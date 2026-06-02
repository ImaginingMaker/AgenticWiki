# 5.7 依赖聚簇划分 — `cluster-tasks.ts`（v2.1 核心）

> 替代"文件夹+角色"划分方案，按依赖关系 BFS 聚簇，SubAgent 减少 50-60%。

---

## 背景问题

传统的 `analyze-folders.ts` 方案按文件夹+角色划分 subTask，存在三个问题：

| 问题 | 示例 | 后果 |
|:---|:---|:---|
| **SubAgent 数量多** | 每文件夹每角色一个 SubAgent | 12 个文件夹 → 可能 30+ 个任务 |
| **跨文件夹依赖割裂** | `useClick.ts` 被 `Button.tsx` 和 `Dropdown.tsx` 共用，但分属不同任务 | SubAgent 缺失上下文 |
| **文件夹边界不合理** | `utils/` 的工具函数被 `components/` 大量引用 | SubAgent 无法理解使用场景 |

## 聚簇方案

### 核心流程

```
1. 选种子：每个文件夹的第一份文件作为聚簇种子（seeds）
2. BFS 遍历：从种子出发，沿 dependencies 方向遍历（maxDepth=3）
   → 收集所有关联文件
3. 冲突处理：某文件被多个 seed 同时命中 → 按共享引用率决定归属
4. 聚簇归约：重叠度过高的聚簇合并（normalizeClusters）
5. 大簇拆分：超过阈值的大聚簇自动拆分
6. 未分配文件：残余文件按目录分组生成独立聚簇
```

### BFS 遍历

```typescript
const queue: Array<{ file: string; depth: number }> = [{ file: seed, depth: 0 }];
const visited = new Set<string>();

while (queue.length > 0) {
  const { file, depth } = queue.shift()!;
  if (visited.has(file)) continue;
  visited.add(file);
  clusterFiles.add(file);

  if (depth < MAX_BFS_DEPTH) {
    const mod = moduleMap.get(file);
    if (mod) {
      for (const dep of mod.dependencies) {
        if (dep.type === "local") queue.push({ file: dep.resolved, depth: depth + 1 });
      }
    }
  }
}
```

### 冲突处理

当多个种子竞争同一文件时：

```typescript
// 按 sharedImportRatio 决定归属
// 共享引用比例越高 → 倾向合并
// overlapRatio > MERGE_OVERLAP_RATIO(0.5) → 强制合并两个聚簇
```

### 聚簇命名（多数投票）

这是聚簇方案中**最微妙**的设计。不能用 seed 组件名作为聚簇名（会被 `useClick.ts` 误导为"click"），而是按文件的**目录多数分布**投票：

```typescript
function computeClusterName(files: string[], meta: FileMetaMap): string {
  // 1. 统计文件目录分布（排除 src/、common、hooks 等通用目录）
  // 2. 投票：出现最多的目录段获胜
  // 3. 如有组件名 → 优先用组件名命名
  // 4. 否则用目录名
  
  // 排除的通用目录：
  const EXCLUDED_NAMING_DIRS = new Set(["src", "common", "hooks", "utils", "types", "lib", "components", ...]);
}
```

### 大簇拆分

超过阈值（`maxCluster = projectTotalTokens × 20%`）的聚簇自动拆分为多个：

```typescript
function splitLargeCluster(cluster: TaskCluster, threshold: number): TaskCluster[] {
  // 按文件数量对半拆分
  // 保持根文件（初始种子文件）在第一个子聚簇
  // 其余文件均衡分配到各子聚簇
}
```

## 收益

| 指标 | 文件夹模式 | 聚簇模式 | 改善 |
|:---|:---:|:---:|:---:|
| SubAgent 数量 | ~28 个/项目 | ~12 个/项目 | **-57%** |
| 跨文件上下文 | 缺失 | 完整（BFS 聚簇） | ✅ |
| 命名准确性 | 按角色（可能泛化） | 按多数投票（精准） | ✅ |

## 模式切换（自动）

GEN 阶段自动检测：`task-clusters.json` 存在 → 聚簇模式；否则回退到文件夹模式。

---

> **上一篇**: [5.6 文件元信息提取](06-extract-file-meta.md) | **下一篇**: [第六章 GEN 阶段](../06-gen-phase/index.md)
