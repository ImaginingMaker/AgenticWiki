/**
 * assemble-experience.ts — 通用开发经验组装器。
 *
 * 在 ASSEMBLE 阶段末尾运行（非关键脚本）。
 * 功能：
 *   1. 扫描 volume-3-experience/ 目录，提取经验文档元信息
 *   2. 生成经验索引（供 assemble-book.ts 使用）
 *   3. 生成 Markdown 经验章节（追加到 book.md）
 *   4. 增量模式：标记经验文档为 stale/orphaned
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

/**
 * Generate the Markdown section for volume-3-experience in book.md.
 * Called by assemble-book.ts.
 */
export function generateExperienceSection(
  result: ExperienceAssembleResult,
): string {
  if (result.totalPatterns === 0) return "";

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

  const sortedCategories = Object.entries(result.byCategory).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const lines: string[] = [
    "",
    "---",
    "",
    "## 📚 通用开发经验",
    "",
    `> 从 ${result.stats.totalCategories} 个分类中提取的 ${result.totalPatterns} 个通用实现模式。`,
    "> 这些经验来源于跨聚簇分析，可直接复用于新需求开发。",
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
 *
 * Updates the YAML frontmatter of affected .md files with:
 *   - status: "stale" | "orphaned"
 *   - staleReason: description of why
 *   - staleAt: ISO timestamp
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
    const reasonEscaped = entry.reason.replace(/"/g, '\\"');

    // Update or add frontmatter fields
    const statusLine = `status: ${entry.action}`;
    const reasonLine = `staleReason: "${reasonEscaped}"`;
    const atLine = `staleAt: "${now}"`;

    // Replace existing or insert after YAML start
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
  const result = await assembleExperience(wikiRoot);

  if (argv.output) {
    await fs.outputJson(path.resolve(argv.output), result, { spaces: 2 });
  }

  console.log(
    `经验文档组装完成:` +
      `\n   总模式数: ${result.totalPatterns}` +
      `\n   分类数: ${result.stats.totalCategories}` +
      `\n   文件数: ${result.stats.totalFiles}`,
  );

  for (const [cat, metas] of Object.entries(result.byCategory)) {
    const active = metas.filter((m) => m.status === "active").length;
    const stale = metas.filter((m) => m.status === "stale").length;
    const orphaned = metas.filter(
      (m) => m.status === "orphaned" || m.status === "deprecated",
    ).length;
    console.log(
      `   ${cat}: ${metas.length} 个（${active} active, ${stale} stale, ${orphaned} orphaned）`,
    );
  }

  // Append experience section to book.md if it exists
  const bookPath = path.join(wikiRoot, "book.md");
  if (fs.existsSync(bookPath) && result.totalPatterns > 0) {
    const section = generateExperienceSection(result);
    await fs.appendFile(bookPath, section, "utf-8");
    console.log("  📚 经验章节已追加到 book.md");
  }
}

const isMainModule =
  process.argv[1]?.endsWith("assemble-experience.ts") ||
  process.argv[1]?.endsWith("assemble-experience.js");
if (isMainModule) main();
