# AgenticWiki — Agent 操作手册

> **阅读对象**：LLM Agent（Zed / Claude Code / Cursor）
> **定位**：快速上手 + 关键约束，其他细节引用已有文档

---

## 0. 🔴 文档更新规则（Agent 必须遵守）

> **如果你修改了任何 SKILL.md 或 `src/lib/` 脚本，必须同步检查并更新以下两个文件：**
>
> 1. **`agents.md`**（本文件）— 约束、目录速览、故障排查、文档索引
> 2. **`README.md`** — 入口路由、架构图、脚本速查表、参考文档
>
> 具体检查清单：
> - 新增/删除/重命名脚本 → 更新「目录速览」的脚本数量、「关键脚本速查」表、`package.json` scripts
> - 新增/删除/修改 SKILL.md → 更新「如何启动」的模式表、文档索引
> - 新增/修改基础设施（dag-definition.ts、shared/） → 更新目录速览、DAG 流水线说明
> - 路径铁律、门控体系、写入安全等全局规则的变更 → 同步更新 `skills/base.SKILL.md`
> - 错误处理的变更 → 更新「故障排查」表
>
> **遗漏这两个文件是常见的 Agent 失误，会导致下一个 Agent 拿到过时的操作手册，做出错误决策。**

---

## 1. 这是什么？

Agent 驱动的前端代码 → Wiki 转换系统，基于 [LLM Wiki](docs/LLM-Wiki_karpathry.md) 思想。

**核心原则**：Agent 读 SKILL.md → 决策 → 调脚本/启 SubAgent，脚本只产出 JSON，LLM 只产出 Markdown。

> 完整架构：[docs/design/architecture.md](docs/design/architecture.md)
> 技术规格：[docs/design/spec-v2-context-safe.md](docs/design/spec-v2-context-safe.md)

---

## 2. 路径铁律（违反必须阻断）

| # | 正确 ✅ | 错误 ❌ |
|---|---------|---------|
| 1 | `projectRoot` = 被分析项目的根目录 | 指向 AgenticWiki 自身 |
| 2 | Wiki 输出到 `{projectRoot}/wiki/` | 漏到 AgenticWiki 目录 |
| 3 | `.agentic-wiki/` 在 `{projectRoot}/` 下 | 写在 AgenticWiki 目录下 |

> **自动化验证**（替代 Agent 手动检查）：每个阶段开始前运行：
> ```bash
> npx tsx src/lib/validate-paths.ts --state .agentic-wiki/state.json
> ```
> 退出码 0 = 通过，1 = 阻断。详见 `skills/base.SKILL.md`。

---

## 3. 启动前必读

**在读取任何 `skills/aw-*/SKILL.md` 之前，必须先读取 `skills/base.SKILL.md`** 加载全局规则（路径铁律、门控体系、写入安全、反馈循环、错误码速查）。这些规则之前重复在 5+ 个文件中，现在集中到单一文件。

然后读 `README.md`（入口路由），按意图选模式：

| 模式 | 入口 SKILL.md |
|------|--------------|
| 全量分析 | `skills/aw-orchestrator/SKILL.md` |
| 增量分析 | `skills/aw-incremental/SKILL.md` |
| 单文件夹 | `skills/aw-analyze/SKILL.md` |

然后严格按 SKILL.md 指令执行。

---

## 4. DAG 流水线

```
INIT → SCAN → DEPENDENCY → GEN → ASSEMBLE → VALIDATE → DONE
  │       │         │          │        │           │
  └─GATE──┴─GATE────┴─GATE─────┴─GATE───┴─GATE──────┘
                                                    │
                                          ┌─ 失败 ──┘
                                          ↓
                                      FEEDBACK → 回退
```

> 各阶段职责、脚本清单、门控体系详见各阶段 SKILL.md 和 [架构文档](docs/design/architecture.md)。
>
> **DAG 已代码化**：所有阶段的脚本调用顺序、门控产物、阶段间依赖关系定义在 `src/dag-definition.ts`。
> 编排器 Agent 可读取此文件获取当前阶段需要执行哪些脚本，替代手动从 SKILL.md 文本中提取。

---

## 5. 目录速览

```
skills/           # 10 个 SKILL.md 指令集（base: 全局规则，aw-*: 9 个阶段技能）
src/types/        # 完整 TypeScript 类型定义
src/lib/          # 28 个脚本 + shared/ 共享基础设施
src/lib/shared/   # logger.ts（结构化日志）、errors.ts（错误码体系）
src/lib/__tests__ # 14 个测试文件（含 state-manager 23 个新用例）
src/dag-definition.ts  # DAG 代码级定义（阶段脚本、门控产物、条件路由）
docs/design/      # 架构、技术规格、Issue 检测指南
docs/feedback/    # 跨项目通用改进策略
project/          # 示例目标项目
```

---

## 6. 关键约束

1. **脚本调用必须**通过 `terminal` 工具执行 `npx tsx src/lib/xxx.ts`，禁止手动模拟产出。
2. **Issue 类型**只有 6 种：`missing_types`、`complex_logic`、`circular_dependency`、`dead_code`、`inconsistent_api`、`potential_bug`。详情见 `skills/aw-generate/SKILL.md` 和 `docs/design/issue-detection-guide.md`。
3. **状态文件**（`state.json`）只能通过 `state-manager.ts` 操作，支持文件锁（mkdir 原子锁 + PID 存活校验）。
4. **增量优先**：全量分析是特例，增量分析是常态。
5. **路径验证自动化**：每个阶段开始前运行 `npm run validate:paths`（替代 Agent 手动逐项校验路径铁律）。
6. **文档同步**：修改任何 SKILL.md 或脚本后，必须检查并更新 `agents.md` 和 `README.md`（见第 0 节）。
7. **反馈去重**基于 `phase + 消息首行`，不同文件夹/不同根因的失败不会被误去重。

---

## 7. 故障排查

| 问题 | 排查 |
|------|------|
| 脚本执行失败 | `npm install` → 检查 TypeScript 编译 |
| 产物缺失 | 运行 `validate-artifacts.ts` |
| 门禁阻断 | 查看 `state.json.blockers` |
| 状态异常 | 运行 `state-manager.ts validate` |
| 路径错误 | 运行 `npm run validate:paths`（自动检测 6 条规则） |
| **dependency-cruiser 超时** | 增加 `--timeout` 或缩小分析范围 |
| **dependency-cruiser maxBuffer 溢出**（大型项目） | 增加 `--max-buffer`（如 `--max-buffer 104857600` 为 100MB） |
| GEN 阶段卡死 | 检查 `genTasks` 状态 → 运行 `gen:sync` → 查看 `wiki/PROGRESS.md` |

---

## 8. 文档索引

| 文档 | 用途 |
|------|------|
| `README.md` | 入口路由 |
| `skills/base.SKILL.md` | 🔴 **全局共享规则**（启动前必读） |
| `docs/design/architecture.md` | 完整架构与数据规范 |
| `docs/design/spec-v2-context-safe.md` | 流水线技术规格 |
| `docs/design/issue-detection-guide.md` | Issue 检测标准 |
| `docs/feedback/global-strategies.md` | 全局改进策略 |
| `src/types/index.ts` | TypeScript 类型字典 |
| `src/dag-definition.ts` | DAG 代码级定义（脚本顺序 + 门控 + 路由） |
| `src/lib/shared/errors.ts` | 结构化错误码（E001-E502） |
| `src/lib/shared/logger.ts` | 结构化日志工具 |
| `skills/aw-orchestrator/SKILL.md` | 编排器完整指令 |
| `skills/aw-generate/SKILL.md` | GEN 阶段 Issue 约束 |
| `skills/aw-init/SKILL.md` | 路径自检规则 |
