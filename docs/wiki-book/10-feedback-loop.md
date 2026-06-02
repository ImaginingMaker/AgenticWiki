# 第十章 反馈闭环与持续改进

> LLM 生成的 Wiki 质量需要持续改进。每个失败都应转化为规则，避免重复犯错。

---

## 10.1 背景

LLM 生成的 Wiki 质量不完美——SubAgent 可能"只说不写"、Issue 文件名可能不规范、路径可能写错。如果每个失败只在运行时被发现而不积累，系统永远不会改进。

## 10.2 双层反馈系统

```
┌──────────────────────────────────────┐
│  docs/feedback/global-strategies.md  │ ← 跨项目通用改进策略
│  (GEN-001, GEN-002, ...)            │   由开发者手动升级至此
└────────────────┬─────────────────────┘
                 │ 自动读取
                 ▼
┌──────────────────────────────────────┐
│        每个 SubAgent Prompt          │
│        (反馈注入块在末尾)             │
└────────────────┬─────────────────────┘
                 ▲
┌────────────────┴─────────────────────┐
│  .agentic-wiki/feedback/prompts.md   │ ← 本项目专属改进策略
│  (Runner 自动追加失败记录)            │   由 Runner 自动管理
└──────────────────────────────────────┘
```

### 全局策略（`docs/feedback/global-strategies.md`）

跨项目通用的改进经验。由开发者手动维护，当项目 `prompts.md` 中的某条策略具有普遍性时，升级到此文件。

目前已有策略（持续积累中）：

| ID | 问题 | 严重度 | 改进 |
|:---|:---|:---:|:---|
| GEN-001 | SubAgent "只说不写"——声称写了文件但实际未调用 `write_file` | 🔴 CRITICAL | Prompt 末尾追加"你必须使用 write_file 工具实际写入文件" |
| GEN-002 | Issue 文件命名格式不统一 | 🟡 WARNING | 统一格式为 `IS-{NNNN}-{SEVERITY}-{slug}.md` |

### 项目策略（`.agentic-wiki/feedback/prompts.md`）

本项目专属的改进积累。Runner 自动创建种子、自动追加失败记录。

## 10.3 反馈注入时机

| 时机 | Runner 行为 |
|:---|:---|
| **INIT 阶段**（首次） | `ensureFeedbackSeed()` 自动创建种子 `prompts.md` |
| **GEN 阶段**（每次调度时） | `injectFeedbackIntoPrompts()` 读取两个策略文件，注入每个 Prompt 末尾 |
| **阶段失败时** | `recordFailure()` 自动追加失败原因到 `prompts.md` |

## 10.4 反馈注入模式

```typescript
function injectFeedbackIntoPrompts(
  promptsDir: string,
  agenticWikiRoot: string,
  projectRoot: string,
  mode: "append" | "replace" = "append",
): void {
  // 1. 读取全局策略 (docs/feedback/global-strategies.md)
  // 2. 读取项目策略 (.agentic-wiki/feedback/prompts.md)
  // 3. 对每个 prompt 文件:
  //    - 无注入标记 → append 注入块
  //    - 已有注入标记 + mode=replace → 替换注入块
  //    - 已有注入标记 + mode=append → 跳过
}
```

## 10.5 失败记录

```typescript
function recordFailure(paths, phase, errorDetail): void {
  const entry = [
    `### aw-${phase.toLowerCase()} 改进 (${timestamp})`,
    `**触发**: ${phase} 阶段执行失败`,
    `**问题**: ${errorDetail.slice(0, 500)}`,
    `**改进**: 检查脚本参数与输入文件完整性`,
  ];
  
  // 优先通过 state-manager.ts append-feedback 写入
  // 失败则直接 append 到 prompts.md
}
```

---

> **上一篇**: [第九章 增量模式](09-incremental-mode.md) | **下一篇**: [第十一章 优化特性详解](../11-optimizations/index.md)
