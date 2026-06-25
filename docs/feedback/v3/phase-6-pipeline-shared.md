# Phase 6: PIPELINE + SHARED 基础设施重构

> 涉及脚本：`runner.ts` · `gen-helpers.ts` · `phase-definitions.ts` · `path-resolver.ts` · `script-runner.ts` · `state-manager.ts` · `id-utils.ts`
> 新增：`gen-resume-handler.ts`
> 依赖关系：依赖 Phase 2（FileTaskIndex）
> 核心目标：G1（增量路径重构）、#5（Resume 提取）、#6（反馈注入优化）、安全修复

---

## 1. 问题清单

### 1.1 runner.ts（622 行）

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| R1-1 | 🔴 | **增量模式硬编码 `folder-strategy.json`**（remaining-issues #2）：L183 读取 `folder-strategy.json`，`markAffectedGenTasks()` 只接受 `FolderStrategyResult`，聚簇项目增量完全失效 | L183-195 |
| R1-2 | 🔴 | **GEN resume 逻辑 170 行内联**（remaining-issues #5）：L298-468 包含 6 层缩进的状态检查、同步、验证、重试、重调度逻辑，全在 `main()` 中 | L298-468 |
| R1-3 | 🟡 | 增量模式的 `gen-scheduler` 调用硬编码 `--strategy`，不支持 `--clusters` | L203-219 |

### 1.2 gen-helpers.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| R2-1 | 🟡 | **反馈注入逐文件 I/O**（remaining-issues #6）：反馈内容被重复读取 N 次 | L156-178 |
| R2-2 | 🟡 | `markAffectedGenTasks` 只接受 `FolderStrategyResult`，不兼容聚簇 | L298-334 |
| R2-3 | 🟢 | `recordFailure` 通过 `execSync` 调用 `state-manager.ts CLI`，shell 拼接有注入风险 | L232-237 |

### 1.3 state-manager.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| R3-1 | 🔴 | **文件锁内部矛盾**：`acquireLock` 用 `mkdir`（目录锁），但 `pathExists` + `readJson` 检查旧版文件锁格式。目录锁存在时 `readJson(lockPath)` 会对目录报错，被误判为 stale 并删除合法锁 | L49-93 |
| R3-2 | 🔴 | **`unlock` CLI 命令失效**：`readJson(lockPath)` 对目录锁抛异常，`unlock` 命令永远无法正常工作 | L952-968 |
| R3-3 | 🟡 | **原型污染**：`setNested(obj, key, value)` 对 `__proto__`/`constructor`/`prototype` 无防护，CLI `--key "__proto__.x" --value "y"` 可触发 | L616-637 |
| R3-4 | 🟡 | `releaseLock` 处理 `.lock.legacy` 路径但项目中无任何代码生成此文件 — 死代码 | L151-153 |
| R3-5 | 🟡 | `appendFeedback` 使用同步 I/O，其他核心函数都是异步的，设计不一致 | L555-603 |
| R3-6 | 🟢 | `transitionPhase` 熔断到 `DONE` 时不创建 `phaseHistory` 记录 | L521-548 |

### 1.4 id-utils.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| R4-1 | 🟡 | `sanitizePathId` 保留 `-` 但 `sanitizeRole` 将 `-` 替换为 `_`，导致 ID 中 `-` 语义不明确，无法可靠分隔 folder/role | L19, L31 |
| R4-2 | 🟢 | `subTaskIdEquals` 函数未被任何外部代码调用 — 疑似死代码 | 全局 |

### 1.5 script-runner.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| R5-1 | 🟡 | `runScript` 使用 `execSync` 拼接 `npx tsx` 命令，路径含空格时可能断裂 | 命令拼接 |

---

## 2. 重构方案

### 2.1 runner.ts — 增量路径重构（G1 核心）

```typescript
// 替换 L183-195 的硬编码 folder-strategy.json 读取
import { buildFileTaskIndex } from "./lib/dependency/build-file-task-index.js";
import type { FileTaskIndex } from "./types/index.js";

// 增量模式段落
const clustersPath = path.join(paths.cacheRoot, "task-clusters.json");
const strategyPath = path.join(paths.cacheRoot, "folder-strategy.json");

let fileTaskIndex: FileTaskIndex;
if (fs.existsSync(clustersPath)) {
  const clusterResult = fs.readJsonSync(clustersPath);
  fileTaskIndex = buildFileTaskIndex(undefined, clusterResult);
} else if (fs.existsSync(strategyPath)) {
  const folderStrategy = fs.readJsonSync(strategyPath);
  fileTaskIndex = buildFileTaskIndex(folderStrategy, undefined);
} else {
  console.error("❌ 找不到 task-clusters.json 或 folder-strategy.json");
  process.exit(1);
}

const updated = markAffectedGenTasks(paths.statePath, affectedFiles, fileTaskIndex);
```

增量模式的 gen-scheduler 调用也需根据存在的文件自动选择 `--clusters` 或 `--strategy`。

### 2.2 提取 gen-resume-handler.ts（#5 核心）

将 runner.ts L298-468 提取为独立模块：

```typescript
// src/lib/pipeline/gen-resume-handler.ts
export interface ResumeResult {
  action: "continue" | "pause" | "done";
  message: string;
  updatedState?: WikiState;
}

export async function handleGenResume(
  paths: ResolvedPaths,
  state: WikiState,
  args: RunnerArgs,
): Promise<ResumeResult> {
  // Step 1: 反馈重注入
  const genPromptsDir = path.join(paths.cacheRoot, "gen-prompts");
  if (fs.existsSync(genPromptsDir)) {
    injectFeedbackIntoPrompts(genPromptsDir, paths.agenticWikiRoot, paths.projectRoot);
  }

  // Step 2: 状态同步
  runScript("gen/sync-gen-tasks.ts", [...], paths.libDir, paths.projectRoot);

  // Step 3: 产物验证
  runScript("gen/verify-gen-artifacts.ts", [...], paths.libDir, paths.projectRoot);

  // Step 4: 分析验证结果
  const { pendingCount, tasksMissing, mermaidLeaks } = readVerifyReport(paths);

  // Step 5: 决策
  if (pendingCount === 0 && tasksMissing === 0) {
    return { action: "continue", message: "所有 SubAgent 产物验证通过" };
  }

  if (pendingCount > 0 || tasksMissing > 0) {
    // 自动重试重置（最多 3 次）
    if (pendingCount === 0 && tasksMissing > 0) {
      const resetResult = autoResetFailedTasks(state, paths);
      if (resetResult.action === "skip") {
        return { action: "continue", message: resetResult.message };
      }
    }
    // 重跑 gen-scheduler
    rerunGenScheduler(paths, args);
    outputGenPrompts(paths, args.limit || 5);
    return { action: "pause", message: "GEN 阶段需要 Agent 操作 SubAgent" };
  }

  return { action: "continue", message: "就绪" };
}
```

runner.ts 中简化为：

```typescript
if (phase === "GEN" && args.resume && isGenInProgress(state)) {
  const result = await handleGenResume(paths, state, args);
  if (result.action === "pause") return;
  if (result.action === "done") continue;
  // action === "continue" → 落入后续 ASSEMBLE
}
```

### 2.3 markAffectedGenTasks — 使用 FileTaskIndex

```typescript
// gen-helpers.ts — 新签名
export function markAffectedGenTasks(
  statePath: string,
  affectedFiles: Set<string>,
  fileTaskIndex: FileTaskIndex,
): number {
  const state = fs.readJsonSync(statePath) as WikiState;
  if (!state.genTasks || state.genTasks.length === 0) return 0;

  const affectedTaskIds = new Set<string>();
  for (const file of affectedFiles) {
    const taskIds = fileTaskIndex.fileToTasks[file];
    if (taskIds) taskIds.forEach(id => affectedTaskIds.add(id));
  }

  let updated = 0;
  for (const task of state.genTasks) {
    if (affectedTaskIds.has(task.id) && task.status !== "in_progress") {
      task.status = "pending";
      updated++;
    }
  }

  if (updated > 0) fs.writeJsonSync(statePath, state, { spaces: 2 });
  return updated;
}
```

### 2.4 反馈注入优化（#6）

```typescript
// gen-helpers.ts — 预计算注入内容
export function injectFeedbackIntoPrompts(
  promptsDir: string,
  agenticWikiRoot: string,
  projectRoot: string,
  mode: "append" | "replace" = "append",
): void {
  if (!fs.existsSync(promptsDir)) return;

  // 预计算：只读取一次
  const injection = buildInjectionBlock(agenticWikiRoot, projectRoot);

  const promptFiles = fs.readdirSync(promptsDir).filter(f => f.endsWith(".md"));
  for (const file of promptFiles) {
    const filePath = path.join(promptsDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    if (content.includes(INJECTION_SENTINEL)) {
      if (mode === "replace") {
        const idx = content.indexOf(`<!-- ${INJECTION_SENTINEL} -->`);
        fs.writeFileSync(filePath, content.slice(0, idx).trimEnd() + "\n\n" + injection, "utf-8");
      }
    } else {
      fs.appendFileSync(filePath, injection, "utf-8");
    }
  }
}

function buildInjectionBlock(agenticWikiRoot: string, projectRoot: string): string {
  let globalFeedback = "";
  const globalPath = path.join(agenticWikiRoot, "docs", "feedback", "global-strategies.md");
  if (fs.existsSync(globalPath)) globalFeedback = fs.readFileSync(globalPath, "utf-8");

  let projectFeedback = "";
  const pfPath = path.join(projectRoot, ".agentic-wiki", "feedback", "prompts.md");
  if (fs.existsSync(pfPath)) projectFeedback = fs.readFileSync(pfPath, "utf-8");

  const lines = ["", "---", "", `<!-- ${INJECTION_SENTINEL} -->`, "",
    "## 🔴 历史反馈与改进策略（Runner 自动注入，必须遵守）", ""];
  if (globalFeedback) lines.push("### 全局策略", "", globalFeedback, "");
  if (projectFeedback) lines.push("### 项目策略", "", projectFeedback, "");
  lines.push("> 以上策略来自历史验证失败的根因分析。必须在本次执行中应用。", "");
  return lines.join("\n");
}
```

### 2.5 state-manager.ts — 文件锁修复 + 安全防护

**改动 1**：统一锁格式为目录锁，移除旧版文件锁兼容代码

```typescript
async function acquireLock(statePath: string, timeoutMs = 10_000): Promise<FileLock> {
  const lockPath = statePath + ".lock";
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      // mkdir 是原子操作，天然互斥
      fs.mkdirSync(lockPath);

      // 写入元数据
      const meta = { pid: process.pid, acquiredAt: new Date().toISOString() };
      fs.writeFileSync(path.join(lockPath, "meta.json"), JSON.stringify(meta));

      return { path: lockPath, pid: process.pid, acquiredAt: meta.acquiredAt };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        // 锁已存在 — 检查是否过期
        const metaPath = path.join(lockPath, "meta.json");
        if (fs.existsSync(metaPath)) {
          try {
            const meta = fs.readJsonSync(metaPath);
            const age = Date.now() - new Date(meta.acquiredAt).getTime();
            if (age > 60_000) { // 超过 60 秒视为过期
              fs.removeSync(lockPath);
              continue;
            }
          } catch {
            fs.removeSync(lockPath); // 元数据损坏，清除
            continue;
          }
        } else {
          fs.removeSync(lockPath); // 无元数据，清除
          continue;
        }
        await new Promise(r => setTimeout(r, 200));
      } else {
        throw err;
      }
    }
  }

  throw new Error(`无法获取文件锁: ${lockPath} (超时 ${timeoutMs}ms)`);
}
```

**改动 2**：原型污染防护

```typescript
function setNested(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const parts = keyPath.split(".");

  // 原型污染防护
  for (const part of parts) {
    if (part === "__proto__" || part === "constructor" || part === "prototype") {
      throw new Error(`安全拒绝：禁止设置 ${part} 属性`);
    }
  }

  // ... 原有逻辑
}
```

**改动 3**：修复 `unlock` CLI 命令

```typescript
case "unlock": {
  const lockPath = statePath + ".lock";
  const metaPath = path.join(lockPath, "meta.json");
  if (fs.existsSync(metaPath)) {
    const meta = fs.readJsonSync(metaPath);
    console.log(`释放锁: PID=${meta.pid}, 获取时间=${meta.acquiredAt}`);
  }
  fs.removeSync(lockPath);
  break;
}
```

### 2.6 id-utils.ts — 统一分隔符

```typescript
// 统一：sanitizeRole 也保留 -，不再替换为 _
export function sanitizeRole(role: string): string {
  return role
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "default";
}
```

### 2.7 script-runner.ts — 路径引用安全

```typescript
// 使用 execFileSync 替代 execSync 字符串拼接
import { execFileSync } from "node:child_process";

export function runScript(name: string, args: string[], ...): ScriptResult {
  const scriptPath = path.join(libDir, name);
  const result = execFileSync("npx", ["tsx", scriptPath, ...args], {
    cwd: projectRoot,
    encoding: "utf-8",
    maxBuffer: opts?.maxBuffer || 50 * 1024 * 1024,
    timeout: opts?.timeout || 120_000,
  });
  // ...
}
```

---

## 3. 受影响文件

| 文件 | 改动类型 |
|------|---------|
| `src/runner.ts` | 修改：增量路径重构 + resume 提取 |
| `src/lib/pipeline/gen-helpers.ts` | 修改：markAffectedGenTasks 新签名 + 反馈注入优化 |
| `src/lib/pipeline/gen-resume-handler.ts` | **新增** |
| `src/lib/pipeline/phase-definitions.ts` | 修改：集成所有新脚本 |
| `src/lib/pipeline/script-runner.ts` | 修改：execFileSync 安全化 |
| `src/lib/shared/state-manager.ts` | 修改：锁修复 + 原型污染防护 + unlock 修复 |
| `src/lib/shared/id-utils.ts` | 修改：统一分隔符 |

---

## 4. 测试要点

- [ ] 增量模式在聚簇项目中正常工作（读 `task-clusters.json`）
- [ ] 增量模式在文件夹项目中正常工作（回退 `folder-strategy.json`）
- [ ] `handleGenResume` 返回 `continue` 时 runner 进入 ASSEMBLE
- [ ] `handleGenResume` 返回 `pause` 时 runner 暂停并输出 prompt
- [ ] `acquireLock` + `releaseLock` 在并发场景下互斥
- [ ] `setNested` 对 `__proto__` key 抛异常
- [ ] `unlock` CLI 命令正常删除目录锁
- [ ] `sanitizeRole("ui-components")` = `"ui-components"`（保留 `-`）
- [ ] `runScript` 路径含空格时不断裂
- [ ] 反馈注入只读取反馈文件 1 次（非 N 次）
