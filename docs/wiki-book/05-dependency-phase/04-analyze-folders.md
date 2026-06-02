# 5.4 文件夹拆分策略 — `analyze-folders.ts`

> 决定每个文件夹是否需要拆分为多个 SubAgent 任务，以及如何拆分。

---

## 策略

本脚本是整个流水线中**策略最密集**的脚本之一，涉及三个核心机制。

### 5.4.1 动态阈值计算

替代 50K/30K/5K 的硬编码阈值，按项目规模动态计算：

```
split     = max(20000, min(150000, 项目总 Token × 5%))
noSplit   = max(10000, min(80000,  项目总 Token × 2.5%))
mergeMin  = max(3000,  min(15000,  项目总 Token × 0.3%))
```

**示例**：

| 项目规模 | split | noSplit | mergeMin |
|:---|---:|---:|---:|
| 100K Token | 20K | 10K | 3K |
| 500K Token | 25K | 12.5K | 3K |
| 1M Token | 50K | 25K | 3K |
| 3M Token | 150K | 75K | 9K |

### 5.4.2 角色分类

将文件按用途分为 7 类，每个类别成为独立的 subTask：

| 角色 | 识别规则 | 示例 |
|:---|:---|:---|
| **entry** | 文件名 `index.ts` / `main.ts` / `app.ts` | `src/index.ts` |
| **ui-components** | 目录含 `components`/`ui`/`common` + PascalCase 文件名 | `Button.tsx` |
| **business-components** | 目录含 `pages`/`features`/`modules` | `LoginPage.tsx` |
| **hooks** | 文件名 `useXxx` 或目录含 `hooks` | `useAuth.ts` |
| **utils** | 目录含 `utils`/`helpers`/`lib` | `format.ts` |
| **types** | 目录含 `types` 或 `.d.ts` 文件 | `index.d.ts` |
| **other** | 以上均不匹配 | — |

### 5.4.3 入口文件内联（v2.1）

纯 re-export 的 `index.ts`（barrel 文件）自动合并到相邻 subTask，不单独生成。

```typescript
function isPureReexportFile(filePath: string): boolean {
  // 读取前 4KB → 检查所有有效行
  // 行级检查: export * from ... / export { ... } from ... 
  // 允许 "use client" / "use server" 指令
  // 有任何非 re-export 语句 → 返回 false
}
```

**价值**：barrel 文件的 Wiki 分析价值极低，但会浪费一个 SubAgent 槽位。内联后减少无效 subTask。

### 5.4.4 跨文件夹合并

同角色的小文件组（如跨文件夹的`hooks`）在累计 Token 达到 `mergeMin` 阈值时，合并为一个跨文件夹任务。

---

## 数据流

```
file-priorities.json
  → 按文件夹分组
  → 动态阈值计算
  → 角色分类 + 入口文件内联 + 跨文件夹合并
  → folder-strategy.json（含 subTasks[] 和 crossFolderMerges[]）
```

## 产物

```json
// folder-strategy.json
{
  "folders": [
    {
      "path": "src/components",
      "fileCount": 15,
      "totalTokens": 45800,
      "shouldSplit": true,
      "subTasks": [
        { "id": "src_components_ui_components", "label": "UI 组件", "files": [...], "estimatedTokens": 32000, "wikiChapter": "ch-src_components/ui-components.md" },
        { "id": "src_components_hooks", "label": "Hooks", "files": [...], "estimatedTokens": 8600, "wikiChapter": "ch-src_components/hooks.md" }
      ]
    }
  ],
  "crossFolderMerges": [
    { "id": "cross-hooks", "label": "全局 Hooks 汇总", "folders": ["src/a", "src/b"], "files": [...], "estimatedTokens": 6200 }
  ]
}
```

---

> **上一篇**: [5.3 优先级分配](03-file-priorities.md) | **下一篇**: [5.5 子图提取](05-extract-subgraph.md)
