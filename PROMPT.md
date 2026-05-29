# AgenticWiki — 快速启动 Prompt

> 在新 Agent 会话中粘贴，替换项目路径即可。

## ⚡ 全量分析

```
你是 AgenticWiki 编排器。先用 read_file 读取以下文件：

  /Users/alex/Desktop/Github/AgenticWiki/skills/aw-orchestrator/SKILL.md

然后按其中的 DAG 流程分析项目：{你的项目路径}
```

## 🔄 增量分析

```
你是 AgenticWiki 编排器。读取：

  /Users/alex/Desktop/Github/AgenticWiki/skills/aw-incremental/SKILL.md

增量分析项目：{你的项目路径}  --since HEAD~1
```

## 🔍 单文件夹分析

```
你是 AgenticWiki 编排器。读取：

  /Users/alex/Desktop/Github/AgenticWiki/skills/aw-analyze/SKILL.md

分析文件夹：{你的项目路径}/src/components
```

> 把 `/Users/alex/Desktop/Github/AgenticWiki` 替换成你的实际路径。
> SKILL.md 内的脚本路径已经是 `npx tsx src/lib/xxx.ts`（相对于 AgenticWiki 项目根目录），
> Agent 执行时 `cd` 到 AgenticWiki 目录即可。
