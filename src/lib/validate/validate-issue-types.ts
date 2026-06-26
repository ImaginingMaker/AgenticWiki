/**
 * Validate all Issue Markdown files in wiki/volume-2-issues/ against
 * the Issue type whitelist and chapter classification rules.
 *
 * Usage:
 *   npx tsx src/lib/validate/validate-issue-types.ts \
 *     --issues wiki/volume-2-issues/ \
 *     [--fix] \
 *     [--output .agentic-wiki/cache/issue-validation.json]
 *
 * --fix    Move issues with wrong paths to correct chapters
 * --output  Write validation report as JSON (always writes, even when 0 issues found)
 */

import fs from "fs-extra";
import matter from "gray-matter";
import path from "node:path";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { parseIssueFrontmatter as parseIssueFM } from "../shared/issue-parser.js";

// === Issue Type Whitelist ===

/**
 * 3 层优先级 Issue 分类体系
 *
 * 🔴 P0 (功能正确性) — 运行时崩溃/数据错误/安全漏洞 → critical/high
 * 🟡 P1 (代码健康)   — 类型安全/性能债 → high/medium
 * 🟢 P2 (优化建议)   — 不影响运行但影响维护 → medium/low
 *
 * 旧类型映射（向后兼容）:
 *   circular_dependency → bug
 *   dead_code          → dead_code
 *   missing_types      → typescript
 *   complex_logic      → complexity
 *   inconsistent_api   → maintainability
 *   potential_bug      → bug
 */
export const ISSUE_TIER: Record<string, "P0" | "P1" | "P2"> = {
  bug: "P0",
  security: "P0",
  typescript: "P1",
  performance: "P1",
  dead_code: "P2",
  complexity: "P2",
  maintainability: "P2",
  ux: "P2",
};

export const ALLOWED_TYPES = new Set(Object.keys(ISSUE_TIER));

export const TYPE_TO_CHAPTER: Record<string, string> = {
  bug: "ch-01-bugs",
  security: "ch-02-security",
  typescript: "ch-03-typescript",
  performance: "ch-04-performance",
  dead_code: "ch-05-dead-code",
  complexity: "ch-06-complexity",
  maintainability: "ch-07-maintainability",
  ux: "ch-08-ux",
};

export const ARCHIVE_CHAPTER = "ch-99-archived";

interface IssueFrontmatter {
  id?: string;
  type?: string;
  severity?: string;
  status?: string;
  detected_at?: string;
  source_files?: string[];
  confidence?: string;
}

interface IssueViolation {
  id: string;
  file: string;
  severity: "error" | "warning";
  violation: string;
  detail: string;
  suggestion: string;
}

interface IssueValidationReport {
  validatedAt: string;
  totalIssues: number;
  violations: IssueViolation[];
  summary: {
    errors: number;
    warnings: number;
    passed: number;
  };
}

// === Parsing ===

export function parseFrontmatter(content: string): IssueFrontmatter | null {
  return parseIssueFM(content) as IssueFrontmatter | null;
}

/**
 * Fallback parser for SubAgent inline markdown table format.
 * Extracts: **ID**, **类型**
 */
export function parseMarkdownTable(content: string): IssueFrontmatter | null {
  const fm = parseIssueFM(content);
  if (!fm) return null;
  if (fm.id && fm.type) return fm as IssueFrontmatter;
  return null;
}

/** Unified parser: tries YAML frontmatter first, then markdown table. */
export function parseIssueMetadata(content: string): IssueFrontmatter | null {
  return parseIssueFM(content) as IssueFrontmatter | null;
}

export function getExpectedChapter(issueType: string): string {
  return TYPE_TO_CHAPTER[issueType] || ARCHIVE_CHAPTER;
}

export function getCurrentChapter(filePath: string): string {
  const parts = filePath.split("/");
  const volIdx = parts.findIndex((p) => p === "volume-2-issues");
  if (volIdx >= 0 && volIdx + 1 < parts.length) {
    return parts[volIdx + 1];
  }
  return "unknown";
}

// === Validation ===

export function validateIssue(
  filePath: string,
  fm: IssueFrontmatter,
): IssueViolation[] {
  const violations: IssueViolation[] = [];
  const id = fm.id || path.basename(filePath, ".md");

  // 1. Type whitelist check — reject legacy types as errors
  if (!fm.type) {
    violations.push({
      id,
      file: filePath,
      severity: "error",
      violation: "missing_type",
      detail: "Issue has no 'type' field in frontmatter",
      suggestion: `Add type: <one of ${Array.from(ALLOWED_TYPES).join(", ")}>`,
    });
  } else if (!ALLOWED_TYPES.has(fm.type)) {
    violations.push({
      id,
      file: filePath,
      severity: "error",
      violation: "invalid_type",
      detail: `Issue type '${fm.type}' is not in the whitelist`,
      suggestion: `Change type to one of: ${Array.from(ALLOWED_TYPES).join(", ")}`,
    });
  }

  // 2. Chapter classification check
  if (fm.type && ALLOWED_TYPES.has(fm.type)) {
    const expectedChapter = getExpectedChapter(fm.type);
    const currentChapter = getCurrentChapter(filePath);

    if (currentChapter !== expectedChapter && currentChapter !== "unknown") {
      violations.push({
        id,
        file: filePath,
        severity: "warning",
        violation: "wrong_chapter",
        detail: `Issue classified as '${fm.type}' but located in '${currentChapter}' instead of '${expectedChapter}'`,
        suggestion: `Move to wiki/volume-2-issues/${expectedChapter}/${path.basename(filePath)}`,
      });
    }
  }

  // 3. Severity check
  if (
    fm.severity &&
    !["critical", "high", "medium", "low"].includes(fm.severity)
  ) {
    violations.push({
      id,
      file: filePath,
      severity: "warning",
      violation: "invalid_severity",
      detail: `Invalid severity '${fm.severity}'`,
      suggestion: "Use: high, medium, or low",
    });
  }

  // 4. Status check
  if (
    fm.status &&
    ![
      "detected",
      "acknowledged",
      "verified",
      "fixing",
      "fixed",
      "verified_fixed",
      "archived",
      "false_positive",
      "stale",
      "disputed",
      "closed",
    ].includes(fm.status)
  ) {
    violations.push({
      id,
      file: filePath,
      severity: "warning",
      violation: "invalid_status",
      detail: `Invalid status '${fm.status}'`,
      suggestion:
        "Use: detected, verified, fixing, fixed, archived, false_positive, or stale",
    });
  }

  // 5. Confidence check (optional but must be valid if present)
  if (
    fm.confidence &&
    !["high", "medium", "low"].includes(fm.confidence)
  ) {
    violations.push({
      id,
      file: filePath,
      severity: "warning",
      violation: "invalid_confidence",
      detail: `Invalid confidence '${fm.confidence}'`,
      suggestion: "Use: high, medium, or low",
    });
  }

  return violations;
}

// === Fix mode ===

export async function fixIssue(
  filePath: string,
  fm: IssueFrontmatter,
): Promise<boolean> {
  if (!fm.type || !ALLOWED_TYPES.has(fm.type)) return false;

  const expectedChapter = getExpectedChapter(fm.type);
  const currentChapter = getCurrentChapter(filePath);

  if (currentChapter === expectedChapter || currentChapter === "unknown") {
    return false;
  }

  const issueDir = path.dirname(filePath);
  const issueDirParent = path.dirname(issueDir);
  const newDir = path.join(issueDirParent, expectedChapter);
  const newPath = path.join(newDir, path.basename(filePath));

  await fs.ensureDir(newDir);
  await fs.move(filePath, newPath, { overwrite: true });

  // Update related_wiki paths in frontmatter to reflect new chapter location
  try {
    const movedContent = await fs.readFile(newPath, "utf-8");
    const parsed = matter(movedContent);
    if (Array.isArray(parsed.data.related_wiki)) {
      parsed.data.related_wiki = parsed.data.related_wiki.map(
        (p: string) => p.replace(currentChapter, expectedChapter)
      );
      await fs.writeFile(
        newPath,
        matter.stringify(parsed.content, parsed.data),
        "utf-8"
      );
    }
  } catch {
    // Best effort — non-critical
  }
  try {
    const siblings = await fs.readdir(issueDir);
    for (const sibling of siblings) {
      const srcPath = path.join(issueDir, sibling);
      const destPath = path.join(newDir, sibling);
      if (!(await fs.pathExists(destPath))) {
        await fs.move(srcPath, destPath, { overwrite: true });
      }
    }
    const remaining = await fs.readdir(issueDir);
    if (remaining.length === 0) {
      await fs.remove(issueDir);
    }
  } catch {
    // Best effort
  }

  return true;
}

// === Generate Report ===

export function generateReport(
  allViolations: IssueViolation[],
  totalIssues: number,
): IssueValidationReport {
  const errors = allViolations.filter((v) => v.severity === "error").length;
  const warnings = allViolations.filter((v) => v.severity === "warning").length;
  const uniqueViolatingIds = new Set(allViolations.map((v) => v.id));
  const passed = totalIssues - uniqueViolatingIds.size;

  return {
    validatedAt: new Date().toISOString(),
    totalIssues,
    violations: allViolations,
    summary: { errors, warnings, passed },
  };
}

// === CLI ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("issues", {
      type: "string",
      demandOption: true,
      description: "Path to wiki/volume-2-issues/ directory",
    })
    .option("fix", {
      type: "boolean",
      default: false,
      description: "Auto-fix chapter classification issues",
    })
    .option("output", {
      type: "string",
      description: "Write validation report as JSON",
    })
    .parseSync();

  // Validate --output parameter (must be a file path, not a directory)
  if (argv.output) {
    const resolvedOutput = path.resolve(argv.output);
    if (!path.extname(resolvedOutput)) {
      console.error(
        `❌ --output 期望文件路径（如 issue-validation.json），但收到: ${argv.output}`,
      );
      console.error(
        `   文件路径应有扩展名（如 .json），当前路径无扩展名，可能为目录路径。`,
      );
      process.exit(1);
    }
    const parentDir = path.dirname(resolvedOutput);
    if (!fs.existsSync(parentDir)) {
      console.error(`❌ --output 的父目录不存在: ${parentDir}`);
      process.exit(1);
    }
  }

  // Validate --issues path
  if (!fs.existsSync(path.resolve(argv.issues))) {
    console.error(`❌ --issues 路径不存在: ${argv.issues}`);
    process.exit(1);
  }

  // Find all issue files
  const issueFiles = await globby("**/IS-*.md", {
    cwd: argv.issues,
    onlyFiles: true,
  });

  // Always write output JSON when --output is specified, even if 0 issues found
  if (issueFiles.length === 0) {
    const report = generateReport([], 0);
    if (argv.output) {
      await fs.outputJson(argv.output, report, { spaces: 2 });
    }
    process.stdout.write("No Issue files found.\n");
    process.exit(0);
  }

  const allViolations: IssueViolation[] = [];
  const issuesDir = path.resolve(argv.issues);

  // Validate each issue
  for (const relPath of issueFiles) {
    const fullPath = path.join(issuesDir, relPath);
    const content = await fs.readFile(fullPath, "utf-8");
    const fm = parseIssueMetadata(content);

    if (!fm) {
      allViolations.push({
        id: path.basename(relPath, ".md"),
        file: relPath,
        severity: "error",
        violation: "no_frontmatter",
        detail: "Issue file has no YAML frontmatter",
        suggestion:
          "Add YAML frontmatter with id, type, severity, status fields",
      });
      continue;
    }

    const violations = validateIssue(relPath, fm);
    allViolations.push(...violations);

    // Auto-fix if requested
    if (argv.fix && violations.some((v) => v.violation === "wrong_chapter")) {
      const fixed = await fixIssue(fullPath, fm);
      if (fixed) {
        process.stdout.write(
          `  🔧 Fixed: ${relPath} → ${getExpectedChapter(fm.type!)}/${path.basename(relPath)}\n`,
        );
      }
    }
  }

  // Generate report
  const report = generateReport(allViolations, issueFiles.length);

  if (argv.output) {
    await fs.outputJson(argv.output, report, { spaces: 2 });
  }

  // Console summary
  process.stdout.write(
    `\n📋 Issue Type Validation Report\n` +
      `────────────────────────────────\n` +
      `Total Issues:  ${report.totalIssues}\n` +
      `Errors:        ${report.summary.errors}\n` +
      `Warnings:      ${report.summary.warnings}\n` +
      `Passed:        ${report.summary.passed}\n`,
  );

  if (allViolations.length > 0) {
    process.stdout.write(`\nViolations:\n`);
    for (const v of allViolations) {
      const icon = v.severity === "error" ? "🔴" : "🟡";
      process.stdout.write(
        `  ${icon} [${v.id}] ${v.violation}\n` +
          `     File: ${v.file}\n` +
          `     ${v.detail}\n` +
          `     → ${v.suggestion}\n`,
      );
    }
  }

  const hasErrors = report.summary.errors > 0;
  if (hasErrors) process.exit(1);
  process.exit(0);
}

const isMainModule =
  process.argv[1]?.endsWith("validate-issue-types.ts") ||
  process.argv[1]?.endsWith("validate-issue-types.js");
if (isMainModule) main();
