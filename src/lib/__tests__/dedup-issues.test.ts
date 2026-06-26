import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { dedupIssues } from "../validate/dedup-issues.js";

describe("dedupIssues", () => {
  let tmpDir: string;

  function createIssue(filename: string, fm: Record<string, unknown>) {
    const fullPath = path.join(tmpDir, filename);
    fs.ensureDirSync(path.dirname(fullPath));
    const yaml = Object.entries(fm)
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k}:\n  - ${v.join("\n  - ")}`;
        return `${k}: ${v}`;
      })
      .join("\n");
    fs.writeFileSync(fullPath, `---\n${yaml}\n---\n\n# Content\n`);
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dedup-"));
  });
  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it("detects exact duplicates (same type + same source_files)", async () => {
    createIssue("ch-01-bugs/IS-0001-CRITICAL-a.md", {
      id: "IS-0001-CRITICAL-a",
      type: "bug",
      severity: "critical",
      status: "detected",
      detected_at: "2026-01-01T00:00:00Z",
      source_files: ["src/Button.tsx", "src/useClick.ts"],
    });
    createIssue("ch-01-bugs/IS-0005-CRITICAL-b.md", {
      id: "IS-0005-CRITICAL-b",
      type: "bug",
      severity: "critical",
      status: "detected",
      detected_at: "2026-02-01T00:00:00Z",
      source_files: ["src/useClick.ts", "src/Button.tsx"],
    });
    const result = await dedupIssues(tmpDir, true);
    expect(result.totalScanned).toBe(2);
    expect(result.exactDuplicates).toBe(1);
    expect(result.archived).toHaveLength(1);
    expect(result.archived[0]).toBe("IS-0005-CRITICAL-b");
  });

  it("does not mark different types as duplicates", async () => {
    createIssue("ch-01/IS-0001-CRITICAL.md", {
      id: "IS-0001-CRITICAL",
      type: "bug",
      severity: "critical",
      status: "detected",
      detected_at: "2026-01-01",
      source_files: ["src/Button.tsx"],
    });
    createIssue("ch-03/IS-0002-HIGH.md", {
      id: "IS-0002-HIGH",
      type: "typescript",
      severity: "high",
      status: "detected",
      detected_at: "2026-01-02",
      source_files: ["src/Button.tsx"],
    });
    const result = await dedupIssues(tmpDir, true);
    expect(result.exactDuplicates).toBe(0);
  });

  it("handles empty issues directory", async () => {
    const result = await dedupIssues(tmpDir, true);
    expect(result.totalScanned).toBe(0);
    expect(result.exactDuplicates).toBe(0);
  });

  it("archives duplicate by moving to ch-99-archived", async () => {
    createIssue("ch-01-bugs/IS-0001-CRITICAL.md", {
      id: "IS-0001-CRITICAL",
      type: "bug",
      severity: "critical",
      status: "detected",
      detected_at: "2026-01-01",
      source_files: ["src/A.tsx"],
    });
    createIssue("ch-01-bugs/IS-0002-CRITICAL.md", {
      id: "IS-0002-CRITICAL",
      type: "bug",
      severity: "critical",
      status: "detected",
      detected_at: "2026-02-01",
      source_files: ["src/A.tsx"],
    });
    const result = await dedupIssues(tmpDir, false);
    expect(result.exactDuplicates).toBe(1);
    // Later issue should be archived
    expect(
      fs.existsSync(path.join(tmpDir, "ch-01-bugs/IS-0002-CRITICAL.md")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(tmpDir, "ch-99-archived/IS-0002-CRITICAL.md")),
    ).toBe(true);
  });
});
