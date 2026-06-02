import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs-extra";
import {
  ISSUE_TYPE_TO_CHAPTER,
  collectMisplacedIssues,
  extractIssueType,
  fixIssuePaths,
} from "../assemble/fix-issue-paths.js";

// ========================================================================
// Setup: mock fs-extra
// ========================================================================

vi.mock("fs-extra", () => ({
  default: {
    pathExists: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    ensureDir: vi.fn(),
    move: vi.fn(),
    rmdir: vi.fn(),
    stat: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ========================================================================
// Constants
// ========================================================================

describe("ISSUE_TYPE_TO_CHAPTER", () => {
  it("maps all 6 issue types to correct chapter directories", () => {
    expect(ISSUE_TYPE_TO_CHAPTER).toEqual({
      circular_dependency: "ch-01-circular-deps",
      dead_code: "ch-02-dead-code",
      missing_types: "ch-03-missing-types",
      complex_logic: "ch-04-complex-logic",
      inconsistent_api: "ch-05-inconsistent-api",
      potential_bug: "ch-06-potential-bugs",
    });
  });
});

// ========================================================================
// collectMisplacedIssues
// ========================================================================

describe("collectMisplacedIssues", () => {
  it("returns empty array when wiki has neither volume-2-issues nor volume-1-code dirs", async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(false);

    const result = await collectMisplacedIssues("/fake/wiki");

    expect(result).toEqual([]);
    // Should check both directories
    expect(vi.mocked(fs.pathExists)).toHaveBeenCalledTimes(2);
  });

  it("finds misplaced issues in volume-2-issues root directory", async () => {
    vi.mocked(fs.pathExists)
      .mockResolvedValueOnce(true) // volume-2-issues exists
      .mockResolvedValueOnce(false); // volume-1-code does not exist

    vi.mocked(fs.readdir).mockResolvedValueOnce([
      {
        name: "IS-001.md",
        isFile: () => true,
        isDirectory: () => false,
      },
      {
        name: "IS-002.md",
        isFile: () => true,
        isDirectory: () => false,
      },
      {
        name: "ch-01-circular-deps",
        isFile: () => false,
        isDirectory: () => true,
      },
      {
        name: "README.md",
        isFile: () => true,
        isDirectory: () => false,
      },
    ] as unknown as fs.Dirent[]);

    const result = await collectMisplacedIssues("/fake/wiki");

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      filePath: "/fake/wiki/volume-2-issues/IS-001.md",
      relativePath: "volume-2-issues/IS-001.md",
      location: "volume-2-root",
    });
    expect(result[1]).toMatchObject({
      filePath: "/fake/wiki/volume-2-issues/IS-002.md",
      relativePath: "volume-2-issues/IS-002.md",
      location: "volume-2-root",
    });
  });

  it("finds issues in volume-1-code/ch-*/issues/ directories", async () => {
    vi.mocked(fs.pathExists)
      .mockResolvedValueOnce(false) // volume-2-issues does not exist
      .mockResolvedValueOnce(true) // volume-1-code exists
      .mockResolvedValueOnce(true); // volume-1-code/ch-01-circular-deps/issues exists

    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        // volume-1-code chapters
        {
          name: "ch-01-circular-deps",
          isFile: () => false,
          isDirectory: () => true,
        },
        {
          name: "ch-02-dead-code",
          isFile: () => false,
          isDirectory: () => true,
        },
        {
          name: "index.md",
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as unknown as fs.Dirent[])
      .mockResolvedValueOnce([
        // issues dir contents for ch-01-circular-deps
        {
          name: "IS-003.md",
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as unknown as fs.Dirent[]);

    // ch-02-dead-code/issues does not exist → pathExists returns false
    vi.mocked(fs.pathExists).mockResolvedValueOnce(false);

    const result = await collectMisplacedIssues("/fake/wiki");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      filePath: "/fake/wiki/volume-1-code/ch-01-circular-deps/issues/IS-003.md",
      relativePath:
        "volume-1-code/ch-01-circular-deps/issues/IS-003.md",
      location: "volume-1-code",
    });
  });

  it("filters out non-IS-*.md files from both locations", async () => {
    vi.mocked(fs.pathExists)
      .mockResolvedValueOnce(true) // volume-2-issues exists
      .mockResolvedValueOnce(true); // volume-1-code exists

    // volume-2-issues root: mix of IS files and non-IS files
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        {
          name: "IS-001.md",
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: "NOT_AN_ISSUE.md",
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: "index.md",
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as unknown as fs.Dirent[])
      // volume-1-code chapters
      .mockResolvedValueOnce([
        {
          name: "ch-01-circular-deps",
          isFile: () => false,
          isDirectory: () => true,
        },
      ] as unknown as fs.Dirent[]);

    // ch-01-circular-deps/issues exists
    vi.mocked(fs.pathExists).mockResolvedValueOnce(true);

    // issues dir content: mix of IS files and other files
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      {
        name: "IS-002.md",
        isFile: () => true,
        isDirectory: () => false,
      },
      {
        name: "notes.md",
        isFile: () => true,
        isDirectory: () => false,
      },
      {
        name: "IS-003.md",
        isFile: () => true,
        isDirectory: () => false,
      },
    ] as unknown as fs.Dirent[]);

    const result = await collectMisplacedIssues("/fake/wiki");

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.relativePath).sort()).toEqual([
      "volume-1-code/ch-01-circular-deps/issues/IS-002.md",
      "volume-1-code/ch-01-circular-deps/issues/IS-003.md",
      "volume-2-issues/IS-001.md",
    ]);
  });
});

// ========================================================================
// extractIssueType
// ========================================================================

describe("extractIssueType", () => {
  it("extracts type from YAML frontmatter", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(`---
id: IS-001
type: dead_code
severity: high
---
Some content`);

    const result = await extractIssueType("/fake/wiki/volume-2-issues/IS-001.md");
    expect(result).toBe("dead_code");
  });

  it("extracts type from markdown table format", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      "| **ID** | IS-002 |\n| **类型** | dead_code |\n| **严重等级** | 高 |\n",
    );

    const result = await extractIssueType("/fake/wiki/IS-002.md");
    expect(result).toBe("dead_code");
  });

  it("extracts type from markdown table with backtick-wrapped value", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      "| **ID** | IS-003 |\n| **类型** | `complex_logic` |\n| **严重等级** | medium |\n",
    );

    const result = await extractIssueType("/fake/wiki/IS-003.md");
    expect(result).toBe("complex_logic");
  });

  it("returns null when content has no type info", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      "Just some text without any metadata.\n",
    );

    const result = await extractIssueType("/fake/wiki/IS-004.md");
    expect(result).toBeNull();
  });

  it("returns null when file cannot be read", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

    const result = await extractIssueType("/fake/wiki/missing.md");
    expect(result).toBeNull();
  });

  it("prefers YAML frontmatter over markdown table when both exist", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(`---
id: IS-005
type: potential_bug
---

| **类型** | dead_code |
`);

    const result = await extractIssueType("/fake/wiki/IS-005.md");
    expect(result).toBe("potential_bug");
  });
});

// ========================================================================
// fixIssuePaths
// ========================================================================

describe("fixIssuePaths", () => {
  it("dry-run mode reports issues without moving files", async () => {
    // pathExists: v2 true, v1 false
    vi.mocked(fs.pathExists).mockResolvedValueOnce(true).mockResolvedValue(false);

    // readdir for v2 root: one misplaced file
    vi.mocked(fs.readdir).mockResolvedValue([
      {
        name: "IS-001.md",
        isFile: () => true,
        isDirectory: () => false,
      },
    ] as unknown as fs.Dirent[]);

    // readFile: extract type from frontmatter
    vi.mocked(fs.readFile).mockResolvedValue(`---
type: dead_code
---
Content
`);

    const result = await fixIssuePaths("/fake/wiki", false);

    // Should report the file as fixed (in dry-run, they're listed)
    expect(result.fixed).toHaveLength(1);
    expect(result.fixed[0]).toContain("IS-001.md");
    expect(result.fixed[0]).toContain("ch-02-dead-code");
    expect(result.fixed[0]).toContain("dead_code");

    // Should NOT have called move or ensureDir in dry-run mode
    expect(vi.mocked(fs.move)).not.toHaveBeenCalled();
    expect(vi.mocked(fs.ensureDir)).not.toHaveBeenCalled();
  });

  it("apply mode actually moves files to correct chapter dir", async () => {
    // pathExists: v2 true, v1 false, and then for collectCorrect (v2 true again)
    vi.mocked(fs.pathExists)
      .mockResolvedValueOnce(true) // v2 root exists
      .mockResolvedValueOnce(false) // v1 root doesn't exist
      .mockResolvedValueOnce(true); // v2 root exists (in collectCorrect)

    // readdir: one misplaced file in v2 root, then empty collectCorrect dir
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        {
          name: "IS-001.md",
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as unknown as fs.Dirent[])
      .mockResolvedValueOnce([] as unknown as fs.Dirent[]);

    // readFile for type extraction
    vi.mocked(fs.readFile).mockResolvedValue(`---
type: missing_types
---
Content
`);

    const result = await fixIssuePaths("/fake/wiki", true);

    expect(result.fixed).toHaveLength(1);
    expect(result.fixed[0]).toContain("IS-001.md");
    expect(result.fixed[0]).toContain("missing_types");

    // Should have created target dir and moved the file
    expect(vi.mocked(fs.ensureDir)).toHaveBeenCalledWith(
      "/fake/wiki/volume-2-issues/ch-03-missing-types",
    );
    expect(vi.mocked(fs.move)).toHaveBeenCalledWith(
      "/fake/wiki/volume-2-issues/IS-001.md",
      "/fake/wiki/volume-2-issues/ch-03-missing-types/IS-001.md",
      { overwrite: false },
    );
  });

  it("skips issues with unknown type", async () => {
    vi.mocked(fs.pathExists)
      .mockResolvedValueOnce(true) // v2 root exists
      .mockResolvedValueOnce(false) // v1 doesn't exist
      .mockResolvedValueOnce(true); // v2 root for collectCorrect

    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        {
          name: "IS-001.md",
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as unknown as fs.Dirent[])
      .mockResolvedValueOnce([] as unknown as fs.Dirent[]);

    vi.mocked(fs.readFile).mockResolvedValue(`---
type: totally_invalid_type
---
`);

    const result = await fixIssuePaths("/fake/wiki", false);

    expect(result.fixed).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain("IS-001.md");
    expect(result.skipped[0]).toContain("unknown type");
  });

  it("skips issues with no extractable type", async () => {
    vi.mocked(fs.pathExists)
      .mockResolvedValueOnce(true) // v2 root exists
      .mockResolvedValueOnce(false) // v1 doesn't exist
      .mockResolvedValueOnce(true); // v2 root for collectCorrect

    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        {
          name: "IS-001.md",
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as unknown as fs.Dirent[])
      .mockResolvedValueOnce([] as unknown as fs.Dirent[]);

    // Content has no type info → extractIssueType returns null
    vi.mocked(fs.readFile).mockResolvedValue("Just text without metadata");

    const result = await fixIssuePaths("/fake/wiki", false);

    expect(result.fixed).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain("IS-001.md");
    expect(result.skipped[0]).toContain("no type");
  });

  it("reports already-correct issues from volume-2-issues chapter subdirectories", async () => {
    // pathExists: v2 true, v1 false, and then v2 true for collectCorrect
    vi.mocked(fs.pathExists)
      .mockResolvedValueOnce(true) // v2 root exists
      .mockResolvedValueOnce(false) // v1 doesn't exist
      .mockResolvedValueOnce(true); // v2 root for collectCorrect

    // readdir for v2 root: no misplaced files (only a chapter dir)
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        {
          name: "ch-02-dead-code",
          isFile: () => false,
          isDirectory: () => true,
        },
      ] as unknown as fs.Dirent[])
      .mockResolvedValueOnce([
        // collectCorrect: files inside ch-02-dead-code
        {
          name: "ch-02-dead-code",
          isFile: () => false,
          isDirectory: () => true,
        },
      ] as unknown as fs.Dirent[])
      .mockResolvedValueOnce([
        // collectCorrect: files inside ch-02-dead-code
        {
          name: "IS-005.md",
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: "IS-006.md",
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as unknown as fs.Dirent[]);

    const result = await fixIssuePaths("/fake/wiki", false);

    expect(result.fixed).toHaveLength(0);
    expect(result.alreadyCorrect).toHaveLength(2);
    expect(result.alreadyCorrect).toContain("ch-02-dead-code/IS-005.md");
    expect(result.alreadyCorrect).toContain("ch-02-dead-code/IS-006.md");
  });

  it("handles issues from volume-1-code location with apply mode and cleanup", async () => {
    // pathExists: v2 false, v1 true, v1/ch-01-circular-deps/issues true
    vi.mocked(fs.pathExists)
      .mockResolvedValueOnce(false) // v2 doesn't exist
      .mockResolvedValueOnce(true) // v1 exists
      .mockResolvedValueOnce(true) // ch-01-circular-deps/issues exists
      .mockResolvedValueOnce(true); // v2 exists for collectCorrect

    // readdir: v1 chapters, issues dir contents, collectCorrect empty
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        {
          name: "ch-01-circular-deps",
          isFile: () => false,
          isDirectory: () => true,
        },
      ] as unknown as fs.Dirent[])
      .mockResolvedValueOnce([
        {
          name: "IS-010.md",
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as unknown as fs.Dirent[])
      .mockResolvedValueOnce([] as unknown as fs.Dirent[]) // collectCorrect: empty
      .mockResolvedValueOnce([] as unknown as fs.Dirent[]); // rmdir check: remaining files list is empty

    // extract type
    vi.mocked(fs.readFile).mockResolvedValue(`---
type: circular_dependency
---
Content
`);

    const result = await fixIssuePaths("/fake/wiki", true);

    expect(result.fixed).toHaveLength(1);
    expect(result.fixed[0]).toContain("volume-1-code");
    expect(result.fixed[0]).toContain("circular_dependency");

    // Should have moved from v1 to v2
    expect(vi.mocked(fs.move)).toHaveBeenCalledWith(
      "/fake/wiki/volume-1-code/ch-01-circular-deps/issues/IS-010.md",
      "/fake/wiki/volume-2-issues/ch-01-circular-deps/IS-010.md",
      { overwrite: false },
    );

    // Should have cleaned up the empty issues dir
    expect(vi.mocked(fs.readdir)).toHaveBeenCalledWith(
      "/fake/wiki/volume-1-code/ch-01-circular-deps/issues",
    );
    expect(vi.mocked(fs.rmdir)).toHaveBeenCalledWith(
      "/fake/wiki/volume-1-code/ch-01-circular-deps/issues",
    );
  });

  it("reports totalIssues as misplaced + already-correct sum", async () => {
    vi.mocked(fs.pathExists)
      .mockResolvedValueOnce(true) // v2 exists
      .mockResolvedValueOnce(false) // v1 doesn't exist
      .mockResolvedValueOnce(true); // v2 for collectCorrect

    // readdir: 2 misplaced files in v2 root, 2 chapter dirs in v2 for collectCorrect
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([
        {
          name: "IS-001.md",
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: "IS-002.md",
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as unknown as fs.Dirent[])
      .mockResolvedValueOnce([
        {
          name: "ch-01-circular-deps",
          isFile: () => false,
          isDirectory: () => true,
        },
      ] as unknown as fs.Dirent[])
      // collectCorrect: one correct file inside chapter dir
      .mockResolvedValueOnce([
        {
          name: "IS-003.md",
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as unknown as fs.Dirent[]);

    // Both misplaced files have valid types
    vi.mocked(fs.readFile).mockResolvedValue(`---
type: dead_code
---
Content
`);

    const result = await fixIssuePaths("/fake/wiki", false);

    // 2 misplaced + 1 already-correct = 3 total
    expect(result.totalIssues).toBe(3);
    expect(result.fixed).toHaveLength(2);
    expect(result.alreadyCorrect).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });
});
