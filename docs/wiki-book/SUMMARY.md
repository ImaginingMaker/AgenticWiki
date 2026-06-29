# AgenticWiki 书册目录

> 本文档将 `docs/WIKI.md` 拆分为结构化书册。
> 每个章节独立成篇，复杂章节拆分为子章节，便于阅读和维护。

---

## 📖 卷首

- [前言](preface.md)

## 📖 第一卷：基础概念

- [第一章 项目概览](01-overview.md)
- [第二章 目录规范](02-directory-structure.md)

## 📖 第二卷：流水线阶段

- [第三章 INIT 阶段：项目扫描与状态初始化](03-init-phase.md)
- [第四章 SCAN 阶段：文件扫描与样式过滤](04-scan-phase.md)
- [第五章 DEPENDENCY 阶段：依赖分析与策略规划](05-dependency-phase/index.md)
  - [5.1 依赖图构建 — build-deps.ts](05-dependency-phase/01-build-deps.md)
  - [5.2 文件哈希 — compute-hashes.ts](05-dependency-phase/02-file-priorities.md)
  - [5.3 优先级分配 — file-priorities.ts](05-dependency-phase/03-file-priorities.md)
  - [5.4 文件夹拆分策略 — analyze-folders.ts](05-dependency-phase/04-analyze-folders.md)
  - [5.5 子图提取 — extract-subgraph.ts](05-dependency-phase/05-extract-subgraph.md)
  - [5.6 文件元信息提取 — extract-file-meta.ts](05-dependency-phase/06-extract-file-meta.md)
  - [5.7 依赖聚簇划分 — cluster-tasks.ts](05-dependency-phase/07-cluster-tasks.md)
- [第六章 GEN 阶段：SubAgent 调度与 Prompt 生成](06-gen-phase/index.md)
  - [6.1 调度方案](06-gen-phase/01-scheduling.md)
  - [6.2 Prompt 结构与模板系统](06-gen-phase/02-prompt-structure.md)
  - [6.3 Agent 工作流](06-gen-phase/03-agent-workflow.md)
  - [6.4 从优先级到 Wiki 产出：SubAgent 闭环任务全流程](06-gen-phase/04-priority-to-wiki-flow.md)
- [第七章 ASSEMBLE 阶段：Wiki 组装](07-assemble-phase.md)
- [第八章 VALIDATE 阶段：交叉引用校验](08-validate-phase.md)

## 📖 第三卷：进阶机制

- [第九章 增量模式](09-incremental-mode.md)
- [第十章 反馈闭环与持续改进](10-feedback-loop.md)

## 📖 第四卷：优化与工程实践

- [第十一章 优化特性详解](11-optimizations/index.md)
  - [11.1 Prompt 模板外置](11-optimizations/01-prompt-templates.md)
  - [11.2 动态 Token 预算](11-optimizations/02-dynamic-token-budget.md)
  - [11.3 Token 阈值批次](11-optimizations/03-token-threshold-batch.md)
  - [11.4 动态拆分阈值](11-optimizations/04-dynamic-split-thresholds.md)
  - [11.5 入口文件内联](11-optimizations/05-entry-inlining.md)
  - [11.6 文件元信息提取](11-optimizations/06-file-meta-extraction.md)
  - [11.7 依赖聚簇划分](11-optimizations/07-dependency-clustering.md)
  - [11.8 SubAgent 产物自检](11-optimizations/08-self-check.md)
  - [11.9 SubAgent 完成标记](11-optimizations/09-completion-marker.md)
  - [11.10 状态-磁盘一致性检查](11-optimizations/10-consistency-check.md)
  - [11.11 聚簇命名多数投票](11-optimizations/11-cluster-naming.md)
  - [11.12 非关键阶段标记](11-optimizations/12-non-critical-phase.md)
- [第十二章 开发纪律](12-development-discipline.md)

## 📖 附录

- [附录 A：流水线全链路数据流分析](appendix.md)
