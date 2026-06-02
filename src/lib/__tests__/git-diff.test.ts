import { describe, it, expect, vi, beforeEach } from "vitest";
import { getGitDiff, computeAffectedScope } from "../shared/git-diff.js";
import type { ChangedFile, DependencyGraphResult } from "../../types/index.js";

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(),
}));

import { simpleGit } from "simple-git";

const mockSimpleGit = vi.mocked(simpleGit);

describe("getGitDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return changed files with modified status", async () => {
    const mockDiffSummary = vi.fn().mockResolvedValue({
      files: [
        { file: "src/App.tsx", insertions: 5, deletions: 2, binary: false },
      ],
    });
    mockSimpleGit.mockReturnValue({
      diffSummary: mockDiffSummary,
    } as unknown as ReturnType<typeof simpleGit>);

    const result = await getGitDiff("/project", "HEAD~1");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: "src/App.tsx",
      status: "modified",
    });
  });

  it("should detect added files", async () => {
    const mockDiffSummary = vi.fn().mockResolvedValue({
      files: [
        {
          file: "src/NewComponent.tsx",
          insertions: 50,
          deletions: 0,
          binary: false,
          status: "A",
        },
      ],
    });
    mockSimpleGit.mockReturnValue({
      diffSummary: mockDiffSummary,
    } as unknown as ReturnType<typeof simpleGit>);

    const result = await getGitDiff("/project", "HEAD~1");

    expect(result[0].status).toBe("added");
  });

  it("should detect deleted files", async () => {
    const mockDiffSummary = vi.fn().mockResolvedValue({
      files: [
        {
          file: "src/RemovedFile.ts",
          insertions: 0,
          deletions: 30,
          binary: false,
          status: "D",
        },
      ],
    });
    mockSimpleGit.mockReturnValue({
      diffSummary: mockDiffSummary,
    } as unknown as ReturnType<typeof simpleGit>);

    const result = await getGitDiff("/project", "HEAD~1");

    expect(result[0].status).toBe("deleted");
  });

  it("should handle multiple changed files", async () => {
    const mockDiffSummary = vi.fn().mockResolvedValue({
      files: [
        {
          file: "src/a.ts",
          insertions: 1,
          deletions: 0,
          binary: false,
          status: "A",
        },
        { file: "src/b.ts", insertions: 2, deletions: 3, binary: false },
        {
          file: "src/c.ts",
          insertions: 0,
          deletions: 5,
          binary: false,
          status: "D",
        },
      ],
    });
    mockSimpleGit.mockReturnValue({
      diffSummary: mockDiffSummary,
    } as unknown as ReturnType<typeof simpleGit>);

    const result = await getGitDiff("/project", "main");

    expect(result).toHaveLength(3);
    expect(result[0].status).toBe("added");
    expect(result[1].status).toBe("modified");
    expect(result[2].status).toBe("deleted");
  });

  it("should pass correct arguments to simple-git", async () => {
    const mockDiffSummary = vi.fn().mockResolvedValue({ files: [] });
    mockSimpleGit.mockReturnValue({
      diffSummary: mockDiffSummary,
    } as unknown as ReturnType<typeof simpleGit>);

    await getGitDiff("/my/repo", "abc123");

    expect(mockSimpleGit).toHaveBeenCalledWith("/my/repo");
    expect(mockDiffSummary).toHaveBeenCalledWith(["abc123"]);
  });

  it("should handle binary files as modified", async () => {
    const mockDiffSummary = vi.fn().mockResolvedValue({
      files: [
        { file: "assets/logo.png", binary: true, insertions: 0, deletions: 0 },
      ],
    });
    mockSimpleGit.mockReturnValue({
      diffSummary: mockDiffSummary,
    } as unknown as ReturnType<typeof simpleGit>);

    const result = await getGitDiff("/project", "HEAD~1");

    expect(result[0].status).toBe("modified");
  });

  it("should return empty array when no changes", async () => {
    const mockDiffSummary = vi.fn().mockResolvedValue({ files: [] });
    mockSimpleGit.mockReturnValue({
      diffSummary: mockDiffSummary,
    } as unknown as ReturnType<typeof simpleGit>);

    const result = await getGitDiff("/project", "HEAD~1");

    expect(result).toEqual([]);
  });

  it('should recognize "added" status string variant', async () => {
    const mockDiffSummary = vi.fn().mockResolvedValue({
      files: [
        {
          file: "src/new.ts",
          insertions: 10,
          deletions: 0,
          binary: false,
          status: "added",
        },
      ],
    });
    mockSimpleGit.mockReturnValue({
      diffSummary: mockDiffSummary,
    } as unknown as ReturnType<typeof simpleGit>);

    const result = await getGitDiff("/project", "HEAD~1");

    expect(result[0].status).toBe("added");
  });

  it('should recognize "deleted" status string variant', async () => {
    const mockDiffSummary = vi.fn().mockResolvedValue({
      files: [
        {
          file: "src/old.ts",
          insertions: 0,
          deletions: 10,
          binary: false,
          status: "deleted",
        },
      ],
    });
    mockSimpleGit.mockReturnValue({
      diffSummary: mockDiffSummary,
    } as unknown as ReturnType<typeof simpleGit>);

    const result = await getGitDiff("/project", "HEAD~1");

    expect(result[0].status).toBe("deleted");
  });
});

describe("computeAffectedScope", () => {
  const baseDependencyGraph: DependencyGraphResult = {
    generatedAt: "2025-01-01T00:00:00Z",
    modules: [],
    cycles: [],
    hotspots: { mostDepended: [], mostDependent: [] },
  };

  it("should mark directly changed files with status reason", () => {
    const changedFiles: ChangedFile[] = [
      { path: "src/a.ts", status: "modified" },
    ];

    const result = computeAffectedScope(changedFiles, baseDependencyGraph);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: "src/a.ts",
      reason: "Directly modified",
    });
  });

  it("should include dependents of changed files", () => {
    const changedFiles: ChangedFile[] = [
      { path: "src/utils.ts", status: "modified" },
    ];

    const depGraph: DependencyGraphResult = {
      ...baseDependencyGraph,
      modules: [
        {
          source: "src/utils.ts",
          dependencies: [],
          dependents: ["src/App.tsx", "src/components/Button.tsx"],
          hasCircular: false,
        },
      ],
    };

    const result = computeAffectedScope(changedFiles, depGraph);

    expect(result).toHaveLength(3);
    const paths = result.map((r) => r.path);
    expect(paths).toContain("src/utils.ts");
    expect(paths).toContain("src/App.tsx");
    expect(paths).toContain("src/components/Button.tsx");
  });

  it('should mark dependents with "Depends on changed file" reason', () => {
    const changedFiles: ChangedFile[] = [
      { path: "src/utils.ts", status: "modified" },
    ];

    const depGraph: DependencyGraphResult = {
      ...baseDependencyGraph,
      modules: [
        {
          source: "src/utils.ts",
          dependencies: [],
          dependents: ["src/App.tsx"],
          hasCircular: false,
        },
      ],
    };

    const result = computeAffectedScope(changedFiles, depGraph);

    const appFile = result.find((r) => r.path === "src/App.tsx");
    expect(appFile?.reason).toBe("Depends on changed file");
  });

  it("should recursively find transitive dependents", () => {
    const changedFiles: ChangedFile[] = [
      { path: "src/core.ts", status: "modified" },
    ];

    const depGraph: DependencyGraphResult = {
      ...baseDependencyGraph,
      modules: [
        {
          source: "src/core.ts",
          dependencies: [],
          dependents: ["src/utils.ts"],
          hasCircular: false,
        },
        {
          source: "src/utils.ts",
          dependencies: [
            { resolved: "src/core.ts", type: "local", circular: false },
          ],
          dependents: ["src/App.tsx"],
          hasCircular: false,
        },
      ],
    };

    const result = computeAffectedScope(changedFiles, depGraph);

    expect(result).toHaveLength(3);
    const paths = result.map((r) => r.path);
    expect(paths).toContain("src/core.ts");
    expect(paths).toContain("src/utils.ts");
    expect(paths).toContain("src/App.tsx");
  });

  it("should not duplicate files in the result", () => {
    const changedFiles: ChangedFile[] = [
      { path: "src/a.ts", status: "modified" },
      { path: "src/b.ts", status: "added" },
    ];

    const depGraph: DependencyGraphResult = {
      ...baseDependencyGraph,
      modules: [
        {
          source: "src/a.ts",
          dependencies: [],
          dependents: ["src/App.tsx"],
          hasCircular: false,
        },
        {
          source: "src/b.ts",
          dependencies: [],
          dependents: ["src/App.tsx"],
          hasCircular: false,
        },
      ],
    };

    const result = computeAffectedScope(changedFiles, depGraph);

    const paths = result.map((r) => r.path);
    const uniquePaths = [...new Set(paths)];
    expect(paths).toHaveLength(uniquePaths.length);
  });

  it("should handle empty changed files", () => {
    const result = computeAffectedScope([], baseDependencyGraph);

    expect(result).toEqual([]);
  });

  it("should handle dependency graph with no modules", () => {
    const changedFiles: ChangedFile[] = [
      { path: "src/standalone.ts", status: "added" },
    ];

    const result = computeAffectedScope(changedFiles, baseDependencyGraph);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/standalone.ts");
    expect(result[0].reason).toBe("Directly added");
  });

  it("should handle changed file not in dependency graph", () => {
    const changedFiles: ChangedFile[] = [
      { path: "src/orphan.ts", status: "modified" },
    ];

    const depGraph: DependencyGraphResult = {
      ...baseDependencyGraph,
      modules: [
        {
          source: "src/other.ts",
          dependencies: [],
          dependents: ["src/something.ts"],
          hasCircular: false,
        },
      ],
    };

    const result = computeAffectedScope(changedFiles, depGraph);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/orphan.ts");
  });

  it('should handle "added" status in reason', () => {
    const changedFiles: ChangedFile[] = [
      { path: "src/new.ts", status: "added" },
    ];

    const result = computeAffectedScope(changedFiles, baseDependencyGraph);

    expect(result[0].reason).toBe("Directly added");
  });

  it('should handle "deleted" status in reason', () => {
    const changedFiles: ChangedFile[] = [
      { path: "src/old.ts", status: "deleted" },
    ];

    const result = computeAffectedScope(changedFiles, baseDependencyGraph);

    expect(result[0].reason).toBe("Directly deleted");
  });
});
