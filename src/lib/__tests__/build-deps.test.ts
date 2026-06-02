import { describe, it, expect } from "vitest";
import {
  generateMermaid,
  normalizePath,
  sanitizeNodeId,
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
