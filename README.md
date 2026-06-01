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

项目代码变更后，仅更新受影响的部分。自动 Git diff → 依赖传播 → 标记受影响文件夹 → 进入模式 B 流程。

```bash
npx tsx src/runner.ts --project /absolute/path/to/target --mode incremental --since HEAD~1
```

前提：项目已有完整 Wiki。Runner 自动检测变更范围，依赖传播后仅重新分析受影响部分。

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

| 参数 | 用途 |
|:---|:---|
| `--limit N` | GEN 阶段每批调度 N 个文件夹（默认 5）。N 越小，批次间反馈传播越及时 |
| `--to PHASE` | 运行到指定阶段后停止。如 `--to DEPENDENCY` 仅出依赖图不生成 Wiki |
| `--only PHASE` | 仅运行指定阶段。如 `--only ASSEMBLE` 重新组装已有 Wiki |
| `--force` | 清除已有状态，从 INIT 重新开始 |
| `--dry-run` | 仅展示将执行的阶段和脚本，不实际运行 |
| `--resume` | 断点续跑（即模式 B） |

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
