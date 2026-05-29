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
3. 🔴 确认 `{folder}-deps.json` 子图已存在（如果没有，阻断并回退到 DEPENDENCY）
4. 为每个子任务并发启动 SubAgent
5. SubAgent 按优先级读取源码文件，直接生成 Wiki 章节
6. 🔴 发现代码问题时，按 `docs/design/issue-detection-guide.md` 标准评估并创建 Issue

---

## 🔴 Issue 类型约束

> ⚠️ GEN SubAgent 创建的 Issue **只能**使用以下预定义类型。**禁止** SubAgent 发明不在白名单中的新类型。

### 检测标准

**SubAgent 启动前，使用 `read_file` 读取检测标准指南**：

```
docs/design/issue-detection-guide.md
```

该指南基于 `pi-code-reviewer` 的 7 维度审查体系，包含：
- 6 种 IssueType 的详细检测标准（含严重等级决策）
- 10 种高频问题模式速查
- 严重等级决策矩阵（影响范围 × 运行时影响）
- 统一 Issue 输出模板

### 合法 IssueType 白名单

| 类型 | pi-code-reviewer 维度 | 关键检测项 |
|------|----------------------|-----------|
| `circular_dependency` | 架构级（脚本自动检测） | 子图中 `circular: true` |
| `dead_code` | 代码质量 | 导出无引用、重复造轮子 |
| `missing_types` | 类型安全 | any 滥用、缺类型守卫、API 无类型 |
| `complex_logic` | 规范 + 质量 | 组件>200行、嵌套>4层、Hooks依赖缺失 |
| `inconsistent_api` | 代码质量 | 签名不一致、Props 重复 |
| `potential_bug` | 性能+边界+副作用 | 内存泄漏、错误被吞、竞态、缺兜底 |

### Issue 章节分类规则

Issue **不按源文件夹分类**，而按 `type` 分类到固定章节：

| Issue Type | Wiki 输出路径 |
|------------|--------------|
| `circular_dependency` | `wiki/volume-2-issues/ch-01-circular-deps/IS-{id}.md` |
| `dead_code` | `wiki/volume-2-issues/ch-02-dead-code/IS-{id}.md` |
| `missing_types` | `wiki/volume-2-issues/ch-03-missing-types/IS-{id}.md` |
| `complex_logic` | `wiki/volume-2-issues/ch-04-complex-logic/IS-{id}.md` |
| `inconsistent_api` | `wiki/volume-2-issues/ch-05-inconsistent-api/IS-{id}.md` |
| `potential_bug` | `wiki/volume-2-issues/ch-06-potential-bugs/IS-{id}.md` |
| 其他（无法归类） | `wiki/volume-2-issues/ch-99-archived/IS-{id}.md` |

### 编排器校验规则

ASSEMBLE 阶段必须对每个 Issue 进行校验：

1. `type` 字段是否在白名单中 → 不在则拒绝并记录到 `blockers`
2. 文件路径是否符合分类规则 → 不符合则移动到正确章节
3. 严重等级是否符合决策矩阵 → 不合理则降级/升级

---

## 执行步骤

### Step 1: 读取调度清单

使用 `read_file` 工具读取：

```
.agentic-wiki/cache/folder-strategy.json
```

获取 `folders[].subTasks[]` 和 `crossFolderMerges[]`。

### Step 2: 🔴 确认子图存在

对每个待处理文件夹，检查对应的子图文件：

```
.agentic-wiki/cache/deps/{folder}-deps.json
```

**如果子图不存在**：
- 记录到 `state.json.blockers`
- **不要继续** — 回退到 DEPENDENCY 阶段
- 子图是 GEN SubAgent 生成准确依赖关系的必需数据

### Step 3: 合并子任务

对于 `crossFolderMerges[]` 中的条目：
- 将多个文件夹的指定文件合并为一个子任务
- 示例：`src/components/` 的 hooks + `src/hooks/` 的全部 → 一个 "全局 Hooks" 子任务

对于 `subTasks[].mergeWith` 指向的条目：
- 跳过这些子任务（已在跨文件夹合并中处理）

### Step 4: 启动 SubAgent 并发

使用 `spawn_agent` 工具启动 SubAgent。

**SubAgent Prompt 模板**：

```
你是 AgenticWiki GEN SubAgent。

## 🔴 Issue 检测标准（最高优先级）

你必须按 `docs/design/issue-detection-guide.md` 的标准评估代码问题。
该指南基于 pi-code-reviewer 的 7 维度审查体系，在启动前已由编排器读取。

**白名单速查**（完整检测规则 + 严重等级见指南）：

| 类型 | 维度 | 关键检测项 | 严重等级示例 |
|------|------|-----------|------------|
| circular_dependency | 架构 | 由脚本自动检测，子图 circular: true | ≥3 模块=high, 2 模块=medium |
| dead_code | 代码质量 | 导出无引用=high, 重复造轮子=medium | 0 引用=high |
| missing_types | 类型安全 | any≥3处=high, 缺类型守卫=medium, API无类型=high | 核心接口=high |
| complex_logic | 规范+质量 | 组件>200行=high, 嵌套>4层=medium, Hooks缺依赖=high | 单文件超阈值=high |
| inconsistent_api | 代码质量 | 签名不一致=high, Props重复=medium, 命名风格=low | 同类组件不同=high |
| potential_bug | 性能+边界+副作用 | 内存泄漏=high, 错误被吞=high, 竞态=high, 缺兜底=high, 生产日志=medium | 运行时崩溃风险=high |

**Issue 文件路径**（按类型，而非源文件夹）：
- circular_dependency → wiki/volume-2-issues/ch-01-circular-deps/IS-{YYYY}-{NNN}.md
- dead_code → wiki/volume-2-issues/ch-02-dead-code/IS-{YYYY}-{NNN}.md
- missing_types → wiki/volume-2-issues/ch-03-missing-types/IS-{YYYY}-{NNN}.md
- complex_logic → wiki/volume-2-issues/ch-04-complex-logic/IS-{YYYY}-{NNN}.md
- inconsistent_api → wiki/volume-2-issues/ch-05-inconsistent-api/IS-{YYYY}-{NNN}.md
- potential_bug → wiki/volume-2-issues/ch-06-potential-bugs/IS-{YYYY}-{NNN}.md

**Issue 输出格式**：

```markdown
---
id: IS-{YYYY}-{NNN}
type: {类型}
severity: {high|medium|low}
confidence: {high|medium|low}
status: detected
detected_at: <ISO时间戳>
detected_by: aw-generate
source_files:
  - {相对路径}
related_wiki:
  - "[[../../volume-1-code/{chapter}/index]]"
history:
  - at: <ISO时间戳>
    event: detected
    by: aw-generate
    note: "<模式>: <概述>"
---

# IS-{id}：{简短标题}

## 检测依据

> 维度：{pi-code-reviewer 维度}
> 模式：{高频模式名称}
> 检测项：{具体检测项}

**位置**：`{file}:{line}` — `{函数名/组件名}`

## 问题描述

{2-3 句话}

## 影响范围

| 指标 | 值 |
|------|-----|
| 影响文件数 | {N} |
| 下游依赖数 | {N} |
| 风险 | {运行时崩溃 / 用户体验 / 维护性} |

## 建议方案

1. **{方案 1}**：{一句话 + 代码示例}
2. **{方案 2}**：{备选}

## 相关 Wiki

- [[../../volume-1-code/{chapter}/index]]

## 状态时间线

| 时间 | 事件 | 操作者 | 备注 |
|------|------|--------|------|
| <时间> | 🔍 发现 | aw-generate | {模式}: {概述} |
```

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

按 `docs/design/issue-detection-guide.md` 标准评估。使用上述统一模板格式。

### 步骤 4：输出摘要

简短报告：
- 读取了哪些文件（按优先级分组）
- 发现了哪些 Issue（路径 + 类型 + 严重等级 + 检测模式）
- 预估 token 使用量 vs. 预算

## 重要注意事项

- **不要写入任何 JSON 文件**
- **不要生成中间分析产物**
- **Issue 必须包含检测依据章节**（维度 + 模式 + 检测项）
- **严重等级按决策矩阵判断**（影响范围 × 运行时影响）
- Obsidian 链接格式：`[[../../volume-1-code/ch-nn/sec-name]]`
- Mermaid 图 ≤ 20 个节点
- 表格对齐，格式良好
- 仅列出实际读取的文件到 frontmatter 的 sourceFiles
```

### Step 5: 等待完成

收集所有 SubAgent 的摘要报告。

### Step 6: 🔴 Issue 类型校验

所有 SubAgent 完成后，对每个生成的 Issue 文件：

1. 用 `read_file` 读取 Issue 的 YAML frontmatter
2. 检查 `type` 字段是否在白名单中
3. 检查文件路径是否符合分类规则
4. 检查 `severity` 是否符合决策矩阵（影响范围 × 运行时影响）

**如果检测到非法类型**：
- 记录到 `state.json.blockers`
- 将 Issue 移动到 `ch-99-archived/` 并标记为待审核
- 展示警告给用户

### Step 7: 更新状态

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
      ],
      "artifacts": [
        "wiki/volume-1-code/ch-01-dialog/index.md",
        "wiki/volume-2-issues/ch-06-potential-bugs/IS-2026-001.md"
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
| `wiki/volume-2-issues/ch-{NN}-{category}/*.md` | Issue Markdown 文件（按类型分类 + 含检测依据） |

---

## 下一步

GEN 阶段完成后，调用 ASSEMBLE 阶段：
- 运行 `symbol-index.ts` 构建符号索引
- 运行 `issue-dashboard.ts` 生成 Issue 一览（输出到 `wiki/issues.md`）
- 运行 `validate-issue-types.ts` 校验 Issue 白名单合规
- 生成 `book.md`、`_toc.md`、`glossary.md`
