# aw-dependency — 依赖图构建

> 构建模块依赖图，检测循环依赖，生成 Mermaid 可视化

## 触发条件

- `aw-scan` 完成后
- 用户说"分析依赖"、"构建依赖图"
- `aw-orchestrator` 检测到 `currentPhase = DEPENDENCY`

---

## 你的任务

1. 构建模块依赖图（import/require 关系）
2. 检测循环依赖
3. 识别依赖热点（被依赖最多/依赖最多）
4. 生成 Mermaid 可视化图
5. 🔴 **为每个待分析文件夹提取子图**（不可跳过）
6. 输出结构化依赖数据

---

## 执行步骤

### Step 1: 构建依赖图（JSON 格式）— 🔧 脚本

使用 `terminal` 工具运行：

```bash
npx tsx src/lib/build-deps.ts --path <源码路径> --output .agentic-wiki/cache/dependency-graph.json --format json
```

**参数说明**：
- `--path`: 源码路径
- `--output`: 输出文件路径
- `--format`: 输出格式（json）

**脚本功能**：
- 使用 `dependency-cruiser` 分析依赖关系
- 支持 TypeScript 路径别名
- 检测循环依赖
- 识别外部依赖 vs 本地依赖

**输出示例**：
```json
{
  "generatedAt": "2026-05-29T10:05:00Z",
  "modules": [
    {
      "source": "src/App.tsx",
      "dependencies": [
        { "resolved": "src/components/Button.tsx", "type": "local", "circular": false },
        { "resolved": "src/utils/helper.ts", "type": "local", "circular": false },
        { "resolved": "react", "type": "external", "circular": false }
      ],
      "dependents": ["src/main.tsx"],
      "hasCircular": false
    }
  ],
  "cycles": [
    {
      "path": ["src/A.ts", "src/B.ts", "src/A.ts"],
      "severity": "error",
      "description": "循环依赖: A → B → A"
    }
  ],
  "hotspots": {
    "mostDepended": [
      { "source": "src/utils/helper.ts", "dependentsCount": 15 }
    ],
    "mostDependent": [
      { "source": "src/pages/Dashboard.tsx", "dependenciesCount": 12 }
    ]
  }
}
```

**自检**：运行后用 `read_file` 读取 `dependency-graph.json`，确认文件存在且包含 `modules` 数组。

---

### Step 2: 生成 Mermaid 可视化 — 🔧 脚本

使用 `terminal` 工具运行：

```bash
npx tsx src/lib/build-deps.ts --path <源码路径> --output .agentic-wiki/cache/dependency-graph.mmd --format mermaid
```

**输出示例**：
```mermaid
graph TD
  App[App.tsx] --> Button[Button.tsx]
  App --> Input[Input.tsx]
  App --> helper[utils/helper.ts]
  Button --> React
  Input --> React
  Home[pages/Home.tsx] --> App
```

**Mermaid 输出特点**：
- 可直接嵌入 Markdown Wiki 页面
- 支持在 Obsidian 中渲染
- 清晰展示模块关系

**自检**：运行后用 `read_file` 读取 `dependency-graph.mmd`，确认文件存在且内容以 `graph` 或 `flowchart` 开头。

---

### Step 3: 分析依赖热点

使用 `read_file` 工具读取 `dependency-graph.json`，然后分析：

**分析维度**：

| 维度 | 说明 | 用途 |
|------|------|------|
| **被依赖最多** | 核心模块，修改影响范围大 | 标记为高优先级分析 |
| **依赖最多** | 复杂模块，逻辑可能复杂 | 标记为深度分析 |
| **循环依赖** | 架构问题，需要修复 | 记录为 Issue |
| **孤立模块** | 未被任何文件依赖 | 可能是死代码 |

**输出到 `dependency-graph.json` 的 `hotspots` 字段**。

---

### Step 4: 检测并记录循环依赖

如果检测到循环依赖，使用 `write_file` 工具创建 Issue JSON：

```json
// .agentic-wiki/issues/ISSUE-001.json
{
  "id": "ISSUE-001",
  "type": "circular_dependency",
  "severity": "high",
  "status": "detected",
  "location": {
    "files": ["src/A.ts", "src/B.ts"],
    "description": "循环依赖: A → B → A"
  },
  "detectedAt": "2026-05-29T10:05:00Z",
  "verifiedAt": null,
  "fixedAt": null
}
```

同时更新 `issues/index.json`。

---

### Step 5: 🔴 提取子图（🔧 脚本，不可跳过）

> ⚠️ 此步骤是 DEPENDENCY 阶段的**强制步骤**，不可跳过。
> GEN SubAgent 依赖子图数据来生成准确的依赖关系图和交叉引用。

#### 5.1 确定文件夹列表

使用 `read_file` 读取 `.agentic-wiki/cache/folder-strategy.json`，获取 `folders[].path` 列表。

#### 5.2 为每个文件夹提取子图

对**每个**待分析文件夹，使用 `terminal` 工具运行：

```bash
npx tsx src/lib/extract-subgraph.ts \
  --deps .agentic-wiki/cache/dependency-graph.json \
  --folder "<文件夹路径>" \
  --output .agentic-wiki/cache/deps/<文件夹名>-deps.json
```

**示例**：

```bash
# 为 dialog 文件夹提取子图
npx tsx src/lib/extract-subgraph.ts \
  --deps .agentic-wiki/cache/dependency-graph.json \
  --folder "project/tdesign-vue-next/packages/components/dialog/" \
  --output .agentic-wiki/cache/deps/dialog-deps.json

# 为另一个文件夹提取子图
npx tsx src/lib/extract-subgraph.ts \
  --deps .agentic-wiki/cache/dependency-graph.json \
  --folder "project/tdesign-vue-next/packages/components/button/" \
  --output .agentic-wiki/cache/deps/button-deps.json
```

#### 5.3 子图产物自检

运行后**必须**逐项确认：

- [ ] 每个文件夹都有对应的 `deps/{folder}-deps.json` 文件
- [ ] 每个子图文件内容非空（使用 `read_file` 检查是否包含 `internalModules` 字段）
- [ ] 子图文件数量 = 待分析文件夹数量

#### 5.4 缺失处理

如果任何子图缺失：
- 标记对应文件夹到 `state.json.blockers`
- **暂停流水线**，不要进入 GEN 阶段
- 向用户展示缺失的子图清单

---

### Step 6: 更新状态

使用 `edit_file` 工具更新 `state.json`：

```json
{
  "phaseHistory": [
    {
      "phase": "DEPENDENCY",
      "status": "completed",
      "startedAt": "<时间戳>",
      "completedAt": "<时间戳>",
      "output": ".agentic-wiki/cache/dependency-graph.json",
      "artifacts": [
        ".agentic-wiki/cache/dependency-graph.json",
        ".agentic-wiki/cache/dependency-graph.mmd",
        ".agentic-wiki/cache/deps/dialog-deps.json"
      ],
      "scriptsExecuted": [
        { "script": "build-deps.ts", "exitCode": 0 },
        { "script": "extract-subgraph.ts", "exitCode": 0 }
      ]
    }
  ],
  "currentPhase": "GEN",
  "checkpoint": {
    "lastSuccessPhase": "DEPENDENCY"
  }
}
```

---

## 输出产物

| 文件 | 说明 | 级别 |
|------|------|------|
| `.agentic-wiki/cache/dependency-graph.json` | 依赖图数据 | 🔴 CRITICAL |
| `.agentic-wiki/cache/dependency-graph.mmd` | Mermaid 可视化 | 🟡 REQUIRED |
| `.agentic-wiki/cache/deps/{folder}-deps.json` | 🔴 每个文件夹的依赖子图 | 🔴 CRITICAL |
| `.agentic-wiki/issues/ISSUE-*.json` | 循环依赖 Issue（如有） | 🟡 条件性 |

---

## 决策输出

依赖图构建完成后，向用户展示：

```
✅ 依赖图构建完成

依赖分析：
- 模块总数: 103 个
- 循环依赖: 1 个 ⚠️
- 外部依赖: 15 个

依赖热点：
- 被依赖最多: src/utils/helper.ts (15 次)
- 依赖最多: src/pages/Dashboard.tsx (12 个依赖)

子图提取：
- dialog-deps.json ✅ (6 个内部模块, 5 个外部依赖)
- button-deps.json ✅ (4 个内部模块, 3 个外部依赖)

⚠️ 检测到循环依赖:
- src/A.ts → src/B.ts → src/A.ts

是否继续分析代码逻辑？(aw-analyze)
```

---

## 循环依赖处理

如果检测到循环依赖：

1. **记录 Issue**：创建 `ISSUE-*.json`
2. **标记严重性**：循环依赖为 `high` 严重性
3. **提示用户**：在输出中明确标注
4. **继续执行**：不阻塞后续分析，但标记为需要修复

---

## 下一步

依赖图构建完成后，根据模式：

- **全量模式**：调用 `aw-analyze` 分析所有文件夹
- **增量模式**：调用 `aw-incremental` 计算受影响范围
