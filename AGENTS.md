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

> ⚠️ **state.json.genTasks 不是全量任务清单**：`state.json` 的 `genTasks` 数组只记录
> **已被调度到运行队列的任务**（由 gen-scheduler 的 `--write-state` 分批写入），不是全部待分析任务。
> 真实总任务数在 `task-clusters.json`（聚簇模式）或 `folder-strategy.json`（文件夹模式）中。
> 查询进度时，应同时交叉核对 `task-clusters.json` / `folder-strategy.json` 和 `gen-schedule.json` 的 summary。

---

## 4. 目录速览

```
src/
  runner.ts           # 统一流水线入口（Agent 只需知道这个）
  dag-definition.ts    # 已删除（逻辑内联到 runner.ts）
  types/index.ts       # TypeScript 类型定义
  lib/                 # 按功能分 7 子目录（含 shared/issue-parser.ts 统一解析器）：scan/ dependency/ gen/ assemble/ validate/ shared/ pipeline/
  lib/__tests__/          # 35 个测试文件（740 个用例）

docs/
  wiki-book/           # 项目全貌 WIKI 书册（12 章 + 子章节，结构化拆分，附录含辅助工具文档）
  feedback/            # 跨项目通用改进策略
  reference/           # 参考资料

scripts/               # 独立辅助脚本（不参与 Runner 流水线，仅人工使用）
  export-issues-csv.ts # 将 volume-2-issues 批量导出为 CSV 汇总文件

运行时生成：
.agentic-wiki/
  cache/              # Runner 各阶段产物（project-scan.json, dependency-graph.json, task-clusters.json, gen-schedule.json 等）
```

---

## 5. Runner 自动完成的功能

- **ESLint 检查**（`npm run lint` 扫描全量 TypeScript，无 error 通过）
- 路径自检（5 条铁律）
- 状态管理（state.json 全生命周期）
- 脚本调度（33 个脚本参数自动拼接）
- 门控验证（每阶段产物完整性）
- 反馈注入（global-strategies.md + prompts.md → SubAgent prompt）
- 失败记录（自动追加到 prompts.md）
- 进度同步（ASSEMBLE 阶段自动 sync + progress）
- 增量检测（Git diff → 依赖传播 BFS → FileTaskIndex 标记受影响 genTasks）
- **Token 预算 v3**（分段计算：≤10K→2.5x+8K, ≤50K→2.0x+10K, >50K→1.5x+15K，上限 200K，替代旧 80K 硬限制）
- **12 章节 Wiki**（Prompt 内置 12 章结构模板：需求背景/架构/技术实现/公共组件索引/设计决策/使用示例等）
- **Issue 去重**（ASSEMBLE 阶段自动运行 `dedup-issues.ts`，按 type+source_files 匹配归档重复 Issue）
- **Issue 状态机**（验证通过→verified，失败→disputed，增量模式源文件变更→stale）。增量模式 runner 自动调用 `computeAffectedIssues` 识别受影响 Issue 并通过 `markIssuesStale` 更新状态
- **前置阶段依赖门控**（`--only ASSEMBLE` 时校验 GEN 已完成，`--only VALIDATE` 校验 ASSEMBLE 已完成；`--skip-deps-check` 可跳过，高级用法）
- **computePhaseRange DAG 顺序保障**（`VALIDATE→DONE` 等边缘场景下结果始终按 DAG_ORDER 排序，不会出现 VALIDATE 先于 ASSEMBLE 执行）
- **FileTaskIndex 双向索引**（`build-file-task-index.ts` 构建文件↔任务映射，增量模式同时支持聚簇/文件夹策略）
- **入口文件内联**（纯 re-export 的 `index.ts` 自动合并到相邻 subTask，不单独生成）
- **文件元信息提取**（`extract-file-meta.ts` — DEPENDENCY 阶段预分析组件/Hook/Props/export）
- **依赖聚簇划分**（`cluster-tasks.ts` — 替代文件夹+角色，按依赖关系聚簇，subTask 减少 50-60%）
- **聚簇命名多数投票**（`cluster-tasks.ts` — 按文件目录多数分布决定聚簇名称，过滤 `src/`、`common`、`hooks` 等通用目录，避免以 seed 组件名为准导致误命名）
- **非关键阶段标记**（`validate-references.ts` 标记为非关键，即使有 sourceFiles 缺失也不阻塞流水线）
- **进度面板聚簇感知**（ASSEMBLE 阶段 `progress-dashboard.ts` 优先从 `state.genTasks` 构建仪表盘，而非 `folder-strategy.json`，聚簇模式正确显示 100%）
- **SubAgent 产物自检**（SubAgent prompt 内置步骤 3.5，指导 SubAgent 在写入后立即用 `ls -la` 验证文件存在且非空）
- **SubAgent 完成标记**（SubAgent prompt 步骤 5 写入 `.gen-done` 标记文件，`verify-gen-artifacts.ts` 在恢复时检查此标记并校验内容格式，缺失或格式错误则判定为未完成）
- **状态-磁盘一致性检查**（`verify-gen-artifacts.ts` 检测标记为 completed 但目录缺失的任务，自动重置为 pending，最多重试 3 次后标记 failed 跳过）
- **Prompts 目录选择性清理**（`gen-scheduler.ts` 不再清空整个 gen-prompts 目录，仅清理已完成任务的 prompt，保留待处理任务的 prompt）
- **GEN 批次控制**（`--limit` 默认 5，可通过 CLI 覆盖；`--token-limit` 按 Token 预算调度）
- **state.json 增量累积**（gen-scheduler 的 `--write-state` 按批写入 `genTasks`，只记录已调度过的任务，非全量。完整任务列表在 `task-clusters.json` 或 `folder-strategy.json` 中）

---

## 6. 故障排查

| 问题 | 排查 |
|:---|:---|
| Runner 启动阻断 | 确认 `--project` 指向目标项目，非 AgenticWiki 自身 |
| 产物缺失 | Runner 每阶段自动门控，查看控制台输出 |
| 状态-磁盘不一致 | Runner 自动重置为 pending（最多 3 次），超过后标记 failed 跳过。查看控制台输出确认具体失败任务 |
| 状态异常 | `npx tsx src/runner.ts --project <path> --force` 重建 |
| dependency-cruiser 超时 | 增加 `--timeout` 或缩小范围 |
| GEN 阶段卡死 | `--resume` 续跑，Runner 自动跳过已完成任务 |
| SubAgent 模板文件不存在 | v3 已移除模板外置机制，Issue 规则直接内联在 SubAgent prompt 中 |
| SubAgent 找不到 file-meta.json | 检查 `.agentic-wiki/cache/file-meta.json` 是否存在（DEPENDENCY 阶段自动生成） |
| 聚簇模式未生效 | 检查 `.agentic-wiki/cache/task-clusters.json` 是否存在。删除后会自动回退到文件夹模式 |
| 增量模式提示无变更 | 确认 `--since` 指向正确的基准 commit（如 HEAD~1） |
| 增量模式依赖图缺失 | 先运行一次完整的模式 A 生成全量分析结果 |
| 增量模式全量重跑 | 某个底层依赖（如 utils/）被改动，传播了大量上层文件，这是预期行为 |
| Monorepo 根无 `src/` 导致阻断 | Runner 自动探测并列出候选包，用 `--source packages/<包名>/src` 指定 |
| `--source` 路径错误 | Rule 5 验证会阻断并提示 `NOT FOUND`，修正路径后重试 |
| SubAgent 产物被标记为缺失 | 检查 wiki 目录下是否有 `.gen-done` 标记文件（SubAgent 未完成写入），重新 dispatch SubAgent |
| 聚簇命名不符合预期 | 检查聚簇文件的目录分布，`computeClusterName` 按多数目录投票命名，排除 `src/` `common` `hooks` 等通用目录 |
| dep-graph 与 file-list 路径不一致 | `build-deps.ts` 的 `transformCruiserOutput` 已统一以 sourceRoot 为归一化基准（所有 cache 产物路径均相对 sourceRoot）。升级 dependency-cruiser 后如再现，删除 `dependency-graph.json` 重跑 |
| 增量模式 Issue 未标记 stale | runner 增量流程已接入 `computeAffectedIssues`，自动将源文件变更的 Issue 标记为 stale。若未生效，检查 `wiki/volume-2-issues/` 是否存在 Issue 文件 |
| `--only ASSEMBLE` 被阻断 | 前置依赖门控要求 GEN 已完成。如确认要跳过，加 `--skip-deps-check`（高级用法，可能生成不完整产物） |
| state.json 任务数远少于预期 | **正常现象**。`state.json.genTasks` 只记录已调度批次，非全量。真实总数查看 `task-clusters.json`（聚簇模式）或 `folder-strategy.json`（文件夹模式）。当前调度进度见 `gen-schedule.json` 的 `summary` |

---

## 7. 开发纪律

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

## 8. 文档索引
| 文档 | 用途 |
|:---|:---|
| `README.md` | 🔴 唯一切入点 |
| `docs/wiki-book/` | 项目全貌 WIKI 书册（12 章，含子章节的完整结构化文档） |
| `docs/feedback/global-strategies.md` | 全局改进策略 |
| `docs/reference/LLM-Wiki_karpathry.md` | LLM Wiki 原始思想参考 |
| `src/types/index.ts` | TypeScript 类型字典 |
