# AgenticWiki

> **你是 Agent。这是入口文档。读完就能行动。**

Agent 驱动的前端代码转 Wiki 系统。基于 [LLM Wiki (karpathry)](docs/reference/LLM-Wiki_karpathry.md) 思想。

---

## 🔴 入口：选模式

### 模式 A：全量 DAG 流水线（推荐）

**Step 1 — 启动**：

```bash
npx tsx src/runner.ts --project /absolute/path/to/target
```

Runner 自动 INIT → SCAN → DEPENDENCY → GEN（调度），然后**暂停**输出 SubAgent 任务。

**Step 2 — 并发调度 SubAgent**：

Runner 暂停后打印：
```
📝 SubAgent Prompts 已输出到: /path/.agentic-wiki/prompts/
   1. 依次读取 prompts 文件
   2. 使用 spawn_agent 启动 SubAgent（每个 prompt 一个）
   3. SubAgent 全部完成后运行 --resume
```

按指令操作：读 prompt → `spawn_agent` → 等全部完成。

**Step 3 — 续跑完成**：

```bash
npx tsx src/runner.ts --project /absolute/path/to/target --resume
```

Runner 自动 GEN（验证）→ ASSEMBLE → VALIDATE → DONE。
产物在 `wiki/book.md` 和 `wiki/glossary.md`。

---

### 场景覆盖：Agent 可能遇到的所有分支

| 场景 | 操作 |
|:---|:---|
| **首次运行** | Step 1 → Step 2 → Step 3 |
| **上次中断了（任何阶段）** | 直接用 `--resume`，Runner 从断点继续 |
| **Step 2 中某个 SubAgent 失败** | 重跑 Step 1（带 `--limit` 可缩小范围），Runner 自动跳过已完成的，只重试失败的 |
| **大项目分批执行** | 循环：`Step 1 --limit 5` → `Step 2` → `Step 1 --limit 5` → ... → 全部完成 → `Step 3` |
| **只想跑到依赖图不生成 Wiki** | `npx tsx src/runner.ts --project /path --to DEPENDENCY` |
| **只想重新组装（Wiki 已有）** | `npx tsx src/runner.ts --project /path --only ASSEMBLE` |
| **想从头重来** | `npx tsx src/runner.ts --project /path --force` |
| **不确定会执行什么** | `npx tsx src/runner.ts --project /path --dry-run` |
| **崩溃/超时后恢复** | Runner 所有阶段幂等，直接 `--resume` |
| **完成后产物在哪** | `wiki/book.md`（成书）、`wiki/glossary.md`（术语表）、`wiki/PROGRESS.md`（进度） |

---

### 模式 B：页面级 Wiki 生成（独立工具，不经过 runner）

加载 `adft-page-wiki-generator` skill，按其流程执行。

---

### 模式 C：增量分析

```bash
npx tsx src/runner.ts --project /path/to/target --mode incremental --since HEAD~1
```

前提：项目已有完整 Wiki。Runner 自动 Git diff → 依赖传播 → 仅更新受影响的部分。

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
| DEPENDENCY | 依赖图 + 优先级 + 拆分 + 子图 | ❌ |
| GEN | 调度 + Prompt 生成 → **暂停** | ✅ |
| ASSEMBLE | 符号索引 + Issue + 组装成书 | ❌ |
| VALIDATE | 交叉引用 + 源码校验 | ❌ |

## License

MIT
