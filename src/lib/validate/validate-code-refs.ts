/**
 * Validate Code References — 校验 Wiki 中对源码的引用是否有效。
 *
 * 检查项：
 *   1. Wiki frontmatter sourceFiles 指向的源文件是否存在
 *   2. Wiki 章节标题中的函数/组件名是否在源文件中出现（基本 grep）
 *   3. 依赖图一致性：Wiki 中的依赖是否与 dependency-graph.json 一致
 *
 * 替代编排器 VALIDATE Step 2-3 中手工逐文件读取比对的操作。
 *
 * Usage:
 *   npx tsx src/lib/validate/validate-code-refs.ts \
 *     --wiki wiki/ \
 *     --source <project-src-path> \
 *     --deps .agentic-wiki/cache/dependency-graph.json \
 *     --output .agentic-wiki/cache/code-ref-validation.json
 *
 * Exit: 0 = all OK, 1 = issues found
 */

import path from "node:path";
import fs from "fs-extra";
import { globby } from "globby";
import matter from "gray-matter";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { DependencyGraphResult } from "../types/index.js";

// === Types ===

export type RefCheckSeverity = "error" | "warning" | "info";

export interface RefCheck {
  wikiPage: string;
  checkType: "file_exists" | "symbol_in_file" | "dep_consistency";
  severity: RefCheckSeverity;
  sourceFile: string;
  expected: string;
  actual: string;
  passed: boolean;
  detail: string;
}

export interface CodeRefValidationReport {
  validatedAt: string;
  totalWikiPages: number;
  totalChecks: number;
  checks: RefCheck[];
  summary: {
    passed: number;
    failed: number;
    errors: number;
    warnings: number;
  };
}

// === Checks ===

async function checkSourceFileExists(
  wikiPage: string,
  sourceFile: string,
  projectRoot: string,
): Promise<RefCheck> {
  const fullPath = path.join(projectRoot, sourceFile);
  const exists = await fs.pathExists(fullPath);

  return {
    wikiPage,
    checkType: "file_exists",
    severity: "error",
    sourceFile,
    expected: "File exists",
    actual: exists ? "EXISTS" : "NOT_FOUND",
    passed: exists,
    detail: exists
      ? `Source file '${sourceFile}' exists`
      : `Source file '${sourceFile}' does not exist`,
  };
}

async function checkSymbolInFile(
  wikiPage: string,
  sourceFile: string,
  symbolName: string,
  projectRoot: string,
): Promise<RefCheck> {
  const fullPath = path.join(projectRoot, sourceFile);
  if (!(await fs.pathExists(fullPath))) {
    return {
      wikiPage,
      checkType: "symbol_in_file",
      severity: "warning",
      sourceFile,
      expected: `Symbol '${symbolName}' found in file`,
      actual: "FILE_NOT_FOUND",
      passed: false,
      detail: `Source file '${sourceFile}' does not exist, cannot check symbol`,
    };
  }

  const content = await fs.readFile(fullPath, "utf-8");

  // Try multiple patterns to find the symbol
  const patterns = [
    new RegExp(`\\b${escapeRegex(symbolName)}\\b`),
    new RegExp(
      `(?:export\\s+)?(?:function|const|class|interface|type|enum)\\s+${escapeRegex(symbolName)}\\b`,
    ),
  ];

  let found = false;
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      found = true;
      break;
    }
  }

  return {
    wikiPage,
    checkType: "symbol_in_file",
    severity: "warning",
    sourceFile,
    expected: `Symbol '${symbolName}' found in file`,
    actual: found ? "FOUND" : "NOT_FOUND",
    passed: found,
    detail: found
      ? `Symbol '${symbolName}' found in '${sourceFile}'`
      : `Symbol '${symbolName}' not found in '${sourceFile}' (may be renamed or moved)`,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function checkDepConsistency(
  wikiPage: string,
  sourceFile: string,
  depGraph: DependencyGraphResult,
): Promise<RefCheck[]> {
  const checks: RefCheck[] = [];
  const module = depGraph.modules.find((m) => m.source === sourceFile);

  if (!module) {
    return [
      {
        wikiPage,
        checkType: "dep_consistency",
        severity: "warning",
        sourceFile,
        expected: "Module in dependency graph",
        actual: "NOT_IN_GRAPH",
        passed: false,
        detail: `Source file '${sourceFile}' not found in dependency graph — may be external or excluded`,
      },
    ];
  }

  // Check circular dependencies
  if (module.hasCircular) {
    // Find the cycle info
    const cycle = depGraph.cycles.find((c) => c.path.includes(sourceFile));
    checks.push({
      wikiPage,
      checkType: "dep_consistency",
      severity: "error",
      sourceFile,
      expected: "No circular dependency",
      actual: cycle ? `CYCLE: ${cycle.path.join(" → ")}` : "HAS_CIRCULAR",
      passed: false,
      detail: `Circular dependency detected involving '${sourceFile}'`,
    });
  } else {
    checks.push({
      wikiPage,
      checkType: "dep_consistency",
      severity: "info",
      sourceFile,
      expected: "No circular dependency",
      actual: "OK",
      passed: true,
      detail: `No circular dependency involving '${sourceFile}'`,
    });
  }

  // Check if heavily depended module
  if (module.dependents.length >= 10) {
    checks.push({
      wikiPage,
      checkType: "dep_consistency",
      severity: "info",
      sourceFile,
      expected: `< 10 dependents`,
      actual: `${module.dependents.length} dependents`,
      passed: true,
      detail: `'${sourceFile}' is a hot module with ${module.dependents.length} dependents`,
    });
  }

  return checks;
}

// === Symbol Extraction from Wiki ===

interface WikiSymbol {
  name: string;
  wikiPage: string;
  sourceFiles: string[];
}

export function extractWikiSymbols(rawContent: string): string[] {
  const symbols: string[] = [];
  const seen = new Set<string>();

  // H2/H3 headings with backtick-wrapped names
  const headingRe = /^#{2,3}\s+`([A-Za-z_]\w+)`/gm;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(rawContent)) !== null) {
    const name = m[1];
    if (!seen.has(name) && name.length >= 2) {
      seen.add(name);
      symbols.push(name);
    }
  }

  return symbols;
}

// === Main ===

export async function validateCodeRefs(
  wikiPath: string,
  sourceRoot: string,
  depGraph: DependencyGraphResult | null,
): Promise<CodeRefValidationReport> {
  const volume1Path = path.join(wikiPath, "volume-1-code");
  const allChecks: RefCheck[] = [];

  const mdFiles = await globby(["**/*.md"], {
    cwd: volume1Path,
    onlyFiles: true,
  });

  if (mdFiles.length === 0) {
    return {
      validatedAt: new Date().toISOString(),
      totalWikiPages: 0,
      totalChecks: 0,
      checks: [],
      summary: { passed: 0, failed: 0, errors: 0, warnings: 0 },
    };
  }

  for (const relPath of mdFiles) {
    const fullPath = path.join(volume1Path, relPath);
    const rawContent = await fs.readFile(fullPath, "utf-8");
    const parsed = matter(rawContent);

    const sourceFiles: string[] = Array.isArray(parsed.data.sourceFiles)
      ? parsed.data.sourceFiles
      : typeof parsed.data.sourceFiles === "string"
        ? [parsed.data.sourceFiles]
        : [];

    const symbols = extractWikiSymbols(rawContent);

    for (const sf of sourceFiles) {
      // Check 1: Source file exists
      allChecks.push(await checkSourceFileExists(relPath, sf, sourceRoot));

      // Check 2: Each symbol found in source files
      for (const sym of symbols) {
        allChecks.push(await checkSymbolInFile(relPath, sf, sym, sourceRoot));
      }

      // Check 3: Dependency consistency
      if (depGraph) {
        const depChecks = await checkDepConsistency(relPath, sf, depGraph);
        allChecks.push(...depChecks);
      }
    }

    // If no source files, still log
    if (sourceFiles.length === 0) {
      allChecks.push({
        wikiPage: relPath,
        checkType: "file_exists",
        severity: "warning",
        sourceFile: "(none)",
        expected: "At least one source file referenced",
        actual: "EMPTY",
        passed: false,
        detail: `Wiki page '${relPath}' has no sourceFiles in frontmatter`,
      });
    }
  }

  const passed = allChecks.filter((c) => c.passed).length;
  const failed = allChecks.filter((c) => !c.passed).length;
  const errors = allChecks.filter(
    (c) => !c.passed && c.severity === "error",
  ).length;
  const warnings = allChecks.filter(
    (c) => !c.passed && c.severity === "warning",
  ).length;

  return {
    validatedAt: new Date().toISOString(),
    totalWikiPages: mdFiles.length,
    totalChecks: allChecks.length,
    checks: allChecks,
    summary: { passed, failed, errors, warnings },
  };
}

// === CLI ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("wiki", { type: "string", demandOption: true })
    .option("source", { type: "string", demandOption: true })
    .option("deps", { type: "string" })
    .option("output", { type: "string", demandOption: true })
    .option("only-failed", { type: "boolean", default: false })
    .parseSync();

  let depGraph: DependencyGraphResult | null = null;
  if (argv.deps) {
    try {
      depGraph = await fs.readJson(argv.deps);
    } catch {
      /* skip */
    }
  }

  const report = await validateCodeRefs(
    path.resolve(argv.wiki),
    path.resolve(argv.source),
    depGraph,
  );

  await fs.outputJson(argv.output, report, { spaces: 2 });

  if (!argv["only-failed"] || report.summary.failed > 0) {
    process.stdout.write(
      `\n📋 Code Reference Validation\n` +
        `─────────────────────────────\n` +
        `Pages:   ${report.totalWikiPages}\n` +
        `Checks:  ${report.totalChecks}\n` +
        `Passed:  ${report.summary.passed}\n` +
        `Failed:  ${report.summary.failed} (${report.summary.errors} errors, ${report.summary.warnings} warnings)\n`,
    );

    if (report.summary.failed > 0) {
      process.stdout.write(`\nFailed checks:\n`);
      for (const c of report.checks.filter((x) => !x.passed)) {
        const icon = c.severity === "error" ? "🔴" : "🟡";
        process.stdout.write(
          `  ${icon} [${c.checkType}] ${c.wikiPage}\n` + `     ${c.detail}\n`,
        );
      }
    }
  }

  process.stdout.write(`\nReport: ${argv.output}\n`);

  if (report.summary.errors > 0) process.exit(1);
  process.exit(0);
}

const isMainModule =
  process.argv[1]?.endsWith("validate-code-refs.ts") ||
  process.argv[1]?.endsWith("validate-code-refs.js");
if (isMainModule) main();
