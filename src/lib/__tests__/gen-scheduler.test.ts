import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calcTokenBudget,
  buildGenTaskLookup,
  buildSubTaskPrompt,
  buildClusterPrompt,
  computeNextIssueId,
} from "../gen/gen-scheduler";
import type { ScheduleEntry } from "../gen/gen-scheduler";
import type { TaskCluster } from "../dependency/cluster-tasks";

// ─── calcTokenBudget v3 ───────────────────────────────────────────

describe("calcTokenBudget", () => {
  it("returns at least 15000 for zero estimated tokens (v3 floor)", () => {
    expect(calcTokenBudget(0)).toBe(15000);
  });

  it("returns at least 15000 for small values (v3 floor)", () => {
    expect(calcTokenBudget(100)).toBe(15000);
  });

  it("small task: 5000 * 2.5 + 8000 = 20500", () => {
    expect(calcTokenBudget(5000)).toBe(20500);
  });

  it("medium task: 30000 * 2.0 + 10000 = 70000", () => {
    expect(calcTokenBudget(30000)).toBe(70000);
  });

  it("large task: 80000 * 1.5 + 15000 = 135000 (not capped at 80K)", () => {
    expect(calcTokenBudget(80000)).toBe(135000);
  });

  it("caps at 300000 max", () => {
    // 190K × 1.5 + 15K = 300K, then capped at 300K
    expect(calcTokenBudget(190000)).toBe(300000);
  });

  it("caps at 300000 for huge values", () => {
    expect(calcTokenBudget(500000)).toBe(300000);
  });

  it("applies project cap at 30% when projectTotalTokens provided", () => {
    // 80000 * 1.5 + 15000 = 135000, but 30% of 300000 = 90000
    expect(calcTokenBudget(80000, 300000)).toBe(90000);
  });

  it("does not exceed 300K even with large project", () => {
    // 190K * 1.5 + 15K = 300K, capped at 300K (project 1M * 0.3 = 300K)
    expect(calcTokenBudget(190000, 1000000)).toBe(300000);
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
    // calcTokenBudget v3(15000) = 15000 * 2.0 + 10000 = 40000
    expect(result).toContain("40000");
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
    expect(result).toContain("## 1. 需求背景");
    expect(result).toContain("## 3. 组件/函数清单");
    expect(result).toContain("## 6. 依赖关系");
    expect(result).toContain("## 7. 数据流");
    expect(result).toContain("## 12. 相关章节");
    expect(result).toContain("## 11. Issue 分析");

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
    // calcTokenBudget v3(25000) = 25000 * 2.0 + 10000 = 60000
    expect(result).toContain("60000");
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
    expect(result).toContain("## 1. 需求背景");
    expect(result).toContain("## 3. 组件/函数清单");
    expect(result).toContain("## 6. 依赖关系");
    expect(result).toContain("## 7. 数据流");
    expect(result).toContain("## 12. 相关章节");
    expect(result).toContain("## 11. Issue 分析");
  });


  it("includes experience extraction step (步骤 4.5)", () => {
    const result = buildClusterPrompt(
      cluster,
      "/project",
      "/project/.agentic-wiki",
      1,
    );
    expect(result).toContain("步骤 4.5：提取通用开发经验");
    expect(result).toContain("volume-3-experience");
    expect(result).toContain("status: candidate");
    expect(result).toContain("source_clusters");
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
