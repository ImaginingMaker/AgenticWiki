# 第五章 DEPENDENCY 阶段：依赖分析与策略规划

| 属性 | 值 |
|:---|:---|
| **阶段序号** | 2 |
| **自动化** | ✅ 完全自动 |
| **脚本数** | **7**（全流水线最多） |
| **关键产物** | 依赖图、优先级、策略、子图、元信息、聚簇 |

---

## 5.1 背景

这是整个流水线**最复杂、最核心的阶段**。要生成有意义的 Wiki，不能简单地按字母顺序遍历文件。必须理解：

- 代码之间如何依赖？哪个模块被最多人引用？
- 哪些文件夹重要？哪些只是工具集合？
- 大文件夹如何拆分成多个 SubAgent 任务？
- 跨文件夹的关联文件能否合并为一个任务？

## 5.2 解决的问题

| 问题 | 对应脚本 |
|:---|:---|
| 模块之间的依赖关系 + 循环依赖 | `build-deps.ts` |
| 每个文件的重要程度 | `file-priorities.ts` |
| 文件夹是否要拆分、如何拆分 | `analyze-folders.ts` |
| 每个文件夹的局部依赖图 | `extract-subgraph.ts` |
| 文件概要信息（替代阅读全文） | `extract-file-meta.ts` |
| 按依赖关系聚簇（替代文件夹方案） | `cluster-tasks.ts` |

## 5.3 数据流

```
file-list.json ──────────→ file-priorities.ts ──→ file-priorities.json
                              ↓
                    analyze-folders.ts ──→ folder-strategy.json
                              ↓
                    extract-subgraph.ts ──→ deps/<hash>-deps.json (每个文件夹)
                              ↓
                    extract-file-meta.ts ──→ file-meta.json
                              ↓
                    cluster-tasks.ts ──→ task-clusters.json (存在时启用聚簇模式)
```

依赖图 `dependency-graph.json` 从 `build-deps.ts` 产出，作为上述所有脚本的输入。

## 5.4 子章节

- [5.1 依赖图构建 — build-deps.ts](01-build-deps.md)
- [5.2 文件哈希 — compute-hashes.ts](02-compute-hashes.md)
- [5.3 优先级分配 — file-priorities.ts](03-file-priorities.md)
- [5.4 文件夹拆分策略 — analyze-folders.ts](04-analyze-folders.md)
- [5.5 子图提取 — extract-subgraph.ts](05-extract-subgraph.md)
- [5.6 文件元信息提取 — extract-file-meta.ts](06-extract-file-meta.md)
- [5.7 依赖聚簇划分 — cluster-tasks.ts](07-cluster-tasks.md)

## 5.5 阶段产物

```
cache/dependency-graph.json     # 全量依赖图（modules + cycles + hotspots）
cache/dependency-graph.mmd      # Mermaid 可视化
cache/file-priorities.json      # P0-P4 优先级分配
cache/folder-strategy.json      # 文件夹策略（回退模式用）
cache/deps/                     # 每个文件夹的子图
cache/file-meta.json            # 文件元信息
cache/task-clusters.json        # 依赖聚簇（存在时启用聚簇模式）
```

---

> **上一篇**: [第四章 SCAN 阶段](../04-scan-phase.md) | **下一篇**: [5.1 依赖图构建](01-build-deps.md)
