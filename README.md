# AgenticWiki

Agent 驱动的前端代码转 Wiki 系统。基于 [LLM Wiki (karpathry)](docs/LLM-Wiki_karpathry.md) 思想，通过原子化 Skills 生态实现代码 → Wiki 的自动化转译。

## 核心理念

- **Agent 是驱动者** — Agent 决定调用什么 Skills、运行什么脚本、处理什么数据
- **Skills 是指令集** — SKILL.md 告诉 Agent "做什么、怎么做"，不是可执行程序
- **脚本是数据工具** — 脚本只负责数据获取与转换，不包含业务逻辑，不调度 LLM
- **Skills 完全独立** — 不复用现有 pi-/pu- Skills 生态
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
│  src/lib/*.ts                            │
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
| `aw-init` | INIT | 项目初始化 + 技术栈识别 |
| `aw-scan` | SCAN | 文件扫描 + 文件夹拆分决策 |
| `aw-dependency` | DEPENDENCY | 依赖图构建 + 循环检测 |
| `aw-incremental` | INCREMENTAL | 增量分析引擎 |
| `aw-analyze` | ANALYZE | 单文件夹局部分析 |
| `aw-generate` | GENERATE | Wiki 文档生成 |
| `aw-validate` | VALIDATE | Wiki 验证 + Review |
| `aw-issue` | ISSUE | Issue 检测 + 验证 + 追踪 |
| `aw-feedback` | FEEDBACK | 反馈循环 + prompt 优化 |
| `aw-orchestrator` | 编排 | DAG 调度 + 断点恢复 + 状态管理 |

### DAG 拓扑

```
INIT → SCAN → DEPENDENCY ─┬─→ ANALYZE → GENERATE → VALIDATE ─→ DONE
                          │                        │
                          └→ INCREMENTAL ──────────┘
                                                   │
                                        ┌── 失败 ──┘
                                        ↓
                                    FEEDBACK → 回退
```

## 文档

- [架构设计文档](docs/design/architecture.md) — 完整的架构、数据规范、状态管理设计
- [LLM Wiki (karpathry)](docs/LLM-Wiki_karpathry.md) — 原始思想参考

## 快速开始

**新会话一键启动**：复制 `PROMPT.md` 中的模板，替换项目路径即可。

或手动执行：

1. 安装依赖：
```bash
npm install
```

2. 告诉 Agent 加载 `aw-orchestrator` Skill：
```
帮我分析这个项目，生成 Wiki
```

3. Agent 会自动：
   - 加载 `aw-orchestrator` Skill
   - 按 DAG 顺序执行各阶段
   - 在 `wiki/` 目录生成最终文档

## 技术栈

| 功能 | 库 | 核心理由 |
|------|-----|---------|
| AST 解析 | `@babel/parser` + `@babel/traverse` | 最成熟，支持 JSX/TSX |
| 依赖图 | `dependency-cruiser` | 原生 Mermaid 输出 + 循环检测 |
| Git 操作 | `simple-git` | 链式 API，内置 diff 解析 |
| 文件扫描 | `globby` | 自动 gitignore，性能最佳 |
| Markdown | `remark` + `gray-matter` | 工业标准，Frontmatter 支持 |

## License

Apache
