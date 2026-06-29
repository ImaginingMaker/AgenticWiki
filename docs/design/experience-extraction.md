# 通用开发经验（experience）— 设计文档

> **状态**：最终方案 | **日期**：2026-06-29 | **版本**：v2

---

## 1. 背景与动机

AgenticWiki 当前生成的 Wiki 是**聚簇视角**的：每个聚簇一份 Wiki 章节，描述该聚簇的内部实现。

问题：**跨聚簇的通用模式被分散在各章节中，无法直接复用**。

例如：
- 项目中 5 个聚簇都实现了 `useDebounce`，各有微小差异
- 3 个聚簇使用了相同的 Container/Presenter 拆分模式
- 错误处理、数据获取等模式在整个项目中重复出现

**目标**：在 Wiki 生成完成后，跨聚簇提取通用实现模式，形成 `volume-3-experience/` 经验知识库。

---

## 2. 设计决策：为什么不作为独立流水线阶段？

### 2.1 两种方案对比

| 维度 | 方案 A：独立阶段 (`EXPERIENCE`) | 方案 B：ASSEMBLE 内部可选步骤 ✅ |
|:---|:---|:---|
| 流水线复杂度 | +1 阶段，+DAG 顺序，+resume 逻辑，+状态管理 | 不增加阶段 |
| 是否阻塞后续 | 是（`EXPERIENCE → VALIDATE`，未完成则流水线卡住） | 否，ASSEMBLE 完成即进入 VALIDATE |
| Agent 交互 | 必须（像 GEN 一样 pause/resume） | 可选（无经验文档时提示用户手动触发） |
| 代码侵入度 | runner.ts ~100 行新增，phase-definitions 变更，测试更新 | runner.ts ~15 行，phase-definitions ~10 行 |
| 增量更新 | 需要单独的 stale 标记和 resume 逻辑 | 复用 ASSEMBLE 已有的增量流程 |
| 首次运行体验 | 必须跑完 EXPERIENCE 才能到 VALIDATE | 先完成 book.md → 用户可选是否补充 |

### 2.2 决策：方案 B

**理由**：

1. **经验提取是对已有 Wiki 的二次加工**，不是独立的代码分析阶段。
2. **不应该阻塞核心流水线**。`book.md` + `glossary.md` 就是完整产物，经验文档是锦上添花。
3. **ASSEMBLE 阶段天然适合做"组装后处理"**。
4. **增量模式更简单**：ASSEMBLE 本身就处理 Issue stale 逻辑，经验 stale 可以复用同一上下文。

---

## 3. 架构设计

### 3.1 整体流程

```
GEN 完成 → ASSEMBLE 开始
            │
            ├── sync-gen-tasks.ts           # 同步任务状态
            ├── progress-dashboard.ts       # 生成进度面板
            ├── symbol-index.ts             # 符号索引
            ├── dedup-issues.ts             # Issue 去重
            ├── fix-issue-paths.ts          # 修复路径
            ├── issue-dashboard.ts          # Issue 仪表盘
            ├── validate-issue-types.ts     # Issue 格式校验
            ├── validate-issue-content.ts   # Issue 内容校验
            ├── assemble-book.ts            # 组装 book.md + glossary.md（不修改此文件）
            │
            └── 🆕 assemble-experience.ts   # 独立脚本（critical: false）
                  ├─ volume-3-experience/ 不存在 → 安静退出（exit 0）
                  ├─ volume-3-experience/ 存在 → 读取经验文档
                  ├─ 生成经验章节 Markdown
                  └─ append 到 book.md 末尾

DAG_ORDER 不变：INIT → SCAN → DEPENDENCY → GEN → ASSEMBLE → VALIDATE
                                                              ↑
                                                    经验提取在 ASSEMBLE 内部完成
```

### 3.2 关键架构决策

**决策 1：`assemble-experience.ts` 是独立脚本，不修改 `assemble-book.ts`**

原因：`assemble-book.ts` 是 ASSEMBLE 最后一个关键脚本，运行在经验脚本之前。
经验章节由 `assemble-experience.ts` 独立脚本 append 到已生成的 `book.md`。
两者解耦：`assemble-book.ts` 不感知经验功能的存在，降低耦合。

**决策 2：`computeAffectedExperience` 和 `markExperienceStale` 是库函数，放在 `shared/`**

原因：它们被 `runner.ts` 增量模式直接调用（类比 `computeAffectedIssues` 在 `shared/git-diff.ts`，
`markIssuesStale` 在 `shared/issue-status.ts`），不是 CLI 脚本。
CLI 脚本（`extract-experience.ts`）和库函数分离是项目既有规范。

**决策 3：经验提取仅在聚簇模式下可用**

原因：经验提取本质是跨聚簇比较，依赖 `task-clusters.json` 中的聚簇结构。
文件夹回退模式（无 `task-clusters.json`）下，`extract-experience.ts` 和 `assemble-experience.ts`
检测到无聚簇数据后安静退出（exit 0），不产生任何产物。
这简化了设计，且聚簇模式是项目的主推路径。

### 3.3 文件规划

```
src/lib/
  experience/                              # 🆕 新目录（CLI 脚本）
    extract-experience.ts                  # 生成 SubAgent prompt（CLI 脚本）
    assemble-experience.ts                 # 读取产物 + append 经验到 book.md（CLI 脚本）
    __tests__/
      extract-experience.test.ts
      assemble-experience.test.ts

  shared/                                  # 已有目录（库函数）
    experience-status.ts                   # 🆕 computeAffectedExperience + markExperienceStale

修改：
  src/types/index.ts                       # +ExperiencePatternStatus, +ExperienceCategory, +AffectedExperience
  src/lib/pipeline/phase-definitions.ts    # ASSEMBLE 末尾增加 2 个脚本（critical: false）
  src/runner.ts                            # 增量模式中增加经验 stale 标记（~15 行）
  README.md, AGENTS.md                     # 文档同步

不修改：
  src/lib/assemble/assemble-book.ts        # ❌ 不动，解耦
```

---

## 4. 数据模型

### 4.1 生命周期状态

```
active ──(代码变更)──→ stale ──(SubAgent重验)──→ active
  │                      │
  │                      └──(source<2)──→ orphaned
  │
  └──(手动)──→ deprecated
```

```typescript
// src/types/index.ts 新增

export type ExperiencePatternStatus =
  | "active"      // 正常（≥2 个源聚簇确认）
  | "stale"       // 源聚簇代码已变更，需重验
  | "orphaned"    // 只剩 <2 个源聚簇，降级为单点实现
  | "deprecated"; // 手动废弃

export type ExperienceCategory =
  | "hook"
  | "component"
  | "state"
  | "data-flow"
  | "error"
  | "utility"
  | "architecture"
  | "testing";
```

### 4.2 核心类型

```typescript
// src/types/index.ts 新增

export interface ExperiencePatternMeta {
  id: string;                              // e.g. "EXP-001"
  category: ExperienceCategory;
  status: ExperiencePatternStatus;
  title: string;
  summary: string;
  sourceClusters: string[];                // 来源聚簇 ID
  sourceFiles: string[];                   // sourceRoot-relative
  wikiChapters: string[];                  // 关联 Wiki 章节
  staleReason?: string;
  staleAt?: string;
}

export interface AffectedExperience {
  id: string;
  path: string;                            // volume-3-experience/ 下的相对路径
  category: ExperienceCategory;
  action: "stale" | "orphaned" | "unchanged";
  reason: string;
  remainingClusters: string[];             // 变更后仍存在的来源聚簇
}
```

### 4.3 产物结构

```
wiki/volume-3-experience/
  index.md                  # 经验总索引（目录 + 按分类统计）
  .gen-done                 # SubAgent 完成标记
  hook/
    EXP-001-usefetch.md
    EXP-002-usedebounce.md
  component/
    EXP-003-container-presenter.md
  state/
    EXP-004-context-reducer.md
  data-flow/
    EXP-005-fetch-cache.md
  error/
    EXP-006-error-boundary.md
  utility/
    EXP-007-format-date.md
  architecture/
    EXP-008-plugin-pattern.md
```

单个文档格式：

```yaml
---
id: EXP-001
category: hook
status: active
title: "useFetch — 通用数据获取 Hook"
source_clusters: [cluster-user-list, cluster-product-catalog, cluster-dashboard]
source_files: [hooks/useFetch.ts, api/fetcher.ts]
wiki_chapters: [ch-user-list, ch-product-catalog, ch-dashboard]
detected_at: "2026-06-29T12:00:00Z"
---

# useFetch — 通用数据获取 Hook

## 概述
...

## 适用场景
...

## 标准实现方案
...

## 代码示例
...

## 来源聚簇
...

## 变体差异
...

## 注意事项
...

## 相关经验
- [[EXP-005-fetch-cache]]
```

---

## 5. SubAgent 交互设计

### 5.1 触发方式：用户主动触发（非自动）

```
首次运行（模式 A → ASSEMBLE 完成）：
  ✅ book.md + glossary.md 生成完成
  💡 提示：可选生成通用开发经验？
     → npx tsx src/lib/experience/extract-experience.ts --project ... --wiki ... --cache ...
     → 输出 SubAgent prompt 到 .agentic-wiki/experience-prompts/
     → spawn SubAgent 写入 wiki/volume-3-experience/
     → 再次运行 ASSEMBLE（或直接运行 assemble-experience.ts）
  ✅ [ASSEMBLE] → VALIDATE

增量运行（模式 C → ASSEMBLE）：
  📚 检测到 3 个 stale 经验模式（聚簇 cluster-button, cluster-modal 变更）
  💡 可选：重验经验模式？(--incremental)
  ✅ [ASSEMBLE] → VALIDATE
```

### 5.2 为什么不自动触发？

1. **Token 成本**：SubAgent 需读取大量 Wiki 章节（可能几百 KB）
2. **非核心产物**：book.md 已经是完整 Wiki
3. **用户控制**：用户可以选择跳过或调整 prompt 后执行

### 5.3 SubAgent Prompt 结构

```
你是 AgenticWiki EXPERIENCE SubAgent。

上下文：
  - Wiki 章节: wiki/volume-1-code/
  - 文件元信息: .agentic-wiki/cache/file-meta.json
  - 聚簇信息: .agentic-wiki/cache/task-clusters.json
  - Token 预算: {budget}

任务：跨聚簇提取通用实现模式

步骤 1: 扫描 Wiki 章节（收集核心实现）
步骤 2: 跨聚簇比较（按 8 个分类维度）
步骤 3: 生成经验文档（每模式一个 .md，含 YAML frontmatter）
步骤 4: 生成 index.md（总索引）
步骤 5: 写入 .gen-done 标记（JSON 格式，含 completedAt + files 列表）
步骤 6: 用 ls -la 验证文件存在且非空

提取质量准则：
  - 真实性：只提取实际存在的模式，不凭空推测
  - 通用性：≥2 个不同聚簇才提取
  - 实用性：含可运行代码示例
  - 简洁性：每文档 200-500 行
  - ID 格式：EXP-NNN-shortname.md
```

---

## 6. 增量增删改查逻辑

### 6.1 增量检测（在 runner.ts 增量模式中）

在 Issue stale 标记之后（当前代码 ~第 303 行 `}`），新增经验 stale 检测块：

```typescript
// ─── 经验模式状态更新（stale/orphaned）───────────────────────────
// 聚簇代码变更后，引用这些聚簇的经验模式可能过时
const experiencePath = path.join(paths.wikiRoot, "volume-3-experience");
const clustersExist = fs.existsSync(clustersPath);

if (fs.existsSync(experiencePath) && clustersExist) {
  try {
    const clusterData = fs.readJsonSync(clustersPath);
    const allClusterIds = new Set<string>(
      clusterData.clusters.map((c: { id: string }) => c.id)
    );

    // 从 fileTaskIndex 找出受影响文件所属的聚簇 ID
    const fileTaskIndex = buildFileTaskIndex(undefined, clusterData);
    const affectedClusterIds = new Set<string>();
    for (const file of affectedFiles) {
      const tasks = fileTaskIndex.get(file);
      if (tasks) {
        for (const t of tasks) affectedClusterIds.add(t);
      }
    }

    const { affected, summary } = computeAffectedExperience(
      experiencePath,
      affectedClusterIds,
      allClusterIds,
    );

    if (affected.length > 0) {
      const result = await markExperienceStale(affected, experiencePath);
      console.log(
        `  📚 经验模式状态更新: ${result.staleCount} stale, ` +
          `${result.orphanedCount} orphaned\n`,
      );
    } else {
      console.log("  📚 无受影响的经验模式\n");
    }
  } catch (expErr: unknown) {
    // 经验状态更新失败不阻断增量流程（非关键路径）
    const expErrMsg =
      expErr instanceof Error ? expErr.message : String(expErr);
    console.warn(
      `  ⚠️  经验状态更新失败（不阻断）: ${expErrMsg.slice(0, 200)}\n`,
    );
  }
}
```

### 6.2 重验证（ASSEMBLE 阶段可选触发）

```
如果用户选择重验（extract-experience.ts --incremental）：
  1. 只读取 status == "stale" 的经验文档
  2. 仅读取这些文档 source_clusters 对应的 Wiki 章节
  3. SubAgent 重验后更新 status 为 "active" 或 "orphaned"
  4. assemble-experience.ts 重新 append 到 book.md
```

### 6.3 增量模式中各操作的对应

| 操作 | 触发条件 | 处理 |
|:---|:---|:---|
| **增**（新聚簇引入新模式） | 新代码可能产生新通用模式 | 用户手动重跑全量提取 |
| **删**（聚簇被移除） | source_clusters 中的聚簇 ID 不再存在于 task-clusters.json | `computeAffectedExperience` 检测 remaining < 2 → 标记 orphaned |
| **改**（代码变更影响经验） | 受影响文件所属聚簇是某经验的 source_cluster | `computeAffectedExperience` 检测 → 标记 stale |
| **查**（运行时查询状态） | assemble-experience.ts 生成经验章节时 | 按 status 过滤：active 正常显示，stale 标记警告，orphaned 标记废弃 |

---

## 7. 具体实现点

### 7.1 `src/lib/shared/experience-status.ts`（🆕 库函数）

```typescript
import fse from "fs-extra";
import path from "node:path";
import matter from "gray-matter";
import type { AffectedExperience, ExperiencePatternStatus } from "../types/index.js";

/**
 * Reverse-lookup: scan experience documents and match their source_clusters
 * against the affected cluster set.
 *
 * 类比 computeAffectedIssues（git-diff.ts）的设计模式。
 */
export function computeAffectedExperience(
  experienceDir: string,
  affectedClusterIds: Set<string>,
  allClusterIds: Set<string>,
): { affected: AffectedExperience[]; summary: { stale: number; orphaned: number; unchanged: number; total: number } } {
  const results: AffectedExperience[] = [];
  let stale = 0, orphaned = 0, unchanged = 0;

  // 扫描 volume-3-experience/**/*.md（排除 index.md）
  const { globbySync } = require("globby");
  const expFiles: string[] = globbySync("**/EXP-*.md", {
    cwd: experienceDir,
    onlyFiles: true,
  });

  for (const relPath of expFiles) {
    const fullPath = path.join(experienceDir, relPath);
    const content = fse.readFileSync(fullPath, "utf-8");
    const parsed = matter(content);
    const fm = parsed.data;

    const sourceClusters: string[] = fm.source_clusters || [];
    const id = fm.id || path.basename(relPath, ".md");
    const category = fm.category || "utility";

    // 计算变更后仍存在于 allClusterIds 的聚簇数量
    const remaining = sourceClusters.filter(
      (c) => allClusterIds.has(c) && !affectedClusterIds.has(c)
    );

    const affected = sourceClusters.some((c) => affectedClusterIds.has(c));
    if (!affected) {
      unchanged++;
      continue;
    }

    if (remaining.length < 2) {
      orphaned++;
      results.push({
        id, path: relPath, category,
        action: "orphaned",
        reason: `Only ${remaining.length} unaffected source cluster(s) remain`,
        remainingClusters: remaining,
      });
    } else {
      stale++;
      results.push({
        id, path: relPath, category,
        action: "stale",
        reason: `Source cluster(s) affected by code change`,
        remainingClusters: remaining,
      });
    }
  }

  return {
    affected: results,
    summary: { stale, orphaned, unchanged, total: expFiles.length },
  };
}

/**
 * Batch-mark experience documents as stale/orphaned.
 * Updates YAML frontmatter in-place. Idempotent.
 *
 * 类比 markIssuesStale（issue-status.ts）的设计模式。
 */
export async function markExperienceStale(
  affectedEntries: AffectedExperience[],
  experienceDir: string,
): Promise<{ staleCount: number; orphanedCount: number }> {
  let staleCount = 0, orphanedCount = 0;

  for (const entry of affectedEntries) {
    const fullPath = path.join(experienceDir, entry.path);
    if (!fse.existsSync(fullPath)) continue;

    const raw = fse.readFileSync(fullPath, "utf-8");
    const parsed = matter(raw);

    const newStatus: ExperiencePatternStatus = entry.action === "orphaned" ? "orphaned" : "stale";
    if (parsed.data.status === newStatus) continue; // idempotent

    parsed.data.status = newStatus;
    parsed.data.staleReason = entry.reason;
    parsed.data.staleAt = new Date().toISOString();

    fse.writeFileSync(
      fullPath,
      matter.stringify(parsed.content, parsed.data),
      "utf-8",
    );

    if (newStatus === "stale") staleCount++;
    else orphanedCount++;
  }

  return { staleCount, orphanedCount };
}
```

### 7.2 `src/lib/experience/extract-experience.ts`（🆕 CLI 脚本）

```typescript
/**
 * 生成经验提取 SubAgent prompt。
 *
 * 职责：
 *   - 读取 task-clusters.json + wiki/volume-1-code/ + file-meta.json
 *   - 计算 Token 预算
 *   - 生成 SubAgent prompt 到 .agentic-wiki/experience-prompts/
 *
 * 幂等行为：
 *   - 无 task-clusters.json → 安静退出 (exit 0)，输出提示
 *   - --incremental 模式：只为 stale 经验生成 prompt
 *
 * CLI Usage:
 *   npx tsx src/lib/experience/extract-experience.ts \
 *     --project /path --wiki wiki/ --cache .agentic-wiki/cache/ \
 *     --source src/ --output .agentic-wiki/cache/experience-schedule.json
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("project", { type: "string", demandOption: true })
    .option("wiki", { type: "string", demandOption: true })
    .option("cache", { type: "string", demandOption: true })
    .option("source", { type: "string", demandOption: true })
    .option("output", { type: "string", demandOption: true })
    .option("incremental", { type: "boolean", default: false })
    .parseSync();

  const clustersPath = path.join(argv.cache, "task-clusters.json");

  // 前置条件：聚簇模式
  if (!fs.existsSync(clustersPath)) {
    process.stdout.write(
      "⏭️  经验提取跳过：无 task-clusters.json（需聚簇模式）\n"
    );
    process.exit(0);
  }

  // ... 读取聚簇数据、Wiki 章节、file-meta
  // ... 计算 Token 预算
  // ... 生成 SubAgent prompt
  // ... 输出 experience-schedule.json

  process.stdout.write(
    `Experience prompts generated: ${promptCount} prompt(s)\n`
  );
}

const isMainModule =
  process.argv[1]?.endsWith("extract-experience.ts") ||
  process.argv[1]?.endsWith("extract-experience.js");
if (isMainModule) main();
```

### 7.3 `src/lib/experience/assemble-experience.ts`（🆕 CLI 脚本）

```typescript
/**
 * 读取 volume-3-experience/ 产物，生成经验章节 append 到 book.md。
 *
 * 幂等行为：
 *   - volume-3-experience/ 不存在 → 安静退出 (exit 0)，输出提示
 *   - volume-3-experience/ 存在但无 .gen-done → 安静退出 (exit 0)
 *   - 无 task-clusters.json → 安静退出 (exit 0)
 *   - book.md 已包含经验章节 → 先删除旧章节再 append（幂等重跑）
 *
 * CLI Usage:
 *   npx tsx src/lib/experience/assemble-experience.ts \
 *     --wiki wiki/ --output .agentic-wiki/cache/experience-index.json
 */

import path from "node:path";
import fs from "fs-extra";
import matter from "gray-matter";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// 经验章节的分隔标记（用于幂等删除旧章节）
const EXP_SECTION_START = "\n---\n\n## 📚 通用开发经验\n";
const EXP_SECTION_MARKER = "<!-- experience-section -->";

export interface ExperienceIndex {
  totalPatterns: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  patterns: Array<{ id: string; title: string; category: string; status: string }>;
}

export async function assembleExperience(wikiRoot: string): Promise<ExperienceIndex> {
  const expDir = path.join(wikiRoot, "volume-3-experience");

  // 前置条件检查
  if (!fs.existsSync(expDir)) return { totalPatterns: 0, byCategory: {}, byStatus: {}, patterns: [] };

  const genDone = path.join(expDir, ".gen-done");
  if (!fs.existsSync(genDone)) return { totalPatterns: 0, byCategory: {}, byStatus: {}, patterns: [] };

  const files = await globby("**/EXP-*.md", { cwd: expDir, onlyFiles: true });
  const patterns: ExperienceIndex["patterns"] = [];
  const byCategory: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const rel of files) {
    const raw = await fs.readFile(path.join(expDir, rel), "utf-8");
    const parsed = matter(raw);
    const fm = parsed.data;

    const entry = {
      id: fm.id || path.basename(rel, ".md"),
      title: fm.title || "",
      category: fm.category || "utility",
      status: fm.status || "active",
    };

    patterns.push(entry);
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
  }

  return { totalPatterns: patterns.length, byCategory, byStatus, patterns };
}

export function generateExperienceSection(result: ExperienceIndex): string {
  if (result.totalPatterns === 0) return "";

  const lines: string[] = [
    EXP_SECTION_MARKER,
    EXP_SECTION_START.trim(),
    "",
    `> ${result.totalPatterns} 个通用模式`,
    "",
    "| 分类 | 数量 |",
    "|------|------|",
  ];

  for (const [cat, count] of Object.entries(result.byCategory).sort()) {
    lines.push(`| ${cat} | ${count} |`);
  }

  lines.push("", "### 模式列表", "", "| ID | 标题 | 分类 | 状态 |", "|---|----|------|------|");
  for (const p of result.patterns) {
    const statusIcon = p.status === "active" ? "✅" : p.status === "stale" ? "⚠️" : "❌";
    lines.push(`| ${p.id} | ${p.title} | ${p.category} | ${statusIcon} ${p.status} |`);
  }

  lines.push("", "---", "", `> 💡 由 \`assemble-experience.ts\` 自动生成`);
  return "\n" + lines.join("\n") + "\n";
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("wiki", { type: "string", demandOption: true })
    .option("output", { type: "string", demandOption: true })
    .parseSync();

  const wikiRoot = path.resolve(argv.wiki);
  const result = await assembleExperience(wikiRoot);

  if (result.totalPatterns === 0) {
    process.stdout.write("⏭️  经验组装跳过：无经验文档或 SubAgent 未完成\n");
    process.exit(0);
  }

  // Append experience section to book.md（幂等）
  const bookPath = path.join(wikiRoot, "book.md");
  if (fs.existsSync(bookPath)) {
    let bookContent = await fs.readFile(bookPath, "utf-8");
    // 删除旧的经验章节（幂等）
    const markerIdx = bookContent.indexOf(EXP_SECTION_MARKER);
    if (markerIdx !== -1) {
      bookContent = bookContent.slice(0, markerIdx);
    }
    const section = generateExperienceSection(result);
    await fs.writeFile(bookPath, bookContent + section, "utf-8");
  }

  // 输出索引 JSON
  await fs.outputJson(path.resolve(argv.output), result, { spaces: 2 });
  process.stdout.write(
    `Experience assembled: ${result.totalPatterns} patterns appended to book.md\n`
  );
}

const isMainModule =
  process.argv[1]?.endsWith("assemble-experience.ts") ||
  process.argv[1]?.endsWith("assemble-experience.js");
if (isMainModule) main();
```

### 7.4 phase-definitions.ts — ASSEMBLE 末尾新增

```typescript
// 在 assemble-book.ts 之后追加 2 个非关键脚本：
script(
  "experience/extract-experience.ts",
  [
    "--project", projectRoot,
    "--wiki", wikiRoot,
    "--cache", cacheRoot,
    "--source", sourceRoot,
    "--output", path.join(cacheRoot, "experience-schedule.json"),
  ],
  false,  // critical: false — 失败不阻塞流水线
),
script(
  "experience/assemble-experience.ts",
  [
    "--wiki", wikiRoot,
    "--output", path.join(cacheRoot, "experience-index.json"),
  ],
  false,  // critical: false
),
```

### 7.5 runner.ts — 增量模式新增

在 Issue stale 标记之后（当前代码 ~第 303 行 `}` 之后），增加经验 stale 检测块。
详见 §6.1 的完整代码。

新增 import：
```typescript
import { computeAffectedExperience, markExperienceStale } from "./lib/shared/experience-status.js";
```

---

## 8. 幂等性与边界行为

| 场景 | 行为 |
|:---|:---|
| 首次运行 + 无 task-clusters.json（文件夹回退模式） | `extract-experience.ts` 输出提示后 exit 0，不产生产物 |
| 首次运行 + 有 task-clusters.json + 用户未 spawn SubAgent | `extract-experience.ts` 生成 prompt 后 exit 0；`assemble-experience.ts` 检测无 `.gen-done` → exit 0 |
| 首次运行 + SubAgent 已完成 | `assemble-experience.ts` 读取产物 → append 到 book.md |
| 增量运行 + volume-3-experience/ 不存在 | 跳过经验 stale 检测（非关键路径） |
| 增量运行 + volume-3-experience/ 存在 | 执行 `computeAffectedExperience` → 标记 stale/orphaned |
| ASSEMBLE 重跑 | `assemble-experience.ts` 先删除 book.md 中旧的经验章节，再 append 新的（幂等） |
| `extract-experience.ts` 执行失败 | critical: false，不阻塞 VALIDATE |
| `assemble-experience.ts` 执行失败 | critical: false，不阻塞 VALIDATE |

---

## 9. 验收标准

| # | 验收项 | 验证方式 |
|:---|:---|:---|
| 1 | 首次全量：book.md 正常生成（无经验章节也可） | 运行模式 A，检查 book.md 不含经验章节 |
| 2 | 手动触发后，book.md 包含经验章节 | spawn SubAgent → 重跑 ASSEMBLE，检查经验章节 |
| 3 | 增量模式标记受影响经验为 stale | 改代码 → 模式 C，检查 frontmatter status = stale |
| 4 | orphaned 状态（source < 2）自动标记 | 删除聚簇 → 增量，检查经验文件 status = orphaned |
| 5 | 经验提取失败不阻塞 VALIDATE | 模拟 extract-experience.ts 失败，确认流水线继续 |
| 6 | 现有测试全量通过 | `npm test` |
| 7 | Lint 无 error | `npm run lint` |
| 8 | 无 task-clusters.json 时两个脚本安静退出 | 删除 task-clusters.json → ASSEMBLE，检查 exit 0 |
| 9 | book.md 经验章节幂等（重跑不重复） | 多次 ASSEMBLE → book.md 只有一份经验章节 |
| 10 | runner.ts 增量模式经验检测失败不阻断 | 模拟异常 → 检查流水线继续 |

---

## 10. 不做的

- ❌ 不增加独立流水线阶段
- ❌ 不自动触发 SubAgent（Token 成本由用户控制）
- ❌ 不增加 GEN 式的 resume 分支逻辑
- ❌ 不做正则模式匹配（用 LLM 做语义分析）
- ❌ 不修改 `assemble-book.ts`（解耦设计）
- ❌ 不支持文件夹回退模式的经验提取（聚簇是前提）

---

## 11. 实施优先级

| 优先级 | 任务 | 产物 |
|:---|:---|:---|
| P0 | 类型定义 | `src/types/index.ts` 新增 4 个类型 |
| P0 | 库函数 | `src/lib/shared/experience-status.ts` |
| P1 | CLI 脚本 | `src/lib/experience/assemble-experience.ts` |
| P1 | CLI 脚本 | `src/lib/experience/extract-experience.ts` |
| P1 | 流水线注册 | `phase-definitions.ts` ASSEMBLE 末尾 +2 脚本 |
| P2 | 增量集成 | `runner.ts` 增量模式 +15 行 |
| P2 | 单元测试 | `__tests__/` 下 2 个测试文件 |
| P3 | 文档同步 | `README.md` + `AGENTS.md` 更新 |
