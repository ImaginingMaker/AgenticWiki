# AgenticWiki — 快速启动 Prompt

## 方式 A：全局安装后（推荐）

```bash
# 先运行一次
chmod +x setup.sh && ./setup.sh
```

之后在**任意项目**的 Agent 会话中，只需一句：

```
你是 AgenticWiki 编排器，加载 aw-orchestrator，分析当前项目
```

不需要任何路径 —— Agent 会自动读取 `~/.agents/skills/aw-orchestrator/SKILL.md`，脚本路径也已在安装时替换为绝对路径。

---

## 方式 B：不安装，用绝对路径

把 `/Users/alex/Desktop/Github/AgenticWiki` 替换成你的实际路径：

```
你是 AgenticWiki 编排器。请用 read_file 读取
/Users/alex/Desktop/Github/AgenticWiki/skills/aw-orchestrator/SKILL.md
然后按 DAG 流程分析 {你的项目路径}
```

---

## 场景模板

### 增量分析

```
aw-orchestrator，增量模式分析当前项目，--since HEAD~1
```

### 单文件夹分析

```
aw-analyze，分析 src/components/
```
