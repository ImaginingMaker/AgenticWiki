import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generateMermaid,
  normalizePath,
  sanitizeNodeId,
  transformCruiserOutput,
} from "../dependency/build-deps";
import type { DependencyGraphResult } from "../types/index";

function makeModule(
  source: string,
  deps: { resolved: string; type: "local" | "external"; circular?: boolean }[],
  dependents: string[],
) {
  return {
    source,
    dependencies: deps.map((d) => ({ ...d, circular: d.circular ?? false })),
    dependents,
    hasCircular: deps.some((d) => d.circular),
  };
}

describe("generateMermaid", () => {
  const baseGraph: DependencyGraphResult = {
    generatedAt: "2026-01-01T00:00:00Z",
    modules: [],
    cycles: [],
    hotspots: { mostDepended: [], mostDependent: [] },
  };

  it("generates graph TD header", () => {
    const result = generateMermaid(baseGraph);
    expect(result).toContain("graph TD");
  });

  it("includes fallback message when no dependencies exist", () => {
    const result = generateMermaid(baseGraph);
    expect(result).toContain("No dependencies found");
  });

  it("generates edges for local dependencies", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule(
          "src/components/Button.tsx",
          [{ resolved: "src/utils/helper.ts", type: "local" }],
          [],
        ),
        makeModule("src/utils/helper.ts", [], ["src/components/Button.tsx"]),
      ],
    };
    const result = generateMermaid(graph);
    expect(result).toContain("Button.tsx");
    expect(result).toContain("helper.ts");
    expect(result).toContain("-->");
  });

  it("skips external dependencies", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule(
          "src/components/Button.tsx",
          [
            { resolved: "react", type: "external" },
            { resolved: "lodash", type: "external" },
          ],
          [],
        ),
      ],
    };
    const result = generateMermaid(graph);
    // Should only have the header and no-deps message
    expect(result).toContain("No dependencies found");
  });

  it("deduplicates duplicate edges", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule(
          "src/a.ts",
          [{ resolved: "src/b.ts", type: "local" }],
          ["src/b.ts"],
        ),
        makeModule(
          "src/b.ts",
          [{ resolved: "src/a.ts", type: "local" }],
          ["src/a.ts"],
        ),
      ],
    };
    const result = generateMermaid(graph);
    const edgeCount = (result.match(/-->/g) || []).length;
    expect(edgeCount).toBe(2); // a→b and b→a, but deduped so should be 2
  });

  it("respects maxNodes limit", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule("src/a.ts", [{ resolved: "src/b.ts", type: "local" }], []),
        makeModule("src/b.ts", [{ resolved: "src/c.ts", type: "local" }], []),
        makeModule("src/c.ts", [], []),
      ],
    };
    const result = generateMermaid(graph, 1);
    // maxNodes=1 should stop after 1 node
    const edgeCount = (result.match(/-->/g) || []).length;
    expect(edgeCount).toBeLessThanOrEqual(1);
  });

  it("handles circular local dependencies", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule(
          "src/a.ts",
          [{ resolved: "src/b.ts", type: "local", circular: true }],
          ["src/b.ts"],
        ),
        makeModule(
          "src/b.ts",
          [{ resolved: "src/a.ts", type: "local", circular: true }],
          ["src/a.ts"],
        ),
      ],
    };
    const result = generateMermaid(graph);
    expect(result).toContain("a.ts");
    expect(result).toContain("b.ts");
  });

  it("uses basenames for node labels", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule(
          "src/components/MyButton.tsx",
          [{ resolved: "src/hooks/useAuth.ts", type: "local" }],
          [],
        ),
        makeModule("src/hooks/useAuth.ts", [], []),
      ],
    };
    const result = generateMermaid(graph);
    expect(result).toContain("MyButton.tsx");
    expect(result).toContain("useAuth.ts");
  });
});

describe("normalizePath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizePath("src\\components\\Button.tsx")).toBe(
      "src/components/Button.tsx",
    );
  });

  it("leaves forward slashes unchanged", () => {
    expect(normalizePath("src/components/Button.tsx")).toBe(
      "src/components/Button.tsx",
    );
  });

  it("handles mixed separators", () => {
    expect(normalizePath("src\\components/Button.tsx")).toBe(
      "src/components/Button.tsx",
    );
  });

  it("handles empty string", () => {
    expect(normalizePath("")).toBe("");
  });

  it("handles path with no separators", () => {
    expect(normalizePath("Button.tsx")).toBe("Button.tsx");
  });
});

describe("sanitizeNodeId", () => {
  it("replaces special characters with underscores", () => {
    expect(sanitizeNodeId("src/components/Button.tsx")).toBe(
      "src_components_Button_tsx",
    );
  });

  it("collapses consecutive special characters", () => {
    expect(sanitizeNodeId("a!!b??c")).toBe("a_b_c");
  });

  it("strips leading and trailing underscores", () => {
    expect(sanitizeNodeId("!!!")).toBe("");
  });

  it("preserves alphanumeric and underscore/hyphen", () => {
    expect(sanitizeNodeId("my-component_v2")).toBe("my-component_v2");
  });

  it("handles empty string", () => {
    expect(sanitizeNodeId("")).toBe("");
  });
});

// === Phase 2 新增 ===
describe("findTsConfig (D1-5)", () => {
  it("is exported via buildDependencyGraph — path validation rejects missing source", async () => {
    // buildDependencyGraph requires the sourcePath to exist.
    // This is tested indirectly: we verify that the function rejects invalid paths.
    const { buildDependencyGraph } =
      await import("../dependency/build-deps.js");
    await expect(buildDependencyGraph("/nonexistent/path")).rejects.toThrow(
      "Source path does not exist",
    );
  });
});

// === BUG-2 回归测试：transformCruiserOutput 路径归一化 ===
// 验证 dependency-graph.json 的路径与 file-list.json（相对 sourceRoot）一致，
// 避免下游 cluster-tasks.ts / file-priorities.ts 的 moduleMap.get(file) 失配。
describe("transformCruiserOutput — path normalization (BUG-2)", () => {
  let tmpSourceRoot: string;
  let tmpProjectRoot: string;
  // Cruised files: <sourceRoot>/foo.ts and <sourceRoot>/components/Button.tsx
  // Expected normalized keys (aligned with file-list.json): "foo.ts",
  // "components/Button.tsx"
  const EXPECTED_FOO = "foo.ts";
  const EXPECTED_BUTTON = "components/Button.tsx";

  beforeEach(() => {
    tmpProjectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agenticwiki-bug2-"),
    );
    tmpSourceRoot = path.join(tmpProjectRoot, "src");
    fs.mkdirSync(path.join(tmpSourceRoot, "components"), {
      recursive: true,
    });
    // Create real files so realpathSync succeeds (exercises the absolute-path
    // branch of relativize, which is the bug-triggering path).
    fs.writeFileSync(path.join(tmpSourceRoot, "foo.ts"), "export const x=1;");
    fs.writeFileSync(
      path.join(tmpSourceRoot, "components", "Button.tsx"),
      "export const B=1;",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
  });

  it("normalizes cruiser ABSOLUTE path output to sourceRoot-relative keys", () => {
    const fooAbs = path.join(tmpSourceRoot, "foo.ts");
    const buttonAbs = path.join(tmpSourceRoot, "components", "Button.tsx");
    const raw = {
      modules: [
        {
          source: fooAbs,
          dependencies: [{ resolved: buttonAbs, circular: false }],
        },
        {
          source: buttonAbs,
          dependencies: [{ resolved: fooAbs, circular: false }],
        },
      ],
      summary: { violations: [] },
    };
    const graph = transformCruiserOutput(
      raw,
      tmpSourceRoot,
      tmpProjectRoot,
    );
    const sources = new Set(graph.modules.map((m) => m.source));
    expect(sources.has(EXPECTED_FOO)).toBe(true);
    expect(sources.has(EXPECTED_BUTTON)).toBe(true);
    // Dependency edges should also be normalized to sourceRoot-relative.
    const fooMod = graph.modules.find((m) => m.source === EXPECTED_FOO)!;
    expect(fooMod.dependencies[0].resolved).toBe(EXPECTED_BUTTON);
  });

  it("normalizes cruiser paths RELATIVE TO ANALYSIS ROOT (fallback branch)", () => {
    // cruiser outputs paths relative to its cwd (/tmp); realpathSync fails,
    // so relativize falls back to stripping — must still yield sourceRoot-relative.
    const raw = {
      modules: [
        {
          source: EXPECTED_FOO,
          dependencies: [
            { resolved: EXPECTED_BUTTON, circular: false },
          ],
        },
        { source: EXPECTED_BUTTON, dependencies: [] },
      ],
      summary: { violations: [] },
    };
    const graph = transformCruiserOutput(
      raw,
      tmpSourceRoot,
      tmpProjectRoot,
    );
    const sources = new Set(graph.modules.map((m) => m.source));
    expect(sources.has(EXPECTED_FOO)).toBe(true);
    expect(sources.has(EXPECTED_BUTTON)).toBe(true);
  });

  it("normalizes paths relative to /tmp via ../<projectRoot>/src/...", () => {
    // Simulate cruiser output relative to /tmp: ../<dir>/src/foo.ts
    const relFromTmp = path.relative(
      "/tmp",
      path.join(tmpSourceRoot, "foo.ts"),
    );
    const raw = {
      modules: [
        { source: relFromTmp, dependencies: [] },
      ],
      summary: { violations: [] },
    };
    const graph = transformCruiserOutput(
      raw,
      tmpSourceRoot,
      tmpProjectRoot,
    );
    expect(graph.modules[0].source).toBe(EXPECTED_FOO);
  });

  it("produces keys aligned with file-list.json (cross-artifact consistency)", () => {
    // file-list.json would contain these (sorted) — simulate scan-files output.
    const fileListFiles = ["components/Button.tsx", "foo.ts"];
    const fooAbs = path.join(tmpSourceRoot, "foo.ts");
    const buttonAbs = path.join(tmpSourceRoot, "components", "Button.tsx");
    const raw = {
      modules: [
        {
          source: fooAbs,
          dependencies: [{ resolved: buttonAbs, circular: false }],
        },
        { source: buttonAbs, dependencies: [] },
      ],
      summary: { violations: [] },
    };
    const graph = transformCruiserOutput(
      raw,
      tmpSourceRoot,
      tmpProjectRoot,
    );
    const depGraphSources = new Set(graph.modules.map((m) => m.source));
    // Every file in file-list must be findable in dep-graph (the invariant
    // that cluster-tasks.ts moduleMap.get(file) relies on).
    for (const f of fileListFiles) {
      expect(depGraphSources.has(f)).toBe(true);
    }
  });
});

// === 外部模块分类回归测试 ===
// 验证 dependency-cruiser 的各种外部依赖格式都被正确标记为 "external"，
// 而非因 relativize 的 fallback 剥离 "node_modules/" 后被误判为 "local"。
// 误判会污染 cluster-tasks 的 BFS 遍历和 file-priorities 的 dependent 计数。
describe("transformCruiserOutput — external module classification", () => {
  let tmpSourceRoot: string;
  let tmpProjectRoot: string;

  beforeEach(() => {
    tmpProjectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "agenticwiki-ext-"),
    );
    tmpSourceRoot = path.join(tmpProjectRoot, "src");
    fs.mkdirSync(tmpSourceRoot, { recursive: true });
    fs.writeFileSync(path.join(tmpSourceRoot, "foo.ts"), "export const x=1;");
  });

  afterEach(() => {
    fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
  });

  it("classifies bare module specifier (react) as external", () => {
    // cruiser couldNotResolve a bare import → must be external
    const raw = {
      modules: [
        {
          source: path.join(tmpSourceRoot, "foo.ts"),
          dependencies: [
            { module: "react", couldNotResolve: "react", circular: false },
          ],
        },
      ],
      summary: { violations: [] },
    };
    const graph = transformCruiserOutput(
      raw,
      tmpSourceRoot,
      tmpProjectRoot,
    );
    const dep = graph.modules[0].dependencies[0];
    expect(dep.type).toBe("external");
    expect(dep.resolved).toBe("react");
  });

  it("classifies node_modules absolute path as external", () => {
    const raw = {
      modules: [
        {
          source: path.join(tmpSourceRoot, "foo.ts"),
          dependencies: [
            {
              resolved: "/some/project/node_modules/lodash/index.js",
              module: "lodash",
              moduleName: "lodash",
              circular: false,
            },
          ],
        },
      ],
      summary: { violations: [] },
    };
    const graph = transformCruiserOutput(
      raw,
      tmpSourceRoot,
      tmpProjectRoot,
    );
    const dep = graph.modules[0].dependencies[0];
    expect(dep.type).toBe("external");
    expect(dep.resolved).toBe("lodash");
  });

  it("classifies couldNotResolve entries as external", () => {
    const raw = {
      modules: [
        {
          source: path.join(tmpSourceRoot, "foo.ts"),
          dependencies: [
            {
              couldNotResolve: "./missing-file",
              module: "./missing-file",
              circular: false,
            },
          ],
        },
      ],
      summary: { violations: [] },
    };
    const graph = transformCruiserOutput(
      raw,
      tmpSourceRoot,
      tmpProjectRoot,
    );
    const dep = graph.modules[0].dependencies[0];
    expect(dep.type).toBe("external");
  });

  it("keeps local resolved deps as local", () => {
    const fooAbs = path.join(tmpSourceRoot, "foo.ts");
    const raw = {
      modules: [
        {
          source: fooAbs,
          dependencies: [
            {
              resolved: fooAbs, // self-reference, but local
              module: "./foo",
              circular: false,
            },
          ],
        },
      ],
      summary: { violations: [] },
    };
    const graph = transformCruiserOutput(
      raw,
      tmpSourceRoot,
      tmpProjectRoot,
    );
    const dep = graph.modules[0].dependencies[0];
    expect(dep.type).toBe("local");
    expect(dep.resolved).toBe("foo.ts");
  });

  it("does not let external deps inflate dependent counts", () => {
    // foo.ts imports react (external). react must NOT appear as a module
    // in the graph, and foo.ts's react dep must not create a bogus local edge.
    const raw = {
      modules: [
        {
          source: path.join(tmpSourceRoot, "foo.ts"),
          dependencies: [
            { module: "react", couldNotResolve: "react", circular: false },
          ],
        },
      ],
      summary: { violations: [] },
    };
    const graph = transformCruiserOutput(
      raw,
      tmpSourceRoot,
      tmpProjectRoot,
    );
    // Only foo.ts should be a module; react must not be a graph node.
    expect(graph.modules).toHaveLength(1);
    expect(graph.modules[0].source).toBe("foo.ts");
    // The external dep is recorded but typed as external.
    expect(graph.modules[0].dependencies[0].type).toBe("external");
  });
});
