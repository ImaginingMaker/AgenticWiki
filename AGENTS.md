# AgenticWiki — Agent 操作手册

> **阅读对象**：LLM Agent | **唯一切入点**：`README.md`

## 1. 这是什么？

Agent 驱动的前端代码 → Wiki 转换系统。

**核心原则**：Agent 运行 `runner.ts`，Runner 自动编排脚本，Agent 只需在 GEN 阶段 spawn SubAgent。

---

## 2. 路径铁律

**只需记住一条**：`--project` 指向被分析的项目，不要指向 AgenticWiki 自身。

Runner 启动时自动校验 5 条规则（含 sourceRoot 存在性检查），违反则阻断。

---

## 3. 入口

Agent 读 `README.md` → 选模式 → 运行命令。

| 模式 | 命令 | 说明 |
|:---|:---|:---|
| 首次全量 | `npx tsx src/runner.ts --project <path>` | 初始化项目，分批调度 LLM |
| 首次全量（monorepo） | `npx tsx src/runner.ts --project <path> --source packages/muya/src` | 指定 monorepo 子包的源码目录 |
| 断点续跑 | `npx tsx src/runner.ts --project <path> --resume` | 检查状态，继续未完成的 GEN 任务 |
| 增量更新 | `npx tsx src/runner.ts --project <path> --mode incremental --since HEAD~1` | Git diff → 依赖传播 → 标记受影响部分 → 暂停 |

**典型工作流**：首次全量 → GEN 暂停 → spawn SubAgent → 断点续跑 → ... 反复直到 DONE。项目更新后走增量更新。

> 💡 **Monorepo 数据隔离**：`--source packages/<包名>/src` 时，
> `.agentic-wiki/` 和 `wiki/` 存放在该包目录下，多个包可同时独立分析。

> 💡 DEPENDENCY 阶段自动生成 `file-meta.json`（文件元信息）和 `task-clusters.json`（依赖聚簇）。
> GEN 阶段自动检测：如有 `task-clusters.json` 则使用聚簇模式（SubAgent 减少 50-60%），
> 否则回退到文件夹模式。**整个过程全自动，Agent 无需干预。**

---

## 4. 目录速览

```
src/
  runner.ts           # 统一流水线入口（Agent 只需知道这个）
  dag-definition.ts    # 已删除（逻辑内联到 runner.ts）
  types/index.ts       # TypeScript 类型定义
  lib/                 # 按功能分 7 子目录：scan/ dependency/ gen/ assemble/ validate/ shared/ pipeline/
  lib/__tests__/          # 32 个测试文件（651 个用例）

docs/
  feedback/            # 跨项目通用改进策略
  reference/           # 参考资料

运行时生成：
.agentic-wiki/
  templates/           # GEN 阶段自动生成的 SubAgent 模板（issue-rules.md, output-format.md, path-safety.md）
```

---

## 5. Runner 自动完成的功能

- **ESLint 检查**（`npm run lint` 扫描全量 TypeScript，无 error 通过）
- 路径自检（5 条铁律）
- 状态管理（state.json 全生命周期）
- 脚本调度（28 个脚本参数自动拼接）
- 门控验证（每阶段产物完整性）
- 反馈注入（global-strategies.md + prompts.md → SubAgent prompt）
- 失败记录（自动追加到 prompts.md）
- 进度同步（ASSEMBLE 阶段自动 sync + progress）
- 增量检测（Git diff → 依赖传播 BFS → 标记受影响 genTasks）
- **模板生成**（GEN 阶段自动生成 `issue-rules.md` / `output-format.md` / `path-safety.md` 到 `.agentic-wiki/templates/`）
- **Token 阈值调度**（支持 `--token-limit`，按 Token 数切分批次）
- **动态 Token 预算**（按文件夹大小分配 SubAgent Token 预算，小文件夹不再配 80K 固定值）
- **动态拆分阈值**（50K/30K/5K 硬编码 → 项目总 Token × 百分比）
- **入口文件内联**（纯 re-export 的 `index.ts` 自动合并到相邻 subTask，不单独生成）
- **文件元信息提取**（`extract-file-meta.ts` — DEPENDENCY 阶段预分析组件/Hook/Props/export）
- **依赖聚簇划分**（`cluster-tasks.ts` — 替代文件夹+角色，按依赖关系聚簇，subTask 减少 50-60%）

---

## 6. 故障排查

| 问题 | 排查 |
|:---|:---|
| Runner 启动阻断 | 确认 `--project` 指向目标项目，非 AgenticWiki 自身 |
| 产物缺失 | Runner 每阶段自动门控，查看控制台输出 |
| 状态异常 | `npx tsx src/runner.ts --project <path> --force` 重建 |
| dependency-cruiser 超时 | 增加 `--timeout` 或缩小范围 |
| GEN 阶段卡死 | `--resume` 续跑，Runner 自动跳过已完成任务 |
| SubAgent 提示模板文件不存在 | `.agentic-wiki/templates/` 首次 GEN 自动生成，检查文件夹是否存在 |
| SubAgent 找不到 file-meta.json | 检查 `.agentic-wiki/cache/file-meta.json` 是否存在（DEPENDENCY 阶段自动生成） |
| 聚簇模式未生效 | 检查 `.agentic-wiki/cache/task-clusters.json` 是否存在。删除后会自动回退到文件夹模式 |
| 增量模式提示无变更 | 确认 `--since` 指向正确的基准 commit（如 HEAD~1） |
| 增量模式依赖图缺失 | 先运行一次完整的模式 A 生成全量分析结果 |
| 增量模式全量重跑 | 某个底层依赖（如 utils/）被改动，传播了大量上层文件，这是预期行为 |
| Monorepo 根无 `src/` 导致阻断 | Runner 自动探测并列出候选包，用 `--source packages/<包名>/src` 指定 |
| `--source` 路径错误 | Rule 5 验证会阻断并提示 `NOT FOUND`，修正路径后重试 |

---

## 8. 开发纪律

> 修改脚本或文档时，必须同步更新入口文档并保证测试通过。

### 文档同步（强约束）

Dev 阶段**修改任何脚本或文档**后，必须同步更新以下入口文档中的对应描述：

| 修改了什么 | 必须同步更新的文档 |
|:---|:---|
| `src/lib/` 下的脚本（新增/改名/删除/行为变更） | `README.md`（架构表格、阶段描述、脚本计数）+ `AGENTS.md`（目录速览、脚本计数、Automated 列表） |
| 新增/删除 CLI 参数 | `README.md`（参数速查表）+ `AGENTS.md`（入口表格） |
| `docs/` 下的反馈策略或参考资料 | `AGENTS.md`（目录速览中的文档索引）+ `README.md`（如有引用） |
| `src/runner.ts` 流水线逻辑变更 | `README.md`（阶段表格、工作流）+ `AGENTS.md`（Automated 列表、故障排查） |
| 新增/删除/重命名 `src/lib/__tests__/` 测试文件 | `AGENTS.md`（目录速览中的测试用例计数） |

> **检查清单**：改代码后，`grep` 搜索 `AGENTS.md` 和 `README.md` 中所有与被修改主题相关的描述，确保数字和描述一致。

### 测试纪律

| 约束 | 要求 |
|:---|:---|
| 全量通过 | 每次代码修改后 `npm test`（即 `vitest run`）必须全部通过 |
| 覆盖率阈值 | `npm run test:coverage` 必须满足 `vitest.config.js` 中设置的全局阈值（当前：lines ≥ 85%, functions ≥ 85%, branches ≥ 80%, statements ≥ 85%） |
| 新增脚本配套测试 | 新增加的 `src/lib/*.ts` 脚本原则上应配套对应的 `src/lib/__tests__/*.test.ts` 测试文件 |

> 💡 当前有部分历史脚本（如 `assemble-book.ts`、`gen-scheduler.ts`、`validate-*` 等）覆盖率较低，属于遗留债。**新改代码不允许降低已有覆盖率**，新增文件的覆盖率目标 ≥ 前面规定的全局阈值。

```bash
# 快速验证
npm test                  # 全量测试通过
npm run lint              # ESLint 检查（无 error 可通过）
npm run test:coverage     # 覆盖率达标
```

---

## 7. 文档索引

| 文档 | 用途 |
|:---|:---|
| `README.md` | 🔴 唯一切入点 |
| `docs/feedback/global-strategies.md` | 全局改进策略 |
| `docs/reference/LLM-Wiki_karpathry.md` | LLM Wiki 原始思想参考 |
| `src/types/index.ts` | TypeScript 类型字典 |
