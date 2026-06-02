/**
 * Assemble Book — 将分散的 Wiki 章节组装为完整文档。
 *
 * 功能：
 *   1. 扫描所有 wiki/volume-1-code/ 章节，生成带目录的 book.md
 *   2. 从 Wiki 标题中提取符号，生成 glossary.md 术语表
 *
 * 替代编排器 ASSEMBLE Step 3 中手工拼接 Wiki 的操作。
 *
 * Usage:
 *   npx tsx src/lib/assemble-book.ts \
 *     --wiki wiki/ \
 *     --strategy .agentic-wiki/cache/folder-strategy.json \
 *     --output-wiki wiki/
 */

import path from "node:path";
import fs from "fs-extra";
import { globby } from "globby";
import matter from "gray-matter";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { FolderStrategyResult } from "../types/index.js";

interface WikiPageMeta {
  relPath: string;
  chapter: string;
  section: string;
  title: string;
  tags: string[];
  sourceFiles: string[];
  size: number;
}

interface SymbolEntry {
  name: string;
  type: string;
  wikiPage: string;
  chapter: string;
}

interface BookStats {
  totalChapters: number;
  totalPages: number;
  totalSymbols: number;
  totalSourceFiles: number;
}

export function extractTitle(
  raw: string,
  parsed: matter.GrayMatterFile<string>,
): string {
  if (parsed.data.title) return parsed.data.title as string;
  const h1 = raw.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : "";
}

export function extractSymbols(
  content: string,
): { name: string; type: string }[] {
  const symbols: { name: string; type: string }[] = [];
  const seen = new Set<string>();
  const hRe = /^#{2,3}\s+`?([A-Za-z_]\w*)`?/gm;
  let m: RegExpExecArray | null;
  while ((m = hRe.exec(content)) !== null) {
    const name = m[1];
    if (seen.has(name) || name.length < 2) continue;
    seen.add(name);
    let type = "symbol";
    if (/^use[A-Z]/.test(name)) type = "hook";
    else if (/^[A-Z]/.test(name)) type = "component";
    else if (/^[a-z]/.test(name)) type = "function";
    symbols.push({ name, type });
  }
  return symbols;
}

export function chapterLabel(
  chapter: string,
  strategy: FolderStrategyResult | null,
): string {
  if (strategy) {
    const folderId = chapter.replace(/^ch-/, "");
    for (const f of strategy.folders) {
      const id = f.path.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
      if (id === folderId) return f.path;
    }
  }
  return chapter.replace(/^ch-/, "").replace(/_/g, "/");
}

export function generateBook(
  pages: WikiPageMeta[],
  strategy: FolderStrategyResult | null,
  stats: BookStats,
): string {
  const now = new Date().toISOString();
  const chapters = new Map<string, WikiPageMeta[]>();
  for (const p of pages) {
    if (!chapters.has(p.chapter)) chapters.set(p.chapter, []);
    chapters.get(p.chapter)!.push(p);
  }

  const lines: string[] = [
    "---",
    `generated_at: "${now}"`,
    `chapters: ${stats.totalChapters}`,
    `pages: ${stats.totalPages}`,
    `symbols: ${stats.totalSymbols}`,
    "---",
    "",
    "# 📖 项目代码 Wiki",
    "",
    `> 生成时间：${now.replace("T", " ").slice(0, 19)}`,
    `> ${stats.totalChapters} 个章节，${stats.totalPages} 个页面，${stats.totalSymbols} 个符号`,
    "",
    "---",
    "",
    "## 目录",
    "",
  ];

  const sorted = [...chapters.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [ch, cPages] of sorted) {
    const label = chapterLabel(ch, strategy);
    lines.push(`### ${label}`, "");
    for (const p of cPages.sort((a, b) => a.section.localeCompare(b.section))) {
      const link = `volume-1-code/${p.chapter}/${p.section}`;
      lines.push(`- [${p.title || p.section}](${link})`);
    }
    lines.push("");
  }

  lines.push("---", "", "## 章节详情", "");
  for (const [ch, cPages] of sorted) {
    const label = chapterLabel(ch, strategy);
    lines.push(`### ${label}`, "");
    const srcSet = new Set<string>();
    cPages.forEach((p) => p.sourceFiles.forEach((f) => srcSet.add(f)));
    lines.push(
      `- **${cPages.length}** 个页面，**${srcSet.size}** 个源码文件`,
      "",
    );
    lines.push("| 页面 | 标题 | 源码文件 |", "|------|------|---------|");
    for (const p of cPages) {
      const link = `volume-1-code/${p.chapter}/${p.section}`;
      lines.push(
        `| [${p.section}](${link}) | ${p.title || "-"} | ${p.sourceFiles.length} 个 |`,
      );
    }
    lines.push("");
  }

  lines.push("---", "", `> 💡 由 \`assemble-book.ts\` 自动生成`);
  return lines.join("\n") + "\n";
}

export function generateGlossary(
  symbols: SymbolEntry[],
  stats: BookStats,
): string {
  const now = new Date().toISOString();
  const byType = new Map<string, SymbolEntry[]>();
  for (const s of symbols) {
    if (!byType.has(s.type)) byType.set(s.type, []);
    byType.get(s.type)!.push(s);
  }

  const order = ["component", "hook", "function", "symbol"];
  const labels: Record<string, string> = {
    component: "🧩 组件",
    hook: "🪝 Hooks",
    function: "🔧 函数",
    symbol: "📌 符号",
  };

  const lines: string[] = [
    "---",
    `generated_at: "${now}"`,
    `total_symbols: ${stats.totalSymbols}`,
    "---",
    "",
    "# 📚 术语表",
    "",
    `> ${stats.totalSymbols} 个符号`,
    "",
    "| 类型 | 数量 |",
    "|------|------|",
  ];

  for (const [type, syms] of [...byType.entries()].sort(
    ([a], [b]) =>
      (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) -
      (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
  )) {
    lines.push(`| ${labels[type] || type} | ${syms.length} |`);
  }

  for (const [type, syms] of [...byType.entries()].sort(
    ([a], [b]) =>
      (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) -
      (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
  )) {
    lines.push("", `## ${labels[type] || type}`, "");
    lines.push("| 名称 | 章节 |", "|------|------|");
    for (const s of syms.sort((a, b) => a.name.localeCompare(b.name))) {
      const wl = `[[volume-1-code/${s.chapter}/${s.wikiPage}]]`;
      lines.push(`| \`${s.name}\` | ${wl} |`);
    }
  }

  lines.push("", "---", "", `> 💡 由 \`assemble-book.ts\` 自动生成`);
  return lines.join("\n") + "\n";
}

// === Core ===

export async function assembleBook(
  wikiPath: string,
  strategy: FolderStrategyResult | null,
): Promise<{ bookPath: string; glossaryPath: string; stats: BookStats }> {
  const v1 = path.join(wikiPath, "volume-1-code");
  const files = await globby(["**/*.md"], { cwd: v1, onlyFiles: true });

  const pages: WikiPageMeta[] = [];
  const allSymbols: SymbolEntry[] = [];
  const allSrc = new Set<string>();

  for (const rel of files) {
    const raw = await fs.readFile(path.join(v1, rel), "utf-8");
    const parsed = matter(raw);
    const parts = rel.split("/");
    const chapter = parts.length >= 2 ? parts[0] : "uncategorized";
    const section = path.basename(rel);
    const title = extractTitle(raw, parsed);
    const tags: string[] = Array.isArray(parsed.data.tags)
      ? parsed.data.tags
      : typeof parsed.data.tags === "string"
        ? parsed.data.tags.split(",").map((t: string) => t.trim())
        : [];
    const sourceFiles: string[] = Array.isArray(parsed.data.sourceFiles)
      ? parsed.data.sourceFiles
      : typeof parsed.data.sourceFiles === "string"
        ? [parsed.data.sourceFiles]
        : [];

    sourceFiles.forEach((f) => allSrc.add(f));

    pages.push({
      relPath: rel,
      chapter,
      section,
      title,
      tags,
      sourceFiles,
      size: raw.length,
    });

    for (const sym of extractSymbols(raw)) {
      allSymbols.push({ ...sym, wikiPage: section, chapter });
    }
  }

  const stats: BookStats = {
    totalChapters: new Set(pages.map((p) => p.chapter)).size,
    totalPages: pages.length,
    totalSymbols: allSymbols.length,
    totalSourceFiles: allSrc.size,
  };

  const bookPath = path.join(wikiPath, "book.md");
  const glossaryPath = path.join(wikiPath, "glossary.md");

  await fs.outputFile(bookPath, generateBook(pages, strategy, stats), "utf-8");
  await fs.outputFile(
    glossaryPath,
    generateGlossary(allSymbols, stats),
    "utf-8",
  );

  return { bookPath, glossaryPath, stats };
}

// === CLI ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("wiki", { type: "string", demandOption: true })
    .option("strategy", { type: "string" })
    .parseSync();

  let strategy: FolderStrategyResult | null = null;
  if (argv.strategy) {
    try {
      strategy = await fs.readJson(argv.strategy);
    } catch {
      /* skip */
    }
  }

  const { stats } = await assembleBook(path.resolve(argv.wiki), strategy);

  process.stdout.write(
    `Book assembled: ${stats.totalChapters} chapters, ${stats.totalPages} pages, ${stats.totalSymbols} symbols\n` +
      `  book.md     ← wiki/book.md\n` +
      `  glossary.md ← wiki/glossary.md\n`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("assemble-book.ts") ||
  process.argv[1]?.endsWith("assemble-book.js");
if (isMainModule) main();
