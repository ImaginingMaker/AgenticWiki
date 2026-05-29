# aw-orchestrator — 主编排器

> DAG 任务调度、状态管理、断点恢复、反向反馈

## 触发条件

- 用户说"生成 Wiki"、"开始分析"
- 用户说"继续"、"恢复任务"
- 其他 Skills 完成后需要继续流程

---

## 你的角色

你是主编排器，负责：

1. **状态管理**：读取和更新 `state.json`
2. **DAG 调度**：按依赖关系执行各阶段
3. **并发调度**：ANALYZE 和 GENERATE 阶段并发执行
4. **断点恢复**：从上次中断的位置继续
5. **反向反馈**：验证失败时回退并改进

---

## 🔒 强制脚本调用规则

> **这是最高优先级约束。违反此规则会导致流水线产物不可信。**

### 核心原则

**脚本写 JSON，LLM 写 Markdown。两者永远不交叉。**

- 凡是标注 `🔧 脚本` 的步骤，**必须**通过 `terminal` 工具调用脚本完成
- **禁止**用 `read_file` + `write_file` 手动模拟脚本产出
- **禁止**跳过脚本调用直接进入下一阶段
- 脚本调用失败时，**必须**记录到 `state.json.blockers` 并暂停流水线

### 各阶段脚本调用清单

| 阶段 | 脚本 | 命令 | 产物 | 级别 |
|------|------|------|------|------|
| INIT | `scan-project.ts` | `npx tsx src/lib/scan-project.ts ...` | `project-scan.json` | 🔴 CRITICAL |
| INIT | `compute-hashes.ts` | `npx tsx src/lib/compute-hashes.ts ...` | 哈希快照 | 🟡 REQUIRED |
| SCAN | `scan-files.ts` | `npx tsx src/lib/scan-files.ts ...` | `file-list.json` | 🔴 CRITICAL |
| SCAN | `filter-styles.ts` | `npx tsx src/lib/filter-styles.ts ...` | `filtered-files.json` | 🟡 REQUIRED |
| SCAN | `file-priorities.ts` | `npx tsx src/lib/file-priorities.ts ...` | `file-priorities.json` | 🔴 CRITICAL |
| SCAN | `analyze-folders.ts` | `npx tsx src/lib/analyze-folders.ts ...` | `folder-strategy.json` | 🔴 CRITICAL |
| DEPENDENCY | `build-deps.ts` | `npx tsx src/lib/build-deps.ts ...` | `dependency-graph.json` | 🔴 CRITICAL |
| DEPENDENCY | `build-deps.ts` | `npx tsx src/lib/build-deps.ts ... --format mermaid` | `dependency-graph.mmd` | 🟡 REQUIRED |
| DEPENDENCY | `extract-subgraph.ts` | `npx tsx src/lib/extract-subgraph.ts ...` | `deps/{folder}-deps.json` | 🔴 CRITICAL |
| ASSEMBLE | `symbol-index.ts` | `npx tsx src/lib/symbol-index.ts ...` | `symbol-index.json` | 🟡 REQUIRED |
| ASSEMBLE | `issue-dashboard.ts` | `npx tsx src/lib/issue-dashboard.ts ...` | `issue-dashboard.md` | 🟡 REQUIRED |
| VALIDATE | `validate-references.ts` | `npx tsx src/lib/validate-references.ts ...` | 验证报告 | 🔴 CRITICAL |

### 自检规则

每个阶段完成后，**必须**执行以下自检，通过后才能进入下一阶段：

1. 用 `read_file` 读取该阶段的**所有**预期产物文件
2. 验证文件存在且内容非空
3. 验证 JSON 产物可解析（对 JSON 文件检查 `{` 开头）
4. 将产物路径记录到 `state.json.phaseHistory[].artifacts`

如果任一 🔴 CRITICAL 产物缺失：
- 记录到 `state.json.blockers`
- **暂停流水线**，展示缺失清单给用户
- 不要进入下一阶段

如果任一 🟡 REQUIRED 产物缺失：
- 记录到 `state.json.blockers`（severity: warning）
- 展示警告给用户
- 可以继续，但在最终输出中标注缺失

---

## 核心流程

### Phase 0: 启动检查

#### Step 1: 读取状态

使用 `read_file` 工具读取 `.agentic-wiki/state.json`。

**如果文件不存在**：
- 初始化新任务
- 调用 `aw-init` Skill

**如果文件存在**：
- 检查 `currentPhase`
- 从该阶段继续执行

#### Step 2: 校验文件一致性

使用 `terminal` 工具运行：

```bash
npx tsx src/lib/compute-hashes.ts --path <源码路径> --output /tmp/current-hashes.json
```

对比 `state.json.checkpoint.filesSnapshot` 与当前哈希：

**如果一致**：
- 从 `currentPhase` 继续

**如果不一致**：
- 展示差异文件列表
- 询问用户：
  - "继续"：从 `currentPhase` 继续
  - "重新开始"：清理状态，从 INIT 开始

---

### Phase 1: 执行 DAG

#### DAG 拓扑

```
INIT → SCAN → DEPENDENCY → SCAN(优先级) → GEN → ASSEMBLE → VALIDATE → DONE
                                                    │
                                          ┌─ 失败 ──┘
                                          ↓
                                      FEEDBACK → 回退到 GEN
```

#### 阶段执行策略

| 阶段 | 执行方式 | 说明 |
|------|---------|------|
| INIT | Main Agent + 脚本 | 项目初始化 |
| SCAN | Main Agent + 脚本 | 文件扫描 + 优先级标注（两次调用，中间插入 DEPENDENCY） |
| DEPENDENCY | Main Agent + 脚本 | 依赖图 + 子图提取 |
| GEN | **SubAgent 并发** | 合并分析+Wiki生成（无中间 JSON） |
| ASSEMBLE | Main Agent + 脚本 | 组装成书 + 术语表 + 仪表盘 |
| VALIDATE | Main Agent + 脚本 | 交叉引用验证 |
| FEEDBACK | Main Agent | 反馈循环（失败时） |

---

### Phase 2: GEN 阶段（并发调度）

#### Step 1: 读取调度清单

使用 `read_file` 工具读取 `.agentic-wiki/cache/folder-strategy.json`。

获取 `folders[].subTasks[]` 和 `crossFolderMerges[]`。

#### Step 2: 构建 SubAgent 任务

每个子任务需要以下参数：
- `{projectRoot}`：从 `state.json.config.paths.projectRoot` 获取
- `{folderPath}`：子任务的文件夹路径
- `{budget}`：`state.json.config.tokenBudgetPerSubTask`（默认 80000）
- `{wikiChapter}`：子任务的 `wikiChapter` 字段

#### Step 3: 启动 SubAgent

使用 `spawn_agent` 工具并发启动所有 SubAgent。

```
最大并发数: {state.json.config.maxConcurrentSubAgents}（默认 5）
单任务超时: 10 分钟
失败策略: continue
```

SubAgent 提示模板参考 `aw-generate/SKILL.md`。

#### Step 4: 等待完成

收集所有 SubAgent 的摘要报告，更新 `state.json.genTasks[]`。

---

### Phase 3: ASSEMBLE 阶段

> ⚠️ 以下 Step 1-2 必须通过 terminal 调用脚本，不可手动模拟。

#### Step 1: 生成符号索引（🔧 脚本，必须）

使用 `terminal` 工具运行：

```bash
npx tsx {agenticWikiRoot}/src/lib/symbol-index.ts --wiki wiki/ --output .agentic-wiki/search/symbol-index.json
```

**自检**：运行后用 `read_file` 读取 `.agentic-wiki/search/symbol-index.json`，确认文件存在且内容非空。

#### Step 2: 生成 ISSUE 仪表盘（🔧 脚本，必须）

使用 `terminal` 工具运行：

```bash
npx tsx {agenticWikiRoot}/src/lib/issue-dashboard.ts --issues wiki/volume-2-issues/ --output wiki/appendix/issue-dashboard.md
```

**自检**：运行后用 `read_file` 读取 `wiki/appendix/issue-dashboard.md`，确认文件存在。

#### Step 3: 组装成书

生成以下文件（使用 `write_file` 工具）：
- `wiki/book.md`：封面 + 总目录 + 项目健康度
- `wiki/volume-1-code/_toc.md`：卷 I 目录
- `wiki/volume-2-issues/_toc.md`：卷 II 目录
- `wiki/glossary.md`：术语表（**必须**引用 `symbol-index.json` 中的数据，不可凭空生成）

模板参考 SPEC v2 §7。

#### Step 4: ASSEMBLE 产物自检

完成 Step 1-3 后，**必须**逐项确认以下文件存在：

- [ ] `.agentic-wiki/search/symbol-index.json`（脚本生成）
- [ ] `wiki/appendix/issue-dashboard.md`（脚本生成）
- [ ] `wiki/book.md`（编排器生成）
- [ ] `wiki/volume-1-code/_toc.md`（编排器生成）
- [ ] `wiki/volume-2-issues/_toc.md`（编排器生成）
- [ ] `wiki/glossary.md`（编排器生成）

全部确认后，将产物清单写入 `state.json.phaseHistory[].artifacts`。

---

### Phase 4: 状态更新

每个阶段完成后，使用 `edit_file` 工具更新 `state.json`。

**必须包含 `artifacts` 和 `scriptsExecuted` 字段**，列出该阶段实际生成的所有产物和脚本执行记录：

```json
{
  "currentPhase": "<下一阶段>",
  "phaseHistory": [
    {
      "phase": "<当前阶段>",
      "status": "completed",
      "startedAt": "<时间戳>",
      "completedAt": "<时间戳>",
      "output": "<主要产物路径>",
      "artifacts": [
        ".agentic-wiki/cache/xxx.json",
        ".agentic-wiki/cache/deps/xxx-deps.json"
      ],
      "scriptsExecuted": [
        { "script": "extract-subgraph.ts", "exitCode": 0 },
        { "script": "build-deps.ts", "exitCode": 0 }
      ]
    }
  ],
  "checkpoint": {
    "lastSuccessPhase": "<当前阶段>",
    "timestamp": "<时间戳>"
  }
}
```

**字段说明**：
- `artifacts`：该阶段生成的所有文件路径（相对于项目根目录）
- `scriptsExecuted`：该阶段实际调用的脚本及其执行结果（用于审计和调试）

---

### Phase 5: 断点恢复

如果任务中断，下次启动时：

1. 读取 `state.json`
2. 检查 `currentPhase`
3. 检查 `phaseHistory` 中哪些阶段已完成
4. 从最后一个未完成的阶段继续

**示例**：

```
上次中断时：
- currentPhase: ANALYZE
- phaseHistory: INIT(completed), SCAN(completed), DEPENDENCY(completed), ANALYZE(in_progress)

恢复时：
- 跳过 INIT, SCAN, DEPENDENCY
- 从 ANALYZE 继续
- 检查 ANALYZE 的 subTasks，跳过已完成的子任务
```

---

### Phase 6: 反向反馈

如果 VALIDATE 阶段失败：

1. 调用 `aw-feedback` 分析根因
2. 决定回退阶段
3. 清理该阶段及后续阶段的产物
4. 重新执行该阶段，注入改进策略

**回退规则**：

| VALIDATE 发现的问题 | 回退阶段 |
|---------------------|---------|
| Wiki 内容与代码不一致 | GENERATE |
| 分析逻辑错误 | ANALYZE |
| 依赖图错误 | DEPENDENCY |
| 文件遗漏 | SCAN |

---

## 增量模式

### 触发条件

- 用户指定 `--since` 参数
- 用户说"增量分析"、"只分析变更"

### 执行流程

```
INCREMENTAL（Git diff + 依赖传播）
    │
    ├─→ 只对受影响文件夹执行 ANALYZE
    ├─→ 只对受影响 Wiki 执行 GENERATE
    └─→ 对全部 Wiki 执行 VALIDATE
```

### 优化效果

- 减少分析量（只分析受影响文件夹）
- 减少生成量（只更新受影响 Wiki）
- 保证一致性（验证所有 Wiki）

---

## 加载反馈策略

启动时，使用 `read_file` 工具读取 `.agentic-wiki/feedback/prompts.md`。

在调度对应 Skill 的 SubAgent 时，将相关策略注入到 prompt 中：

```
## 历史反馈与改进策略

### aw-dependency 改进
- 问题: 未检测间接循环依赖
- 改进: 增加传递性分析，深度 ≥ 3

请在构建依赖图时应用此改进策略。
```

---

## 写入安全

每次更新 `state.json` 时：

1. 先备份为 `state.backup.json`
2. 先写入 `state.tmp.json`
3. 成功后重命名为 `state.json`

**损坏恢复**：
- 如果 `state.json` 损坏，从 `state.backup.json` 恢复
- 如果 `state.backup.json` 也损坏，重新初始化

---

## 用户交互

### 启动时

```
🚀 AgenticWiki 启动

模式: 全量分析
项目: /path/to/project

阶段计划:
1. INIT - 项目初始化
2. SCAN - 文件扫描
3. DEPENDENCY - 依赖图构建
4. ANALYZE - 代码分析（并发）
5. GENERATE - Wiki 生成（并发）
6. VALIDATE - 验证

是否开始？
```

### 阶段切换时

```
✅ SCAN 完成 (耗时 2s)

扫描结果:
- 源码文件: 128 个
- 待分析文件夹: 12 个

下一阶段: DEPENDENCY
预计耗时: 5s

继续执行...
```

### 完成时

```
✅ Wiki 生成完成！

输出:
- Wiki 索引: wiki/index.md
- 总页面: 15 个
- 总耗时: 2 分钟

下一步:
- 在 Obsidian 中打开 wiki/ 目录查看
- 运行 "增量分析" 更新 Wiki
```

---

## 错误处理

| 错误 | 处理方式 |
|------|---------|
| 阶段执行失败 | 记录到 `blockers`，询问用户 |
| SubAgent 超时 | 标记为失败，继续执行其他任务 |
| 文件读取失败 | 记录错误，跳过该文件 |
| 状态文件损坏 | 从备份恢复或重新初始化 |

---

## 输出产物

| 文件 | 说明 |
|------|------|
| `.agentic-wiki/state.json` | 状态文件（持续更新） |
| `wiki/` 目录 | 最终 Wiki 文档 |
