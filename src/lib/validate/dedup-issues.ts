/**
 * Issue Deduplication — 识别并归档语义重复的 Issue。
 *
 * 策略：
 *   - 精确匹配：type 相同 + source_files 完全相同 → 保留最早的，其余标记为 duplicate
 *   - 被归档的 Issue 移动到 ch-99-archived/，status 改为 duplicate
 *
 * Usage:
 *   npx tsx src/lib/validate/dedup-issues.ts \
 *     --issues wiki/volume-2-issues/ \
 *     [--dry-run]
 */

import fs from "fs-extra";
import path from "node:path";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { parseIssueFrontmatter } from "../shared/issue-parser.js";
import type { IssueFrontmatter } from "../shared/issue-parser.js";

interface DedupResult {
  totalScanned: number;
  exactDuplicates: number;
  archived: string[];
}

interface ParsedIssue {
  id: string;
  type: string;
  sourceFiles: string[];
  detectedAt: string;
  filePath: string;
  frontmatter: IssueFrontmatter;
}

/**
 * Scan all Issue markdown files under issuesDir and parse frontmatter.
 */
async function scanAllIssues(issuesDir: string): Promise<ParsedIssue[]> {
  const files = await globby(["**/*.md"], {
    cwd: issuesDir,
    ignore: ["**/index.md", "ch-99-archived/**"],
    onlyFiles: true,
  });

  const issues: ParsedIssue[] = [];
  for (const file of files) {
    const fullPath = path.join(issuesDir, file);
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const fm = parseIssueFrontmatter(content);
      if (fm?.id && fm?.type) {
        issues.push({
          id: fm.id,
          type: fm.type,
          sourceFiles: fm.source_files || [],
          detectedAt: fm.detected_at || "",
          filePath: fullPath,
          frontmatter: fm,
        });
      }
    } catch {
      // skip unreadable files
    }
  }
  return issues;
}

/**
 * Deduplicate issues by exact (type, source_files) match.
 * Keeps the issue with the earliest detectedAt, archives the rest.
 */
export async function dedupIssues(
  issuesDir: string,
  dryRun = false,
): Promise<DedupResult> {
  const issues = await scanAllIssues(issuesDir);
  const seen = new Map<string, ParsedIssue>();
  const result: DedupResult = {
    totalScanned: issues.length,
    exactDuplicates: 0,
    archived: [],
  };

  for (const issue of issues) {
    const key = `${issue.type}::${issue.sourceFiles.sort().join(",")}`;
    const existing = seen.get(key);

    if (existing) {
      // Determine which to archive (keep the earlier one)
      const toArchive =
        issue.detectedAt < existing.detectedAt ? existing : issue;
      const toKeep =
        issue.detectedAt < existing.detectedAt ? issue : existing;

      result.exactDuplicates++;
      result.archived.push(toArchive.id);

      if (!dryRun) {
        await archiveIssue(toArchive, toKeep.id, issuesDir);
      }

      // Keep the earlier one in the seen map
      if (issue.detectedAt < existing.detectedAt) {
        seen.set(key, issue);
      }
    } else {
      seen.set(key, issue);
    }
  }

  return result;
}

/**
 * Move an issue to ch-99-archived/ and mark its status as duplicate.
 */
async function archiveIssue(
  issue: ParsedIssue,
  duplicateOfId: string,
  issuesDir: string,
): Promise<void> {
  const archivedDir = path.join(issuesDir, "ch-99-archived");
  await fs.ensureDir(archivedDir);

  // Update the markdown content: set status to duplicate
  let content: string;
  try {
    content = await fs.readFile(issue.filePath, "utf-8");
  } catch {
    return;
  }

  // Update status in YAML frontmatter
  if (content.startsWith("---")) {
    content = content.replace(/^status:\s*.*$/m, "status: duplicate");
    // Append duplicate_of to frontmatter
    if (!content.includes("duplicate_of:")) {
      content = content.replace(
        /^(---[\s\S]*?)(---)/,
        `$1duplicate_of: ${duplicateOfId}\n$2`,
      );
    }
  }

  // Move file to archived directory
  const dest = path.join(archivedDir, path.basename(issue.filePath));
  await fs.move(issue.filePath, dest, { overwrite: true });
  await fs.writeFile(dest, content, "utf-8");
}

// === CLI Entry Point ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("issues", {
      type: "string",
      demandOption: true,
      description: "Path to wiki/volume-2-issues/",
    })
    .option("dry-run", {
      type: "boolean",
      default: false,
      description: "Preview duplicates without modifying files",
    })
    .parseSync();

  const result = await dedupIssues(argv.issues, argv["dry-run"]);

  process.stdout.write(
    `Issue deduplication: ${result.totalScanned} scanned, ` +
      `${result.exactDuplicates} duplicates found\n`,
  );

  if (result.archived.length > 0) {
    process.stdout.write(`Archived:\n`);
    for (const id of result.archived) {
      process.stdout.write(`  - ${id}\n`);
    }
  }

  if (argv["dry-run"]) {
    process.stdout.write("[DRY RUN] No files were modified.\n");
  }
}

const isMainModule =
  process.argv[1]?.endsWith("dedup-issues.ts") ||
  process.argv[1]?.endsWith("dedup-issues.js");
if (isMainModule) main();
