/**
 * Fix Issue Paths
 *
 * Moves issue files from incorrect locations to the proper volume-2-issues chapter dir.
 * Handles two error scenarios:
 *   - Issue written to volume-2-issues root instead of a ch-xx-type subdirectory
 *   - Issue written to volume-1-code chapter issues dir instead of volume-2-issues
 *
 * All issues end up at: volume-2-issues/ch-XX-type/IS-YYYY-NNN.md
 *
 * Usage dry-run:
 *   npx tsx src/lib/assemble/fix-issue-paths.ts --wiki wiki/
 *
 * Usage apply:
 *   npx tsx src/lib/assemble/fix-issue-paths.ts --wiki wiki/ --apply
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// === Constants ===

/**
 * 3 层优先级 Issue 类型 → 章节目录映射
 *
 * 🔴 P0: bug/security → 功能正确性
 * 🟡 P1: typescript/performance → 代码健康
 * 🟢 P2: dead_code/complexity/maintainability/ux → 优化建议
 *
 * 旧类型向后兼容：在 extractIssueType 中通过 LEGACY_TYPE_MAP 转换
 */
export const ISSUE_TYPE_TO_CHAPTER: Record<string, string> = {
  bug: "ch-01-bugs",
  security: "ch-02-security",
  typescript: "ch-03-typescript",
  performance: "ch-04-performance",
  dead_code: "ch-05-dead-code",
  complexity: "ch-06-complexity",
  maintainability: "ch-07-maintainability",
  ux: "ch-08-ux",
};

/** 旧类型 → 新类型映射（向后兼容） */
const LEGACY_TYPE_MAP: Record<string, string> = {
  circular_dependency: "bug",
  dead_code: "dead_code",
  missing_types: "typescript",
  complex_logic: "complexity",
  inconsistent_api: "maintainability",
  potential_bug: "bug",
};

const VOLUME_2_DIR = "volume-2-issues";
const VOLUME_1_DIR = "volume-1-code";

// === Types ===

export interface FixResult {
  scannedAt: string;
  totalIssues: number;
  fixed: string[];
  alreadyCorrect: string[];
  skipped: string[];
}

// === Issue Collector ===

export interface IssueEntry {
  filePath: string; // absolute path
  relativePath: string; // path relative to wiki root
  location: "volume-2-root" | "volume-1-code";
}

/**
 * Collect all IS-NNNN.md files from both:
 *   a) volume-2-issues root - misplaced, not in a ch-xx subdir
 *   b) volume-1-code chapter issues dir - wrong volume entirely
 */
export async function collectMisplacedIssues(
  wikiRoot: string,
): Promise<IssueEntry[]> {
  const results: IssueEntry[] = [];

  // === Scan A: volume-2-issues/ root ===
  const v2Root = path.join(wikiRoot, VOLUME_2_DIR);
  if (await fs.pathExists(v2Root)) {
    const entries = await fs.readdir(v2Root, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isFile() &&
        entry.name.startsWith("IS-") &&
        entry.name.endsWith(".md")
      ) {
        results.push({
          filePath: path.join(v2Root, entry.name),
          relativePath: VOLUME_2_DIR + "/" + entry.name,
          location: "volume-2-root",
        });
      }
    }
  }

  // === Scan B: volume-1-code/ch-*/issues/IS-*.md ===
  const v1Root = path.join(wikiRoot, VOLUME_1_DIR);
  if (await fs.pathExists(v1Root)) {
    const chapters = await fs.readdir(v1Root, { withFileTypes: true });
    for (const chapter of chapters) {
      if (!chapter.isDirectory() || !chapter.name.startsWith("ch-")) continue;
      const issuesDir = path.join(v1Root, chapter.name, "issues");
      if (!(await fs.pathExists(issuesDir))) continue;

      const issueFiles = await fs.readdir(issuesDir, { withFileTypes: true });
      for (const issueFile of issueFiles) {
        if (
          issueFile.isFile() &&
          issueFile.name.startsWith("IS-") &&
          issueFile.name.endsWith(".md")
        ) {
          results.push({
            filePath: path.join(issuesDir, issueFile.name),
            relativePath:
              VOLUME_1_DIR + "/" + chapter.name + "/issues/" + issueFile.name,
            location: "volume-1-code",
          });
        }
      }
    }
  }

  return results;
}

// === Core Logic ===

/**
 * Extract the issue type from a markdown file.
 * Reads frontmatter (--- ... ---) looking for `type:` field.
 */
export async function extractIssueType(
  filePath: string,
): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");

    // Try YAML frontmatter first
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const fm = frontmatterMatch[1];
      const typeMatch = fm.match(/^type:\s*(\S+)/m);
      if (typeMatch) return typeMatch[1].trim();
    }

    // Try markdown table format: | **type** | dead_code |
    // Also handles backtick-wrapped values like | **类型** | `complex_logic` |
    const tableMatch = content.match(/\*\*类型\*\*\s*\|\s*`?(\w+)`?/);
    if (tableMatch) return tableMatch[1].trim();

    return null;
  } catch {
    return null;
  }
}

/**
 * Fix misplaced issue files in the wiki directory.
 */
export async function fixIssuePaths(
  wikiRoot: string,
  apply: boolean,
): Promise<FixResult> {
  const v2Root = path.join(wikiRoot, VOLUME_2_DIR);
  const fixed: string[] = [];
  const alreadyCorrect: string[] = [];
  const skipped: string[] = [];

  // Collect misplaced issues from both volume-1-code and volume-2-issues root
  const misplacedIssues = await collectMisplacedIssues(wikiRoot);

  for (const issue of misplacedIssues) {
    const fileName = path.basename(issue.filePath);

    // Extract type from frontmatter
    const issueType = await extractIssueType(issue.filePath);
    if (!issueType) {
      skipped.push(`${issue.relativePath} (no type in frontmatter)`);
      continue;
    }

    // Resolve legacy type if needed
    const resolvedType = LEGACY_TYPE_MAP[issueType] || issueType;
    const chapterDir = ISSUE_TYPE_TO_CHAPTER[resolvedType];
    if (!chapterDir) {
      skipped.push(`${issue.relativePath} (unknown type: ${issueType})`);
      continue;
    }

    const targetDir = path.join(v2Root, chapterDir);
    const targetPath = path.join(targetDir, fileName);

    if (apply) {
      await fs.ensureDir(targetDir);
      await fs.move(issue.filePath, targetPath, { overwrite: false });

      // Clean up empty issues/ directory in volume-1-code after move
      if (issue.location === "volume-1-code") {
        const srcIssuesDir = path.dirname(issue.filePath);
        try {
          const remaining = await fs.readdir(srcIssuesDir);
          if (remaining.length === 0) {
            await fs.rmdir(srcIssuesDir);
          }
        } catch {
          // Directory may already be gone or not empty — ignore
        }
      }
    }

    const originTag =
      issue.location === "volume-1-code" ? " [moved from volume-1-code]" : "";
    fixed.push(
      `${issue.relativePath} → ${chapterDir}/${fileName} [${issueType}]${originTag}`,
    );
  }

  // Count correctly-placed issues for reporting
  if (await fs.pathExists(v2Root)) {
    async function collectCorrect(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name.startsWith("ch-")) {
          await collectCorrect(fullPath);
        } else if (
          entry.isFile() &&
          entry.name.startsWith("IS-") &&
          entry.name.endsWith(".md")
        ) {
          alreadyCorrect.push(path.relative(v2Root, fullPath));
        }
      }
    }
    await collectCorrect(v2Root);
  }

  return {
    scannedAt: new Date().toISOString(),
    totalIssues: misplacedIssues.length + alreadyCorrect.length,
    fixed,
    alreadyCorrect,
    skipped,
  };
}

// === CLI Entry Point ===

async function main(): Promise<void> {
  const argv = yargs(hideBin(process.argv))
    .option("wiki", {
      type: "string",
      demandOption: true,
      description: "Path to wiki root directory",
    })
    .option("apply", {
      type: "boolean",
      default: false,
      description: "Actually move files (default: dry-run)",
    })
    .parseSync();

  const wikiRoot = path.resolve(argv.wiki);
  const result = await fixIssuePaths(wikiRoot, argv.apply);

  process.stdout.write(
    "Fix Issue Paths:\n" +
      "  Scanned:   " +
      result.totalIssues +
      " issue files\n" +
      "  Fixed:     " +
      result.fixed.length +
      "\n" +
      "  Already OK:" +
      result.alreadyCorrect.length +
      "\n" +
      "  Skipped:   " +
      result.skipped.length +
      "\n",
  );

  if (result.fixed.length > 0) {
    process.stdout.write("\nIssues to fix:\n");
    for (const f of result.fixed) {
      process.stdout.write("  " + (argv.apply ? "✅" : "📋") + " " + f + "\n");
    }
  }

  if (!argv.apply && result.fixed.length > 0) {
    process.stdout.write("\n  [DRY RUN] Use --apply to move files.\n");
  }
}

const isMainModule =
  process.argv[1]?.endsWith("fix-issue-paths.ts") ||
  process.argv[1]?.endsWith("fix-issue-paths.js");
if (isMainModule) main();
