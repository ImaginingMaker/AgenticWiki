import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module
vi.mock("globby", () => ({ globby: vi.fn() }));
vi.mock("gray-matter", () => ({ default: vi.fn() }));
vi.mock("fs-extra", () => ({ default: { readFile: vi.fn(), pathExists: vi.fn() } }));

import { globby } from "globby";
import matter from "gray-matter";
import fs from "fs-extra";
import { validateCodeRefs, extractWikiSymbols } from "../validate/validate-code-refs.js";

const mockGlobby = vi.mocked(globby);
const mockMatter = vi.mocked(matter);
const mockReadFile = vi.mocked(fs.readFile);
const mockPathExists = vi.mocked(fs.pathExists);

// ─── extractWikiSymbols (pure function, no mocks needed) ───

describe("extractWikiSymbols", () => {
  it("extracts backtick-wrapped H2/H3 names", () => {
    const content = [
      "## `Button`",
      "Some description",
      "### `useToggle`",
      "Details here",
      "## `Input`",
      "",
    ].join("\n");

    const result = extractWikiSymbols(content);

    expect(result).toEqual(["Button", "useToggle", "Input"]);
  });

  it("skips names shorter than 2 characters", () => {
    const content = [
      "## `A`",
      "### `B`",
      "## `Ab`",
      "### `Bc`",
    ].join("\n");

    const result = extractWikiSymbols(content);

    // "A" and "B" are < 2 chars, skipped
    expect(result).toEqual(["Ab", "Bc"]);
  });

  it("deduplicates symbols that appear in multiple headings", () => {
    const content = [
      "## `Button`",
      "Description",
      "### `Button`",
      "More details",
      "## `Icon`",
      "## `Button`",
    ].join("\n");

    const result = extractWikiSymbols(content);

    expect(result).toEqual(["Button", "Icon"]);
  });

  it("returns empty array when there are no headings", () => {
    const content = "Just some text without any headings.\n\nA paragraph.";

    const result = extractWikiSymbols(content);

    expect(result).toEqual([]);
  });

  it("only matches backtick-wrapped headings, not plain headings", () => {
    const content = [
      "## Button",
      "### `useToggle`",
      "## `Valid`",
      "# Not checked (H1)",
    ].join("\n");

    const result = extractWikiSymbols(content);

    // "Button" is not backtick-wrapped, H1 is not checked
    expect(result).toEqual(["useToggle", "Valid"]);
  });
});

// ─── validateCodeRefs ───

describe("validateCodeRefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultDepGraph = {
    modules: [
      {
        source: "src/App.tsx",
        dependencies: [],
        dependents: ["src/utils.ts"],
        hasCircular: false,
      },
    ],
    cycles: [],
    hotspots: { mostDepended: [], mostDependent: [] },
    generatedAt: "2024-01-01",
  };

  it("returns empty report when wiki has no markdown files", async () => {
    mockGlobby.mockResolvedValue([]);

    const report = await validateCodeRefs("/fake/wiki", "/fake/src", defaultDepGraph);

    expect(report.totalWikiPages).toBe(0);
    expect(report.totalChecks).toBe(0);
    expect(report.checks).toEqual([]);
    expect(report.summary.passed).toBe(0);
    expect(report.summary.failed).toBe(0);
  });

  it("passes check when source file exists", async () => {
    mockGlobby.mockResolvedValue(["ch-01/Button.md"]);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("Button.md")) {
        return `---
sourceFiles: ["src/App.tsx"]
---

## \`App\`
Documentation for App component.
`;
      }
      // Source file content
      return "export function App() { return <div />; }\n";
    });
    mockMatter.mockReturnValue({
      data: { sourceFiles: ["src/App.tsx"] },
      content: "\n## `App`\nDocumentation for App component.\n",
    } as any);
    mockPathExists.mockResolvedValue(true);

    const report = await validateCodeRefs("/fake/wiki", "/fake/src", defaultDepGraph);

    // file_exists check: passed, symbol_in_file: passed, dep_consistency: info (passed)
    expect(report.totalWikiPages).toBe(1);
    expect(report.totalChecks).toBe(3);

    const fileExistsCheck = report.checks.find((c) => c.checkType === "file_exists");
    expect(fileExistsCheck).toBeDefined();
    expect(fileExistsCheck!.passed).toBe(true);
    expect(fileExistsCheck!.severity).toBe("error");
    expect(fileExistsCheck!.actual).toBe("EXISTS");
  });

  it("fails when source file does not exist", async () => {
    mockGlobby.mockResolvedValue(["ch-01/MissingFile.md"]);
    mockReadFile.mockResolvedValue(`---
sourceFiles: ["src/Gone.tsx"]
---

## \`Gone\`
`);
    mockMatter.mockReturnValue({
      data: { sourceFiles: ["src/Gone.tsx"] },
      content: "\n## `Gone`\n",
    } as any);
    mockPathExists.mockResolvedValue(false);

    const report = await validateCodeRefs("/fake/wiki", "/fake/src", null);

    // Only file_exists check runs (no depGraph)
    expect(report.totalChecks).toBe(2); // file_exists + symbol_in_file
    const fileExistsCheck = report.checks.find((c) => c.checkType === "file_exists");
    expect(fileExistsCheck).toBeDefined();
    expect(fileExistsCheck!.passed).toBe(false);
    expect(fileExistsCheck!.severity).toBe("error");
    expect(fileExistsCheck!.actual).toBe("NOT_FOUND");

    // Symbol check should also fail with FILE_NOT_FOUND
    const symCheck = report.checks.find((c) => c.checkType === "symbol_in_file");
    expect(symCheck).toBeDefined();
    expect(symCheck!.passed).toBe(false);
    expect(symCheck!.severity).toBe("warning");
    expect(symCheck!.actual).toBe("FILE_NOT_FOUND");
  });

  it("passes symbol check when symbol is found in source file (via general word boundary)", async () => {
    mockGlobby.mockResolvedValue(["ch-01/Button.md"]);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("Button.md")) {
        return `---
sourceFiles: ["src/App.tsx"]
---

## \`App\`
`;
      }
      // Source file — symbol appears as a word, not as a declaration
      return `const App = () => <div />;\n`;
    });
    mockMatter.mockReturnValue({
      data: { sourceFiles: ["src/App.tsx"] },
      content: "\n## `App`\n",
    } as any);
    mockPathExists.mockResolvedValue(true);

    const report = await validateCodeRefs("/fake/wiki", "/fake/src", null);

    const symCheck = report.checks.find((c) => c.checkType === "symbol_in_file");
    expect(symCheck).toBeDefined();
    expect(symCheck!.passed).toBe(true);
    expect(symCheck!.actual).toBe("FOUND");
  });

  it("fails symbol check when symbol is NOT found in source file", async () => {
    mockGlobby.mockResolvedValue(["ch-01/MissingSym.md"]);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("MissingSym.md")) {
        return `---
sourceFiles: ["src/App.tsx"]
---

## \`NonExistent\`
`;
      }
      // Source file does NOT contain NonExistent
      return `export function App() { return <div />; }\n`;
    });
    mockMatter.mockReturnValue({
      data: { sourceFiles: ["src/App.tsx"] },
      content: "\n## `NonExistent`\n",
    } as any);
    mockPathExists.mockResolvedValue(true);

    const report = await validateCodeRefs("/fake/wiki", "/fake/src", null);

    const symCheck = report.checks.find((c) => c.checkType === "symbol_in_file");
    expect(symCheck).toBeDefined();
    expect(symCheck!.passed).toBe(false);
    expect(symCheck!.severity).toBe("warning");
    expect(symCheck!.actual).toBe("NOT_FOUND");
    expect(symCheck!.detail).toContain("not found");
  });

  it("adds warning when wiki page has no sourceFiles in frontmatter", async () => {
    mockGlobby.mockResolvedValue(["ch-01/NoRefs.md"]);
    mockReadFile.mockResolvedValue(`---
tags: ["react"]
---

## \`Something\`
`);
    mockMatter.mockReturnValue({
      data: { tags: ["react"] },
      content: "\n## `Something`\n",
    } as any);

    const report = await validateCodeRefs("/fake/wiki", "/fake/src", null);

    const noSourceCheck = report.checks.find((c) => c.sourceFile === "(none)");
    expect(noSourceCheck).toBeDefined();
    expect(noSourceCheck!.passed).toBe(false);
    expect(noSourceCheck!.severity).toBe("warning");
    expect(noSourceCheck!.detail).toContain("no sourceFiles");
  });

  it("with depGraph: detects circular dependencies as error", async () => {
    const depGraphWithCycle = {
      modules: [
        {
          source: "src/CircularA.ts",
          dependencies: [],
          dependents: ["src/CircularB.ts"],
          hasCircular: true,
        },
      ],
      cycles: [
        {
          path: ["src/CircularA.ts", "src/CircularB.ts", "src/CircularA.ts"],
          severity: "error",
          description: "Circular dependency detected",
        },
      ],
      hotspots: { mostDepended: [], mostDependent: [] },
      generatedAt: "2024-01-01",
    };

    mockGlobby.mockResolvedValue(["ch-01/Circular.md"]);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("Circular.md")) {
        return `---
sourceFiles: ["src/CircularA.ts"]
---

## \`Something\`
`;
      }
      return "export function Something() {}\n";
    });
    mockMatter.mockReturnValue({
      data: { sourceFiles: ["src/CircularA.ts"] },
      content: "\n## `Something`\n",
    } as any);
    mockPathExists.mockResolvedValue(true);

    const report = await validateCodeRefs("/fake/wiki", "/fake/src", depGraphWithCycle);

    const depCheck = report.checks.find((c) => c.checkType === "dep_consistency");
    expect(depCheck).toBeDefined();
    expect(depCheck!.passed).toBe(false);
    expect(depCheck!.severity).toBe("error");
    expect(depCheck!.detail).toContain("Circular dependency");
    expect(depCheck!.actual).toContain("CYCLE");
  });

  it("with depGraph: clean module gets passing info check", async () => {
    mockGlobby.mockResolvedValue(["ch-01/Clean.md"]);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("Clean.md")) {
        return `---
sourceFiles: ["src/App.tsx"]
---

## \`App\`
`;
      }
      return "export function App() {}\n";
    });
    mockMatter.mockReturnValue({
      data: { sourceFiles: ["src/App.tsx"] },
      content: "\n## `App`\n",
    } as any);
    mockPathExists.mockResolvedValue(true);

    const report = await validateCodeRefs("/fake/wiki", "/fake/src", defaultDepGraph);

    const depCheck = report.checks.find(
      (c) => c.checkType === "dep_consistency" && c.severity === "info",
    );
    expect(depCheck).toBeDefined();
    expect(depCheck!.passed).toBe(true);
    expect(depCheck!.actual).toBe("OK");
    expect(depCheck!.detail).toContain("No circular dependency");
  });

  it("with depGraph: hot module (>=10 dependents) adds extra info check", async () => {
    const depGraphHot = {
      modules: [
        {
          source: "src/HotModule.ts",
          dependencies: [],
          dependents: Array.from({ length: 10 }, (_, i) => `src/dep${i}.ts`),
          hasCircular: false,
        },
      ],
      cycles: [],
      hotspots: { mostDepended: [], mostDependent: [] },
      generatedAt: "2024-01-01",
    };

    mockGlobby.mockResolvedValue(["ch-01/Hot.md"]);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("Hot.md")) {
        return `---
sourceFiles: ["src/HotModule.ts"]
---

## \`Hot\`
`;
      }
      return "export function Hot() {}\n";
    });
    mockMatter.mockReturnValue({
      data: { sourceFiles: ["src/HotModule.ts"] },
      content: "\n## `Hot`\n",
    } as any);
    mockPathExists.mockResolvedValue(true);

    const report = await validateCodeRefs("/fake/wiki", "/fake/src", depGraphHot);

    // Should have 4 checks: file_exists + symbol_in_file + 2 dep_consistency
    expect(report.totalChecks).toBe(4);

    const depChecks = report.checks.filter((c) => c.checkType === "dep_consistency");
    expect(depChecks).toHaveLength(2);

    const hotCheck = depChecks.find((c) => c.detail.includes("hot module"));
    expect(hotCheck).toBeDefined();
    expect(hotCheck!.passed).toBe(true);
    expect(hotCheck!.severity).toBe("info");
    expect(hotCheck!.actual).toBe("10 dependents");
  });

  it("with depGraph: module not in graph produces warning", async () => {
    mockGlobby.mockResolvedValue(["ch-01/External.md"]);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("External.md")) {
        return `---
sourceFiles: ["src/External.ts"]
---

## \`Ext\`
`;
      }
      return "export function Ext() {}\n";
    });
    mockMatter.mockReturnValue({
      data: { sourceFiles: ["src/External.ts"] },
      content: "\n## `Ext`\n",
    } as any);
    mockPathExists.mockResolvedValue(true);

    const report = await validateCodeRefs("/fake/wiki", "/fake/src", defaultDepGraph);

    // src/External.ts is NOT in defaultDepGraph.modules
    const depCheck = report.checks.find((c) => c.checkType === "dep_consistency");
    expect(depCheck).toBeDefined();
    expect(depCheck!.passed).toBe(false);
    expect(depCheck!.severity).toBe("warning");
    expect(depCheck!.actual).toBe("NOT_IN_GRAPH");
  });

  it("multiple pages, multiple checks: correct summary counts", async () => {
    // Page 1: single sourceFile, single symbol — all pass
    // Page 2: single sourceFile, single symbol — file NOT found
    // Page 3: no sourceFiles — warning
    mockGlobby.mockResolvedValue([
      "ch-01/Good.md",
      "ch-02/Bad.md",
      "ch-03/Empty.md",
    ]);

    // Mock readFile: wiki pages
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("Good.md")) {
        return `---
sourceFiles: ["src/App.tsx"]
---

## \`App\`
`;
      }
      if (filePath.includes("Bad.md")) {
        return `---
sourceFiles: ["src/Gone.tsx"]
---

## \`Missing\`
`;
      }
      if (filePath.includes("Empty.md")) {
        return "---\ntags: []\n---\n\nNo source files.";
      }
      // Source file content
      return "export function App() {}\n";
    });

    mockMatter.mockImplementation((content: string) => {
      if (content.includes("Good.md") || content.includes("App")) {
        return {
          data: { sourceFiles: ["src/App.tsx"] },
          content: "\n## `App`\n",
        } as any;
      }
      if (content.includes("Bad.md") || content.includes("Gone")) {
        return {
          data: { sourceFiles: ["src/Gone.tsx"] },
          content: "\n## `Missing`\n",
        } as any;
      }
      return {
        data: { tags: [] },
        content: "\nNo source files.\n",
      } as any;
    });

    // pathExists: src/App.tsx exists, src/Gone.tsx doesn't
    mockPathExists.mockImplementation(async (filePath: string) => {
      return filePath.includes("App.tsx");
    });

    const report = await validateCodeRefs("/fake/wiki", "/fake/src", null);

    // Good page: file_exists(pass) + symbol_in_file(pass) = 2 passed
    // Bad page: file_exists(fail) + symbol_in_file(fail, FILE_NOT_FOUND) = 0 passed, 2 failed
    // Empty page: no sourceFiles warning = 0 passed, 1 failed
    expect(report.totalWikiPages).toBe(3);
    expect(report.totalChecks).toBe(5);
    expect(report.summary.passed).toBe(2);
    expect(report.summary.failed).toBe(3);
    expect(report.summary.errors).toBe(1);   // file_exists for Gone.tsx is error
    expect(report.summary.warnings).toBe(2);  // symbol_in_file FILE_NOT_FOUND + no sourceFiles
  });

  it("handles sourceFiles as a string (not array) in frontmatter", async () => {
    mockGlobby.mockResolvedValue(["ch-01/StringRef.md"]);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("StringRef.md")) {
        return `---
sourceFiles: "src/App.tsx"
---

## \`App\`
`;
      }
      return "export function App() {}\n";
    });
    mockMatter.mockReturnValue({
      data: { sourceFiles: "src/App.tsx" },
      content: "\n## `App`\n",
    } as any);
    mockPathExists.mockResolvedValue(true);

    const report = await validateCodeRefs("/fake/wiki", "/fake/src", null);

    // Should have processed the string sourceFiles correctly
    const fileCheck = report.checks.find((c) => c.checkType === "file_exists");
    expect(fileCheck).toBeDefined();
    expect(fileCheck!.sourceFile).toBe("src/App.tsx");
    expect(fileCheck!.passed).toBe(true);
  });

  it("searches for symbol correctly when it matches a named export declaration", async () => {
    mockGlobby.mockResolvedValue(["ch-01/ExportSym.md"]);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("ExportSym.md")) {
        return `---
sourceFiles: ["src/components/Header.ts"]
---

## \`Header\`
### \`useHeader\`
`;
      }
      // Source file has named exports
      return [
        "export function Header() {",
        '  return <header>Title</header>;',
        "}",
        "",
        "export function useHeader() {",
        "  return { title: 'Hello' };",
        "}",
      ].join("\n");
    });
    mockMatter.mockReturnValue({
      data: { sourceFiles: ["src/components/Header.ts"] },
      content: "\n## `Header`\n### `useHeader`\n",
    } as any);
    mockPathExists.mockResolvedValue(true);

    const report = await validateCodeRefs("/fake/wiki", "/fake/src", null);

    const symChecks = report.checks.filter((c) => c.checkType === "symbol_in_file");
    expect(symChecks).toHaveLength(2);

    expect(symChecks[0].passed).toBe(true);
    expect(symChecks[0].expected).toContain("Header");
    expect(symChecks[1].passed).toBe(true);
    expect(symChecks[1].expected).toContain("useHeader");
  });
});
