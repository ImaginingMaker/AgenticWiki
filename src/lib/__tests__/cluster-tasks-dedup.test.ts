import { describe, it, expect } from "vitest";
import { clusterTasks } from "../dependency/cluster-tasks.js";
import type {
  DependencyGraphResult,
  FileListResult,
} from "../../types/index.js";
import type { FileMeta } from "../extract-file-meta.js";

// ─── Test helpers ───────────────────────────────────────────────

function makeDepGraph(
  modules: { source: string; deps: string[] }[],
): DependencyGraphResult {
  const moduleMap = new Map<
    string,
    { source: string; dependencies: string[]; dependents: string[] }
  >();
  for (const m of modules) {
    moduleMap.set(m.source, {
      source: m.source,
      dependencies: [...(m.deps || [])],
      dependents: [],
    });
  }
  for (const m of modules) {
    for (const dep of m.deps || []) {
      const target = moduleMap.get(dep);
      if (target) target.dependents.push(m.source);
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

/**
 * Create file-meta entries with sensible defaults.
 * Uses high estimatedTokens (20000) by default to ensure clusters
 * survive the dynamic minCluster threshold and don't get merged.
 */
function makeMeta(
  entries: [string, Partial<FileMeta>][],
): Record<string, FileMeta> {
  const meta: Record<string, FileMeta> = {};
  for (const [path, overrides] of entries) {
    meta[path] = {
      path,
      lineCount: 100,
      estimatedTokens: 20000,
      hasJSX: true,
      isReexportBarrel: false,
      isReactComponent: true,
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

// ─── Assertion helper ───────────────────────────────────────────

/** Assert all cluster IDs are unique */
function assertUniqueIds(clusters: { id: string }[]) {
  const ids = clusters.map((c) => c.id);
  const uniqueIds = new Set(ids);
  expect(uniqueIds.size).toBe(ids.length);
}

// ─── Tests ──────────────────────────────────────────────────────

describe("clusterTasks ID uniqueness (scope-aware)", () => {
  it("produces unique IDs when same directory name appears in different packages", () => {
    // Three _al/ directories in different packages
    const files = [
      "packages/user/balance/_al/index.tsx",
      "packages/user/balance/_al/helper.ts",
      "packages/marketing/brandActivity/_al/index.tsx",
      "packages/marketing/brandActivity/_al/utils.ts",
      "packages/user/memberCenter/_al/index.tsx",
      "packages/user/memberCenter/_al/style.ts",
    ];

    const result = clusterTasks(
      makeDepGraph([
        { source: files[0], deps: [files[1]] },
        { source: files[1], deps: [] },
        { source: files[2], deps: [files[3]] },
        { source: files[3], deps: [] },
        { source: files[4], deps: [files[5]] },
        { source: files[5], deps: [] },
      ]),
      makeMeta([
        [files[0], { componentName: "BalanceAl" }],
        [files[1], { isReactComponent: false }],
        [files[2], { componentName: "BrandAl" }],
        [files[3], { isReactComponent: false }],
        [files[4], { componentName: "MemberAl" }],
        [files[5], { isReactComponent: false }],
      ]),
      makeFileList(files),
    );

    assertUniqueIds(result.clusters);

    // Each _al cluster should have a scope prefix, not just "al"
    const alRelated = result.clusters.filter(
      (c) => c.files.some((f) => f.includes("_al/")),
    );
    expect(alRelated.length).toBeGreaterThanOrEqual(2);

    // No cluster should have a bare "al" ID
    for (const c of alRelated) {
      expect(c.id).not.toBe("al");
    }
  });

  it("produces unique IDs for common component dirs across packages", () => {
    const files = [
      "packages/shop/header/index.tsx",
      "packages/shop/header/logo.tsx",
      "packages/user/header/index.tsx",
      "packages/user/header/avatar.tsx",
    ];

    const result = clusterTasks(
      makeDepGraph([
        { source: files[0], deps: [files[1]] },
        { source: files[1], deps: [] },
        { source: files[2], deps: [files[3]] },
        { source: files[3], deps: [] },
      ]),
      makeMeta([
        [files[0], { componentName: "ShopHeader" }],
        [files[1], { isReactComponent: false }],
        [files[2], { componentName: "UserHeader" }],
        [files[3], { isReactComponent: false }],
      ]),
      makeFileList(files),
    );

    assertUniqueIds(result.clusters);

    const headerClusters = result.clusters.filter(
      (c) => c.files.some((f) => f.includes("/header/")),
    );
    expect(headerClusters.length).toBeGreaterThanOrEqual(2);

    // No bare "header" ID
    for (const c of headerClusters) {
      expect(c.id).not.toBe("header");
    }
  });

  it("does not add scope when cluster names are naturally unique", () => {
    const files = [
      "src/components/Button/index.tsx",
      "src/components/Button/styles.ts",
      "src/components/Modal/index.tsx",
      "src/components/Modal/overlay.ts",
    ];

    const result = clusterTasks(
      makeDepGraph([
        { source: files[0], deps: [files[1]] },
        { source: files[1], deps: [] },
        { source: files[2], deps: [files[3]] },
        { source: files[3], deps: [] },
      ]),
      makeMeta([
        [files[0], { componentName: "Button" }],
        [files[1], { isReactComponent: false }],
        [files[2], { componentName: "Modal" }],
        [files[3], { isReactComponent: false }],
      ]),
      makeFileList(files),
    );

    assertUniqueIds(result.clusters);

    // Button and Modal should have simple IDs without unnecessary scope prefixes
    const buttonCluster = result.clusters.find((c) =>
      c.files.includes("src/components/Button/index.tsx"),
    );
    const modalCluster = result.clusters.find((c) =>
      c.files.includes("src/components/Modal/index.tsx"),
    );
    expect(buttonCluster).toBeDefined();
    expect(modalCluster).toBeDefined();
    // IDs should be simple — just the dir name
    expect(buttonCluster!.id).toMatch(/button/i);
    expect(modalCluster!.id).toMatch(/modal/i);
  });

  it("handles many duplicate directory names across deep nesting", () => {
    // 5 different "list" directories
    const packages = [
      "packages/a/features/list",
      "packages/b/features/list",
      "packages/c/modules/list",
      "packages/d/pages/list",
      "packages/e/views/list",
    ];

    const files: string[] = [];
    const deps: { source: string; deps: string[] }[] = [];
    const metas: [string, Partial<FileMeta>][] = [];

    for (const pkg of packages) {
      const idx = `${pkg}/index.tsx`;
      const helper = `${pkg}/helper.ts`;
      files.push(idx, helper);
      deps.push({ source: idx, deps: [helper] });
      deps.push({ source: helper, deps: [] });
      metas.push([idx, { componentName: `ListFrom${pkg.split("/")[1]}` }]);
      metas.push([helper, { isReactComponent: false }]);
    }

    const result = clusterTasks(
      makeDepGraph(deps),
      makeMeta(metas),
      makeFileList(files),
    );

    assertUniqueIds(result.clusters);
    expect(result.clusters.length).toBeGreaterThanOrEqual(3);
  });

  it("numeric suffix fallback for truly identical scope+name", () => {
    // Edge case: two clusters that end up with same scope AND same name
    // after sanitization (e.g., identical directory structures in
    // sibling dirs with same name at every level)
    const files = [
      "mono/pkg/comp/mod/index.tsx",
      "mono/pkg/comp/mod/helper.ts",
      "mono/pkg/comp/mod/other.tsx",
      "mono/pkg/comp/mod/utils.ts",
    ];

    const result = clusterTasks(
      makeDepGraph([
        { source: files[0], deps: [files[1]] },
        { source: files[1], deps: [] },
        { source: files[2], deps: [files[3]] },
        { source: files[3], deps: [] },
      ]),
      makeMeta([
        [files[0], { componentName: "ModA" }],
        [files[1], { isReactComponent: false }],
        [files[2], { componentName: "ModB" }],
        [files[3], { isReactComponent: false }],
      ]),
      makeFileList(files),
    );

    // Even if they end up in one cluster (due to same dir), IDs are unique
    assertUniqueIds(result.clusters);
  });

  it("wikiChapter is consistent with cluster ID", () => {
    const files = [
      "packages/shop/header/index.tsx",
      "packages/shop/header/logo.tsx",
      "packages/user/header/index.tsx",
      "packages/user/header/avatar.tsx",
    ];

    const result = clusterTasks(
      makeDepGraph([
        { source: files[0], deps: [files[1]] },
        { source: files[1], deps: [] },
        { source: files[2], deps: [files[3]] },
        { source: files[3], deps: [] },
      ]),
      makeMeta([
        [files[0], { componentName: "ShopHeader" }],
        [files[1], { isReactComponent: false }],
        [files[2], { componentName: "UserHeader" }],
        [files[3], { isReactComponent: false }],
      ]),
      makeFileList(files),
    );

    for (const c of result.clusters) {
      expect(c.wikiChapter).toBe(`ch-${c.id}/index.md`);
    }
  });

  it("shared-utilities cluster always gets a unique ID", () => {
    // 3 seeds + 1 hub file → hub becomes shared-utilities
    const files = [
      "src/A.tsx",
      "src/B.tsx",
      "src/C.tsx",
      "src/utils/shared.ts",
    ];

    const result = clusterTasks(
      makeDepGraph([
        { source: "src/A.tsx", deps: ["src/utils/shared.ts"] },
        { source: "src/B.tsx", deps: ["src/utils/shared.ts"] },
        { source: "src/C.tsx", deps: ["src/utils/shared.ts"] },
        { source: "src/utils/shared.ts", deps: [] },
      ]),
      makeMeta([
        ["src/A.tsx", { componentName: "A" }],
        ["src/B.tsx", { componentName: "B" }],
        ["src/C.tsx", { componentName: "C" }],
        [
          "src/utils/shared.ts",
          { isReactComponent: false, exportNames: ["util"] },
        ],
      ]),
      makeFileList(files),
    );

    assertUniqueIds(result.clusters);
    const shared = result.clusters.find((c) => c.source === "shared");
    expect(shared).toBeDefined();
    expect(shared!.id).toBe("shared-utilities");
  });
});
