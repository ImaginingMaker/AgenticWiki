import { describe, it, expect } from "vitest";
import { generateIssueDashboard } from "../issue-dashboard";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

describe("issue-dashboard", () => {
  let tmpDir: string;

  function createIssueFile(id: string, type: string, severity: string, status: string, date: string, files: string[]) {
    const content = `---
id: ${id}
type: ${type}
severity: ${severity}
status: ${status}
detected_at: ${date}
detected_by: aw-generate
source_files:
${files.map((f) => `  - ${f}`).join("\n")}
---

# ${id}: Test issue

## Overview
Test issue description.
`;
    const chapter = type === "circular_dependency" ? "ch-01-circular-deps"
      : type === "dead_code" ? "ch-02-dead-code"
      : type === "missing_types" ? "ch-03-missing-types"
      : "ch-05-validation";
    const dir = path.join(tmpDir, chapter);
    fs.ensureDirSync(dir);
    fs.writeFileSync(path.join(dir, `${id}.md`), content);
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-dashboard-test-"));
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it("generates dashboard with status overview", async () => {
    createIssueFile("IS-001", "circular_dependency", "high", "detected", "2026-05-29T10:00:00Z", ["src/a.ts"]);
    createIssueFile("IS-002", "dead_code", "medium", "fixed", "2026-05-28T10:00:00Z", ["src/b.ts"]);

    const outputPath = path.join(tmpDir, "dashboard.md");
    await generateIssueDashboard(tmpDir, outputPath);

    const result = fs.readFileSync(outputPath, "utf-8");
    expect(result).toContain("# ISSUE 仪表盘");
    expect(result).toContain("detected");
    expect(result).toContain("fixed");
    expect(result).toContain("**合计** | **2**");
  });

  it("includes severity distribution chart", async () => {
    createIssueFile("IS-001", "circular_dependency", "high", "detected", "2026-05-29T10:00:00Z", ["src/a.ts"]);
    createIssueFile("IS-002", "dead_code", "medium", "fixed", "2026-05-28T10:00:00Z", ["src/b.ts"]);

    const outputPath = path.join(tmpDir, "dashboard.md");
    await generateIssueDashboard(tmpDir, outputPath);

    const result = fs.readFileSync(outputPath, "utf-8");
    expect(result).toContain("```mermaid");
    expect(result).toContain('"高" : 1');
    expect(result).toContain('"中" : 1');
  });

  it("shows pending high severity issues", async () => {
    createIssueFile("IS-001", "circular_dependency", "high", "detected", "2026-05-29T10:00:00Z", ["src/a.ts", "src/b.ts"]);

    const outputPath = path.join(tmpDir, "dashboard.md");
    await generateIssueDashboard(tmpDir, outputPath);

    const result = fs.readFileSync(outputPath, "utf-8");
    expect(result).toContain("待处理 — 高严重性");
    expect(result).toContain("IS-001");
    expect(result).toContain("circular_dependency");
  });

  it("does not show pending section when no pending issues", async () => {
    createIssueFile("IS-001", "circular_dependency", "high", "archived", "2026-05-29T10:00:00Z", ["src/a.ts"]);

    const outputPath = path.join(tmpDir, "dashboard.md");
    await generateIssueDashboard(tmpDir, outputPath);

    const result = fs.readFileSync(outputPath, "utf-8");
    expect(result).not.toContain("待处理");
    expect(result).toContain("archived");
  });

  it("handles empty issues directory", async () => {
    const outputPath = path.join(tmpDir, "dashboard.md");
    await generateIssueDashboard(tmpDir, outputPath);

    const result = fs.readFileSync(outputPath, "utf-8");
    expect(result).toContain("**合计** | **0**");
  });

  it("groups by type", async () => {
    createIssueFile("IS-001", "circular_dependency", "high", "detected", "2026-05-29T10:00:00Z", ["src/a.ts"]);
    createIssueFile("IS-002", "circular_dependency", "medium", "detected", "2026-05-29T10:00:00Z", ["src/b.ts"]);
    createIssueFile("IS-003", "dead_code", "low", "archived", "2026-05-28T10:00:00Z", ["src/c.ts"]);

    const outputPath = path.join(tmpDir, "dashboard.md");
    await generateIssueDashboard(tmpDir, outputPath);

    const result = fs.readFileSync(outputPath, "utf-8");
    expect(result).toContain("按类型分布");
    expect(result).toContain("circular_dependency");
    expect(result).toContain("dead_code");
  });
});
