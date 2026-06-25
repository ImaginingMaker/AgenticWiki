# Phase 2: DEPENDENCY 阶段重构

> 涉及脚本：`build-deps.ts` · `file-priorities.ts` · `analyze-folders.ts` · `extract-subgraph.ts` · `extract-file-meta.ts` · `cluster-tasks.ts` · `build-file-task-index.ts`(新增)
> 依赖关系：依赖 Phase 1（扫描修复）
> 核心目标：G1（FileTaskIndex）、G2（Token 容量控制）、P0-#1（4KB 截断）

---

## 1. 问题清单

### 1.1 build-deps.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| D1-1 | 🔴 | **RCE 命令注入**：`execSync(args.join(" "))` 直接拼接用户路径到 shell 命令。路径含 shell 元字符（`; rm -rf /`）可执行任意命令 | L56 |
| D1-2 | 🟡 | `CycleInfo` 检测不完整：`severity === "error"` 条件过宽，非循环 error 也被加入 cycles；循环路径只取 `[from, to, from]` 三节点，丢失完整路径 | L267-284 |
| D1-3 | 🟡 | `execSync` 阻塞事件循环，大项目分析 >1 分钟时进程冻结 | L56 |
| D1-4 | 🟡 | `rawOutput as CruiserOutput` 无运行时校验，dependency-cruiser 版本变化可能静默产生错误数据 | L188 |
| D1-5 | 🟢 | `findTsConfig` 只向上查找 2 级，深层 monorepo 找不到根 tsconfig | L110-121 |

### 1.2 file-priorities.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| D2-1 | 🔴 | **同文件重复读取 5 次**：`getLineCount` 读一次全量，`containsJSX` 读一次前 4KB，`containsHook` 又读一次，`estimateTokens` 再调 `containsJSX`，`buildReason` 再调两次。5000 文件项目产生 ~25000 次 I/O | L74-158 |
| D2-2 | 🟡 | `dependentCount` 对齐不一致：从 `depGraph.modules` 取 `dependents.length`，但 `allFiles` 来自 `fileList.files` 而非 `depGraph.modules`，无依赖记录的文件默认 `dependentCount=0` | L193-197 |

### 1.3 extract-file-meta.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| D3-1 | 🔴 | **P0-#1 — 4KB 截断**：`.slice(0, 4096)` 导致 `lineCount` 和 `estimatedTokens` 严重低估（>4KB 的文件占大多数） | L270 |
| D3-2 | 🟡 | `lineCount` 按 `\n` 字符逐个扫描计算，全量替换后建议用 `split("\n").length` | L272-277 |

### 1.4 cluster-tasks.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| D4-1 | 🟡 | `maxCluster` 硬编码上限 50K，1M 模型可处理更大聚簇 | `calcClusterThresholds` |
| D4-2 | 🟡 | `splitLargeCluster` 使用 `chunk.length * 1000` 估算 token，不查 metaMap，估算偏差大 | L689 |
| D4-3 | 🟢 | `normalizeClusters` O(n²) 合并循环，聚簇数 >200 时性能下降 | L578-616 |

### 1.5 analyze-folders.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| D5-1 | 🟡 | 聚簇模式下此脚本仍然执行（DEPENDENCY 阶段固定运行），输出 `folder-strategy.json` 在聚簇项目中不被 GEN 阶段使用，是冗余 I/O | 全局 |

---

## 2. 重构方案

### 2.1 build-deps.ts — 安全修复 + 异步化

**改动 1**：RCE 修复 — 使用 `execFileSync` 替代 `execSync`

```typescript
import { execFileSync } from "node:child_process";

// 旧：execSync(args.join(" "), { ... });
// 新：
const [bin, ...binArgs] = args;
const result = execFileSync(bin, binArgs, {
  encoding: "utf-8",
  maxBuffer: maxBuffer,
  timeout: timeout,
  cwd: sourcePath,
});
```

**改动 2**：循环检测完善

```typescript
// 仅匹配 no-circular 规则
if (violation.rule?.name === "no-circular") {
  // 使用 violation.cycle（dependency-cruiser 提供完整路径）
  const cyclePath = violation.cycle || [violation.from, violation.to];
  cycles.push({
    path: cyclePath,
    severity: violation.rule.severity || "error",
    description: `循环依赖: ${cyclePath.join(" → ")}`,
  });
}
```

**改动 3**：`findTsConfig` 循环向上查找

```typescript
function findTsConfig(basePath: string): string | null {
  let current = path.resolve(basePath);
  const root = path.parse(current).root;
  while (current !== root) {
    const candidate = path.join(current, "tsconfig.json");
    if (fs.existsSync(candidate)) return candidate;
    current = path.dirname(current);
  }
  return null;
}
```

### 2.2 file-priorities.ts — 文件内容缓存

```typescript
// 一次读取，缓存内容，传递给所有检测函数
interface FileContext {
  content: string;
  head: string;      // 前 4KB
  lineCount: number;
  hasJSX: boolean;
  hasHook: boolean;
}

function readFileContext(filePath: string): FileContext | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const head = content.slice(0, 4096);
    return {
      content,
      head,
      lineCount: content.split("\n").length,
      hasJSX: containsJSXContent(head),
      hasHook: containsHookContent(head),
    };
  } catch { return null; }
}

// 所有检测函数改为接受 FileContext 而非文件路径
function estimateTokens(filePath: string, ctx: FileContext): number { ... }
function buildReason(filePath: string, ctx: FileContext): string { ... }
```

### 2.3 extract-file-meta.ts — 去除 4KB 截断（P0-#1）

```typescript
// 旧 L270：
content = fs.readFileSync(fullPath, "utf-8").slice(0, 4096);

// 新：
const fullContent = fs.readFileSync(fullPath, "utf-8");
lineCount = fullContent.split("\n").length;

// 元信息提取用前 8KB（性能优化，仅影响正则匹配范围，不影响 token 估算）
content = fullContent.slice(0, 8192);
```

### 2.4 cluster-tasks.ts — 阈值调整 + 拆分修复

**改动 1**：提升 `maxCluster` 上限

```typescript
function calcClusterThresholds(totalProjectTokens: number) {
  return {
    maxCluster: Math.max(1000, Math.min(120_000, Math.round(totalProjectTokens * 0.25))),
    minCluster: Math.max(50, Math.min(15_000, Math.round(totalProjectTokens * 0.05))),
  };
}
```

**改动 2**：`splitLargeCluster` 使用 metaMap 真实 token

```typescript
function splitLargeCluster(cluster: TaskCluster, metaMap: FileMetaMap): TaskCluster[] {
  // ...
  // 旧：split[0].estimatedTokens = split[0].files.length * 1000;
  // 新：
  split[0].estimatedTokens = split[0].files.reduce(
    (sum, f) => sum + fileTokens(f, metaMap), 0
  );
  // chunk 同理
  const chunkTokens = chunk.reduce((sum, f) => sum + fileTokens(f, metaMap), 0);
}
```

### 2.5 新增 build-file-task-index.ts（G1 核心）

```typescript
/**
 * 构建统一的文件→任务双向索引。
 * 增量模式通过此索引匹配受影响任务，不再区分文件夹/聚簇。
 */
export interface FileTaskIndex {
  fileToTasks: Record<string, string[]>;
  taskToFiles: Record<string, string[]>;
  source: "folder-strategy" | "task-clusters";
  generatedAt: string;
}

export function buildFileTaskIndex(
  folderStrategy?: FolderStrategyResult,
  clusterResult?: ClusterTaskResult,
): FileTaskIndex {
  const fileToTasks: Record<string, string[]> = {};
  const taskToFiles: Record<string, string[]> = {};

  if (clusterResult) {
    for (const cluster of clusterResult.clusters) {
      taskToFiles[cluster.id] = [...cluster.files];
      for (const file of cluster.files) {
        (fileToTasks[file] ??= []).push(cluster.id);
      }
    }
    return { fileToTasks, taskToFiles, source: "task-clusters", generatedAt: new Date().toISOString() };
  }

  if (folderStrategy) {
    for (const folder of folderStrategy.folders) {
      for (const sub of folder.subTasks || []) {
        taskToFiles[sub.id] = [...sub.files];
        for (const file of sub.files) {
          (fileToTasks[file] ??= []).push(sub.id);
        }
      }
    }
    return { fileToTasks, taskToFiles, source: "folder-strategy", generatedAt: new Date().toISOString() };
  }

  throw new Error("必须提供 folderStrategy 或 clusterResult");
}
```

在 `phase-definitions.ts` DEPENDENCY 阶段末尾注册此脚本。

---

## 3. 受影响文件

| 文件 | 改动类型 |
|------|---------|
| `src/lib/dependency/build-deps.ts` | 修改：execFileSync 安全修复、循环检测、tsconfig 查找 |
| `src/lib/dependency/file-priorities.ts` | 修改：FileContext 缓存去重 5→1 次 I/O |
| `src/lib/dependency/extract-file-meta.ts` | 修改：去除 4KB 截断、全量 lineCount |
| `src/lib/dependency/cluster-tasks.ts` | 修改：阈值 120K、拆分用真实 token |
| `src/lib/dependency/build-file-task-index.ts` | **新增** |
| `src/types/index.ts` | 新增 `FileTaskIndex` 类型 |
| `src/lib/pipeline/phase-definitions.ts` | 修改：集成 build-file-task-index |

---

## 4. 测试要点

- [ ] `build-deps.ts`：路径含空格/特殊字符时不触发 RCE
- [ ] `file-priorities.ts`：同文件只读一次（可用 spy 验证）
- [ ] `extract-file-meta.ts`：200 行 .tsx 文件的 `lineCount` = 200（非 ~30）
- [ ] `extract-file-meta.ts`：`estimatedTokens` = 200 * 2.5 = 500（非 ~75）
- [ ] `cluster-tasks.ts`：100K token 聚簇不被拆分（旧版在 50K 就拆）
- [ ] `build-file-task-index.ts`：聚簇模式和文件夹模式分别输出正确索引
- [ ] `build-file-task-index.ts`：同一文件属于多个聚簇时 `fileToTasks` 正确记录
