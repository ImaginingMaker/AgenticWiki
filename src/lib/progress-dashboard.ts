/**
 * Progress Dashboard — 生成 Wiki 分析进度面板。
 *
 * 交叉比对 folder-strategy.json（所有待分析文件夹）与 state.json（已完成子任务），
 * 渲染为 wiki/PROGRESS.md，让用户一眼看到分析进度。
 *
 * Usage:
 *   npx tsx src/lib/progress-dashboard.ts \
 *     --state    .agentic-wiki/state.json \
 *     --strategy .agentic-wiki/cache/folder-strategy.json \
 *     --output   wiki/PROGRESS.md
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type {
  WikiState,
  FolderStrategyResult,
  FolderInfo,
  SubTaskInfo,
  GenTask,
  Phase,
} from "../types/index.js";
import { subTaskIdEquals, sanitizePathId } from "./id-utils.js";

// === Types ===

type TaskStatus = "completed" | "in_progress" | "pending" | "failed";

interface DashboardRow {
  folder: string;
  fileCount: number;
  estimatedTokens: number;
  subTaskCount: number;
  completedCount: number;
  inProgressCount: number;
  pendingCount: number;
  failedCount: number;
  wikiChapters: string[];
  status: TaskStatus;
}

interface DashboardStats {
  totalFolders: number;
  totalSubTasks: number;
  completed: number;
  inProgress: number;
  pending: number;
  failed: number;
  percent: number;
}

// === Core Logic ===

/**
 * Build a lookup table from genTasks for quick status queries.
 * Key = `${folder}::${subTaskId}`, but since genTasks use their own id,
 * we match by folder + role to link with folder-strategy subTasks.
 */
function buildGenTaskLookup(
  genTasks: GenTask[] | undefined,
): Map<string, GenTask> {
  const lookup = new Map<string, GenTask>();
  if (!genTasks) return lookup;
  for (const task of genTasks) {
    // Store by genTask.id for exact match（类型安全桥接）
    lookup.set(task.id, task);
  }
  return lookup;
}

/**
 * Match a subTask from folder-strategy against genTasks to determine its status.
 */
function resolveSubTaskStatus(
  subTask: SubTaskInfo,
  _folderPath: string,
  genTaskLookup: Map<string, GenTask>,
): { status: TaskStatus; wikiChapter?: string } {
  // 精确 ID 匹配（subTask.id 和 genTask.id 由同一函数 generateSubTaskId 生成）
  const match = genTaskLookup.get(subTask.id);
  if (match) {
    return {
      status: normalizeStatus(match.status),
      wikiChapter: match.wikiChapter,
    };
  }
  // No match → pending
  return { status: "pending" };
}

function normalizeStatus(raw: string): TaskStatus {
  switch (raw) {
    case "completed":
      return "completed";
    case "in_progress":
      return "in_progress";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

/**
 * Build dashboard rows by cross-referencing folder-strategy with genTasks.
 */
function buildDashboard(
  strategy: FolderStrategyResult,
  genTasks: GenTask[] | undefined,
  currentPhase: Phase,
): { rows: DashboardRow[]; stats: DashboardStats } {
  const genTaskLookup = buildGenTaskLookup(genTasks);
  const rows: DashboardRow[] = [];

  let totalSubTaskCount = 0;
  let totalCompleted = 0;
  let totalInProgress = 0;
  let totalPending = 0;
  let totalFailed = 0;

  for (const folder of strategy.folders) {
    if (folder.fileCount === 0) continue;

    const subTasks = folder.subTasks || [];
    if (subTasks.length === 0) {
      // Folder without subTasks — treated as a single unit.
      // Check if genTasks has a matching entry.
      const folderOnlyMatch = findFolderMatch(folder.path, genTaskLookup);
      const status = folderOnlyMatch
        ? normalizeStatus(folderOnlyMatch.status)
        : currentPhase === "DONE"
          ? "completed"
          : "pending";

      totalSubTaskCount += 1;
      incrementStatus(status);

      rows.push({
        folder: folder.path || ".",
        fileCount: folder.fileCount,
        estimatedTokens: folder.totalTokens || 0,
        subTaskCount: 1,
        completedCount: status === "completed" ? 1 : 0,
        inProgressCount: status === "in_progress" ? 1 : 0,
        pendingCount: status === "pending" ? 1 : 0,
        failedCount: status === "failed" ? 1 : 0,
        wikiChapters: folderOnlyMatch?.wikiChapter
          ? [folderOnlyMatch.wikiChapter]
          : [],
        status,
      });
      continue;
    }

    // Folder with subTasks
    let completed = 0;
    let inProgress = 0;
    let pending = 0;
    let failed = 0;
    const wikiChapters: string[] = [];

    for (const subTask of subTasks) {
      const resolved = resolveSubTaskStatus(
        subTask,
        folder.path,
        genTaskLookup,
      );
      switch (resolved.status) {
        case "completed":
          completed++;
          break;
        case "in_progress":
          inProgress++;
          break;
        case "failed":
          failed++;
          break;
        default:
          pending++;
      }
      if (resolved.wikiChapter) {
        wikiChapters.push(resolved.wikiChapter);
      }
    }

    totalSubTaskCount += subTasks.length;
    totalCompleted += completed;
    totalInProgress += inProgress;
    totalPending += pending;
    totalFailed += failed;

    // Determine folder-level status
    let folderStatus: TaskStatus;
    if (failed > 0) {
      folderStatus = "failed";
    } else if (inProgress > 0) {
      folderStatus = "in_progress";
    } else if (pending > 0) {
      folderStatus = "pending";
    } else {
      folderStatus = "completed";
    }

    rows.push({
      folder: folder.path || ".",
      fileCount: folder.fileCount,
      estimatedTokens: folder.totalTokens || 0,
      subTaskCount: subTasks.length,
      completedCount: completed,
      inProgressCount: inProgress,
      pendingCount: pending,
      failedCount: failed,
      wikiChapters,
      status: folderStatus,
    });
  }

  // Cross-folder merges
  if (strategy.crossFolderMerges && strategy.crossFolderMerges.length > 0) {
    for (const merge of strategy.crossFolderMerges) {
      const match = genTaskLookup.get(merge.id);
      const status = match
        ? normalizeStatus(match.status)
        : currentPhase === "DONE"
          ? "completed"
          : "pending";

      totalSubTaskCount += 1;
      incrementStatus(status);

      rows.push({
        folder: `🌐 全局: ${merge.label}`,
        fileCount: merge.files.length,
        estimatedTokens: merge.estimatedTokens,
        subTaskCount: 1,
        completedCount: status === "completed" ? 1 : 0,
        inProgressCount: status === "in_progress" ? 1 : 0,
        pendingCount: status === "pending" ? 1 : 0,
        failedCount: status === "failed" ? 1 : 0,
        wikiChapters: merge.wikiChapter ? [merge.wikiChapter] : [],
        status,
      });
    }
  }

  // Sort: failed first, then in_progress, then pending, then completed
  const statusOrder: Record<TaskStatus, number> = {
    failed: 0,
    in_progress: 1,
    pending: 2,
    completed: 3,
  };
  rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  function incrementStatus(s: TaskStatus): void {
    switch (s) {
      case "completed":
        totalCompleted++;
        break;
      case "in_progress":
        totalInProgress++;
        break;
      case "failed":
        totalFailed++;
        break;
      default:
        totalPending++;
    }
  }

  const percent =
    totalSubTaskCount > 0
      ? Math.round((totalCompleted / totalSubTaskCount) * 100)
      : 0;

  return {
    rows,
    stats: {
      totalFolders: strategy.foldersToAnalyze,
      totalSubTasks: totalSubTaskCount,
      completed: totalCompleted,
      inProgress: totalInProgress,
      pending: totalPending,
      failed: totalFailed,
      percent,
    },
  };
}

function findFolderMatch(
  folderPath: string,
  lookup: Map<string, GenTask>,
): GenTask | undefined {
  // Try direct match by genTask.id prefix
  for (const [, task] of lookup) {
    if (
      task.folder === folderPath ||
      task.id.startsWith(sanitizePathId(folderPath))
    ) {
      return task;
    }
  }
  return undefined;
}

// === Renderer ===

function renderProgressBar(percent: number, width: number = 40): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function statusEmoji(status: TaskStatus): string {
  switch (status) {
    case "completed":
      return "✅";
    case "in_progress":
      return "🔄";
    case "pending":
      return "⏳";
    case "failed":
      return "❌";
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function renderDashboard(
  rows: DashboardRow[],
  stats: DashboardStats,
  currentPhase: Phase,
  projectPath: string,
): string {
  const now = new Date().toISOString();
  const phaseLabel = currentPhase === "DONE" ? "✅ 全部完成" : currentPhase;

  // Group rows by status
  const completedRows = rows.filter((r) => r.status === "completed");
  const inProgressRows = rows.filter((r) => r.status === "in_progress");
  const pendingRows = rows.filter((r) => r.status === "pending");
  const failedRows = rows.filter((r) => r.status === "failed");

  const lines: string[] = [
    "---",
    `generated_at: "${now}"`,
    `project: "${projectPath}"`,
    `phase: "${currentPhase}"`,
    "---",
    "",
    "# 📊 Wiki 分析进度",
    "",
    `> **项目**: \`${path.basename(projectPath || "unknown")}\`,`,
    `> **模式**: 全量分析`,
    `> **当前阶段**: ${phaseLabel}`,
    `> **最后更新**: ${now.replace("T", " ").slice(0, 19)}`,
    "",
    "## 总体进度",
    "",
    "| 状态 | 数量 | 占比 |",
    "|------|------|------|",
  ];

  const total = stats.totalSubTasks;
  if (total > 0) {
    lines.push(
      `| ${statusEmoji("completed")} 已完成 | ${stats.completed} | ${pct(stats.completed, total)} |`,
      `| ${statusEmoji("in_progress")} 进行中 | ${stats.inProgress} | ${pct(stats.inProgress, total)} |`,
      `| ${statusEmoji("pending")} 待处理 | ${stats.pending} | ${pct(stats.pending, total)} |`,
      `| ${statusEmoji("failed")} 失败 | ${stats.failed} | ${pct(stats.failed, total)} |`,
      `| **合计** | **${total}** | **100%** |`,
    );
  } else {
    lines.push("| — | 0 | — |");
  }

  lines.push(
    "",
    "```",
    `${renderProgressBar(stats.percent)}  ${stats.percent}%`,
    "```",
    "",
    "## 文件夹详情",
    "",
  );

  // Failed section
  if (failedRows.length > 0) {
    lines.push(
      `### ❌ 失败（${failedRows.length}）`,
      "",
      ...renderTable(failedRows),
    );
  }

  // In Progress section
  if (inProgressRows.length > 0) {
    lines.push(
      `### 🔄 进行中（${inProgressRows.length}）`,
      "",
      ...renderTable(inProgressRows),
    );
  }

  // Pending section
  if (pendingRows.length > 0) {
    lines.push(
      `### ⏳ 待处理（${pendingRows.length}）`,
      "",
      ...renderTable(pendingRows),
    );
  }

  // Completed section
  if (completedRows.length > 0) {
    lines.push(
      `### ✅ 已完成（${completedRows.length}）`,
      "",
      ...renderTable(completedRows),
    );
  }

  lines.push(
    "",
    "---",
    "",
    `> 💡 此文件由 \`progress-dashboard.ts\` 自动生成，每次阶段切换时更新。`,
  );

  if (
    currentPhase === "DONE" &&
    stats.pending === 0 &&
    stats.inProgress === 0 &&
    stats.failed === 0
  ) {
    lines.push("> 🎉 **所有文件夹分析完毕！项目 Wiki 已生成。**");
  } else if (stats.failed > 0) {
    lines.push(`> ⚠️ 有 ${stats.failed} 个子任务失败，请检查错误日志后重试。`);
  } else {
    lines.push(
      `> 📍 继续执行编排器即可从断点恢复。已完成 ${stats.completed}/${total} 个子任务。`,
    );
  }

  return lines.join("\n") + "\n";
}

function pct(value: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((value / total) * 100 * 10) / 10}%`;
}

function renderTable(rows: DashboardRow[]): string[] {
  const lines: string[] = [];
  lines.push(
    "| 文件夹 | 文件数 | Token | 子任务 | 完成 | 进度 |",
    "|--------|--------|-------|--------|------|------|",
  );

  for (const row of rows) {
    const done = row.completedCount;
    const all = row.subTaskCount;
    const progress =
      all > 0
        ? `${statusEmoji(row.status)} ${done}/${all} ${renderProgressBar(Math.round((done / all) * 100), 10)}`
        : statusEmoji(row.status);

    const name =
      row.folder.length > 40 ? "..." + row.folder.slice(-37) : row.folder;

    lines.push(
      `| \`${name}\` | ${row.fileCount} | ${formatNumber(row.estimatedTokens)} | ${row.subTaskCount} | ${done} | ${progress} |`,
    );
  }

  return lines;
}

// === CLI Entry Point ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("state", {
      type: "string",
      demandOption: true,
      description: "Path to state.json",
    })
    .option("strategy", {
      type: "string",
      demandOption: true,
      description: "Path to folder-strategy.json",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      description: "Output path for PROGRESS.md",
    })
    .parseSync();

  // Read inputs
  const state: WikiState = await fs.readJson(argv.state);
  const strategy: FolderStrategyResult = await fs.readJson(argv.strategy);

  const { rows, stats } = buildDashboard(
    strategy,
    state.genTasks,
    state.currentPhase,
  );

  const markdown = renderDashboard(
    rows,
    stats,
    state.currentPhase,
    state.projectPath || (state as any).projectRoot || "",
  );

  await fs.outputFile(argv.output, markdown, "utf-8");

  const phaseLabel =
    state.currentPhase === "DONE" ? "全部完成" : state.currentPhase;
  process.stdout.write(
    `Progress dashboard: ${stats.completed}/${stats.totalSubTasks} sub-tasks completed (${stats.percent}%)\n` +
      `  Phase: ${phaseLabel}\n` +
      `  Failed: ${stats.failed}\n` +
      `Written to ${argv.output}\n`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("progress-dashboard.ts") ||
  process.argv[1]?.endsWith("progress-dashboard.js");
if (isMainModule) main();
