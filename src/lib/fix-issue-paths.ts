/**
 * Fix Issue Paths — 将误放在 volume-2-issues/ 根目录的 Issue 文件移动到正确的 chapter 子目录。
 *
 * 问题：SubAgent 常将 Issue 写入 volume-2-issues/IS-{YYYY}-{NNN}.md
 *       而非 volume-2-issues/{ch-xx-type}/IS-{YYYY}-{NNN}.md
 * 解决：读取 Issue type frontmatter，按类型映射到对应 chapter 目录。
 *
 * Usage (dry-run):
 *   npx tsx src/lib/fix-issue-paths.ts --wiki wiki/
 *
 * Usage (apply):
 *   npx tsx src/lib/fix-issue-paths.ts --wiki wiki/ --apply
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// === Constants ===

/** Issue type → chapter directory mapping */
const ISSUE_TYPE_TO_CHAPTER: Record<string, string> = {
  circular_dependency: "ch-01-circular-deps",
  dead_code: "ch-02-dead-code",
  missing_types: "ch-03-missing-types",
  complex_logic: "ch-04-complex-logic",
  inconsistent_api: "ch-05-inconsistent-api",
  potential_bug: "ch-06-potential-bugs",
};

const ISSUES_DIR = "volume-2-issues";

// === Types ===

interface FixResult {
  scannedAt: string;
  totalIssues: number;
  fixed: string[];
  alreadyCorrect: string[];
  skipped: string[];
}

// === Core Logic ===

/**
 * Extract the issue type from a markdown file.
 * Reads frontmatter (--- ... ---) looking for `type:` field.
 */
async function extractIssueType(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");

    // Try YAML frontmatter first
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const fm = frontmatterMatch[1];
      const typeMatch = fm.match(/^type:\s*(\S+)/m);
      if (typeMatch) return typeMatch[1].trim();
    }

    // Try markdown table format: | **类型** | dead_code |
    const tableMatch = content.match(/\*\*类型\*\*\s*\|\s*(\S+)/);
    if (tableMatch) return tableMatch[1].trim();

    return null;
  } catch {
    return null;
  }
}

/**
 * Fix misplaced issue files in the wiki directory.
 */
async function fixIssuePaths(
  wikiRoot: string,
  apply: boolean,
): Promise<FixResult> {
  const issuesRoot = path.join(wikiRoot, ISSUES_DIR);
  const fixed: string[] = [];
  const alreadyCorrect: string[] = [];
  const skipped: string[] = [];

  if (!(await fs.pathExists(issuesRoot))) {
    return {
      scannedAt: new Date().toISOString(),
      totalIssues: 0,
      fixed: [],
      alreadyCorrect: [],
      skipped: [],
    };
  }

  // Collect all .md files recursively
  const allIssueFiles: string[] = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith(".md") && entry.name.startsWith("IS-")) {
        allIssueFiles.push(fullPath);
      }
    }
  }
  await walk(issuesRoot);

  for (const filePath of allIssueFiles) {
    const relativePath = path.relative(issuesRoot, filePath);
    const fileName = path.basename(filePath);

    // Check if already in correct chapter subdirectory
    const parentDir = path.basename(path.dirname(filePath));
    if (parentDir !== ISSUES_DIR && parentDir.startsWith("ch-")) {
      alreadyCorrect.push(relativePath);
      continue;
    }

    // Extract type from frontmatter
    const issueType = await extractIssueType(filePath);
    if (!issueType) {
      skipped.push(`${relativePath} (no type in frontmatter)`);
      continue;
    }

    const chapterDir = ISSUE_TYPE_TO_CHAPTER[issueType];
    if (!chapterDir) {
      skipped.push(`${relativePath} (unknown type: ${issueType})`);
      continue;
    }

    const targetDir = path.join(issuesRoot, chapterDir);
    const targetPath = path.join(targetDir, fileName);

    if (apply) {
      await fs.ensureDir(targetDir);
      await fs.move(filePath, targetPath, { overwrite: false });
    }

    fixed.push(`${relativePath} → ${chapterDir}/${fileName} [${issueType}]`);
  }

  return {
    scannedAt: new Date().toISOString(),
    totalIssues: allIssueFiles.length,
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
