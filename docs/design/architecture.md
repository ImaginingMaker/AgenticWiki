# AgenticWiki — 架构设计文档

> 基于 LLM Wiki (karpathry) 思想，构建 Agent 驱动的前端代码转 Wiki 系统

## 一、核心架构

### 1.1 设计原则

| 原则 | 说明 |
|------|------|
| **Agent 是驱动者** | Agent 决定调用什么 Skills、运行什么脚本、处理什么数据 |
| **Skills 是指令集** | SKILL.md 告诉 Agent "做什么、怎么做"，不是可执行程序 |
| **脚本是数据工具** | 脚本只负责数据获取与转换，不包含业务逻辑，不调度 LLM |
| **Skills 完全独立** | 不复用现有 pi-/pu- Skills 生态，执行环境不同 |
| **增量优先** | 全量分析是特例，增量分析是常态 |

### 1.2 三层架构（借鉴 karpathry）

```
┌─────────────────────────────────────────┐
│  Agent 层                                │
│  Main Agent + SubAgent                   │
│  读取 SKILL.md → 决策 → 调用工具         │
├─────────────────────────────────────────┤
│  Skills 层                               │
│  aw-* SKILL.md 文档                      │
│  指导 Agent 如何行动                      │
├─────────────────────────────────────────┤
│  脚本层                                  │
│  src/lib/*.ts                            │
│  纯数据获取与转换（通过 tsx 执行）         │
├─────────────────────────────────────────┤
│  数据层                                  │
│  .agentic-wiki/cache/*.json              │
│  wiki/*.md                               │
└─────────────────────────────────────────┘
```

**与 karpathry 原始三层映射**：

| karpathry | AgenticWiki | 说明 |
|-----------|-------------|------|
| Raw Sources | 项目源码 | 不可变的源码文件，Agent 只读不写 |
| The Wiki | wiki/ 目录 | LLM 生成的 Markdown 文档，Agent 拥有读写权 |
| The Schema | SKILL.md + state.json | 告诉 Agent 如何组织 Wiki、遵循什么规范 |

### 1.3 Agent 工具映射

Agent 通过以下内置工具与外部交互：

| Agent 工具 | 用途 | 典型场景 |
|-----------|------|---------|
| `terminal` | 运行脚本 | `node scripts/build-deps.js --path src/` |
| `read_file` | 读取文件 | 读取 `cache/dependency-graph.json` |
| `write_file` | 写入文件 | 写入 `wiki/src-components.md` |
| `edit_file` | 编辑文件 | 增量更新 Wiki 章节 |
| `spawn_agent` | 启动 SubAgent | 并发分析多个文件夹 |
| `grep` | 搜索内容 | 搜索 Wiki 中的交叉引用 |
| `find_path` | 查找文件 | 查找 Wiki 页面 |

---

## 二、Skills 生态设计

### 2.1 技能清单

| 技能 | 阶段 | 职责 | 产物 |
|------|------|------|------|
| `aw-init` | INIT | 项目初始化 + 技术栈识别 | `project-scan.json` |
| `aw-scan` | SCAN | 文件扫描 + 样式过滤 | `file-list.json`, `filtered-files.json` |
| `aw-dependency` | DEPENDENCY | 依赖图构建 + 优先级标注 + 拆分策略 + 子图提取 | `dependency-graph.json`, `dependency-graph.mmd`, `file-priorities.json`, `folder-strategy.json`, `deps/{folder}-deps.json` |
| `aw-incremental` | INCREMENTAL | 增量分析引擎 | `incremental-analysis.json` |
| `aw-generate` | GEN | 合并分析 + Wiki 生成 + Issue 发现 | `wiki/volume-1-code/**/*.md`, `wiki/volume-2-issues/**/*.md` |
| `aw-validate` | VALIDATE | Wiki 验证 + 交叉引用检查 | `validation-report.json` |
| `aw-feedback` | FEEDBACK | 反馈循环 + prompt 优化 + 回退策略 | `feedback/prompts.md` |
| `aw-orchestrator` | 编排 | DAG 调度 + 断点恢复 + 状态管理 + 门控 | `state.json` |

> `aw-analyze` 作为单文件夹快捷入口，自身不执行分析逻辑，委托给编排器执行完整 DAG（范围缩小到单文件夹）。`aw-issue` 已移除，Issue 发现由 GEN 阶段 SubAgent 直接完成。

### 2.2 DAG 拓扑

```
INIT → SCAN → DEPENDENCY → GEN → ASSEMBLE → VALIDATE → DONE
  │       │         │          │        │           │
  └─GATE──┴─GATE────┴─GATE─────┴─GATE───┴─GATE──────┘
                                                    │
                                          ┌─ 失败 ──┘
                                          ↓
                                      FEEDBACK → 回退到 GEN

增量模式（可选）:
  INCREMENTAL（Git diff + 依赖传播）→ 只分析受影响文件夹
```

> SCAN = 扫描 + 过滤，DEPENDENCY = 依赖图 + 优先级 + 拆分 + 子图

**阶段依赖关系**：

| 阶段 | 前置依赖 | 可并发 | 说明 |
|------|---------|--------|------|
| INIT | 无 | 否 | 基础初始化 |
| SCAN | INIT | 否 | 扫描 + 过滤 |
| DEPENDENCY | SCAN | 否 | 依赖图 + 优先级 + 拆分 + 子图 |
| INCREMENTAL | DEPENDENCY | 否 | 依赖依赖图计算传播范围（可选）|
| GEN | DEPENDENCY 或 INCREMENTAL | **是** | SubAgent 并发生成 Wiki + Issue |
| ASSEMBLE | GEN | 否 | 组装成书 + 符号索引 + Issue 仪表盘 |
| VALIDATE | ASSEMBLE | 否 | 交叉引用验证 + 产物门控 |
| FEEDBACK | VALIDATE | 否 | 只有失败时触发，回退到 GEN |

### 2.3 增量模式 DAG

```
INCREMENTAL（Git diff + 依赖传播）
    │
    ├─→ 只对受影响文件夹执行 GEN
    ├─→ 只对受影响 Wiki 执行更新
    └─→ 对全部 Wiki 执行 VALIDATE
```

---

## 三、状态管理与断点恢复

### 3.1 目录结构

```
.agentic-wiki/
├── state.json                    # 唯一状态源
├── cache/
│   ├── project-scan.json         # 项目信息
│   ├── file-list.json            # 文件列表
│   ├── folder-strategy.json      # 拆分策略
│   ├── file-priorities.json      # 文件优先级标注
│   ├── filtered-files.json       # 过滤结果
│   ├── dependency-graph.json     # 依赖图数据
│   ├── dependency-graph.mmd      # Mermaid 图
│   ├── deps/                     # 每个文件夹的依赖子图
│   │   ├── {folder}-deps.json
│   │   └── ...
│   ├── file-hashes.json          # 文件哈希（增量检测）
│   └── incremental-analysis.json # 增量分析结果
├── search/
│   └── symbol-index.json         # 符号索引（ASSEMBLE 阶段产出）
├── feedback/
│   └── prompts.md                # 反馈积累
└── config.json                   # 用户配置
```

### 3.2 state.json 规范

```typescript
interface WikiState {
  // 任务标识
  id: string;                         // YYYYMMDD-{项目名}
  projectPath: string;                // 项目绝对路径
  createdAt: string;                  // 创建时间

  // 阶段状态
  currentPhase: Phase;                // 当前阶段
  phaseHistory: PhaseRecord[];        // 执行历史

  // 断点恢复
  checkpoint: {
    lastSuccessPhase: Phase | null;   // 最后成功阶段
    filesSnapshot: Record<string, string>;  // 文件哈希快照
    timestamp: string;                // 快照时间
  };

  // 阻塞项
  blockers: Blocker[];

  // 配置
  config: WikiConfig;
}

type Phase =
  | 'INIT'
  | 'SCAN'
  | 'DEPENDENCY'
  | 'INCREMENTAL'
  | 'GEN'
  | 'ASSEMBLE'
  | 'VALIDATE'
  | 'FEEDBACK'
  | 'DONE';

interface PhaseRecord {
  phase: Phase;
  status: 'completed' | 'skipped' | 'failed' | 'in_progress';
  startedAt: string;
  completedAt?: string;
  output?: string;           // 产物路径
  error?: string;            // 失败原因
  subTasks?: SubTaskRecord[]; // GEN 阶段的子任务
}

interface SubTaskRecord {
  id: string;
  folder: string;
  status: 'completed' | 'failed' | 'in_progress';
  output?: string;
  error?: string;
}

interface Blocker {
  phase: Phase;
  message: string;
  timestamp: string;
  resolved: boolean;
}

interface WikiConfig {
  mode: 'full' | 'incremental';
  since?: string;            // 增量模式的起始 commit
  sourcePath: string;        // 源码路径
  wikiPath: string;          // Wiki 输出路径
  excludePatterns: string[]; // 排除模式
  language: string;          // 输出语言
}
```

### 3.3 断点恢复流程

```
启动 → 读取 state.json
  ├─ 不存在 → 全新开始（INIT）
  ├─ 存在 + currentPhase = DONE → 提示已完成
  └─ 存在 + currentPhase != DONE
       ├─ 校验文件一致性（checkpoint.filesSnapshot vs 当前文件哈希）
       │    ├─ 一致 → 从 currentPhase 继续
       │    └─ 不一致 → 展示差异，询问用户
       └─ 跳过已完成的阶段，执行下一个
```

### 3.4 写入安全

- 每次更新 state.json 前，先备份为 `state.backup.json`
- 先写入 `state.tmp.json`，成功后重命名为 `state.json`
- 损坏时从 `state.backup.json` 恢复

---

## 四、脚本层设计

### 4.1 脚本职责边界

**脚本做**：
- 数据获取（文件扫描、Git diff）
- 数据转换（AST 解析、依赖图构建）
- 结构化输出（JSON）

**脚本不做**：
- 调度 LLM
- 管理状态
- 决策判断
- 生成自然语言

### 4.2 脚本清单

| 脚本 | 输入 | 输出 | 核心库 | 说明 |
|------|------|------|--------|------|
| `src/lib/scan-project.ts` | `--path` | `project-scan.json` | `globby`, `fs-extra` | 识别技术栈、框架、包管理器 |
| `src/lib/scan-files.ts` | `--path` | `file-list.json` | `globby` | 列出所有源码文件，自动排除 gitignore |
| `src/lib/filter-styles.ts` | `--input` | `filtered-files.json` | `@babel/parser` | 识别并过滤纯样式文件 |
| `src/lib/build-deps.ts` | `--path` | `dependency-graph.json` / `.mmd` | `dependency-cruiser` | 构建依赖图，支持 Mermaid 输出 |
| `src/lib/file-priorities.ts` | `--files --deps` | `file-priorities.json` | - | P0-P4 优先级标注 + token 估算 |
| `src/lib/analyze-folders.ts` | `--input` | `folder-strategy.json` | - | 基于优先级与 token 估算生成拆分策略 |
| `src/lib/extract-subgraph.ts` | `--deps --folder` | `deps/{folder}-deps.json` | - | 提取文件夹依赖子图 |
| `src/lib/git-diff.ts` | `--since` | `incremental-analysis.json` | `simple-git` | 获取变更文件，计算受影响范围 |
| `src/lib/compute-hashes.ts` | `--path` | `file-hashes.json` | `fs-extra`, `crypto` | 计算文件哈希，用于增量检测 |
| `src/lib/validate-references.ts` | `--wiki-path` | 验证结果 JSON | `remark`, `unist-util-visit` | 验证 Wiki 中的链接和引用 |

### 4.3 脚本调用规范

所有脚本遵循统一规范：

```bash
# 统一参数格式（通过 tsx 执行 TypeScript 源文件）
npx tsx src/lib/<name>.ts --path <路径> --output <输出路径> [--format <格式>]

# 返回值
# 0 = 成功
# 1 = 参数错误
# 2 = 运行时错误

# 输出
# stdout: 简短结果摘要（Agent 可读取）
# stderr: 错误信息
# 文件: 结构化 JSON 产物
```

---

## 五、数据产物规范

### 5.1 project-scan.json

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

### 5.2 folder-strategy.json

```json
{
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
      "path": "src/utils/",
      "fileCount": 15,
      "logicFileCount": 15,
      "styleFileCount": 0,
      "shouldSplit": false,
      "reason": "规模适中，无需拆分",
      "priority": "medium"
    }
  ],
  "filteredFiles": [
    {
      "path": "src/styles/global.css",
      "reason": "纯样式文件",
      "filterType": "pure_style"
    }
  ]
}
```

### 5.3 dependency-graph.json

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
  },
  "mermaidGraph": "graph TD\n  App[App.tsx] --> Button[Button.tsx]\n  ..."
}
```

### 5.4 incremental-analysis.json

```json
{
  "since": "HEAD~1",
  "sinceCommit": "abc1234",
  "currentCommit": "def5678",
  "changedFiles": [
    { "path": "src/App.tsx", "status": "modified" },
    { "path": "src/utils/helper.ts", "status": "modified" }
  ],
  "affectedFiles": [
    { "path": "src/App.tsx", "reason": "直接变更" },
    { "path": "src/pages/Home.tsx", "reason": "依赖 App.tsx" },
    { "path": "src/components/Header.tsx", "reason": "依赖 App.tsx" }
  ],
  "affectedFolders": [
    { "path": "src/", "reason": "包含直接变更" },
    { "path": "src/pages/", "reason": "包含受影响文件" },
    { "path": "src/components/", "reason": "包含受影响文件" }
  ],
  "unaffectedFolders": [
    { "path": "src/hooks/", "reason": "无变更传播" }
  ]
}
```

### 5.5 validation-report.json

```json
{
  "validatedAt": "2026-05-29T11:00:00Z",
  "totalPages": 15,
  "issues": [
    {
      "id": "V-001",
      "type": "broken_link",
      "severity": "warning",
      "file": "wiki/src-components.md",
      "location": "## 相关页面 章节",
      "message": "链接 [[src/pages/NotFound]] 指向不存在的 Wiki 页面",
      "suggestion": "创建 src/pages/NotFound 页面或移除该链接"
    },
    {
      "id": "V-002",
      "type": "outdated_content",
      "severity": "error",
      "file": "wiki/src-utils.md",
      "location": "## 函数列表 章节",
      "message": "函数 formatDate 已被移除，但 Wiki 仍在引用",
      "suggestion": "从 Wiki 中移除该函数的描述"
    }
  ],
  "summary": {
    "errors": 1,
    "warnings": 1,
    "passed": 13
  }
}
```

### 5.6 Wiki 输出规范

### 6.1 目录结构

```
wiki/
├── book.md                        # 全书总索引
├── glossary.md                    # 术语表
├── issues.md                      # Issue 仪表盘
├── volume-1-code/                 # 卷 I：代码 Wiki
│   ├── _toc.md                   # 卷目录
│   └── ch-{nn}-{name}/
│       └── sec-{name}.md         # 章节 Wiki
├── volume-2-issues/               # 卷 II：Issue Wiki
│   ├── _toc.md                   # Issue 总目录
│   └── ch-{nn}-{category}/
│       └── IS-{id}.md            # 单个 Issue 文档
└── appendix/                      # 附录
```

### 6.2 页面模板

每个 Wiki 页面包含 YAML frontmatter + 正文：

```markdown
---
tags: [react, components, ui]
lastUpdated: 2026-05-29
sourceFiles: [Button.tsx, Input.tsx]
---

# src/components/

## 概述

通用 UI 组件库，包含 Button、Input、Modal 三个组件。

## 组件列表

### Button

**类型**: 函数组件
**Props**:
| 名称 | 类型 | 必填 | 默认值 |
|------|------|------|--------|
| label | string | 是 | - |
| onClick | () => void | 是 | - |
| variant | 'primary' \| 'secondary' | 否 | 'primary' |

**用途**: 通用按钮组件，支持两种样式变体。

## 依赖关系

\`\`\`mermaid
graph TD
  Button --> React
  Input --> React
\`\`\`

## 数据流

- **入**: 从父组件接收 props
- **出**: 通过 onClick 向父组件传递事件
- **内**: 组件内部 useState 管理状态

## 相关页面

- [[src/pages/Home]] — 使用了 Button 和 Input
- [[src/pages/Dashboard]] — 使用了 Button

## 已知问题

- 无
```

### 6.3 book.md 规范

```markdown
# {项目名} Wiki

## 项目信息
- **框架**: React + TypeScript
- **构建工具**: Vite
- **源码路径**: src/

## 卷目录

| 卷 | 说明 | 章节数 |
|----|------|--------|
| [[volume-1-code/_toc]] | 代码 Wiki | 8 |
| [[volume-2-issues/_toc]] | Issue Wiki | 6 |

## 依赖图

\`\`\`mermaid
graph TD
  App[App.tsx] --> Button[Button.tsx]
  App --> Input[Input.tsx]
\`\`\`

## 术语表

见 [[glossary]]
```

### 6.4 log.md 规范

```markdown
# 变更日志

## [2026-05-29] full | 初始化分析
- 初始化项目扫描
- 识别技术栈: React + TypeScript
- 扫描 128 个源码文件
- 构建依赖图，检测到 0 个循环依赖
- 生成 12 个 Wiki 页面
- 验证通过

## [2026-05-30] incremental | 增量更新
- 变更文件: src/App.tsx, src/utils/helper.ts
- 受影响文件夹: src/, src/pages/, src/components/
- 更新 3 个 Wiki 页面
- 验证通过
```

---

## 七、增量分析设计

### 7.1 增量检测方式

| 方式 | 触发条件 | 实现 |
|------|---------|------|
| Git diff | 用户指定 `--since` | `simple-git` 获取变更文件 |
| 文件哈希 | 自动检测 | 对比 `file-hashes.json` 与当前哈希 |
| 文件监听 | watch 模式 | `chokidar` 监听变更（未来） |

### 7.2 依赖传播算法

```
输入: changedFiles[], dependencyGraph
输出: affectedFiles[]

算法:
1. affectedSet = Set(changedFiles)
2. for each file in changedFiles:
3.   dependents = dependencyGraph.getDependents(file)  // 谁依赖了这个文件
4.   for each dependent in dependents:
5.     if dependent not in affectedSet:
6.       affectedSet.add(dependent)
7.       changedFiles.push(dependent)  // 递归传播
8. return affectedSet
```

### 7.3 增量更新策略

| 场景 | 策略 |
|------|------|
| 文件新增 | 分析新文件所在文件夹，生成新 Wiki 或追加到已有 Wiki |
| 文件修改 | 重新分析所在文件夹，增量更新对应 Wiki 章节 |
| 文件删除 | 重新分析所在文件夹，从 Wiki 中移除相关内容 |
| 依赖变更 | 传播计算受影响范围，对受影响文件夹重新分析 |

---

## 八、Issue 管理设计

### 8.1 Issue 类型

| 类型 | 说明 | 检测阶段 |
|------|------|---------|
| `circular_dependency` | 循环依赖 | DEPENDENCY（脚本自动检测）|
| `dead_code` | 未使用的导出 | GEN（SubAgent 分析时）|
| `missing_types` | 缺少类型定义 | GEN（SubAgent 分析时）|
| `complex_logic` | 过于复杂的逻辑 | GEN（SubAgent 分析时）|
| `inconsistent_api` | API 使用不一致 | GEN（SubAgent 分析时）|
| `potential_bug` | 潜在 bug | GEN（SubAgent 分析时）|

### 8.2 Issue 生命周期

```
detected → verified → fixing → fixed → archived
   │          │                    │
   │          └─ 验证为误报 → closed (false_positive)
   └─ 未验证 → stale
```

### 8.3 Issue 索引

```json
// issues/index.json
{
  "lastUpdated": "2026-05-29T10:00:00Z",
  "issues": [
    {
      "id": "ISSUE-001",
      "type": "circular_dependency",
      "severity": "high",
      "status": "detected",
      "summary": "循环依赖: A → B → A",
      "files": ["src/A.ts", "src/B.ts"]
    }
  ],
  "stats": {
    "total": 3,
    "bySeverity": { "high": 1, "medium": 1, "low": 1 },
    "byStatus": { "detected": 2, "verified": 1 }
  }
}
```

---

## 九、反馈循环设计

### 9.1 feedback/prompts.md 结构

```markdown
# 反馈积累与策略改进

## 2026-05-29: 循环依赖检测改进

**触发**: VALIDATE 阶段发现 Wiki 中的依赖关系与实际不一致
**根因**: aw-dependency 未检测间接循环依赖
**改进**: 在构建依赖图时增加传递性分析，深度 ≥ 3
**影响技能**: aw-dependency

---

## 2026-05-28: 样式文件过滤优化

**触发**: VALIDATE 阶段发现 Wiki 包含了纯样式文件的描述
**根因**: aw-scan 未识别 styled-components 定义的样式
**改进**: 在过滤逻辑中增加 styled-components 识别规则
**影响技能**: aw-scan
```

### 9.2 反馈加载机制

`aw-orchestrator` 启动时：
1. 读取 `.agentic-wiki/feedback/prompts.md`
2. 解析为结构化的改进策略列表
3. 在调度对应 Skill 的 SubAgent 时，将相关策略注入到 prompt 中

### 9.3 反向回退规则

| VALIDATE 发现的问题 | 回退阶段 | 说明 |
|---------------------|---------|------|
| Wiki 内容与代码不一致 | GEN | 重新生成该 Wiki |
| 生成逻辑错误 | GEN | 重新分析该文件夹并生成 Wiki |
| 依赖图错误 | DEPENDENCY | 重新构建依赖图 |
| 文件遗漏 | SCAN | 重新扫描 |

---

## 十、第三方库选型

| 功能 | 库 | 版本 | 核心理由 |
|------|-----|------|---------|
| AST 解析 | `@babel/parser` + `@babel/traverse` | ^7.24 | 最成熟，支持 JSX/TSX |
| 依赖图构建 | `dependency-cruiser` | ^16.0 | 原生 Mermaid 输出 + 循环检测 |
| 多格式依赖提取 | `precinct` | ^12.0 | 支持 Vue/CSS/Less 等 |
| Git 操作 | `simple-git` | ^3.24 | 链式 API，内置 diff 解析 |
| 文件扫描 | `globby` | ^14.0 | 自动 gitignore，性能最佳 |
| 文件系统 | `fs-extra` | ^11.2 | outputFile 自动创建目录 |
| Markdown 处理 | `remark` | ^15.0 | 工业标准，插件生态丰富 |
| Markdown AST 遍历 | `unist-util-visit` | ^5.0 | 精确查找和修改节点 |
| Frontmatter | `gray-matter` | ^4.0 | 解析和序列化 YAML |
| 脚本参数 | `yargs` | ^17.7 | 成熟的命令行参数解析 |
