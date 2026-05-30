# AgenticWiki — Agent 操作手册

> **阅读对象**：LLM Agent（Zed / Claude Code / Cursor）
> **定位**：快速上手 + 关键约束，其他细节引用已有文档

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

---

## 3. 如何启动？

读 `README.md`（入口路由），按意图选模式：

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

---

## 5. 目录速览

```
skills/           # 9 个 SKILL.md 指令集（Agent 执行手册）
src/types/        # 完整 TypeScript 类型定义
src/lib/          # 22 个纯数据脚本，全部有 CLI（npx tsx src/lib/xxx.ts）
src/lib/__tests__ # 13 个测试文件
docs/design/      # 架构、技术规格、Issue 检测指南
docs/feedback/    # 跨项目通用改进策略
project/          # 示例目标项目
```

---

## 6. 关键约束

1. **脚本调用必须**通过 `terminal` 工具执行 `npx tsx src/lib/xxx.ts`，禁止手动模拟产出。
2. **Issue 类型**只有 6 种：`missing_types`、`complex_logic`、`circular_dependency`、`dead_code`、`inconsistent_api`、`potential_bug`。详情见 `skills/aw-generate/SKILL.md` 和 `docs/design/issue-detection-guide.md`。
3. **状态文件**（`state.json`）只能通过 `state-manager.ts` 操作，支持文件锁。
4. **增量优先**：全量分析是特例，增量分析是常态。

---

## 7. 故障排查

| 问题 | 排查 |
|------|------|
| 脚本执行失败 | `npm install` → 检查 TypeScript 编译 |
| 产物缺失 | 运行 `validate-artifacts.ts` |
| 门禁阻断 | 查看 `state.json.blockers` |
| 状态异常 | 运行 `state-manager.ts validate` |
| 路径错误 | 核对第 2 节路径铁律 |

---

## 8. 文档索引

| 文档 | 用途 |
|------|------|
| `README.md` | 入口路由 |
| `docs/design/architecture.md` | 完整架构与数据规范 |
| `docs/design/spec-v2-context-safe.md` | 流水线技术规格 |
| `docs/design/issue-detection-guide.md` | Issue 检测标准 |
| `docs/feedback/global-strategies.md` | 全局改进策略 |
| `src/types/index.ts` | TypeScript 类型字典 |
| `skills/aw-orchestrator/SKILL.md` | 编排器完整指令 |
| `skills/aw-generate/SKILL.md` | GEN 阶段 Issue 约束 |
| `skills/aw-init/SKILL.md` | 路径自检规则 |
