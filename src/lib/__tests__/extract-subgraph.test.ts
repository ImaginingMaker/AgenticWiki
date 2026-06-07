import { describe, it, expect } from "vitest";
import {
  extractSubgraph,
  buildSubGraphResult,
  folderToHash,
} from "../dependency/extract-subgraph";
import type { DependencyGraphResult } from "../../types/index.js";

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

describe("extractSubgraph", () => {
  const baseGraph: DependencyGraphResult = {
    generatedAt: "2026-01-01T00:00:00Z",
    modules: [],
    cycles: [],
    hotspots: { mostDepended: [], mostDependent: [] },
  };

  it("extracts only modules inside the target folder", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule("src/components/Button.tsx", [], []),
        makeModule("src/components/Input.tsx", [], []),
        makeModule("src/utils/helper.ts", [], []),
        makeModule("src/pages/Home.tsx", [], []),
      ],
    };
    const sub = extractSubgraph(graph, "src/components/");
    expect(sub.internalModules).toHaveLength(2);
    expect(sub.internalModules.map((m) => m.source).sort()).toEqual([
      "src/components/Button.tsx",
      "src/components/Input.tsx",
    ]);
  });

  it("identifies external dependencies", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule(
          "src/components/Button.tsx",
          [
            { resolved: "src/utils/helper.ts", type: "local" },
            { resolved: "react", type: "external" },
          ],
          [],
        ),
        makeModule("src/utils/helper.ts", [], ["src/components/Button.tsx"]),
      ],
    };
    const sub = extractSubgraph(graph, "src/components/");
    expect(sub.externalDeps).toEqual(["src/utils/helper.ts"]);
    // react is external type, not local, so excluded
  });

  it("identifies external dependents", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule(
          "src/utils/helper.ts",
          [],
          ["src/components/Button.tsx", "src/pages/Home.tsx"],
        ),
        makeModule(
          "src/components/Button.tsx",
          [{ resolved: "src/utils/helper.ts", type: "local" }],
          [],
        ),
        makeModule("src/pages/Home.tsx", [], []),
      ],
    };
    // helper.ts's dependents include Button.tsx (internal to src/components) and Home.tsx (external to src/utils)
    const sub = extractSubgraph(graph, "src/utils");
    expect(sub.externalDependents).toContain("src/components/Button.tsx");
    expect(sub.externalDependents).toContain("src/pages/Home.tsx");
  });

  it("handles folder path without trailing slash", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [makeModule("src/components/Button.tsx", [], [])],
    };
    const sub = extractSubgraph(graph, "src/components");
    expect(sub.internalModules).toHaveLength(1);
  });

  it("handles empty folder", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [makeModule("src/pages/Home.tsx", [], [])],
    };
    const sub = extractSubgraph(graph, "src/components/");
    expect(sub.internalModules).toHaveLength(0);
    expect(sub.externalDeps).toHaveLength(0);
    expect(sub.externalDependents).toHaveLength(0);
  });

  it("sorts external deps and dependents", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule(
          "src/components/Button.tsx",
          [
            { resolved: "src/utils/helper.ts", type: "local" },
            { resolved: "src/utils/format.ts", type: "local" },
          ],
          [],
        ),
        makeModule("src/utils/helper.ts", [], ["src/components/Button.tsx"]),
        makeModule("src/utils/format.ts", [], []),
      ],
    };
    const sub = extractSubgraph(graph, "src/components/");
    expect(sub.externalDeps).toEqual([
      "src/utils/format.ts",
      "src/utils/helper.ts",
    ]);
  });

  it("uses fuzzy last-segment matching when exact prefix fails", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule("src/components/Button.tsx", [], []),
        makeModule("src/components/Input.tsx", [], []),
      ],
    };
    // "components" is not a prefix of "src/components/Button.tsx" → triggers fuzzy match
    const sub = extractSubgraph(graph, "components");
    expect(sub.internalModules).toHaveLength(2);
  });

  it("fuzzy match handles modules by last segment prefix", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule("src/components/Button.tsx", [], []),
        makeModule("src/components/Input.tsx", [], []),
        makeModule("src/pages/Home.tsx", [], []),
      ],
    };
    // "components" fuzzy match finds modules under any components/ prefix
    const sub = extractSubgraph(graph, "components");
    expect(sub.internalModules).toHaveLength(2);
    const sources = sub.internalModules.map((m) => m.source).sort();
    expect(sources).toEqual([
      "src/components/Button.tsx",
      "src/components/Input.tsx",
    ]);
  });

  it("fuzzy match falls through to empty when no partial match", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule("src/pages/Home.tsx", [], []),
        makeModule("src/utils/helper.ts", [], []),
      ],
    };
    const sub = extractSubgraph(graph, "nonexistent");
    expect(sub.internalModules).toHaveLength(0);
  });

  it("exact folder equals module source", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [makeModule("src/components", [], [])],
    };
    const sub = extractSubgraph(graph, "src/components");
    expect(sub.internalModules).toHaveLength(1);
    expect(sub.internalModules[0].source).toBe("src/components");
  });

  it("fuzzy match handles modules from multiple directories with same segment", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule("packages/components/Button.tsx", [], []),
        makeModule("src/components/Input.tsx", [], []),
        makeModule("src/pages/Home.tsx", [], []),
      ],
    };
    // "components" fuzzy matches both packages/components/ and src/components/
    const sub = extractSubgraph(graph, "components");
    expect(sub.internalModules).toHaveLength(2);
    const sources = sub.internalModules.map((m) => m.source).sort();
    expect(sources).toEqual([
      "packages/components/Button.tsx",
      "src/components/Input.tsx",
    ]);
  });

  it("externalDeps excludes non-local dependency types", () => {
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
    const sub = extractSubgraph(graph, "src/components/");
    expect(sub.externalDeps).toEqual([]);
  });

  it("fuzzy match best prefix for external dep detection", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule(
          "packages/components/Button.tsx",
          [
            { resolved: "packages/utils/helper.ts", type: "local" },
            { resolved: "src/utils/helper.ts", type: "local" },
          ],
          [],
        ),
        makeModule(
          "packages/components/Input.tsx",
          [{ resolved: "packages/utils/format.ts", type: "local" }],
          [],
        ),
        makeModule("packages/utils/helper.ts", [], []),
        makeModule("packages/utils/format.ts", [], []),
        makeModule("src/utils/helper.ts", [], []),
      ],
    };
    // Fuzzy match "components" -> best prefix is "packages/components/"
    const sub = extractSubgraph(graph, "components");
    expect(sub.internalModules).toHaveLength(2);
    // "packages/utils/helper.ts" is under "packages/" prefix which != "packages/components/" -> external
    expect(sub.externalDeps).toContain("packages/utils/helper.ts");
    expect(sub.externalDeps).toContain("packages/utils/format.ts");
    // "src/utils/helper.ts" is external too
    expect(sub.externalDeps).toContain("src/utils/helper.ts");
  });
});

describe("buildSubGraphResult", () => {
  const baseGraph: DependencyGraphResult = {
    generatedAt: "2026-01-01T00:00:00Z",
    modules: [],
    cycles: [],
    hotspots: { mostDepended: [], mostDependent: [] },
  };

  it("identifies external dependencies", () => {
    const internalModules = [
      makeModule(
        "src/components/Button.tsx",
        [
          { resolved: "src/utils/helper.ts", type: "local" },
          { resolved: "react", type: "external" },
        ],
        [],
      ),
    ];
    const result = buildSubGraphResult(
      baseGraph,
      internalModules,
      "src/components/",
      "src/components",
    );
    expect(result.externalDeps).toEqual(["src/utils/helper.ts"]);
  });

  it("identifies external dependents", () => {
    const internalModules = [
      makeModule(
        "src/utils/helper.ts",
        [],
        ["src/components/Button.tsx", "src/pages/Home.tsx"],
      ),
    ];
    const result = buildSubGraphResult(
      baseGraph,
      internalModules,
      "src/utils/",
      "src/utils",
    );
    expect(result.externalDependents).toContain("src/components/Button.tsx");
    expect(result.externalDependents).toContain("src/pages/Home.tsx");
  });

  it("excludes internal deps from externalDeps", () => {
    const internalModules = [
      makeModule(
        "src/components/Button.tsx",
        [
          { resolved: "src/components/Input.tsx", type: "local" },
          { resolved: "src/components/Label.tsx", type: "local" },
        ],
        [],
      ),
    ];
    const result = buildSubGraphResult(
      baseGraph,
      internalModules,
      "src/components/",
      "src/components",
    );
    expect(result.externalDeps).toEqual([]);
  });

  it("excludes internal dependents from externalDependents", () => {
    const internalModules = [
      makeModule("src/components/Button.tsx", [], ["src/components/Input.tsx"]),
    ];
    const result = buildSubGraphResult(
      baseGraph,
      internalModules,
      "src/components/",
      "src/components",
    );
    expect(result.externalDependents).toEqual([]);
  });

  it("returns empty arrays when no modules", () => {
    const result = buildSubGraphResult(
      baseGraph,
      [],
      "src/empty/",
      "src/empty",
    );
    expect(result.internalModules).toEqual([]);
    expect(result.externalDeps).toEqual([]);
    expect(result.externalDependents).toEqual([]);
  });

  it("includes folder in result", () => {
    const result = buildSubGraphResult(baseGraph, [], "src/foo/", "src/foo");
    expect(result.folder).toBe("src/foo");
  });
});

describe("folderToHash", () => {
  it("converts basic path to lowercase hash", () => {
    expect(folderToHash("src/components")).toBe("src_components");
  });

  it("replaces special characters with underscores, preserving hyphens", () => {
    expect(folderToHash("my-package/My$Component")).toBe(
      "my-package_my_component",
    );
  });

  it("collapses consecutive underscores", () => {
    expect(folderToHash("a!!b??c")).toBe("a_b_c");
  });

  it("strips leading and trailing underscores", () => {
    // all special chars => all underscores => stripped to empty
    expect(folderToHash("!!!")).toBe("");
  });

  it("converts to lowercase", () => {
    expect(folderToHash("SRC/COMPONENTS/BUTTON")).toBe("src_components_button");
  });

  it("handles path with dots", () => {
    expect(folderToHash("src/components/MyButton.tsx")).toBe(
      "src_components_mybutton_tsx",
    );
  });
});
