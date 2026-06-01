import { describe, it, expect } from "vitest";
import { analyzeFolders } from "../analyze-folders.js";
import type { FilePrioritiesResult, Priority } from "../../types/index.js";

function makePriorityResult(
  folders: Record<
    string,
    {
      files: {
        path: string;
        priority: Priority;
        lineCount?: number;
        estimatedTokens?: number;
      }[];
    }
  >,
): FilePrioritiesResult {
  const result: FilePrioritiesResult = {
    generatedAt: new Date().toISOString(),
    folders: {},
  };
  for (const [folderPath, group] of Object.entries(folders)) {
    result.folders[folderPath] = {
      folder: folderPath,
      totalTokens: group.files.reduce(
        (sum, f) => sum + (f.estimatedTokens || 0),
        0,
      ),
      files: group.files.map((f) => ({
        path: f.path,
        priority: f.priority,
        lineCount: f.lineCount || 0,
        estimatedTokens: f.estimatedTokens || 0,
        dependentCount: 0,
        reason: "test",
      })),
    };
  }
  return result;
}

describe("analyzeFolders", () => {
  describe("token-based analysis", () => {
    it("detects input and produces subTasks", () => {
      const input = makePriorityResult({
        "src/components": {
          files: [
            {
              path: "src/components/index.ts",
              priority: "P0",
              lineCount: 1,
              estimatedTokens: 200,
            },
            {
              path: "src/components/Button.tsx",
              priority: "P1",
              lineCount: 1,
              estimatedTokens: 5000,
            },
            {
              path: "src/components/Input.tsx",
              priority: "P1",
              lineCount: 1,
              estimatedTokens: 4000,
            },
            {
              path: "src/components/Modal.tsx",
              priority: "P1",
              lineCount: 1,
              estimatedTokens: 6000,
            },
          ],
        },
      });

      const result = analyzeFolders(input);
      const folder = result.folders.find((f) => f.path === "src/components");
      expect(folder).toBeDefined();
      expect(folder!.totalTokens).toBe(15200);
      expect(folder!.shouldSplit).toBe(false);
      expect(folder!.reason).toContain("规模适中");
    });

    it("marks shouldSplit when totalTokens > 50K", () => {
      const files = Array.from({ length: 60 }, (_, i) => ({
        path: `src/big/file${i}.ts`,
        priority: "P2" as Priority,
        lineCount: 1,
        estimatedTokens: 1000,
      }));
      const input = makePriorityResult({ "src/big": { files } });

      const result = analyzeFolders(input);
      const folder = result.folders.find((f) => f.path === "src/big");
      expect(folder!.shouldSplit).toBe(true);
      expect(folder!.reason).toContain("超过阈值");
    });

    it("classifies hooks role by directory name", () => {
      const input = makePriorityResult({
        "src/hooks": {
          files: [
            {
              path: "src/hooks/useAuth.ts",
              priority: "P1",
              lineCount: 1,
              estimatedTokens: 3000,
            },
            {
              path: "src/hooks/useDebounce.ts",
              priority: "P1",
              lineCount: 1,
              estimatedTokens: 2000,
            },
          ],
        },
      });

      const result = analyzeFolders(input);
      const folder = result.folders.find((f) => f.path === "src/hooks");
      expect(folder!.subTasks).toBeDefined();
      const hooksTask = folder!.subTasks!.find((t) => t.role === "hooks");
      expect(hooksTask).toBeDefined();
    });

    it("classifies types role by directory name", () => {
      const input = makePriorityResult({
        "src/types": {
          files: [
            {
              path: "src/types/user.ts",
              priority: "P2",
              lineCount: 1,
              estimatedTokens: 2000,
            },
            {
              path: "src/types/api.ts",
              priority: "P2",
              lineCount: 1,
              estimatedTokens: 3000,
            },
          ],
        },
      });

      const result = analyzeFolders(input);
      const folder = result.folders.find((f) => f.path === "src/types");
      expect(folder!.subTasks).toBeDefined();
      const roles = folder!.subTasks!.map((t) => t.role);
      expect(roles).toContain("types");
    });

    it("excludes P3 and P4 files from subTasks", () => {
      const input = makePriorityResult({
        "src/components": {
          files: [
            {
              path: "src/components/Button.tsx",
              priority: "P1",
              lineCount: 1,
              estimatedTokens: 5000,
            },
            {
              path: "src/components/Button.test.ts",
              priority: "P3",
              lineCount: 1,
              estimatedTokens: 3000,
            },
            {
              path: "src/components/styles.css",
              priority: "P4",
              lineCount: 1,
              estimatedTokens: 2000,
            },
          ],
        },
      });

      const result = analyzeFolders(input);
      const folder = result.folders.find((f) => f.path === "src/components");
      const allTaskFiles = folder!.subTasks?.flatMap((t) => t.files) || [];
      expect(allTaskFiles).not.toContain("src/components/Button.test.ts");
      expect(allTaskFiles).not.toContain("src/components/styles.css");
      expect(allTaskFiles).toContain("src/components/Button.tsx");
    });
  });

  describe("crossFolderMerges", () => {
    it("merges small same-role groups across folders", () => {
      const input = makePriorityResult({
        "src/a": {
          files: [
            {
              path: "src/a/hooks/useAuth.ts",
              priority: "P1",
              lineCount: 1,
              estimatedTokens: 3000,
            },
            {
              path: "src/a/index.ts",
              priority: "P1",
              lineCount: 1,
              estimatedTokens: 60000,
            },
          ],
        },
        "src/b": {
          files: [
            {
              path: "src/b/hooks/useData.ts",
              priority: "P1",
              lineCount: 1,
              estimatedTokens: 3000,
            },
            {
              path: "src/b/index.ts",
              priority: "P1",
              lineCount: 1,
              estimatedTokens: 60000,
            },
          ],
        },
      });

      const result = analyzeFolders(input);
      expect(result.crossFolderMerges).toBeDefined();
      expect(result.crossFolderMerges!.length).toBeGreaterThan(0);

      const hooksMerge = result.crossFolderMerges!.find(
        (m) => m.id === "cross-hooks",
      );
      expect(hooksMerge).toBeDefined();
      expect(hooksMerge!.folders).toContain("src/a");
      expect(hooksMerge!.folders).toContain("src/b");
    });
  });

  describe("subTasks", () => {
    it("splits large roles into multiple chunks", () => {
      const files = Array.from({ length: 60 }, (_, i) => ({
        path: `src/big/component${i}.tsx`,
        priority: "P1" as Priority,
        lineCount: 1,
        estimatedTokens: 2000,
      }));
      const input = makePriorityResult({ "src/big": { files } });

      const result = analyzeFolders(input);
      const folder = result.folders.find((f) => f.path === "src/big");
      expect(folder!.shouldSplit).toBe(true);
      expect(folder!.subTasks).toBeDefined();
      expect(folder!.subTasks!.length).toBeGreaterThan(1);
    });

    it("assigns correct ids and labels", () => {
      const input = makePriorityResult({
        "src/hooks": {
          files: [
            {
              path: "src/hooks/useAuth.ts",
              priority: "P1",
              lineCount: 1,
              estimatedTokens: 3000,
            },
            {
              path: "src/hooks/useDebounce.ts",
              priority: "P1",
              lineCount: 1,
              estimatedTokens: 2000,
            },
          ],
        },
      });

      const result = analyzeFolders(input);
      const folder = result.folders.find((f) => f.path === "src/hooks");
      const task = folder!.subTasks!.find((t) => t.role === "hooks");
      expect(task).toBeDefined();
      expect(task!.id).toBeTruthy();
      expect(task!.label).toBeTruthy();
      expect(task!.files).toContain("src/hooks/useAuth.ts");
      expect(task!.files).toContain("src/hooks/useDebounce.ts");
    });
  });

  describe("folder priority", () => {
    it("sets high priority for entry files", () => {
      const input = makePriorityResult({
        src: {
          files: [
            {
              path: "src/App.tsx",
              priority: "P0",
              lineCount: 1,
              estimatedTokens: 200,
            },
            {
              path: "src/utils.ts",
              priority: "P2",
              lineCount: 1,
              estimatedTokens: 100,
            },
          ],
        },
      });

      const result = analyzeFolders(input);
      const folder = result.folders.find((f) => f.path === "src");
      expect(folder!.priority).toBe("high");
    });

    it("sets medium priority for non-entry folders", () => {
      const input = makePriorityResult({
        utils: {
          files: [
            {
              path: "utils/helper.ts",
              priority: "P2",
              lineCount: 1,
              estimatedTokens: 100,
            },
            {
              path: "utils/format.ts",
              priority: "P2",
              lineCount: 1,
              estimatedTokens: 100,
            },
          ],
        },
      });

      const result = analyzeFolders(input);
      const folder = result.folders.find((f) => f.path === "utils");
      expect(folder!.priority).toBe("medium");
    });
  });

  describe("sorting", () => {
    it("sorts folders by priority (high first)", () => {
      const input = makePriorityResult({
        components: {
          files: [
            {
              path: "components/Button.tsx",
              priority: "P1",
              lineCount: 1,
              estimatedTokens: 100,
            },
          ],
        },
        src: {
          files: [
            {
              path: "src/App.tsx",
              priority: "P0",
              lineCount: 1,
              estimatedTokens: 200,
            },
          ],
        },
      });

      const result = analyzeFolders(input);
      expect(result.folders[0].path).toBe("src");
      expect(result.folders[1].path).toBe("components");
    });

    it("sorts same-priority folders by fileCount descending", () => {
      const input = makePriorityResult({
        small: {
          files: [
            {
              path: "small/a.ts",
              priority: "P2",
              lineCount: 1,
              estimatedTokens: 100,
            },
          ],
        },
        big: {
          files: [
            {
              path: "big/a.ts",
              priority: "P2",
              lineCount: 1,
              estimatedTokens: 100,
            },
            {
              path: "big/b.ts",
              priority: "P2",
              lineCount: 1,
              estimatedTokens: 100,
            },
            {
              path: "big/c.ts",
              priority: "P2",
              lineCount: 1,
              estimatedTokens: 100,
            },
          ],
        },
      });

      const result = analyzeFolders(input);
      const bigIndex = result.folders.findIndex((f) => f.path === "big");
      const smallIndex = result.folders.findIndex((f) => f.path === "small");
      expect(bigIndex).toBeLessThan(smallIndex);
    });
  });

  describe("result structure", () => {
    it("contains generatedAt timestamp", () => {
      const input = makePriorityResult({
        src: {
          files: [
            {
              path: "src/App.tsx",
              priority: "P0",
              lineCount: 1,
              estimatedTokens: 200,
            },
          ],
        },
      });

      const result = analyzeFolders(input);
      expect(result.generatedAt).toBeTruthy();
      expect(new Date(result.generatedAt).getTime()).not.toBeNaN();
    });

    it("contains all required fields", () => {
      const input = makePriorityResult({
        src: {
          files: [
            {
              path: "src/App.tsx",
              priority: "P0",
              lineCount: 1,
              estimatedTokens: 200,
            },
            {
              path: "src/style.css",
              priority: "P4",
              lineCount: 1,
              estimatedTokens: 50,
            },
          ],
        },
      });

      const result = analyzeFolders(input);
      expect(result.totalFolders).toBe(1);
      expect(result.foldersToAnalyze).toBe(1);

      const folder = result.folders[0];
      expect(folder).toHaveProperty("path");
      expect(folder).toHaveProperty("fileCount");
      expect(folder).toHaveProperty("logicFileCount");
      expect(folder).toHaveProperty("styleFileCount");
      expect(folder).toHaveProperty("shouldSplit");
      expect(folder).toHaveProperty("reason");
      expect(folder).toHaveProperty("priority");
    });
  });

  // === Boundary: token thresholds ===
  it("should NOT split when totalTokens=50000 (exact threshold)", () => {
    const input = makePriorityResult({
      "src/exact": {
        files: [
          { path: "src/exact/a.ts", priority: "P2", estimatedTokens: 50000 },
        ],
      },
    });
    const result = analyzeFolders(input);
    expect(result.folders[0].shouldSplit).toBe(false);
  });
  it("should split when totalTokens=50001 (just over)", () => {
    const input = makePriorityResult({
      "src/over": {
        files: [
          { path: "src/over/a.ts", priority: "P2", estimatedTokens: 50001 },
        ],
      },
    });
    const result = analyzeFolders(input);
    expect(result.folders[0].shouldSplit).toBe(true);
  });
  it("should skip empty folders", () => {
    const input = makePriorityResult({
      "src/empty": { files: [] },
    });
    const result = analyzeFolders(input);
    expect(result.folders.find((f) => f.path === "src/empty")).toBeUndefined();
  });
});
