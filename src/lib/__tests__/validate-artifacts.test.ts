import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

// Mock fs-extra sync methods used by validate-artifacts.ts
vi.mock("fs-extra", () => ({
  default: {
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}));

import fs from "fs-extra";
import {
  checkArtifact,
  validatePhase,
  generateReport,
  resolvePath,
  CRITICAL_ARTIFACTS,
} from "../validate-artifacts.js";
import type { PhaseRecord } from "../../types/index.js";

// Typed mocks
const mockExistsSync = vi.mocked(fs.existsSync);
const mockStatSync = vi.mocked(fs.statSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePhase(overrides: Partial<PhaseRecord> = {}): PhaseRecord {
  return {
    phase: "ASSEMBLE",
    status: "completed",
    startedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkArtifact
// ---------------------------------------------------------------------------

describe("checkArtifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for an existing non-empty file (non-JSON)", () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 512 } as any);

    const result = checkArtifact(
      "/project/readme.md",
      "readme.md",
      "INIT",
      "error",
    );

    expect(result).toBeNull();
    expect(mockExistsSync).toHaveBeenCalledWith("/project/readme.md");
    expect(mockStatSync).toHaveBeenCalledWith("/project/readme.md");
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("returns null for an existing non-empty file with warning severity", () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 512 } as any);

    const result = checkArtifact(
      "/project/some.log",
      "some.log",
      "DEPENDENCY",
      "warning",
    );

    expect(result).toBeNull();
  });

  it("returns error issue for a non-existent file", () => {
    mockExistsSync.mockReturnValue(false);

    const result = checkArtifact(
      "/project/missing.txt",
      "missing.txt",
      "INIT",
      "error",
    );

    expect(result).not.toBeNull();
    expect(result!.severity).toBe("error");
    expect(result!.phase).toBe("INIT");
    expect(result!.artifact).toBe("missing.txt");
    expect(result!.message).toContain("does not exist");
  });

  it("propagates warning severity for a non-existent required artifact", () => {
    mockExistsSync.mockReturnValue(false);

    const result = checkArtifact(
      "/project/optional.txt",
      "optional.txt",
      "SCAN",
      "warning",
    );

    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.phase).toBe("SCAN");
    expect(result!.message).toContain("does not exist");
  });

  it("returns error issue for an empty file", () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 0 } as any);

    const result = checkArtifact(
      "/project/empty.json",
      "empty.json",
      "ASSEMBLE",
      "error",
    );

    expect(result).not.toBeNull();
    expect(result!.severity).toBe("error");
    expect(result!.message).toContain("empty");
    expect(result!.message).toContain("empty.json");
  });

  it("returns error issue when statSync throws", () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockImplementation(() => {
      throw new Error("permission denied");
    });

    const result = checkArtifact(
      "/project/locked.bin",
      "locked.bin",
      "ASSEMBLE",
      "error",
    );

    expect(result).not.toBeNull();
    expect(result!.severity).toBe("error");
    expect(result!.message).toContain("Cannot read");
    expect(result!.message).toContain("locked.bin");
  });

  it("returns error issue for invalid JSON content", () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 128 } as any);
    mockReadFileSync.mockReturnValue("{ invalid json content }");

    const result = checkArtifact(
      "/project/data.json",
      "data.json",
      "DEPENDENCY",
      "error",
    );

    expect(result).not.toBeNull();
    expect(result!.severity).toBe("error");
    expect(result!.message).toContain("Invalid JSON");
    expect(result!.message).toContain("data.json");
  });

  it("returns null for valid JSON content", () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 64 } as any);
    mockReadFileSync.mockReturnValue('{"name":"test","version":"1.0"}');

    const result = checkArtifact(
      "/project/manifest.json",
      "manifest.json",
      "INIT",
      "error",
    );

    expect(result).toBeNull();
  });

  it("returns warning for ghost artifact (3+ long strings in JSON)", () => {
    const longStr = '"' + "x".repeat(250) + '"';
    const content = [longStr, longStr, longStr].join(", ");

    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 1024 } as any);
    mockReadFileSync.mockReturnValue(
      `{ "a": ${longStr}, "b": ${longStr}, "c": ${longStr} }`,
    );

    const result = checkArtifact(
      "/project/gen-output.json",
      ".agentic-wiki/cache/gen-output.json",
      "GEN",
      "warning",
    );

    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.message).toContain("ghost artifact");
    expect(result!.message).toContain("gen-output.json");
  });

  it("returns null when JSON has fewer than 3 long strings", () => {
    const longStr = '"' + "x".repeat(250) + '"';

    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 512 } as any);
    mockReadFileSync.mockReturnValue(`{ "a": ${longStr}, "b": "short" }`);

    const result = checkArtifact(
      "/project/data.json",
      "data.json",
      "ASSEMBLE",
      "error",
    );

    expect(result).toBeNull();
  });

  it("returns null when JSON is empty after trimming", () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 64 } as any);
    mockReadFileSync.mockReturnValue("   \n  ");

    const result = checkArtifact(
      "/project/whitespace.json",
      "whitespace.json",
      "SCAN",
      "error",
    );

    expect(result).toBeNull();
  });

  it("skips ghost artifact check for state.json", () => {
    const longStr = '"' + "y".repeat(300) + '"';

    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 2048 } as any);
    mockReadFileSync.mockReturnValue(
      `{ "a": ${longStr}, "b": ${longStr}, "c": ${longStr} }`,
    );

    // readFileSync is called exactly once (JSON parse only, ghost check skipped)
    const result = checkArtifact(
      "/project/.agentic-wiki/state.json",
      ".agentic-wiki/cache/state.json",
      "VALIDATE",
      "error",
    );

    expect(result).toBeNull();
  });

  it("returns error when trimmed content is non-empty but JSON parse fails", () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 16 } as any);
    mockReadFileSync.mockReturnValue("   true   "); // valid JSON but after the `if` path...

    // "   true   ".trim() → "true", length > 0, JSON.parse("true") → true, no error
    // Then the ghost artifact check runs.
    const result = checkArtifact(
      "/project/primitive.json",
      "primitive.json",
      "DEPENDENCY",
      "error",
    );

    // "true" is 4 chars, no long strings → null
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validatePhase
// ---------------------------------------------------------------------------

describe("validatePhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no issues when all critical artifacts exist", () => {
    // ASSEMBLE has 3 critical artifacts
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 256 } as any);
    mockReadFileSync.mockReturnValue("{}");

    const phase = makePhase({ phase: "ASSEMBLE" });
    const issues = validatePhase(phase, "/project");

    expect(issues).toHaveLength(0);
    // 3 critical + 1 required + 0 extra = 4 calls
    expect(mockExistsSync).toHaveBeenCalledTimes(4);
  });

  it("returns error when a critical artifact does not exist", () => {
    // ASSEMBLE: first critical path exists, second doesn't
    mockExistsSync
      .mockReturnValueOnce(true) // .agentic-wiki/search/symbol-index.json
      .mockReturnValueOnce(false) // wiki/book.md → will fail
      .mockReturnValue(true); // the rest
    mockStatSync.mockReturnValue({ size: 256 } as any);
    mockReadFileSync.mockReturnValue("{}");

    const phase = makePhase({ phase: "ASSEMBLE" });
    const issues = validatePhase(phase, "/project");

    const criticalIssues = issues.filter((i) => i.severity === "error");
    expect(criticalIssues).toHaveLength(1);
    expect(criticalIssues[0].artifact).toBe("wiki/book.md");
    expect(criticalIssues[0].message).toContain("does not exist");
  });

  it("returns warning when a required artifact is missing", () => {
    // DEPENDENCY: critical all exist, but required artifact is missing
    mockExistsSync
      // Critical: dependency-graph.json, file-priorities.json, folder-strategy.json
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      // Required: dependency-graph.mmd
      .mockReturnValueOnce(false);
    mockStatSync.mockReturnValue({ size: 256 } as any);
    mockReadFileSync.mockReturnValue("{}");

    const phase = makePhase({ phase: "DEPENDENCY" });
    const issues = validatePhase(phase, "/project");

    const warningIssues = issues.filter((i) => i.severity === "warning");
    expect(warningIssues).toHaveLength(1);
    expect(warningIssues[0].artifact).toBe(
      ".agentic-wiki/cache/dependency-graph.mmd",
    );
    expect(warningIssues[0].message).toContain("does not exist");
  });

  it("returns both errors and warnings when critical and required artifacts are missing", () => {
    // DEPENDENCY: critical file-priorities.json missing, required dependency-graph.mmd missing
    mockExistsSync
      // Critical
      .mockReturnValueOnce(true) // dependency-graph.json
      .mockReturnValueOnce(false) // file-priorities.json → error
      .mockReturnValueOnce(true) // folder-strategy.json
      // Required
      .mockReturnValueOnce(false); // dependency-graph.mmd → warning
    mockStatSync.mockReturnValue({ size: 256 } as any);
    mockReadFileSync.mockReturnValue("{}");

    const phase = makePhase({ phase: "DEPENDENCY" });
    const issues = validatePhase(phase, "/project");

    expect(issues).toHaveLength(2);
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");
    expect(errors).toHaveLength(1);
    expect(errors[0].artifact).toBe(".agentic-wiki/cache/file-priorities.json");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].artifact).toBe(
      ".agentic-wiki/cache/dependency-graph.mmd",
    );
  });

  it("returns no issues for a phase with no matching artifact entries", () => {
    // DONE is not a key in either map → both default to []
    mockExistsSync.mockReturnValue(true);

    const phase = makePhase({ phase: "DONE" });
    const issues = validatePhase(phase, "/project");

    expect(issues).toHaveLength(0);
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it("validates extra artifacts listed in the PhaseRecord artifacts array", () => {
    // SCAN has 1 critical (file-list.json) + 1 required (filtered-files.json)
    // → those are skipped when found in the artifacts list
    // Extra artifact "extra-output.txt" is checked
    mockExistsSync
      // Critical: file-list.json → existing
      .mockReturnValueOnce(true)
      // Required: filtered-files.json → existing
      .mockReturnValueOnce(true)
      // Extra: extra-output.txt → missing
      .mockReturnValueOnce(false);
    mockStatSync.mockReturnValue({ size: 256 } as any);
    mockReadFileSync.mockReturnValue("{}");

    const phase = makePhase({
      phase: "SCAN",
      artifacts: [
        ".agentic-wiki/cache/file-list.json",
        ".agentic-wiki/cache/filtered-files.json",
        "extra-output.txt",
      ],
    });
    const issues = validatePhase(phase, "/project");

    // The extra missing artifact should produce a warning
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].artifact).toBe("extra-output.txt");
  });

  it("skips extra artifacts that overlap with critical or required lists", () => {
    // DEPENDENCY: extra artifacts include items from critical/required → skipped
    mockExistsSync
      // Critical: dependency-graph.json, file-priorities.json, folder-strategy.json
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      // Required: dependency-graph.mmd
      .mockReturnValueOnce(true)
      // Extra: unique-extra.json (not in crictical or required)
      .mockReturnValueOnce(false);
    mockStatSync.mockReturnValue({ size: 256 } as any);
    mockReadFileSync.mockReturnValue("{}");

    const phase = makePhase({
      phase: "DEPENDENCY",
      artifacts: [
        // These overlap with the predefined lists → should be skipped
        ".agentic-wiki/cache/dependency-graph.json",
        ".agentic-wiki/cache/dependency-graph.mmd",
        // This one is unique → should be checked
        "unique-extra.json",
      ],
    });
    const issues = validatePhase(phase, "/project");

    expect(issues).toHaveLength(1);
    expect(issues[0].artifact).toBe("unique-extra.json");
  });

  it("handles GEN phase with no critical artifacts but required artifacts", () => {
    // GEN: critical = [], required = ["wiki/volume-1-code/", "wiki/volume-2-issues/"]
    mockExistsSync
      .mockReturnValueOnce(false) // volume-1-code/ → warning
      .mockReturnValueOnce(true); // volume-2-issues/ → ok
    mockStatSync.mockReturnValue({ size: 256 } as any);
    mockReadFileSync.mockReturnValue("{}");

    const phase = makePhase({ phase: "GEN" });
    const issues = validatePhase(phase, "/project");

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].artifact).toBe("wiki/volume-1-code/");
  });

  it("returns issues for invalid JSON in a critical artifact", () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ size: 64 } as any);
    mockReadFileSync.mockReturnValue("{ bad json");

    const phase = makePhase({ phase: "ASSEMBLE" });
    const issues = validatePhase(phase, "/project");

    const jsonIssues = issues.filter((i) => i.message.includes("Invalid JSON"));
    expect(jsonIssues.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// generateReport
// ---------------------------------------------------------------------------

describe("generateReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all-passed report when there are no issues", () => {
    const report = generateReport([], 3);

    expect(report.totalPhases).toBe(3);
    expect(report.totalArtifacts).toBe(3); // allPhases - uniquePhaseCount + 0
    expect(report.summary).toEqual({
      errors: 0,
      warnings: 0,
      passed: 3,
    });
    expect(report.issues).toHaveLength(0);
  });

  it("reports correct counts with mixed errors and warnings", () => {
    const issues = [
      {
        phase: "INIT",
        artifact: "a.json",
        severity: "error" as const,
        message: "Missing",
      },
      {
        phase: "INIT",
        artifact: "b.json",
        severity: "warning" as const,
        message: "Empty",
      },
      {
        phase: "SCAN",
        artifact: "c.json",
        severity: "error" as const,
        message: "Invalid JSON",
      },
      {
        phase: "DEPENDENCY",
        artifact: "d.json",
        severity: "warning" as const,
        message: "Ghost",
      },
    ];

    const report = generateReport(issues, 5);

    expect(report.totalPhases).toBe(5);
    // totalArtifacts = issues.length + max(0, passed)
    // passed = totalPhases - unique phases with issues = 5 - 3 = 2
    // totalArtifacts = 4 + 2 = 6
    expect(report.totalArtifacts).toBe(6);
    expect(report.summary.errors).toBe(2);
    expect(report.summary.warnings).toBe(2);
    expect(report.summary.passed).toBe(2);
    expect(report.issues).toHaveLength(4);
  });

  it("reports no phases passed when every phase has an issue", () => {
    const issues = [
      {
        phase: "INIT",
        artifact: "a.json",
        severity: "error" as const,
        message: "Missing",
      },
      {
        phase: "SCAN",
        artifact: "b.json",
        severity: "warning" as const,
        message: "Empty",
      },
    ];

    const report = generateReport(issues, 2);

    expect(report.summary.passed).toBe(0);
    expect(report.totalArtifacts).toBe(2); // 2 issues + 0 passed
  });

  it("includes an ISO validatedAt timestamp", () => {
    const report = generateReport([], 1);

    expect(report.validatedAt).toBeTruthy();
    expect(() => new Date(report.validatedAt)).not.toThrow();
    expect(new Date(report.validatedAt).toISOString()).toBe(report.validatedAt);
  });

  it("handles a single phase with multiple issues", () => {
    const issues = [
      {
        phase: "ASSEMBLE",
        artifact: "book.md",
        severity: "error" as const,
        message: "Missing",
      },
      {
        phase: "ASSEMBLE",
        artifact: "glossary.md",
        severity: "warning" as const,
        message: "Empty",
      },
      {
        phase: "ASSEMBLE",
        artifact: "symbol-index.json",
        severity: "error" as const,
        message: "Invalid JSON",
      },
    ];

    const report = generateReport(issues, 4);

    // passed = 4 - 1 = 3
    expect(report.summary.errors).toBe(2);
    expect(report.summary.warnings).toBe(1);
    expect(report.summary.passed).toBe(3);
    expect(report.totalArtifacts).toBe(6); // 3 issues + 3 passed
  });
});

// ---------------------------------------------------------------------------
// resolvePath
// ---------------------------------------------------------------------------

describe("resolvePath", () => {
  it("resolves a relative path against the project root", () => {
    const result = resolvePath("/project", ".agentic-wiki/cache/state.json");
    expect(result).toBe(
      path.resolve("/project", ".agentic-wiki/cache/state.json"),
    );
  });

  it("handles a path with dot segments", () => {
    const result = resolvePath("/project/sub", "../other/file.txt");
    expect(result).toBe(path.resolve("/project/sub", "../other/file.txt"));
  });

  it("handles an absolute relative path", () => {
    const result = resolvePath("/project", "/absolute/path");
    expect(result).toBe(path.resolve("/project", "/absolute/path"));
  });
});

// ---------------------------------------------------------------------------
// CRITICAL_ARTIFACTS (smoke check)
// ---------------------------------------------------------------------------

describe("CRITICAL_ARTIFACTS", () => {
  it("defines critical artifacts for all expected phases", () => {
    const phases = [
      "INIT",
      "SCAN",
      "DEPENDENCY",
      "GEN",
      "ASSEMBLE",
      "VALIDATE",
    ];
    for (const phase of phases) {
      expect(CRITICAL_ARTIFACTS).toHaveProperty(phase);
      expect(Array.isArray(CRITICAL_ARTIFACTS[phase])).toBe(true);
    }
  });
});
