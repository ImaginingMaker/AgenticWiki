# aw-generate — Wiki 文档生成

> 根据分析结果生成 Wiki 文档，支持增量更新

## 触发条件

- `aw-analyze` 完成后
- 用户说"生成 Wiki"、"生成文档"
- `aw-orchestrator` 调度 GENERATE 阶段

---

## 你的任务

1. 读取分析结果（`analysis/*.json`）
2. 为每个文件夹生成 Wiki 页面
3. 生成 Wiki 索引（`index.md`）
4. 生成变更日志（`log.md`）
5. 支持增量更新已有 Wiki

---

## 执行模式

### 模式 A: Main Agent 直接执行（少量 Wiki）

适用于：
- Wiki 页面 ≤ 5

**执行方式**：Main Agent 直接生成

---

### 模式 B: SubAgent 并发执行（大量 Wiki）

适用于：
- Wiki 页面 > 5

**执行方式**：使用 `spawn_agent` 工具启动 SubAgent

---

## 执行步骤（模式 B）

### Step 1: 确定生成范围

使用 `read_file` 工具读取：
- `.agentic-wiki/cache/analysis/*.json`（分析结果）
- `.agentic-wiki/cache/incremental-analysis.json`（增量模式）

获取需要生成/更新的 Wiki 列表。

---

### Step 2: 为每个文件夹创建 SubAgent 任务

**任务清单格式**：

| ID | 文件夹 | Wiki 路径 | 任务描述 |
|----|--------|----------|---------|
| T1 | src/components/ | wiki/src-components/index.md | 生成组件 Wiki |
| T2 | src/pages/ | wiki/src-pages/index.md | 生成页面 Wiki |
| T3 | src/utils/ | wiki/src-utils/index.md | 生成工具函数 Wiki |

---

### Step 3: 启动 SubAgent 并发生成

使用 `spawn_agent` 工具启动多个 SubAgent：

**SubAgent Prompt 模板**：

```
你正在为文件夹生成 Wiki：{folder}

## 输入

分析结果：`.agentic-wiki/cache/analysis/{folder-hash}.json`

## 你的任务

根据分析结果生成 Wiki 文档，包含以下章节：

### 必需章节

1. **YAML Frontmatter**
```yaml
---
tags: [框架, 类型, 业务域]
lastUpdated: <日期>
sourceFiles: [文件列表]
analysisVersion: 1
---
```

2. **概述**
- 文件夹的用途（1-2 段话）
- 包含的主要模块

3. **组件/函数列表**
- 表格形式展示
- 包含名称、类型、用途

4. **依赖关系**
- Mermaid 依赖图
- 说明关键依赖

5. **数据流**
- 入：数据来源
- 出：数据去向
- 内：内部流转

6. **相关页面**
- Wiki 内部链接（Obsidian 格式：`[[页面名]]`）

7. **已知问题**
- 从 Issue 索引中提取相关问题

## 输出格式

使用 `write_file` 工具写入：`{wiki-path}`

## 注意事项

- 使用 Obsidian 兼容的链接格式：`[[页面名]]`
- Mermaid 图要简洁，不要包含所有节点
- 表格要对齐，便于阅读
- 描述要具体，不要泛泛而谈
```

---

### Step 4: 生成 Wiki 索引

使用 `read_file` 工具读取所有生成的 Wiki，然后生成 `wiki/index.md`：

```markdown
# Wiki 索引

## 项目信息
- **框架**: React + TypeScript
- **构建工具**: Vite
- **源码路径**: src/

## 页面目录

| 页面 | 说明 | 最后更新 | 源文件数 |
|------|------|---------|---------|
| [[src/components]] | 通用 UI 组件库 | 2026-05-29 | 3 |
| [[src/pages]] | 页面组件 | 2026-05-29 | 5 |
| [[src/utils]] | 工具函数 | 2026-05-29 | 15 |

## 依赖图

\`\`\`mermaid
graph TD
  App[App.tsx] --> Button[Button.tsx]
  App --> Input[Input.tsx]
\`\`\`

## 统计

- 总页面数: 12
- 总组件数: 20
- 总函数数: 35
```

---

### Step 5: 更新变更日志

使用 `edit_file` 工具追加到 `wiki/log.md`：

```markdown
## [2026-05-29] full | 初始化分析
- 初始化项目扫描
- 识别技术栈: React + TypeScript
- 扫描 128 个源码文件
- 构建依赖图，检测到 0 个循环依赖
- 生成 12 个 Wiki 页面
```

或（增量模式）：

```markdown
## [2026-05-30] incremental | 增量更新
- 变更文件: src/App.tsx, src/utils/helper.ts
- 受影响文件夹: src/, src/pages/, src/components/
- 更新 3 个 Wiki 页面
```

---

### Step 6: 更新状态

使用 `edit_file` 工具更新 `state.json`：

```json
{
  "phaseHistory": [
    {
      "phase": "GENERATE",
      "status": "completed",
      "startedAt": "<时间戳>",
      "completedAt": "<时间戳>",
      "output": "wiki/",
      "subTasks": [
        { "id": "T1", "folder": "src/components/", "status": "completed", "output": "wiki/src-components/index.md" },
        { "id": "T2", "folder": "src/pages/", "status": "completed", "output": "wiki/src-pages/index.md" }
      ]
    }
  ],
  "currentPhase": "VALIDATE"
}
```

---

## 增量更新策略

### 场景 1: 文件新增

- 在对应 Wiki 中追加新组件/函数的描述
- 更新依赖图（如有新依赖）
- 更新 frontmatter 的 `sourceFiles`

### 场景 2: 文件修改

- 使用 `edit_file` 工具更新对应章节
- 重新生成依赖图章节（如有依赖变更）
- 更新 frontmatter 的 `lastUpdated`

### 场景 3: 文件删除

- 从 Wiki 中移除对应描述
- 更新依赖图
- 更新 frontmatter 的 `sourceFiles`

---

## 输出产物

| 文件 | 说明 |
|------|------|
| `wiki/*/index.md` | 每个文件夹的 Wiki |
| `wiki/index.md` | Wiki 索引 |
| `wiki/log.md` | 变更日志 |
| `wiki/overview.md` | 项目概览（可选） |
| `wiki/dependency-graph.md` | 全局依赖图（可选） |

---

## Wiki 页面模板

```markdown
---
tags: [react, components, ui]
lastUpdated: 2026-05-29
sourceFiles: [Button.tsx, Input.tsx, Modal.tsx]
analysisVersion: 1
---

# src/components/

## 概述

通用 UI 组件库，包含 Button、Input、Modal 三个组件，用于构建用户界面。

## 组件列表

| 名称 | 类型 | 用途 |
|------|------|------|
| Button | 函数组件 | 通用按钮 |
| Input | 函数组件 | 受控输入框 |
| Modal | 函数组件 | 模态对话框 |

### Button

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
  Modal --> React
\`\`\`

## 数据流

- **入**: 从父组件接收 props
- **出**: 通过 onClick/onChange 向父组件传递事件
- **内**: 组件内部 useState 管理状态

## 相关页面

- [[src/pages/Home]] — 使用了 Button 和 Input
- [[src/pages/Dashboard]] — 使用了 Button 和 Modal

## 已知问题

- 无
```

---

## 下一步

Wiki 生成完成后，调用 `aw-validate` 验证 Wiki 准确性。
