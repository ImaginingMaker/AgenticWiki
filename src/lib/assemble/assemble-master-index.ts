/**
 * Assemble Master Index — 🆕 统一入口 index.md 生成器。
 *
 * 扫描三个 Volume 的统计信息，生成 wiki/index.md 作为 Obsidian 关系图谱的
 * 唯一入口节点，链接到三个子索引：
 *   - Volume 1: book.md（Wiki 目录）
 *   - Volume 2: issues.md（Issue 仪表盘）
 *   - Volume 3: experience.md（经验索引）
 *
 * 同时链接 glossary.md（术语表）和 file-issues.md（文件→Issue 反向索引）。
 *
 * Usage:
 *   npx tsx src/lib/assemble/assemble-master-index.ts \
 *     --wiki wiki/ \
 *     --output wiki/index.md
 */

import path from "node:path";
import fs from "fs-extra";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// === Types ===

interface VolumeStats {
  exists: boolean;
  totalPages?: number;
  totalChapters?: number;
  totalSymbols?: number;
}

interface MasterIndexData {
  wiki: VolumeStats;
  issues: VolumeStats & { totalIssues?: number; critical?: number; high?: number };
  experience: VolumeStats & { totalPatterns?: number; active?: number; stale?: number };
  glossary: { exists: boolean };
  fileIssues: { exists: boolean };
}

// === Collectors ===

async function collectWikiStats(wikiRoot: string): Promise<VolumeStats> {
  const v1 = path.join(wikiRoot, "volume-1-code");
  if (!(await fs.pathExists(v1))) return { exists: false };

  const bookPath = path.join(wikiRoot, "book.md");
  if (await fs.pathExists(bookPath)) {
    const bookContent = await fs.readFile(bookPath, "utf-8");
    const chapterMatch = bookContent.match(/chapters:\s*(\d+)/);
    const pagesMatch = bookContent.match(/pages:\s*(\d+)/);
    const symbolsMatch = bookContent.match(/symbols:\s*(\d+)/);
    return {
      exists: true,
      totalChapters: chapterMatch ? parseInt(chapterMatch[1], 10) : undefined,
      totalPages: pagesMatch ? parseInt(pagesMatch[1], 10) : undefined,
      totalSymbols: symbolsMatch ? parseInt(symbolsMatch[1], 10) : undefined,
    };
  }

  // Fallback: count files
  const files = await globby(["**/*.md"], {
    cwd: v1,
    ignore: ["**/.gen-done"],
    onlyFiles: true,
  });
  return {
    exists: true,
    totalPages: files.length,
    totalChapters: new Set(files.map((f) => f.split("/")[0])).size,
  };
}

async function collectIssueStats(wikiRoot: string): Promise<MasterIndexData["issues"]> {
  const v2 = path.join(wikiRoot, "volume-2-issues");
  if (!(await fs.pathExists(v2))) return { exists: false };

  const dashboardPath = path.join(wikiRoot, "issues.md");
  if (await fs.pathExists(dashboardPath)) {
    const content = await fs.readFile(dashboardPath, "utf-8");
    // Extract total from "| **合计** | **N** |"
    const totalMatch = content.match(/\| \*\*合计\*\* \| \*\*(\d+)\*\* \|/);
    // Extract severity counts from mermaid pie
    const criticalMatch = content.match(/"致命"\s*:\s*(\d+)/);
    const highMatch = content.match(/"高"\s*:\s*(\d+)/);

    return {
      exists: true,
      totalIssues: totalMatch ? parseInt(totalMatch[1], 10) : undefined,
      critical: criticalMatch ? parseInt(criticalMatch[1], 10) : undefined,
      high: highMatch ? parseInt(highMatch[1], 10) : undefined,
    };
  }

  // Fallback: count IS-*.md files
  const files = await globby(["**/IS-*.md"], {
    cwd: v2,
    ignore: ["ch-99-archived/**"],
    onlyFiles: true,
  });
  return {
    exists: true,
    totalIssues: files.length,
  };
}

async function collectExperienceStats(wikiRoot: string): Promise<MasterIndexData["experience"]> {
  const v3 = path.join(wikiRoot, "volume-3-experience");
  if (!(await fs.pathExists(v3))) return { exists: false };

  const experienceMdPath = path.join(wikiRoot, "experience.md");
  if (await fs.pathExists(experienceMdPath)) {
    const content = await fs.readFile(experienceMdPath, "utf-8");
    const patternsMatch = content.match(/total_patterns:\s*(\d+)/);
    const activeMatch = content.match(/active:\s*(\d+)/);
    const staleMatch = content.match(/stale:\s*(\d+)/);

    return {
      exists: true,
      totalPatterns: patternsMatch ? parseInt(patternsMatch[1], 10) : undefined,
      active: activeMatch ? parseInt(activeMatch[1], 10) : undefined,
      stale: staleMatch ? parseInt(staleMatch[1], 10) : undefined,
    };
  }

  // Fallback: count EXP-*.md files
  const files = await globby(["**/EXP-*.md"], {
    cwd: v3,
    ignore: ["EXP-0[0-9][0-9]-*.md"], // candidate docs
    onlyFiles: true,
  });
  return {
    exists: true,
    totalPatterns: files.length,
  };
}

// === Generate ===

export function generateMasterIndex(data: MasterIndexData): string {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const lines: string[] = [
    "---",
    `generated_at: "${now}"`,
    "type: master_index",
    "---",
    "",
    "# 📖 项目知识库",
    "",
    `> 🕐 生成时间：${now}`,
    "> 本索引是项目知识库的统一入口，链接到三个分析产物 Volume。",
    "",
    "---",
    "",
    "## 📊 概览",
    "",
    "| Volume | 类型 | 状态 |",
    "|--------|------|------|",
  ];

  // Wiki row
  if (data.wiki.exists) {
    const parts: string[] = [];
    if (data.wiki.totalChapters) parts.push(`${data.wiki.totalChapters} 章`);
    if (data.wiki.totalPages) parts.push(`${data.wiki.totalPages} 页`);
    if (data.wiki.totalSymbols) parts.push(`${data.wiki.totalSymbols} 符号`);
    lines.push(`| 📖 [[book|代码 Wiki]] | 文档 | ${parts.join(" / ") || "✓"} |`);
  }

  // Issues row
  if (data.issues.exists) {
    const parts: string[] = [];
    if (data.issues.totalIssues) {
      parts.push(`${data.issues.totalIssues} 个 Issue`);
      if (data.issues.critical) parts.push(`${data.issues.critical} ⛔致命`);
      if (data.issues.high) parts.push(`${data.issues.high} 🔴高`);
    }
    lines.push(`| 🐛 [[issues|代码问题]] | Issue | ${parts.join(" / ") || "✓"} |`);
  }

  // Experience row
  if (data.experience.exists) {
    const parts: string[] = [];
    if (data.experience.totalPatterns) {
      parts.push(`${data.experience.totalPatterns} 个模式`);
      if (data.experience.active) parts.push(`${data.experience.active} 活跃`);
    }
    lines.push(`| 🧠 [[experience|开发经验]] | 经验 | ${parts.join(" / ") || "✓"} |`);
  }

  lines.push("");

  // === Volume 1: Wiki ===
  lines.push(
    "---",
    "",
    "## 📖 Volume 1: 代码 Wiki",
    "",
  );

  if (data.wiki.exists) {
    lines.push(
      "> 自动从源码提取的代码文档，按依赖关系组织为章节。",
      "",
      "| 文档 | 说明 |",
      "|------|------|",
      "| [[book|📚 Wiki 目录]] | 完整章节树，按功能模块组织 |",
      "| [[glossary|📚 术语表]] | 组件 / Hook / 函数 符号速查 |",
      "",
    );
  } else {
    lines.push("> ⚠️ Volume 1 尚未生成。运行 Runner 的 GEN → ASSEMBLE 阶段后自动产出。", "");
  }

  // === Volume 2: Issues ===
  lines.push(
    "## 🐛 Volume 2: 代码问题",
    "",
  );

  if (data.issues.exists) {
    lines.push(
      "> 从代码中自动检测的问题，按严重等级和类型组织。",
      "> Issue 与源代码文件双向绑定，可在 Obsidian 图谱中追踪。",
      "",
      "| 文档 | 说明 |",
      "|------|------|",
      "| [[issues|🐛 Issue 仪表盘]] | 全部 Issue 统计与待处理清单 |",
    );

    if (data.fileIssues.exists) {
      lines.push("| [[file-issues|📋 文件 → Issue 索引]] | 从源文件反向查找关联 Issue |");
    }

    lines.push("");
  } else {
    lines.push("> ⚠️ Volume 2 尚未生成。运行 Runner 的 GEN 阶段并启用 Issue 产出后自动生成。", "");
  }

  // === Volume 3: Experience ===
  lines.push(
    "## 🧠 Volume 3: 开发经验",
    "",
  );

  if (data.experience.exists) {
    lines.push(
      "> 跨聚簇提取的通用开发模式，可直接复用于新需求开发。",
      "",
      "| 文档 | 说明 |",
      "|------|------|",
      "| [[experience|🧠 经验索引]] | 按分类组织的开发模式目录 |",
      "",
    );
  } else {
    lines.push("> ⚠️ Volume 3 尚未生成。运行 Runner 的 GEN 阶段并启用 Experience 产出后自动生成。", "");
  }

  // === Navigation ===
  lines.push(
    "---",
    "",
    "## 🧭 快速导航",
    "",
  );

  const navItems: string[] = [];
  if (data.wiki.exists) {
    navItems.push("- 📖 [[book|Wiki 目录]] → 浏览代码文档");
    navItems.push("- 📚 [[glossary|术语表]] → 按符号名查找");
  }
  if (data.issues.exists) {
    navItems.push("- 🐛 [[issues|Issue 仪表盘]] → 查看代码问题");
  }
  if (data.fileIssues.exists) {
    navItems.push("- 📋 [[file-issues|文件→Issue]] → 按源文件查 Issue");
  }
  if (data.experience.exists) {
    navItems.push("- 🧠 [[experience|经验索引]] → 浏览开发模式");
  }
  lines.push(...navItems, "");

  lines.push(
    "---",
    "",
    "> 💡 本文件由 `assemble-master-index.ts` 自动生成，Runner ASSEMBLE 阶段结束时更新。",
    "",
  );

  return lines.join("\n");
}

// === CLI ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("wiki", { type: "string", demandOption: true, description: "Path to wiki root" })
    .option("output", { type: "string", description: "Output path (default: wiki/index.md)" })
    .parseSync();

  const wikiRoot = path.resolve(argv.wiki);

  if (!(await fs.pathExists(wikiRoot))) {
    console.log("master-index: wiki root not found, skipping.");
    process.exit(0);
  }

  const [wiki, issues, experience] = await Promise.all([
    collectWikiStats(wikiRoot),
    collectIssueStats(wikiRoot),
    collectExperienceStats(wikiRoot),
  ]);

  const glossary = { exists: await fs.pathExists(path.join(wikiRoot, "glossary.md")) };
  const fileIssues = { exists: await fs.pathExists(path.join(wikiRoot, "file-issues.md")) };

  const data: MasterIndexData = { wiki, issues, experience, glossary, fileIssues };
  const md = generateMasterIndex(data);

  const outputPath = path.resolve(argv.output || path.join(wikiRoot, "index.md"));
  await fs.outputFile(outputPath, md, "utf-8");

  const summary: string[] = [];
  if (wiki.exists) summary.push(`Wiki: ${wiki.totalChapters ?? "?"}章/${wiki.totalPages ?? "?"}页`);
  if (issues.exists) summary.push(`Issue: ${issues.totalIssues ?? "?"}个`);
  if (experience.exists) summary.push(`经验: ${experience.totalPatterns ?? "?"}模式`);

  console.log(`Master Index: ${outputPath}`);
  console.log(`  ${summary.join(" | ")}`);
}

const isMainModule =
  process.argv[1]?.endsWith("assemble-master-index.ts") ||
  process.argv[1]?.endsWith("assemble-master-index.js");
if (isMainModule) main();
