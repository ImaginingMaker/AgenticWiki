# AgenticWiki

Agent 驱动的前端代码转 Wiki 系统。基于 [LLM Wiki (karpathry)](docs/LLM-Wiki_karpathry.md) 思想，通过原子化 Skills 生态实现代码 → Wiki 的自动化转译。

## 核心理念

- **Agent 是驱动者** — Agent 决定调用什么 Skills、运行什么脚本、处理什么数据
- **Skills 是指令集** — SKILL.md 告诉 Agent "做什么、怎么做"，不是可执行程序
- **脚本是数据工具** — 脚本只负责数据获取与转换，不包含业务逻辑
- **LLM 写 Markdown，脚本写 JSON** — LLM 不生成结构化数据，脚本不生成叙述性内容（book.md / glossary.md 等组装类 Markdown 由脚本机械生成，不涉及语义理解）
- **增量优先** — 全量分析是特例，增量分析是常态

## 架构

```
┌─────────────────────────────────────────┐
│  Agent 层                                │
│  Main Agent + SubAgent                   │
│  读取 SKILL.md → 决策 → 调用工具         │
├─────────────────────────────────────────┤
│  Skills 层                               │
│  aw-* SKILL.md 文档                      │
│  指导 Agent 如何行动                      │
├─────────────────────────────────────────┤
│  脚本层                                  │
│  src/lib/*.ts (22 个脚本，全部有 CLI)     │
│  纯数据获取与转换（通过 tsx 执行）         │
├─────────────────────────────────────────┤
│  数据层                                  │
│  .agentic-wiki/cache/*.json              │
│  wiki/*.md                               │
└─────────────────────────────────────────┘
```

## Skills 生态

| 技能 | 阶段 | 职责 |
|------|------|------|
| `aw-orchestrator` | 编排 | DAG 调度 + 断点恢复 + 状态管理 + 门控 |
| `aw-init` | INIT | 项目初始化 + 技术栈识别 + 路径自检 |
| `aw-scan` | SCAN | 文件扫描 + 样式过滤 |
| `aw-dependency` | DEPENDENCY | 依赖图构建 + 优先级标注 + 拆分策略 + 子图提取 |
| `aw-incremental` | INCREMENTAL | 增量分析引擎（Git diff + 依赖传播） |
| `aw-analyze` | 单文件夹入口 | 委托给编排器执行完整 DAG（同全量模式，范围缩小到单文件夹） |
| `aw-generate` | GEN | 合并分析+Wiki生成 + Issue 发现 |
| `aw-validate` | VALIDATE | Wiki 验证 + 交叉引用检查 |
| `aw-feedback` | FEEDBACK | 验证失败时回退 + 策略改进 |

### DAG 拓扑

```
INIT → SCAN → DEPENDENCY → GEN → ASSEMBLE → VALIDATE → DONE
  │       │         │          │        │           │
  └─GATE──┴─GATE────┴─GATE─────┴─GATE───┴─GATE──────┘
                                                    │
                                          ┌─ 失败 ──┘
                                          ↓
                                      FEEDBACK → 回退到 GEN

增量模式（可选）:
  INCREMENTAL（Git diff + 依赖传播）→ 只分析受影响文件夹
```

> SCAN = 扫描 + 过滤（aw-scan），DEPENDENCY = 依赖图 + 优先级 + 拆分 + 子图（aw-dependency）

### 脚本清单（22 个，全部有 CLI）

| 脚本 | 阶段 | 功能 |
|------|------|------|
| `scan-project.ts` | INIT | 项目扫描 + 技术栈识别 |
| `compute-hashes.ts` | INIT | 文件哈希基线 |
| `scan-files.ts` | SCAN | 源码文件扫描 |
| `filter-styles.ts` | SCAN | 样式文件过滤 |
| `analyze-folders.ts` | DEPENDENCY | 文件夹拆分策略 + token 估算 |
| `file-priorities.ts` | DEPENDENCY | P0-P4 优先级标注 + token 估算 |
| `build-deps.ts` | DEPENDENCY | 依赖图构建（JSON + Mermaid） |
| `extract-subgraph.ts` | DEPENDENCY | 子图提取（模糊匹配） |
| `git-diff.ts` | INCREMENTAL | Git diff + 依赖传播 + Issue 反向查询 |
| `gen-scheduler.ts` | GEN | 调度清单生成 + SubAgent Prompt 预构建 |
| `verify-gen-artifacts.ts` | GEN | Mermaid 泄露扫描 + Wiki 目录验证 |
| `symbol-index.ts` | ASSEMBLE | 符号索引生成 |
| `issue-dashboard.ts` | ASSEMBLE | Issue 仪表盘（输出到 `wiki/issues.md`） |
| `validate-issue-types.ts` | ASSEMBLE | Issue 类型白名单校验 |
| `validate-issue-content.ts` | ASSEMBLE | Issue 内容量化验证（行数/any/嵌套/引用/循环） |
| `progress-dashboard.ts` | GEN / ASSEMBLE | 分析进度仪表盘（`wiki/PROGRESS.md`） |
| `assemble-book.ts` | ASSEMBLE | 自动组装 book.md + glossary.md |
| `validate-references.ts` | VALIDATE | 交叉引用验证 |
| `validate-code-refs.ts` | VALIDATE | 源码引用校验 + 符号检查 |
| `validate-artifacts.ts` | GATE | 产物门控（每阶段后运行） |
| `state-manager.ts` | 全局 | state.json 原子操作（init/read/update/validate/transition/lock/append-feedback） |
| `id-utils.ts` | 工具 | 统一 ID 生成（subTask/genTask ID 桥接） |

### 门控体系

每个阶段完成后强制运行 `validate-artifacts.ts`，校验产物存在性、JSON 合法性、幽灵产物检测。

| 级别 | 含义 | 行为 |
|------|------|------|
| 🔴 CRITICAL | 缺失则阻断流水线 | 暂停，记录 blockers |
| 🟡 REQUIRED | 缺失则告警 | 可继续，标注缺失 |

## 文档

- [架构设计文档](docs/design/architecture.md) — 完整架构、数据规范、状态管理设计
- [流水线技术规格](docs/design/spec-v2-context-safe.md) — 流水线技术规格
- [LLM Wiki (karpathry)](docs/LLM-Wiki_karpathry.md) — 原始思想参考

## 快速开始

在 Agent 会话中，复制 `PROMPT.md` 中的模板即可。

### 全量分析
```
你是 Agentic Wiki 编排器。先用 read_file 读取 skills/aw-orchestrator/SKILL.md
然后按其中的 DAG 流程分析目标项目。
目标项目路径：{你的项目路径}
```

### 增量分析
```
你是 Agentic Wiki 编排器。读取 skills/aw-incremental/SKILL.md
增量分析目标项目：{你的项目路径} --since HEAD~1
```

### 单文件夹分析
```
你是 Agentic Wiki 编排器。读取 skills/aw-orchestrator/SKILL.md
配置 mode=single-folder，分析目标文件夹：{你的项目路径}/src/components
```

## 技术栈

| 功能 | 库 | 核心理由 |
|------|-----|---------|
| 依赖图 | `dependency-cruiser` | 原生 Mermaid 输出 + 循环检测 |
| Git 操作 | `simple-git` | 链式 API，内置 diff 解析 |
| 文件扫描 | `globby` | 自动 gitignore，性能最佳 |
| Markdown | `gray-matter` | Frontmatter 解析 |

## License

Apache
