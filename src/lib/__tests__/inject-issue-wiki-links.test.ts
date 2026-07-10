import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("globby", () => ({ globby: vi.fn() }));
vi.mock("fs-extra", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    outputFile: vi.fn(),
    pathExists: vi.fn(),
  },
}));

import { globby } from "globby";
import fs from "fs-extra";
import { injectIssueWikiLinks } from "../assemble/inject-issue-wiki-links.js";

const mockGlobby = vi.mocked(globby);
const mockReadFile = vi.mocked(fs.readFile) as unknown as typeof fs.readFile;
const mockWriteFile = vi.mocked(fs.writeFile) as unknown as typeof fs.writeFile;
const mockPathExists = vi.mocked(
  fs.pathExists,
) as unknown as typeof fs.pathExists;

// Sample issue markdown with sourceFile (singular, as SubAgent emits)
function makeIssueMd(sourceFiles: string[]): string {
  return [
    "---",
    "issueId: IS-0001-MEDIUM",
    "type: bug",
    "severity: medium",
    "status: detected",
    "detectedAt: 2026-01-01T00:00:00.000Z",
    `sourceFile: [${sourceFiles.map((f) => `"${f}"`).join(", ")}]`,
    "---",
    "",
    "# IS-0001-MEDIUM: Test issue",
    "",
    "This is a test issue.",
  ].join("\n");
}

// Sample wiki page markdown with sourceFiles (plural)
function makeWikiPageMd(sourceFiles: string[]): string {
  return [
    "---",
    "title: Button",
    "tags: [component]",
    `sourceFiles: [${sourceFiles.map((f) => `"${f}"`).join(", ")}]`,
    "---",
    "",
    "# Button",
    "",
    "Documentation for Button component.",
  ].join("\n");
}

describe("injectIssueWikiLinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // fs.pathExists returns true by default for all calls
    mockPathExists.mockResolvedValue(true as never);
  });

  it("returns 0 updated when issues dir not found", async () => {
    mockPathExists.mockResolvedValue(false as never);
    const result = await injectIssueWikiLinks("/fake/issues", "/fake/wiki");
    expect(result.totalIssues).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it("skips issues without source files", async () => {
    // buildSourceToWikiMap reads wiki files first, then injectIssueWikiLinks reads issues
    mockGlobby
      .mockResolvedValueOnce([]) // wiki files (first)
      .mockResolvedValueOnce(["ch-01-bugs/IS-0001-MEDIUM.md"]); // issue files (second)
    // readFile: issue only (no wiki files to read)
    mockReadFile.mockResolvedValue(makeIssueMd([]) as unknown as Buffer);

    const result = await injectIssueWikiLinks("/fake/issues", "/fake/wiki");

    expect(result.totalIssues).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("injects wiki links for issues with matching source files", async () => {
    mockGlobby
      .mockResolvedValueOnce(["ch-components/Button.md"]) // wiki files (first)
      .mockResolvedValueOnce(["ch-01-bugs/IS-0001-MEDIUM.md"]); // issue files (second)

    // readFile: wiki page first, then issue
    mockReadFile
      .mockResolvedValueOnce(
        makeWikiPageMd(["src/Button.tsx"]) as unknown as Buffer,
      )
      .mockResolvedValueOnce(
        makeIssueMd(["src/Button.tsx"]) as unknown as Buffer,
      );

    const result = await injectIssueWikiLinks("/fake/issues", "/fake/wiki");

    expect(result.totalIssues).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);

    // Verify wiki links were appended
    const calls = vi.mocked(fs.writeFile).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const writeCallArg = calls[0]?.[1] as string;
    expect(writeCallArg).toContain("## 📖 相关 Wiki 页面");
    expect(writeCallArg).toContain("volume-1-code/ch-components/Button");
  });

  it("skips issues that already have wiki links section", async () => {
    mockGlobby
      .mockResolvedValueOnce(["ch-components/Button.md"]) // wiki files (first)
      .mockResolvedValueOnce(["ch-01-bugs/IS-0001-MEDIUM.md"]); // issue files (second)

    const alreadyInjected =
      makeIssueMd(["src/Button.tsx"]) +
      "\n## 📖 相关 Wiki 页面\n\n- [[volume-1-code/ch-components/Button]]\n";
    mockReadFile
      .mockResolvedValueOnce(
        makeWikiPageMd(["src/Button.tsx"]) as unknown as Buffer,
      )
      .mockResolvedValueOnce(alreadyInjected as unknown as Buffer);

    const result = await injectIssueWikiLinks("/fake/issues", "/fake/wiki");

    expect(result.totalIssues).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("dry run does not write files", async () => {
    mockGlobby
      .mockResolvedValueOnce(["ch-components/Button.md"]) // wiki files (first)
      .mockResolvedValueOnce(["ch-01-bugs/IS-0001-MEDIUM.md"]); // issue files (second)

    mockReadFile
      .mockResolvedValueOnce(
        makeWikiPageMd(["src/Button.tsx"]) as unknown as Buffer,
      )
      .mockResolvedValueOnce(
        makeIssueMd(["src/Button.tsx"]) as unknown as Buffer,
      );

    const result = await injectIssueWikiLinks(
      "/fake/issues",
      "/fake/wiki",
      true,
    );

    expect(result.updated).toBe(1);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
