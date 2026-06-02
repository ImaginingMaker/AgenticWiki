import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calcTokenBudget,
  getIssueRulesTemplate,
  getOutputFormatTemplate,
  getPathSafetyTemplate,
  buildGenTaskLookup,
  buildSubTaskPrompt,
  buildClusterPrompt,
  computeNextIssueId,
  ensureTemplates,
} from "../gen/gen-scheduler";
import type { ScheduleEntry } from "../gen/gen-scheduler";
import type { TaskCluster } from "../dependency/cluster-tasks";

// ─── calcTokenBudget (pure) ─────────────────────────────────────────

describe("calcTokenBudget", () => {
  it("returns at least 10000 for zero estimated tokens", () => {
    expect(calcTokenBudget(0)).toBe(10000);
  });

  it("returns at least 10000 for small values", () => {
    expect(calcTokenBudget(100)).toBe(10000);
  });

  it("scales with estimated tokens (small folder)", () => {
    // 5000 * 1.5 + 5000 = 12500
    expect(calcTokenBudget(5000)).toBe(12500);
  });

  it("caps at 80000 for large folders", () => {
    // 80000 * 1.5 + 5000 = 125000, capped at 80000
    expect(calcTokenBudget(80000)).toBe(80000);
  });

  it("treats negative values as zero (Math.max floor)", () => {
    const result = calcTokenBudget(-100);
    expect(result).toBeGreaterThanOrEqual(10000);
  });

  it("handles mid-range value", () => {
    // 30000 * 1.5 + 5000 = 50000
    expect(calcTokenBudget(30000)).toBe(50000);
  });
});

// ─── getIssueRulesTemplate (pure) ───────────────────────────────────

describe("getIssueRulesTemplate", () => {
  it("includes Issue ID starting number", () => {
    const result = getIssueRulesTemplate(42);
    expect(result).toContain("0042");
  });

  it("includes the 8 issue types", () => {
    const result = getIssueRulesTemplate(1);
    expect(result).toContain("bug");
    expect(result).toContain("security");
    expect(result).toContain("typescript");
    expect(result).toContain("performance");
    expect(result).toContain("dead_code");
    expect(result).toContain("complexity");
    expect(result).toContain("maintainability");
    expect(result).toContain("ux");
  });

  it("includes severity matrix", () => {
    const result = getIssueRulesTemplate(1);
    expect(result).toContain(
      "| 类型 | 层级 | 维度 | 关键检测项 | 典型严重等级 |",
    );
  });

  it("handles zero issue ID start", () => {
    const result = getIssueRulesTemplate(0);
    expect(result).toContain("0000");
  });

  it("handles large issue ID start", () => {
    const result = getIssueRulesTemplate(9999);
    expect(result).toContain("9999");
  });
});

// ─── getOutputFormatTemplate (pure) ─────────────────────────────────

describe("getOutputFormatTemplate", () => {
  it("includes markdown frontmatter template", () => {
    const result = getOutputFormatTemplate();
    expect(result).toContain("---");
    expect(result).toContain("id:");
    expect(result).toContain("type:");
    expect(result).toContain("severity:");
  });

  it("includes issue file sections", () => {
    const result = getOutputFormatTemplate();
    expect(result).toContain("## 检测依据");
    expect(result).toContain("## 问题描述");
    expect(result).toContain("## 影响范围");
    expect(result).toContain("## 建议方案");
    expect(result).toContain("## 相关 Wiki");
    expect(result).toContain("## 状态时间线");
  });

  it("includes source_files and history in frontmatter", () => {
    const result = getOutputFormatTemplate();
    expect(result).toContain("source_files:");
    expect(result).toContain("history:");
  });

  it("returns a non-empty string", () => {
    const result = getOutputFormatTemplate();
    expect(result.length).toBeGreaterThan(100);
  });
});

// ─── getPathSafetyTemplate (pure) ───────────────────────────────────

describe("getPathSafetyTemplate", () => {
  it("includes path white list rule", () => {
    const result = getPathSafetyTemplate();
    expect(result).toContain("路径白名单");
    expect(result).toContain("wiki/volume-1-code");
    expect(result).toContain("wiki/volume-2-issues");
  });

  it("includes mermaid isolation rule", () => {
    const result = getPathSafetyTemplate();
    expect(result).toContain("Mermaid");
    expect(result).toContain("```mermaid");
  });

  it("includes path character safety rule", () => {
    const result = getPathSafetyTemplate();
    expect(result).toContain("路径字符安全");
    expect(result).toContain("文件名只能使用字母");
  });

  it("includes self-check checklist", () => {
    const result = getPathSafetyTemplate();
    expect(result).toContain("自检清单");
    expect(result).toContain("write_file");
  });
});

// ─── buildGenTaskLookup (pure) ──────────────────────────────────────

describe("buildGenTaskLookup", () => {
  it("builds a map from genTasks array", () => {
    const tasks = [
      {
        id: "task-1",
        folder: "src/a",
        role: "primary",
        status: "pending" as const,
        estimatedTokens: 5000,
      },
      {
        id: "task-2",
        folder: "src/b",
        role: "primary",
        status: "completed" as const,
        estimatedTokens: 3000,
      },
    ];
    const map = buildGenTaskLookup(tasks);
    expect(map.size).toBe(2);
    expect(map.get("task-1")?.folder).toBe("src/a");
    expect(map.get("task-2")?.status).toBe("completed");
  });

  it("returns empty map for undefined input", () => {
    const map = buildGenTaskLookup(undefined);
    expect(map.size).toBe(0);
  });

  it("returns empty map for empty array", () => {
    const map = buildGenTaskLookup([]);
    expect(map.size).toBe(0);
  });

  it("overwrites duplicate IDs (last wins)", () => {
    const tasks = [
      {
        id: "task-1",
        folder: "src/a",
        role: "primary",
        status: "pending" as const,
        estimatedTokens: 5000,
      },
      {
        id: "task-1",
        folder: "src/b",
        role: "secondary",
        status: "completed" as const,
        estimatedTokens: 3000,
      },
    ];
    const map = buildGenTaskLookup(tasks);
    expect(map.size).toBe(1);
    expect(map.get("task-1")?.folder).toBe("src/b");
  });
});

// ─── buildSubTaskPrompt (pure) ──────────────────────────────────────

describe("buildSubTaskPrompt", () => {
  const entry: ScheduleEntry = {
    id: "test-task",
    folder: "src/components/Button",
    role: "primary",
    label: "Button Component",
    estimatedTokens: 15000,
    wikiChapter: "ch-02-core",
    files: [
      "src/components/Button/Button.tsx",
      "src/components/Button/types.ts",
    ],
    action: "run",
    reason: "",
    prompt: "",
  };

  it("includes project root path", () => {
    const result = buildSubTaskPrompt(
      entry,
      "/project",
      "/project/.agentic-wiki",
      5,
    );
    expect(result).toContain("/project");
  });

  it("includes task folder name", () => {
    const result = buildSubTaskPrompt(
      entry,
      "/project",
      "/project/.agentic-wiki",
      5,
    );
    expect(result).toContain("Button");
  });

  it("includes wiki chapter path", () => {
    const result = buildSubTaskPrompt(
      entry,
      "/project",
      "/project/.agentic-wiki",
      5,
    );
    expect(result).toContain("ch-02-core");
  });

  it("inlines template content instead of file references", () => {
    const result = buildSubTaskPrompt(
      entry,
      "/project",
      "/project/.agentic-wiki",
      5,
    );
    // Templates are inlined — no longer references to external files
    expect(result).not.toContain("issue-rules.md");
    expect(result).not.toContain("output-format.md");
    expect(result).not.toContain("path-safety.md");
    // Inlined content should be present
    expect(result).toContain("bug");
    expect(result).toContain("type: {bug");
    expect(result).toContain("Mermaid 必须包裹在");
    expect(result).toContain("步骤 3.5：自检产物");
    expect(result).toContain("步骤 5：写入完成标记");
    expect(result).toContain(".gen-done");
  });

  it("includes file-priorities.json reference", () => {
    const result = buildSubTaskPrompt(
      entry,
      "/project",
      "/project/.agentic-wiki",
      5,
    );
    expect(result).toContain("file-priorities.json");
  });

  it("includes dependency subgraph reference", () => {
    const result = buildSubTaskPrompt(
      entry,
      "/project",
      "/project/.agentic-wiki",
      5,
    );
    expect(result).toContain("Button-deps.json");
  });

  it("includes token budget", () => {
    const result = buildSubTaskPrompt(
      entry,
      "/project",
      "/project/.agentic-wiki",
      5,
    );
    // calcTokenBudget(15000) = min(15000*1.5+5000, 80000) = 27500
    expect(result).toContain("27500");
  });

  it("includes Issue ID starting number", () => {
    const result = buildSubTaskPrompt(
      entry,
      "/project",
      "/project/.agentic-wiki",
      42,
    );
    expect(result).toContain("0042");
  });

  it("includes write_file instructions", () => {
    const result = buildSubTaskPrompt(
      entry,
      "/project",
      "/project/.agentic-wiki",
      1,
    );
    expect(result).toContain("write_file");
    expect(result).toContain("wiki/volume-1-code");
  });

  it("includes all required wiki sections", () => {
    const result = buildSubTaskPrompt(
      entry,
      "/project",
      "/project/.agentic-wiki",
      1,
    );
    expect(result).toContain("YAML frontmatter");
    expect(result).toContain("## 概述");
    expect(result).toContain("## 组件/函数列表");
    expect(result).toContain("## 依赖关系");
    expect(result).toContain("## 数据流");
    expect(result).toContain("## 相关章节");
    expect(result).toContain("## 已知问题");
  });

  it("handles cache root with deep nesting", () => {
    const result = buildSubTaskPrompt(
      entry,
      "/a/b/c",
      "/a/b/c/.agentic-wiki/sub/dir",
      1,
    );
    expect(result).toContain("/a/b/c");
  });
});

// ─── buildClusterPrompt (pure) ──────────────────────────────────────

describe("buildClusterPrompt", () => {
  const cluster: TaskCluster = {
    id: "cluster-1",
    label: "Auth Module",
    files: [
      "src/auth/AuthProvider.tsx",
      "src/auth/useAuth.ts",
      "src/auth/types.ts",
    ],
    estimatedTokens: 25000,
    rootFiles: ["src/auth/AuthProvider.tsx"],
    wikiChapter: "ch-03-auth",
    priority: "high",
    source: "component",
  };

  it("includes cluster name", () => {
    const result = buildClusterPrompt(
      cluster,
      "/project",
      "/project/.agentic-wiki",
      1,
    );
    expect(result).toContain("Auth Module");
  });

  it("includes all files in the cluster", () => {
    const result = buildClusterPrompt(
      cluster,
      "/project",
      "/project/.agentic-wiki",
      1,
    );
    expect(result).toContain("src/auth/AuthProvider.tsx");
    expect(result).toContain("src/auth/useAuth.ts");
    expect(result).toContain("src/auth/types.ts");
  });

  it("includes pre-extracted metadata table header", () => {
    const result = buildClusterPrompt(
      cluster,
      "/project",
      "/project/.agentic-wiki",
      1,
    );
    // Metadata section header is inlined (table content may be empty in test
    // due to missing file-meta.json, but the structure is present)
    expect(result).toContain("聚簇文件摘要");
    expect(result).toContain("聚簇文件清单");
    // No longer references file-meta.json as a file for SubAgent to read
    expect(result).not.toContain("代替读取完整源码，先从此文件获取");
  });

  it("includes token budget", () => {
    const result = buildClusterPrompt(
      cluster,
      "/project",
      "/project/.agentic-wiki",
      1,
    );
    // calcTokenBudget(25000) = min(25000*1.5+5000, 80000) = 42500
    expect(result).toContain("42500");
  });

  it("includes Issue ID starting number", () => {
    const result = buildClusterPrompt(
      cluster,
      "/project",
      "/project/.agentic-wiki",
      99,
    );
    expect(result).toContain("0099");
  });

  it("includes all required wiki sections", () => {
    const result = buildClusterPrompt(
      cluster,
      "/project",
      "/project/.agentic-wiki",
      1,
    );
    expect(result).toContain("YAML frontmatter");
    expect(result).toContain("## 概述");
    expect(result).toContain("## 组件/函数列表");
    expect(result).toContain("## 依赖关系");
    expect(result).toContain("## 数据流");
    expect(result).toContain("## 相关章节");
    expect(result).toContain("## 已知问题");
  });
});

// ─── computeNextIssueId (needs fs mock) ─────────────────────────────

describe("computeNextIssueId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 1 when wiki/volume-2-issues does not exist", () => {
    const fs = require("fs-extra");
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    expect(computeNextIssueId("/project")).toBe(1);
  });

  it("returns next ID based on existing issue files at root level", () => {
    const fs = require("fs-extra");
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const mockDirent = (name: string, isDir: boolean) => ({
      name,
      isDirectory: () => isDir,
      isFile: () => !isDir,
    });
    vi.spyOn(fs, "readdirSync").mockImplementation((() => {
      return [
        mockDirent("IS-0001-high-bug.md", false),
        mockDirent("IS-0005-medium-typo.md", false),
        mockDirent("some-other-file.md", false),
      ];
    }) as unknown);

    expect(computeNextIssueId("/project")).toBe(6);
  });

  it("scans chapter subdirectories for issue files", () => {
    const fs = require("fs-extra");
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const mockDirent = (name: string, isDir: boolean) => ({
      name,
      isDirectory: () => isDir,
      isFile: () => !isDir,
    });

    vi.spyOn(fs, "readdirSync").mockImplementation(((path: string) => {
      if (path.endsWith("volume-2-issues")) {
        return [mockDirent("ch-01-circular-deps", true)];
      }
      if (path.includes("ch-01-circular-deps")) {
        return ["IS-0003-high-cycle.md", "IS-0012-low-dup.md", "readme.md"];
      }
      return [];
    }) as unknown);

    expect(computeNextIssueId("/project")).toBe(13);
  });

  it("returns 1 on error (e.g., unreadable directory)", () => {
    const fs = require("fs-extra");
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new Error("permission denied");
    });

    expect(computeNextIssueId("/project")).toBe(1);
  });

  it("returns 1 when no issue files exist", () => {
    const fs = require("fs-extra");
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const mockDirent = (name: string, isDir: boolean) => ({
      name,
      isDirectory: () => isDir,
      isFile: () => !isDir,
    });
    vi.spyOn(fs, "readdirSync").mockReturnValue([
      mockDirent("readme.md", false),
      mockDirent("glossary.md", false),
    ] as unknown);

    expect(computeNextIssueId("/project")).toBe(1);
  });
});

// ─── ensureTemplates (needs fs mock) ────────────────────────────────

describe("ensureTemplates", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("creates templatesDir and writes all 3 template files when none exist", () => {
    const fs = require("fs-extra");
    const mkdirpSyncMock = vi.fn();
    const writeFileSyncMock = vi.fn();
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    vi.spyOn(fs, "mkdirpSync").mockImplementation(mkdirpSyncMock);
    vi.spyOn(fs, "writeFileSync").mockImplementation(writeFileSyncMock);

    ensureTemplates("/project/.agentic-wiki/cache", 1);

    expect(mkdirpSyncMock).toHaveBeenCalledWith(
      "/project/.agentic-wiki/templates",
    );
    expect(writeFileSyncMock).toHaveBeenCalledTimes(3);

    const issuesCall = writeFileSyncMock.mock.calls.find((c: unknown[]) =>
      c[0].endsWith("issue-rules.md"),
    );
    const outputCall = writeFileSyncMock.mock.calls.find((c: unknown[]) =>
      c[0].endsWith("output-format.md"),
    );
    const safetyCall = writeFileSyncMock.mock.calls.find((c: unknown[]) =>
      c[0].endsWith("path-safety.md"),
    );
    expect(issuesCall).toBeDefined();
    expect(outputCall).toBeDefined();
    expect(safetyCall).toBeDefined();
  });

  it("skips writing template files that already exist", () => {
    const fs = require("fs-extra");
    const writeFileSyncMock = vi.fn();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "mkdirpSync").mockImplementation(vi.fn());
    vi.spyOn(fs, "writeFileSync").mockImplementation(writeFileSyncMock);

    ensureTemplates("/project/.agentic-wiki/cache", 1);

    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });
});
