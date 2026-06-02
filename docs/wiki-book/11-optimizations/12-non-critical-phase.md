# 11.12 非关键阶段标记

> 验证阶段脚本可标记为非关键，失败不阻塞流水线。

---

## 背景

VALIDATE 阶段的脚本验证失败，不一定意味着 Wiki 不可用。例如 `validate-references.ts` 检查 `sourceFiles` 字段——某个文件被删除或重命名后，Wiki 页面引用了不存在的源文件。这是"不佳"但不至于"不可用"。

旧行为：任何验证失败 → 流水线阻断 → Agent 需要手动解决才能继续。

## 方案

在 `phase-definitions.ts` 中，通过 `critical: false` 标记非关键脚本：

```typescript
// phase-definitions.ts → VALIDATE phase
script(
  "validate/validate-references.ts",
  ["--wiki", wikiRoot, ...],
  false,  // ← critical: false
),
```

非关键脚本失败时：

```
⏸️ 非关键脚本失败，继续执行...
⚠️ validate-references.ts 执行失败（非关键），记录警告
  [失败详情]
→ 流水线继续，不阻断
```

## 当前非关键脚本

| 脚本 | 标记原因 |
|:---|:---|
| `validate-references.ts` | sourceFiles 缺失不致命 |
| `validate-code-refs.ts` | 符号不在源码中可能是重构遗留，不影响 Wiki 阅读 |
| `validate-issue-content.ts` | 定量断言验证为辅助性质 |
| `issue-dashboard.ts` | 仪表盘生成失败不影响正文 |
| `fix-issue-paths.ts` | Issue 路径修复为辅助 |

---

> **上一篇**: [11.11 聚簇命名多数投票](11-cluster-naming.md) | **下一篇**: [第十二章 开发纪律](../12-development-discipline.md)
