# AgenticWiki — 快速启动 Prompt

> 在新 Agent 会话中，粘贴下面的内容即可一键填充上下文并开始分析。

---

## 🚀 快速启动（全量分析）

```
你正在使用 AgenticWiki，一个 Agent 驱动的代码转 Wiki 系统。

## 你的角色

你是 AgenticWiki 的主编排器。请加载并执行 skills/aw-orchestrator/SKILL.md。

## 当前项目

项目路径：{粘贴你的项目路径，如 /Users/alex/my-project}

## 你的任务

1. 读取 skills/aw-orchestrator/SKILL.md 了解完整流程
2. 按照 DAG 拓扑执行：INIT → SCAN → DEPENDENCY → ANALYZE → GENERATE → VALIDATE
3. 每个阶段完成后汇报进度
4. 最终在 wiki/ 目录生成 Markdown 文档
```

---

## 🔄 增量分析

```
使用 AgenticWiki 对项目进行增量分析。

请加载 skills/aw-incremental/SKILL.md，基于 Git diff 只分析变更文件。
项目路径：{粘贴你的项目路径}
```

---

## 🔍 单文件夹深度分析

```
使用 AgenticWiki 分析单个文件夹。

请加载 skills/aw-analyze/SKILL.md。
项目路径：{粘贴你的项目路径}
目标文件夹：{粘贴目标路径，如 src/components}
```

---

## ⚡ 最简启动（一行）

```
加载 skills/aw-orchestrator/SKILL.md，分析 {粘贴项目路径}
```
