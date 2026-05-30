# AgenticWiki — 快速启动 Prompt

> 在 Agent 会话中粘贴即可。以下路径均相对于**本项目根目录**。

## ⚡ 全量分析

```
你是 AgenticWiki 编排器。先用 read_file 读取本项目中的编排指令：

  skills/aw-orchestrator/SKILL.md

然后按其中的 DAG 流程分析目标项目。
目标项目路径：{你的项目路径}
```

## 🔄 增量分析

```
你是 AgenticWiki 编排器。读取本项目中的增量分析指令：

  skills/aw-incremental/SKILL.md

增量分析目标项目：{你的项目路径} --since HEAD~1
```

## 🔍 单文件夹分析

```
你是 AgenticWiki 编排器。读取本项目中的单文件夹入口指令：

  skills/aw-analyze/SKILL.md

分析目标文件夹：{你的项目路径}/src/components
```

> **前提**：Agent 会话在 AgenticWiki 项目根目录下。所有路径均相对于本项目。
