# 5.5 子图提取 — `extract-subgraph.ts`

> 从全量依赖图中为每个文件夹提取局部依赖子图。

---

## 策略

全量依赖图可能包含上千个模块，SubAgent 不需要看到全貌——只需要知道自己负责的文件夹的局部依赖关系。

子图提取即从全图中"切"出目标文件夹的局部视图：

```
全量依赖图 (1000+ modules)
  ↓
extract-subgraph.ts
  ↓
每个文件夹的局部子图 (~10-50 modules)
  ├── internalModules:    文件夹内的模块
  ├── externalDeps:       文件夹依赖的外部模块
  └── externalDependents: 哪些外部模块依赖此文件夹
```

## 实现细节

### 路径匹配

支持两种模式：

| 模式 | 方式 | 示例 |
|:---|:---|:---|
| **精确前缀匹配** | `folderPath + "/"` 前缀 | `src/components/` 匹配 `src/components/Button.tsx` |
| **模糊末段匹配** | 当精确匹配为 0 时，按最后一段目录名匹配 | `button` 匹配 `packages/ui/button/...` |

### 批量模式

通过 `--all --strategy folder-strategy.json` 一次性提取所有文件夹子图：

```typescript
for (const folder of strategy.folders) {
  const hash = folderToHash(folder.path);
  const outputPath = path.join(outputDir, `${hash}-deps.json`);
  
  // 已存在且非空 → 跳过（增量缓存）
  if (exists && nonEmpty) { skipped++; continue; }
  
  const subgraph = extractSubgraph(fullGraph, folder.path);
  await fs.outputJson(outputPath, subgraph);
}
```

**增量缓存**：已提取的非空子图自动跳过，避免重复计算。文件扩展名转为 `.json`。

### 文件夹名哈希

```typescript
function folderToHash(folder: string): string {
  return folder.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").toLowerCase();
  // "src/components" → "src_components"
}
```

## 产物

`cache/deps/src_components-deps.json`:

```json
{
  "folder": "src/components",
  "internalModules": [
    { "source": "src/components/Button.tsx", "dependencies": [...], "dependents": [...], "hasCircular": false }
  ],
  "externalDeps": ["src/utils/classnames.ts", "src/types/common.ts"],
  "externalDependents": ["src/pages/Home.tsx", "src/App.tsx"]
}
```

---

> **上一篇**: [5.4 文件夹拆分策略](04-analyze-folders.md) | **下一篇**: [5.6 文件元信息提取](06-extract-file-meta.md)
