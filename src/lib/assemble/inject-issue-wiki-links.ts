/**
 * Inject Issue-Wiki Links — 🆕 Issue → Wiki 反向链接注入器。
 *
 * 遍历 volume-2-issues/ 下所有 Issue 文件，解析其 source_files，
 * 查找对应的 Wiki 页面，在每个 Issue 末尾追加 "📖 相关 Wiki 页面" 章节，
 * 使 Obsidian 关系图谱中 Issue 节点与 Wiki 节点建立双向链接。
 *
 * Uses symbol-index.json (or wiki file scan fallback) to map source files → wiki pages.
 *
 * Usage:
 *   npx tsx src/lib/assemble/inject-issue-wiki-links.ts \
 *     --issues wiki/volume-2-issues/ \
 *     --wiki wiki/ \
 *     [--dry-run]
 */

import path from "node:path";
import fs from "fs-extra";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { parseIssueFrontmatter } from "../shared/issue-parser.js";

// === Types ===

interface InjectResult {
  totalIssues: number;
  updated: number;
  skipped: number;
  errors: string[];
  linksInjected: number;
}

// === Helpers ===

/**
 * Build a reverse map: sourceFilePath → wikiPageRelPath[]
 * by scanning all wiki pages' frontmatter for sourceFiles.
 */
async function buildSourceToWikiMap(
  wikiRoot: string,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const v1 = path.join(wikiRoot, "volume-1-code");
  if (!(await fs.pathExists(v1))) return map;

  const mdFiles = await globby(["**/*.md"], {
    cwd: v1,
    ignore: ["**/.gen-done", "**/index.md"],
    onlyFiles: true,
  });

  for (const rel of mdFiles) {
    const fullPath = path.join(v1, rel);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      // Parse YAML frontmatter
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      let sourceFiles: string[] = [];
      for (const line of fmMatch[1].split("\n")) {
        const m = line.match(/^sourceFiles:\s*(.+)$/);
        if (m) {
          const value = m[1].trim();
          if (value.startsWith("[") && value.endsWith("]")) {
            sourceFiles = value
              .slice(1, -1)
              .split(",")
              .map((s) => s.trim().replace(/^["']|["']$/g, ""));
          } else {
            sourceFiles = [value.replace(/^["']|["']$/g, "")];
          }
          break;
        }
      }

      const wikiChapter = rel.split("/")[0] || "";
      const wikiRelPath = `volume-1-code/${wikiChapter}/${path.basename(rel)}`;

      for (const sf of sourceFiles) {
        const existing = map.get(sf) || [];
        existing.push(wikiRelPath);
        map.set(sf, existing);
      }
    } catch {
      // skip unreadable
    }
  }

  return map;
}

/**
 * Check if an issue file already has the "相关 Wiki 页面" section.
 */
function hasWikiSection(content: string): boolean {
  return /^##\s*📖\s*相关\s*Wiki\s*页面/m.test(content);
}

/**
 * Generate the wiki links section for an issue.
 */
function buildWikiLinksSection(
  issueSourceFiles: string[],
  sourceToWikiMap: Map<string, string[]>,
): string {
  const wikiPages = new Map<string, string>(); // wikiRelPath → dedup key

  for (const sf of issueSourceFiles) {
    const pages = sourceToWikiMap.get(sf);
    if (pages) {
      for (const wp of pages) {
        wikiPages.set(wp, wp);
      }
    }
  }

  if (wikiPages.size === 0) return "";

  const lines: string[] = [
    "",
    "---",
    "",
    "## 📖 相关 Wiki 页面",
    "",
    `> 此 Issue 涉及的源文件对应以下 Wiki 页面：`,
    "",
  ];

  for (const wp of [...wikiPages.keys()].sort()) {
    lines.push(`- [[${wp.replace(/\.md$/, "")}]]`);
  }

  lines.push("", `> 💡 由 \`inject-issue-wiki-links.ts\` 自动生成`, "");

  return lines.join("\n");
}

// === Core ===

export async function injectIssueWikiLinks(
  issuesDir: string,
  wikiRoot: string,
  dryRun = false,
): Promise<InjectResult> {
  const result: InjectResult = {
    totalIssues: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    linksInjected: 0,
  };

  if (!(await fs.pathExists(issuesDir))) {
    result.errors.push(`Issues dir not found: ${issuesDir}`);
    return result;
  }

  // Build the source→wiki reverse map
  const sourceToWikiMap = await buildSourceToWikiMap(wikiRoot);

  // Scan all issue files
  const mdFiles = await globby(["**/IS-*.md"], {
    cwd: issuesDir,
    ignore: ["ch-99-archived/**"],
    onlyFiles: true,
  });

  for (const rel of mdFiles) {
    const fullPath = path.join(issuesDir, rel);
    result.totalIssues++;

    let content: string;
    try {
      content = await fs.readFile(fullPath, "utf-8");
    } catch {
      result.errors.push(`Cannot read: ${rel}`);
      continue;
    }

    // Skip if already has the section
    if (hasWikiSection(content)) {
      result.skipped++;
      continue;
    }

    // Parse issue frontmatter for source_files
    const fm = parseIssueFrontmatter(content);
    const sourceFiles = fm?.source_files || [];
    if (sourceFiles.length === 0) {
      result.skipped++;
      continue;
    }

    // Build wiki links section
    const section = buildWikiLinksSection(sourceFiles, sourceToWikiMap);
    if (!section) {
      result.skipped++;
      continue;
    }

    result.updated++;
    result.linksInjected += sourceToWikiMap.size;

    if (!dryRun) {
      // Remove trailing whitespace then append
      const trimmed = content.trimEnd();
      await fs.writeFile(fullPath, trimmed + "\n" + section, "utf-8");
    }
  }

  return result;
}

// === CLI ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("issues", {
      type: "string",
      demandOption: true,
      description: "Path to volume-2-issues/",
    })
    .option("wiki", {
      type: "string",
      demandOption: true,
      description: "Path to wiki root",
    })
    .option("dry-run", {
      type: "boolean",
      default: false,
      description: "Preview without modifying",
    })
    .parseSync();

  const result = await injectIssueWikiLinks(
    path.resolve(argv.issues),
    path.resolve(argv.wiki),
    argv["dry-run"],
  );

  console.log(
    `Issue-Wiki Links: ${result.updated}/${result.totalIssues} updated, ` +
      `${result.skipped} skipped, ${result.linksInjected} links injected`,
  );

  if (result.errors.length > 0) {
    console.log(`  Errors: ${result.errors.length}`);
    for (const e of result.errors) {
      console.log(`    - ${e}`);
    }
  }

  if (argv["dry-run"] && result.updated > 0) {
    console.log(
      "  [DRY RUN] No files modified. Use without --dry-run to apply.",
    );
  }
}

const isMainModule =
  process.argv[1]?.endsWith("inject-issue-wiki-links.ts") ||
  process.argv[1]?.endsWith("inject-issue-wiki-links.js");
if (isMainModule) main();
