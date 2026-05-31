# aw-generate — 合并分析+Wiki生成（GEN 阶段）

> SubAgent 直接读取源码生成 Wiki，无中间 JSON 产物。分析与 Wiki 生成在单次 SubAgent 调用中完成。

## 触发条件

- `aw-dependency` 完成后
- 用户说"生成 Wiki"、"分析代码"
- `aw-orchestrator` 调度 GEN 阶段

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
>
> **有意排除**：视觉美学维度（CSS/styled-components 一致性问题）不在当前版本 Issue 检测范围内，
> 因为这类问题难以通过代码分析自动检测，需要视觉回归测试工具。计划在 v3 中结合截图对比引入。

### 内联检测标准（已完整内联，不依赖外部文件）

以下标准基于 `pi-code-reviewer` 的 7 维度审查体系，已完整嵌入此 Prompt。

#### 1. missing_types（类型缺失）— 维度：类型安全

| 检测项 | 等级 | 规则 |
|--------|:---:|------|
| Props/返回值使用 `any` | 🔴 high | ≥ 3 处或核心接口 |
| Props/返回值使用 `any` | 🟡 medium | 1-2 处或非核心工具函数 |
| 缺少类型守卫 | 🟡 medium | unknown 直接 as 转换 |
| API 响应无类型 | 🔴 high | fetch/axios 返回值标注为 any |

#### 2. complex_logic（复杂逻辑）— 维度：React/Vue 规范 + 代码质量

| 检测项 | 等级 | 规则 |
|--------|:---:|------|
| 组件 > 200 行 | 🔴 high | 单一文件超阈值 |
| 函数 > 100 行 | 🟡 medium | 单个函数超阈值 |
| 嵌套 > 4 层 | 🟡 medium | if/for/回调 嵌套深度 |
| Hooks 依赖缺失 | 🔴 high | useEffect/useMemo 缺少依赖项 |
| 组件职责混杂 | 🟡 medium | UI + 数据获取 + 状态管理同文件 |

#### 3. dead_code（死代码）— 维度：代码质量

| 检测项 | 等级 | 规则 |
|--------|:---:|------|
| 导出但无引用 | 🔴 high | 0 文件 import，查子图 dependents |
| 重复造轮子 | 🟡 medium | 功能与已有 utils/helpers 重叠 |

#### 4. inconsistent_api（API 不一致）— 维度：代码质量

| 检测项 | 等级 | 规则 |
|--------|:---:|------|
| 同类组件签名不一致 | 🔴 high | Button 用 onClick 而 Input 用 handleClick |
| Props 功能重复 | 🟡 medium | content 和 default 同时存在 |
| 参数/返回值顺序不一致 | 🟡 medium | 同类函数参数顺序不同 |

#### 5. potential_bug（潜在 Bug）— 维度：性能+边界+副作用

| 检测项 | 等级 | 来源 |
|--------|:---:|------|
| 内存泄漏 | 🔴 high | useEffect 无清理、订阅/定时器未取消 |
| 错误被吞 | 🔴 high | catch {} 空块 |
| 竞态条件 | 🔴 high | 异步操作无 AbortController |
| 缺少兜底 | 🔴 high | 无 loading/empty/error 状态 |
| 生产环境 console | 🟡 medium | console.warn/error 未在 prod 移除 |

#### 6. circular_dependency（循环依赖）— 维度：架构（脚本自动）

| 检测项 | 等级 | 规则 |
|--------|:---:|------|
| ≥ 3 模块循环 | 🔴 high | A→B→C→A |
| 2 模块循环 | 🟡 medium | A→B→A |

> 从子图 `modules[].dependencies[]` 检查 `circular: true`

### 严重等级决策矩阵

| 影响范围 | 无运行时影响 | 影响边缘场景 | 影响核心功能 |
|---------|:---:|:---:|:---:|
| 单文件 | 🟢 low | 🟡 medium | 🔴 high |
| 多文件 2-5 | 🟡 medium | 🟡 medium | 🔴 high |
| 全局/核心 | 🟡 medium | 🔴 high | 🔴 high |

**快速决策**：运行时崩溃 → 🔴 high；用户体验 → 🟡 medium；纯风格 → 🟢 low

### 高频问题模式速查（优先检查）

| 模式 | → 类型 | 等级 | 检测方法 |
|------|--------|:---:|------|
| 内存泄漏 | potential_bug | 🔴 | useEffect 无清理 |
| 错误被吞 | potential_bug | 🔴 | catch {} 空块 |
| 竞态条件 | potential_bug | 🔴 | 异步无取消机制 |
| any 滥用 | missing_types | 🔴 | ≥ 3 处 any |
| 缺兜底 | potential_bug | 🔴 | 无 loading/empty/error |
| 组件过大 | complex_logic | 🟡 | > 200 行 |
| 重复造轮子 | dead_code / inconsistent_api | 🟡 | 功能重叠 |
| 深度嵌套 | complex_logic | 🟡 | > 4 层 |
| 签名不一致 | inconsistent_api | 🟡 | 同类函数参数不同 |
| 生产日志 | potential_bug | 🟡 | console.warn/error |

### 合法 IssueType 白名单（超集检查）

| 类型 | 维度 | 关键检测项 |
|------|------|-----------|
| `circular_dependency` | 架构脚本自动 | 子图 `circular: true` |
| `dead_code` | 代码质量 | 导出无引用、重复造轮子 |
| `missing_types` | 类型安全 | any 滥用、缺类型守卫、API 无类型 |
| `complex_logic` | 规范+质量 | 组件>200行、嵌套>4层、Hooks 缺依赖 |
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

### Step 0: 🔴 初始化 genTasks（编排器执行，必须）

> ⛔ **此步骤由编排器（`aw-orchestrator`）在启动 SubAgent 前执行，SubAgent 无需关心。**

**在启动任何 SubAgent 之前**，必须先确保 `state.json.genTasks` 已初始化，否则进度面板将始终显示 0%。

**方式一：运行 gen-scheduler 并写入 state**

```bash
npx tsx src/lib/gen-scheduler.ts \
  --strategy .agentic-wiki/cache/folder-strategy.json \
  --state    .agentic-wiki/state.json \
  --output   .agentic-wiki/cache/gen-schedule.json \
  --write-state   # 🔴 关键：写入 genTasks 到 state.json
```

**方式二：sync-gen-tasks 从 gen-schedule.json 初始化**

如果 `gen-schedule.json` 已存在但 `state.json.genTasks` 为空：

```bash
npx tsx src/lib/sync-gen-tasks.ts \
  --state .agentic-wiki/state.json \
  --wiki  wiki/ \
  --init-from-schedule .agentic-wiki/cache/gen-schedule.json \
  --write
```

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

## 🔴 Issue 检测标准（最高优先级 — 已内联）

> 完整的 6 种 IssueType 检测规则、严重等级决策矩阵、高频问题模式速查
> 均已在本 Skill 的 "🔴 Issue 类型约束" 章节中内联。**禁止读取任何外部文件**。

**速查（详见本章 Skill 顶部 "内联检测标准" 章节）**：

| 类型 | 维度 | 关键检测项 | 严重等级 |
|------|------|-----------|:---:|
| circular_dependency | 架构 | 子图 circular: true | ≥3模块=high |
| dead_code | 代码质量 | 导出0引用=high, 重复造轮子=medium | 0引用=high |
| missing_types | 类型安全 | any≥3处=high, 缺类型守卫/API无类型 | 核心接口=high |
| complex_logic | 规范+质量 | 组件>200行=high, 嵌套>4层=medium, Hook缺依赖 | 单文件超阈值=high |
| inconsistent_api | 代码质量 | 签名不一致=high, Props重复=medium | 同类组件不同=high |
| potential_bug | 性能+边界+副作用 | 内存泄漏/错误被吞/竞态/缺兜底=high | 运行时崩溃=high |

### 🔴 Issue ID 编号规则（不可违反）

- 格式：`IS-{YYYY}-{NNN}`，其中 YYYY 为当前年份，NNN 为 3 位递增序号
- 同一批次（同一次 GEN 运行）中，ID 必须从 `IS-{YYYY}-001` 开始递增
- 不同 Issue **绝对不能共享同一个 ID**
- 编号按 Issue 生成顺序递增，不按类型分组

**Issue 文件路径**（按类型，而非源文件夹）—— 🔴 禁止写入 volume-2-issues/ 根目录：
- circular_dependency → `wiki/volume-2-issues/ch-01-circular-deps/IS-{YYYY}-{NNN}.md`
- dead_code → `wiki/volume-2-issues/ch-02-dead-code/IS-{YYYY}-{NNN}.md`
- missing_types → `wiki/volume-2-issues/ch-03-missing-types/IS-{YYYY}-{NNN}.md`
- complex_logic → `wiki/volume-2-issues/ch-04-complex-logic/IS-{YYYY}-{NNN}.md`
- inconsistent_api → `wiki/volume-2-issues/ch-05-inconsistent-api/IS-{YYYY}-{NNN}.md`
- potential_bug → `wiki/volume-2-issues/ch-06-potential-bugs/IS-{YYYY}-{NNN}.md`

> 🚫 **绝对禁止**：不要把 Issue 文件写入以下位置：
>
> 1. ❌ `wiki/volume-2-issues/IS-xxx.md`（根目录，未分类）
> 2. ❌ `wiki/volume-1-code/ch-*/issues/IS-xxx.md`（Volume 1 模块目录 — Issue 的唯一归宿是 Volume 2）
>
> ✅ **唯一合法路径**：`wiki/volume-2-issues/ch-{NN}-{type}/IS-{YYYY}-{NNN}.md`
>
> 写入前用 `list_directory` 确认目标子目录存在，不存在则用 `create_directory` 创建。

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
- ## 已知问题（🔴 必须收集该文件夹已有的 Issue，不可为空）

### 步骤 2.5：🔴 收集已有 Issue（不可跳过）

在生成 Wiki 之前，使用 `find_path` 扫描 `wiki/volume-2-issues/` 目录，查找 `source_files` 中包含当前文件夹路径的 Issue 文件。

1. 使用 `find_path` 搜索 `wiki/volume-2-issues/ch-*/IS-*.md`
2. 对找到的每个 Issue，用 `read_file` 读取 frontmatter 中的 `source_files` 字段
3. 如果 Issue 的 `source_files` 包含当前文件夹下的文件，则该 Issue 与该文件夹相关
4. 在 Wiki 的 `## 已知问题` 章节中列出**所有**相关 Issue：
   - 如果找到相关 Issue：按严重等级排序（high → medium → low），每个 Issue 一行链接 + 一句话概述
   - 如果未找到：写 `✅ 当前无已知 Issue（在 volume-2-issues/ 中未找到与此文件夹相关的 Issue）`

### 步骤 3：发现问题时创建 Issue

按本 Prompt 中内联的检测标准评估。使用上述统一 Issue 输出模板。

### 步骤 4：输出摘要

简短报告：
- 读取了哪些文件（按优先级分组）
- 收集到了哪些已有 Issue（ID + 严重等级 + 一句话概述）
- 发现了哪些新 Issue（路径 + 类型 + 严重等级 + 检测模式）
- 预估 token 使用量 vs. 预算

## 🔴 文件写入路径安全规则（最高优先级，违反即阻塞）

> ⚠️ 以下规则约束所有 `write_file` / `edit_file` 调用。违反任一条 = 编排器校验失败，产物拒绝。

### 规则 1：路径白名单

`write_file` 的 `path` 参数**只能**是以下前缀之一：

| 允许的前缀 | 用途 | 示例 |
|-----------|------|------|
| `{projectRoot}/wiki/volume-1-code/{wikiChapter}/` | Wiki 章节（.md 文档，不含 Issue） | `{projectRoot}/wiki/volume-1-code/ch-utils/sec-user.md` |
| `{projectRoot}/wiki/volume-2-issues/ch-{NN}-{type}/` | Issue 文件 | `{projectRoot}/wiki/volume-2-issues/ch-03-missing-types/IS-2026-001.md` |

**禁止写入到以上前缀之外的任何路径。**

> ⚠️ 特别禁止：`wiki/volume-1-code/ch-*/issues/` 不是合法 Issue 路径。
> Issue 的唯一归宿是 `volume-2-issues/`，Volume 1 只包含代码文档，不包含 Issue 文件。
> 如果 SubAgent 误写到 Volume 1，ASSEMBLE 阶段的 `fix-issue-paths.ts` 会自动修正。

### 规则 2：Mermaid 语法隔离

- 🔴 **Mermaid 图的节点定义（如 `B[getUserData]`、`D{子包?}`）绝对禁止作为 `write_file` 的 `path` 参数**
- 🔴 **Mermaid 边标签（如 `isSub=true`、`isSub=false`）绝对禁止作为 `write_file` 的 `path` 参数**
- Mermaid 图必须作为 **markdown 内容的一部分**写入 Wiki 章节文件，用 ` ```mermaid ` 代码块包裹，绝不拆分为独立文件
- 如果 Mermaid 节点数超过 20 个，**截断**而非拆分

### 规则 3：路径字符安全

- `path` 中**禁止**包含 `[` `]` `{` `}` 字符（这些是 Mermaid 语法保留字符）
- `path` 必须能以 `{projectRoot}/wiki/` 开头拼接为有效文件路径
- 如果在生成内容时发现自己正在用 `[]` `{}` 字符构造 `write_file` 的 path，**立即停止并回退**——这表示 Mermaid 语法泄露到文件系统

### 规则 4：自检清单

每次调用 `write_file` 前，先在脑中过一遍：

1. 这个 path 是以 `{projectRoot}/wiki/volume-1-code/` 或 `{projectRoot}/wiki/volume-2-issues/` 开头的吗？
2. path 中包含 `[` `]` `{` `}` 字符吗？→ 如果有，**绝对禁止**
3. 这个文件是我要写的 Wiki 内容还是 Mermaid 片段？→ 只能是 Wiki 内容

---

## 重要注意事项

- **不要写入任何 JSON 文件**
- **不要生成中间分析产物**
- **Issue 必须包含检测依据章节**（维度 + 模式 + 检测项）
- **严重等级按本 Prompt 内联的决策矩阵判断**（影响范围 × 运行时影响）
- **## 已知问题 章节不可为空**：必须扫描 volume-2-issues/ 并列出相关 Issue，或写明"✅ 无已知 Issue"
- Obsidian 链接格式：`[[../../volume-1-code/ch-nn/sec-name]]`
- Mermaid 图 ≤ 20 个节点，**必须内嵌在 markdown 的 ` ```mermaid ` 代码块中**，禁止拆分为独立文件
- 表格对齐，格式良好
- 仅列出实际读取的文件到 frontmatter 的 sourceFiles
- **不要预创建空的 Issue 章节目录**：只在确实有 Issue 要写入时才创建 `ch-{NN}-{type}/` 目录
- **Issue ID 必须递增不重复**：同一批次从 IS-{YYYY}-001 开始，每个新 Issue 递增 NNN
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
