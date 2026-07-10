import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("globby", () => ({ globby: vi.fn() }));
vi.mock("fs-extra", () => ({
  default: {
    readFile: vi.fn(),
    outputFile: vi.fn(),
    outputJson: vi.fn(),
    pathExists: vi.fn(),
  },
}));

import { globby } from "globby";
import fs from "fs-extra";
import {
  buildFileIssueIndex,
  generateFileIssuesMarkdown,
} from "../assemble/build-file-issue-index.js";

// Sample issue markdown
function makeIssueMd(
  id: string,
  type: string,
  severity: string,
  sourceFiles: string[],
): string {
  return [
    "---",
    `issueId: ${id}`,
    `type: ${type}`,
    `severity: ${severity}`,
    `status: detected`,
    `detectedAt: 2026-01-01T00:00:00.000Z`,
    `sourceFile: [${sourceFiles.map((f) => `"${f}"`).join(", ")}]`,
    "---",
    "",
    `# ${id}: Test issue`,
    "",
    "This is a test issue.",
  ].join("\n");
}

describe("buildFileIssueIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty index when no issues exist", async () => {
    vi.mocked(globby).mockResolvedValue([]);

    const result = await buildFileIssueIndex("/fake/issues");

    expect(result.stats.totalIssues).toBe(0);
    expect(result.stats.totalFilesWithIssues).toBe(0);
    expect(Object.keys(result.fileToIssues)).toHaveLength(0);
  });

  it("maps a single issue to its source files", async () => {
    vi.mocked(globby).mockResolvedValue(["ch-01-bugs/IS-0001-MEDIUM.md"]);
    vi.mocked(fs.readFile).mockResolvedValue(
      makeIssueMd("IS-0001-MEDIUM", "bug", "medium", [
        "src/Button.tsx",
      ]) as unknown as Buffer,
    );

    const result = await buildFileIssueIndex("/fake/issues");

    expect(result.stats.totalIssues).toBe(1);
    expect(result.stats.totalFilesWithIssues).toBe(1);
    expect(result.stats.bySeverity.medium).toBe(1);
    expect(result.fileToIssues["src/Button.tsx"]).toHaveLength(1);
    expect(result.fileToIssues["src/Button.tsx"][0].id).toBe("IS-0001-MEDIUM");
  });

  it("maps multiple issues to the same source file", async () => {
    vi.mocked(globby).mockResolvedValue([
      "ch-01-bugs/IS-0001-MEDIUM.md",
      "ch-01-bugs/IS-0002-HIGH.md",
    ]);
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(
        makeIssueMd("IS-0001-MEDIUM", "bug", "medium", [
          "src/Button.tsx",
        ]) as unknown as Buffer,
      )
      .mockResolvedValueOnce(
        makeIssueMd("IS-0002-HIGH", "security", "high", [
          "src/Button.tsx",
        ]) as unknown as Buffer,
      );

    const result = await buildFileIssueIndex("/fake/issues");

    expect(result.stats.totalIssues).toBe(2);
    expect(result.stats.totalFilesWithIssues).toBe(1);
    expect(result.fileToIssues["src/Button.tsx"]).toHaveLength(2);
  });

  it("maps one issue to multiple source files", async () => {
    vi.mocked(globby).mockResolvedValue(["ch-01-bugs/IS-0001-CRITICAL.md"]);
    vi.mocked(fs.readFile).mockResolvedValue(
      makeIssueMd("IS-0001-CRITICAL", "bug", "critical", [
        "src/Button.tsx",
        "src/Input.tsx",
      ]) as unknown as Buffer,
    );

    const result = await buildFileIssueIndex("/fake/issues");

    expect(result.stats.totalIssues).toBe(1);
    expect(result.stats.totalFilesWithIssues).toBe(2);
    expect(result.fileToIssues["src/Button.tsx"]).toHaveLength(1);
    expect(result.fileToIssues["src/Input.tsx"]).toHaveLength(1);
  });

  it("skips issues without required frontmatter", async () => {
    vi.mocked(globby).mockResolvedValue(["ch-01-bugs/no-id.md"]);
    vi.mocked(fs.readFile).mockResolvedValue(
      "# No frontmatter\n\nJust content." as unknown as Buffer,
    );

    const result = await buildFileIssueIndex("/fake/issues");

    expect(result.stats.totalIssues).toBe(0);
  });

  it("handles read errors gracefully", async () => {
    vi.mocked(globby).mockResolvedValue(["ch-01-bugs/broken.md"]);
    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

    const result = await buildFileIssueIndex("/fake/issues");

    expect(result.stats.totalIssues).toBe(0);
  });
});

describe("generateFileIssuesMarkdown", () => {
  it("generates markdown with issue links", () => {
    const index = {
      generatedAt: new Date().toISOString(),
      fileToIssues: {
        "src/Button.tsx": [
          {
            id: "IS-0001-MEDIUM",
            type: "bug",
            severity: "medium",
            status: "detected",
            title: "Button missing error state",
            sourceFiles: ["src/Button.tsx"],
            relativePath: "ch-01-bugs/IS-0001-MEDIUM.md",
          },
        ],
      },
      stats: {
        totalIssues: 1,
        totalFilesWithIssues: 1,
        bySeverity: { medium: 1 },
      },
    };

    const md = generateFileIssuesMarkdown(index, "volume-2-issues");

    expect(md).toContain("IS-0001-MEDIUM");
    expect(md).toContain("Button missing error state");
    expect(md).toContain("src/Button.tsx");
    expect(md).toContain("volume-2-issues/ch-01-bugs/IS-0001-MEDIUM");
  });

  it("handles empty index", () => {
    const index = {
      generatedAt: new Date().toISOString(),
      fileToIssues: {},
      stats: { totalIssues: 0, totalFilesWithIssues: 0, bySeverity: {} },
    };

    const md = generateFileIssuesMarkdown(index, "volume-2-issues");
    expect(md).toContain("# 📋 文件 → Issue 反向索引");
  });
});
