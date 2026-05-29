# aw-generate — 合并分析+Wiki生成（GEN 阶段）

> v2: ANALYZE + GENERATE 合并为单一阶段，SubAgent 直接读取源码生成 Wiki，无中间 JSON 产物。

## 触发条件

- `aw-dependency` 完成后
- 用户说"生成 Wiki"、"分析代码"
- `aw-orchestrator` 调度 GEN 阶段

---

## 核心变更（v1 → v2）

| v1 | v2 |
|----|----|
| ANALYZE：SubAgent 读代码 → 写 `analysis/{folder}.json` | 合并 |
| GENERATE：SubAgent 读 JSON → 写 `wiki/*.md` | 合并 |
| **v2 GEN**：SubAgent 读优先级清单 + 代码 → 直接写 `wiki/*.md` + Issue `.md` | ✅ 无中间产物 |

---

## 你的任务

1. 读取 `folder-strategy.json` 获取子任务清单
2. 读取 `file-priorities.json` 获取文件优先级标注
3. 读取 `{folder}-deps.json` 获取依赖子图
4. 为每个子任务并发启动 SubAgent
5. SubAgent 按优先级读取源码文件，直接生成 Wiki 章节
6. 发现代码问题时创建 Issue Markdown 文件

---

## 执行步骤

### Step 1: 读取调度清单

使用 `read_file` 工具读取：

```
.agentic-wiki/cache/folder-strategy.json
```

获取 `folders[].subTasks[]` 和 `crossFolderMerges[]`。

### Step 2: 合并子任务

对于 `crossFolderMerges[]` 中的条目：
- 将多个文件夹的指定文件合并为一个子任务
- 示例：`src/components/` 的 hooks + `src/hooks/` 的全部 → 一个 "全局 Hooks" 子任务

对于 `subTasks[].mergeWith` 指向的条目：
- 跳过这些子任务（已在跨文件夹合并中处理）

### Step 3: 启动 SubAgent 并发

使用 `spawn_agent` 工具启动 SubAgent。

**SubAgent Prompt 模板**：

```
你是 AgenticWiki GEN SubAgent。

## 上下文

项目根目录：{projectRoot}
  所有文件路径相对于此目录解析。
  读取文件时使用绝对路径：{projectRoot}/{relativePath}

文件优先级清单：.agentic-wiki/cache/file-priorities.json
  完整路径：{projectRoot}/.agentic-wiki/cache/file-priorities.json

依赖子图：.agentic-wiki/cache/deps/{folder}-deps.json
  完整路径：{projectRoot}/.agentic-wiki/cache/deps/{folder}-deps.json

Wiki 输出：wiki/volume-1-code/{wikiChapter}
  完整路径：{projectRoot}/wiki/volume-1-code/{wikiChapter}

Token 预算：{budget} tokens

## 你的任务

为文件夹 "{folderPath}" 生成 Wiki 章节。**不要创建任何 JSON 文件。**

### 步骤 0：解析路径

所有路径相对于项目根目录 `{projectRoot}`。读取/写入时始终拼接为绝对路径。

### 步骤 1：按优先级读取文件

1. 读取 file-priorities.json（使用上述完整路径），找到文件夹 "{folderPath}" 的条目
2. 读取所有 P0 文件（入口文件、桶文件）— **始终读取**
3. 在 token 预算允许的条件下读取 P1 文件（核心逻辑：组件、Hooks、状态管理）
4. 仅在 P0/P1 的 import 语句引用时读取 P2 文件（工具函数、类型定义）— **按需读取**
5. 跳过 P3 和 P4 文件（测试、样式）
6. 记录你实际读取了哪些文件

### 步骤 2：生成 Wiki 章节

使用 write_file 将输出写入完整路径：{projectRoot}/wiki/volume-1-code/{wikiChapter}

**必需章节**：
- YAML frontmatter（tags、lastUpdated、sourceFiles — 仅包含实际读取的文件）
- ## 概述（1-2 段，描述文件夹用途和包含内容）
- ## 组件/函数列表（表格：名称 | 类型 | 用途）
- ## 每个组件的详细说明（签名、Props、状态管理、依赖）
- ## 依赖关系（来自子图 JSON 的 Mermaid 图，≤ 20 个节点）
- ## 数据流（入：数据来源 | 出：数据去向 | 内：内部流转）
- ## 相关章节（Obsidian wiki 链接格式：[[../../volume-1-code/ch-nn/sec-name]]）
- ## 已知问题（交叉引用 ISSUE Wiki：[[../../volume-2-issues/ch-nn/IS-id]]）

### 步骤 3：发现问题时创建 Issue

如果遇到以下情况，创建独立的 Issue `.md` 文件：

- **循环依赖**：子图中标记为 `circular: true` 的依赖
- **死代码**：导出的符号但无任何文件导入
- **缺失类型**：Props 使用 `any` 类型
- **复杂逻辑**：函数 > 200 行或嵌套 > 4 层

Issue 输出位置：{projectRoot}/wiki/volume-2-issues/{chapter}/IS-{id}.md

Issue 格式：

```markdown
---
id: IS-{YYYY}-{NNN}
type: circular_dependency | dead_code | missing_types | complex_logic
severity: high | medium | low
confidence: high | medium | low
status: detected
detected_at: <ISO时间戳>
detected_by: aw-generate
source_files:
  - src/xxx.ts
related_wiki:
  - "[[../../volume-1-code/ch-nn/sec-name]]"
history:
  - at: <ISO时间戳>
    event: detected
    by: aw-generate
    note: "<描述>"
---

# IS-{id}：{标题}

## 概述
<1-2 句话描述问题>

## 依赖链 / 影响范围
<具体分析>

## 建议方案
1. <方案 1>
2. <方案 2>

## 相关 Wiki
- [[../../volume-1-code/ch-nn/sec-name]]

## 状态时间线
| 时间 | 事件 | 操作者 | 备注 |
|------|------|--------|------|
| <时间> | 🔍 发现 | aw-generate | <描述> |
```

### 步骤 4：输出摘要

简短报告：
- 读取了哪些文件（按优先级分组）
- 发现了哪些 Issue（Issue 文件路径）
- 预估 token 使用量 vs. 预算

## 重要注意事项

- **不要写入任何 JSON 文件**
- **不要生成中间分析产物**
- Obsidian 链接格式：`[[../../volume-1-code/ch-nn/sec-name]]`
- Mermaid 图 ≤ 20 个节点
- 表格对齐，格式良好
- 仅列出实际读取的文件到 frontmatter 的 sourceFiles
```

### Step 4: 等待完成

收集所有 SubAgent 的摘要报告。

### Step 5: 更新状态

使用 `edit_file` 工具更新 `state.json`：

```json
{
  "phaseHistory": [
    {
      "phase": "GEN",
      "status": "completed",
      "startedAt": "<时间戳>",
      "completedAt": "<时间戳>",
      "output": "wiki/volume-1-code/",
      "subTasks": [
        { "id": "src-components-ui", "status": "completed", "output": "wiki/volume-1-code/ch-02-core/sec-components.md" }
      ]
    }
  ],
  "currentPhase": "ASSEMBLE",
  "genTasks": [
    { "id": "src-components-ui", "status": "completed", "output": "...", "actualTokens": 32000, "issuesFound": ["IS-2026-001"] }
  ]
}
```

---

## 子任务拆分决策

| 条件 | 操作 |
|------|------|
| 文件夹 `totalTokens` > 50K | 按角色分组拆分为多个子任务 |
| 文件夹 `totalTokens` ≤ 30K | 不拆分 |
| 子任务 `estimatedTokens` < 5K | 与相邻子任务合并 |
| `crossFolderMerges` 中有条目 | 跨文件夹合并为一个子任务 |

---

## 输出产物

| 文件 | 说明 |
|------|------|
| `wiki/volume-1-code/**/*.md` | 代码 Wiki 章节 |
| `wiki/volume-2-issues/**/*.md` | Issue Markdown 文件（如有） |

---

## 下一步

GEN 阶段完成后，调用 ASSEMBLE 阶段：
- 运行 `symbol-index.ts` 构建符号索引
- 运行 `issue-dashboard.ts` 生成仪表盘
- 生成 `book.md`、`_toc.md`、`glossary.md`
