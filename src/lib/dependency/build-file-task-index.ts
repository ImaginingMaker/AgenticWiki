/**
 * Build a unified file → task bidirectional index.
 *
 * Incremental mode uses this index to match affected files to tasks,
 * regardless of whether the project uses folder-strategy or task-clusters.
 *
 * Usage:
 *   npx tsx src/lib/dependency/build-file-task-index.ts \
 *     --strategy .agentic-wiki/cache/folder-strategy.json \
 *     --clusters .agentic-wiki/cache/task-clusters.json \
 *     --output .agentic-wiki/cache/file-task-index.json
 */

import fse from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { FileTaskIndex } from "../types/index.js";

/** Minimal shape of a folder-strategy sub-task used in the index. */
interface StrategySubTask {
  id: string;
  files: string[];
}

/** Minimal shape of a task-cluster used in the index. */
interface ClusterEntry {
  id: string;
  files: string[];
}

/**
 * Build a file ↔ task bidirectional index from folder-strategy or task-clusters.
 * Prefers clusters when both are provided.
 */
export function buildFileTaskIndex(
  folderStrategy?: { folders?: Array<{ subTasks?: StrategySubTask[] }> },
  clusterResult?: { clusters?: ClusterEntry[] },
): FileTaskIndex {
  const fileToTasks: Record<string, string[]> = {};
  const taskToFiles: Record<string, string[]> = {};

  if (clusterResult?.clusters?.length) {
    for (const cluster of clusterResult.clusters) {
      taskToFiles[cluster.id] = [...cluster.files];
      for (const file of cluster.files) {
        (fileToTasks[file] ??= []).push(cluster.id);
      }
    }
    return {
      fileToTasks,
      taskToFiles,
      source: "task-clusters",
      generatedAt: new Date().toISOString(),
    };
  }

  if (folderStrategy?.folders?.length) {
    for (const folder of folderStrategy.folders) {
      for (const sub of folder.subTasks || []) {
        taskToFiles[sub.id] = [...sub.files];
        for (const file of sub.files) {
          (fileToTasks[file] ??= []).push(sub.id);
        }
      }
    }
    return {
      fileToTasks,
      taskToFiles,
      source: "folder-strategy",
      generatedAt: new Date().toISOString(),
    };
  }

  // If folderStrategy was provided but has no tasks (empty folders),
  // still return empty index rather than throwing.
  if (folderStrategy && !clusterResult?.clusters?.length) {
    return {
      fileToTasks,
      taskToFiles,
      source: "folder-strategy",
      generatedAt: new Date().toISOString(),
    };
  }

  throw new Error(
    "必须提供 --strategy (folder-strategy.json) 或 --clusters (task-clusters.json)",
  );
}

// === CLI Entry Point ===
async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("strategy", {
      type: "string",
      description: "Path to folder-strategy.json",
    })
    .option("clusters", {
      type: "string",
      description: "Path to task-clusters.json",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      description: "Output path for file-task-index.json",
    })
    .parseSync();

  let folderStrategy;
  let clusterResult;

  if (argv.strategy) {
    try {
      folderStrategy = await fse.readJson(argv.strategy);
    } catch {
      // strategy file missing → skip
    }
  }

  if (argv.clusters) {
    try {
      clusterResult = await fse.readJson(argv.clusters);
    } catch {
      // clusters file missing → skip
    }
  }

  const index = buildFileTaskIndex(folderStrategy, clusterResult);

  await fse.outputJson(argv.output, index, { spaces: 2 });

  const taskCount = Object.keys(index.taskToFiles).length;
  process.stdout.write(
    `File-task index built: ${taskCount} tasks, ` +
      `source=${index.source}\n` +
      `Written to ${argv.output}\n`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("build-file-task-index.ts") ||
  process.argv[1]?.endsWith("build-file-task-index.js");
if (isMainModule) main();
