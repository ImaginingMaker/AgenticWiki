/**
 * assemble-experience.ts — 通用开发经验组装器。
 *
 * 在 ASSEMBLE 阶段末尾运行（非关键脚本）。
 * 功能：
 *   1. 合并 per-cluster candidate 经验文档为 canonical 格式（mergeClusterExperiences）
 *   2. 扫描 volume-3-experience/ 目录，提取经验文档元信息（assembleExperience）
 *   3. 生成 Markdown 经验章节（generateExperienceSection）
 *   4. 增量模式：标记经验文档为 stale/orphaned（markExperienceStale）
 *
 * Usage:
 *   npx tsx src/lib/experience/assemble-experience.ts \
 *     --wiki wiki/ \
 *     --output .agentic-wiki/cache/experience-index.json
 */

import path from "node:path";
import fs from "fs-extra";
import { globby } from "globby";
import matter from "gray-matter";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type {
  ExperiencePatternMeta,
  ExperienceCategory,
  ExperienceIndex,
  AffectedExperience,
} from "../../types/index.js";

// === Types ===

interface ExperienceAssembleResult extends ExperienceIndex {
  stats: {
    totalCategories: number;
    totalFiles: number;
  };
}

// === Helpers ===

/** Escape a string for use inside a YAML double-quoted value. */
function sanitizeYamlString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

// === Core ===

export async function assembleExperience(
  wikiRoot: string,
): Promise<ExperienceAssembleResult> {
  const v3 = path.join(wikiRoot, "volume-3-experience");
  if (!fs.existsSync(v3)) {
    return {
      generatedAt: new Date().toISOString(),
      totalPatterns: 0,
      byCategory: {},
      patterns: [],
      stats: { totalCategories: 0, totalFiles: 0 },
    };
  }

  const files = await globby(["**/*.md"], {
    cwd: v3,
    onlyFiles: true,
    ignore: [".gen-done"],
  });

  const patterns: ExperiencePatternMeta[] = [];

  for (const rel of files) {
    const raw = await fs.readFile(path.join(v3, rel), "utf-8");
    const parsed = matter(raw);

    const id = parsed.data.id || path.basename(rel, ".md");
    const category = (parsed.data.category ||
      path.dirname(rel)) as ExperienceCategory;
    const status = parsed.data.status || "active";
    const title = parsed.data.title || "";
    const summary = parsed.data.summary || "";
    const sourceClusters: string[] = Array.isArray(parsed.data.source_clusters)
      ? parsed.data.source_clusters
      : [];
    const sourceFiles: string[] = Array.isArray(parsed.data.source_files)
      ? parsed.data.source_files
      : [];
    const wikiChapters: string[] = Array.isArray(parsed.data.wiki_chapters)
      ? parsed.data.wiki_chapters
      : [];
    const staleReason = parsed.data.staleReason || undefined;
    const staleAt = parsed.data.staleAt || undefined;

    patterns.push({
      id,
      category,
      status,
      title,
      summary,
      sourceClusters,
      sourceFiles,
      wikiChapters,
      staleReason,
      staleAt,
    });
  }

  const byCategory: Record<string, ExperiencePatternMeta[]> = {};
  for (const p of patterns) {
    const cat = p.category || "uncategorized";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(p);
  }

  return {
    generatedAt: new Date().toISOString(),
    totalPatterns: patterns.length,
    byCategory,
    patterns,
    stats: {
      totalCategories: Object.keys(byCategory).length,
      totalFiles: files.length,
    },
  };
}

// === Candidate Merge (🆕 per-cluster → canonical) ===

interface CandidateDoc {
  id: string;
  category: string;
  title: string;
  summary: string;
  tags: string[];
  sourceClusters: string[];
  sourceFiles: string[];
  wikiChapters: string[];
  rawContent: string;
  filePath: string;
}

/**
 * Merge per-cluster candidate experience docs into canonical docs.
 *
 * Each GEN SubAgent writes candidate docs like:
 *   volume-3-experience/{category}/EXP-{clusterId}-{slug}.md
 *
 * This function groups candidates by (category, normalized title) and merges
 * them into canonical docs with sequential IDs (EXP-001, EXP-002, ...).
 *
 * Quality rule: only promotes to active if >=2 clusters share the pattern.
 * Single-cluster patterns remain as candidates on disk (not displayed in book.md).
 */
export async function mergeClusterExperiences(
  wikiRoot: string,
): Promise<{ merged: number; promoted: number; candidate: number }> {
  const v3 = path.join(wikiRoot, "volume-3-experience");
  if (!fs.existsSync(v3)) return { merged: 0, promoted: 0, candidate: 0 };

  // 1. Collect all candidate docs
  const candidateFiles = await globby(["**/EXP-*-*.md"], {
    cwd: v3,
    onlyFiles: true,
    ignore: ["EXP-0[0-9][0-9]-*.md", ".gen-done", "index.md"],
  });

  if (candidateFiles.length === 0)
    return { merged: 0, promoted: 0, candidate: 0 };

  const candidates: CandidateDoc[] = [];
  for (const rel of candidateFiles) {
    const fullPath = path.join(v3, rel);
    const raw = fs.readFileSync(fullPath, "utf-8");
    const parsed = matter(raw);

    if (parsed.data.status !== "candidate") continue;

    const category = parsed.data.category || path.dirname(rel);
    const id = parsed.data.id || path.basename(rel, ".md");

    candidates.push({
      id,
      category,
      title: parsed.data.title || "",
      summary: parsed.data.summary || "",
      tags: Array.isArray(parsed.data.tags) ? parsed.data.tags : [],
      sourceClusters: Array.isArray(parsed.data.source_clusters)
        ? parsed.data.source_clusters
        : [],
      sourceFiles: Array.isArray(parsed.data.source_files)
        ? parsed.data.source_files
        : [],
      wikiChapters: Array.isArray(parsed.data.wiki_chapters)
        ? parsed.data.wiki_chapters
        : [],
      rawContent: parsed.content || "",
      filePath: fullPath,
    });
  }

  if (candidates.length === 0) return { merged: 0, promoted: 0, candidate: 0 };

  // 2. Group by (category, normalized title).
  //    Using title (not filename) avoids issues with hyphenated cluster IDs
  //    like "date-picker" that would break simple filename parsing.
  //    e.g., "useAsyncAction 模式" → "useasyncaction"
  const groups = new Map<string, CandidateDoc[]>();
  for (const c of candidates) {
    const normalizedTitle = (c.title || c.summary || c.id)
      .replace(/[^\p{L}\p{N}]/gu, "")
      .toLowerCase()
      .slice(0, 60);
    const key = `${c.category}/${normalizedTitle}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  // 3. Generate merged canonical docs with sequential IDs
  for (const [, group] of groups) {
    if (group.length === 0) continue;
    const cat = group[0].category;
    fs.ensureDirSync(path.join(v3, cat));
  }

  // Find existing canonical IDs to avoid collisions
  const existingCanonical = await globby(["**/EXP-0[0-9][0-9]-*.md"], {
    cwd: v3,
    onlyFiles: true,
  });
  const existingIds = new Set<number>();
  for (const f of existingCanonical) {
    const m = path.basename(f).match(/^EXP-(\d{3})-/);
    if (m) existingIds.add(parseInt(m[1], 10));
  }

  let nextId = 1;
  while (existingIds.has(nextId)) nextId++;

  let promoted = 0;
  let candidateRemaining = 0;

  for (const [, group] of groups) {
    const category = group[0].category;

    // Merge all candidates in the group
    const mergedClusters = new Set<string>();
    const mergedFiles = new Set<string>();
    const mergedChapters = new Set<string>();
    const mergedTags = new Set<string>();
    let bestTitle = group[0].title;
    let bestSummary = group[0].summary;

    for (const c of group) {
      for (const cl of c.sourceClusters) mergedClusters.add(cl);
      for (const f of c.sourceFiles) mergedFiles.add(f);
      for (const ch of c.wikiChapters) mergedChapters.add(ch);
      for (const t of c.tags) mergedTags.add(t);
      if (c.title.length > bestTitle.length) bestTitle = c.title;
      if (c.summary.length > bestSummary.length) bestSummary = c.summary;
    }

    const clusters = Array.from(mergedClusters).sort();
    const isCrossCluster = clusters.length >= 2;

    // Derive a clean slug from title for the canonical filename
    const slug =
      bestTitle
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .replace(/\s+/g, "-")
        .toLowerCase()
        .slice(0, 40) || "pattern";

    const expId = `EXP-${String(nextId).padStart(3, "0")}`;
    const canonicalFile = `${expId}-${slug}.md`;
    const canonicalPath = path.join(v3, category, canonicalFile);

    const now = new Date().toISOString();
    const frontmatter = [
      `---`,
      `id: ${expId}`,
      `category: ${category}`,
      `status: ${isCrossCluster ? "active" : "candidate"}`,
      `title: "${sanitizeYamlString(bestTitle)}"`,
      `summary: "${sanitizeYamlString(bestSummary)}"`,
      `tags:`,
      ...Array.from(mergedTags)
        .sort()
        .map((t) => `  - ${t}`),
      `source_clusters:`,
      ...clusters.map((c) => `  - ${c}`),
      `source_files:`,
      ...Array.from(mergedFiles)
        .sort()
        .map((f) => `  - ${f}`),
      `wiki_chapters:`,
      ...Array.from(mergedChapters)
        .sort()
        .map((ch) => `  - ${ch}`),
      `lastUpdated: ${now}`,
      `---`,
    ].join("\n");

    const bestContent = group
      .map((c) => c.rawContent.trim())
      .sort((a, b) => b.length - a.length)[0];

    fs.writeFileSync(
      canonicalPath,
      frontmatter + "\n\n" + bestContent + "\n",
      "utf-8",
    );

    // Remove old candidate files
    for (const c of group) {
      if (c.filePath !== canonicalPath && fs.existsSync(c.filePath)) {
        fs.removeSync(c.filePath);
      }
    }

    if (isCrossCluster) {
      promoted++;
    } else {
      candidateRemaining++;
    }
    nextId++;
  }

  return { merged: groups.size, promoted, candidate: candidateRemaining };
}

// === Markdown Generation ===

/**
 * Generate the Markdown section for volume-3-experience in book.md.
 * Called by assemble-book.ts.
 *
 * Only displays patterns with status: active, stale, or orphaned.
 * candidate patterns are kept on disk for future merging but not shown.
 */
export function generateExperienceSection(
  result: ExperienceAssembleResult,
): string {
  // Filter out candidate patterns (single-cluster, not yet confirmed as common)
  const displayPatterns = result.patterns.filter(
    (p) => p.status !== "candidate",
  );

  if (displayPatterns.length === 0) return "";

  const categoryLabels: Record<string, string> = {
    hook: "🪝 自定义 Hook 模式",
    component: "🧩 组件组合模式",
    state: "📦 状态管理模式",
    "data-flow": "🔄 数据流模式",
    error: "⚠️ 错误处理模式",
    utility: "🔧 工具函数模式",
    architecture: "🏗️ 架构决策模式",
    testing: "🧪 测试模式",
    uncategorized: "📌 未分类",
    index: "📚 索引",
  };

  const statusLabels: Record<string, string> = {
    active: "",
    stale: " ⚠️[待重验]",
    orphaned: " 🗑️[已废弃]",
    deprecated: " ❌[已弃用]",
  };

  // Build byCategory from filtered patterns only
  const byCategory: Record<string, ExperiencePatternMeta[]> = {};
  for (const p of displayPatterns) {
    const cat = p.category || "uncategorized";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(p);
  }

  const sortedCategories = Object.entries(byCategory).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const candidateCount = result.patterns.length - displayPatterns.length;
  const lines: string[] = [
    "",
    "---",
    "",
    "## 📚 通用开发经验",
    "",
    `> 从 ${Object.keys(byCategory).length} 个分类中提取的 ${displayPatterns.length} 个通用实现模式。`,
    candidateCount > 0
      ? `> ${candidateCount} 个单聚簇候选模式暂未列出（等待更多聚簇确认）。`
      : "> 这些经验来源于跨聚簇分析，可直接复用于新需求开发。",
    "",
    "### 经验目录",
    "",
    "| 分类 | 活跃 | stale | 废弃 |",
    "|------|------|-------|------|",
  ];

  for (const [cat, metas] of sortedCategories) {
    const label = categoryLabels[cat] || cat;
    const activeCount = metas.filter((m) => m.status === "active").length;
    const staleCount = metas.filter((m) => m.status === "stale").length;
    const orphanedCount = metas.filter(
      (m) => m.status === "orphaned" || m.status === "deprecated",
    ).length;
    lines.push(
      `| ${label} | ${activeCount} | ${staleCount} | ${orphanedCount} |`,
    );
  }

  lines.push("", "---", "");

  for (const [cat, metas] of sortedCategories) {
    const label = categoryLabels[cat] || cat;
    lines.push(`### ${label}`, "");

    for (const meta of metas.sort((a, b) => a.id.localeCompare(b.id))) {
      const linkPath = `volume-3-experience/${cat}/${meta.id}.md`;
      const summary = meta.summary || meta.title || meta.id;
      const statusTag = statusLabels[meta.status] || "";
      const clusterStr =
        meta.sourceClusters.length > 0
          ? ` | 来源: ${meta.sourceClusters.slice(0, 3).join(", ")}${meta.sourceClusters.length > 3 ? "..." : ""}`
          : "";
      lines.push(
        `- [${meta.id}](${linkPath})${statusTag} — ${summary}${clusterStr}`,
      );
    }

    lines.push("");
  }

  lines.push("---", "", `> 💡 由 \`assemble-experience.ts\` 自动生成`, "");

  return lines.join("\n");
}

// === Incremental Support ===

/**
 * Mark experience patterns as stale/orphaned based on affected clusters.
 */
export async function markExperienceStale(
  affectedEntries: Pick<
    AffectedExperience,
    "id" | "path" | "action" | "reason"
  >[],
  experienceDir: string,
): Promise<{ staleCount: number; orphanedCount: number }> {
  let staleCount = 0;
  let orphanedCount = 0;
  const now = new Date().toISOString();

  for (const entry of affectedEntries) {
    if (entry.action === "unchanged") continue;

    const filePath = path.join(experienceDir, entry.path);
    if (!fs.existsSync(filePath)) continue;

    let raw = fs.readFileSync(filePath, "utf-8");
    const reasonEscaped = sanitizeYamlString(entry.reason);

    const statusLine = `status: ${entry.action}`;
    const reasonLine = `staleReason: "${reasonEscaped}"`;
    const atLine = `staleAt: "${now}"`;

    if (raw.match(/^status:\s*/m)) {
      raw = raw.replace(/^status:\s*.*$/m, statusLine);
    } else {
      raw = raw.replace(/^---\n/, `---\n${statusLine}\n`);
    }

    if (raw.match(/^staleReason:\s*/m)) {
      raw = raw.replace(/^staleReason:\s*.*$/m, reasonLine);
    } else {
      raw = raw.replace(/^(status:\s*.*\n)/m, `$1${reasonLine}\n`);
    }

    if (raw.match(/^staleAt:\s*/m)) {
      raw = raw.replace(/^staleAt:\s*.*$/m, atLine);
    } else {
      raw = raw.replace(/^(staleReason:\s*.*\n)/m, `$1${atLine}\n`);
    }

    fs.writeFileSync(filePath, raw, "utf-8");

    if (entry.action === "stale") staleCount++;
    else if (entry.action === "orphaned") orphanedCount++;
  }

  return { staleCount, orphanedCount };
}

// === CLI ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("wiki", { type: "string", demandOption: true })
    .option("output", { type: "string" })
    .parseSync();

  const wikiRoot = path.resolve(argv.wiki);

  // 🆕 Step 0: Merge per-cluster candidate docs into canonical format
  const mergeResult = await mergeClusterExperiences(wikiRoot);
  if (mergeResult.merged > 0) {
    console.log(
      `候选经验合并完成:` +
        `\n   合并组数: ${mergeResult.merged}` +
        `\n   升级为活跃: ${mergeResult.promoted}（≥2 聚簇）` +
        `\n   保留候选: ${mergeResult.candidate}（单聚簇）`,
    );
  }

  const result = await assembleExperience(wikiRoot);

  if (argv.output) {
    await fs.outputJson(path.resolve(argv.output), result, { spaces: 2 });
  }

  const candidateCount = result.patterns.filter(
    (p) => p.status === "candidate",
  ).length;
  const displayCount = result.patterns.length - candidateCount;

  console.log(
    `经验文档组装完成:` +
      `\n   显示模式数: ${displayCount}（活跃 + stale + 废弃）` +
      `\n   候选模式数: ${candidateCount}（单聚簇，未显示）` +
      `\n   分类数: ${result.stats.totalCategories}` +
      `\n   文件数: ${result.stats.totalFiles}`,
  );

  for (const [cat, metas] of Object.entries(result.byCategory)) {
    const active = metas.filter((m) => m.status === "active").length;
    const stale = metas.filter((m) => m.status === "stale").length;
    const orphaned = metas.filter(
      (m) => m.status === "orphaned" || m.status === "deprecated",
    ).length;
    const cand = metas.filter((m) => m.status === "candidate").length;
    console.log(
      `   ${cat}: ${metas.length} 个（${active} active, ${stale} stale, ${orphaned} orphaned, ${cand} candidate）`,
    );
  }

  // Append experience section to book.md if it exists
  const bookPath = path.join(wikiRoot, "book.md");
  if (fs.existsSync(bookPath) && displayCount > 0) {
    const section = generateExperienceSection(result);
    await fs.appendFile(bookPath, section, "utf-8");
    console.log("  📚 经验章节已追加到 book.md");
  }
}

const isMainModule =
  process.argv[1]?.endsWith("assemble-experience.ts") ||
  process.argv[1]?.endsWith("assemble-experience.js");
if (isMainModule) main();
