# 第十一章 优化特性详解

> 收集了 AgenticWiki v2.1 引入的所有优化措施，按领域分组。

---

## 分类索引

### Token 与预算优化

| # | 优化 | 核心收益 | 章节 |
|:---|:---|:---:|:---:|
| 11.1 | Prompt 模板外置 | Token 减少 ~74% | [详情](01-prompt-templates.md) |
| 11.2 | 动态 Token 预算 | 小文件夹预算减少 ~87% | [详情](02-dynamic-token-budget.md) |
| 11.3 | Token 阈值批次 | 批次 Token 更均衡 | [详情](03-token-threshold-batch.md) |
| 11.4 | 动态拆分阈值 | 适配不同规模项目 | [详情](04-dynamic-split-thresholds.md) |
| 11.6 | 文件元信息提取 | SubAgent Token 减少 ~60% | [详情](06-file-meta-extraction.md) |

### 任务拆分优化

| # | 优化 | 核心收益 | 章节 |
|:---|:---|:---:|:---:|
| 11.5 | 入口文件内联 | 减少无效 subTask | [详情](05-entry-inlining.md) |
| 11.7 | 依赖聚簇划分 | SubAgent 减少 50-60% | [详情](07-dependency-clustering.md) |
| 11.11 | 聚簇命名多数投票 | 避免误命名 | [详情](11-cluster-naming.md) |

### SubAgent 可靠性

| # | 优化 | 核心收益 | 章节 |
|:---|:---|:---:|:---:|
| 11.8 | SubAgent 产物自检 | 减少静默失败 | [详情](08-self-check.md) |
| 11.9 | SubAgent 完成标记 | 准确区分完成状态 | [详情](09-completion-marker.md) |
| 11.10 | 状态-磁盘一致性检查 | 阻断死胡同状态 | [详情](10-consistency-check.md) |

### 流水线健壮性

| # | 优化 | 核心收益 | 章节 |
|:---|:---|:---:|:---:|
| 11.12 | 非关键阶段标记 | 避免误卡流水线 | [详情](12-non-critical-phase.md) |

---

> **上一篇**: [第十章 反馈闭环](../10-feedback-loop.md) | **下一篇**: [11.1 Prompt 模板外置](01-prompt-templates.md)
