# main.SKILL.md — AgenticWiki 唯一切入点

> 替代原来 10 个 aw-* SKILL.md 的碎片化指令。Agent 只需读这一个文件。

---

## 启动方式

只有一条命令：

```bash
npx tsx src/runner.ts --project <目标项目路径>
```

> Runner 自动完成：
- ✅ 路径自检（projectRoot ≠ AgenticWiki 根目录）
- ✅ 目录初始化（.agentic-wiki/ + wiki/）
- ✅ 状态管理（state.json 创建/读取/更新）
- ✅ 阶段执行（INIT → SCAN → DEPENDENCY → GEN）
- ✅ 门控验证（每阶段产物完整性检查）
- ✅ 反馈种子（prompts.md 自动创建）
- 🔄 反馈注入（global-strategies.md + prompts.md → SubAgent prompt）
- 📝 失败记录（阶段失败自动追加到 prompts.md）

---

## 完整流程（3 步）

### Step 1：启动流水线

```bash
npx tsx src/runner.ts --project /path/to/target
```

Runner 自动执行 INIT → SCAN → DEPENDENCY → GEN（调度），
然后输出 SubAgent prompts 并**暂停**。

### Step 2：并发启动 SubAgent

Runner 暂停后会显示：

```
📝 SubAgent Prompts 已输出到: /path/to/target/.agentic-wiki/prompts/
   Agent 下一步操作：
   1. 依次读取 prompts 文件
   2. 使用 spawn_agent 工具启动 SubAgent
   3. SubAgent 全部完成后运行 --resume
```

按 Runner 输出的指令，逐个读取 prompt 文件并用 `spawn_agent` 启动 SubAgent。
每个 SubAgent 会生成 1 个 Wiki 章节 + Issue 文件。

### Step 3：续跑完成

```bash
npx tsx src/runner.ts --project /path/to/target --resume
```

Runner 自动执行 GEN（验证）→ ASSEMBLE → VALIDATE → DONE。

---

## 常用参数

| 参数 | 用途 | 示例 |
|:---|:---|:---|
| `--project <path>` | 目标项目路径（必填） | `--project /path/to/project` |
| `--limit N` | GEN 阶段每次调度 N 个文件夹 | `--limit 5` |
| `--resume` | 从上次中断的阶段继续 | `--resume` |
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

## 断点恢复

流水线中断（脚本失败、SubAgent 超时、手动暂停）后：

```bash
npx tsx src/runner.ts --project /path/to/target --resume
```

Runner 自动读取 `state.json`，从 `currentPhase` 继续。已完成的阶段自动跳过。

---

## 模式 B：页面级 Wiki（独立工具，不走 runner）

分析单个页面/组件时，使用 `adft-page-wiki-generator` skill：

```
加载 adft-page-wiki-generator skill，然后按其流程执行。
目标路径：{用户指定的页面文件或目录}
```

---

## 模式 C：增量分析

```bash
npx tsx src/runner.ts --project /path/to/target --mode incremental --since HEAD~1
```

Runner 自动执行增量流程：Git diff → 依赖传播 → 仅分析受影响文件夹。

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
