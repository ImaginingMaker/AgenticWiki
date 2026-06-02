/**
 * Parse all Wiki Markdown files, extract YAML frontmatter symbols,
 * and build a symbol -> wiki page lookup index.
 *
 * Usage:
 *   npx tsx src/lib/symbol-index.ts --wiki wiki/ --output .agentic-wiki/search/symbol-index.json
 */

import fs from "fs-extra";
import path from "node:path";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { SymbolEntry, SymbolIndex } from "../types/index.js";

interface ExtractedSymbol extends SymbolEntry {
  name: string;
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const result: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;
    let value: unknown = kv[2].trim();
    if (
      typeof value === "string" &&
      value.startsWith("[") &&
      value.endsWith("]")
    ) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
    }
    result[kv[1]] = value;
  }
  return result;
}

function detectType(_content: string, tags: string[]): SymbolEntry["type"] {
  if (tags.includes("hook") || tags.includes("hooks")) return "hook";
  if (tags.includes("component") || tags.includes("components"))
    return "component";
  if (
    tags.includes("type") ||
    tags.includes("types") ||
    tags.includes("interface")
  )
    return "type";
  if (
    tags.includes("utility") ||
    tags.includes("utils") ||
    tags.includes("function")
  )
    return "function";
  if (tags.includes("constant") || tags.includes("constants"))
    return "constant";
  if (tags.includes("enum") || tags.includes("enums")) return "enum";
  return "function";
}

function extractSymbols(
  content: string,
  sourceFiles: string[],
  wikiPath: string,
  tags: string[],
): ExtractedSymbol[] {
  const entries: ExtractedSymbol[] = [];
  const seen = new Set<string>();

  // Extract from markdown headings
  const headingRegex = /^#{2,4}\s+`?(\w+)`?/gm;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headingRegex.exec(content)) !== null) {
    const name = hMatch[1];
    if (seen.has(name)) continue;
    seen.add(name);
    entries.push({
      name,
      type: detectType(content, tags),
      file: sourceFiles[0] || "",
      wiki: wikiPath,
    });
  }

  // Extract from code blocks
  const codeRegex = /```[\s\S]*?```/g;
  let cMatch: RegExpExecArray | null;
  while ((cMatch = codeRegex.exec(content)) !== null) {
    const fnRegex = /(?:export\s+)?(?:function|const|class)\s+(\w+)/g;
    let fMatch: RegExpExecArray | null;
    while ((fMatch = fnRegex.exec(cMatch[0])) !== null) {
      const name = fMatch[1];
      if (seen.has(name) || name === "function" || name === "const") continue;
      seen.add(name);
      entries.push({
        name,
        type: detectType(content, tags),
        file: sourceFiles[0] || "",
        wiki: wikiPath,
      });
    }
  }
  return entries;
}

export async function buildSymbolIndex(wikiPath: string): Promise<SymbolIndex> {
  const mdFiles = await globby(["**/*.md"], {
    cwd: wikiPath,
    ignore: ["_toc.md", "book.md", "index.md", "**/index.md"],
    onlyFiles: true,
  });

  const symbols: Record<string, SymbolEntry> = {};

  for (const file of mdFiles) {
    const fullPath = path.join(wikiPath, file);
    const content = await fs.readFile(fullPath, "utf-8");
    const fm = parseFrontmatter(content);
    const sourceFiles = (fm?.sourceFiles as string[]) || [];
    const tags = (fm?.tags as string[]) || [];
    const entries = extractSymbols(content, sourceFiles, file, tags);
    for (const entry of entries) {
      if (!symbols[entry.name]) {
        symbols[entry.name] = {
          type: entry.type,
          file: entry.file,
          wiki: entry.wiki,
        };
      }
    }
  }

  return { generatedAt: new Date().toISOString(), symbols };
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("wiki", { type: "string", demandOption: true })
    .option("output", { type: "string", demandOption: true })
    .parseSync();
  const index = await buildSymbolIndex(argv.wiki);
  await fs.outputJson(argv.output, index, { spaces: 2 });
  process.stdout.write(
    `Symbol index: ${Object.keys(index.symbols).length} symbols\nWritten to ${argv.output}\n`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("symbol-index.ts") ||
  process.argv[1]?.endsWith("symbol-index.js");
if (isMainModule) main();
