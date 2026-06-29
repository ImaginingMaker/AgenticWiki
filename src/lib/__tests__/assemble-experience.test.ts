/**
 * Tests for assemble-experience.ts
 */
import { describe, it, expect } from "vitest";
import { generateExperienceSection } from "../experience/assemble-experience.js";
import type {
  ExperiencePatternMeta,
  ExperienceCategory,
} from "../../types/index.js";

function makeMeta(
  overrides: Partial<ExperiencePatternMeta> = {},
): ExperiencePatternMeta {
  return {
    id: "EXP-001",
    category: "hook" as ExperienceCategory,
    status: "active",
    title: "Test Pattern",
    summary: "A test pattern",
    sourceClusters: ["cluster-1", "cluster-2"],
    sourceFiles: ["hooks/useTest.ts"],
    wikiChapters: ["volume-1-code/ch-1/index.md"],
    ...overrides,
  };
}

describe("generateExperienceSection", () => {
  it("returns empty string when no patterns exist", () => {
    const result = {
      generatedAt: new Date().toISOString(),
      totalPatterns: 0,
      byCategory: {},
      patterns: [],
      stats: { totalCategories: 0, totalFiles: 0 },
    };
    expect(generateExperienceSection(result)).toBe("");
  });

  it("generates section with active pattern", () => {
    const result = {
      generatedAt: new Date().toISOString(),
      totalPatterns: 1,
      byCategory: {
        hook: [makeMeta()],
      },
      patterns: [makeMeta()],
      stats: { totalCategories: 1, totalFiles: 1 },
    };
    const section = generateExperienceSection(result);
    expect(section).toContain("## 📚 通用开发经验");
    expect(section).toContain("EXP-001");
    expect(section).toContain("A test pattern");
  });

  it("shows stale badge for stale patterns", () => {
    const result = {
      generatedAt: new Date().toISOString(),
      totalPatterns: 1,
      byCategory: {
        hook: [makeMeta({ status: "stale", staleReason: "Source changed" })],
      },
      patterns: [makeMeta({ status: "stale" })],
      stats: { totalCategories: 1, totalFiles: 1 },
    };
    const section = generateExperienceSection(result);
    expect(section).toContain("[待重验]");
  });

  it("shows orphaned badge for orphaned patterns", () => {
    const result = {
      generatedAt: new Date().toISOString(),
      totalPatterns: 1,
      byCategory: {
        hook: [makeMeta({ status: "orphaned" })],
      },
      patterns: [makeMeta({ status: "orphaned" })],
      stats: { totalCategories: 1, totalFiles: 1 },
    };
    const section = generateExperienceSection(result);
    expect(section).toContain("[已废弃]");
  });

  it("generates summary stats table", () => {
    const result = {
      generatedAt: new Date().toISOString(),
      totalPatterns: 3,
      byCategory: {
        hook: [
          makeMeta({ id: "EXP-001", status: "active" }),
          makeMeta({ id: "EXP-002", status: "stale" }),
        ],
        component: [makeMeta({ id: "EXP-003", category: "component" as ExperienceCategory, status: "orphaned" })],
      },
      patterns: [],
      stats: { totalCategories: 2, totalFiles: 3 },
    };
    const section = generateExperienceSection(result);
    expect(section).toContain("| 活跃 | stale | 废弃 |");
    expect(section).toContain("| 1 | 1 | 0 |"); // hook: 1 active, 1 stale, 0 orphaned
  });
});
