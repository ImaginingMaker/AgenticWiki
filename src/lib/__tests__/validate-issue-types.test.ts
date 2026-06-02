import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  parseMarkdownTable,
  parseIssueMetadata,
  getExpectedChapter,
  getCurrentChapter,
  validateIssue,
  generateReport,
  ALLOWED_TYPES,
  TYPE_TO_CHAPTER,
  ARCHIVE_CHAPTER,
} from "../validate/validate-issue-types.js";

// ========================================================================
// parseFrontmatter
// ========================================================================

describe("parseFrontmatter", () => {
  it("parses valid YAML frontmatter with id, type, severity, status", () => {
    const content = `---
id: IS-001
type: circular_dependency
severity: high
status: detected
---
Some content here
`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({
      id: "IS-001",
      type: "circular_dependency",
      severity: "high",
      status: "detected",
    });
  });

  it("returns null when no frontmatter markers are present", () => {
    const content = "Just some text without frontmatter.";
    expect(parseFrontmatter(content)).toBeNull();
  });

  it("handles frontmatter with quoted values (keeps quotes as-is)", () => {
    const content = `---
id: "IS-002"
type: "dead_code"
severity: "medium"
status: "verified"
---
Content
`;
    const result = parseFrontmatter(content);
    // The function's simple regex doesn't strip quotes
    expect(result).toEqual({
      id: '"IS-002"',
      type: '"dead_code"',
      severity: '"medium"',
      status: '"verified"',
    });
  });

  it("normalizes issueId to id", () => {
    const content = `---
issueId: IS-003
type: complex_logic
---
Content
`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({
      id: "IS-003",
      type: "complex_logic",
    });
  });

  it("handles list values like source_files", () => {
    const content = `---
id: IS-004
type: potential_bug
source_files: ["src/a.ts", "src/b.ts"]
---
Content
`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({
      id: "IS-004",
      type: "potential_bug",
      source_files: ["src/a.ts", "src/b.ts"],
    });
  });

  it("returns null for empty content", () => {
    expect(parseFrontmatter("")).toBeNull();
  });

  it("returns null for whitespace-only content", () => {
    expect(parseFrontmatter("   \n  \n  ")).toBeNull();
  });
});

// ========================================================================
// parseMarkdownTable
// ========================================================================

/*
 * The regex in parseMarkdownTable matches a two-column pattern:
 *   | **Header** | Value |
 * per row. So a valid input uses one row per field:
 *   | **ID** | IS-005 |
 *   | **类型** | dead_code |
 *   | **严重等级** | 高 |
 */

describe("parseMarkdownTable", () => {
  it("parses a two-column table with ID, 类型, 严重等级 rows", () => {
    const content = `| **ID** | IS-005 |
| **类型** | dead_code |
| **严重等级** | 高 |
`;
    const result = parseMarkdownTable(content);
    expect(result).toEqual({
      id: "IS-005",
      type: "dead_code",
      severity: "高",
    });
  });

  it("returns null for content without a table", () => {
    const content = "Just some text with no table structure.";
    expect(parseMarkdownTable(content)).toBeNull();
  });

  it("handles backtick-wrapped values", () => {
    const content = `| **ID** | \`IS-006\` |
| **类型** | \`missing_types\` |
| **严重等级** | \`high\` |
`;
    const result = parseMarkdownTable(content);
    expect(result).toEqual({
      id: "`IS-006`",
      type: "`missing_types`",
      severity: "`high`",
    });
  });

  it("strips emoji prefixes from severity values", () => {
    const content = `| **ID** | IS-007 |
| **类型** | inconsistent_api |
| **严重等级** | 🔴 高 |
`;
    const result = parseMarkdownTable(content);
    expect(result).toEqual({
      id: "IS-007",
      type: "inconsistent_api",
      severity: "高",
    });
  });

  it("returns null when required fields (ID and 类型) are missing", () => {
    const content = `| **严重等级** | high |
`;
    expect(parseMarkdownTable(content)).toBeNull();
  });
});

// ========================================================================
// parseIssueMetadata
// ========================================================================

describe("parseIssueMetadata", () => {
  it("returns frontmatter result when frontmatter exists", () => {
    const content = `---
id: IS-010
type: potential_bug
---
Table content that should be ignored
| **ID** | **类型** |
| IS-999 | dead_code |
`;
    const result = parseIssueMetadata(content);
    expect(result).toEqual({
      id: "IS-010",
      type: "potential_bug",
    });
  });

  it("falls back to markdown table when no frontmatter exists", () => {
    const content = `Some intro text

| **ID** | IS-011 |
| **类型** | complex_logic |
| **严重等级** | medium |
`;
    const result = parseIssueMetadata(content);
    expect(result).toEqual({
      id: "IS-011",
      type: "complex_logic",
      severity: "medium",
    });
  });

  it("returns null when neither format matches", () => {
    const content = "Just a plain text file with no metadata.";
    expect(parseIssueMetadata(content)).toBeNull();
  });
});

// ========================================================================
// getExpectedChapter / getCurrentChapter
// ========================================================================

describe("getExpectedChapter", () => {
  it("returns the correct chapter for each allowed type", () => {
    expect(getExpectedChapter("bug")).toBe("ch-01-bugs");
    expect(getExpectedChapter("security")).toBe("ch-02-security");
    expect(getExpectedChapter("typescript")).toBe("ch-03-typescript");
    expect(getExpectedChapter("performance")).toBe("ch-04-performance");
    expect(getExpectedChapter("dead_code")).toBe("ch-05-dead-code");
    expect(getExpectedChapter("complexity")).toBe("ch-06-complexity");
    expect(getExpectedChapter("maintainability")).toBe("ch-07-maintainability");
    expect(getExpectedChapter("ux")).toBe("ch-08-ux");
  });

  it("returns archive chapter for unknown types", () => {
    expect(getExpectedChapter("unknown_type")).toBe(ARCHIVE_CHAPTER);
    expect(getExpectedChapter("")).toBe(ARCHIVE_CHAPTER);
    expect(getExpectedChapter("some_random_value")).toBe("ch-99-archived");
  });
});

describe("getCurrentChapter", () => {
  it("extracts chapter from a standard volume-2-issues path", () => {
    const result = getCurrentChapter(
      "wiki/volume-2-issues/ch-01-circular-deps/IS-001.md",
    );
    expect(result).toBe("ch-01-circular-deps");
  });

  it("returns unknown for paths without volume-2-issues", () => {
    expect(getCurrentChapter("some/other/path/file.md")).toBe("unknown");
    expect(getCurrentChapter("")).toBe("unknown");
  });
});

// ========================================================================
// validateIssue
// ========================================================================

describe("validateIssue", () => {
  it("returns an error when type is missing", () => {
    const violations = validateIssue(
      "wiki/volume-2-issues/ch-01-circular-deps/IS-001.md",
      { id: "IS-001" },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      id: "IS-001",
      severity: "error",
      violation: "missing_type",
    });
  });

  it("returns an error when type is not in the whitelist", () => {
    const violations = validateIssue(
      "wiki/volume-2-issues/ch-99-archived/IS-002.md",
      { id: "IS-002", type: "bogus_type" },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      id: "IS-002",
      severity: "error",
      violation: "invalid_type",
    });
  });

  it("returns a warning when issue is in the wrong chapter for its type", () => {
    const violations = validateIssue(
      "wiki/volume-2-issues/ch-05-dead-code/IS-003.md",
      { id: "IS-003", type: "bug" },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      id: "IS-003",
      severity: "warning",
      violation: "wrong_chapter",
      file: "wiki/volume-2-issues/ch-05-dead-code/IS-003.md",
    });
  });

  it("does not flag chapter when current chapter is unknown", () => {
    const violations = validateIssue("some/other/path/IS-003.md", {
      id: "IS-003",
      type: "bug",
    });
    // Only type check passes, no chapter warning since current chapter is "unknown"
    expect(violations).toHaveLength(0);
  });

  it("returns a warning for invalid severity", () => {
    const violations = validateIssue(
      "wiki/volume-2-issues/ch-01-bugs/IS-004.md",
      { id: "IS-004", type: "bug", severity: "extreme" },
    );
    const sevViolation = violations.find(
      (v) => v.violation === "invalid_severity",
    );
    expect(sevViolation).toBeDefined();
    expect(sevViolation!.severity).toBe("warning");
  });

  it("returns a warning for invalid status", () => {
    const violations = validateIssue(
      "wiki/volume-2-issues/ch-01-bugs/IS-005.md",
      { id: "IS-005", type: "bug", status: "unknown_status" },
    );
    const statusViolation = violations.find(
      (v) => v.violation === "invalid_status",
    );
    expect(statusViolation).toBeDefined();
    expect(statusViolation!.severity).toBe("warning");
  });

  it("returns empty violations for a completely valid issue", () => {
    const violations = validateIssue(
      "wiki/volume-2-issues/ch-01-bugs/IS-006.md",
      {
        id: "IS-006",
        type: "bug",
        severity: "high",
        status: "detected",
      },
    );
    expect(violations).toHaveLength(0);
  });

  it("accumulates multiple violations on one issue", () => {
    const violations = validateIssue(
      "wiki/volume-2-issues/ch-05-dead-code/IS-007.md",
      {
        id: "IS-007",
        type: "bug",
        severity: "extreme",
        status: "bad_status",
      },
    );
    // wrong_chapter + invalid_severity + invalid_status = 3 violations
    expect(violations).toHaveLength(3);
    const violationTypes = violations.map((v) => v.violation).sort();
    expect(violationTypes).toEqual([
      "invalid_severity",
      "invalid_status",
      "wrong_chapter",
    ]);
  });

  it("falls back to filename when id is missing", () => {
    const violations = validateIssue(
      "wiki/volume-2-issues/ch-01-circular-deps/IS-008.md",
      { type: "bogus" },
    );
    expect(violations[0]).toMatchObject({
      id: "IS-008",
    });
  });
});

// ========================================================================
// generateReport
// ========================================================================

describe("generateReport", () => {
  it("returns passed = totalIssues when there are no violations", () => {
    const report = generateReport([], 5);
    expect(report.totalIssues).toBe(5);
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBe(0);
    expect(report.summary.passed).toBe(5);
    expect(report.violations).toHaveLength(0);
    expect(report.validatedAt).toBeDefined();
    expect(typeof report.validatedAt).toBe("string");
  });

  it("correctly counts errors, warnings, and passed with mixed violations", () => {
    const violations = [
      {
        id: "IS-001",
        file: "a.md",
        severity: "error" as const,
        violation: "missing_type",
        detail: "...",
        suggestion: "...",
      },
      {
        id: "IS-001",
        file: "a.md",
        severity: "warning" as const,
        violation: "invalid_severity",
        detail: "...",
        suggestion: "...",
      },
      {
        id: "IS-002",
        file: "b.md",
        severity: "warning" as const,
        violation: "wrong_chapter",
        detail: "...",
        suggestion: "...",
      },
    ];

    const report = generateReport(violations, 5);
    expect(report.totalIssues).toBe(5);
    expect(report.summary.errors).toBe(1);
    expect(report.summary.warnings).toBe(2);
    // 5 total - 2 unique violating IDs (IS-001, IS-002) = 3 passed
    expect(report.summary.passed).toBe(3);
    expect(report.violations).toHaveLength(3);
  });

  it("handles duplicate IDs correctly in passed count", () => {
    const violations = [
      {
        id: "IS-001",
        file: "a.md",
        severity: "error" as const,
        violation: "missing_type",
        detail: "...",
        suggestion: "...",
      },
      {
        id: "IS-001",
        file: "a.md",
        severity: "error" as const,
        violation: "invalid_type",
        detail: "...",
        suggestion: "...",
      },
    ];

    const report = generateReport(violations, 5);
    // 2 violations, but 1 unique ID → 5 - 1 = 4 passed
    expect(report.summary.passed).toBe(4);
    expect(report.summary.errors).toBe(2);
    expect(report.summary.warnings).toBe(0);
  });

  it("returns 0 passed when every issue has at least one violation", () => {
    const violations = [
      {
        id: "IS-001",
        file: "a.md",
        severity: "error" as const,
        violation: "missing_type",
        detail: "...",
        suggestion: "...",
      },
      {
        id: "IS-002",
        file: "b.md",
        severity: "warning" as const,
        violation: "wrong_chapter",
        detail: "...",
        suggestion: "...",
      },
    ];

    const report = generateReport(violations, 2);
    expect(report.summary.passed).toBe(0);
    expect(report.summary.errors).toBe(1);
    expect(report.summary.warnings).toBe(1);
  });
});

// ========================================================================
// Constants
// ========================================================================

describe("constants", () => {
  it("ALLOWED_TYPES contains all expected types", () => {
    expect(ALLOWED_TYPES.has("bug")).toBe(true);
    expect(ALLOWED_TYPES.has("security")).toBe(true);
    expect(ALLOWED_TYPES.has("typescript")).toBe(true);
    expect(ALLOWED_TYPES.has("performance")).toBe(true);
    expect(ALLOWED_TYPES.has("dead_code")).toBe(true);
    expect(ALLOWED_TYPES.has("complexity")).toBe(true);
    expect(ALLOWED_TYPES.has("maintainability")).toBe(true);
    expect(ALLOWED_TYPES.has("ux")).toBe(true);
    expect(ALLOWED_TYPES.size).toBe(8);
  });

  it("TYPE_TO_CHAPTER maps all allowed types to chapters", () => {
    expect(TYPE_TO_CHAPTER).toEqual({
      bug: "ch-01-bugs",
      security: "ch-02-security",
      typescript: "ch-03-typescript",
      performance: "ch-04-performance",
      dead_code: "ch-05-dead-code",
      complexity: "ch-06-complexity",
      maintainability: "ch-07-maintainability",
      ux: "ch-08-ux",
    });
  });

  it("ARCHIVE_CHAPTER is ch-99-archived", () => {
    expect(ARCHIVE_CHAPTER).toBe("ch-99-archived");
  });
});
