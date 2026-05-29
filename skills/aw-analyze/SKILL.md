# aw-analyze — 代码逻辑分析

> 分析单个文件夹的代码逻辑，提取组件、链路、数据流

## 触发条件

- `aw-dependency` 或 `aw-incremental` 完成后
- 用户说"分析这个文件夹"、"分析代码逻辑"
- `aw-orchestrator` 调度 ANALYZE 阶段

---

## 你的任务

1. 读取文件夹下的所有源码文件
2. 提取组件/函数/类的定义和接口
3. 分析关键链路（初始化、业务操作、跳转、异常）
4. 分析数据流（入、出、内）
5. 识别交叉引用
6. 输出结构化分析结果

---

## 执行模式

### 模式 A: Main Agent 直接执行（简单文件夹）

适用于：
- 文件数 ≤ 10
- 逻辑简单

**执行方式**：Main Agent 直接读取文件并分析

---

### 模式 B: SubAgent 并发执行（复杂文件夹）

适用于：
- 文件数 > 10
- 逻辑复杂

**执行方式**：使用 `spawn_agent` 工具启动 SubAgent

---

## 执行步骤（模式 B）

### Step 1: 确定分析范围

使用 `read_file` 工具读取：
- `.agentic-wiki/cache/folder-strategy.json`（全量模式）
- `.agentic-wiki/cache/incremental-analysis.json`（增量模式）

获取需要分析的文件夹列表。

---

### Step 2: 为每个文件夹创建 SubAgent 任务

**任务清单格式**：

| ID | 文件夹 | 任务描述 |
|----|--------|---------|
| T1 | src/components/ | 分析组件结构、Props、依赖关系 |
| T2 | src/pages/ | 分析页面逻辑、路由、数据流 |
| T3 | src/utils/ | 分析工具函数、输入输出 |
| T4 | src/hooks/ | 分析自定义 Hook、使用场景 |

---

### Step 3: 启动 SubAgent 并发分析

使用 `spawn_agent` 工具启动多个 SubAgent：

**SubAgent Prompt 模板**：

```
你正在分析文件夹：{folder}

## 你的任务

1. 读取该文件夹下的所有源码文件
2. 提取以下信息：
   - 组件/函数/类的定义
   - Props/参数/返回值类型
   - 依赖关系（import）
   - 关键链路（初始化、业务操作、跳转、异常）
   - 数据流（入、出、内）
3. 产出结构化分析结果

## 可用工具

- `read_file`: 读取代码文件
- `terminal`: 运行 AST 解析脚本
  ```bash
  npx tsx src/lib/parse-ast.ts --file <文件路径>
  ```

## 输出格式

将分析结果写入：`.agentic-wiki/cache/analysis/{folder-hash}.json`

格式要求：
```json
{
  "folder": "src/components/",
  "analyzedAt": "<时间戳>",
  "files": ["Button.tsx", "Input.tsx"],
  "summary": "文件夹概述（1-2句话）",
  "components": [
    {
      "name": "Button",
      "file": "Button.tsx",
      "type": "functional",
      "props": [
        { "name": "label", "type": "string", "required": true }
      ],
      "exports": ["Button"],
      "hooks": ["useState"],
      "dependencies": ["react"],
      "description": "组件描述"
    }
  ],
  "functions": [...],
  "links": {
    "init": ["初始化链路描述"],
    "business": ["业务操作链路描述"],
    "navigation": ["跳转链路描述"],
    "error": ["异常处理链路描述"]
  },
  "dataFlow": {
    "incoming": ["数据来源"],
    "outgoing": ["数据去向"],
    "internal": ["内部数据流转"]
  },
  "crossReferences": ["引用该文件夹的其他文件"]
}
```

## 注意事项

- 使用 AST 解析脚本提取精确的类型信息
- 链路分析要具体，不要泛泛而谈
- 交叉引用要基于依赖图，不要遗漏
```

---

### Step 4: 等待所有 SubAgent 完成

收集所有 SubAgent 的输出结果。

---

### Step 5: 汇总分析结果

使用 `read_file` 工具读取所有 `analysis/*.json` 文件，汇总：

```json
{
  "analyzedAt": "2026-05-29T10:15:00Z",
  "totalFolders": 12,
  "folders": [
    {
      "path": "src/components/",
      "summary": "通用 UI 组件库",
      "fileCount": 3,
      "componentCount": 3
    },
    {
      "path": "src/pages/",
      "summary": "页面组件",
      "fileCount": 5,
      "componentCount": 5
    }
  ],
  "totalComponents": 20,
  "totalFunctions": 35,
  "issues": [
    {
      "folder": "src/utils/",
      "type": "missing_types",
      "description": "helper.ts 缺少返回值类型"
    }
  ]
}
```

---

### Step 6: 更新状态

使用 `edit_file` 工具更新 `state.json`：

```json
{
  "phaseHistory": [
    {
      "phase": "ANALYZE",
      "status": "completed",
      "startedAt": "<时间戳>",
      "completedAt": "<时间戳>",
      "output": ".agentic-wiki/cache/analysis/",
      "subTasks": [
        { "id": "T1", "folder": "src/components/", "status": "completed" },
        { "id": "T2", "folder": "src/pages/", "status": "completed" },
        { "id": "T3", "folder": "src/utils/", "status": "completed" }
      ]
    }
  ],
  "currentPhase": "GENERATE"
}
```

---

## 输出产物

| 文件 | 说明 |
|------|------|
| `.agentic-wiki/cache/analysis/*.json` | 每个文件夹的分析结果 |
| `.agentic-wiki/cache/analysis-summary.json` | 汇总结果（可选） |

---

## 分析维度

### 组件分析

| 字段 | 说明 | 提取方式 |
|------|------|---------|
| `name` | 组件名称 | AST 解析 |
| `type` | 组件类型（functional/class） | AST 解析 |
| `props` | Props 定义 | TypeScript 类型提取 |
| `exports` | 导出项 | AST 解析 |
| `hooks` | 使用的 Hooks | AST 遍历 |
| `dependencies` | 依赖项 | import 分析 |
| `description` | 组件描述 | LLM 生成 |

### 链路分析

| 链路类型 | 说明 | 分析方式 |
|---------|------|---------|
| `init` | 初始化链路 | 分析 useEffect、constructor |
| `business` | 业务操作链路 | 分析事件处理函数 |
| `navigation` | 跳转链路 | 分析路由调用 |
| `error` | 异常处理链路 | 分析 try-catch、错误边界 |

### 数据流分析

| 方向 | 说明 | 分析方式 |
|------|------|---------|
| `incoming` | 数据来源 | 分析 props、API 响应 |
| `outgoing` | 数据去向 | 分析回调、事件 |
| `internal` | 内部流转 | 分析 state、context |

---

## 下一步

分析完成后，调用 `aw-generate` 生成 Wiki 文档。
