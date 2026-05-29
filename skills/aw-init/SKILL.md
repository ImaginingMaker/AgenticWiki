# aw-init — 项目初始化

> 识别项目技术栈，创建 `.agentic-wiki/` 目录结构，初始化状态文件

## 触发条件

- 用户首次运行 AgenticWiki
- 用户说"初始化项目"、"分析新项目"、"开始分析"
- `aw-orchestrator` 检测到 `state.json` 不存在

---

## 你的任务

1. 识别项目技术栈（框架、语言、构建工具、包管理器）
2. 创建 `.agentic-wiki/` 目录结构
3. 🔴 **路径冲突检测**（新增 - 不可跳过）
4. 初始化 `state.json` 状态文件
5. 记录项目基础信息到 `project-scan.json`

---

## 执行步骤

### Step 1: 扫描项目文件

使用 `terminal` 工具运行：

```bash
npx tsx src/lib/scan-project.ts --path <项目路径> --output .agentic-wiki/cache/project-scan.json
```

**参数说明**：
- `--path`: 项目根目录路径（默认为当前目录）
- `--output`: 输出文件路径

**脚本功能**：
- 扫描 `package.json` 识别依赖和脚本
- 检测框架类型（React/Vue/Node.js/Angular 等）
- 识别语言（TypeScript/JavaScript）
- 识别构建工具（Vite/Webpack/Rollup 等）
- 识别包管理器（pnpm/npm/yarn）
- 统计源码文件数量

**输出示例**：
```json
{
  "projectPath": "/path/to/project",
  "scannedAt": "2026-05-29T10:00:00Z",
  "techStack": {
    "framework": "react",
    "language": "typescript",
    "buildTool": "vite",
    "packageManager": "pnpm",
    "hasJSX": true,
    "hasTypeScript": true
  },
  "sourcePath": "src/",
  "totalFiles": 128,
  "totalFolders": 12
}
```

---

### Step 2: 创建目录结构

使用 `terminal` 工具运行：

```bash
mkdir -p .agentic-wiki/cache
mkdir -p .agentic-wiki/cache/analysis
mkdir -p .agentic-wiki/cache/deps
mkdir -p .agentic-wiki/issues
mkdir -p .agentic-wiki/feedback
mkdir -p .agentic-wiki/search
```

**目录说明**：
- `cache/`: 存储中间产物（JSON）
- `cache/analysis/`: 存储局部分析结果（v1 兼容）
- `cache/deps/`: 🆕 存储每个文件夹的依赖子图
- `issues/`: 存储 Issue 追踪数据
- `feedback/`: 存储反馈积累
- `search/`: 🆕 存储符号索引

---

### Step 2.5: 🔴 路径冲突检测（必须）

> ⚠️ 在初始化 `state.json` 之前，**必须**检测路径冲突。此步骤不可跳过。

**检测规则**：

1. **`projectRoot` 与 `agenticWikiRoot` 不能指向同一目录**

   如果用户将目标项目放在 AgenticWiki 项目内部（如 `project/tdesign-vue-next/`），必须将 `projectRoot` 设为该子目录的绝对路径：
   - ✅ `projectRoot` = `/Users/alex/Desktop/Github/AgenticWiki/project/tdesign-vue-next`
   - ✅ `agenticWikiRoot` = `/Users/alex/Desktop/Github/AgenticWiki`
   - ❌ `projectRoot` = `agenticWikiRoot` = 同一目录

2. **`wikiRoot` 必须在 `projectRoot` 下，而非 `agenticWikiRoot` 下**

   - ✅ `wikiRoot` = `{projectRoot}/wiki`
   - ❌ `wikiRoot` = `{agenticWikiRoot}/wiki`（这会把 Wiki 写到 AgenticWiki 自己的目录里）

3. **`sourceRoot` 必须在 `projectRoot` 下**

   - ✅ `sourceRoot` = `{projectRoot}/src`（或用户指定的源码路径）
   - ❌ `sourceRoot` 指向 `projectRoot` 之外的路径

**检测流程**：

1. 从 Step 1 的 `project-scan.json` 获取目标项目路径
2. 确定 AgenticWiki 自身的安装路径（当前工作目录或环境变量）
3. 对比两者：如果 `projectRoot` 以 `agenticWikiRoot` 开头（即目标项目在 AgenticWiki 内部），**必须**生成独立的 `projectRoot`
4. 展示路径映射给用户确认：

```
📁 路径映射检测：

AgenticWiki 安装根: /Users/alex/Desktop/Github/AgenticWiki
目标项目根:        /Users/alex/Desktop/Github/AgenticWiki/project/tdesign-vue-next

派生路径：
- sourceRoot:  {projectRoot}/packages/components/dialog/
- wikiRoot:    {projectRoot}/wiki
- cacheRoot:   {projectRoot}/.agentic-wiki/cache

✅ 路径无冲突（projectRoot ≠ agenticWikiRoot）
```

**如果检测到冲突**：
- 向用户展示冲突详情
- 建议正确的路径配置
- **等待用户确认**后再继续

---

### Step 3: 初始化状态文件

使用 `write_file` 工具创建 `.agentic-wiki/state.json`：

```json
{
  "id": "YYYYMMDD-<项目名>",
  "projectPath": "<项目绝对路径>",
  "createdAt": "<ISO时间戳>",
  "currentPhase": "INIT",
  "phaseHistory": [
    {
      "phase": "INIT",
      "status": "in_progress",
      "startedAt": "<ISO时间戳>"
    }
  ],
  "checkpoint": {
    "lastSuccessPhase": null,
    "filesSnapshot": {},
    "timestamp": "<ISO时间戳>"
  },
  "blockers": [],
  "config": {
    "mode": "full",
    "sourcePath": "src/",
    "wikiPath": "wiki/",
    "excludePatterns": ["node_modules", "dist", "build"],
    "language": "zh-CN",
    "tokenBudgetPerSubTask": 80000,
    "maxConcurrentSubAgents": 5,
    "paths": {
      "projectRoot": "<项目绝对路径>",
      "agenticWikiRoot": "<AgenticWiki安装绝对路径>",
      "sourceRoot": "<项目绝对路径>/src",
      "wikiRoot": "<项目绝对路径>/wiki",
      "cacheRoot": "<项目绝对路径>/.agentic-wiki/cache"
    }
  }
}
```

**字段说明**：
- `id`: 任务唯一标识，格式为 `YYYYMMDD-{项目名}`
- `currentPhase`: 当前阶段，初始化时为 `INIT`
- `phaseHistory`: 阶段执行历史
- `checkpoint`: 断点恢复快照
- `config`: 用户配置
- `config.tokenBudgetPerSubTask`: 🆕 每个 SubAgent 的 token 预算上限
- `config.maxConcurrentSubAgents`: 🆕 最大并发 SubAgent 数
- `config.paths`: 🆕 绝对路径映射（projectRoot、agenticWikiRoot、sourceRoot、wikiRoot、cacheRoot）

> ⚠️ **重要**：`config.paths.*` 中的所有路径必须是**绝对路径**。`projectRoot` **必须**指向目标项目根目录（被分析的项目），而非 AgenticWiki 自身。`wikiRoot` 必须等于 `{projectRoot}/wiki`。

---

### Step 4: 更新状态为已完成

使用 `edit_file` 工具更新 `state.json`：

```json
{
  "phaseHistory": [
    {
      "phase": "INIT",
      "status": "completed",
      "startedAt": "<原值>",
      "completedAt": "<当前时间戳>",
      "output": ".agentic-wiki/cache/project-scan.json",
      "artifacts": [
        ".agentic-wiki/cache/project-scan.json",
        ".agentic-wiki/state.json"
      ]
    }
  ],
  "currentPhase": "SCAN",
  "checkpoint": {
    "lastSuccessPhase": "INIT",
    "timestamp": "<当前时间戳>"
  }
}
```

---

## 输出产物

| 文件 | 说明 |
|------|------|
| `.agentic-wiki/state.json` | 状态文件（唯一状态源） |
| `.agentic-wiki/cache/project-scan.json` | 项目扫描结果 |
| `.agentic-wiki/` 目录结构 | 缓存、Issue、反馈目录 |

---

## 错误处理

| 错误 | 处理方式 |
|------|---------|
| `package.json` 不存在 | 提示用户"未找到 package.json，请确认项目路径" |
| 无法识别框架 | 默认为 `node` 项目，继续执行 |
| 目录创建失败 | 记录错误到 `state.json.blockers`，询问用户 |
| 🔴 路径冲突 | 展示冲突详情，建议修正，等待用户确认 |

---

## 下一步

初始化完成后，提示用户：

```
✅ 项目初始化完成

项目信息：
- 框架: React
- 语言: TypeScript
- 构建工具: Vite
- 源码文件: 128 个

路径映射：
- 目标项目: /path/to/target
- Wiki 输出: /path/to/target/wiki
- 缓存目录: /path/to/target/.agentic-wiki

是否继续执行文件扫描？(aw-scan)
```

如果用户确认，自动调用 `aw-scan` Skill。
