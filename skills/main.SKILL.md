# main.SKILL.md — AgenticWiki 参考文档

> **Agent 参考手册**。入口文档是 `README.md`，本文件提供详细的参数、流程和故障排查。

---

## 三模式架构

| 模式 | 命令 | 说明 |
|:---|:---|:---|
| **模式 A：首次全量** | `npx tsx src/runner.ts --project <path>` | 初始化项目，INIT→SCAN→DEPENDENCY→GEN(暂停)，分批调度 LLM |
| **模式 B：断点续跑** | `npx tsx src/runner.ts --project <path> --resume` | 读取 state.json，跳过已完成，继续未完成的 GEN 任务 |
| **模式 C：增量更新** | `npx tsx src/runner.ts --project <path> --mode incremental --since HEAD~1` | Git diff → 依赖传播 BFS → 标记受影响 genTasks → 暂停 |

**典型工作流**：模式 A → GEN 暂停 → spawn SubAgent → 模式 B → GEN 暂停 → spawn → 模式 B → ... 反复直到 DONE。项目更新后走模式 C。

---

## 模式 A 详细流程

### Step 1：启动流水线

```bash
npx tsx src/runner.ts --project /path/to/target
```

Runner 自动执行 INIT → SCAN → DEPENDENCY → GEN（调度），
然后输出 SubAgent prompts 并**暂停**。

### Step 2：并发启动 SubAgent

Runner 暂停后会显示：

```text
📝 SubAgent Prompts 已输出到: /path/.agentic-wiki/cache/gen-prompts/
   1. 依次读取 prompts 文件
   2. 使用 spawn_agent 工具启动 SubAgent（每个 prompt 一个）
   3. SubAgent 全部完成后运行 --resume
```

按 Runner 输出的指令，逐个读取 prompt 文件并用 `spawn_agent` 启动 SubAgent。
每个 SubAgent 会生成 1 个 Wiki 章节 + Issue 文件。

### Step 3：续跑完成（即模式 B）

```bash
npx tsx src/runner.ts --project /path/to/target --resume
```

Runner 自动 GEN（验证）→ ASSEMBLE → VALIDATE → DONE。
**可以反复 `--resume` 直到全部任务完成**。产物在 `wiki/book.md` 和 `wiki/glossary.md`。

---

## 模式 C 详细说明

```bash
npx tsx src/runner.ts --project /path/to/target --mode incremental --since HEAD~1
```

Runner 自动执行以下步骤：

1. **Git diff**：`git diff --name-only {since}...HEAD` 获取变更文件
2. **过滤源码**：仅保留 `.ts/.tsx/.js/.jsx` 文件
3. **加载依赖图**：读取全量分析时生成的 `dependency-graph.json`
4. **BFS 依赖传播**：从变更文件出发，沿 `dependents` 方向层层传播，找到所有间接受影响的文件
5. **标记 genTasks**：将受影响文件夹的 genTasks 状态重置为 `pending`
6. **重跑 gen-scheduler**：为 pending 任务重新生成 SubAgent prompts
7. **暂停**：输出 prompts，等待 Agent spawn SubAgent

> ⚠️ 改了底层依赖（如 `utils/format.ts`）会沿导入链向上传播，大量上层文件被标记为受影响，这是**预期行为**，不是 bug。

---

## 参数速查

| 参数 | 用途 | 示例 |
|:---|:---|:---|
| `--project <path>` | 目标项目路径（必填） | `--project /path/to/project` |
| `--resume` | 断点续跑（模式 B） | `--resume` |
| `--mode incremental` | 增量更新（模式 C） | `--mode incremental` |
| `--since <ref>` | 增量模式的 Git 基准 | `--since HEAD~1` |
| `--limit N` | GEN 阶段每批调度 N 个文件夹（默认 5） | `--limit 5` |
| `--force` | 清除已有状态，从 INIT 重新开始 | `--force` |
| `--to <phase>` | 运行到指定阶段（含） | `--to DEPENDENCY` |
| `--only <phase>` | 仅运行指定阶段 | `--only ASSEMBLE` |
| `--dry-run` | 预览执行计划，不实际运行 | `--dry-run` |

---

## 路径铁律（Runner 自动校验，无需记忆）

| # | 规则 | Runner 行为 |
|:---:|:---|:---|
| 1 | `projectRoot` ≠ AgenticWiki 自身目录 | 启动时自动校验，违反则阻断 |
| 2 | Wiki 输出到 `{projectRoot}/wiki/` | Runner 自动推导 wikiRoot |
| 3 | `.agentic-wiki/` 在 projectRoot 下 | Runner 自动推导 cacheRoot |

> Agent 只需记住 `--project` 参数指向**被分析的代码所在项目**，其余 Runner 自动处理。

---

## 反馈链路（自动）

Runner 内置双层反馈机制，**Agent 无需手动操作**：

| 环节 | 时机 | Runner 行为 |
|:---|:---|:---|
| 🔄 **注入** | GEN 阶段 prompt 生成后 | 自动读取 `global-strategies.md` + `prompts.md`，注入每个 SubAgent prompt 末尾 |
| 📝 **记录** | 任何阶段失败时 | 自动调用 `state-manager.ts append-feedback`，追加失败原因到 `prompts.md` |
| 🌱 **种子** | 首次运行 INIT 时 | 自动创建种子 `prompts.md`，确保后续阶段有策略可加载 |

> 反馈链路持久化到 `.agentic-wiki/feedback/prompts.md`，跨会话保留。

---

## 故障排查

| 症状 | 诊断 | 修复 |
|:---|:---|:---|
| Runner 启动即阻断 | 路径铁律违反 | 确认 `--project` 指向目标项目，非 AgenticWiki 自身 |
| state.json 不存在 | 首次运行 | Runner 自动初始化 |
| GEN 阶段无 SubAgent prompt | gen-scheduler 失败 | 检查 folder-strategy.json 是否完整 |
| SubAgent 产物丢失 | SubAgent "只说不写" | Prompt 内置 `write_file` 强制规则；反馈策略含 GEN-001 修复 |
| 进度面板显示 0% | genTasks 未同步 | Runner 在 ASSEMBLE 阶段自动运行 sync-gen-tasks |
| 增量模式提示无变更 | `--since` 指向错误 | 确认 `--since` 指向正确的基准 commit（如 `HEAD~1`） |
| 增量模式依赖图缺失 | 未先运行模式 A | 先执行一次完整全量分析生成 `dependency-graph.json` |
| 增量模式触发大量文件 | 底层依赖被改动 | 依赖传播行为，是预期结果——受影响的文件确实需要重分析 |
