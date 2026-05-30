/**
 * Sync genTasks — 根据 Wiki 产物目录自动更新 state.json.genTasks 状态。
 *
 * 问题：编排器 Agent 常遗漏手动 edit_file 更新 genTasks，
 *       导致 progress-dashboard.ts 始终显示 0%。
 * 解决：此脚本扫描 wiki 输出目录，自动将对应 genTask 标记为 completed。
 *
 * Usage:
 *   npx tsx src/lib/sync-gen-tasks.ts \
 *     --state .agentic-wiki/state.json \
 *     --wiki  wiki/
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { WikiState, GenTask } from "../types/index.js";

// === Types ===

interface SyncResult {
  syncedAt: string;
  totalGenTasks: number;
  before: { completed: number; inProgress: number; pending: number; failed: number };
  after: { completed: number; inProgress: number; pending: number; failed: number };
  updated: string[];
  skipped: string[];
}

// === Core Logic ===

/**
 * Check if a wiki directory has actual content (non-empty markdown files).
 */
async function hasWikiContent(wikiDir: string): Promise<boolean> {
  try {
    const exists = await fs.pathExists(wikiDir);
    if (!exists) return false;

    const files = await fs.readdir(wikiDir);
    // Directory exists with at least one .md file
    return files.some((f) => f.endsWith(".md"));
  } catch {
    return false;
  }
}

/**
 * Find the wiki chapter directory for a genTask.
 * Looks for volume-1-code/{wikiChapter} pattern.
 */
async function findWikiChapterDir(
  wikiRoot: string,
  wikiChapter: string | undefined,
  folder: string,
): Promise<string | null> {
  if (wikiChapter) {
    // Direct match: wiki/volume-1-code/{wikiChapter}
    const directPath = path.join(wikiRoot, "volume-1-code", wikiChapter);
    if (await hasWikiContent(directPath)) {
      return directPath;
    }
  }

  // Try matching folder name against volume-1-code subdirs
  if (folder) {
    const volume1Path = path.join(wikiRoot, "volume-1-code");
    try {
      const entries = await fs.readdir(volume1Path);
      for (const entry of entries) {
        const fullPath = path.join(volume1Path, entry);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory() && (await hasWikiContent(fullPath))) {
          // Try matching folder name segments
          const folderKey = folder.replace(/[\/\\]/g, "-").toLowerCase();
          const entryKey = entry.toLowerCase();
          if (
            entryKey.includes(folderKey) ||
            folderKey.includes(entryKey)
          ) {
            return fullPath;
          }
        }
      }
    } catch {
      // volume-1-code doesn't exist yet
    }
  }

  return null;
}

/**
 * Sync genTasks statuses from wiki output directories.
 */
async function syncGenTasks(
  state: WikiState,
  wikiRoot: string,
): Promise<SyncResult> {
  const genTasks = state.genTasks || [];
  const updated: string[] = [];
  const skipped: string[] = [];

  // Count before state
  const before = countStatuses(genTasks);

  for (const task of genTasks) {
    // Only sync tasks that are not already completed or failed
    if (task.status === "completed" || task.status === "failed") {
      skipped.push(`${task.id} (already ${task.status})`);
      continue;
    }

    const wikiDir = await findWikiChapterDir(
      wikiRoot,
      task.wikiChapter,
      task.folder,
    );

    if (wikiDir) {
      task.status = "completed";
      task.wikiChapter = task.wikiChapter || path.basename(wikiDir);
      updated.push(`${task.id} → completed (${path.relative(wikiRoot, wikiDir)})`);
    } else {
      skipped.push(`${task.id} (no wiki output found for ${task.folder})`);
    }
  }

  // Count after state
  const after = countStatuses(genTasks);

  return {
    syncedAt: new Date().toISOString(),
    totalGenTasks: genTasks.length,
    before,
    after,
    updated,
    skipped,
  };
}

function countStatuses(tasks: GenTask[]) {
  return {
    completed: tasks.filter((t) => t.status === "completed").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    pending: tasks.filter((t) => t.status === "pending").length,
    failed: tasks.filter((t) => t.status === "failed").length,
  };
}

// === CLI Entry Point ===

async function main(): Promise<void> {
  const argv = yargs(hideBin(process.argv))
    .option("state", {
      type: "string",
      demandOption: true,
      description: "Path to state.json",
    })
    .option("wiki", {
      type: "string",
      demandOption: true,
      description: "Path to wiki output root directory",
    })
    .option("write", {
      type: "boolean",
      default: false,
      description: "Write updated state.json (default: false, dry-run)",
    })
    .option("output", {
      type: "string",
      description: "Output path for sync report JSON",
    })
    .parseSync();

  const state: WikiState = await fs.readJson(argv.state);
  const wikiRoot = path.resolve(argv.wiki);
  const stateDir = path.dirname(path.resolve(argv.state));

  const result = await syncGenTasks(state, wikiRoot);

  // Write back state.json if --write flag is set
  if (argv.write) {
    await fs.writeJson(argv.state, state, { spaces: 2 });
  }

  // Write report if output specified
  if (argv.output) {
    await fs.outputJson(argv.output, result, { spaces: 2 });
  }

  process.stdout.write(
    `Sync genTasks:\n` +
      `  Before:  ${result.before.completed} completed, ${result.before.pending} pending, ${result.before.failed} failed\n` +
      `  After:   ${result.after.completed} completed, ${result.after.pending} pending, ${result.after.failed} failed\n` +
      `  Updated: ${result.updated.length} tasks\n` +
      `  Skipped: ${result.skipped.length} tasks\n`,
  );

  if (!argv.write) {
    process.stdout.write("\n  [DRY RUN] Use --write to persist changes.\n");
  }

  if (result.updated.length > 0) {
    process.stdout.write("\nUpdated tasks:\n");
    for (const u of result.updated) {
      process.stdout.write(`  ✅ ${u}\n`);
    }
  }
}

const isMainModule =
  process.argv[1]?.endsWith("sync-gen-tasks.ts") ||
  process.argv[1]?.endsWith("sync-gen-tasks.js");
if (isMainModule) main();
