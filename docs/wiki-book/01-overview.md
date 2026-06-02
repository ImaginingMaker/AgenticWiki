# 第一章 项目概览

> 本章帮助你快速理解 AgenticWiki 是什么、解决了什么问题、以及整体架构如何分层。

---

## 1.1 背景

人工编写代码文档耗时巨大，且随项目迭代迅速过时。传统的 RAG 方案在每次查询时重新"发现"知识——LLM 需要从零散文档中拼凑答案，无法积累理解。

AgenticWiki 基于 [LLM Wiki (karpathry)](../reference/LLM-Wiki_karpathry.md) 思想：让 LLM Agent 扮演"文档工程师"，自动将前端代码解析为**结构化的、持久化的、可积累的 Wiki 百科**。

### 与 RAG 的对比

| 维度 | RAG 查询 | AgenticWiki |
|:---|:---|:---|
| **知识形式** | 检索片段 | 结构化 Markdown 页面 |
| **积累性** | 每次重新发现 | 增量更新，知识持续积累 |
| **跨文件关系** | LLM 即时推理 | Wiki 中预先建立链接 |
| **复杂度** | 简单设置 | 需要流水线编排 |

## 1.2 核心思想

```
源代码 → [AgenticWiki 流水线] → 结构化 Wiki
   ↑                               ↓
   └──────── 增量更新 ←───────────┘
```

**两卷文档体系**：

| 卷 | 内容 | 用途 |
|:---|:---|:---|
| `volume-1-code` | 代码档案 | 每个文件夹的分析文档，包含组件、Hook、工具函数等 |
| `volume-2-issues` | Issue 面板 | 按优先级分层的 8 类代码问题（P0 运行时缺陷 + 安全漏洞、P1 类型安全债 + 性能债、P2 死代码 + 复杂度债 + 可维护性债 + 体验债） |

**三个最终产物**：

| 产物 | 说明 |
|:---|:---|
| `wiki/book.md` | 完整书册，含目录、章节、页面索引 |
| `wiki/glossary.md` | 术语表，从所有章节提取的符号→定义映射 |
| `wiki/issues.md` | Issue 汇总仪表盘，按类型/严重程度/状态聚合 |

## 1.3 架构设计

```
Agent（读 README.md）→ runner.ts（自动编排 6 阶段）→ 28 个脚本
                                        ↘ GEN 暂停 → Agent spawn SubAgent
```

### 四层职责

| 层 | 角色 | 自动化程度 |
|:---|:---|:---:|
| **Agent** | 人类或 LLM 操作员——启动 Runner + spawn SubAgent | 手动 |
| **Runner** (`runner.ts`) | 统一入口——CLI 解析、路径校验、阶段调度、状态管理 | 自动 |
| **脚本** (`src/lib/`) | 28 个独立脚本——扫描、依赖分析、调度、组装、验证 | 自动 |
| **SubAgent** | 每个负责一个文件夹/聚簇的 Wiki 页面生成 | 手动 spawn |

### 6 阶段 DAG

```
INIT → SCAN → DEPENDENCY → GEN → ASSEMBLE → VALIDATE
                               ↕
                          SubAgent (Agent 手动)
```

其中 **INIT / SCAN / DEPENDENCY / ASSEMBLE / VALIDATE** 全部自动完成。
**GEN** 生成 Prompt 后暂停，等待 Agent spawn SubAgent。

### 模式三态

| 模式 | 命令 | 适用场景 |
|:---|:---|:---|
| 全量分析 | `--project <path>` | 首次初始化 |
| 断点续跑 | `--resume` | GEN 阶段分批完成后继续 |
| 增量更新 | `--mode incremental --since HEAD~1` | 已有全量 Wiki，仅更新变更部分 |

## 1.4 路径铁律

整个系统最核心的安全准则：

```
正确: --project /Users/alex/projects/my-app
错误: --project .              ← 指向 AgenticWiki 自身，破坏自身
```

Runner 启动时自动校验 5 条路径规则，违反则阻断流水线。

---

> **上一篇**: [前言](preface.md) | **下一篇**: [第二章 目录规范](02-directory-structure.md)
