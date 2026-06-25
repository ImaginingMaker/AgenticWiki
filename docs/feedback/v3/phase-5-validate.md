# Phase 5: VALIDATE 阶段重构

> 涉及脚本：`validate-references.ts` · `validate-code-refs.ts` · `validate-issue-types.ts` · `validate-issue-content.ts`
> 依赖关系：依赖 Phase 4（Issue 状态机 + 去重）
> 核心目标：#3（Issue 状态机激活）、issue-parser 统一、路径净化一致性

---

## 1. 问题清单

### 1.1 validate-issue-content.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| V1-1 | 🟡 | **Issue 状态机未激活**（remaining-issues #3）：验证通过的 Issue 仍保持 `status: detected`，11 种 `IssueStatus` 中除 `detected` 外全部是死代码 | 全局 |
| V1-2 | 🟡 | 验证失败的 Issue 不更新状态，无法区分"未验证"和"验证不通过" | 全局 |
| V1-3 | 🟢 | `ContentCheck` 的 `sourceFile` 字段用相对路径，但 check 结果输出时不标注相对于哪个根目录 | 输出格式 |

### 1.2 validate-references.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| V2-1 | 🟡 | Wiki 链接解析时对 `ch-` 前缀的处理与 `id-utils.ts` 的 `sanitizePathId` 规则不一致，导致部分合法链接被报为 broken | 链接解析 |
| V2-2 | 🟢 | 对 Obsidian `[[wikilink]]` 格式的解析不支持别名 `[[path|显示名]]`，遇到别名链接时整段被视为无效 | 正则 |

### 1.3 validate-issue-types.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| V3-1 | 🟡 | `--fix` 模式下移动 Issue 文件后不更新文件内 frontmatter 的元数据（如 `related_wiki` 路径） | 修复逻辑 |

### 1.4 issue-parser.ts（shared 模块，被 4 个验证脚本引用）

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| V4-1 | 🟡 | **手写 YAML 解析器**只支持单行 `key: value`，不支持多行值、缩进数组、带引号的冒号字符串。项目已有 `gray-matter` 依赖 | L48 |
| V4-2 | 🟡 | `parseYamlFrontmatter` 对空 frontmatter 返回 `{}`（无最低字段要求），上游收到无意义空对象 | 返回逻辑 |
| V4-3 | 🟢 | Markdown 表格解析器对含 `|` 的 slug 字段处理不安全 | 正则 |

---

## 2. 重构方案

### 2.1 Issue 状态机激活（#3 核心）

**新增模块**：`src/lib/shared/issue-status.ts`

```typescript
import fs from "fs-extra";
import matter from "gray-matter";
import type { IssueStatus } from "../types/index.js";

/**
 * 更新 Issue 文件的 status 字段并追加 history 条目。
 * 幂等：如果 status 已经是目标值则跳过。
 */
export function updateIssueStatus(
  issueFilePath: string,
  newStatus: IssueStatus,
  actor: string = "aw-validate",
  note?: string,
): boolean {
  if (!fs.existsSync(issueFilePath)) return false;

  const raw = fs.readFileSync(issueFilePath, "utf-8");
  const parsed = matter(raw);
  const oldStatus = parsed.data.status as string;
  if (oldStatus === newStatus) return false;

  parsed.data.status = newStatus;

  // 追加 history 条目
  if (!Array.isArray(parsed.data.history)) parsed.data.history = [];
  parsed.data.history.push({
    at: new Date().toISOString(),
    event: `status_change`,
    from: oldStatus,
    to: newStatus,
    by: actor,
    note: note || `${oldStatus} → ${newStatus}`,
  });

  fs.writeFileSync(
    issueFilePath,
    matter.stringify(parsed.content, parsed.data),
    "utf-8",
  );
  return true;
}

/**
 * 批量标记 Issue 为 stale（增量模式下源文件变更）。
 */
export function markIssuesStale(
  issueFiles: string[],
  reason: string,
): number {
  let count = 0;
  for (const file of issueFiles) {
    if (updateIssueStatus(file, "stale", "aw-incremental", reason)) {
      count++;
    }
  }
  return count;
}
```

**修改 `validate-issue-content.ts`**：

```typescript
import { updateIssueStatus } from "../shared/issue-status.js";

// 在验证循环中：
for (const check of checks) {
  if (check.passed) {
    updateIssueStatus(check.issueFile, "verified", "aw-validate",
      `${check.checkType} 验证通过`);
  } else {
    updateIssueStatus(check.issueFile, "disputed", "aw-validate",
      `${check.checkType} 验证失败: ${check.detail}`);
  }
}
```

**修改增量模式（runner.ts）**：受影响文件关联的 Issue 自动标记为 `stale`

```typescript
// 在 markAffectedGenTasks 之后
const issueFiles = findIssuesBySourceFiles(affectedFiles, wikiRoot);
const staleCount = markIssuesStale(issueFiles, `源文件变更 (since ${args.since})`);
console.log(`  📋 标记 ${staleCount} 个 Issue 为 stale`);
```

### 2.2 issue-parser.ts — 统一使用 gray-matter

```typescript
import matter from "gray-matter";

export function parseIssueFrontmatter(filePath: string): ParsedIssue | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = matter(raw);
    const data = parsed.data;

    // 最低字段要求
    if (!data.id || !data.type) return null;

    return {
      id: String(data.id),
      type: String(data.type),
      severity: String(data.severity || "medium"),
      status: String(data.status || "detected"),
      confidence: String(data.confidence || "medium"),
      sourceFiles: Array.isArray(data.source_files) ? data.source_files : [],
      detectedAt: String(data.detected_at || ""),
      filePath,
    };
  } catch {
    return null;
  }
}
```

所有 4 个验证脚本统一调用此函数，删除手写 YAML 解析器和 Markdown 表格解析器（作为 fallback 保留但降级使用）。

### 2.3 validate-references.ts — 路径净化对齐

```typescript
import { sanitizePathId } from "../shared/id-utils.js";

// 解析 [[wikilink]] 时统一使用 sanitizePathId
function resolveWikiLink(link: string): string {
  // 支持别名格式 [[path|显示名]]
  const pipeIdx = link.indexOf("|");
  const target = pipeIdx >= 0 ? link.slice(0, pipeIdx) : link;
  return target.trim();
}
```

### 2.4 validate-issue-types.ts — 修复后更新 frontmatter

```typescript
// --fix 模式下移动文件后，同步更新 related_wiki 相对路径
function fixIssuePath(issueFile: string, correctDir: string): void {
  const dest = path.join(correctDir, path.basename(issueFile));
  fs.moveSync(issueFile, dest, { overwrite: true });

  // 更新内部相对路径引用
  const raw = fs.readFileSync(dest, "utf-8");
  const parsed = matter(raw);
  if (Array.isArray(parsed.data.related_wiki)) {
    parsed.data.related_wiki = parsed.data.related_wiki.map((ref: string) =>
      recalculateRelativePath(ref, issueFile, dest)
    );
    fs.writeFileSync(dest, matter.stringify(parsed.content, parsed.data), "utf-8");
  }
}
```

---

## 3. 受影响文件

| 文件 | 改动类型 |
|------|---------|
| `src/lib/shared/issue-status.ts` | **新增** |
| `src/lib/shared/issue-parser.ts` | 修改：统一 gray-matter、最低字段要求 |
| `src/lib/validate/validate-issue-content.ts` | 修改：调用 updateIssueStatus 激活状态流转 |
| `src/lib/validate/validate-references.ts` | 修改：路径净化对齐、别名支持 |
| `src/lib/validate/validate-issue-types.ts` | 修改：--fix 后更新 frontmatter |

---

## 4. 测试要点

- [ ] `updateIssueStatus` 幂等：重复调用不追加重复 history
- [ ] 验证通过的 Issue status 变为 `verified`
- [ ] 验证失败的 Issue status 变为 `disputed`
- [ ] 增量模式下受影响源文件关联的 Issue status 变为 `stale`
- [ ] `parseIssueFrontmatter` 对缺少 `id` 的文件返回 null
- [ ] `parseIssueFrontmatter` 正确解析 `source_files` 缩进数组
- [ ] `resolveWikiLink` 对 `[[path|名称]]` 返回 `path`
