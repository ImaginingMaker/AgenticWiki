import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseIssueFrontmatter,
  extractIssueDescription,
  extractLineNumber,
  classifyChecks,
  checkExportReferences,
  checkCircularInGraph,
  checkFileExists,
  checkLineCount,
  checkAnyCount,
  checkNestingDepth,
  validateIssueContent,
} from "../validate/validate-issue-content.js";

import type { DependencyGraphResult } from "../../types/index.js";

// Mock fs-extra (only need pathExists + readFile)
vi.mock("fs-extra", () => ({
  default: {
    pathExists: vi.fn(),
    readFile: vi.fn(),
  },
}));

import fs from "fs-extra";

const mockPathExists = vi.mocked(
  fs.pathExists,
) as unknown as typeof fs.pathExists;
const mockReadFile = vi.mocked(fs.readFile) as unknown as typeof fs.readFile;

// === Helpers ===

function makeDepGraph(
  overrides?: Partial<DependencyGraphResult>,
): DependencyGraphResult {
  return {
    generatedAt: "2024-01-01",
    modules: [],
    cycles: [],
    hotspots: { mostDepended: [], mostDependent: [] },
    ...overrides,
  };
}

// === Pure helpers: NO mocking needed ===

describe("parseIssueFrontmatter", () => {
  it("parses basic frontmatter", () => {
    const content = `---
id: IS-0001-HIGH
type: dead_code
severity: high
---
Content here`;
    const result = parseIssueFrontmatter(content);
    expect(result).toBeDefined();
    expect(result!.id).toBe("IS-0001-HIGH");
    expect(result!.type).toBe("dead_code");
    expect(result!.severity).toBe("high");
  });

  it("normalizes issueId → id (SubAgent output compat)", () => {
    const content = `---
issueId: IS-0001-HIGH
type: bug
severity: critical
---
Content`;
    const result = parseIssueFrontmatter(content);
    expect(result).toBeDefined();
    expect(result!.id).toBe("IS-0001-HIGH");
    // issueId should not exist as a separate key after normalization
    expect(result!.issueId).toBeUndefined();
  });

  it("returns null for content without frontmatter", () => {
    expect(parseIssueFrontmatter("# Just a heading")).toBeNull();
  });

  it("parses list values", () => {
    const content = `---
id: IS-0001
type: complex_logic
source_files: ["src/a.ts", "src/b.ts"]
---
Body`;
    const result = parseIssueFrontmatter(content);
    expect(result!.source_files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns null for empty content", () => {
    expect(parseIssueFrontmatter("")).toBeNull();
  });
});

describe("extractIssueDescription", () => {
  it("extracts from **位置** pattern", () => {
    const content = "**位置**：`src/button/Button.tsx` — `Button`";
    expect(extractIssueDescription(content)).toBe("src/button/Button.tsx");
  });

  it("extracts from backtick file:line pattern", () => {
    const content = "在 `src/utils/helper.ts:42` 中发现了问题";
    expect(extractIssueDescription(content)).toBe("src/utils/helper.ts");
  });

  it("returns empty when no pattern matches", () => {
    expect(extractIssueDescription("no location here")).toBe("");
  });

  it("returns empty for empty string", () => {
    expect(extractIssueDescription("")).toBe("");
  });
});

describe("extractLineNumber", () => {
  it("extracts line number from backtick path", () => {
    expect(extractLineNumber("在 `src/a.ts:42` 中")).toBe(42);
  });

  it("extracts line number from **位置** pattern", () => {
    expect(extractLineNumber("**位置**：`src/a.ts:99`")).toBe(99);
  });

  it("returns null when no line number", () => {
    expect(extractLineNumber("no line here")).toBeNull();
  });
});

describe("classifyChecks", () => {
  // ── Current 3-tier types (P0/P1/P2) ──

  it("adds circular_in_graph for bug (P0)", () => {
    const checks = classifyChecks({
      id: "I1",
      file: "a.md",
      issueType: "bug",
      sourceFiles: ["a.ts"],
      description: "",
      lineNumber: null,
    });
    expect(checks).toContain("file_exists");
    expect(checks).toContain("circular_in_graph");
    expect(checks).toHaveLength(2);
  });

  it("adds any_count for typescript (P1)", () => {
    const checks = classifyChecks({
      id: "I1",
      file: "a.md",
      issueType: "typescript",
      sourceFiles: ["a.ts"],
      description: "",
      lineNumber: null,
    });
    expect(checks).toContain("any_count");
    expect(checks).not.toContain("line_count");
  });

  it("adds line_count and nesting_depth for complexity (P2)", () => {
    const checks = classifyChecks({
      id: "I1",
      file: "a.md",
      issueType: "complexity",
      sourceFiles: ["a.ts"],
      description: "",
      lineNumber: null,
    });
    expect(checks).toContain("file_exists");
    expect(checks).toContain("line_count");
    expect(checks).toContain("nesting_depth");
    expect(checks).toHaveLength(3);
  });

  it("adds export_references for dead_code (P2)", () => {
    const checks = classifyChecks({
      id: "I1",
      file: "a.md",
      issueType: "dead_code",
      sourceFiles: ["a.ts"],
      description: "",
      lineNumber: null,
    });
    expect(checks).toContain("export_references");
  });

  it("only adds file_exists for semantic-only current types", () => {
    for (const t of ["security", "performance", "maintainability", "ux"]) {
      const checks = classifyChecks({
        id: "I1",
        file: "a.md",
        issueType: t,
        sourceFiles: ["a.ts"],
        description: "",
        lineNumber: null,
      });
      expect(checks).toEqual(["file_exists"]);
    }
  });

  // ── Legacy types (backward compat) ──

  it("adds line_count and nesting_depth for complex_logic (legacy)", () => {
    const checks = classifyChecks({
      id: "I1",
      file: "a.md",
      issueType: "complex_logic",
      sourceFiles: ["a.ts"],
      description: "",
      lineNumber: null,
    });
    expect(checks).toContain("file_exists");
    expect(checks).toContain("line_count");
    expect(checks).toContain("nesting_depth");
  });

  it("adds any_count for missing_types (legacy)", () => {
    const checks = classifyChecks({
      id: "I1",
      file: "a.md",
      issueType: "missing_types",
      sourceFiles: ["a.ts"],
      description: "",
      lineNumber: null,
    });
    expect(checks).toContain("any_count");
    expect(checks).not.toContain("line_count");
  });

  it("adds export_references for dead_code (legacy — same name)", () => {
    const checks = classifyChecks({
      id: "I1",
      file: "a.md",
      issueType: "dead_code",
      sourceFiles: ["a.ts"],
      description: "",
      lineNumber: null,
    });
    expect(checks).toContain("export_references");
  });

  it("adds circular_in_graph for circular_dependency (legacy)", () => {
    const checks = classifyChecks({
      id: "I1",
      file: "a.md",
      issueType: "circular_dependency",
      sourceFiles: ["a.ts"],
      description: "",
      lineNumber: null,
    });
    expect(checks).toContain("circular_in_graph");
  });

  it("only adds file_exists for potential_bug and inconsistent_api (legacy)", () => {
    for (const t of ["potential_bug", "inconsistent_api"]) {
      const checks = classifyChecks({
        id: "I1",
        file: "a.md",
        issueType: t,
        sourceFiles: ["a.ts"],
        description: "",
        lineNumber: null,
      });
      expect(checks).toEqual(["file_exists"]);
    }
  });

  it("always includes file_exists first", () => {
    const checks = classifyChecks({
      id: "I1",
      file: "a.md",
      issueType: "complexity",
      sourceFiles: ["a.ts"],
      description: "",
      lineNumber: null,
    });
    expect(checks[0]).toBe("file_exists");
  });
});

// === Pure dep-graph checks: NO mocking needed ===

describe("checkExportReferences", () => {
  it("returns passed=false when module not in graph", async () => {
    const depGraph = makeDepGraph({ modules: [] });
    const result = await checkExportReferences(
      "I1",
      "a.md",
      "src/unknown.ts",
      depGraph,
    );
    expect(result.passed).toBe(false);
    expect(result.actual).toBe("MODULE_NOT_IN_GRAPH");
  });

  it("returns passed=true when module has 0 dependents", async () => {
    const depGraph = makeDepGraph({
      modules: [
        {
          source: "src/dead.ts",
          dependencies: [],
          dependents: [],
          hasCircular: false,
        },
      ],
    });
    const result = await checkExportReferences(
      "I1",
      "a.md",
      "src/dead.ts",
      depGraph,
    );
    expect(result.passed).toBe(true);
    expect(result.actual).toBe("0");
  });

  it("returns passed=false when module has dependents", async () => {
    const depGraph = makeDepGraph({
      modules: [
        {
          source: "src/used.ts",
          dependencies: [],
          dependents: ["src/importer.ts"],
          hasCircular: false,
        },
      ],
    });
    const result = await checkExportReferences(
      "I1",
      "a.md",
      "src/used.ts",
      depGraph,
    );
    expect(result.passed).toBe(false);
    expect(result.actual).toBe("1");
  });
});

describe("checkCircularInGraph", () => {
  it("returns passed=true when file is in a cycle", async () => {
    const depGraph = makeDepGraph({
      cycles: [
        {
          path: ["src/a.ts", "src/b.ts", "src/a.ts"],
          severity: "high",
          description: "cycle",
        },
      ],
    });
    const result = await checkCircularInGraph(
      "I1",
      "a.md",
      ["src/a.ts", "src/c.ts"],
      depGraph,
    );
    expect(result.passed).toBe(true);
    expect(result.actual).toContain("Found");
  });

  it("returns passed=false when no file is in any cycle", async () => {
    const depGraph = makeDepGraph({
      cycles: [
        {
          path: ["src/x.ts", "src/y.ts"],
          severity: "high",
          description: "cycle",
        },
      ],
    });
    const result = await checkCircularInGraph(
      "I1",
      "a.md",
      ["src/a.ts"],
      depGraph,
    );
    expect(result.passed).toBe(false);
    expect(result.actual).toBe("No match found");
  });

  it("handles empty cycles array", async () => {
    const depGraph = makeDepGraph({ cycles: [] });
    const result = await checkCircularInGraph(
      "I1",
      "a.md",
      ["src/a.ts"],
      depGraph,
    );
    expect(result.passed).toBe(false);
  });
});

// === I/O checks: need fs-extra mock ===

describe("checkFileExists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns passed=true when file exists", async () => {
    mockPathExists.mockResolvedValue(true);
    const result = await checkFileExists("I1", "a.md", "src/a.ts", "/root");
    expect(result.passed).toBe(true);
    expect(mockPathExists).toHaveBeenCalledWith("/root/src/a.ts");
  });

  it("returns passed=false when file does not exist", async () => {
    mockPathExists.mockResolvedValue(false);
    const result = await checkFileExists("I1", "a.md", "src/a.ts", "/root");
    expect(result.passed).toBe(false);
  });
});

describe("checkLineCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns passed=true when file exceeds threshold", async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("x\n".repeat(250));
    const result = await checkLineCount("I1", "a.md", "src/big.ts", "/root");
    expect(result.passed).toBe(true);
    expect(result.actual).toBe("251");
  });

  it("returns passed=false when file is under threshold", async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("x\n".repeat(50));
    const result = await checkLineCount("I1", "a.md", "src/small.ts", "/root");
    expect(result.passed).toBe(false);
    expect(result.actual).toBeDefined();
    expect(typeof result.actual).toBe("string");
  });

  it("returns FILE_NOT_FOUND when file missing", async () => {
    mockPathExists.mockResolvedValue(false);
    const result = await checkLineCount(
      "I1",
      "a.md",
      "src/missing.ts",
      "/root",
    );
    expect(result.passed).toBe(false);
    expect(result.actual).toBe("FILE_NOT_FOUND");
  });
});

describe("checkAnyCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts `: any` and `as any` occurrences", async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(
      "const x: any = 1;\n" +
        "const y = foo as any;\n" +
        "const z: any = 3;\n" +
        "const w = bar as any;\n",
    );
    const result = await checkAnyCount("I1", "a.md", "src/any.ts", "/root");
    expect(result.passed).toBe(true);
    expect(result.actual).toBe("4");
  });

  it("returns passed=false when count below threshold", async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("const x: any = 1;\n");
    const result = await checkAnyCount("I1", "a.md", "src/any.ts", "/root");
    expect(result.passed).toBe(false);
    expect(result.actual).toBe("1");
  });
});

describe("checkNestingDepth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects deep nesting", async () => {
    mockPathExists.mockResolvedValue(true);
    // 5 levels of if nesting (10 spaces = 5 levels at 2-space indent)
    mockReadFile.mockResolvedValue(
      "if (a) {\n" +
        "  if (b) {\n" +
        "    if (c) {\n" +
        "      if (d) {\n" +
        "        if (e) {\n" +
        "          return x;\n" +
        "        }\n" +
        "      }\n" +
        "    }\n" +
        "  }\n" +
        "}\n",
    );
    const result = await checkNestingDepth(
      "I1",
      "a.md",
      "src/deep.ts",
      "/root",
    );
    expect(result.passed).toBe(true);
    expect(result.actual).toBeDefined();
    expect(typeof result.actual).toBe("string");
  });

  it("returns passed=false for shallow nesting", async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("const x = 1;\nconst y = 2;\n");
    const result = await checkNestingDepth(
      "I1",
      "a.md",
      "src/shallow.ts",
      "/root",
    );
    expect(result.passed).toBe(false);
  });
});

// === validateIssueContent (orchestrator) ===

describe("validateIssueContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Current types ──

  it("runs correct checks for complexity (P2)", async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("x\n".repeat(300));

    const meta = {
      id: "IS-0001",
      file: "ch-06/complex.md",
      issueType: "complexity" as const,
      sourceFiles: ["src/big.ts"],
      description: "",
      lineNumber: null,
    };
    const results = await validateIssueContent(meta, "/root", null);
    // file_exists + line_count + nesting_depth = 3 checks
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.checkType)).toContain("file_exists");
    expect(results.map((r) => r.checkType)).toContain("line_count");
    expect(results.map((r) => r.checkType)).toContain("nesting_depth");
  });

  it("runs correct checks for bug (P0) with depGraph", async () => {
    mockPathExists.mockResolvedValue(true);
    const depGraph = makeDepGraph({
      cycles: [
        {
          path: ["src/a.ts", "src/b.ts"],
          severity: "high",
          description: "cycle",
        },
      ],
    });
    const meta = {
      id: "IS-0002",
      file: "ch-01/circular.md",
      issueType: "bug" as const,
      sourceFiles: ["src/a.ts"],
      description: "",
      lineNumber: null,
    };
    const results = await validateIssueContent(meta, "/root", depGraph);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.checkType)).toContain("file_exists");
    expect(results.map((r) => r.checkType)).toContain("circular_in_graph");
  });

  it("runs correct checks for typescript (P1)", async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("const x: any = 1;\n");

    const meta = {
      id: "IS-0003",
      file: "ch-03/typescript.md",
      issueType: "typescript" as const,
      sourceFiles: ["src/loose.ts"],
      description: "",
      lineNumber: null,
    };
    const results = await validateIssueContent(meta, "/root", null);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.checkType)).toContain("file_exists");
    expect(results.map((r) => r.checkType)).toContain("any_count");
  });

  it("only runs file_exists for semantic-only types (security)", async () => {
    mockPathExists.mockResolvedValue(true);
    const meta = {
      id: "IS-0004",
      file: "ch-02/security.md",
      issueType: "security" as const,
      sourceFiles: ["src/unsafe.ts"],
      description: "",
      lineNumber: null,
    };
    const results = await validateIssueContent(meta, "/root", null);
    expect(results).toHaveLength(1);
    expect(results[0].checkType).toBe("file_exists");
  });

  // ── Legacy types (backward compat) ──

  it("runs correct checks for complex_logic (legacy)", async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("x\n".repeat(300));

    const meta = {
      id: "IS-0001",
      file: "ch-04/complex.md",
      issueType: "complex_logic" as const,
      sourceFiles: ["src/big.ts"],
      description: "",
      lineNumber: null,
    };
    const results = await validateIssueContent(meta, "/root", null);
    // file_exists + line_count + nesting_depth = 3 checks
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.checkType)).toContain("file_exists");
    expect(results.map((r) => r.checkType)).toContain("line_count");
    expect(results.map((r) => r.checkType)).toContain("nesting_depth");
  });

  it("runs correct checks for circular_dependency with depGraph (legacy)", async () => {
    const depGraph = makeDepGraph({
      cycles: [
        {
          path: ["src/a.ts", "src/b.ts"],
          severity: "high",
          description: "cycle",
        },
      ],
    });
    const meta = {
      id: "IS-0002",
      file: "ch-01/circular.md",
      issueType: "circular_dependency" as const,
      sourceFiles: ["src/a.ts"],
      description: "",
      lineNumber: null,
    };
    const results = await validateIssueContent(meta, "/root", depGraph);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.checkType)).toContain("file_exists");
    expect(results.map((r) => r.checkType)).toContain("circular_in_graph");
  });

  it("runs check per source file", async () => {
    mockPathExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue("x\n".repeat(300));

    const meta = {
      id: "IS-0003",
      file: "multi.md",
      issueType: "complexity" as const,
      sourceFiles: ["src/a.ts", "src/b.ts"],
      description: "",
      lineNumber: null,
    };
    const results = await validateIssueContent(meta, "/root", null);
    // 2 files × 3 checks each = 6 checks
    expect(results).toHaveLength(6);
  });
});
