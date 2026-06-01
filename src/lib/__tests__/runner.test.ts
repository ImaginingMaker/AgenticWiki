/**
 * runner.ts 单元测试
 *
 * 覆盖核心函数：resolvePaths、validatePathRules、
 * isPhaseCompleted、getCurrentPhase、getPhaseDefinition。
 *
 * 纯函数测试，不依赖文件系统或外部进程。
 */

import { describe, it, expect } from "vitest";
import path from "node:path";

import {
  resolvePaths,
  validatePathRules,
  isPhaseCompleted,
  getCurrentPhase,
  getPhaseDefinition,
} from "../runner.js";

import type { WikiState, Phase, WikiPaths } from "../../types/index.js";

// ============================================================
// Test Helpers
// ============================================================

/**
 * 创建一个最小可用的 WikiState mock 供测试使用。
 */
function createMockState(overrides: Partial<WikiState> = {}): WikiState {
  return {
    schemaVersion: 1,
    id: "test-state-001",
    projectPath: "/tmp/my-project",
    createdAt: "2025-01-01T00:00:00.000Z",
    currentPhase: "INIT",
    phaseHistory: [],
    checkpoint: {
      lastSuccessPhase: null,
      filesSnapshot: {},
      timestamp: "2025-01-01T00:00:00.000Z",
    },
    blockers: [],
    config: {
      mode: "full",
      sourcePath: "src/",
      wikiPath: "wiki/",
      excludePatterns: [],
      language: "zh",
    },
    ...overrides,
  };
}

/**
 * 创建一个 WikiPaths mock 供测试使用。
 */
function createMockPaths(overrides: Partial<WikiPaths> = {}): WikiPaths {
  const projectRoot = "/tmp/my-project";
  return {
    projectRoot,
    agenticWikiRoot: "/tmp/agentic-wiki",
    sourceRoot: path.join(projectRoot, "src"),
    wikiRoot: path.join(projectRoot, "wiki"),
    cacheRoot: path.join(projectRoot, ".agentic-wiki", "cache"),
    ...overrides,
  };
}

// ============================================================
// resolvePaths
// ============================================================

describe("resolvePaths", () => {
  it("derives wikiRoot, cacheRoot, and statePath from a normal projectRoot", () => {
    const result = resolvePaths("/home/user/my-project");

    expect(result.wikiRoot).toBe("/home/user/my-project/wiki");
    expect(result.cacheRoot).toBe("/home/user/my-project/.agentic-wiki/cache");
    expect(result.statePath).toBe("/home/user/my-project/.agentic-wiki/state.json");
  });

  it("handles path with trailing slash", () => {
    const result = resolvePaths("/home/user/my-project/");

    expect(result.wikiRoot).toBe("/home/user/my-project/wiki");
    expect(result.cacheRoot).toBe("/home/user/my-project/.agentic-wiki/cache");
    expect(result.statePath).toBe("/home/user/my-project/.agentic-wiki/state.json");
  });

  it("handles path with multiple trailing slashes", () => {
    const result = resolvePaths("/home/user/my-project///");

    expect(result.wikiRoot).toBe("/home/user/my-project/wiki");
    expect(result.cacheRoot).toBe("/home/user/my-project/.agentic-wiki/cache");
    expect(result.statePath).toBe("/home/user/my-project/.agentic-wiki/state.json");
  });

  it("works with macOS-style paths", () => {
    const result = resolvePaths("/Users/alex/Projects/MyApp");

    expect(result.wikiRoot).toBe("/Users/alex/Projects/MyApp/wiki");
    expect(result.cacheRoot).toBe("/Users/alex/Projects/MyApp/.agentic-wiki/cache");
    expect(result.statePath).toBe("/Users/alex/Projects/MyApp/.agentic-wiki/state.json");
  });

  it("all three returned paths are children of projectRoot", () => {
    const root = "/tmp/test-root";
    const result = resolvePaths(root);

    expect(result.wikiRoot.startsWith(root)).toBe(true);
    expect(result.cacheRoot.startsWith(root)).toBe(true);
    expect(result.statePath.startsWith(root)).toBe(true);
  });
});

// ============================================================
// validatePathRules
// ============================================================

describe("validatePathRules", () => {
  it("passes for valid paths", () => {
    const paths = createMockPaths();
    expect(validatePathRules(paths)).toBe(true);
  });

  it("rejects when projectRoot equals agenticWikiRoot", () => {
    const paths = createMockPaths({
      projectRoot: "/tmp/same-root",
      agenticWikiRoot: "/tmp/same-root",
      wikiRoot: "/tmp/same-root/wiki",
    });

    expect(validatePathRules(paths)).toBe(false);
  });

  it("rejects when wikiRoot is not projectRoot + '/wiki'", () => {
    const paths = createMockPaths({
      wikiRoot: "/tmp/somewhere-else/wiki",
    });

    expect(validatePathRules(paths)).toBe(false);
  });

  it("passes even when agenticWikiRoot is totally separate", () => {
    const paths = createMockPaths({
      projectRoot: "/tmp/proj-a",
      agenticWikiRoot: "/home/user/tools/agentic-wiki",
      wikiRoot: "/tmp/proj-a/wiki",
    });

    expect(validatePathRules(paths)).toBe(true);
  });

  it("handles paths that resolve to the same but are spelled differently", () => {
    // path.resolve normalizes, so /tmp/proj/wiki and /tmp/proj/./wiki are equal
    const paths = createMockPaths({
      wikiRoot: path.join("/tmp/my-project", ".", "wiki"),
    });

    expect(validatePathRules(paths)).toBe(true);
  });
});

// ============================================================
// isPhaseCompleted
// ============================================================

describe("isPhaseCompleted", () => {
  it("returns true when phaseHistory has a completed record for the phase", () => {
    const state = createMockState({
      phaseHistory: [
        {
          phase: "SCAN",
          status: "completed",
          startedAt: "2025-01-01T00:00:00.000Z",
          completedAt: "2025-01-01T00:01:00.000Z",
        },
      ],
    });

    expect(isPhaseCompleted(state, "SCAN")).toBe(true);
  });

  it("returns false when phaseHistory does not contain the phase", () => {
    const state = createMockState({
      phaseHistory: [
        {
          phase: "INIT",
          status: "completed",
          startedAt: "2025-01-01T00:00:00.000Z",
          completedAt: "2025-01-01T00:01:00.000Z",
        },
      ],
    });

    expect(isPhaseCompleted(state, "SCAN")).toBe(false);
  });

  it("returns false when phase exists but status is not 'completed'", () => {
    const state = createMockState({
      phaseHistory: [
        {
          phase: "SCAN",
          status: "in_progress",
          startedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(isPhaseCompleted(state, "SCAN")).toBe(false);
  });

  it("returns false when phase exists but status is 'failed'", () => {
    const state = createMockState({
      phaseHistory: [
        {
          phase: "SCAN",
          status: "failed",
          startedAt: "2025-01-01T00:00:00.000Z",
          error: "something went wrong",
        },
      ],
    });

    expect(isPhaseCompleted(state, "SCAN")).toBe(false);
  });

  it("returns false when state is null", () => {
    expect(isPhaseCompleted(null, "SCAN")).toBe(false);
  });

  it("returns false when phaseHistory is empty", () => {
    const state = createMockState({ phaseHistory: [] });

    expect(isPhaseCompleted(state, "INIT")).toBe(false);
  });

  it("returns true when multiple phases exist and one matches", () => {
    const state = createMockState({
      phaseHistory: [
        {
          phase: "INIT",
          status: "completed",
          startedAt: "2025-01-01T00:00:00.000Z",
          completedAt: "2025-01-01T00:01:00.000Z",
        },
        {
          phase: "SCAN",
          status: "completed",
          startedAt: "2025-01-01T00:01:00.000Z",
          completedAt: "2025-01-01T00:02:00.000Z",
        },
        {
          phase: "DEPENDENCY",
          status: "in_progress",
          startedAt: "2025-01-01T00:02:00.000Z",
        },
      ],
    });

    expect(isPhaseCompleted(state, "INIT")).toBe(true);
    expect(isPhaseCompleted(state, "SCAN")).toBe(true);
    expect(isPhaseCompleted(state, "DEPENDENCY")).toBe(false);
  });
});

// ============================================================
// getCurrentPhase
// ============================================================

describe("getCurrentPhase", () => {
  it("returns currentPhase from state", () => {
    const state = createMockState({ currentPhase: "SCAN" });
    expect(getCurrentPhase(state)).toBe("SCAN");
  });

  it("returns the default INIT phase from state", () => {
    const state = createMockState({ currentPhase: "INIT" });
    expect(getCurrentPhase(state)).toBe("INIT");
  });

  it("returns GEN when state is in GEN phase", () => {
    const state = createMockState({ currentPhase: "GEN" });
    expect(getCurrentPhase(state)).toBe("GEN");
  });

  it("returns DONE when state is in DONE phase", () => {
    const state = createMockState({ currentPhase: "DONE" });
    expect(getCurrentPhase(state)).toBe("DONE");
  });

  it("returns 'INIT' when state is null", () => {
    expect(getCurrentPhase(null)).toBe("INIT");
  });
});

// ============================================================
// getPhaseDefinition
// ============================================================

describe("getPhaseDefinition", () => {
  // --- INIT Phase ---

  describe("INIT phase", () => {
    it("returns 2 scripts", () => {
      const def = getPhaseDefinition("INIT");
      expect(def).not.toBeNull();
      expect(def!.scripts).toHaveLength(2);
    });

    it("both scripts are critical", () => {
      const def = getPhaseDefinition("INIT");
      expect(def!.scripts.every((s) => s.critical)).toBe(true);
    });

    it("does not require agent", () => {
      const def = getPhaseDefinition("INIT");
      expect(def!.requiresAgent).toBeFalsy();
    });
  });

  // --- SCAN Phase ---

  describe("SCAN phase", () => {
    it("returns 2 scripts", () => {
      const def = getPhaseDefinition("SCAN");
      expect(def).not.toBeNull();
      expect(def!.scripts).toHaveLength(2);
    });

    it("first script is critical, second is non-critical", () => {
      const def = getPhaseDefinition("SCAN");
      expect(def!.scripts[0].critical).toBe(true);
      expect(def!.scripts[1].critical).toBe(false);
    });
  });

  // --- DEPENDENCY Phase ---

  describe("DEPENDENCY phase", () => {
    it("returns 5 scripts", () => {
      const def = getPhaseDefinition("DEPENDENCY");
      expect(def).not.toBeNull();
      expect(def!.scripts).toHaveLength(5);
    });

    it("all scripts are critical", () => {
      const def = getPhaseDefinition("DEPENDENCY");
      expect(def!.scripts.every((s) => s.critical)).toBe(true);
    });

    it("scripts have expected names", () => {
      const def = getPhaseDefinition("DEPENDENCY");
      const names = def!.scripts.map((s) => s.name);
      expect(names).toContain("deps:build");
      expect(names).toContain("deps:extract");
      expect(names).toContain("deps:diff");
      expect(names).toContain("scan:folders");
      expect(names).toContain("scan:priorities");
    });
  });

  // --- GEN Phase ---

  describe("GEN phase", () => {
    it("marks requiresAgent as true", () => {
      const def = getPhaseDefinition("GEN");
      expect(def).not.toBeNull();
      expect(def!.requiresAgent).toBe(true);
    });

    it("has empty scripts array", () => {
      const def = getPhaseDefinition("GEN");
      expect(def!.scripts).toHaveLength(0);
    });
  });

  // --- Unknown Phase ---

  describe("unknown phases", () => {
    it("returns null for unsupported phase ASSEMBLE", () => {
      expect(getPhaseDefinition("ASSEMBLE" as Phase)).toBeNull();
    });

    it("returns null for unsupported phase VALIDATE", () => {
      expect(getPhaseDefinition("VALIDATE" as Phase)).toBeNull();
    });

    it("returns null for FEEDBACK phase", () => {
      expect(getPhaseDefinition("FEEDBACK" as Phase)).toBeNull();
    });

    it("returns null for DONE phase", () => {
      expect(getPhaseDefinition("DONE" as Phase)).toBeNull();
    });

    it("returns null for INCREMENTAL phase", () => {
      expect(getPhaseDefinition("INCREMENTAL" as Phase)).toBeNull();
    });
  });
});
