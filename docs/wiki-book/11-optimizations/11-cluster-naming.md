# 11.11 聚簇命名多数投票

> 按文件的目录多数分布决定聚簇名称，排除通用目录，避免误命名。

---

## 背景

依赖聚簇后，聚簇需要命名。如果聚簇中包含 `src/button/useClick.ts`、`src/button/useDrag.ts` 和大量 `src/components/` 下的文件，用 seed 名 `useClick` 命名会完全跑偏——聚簇的核心其实是 `Button` 组件。

## 方案

```typescript
function computeClusterName(files: string[], meta: FileMetaMap): string {
  // 1. 统计文件的目录分布
  const dirCount = new Map<string, number>();
  for (const file of files) {
    const segments = path.dirname(file).split("/");
    for (const seg of segments) {
      if (!EXCLUDED_NAMING_DIRS.has(seg)) {
        dirCount.set(seg, (dirCount.get(seg) || 0) + 1);
      }
    }
  }

  // 2. 多数投票
  const [bestDir, majorityCount] = [...dirCount.entries()]
    .sort((a, b) => b[1] - a[1])[0] || ["unknown", 0];

  // 3. 如有组件名 → 优先用组件名
  // 4. 否则用目录名
}
```

### 排除的通用目录

```typescript
const EXCLUDED_NAMING_DIRS = new Set([
  "src", "common", "hooks", "utils", "types", "lib",
  "components", "ui", "shared", "helpers", "constants",
  "enums", "interfaces", "styles", "assets",
  // 单字母目录名（e.g. 'a', 'b' 是 monorepo 内部路径段，无意义）
  ...singleLetterDirs,
]);
```

### 示例

| 聚簇文件 | 目录投票 | 命名结果 |
|:---|:---|:---|
| `src/button/*.ts` + `src/components/Button.tsx` | button: 3, components: 1 | ✅ "button"（正确） |
| `src/hooks/useClick.ts` + `src/utils/clickHandler.ts` | hooks 和 utils 被排除 → 降级到 dirname | ✅ 按组件名命名 |
| `src/button/*.ts` + `src/common/helpers.ts` | button: 3 > common(排除) | ✅ "button" |

## 为什么重要

聚簇命名直接影响 SubAgent Prompt 的可读性和 Wiki 章节标题。误命名（如 `useClick` 作为聚簇名）会让读者困惑。

---

> **上一篇**: [11.10 状态-磁盘一致性检查](10-consistency-check.md) | **下一篇**: [11.12 非关键阶段标记](12-non-critical-phase.md)
