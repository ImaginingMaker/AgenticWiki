# 11.1 Prompt 模板外置

> SubAgent Prompt 中重复的 Issue 规则/输出格式/路径规则提取为独立模板文件。

---

## 背景

每个 SubAgent Prompt 中包含大量相同的描述性内容——Issue 6 类检测标准、Wiki 页面输出格式、路径安全规则。对 N 个 SubAgent 而言，这些内容被重复了 N 次，浪费大量 Token。

## 方案

三个部分提取为独立模板文件，SubAgent 通过 `read_file` 引用：

```
.agentic-wiki/templates/
  issue-rules.md     # 6 类 Issue 检测标准 + 严重等级 + 检测方法
  output-format.md   # Wiki 页面格式规范 + Frontmatter 要求
  path-safety.md     # 路径书写规则（禁止绝对路径、src/ 前缀）
```

模板由 `gen-scheduler.ts` 在 GEN 阶段首次调度时自动生成。

## 收益

| 指标 | 优化前 | 优化后 | 改善 |
|:---|:---:|:---:|:---:|
| Prompt 主体大小 | ~55K | ~15K | **-74%** |
| 每批次 Token 节省 | — | ~40K × SubAgent 数 | 显著 |

---

> **上一篇**: [优化特性总览](index.md) | **下一篇**: [11.2 动态 Token 预算](02-dynamic-token-budget.md)
