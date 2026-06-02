# 第四章 SCAN 阶段：文件扫描与样式过滤

| 属性 | 值 |
|:---|:---|
| **阶段序号** | 1 |
| **自动化** | ✅ 完全自动 |
| **脚本数** | 2 |
| **关键产物** | `file-list.json`, `filtered-files.json` |

---

## 4.1 背景

目标项目的 `src/` 目录可能有成百上千个文件。但并非所有文件都需要被 Wiki 分析——纯样式文件（CSS/SCSS/LESS）和样式组件定义（`.styled.` 文件）不包含业务逻辑，生成 Wiki 页面时会浪费大量 Token。

## 4.2 解决的问题

1. 哪些文件是逻辑文件（应被分析）？哪些是样式文件（应被跳过）？
2. 不同扩展名的文件各有多少？（用于 Token 估算）

## 4.3 策略设计

### 扩展名白名单

只扫描以下扩展名的文件：

```
.ts / .tsx / .js / .jsx / .vue / .svelte
```

### 二分过滤

将源文件列表分为两组：

```
全量文件 → [filter-styles.ts] → 逻辑文件（后续分析）
                              → 样式文件（跳过）
```

样式文件判定规则：

| 规则 | 匹配 | 示例 |
|:---|:---|:---|
| **扩展名匹配** | `.css` / `.scss` / `.less` / `.sass` / `.styl` | `Button.css` |
| **命名模式匹配** | `.styled.` / `.styles.` 在文件名中 | `Button.styled.ts` |

### 测试伪阳性排除

`.styled.spec.ts` 虽然是 `.styled.` 模式，但它是测试文件，不是样式定义——需排除误过滤。

## 4.4 脚本实现

### 4.4.1 `scan-files.ts` — 文件递归扫描

**流程**：

```
SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "vue", "svelte"]

globby 多模式匹配:
  ["**/*.ts", "**/*.tsx", "**/*.js", ...]
  ignore: ["node_modules", "dist", "build", ".git", ...]

→ 按扩展名统计（byExtension）
→ 排序后写入 file-list.json
```

### 4.4.2 `filter-styles.ts` — 样式文件过滤

**流程**：

```
对 file-list.json 的每个文件:
  1. isStyleExtension(filePath) —— 检查扩展名
  2. isStyledComponentsFile(filePath) —— 检查文件名模式
     → 排除 false positives（.spec. / .test.）
  3. 命中任一规则 → 加入 filteredFiles, 从逻辑列表移除

输出: filtered-files.json { files: [...], filteredFiles: [...], ... }
```

## 4.5 产物说明

```
cache/file-list.json
  ├── totalFiles:      全部源文件数量
  ├── files:           按字母排序的文件路径列表
  └── byExtension:     { ".ts": 42, ".tsx": 18, ".css": 5, ... }

cache/filtered-files.json
  ├── totalFiles:      同 file-list.json
  ├── files:           过滤后的逻辑文件列表（仅 .ts/.tsx/.js/.jsx 等）
  ├── filteredFiles:   过滤掉的样式文件（带原因）
  ├── filteredCount:   过滤数量
  └── remainingCount:  剩余逻辑文件数量
```

---

> **上一篇**: [第三章 INIT 阶段](03-init-phase.md) | **下一篇**: [第五章 DEPENDENCY 阶段](05-dependency-phase/index.md)
