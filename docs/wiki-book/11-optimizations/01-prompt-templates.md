# 11.1 Prompt 模板外置（v3 已移除）

> ⚠️ **v3 重构后，此优化已被移除。** Issue 检测规则、输出格式、路径规则现在直接内联在 Prompt 中。

---

## 背景（v2 时期）

每个 SubAgent Prompt 中包含大量相同的描述性内容——Issue 6 类检测标准、Wiki 页面输出格式、路径安全规则。对 N 个 SubAgent 而言，这些内容被重复了 N 次，浪费大量 Token。

## 方案（v2 时期，已弃用）

三个部分提取为独立模板文件，SubAgent 通过 `read_file` 引用：

```
.agentic-wiki/templates/          ← v3 已移除
  issue-rules.md     # 8 类 Issue 检测标准（3 层优先级）+ 严重等级 + 检测方法
  output-format.md   # Wiki 页面格式规范 + Frontmatter 要求
  path-safety.md     # 路径书写规则（禁止绝对路径、src/ 前缀）
```

## v3 变更

模板生成函数（`getIssueRulesTemplate`、`getOutputFormatTemplate`、`getPathSafetyTemplate`、`ensureTemplates`）已被删除。规则文本直接内联在 `buildSubTaskPrompt()` 和 `buildClusterPrompt()` 中，简化了代码结构，消除了 ~200 行死代码。

## 收益（v2 时期，已过时）

| 指标 | 优化前 | 优化后 | 改善 |
|:---|:---:|:---:|:---:|
| Prompt 主体大小 | ~55K | ~15K | **-74%** |
| 每批次 Token 节省 | — | ~40K × SubAgent 数 | 显著 |

---

> **上一篇**: [优化特性总览](index.md) | **下一篇**: [11.2 动态 Token 预算](02-dynamic-token-budget.md)
