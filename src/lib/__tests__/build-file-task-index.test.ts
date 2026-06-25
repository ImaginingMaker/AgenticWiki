import { describe, it, expect } from "vitest";
import { buildFileTaskIndex } from "../dependency/build-file-task-index.js";
import type { FileTaskIndex } from "../../types/index.js";

describe("buildFileTaskIndex", () => {
  it("builds index from task-clusters", () => {
    const clusters = {
      clusters: [
        { id: "Button", files: ["src/Button.tsx", "src/useClick.ts"] },
        { id: "Input", files: ["src/Input.tsx", "src/useFocus.ts"] },
      ],
    };

    const result = buildFileTaskIndex(undefined, clusters);
    expect(result.source).toBe("task-clusters");
    expect(result.generatedAt).toBeTruthy();

    // fileToTasks
    expect(result.fileToTasks["src/Button.tsx"]).toEqual(["Button"]);
    expect(result.fileToTasks["src/useClick.ts"]).toEqual(["Button"]);

    // taskToFiles
    expect(result.taskToFiles["Button"]).toEqual([
      "src/Button.tsx",
      "src/useClick.ts",
    ]);
    expect(result.taskToFiles["Input"]).toEqual([
      "src/Input.tsx",
      "src/useFocus.ts",
    ]);
  });

  it("prefers clusters when both are provided", () => {
    const clusters = {
      clusters: [{ id: "ComponentA", files: ["src/A.tsx"] }],
    };
    const strategy = {
      folders: [{ subTasks: [{ id: "folder-1", files: ["src/B.ts"] }] }],
    };

    const result = buildFileTaskIndex(strategy, clusters);
    expect(result.source).toBe("task-clusters");
    expect(result.fileToTasks["src/A.tsx"]).toEqual(["ComponentA"]);
  });

  it("falls back to folder-strategy when no clusters", () => {
    const strategy = {
      folders: [
        { subTasks: [{ id: "folder-1", files: ["src/a.ts", "src/b.ts"] }] },
        { subTasks: [{ id: "folder-2", files: ["src/c.ts"] }] },
      ],
    };

    const result = buildFileTaskIndex(strategy, undefined);
    expect(result.source).toBe("folder-strategy");
    expect(result.fileToTasks["src/a.ts"]).toEqual(["folder-1"]);
    expect(result.fileToTasks["src/b.ts"]).toEqual(["folder-1"]);
    expect(result.fileToTasks["src/c.ts"]).toEqual(["folder-2"]);
  });

  it("handles same file in multiple clusters", () => {
    const clusters = {
      clusters: [
        { id: "ClusterA", files: ["src/shared.ts", "src/A.tsx"] },
        { id: "ClusterB", files: ["src/shared.ts", "src/B.tsx"] },
      ],
    };

    const result = buildFileTaskIndex(undefined, clusters);
    expect(result.fileToTasks["src/shared.ts"]).toEqual([
      "ClusterA",
      "ClusterB",
    ]);
  });

  it("throws when neither strategy nor clusters provided", () => {
    expect(() => buildFileTaskIndex(undefined, undefined)).toThrow(
      "必须提供 --strategy",
    );
  });

  it("handles empty clusters gracefully (falls back to strategy)", () => {
    const strategy = {
      folders: [{ subTasks: [{ id: "f1", files: ["src/x.ts"] }] }],
    };

    // Empty clusters array should trigger fallback to strategy
    const result = buildFileTaskIndex(strategy, { clusters: [] });
    expect(result.source).toBe("folder-strategy");
    expect(result.fileToTasks["src/x.ts"]).toEqual(["f1"]);
  });

  it("handles folders without subTasks", () => {
    const strategy = {
      folders: [
        { subTasks: undefined },
        { subTasks: [{ id: "valid", files: ["src/a.ts"] }] },
      ],
    };

    const result = buildFileTaskIndex(strategy, undefined);
    expect(result.fileToTasks["src/a.ts"]).toEqual(["valid"]);
  });

  it("returns empty index for empty strategy", () => {
    const strategy = { folders: [] };

    const result = buildFileTaskIndex(strategy, undefined);
    expect(result.source).toBe("folder-strategy");
    expect(Object.keys(result.taskToFiles)).toHaveLength(0);
    expect(Object.keys(result.fileToTasks)).toHaveLength(0);
  });

  it("generatedAt is ISO timestamp", () => {
    const clusters = {
      clusters: [{ id: "Test", files: ["src/test.ts"] }],
    };

    const result = buildFileTaskIndex(undefined, clusters);
    expect(new Date(result.generatedAt).getTime()).not.toBeNaN();
  });

  it("FileTaskIndex type is structurally correct", () => {
    const index: FileTaskIndex = buildFileTaskIndex(undefined, {
      clusters: [{ id: "X", files: ["x.ts"] }],
    });

    expect(index).toHaveProperty("fileToTasks");
    expect(index).toHaveProperty("taskToFiles");
    expect(index).toHaveProperty("source");
    expect(index).toHaveProperty("generatedAt");
  });
});
