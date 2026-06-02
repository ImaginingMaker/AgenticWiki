/**
 * Analyze folder sizes and decide splitting strategy.
 *
 * Usage:
 *   npx tsx src/lib/dependency/analyze-folders.ts --input .agentic-wiki/cache/file-priorities.json --output .agentic-wiki/cache/folder-strategy.json
 *
 * Requires file-priorities.json (produced by file-priorities.ts).
 * Produces subTasks[] and crossFolderMerges[] for gen-scheduler.ts.
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  sanitizePathId,
  generateSubTaskId,
  generateWikiChapterPath,
} from "../shared/id-utils.js";
import type {
  FilePrioritiesResult,
  FilePriorityInfo,
  FolderStrategyResult,
  FolderInfo,
  SubTaskInfo,
  CrossFolderMerge,
  Priority,
} from "../types/index.js";

// === Constants ===

const ENTRY_FILE_PATTERNS = ["app", "main", "index"];

// Thresholds are now computed dynamically by calcThresholds().
// These are the fallback values when no project total is available.
const DEFAULT_SPLIT = 50000;
const DEFAULT_NO_SPLIT = 30000;
const DEFAULT_MERGE_MIN = 5000;

/**
 * Dynamic threshold calculation.
 * Converts hardcoded constants to project-size-aware percentages.
 *
 * For a 1M-token project:  split=50K(5%), noSplit=25K(2.5%), mergeMin=3K(0.3%)
 * For a 100K-token project: split=30K(30%), noSplit=15K(15%), mergeMin=3K(3%)
 *
 * Clamped to safe ranges to avoid pathological behavior on tiny/huge projects.
 */
function calcThresholds(totalProjectTokens: number): {
  split: number;
  noSplit: number;
  mergeMin: number;
} {
  if (totalProjectTokens <= 0) {
    return {
      split: DEFAULT_SPLIT,
      noSplit: DEFAULT_NO_SPLIT,
      mergeMin: DEFAULT_MERGE_MIN,
    };
  }
  return {
    // 5% of project total, clamped [20000, 150000]
    split: Math.max(
      20000,
      Math.min(150000, Math.round(totalProjectTokens * 0.05)),
    ),
    // 2.5% of project total, clamped [10000, 80000]
    noSplit: Math.max(
      10000,
      Math.min(80000, Math.round(totalProjectTokens * 0.025)),
    ),
    // 0.3% of project total, clamped [3000, 15000]
    mergeMin: Math.max(
      3000,
      Math.min(15000, Math.round(totalProjectTokens * 0.003)),
    ),
  };
}

/**
 * Check if a file is a pure re-export barrel file.
 * Reads the first 4KB of the file and checks if all non-blank,
 * non-comment lines are re-export statements.
 */
function isPureReexportFile(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8").slice(0, 4096);
    const lines = content.split("\n");
    if (lines.length === 0) return true;

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip blank lines and pure comments
      if (
        trimmed === "" ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*")
      )
        continue;
      // Allow re-export patterns
      if (trimmed.startsWith("export * from")) continue;
      if (trimmed.startsWith("export {") && trimmed.includes("} from"))
        continue;
      if (/^export\s+\{[^}]*\}\s+from/.test(trimmed)) continue;
      if (/^export\s+(?:type|interface)\s+\{[^}]*\}\s+from/.test(trimmed))
        continue;
      // Allow "use client" / "use server" directives
      if (
        trimmed === '"use client"' ||
        trimmed === "'use client'" ||
        trimmed === '"use server"' ||
        trimmed === "'use server'"
      )
        continue;
      // Anything else is real code → not pure re-export
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// === Role Classification ===

type FileRole =
  | "entry"
  | "ui-components"
  | "business-components"
  | "hooks"
  | "utils"
  | "types"
  | "other";

function classifyRole(filePath: string, priority: Priority): FileRole {
  const basename = path.basename(filePath).toLowerCase();
  const dirname = path.dirname(filePath).toLowerCase();

  // Entry files
  if (ENTRY_FILE_PATTERNS.some((p) => basename.startsWith(p))) return "entry";

  // Hooks
  if (
    basename.startsWith("use") ||
    dirname.includes("hooks") ||
    dirname.includes("hook")
  ) {
    return "hooks";
  }

  // Types
  if (
    dirname.includes("types") ||
    dirname.includes("type") ||
    basename.includes(".d.ts") ||
    basename.includes("interface") ||
    basename.includes("enum")
  ) {
    return "types";
  }

  // UI components (generic reusable)
  if (
    dirname.includes("components") ||
    dirname.includes("ui") ||
    dirname.includes("common")
  ) {
    if (/^[A-Z]/.test(basename)) return "ui-components";
    return "ui-components";
  }

  // Business components (pages, features, modules)
  if (
    dirname.includes("pages") ||
    dirname.includes("features") ||
    dirname.includes("modules")
  ) {
    return "business-components";
  }

  // Utils
  if (
    dirname.includes("utils") ||
    dirname.includes("util") ||
    dirname.includes("helpers") ||
    dirname.includes("lib")
  ) {
    return "utils";
  }

  // Fallback by priority
  if (priority === "P0") return "entry";
  if (priority === "P1") return "business-components";

  return "utils";
}

// === Helpers ===

function isEntryFile(filePath: string): boolean {
  const basename = path
    .basename(filePath, path.extname(filePath))
    .toLowerCase();
  return ENTRY_FILE_PATTERNS.includes(basename);
}

function roleLabel(role: FileRole): string {
  const labels: Record<FileRole, string> = {
    entry: "入口文件",
    "ui-components": "UI 组件",
    "business-components": "业务组件",
    hooks: "Hooks",
    utils: "工具函数",
    types: "类型定义",
    other: "其他",
  };
  return labels[role] || role;
}

// === Core: Folder Strategy ===

export function analyzeFolders(
  input: FilePrioritiesResult,
  sourceRoot?: string,
): FolderStrategyResult {
  return analyzeFoldersV2(input, sourceRoot);
}

function analyzeFoldersV2(
  priorities: FilePrioritiesResult,
  sourceRoot?: string,
): FolderStrategyResult {
  const folders: FolderInfo[] = [];
  const crossFolderMergeCandidates: Map<
    string,
    { files: string[]; tokens: number; folders: Set<string> }
  > = new Map();

  // === Dynamic threshold calculation ===
  // Compute total project tokens from all folders
  const totalProjectTokens = Object.values(priorities.folders).reduce(
    (sum, g) => sum + g.totalTokens,
    0,
  );
  const TH = calcThresholds(totalProjectTokens);

  for (const [folderPath, group] of Object.entries(priorities.folders)) {
    // Only analyze folders with files and non-zero tokens
    if (group.files.length === 0) continue;

    const totalTokens = group.totalTokens;
    const shouldSplit = totalTokens > TH.split;
    const logicFiles = group.files.filter(
      (f) => f.priority !== "P3" && f.priority !== "P4",
    );

    // Group files by role
    const roleGroups = new Map<FileRole, typeof group.files>();
    for (const file of logicFiles) {
      const role = classifyRole(file.path, file.priority);
      if (!roleGroups.has(role)) roleGroups.set(role, []);
      roleGroups.get(role)!.push(file);
    }

    // Build sub-tasks from role groups
    const subTasks: SubTaskInfo[] = [];
    const roleOrder: FileRole[] = [
      "entry",
      "ui-components",
      "business-components",
      "hooks",
      "utils",
      "types",
      "other",
    ];
    let taskCounter = 0;

    for (const role of roleOrder) {
      const roleFiles = roleGroups.get(role);
      if (!roleFiles || roleFiles.length === 0) continue;

      const roleTokens = roleFiles.reduce(
        (sum, f) => sum + f.estimatedTokens,
        0,
      );

      // === Entry file inlining ===
      // If all entry files in this folder are pure re-exports (barrel files),
      // inline them into the first non-entry subTask instead of creating a
      // standalone entry subTask. Pure re-export index.ts files produce
      // minimal Wiki content and waste a subTask slot + token budget.
      if (role === "entry" && sourceRoot) {
        const allPureReexport = roleFiles.every((f) =>
          isPureReexportFile(path.join(sourceRoot, f.path)),
        );
        if (allPureReexport && roleFiles.length > 0) {
          // Find the first non-entry role that has files and merge entry into it
          const nextRole = roleOrder.find(
            (r) =>
              r !== "entry" &&
              roleGroups.has(r) &&
              roleGroups.get(r)!.length > 0,
          );
          if (nextRole) {
            const targetFiles = roleGroups.get(nextRole)!;
            targetFiles.push(...roleFiles);
            // Don't increment taskCounter — entry files are absorbed
            continue;
          }
        }
      }

      if (roleTokens < TH.mergeMin && shouldSplit) {
        // Too small → candidate for cross-folder merge
        const mergeKey = role;
        if (!crossFolderMergeCandidates.has(mergeKey)) {
          crossFolderMergeCandidates.set(mergeKey, {
            files: [],
            tokens: 0,
            folders: new Set(),
          });
        }
        const candidate = crossFolderMergeCandidates.get(mergeKey)!;
        candidate.files.push(...roleFiles.map((f) => f.path));
        candidate.tokens += roleTokens;
        candidate.folders.add(folderPath);
        continue;
      }

      // If role tokens > split threshold, split further
      if (roleTokens > TH.split) {
        const chunks = chunkFiles(roleFiles, TH.noSplit);
        for (const chunk of chunks) {
          taskCounter++;
          const chunkTokens = chunk.reduce(
            (sum, f) => sum + f.estimatedTokens,
            0,
          );
          const wikiChapter = generateWikiChapterPath(
            folderPath,
            role,
            taskCounter,
          );
          subTasks.push({
            id: generateSubTaskId(folderPath, role, taskCounter),
            label: `${roleLabel(role)} (${taskCounter})`,
            role,
            files: chunk.map((f) => f.path),
            estimatedTokens: chunkTokens,
            wikiChapter,
            priority: chunk.some((f) => f.priority === "P0") ? "P0" : "P1",
          });
        }
      } else {
        taskCounter++;
        const wikiChapter = generateWikiChapterPath(
          folderPath,
          role,
          taskCounter,
        );
        subTasks.push({
          id: generateSubTaskId(folderPath, role),
          label: roleLabel(role),
          role,
          files: roleFiles.map((f) => f.path),
          estimatedTokens: roleTokens,
          wikiChapter,
          priority: roleFiles.some((f) => f.priority === "P0") ? "P0" : "P1",
        });
      }
    }

    const logicFileCount = logicFiles.length;
    const styleFileCount = group.files.filter(
      (f) => f.priority === "P4",
    ).length;
    const hasEntryFile = group.files.some((f) => isEntryFile(f.path));

    let reason: string;
    if (shouldSplit) {
      reason = `总 token ${totalTokens}，超过动态阈值 ${TH.split}，拆分为 ${subTasks.length} 个子任务`;
    } else if (totalTokens === 0) {
      reason = "空文件夹";
    } else {
      reason = `总 token ${totalTokens}，规模适中`;
    }

    folders.push({
      path: folderPath || ".",
      fileCount: group.files.length,
      logicFileCount,
      styleFileCount,
      totalTokens,
      shouldSplit,
      subTasks: subTasks.length > 0 ? subTasks : undefined,
      reason,
      priority: hasEntryFile ? "high" : "medium",
    });
  }

  // Build cross-folder merges from candidates that accumulated enough tokens
  const crossFolderMerges: CrossFolderMerge[] = [];
  for (const [role, candidate] of crossFolderMergeCandidates.entries()) {
    if (candidate.tokens >= TH.mergeMin && candidate.folders.size >= 2) {
      crossFolderMerges.push({
        id: `cross-${role}`,
        label: `全局 ${roleLabel(role as FileRole)} 汇总`,
        folders: [...candidate.folders],
        files: candidate.files,
        estimatedTokens: candidate.tokens,
        wikiChapter: `appendix/cross-${role}.md`,
        priority: "P1",
      });
    } else if (candidate.folders.size === 1) {
      // Single-folder small group → merge back into that folder's nearest sub-task
      const soleFolder = [...candidate.folders][0];
      const folderInfo = folders.find((f) => f.path === soleFolder);
      if (folderInfo?.subTasks && folderInfo.subTasks.length > 0) {
        const lastTask = folderInfo.subTasks[folderInfo.subTasks.length - 1];
        lastTask.mergeWith = `cross-${role}`;
        lastTask.files.push(...candidate.files);
        lastTask.estimatedTokens += candidate.tokens;
      }
    }
  }

  // Sort
  folders.sort((a, b) => {
    const po = { high: 0, medium: 1, low: 2 };
    if (po[a.priority] !== po[b.priority])
      return po[a.priority] - po[b.priority];
    return b.fileCount - a.fileCount;
  });

  return {
    generatedAt: new Date().toISOString(),
    folders,
    totalFolders: folders.length,
    foldersToAnalyze: folders.filter((f) => f.fileCount > 0).length,
    crossFolderMerges:
      crossFolderMerges.length > 0 ? crossFolderMerges : undefined,
  };
}

// === Utility Functions ===

function chunkFiles(
  files: FilePriorityInfo[],
  maxTokens: number,
): FilePriorityInfo[][] {
  const chunks: FilePriorityInfo[][] = [];
  let current: FilePriorityInfo[] = [];
  let currentTokens = 0;

  for (const file of files) {
    if (
      currentTokens + file.estimatedTokens > maxTokens &&
      current.length > 0
    ) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(file);
    currentTokens += file.estimatedTokens;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// === CLI Entry Point ===
async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("input", {
      type: "string",
      demandOption: true,
      description: "Path to file-priorities.json",
    })
    .option("output", { type: "string", demandOption: true })
    .option("source", {
      type: "string",
      description:
        "Project source root path (for reading files to detect pure re-export barrels)",
    })
    .parseSync();

  const priorities: FilePrioritiesResult = await fs.readJson(argv.input);
  const result = analyzeFolders(priorities, argv.source);
  await fs.outputJson(argv.output, result, { spaces: 2 });

  process.stdout.write(
    `Folder strategy: ${result.foldersToAnalyze} folders to analyze` +
      `, ${result.crossFolderMerges?.length || 0} cross-folder merges` +
      `\nWritten to ${argv.output}\n`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("analyze-folders.ts") ||
  process.argv[1]?.endsWith("analyze-folders.js");
if (isMainModule) main();
