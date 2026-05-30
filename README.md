# AgenticWiki

> **你是 Agent。这是你的入口文档。** 从这里开始，按指令行动。

Agent 驱动的前端代码转 Wiki 系统。基于 [LLM Wiki (karpathry)](docs/LLM-Wiki_karpathry.md) 思想，通过原子化 Skills 生态实现代码 → Wiki 的自动化转译。

---

## 🔴 第一步：选择模式并启动

根据用户意图，选择以下三种模式之一，**读取对应的 SKILL.md 并严格按其指令执行**：

### 全量分析（首次分析项目）

```
先用 read_file 读取 skills/aw-orchestrator/SKILL.md
然后按其中的 DAG 流程分析目标项目。
目标项目路径：{用户指定的项目路径}
```

### 增量分析（项目已有 Wiki，只需更新变更）

```
先用 read_file 读取 skills/aw-incremental/SKILL.md
增量分析目标项目：{用户指定的项目路径} --since HEAD~1
```

### 单文件夹分析（只分析一个子目录）

```
先用 read_file 读取 skills/aw-analyze/SKILL.md
分析目标文件夹：{用户指定的项目路径}/src/components
```

> ⚠️ **入口即出口**：所有模式的执行细节都在对应 SKILL.md 中。README 只负责路由，不重复描述流程。

---

## 🔴 路径铁律（违反则必须阻断）

| # | 规则 | 正确 | 错误 |
|---|------|------|------|
| 1 | `projectRoot` ≠ AgenticWiki 自身目录 | `.../AgenticWiki/project/xxx` | `.../AgenticWiki` ❌ |
| 2 | Wiki 输出到 `{projectRoot}/wiki/` | `.../project/xxx/wiki/` | `.../AgenticWiki/wiki/` ❌ |
| 3 | `.agentic-wiki/` 在 projectRoot 下 | `.../project/xxx/.agentic-wiki/` | 漏到 AgenticWiki 目录 ❌ |

> 详见 `skills/aw-init/SKILL.md` Step 3.5 路径自检。

---

## 架构

```
┌─────────────────────────────────────────┐
│  Agent 层                                │
│  读取 SKILL.md → 决策 → 调用工具/脚本     │
├─────────────────────────────────────────┤
│  Skills 层（9 个）                        │
│  aw-*/SKILL.md — 任务指令，不是可执行程序  │
├─────────────────────────────────────────┤
│  脚本层（22 个，全部有 CLI）               │
│  src/lib/*.ts — 纯数据获取与转换           │
├─────────────────────────────────────────┤
│  数据层                                  │
│  .agentic-wiki/cache/*.json              │
│  wiki/*.md                               │
└─────────────────────────────────────────┘
```

### 设计原则

- **Agent 是驱动者** — 读取 SKILL.md，决定调用什么脚本、启动什么 SubAgent
- **脚本写 JSON，LLM 写 Markdown** — 脚本不做语义理解，LLM 不生成结构化数据
- **脚本调用 = terminal 工具** — 所有 🔧 标注的步骤必须通过 `npx tsx src/lib/xxx.ts` 执行，禁止手动模拟
- **增量优先** — 全量分析是特例，增量分析是常态

---

## Skills 与 DAG

| 技能 | 阶段 | 职责 |
|------|------|------|
| `aw-orchestrator` | 编排 | DAG 调度 + 断点恢复 + 状态管理 + 门控 |
| `aw-init` | INIT | 项目初始化 + 技术栈识别 + **路径自检** |
| `aw-scan` | SCAN | 文件扫描 + 样式过滤 |
| `aw-dependency` | DEPENDENCY | 依赖图 + 优先级标注 + 拆分策略 + 子图提取 |
| `aw-incremental` | INCREMENTAL | Git diff + 依赖传播（增量模式） |
| `aw-analyze` | 单文件夹 | 委托编排器执行完整 DAG（范围缩小到单文件夹） |
| `aw-generate` | GEN | SubAgent 并发：读源码 → 写 Wiki + 发现 Issue |
| `aw-validate` | VALIDATE | Wiki 交叉引用验证 + 源码引用校验 |
| `aw-feedback` | FEEDBACK | 验证失败时根因分析 + 回退重试 |

```
INIT → SCAN → DEPENDENCY → GEN → ASSEMBLE → VALIDATE → DONE
  │       │         │          │        │           │
  └─GATE──┴─GATE────┴─GATE─────┴─GATE───┴─GATE──────┘
                                                    │
                                          ┌─ 失败 ──┘
                                          ↓
                                      FEEDBACK → 回退
```

> SCAN = 扫描 + 过滤，DEPENDENCY = 依赖图 + 优先级 + 拆分 + 子图，GEN = SubAgent 并发生成

---

## 门控体系

每个阶段完成后强制运行 `validate-artifacts.ts`：

| 级别 | 含义 | 行为 |
|------|------|------|
| 🔴 CRITICAL | 缺失则阻断 | 暂停，记录 blockers |
| 🟡 REQUIRED | 缺失则告警 | 可继续，标注缺失 |

---

## 参考文档

| 文档 | 用途 |
|------|------|
| `skills/aw-orchestrator/SKILL.md` | 编排器完整指令（Agent 执行手册） |
| `docs/design/architecture.md` | 完整架构、数据规范、状态管理设计 |
| `docs/design/spec-v2-context-safe.md` | 流水线技术规格 |
| `docs/feedback/global-strategies.md` | 跨项目通用改进策略（GEN 阶段注入） |

---

## 技术栈

| 功能 | 库 | 理由 |
|------|-----|------|
| 依赖图 | `dependency-cruiser` | 原生 Mermaid 输出 + 循环检测 |
| Git 操作 | `simple-git` | 链式 API，内置 diff 解析 |
| 文件扫描 | `globby` | 自动 gitignore |
| Markdown | `gray-matter` | Frontmatter 解析 |

## License

Apache
