/**
 * Validate all artifacts listed in state.json exist, are non-empty,
 * and JSON artifacts are valid parseable JSON.
 *
 * Usage:
 *   npx tsx src/lib/validate/validate-artifacts.ts \
 *     --state .agentic-wiki/state.json \
 *     [--phase DEPENDENCY] \
 *     [--strict]
 *
 * --phase    Only validate a specific phase (default: all)
 * --strict   Exit with code 1 on warnings too (default: only on errors)
 */

import fs from "fs-extra";
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { WikiState, PhaseRecord } from "../types/index.js";

export interface ArtifactIssue {
  phase: string;
  artifact: string;
  severity: "error" | "warning";
  message: string;
}

export interface ValidationReport {
  validatedAt: string;
  totalPhases: number;
  totalArtifacts: number;
  issues: ArtifactIssue[];
  summary: {
    errors: number;
    warnings: number;
    passed: number;
  };
}

/** Critical artifacts that must exist per phase. */
export const CRITICAL_ARTIFACTS: Record<string, string[]> = {
  INIT: [".agentic-wiki/cache/project-scan.json"],
  SCAN: [".agentic-wiki/cache/file-list.json"],
  DEPENDENCY: [
    ".agentic-wiki/cache/dependency-graph.json",
    ".agentic-wiki/cache/file-priorities.json",
    ".agentic-wiki/cache/folder-strategy.json",
  ],
  // wiki/book.md is created by assemble-book.ts in ASSEMBLE phase, not in GEN.
  GEN: [],
  ASSEMBLE: [
    ".agentic-wiki/search/symbol-index.json",
    "wiki/book.md",
    "wiki/glossary.md",
  ],
  VALIDATE: [".agentic-wiki/cache/reference-validation.json"],
};

/** Required (but non-critical) artifacts per phase. */
export const REQUIRED_ARTIFACTS: Record<string, string[]> = {
  INIT: [],
  SCAN: [".agentic-wiki/cache/filtered-files.json"],
  DEPENDENCY: [".agentic-wiki/cache/dependency-graph.mmd"],
  GEN: ["wiki/volume-1-code/", "wiki/volume-2-issues/"],
  ASSEMBLE: ["wiki/issues.md"],
  VALIDATE: [],
};

/** All artifact paths are relative to projectRoot. */
export function resolvePath(projectRoot: string, relativePath: string): string {
  return path.resolve(projectRoot, relativePath);
}

export function validatePhase(
  phase: PhaseRecord,
  projectRoot: string,
): ArtifactIssue[] {
  const issues: ArtifactIssue[] = [];
  const phaseName = phase.phase;

  const criticalPaths = CRITICAL_ARTIFACTS[phaseName] || [];
  for (const artifactPath of criticalPaths) {
    const fullPath = resolvePath(projectRoot, artifactPath);
    const issue = checkArtifact(fullPath, artifactPath, phaseName, "error");
    if (issue) issues.push(issue);
  }

  const requiredPaths = REQUIRED_ARTIFACTS[phaseName] || [];
  for (const artifactPath of requiredPaths) {
    const fullPath = resolvePath(projectRoot, artifactPath);
    const issue = checkArtifact(fullPath, artifactPath, phaseName, "warning");
    if (issue) issues.push(issue);
  }

  if (phase.artifacts && Array.isArray(phase.artifacts)) {
    for (const artifactPath of phase.artifacts) {
      if (
        criticalPaths.includes(artifactPath) ||
        requiredPaths.includes(artifactPath)
      ) {
        continue;
      }
      const fullPath = resolvePath(projectRoot, artifactPath);
      const issue = checkArtifact(fullPath, artifactPath, phaseName, "warning");
      if (issue) issues.push(issue);
    }
  }

  return issues;
}

export function checkArtifact(
  fullPath: string,
  relativePath: string,
  phase: string,
  defaultSeverity: "error" | "warning",
): ArtifactIssue | null {
  if (!fs.existsSync(fullPath)) {
    return {
      phase,
      artifact: relativePath,
      severity: defaultSeverity,
      message: `Artifact does not exist: ${relativePath}`,
    };
  }

  try {
    const stat = fs.statSync(fullPath);
    if (stat.size === 0) {
      return {
        phase,
        artifact: relativePath,
        severity: defaultSeverity,
        message: `Artifact is empty: ${relativePath}`,
      };
    }
  } catch {
    return {
      phase,
      artifact: relativePath,
      severity: defaultSeverity,
      message: `Cannot read artifact: ${relativePath}`,
    };
  }

  if (relativePath.endsWith(".json")) {
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      if (content.trim().length > 0) {
        JSON.parse(content);
      }
    } catch (e) {
      const errMsg = e instanceof SyntaxError ? e.message : String(e);
      return {
        phase,
        artifact: relativePath,
        severity: "error",
        message: `Invalid JSON in ${relativePath}: ${errMsg}`,
      };
    }
  }

  if (relativePath.endsWith(".json") && !relativePath.includes("state.json")) {
    const content = fs.readFileSync(fullPath, "utf-8");
    const longTextMatches = content.match(/"[^"]{200,}"/g);
    if (longTextMatches && longTextMatches.length > 2) {
      return {
        phase,
        artifact: relativePath,
        severity: "warning",
        message: `Possible ghost artifact (manual content detected in JSON): ${relativePath}`,
      };
    }
  }

  return null;
}

export function generateReport(
  allIssues: ArtifactIssue[],
  totalPhases: number,
): ValidationReport {
  const errors = allIssues.filter((i) => i.severity === "error").length;
  const warnings = allIssues.filter((i) => i.severity === "warning").length;
  const passed = totalPhases - new Set(allIssues.map((i) => i.phase)).size;

  return {
    validatedAt: new Date().toISOString(),
    totalPhases,
    totalArtifacts: allIssues.length + Math.max(0, passed),
    issues: allIssues,
    summary: { errors, warnings, passed },
  };
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("state", {
      type: "string",
      demandOption: true,
      description: "Path to .agentic-wiki/state.json",
    })
    .option("phase", {
      type: "string",
      description: "Only validate a specific phase",
    })
    .option("strict", {
      type: "boolean",
      default: false,
      description: "Exit with code 1 on warnings too",
    })
    .option("output", {
      type: "string",
      description: "Output report to JSON file",
    })
    .parseSync();

  const statePath = path.resolve(argv.state);
  const state: WikiState = await fs.readJson(statePath);
  const projectRoot = path.resolve(
    state.config.paths?.projectRoot || state.projectPath,
  );

  const targetPhases = argv.phase
    ? state.phaseHistory.filter((p) => p.phase === argv.phase)
    : state.phaseHistory.filter((p) => p.status === "completed");

  if (targetPhases.length === 0) {
    process.stdout.write("No completed phases to validate.\n");
    process.exit(0);
  }

  const allIssues: ArtifactIssue[] = [];
  for (const phase of targetPhases) {
    const issues = validatePhase(phase, projectRoot);
    allIssues.push(...issues);
  }

  const report = generateReport(allIssues, targetPhases.length);

  if (argv.output) {
    await fs.outputJson(argv.output, report, { spaces: 2 });
  }

  process.stdout.write(
    `\n📦 Artifact Gate Report\n` +
      `──────────────────────\n` +
      `Phases validated: ${report.totalPhases}\n` +
      `Errors:   ${report.summary.errors}\n` +
      `Warnings: ${report.summary.warnings}\n` +
      `Passed:   ${report.summary.passed}\n`,
  );

  if (allIssues.length > 0) {
    process.stdout.write(`\nIssues:\n`);
    for (const issue of allIssues) {
      const icon = issue.severity === "error" ? "🔴" : "🟡";
      process.stdout.write(
        `  ${icon} [${issue.phase}] ${issue.artifact}\n` +
          `     ${issue.message}\n`,
      );
    }
  }

  const hasErrors = report.summary.errors > 0;
  const hasWarnings = report.summary.warnings > 0;
  if (hasErrors) process.exit(1);
  if (hasWarnings && argv.strict) process.exit(1);
  process.exit(0);
}

const isMainModule =
  process.argv[1]?.endsWith("validate-artifacts.ts") ||
  process.argv[1]?.endsWith("validate-artifacts.js");
if (isMainModule) main();
