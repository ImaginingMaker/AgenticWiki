import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import fs from "fs-extra";
import {
  hasWikiContent,
  findWikiChapterDir,
  findIssueFiles,
  checkIssueCompleteness,
  syncGenTasks,
  countStatuses,
} from "../gen/sync-gen-tasks.js";
import type { WikiState, GenTask } from "../../types/index.js";

// === Mocks ===

vi.mock("fs-extra", () => ({
  default: {
    pathExists: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
  },
}));

vi.mock("../state-manager.js", () => ({
  atomicUpdate: vi.fn().mockResolvedValue({}),
}));

// === Helpers ===

function makeGenTask(overrides: Partial<GenTask> = {}): GenTask {
  return {
    id: "task-1",
    folder: "src/components",
    role: "architect",
    status: "pending",
    estimatedTokens: 5000,
    ...overrides,
  };
}

function makeWikiState(overrides: Partial<WikiState> = {}): WikiState {
  return {
    schemaVersion: 1,
    id: "test-project",
    projectPath: "/test/project",
    createdAt: "2025-01-01T00:00:00.000Z",
    currentPhase: "GEN",
    phaseHistory: [],
    checkpoint: {
      lastSuccessPhase: null,
      filesSnapshot: {},
      timestamp: "2025-01-01T00:00:00.000Z",
    },
    blockers: [],
    config: {
      mode: "full",
      sourcePath: "/test/project/src",
      wikiPath: "/test/project/wiki",
      excludePatterns: [],
      language: "TypeScript",
    },
    ...overrides,
  };
}

interface DirentLike {
  name: string;
  isFile: () => boolean;
  isDirectory: () => boolean;
}

function makeFileDirent(name: string): DirentLike {
  return { name, isFile: () => true, isDirectory: () => false };
}

function makeDirDirent(name: string): DirentLike {
  return { name, isFile: () => false, isDirectory: () => true };
}

// === Tests ===

describe("hasWikiContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return true when directory exists with .md files", async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(true);
    vi.mocked(fs.readdir).mockResolvedValue(["README.md", "index.ts"]);

    const result = await hasWikiContent("/wiki/chapter-1");

    expect(result).toBe(true);
    expect(fs.pathExists).toHaveBeenCalledWith("/wiki/chapter-1");
    expect(fs.readdir).toHaveBeenCalledWith("/wiki/chapter-1");
  });

  it("should return false when directory does not exist", async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(false);

    const result = await hasWikiContent("/wiki/missing");

    expect(result).toBe(false);
    expect(fs.readdir).not.toHaveBeenCalled();
  });

  it("should return false when directory exists but no .md files", async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(true);
    vi.mocked(fs.readdir).mockResolvedValue(["index.ts", "styles.css"]);

    const result = await hasWikiContent("/wiki/chapter-1");

    expect(result).toBe(false);
  });

  it("should return false when error reading directory", async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(true);
    vi.mocked(fs.readdir).mockRejectedValue(new Error("Permission denied"));

    const result = await hasWikiContent("/wiki/restricted");

    expect(result).toBe(false);
  });
});

describe("findWikiChapterDir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return chapter dir when wikiChapter is provided and has content", async () => {
    const wikiRoot = "/wiki";
    const wikiChapter = "ch-api";
    const folder = "src/api";
    const chapterPath = path.join(wikiRoot, "volume-1-code", wikiChapter);

    // pathExists for wikiChapter dir (no "/" in wikiChapter → hasWikiContent path)
    vi.mocked(fs.pathExists).mockResolvedValue(true);
    vi.mocked(fs.readdir).mockResolvedValue(["api-service.md", "routes.md"]);
    vi.mocked(fs.stat).mockResolvedValue({
      isDirectory: () => true,
    } as unknown);

    const result = await findWikiChapterDir(wikiRoot, wikiChapter, folder);

    expect(result).toBe(chapterPath);
  });

  it("should return dirname when wikiChapter contains a separator and exact file exists", async () => {
    const wikiRoot = "/wiki";
    const wikiChapter = "ch-api/api-service.md";
    const folder = "src/api";
    const wikiFilePath = path.join(wikiRoot, "volume-1-code", wikiChapter);

    vi.mocked(fs.pathExists).mockResolvedValue(true);
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(fs.stat).mockResolvedValue({
      isDirectory: () => false,
    } as unknown);

    const result = await findWikiChapterDir(wikiRoot, wikiChapter, folder);

    expect(result).toBe(path.dirname(wikiFilePath));
  });

  it("should return null when wikiChapter contains separator but file not found", async () => {
    const wikiRoot = "/wiki";
    const wikiChapter = "ch-api/missing-file.md";
    const folder = "src/api";

    vi.mocked(fs.pathExists).mockResolvedValue(false);

    const result = await findWikiChapterDir(wikiRoot, wikiChapter, folder);

    expect(result).toBeNull();
  });

  it("should fall back to folder matching when no wikiChapter provided", async () => {
    const wikiRoot = "/wiki";
    const folder = "desktop/src/main";
    const volume1Path = path.join(wikiRoot, "volume-1-code");
    const matchedChapterPath = path.join(volume1Path, "ch-desktop_src_main");

    vi.mocked(fs.pathExists).mockResolvedValue(true);
    // readdir for volume-1-code listing → directory names
    // readdir for chapter dir content → .md files (for hasWikiContent check)
    vi.mocked(fs.readdir).mockImplementation(async (dirPath: string) => {
      if (dirPath === volume1Path) {
        return ["ch-desktop_src_main", "ch-web_src"];
      }
      // hasWikiContent reads chapter dir → return .md files
      return ["overview.md", "details.md"];
    });
    vi.mocked(fs.stat).mockImplementation(async (dirPath: string) => {
      return { isDirectory: () => dirPath.includes("ch-") } as unknown;
    });

    const result = await findWikiChapterDir(wikiRoot, undefined, folder);

    expect(result).toBe(matchedChapterPath);
  });

  it("should return null when neither wikiChapter nor folder match any chapter", async () => {
    const wikiRoot = "/wiki";
    const folder = "src/unknown";
    vi.mocked(fs.pathExists).mockResolvedValue(false);
    vi.mocked(fs.readdir).mockResolvedValue(["ch-api", "ch-web_src"]);
    vi.mocked(fs.stat).mockImplementation(async (dirPath: string) => {
      return { isDirectory: () => dirPath.includes("ch-") } as unknown;
    });
    // hasWikiContent returns false for both chapters
    vi.mocked(fs.readdir).mockResolvedValue(["no-markdown.ts"]);

    const result = await findWikiChapterDir(wikiRoot, undefined, folder);

    // pathExists was called for wikiChapter check (undefined → false returned via mockResolvedValue(false))
    // So it falls through to the folder matching loop
    expect(result).toBeNull();
  });

  it("should return null when volume-1-code does not exist", async () => {
    const wikiRoot = "/wiki";
    const folder = "src/components";

    vi.mocked(fs.pathExists).mockResolvedValue(false);
    vi.mocked(fs.readdir).mockRejectedValue(new Error("ENOENT"));

    const result = await findWikiChapterDir(wikiRoot, undefined, folder);

    expect(result).toBeNull();
  });
});

describe("findIssueFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should find IS-*.md files recursively", async () => {
    const root = "/wiki/volume-2-issues";

    vi.mocked(fs.readdir).mockImplementation(
      async (dirPath: string, options?: unknown) => {
        if (dirPath === root) {
          if (options?.withFileTypes) {
            return [
              makeFileDirent("IS-0001-CRITICAL.md"),
              makeDirDirent("subdir"),
              makeFileDirent("other.txt"),
            ];
          }
          return [];
        }
        if (dirPath === path.join(root, "subdir")) {
          return [
            makeFileDirent("IS-0002-HIGH.md"),
            makeFileDirent("IS-0003-MEDIUM.md"),
          ];
        }
        return [];
      },
    );

    const result = await findIssueFiles(root);

    expect(result).toHaveLength(3);
    expect(result).toContain("IS-0001-CRITICAL.md");
    expect(result).toContain("IS-0002-HIGH.md");
    expect(result).toContain("IS-0003-MEDIUM.md");
  });

  it("should filter out non-IS files", async () => {
    const root = "/wiki/volume-2-issues";

    vi.mocked(fs.readdir).mockResolvedValue([
      makeFileDirent("README.md"),
      makeFileDirent("IS-0001-CRITICAL.md"),
      makeFileDirent("notes.txt"),
      makeFileDirent("ARCH-001.md"),
    ] as unknown);

    const result = await findIssueFiles(root);

    expect(result).toEqual(["IS-0001-CRITICAL.md"]);
  });

  it("should return empty array when directory is empty", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([]);

    const result = await findIssueFiles("/wiki/volume-2-issues");

    expect(result).toEqual([]);
  });

  it("should return empty array when directory does not exist", async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error("ENOENT"));

    const result = await findIssueFiles("/wiki/volume-2-issues");

    expect(result).toEqual([]);
  });
});

describe("checkIssueCompleteness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty array when all referenced issues have files", async () => {
    const wikiDir = "/wiki/volume-1-code/ch-api";
    const wikiRoot = "/wiki";
    const issuesRoot = path.join(wikiRoot, "volume-2-issues");

    // findIssueFiles → finds existing issue files
    vi.mocked(fs.readdir).mockImplementation(
      async (dirPath: string, options?: unknown) => {
        if (dirPath === issuesRoot && options?.withFileTypes) {
          return [
            makeFileDirent("IS-0001-CRITICAL.md"),
            makeFileDirent("IS-0002-HIGH.md"),
          ];
        }
        if (dirPath === wikiDir) {
          return ["api-service.md"];
        }
        return [];
      },
    );

    vi.mocked(fs.readFile).mockResolvedValue(
      "Some text referencing IS-0001-CRITICAL and IS-0002-HIGH",
    );

    const result = await checkIssueCompleteness(wikiDir, wikiRoot);

    expect(result).toEqual([]);
  });

  it("should return orphaned issue IDs when referenced issues have no files", async () => {
    const wikiDir = "/wiki/volume-1-code/ch-api";
    const wikiRoot = "/wiki";
    const issuesRoot = path.join(wikiRoot, "volume-2-issues");

    // Only IS-0001 exists on disk
    vi.mocked(fs.readdir).mockImplementation(
      async (dirPath: string, options?: unknown) => {
        if (dirPath === issuesRoot && options?.withFileTypes) {
          return [makeFileDirent("IS-0001-CRITICAL.md")];
        }
        if (dirPath === wikiDir) {
          return ["api-service.md"];
        }
        return [];
      },
    );

    // Wiki references IS-0001 and IS-0002
    vi.mocked(fs.readFile).mockResolvedValue(
      "Issue IS-0001-CRITICAL needs fix. Also IS-0002-HIGH is related.",
    );

    const result = await checkIssueCompleteness(wikiDir, wikiRoot);

    expect(result).toEqual(["IS-0002-HIGH"]);
  });

  it("should return empty array when no issues are referenced", async () => {
    const wikiDir = "/wiki/volume-1-code/ch-api";
    const wikiRoot = "/wiki";

    vi.mocked(fs.readdir).mockImplementation(
      async (dirPath: string, options?: unknown) => {
        if (options?.withFileTypes) {
          return [];
        }
        if (dirPath === wikiDir) {
          return ["api-service.md"];
        }
        return [];
      },
    );

    vi.mocked(fs.readFile).mockResolvedValue("No issue references here.");

    const result = await checkIssueCompleteness(wikiDir, wikiRoot);

    expect(result).toEqual([]);
  });

  it("should handle volume-2-issues directory not existing", async () => {
    const wikiDir = "/wiki/volume-1-code/ch-api";
    const wikiRoot = "/wiki";

    vi.mocked(fs.readdir).mockImplementation(
      async (dirPath: string, options?: unknown) => {
        if (options?.withFileTypes) {
          return [];
        }
        if (dirPath === wikiDir) {
          return ["api-service.md"];
        }
        return [];
      },
    );

    vi.mocked(fs.readFile).mockResolvedValue("Refers to IS-0001-CRITICAL");

    const result = await checkIssueCompleteness(wikiDir, wikiRoot);

    expect(result).toEqual(["IS-0001-CRITICAL"]);
  });
});

describe("syncGenTasks (plain sync, strict=false)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should skip already completed tasks", async () => {
    const tasks = [
      makeGenTask({ id: "task-1", folder: "src/api", status: "completed" }),
    ];
    const state = makeWikiState({ genTasks: tasks });
    const wikiRoot = "/wiki";

    const result = await syncGenTasks(state, wikiRoot);

    expect(result.updated).toEqual([]);
    expect(result.skipped).toContain("task-1 (already completed)");
    expect(result.before.completed).toBe(1);
    expect(result.after.completed).toBe(1);
  });

  it("should skip already failed tasks", async () => {
    const tasks = [
      makeGenTask({ id: "task-1", folder: "src/api", status: "failed" }),
    ];
    const state = makeWikiState({ genTasks: tasks });
    const wikiRoot = "/wiki";

    const result = await syncGenTasks(state, wikiRoot);

    expect(result.updated).toEqual([]);
    expect(result.skipped).toContain("task-1 (already failed)");
    expect(result.before.failed).toBe(1);
    expect(result.after.failed).toBe(1);
  });

  it("should mark task as completed when wiki output exists", async () => {
    const tasks = [
      makeGenTask({
        id: "task-1",
        folder: "src/api",
        role: "architect",
        status: "pending",
        wikiChapter: "ch-api",
      }),
    ];
    const state = makeWikiState({ genTasks: tasks });
    const wikiRoot = "/wiki";
    // findWikiChapterDir: wikiChapter provided, check hasWikiContent
    vi.mocked(fs.pathExists).mockResolvedValue(true);
    vi.mocked(fs.readdir).mockResolvedValue(["api-service.md", "routes.md"]);

    const result = await syncGenTasks(state, wikiRoot);

    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toContain("task-1 -> completed");
    expect(result.skipped).toEqual([]);
    expect(result.after.completed).toBe(1);
    expect(result.before.pending).toBe(1);

    // Task was mutated in place
    expect(tasks[0].status).toBe("completed");
  });

  it("should skip task when no wiki output is found", async () => {
    const tasks = [
      makeGenTask({
        id: "task-1",
        folder: "src/api",
        status: "pending",
      }),
    ];
    const state = makeWikiState({ genTasks: tasks });
    const wikiRoot = "/wiki";

    // findWikiChapterDir: no wikiChapter, fall back to folder matching
    // pathExists for wikiChapter check (undefined → false)
    vi.mocked(fs.pathExists).mockResolvedValue(false);
    // readdir for volume-1-code
    vi.mocked(fs.readdir).mockImplementation(async (dirPath: string) => {
      if (dirPath === path.join(wikiRoot, "volume-1-code")) {
        return ["ch-api", "ch-web"];
      }
      return [];
    });
    vi.mocked(fs.stat).mockImplementation(async (dirPath: string) => {
      return { isDirectory: () => dirPath.includes("ch-") } as unknown;
    });

    const result = await syncGenTasks(state, wikiRoot);

    expect(result.updated).toEqual([]);
    expect(result.skipped).toContain(
      "task-1 (no wiki output found for src/api)",
    );
    expect(tasks[0].status).toBe("pending");
  });

  it("should handle empty genTasks array", async () => {
    const state = makeWikiState({ genTasks: [] });
    const wikiRoot = "/wiki";

    const result = await syncGenTasks(state, wikiRoot);

    expect(result.totalGenTasks).toBe(0);
    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.before).toEqual({
      completed: 0,
      inProgress: 0,
      pending: 0,
      failed: 0,
    });
  });

  it("should set wikiChapter from basename when not already set", async () => {
    const tasks = [
      makeGenTask({
        id: "task-1",
        folder: "src/api",
        status: "pending",
        wikiChapter: undefined,
      }),
    ];
    const state = makeWikiState({ genTasks: tasks });
    const wikiRoot = "/wiki";
    const volume1Path = path.join(wikiRoot, "volume-1-code");
    const matchedChapterPath = path.join(volume1Path, "ch-src_api");

    // findWikiChapterDir fallback: match folder → "src/api" → "src_api"
    // pathExists for wikiChapter check (undefined → false)
    // pathExists for chapter dir check → true so hasWikiContent can proceed
    vi.mocked(fs.pathExists).mockImplementation(async (dirPath: string) => {
      if (dirPath === matchedChapterPath) return true;
      return false;
    });
    vi.mocked(fs.readdir).mockImplementation(async (dirPath: string) => {
      if (dirPath === volume1Path) {
        return ["ch-src_api"];
      }
      // hasWikiContent reads chapter dir → return .md files
      return ["overview.md"];
    });
    vi.mocked(fs.stat).mockImplementation(async (dirPath: string) => {
      return { isDirectory: () => dirPath.includes("ch-") } as unknown;
    });

    const result = await syncGenTasks(state, wikiRoot);

    // wikiChapter should have been set to basename of wikiDir
    expect(tasks[0].wikiChapter).toBe("ch-src_api");
    expect(result.updated).toHaveLength(1);
  });
});

describe("syncGenTasks (strict mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should block tasks when referenced issue files are missing", async () => {
    const tasks = [
      makeGenTask({
        id: "task-1",
        folder: "src/api",
        status: "pending",
        wikiChapter: "ch-api",
      }),
    ];
    const state = makeWikiState({ genTasks: tasks });
    const wikiRoot = "/wiki";
    const wikiDir = path.join(wikiRoot, "volume-1-code", "ch-api");
    const issuesRoot = path.join(wikiRoot, "volume-2-issues");

    // findWikiChapterDir → wikiChapter found
    vi.mocked(fs.pathExists).mockResolvedValue(true);
    vi.mocked(fs.readdir).mockImplementation(
      async (dirPath: string, options?: unknown) => {
        if (dirPath === issuesRoot && options?.withFileTypes) {
          return []; // No issue files on disk
        }
        if (dirPath === wikiDir) {
          return ["api-service.md"];
        }
        return [];
      },
    );
    vi.mocked(fs.readFile).mockResolvedValue("Depends on IS-0001-CRITICAL");

    const result = await syncGenTasks(state, wikiRoot, true);

    expect(result.strictBlocked).toBeDefined();
    expect(result.strictBlocked).toHaveLength(1);
    expect(result.strictBlocked![0]).toContain("task-1");
    expect(result.strictBlocked![0]).toContain("IS-0001-CRITICAL");
    expect(result.skipped).toHaveLength(1);
    expect(result.updated).toEqual([]);
    expect(tasks[0].status).toBe("pending");
  });

  it("should not block tasks when all referenced issue files exist", async () => {
    const tasks = [
      makeGenTask({
        id: "task-1",
        folder: "src/api",
        status: "pending",
        wikiChapter: "ch-api",
      }),
    ];
    const state = makeWikiState({ genTasks: tasks });
    const wikiRoot = "/wiki";
    const wikiDir = path.join(wikiRoot, "volume-1-code", "ch-api");
    const issuesRoot = path.join(wikiRoot, "volume-2-issues");

    vi.mocked(fs.pathExists).mockResolvedValue(true);
    vi.mocked(fs.readdir).mockImplementation(
      async (dirPath: string, options?: unknown) => {
        if (dirPath === issuesRoot && options?.withFileTypes) {
          return [makeFileDirent("IS-0001-CRITICAL.md")];
        }
        if (dirPath === wikiDir) {
          return ["api-service.md"];
        }
        return [];
      },
    );
    vi.mocked(fs.readFile).mockResolvedValue("Depends on IS-0001-CRITICAL");

    const result = await syncGenTasks(state, wikiRoot, true);

    expect(result.strictBlocked).toBeUndefined();
    expect(result.updated).toHaveLength(1);
    expect(result.skipped).toEqual([]);
    expect(tasks[0].status).toBe("completed");
  });

  it("should skip strictBlocked field when no blocks occur", async () => {
    const state = makeWikiState({ genTasks: [] });
    const wikiRoot = "/wiki";

    const result = await syncGenTasks(state, wikiRoot, true);

    expect(result.strictBlocked).toBeUndefined();
  });
});

describe("countStatuses", () => {
  it("should count all status categories correctly", () => {
    const tasks: GenTask[] = [
      makeGenTask({ id: "t1", status: "completed" }),
      makeGenTask({ id: "t2", status: "completed" }),
      makeGenTask({ id: "t3", status: "in_progress" }),
      makeGenTask({ id: "t4", status: "pending" }),
      makeGenTask({ id: "t5", status: "pending" }),
      makeGenTask({ id: "t6", status: "failed" }),
    ];

    const result = countStatuses(tasks);

    expect(result).toEqual({
      completed: 2,
      inProgress: 1,
      pending: 2,
      failed: 1,
    });
  });

  it("should return all zeros for empty array", () => {
    const result = countStatuses([]);

    expect(result).toEqual({
      completed: 0,
      inProgress: 0,
      pending: 0,
      failed: 0,
    });
  });
});
