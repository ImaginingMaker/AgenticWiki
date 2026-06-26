/**
 * Validate quantifiable assertions in Issue Markdown files.
 *
 * This script checks claims that can be verified mechanically:
 *   - "Component has > 200 lines" → grep file line count
 *   - "any appears ≥ 3 times" → grep for `: any` / `as any`
 *   - "Export has 0 references" → check dependency-graph.json dependents
 *   - "Nesting depth > 4" → basic regex-based depth estimation
 *   - "Circular dependency exists" → check dependency-graph.json cycles
 *   - "Source file exists" → fs.pathExists
 *
 * Supports the 3-tier issue classification (P0/P1/P2):
 *   complexity (P2)   → line_count + nesting_depth
 *   typescript (P1)   → any_count
 *   dead_code (P2)    → export_references
 *   bug (P0)          → circular_in_graph
 *   security/performance/maintainability/ux → semantic only
 *
 * Legacy types (complex_logic, missing_types, circular_dependency) still mapped
 * for backward compatibility with older wiki outputs.
 *
 * Frontmatter parsing is delegated to ../shared/issue-parser.js (single source of truth).
 *
 * Usage:
 *   npx tsx src/lib/validate/validate-issue-content.ts \\
 *     --issues wiki/volume-2-issues/ \\
 *     --source <project-src-path> \\
 *     --deps .agentic-wiki/cache/dependency-graph.json \\
 *     [--only IS-2026-001,IS-2026-002] \\
 *     [--output .agentic-wiki/cache/issue-content-validation.json]
 *
 * Exit code: 0 if all checks pass, 1 if any check fails (disputed).
 */

import fs from "fs-extra";
import path from "node:path";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { parseIssueFrontmatter as parseIssueFM } from "../shared/issue-parser.js";
import { updateIssueStatus } from "../shared/issue-status.js";
import type {
  ContentCheck,
  ContentCheckType,
  IssueContentValidationReport,
  DependencyGraphResult,
} from "../types/index.js";

// === Constants ===

const LINE_COUNT_THRESHOLD = 200;
const ANY_COUNT_THRESHOLD = 3;
const NESTING_DEPTH_THRESHOLD = 4;

// === Helpers ===

/**
 * Re-export of the shared issue frontmatter parser.
 * Delegates to `../shared/issue-parser.js` for single-source-of-truth parsing.
 * Kept as named export for backward compatibility with existing test imports.
 */
export function parseIssueFrontmatter(
  content: string,
): Record<string, unknown> | null {
  const fm = parseIssueFM(content);
  if (!fm) return null;
  return fm as unknown as Record<string, unknown>;
}

export function extractIssueDescription(content: string): string {
  // Extract the line/function reference from "## 检测依据" or "## 问题描述" section
  // Format: `src/button/Button.tsx:42` or `src/button/Button.tsx` — `Button`
  const patterns = [
    /\*\*位置\*\*：`([^`]+)`\s*[—–-]\s*`([^`]+)`/,
    /\*\*位置\*\*：`([^`]+)`/,
    /`([^`]+\.[jt]sx?):(\d+)`/,
  ];

  for (const pattern of patterns) {
    const m = content.match(pattern);
    if (m) {
      return m[1].trim();
    }
  }
  return "";
}

export function extractLineNumber(content: string): number | null {
  const m = content.match(/`[^`]*\.([jt]sx?):(\d+)`/);
  if (m) return parseInt(m[2], 10);

  const m2 = content.match(/\*\*位置\*\*：`[^`]*?:(\d+)`/);
  if (m2) return parseInt(m2[1], 10);

  return null;
}

// === Content Checks ===

export async function checkLineCount(
  issueId: string,
  issueFile: string,
  sourceFile: string,
  sourceRoot: string,
): Promise<ContentCheck> {
  const fullPath = path.join(sourceRoot, sourceFile);
  const fileExists = await fs.pathExists(fullPath);

  if (!fileExists) {
    return {
      issueId,
      issueFile,
      checkType: "line_count",
      expected: `> ${LINE_COUNT_THRESHOLD} lines`,
      actual: "FILE_NOT_FOUND",
      passed: false,
      sourceFile,
      detail: `Source file '${sourceFile}' does not exist at ${fullPath}`,
    };
  }

  const content = await fs.readFile(fullPath, "utf-8");
  const lines = content.split("\n").length;

  return {
    issueId,
    issueFile,
    checkType: "line_count",
    expected: `> ${LINE_COUNT_THRESHOLD}`,
    actual: String(lines),
    passed: lines > LINE_COUNT_THRESHOLD,
    sourceFile,
    detail: `File '${sourceFile}' has ${lines} lines (threshold: ${LINE_COUNT_THRESHOLD})`,
  };
}

export async function checkAnyCount(
  issueId: string,
  issueFile: string,
  sourceFile: string,
  sourceRoot: string,
): Promise<ContentCheck> {
  const fullPath = path.join(sourceRoot, sourceFile);
  const fileExists = await fs.pathExists(fullPath);

  if (!fileExists) {
    return {
      issueId,
      issueFile,
      checkType: "any_count",
      expected: `≥ ${ANY_COUNT_THRESHOLD} occurrences`,
      actual: "FILE_NOT_FOUND",
      passed: false,
      sourceFile,
      detail: `Source file '${sourceFile}' does not exist`,
    };
  }

  const content = await fs.readFile(fullPath, "utf-8");
  const anyMatches = content.match(/(:\s*any|as\s+any)/g);
  const count = anyMatches ? anyMatches.length : 0;

  return {
    issueId,
    issueFile,
    checkType: "any_count",
    expected: `≥ ${ANY_COUNT_THRESHOLD}`,
    actual: String(count),
    passed: count >= ANY_COUNT_THRESHOLD,
    sourceFile,
    detail: `File '${sourceFile}' has ${count} 'any' usages (threshold: ${ANY_COUNT_THRESHOLD})`,
  };
}

export async function checkNestingDepth(
  issueId: string,
  issueFile: string,
  sourceFile: string,
  sourceRoot: string,
): Promise<ContentCheck> {
  const fullPath = path.join(sourceRoot, sourceFile);
  const fileExists = await fs.pathExists(fullPath);

  if (!fileExists) {
    return {
      issueId,
      issueFile,
      checkType: "nesting_depth",
      expected: `> ${NESTING_DEPTH_THRESHOLD} levels`,
      actual: "FILE_NOT_FOUND",
      passed: false,
      sourceFile,
      detail: `Source file '${sourceFile}' does not exist`,
    };
  }

  const content = await fs.readFile(fullPath, "utf-8");
  const lines = content.split("\n");

  // Simple heuristic: count leading whitespace depth per line
  let maxDepth = 0;
  for (const line of lines) {
    if (line.trim() === "") continue;
    // Count indent as 2-space or 4-space levels
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    // Check for brace/bracket nesting
    const depth = Math.floor(indent / 2); // 2-space indent
    if (depth > maxDepth) maxDepth = depth;

    // Also check for actual nested blocks (if/for/try)
    const nestedMatch = line.match(
      /^(\s*)(if|for|while|try|switch|async|useEffect|useMemo|useCallback|watch|computed)\b/,
    );
    if (nestedMatch) {
      const nestedDepth = Math.floor(nestedMatch[1].length / 2);
      if (nestedDepth > maxDepth) maxDepth = nestedDepth;
    }
  }

  return {
    issueId,
    issueFile,
    checkType: "nesting_depth",
    expected: `> ${NESTING_DEPTH_THRESHOLD}`,
    actual: String(maxDepth),
    passed: maxDepth > NESTING_DEPTH_THRESHOLD,
    sourceFile,
    detail: `File '${sourceFile}' has max nesting depth of ${maxDepth} (threshold: ${NESTING_DEPTH_THRESHOLD})`,
  };
}

export async function checkExportReferences(
  issueId: string,
  issueFile: string,
  sourceFile: string,
  depGraph: DependencyGraphResult,
): Promise<ContentCheck> {
  const module = depGraph.modules.find((m) => m.source === sourceFile);

  if (!module) {
    return {
      issueId,
      issueFile,
      checkType: "export_references",
      expected: "0 references (dead_code)",
      actual: "MODULE_NOT_IN_GRAPH",
      passed: false,
      sourceFile,
      detail: `Source file '${sourceFile}' not found in dependency graph`,
    };
  }

  const dependentCount = module.dependents.length;

  return {
    issueId,
    issueFile,
    checkType: "export_references",
    expected: "0",
    actual: String(dependentCount),
    passed: dependentCount === 0,
    sourceFile,
    detail: `File '${sourceFile}' has ${dependentCount} dependents (expected 0 for dead_code)`,
  };
}

export async function checkCircularInGraph(
  issueId: string,
  issueFile: string,
  sourceFiles: string[],
  depGraph: DependencyGraphResult,
): Promise<ContentCheck> {
  // Check if any of the issue's source files participate in a detected cycle
  const involvedFiles = new Set<string>();
  for (const cycle of depGraph.cycles) {
    for (const fp of cycle.path) {
      involvedFiles.add(fp);
    }
  }

  const matched = sourceFiles.filter((sf) => involvedFiles.has(sf));

  return {
    issueId,
    issueFile,
    checkType: "circular_in_graph",
    expected: "Cycle registered in dependency-graph.json",
    actual:
      matched.length > 0
        ? `Found ${matched.length} file(s) in cycles`
        : "No match found",
    passed: matched.length > 0,
    sourceFile: sourceFiles.join(", "),
    detail:
      matched.length > 0
        ? `Files ${matched.join(", ")} participate in a detected cycle`
        : `None of [${sourceFiles.join(", ")}] found in dependency-graph.json cycles`,
  };
}

export async function checkFileExists(
  issueId: string,
  issueFile: string,
  sourceFile: string,
  sourceRoot: string,
): Promise<ContentCheck> {
  const fullPath = path.join(sourceRoot, sourceFile);
  const exists = await fs.pathExists(fullPath);

  return {
    issueId,
    issueFile,
    checkType: "file_exists",
    expected: "File exists",
    actual: exists ? "EXISTS" : "NOT_FOUND",
    passed: exists,
    sourceFile,
    detail: exists
      ? `Source file '${sourceFile}' exists`
      : `Source file '${sourceFile}' does not exist at ${fullPath}`,
  };
}

// === Classification: decide which checks to run ===
//
// Maps issue types to quantifiable checks.
// Supports both the current 3-tier classification (P0/P1/P2) and legacy
// type names from older wiki outputs.

export interface IssueMeta {
  id: string;
  file: string;
  issueType: string;
  sourceFiles: string[];
  description: string;
  lineNumber: number | null;
}

/**
 * Set of issue types that have quantifiable assertions to verify.
 * Includes both current types and legacy aliases for backward compatibility.
 */
const QUANTIFIABLE_TYPES: ReadonlySet<string> = new Set([
  // Current 3-tier types (P0/P1/P2)
  "bug",
  "typescript",
  "complexity",
  "dead_code",
  // Legacy aliases (backward compat with older wiki outputs)
  "complex_logic",
  "missing_types",
  "circular_dependency",
  "potential_bug",
  "inconsistent_api",
]);

export function classifyChecks(meta: IssueMeta): ContentCheckType[] {
  const checks: ContentCheckType[] = [];

  // Always check file existence
  checks.push("file_exists");

  switch (meta.issueType) {
    // 🔴 P0: bug — circular dependency detection
    case "bug":
      checks.push("circular_in_graph");
      break;

    // 🟡 P1: typescript — `any` usage count
    case "typescript":
      checks.push("any_count");
      break;

    // 🟢 P2: complexity — line count + nesting depth
    case "complexity":
      checks.push("line_count");
      checks.push("nesting_depth");
      break;

    // 🟢 P2: dead_code — export reference count
    case "dead_code":
      checks.push("export_references");
      break;

    // ── Legacy aliases (backward compat) ──
    case "complex_logic":
      checks.push("line_count");
      checks.push("nesting_depth");
      break;
    case "missing_types":
      checks.push("any_count");
      break;
    case "circular_dependency":
      checks.push("circular_in_graph");
      break;

    // Semantic-only types (no quantifiable assertions):
    // security, performance, maintainability, ux, potential_bug, inconsistent_api
    default:
      break;
  }

  return checks;
}

// === Main validator ===

export async function validateIssueContent(
  meta: IssueMeta,
  sourceRoot: string,
  depGraph: DependencyGraphResult | null,
): Promise<ContentCheck[]> {
  const checksToRun = classifyChecks(meta);
  const results: ContentCheck[] = [];

  for (const sourceFile of meta.sourceFiles) {
    for (const checkType of checksToRun) {
      let check: ContentCheck;

      switch (checkType) {
        case "line_count":
          check = await checkLineCount(
            meta.id,
            meta.file,
            sourceFile,
            sourceRoot,
          );
          break;
        case "any_count":
          check = await checkAnyCount(
            meta.id,
            meta.file,
            sourceFile,
            sourceRoot,
          );
          break;
        case "nesting_depth":
          check = await checkNestingDepth(
            meta.id,
            meta.file,
            sourceFile,
            sourceRoot,
          );
          break;
        case "export_references":
          if (!depGraph) continue;
          check = await checkExportReferences(
            meta.id,
            meta.file,
            sourceFile,
            depGraph,
          );
          break;
        case "circular_in_graph":
          if (!depGraph) continue;
          check = await checkCircularInGraph(
            meta.id,
            meta.file,
            meta.sourceFiles,
            depGraph,
          );
          break;
        case "file_exists":
          check = await checkFileExists(
            meta.id,
            meta.file,
            sourceFile,
            sourceRoot,
          );
          break;
        default:
          continue;
      }

      results.push(check);
    }
  }

  return results;
}

// === CLI ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("issues", {
      type: "string",
      demandOption: true,
      description: "Path to wiki/volume-2-issues/ directory",
    })
    .option("source", {
      type: "string",
      demandOption: true,
      description: "Project source root path",
    })
    .option("deps", {
      type: "string",
      description:
        "Path to dependency-graph.json (required for dead_code + circular checks)",
    })
    .option("only", {
      type: "string",
      description:
        "Comma-separated Issue IDs to check (e.g., IS-2026-001,IS-2026-002)",
    })
    .option("output", {
      type: "string",
      description: "Write validation report as JSON",
    })
    .parseSync();

  const onlyIds = argv.only
    ? new Set(argv.only.split(",").map((s: string) => s.trim()))
    : null;

  // Load dependency graph if provided
  let depGraph: DependencyGraphResult | null = null;
  if (argv.deps) {
    depGraph = await fs.readJson(argv.deps);
  }

  // Find all issue files
  const issuesPath = path.resolve(argv.issues);
  const sourceRoot = path.resolve(argv.source);

  const issueFiles = await globby("**/IS-*.md", {
    cwd: issuesPath,
    onlyFiles: true,
  });

  if (issueFiles.length === 0) {
    const report: IssueContentValidationReport = {
      validatedAt: new Date().toISOString(),
      totalChecked: 0,
      checks: [],
      summary: { passed: 0, failed: 0, disputed: 0 },
    };
    if (argv.output) {
      await fs.outputJson(argv.output, report, { spaces: 2 });
    }
    process.stdout.write("No Issue files found.\n");
    process.exit(0);
  }

  // Parse each issue and run checks
  const allChecks: ContentCheck[] = [];

  for (const relPath of issueFiles) {
    const fullPath = path.join(issuesPath, relPath);
    const content = await fs.readFile(fullPath, "utf-8");
    const fm = await parseIssueFrontmatter(content);

    const issueId = (fm?.id as string) || path.basename(relPath, ".md");
    const issueType = (fm?.type as string) || "unknown";

    // Skip if --only is specified and this ID is not in the list
    if (onlyIds && !onlyIds.has(issueId)) continue;

    const sourceFiles = (fm?.source_files as string[]) || [];
    if (sourceFiles.length === 0) continue;

    // Only check quantifiable issue types (current + legacy)
    if (!QUANTIFIABLE_TYPES.has(issueType)) {
      continue;
    }

    const description = extractIssueDescription(content);
    const lineNumber = extractLineNumber(content);

    const meta: IssueMeta = {
      id: issueId,
      file: relPath,
      issueType,
      sourceFiles,
      description,
      lineNumber,
    };

    const checks = await validateIssueContent(meta, sourceRoot, depGraph);
    allChecks.push(...checks);

    // Update issue status based on validation results
    if (checks.length > 0) {
      const allPassed = checks.every((c) => c.passed);
      if (allPassed) {
        updateIssueStatus(fullPath, "verified", "aw-validate", `All ${checks.length} content checks passed`);
      } else {
        const failedCount = checks.filter((c) => !c.passed).length;
        updateIssueStatus(fullPath, "disputed", "aw-validate", `${failedCount}/${checks.length} content checks failed`);
      }
    }
  }

  // Generate report
  const passed = allChecks.filter((c) => c.passed).length;
  const failed = allChecks.filter((c) => !c.passed).length;

  const report: IssueContentValidationReport = {
    validatedAt: new Date().toISOString(),
    totalChecked: allChecks.length,
    checks: allChecks,
    summary: { passed, failed, disputed: failed },
  };

  if (argv.output) {
    await fs.outputJson(argv.output, report, { spaces: 2 });
  }

  // Console output
  process.stdout.write(
    `\n📋 Issue Content Validation Report\n` +
      `──────────────────────────────────\n` +
      `Total Checks:  ${allChecks.length}\n` +
      `Passed:        ${passed}\n` +
      `Failed:        ${failed}\n`,
  );

  if (failed > 0) {
    process.stdout.write(`\nFailed Checks:\n`);
    for (const c of allChecks.filter((c) => !c.passed)) {
      const icon = c.checkType === "file_exists" ? "🔴" : "🟡";
      process.stdout.write(
        `  ${icon} [${c.issueId}] ${c.checkType}\n` +
          `     File: ${c.issueFile}\n` +
          `     Source: ${c.sourceFile}\n` +
          `     Expected: ${c.expected}\n` +
          `     Actual:   ${c.actual}\n` +
          `     → ${c.detail}\n`,
      );
    }
  }

  if (failed > 0) process.exit(1);
  process.exit(0);
}

const isMainModule =
  process.argv[1]?.endsWith("validate-issue-content.ts") ||
  process.argv[1]?.endsWith("validate-issue-content.js");
if (isMainModule) main();
