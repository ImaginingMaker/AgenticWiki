/**
 * Sync genTasks — 根据 Wiki 产物目录自动更新 state.json.genTasks 状态。
 *
 * 问题：编排器 Agent 常遗漏手动 edit_file 更新 genTasks，
 *       导致 progress-dashboard.ts 始终显示 0%。
 * 解决：此脚本扫描 wiki 输出目录，自动将对应 genTask 标记为 completed。
 *
 * 新增 --strict 模式：同步前先检查 Wiki 中引用的 Issue 是否有对应独立文件，
 *   若有 orphaned Issue，则不标记为 completed。防止手动生成的 Wiki 漏掉 Issue 文件。
 *
 * Usage:
 *   npx tsx src/lib/sync-gen-tasks.ts \
 *     --state .agentic-wiki/state.json \
 *     --wiki  wiki/ \
 *     [--write]         # 写入 state.json（默认 dry-run）
 *     [--strict]        # Issue 文件不完整时不标记 completed
 *     [--output file]   # 输出同步报告 JSON
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { atomicUpdate } from "../shared/state-manager.js";
import type { WikiState, GenTask } from "../types/index.js";

// === Types ===

interface SyncResult {
  syncedAt: string;
  totalGenTasks: number;
  before: {
    completed: number;
    inProgress: number;
    pending: number;
    failed: number;
  };
  after: {
    completed: number;
    inProgress: number;
    pending: number;
    failed: number;
  };
  updated: string[];
  skipped: string[];
  /** Only populated in --strict mode: tasks skipped due to missing Issue files */
  strictBlocked?: string[];
}

// === Core Logic ===

/**
 * Check if a wiki directory has actual content (non-empty markdown files).
 */
export async function hasWikiContent(wikiDir: string): Promise<boolean> {
  try {
    const exists = await fs.pathExists(wikiDir);
    if (!exists) return false;

    const files = await fs.readdir(wikiDir);
    return files.some((f) => f.endsWith(".md"));
  } catch {
    return false;
  }
}

/**
 * Find the wiki chapter directory for a genTask.
 */
export async function findWikiChapterDir(
  wikiRoot: string,
  wikiChapter: string | undefined,
  folder: string,
): Promise<string | null> {
  if (wikiChapter) {
    const wikiFilePath = path.join(wikiRoot, "volume-1-code", wikiChapter);
    // If wikiChapter contains a path separator, it's a specific file path
    // Check for the exact file, not just the directory
    if (wikiChapter.includes("/")) {
      if (await fs.pathExists(wikiFilePath)) {
        return path.dirname(wikiFilePath);
      }
      // Specific file not found → don't return a match
      return null;
    }
    // No path separator → it's a chapter directory, check dir content
    if (await hasWikiContent(wikiFilePath)) {
      return wikiFilePath;
    }
  }

  if (folder) {
    const volume1Path = path.join(wikiRoot, "volume-1-code");
    try {
      const entries = await fs.readdir(volume1Path);
      for (const entry of entries) {
        const fullPath = path.join(volume1Path, entry);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory() && (await hasWikiContent(fullPath))) {
          const folderKey = folder.replace(/[\/\\]/g, "_").toLowerCase();
          // Chapter names follow pattern: ch-{folder_with_underscores}
          // e.g., desktop/src/main → ch-desktop_src_main
          const entryKey = entry.replace(/^ch-/, "").toLowerCase();
          if (entryKey === folderKey) {
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

// === Strict Mode: Issue File Completeness Check ===

/** Regex to extract IS-NNNN-SEVERITY patterns from Wiki markdown */
const ISSUE_ID_RE = /\bIS-(\d{3,5})-(CRITICAL|HIGH|MEDIUM|LOW)/g;

/**
 * Recursively find all IS-*.md files under a directory.
 */
export async function findIssueFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        const subResults = await findIssueFiles(fullPath);
        results.push(...subResults);
      } else if (
        entry.isFile() &&
        entry.name.startsWith("IS-") &&
        entry.name.endsWith(".md")
      ) {
        results.push(entry.name);
      }
    }
  } catch {
    // directory doesn't exist
  }
  return results;
}

/**
 * Check if a Wiki directory's markdown files reference Issue IDs
 * that don't have corresponding files in volume-2-issues/.
 */
export async function checkIssueCompleteness(
  wikiDir: string,
  wikiRoot: string,
): Promise<string[]> {
  const orphaned: string[] = [];
  const issuesRoot = path.join(wikiRoot, "volume-2-issues");

  // Build index of existing Issue files
  const issueFilenameSet = new Set<string>();
  try {
    const issueFiles = await findIssueFiles(issuesRoot);
    for (const filename of issueFiles) {
      // Match IS-NNNN-SEVERITY pattern from filename (e.g. IS-0001-CRITICAL.md → IS-0001-CRITICAL)
      const severityMatch = filename.match(
        /^(IS-\d{3,5}-(?:CRITICAL|HIGH|MEDIUM|LOW))/,
      );
      if (severityMatch) issueFilenameSet.add(severityMatch[1]);
    }
  } catch {
    // volume-2-issues doesn't exist
  }

  // Scan Wiki markdown files for Issue references
  try {
    const entries = await fs.readdir(wikiDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const content = await fs.readFile(path.join(wikiDir, entry), "utf-8");

      // Extract all Issue IDs
      ISSUE_ID_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      const seenIds = new Set<string>();
      while ((match = ISSUE_ID_RE.exec(content)) !== null) {
        // Only check IDs matching IS-YYYY-NNN (not per-component suffixes)
        const rootId = match[0];
        if (/^IS-\d{3,5}-(?:CRITICAL|HIGH|MEDIUM|LOW)$/.test(rootId)) {
          seenIds.add(rootId);
        }
      }

      for (const id of seenIds) {
        if (!issueFilenameSet.has(id)) {
          orphaned.push(id);
        }
      }
    }
  } catch {
    // Can't read wiki dir
  }

  return orphaned;
}

/**
 * Sync genTasks statuses from wiki output directories.
 */
export async function syncGenTasks(
  state: WikiState,
  wikiRoot: string,
  strict = false,
): Promise<SyncResult> {
  const genTasks = state.genTasks || [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const strictBlocked: string[] = [];

  const before = countStatuses(genTasks);

  for (const task of genTasks) {
    if (task.status === "completed" || task.status === "failed") {
      skipped.push(`${task.id} (already ${task.status})`);
      continue;
    }

    const wikiDir = await findWikiChapterDir(
      wikiRoot,
      task.wikiChapter,
      task.folder,
    );

    if (!wikiDir) {
      skipped.push(`${task.id} (no wiki output found for ${task.folder})`);
      continue;
    }

    // Strict mode: check Issue file completeness before marking completed
    if (strict) {
      const orphaned = await checkIssueCompleteness(wikiDir, wikiRoot);
      if (orphaned.length > 0) {
        strictBlocked.push(`${task.id} (orphaned: ${orphaned.join(", ")})`);
        skipped.push(
          `${task.id} (strict: missing Issue files: ${orphaned.join(", ")})`,
        );
        continue;
      }
    }

    task.status = "completed";
    task.wikiChapter = task.wikiChapter || path.basename(wikiDir);
    updated.push(
      `${task.id} -> completed (${path.relative(wikiRoot, wikiDir)})`,
    );
  }

  const after = countStatuses(genTasks);

  return {
    syncedAt: new Date().toISOString(),
    totalGenTasks: genTasks.length,
    before,
    after,
    updated,
    skipped,
    ...(strictBlocked.length > 0 ? { strictBlocked } : {}),
  };
}

export function countStatuses(tasks: GenTask[]) {
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
    .option("strict", {
      type: "boolean",
      default: false,
      description: "Block sync if Issue files are missing for referenced IDs",
    })
    .option("output", {
      type: "string",
      description: "Output path for sync report JSON",
    })
    .option("init-from-schedule", {
      type: "string",
      description:
        "Path to gen-schedule.json to initialize genTasks if missing",
    })
    .parseSync();

  const state: WikiState = await fs.readJson(argv.state);

  // Initialize genTasks from gen-schedule.json if missing
  if (
    (!state.genTasks || state.genTasks.length === 0) &&
    argv["init-from-schedule"]
  ) {
    const schedulePath = argv["init-from-schedule"];
    const schedule = await fs.readJson(schedulePath);
    const allEntries = [...(schedule.schedule || []), ...(schedule.skip || [])];

    state.genTasks = allEntries.map((entry: any) => ({
      id: entry.id,
      folder: entry.folder,
      role: entry.role,
      status: entry.action === "skip" ? "completed" : "pending",
      estimatedTokens: entry.estimatedTokens,
      wikiChapter: entry.wikiChapter,
    }));

    process.stdout.write(
      `Initialized ${state.genTasks.length} genTasks from ${schedulePath}\n`,
    );
  }
  const wikiRoot = path.resolve(argv.wiki);
  const strict = argv.strict === true;

  const result = await syncGenTasks(state, wikiRoot, strict);

  if (argv.write) {
    // Use atomicUpdate for lock + backup + atomic write safety
    const updatedGenTasks = state.genTasks;
    await atomicUpdate(argv.state, (current) => ({
      ...current,
      genTasks: updatedGenTasks,
    }));
  }

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

  // Report strict mode blocks
  if (result.strictBlocked && result.strictBlocked.length > 0) {
    process.stdout.write(`\n  Strict blocked (missing Issue files):\n`);
    for (const b of result.strictBlocked) {
      process.stdout.write(`    Blocked: ${b}\n`);
    }
  }

  if (!argv.write) {
    process.stdout.write("\n  [DRY RUN] Use --write to persist changes.\n");
  }

  if (result.updated.length > 0) {
    process.stdout.write("\nUpdated tasks:\n");
    for (const u of result.updated) {
      process.stdout.write(`  OK: ${u}\n`);
    }
  }
}

const isMainModule =
  process.argv[1]?.endsWith("sync-gen-tasks.ts") ||
  process.argv[1]?.endsWith("sync-gen-tasks.js");
if (isMainModule) main();
