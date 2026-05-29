/**
 * Assign P0-P4 priorities to each file based on naming patterns,
 * dependency count, and file content heuristics.
 *
 * Usage:
 *   npx tsx src/lib/file-priorities.ts \
 *     --files .agentic-wiki/cache/file-list.json \
 *     --deps .agentic-wiki/cache/dependency-graph.json \
 *     --output .agentic-wiki/cache/file-priorities.json
 */

import fs from "fs-extra";
import path from "node:path";
import { execSync } from "node:child_process";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type {
  FileListResult,
  DependencyGraphResult,
  FilePriorityInfo,
  FolderPriorityGroup,
  FilePrioritiesResult,
  Priority,
} from "../types/index.js";

/** File name patterns that indicate entry/barrel files (P0). */
const ENTRY_PATTERNS = [
  /^index\.(ts|tsx|js|jsx)$/,
  /^(main|app|root)\.(ts|tsx|js|jsx)$/,
];

/** File name patterns that indicate test files (P3). */
const TEST_PATTERNS = [
  /\.test\.(ts|tsx|js|jsx)$/,
  /\.spec\.(ts|tsx|js|jsx)$/,
  /__tests__\//,
];

/** File name patterns that indicate story/demo files (P3). */
const STORY_PATTERNS = [
  /\.stories\.(ts|tsx|js|jsx)$/,
  /\.story\.(ts|tsx|js|jsx)$/,
];

/** File extensions that indicate pure style files (P4). */
const STYLE_EXTENSIONS = new Set([".css", ".scss", ".less", ".sass", ".styl"]);

/** Regex to detect JSX in file content (only read first 2KB for speed). */
const JSX_REGEX = /<\w+[^>]*>|<\/\w+>|React\.createElement/;

/** Regex to detect React hooks in file content. */
const HOOK_REGEX = /\buse[A-Z]\w+\s*\(/;

function isEntryFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return ENTRY_PATTERNS.some((p) => p.test(basename));
}

function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(filePath));
}

function isStoryFile(filePath: string): boolean {
  return STORY_PATTERNS.some((p) => p.test(filePath));
}

function isStyleFile(filePath: string): boolean {
  return STYLE_EXTENSIONS.has(path.extname(filePath));
}

function getLineCount(filePath: string): number {
  try {
    const result = execSync(`wc -l < "${filePath}"`, {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
    });
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function containsJSX(filePath: string): boolean {
  try {
    const head = fs.readFileSync(filePath, "utf-8").slice(0, 4096);
    return JSX_REGEX.test(head);
  } catch {
    return false;
  }
}

function containsHook(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8").slice(0, 4096);
    return HOOK_REGEX.test(content);
  } catch {
    return false;
  }
}

function determinePriority(filePath: string, dependentCount: number): Priority {
  // P4: pure style files
  if (isStyleFile(filePath)) return "P4";

  // P3: test and story files
  if (isTestFile(filePath)) return "P3";
  if (isStoryFile(filePath)) return "P3";

  // P0: entry files OR highly depended upon (>= 10 dependents)
  if (isEntryFile(filePath)) return "P0";
  if (dependentCount >= 10) return "P0";

  // P1: contains JSX/React components OR hooks OR medium dependent count
  if (containsJSX(filePath)) return "P1";
  if (containsHook(filePath)) return "P1";
  if (dependentCount >= 5) return "P1";

  // P2: default (utility functions, types, helpers)
  return "P2";
}

function buildReason(
  filePath: string,
  priority: Priority,
  dependentCount: number,
): string {
  const reasons: string[] = [];

  if (isEntryFile(filePath)) reasons.push("entry file (naming pattern)");
  if (isTestFile(filePath)) reasons.push("test file");
  if (isStoryFile(filePath)) reasons.push("story file");
  if (isStyleFile(filePath)) reasons.push("pure style file");
  if (dependentCount >= 10) reasons.push(`highly depended (${dependentCount})`);
  else if (dependentCount >= 5) reasons.push(`depended (${dependentCount})`);

  if (priority === "P1" && containsJSX(filePath)) reasons.push("contains JSX");
  if (priority === "P1" && containsHook(filePath))
    reasons.push("contains hooks");

  return reasons.join(" + ") || `default (${priority})`;
}

export function assignPriorities(
  fileList: FileListResult,
  depGraph: DependencyGraphResult,
  projectPath: string,
): FilePrioritiesResult {
  // Build dependent count lookup
  const depCounts = new Map<string, number>();
  for (const mod of depGraph.modules) {
    // Also count against normalized paths (without src/ prefix variations)
    depCounts.set(mod.source, mod.dependents.length);
  }

  const folders: Record<string, FolderPriorityGroup> = {};

  for (const file of fileList.files) {
    const fullPath = path.join(projectPath, file);
    const lineCount = getLineCount(fullPath);
    const depCount = depCounts.get(file) || 0;
    const priority = determinePriority(file, depCount);
    const reason = buildReason(file, priority, depCount);

    const info: FilePriorityInfo = {
      path: file,
      priority,
      lineCount,
      estimatedTokens: Math.max(1, Math.round(lineCount * 1.5)),
      dependentCount: depCount,
      reason,
    };

    // Group by parent folder
    const folder = path.dirname(file) || ".";
    if (!folders[folder]) {
      folders[folder] = { folder, totalTokens: 0, files: [] };
    }
    folders[folder].files.push(info);
  }

  // Sort files within each folder: P0 first, then by dependent count desc
  const priorityOrder: Record<Priority, number> = {
    P0: 0,
    P1: 1,
    P2: 2,
    P3: 3,
    P4: 4,
  };

  for (const group of Object.values(folders)) {
    group.files.sort((a, b) => {
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return b.dependentCount - a.dependentCount;
    });
    group.totalTokens = group.files.reduce(
      (sum, f) => sum + f.estimatedTokens,
      0,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    folders,
  };
}

// === CLI Entry Point ===
async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("files", { type: "string", demandOption: true })
    .option("deps", { type: "string", demandOption: true })
    .option("output", { type: "string", demandOption: true })
    .parseSync();

  const fileList: FileListResult = await fs.readJson(argv.files);
  const depGraph: DependencyGraphResult = await fs.readJson(argv.deps);

  // projectPath = parent of sourcePath's parent
  const projectPath = path.resolve(argv.files, "../../..");

  const result = assignPriorities(fileList, depGraph, projectPath);
  await fs.outputJson(argv.output, result, { spaces: 2 });

  const totalFiles = fileList.files.length;
  const byPriority: Record<string, number> = {};
  for (const group of Object.values(result.folders)) {
    for (const f of group.files) {
      byPriority[f.priority] = (byPriority[f.priority] || 0) + 1;
    }
  }

  process.stdout.write(
    `Priorities assigned: ${totalFiles} files across ${Object.keys(result.folders).length} folders\n` +
      `  P0=${byPriority.P0 || 0}  P1=${byPriority.P1 || 0}  P2=${byPriority.P2 || 0}  P3=${byPriority.P3 || 0}  P4=${byPriority.P4 || 0}\n`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("file-priorities.ts") ||
  process.argv[1]?.endsWith("file-priorities.js");
if (isMainModule) main();
