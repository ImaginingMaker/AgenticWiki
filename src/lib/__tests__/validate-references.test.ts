import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module
vi.mock("globby", () => ({
  globby: vi.fn(),
}));

vi.mock("gray-matter", () => ({
  default: vi.fn(),
}));

vi.mock("fs-extra", () => ({
  default: {
    readFile: vi.fn(),
  },
}));

import { globby } from "globby";
import matter from "gray-matter";
import fs from "fs-extra";
import { validateReferences } from "../validate-references.js";

const mockGlobby = vi.mocked(globby);
const mockMatter = vi.mocked(matter) as any;
const mockReadFile = vi.mocked(fs.readFile) as any;

describe("validateReferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty issues for valid wiki with all fields", async () => {
    mockGlobby.mockResolvedValue(["/wiki/Components.md", "/wiki/Hooks.md"]);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("Components")) {
        return `---
tags: ["react"]
lastUpdated: "2024-01-01"
sourceFiles: ["src/App.tsx"]
---
# Components
See [[Hooks]]
`;
      }
      return `---
tags: ["react"]
lastUpdated: "2024-01-01"
sourceFiles: ["src/hooks.ts"]
---
# Hooks
`;
    });
    mockMatter.mockImplementation((content: string) => {
      if (content.includes("Components")) {
        return {
          data: {
            tags: ["react"],
            lastUpdated: "2024-01-01",
            sourceFiles: ["src/App.tsx"],
          },
          content: "\n# Components\nSee [[Hooks]]\n",
        } as any;
      }
      return {
        data: {
          tags: ["react"],
          lastUpdated: "2024-01-01",
          sourceFiles: ["src/hooks.ts"],
        },
        content: "\n# Hooks\n",
      } as any;
    });

    const issues = await validateReferences("/wiki");

    expect(issues).toHaveLength(0);
  });

  it("should detect missing sourceFiles as error", async () => {
    mockGlobby.mockResolvedValue(["/wiki/Page.md"]);
    mockReadFile.mockResolvedValue(`---
tags: ["react"]
lastUpdated: "2024-01-01"
---
Content here
`);
    mockMatter.mockReturnValue({
      data: {
        tags: ["react"],
        lastUpdated: "2024-01-01",
      },
      content: "\nContent here\n",
    } as any);

    const issues = await validateReferences("/wiki");

    const sourceFileIssue = issues.find((i) =>
      i.message.includes("sourceFiles"),
    );
    expect(sourceFileIssue).toBeDefined();
    expect(sourceFileIssue!.severity).toBe("error");
    expect(sourceFileIssue!.type).toBe("missing_frontmatter");
  });

  it("should detect missing warning-level frontmatter fields", async () => {
    mockGlobby.mockResolvedValue(["/wiki/Page.md"]);
    mockReadFile.mockResolvedValue(`---
sourceFiles: ["src/a.ts"]
---
Content
`);
    mockMatter.mockReturnValue({
      data: { sourceFiles: ["src/a.ts"] },
      content: "\nContent\n",
    } as any);

    const issues = await validateReferences("/wiki");

    expect(issues.some((i) => i.message.includes("tags"))).toBe(true);
    expect(issues.some((i) => i.message.includes("lastUpdated"))).toBe(true);
    // All missing fields except sourceFiles should be warnings
    const warningIssues = issues.filter(
      (i) => i.severity === "warning" && i.type === "missing_frontmatter",
    );
    expect(warningIssues).toHaveLength(2);
  });

  it("should detect broken wikilinks", async () => {
    mockGlobby.mockResolvedValue(["/wiki/Page.md"]);
    mockReadFile.mockResolvedValue(`---
tags: []
lastUpdated: "2024-01-01"
sourceFiles: ["a.ts"]
analysisVersion: "1.0"
---
See [[NonExistent]]
`);
    mockMatter.mockReturnValue({
      data: {
        tags: [],
        lastUpdated: "2024-01-01",
        sourceFiles: ["a.ts"],
      },
      content: "\nSee [[NonExistent]]\n",
    } as any);

    const issues = await validateReferences("/wiki");

    const brokenLink = issues.find((i) => i.type === "broken_link");
    expect(brokenLink).toBeDefined();
    expect(brokenLink!.severity).toBe("warning");
    expect(brokenLink!.message).toContain("NonExistent");
    expect(brokenLink!.suggestion).toContain("NonExistent.md");
  });

  it("should detect empty string frontmatter fields as missing", async () => {
    mockGlobby.mockResolvedValue(["/wiki/Page.md"]);
    mockReadFile.mockResolvedValue(`---
tags: ""
lastUpdated: ""
sourceFiles: ""
---
Content
`);
    mockMatter.mockReturnValue({
      data: { tags: "", lastUpdated: "", sourceFiles: "" },
      content: "\nContent\n",
    } as any);

    const issues = await validateReferences("/wiki");

    const missingFieldIssues = issues.filter(
      (i) => i.type === "missing_frontmatter",
    );
    expect(missingFieldIssues).toHaveLength(3);
  });

  it("should skip duplicate wikilinks in the same file", async () => {
    mockGlobby.mockResolvedValue(["/wiki/A.md", "/wiki/B.md"]);
    mockReadFile.mockResolvedValue(`---
tags: []
lastUpdated: "2024-01-01"
sourceFiles: ["a.ts"]
---
See [[B]] and also [[B]] again
`);
    mockMatter.mockReturnValue({
      data: {
        tags: [],
        lastUpdated: "2024-01-01",
        sourceFiles: ["a.ts"],
      },
      content: "\nSee [[B]] and also [[B]] again\n",
    } as any);

    const issues = await validateReferences("/wiki");

    const brokenLinks = issues.filter((i) => i.type === "broken_link");
    // B exists, so no broken links at all
    expect(brokenLinks).toHaveLength(0);
  });

  it("should handle wiki with no markdown files", async () => {
    mockGlobby.mockResolvedValue([]);

    const issues = await validateReferences("/wiki");

    expect(issues).toHaveLength(0);
  });

  it("should validate valid wikilinks that resolve to existing pages", async () => {
    mockGlobby.mockResolvedValue(["/wiki/Components.md", "/wiki/Utils.md"]);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("Components")) {
        return `---
tags: []
lastUpdated: "2024-01-01"
sourceFiles: ["a.ts"]
---
See [[Utils]]
`;
      }
      return `---
tags: []
lastUpdated: "2024-01-01"
sourceFiles: ["b.ts"]
---
See [[Components]]
`;
    });
    mockMatter.mockImplementation((content: string) => {
      if (content.includes("Components") && content.includes("Utils")) {
        return {
          data: {
            tags: [],
            lastUpdated: "2024-01-01",
            sourceFiles: ["a.ts"],
          },
          content: "\nSee [[Utils]]\n",
        } as any;
      }
      return {
        data: {
          tags: [],
          lastUpdated: "2024-01-01",
          sourceFiles: ["b.ts"],
        },
        content: "\nSee [[Components]]\n",
      } as any;
    });

    const issues = await validateReferences("/wiki");

    const brokenLinks = issues.filter((i) => i.type === "broken_link");
    expect(brokenLinks).toHaveLength(0);
  });

  it("should generate proper issue IDs", async () => {
    mockGlobby.mockResolvedValue(["/wiki/Page.md"]);
    mockReadFile.mockResolvedValue(`---
sourceFiles: ["a.ts"]
---
Content
`);
    mockMatter.mockReturnValue({
      data: { sourceFiles: ["a.ts"] },
      content: "\nContent\n",
    } as any);

    const issues = await validateReferences("/wiki");

    for (const issue of issues) {
      expect(issue.id).toBeTruthy();
      expect(typeof issue.id).toBe("string");
    }
  });

  it("should handle null frontmatter fields as missing", async () => {
    mockGlobby.mockResolvedValue(["/wiki/Page.md"]);
    mockReadFile.mockResolvedValue(`---
tags: null
lastUpdated: null
sourceFiles: null
---
Content
`);
    mockMatter.mockReturnValue({
      data: {
        tags: null,
        lastUpdated: null,
        sourceFiles: null,
      },
      content: "\nContent\n",
    } as any);

    const issues = await validateReferences("/wiki");

    const missingFieldIssues = issues.filter(
      (i) => i.type === "missing_frontmatter",
    );
    expect(missingFieldIssues).toHaveLength(3);
  });

  it("should include file path relative to wikiPath in issues", async () => {
    mockGlobby.mockResolvedValue(["/wiki/sub/Page.md"]);
    mockReadFile.mockResolvedValue(`---
sourceFiles: ["a.ts"]
---
Content
`);
    mockMatter.mockReturnValue({
      data: { sourceFiles: ["a.ts"] },
      content: "\nContent\n",
    } as any);

    const issues = await validateReferences("/wiki");

    for (const issue of issues) {
      expect(issue.file).not.toContain("/wiki/");
    }
  });

  it("should handle multiple broken links in a single file", async () => {
    mockGlobby.mockResolvedValue(["/wiki/Page.md"]);
    mockReadFile.mockResolvedValue(`---
tags: []
lastUpdated: "2024-01-01"
sourceFiles: ["a.ts"]
---
See [[Missing1]] and [[Missing2]]
`);
    mockMatter.mockReturnValue({
      data: {
        tags: [],
        lastUpdated: "2024-01-01",
        sourceFiles: ["a.ts"],
      },
      content: "\nSee [[Missing1]] and [[Missing2]]\n",
    } as any);

    const issues = await validateReferences("/wiki");

    const brokenLinks = issues.filter((i) => i.type === "broken_link");
    expect(brokenLinks).toHaveLength(2);
    expect(brokenLinks.some((l) => l.message.includes("Missing1"))).toBe(true);
    expect(brokenLinks.some((l) => l.message.includes("Missing2"))).toBe(true);
  });
});
