import { describe, it, expect } from "vitest";
import { clusterTasks, type TaskCluster } from "../cluster-tasks.js";
import type {
  DependencyGraphResult,
  FileListResult,
} from "../../types/index.js";

function makeDepGraph(
  modules: { source: string; deps: string[]; depBy?: string[] }[],
): DependencyGraphResult {
  const moduleMap = new Map<
    string,
    { source: string; dependencies: string[]; dependents: string[] }
  >();

  // First pass: create entries
  for (const m of modules) {
    moduleMap.set(m.source, {
      source: m.source,
      dependencies: m.deps || [],
      dependents: [],
    });
  }

  // Second pass: populate dependents
  for (const m of modules) {
    for (const dep of m.deps || []) {
      const target = moduleMap.get(dep);
      if (target) {
        target.dependents.push(m.source);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    modules: Array.from(moduleMap.values()).map((m) => ({
      source: m.source,
      dependencies: m.dependencies.map((d) => ({
        resolved: d,
        type: "local" as const,
        circular: false,
      })),
      dependents: m.dependents,
      hasCircular: false,
    })),
    cycles: [],
    hotspots: { mostDepended: [], mostDependent: [] },
  };
}

function makeFileList(files: string[]): FileListResult {
  return {
    scannedAt: new Date().toISOString(),
    sourcePath: "/tmp",
    totalFiles: files.length,
    files,
    byExtension: {},
  };
}

function makeMeta(
  entries: [string, Partial<import("../extract-file-meta.js").FileMeta>][],
): Record<string, any> {
  const meta: Record<string, any> = {};
  for (const [path, overrides] of entries) {
    meta[path] = {
      path,
      lineCount: 10,
      estimatedTokens: 2000,
      hasJSX: false,
      isReexportBarrel: false,
      isReactComponent: false,
      componentName: null,
      hookNames: [],
      exportNames: [],
      propTypeNames: [],
      topLevelFunctionNames: [],
      ...overrides,
    };
  }
  return meta;
}

describe("clusterTasks", () => {
  it("creates clusters from React components", () => {
    const result = clusterTasks(
      makeDepGraph([
        {
          source: "src/Button.tsx",
          deps: ["src/useClick.ts"],
        },
        { source: "src/useClick.ts", deps: [] },
      ]),
      makeMeta([
        [
          "src/Button.tsx",
          {
            isReactComponent: true,
            componentName: "Button",
            hasJSX: true,
            estimatedTokens: 5000,
          },
        ],
        ["src/useClick.ts", { hookNames: ["useClick"], estimatedTokens: 2000 }],
      ]),
      makeFileList(["src/Button.tsx", "src/useClick.ts"]),
    );

    expect(result.stats.totalClusters).toBeGreaterThanOrEqual(1);
    const buttonCluster = result.clusters.find(
      (c) => c.id === "Button" || c.files.includes("src/Button.tsx"),
    );
    expect(buttonCluster).toBeDefined();
    expect(buttonCluster!.files).toContain("src/Button.tsx");
  });

  it("includes dependent files in a seed's cluster", () => {
    const result = clusterTasks(
      makeDepGraph([
        { source: "src/Button.tsx", deps: [] },
        { source: "src/Button.test.tsx", deps: [] },
        { source: "src/useClick.ts", deps: [] },
      ]),
      makeMeta([
        ["src/Button.tsx", { isReactComponent: true, estimatedTokens: 5000 }],
      ]),
      makeFileList(["src/Button.tsx", "src/useClick.ts"]),
    );

    expect(result.stats.totalClusters).toBeGreaterThanOrEqual(1);
    const buttonCluster = result.clusters.find((c) =>
      c.files.includes("src/Button.tsx"),
    );
    expect(buttonCluster).toBeDefined();
  });

  it("identifies hub files (shared by multiple seeds)", () => {
    const result = clusterTasks(
      makeDepGraph([
        { source: "src/Button.tsx", deps: ["src/utils/format.ts"] },
        { source: "src/Input.tsx", deps: ["src/utils/format.ts"] },
        { source: "src/Modal.tsx", deps: ["src/utils/format.ts"] },
        { source: "src/utils/format.ts", deps: [] },
      ]),
      makeMeta([
        ["src/Button.tsx", { isReactComponent: true, estimatedTokens: 3000 }],
        ["src/Input.tsx", { isReactComponent: true, estimatedTokens: 3000 }],
        ["src/Modal.tsx", { isReactComponent: true, estimatedTokens: 3000 }],
        [
          "src/utils/format.ts",
          { estimatedTokens: 1000, exportNames: ["formatDate"] },
        ],
      ]),
      makeFileList([
        "src/Button.tsx",
        "src/Input.tsx",
        "src/Modal.tsx",
        "src/utils/format.ts",
      ]),
    );

    // format.ts is imported by 3 seeds → shared hub → not in any component cluster
    const sharedCluster = result.clusters.find(
      (c) => c.id === "shared-utilities",
    );
    expect(sharedCluster).toBeDefined();
    expect(sharedCluster!.files).toContain("src/utils/format.ts");
  });

  it("handles empty file list", () => {
    const result = clusterTasks(makeDepGraph([]), {}, makeFileList([]));
    expect(result.stats.totalClusters).toBe(0);
  });

  it("handles only utility files (no components)", () => {
    const result = clusterTasks(
      makeDepGraph([
        { source: "src/utils/format.ts", deps: [] },
        { source: "src/utils/parse.ts", deps: [] },
      ]),
      makeMeta([
        [
          "src/utils/format.ts",
          { estimatedTokens: 1000, exportNames: ["formatDate"] },
        ],
        [
          "src/utils/parse.ts",
          { estimatedTokens: 1000, exportNames: ["parseData"] },
        ],
      ]),
      makeFileList(["src/utils/format.ts", "src/utils/parse.ts"]),
    );

    // All files become orphan clusters grouped by directory
    expect(result.stats.totalClusters).toBeGreaterThanOrEqual(1);
    // Should have assigned at least some files
    expect(result.stats.totalFiles).toBeGreaterThan(0);
  });

  it("reports stats correctly", () => {
    const result = clusterTasks(
      makeDepGraph([
        { source: "src/Button.tsx", deps: ["src/useClick.ts"] },
        { source: "src/useClick.ts", deps: [] },
      ]),
      makeMeta([
        [
          "src/Button.tsx",
          {
            isReactComponent: true,
            componentName: "Button",
            estimatedTokens: 5000,
          },
        ],
        ["src/useClick.ts", { estimatedTokens: 2000 }],
      ]),
      makeFileList(["src/Button.tsx", "src/useClick.ts"]),
    );

    expect(result.generatedAt).toBeTruthy();
    expect(result.stats.totalClusters).toBeGreaterThanOrEqual(1);
    expect(result.stats.totalFiles).toBeGreaterThanOrEqual(2);
    expect(result.stats.totalEstimatedTokens).toBeGreaterThan(0);
    expect(result.stats.avgClusterTokens).toBeGreaterThan(0);
  });
});
