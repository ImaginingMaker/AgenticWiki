/**
 * Analyze folder sizes and decide splitting strategy.
 *
 * v2 enhancement: when --priorities is provided, uses token estimates
 * and file role grouping to produce subTasks[] and crossFolderMerges[].
 *
 * Usage (v1 compat):
 *   npx tsx src/lib/analyze-folders.ts --input .agentic-wiki/cache/file-list.json --output .agentic-wiki/cache/folder-strategy.json
 *
 * Usage (v2):
 *   npx tsx src/lib/analyze-folders.ts --input .agentic-wiki/cache/file-priorities.json --output .agentic-wiki/cache/folder-strategy.json
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  sanitizePathId,
  generateSubTaskId,
  generateWikiChapterPath,
} from "./id-utils.js";
import type {
  FileListResult,
  FilePrioritiesResult,
  FilePriorityInfo,
  FolderStrategyResult,
  FolderInfo,
  SubFolder,
  SubTaskInfo,
  CrossFolderMerge,
  Priority,
} from "../types/index.js";

// === Constants ===

const ENTRY_FILE_PATTERNS = ["app", "main", "index"];

/** Token threshold: folder total > this → split into sub-tasks. */
const SPLIT_TOKEN_THRESHOLD = 50000;

/** Token threshold: folder total <= this → no split needed. */
const NO_SPLIT_TOKEN_THRESHOLD = 30000;

/** Token threshold: sub-task < this → merge with adjacent or cross-folder. */
const MERGE_MIN_TOKEN_THRESHOLD = 5000;

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
    // Heuristic: PascalCase files in components dir = UI components
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

function getParentFolder(filePath: string): string {
  return path.dirname(filePath);
}

// === Main: enhanced folder strategy ===

export function analyzeFolders(
  input: FileListResult | FilePrioritiesResult,
): FolderStrategyResult {
  // Detect input type
  const isV2 =
    "folders" in input &&
    typeof input.folders === "object" &&
    !Array.isArray(input.folders);

  if (isV2) {
    return analyzeFoldersV2(input as FilePrioritiesResult);
  }
  return analyzeFoldersV1(input as FileListResult);
}

/** v1: basic file-count-based analysis (backward compatible). */
function analyzeFoldersV1(fileList: FileListResult): FolderStrategyResult {
  const allFolders = new Set<string>();
  for (const file of fileList.files) {
    const fp = getParentFolder(file);
    if (fp) {
      allFolders.add(fp);
      const parts = fp.split("/");
      for (let i = 1; i < parts.length; i++) {
        allFolders.add(parts.slice(0, i).join("/"));
      }
    }
  }

  const folderFiles = new Map<string, string[]>();
  for (const file of fileList.files) {
    const fp = getParentFolder(file);
    if (!fp) continue;
    if (!folderFiles.has(fp)) folderFiles.set(fp, []);
    folderFiles.get(fp)!.push(file);
  }

  const folderChildren = new Map<string, Set<string>>();
  for (const folder of allFolders)
    folderChildren.set(folder, new Set<string>());
  for (const folder of allFolders) {
    for (const other of allFolders) {
      if (other !== folder && other.startsWith(folder + "/")) {
        const rel = other.slice(folder.length + 1);
        if (!rel.includes("/")) folderChildren.get(folder)!.add(other);
      }
    }
  }

  const folders: FolderInfo[] = [];
  for (const folderPath of allFolders) {
    const files = folderFiles.get(folderPath) || [];
    const fileCount = files.length;
    const shouldSplit = fileCount > 50;
    let logicFileCount = 0;
    let styleFileCount = 0;
    for (const file of files) {
      const ext = path.extname(file);
      if ([".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte"].includes(ext))
        logicFileCount++;
      else if ([".css", ".scss", ".less", ".sass"].includes(ext))
        styleFileCount++;
    }
    const hasEntryFile = files.some(isEntryFile);
    const priority: "high" | "medium" | "low" = hasEntryFile
      ? "high"
      : "medium";

    const subFolders: SubFolder[] = [];
    const children = folderChildren.get(folderPath);
    if (children) {
      for (const childPath of children) {
        const childFiles = folderFiles.get(childPath) || [];
        subFolders.push({ path: childPath, fileCount: childFiles.length });
      }
    }

    let reason: string;
    if (shouldSplit) reason = `包含 ${fileCount} 个文件，超过阈值 50`;
    else if (fileCount === 0) reason = "空文件夹";
    else reason = `包含 ${fileCount} 个文件，规模适中`;

    folders.push({
      path: folderPath || ".",
      fileCount,
      logicFileCount,
      styleFileCount,
      shouldSplit,
      subFolders: subFolders.length > 0 ? subFolders : undefined,
      reason,
      priority,
    });
  }

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
  };
}

/** v2: token-based analysis with role grouping, sub-tasks, and cross-folder merges. */
function analyzeFoldersV2(
  priorities: FilePrioritiesResult,
): FolderStrategyResult {
  const folders: FolderInfo[] = [];
  const crossFolderMergeCandidates: Map<
    string,
    { files: string[]; tokens: number; folders: Set<string> }
  > = new Map();

  for (const [folderPath, group] of Object.entries(priorities.folders)) {
    // Only analyze folders with files and non-zero tokens
    if (group.files.length === 0) continue;

    const totalTokens = group.totalTokens;
    const shouldSplit = totalTokens > SPLIT_TOKEN_THRESHOLD;
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

      if (roleTokens < MERGE_MIN_TOKEN_THRESHOLD && shouldSplit) {
        // Too small to be its own sub-task → candidate for cross-folder merge
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

      // If role tokens > 50K, split further
      if (roleTokens > SPLIT_TOKEN_THRESHOLD) {
        // Split role into chunks of ~30K tokens each
        const chunks = chunkFiles(roleFiles, NO_SPLIT_TOKEN_THRESHOLD);
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
      reason = `总 token ${totalTokens}，超过阈值 ${SPLIT_TOKEN_THRESHOLD}，拆分为 ${subTasks.length} 个子任务`;
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
    if (
      candidate.tokens >= MERGE_MIN_TOKEN_THRESHOLD &&
      candidate.folders.size >= 2
    ) {
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
      // Mark for merge by setting mergeWith on the singleton folder's last sub-task
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

// === CLI Entry Point ===
async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("input", {
      type: "string",
      demandOption: true,
      description: "Path to file-list.json or file-priorities.json",
    })
    .option("output", { type: "string", demandOption: true })
    .parseSync();

  const rawInput = await fs.readJson(argv.input);

  // Normalize: accept FileListResult (files[]), FilteredFilesResult (filteredFiles[]), or FilePrioritiesResult
  let input;
  if (rawInput.files && Array.isArray(rawInput.files)) {
    input = rawInput;
  } else if (rawInput.filteredFiles && Array.isArray(rawInput.filteredFiles)) {
    input = {
      files: rawInput.filteredFiles.map(function (f) {
        return f.path;
      }),
    };
  } else {
    input = rawInput;
  }

  const result = analyzeFolders(input);
  await fs.outputJson(argv.output, result, { spaces: 2 });

  const isV2 = "crossFolderMerges" in result && result.crossFolderMerges;
  process.stdout.write(
    `Folder strategy: ${result.foldersToAnalyze} folders to analyze` +
      (isV2
        ? `, ${(result as any).crossFolderMerges?.length || 0} cross-folder merges`
        : "") +
      `\nWritten to ${argv.output}\n`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("analyze-folders.ts") ||
  process.argv[1]?.endsWith("analyze-folders.js");
if (isMainModule) main();
