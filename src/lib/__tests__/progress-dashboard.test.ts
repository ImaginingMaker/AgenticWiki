import { describe, it, expect } from "vitest";
import {
  normalizeStatus,
  buildGenTaskLookup,
  resolveSubTaskStatus,
  findFolderMatch,
  buildDashboard,
  renderProgressBar,
  statusEmoji,
  formatNumber,
  pct,
  renderTable,
  renderDashboard,
} from "../gen/progress-dashboard.js";

import type {
  FolderStrategyResult,
  FolderInfo,
  SubTaskInfo,
  GenTask,
  CrossFolderMerge,
} from "../../types/index.js";

import type {
  DashboardRow,
  DashboardStats,
  TaskStatus,
} from "../gen/progress-dashboard.js";

// === Helpers ===

function makeGenTask(overrides: Partial<GenTask> & { id: string }): GenTask {
  return {
    folder: "src/components",
    role: "component",
    status: "pending",
    estimatedTokens: 10000,
    ...overrides,
  };
}

function makeSubTask(
  overrides: Partial<SubTaskInfo> & { id: string },
): SubTaskInfo {
  return {
    label: "Components",
    role: "component",
    files: ["Button.tsx"],
    estimatedTokens: 10000,
    priority: "high",
    ...overrides,
  };
}

function makeFolder(
  overrides: Partial<FolderInfo> & { path: string },
): FolderInfo {
  return {
    fileCount: 10,
    logicFileCount: 8,
    styleFileCount: 2,
    totalTokens: 50000,
    shouldSplit: false,
    reason: "core",
    priority: "high",
    subTasks: [],
    ...overrides,
  };
}

// === normalizeStatus ===

describe("normalizeStatus", () => {
  it('returns "completed" for completed', () => {
    expect(normalizeStatus("completed")).toBe("completed");
  });

  it('returns "in_progress" for in_progress', () => {
    expect(normalizeStatus("in_progress")).toBe("in_progress");
  });

  it('returns "failed" for failed', () => {
    expect(normalizeStatus("failed")).toBe("failed");
  });

  it('returns "pending" for unknown status', () => {
    expect(normalizeStatus("unknown")).toBe("pending");
  });

  it('returns "pending" for empty string', () => {
    expect(normalizeStatus("")).toBe("pending");
  });
});

// === buildGenTaskLookup ===

describe("buildGenTaskLookup", () => {
  it("builds lookup from genTasks array", () => {
    const tasks = [
      makeGenTask({ id: "T1", folder: "src/a" }),
      makeGenTask({ id: "T2", folder: "src/b" }),
    ];
    const lookup = buildGenTaskLookup(tasks);
    expect(lookup.size).toBe(2);
    expect(lookup.get("T1")!.folder).toBe("src/a");
  });

  it("returns empty map for undefined genTasks", () => {
    const lookup = buildGenTaskLookup(undefined);
    expect(lookup.size).toBe(0);
  });

  it("returns empty map for empty array", () => {
    const lookup = buildGenTaskLookup([]);
    expect(lookup.size).toBe(0);
  });
});

// === resolveSubTaskStatus ===

describe("resolveSubTaskStatus", () => {
  it("returns completed when genTask is completed", () => {
    const subTask = makeSubTask({ id: "T1" });
    const lookup = buildGenTaskLookup([
      makeGenTask({ id: "T1", status: "completed", wikiChapter: "ch-01" }),
    ]);
    const result = resolveSubTaskStatus(subTask, "src/a", lookup);
    expect(result.status).toBe("completed");
    expect(result.wikiChapter).toBe("ch-01");
  });

  it("returns pending when genTask not in lookup", () => {
    const subTask = makeSubTask({ id: "T-unknown" });
    const lookup = buildGenTaskLookup([]);
    const result = resolveSubTaskStatus(subTask, "src/a", lookup);
    expect(result.status).toBe("pending");
    expect(result.wikiChapter).toBeUndefined();
  });

  it("returns failed when genTask is failed", () => {
    const subTask = makeSubTask({ id: "T1" });
    const lookup = buildGenTaskLookup([
      makeGenTask({ id: "T1", status: "failed" }),
    ]);
    const result = resolveSubTaskStatus(subTask, "src/a", lookup);
    expect(result.status).toBe("failed");
  });
});

// === findFolderMatch ===

describe("findFolderMatch", () => {
  it("finds genTask by exact folder path", () => {
    const task = makeGenTask({ id: "T1", folder: "src/components" });
    const lookup = buildGenTaskLookup([task]);
    expect(findFolderMatch("src/components", lookup)).toBe(task);
  });

  it("returns undefined when no match", () => {
    const lookup = buildGenTaskLookup([
      makeGenTask({ id: "T1", folder: "src/a" }),
    ]);
    expect(findFolderMatch("src/b", lookup)).toBeUndefined();
  });

  it("returns undefined for empty lookup", () => {
    expect(findFolderMatch("src/a", new Map())).toBeUndefined();
  });
});

// === buildDashboard ===

describe("buildDashboard", () => {
  it("returns empty stats for empty strategy", () => {
    const strategy: FolderStrategyResult = {
      generatedAt: "2024-01-01",
      folders: [],
      totalFolders: 0,
      foldersToAnalyze: 0,
    };
    const result = buildDashboard(strategy, [], "GEN");
    expect(result.rows).toHaveLength(0);
    expect(result.stats.totalSubTasks).toBe(0);
    expect(result.stats.percent).toBe(0);
  });

  it("skips folders with 0 fileCount", () => {
    const strategy: FolderStrategyResult = {
      generatedAt: "2024-01-01",
      folders: [makeFolder({ path: "src/empty", fileCount: 0 })],
      totalFolders: 1,
      foldersToAnalyze: 0,
    };
    const result = buildDashboard(strategy, [], "GEN");
    expect(result.rows).toHaveLength(0);
  });

  it("treats folder without subTasks as single unit", () => {
    const strategy: FolderStrategyResult = {
      generatedAt: "2024-01-01",
      folders: [
        makeFolder({
          path: "src/utils",
          fileCount: 5,
          totalTokens: 20000,
          subTasks: undefined,
        }),
      ],
      totalFolders: 1,
      foldersToAnalyze: 1,
    };
    const result = buildDashboard(strategy, [], "GEN");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].subTaskCount).toBe(1);
    expect(result.rows[0].status).toBe("pending");
  });

  it("marks folder as completed when phase is DONE", () => {
    const strategy: FolderStrategyResult = {
      generatedAt: "2024-01-01",
      folders: [
        makeFolder({
          path: "src/utils",
          fileCount: 5,
          subTasks: undefined,
        }),
      ],
      totalFolders: 1,
      foldersToAnalyze: 1,
    };
    const result = buildDashboard(strategy, [], "DONE");
    expect(result.rows[0].status).toBe("completed");
  });

  it("aggregates subTask statuses correctly", () => {
    const strategy: FolderStrategyResult = {
      generatedAt: "2024-01-01",
      folders: [
        makeFolder({
          path: "src/components",
          fileCount: 10,
          totalTokens: 50000,
          subTasks: [
            makeSubTask({ id: "T1", label: "Button" }),
            makeSubTask({ id: "T2", label: "Input" }),
            makeSubTask({ id: "T3", label: "Modal" }),
          ],
        }),
      ],
      totalFolders: 1,
      foldersToAnalyze: 1,
    };
    const genTasks = [
      makeGenTask({ id: "T1", status: "completed" }),
      makeGenTask({ id: "T2", status: "in_progress" }),
      makeGenTask({ id: "T3", status: "pending" }),
    ];
    const result = buildDashboard(strategy, genTasks, "GEN");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].completedCount).toBe(1);
    expect(result.rows[0].inProgressCount).toBe(1);
    expect(result.rows[0].pendingCount).toBe(1);
    expect(result.rows[0].status).toBe("in_progress");
    expect(result.stats.percent).toBe(33);
  });

  it("sets folder status to failed when any subTask failed", () => {
    const strategy: FolderStrategyResult = {
      generatedAt: "2024-01-01",
      folders: [
        makeFolder({
          path: "src/broken",
          fileCount: 3,
          totalTokens: 15000,
          subTasks: [
            makeSubTask({ id: "T1", label: "A" }),
            makeSubTask({ id: "T2", label: "B" }),
          ],
        }),
      ],
      totalFolders: 1,
      foldersToAnalyze: 1,
    };
    const genTasks = [
      makeGenTask({ id: "T1", status: "completed" }),
      makeGenTask({ id: "T2", status: "failed" }),
    ];
    const result = buildDashboard(strategy, genTasks, "GEN");
    expect(result.rows[0].status).toBe("failed");
  });

  it("includes cross-folder merges", () => {
    const strategy: FolderStrategyResult = {
      generatedAt: "2024-01-01",
      folders: [
        makeFolder({
          path: "src/components",
          fileCount: 5,
          subTasks: [makeSubTask({ id: "T1", label: "Button" })],
        }),
      ],
      totalFolders: 1,
      foldersToAnalyze: 1,
      crossFolderMerges: [
        {
          id: "M1",
          label: "Global Styles",
          folders: ["src/a", "src/b"],
          files: ["global.css"],
          estimatedTokens: 5000,
          wikiChapter: "ch-global",
          priority: "P1" as any,
        },
      ],
    };
    const genTasks = [
      makeGenTask({ id: "T1", status: "completed" }),
      makeGenTask({ id: "M1", status: "completed", wikiChapter: "ch-global" }),
    ];
    const result = buildDashboard(strategy, genTasks, "GEN");
    expect(result.rows).toHaveLength(2);
    const mergeRow = result.rows.find((r) => r.folder.includes("全局"));
    expect(mergeRow).toBeDefined();
    expect(mergeRow!.status).toBe("completed");
  });

  it("sorts rows: failed first, then in_progress, pending, completed", () => {
    const strategy: FolderStrategyResult = {
      generatedAt: "2024-01-01",
      folders: [
        makeFolder({
          path: "src/completed",
          fileCount: 1,
          subTasks: [],
          shouldSplit: false,
          reason: "a",
          priority: "high",
        }),
        makeFolder({
          path: "src/pending",
          fileCount: 1,
          subTasks: [],
          shouldSplit: false,
          reason: "a",
          priority: "high",
        }),
        makeFolder({
          path: "src/failed",
          fileCount: 1,
          subTasks: [],
          shouldSplit: false,
          reason: "a",
          priority: "high",
        }),
      ],
      totalFolders: 3,
      foldersToAnalyze: 3,
    };
    // Force different statuses: match folder names to get different statuses
    // Folder without subTasks + empty genTasks → pending for GEN, completed for DONE
    // Make failed folders by having a subtask with failed status
    const strategy2: FolderStrategyResult = {
      generatedAt: "2024-01-01",
      folders: [
        makeFolder({
          path: "src/failed",
          fileCount: 1,
          totalTokens: 1000,
          subTasks: [makeSubTask({ id: "F1", label: "Fail" })],
          shouldSplit: false,
          reason: "a",
          priority: "high",
        }),
        makeFolder({
          path: "src/in-progress",
          fileCount: 1,
          totalTokens: 1000,
          subTasks: [makeSubTask({ id: "P1", label: "InProgress" })],
          shouldSplit: false,
          reason: "a",
          priority: "high",
        }),
        makeFolder({
          path: "src/pending",
          fileCount: 1,
          totalTokens: 1000,
          subTasks: [makeSubTask({ id: "P2", label: "Pending" })],
          shouldSplit: false,
          reason: "a",
          priority: "high",
        }),
        makeFolder({
          path: "src/done",
          fileCount: 1,
          totalTokens: 1000,
          subTasks: [makeSubTask({ id: "D1", label: "Done" })],
          shouldSplit: false,
          reason: "a",
          priority: "high",
        }),
      ],
      totalFolders: 4,
      foldersToAnalyze: 4,
    };
    const genTasks = [
      makeGenTask({ id: "F1", status: "failed" }),
      makeGenTask({ id: "P1", status: "in_progress" }),
      // P2 has no genTask → pending
      makeGenTask({ id: "D1", status: "completed" }),
    ];
    const result = buildDashboard(strategy2, genTasks, "GEN");
    expect(result.rows.map((r) => r.status)).toEqual([
      "failed",
      "in_progress",
      "pending",
      "completed",
    ]);
  });

  it("tracks wikiChapters from completed genTasks", () => {
    const strategy: FolderStrategyResult = {
      generatedAt: "2024-01-01",
      folders: [
        makeFolder({
          path: "src/components",
          fileCount: 5,
          totalTokens: 30000,
          subTasks: [makeSubTask({ id: "T1", label: "Button" })],
        }),
      ],
      totalFolders: 1,
      foldersToAnalyze: 1,
    };
    const genTasks = [
      makeGenTask({
        id: "T1",
        status: "completed",
        wikiChapter: "ch-01-components",
      }),
    ];
    const result = buildDashboard(strategy, genTasks, "GEN");
    expect(result.rows[0].wikiChapters).toContain("ch-01-components");
  });
});

// === renderProgressBar ===

describe("renderProgressBar", () => {
  it("renders full bar for 100%", () => {
    expect(renderProgressBar(100, 10)).toBe("██████████");
  });

  it("renders empty bar for 0%", () => {
    expect(renderProgressBar(0, 10)).toBe("░░░░░░░░░░");
  });

  it("renders half bar for 50%", () => {
    expect(renderProgressBar(50, 10)).toBe("█████░░░░░");
  });

  it("uses default width of 40", () => {
    const result = renderProgressBar(25);
    expect(result).toHaveLength(40);
    expect(result.split("█")).toHaveLength(11); // 10 filled
  });
});

// === statusEmoji ===

describe("statusEmoji", () => {
  it("returns ✅ for completed", () =>
    expect(statusEmoji("completed")).toBe("✅"));
  it("returns 🔄 for in_progress", () =>
    expect(statusEmoji("in_progress")).toBe("🔄"));
  it("returns ⏳ for pending", () => expect(statusEmoji("pending")).toBe("⏳"));
  it("returns ❌ for failed", () => expect(statusEmoji("failed")).toBe("❌"));
});

// === formatNumber ===

describe("formatNumber", () => {
  it("formats with en-US locale", () => {
    expect(formatNumber(1000)).toBe("1,000");
  });

  it("handles small numbers", () => {
    expect(formatNumber(42)).toBe("42");
  });

  it("handles large numbers", () => {
    expect(formatNumber(1000000)).toBe("1,000,000");
  });
});

// === pct ===

describe("pct", () => {
  it("returns — for total=0", () => {
    expect(pct(5, 0)).toBe("—");
  });

  it("computes percentage", () => {
    expect(pct(5, 10)).toBe("50%");
  });

  it("rounds to one decimal", () => {
    expect(pct(1, 3)).toBe("33.3%");
  });
});

// === renderTable ===

describe("renderTable", () => {
  it("renders header and row", () => {
    const rows: DashboardRow[] = [
      {
        folder: "src/utils",
        fileCount: 5,
        estimatedTokens: 20000,
        subTaskCount: 2,
        completedCount: 1,
        inProgressCount: 0,
        pendingCount: 1,
        failedCount: 0,
        wikiChapters: ["ch-01"],
        status: "pending",
      },
    ];
    const result = renderTable(rows);
    expect(result[0]).toContain("文件夹");
    expect(result[0]).toContain("文件数");
    expect(result[1]).toContain("--------");
    expect(result.some((l) => l.includes("src/utils"))).toBe(true);
    expect(result.some((l) => l.includes("20,000"))).toBe(true);
  });
});

// === renderDashboard ===

describe("renderDashboard", () => {
  it("renders header with phase and project", () => {
    const rows: DashboardRow[] = [];
    const stats: DashboardStats = {
      totalFolders: 0,
      totalSubTasks: 0,
      completed: 0,
      inProgress: 0,
      pending: 0,
      failed: 0,
      percent: 0,
    };
    const result = renderDashboard(rows, stats, "GEN", "/my/project");
    expect(result).toContain("📊 Wiki 分析进度");
    expect(result).toContain("my/project");
    expect(result).toContain("GEN");
  });

  it("includes progress bar in output", () => {
    const rows: DashboardRow[] = [];
    const stats: DashboardStats = {
      totalFolders: 0,
      totalSubTasks: 0,
      completed: 0,
      inProgress: 0,
      pending: 0,
      failed: 0,
      percent: 0,
    };
    const result = renderDashboard(rows, stats, "GEN", "/p");
    expect(result).toContain("░░░");
    expect(result).toContain("0%");
  });

  it("renders completed summary when DONE", () => {
    const rows: DashboardRow[] = [
      {
        folder: "src/x",
        fileCount: 1,
        estimatedTokens: 1000,
        subTaskCount: 1,
        completedCount: 1,
        inProgressCount: 0,
        pendingCount: 0,
        failedCount: 0,
        wikiChapters: [],
        status: "completed",
      },
    ];
    const stats: DashboardStats = {
      totalFolders: 1,
      totalSubTasks: 1,
      completed: 1,
      inProgress: 0,
      pending: 0,
      failed: 0,
      percent: 100,
    };
    const result = renderDashboard(rows, stats, "DONE", "/p");
    expect(result).toContain("全部完成");
    expect(result).toContain("所有文件夹分析完毕");
  });

  it("renders failed warning when failures exist", () => {
    const rows: DashboardRow[] = [
      {
        folder: "src/x",
        fileCount: 1,
        estimatedTokens: 1000,
        subTaskCount: 1,
        completedCount: 0,
        inProgressCount: 0,
        pendingCount: 0,
        failedCount: 1,
        wikiChapters: [],
        status: "failed",
      },
    ];
    const stats: DashboardStats = {
      totalFolders: 1,
      totalSubTasks: 1,
      completed: 0,
      inProgress: 0,
      pending: 0,
      failed: 1,
      percent: 0,
    };
    const result = renderDashboard(rows, stats, "GEN", "/p");
    expect(result).toContain("有 1 个子任务失败");
  });

  it("renders sections grouped by status", () => {
    const rows: DashboardRow[] = [
      {
        folder: "src/a",
        fileCount: 1,
        estimatedTokens: 1000,
        subTaskCount: 1,
        completedCount: 1,
        inProgressCount: 0,
        pendingCount: 0,
        failedCount: 0,
        wikiChapters: [],
        status: "completed",
      },
      {
        folder: "src/b",
        fileCount: 1,
        estimatedTokens: 1000,
        subTaskCount: 1,
        completedCount: 0,
        inProgressCount: 1,
        pendingCount: 0,
        failedCount: 0,
        wikiChapters: [],
        status: "in_progress",
      },
    ];
    const stats: DashboardStats = {
      totalFolders: 2,
      totalSubTasks: 2,
      completed: 1,
      inProgress: 1,
      pending: 0,
      failed: 0,
      percent: 50,
    };
    const result = renderDashboard(rows, stats, "GEN", "/p");
    expect(result).toContain("进行中（1）");
    expect(result).toContain("已完成（1）");
  });
});
