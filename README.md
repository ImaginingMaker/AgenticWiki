# AgenticWiki

> **你是 Agent。这是你的入口文档。** 从这里开始，按指令行动。

Agent 驱动的前端代码转 Wiki 系统。基于 [LLM Wiki (karpathry)](docs/LLM-Wiki_karpathry.md) 思想，通过原子化 Skills 生态实现代码 → Wiki 的自动化转译。

---

## 🔴 第一步：选择模式并启动

根据用户意图选择模式，**直接执行对应指令**：

### 模式 A：页面级 Wiki 生成（推荐 — SubAgent 并发编排）

> 适用：分析单个/批量页面，生成带链路分析的标准化 Wiki。
> 使用 `pu-page-wiki-generator` skill（内置 `pi-task-orchestrator` 并发调度 6 个 SubAgent）。

```
使用 skill 工具加载 pu-page-wiki-generator，然后按其 Phase 0→6 流程执行：
1. Phase 0: read_file 读取项目文档（README、CLAUDE.md、docs/）
2. Phase 1: Main Agent 基础解析（路由、组件引入、API 定义）
3. Phase 2: 委托 pi-task-orchestrator 并发启动 6 个 SubAgent
4. Phase 3: Main Agent 汇总合并生成完整 Wiki

目标路径：{用户指定的页面文件或目录}
```

### 模式 B：全量 DAG 流水线（完整项目分析）

> 适用：首次分析整个项目，执行完整 INIT→SCAN→DEPENDENCY→GEN→ASSEMBLE→VALIDATE 流水线。
> 使用 `aw-orchestrator` + `aw-generate` SubAgent 体系。

```
1. 使用 read_file 读取 skills/aw-orchestrator/SKILL.md
2. 按 DAG 流程执行：INIT → SCAN → DEPENDENCY → GEN → ASSEMBLE → VALIDATE
3. GEN 阶段，如果文件夹太多分批执行：
   npx tsx src/lib/gen-scheduler.ts --limit 5 ...  （每次只调度 5 个）
4. GEN 阶段完成后，必须运行 gen:sync 同步进度
5. 然后运行 gen:progress 生成进度面板
6. 用 read_file 读取 wiki/PROGRESS.md 确认进度已更新

目标项目路径：{用户指定的项目路径}
```

> 💡 **分批执行**：项目文件夹太多时，在 GEN 阶段加 `--limit N`，
> 本次只处理 N 个文件夹。下次继续时，`gen-scheduler` 自动跳过已完成的，
> 只调度剩余的。
>
> 💡 **增量组装**（可选）：每批 GEN 完成后，可立即运行 `assemble-book.ts`
> 查看部分结果，无需等所有批次完成：
> ```bash
> npx tsx src/lib/assemble-book.ts --wiki wiki/ --strategy .agentic-wiki/cache/folder-strategy.json
> ```
> `wiki/book.md` 和 `wiki/glossary.md` 会随每批增量更新。

### 模式 C：增量分析（项目已有 Wiki，只更新变更）

```
1. 使用 read_file 读取 skills/aw-incremental/SKILL.md
2. 增量分析目标项目：{用户指定的项目路径} --since HEAD~1
3. 同样执行 gen:sync + gen:progress 确保进度更新
```

### 模式 D：单文件夹分析（只分析一个子目录）

```
1. 使用 read_file 读取 skills/aw-analyze/SKILL.md
2. 分析目标文件夹：{用户指定的项目路径}/src/components
```

---

## 🔴 路径铁律（违反则必须阻断）

| # | 规则 | 正确 | 错误 |
|---|------|------|------|
| 1 | `projectRoot` ≠ AgenticWiki 自身目录 | `.../AgenticWiki/project/xxx` | `.../AgenticWiki` ❌ |
| 2 | Wiki 输出到 `{projectRoot}/wiki/` | `.../project/xxx/wiki/` | `.../AgenticWiki/wiki/` ❌ |
| 3 | `.agentic-wiki/` 在 projectRoot 下 | `.../project/xxx/.agentic-wiki/` | 漏到 AgenticWiki 目录 ❌ |

> 详见 `skills/aw-init/SKILL.md` Step 3.5 路径自检。

---

## 🔴 进度追踪（GEN 阶段后必须执行）

> ⚠️ `genTasks` 状态是 `wiki/PROGRESS.md` 的数据源。编排器 Agent 常遗漏手动更新 `state.json.genTasks`，导致进度面板显示 0%。
>
> 🔴 **GEN 阶段开始时**，`gen-scheduler.ts` 必须带 `--write-state` 运行，自动将 genTasks 写入 state.json。详见 `skills/aw-orchestrator/SKILL.md` Phase 2 Step 1。

**GEN 阶段完成后，必须按顺序执行**：

```bash
# Step 1: 自动同步 genTasks 状态（从 wiki 产物目录反推）
npx tsx src/lib/sync-gen-tasks.ts \
  --state  .agentic-wiki/state.json \
  --wiki   wiki/ \
  --write

# Step 2: 生成/更新进度面板
npx tsx src/lib/progress-dashboard.ts \
  --state    .agentic-wiki/state.json \
  --strategy .agentic-wiki/cache/folder-strategy.json \
  --output   wiki/PROGRESS.md

# Step 3: 验证进度已更新
# 用 read_file 读取 wiki/PROGRESS.md，确认 completed > 0
```

> 💡 如果 genTasks 意外为空（gen-scheduler 未带 `--write-state`），可用以下命令从调度清单回填：
> ```bash
> npx tsx src/lib/sync-gen-tasks.ts \
>   --state .agentic-wiki/state.json \
>   --wiki  wiki/ \
>   --init-from-schedule .agentic-wiki/cache/gen-schedule.json \
>   --write
> ```
>
> `sync-gen-tasks.ts` 扫描 `wiki/volume-1-code/` 下已有产物的目录，自动将对应 `genTasks` 标记为 `completed`。不用再手动 edit_file 更新 state.json。

---

## 架构

```
┌─────────────────────────────────────────┐
│  Agent 层                                │
│  读取 SKILL.md → 决策 → 调用工具/脚本     │
├─────────────────────────────────────────┤
│  Skills 层（9 个 aw-* + 独立 pu-*）       │
│  aw-*/SKILL.md — 流水线任务指令           │
│  pu-page-wiki-generator — 页面 Wiki 生成  │
├─────────────────────────────────────────┤
│  脚本层（23 个，全部有 CLI）               │
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
| `pu-page-wiki-generator` | 页面 Wiki | Main Agent + `pi-task-orchestrator` 并发 6 SubAgent |

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

## 关键脚本速查

| 脚本 | npm script | 用途 |
|------|-----------|------|
| `sync-gen-tasks.ts` | `gen:sync` | **自动同步 genTasks 状态**（从 wiki 产物反推） |
| `progress-dashboard.ts` | `gen:progress` | 生成 `wiki/PROGRESS.md` 进度面板 |
| `gen-scheduler.ts` | `gen:schedule` | 生成 GEN 调度清单 + SubAgent Prompts |
| `verify-gen-artifacts.ts` | `gen:verify` | GEN 产物验证（Mermaid 泄露扫描等） |
| `validate-artifacts.ts` | `validate:artifacts` | 阶段门控产物校验 |

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
