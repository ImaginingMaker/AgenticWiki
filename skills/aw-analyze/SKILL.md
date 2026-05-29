# aw-analyze — 单文件夹分析

> 单文件夹模式的快速分析入口。内部委托给主编排器执行完整 DAG 流程。

## 触发条件

- 用户说"分析这个文件夹"、"单文件夹分析"
- PROMPT.md 中的单文件夹快速启动

---

## 你的任务

你是单文件夹分析的入口。委托给 `aw-orchestrator` 执行完整流水线。

---

## 执行步骤

### Step 1: 委托给主编排器

使用 `read_file` 读取主编排器指令：

```
skills/aw-orchestrator/SKILL.md
```

然后按其中的 DAG 流程执行。配置如下：

- `mode`: `"single-folder"`
- `sourcePath`: 用户指定的文件夹路径
- `wikiPath`: `wiki/`
- 其他参数使用默认值

### Step 2: 路径确认

在启动前，确认以下路径：

1. 目标文件夹存在且包含源码文件
2. 如果目标文件夹在 AgenticWiki 项目内部，确保 `projectRoot` 指向独立的目标项目根目录（而非 AgenticWiki 根）

示例：
```
用户指定: project/tdesign-vue-next/packages/components/dialog/

projectRoot     = .../AgenticWiki/project/tdesign-vue-next
sourceRoot      = .../AgenticWiki/project/tdesign-vue-next/packages/components/dialog
wikiRoot        = .../AgenticWiki/project/tdesign-vue-next/wiki
agenticWikiRoot = .../AgenticWiki
```

---

## 与全量模式的区别

| 维度 | 全量模式 | 单文件夹模式 |
|------|---------|-------------|
| 扫描范围 | 整个项目 | 单个文件夹 |
| 依赖图 | 全项目依赖图 | 全项目依赖图（子图提取定位到目标文件夹） |
| Wiki 输出 | 多章节 | 单章节 |
| Issue 分类 | 按类型分章节 | 按类型分章节（相同规则） |

---

## 下一步

初始化完成后，编排器按标准 DAG 流程推进：INIT → SCAN → DEPENDENCY → GEN → ASSEMBLE → VALIDATE。
