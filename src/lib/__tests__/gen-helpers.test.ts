import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  propagateDeps,
  markAffectedGenTasks,
  injectFeedbackIntoPrompts,
} from "../pipeline/gen-helpers";
import type {
  DependencyGraphResult,
  ModuleInfo,
  FolderStrategyResult,
} from "../types/index";

// ─── propagateDeps (pure function, no mocking needed) ────────────────

describe("propagateDeps", () => {
  const makeDepGraph = (modules: ModuleInfo[]): DependencyGraphResult => ({
    generatedAt: "2025-01-01T00:00:00.000Z",
    modules,
    cycles: [],
    hotspots: { mostDepended: [], mostDependent: [] },
  });

  it("returns the changed files when there are no dependents", () => {
    const graph = makeDepGraph([
      {
        source: "src/a.ts",
        dependencies: [],
        dependents: [],
        hasCircular: false,
      },
      {
        source: "src/b.ts",
        dependencies: [],
        dependents: [],
        hasCircular: false,
      },
    ]);
    const result = propagateDeps(["src/a.ts"], graph);
    expect([...result]).toEqual(["src/a.ts"]);
  });

  it("propagates one level of dependents", () => {
    const graph = makeDepGraph([
      {
        source: "src/utils.ts",
        dependencies: [],
        dependents: ["src/a.ts"],
        hasCircular: false,
      },
      {
        source: "src/a.ts",
        dependencies: [
          { resolved: "src/utils.ts", type: "local", circular: false },
        ],
        dependents: [],
        hasCircular: false,
      },
    ]);
    const result = propagateDeps(["src/utils.ts"], graph);
    expect([...result]).toEqual(["src/utils.ts", "src/a.ts"]);
  });

  it("propagates transitively (BFS) through multiple levels", () => {
    const graph = makeDepGraph([
      {
        source: "src/utils.ts",
        dependencies: [],
        dependents: ["src/a.ts"],
        hasCircular: false,
      },
      {
        source: "src/a.ts",
        dependencies: [
          { resolved: "src/utils.ts", type: "local", circular: false },
        ],
        dependents: ["src/b.ts"],
        hasCircular: false,
      },
      {
        source: "src/b.ts",
        dependencies: [
          { resolved: "src/a.ts", type: "local", circular: false },
        ],
        dependents: ["src/c.ts"],
        hasCircular: false,
      },
      {
        source: "src/c.ts",
        dependencies: [
          { resolved: "src/b.ts", type: "local", circular: false },
        ],
        dependents: [],
        hasCircular: false,
      },
    ]);
    const result = propagateDeps(["src/utils.ts"], graph);
    expect([...result].sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/utils.ts",
    ]);
  });

  it("propagates when multiple files change", () => {
    const graph = makeDepGraph([
      {
        source: "src/lib.ts",
        dependencies: [],
        dependents: ["src/middle.ts"],
        hasCircular: false,
      },
      {
        source: "src/middle.ts",
        dependencies: [
          { resolved: "src/lib.ts", type: "local", circular: false },
        ],
        dependents: ["src/top.ts"],
        hasCircular: false,
      },
      {
        source: "src/top.ts",
        dependencies: [
          { resolved: "src/middle.ts", type: "local", circular: false },
        ],
        dependents: [],
        hasCircular: false,
      },
    ]);
    const result = propagateDeps(["src/lib.ts", "src/middle.ts"], graph);
    expect([...result].sort()).toEqual([
      "src/lib.ts",
      "src/middle.ts",
      "src/top.ts",
    ]);
  });

  it("handles circular dependencies without infinite loops", () => {
    const graph = makeDepGraph([
      {
        source: "src/a.ts",
        dependencies: [{ resolved: "src/b.ts", type: "local", circular: true }],
        dependents: ["src/b.ts"],
        hasCircular: true,
      },
      {
        source: "src/b.ts",
        dependencies: [{ resolved: "src/a.ts", type: "local", circular: true }],
        dependents: ["src/a.ts"],
        hasCircular: true,
      },
    ]);
    const result = propagateDeps(["src/a.ts"], graph);
    expect([...result].sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("handles empty changed files list", () => {
    const graph = makeDepGraph([
      {
        source: "src/a.ts",
        dependencies: [],
        dependents: [],
        hasCircular: false,
      },
    ]);
    const result = propagateDeps([], graph);
    expect([...result]).toEqual([]);
  });

  it("handles empty dependency graph", () => {
    const graph = makeDepGraph([]);
    const result = propagateDeps(["src/a.ts"], graph);
    expect([...result]).toEqual(["src/a.ts"]);
  });

  it("propagates diamond-shaped dependency", () => {
    const graph = makeDepGraph([
      {
        source: "src/utils.ts",
        dependencies: [],
        dependents: ["src/a.ts", "src/b.ts"],
        hasCircular: false,
      },
      {
        source: "src/a.ts",
        dependencies: [
          { resolved: "src/utils.ts", type: "local", circular: false },
        ],
        dependents: ["src/top.ts"],
        hasCircular: false,
      },
      {
        source: "src/b.ts",
        dependencies: [
          { resolved: "src/utils.ts", type: "local", circular: false },
        ],
        dependents: ["src/top.ts"],
        hasCircular: false,
      },
      {
        source: "src/top.ts",
        dependencies: [
          { resolved: "src/a.ts", type: "local", circular: false },
          { resolved: "src/b.ts", type: "local", circular: false },
        ],
        dependents: [],
        hasCircular: false,
      },
    ]);
    const result = propagateDeps(["src/utils.ts"], graph);
    expect([...result].sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/top.ts",
      "src/utils.ts",
    ]);
  });

  it("does not include unaffected independent files", () => {
    const graph = makeDepGraph([
      {
        source: "src/changed.ts",
        dependencies: [],
        dependents: ["src/affected.ts"],
        hasCircular: false,
      },
      {
        source: "src/affected.ts",
        dependencies: [
          { resolved: "src/changed.ts", type: "local", circular: false },
        ],
        dependents: [],
        hasCircular: false,
      },
      {
        source: "src/unrelated.ts",
        dependencies: [],
        dependents: [],
        hasCircular: false,
      },
    ]);
    const result = propagateDeps(["src/changed.ts"], graph);
    expect(result.has("src/unrelated.ts")).toBe(false);
    expect(result.has("src/changed.ts")).toBe(true);
    expect(result.has("src/affected.ts")).toBe(true);
  });
});

// ─── markAffectedGenTasks (needs fs mock) ───────────────────────────

describe("markAffectedGenTasks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 0 when state has no genTasks", () => {
    const fs = require("fs-extra");
    vi.spyOn(fs, "readJsonSync").mockReturnValue({
      genTasks: [],
    });

    const folderStrategy: FolderStrategyResult = {
      generatedAt: "",
      folders: [],
      totalFolders: 0,
      foldersToAnalyze: 0,
    };

    const result = markAffectedGenTasks(
      "/fake/state.json",
      new Set(["src/a.ts"]),
      folderStrategy,
    );
    expect(result).toBe(0);
  });

  it("marks genTasks as pending when affected files match subTask files", () => {
    const fs = require("fs-extra");
    const writeJsonMock = vi.fn();
    vi.spyOn(fs, "readJsonSync").mockReturnValue({
      genTasks: [
        {
          id: "task-1",
          folder: "src/folder-a",
          role: "primary",
          status: "completed",
          estimatedTokens: 5000,
        },
        {
          id: "task-2",
          folder: "src/folder-b",
          role: "primary",
          status: "completed",
          estimatedTokens: 3000,
        },
      ],
    });
    vi.spyOn(fs, "writeJsonSync").mockImplementation(writeJsonMock);

    const folderStrategy: FolderStrategyResult = {
      generatedAt: "",
      folders: [
        {
          path: "src/folder-a",
          fileCount: 2,
          logicFileCount: 2,
          styleFileCount: 0,
          shouldSplit: false,
          reason: "",
          priority: "high",
          subTasks: [
            {
              id: "task-1",
              label: "Folder A",
              role: "primary",
              files: ["src/folder-a/a.ts", "src/folder-a/b.ts"],
              estimatedTokens: 5000,
              priority: "high",
            },
          ],
        },
        {
          path: "src/folder-b",
          fileCount: 1,
          logicFileCount: 1,
          styleFileCount: 0,
          shouldSplit: false,
          reason: "",
          priority: "medium",
          subTasks: [
            {
              id: "task-2",
              label: "Folder B",
              role: "primary",
              files: ["src/folder-b/c.ts"],
              estimatedTokens: 3000,
              priority: "medium",
            },
          ],
        },
      ],
      totalFolders: 2,
      foldersToAnalyze: 2,
    };

    const result = markAffectedGenTasks(
      "/fake/state.json",
      new Set(["src/folder-a/a.ts"]),
      folderStrategy,
    );

    expect(result).toBe(1);
    expect(writeJsonMock).toHaveBeenCalled();
    const writtenState = writeJsonMock.mock.calls[0][1];
    const task1 = writtenState.genTasks.find((t: unknown) => t.id === "task-1");
    const task2 = writtenState.genTasks.find((t: unknown) => t.id === "task-2");
    expect(task1.status).toBe("pending");
    expect(task2.status).toBe("completed");
  });

  it("handles cross-folder merges", () => {
    const fs = require("fs-extra");
    const writeJsonMock = vi.fn();
    vi.spyOn(fs, "readJsonSync").mockReturnValue({
      genTasks: [
        {
          id: "merge-1",
          folder: "src/folder-a",
          role: "primary",
          status: "completed",
          estimatedTokens: 8000,
        },
      ],
    });
    vi.spyOn(fs, "writeJsonSync").mockImplementation(writeJsonMock);

    const folderStrategy: FolderStrategyResult = {
      generatedAt: "",
      folders: [
        {
          path: "src/folder-a",
          fileCount: 1,
          logicFileCount: 1,
          styleFileCount: 0,
          shouldSplit: false,
          reason: "",
          priority: "high",
          subTasks: [
            {
              id: "merge-1",
              label: "Merge Task",
              role: "primary",
              files: ["src/folder-a/a.ts"],
              estimatedTokens: 8000,
              priority: "high",
            },
          ],
        },
        {
          path: "src/folder-b",
          fileCount: 1,
          logicFileCount: 1,
          styleFileCount: 0,
          shouldSplit: false,
          reason: "",
          priority: "medium",
          subTasks: [
            {
              id: "sub-b",
              label: "Sub B",
              role: "primary",
              files: ["src/folder-b/b.ts"],
              estimatedTokens: 1000,
              priority: "medium",
            },
          ],
        },
      ],
      totalFolders: 2,
      foldersToAnalyze: 2,
      crossFolderMerges: [
        {
          id: "merge-1",
          label: "A+B Merge",
          folders: ["src/folder-a", "src/folder-b"],
          files: ["src/folder-a/a.ts", "src/folder-b/b.ts"],
          estimatedTokens: 8000,
          wikiChapter: "ch-01-merge",
          priority: "high",
        },
      ],
    };

    // Changing a file in folder-b should also mark merge-1 (affects folder-a too)
    const result = markAffectedGenTasks(
      "/fake/state.json",
      new Set(["src/folder-b/b.ts"]),
      folderStrategy,
    );

    expect(result).toBe(1);
    expect(writeJsonMock).toHaveBeenCalled();
    const writtenState = writeJsonMock.mock.calls[0][1];
    expect(writtenState.genTasks[0].status).toBe("pending");
  });

  it("skips in_progress tasks", () => {
    const fs = require("fs-extra");
    const writeJsonMock = vi.fn();
    vi.spyOn(fs, "readJsonSync").mockReturnValue({
      genTasks: [
        {
          id: "task-1",
          folder: "src/folder-a",
          role: "primary",
          status: "in_progress",
          estimatedTokens: 5000,
        },
      ],
    });
    vi.spyOn(fs, "writeJsonSync").mockImplementation(writeJsonMock);

    const folderStrategy: FolderStrategyResult = {
      generatedAt: "",
      folders: [
        {
          path: "src/folder-a",
          fileCount: 1,
          logicFileCount: 1,
          styleFileCount: 0,
          shouldSplit: false,
          reason: "",
          priority: "high",
          subTasks: [
            {
              id: "task-1",
              label: "Folder A",
              role: "primary",
              files: ["src/folder-a/a.ts"],
              estimatedTokens: 5000,
              priority: "high",
            },
          ],
        },
      ],
      totalFolders: 1,
      foldersToAnalyze: 1,
    };

    const result = markAffectedGenTasks(
      "/fake/state.json",
      new Set(["src/folder-a/a.ts"]),
      folderStrategy,
    );

    // in_progress should not be changed
    expect(result).toBe(0);
    expect(writeJsonMock).not.toHaveBeenCalled();
  });
});

// ─── injectFeedbackIntoPrompts (needs fs mock) ───────────────────────

describe("injectFeedbackIntoPrompts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("warns and returns early when promptsDir does not exist", () => {
    const fs = require("fs-extra");
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    injectFeedbackIntoPrompts("/nonexistent", "/aw", "/project");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("prompts 目录不存在"),
    );
  });

  it("injects feedback into prompt files without sentinel", () => {
    const fs = require("fs-extra");
    // promptsDir exists
    vi.spyOn(fs, "existsSync").mockImplementation((p: string) => {
      if (p === "/prompts") return true;
      if (p === "/aw/docs/feedback/global-strategies.md") return true;
      if (p === "/project/.agentic-wiki/feedback/prompts.md") return true;
      return false;
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((p: string) => {
      if (p === "/aw/docs/feedback/global-strategies.md") {
        return "Global: avoid any types";
      }
      if (p === "/project/.agentic-wiki/feedback/prompts.md") {
        return "Project: follow naming conventions";
      }
      if (p === "/prompts/task-1.md" || p === "/prompts/task-2.md") {
        return "# Task prompt content";
      }
      return "";
    });
    const appendFileMock = vi.fn();
    vi.spyOn(fs, "appendFileSync").mockImplementation(appendFileMock);
    vi.spyOn(fs, "readdirSync").mockReturnValue(["task-1.md", "task-2.md"]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    injectFeedbackIntoPrompts("/prompts", "/aw", "/project");

    expect(appendFileMock).toHaveBeenCalledTimes(2);
    expect(appendFileMock.mock.calls[0][0]).toBe("/prompts/task-1.md");
    expect(appendFileMock.mock.calls[0][1]).toContain(
      "Global: avoid any types",
    );
    expect(appendFileMock.mock.calls[0][1]).toContain(
      "Project: follow naming conventions",
    );
    expect(appendFileMock.mock.calls[0][1]).toContain(
      "AGENTICWIKI_FEEDBACK_INJECTED",
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("已注入 2"));
  });

  it("replaces existing sentinel block in replace mode", () => {
    const fs = require("fs-extra");
    vi.spyOn(fs, "existsSync").mockImplementation((p: string) => {
      if (p === "/prompts") return true;
      if (p === "/aw/docs/feedback/global-strategies.md") return false;
      if (p === "/project/.agentic-wiki/feedback/prompts.md") return false;
      return false;
    });
    vi.spyOn(fs, "readdirSync").mockReturnValue(["task-1.md"]);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      "# Task\n\n<!-- AGENTICWIKI_FEEDBACK_INJECTED -->\n\nOld feedback",
    );
    const writeFileMock = vi.fn();
    vi.spyOn(fs, "writeFileSync").mockImplementation(writeFileMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    injectFeedbackIntoPrompts("/prompts", "/aw", "/project", "replace");

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock.mock.calls[0][0]).toBe("/prompts/task-1.md");
    const written = writeFileMock.mock.calls[0][1];
    expect(written).not.toContain("Old feedback");
    expect(written).toContain("AGENTICWIKI_FEEDBACK_INJECTED");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("已更新 1"));
  });

  it("skips files that already have sentinel in append mode", () => {
    const fs = require("fs-extra");
    vi.spyOn(fs, "existsSync").mockImplementation((p: string) => {
      if (p === "/prompts") return true;
      return false;
    });
    vi.spyOn(fs, "readdirSync").mockReturnValue(["task-1.md"]);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      "# Task\n\n<!-- AGENTICWIKI_FEEDBACK_INJECTED -->\n\nExisting",
    );
    const appendFileMock = vi.fn();
    vi.spyOn(fs, "appendFileSync").mockImplementation(appendFileMock);

    injectFeedbackIntoPrompts("/prompts", "/aw", "/project");

    // In append mode, files with sentinel are skipped
    expect(appendFileMock).not.toHaveBeenCalled();
  });

  it("handles missing project feedback prompts.md gracefully", () => {
    const fs = require("fs-extra");
    vi.spyOn(fs, "existsSync").mockImplementation((p: string) => {
      if (p === "/prompts") return true;
      if (p === "/aw/docs/feedback/global-strategies.md") return true;
      return false;
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((p: string) => {
      if (p === "/aw/docs/feedback/global-strategies.md") {
        return "Global: use proper types";
      }
      if (p === "/prompts/task-1.md") {
        return "# Task prompt";
      }
      return "";
    });
    vi.spyOn(fs, "readdirSync").mockReturnValue(["task-1.md"]);
    const appendFileMock = vi.fn();
    vi.spyOn(fs, "appendFileSync").mockImplementation(appendFileMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    injectFeedbackIntoPrompts("/prompts", "/aw", "/project");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("prompts.md 缺失"),
    );
    expect(appendFileMock).toHaveBeenCalledTimes(1);
    expect(appendFileMock.mock.calls[0][1]).toContain(
      "Global: use proper types",
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("全局策略: 已加载"),
    );
  });

  it("logs project strategy loaded when project feedback exists", () => {
    const fs = require("fs-extra");
    vi.spyOn(fs, "existsSync").mockImplementation((p: string) => {
      if (p === "/prompts") return true;
      if (p === "/aw/docs/feedback/global-strategies.md") return false;
      if (p === "/project/.agentic-wiki/feedback/prompts.md") return true;
      return false;
    });
    vi.spyOn(fs, "readFileSync").mockImplementation((p: string) => {
      if (p === "/project/.agentic-wiki/feedback/prompts.md") {
        return "Project: test coverage needed";
      }
      if (p === "/prompts/task-1.md") {
        return "# Task";
      }
      return "";
    });
    vi.spyOn(fs, "readdirSync").mockReturnValue(["task-1.md"]);
    const appendFileMock = vi.fn();
    vi.spyOn(fs, "appendFileSync").mockImplementation(appendFileMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    injectFeedbackIntoPrompts("/prompts", "/aw", "/project");

    expect(appendFileMock).toHaveBeenCalledTimes(1);
    expect(appendFileMock.mock.calls[0][1]).toContain(
      "Project: test coverage needed",
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("项目策略: 已加载"),
    );
  });

  it("handles directory without .md files", () => {
    const fs = require("fs-extra");
    vi.spyOn(fs, "existsSync").mockImplementation((p: string) => {
      if (p === "/prompts") return true;
      return false;
    });
    vi.spyOn(fs, "readdirSync").mockReturnValue(["readme.txt", "data.json"]);
    const appendFileMock = vi.fn();
    vi.spyOn(fs, "appendFileSync").mockImplementation(appendFileMock);

    injectFeedbackIntoPrompts("/prompts", "/aw", "/project");

    expect(appendFileMock).not.toHaveBeenCalled();
  });
});
