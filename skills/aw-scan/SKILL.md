# aw-scan — 文件扫描与过滤

> 扫描源码文件，智能过滤样式文件

## 触发条件

- `aw-init` 完成后
- 用户说"扫描项目"、"分析文件结构"
- `aw-orchestrator` 检测到 `currentPhase = SCAN`

---

## 你的任务

1. 扫描所有源码文件（自动排除 gitignore）
2. 智能过滤纯样式文件
3. 输出文件列表和过滤结果

> ⚠️ 文件夹拆分策略由 `aw-dependency` 负责（需要依赖图数据作为输入）。

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
- 自动排除 `node_modules`、`dist`、`build` 等构建目录
- 自动排除资源目录：`assets/`、`images/`、`img/`、`static/`、`public/`、`fonts/`、`icons/`、`media/`、`resources/`
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
    "src/utils/helper.ts"
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

### Step 2: 过滤样式文件

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

### Step 3: 更新状态 → DEPENDENCY

使用 `state-manager.ts transition` 完成阶段转换：

```bash
npx tsx {agenticWikiRoot}/src/lib/state-manager.ts transition \
  --state .agentic-wiki/state.json \
  --phase SCAN \
  --status completed \
  --next-phase DEPENDENCY \
  --output ".agentic-wiki/cache/file-list.json" \
  --artifacts "file-list.json,filtered-files.json" \
  --scripts "scan-files.ts:0,filter-styles.ts:0" \
  --gate
```

---

## 输出产物

| 文件 | 说明 |
|------|------|
| `.agentic-wiki/cache/file-list.json` | 文件列表 |
| `.agentic-wiki/cache/filtered-files.json` | 过滤结果 |

---

## 决策输出

扫描完成后，向用户展示：

```
✅ 文件扫描完成

扫描结果：
- 源码文件: 128 个
- 过滤样式: 25 个
- 待分析文件: 103 个

是否继续构建依赖图？(aw-dependency)
```

---

## 下一步

扫描完成后，自动调用 `aw-dependency` Skill。
