import { describe, it, expect } from "vitest";
import { extractSubgraph } from "../dependency/extract-subgraph";
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
        makeModule("src/utils/helper.ts", [], ["src/components/Button.tsx", "src/pages/Home.tsx"]),
        makeModule("src/components/Button.tsx", [{ resolved: "src/utils/helper.ts", type: "local" }], []),
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
      modules: [
        makeModule("src/components/Button.tsx", [], []),
      ],
    };
    const sub = extractSubgraph(graph, "src/components");
    expect(sub.internalModules).toHaveLength(1);
  });

  it("handles empty folder", () => {
    const graph: DependencyGraphResult = {
      ...baseGraph,
      modules: [
        makeModule("src/pages/Home.tsx", [], []),
      ],
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
    expect(sub.externalDeps).toEqual(["src/utils/format.ts", "src/utils/helper.ts"]);
  });
});
