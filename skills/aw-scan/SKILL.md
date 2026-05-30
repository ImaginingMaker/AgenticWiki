# aw-scan — 文件扫描与拆分决策

> 扫描源码文件，智能过滤样式文件，决定文件夹拆分策略

## 触发条件

- `aw-init` 完成后
- 用户说"扫描项目"、"分析文件结构"
- `aw-orchestrator` 检测到 `currentPhase = SCAN`

---

## 你的任务

1. 扫描所有源码文件（自动排除 gitignore）
2. 智能过滤纯样式文件
3. 统计每个文件夹的文件数量
4. 决定文件夹拆分策略（文件数 > 50 则拆分）
5. 输出拆分决策到 `folder-strategy.json`

---

## 执行步骤

### Step 1: 扫描源码文件

使用 `terminal` 工具运行：

```bash
npx tsx src/lib/scan-files.ts --path <源码路径> --output .agentic-wiki/cache/file-list.json
```

**参数说明**：
- `--path`: 源码路径（从 `project-scan.json.sourcePath` 获取）
- `--output`: 输出文件路径

**脚本功能**：
- 使用 `globby` 扫描所有源码文件
- 自动排除 `node_modules`、`dist`、`build`
- 支持 `.gitignore` 规则
- 按扩展名过滤：`.ts`, `.tsx`, `.js`, `.jsx`, `.vue`

**输出示例**：
```json
{
  "scannedAt": "2026-05-29T10:01:00Z",
  "sourcePath": "src/",
  "totalFiles": 128,
  "files": [
    "src/App.tsx",
    "src/main.tsx",
    "src/components/Button.tsx",
    "src/components/Input.tsx",
    "src/pages/Home.tsx",
    "src/utils/helper.ts",
    ...
  ],
  "byExtension": {
    ".tsx": 80,
    ".ts": 40,
    ".jsx": 5,
    ".js": 3
  }
}
```

---

### Step 2: 分析文件夹规模

使用 `terminal` 工具运行：

```bash
npx tsx src/lib/analyze-folders.ts --input .agentic-wiki/cache/file-priorities.json --output .agentic-wiki/cache/folder-strategy.json
```

**脚本功能**：
- 统计每个文件夹的文件数量
- 识别文件夹的业务域（通过命名模式）
- 决定是否需要拆分
- 生成拆分策略

**拆分决策规则**：

| 条件 | 决策 | 说明 |
|------|------|------|
| 文件数 > 50 | 拆分 | 文件过多，需要细分 |
| 包含多个业务域 | 拆分 | 如 `components/` 包含 `common/` 和 `business/` |
| 文件数 ≤ 50 且单一域 | 不拆分 | 规模适中 |

**输出示例**：
```json
{
  "generatedAt": "2026-05-29T10:02:00Z",
  "folders": [
    {
      "path": "src/components/",
      "fileCount": 120,
      "logicFileCount": 95,
      "styleFileCount": 25,
      "shouldSplit": true,
      "subFolders": [
        { "path": "src/components/common/", "fileCount": 30 },
        { "path": "src/components/business/", "fileCount": 65 }
      ],
      "reason": "文件数超过50，且包含多个业务域",
      "priority": "high"
    },
    {
      "path": "src/pages/",
      "fileCount": 45,
      "logicFileCount": 45,
      "styleFileCount": 0,
      "shouldSplit": false,
      "reason": "规模适中，无需拆分",
      "priority": "high"
    },
    {
      "path": "src/utils/",
      "fileCount": 15,
      "logicFileCount": 15,
      "styleFileCount": 0,
      "shouldSplit": false,
      "reason": "规模适中，无需拆分",
      "priority": "medium"
    }
  ],
  "totalFolders": 12,
  "foldersToAnalyze": 12
}
```

---

### Step 3: 过滤样式文件

使用 `terminal` 工具运行：

```bash
npx tsx src/lib/filter-styles.ts --input .agentic-wiki/cache/file-list.json --output .agentic-wiki/cache/filtered-files.json
```

**脚本功能**：
- 识别纯 CSS/SCSS/Less 文件
- 识别 styled-components 定义的样式
- 识别只包含样式的文件
- 输出过滤结果

**过滤规则**：

| 文件类型 | 过滤方式 | 说明 |
|---------|---------|------|
| `*.css`, `*.scss`, `*.less` | 直接过滤 | 纯样式文件 |
| `*.styled.ts` | AST 分析 | 检查是否只包含样式定义 |
| 包含 `styled()` 的文件 | AST 分析 | 检查样式占比 |

**输出示例**：
```json
{
  "filteredAt": "2026-05-29T10:03:00Z",
  "totalFiles": 128,
  "filteredFiles": [
    {
      "path": "src/styles/global.css",
      "reason": "纯样式文件",
      "filterType": "pure_style"
    },
    {
      "path": "src/components/Button.styled.ts",
      "reason": "只包含 styled-components 定义",
      "filterType": "styled_components"
    }
  ],
  "filteredCount": 25,
  "remainingCount": 103
}
```

---

### Step 4: 分配文件优先级 + 更新状态

> 此步骤在 DEPENDENCY 阶段完成后执行。编排器回到 SCAN 阶段完成。

#### 4a. 运行 file-priorities.ts

```bash
npx tsx src/lib/file-priorities.ts --files .agentic-wiki/cache/file-list.json --deps .agentic-wiki/cache/dependency-graph.json --output .agentic-wiki/cache/file-priorities.json
```

按命名模式、依赖数量、JSX/Hook 检测分配 P0-P4 优先级。

#### 4b. 运行 analyze-folders（增强版）

```bash
npx tsx src/lib/analyze-folders.ts --input .agentic-wiki/cache/file-priorities.json --output .agentic-wiki/cache/folder-strategy.json
```

v2: 基于 token 估算拆分，按角色分组，识别跨文件夹合并。

#### 4c. 更新 state.json

使用 `edit_file` 工具更新 `state.json`：

```json
{
  "phaseHistory": [
    {
      "phase": "SCAN",
      "status": "completed",
      "startedAt": "<时间戳>",
      "completedAt": "<时间戳>",
      "output": ".agentic-wiki/cache/folder-strategy.json"
    }
  ],
  "currentPhase": "DEPENDENCY",
  "checkpoint": {
    "lastSuccessPhase": "SCAN"
  }
}
```

---

## 输出产物

| 文件 | 说明 |
|------|------|
| `.agentic-wiki/cache/file-list.json` | 文件列表 |
| `.agentic-wiki/cache/folder-strategy.json` | 拆分策略（v2: 含 subTasks + crossFolderMerges） |
| `.agentic-wiki/cache/filtered-files.json` | 过滤结果 |
| `.agentic-wiki/cache/file-priorities.json` | 🆕 文件优先级标注 + token 估算 |

---

## 决策输出

扫描完成后，向用户展示：

```
✅ 文件扫描完成

扫描结果：
- 源码文件: 128 个
- 过滤样式: 25 个
- 待分析文件: 103 个

文件夹拆分策略：
- src/components/ (120 文件) → 拆分为 common/ + business/
- src/pages/ (45 文件) → 不拆分
- src/utils/ (15 文件) → 不拆分

待分析文件夹: 12 个

是否继续构建依赖图？(aw-dependency)
```

---

## 下一步

扫描完成后，自动调用 `aw-dependency` Skill。
