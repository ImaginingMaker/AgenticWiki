import { describe, it, expect } from "vitest";
import { assignPriorities } from "../file-priorities";
import type {
  FileListResult,
  DependencyGraphResult,
} from "../../types/index.js";

describe("file-priorities", () => {
  const baseFileList: FileListResult = {
    scannedAt: "2026-01-01T00:00:00Z",
    sourcePath: "src/",
    totalFiles: 0,
    files: [],
    byExtension: {},
  };

  const baseDepGraph: DependencyGraphResult = {
    generatedAt: "2026-01-01T00:00:00Z",
    modules: [],
    cycles: [],
    hotspots: { mostDepended: [], mostDependent: [] },
  };

  function makeDepGraph(
    modules: { source: string; dependents: string[] }[],
  ): DependencyGraphResult {
    return {
      ...baseDepGraph,
      modules: modules.map((m) => ({
        source: m.source,
        dependencies: [],
        dependents: m.dependents,
        hasCircular: false,
      })),
    };
  }

  it("assigns P0 to entry files (index.ts, main.tsx, app.ts)", () => {
    const fileList: FileListResult = {
      ...baseFileList,
      files: ["index.ts", "src/main.tsx", "src/App.tsx"],
      totalFiles: 3,
    };
    const result = assignPriorities(fileList, baseDepGraph, "/tmp/project");
    expect(
      result.folders["."].files.find((f) => f.path === "index.ts")!.priority,
    ).toBe("P0");
    expect(
      result.folders["src"].files.find((f) => f.path === "src/main.tsx")!
        .priority,
    ).toBe("P0");
    // App.tsx with uppercase: not an entry file by our pattern (app is lowercase only)
  });

  it("assigns P0 to files with >= 10 dependents", () => {
    const fileList: FileListResult = {
      ...baseFileList,
      files: ["src/utils/helper.ts"],
      totalFiles: 1,
    };
    const depGraph = makeDepGraph([
      { source: "src/utils/helper.ts", dependents: Array(10).fill("other.ts") },
    ]);
    const result = assignPriorities(fileList, depGraph, "/tmp/project");
    expect(result.folders["src/utils"].files[0].priority).toBe("P0");
    expect(result.folders["src/utils"].files[0].reason).toContain(
      "highly depended",
    );
  });

  it("assigns P3 to test files", () => {
    const fileList: FileListResult = {
      ...baseFileList,
      files: [
        "src/Button.test.ts",
        "src/__tests__/utils.ts",
        "src/Modal.spec.tsx",
      ],
      totalFiles: 3,
    };
    const result = assignPriorities(fileList, baseDepGraph, "/tmp/project");
    for (const folder of Object.values(result.folders)) {
      for (const file of folder.files) {
        expect(file.priority).toBe("P3");
      }
    }
  });

  it("assigns P3 to story files", () => {
    const fileList: FileListResult = {
      ...baseFileList,
      files: ["src/Button.stories.tsx", "src/Input.story.ts"],
      totalFiles: 2,
    };
    const result = assignPriorities(fileList, baseDepGraph, "/tmp/project");
    for (const folder of Object.values(result.folders)) {
      for (const file of folder.files) {
        expect(file.priority).toBe("P3");
      }
    }
  });

  it("assigns P4 to style files", () => {
    const fileList: FileListResult = {
      ...baseFileList,
      files: ["src/styles.css", "src/theme.scss", "src/vars.less"],
      totalFiles: 3,
    };
    const result = assignPriorities(fileList, baseDepGraph, "/tmp/project");
    for (const folder of Object.values(result.folders)) {
      for (const file of folder.files) {
        expect(file.priority).toBe("P4");
        expect(file.reason).toContain("pure style");
      }
    }
  });

  it("assigns P1 to files with 5-9 dependents", () => {
    const fileList: FileListResult = {
      ...baseFileList,
      files: ["src/utils/format.ts"],
      totalFiles: 1,
    };
    const depGraph = makeDepGraph([
      { source: "src/utils/format.ts", dependents: Array(7).fill("other.ts") },
    ]);
    const result = assignPriorities(fileList, depGraph, "/tmp/project");
    expect(result.folders["src/utils"].files[0].priority).toBe("P1");
  });

  it("groups files by parent folder", () => {
    const fileList: FileListResult = {
      ...baseFileList,
      files: ["src/a.ts", "src/b.ts", "lib/c.ts"],
      totalFiles: 3,
    };
    const result = assignPriorities(fileList, baseDepGraph, "/tmp/project");
    expect(Object.keys(result.folders).sort()).toEqual(["lib", "src"]);
    expect(result.folders["src"].files).toHaveLength(2);
    expect(result.folders["lib"].files).toHaveLength(1);
  });

  it("computes estimatedTokens as lineCount * 1.5", () => {
    // File doesn't exist in /tmp, so lineCount=0, estimatedTokens=1
    const fileList: FileListResult = {
      ...baseFileList,
      files: ["nonexistent.ts"],
      totalFiles: 1,
    };
    const result = assignPriorities(fileList, baseDepGraph, "/tmp/project");
    expect(result.folders["."].files[0].estimatedTokens).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("sorts files within folder by priority then dependent count", () => {
    const fileList: FileListResult = {
      ...baseFileList,
      files: ["src/c.ts", "src/a.test.ts", "src/index.ts"],
      totalFiles: 3,
    };
    const depGraph = makeDepGraph([
      { source: "src/index.ts", dependents: Array(5).fill("x.ts") },
      { source: "src/c.ts", dependents: Array(8).fill("x.ts") },
    ]);
    const result = assignPriorities(fileList, depGraph, "/tmp/project");
    const priorities = result.folders["src"].files.map((f) => f.priority);
    // P0 (index.ts) first, then P1 (c.ts, 8 deps), then P3 (a.test.ts)
    expect(priorities[0]).toBe("P0");
    expect(priorities[priorities.length - 1]).toBe("P3");
  });

  it("defaults to P2 for unknown files with low dependents", () => {
    const fileList: FileListResult = {
      ...baseFileList,
      files: ["src/some-random-helper.ts"],
      totalFiles: 1,
    };
    const result = assignPriorities(fileList, baseDepGraph, "/tmp/project");
    expect(result.folders["src"].files[0].priority).toBe("P2");
  });

  // === Boundary: dependency count thresholds ===
  it("should assign P1 when depCount=9 (upper bound)", () => {
    const fileList = {
      ...baseFileList,
      files: ["src/helper.ts"],
      totalFiles: 1,
    };
    const depGraph = makeDepGraph([
      { source: "src/helper.ts", dependents: Array(9).fill("x.ts") },
    ]);
    const result = assignPriorities(fileList, depGraph, "/tmp/project");
    expect(result.folders["src"].files[0].priority).toBe("P1");
  });
  it("should assign P0 when depCount=10 (lower bound)", () => {
    const fileList = {
      ...baseFileList,
      files: ["src/helper.ts"],
      totalFiles: 1,
    };
    const depGraph = makeDepGraph([
      { source: "src/helper.ts", dependents: Array(10).fill("x.ts") },
    ]);
    const result = assignPriorities(fileList, depGraph, "/tmp/project");
    expect(result.folders["src"].files[0].priority).toBe("P0");
  });
  it("should assign P0 when depCount=20+", () => {
    const fileList = { ...baseFileList, files: ["src/hot.ts"], totalFiles: 1 };
    const depGraph = makeDepGraph([
      { source: "src/hot.ts", dependents: Array(20).fill("x.ts") },
    ]);
    const result = assignPriorities(fileList, depGraph, "/tmp/project");
    expect(result.folders["src"].files[0].priority).toBe("P0");
  });
  it("P4 style overrides high depCount", () => {
    const fileList = {
      ...baseFileList,
      files: ["src/main.css"],
      totalFiles: 1,
    };
    const depGraph = makeDepGraph([
      { source: "src/main.css", dependents: Array(100).fill("x.ts") },
    ]);
    const result = assignPriorities(fileList, depGraph, "/tmp/project");
    expect(result.folders["src"].files[0].priority).toBe("P4");
  });
});
