# 5.4 文件夹拆分策略 — `analyze-folders.ts`

> 动态阈值 + 角色分组 + 跨文件夹合并，将 file-priorities.json 转换为 subTasks[]。

---

## 策略

### 5.4.1 动态阈值计算

基于项目总 Token 百分比计算三个阈值（caps 来自 `shared/constants.ts`）：

```
split     = max(20000, min(300000, 项目总 Token × 5%))
noSplit   = max(10000, min(150000, 项目总 Token × 2.5%))
mergeMin  = max(3000,  min(15000,  项目总 Token × 0.3%))
```

**示例**：

| 项目规模 | split | noSplit | mergeMin |
|:---|---:|---:|---:|
| 100K Token | 20K | 10K | 3K |
| 500K Token | 25K | 12.5K | 3K |
| 1M Token | 50K | 25K | 3K |
| 3M Token | 150K | 75K | 9K |
| 6M Token | 300K (cap) | 150K (cap) | 15K (cap) |

### 5.4.2 角色分类

将文件按用途分为 7 类，每个类别成为独立的 subTask：

| 角色 | 识别规则 | 示例 |
|:---|:---|:---|
| entry | index.ts / main.ts / app.ts | `src/components/index.ts` |
| ui_components | `.tsx` 含 JSX 逻辑 | `Button.tsx` |
| hooks | `use*` 前缀或 `hooks/` 目录 | `useAuth.ts` |
| utils | 工具函数（默认分类） | `formatDate.ts` |
| types | `types/` 目录或 `.d.ts` | `user.ts` |
| styles | `.css` / `.scss` 等 | `styles.module.css` |
| reducers | `reducers/` 目录或 `*Reducer` | `userReducer.ts` |

### 5.4.3 拆分决策

```
每个文件夹:
  计算 totalTokens = sum(所有文件 estimatedTokens)
  
  if totalTokens > split:
    → 标记 shouldSplit
    → 按角色分组文件
    → 对每个角色:
        if roleTokens > split:
          → chunkFiles(roleFiles, noSplit)  // 按 noSplit 阈值切块
        else if roleTokens < mergeMin:
          → 放入跨文件夹合并候选池
        else:
          → 生成角色 subTask
  else:
    → 不拆分，生成一个 subTask
```

### 5.4.4 跨文件夹合并

```
合并池:
  for 每个角色 in 合并池:
    if 累积 tokens >= mergeMin AND 来源文件夹 >= 2:
      → 生成 crossFolderMerge subTask（跨文件夹汇总）
```

## 产物

```json
// folder-strategy.json
{
  "folders": [{
    "path": "src/components",
    "fileCount": 50,
    "totalTokens": 150000,
    "shouldSplit": true,
    "reason": "总 token 150000，超过动态阈值 50000，拆分为 4 个子任务",
    "subTasks": [
      {
        "id": "src-components__ui_components_1",
        "label": "UI Components (1)",
        "role": "ui_components",
        "files": ["src/components/Button.tsx", "src/components/Input.tsx"],
        "estimatedTokens": 12000,
        "wikiChapter": "ch-src-components/ui_components/part-1.md"
      }
    ]
  }],
  "crossFolderMerges": [{
    "id": "cross-hooks",
    "label": "全局 Hooks 汇总",
    "folders": ["src/a", "src/b"],
    "files": ["src/a/hooks/useAuth.ts", "src/b/hooks/useData.ts"],
    "estimatedTokens": 5000,
    "wikiChapter": "appendix/cross-hooks.md"
  }]
}
```

---

> **上一篇**: [5.3 优先级分配](03-file-priorities.md) | **下一篇**: [5.5 子图提取](05-extract-subgraph.md)
