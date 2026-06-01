# AgenticWiki

> **你是 Agent。这是入口文档。读完就能行动。**

Agent 驱动的前端代码转 Wiki 系统。基于 [LLM Wiki (karpathry)](docs/reference/LLM-Wiki_karpathry.md) 思想。

---

## 🔴 入口：选模式

### 模式 A：首次全量分析

启动流水线，初始化项目，分批次调度 LLM 完成 Wiki 分析。**不要求一次性跑完所有文件夹。**

```bash
npx tsx src/runner.ts --project /absolute/path/to/target
```

Runner 自动 INIT → SCAN → DEPENDENCY → GEN（调度），然后**暂停**并输出：

```
📝 SubAgent Prompts 已输出到: /path/.agentic-wiki/gen-prompts/
   1. 依次读取 prompts 文件
   2. 使用 spawn_agent 启动 SubAgent（每个 prompt 一个）
   3. 批量完成后运行模式 B 继续
```

Agent 按指令：读 prompt → `spawn_agent` → 完成当前批次后，进入**模式 B**继续。

> 💡 **自动聚簇模式**：DEPENDENCY 阶段自动分析依赖关系，将文件按组件簇分组
> （如 `Button.tsx + useClick.ts` 作为一个任务）。如果 `task-clusters.json` 存在，
> GEN 阶段自动使用聚簇模式（SubAgent 数量减少 50-60%）；否则回退到文件夹模式。
> **Agent 无需做任何额外操作。**

---

### 模式 B：断点续跑

检查 `state.json`，跳过已完成的 GEN 任务，继续调度剩余的。**可以反复执行直到全部完成。**

```bash
npx tsx src/runner.ts --project /absolute/path/to/target --resume
```

Runner 自动读取状态 → GEN（仅未完成任务）→ 暂停 → Agent spawn → 再次 `--resume` → ... 全部完成后自动 ASSEMBLE → VALIDATE。

产物在 `wiki/book.md` 和 `wiki/glossary.md`。

---

### 模式 C：增量更新

项目代码变更后，仅更新受影响的部分。

```bash
npx tsx src/runner.ts --project /absolute/path/to/target --mode incremental --since HEAD~1
```

前提：项目已有完整 Wiki。Runner 自动执行以下步骤：

1. **Git diff**：`git diff --name-only {since}...HEAD` 获取变更文件
2. **过滤源码**：仅保留 `.ts/.tsx/.js/.jsx` 文件
3. **加载依赖图**：读取全量分析时生成的 `dependency-graph.json`
4. **BFS 依赖传播**：从变更文件出发，沿 `dependents` 方向层层传播，找到所有间接受影响的文件
5. **标记 genTasks**：将受影响文件夹的 genTasks 状态重置为 `pending`
6. **重跑 gen-scheduler**：为 pending 任务重新生成 SubAgent prompts
7. **暂停**：输出 prompts，等待 Agent spawn SubAgent

> ⚠️ 改了底层依赖（如 `utils/format.ts`）会沿导入链向上传播，大量上层文件被标记为受影响，这是**预期行为**，不是 bug。

---

### 典型工作流

```
模式 A（首次启动）
  → GEN 暂停
  → Agent spawn SubAgent（批次 1）
  → 模式 B（--resume）
  → GEN 暂停
  → Agent spawn SubAgent（批次 2）
  → 模式 B（--resume）
  → GEN 暂停
  → Agent spawn SubAgent（批次 N）
  → 模式 B（--resume）
  → ASSEMBLE → VALIDATE → ✅ DONE

项目更新后：
  → 模式 C（--mode incremental --since HEAD~1）
  → 自动进入模式 B 流程
  → ✅ DONE
```

---

### 参数速查

| 参数 | 类型 | 必须 | 默认值 | 说明 |
|:---|:---|:---:|:---|:---|
| `--project <path>` | `string` | ✅ | — | 被分析的目标项目路径（绝对路径） |
| `--mode <mode>` | `full` \| `incremental` | | `full` | 流水线模式：`full` 全量分析，`incremental` 增量更新 |
| `--resume` | `boolean` | | `false` | 从上次中断的阶段继续（模式 B） |
| `--limit N` | `number` | | `5` | GEN 阶段每批调度 N 个子任务。与 `--token-limit` 互斥（后指定者生效） |
| `--token-limit N` | `number` | | — | GEN 阶段每批总 Token 上限（如 `300000`）。按 Token 阈值调度而非任务数量 |
| `--to PHASE` | `string` | | — | 运行到指定阶段后停止。可选: `INIT` `SCAN` `DEPENDENCY` `GEN` `ASSEMBLE` `VALIDATE` `DONE` |
| `--only PHASE` | `string` | | — | 仅运行指定阶段。如 `--only ASSEMBLE` 重新组装已有 Wiki 产物 |
| `--force` | `boolean` | | `false` | 清除已有状态文件（`state.json`），从 `INIT` 重新开始 |
| `--dry-run` | `boolean` | | `false` | 仅展示将执行的阶段和脚本清单，不实际运行 |
| `--since <ref>` | `string` | | — | 增量模式专用：Git 基准引用（如 `HEAD~1`）。仅 `--mode incremental` 时有效 |

---

### 反馈链路（自动）

Runner 内置双层反馈机制，**Agent 无需手动操作**：

| 环节 | 时机 | Runner 行为 |
|:---|:---|:---|
| 🔄 **注入** | GEN 阶段 prompt 生成后 | 自动读取 `global-strategies.md` + `prompts.md`，注入每个 SubAgent prompt 末尾 |
| 📝 **记录** | 任何阶段失败时 | 自动调用 `state-manager.ts append-feedback`，追加失败原因到 `prompts.md` |
| 🌱 **种子** | 首次运行 INIT 时 | 自动创建种子 `prompts.md`，确保后续阶段有策略可加载 |

> 反馈链路持久化到 `.agentic-wiki/feedback/prompts.md`，跨会话保留。

---

### 故障排查

| 症状 | 修复 |
|:---|:---|
| Runner 启动即阻断 | 确认 `--project` 指向目标项目，非 AgenticWiki 自身 |
| state.json 不存在 | 首次运行，Runner 自动初始化 |
| GEN 阶段无 SubAgent prompt | 检查 `folder-strategy.json` 或 `task-clusters.json` 是否存在 |
| SubAgent 产物丢失 | Prompt 内置 `write_file` 强制规则；反馈策略含 GEN-001 修复 |
| SubAgent read_file 模板失败 | 检查 `.agentic-wiki/templates/` 下 3 个模板文件是否存在（首次 GEN 自动生成） |
| genTasks 状态不同步 | `--resume` 时自动同步已完成任务，无需 Agent 手动操作 |
| Issue 文件格式错误 | 每批 GEN 完成后自动运行 validate-issue-types --fix 修复 |
| 源文件路径不含 src/ | SubAgent prompt 内置 src/ 前缀规则；反馈策略含 GEN-004 修复 |
| 进度面板显示 0% | genTasks 未同步，Runner 在 ASSEMBLE 阶段自动运行 sync-gen-tasks |
| 增量模式提示无变更 | 确认 `--since` 指向正确的基准 commit（如 `HEAD~1`） |
| 增量模式依赖图缺失 | 先运行一次完整的模式 A 生成全量分析结果 |
| 增量模式全量重跑 | 底层依赖被改动，依赖传播触发大量文件重分析，这是预期行为 |

---

## 🔴 路径铁律

**只需记住一件事**：`--project` 指向被分析的代码所在项目，不要指向 AgenticWiki 自身。

```
正确: --project /Users/alex/projects/my-app
错误: --project .  ← 会把 Wiki 写到 AgenticWiki 目录里
```

Runner 启动时自动校验，违反则阻断。

---

## 架构

```
Agent（读本文件）→ runner.ts（自动编排 6 阶段）→ 28 个脚本
                                       ↘ GEN 暂停 → Agent spawn SubAgent
```

| 阶段 | Runner 自动 | Agent？ |
|:---|:---|:---:|
| INIT | 项目扫描 + 哈希 + 状态初始化 | ❌ |
| SCAN | 文件扫描 + 样式过滤 | ❌ |
| DEPENDENCY | 依赖图 + 优先级 + 拆分 + 子图 + 文件元信息 + 依赖聚簇 | ❌ |
| GEN | 调度 + 模板生成 + Prompt 生成（自动聚簇/文件夹模式）→ **暂停** | ✅ |
| ASSEMBLE | 符号索引 + Issue + 组装成书 | ❌ |
| VALIDATE | 交叉引用 + 源码校验 | ❌ |

### 优化特性（v2.1）

| 优化 | 说明 | 收益 |
|:---|:---|:---:|
| **Prompt 模板外置** | Issue 规则、输出格式、路径安全规则提取到 `.agentic-wiki/templates/`，SubAgent 通过 `read_file` 引用 | Token 节省 ~74% |
| **动态 Token 预算** | 预算按 `estimatedTokens × 1.5 + 5000` 动态计算，限制 [10K, 80K] | 小文件夹 Token 减少 ~87% |
| **Token 阈值批次** | `--token-limit N` 按总 Token 数切分批次，替代 `--limit` 的任务数切分 | 批次 Token 消耗更均衡 |
| **动态拆分阈值** | 50K/30K/5K 硬编码 → 项目总 Token × 百分比（5%/2.5%/0.3%）动态计算 | 适配不同规模的项目 |
| **入口文件内联** | 纯 re-export 的 `index.ts` 自动合并到相邻 subTask，不单独生成 | 减少无效 subTask，节省 Token |
| **文件元信息提取** | `extract-file-meta.ts` 预分析组件/Hook/Props/export，SubAgent 读取摘要而非源码 | SubAgent Token 减少 ~60% |
| **依赖聚簇划分** | `cluster-tasks.ts` 按依赖 BFS 聚簇替代文件夹+角色划分 | subTask 数量减少 50-60% |

## License

MIT
