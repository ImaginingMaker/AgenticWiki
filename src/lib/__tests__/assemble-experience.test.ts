/**
 * Tests for assemble-experience.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateExperienceSection,
  mergeClusterExperiences,
} from "../experience/assemble-experience.js";
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

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockGlobby = vi.fn();

vi.mock("fs-extra", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    readdirSync: vi.fn(),
    removeSync: vi.fn(),
    ensureDirSync: vi.fn(),
    outputJson: vi.fn(),
    appendFile: vi.fn(),
  },
}));

vi.mock("globby", () => ({
  globby: (...args: unknown[]) => mockGlobby(...args),
}));

// ─── generateExperienceSection ───────────────────────────────────

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

  it("generates section with patterns", () => {
    const result = {
      generatedAt: new Date().toISOString(),
      totalPatterns: 1,
      byCategory: { hook: [makeMeta()] },
      patterns: [makeMeta()],
      stats: { totalCategories: 1, totalFiles: 1 },
    };
    const section = generateExperienceSection(result);
    expect(section).toContain("## 📚 通用开发经验");
    expect(section).toContain("EXP-001");
  });

  it("shows status labels for stale/orphaned/deprecated", () => {
    const patterns = [
      makeMeta({ id: "EXP-001", status: "active" }),
      makeMeta({ id: "EXP-002", status: "stale" }),
      makeMeta({
        id: "EXP-003",
        category: "component" as ExperienceCategory,
        status: "orphaned",
      }),
    ];
    const result = {
      generatedAt: new Date().toISOString(),
      totalPatterns: 3,
      byCategory: {
        hook: [patterns[0], patterns[1]],
        component: [patterns[2]],
      },
      patterns,
      stats: { totalCategories: 2, totalFiles: 3 },
    };
    const section = generateExperienceSection(result);
    expect(section).toContain("| 活跃 | stale | 废弃 |");
    expect(section).toContain("| 1 | 1 | 0 |"); // hook: 1 active, 1 stale
    expect(section).toContain("⚠️[待重验]");
    expect(section).toContain("🗑️[已废弃]");
  });

  it("filters out candidate status patterns", () => {
    const patterns = [
      makeMeta({ id: "EXP-001", status: "active" }),
      makeMeta({ id: "EXP-002", status: "candidate" }),
    ];
    const result = {
      generatedAt: new Date().toISOString(),
      totalPatterns: 2,
      byCategory: { hook: patterns },
      patterns,
      stats: { totalCategories: 1, totalFiles: 2 },
    };
    const section = generateExperienceSection(result);
    // Should only show active pattern, not candidate
    expect(section).toContain("EXP-001");
    expect(section).not.toContain("EXP-002");
    expect(section).toContain("1 个单聚簇候选模式暂未列出");
  });

  it("returns empty when all patterns are candidate", () => {
    const patterns = [
      makeMeta({ id: "EXP-001", status: "candidate" }),
      makeMeta({ id: "EXP-002", status: "candidate" }),
    ];
    const result = {
      generatedAt: new Date().toISOString(),
      totalPatterns: 2,
      byCategory: { hook: patterns },
      patterns,
      stats: { totalCategories: 1, totalFiles: 2 },
    };
    expect(generateExperienceSection(result)).toBe("");
  });
});

// ─── mergeClusterExperiences ─────────────────────────────────────

describe("mergeClusterExperiences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeros when volume-3-experience does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await mergeClusterExperiences("/wiki");
    expect(result).toEqual({ merged: 0, promoted: 0, candidate: 0 });
  });

  it("returns zeros when no candidate files found", async () => {
    mockExistsSync.mockReturnValue(true);
    mockGlobby.mockResolvedValue([]);
    const result = await mergeClusterExperiences("/wiki");
    expect(result).toEqual({ merged: 0, promoted: 0, candidate: 0 });
  });

  it("merges two candidates with same title into one canonical doc", async () => {
    mockExistsSync.mockImplementation((_p: string) => {
      // v3 exists, individual files exist
      return true;
    });
    mockGlobby
      // First call: find candidate files
      .mockResolvedValueOnce([
        "hook/EXP-button-useAsyncAction.md",
        "hook/EXP-table-useAsyncAction.md",
      ])
      // Second call: find existing canonical IDs
      .mockResolvedValueOnce([]);

    mockReadFileSync.mockReturnValueOnce(`---
id: EXP-button-useAsyncAction
category: hook
status: candidate
title: "useAsyncAction 模式"
summary: "统一的异步操作模式"
tags: ["async"]
source_clusters:
  - button
source_files:
  - button/hooks/useAction.ts
wiki_chapters:
  - ch-button/index.md
lastUpdated: 2026-01-01
---

# useAsyncAction 模式

## 概述
统一的异步操作模式
`).mockReturnValueOnce(`---
id: EXP-table-useAsyncAction
category: hook
status: candidate
title: "useAsyncAction 模式"
summary: "统一的异步操作模式"
tags: ["async", "hook"]
source_clusters:
  - table
source_files:
  - table/hooks/useAction.ts
wiki_chapters:
  - ch-table/index.md
lastUpdated: 2026-01-02
---

# useAsyncAction 异步操作模式

## 概述
异步操作统一封装
`);

    const result = await mergeClusterExperiences("/wiki");

    expect(result.merged).toBe(1);
    expect(result.promoted).toBe(1); // >=2 clusters → active
    expect(result.candidate).toBe(0);

    // Verify canonical file was written
    const writeCalls = mockWriteFileSync.mock.calls;
    expect(writeCalls.length).toBe(1);
    const writtenPath = writeCalls[0][0] as string;
    const writtenContent = writeCalls[0][1] as string;

    expect(writtenPath).toContain("hook/EXP-001-");
    expect(writtenContent).toContain("status: active");
    expect(writtenContent).toContain("button");
    expect(writtenContent).toContain("table");
  });

  it("keeps single-cluster pattern as candidate", async () => {
    mockExistsSync.mockReturnValue(true);
    mockGlobby
      .mockResolvedValueOnce(["hook/EXP-button-useFetch.md"])
      .mockResolvedValueOnce([]);

    mockReadFileSync.mockReturnValueOnce(`---
id: EXP-button-useFetch
category: hook
status: candidate
title: "useFetch 数据获取模式"
summary: "统一数据获取"
source_clusters:
  - button
source_files:
  - button/hooks/useFetch.ts
wiki_chapters:
  - ch-button/index.md
lastUpdated: 2026-01-01
---

# useFetch 数据获取模式
`);

    const result = await mergeClusterExperiences("/wiki");

    expect(result.merged).toBe(1);
    expect(result.promoted).toBe(0); // only 1 cluster → stay candidate
    expect(result.candidate).toBe(1);
  });

  it("handles hyphenated cluster IDs like date-picker", async () => {
    mockExistsSync.mockReturnValue(true);
    mockGlobby
      .mockResolvedValueOnce([
        "hook/EXP-date-picker-useSingle.md",
        "hook/EXP-time-picker-useSingle.md",
      ])
      .mockResolvedValueOnce([]);

    mockReadFileSync.mockReturnValueOnce(`---
id: EXP-date-picker-useSingle
category: hook
status: candidate
title: "useSingle 模式"
source_clusters:
  - date-picker
source_files:
  - date-picker/hooks/useSingle.tsx
wiki_chapters:
  - ch-date-picker/index.md
---
`).mockReturnValueOnce(`---
id: EXP-time-picker-useSingle
category: hook
status: candidate
title: "useSingle 模式"
source_clusters:
  - time-picker
source_files:
  - time-picker/hooks/useSingle.tsx
wiki_chapters:
  - ch-time-picker/index.md
---
`);

    const result = await mergeClusterExperiences("/wiki");

    // Both have title "useSingle 模式" → normalized to same key → merged
    expect(result.merged).toBe(1);
    expect(result.promoted).toBe(1);

    const writeCalls = mockWriteFileSync.mock.calls;
    const writtenContent = writeCalls[0][1] as string;
    expect(writtenContent).toContain("date-picker");
    expect(writtenContent).toContain("time-picker");
    expect(writtenContent).toContain("status: active");
  });

  it("skips files that are not candidate status", async () => {
    mockExistsSync.mockReturnValue(true);
    mockGlobby
      .mockResolvedValueOnce(["hook/EXP-001-useXxx.md"])
      .mockResolvedValueOnce([]);

    mockReadFileSync.mockReturnValueOnce(`---
id: EXP-001
category: hook
status: active
source_clusters:
  - button
---
`);

    const result = await mergeClusterExperiences("/wiki");
    expect(result.merged).toBe(0);
    expect(result.promoted).toBe(0);
    expect(result.candidate).toBe(0);
  });
});
