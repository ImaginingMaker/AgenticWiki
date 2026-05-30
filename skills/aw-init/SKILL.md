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
3. 初始化 `state.json` 状态文件
4. 🔴 **路径自检**（写完后回读校验 — 不可跳过）
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

---

### Step 2: 创建目录结构（🔴 必须使用绝对路径）

> ⚠️ 必须基于 `projectRoot` 拼绝对路径，禁止使用相对路径。
> 错误示例：`mkdir -p .agentic-wiki/cache` ← 会在当前目录下创建！
> 正确做法：先确定 `projectRoot`，再拼接绝对路径。

使用 `terminal` 工具运行（替换 `<projectRoot>` 为实际值）：

```bash
mkdir -p <projectRoot>/.agentic-wiki/cache
mkdir -p <projectRoot>/.agentic-wiki/cache/deps
mkdir -p <projectRoot>/.agentic-wiki/issues
mkdir -p <projectRoot>/.agentic-wiki/feedback
mkdir -p <projectRoot>/.agentic-wiki/search
```

---

## 🔴 路径铁律（最高优先级 — 违反必须阻断）

在写入 `state.json` 之前，**必须**确定以下路径并确保它们满足约束：

```
projectRoot     = 目标项目的绝对路径（被分析的代码所在项目）
agenticWikiRoot = AgenticWiki 自身的安装根目录
wikiRoot        = projectRoot + "/wiki"
sourceRoot      = projectRoot 下的源码路径
cacheRoot       = projectRoot + "/.agentic-wiki/cache"
```

**三条铁律**：

| # | 规则 | 正确示例 | 错误示例 |
|---|------|---------|---------|
| 1 | `projectRoot ≠ agenticWikiRoot` | `.../AgenticWiki/project/tdesign-vue-next` | `.../AgenticWiki` ❌ |
| 2 | `wikiRoot = projectRoot + "/wiki"` | `.../tdesign-vue-next/wiki` | `.../AgenticWiki/wiki` ❌ |
| 3 | `sourceRoot` 在 `projectRoot` 下 | `.../tdesign-vue-next/src` | 指向 projectRoot 外部 ❌ |

**示例场景**：用户指定分析 `project/tdesign-vue-next/packages/components/button/`

- `projectRoot` = `/Users/alex/Desktop/Github/AgenticWiki/project/tdesign-vue-next` ✅
- `agenticWikiRoot` = `/Users/alex/Desktop/Github/AgenticWiki` ✅
- `wikiRoot` = `/Users/alex/Desktop/Github/AgenticWiki/project/tdesign-vue-next/wiki` ✅
- 如果 `wikiRoot` = `/Users/alex/Desktop/Github/AgenticWiki/wiki` ❌ 阻断！

---

### Step 3: 初始化状态文件

使用 `write_file` 工具创建 `.agentic-wiki/state.json`。

**路径占位符说明**：以下模板中的 `<projectRoot>` 必须替换为目标项目的绝对路径，`<agenticWikiRoot>` 替换为 AgenticWiki 自身的绝对路径。`wikiRoot` 和 `cacheRoot` **只能**基于 `projectRoot` 派生。

```json
{
  "id": "YYYYMMDD-<项目名>",
  "projectPath": "<projectRoot>",
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
      "projectRoot": "<projectRoot>",
      "agenticWikiRoot": "<agenticWikiRoot>",
      "sourceRoot": "<projectRoot>/src",
      "wikiRoot": "<projectRoot>/wiki",
      "cacheRoot": "<projectRoot>/.agentic-wiki/cache"
    }
  }
}
```

> `wikiRoot` **必须**等于 `{projectRoot}/wiki`，绝不能等于 `{agenticWikiRoot}/wiki`。

---

### Step 3.5: 🔴 路径自检（不可跳过 — 违反则阻断流水线）

> 写完 `state.json` 后，**必须**立即用 `read_file` 回读并逐项校验。**全部通过才能进入 Step 4。**

**校验清单**：

- [ ] `projectRoot ≠ agenticWikiRoot`
- [ ] `wikiRoot === projectRoot + "/wiki"`
- [ ] `cacheRoot.startsWith(projectRoot)`
- [ ] `sourceRoot.startsWith(projectRoot)`
- [ ] `projectRoot` 指向的目录存在且包含源码或 `package.json`

**校验方法**：

1. 用 `read_file` 读取刚写入的 `.agentic-wiki/state.json`
2. 提取 `config.paths.projectRoot`、`agenticWikiRoot`、`wikiRoot`、`sourceRoot`、`cacheRoot`
3. 逐一执行上述 5 项检查
4. 如果**任何一条**不通过：
   - **禁止**进入 Step 4
   - 将冲突记录到 `state.json.blockers`
   - 展示具体错误和修复建议
   - **等待用户提供正确的 projectRoot 后重新写入**

**校验通过示例**：

```
🔴 路径自检通过 ✅

  projectRoot:      .../AgenticWiki/project/tdesign-vue-next
  agenticWikiRoot:  .../AgenticWiki
  wikiRoot:         .../AgenticWiki/project/tdesign-vue-next/wiki
  projectRoot ≠ agenticWikiRoot: ✅
  wikiRoot 在 projectRoot 下:    ✅
  cacheRoot 在 projectRoot 下:   ✅

→ Wiki 将输出到目标项目目录。继续初始化。
```

**校验失败示例（必须阻断）**：

```
🔴 路径自检失败！

  wikiRoot = .../AgenticWiki/wiki
  期望值   = .../AgenticWiki/project/tdesign-vue-next/wiki

  原因：wikiRoot 被错误地设到了 AgenticWiki 根目录。
  修复：projectRoot 必须指向目标项目（被分析的代码所在的项目），
        而非 AgenticWiki 自身。

→ 已阻断。请提供正确的 projectRoot。
```

---

### Step 4: 更新状态为已完成

路径自检通过后，使用 `edit_file` 工具更新 `state.json`：

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
- 🔴 路径自检失败 | **阻断流水线**，展示错误详情，等待正确 projectRoot |
| 🔴 目录位置错误 | **阻断流水线**，删除错误位置的 `.agentic-wiki/`，展示修复建议 |

---

## 下一步

初始化完成后，提示用户：

```
✅ 项目初始化完成

路径映射：
- 目标项目:    /path/to/target
- Wiki 输出:   /path/to/target/wiki       ← 确认在目标项目下
- 缓存目录:    /path/to/target/.agentic-wiki

是否继续执行文件扫描？(aw-scan)
```

如果用户确认，自动调用 `aw-scan` Skill。
