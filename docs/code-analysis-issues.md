# AgenticWiki 深度分析：各阶段流程设计意图与潜在问题

> **生成时间**：2026-06-28
> **分析对象**：AgenticWiki 流水线（INIT → SCAN → DEPENDENCY → GEN → ASSEMBLE → VALIDATE + 增量模式）
> **分析维度**：各阶段流程设计意图、潜在 bug、设计缺陷
> **分析方法**：源码走查 + 跨阶段一致性比对 + 路径格式追踪 + 状态流转验证

---

## 目录

- [一、整体架构设计意图](#一整体架构设计意图)
- [二、各阶段流程分析与潜在问题](#二各阶段流程分析与潜在问题)
  - [1. INIT 阶段](#1-init-阶段)
  - [2. SCAN 阶段](#2-scan-阶段)
  - [3. DEPENDENCY 阶段](#3-dependency-阶段)
  - [4. GEN 阶段（最复杂，问题最多）](#4-gen-阶段最复杂问题最多)
  - [5. ASSEMBLE 阶段](#5-assemble-阶段)
  - [6. VALIDATE 阶段](#6-validate-阶段)
  - [7. 增量模式（横跨多阶段）](#7-增量模式横跨多阶段)
  - [8. 跨阶段问题](#8-跨阶段问题)
- [三、问题严重性汇总](#三问题严重性汇总)
- [四、优先修复建议](#四优先修复建议)

---

## 一、整体架构设计意图

该项目是一个 **Agent 驱动的前端代码 → Wiki 转换系统**，核心设计思路：

1. **Runner 统一编排**：`runner.ts` 作为唯一入口，将 6 个阶段（INIT→SCAN→DEPENDENCY→GEN→ASSEMBLE→VALIDATE）串联为 DAG，自动调度 33 个脚本
2. **GEN 阶段人机协作**：Runner 自动调度到 GEN 阶段后暂停，由 Agent spawn SubAgent 执行实际的 LLM 分析，再通过 `--resume` 断点续跑
3. **聚簇优化**：用依赖关系 BFS 聚簇替代文件夹+角色划分，减少 SubAgent 数量
4. **增量更新**：Git diff → 依赖传播 BFS → 标记受影响任务 → 仅重跑受影响部分

---

## 二、各阶段流程分析与潜在问题

### 1. INIT 阶段

**设计意图**：扫描项目技术栈 + 计算文件哈希 + 初始化 state.json

**潜在问题**：

#### [BUG-1] `initializeState` 覆写 state.config.paths.projectRoot 为 dataRoot

```typescript
59:153:src/lib/pipeline/state-utils.ts
      state.config.paths.projectRoot = paths.dataRoot;
```

在 monorepo 模式下（`--source packages/muya/src`），`dataRoot` 是包目录而非 monorepo 根。`initializeState` 将 `config.paths.projectRoot` 改写为 `dataRoot`。但 `validatePathRules`（path-resolver.ts:273）校验的是 `paths.projectRoot`（原始 monorepo 根），而 state 中存的却是 `dataRoot`。这导致 **state.json 中的 projectRoot 与实际校验的不一致**，后续脚本读取 `state.config.paths.projectRoot` 时拿到的是包目录，而非 monorepo 根。

---

### 2. SCAN 阶段

**设计意图**：扫描源码文件 + 过滤样式/资源文件

**潜在问题**：

#### [BUG-2] file-list.json 与 dependency-graph.json 路径格式不一致

`scan-files.ts` 使用 `globby({ cwd: sourcePath, absolute: false })`，存储的路径**相对于 sourceRoot**（如 `foo.ts`）。

而 `build-deps.ts` 的 `transformCruiserOutput` 中 `relativize()` 以 `projectPath`（= `sourcePath/..`，即 sourceRoot 的父目录）为基准计算相对路径：

```typescript
196:213:src/lib/dependency/build-deps.ts
  function relativize(cruiserPath: string): string {
    if (!cruiserPath) return cruiserPath;
    const absolute = path.resolve("/tmp", cruiserPath);
    try {
      const realBase = fs.realpathSync(resolvedBase);
      const realFile = fs.realpathSync(absolute);
      const rel = path.relative(realBase, realFile);
```

当 dependency-cruiser 输出绝对路径时，`path.relative(sourceRoot父目录, 文件)` 会包含 sourceRoot 的最后一段目录名（如 `src/foo.ts`），而 file-list.json 中是 `foo.ts`。

这会导致 `cluster-tasks.ts` 中 `moduleMap.get(file)` 查找失败（file 来自 file-list，key 来自 depGraph），**聚簇的依赖 BFS 遍历完全失效**，所有组件退化为按目录分组的孤儿聚簇。同理，`file-priorities.ts` 交叉比对两个文件时也会受影响。

> 注：此问题取决于 dependency-cruiser 的实际输出格式。如果输出的是相对于分析根的路径且 realpath 失败走 fallback，则路径可能匹配。但这是一个**脆弱的隐式依赖**，缺乏显式归一化保障。

---

### 3. DEPENDENCY 阶段

**设计意图**：构建依赖图 + 优先级计算 + 文件夹策略 + 子图提取 + 文件元信息 + 依赖聚簇

**潜在问题**：

#### [设计缺陷-1] 依赖图构建使用 `cwd: "/tmp"` 导致路径归一化脆弱

```typescript
57:63:src/lib/dependency/build-deps.ts
    const result = execFileSync(binPath, args, {
      cwd: "/tmp",
```

dependency-cruiser 在 `/tmp` 下运行，输出的 `source` 路径格式取决于其版本行为。`relativize()` 先尝试 `path.resolve("/tmp", cruiserPath)` 再 `realpathSync`，如果文件不存在则走 fallback 剥离逻辑。这种**双路径策略**（realpath 成功 vs fallback）会产生不同格式的路径，且依赖文件系统状态（realpath 是否成功），非常脆弱。

#### [BUG-3] `cluster-tasks.ts` 聚簇算法中 `assigned` 集合在跳过小聚簇时未回滚

```typescript
528:531:src/lib/dependency/cluster-tasks.ts
    // Skip tiny clusters — they'll be reassigned in orphan step
    if (tokens < TH.minCluster && clusters.length > 0) {
      // Don't assign these files yet — leave them for orphan processing
      continue;
    }
```

当聚簇 token 数小于 `minCluster` 时跳过，但 `clusterFiles` 中的文件**并未加入 `assigned` 集合**（因为 continue 在赋值之前）。这是设计意图——让小聚簇文件留给 orphan 处理。但问题是：这些文件的 seed 已经被 `seeds` 循环消费，**后续 seed 不会再次处理它们**。如果 orphan 步骤的 `findBestMergeTarget` 找不到合适的合并目标（比如所有聚簇目录前缀都不匹配），这些文件会被**静默丢弃**，不出现在任何聚簇中。

---

### 4. GEN 阶段（最复杂，问题最多）

**设计意图**：调度 SubAgent + 生成 Prompt + 暂停等待 Agent 操作 + 断点续跑 + 产物验证

#### [BUG-4] 动态批次大小是死代码——永远不会执行

AGENTS.md 和 README 都声称"动态批次大小 `ceil(pending/3)`，最低 10"，但实际代码：

```typescript
76:80:src/lib/pipeline/path-resolver.ts
    .option("limit", {
      type: "number",
      default: 5,
      description: "GEN 阶段每批任务数",
    })
```

yargs 设置了 `default: 5`，所以 `args.limit` **永远是 5**（除非用户显式传 `--limit`）。然后在 phase-definitions.ts：

```typescript
268:286:src/lib/pipeline/phase-definitions.ts
      if (args.tokenLimit && args.tokenLimit > 0) {
        genArgs.push("--token-limit", String(args.tokenLimit));
      } else if (args.limit !== undefined && args.limit > 0) {
        genArgs.push("--limit", String(args.limit));
      } else {
        // Dynamic default: read pending genTasks, compute batch size as ceil(total / 3).
```

由于 `args.limit` 恒为 5（非 undefined），`else if` 分支恒胜出，**dynamic 分支永远不可达**。文档声称的动态批次大小功能实际未生效，GEN 阶段始终使用固定 limit=5。

#### [BUG-5] resume 自动重置逻辑使用陈旧的内存状态覆盖磁盘状态

```typescript
337:354:src/runner.ts
      runScript(
        "gen/sync-gen-tasks.ts",
        ["--state", paths.statePath, "--wiki", paths.wikiRoot, "--write"],
        paths.libDir,
        paths.projectRoot,
      );
      console.log("  🔍 验证 SubAgent 产物...");
      runScript(
        "gen/verify-gen-artifacts.ts",
        [...],
        paths.libDir,
        paths.projectRoot,
      );
```

在 resume 路径中，`sync-gen-tasks.ts` 和 `verify-gen-artifacts.ts` 通过 `atomicUpdate` 修改了磁盘上的 `state.json`。但内存中的 `state` 变量（runner.ts:110 加载）**未重新读取**。随后自动重置逻辑：

```typescript
407:434:src/runner.ts
          for (const task of state?.genTasks || []) {
            // ... modify task.status ...
          }
          if (resetCount > 0 || failCount > 0) {
            fs.writeJsonSync(paths.statePath, state, { spaces: 2 });
          }
```

直接用**陈旧的内存 state** 覆盖磁盘 state，**丢失 sync-gen-tasks 刚写入的 completed 状态更新**。这会导致已完成的任务被回退，引发重复调度或状态不一致。

#### [BUG-6] Monorepo 模式下反馈注入路径不匹配

```typescript
40:46:src/lib/pipeline/setup.ts
export function ensureFeedbackSeed(feedbackRoot: string): void {
  const feedbackPath = path.join(
    feedbackRoot, ".agentic-wiki", "feedback", "prompts.md",
  );
```

`ensureFeedbackSeed` 接收 `paths.dataRoot`（runner.ts:114），写入 `dataRoot/.agentic-wiki/feedback/prompts.md`。

但 `injectFeedbackIntoPrompts` 读取的是 `projectRoot`：

```typescript
124:129:src/lib/pipeline/gen-helpers.ts
  const projectFeedbackPath = path.join(
    projectRoot, ".agentic-wiki", "feedback", "prompts.md",
  );
```

在 monorepo 模式下，`dataRoot` = 包目录（如 `packages/muya`），`projectRoot` = monorepo 根。**反馈文件写在包目录下，但注入时从 monorepo 根读取**——读不到文件，注入空反馈。`recordFailure` 的 fallback 路径（gen-helpers.ts:249-253）同样使用 `projectRoot`，写入错误位置。

#### [BUG-7] 增量模式在 Monorepo 下依赖传播失效

```typescript
140:182:src/runner.ts
    const gitCmd = `git -C "${paths.projectRoot}" diff --name-only ${args.since}...HEAD`;
    // ...
    const affectedFiles = propagateDeps(sourceChanged, depGraph);
```

`git diff` 返回的路径相对于 `projectRoot`（monorepo 根），如 `packages/muya/src/foo.ts`。但 depGraph 中的 `mod.source` 路径是相对于 `sourceRoot/..`（即 `packages/muya`），如 `src/foo.ts`。

`propagateDeps` 执行 `moduleMap.get(file)`：

```typescript
283:296:src/lib/pipeline/gen-helpers.ts
  const moduleMap = new Map<string, ModuleInfo>();
  for (const mod of depGraph.modules) moduleMap.set(mod.source, mod);
  while (queue.length > 0) {
    const file = queue.shift()!;
    const mod = moduleMap.get(file);
    if (!mod) continue;
```

**key 不匹配**（`packages/muya/src/foo.ts` vs `src/foo.ts`），`moduleMap.get()` 返回 undefined，依赖传播**静默失效**，影响范围计算为 0，增量更新无法正确标记受影响任务。

#### [BUG-8] `outputGenPrompts` 的并发数提示与实际批次不一致

```typescript
80:81:src/lib/pipeline/gen-helpers.ts
  console.log(
    `   2. 使用 spawn_agent 工具启动 SubAgent（每次 ${limit || toRun.length} 个并发）`,
  );
```

`limit` 始终为 5（runner.ts:586 `args.limit || 5`），但 gen-scheduler 实际可能使用 token-limit 或动态 limit 调度。Agent 看到的并发提示与实际调度批次不符。

#### [设计缺陷-2] `verify-gen-artifacts.ts` 退出码语义误导

```typescript
710:714:src/lib/gen/verify-gen-artifacts.ts
  if (report.summary.allPassed) {
    process.exit(0);
  } else {
    process.exit(1);
  }
```

有任何 Issue 链接失败（即使是非关键的 orphaned issue）就退出 1。runner.ts 在 resume 路径中调用它但不检查返回值（344-354），所以不会阻塞。但 `runScript` 会将 stderr 作为错误输出捕获并丢弃，**验证报告的控制台输出被吞掉**，用户看不到详细验证结果。

---

### 5. ASSEMBLE 阶段

**设计意图**：同步状态 + 进度面板 + 符号索引 + Issue 去重 + 修复路径 + 组装成书

**潜在问题**：

#### [BUG-9] `assemble-book.ts` 缺少 `--clusters` 时仍依赖 `folder-strategy.json`

```typescript
297:308:src/lib/pipeline/phase-definitions.ts
      const assembleBookArgs = [
        "--wiki", wikiRoot,
        "--strategy", path.join(cacheRoot, "folder-strategy.json"),
      ];
      const clustersPath = path.join(cacheRoot, "task-clusters.json");
      if (fs.existsSync(clustersPath)) {
        assembleBookArgs.push("--clusters", clustersPath);
      }
```

即使聚簇模式生效（`task-clusters.json` 存在），`assemble-book.ts` 仍然被传入 `--strategy folder-strategy.json`。如果 `folder-strategy.json` 中的 subTasks 与聚簇任务不对应（聚簇模式下 folder-strategy 只是 fallback），组装可能产生错乱。需确认 `assemble-book.ts` 是否优先使用 clusters。

---

### 6. VALIDATE 阶段

**设计意图**：交叉引用验证 + 源码引用校验（非关键错误不阻塞）

**潜在问题**：

#### [设计缺陷-3] VALIDATE 阶段全部标记为 non-critical

```typescript
382:407:src/lib/pipeline/phase-definitions.ts
    case "VALIDATE":
      return define(5, "交叉引用验证 + 源码引用校验", [
        script("validate/validate-references.ts", [...], false),
        script("validate/validate-code-refs.ts", [...], false),
      ]);
```

两个验证脚本都标记为 `critical: false`，意味着**即使验证完全失败，流水线也会标记 VALIDATE 为 completed**。验证失败的 Issue 不会阻塞流程，也不会触发反馈循环。VALIDATE 阶段形同虚设——它的结果不影响任何后续行为。

---

### 7. 增量模式（横跨多阶段）

#### [BUG-10] 增量模式 `--limit` 硬编码为 5，不使用动态批次

```typescript
234:235:src/runner.ts
        "--limit",
        String(args.limit ?? 5),
```

增量模式始终使用 `args.limit ?? 5`（= 5），而全量模式（phase-definitions.ts）本应使用动态 `ceil(pending/3)`（虽然因 BUG-4 也不生效）。增量模式的批次大小与全量模式不一致。

#### [BUG-11] 增量模式不处理 Issue 状态更新（stale 标记）

`git-diff.ts` 中的 `computeAffectedIssues` 能识别受影响的 Issue 并标记为 `stale`/`recheck`，但 runner.ts 的增量模式流程（129-249）**完全未调用此功能**。增量更新后，源文件已变更的 Issue 仍保持 `detected` 状态，不会标记为 `stale`，违反了 AGENTS.md 声称的"Issue 状态机：增量模式源文件变更→stale"。

---

### 8. 跨阶段问题

#### [BUG-12] `WikiState` 类型双重定义导致类型不一致

- `state-utils.ts` 定义了简化的 `WikiState`（无 `createdAt`、`checkpoint`，`GenTask` 无 `retryCount`/`lastError`）
- `types/index.ts` 定义了完整的 `WikiState`（含 `createdAt`、`checkpoint`，`GenTask` 有 `retryCount`/`lastError`）

runner.ts 使用 state-utils.ts 的类型，但 gen-scheduler.ts 使用 types/index.ts 的类型。runner.ts:414 访问 `task.retryCount` 在 state-utils.ts 的 GenTask 类型上不存在（运行时因 JSON 解析可能存在，但**类型检查不安全**）。

#### [BUG-13] `computePhaseRange` 在 startPhase > ASSEMBLE 时产生错误顺序

```typescript
60:66:src/lib/pipeline/phase-definitions.ts
  if (effectiveTarget === "DONE") {
    for (const p of ["ASSEMBLE", "VALIDATE"] as const) {
      if (!phasesToRun.includes(p)) phasesToRun.push(p);
    }
  }
```

当 `startPhase = "VALIDATE"` 且 `targetPhase = "DONE"` 时，phasesToRun = `["VALIDATE"]`，然后追加 ASSEMBLE → `["VALIDATE", "ASSEMBLE"]`。**VALIDATE 在 ASSEMBLE 之前执行**，违反 DAG 顺序。

#### [BUG-14] `--only ASSEMBLE` 不检查 GEN 是否完成

`computePhaseRange` 不验证前置依赖。`--only ASSEMBLE` 会在 GEN 未完成时直接运行组装，生成不完整的 book.md，且不会报错或警告。

---

## 三、问题严重性汇总

| 编号 | 严重性 | 阶段 | 问题 |
|:---|:---:|:---|:---|
| BUG-4 | 🔴 高 | GEN | 动态批次大小死代码，文档声称功能未生效 |
| BUG-5 | 🔴 高 | GEN | resume 自动重置用陈旧内存覆盖磁盘状态 |
| BUG-6 | 🔴 高 | GEN | Monorepo 反馈注入路径不匹配 |
| BUG-7 | 🔴 高 | 增量 | Monorepo 增量模式依赖传播失效 |
| BUG-2 | 🟠 中 | SCAN/DEPENDENCY | file-list 与 depGraph 路径格式潜在不一致 |
| BUG-10 | 🟠 中 | 增量 | 增量模式批次大小硬编码 |
| BUG-11 | 🟠 中 | 增量 | Issue stale 状态未更新 |
| BUG-12 | 🟠 中 | 跨阶段 | WikiState 类型双重定义 |
| BUG-13 | 🟡 低 | 跨阶段 | computePhaseRange 顺序错误（边缘场景） |
| BUG-14 | 🟡 低 | 跨阶段 | --only 不检查前置依赖 |
| BUG-1 | 🟡 低 | INIT | state.projectRoot 被覆写为 dataRoot |
| BUG-3 | 🟡 低 | DEPENDENCY | 小聚簇文件可能静默丢弃 |
| BUG-8 | 🟡 低 | GEN | 并发提示与实际批次不一致 |
| BUG-9 | 🟡 低 | ASSEMBLE | 聚簇模式下仍传 folder-strategy |
| 设计缺陷-1 | 🟡 低 | DEPENDENCY | cwd:/tmp 导致路径归一化脆弱 |
| 设计缺陷-2 | 🟡 低 | GEN | verify 退出码语义误导 |
| 设计缺陷-3 | 🟡 低 | VALIDATE | 验证全 non-critical，形同虚设 |

---

## 四、优先修复建议

**最需要优先修复的 4 个问题**：BUG-4、BUG-5、BUG-6、BUG-7。这 4 个问题直接影响核心功能正确性，且在 Monorepo 场景下必然触发。

### BUG-4 修复建议

移除 yargs 的 `default: 5`，改为 `default: undefined`，让 dynamic 分支可达：

```typescript
// path-resolver.ts
.option("limit", {
  type: "number",
  description: "GEN 阶段每批任务数（默认动态计算 ceil(pending/3)）",
})
```

### BUG-5 修复建议

在调用 `sync-gen-tasks.ts` 和 `verify-gen-artifacts.ts` 之后，**重新加载内存 state**：

```typescript
// runner.ts — 在 verify-gen-artifacts 之后、自动重置之前
state = loadState(paths.statePath);
```

### BUG-6 修复建议

统一使用 `dataRoot` 作为反馈路径基准：

```typescript
// gen-helpers.ts — injectFeedbackIntoPrompts 需要接收 dataRoot 参数
// 或将 recordFailure 的 fallback 路径改为 dataRoot
const projectFeedbackPath = path.join(
  dataRoot, ".agentic-wiki", "feedback", "prompts.md",
);
```

### BUG-7 修复建议

在 `propagateDeps` 之前，将 git diff 路径归一化到 depGraph 的路径基准：

```typescript
// runner.ts — 增量模式中
// 将 monorepo 根相对路径转换为 sourceRoot 相对路径
const sourceRelative = path.relative(projectRoot, sourceRoot); // 如 "packages/muya/src"
const normalizedChanged = sourceChanged
  .filter(f => f.startsWith(sourceRelative + "/"))
  .map(f => f.slice(sourceRelative.length + 1)); // 转为 "foo.ts"
const affectedFiles = propagateDeps(normalizedChanged, depGraph);
```

---

## 附录：分析依据

本文档基于以下源码文件分析：

- `src/runner.ts` — 主入口与流水线编排
- `src/lib/pipeline/` — 路径解析、阶段定义、状态管理、脚本运行、GEN 辅助
- `src/lib/scan/` — 文件扫描
- `src/lib/dependency/` — 依赖图、优先级、聚簇、文件元信息
- `src/lib/gen/` — GEN 调度、状态同步、产物验证
- `src/lib/shared/` — state-manager、git-diff
- `src/types/index.ts` — 类型定义
- `AGENTS.md` / `README.md` — 项目文档与声称的行为

所有代码引用均标注 `行号:行号:文件路径` 格式，便于定位。
