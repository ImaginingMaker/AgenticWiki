# Phase 4: ASSEMBLE 阶段重构

> 涉及脚本：`assemble-book.ts` · `symbol-index.ts` · `issue-dashboard.ts` · `fix-issue-paths.ts` · `dedup-issues.ts`(新增)
> 依赖关系：依赖 Phase 3（GEN 产物格式变更）+ Phase 6（phase-definitions 集成）
> 核心目标：#4（Issue 去重）、assemble-book 聚簇感知、symbol-index 增强

---

## 1. 问题清单

### 1.1 assemble-book.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| A1-1 | 🟡 | `chapterLabel` 只从 `folder-strategy.json` 查找标签，聚簇模式下 chapter ID 以 `ch-` 开头且来自 cluster.id，`folderId` 匹配失败，回退到 `replace(/_/g, "/")` 的粗糙标签 | L78-90 |
| A1-2 | 🟡 | 不读取 `task-clusters.json`，聚簇模式下 book.md 目录的章节名不够友好 | CLI 参数 |
| A1-3 | 🟢 | `generateBook` 对章节按字母排序 `a.localeCompare(b)`，不按聚簇优先级排序 | L123 |

### 1.2 symbol-index.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| A2-1 | 🟡 | 符号提取仅从 `## ` / `### ` 标题中匹配，新增的 12 章节中「## 3. 组件/函数清单」「## 8. 公共组件索引清单」内的表格数据不被提取 | 正则逻辑 |
| A2-2 | 🟢 | 不提取表格中的符号（`| ComponentName | function | ... |`），遗漏大量导出符号 | 全局 |

### 1.3 issue-dashboard.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| A3-1 | 🟡 | Issue 统计不包含 `duplicate` / `stale` / `verified` 状态（Issue 状态机激活后会产生这些新状态） | 统计逻辑 |
| A3-2 | 🟢 | 仪表盘不显示去重信息（多少 Issue 被标记为 duplicate） | 输出格式 |

### 1.4 fix-issue-paths.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| A4-1 | 🟢 | 仅按文件名模式修复路径，不验证 frontmatter 中 `type` 与目标目录是否一致 | 修复逻辑 |

### 1.5 全局缺失

| # | 严重度 | 问题 |
|---|:---:|------|
| A5-1 | 🔴 | **Issue 去重缺失**（remaining-issues #4）：多个 SubAgent 分析重叠文件时生成语义重复的 Issue，无去重机制 |

---

## 2. 重构方案

### 2.1 assemble-book.ts — 聚簇感知

**改动 1**：新增 `--clusters` CLI 参数，读取 `task-clusters.json`

```typescript
.option("clusters", {
  type: "string",
  description: "Path to task-clusters.json (optional, for cluster-aware labeling)",
})
```

**改动 2**：`chapterLabel` 同时支持聚簇和文件夹模式

```typescript
export function chapterLabel(
  chapter: string,
  strategy: FolderStrategyResult | null,
  clusters?: ClusterTaskResult | null,
): string {
  // 优先从聚簇查找
  if (clusters) {
    const clusterId = chapter.replace(/^ch-/, "");
    const cluster = clusters.clusters.find(c => c.id === clusterId);
    if (cluster) return cluster.label;
  }
  // 回退到文件夹策略
  if (strategy) {
    const folderId = chapter.replace(/^ch-/, "");
    for (const f of strategy.folders) {
      const id = f.path.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
      if (id === folderId) return f.path;
    }
  }
  return chapter.replace(/^ch-/, "").replace(/_/g, "/");
}
```

**改动 3**：`phase-definitions.ts` 中 ASSEMBLE 阶段传入 `--clusters` 参数

### 2.2 symbol-index.ts — 表格符号提取增强

新增从 Markdown 表格中提取符号的能力：

```typescript
export function extractSymbols(content: string): { name: string; type: string }[] {
  const symbols: { name: string; type: string }[] = [];
  const seen = new Set<string>();

  // 原有：从标题提取
  const hRe = /^#{2,3}\s+`?([A-Za-z_]\w*)`?/gm;
  // ...

  // 新增：从表格行提取（匹配 | `SymbolName` | type | 模式）
  const tableRe = /^\|\s*`?([A-Z][A-Za-z_]\w*)`?\s*\|\s*(component|hook|function|type|interface|constant|enum)\s*\|/gm;
  let tm;
  while ((tm = tableRe.exec(content)) !== null) {
    const name = tm[1];
    if (seen.has(name)) continue;
    seen.add(name);
    symbols.push({ name, type: tm[2] });
  }

  return symbols;
}
```

### 2.3 新增 dedup-issues.ts（#4 核心）

```typescript
/**
 * Issue 去重 — 按 (type, source_files 交集) 识别重复 Issue。
 *
 * 策略：
 *   - 精确匹配：type 相同 + source_files 完全相同 → 保留最早的
 *   - 模糊匹配：type 相同 + source_files 交集 ≥ 50% → 标记为 potential_duplicate
 *   - 重复 Issue 移动到 ch-99-archived/，status 改为 duplicate
 */
export interface DedupResult {
  totalScanned: number;
  exactDuplicates: number;
  potentialDuplicates: number;
  archived: string[];
}

export function dedupIssues(issuesDir: string): DedupResult {
  const issues = scanAllIssues(issuesDir);
  const seen = new Map<string, ParsedIssue>();
  const result: DedupResult = { totalScanned: issues.length, exactDuplicates: 0, potentialDuplicates: 0, archived: [] };

  for (const issue of issues) {
    const key = `${issue.type}::${issue.sourceFiles.sort().join(",")}`;
    if (seen.has(key)) {
      const existing = seen.get(key)!;
      const toArchive = issue.detectedAt < existing.detectedAt ? existing : issue;
      const toKeep = issue.detectedAt < existing.detectedAt ? issue : existing;

      archiveIssue(toArchive, toKeep.id, issuesDir);
      result.exactDuplicates++;
      result.archived.push(toArchive.id);

      if (issue.detectedAt < existing.detectedAt) seen.set(key, issue);
    } else {
      seen.set(key, issue);
    }
  }

  return result;
}

function archiveIssue(issue: ParsedIssue, duplicateOfId: string, issuesDir: string): void {
  const archivedDir = path.join(issuesDir, "ch-99-archived");
  fs.ensureDirSync(archivedDir);

  // 更新 status + 追加 history
  updateIssueStatus(issue.filePath, "duplicate");
  // 移动文件
  const dest = path.join(archivedDir, path.basename(issue.filePath));
  fs.moveSync(issue.filePath, dest, { overwrite: true });
}
```

在 `phase-definitions.ts` ASSEMBLE 阶段中，在 `fix-issue-paths.ts` 之后、`issue-dashboard.ts` 之前调用。

### 2.4 issue-dashboard.ts — 新增状态统计

```typescript
// 统计维度增加
interface DashboardStats {
  // ...existing...
  byStatus: Record<string, number>;  // 新增：detected/verified/stale/duplicate/...
  duplicateCount: number;             // 新增
}
```

---

## 3. 受影响文件

| 文件 | 改动类型 |
|------|---------|
| `src/lib/assemble/assemble-book.ts` | 修改：聚簇感知、chapterLabel 扩展 |
| `src/lib/assemble/symbol-index.ts` | 修改：表格符号提取 |
| `src/lib/assemble/issue-dashboard.ts` | 修改：新增状态统计 |
| `src/lib/validate/dedup-issues.ts` | **新增** |
| `src/lib/pipeline/phase-definitions.ts` | 修改：集成 dedup-issues + --clusters |

---

## 4. 测试要点

- [ ] `chapterLabel` 在聚簇模式下返回 `cluster.label` 而非 sanitized ID
- [ ] `extractSymbols` 从表格行 `| ButtonGroup | component | ... |` 中提取符号
- [ ] `dedupIssues` 对相同 `(type, source_files)` 的两个 Issue 只保留一个
- [ ] 被归档 Issue 的 status 为 `duplicate`
- [ ] `issue-dashboard` 输出包含 `verified`/`stale`/`duplicate` 状态统计
