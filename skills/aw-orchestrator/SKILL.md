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
INIT → SCAN → DEPENDENCY ─┬─→ ANALYZE → GENERATE → VALIDATE ─→ DONE
                          │                        │
                          └→ INCREMENTAL ──────────┘
                                                   │
                                        ┌── 失败 ──┘
                                        ↓
                                    FEEDBACK → 回退
```

#### 阶段执行策略

| 阶段 | 执行方式 | 说明 |
|------|---------|------|
| INIT | Main Agent 直接执行 | 简单初始化 |
| SCAN | Main Agent 直接执行 | 文件扫描 |
| DEPENDENCY | Main Agent 直接执行 | 依赖图构建 |
| INCREMENTAL | Main Agent 直接执行 | 增量分析（可选） |
| ANALYZE | **SubAgent 并发** | 多文件夹并行分析 |
| GENERATE | **SubAgent 并发** | 多 Wiki 并行生成 |
| VALIDATE | Main Agent 直接执行 | 验证结果 |
| FEEDBACK | Main Agent 直接执行 | 反馈循环（失败时） |

---

### Phase 2: ANALYZE 阶段（并发调度）

#### Step 1: 确定分析范围

**全量模式**：
- 使用 `read_file` 工具读取 `folder-strategy.json`
- 获取所有文件夹列表

**增量模式**：
- 使用 `read_file` 工具读取 `incremental-analysis.json`
- 获取 `affectedFolders` 列表

#### Step 2: 创建 SubAgent 任务清单

```markdown
| ID | 文件夹 | Agent类型 | 任务描述 | 依赖 |
|----|--------|-----------|---------|------|
| T1 | src/components/ | general-purpose | 分析组件结构 | - |
| T2 | src/pages/ | general-purpose | 分析页面逻辑 | - |
| T3 | src/utils/ | general-purpose | 分析工具函数 | - |
```

#### Step 3: 启动 SubAgent

使用 `spawn_agent` 工具并发启动所有 SubAgent：

```
最大并发数: 5
单任务超时: 10 分钟
失败策略: continue（继续执行其他任务）
```

#### Step 4: 等待完成

收集所有 SubAgent 的输出结果。

#### Step 5: 汇总结果

使用 `read_file` 工具读取所有 `analysis/*.json`，汇总统计。

---

### Phase 3: GENERATE 阶段（并发调度）

与 ANALYZE 阶段类似，但生成 Wiki 文档。

---

### Phase 4: 状态更新

每个阶段完成后，使用 `edit_file` 工具更新 `state.json`：

```json
{
  "currentPhase": "<下一阶段>",
  "phaseHistory": [
    {
      "phase": "<当前阶段>",
      "status": "completed",
      "startedAt": "<时间戳>",
      "completedAt": "<时间戳>",
      "output": "<产物路径>"
    }
  ],
  "checkpoint": {
    "lastSuccessPhase": "<当前阶段>",
    "timestamp": "<时间戳>"
  }
}
```

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
