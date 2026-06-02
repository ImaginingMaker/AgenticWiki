/**
 * validate-paths.ts 单元测试
 *
 * 覆盖 validateAllPaths 函数的所有路径规则：
 * - PATH-000: config.paths 存在性检查（CRITICAL）
 * - PATH-001: projectRoot ≠ agenticWikiRoot（CRITICAL）
 * - PATH-002: wikiRoot = projectRoot + '/wiki'（CRITICAL）
 * - PATH-003: cacheRoot 在 projectRoot 下（CRITICAL）
 * - PATH-004: sourceRoot 在 projectRoot 下（REQUIRED）
 * - PATH-005: projectRoot 存在且包含源码（CRITICAL，依赖 fs.existsSync）
 * - PATH-006: projectRoot 不是 AgenticWiki 自身（CRITICAL，依赖 fs.existsSync）
 *
 * 注意：RULES 的 check 方法中 PATH-005/006 使用 fs.existsSync，
 * 但 validateAllPaths 本身是纯编排函数。需要 mock fs-extra 的 existsSync。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";

// Mock fs-extra 以控制 PATH-005（目录存在性）和 PATH-006（AgenticWiki 特征检测）
vi.mock("fs-extra", () => ({
  default: { existsSync: vi.fn() },
}));

import { validateAllPaths } from "../validate-paths.js";
import type { WikiState } from "../../types/index.js";
import fs from "fs-extra";

// ─── Types ───────────────────────────────────────────────────────────────────

const mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * 创建一个基础的有效 WikiState，paths 使用标准布局：
 *
 *   /test/project/               ← projectRoot
 *     package.json               ← 存在（PATH-005 通过）
 *     src/                       ← sourceRoot
 *     wiki/                      ← wikiRoot
 *     .agentic-wiki/cache/       ← cacheRoot
 *   /test/agentic-wiki/          ← agenticWikiRoot（不同于 projectRoot）
 */
function createValidState(
  overrides?: Partial<WikiState["config"]> & {
    paths?: Partial<WikiState["config"]["paths"]>;
  },
): WikiState {
  const defaultPaths = {
    projectRoot: "/test/project",
    agenticWikiRoot: "/test/agentic-wiki",
    sourceRoot: "/test/project/src",
    wikiRoot: "/test/project/wiki",
    cacheRoot: "/test/project/.agentic-wiki/cache",
  };

  // ⚠️ 必须解构 paths 避免 ...overrides 覆盖 paths: mergedPaths
  const { paths: pathsOverride, ...configOverrides } = overrides || {};
  const mergedPaths = pathsOverride
    ? { ...defaultPaths, ...pathsOverride }
    : defaultPaths;

  return {
    schemaVersion: 1,
    id: "test-id",
    projectPath: "/test/project",
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
      sourcePath: "src",
      wikiPath: "wiki",
      excludePatterns: [],
      language: "typescript",
      paths: mergedPaths,
      ...configOverrides,
    },
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // 默认行为：projectRoot 存在且包含 package.json，不是 AgenticWiki 自身
  // PATH-005 需要的检查：projectRoot 存在 + 有 package.json 或 src/
  // PATH-006 需要的检查：agents.md + skills/ 不存在
  mockExistsSync.mockImplementation((filePath: string) => {
    if (filePath === "/test/project") return true;
    if (filePath === "/test/project/package.json") return true;
    return false;
  });
});

// ─── Tests: Happy Path ───────────────────────────────────────────────────────

describe("validateAllPaths", () => {
  it("passes all rules with a valid state (happy path)", () => {
    const state = createValidState();
    const result = validateAllPaths(
      state,
      "/test/project/.agentic-wiki/state.json",
    );

    expect(result.passed).toBe(true);
    expect(result.criticalFailed).toBe(0);
    expect(result.requiredFailed).toBe(0);
    expect(result.rules).toHaveLength(6);
    expect(result.rules.every((r) => r.passed)).toBe(true);
  });

  it("returns correct result format", () => {
    const statePath = "/test/project/.agentic-wiki/state.json";
    const state = createValidState();
    const result = validateAllPaths(state, statePath);

    // 顶层字段
    expect(result).toHaveProperty("validatedAt");
    expect(result).toHaveProperty("statePath", statePath);
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("criticalFailed");
    expect(result).toHaveProperty("requiredFailed");
    expect(result).toHaveProperty("rules");

    // validatedAt 是 ISO 时间戳
    expect(() => new Date(result.validatedAt)).not.toThrow();
    expect(new Date(result.validatedAt).toISOString()).toBe(result.validatedAt);

    // rules 数组
    expect(Array.isArray(result.rules)).toBe(true);
    const rule = result.rules[0];
    expect(rule).toHaveProperty("id");
    expect(rule).toHaveProperty("label");
    expect(rule).toHaveProperty("level");
    expect(rule).toHaveProperty("passed");
    expect(rule).toHaveProperty("description");
    expect(rule).toHaveProperty("expected");
    expect(rule).toHaveProperty("actual");
    expect(rule).toHaveProperty("detail");
  });

  it("reports each rule with correct id and level", () => {
    const state = createValidState();
    const result = validateAllPaths(state, "/test/state.json");

    const ruleIds = result.rules.map((r) => r.id);
    expect(ruleIds).toEqual([
      "PATH-001",
      "PATH-002",
      "PATH-003",
      "PATH-004",
      "PATH-005",
      "PATH-006",
    ]);

    const criticalRules = result.rules.filter((r) => r.level === "CRITICAL");
    const requiredRules = result.rules.filter((r) => r.level === "REQUIRED");

    expect(criticalRules).toHaveLength(5); // PATH-001, 002, 003, 005, 006
    expect(requiredRules).toHaveLength(1); // PATH-004
  });

  it("includes validatedAt as a valid ISO timestamp", () => {
    const state = createValidState();
    const result = validateAllPaths(state, "/test/state.json");

    const ts = new Date(result.validatedAt);
    expect(ts.getTime()).not.toBeNaN();
    // Should be within the last few seconds
    expect(Date.now() - ts.getTime()).toBeLessThan(10_000);
  });
});

// ─── Tests: PATH-000 - Missing config.paths ──────────────────────────────────

describe("PATH-000: Missing config.paths", () => {
  it("returns PATH-000 failure when config.paths is undefined", () => {
    const state = createValidState();
    (state.config as any).paths = undefined;

    const result = validateAllPaths(state, "/test/state.json");

    expect(result.passed).toBe(false);
    expect(result.criticalFailed).toBe(1);
    expect(result.requiredFailed).toBe(0);
    expect(result.rules).toHaveLength(1);

    const rule = result.rules[0];
    expect(rule.id).toBe("PATH-000");
    expect(rule.level).toBe("CRITICAL");
    expect(rule.passed).toBe(false);
    expect(rule.actual).toBe("MISSING");
    expect(rule.detail).toBe("state.json 未初始化 — 运行 runner.ts 创建");
  });

  it("returns only PATH-000 when paths is missing (early return)", () => {
    const state = createValidState();
    delete (state.config as any).paths;

    const result = validateAllPaths(state, "/test/state.json");

    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].id).toBe("PATH-000");
  });

  it("returns PATH-000 failure when config.paths is null", () => {
    const state = createValidState();
    (state.config as any).paths = null;

    const result = validateAllPaths(state, "/test/state.json");

    expect(result.passed).toBe(false);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].id).toBe("PATH-000");
  });
});

// ─── Tests: PATH-001 - projectRoot vs agenticWikiRoot ───────────────────────

describe("PATH-001: projectRoot ≠ agenticWikiRoot", () => {
  it("fails when projectRoot equals agenticWikiRoot", () => {
    const state = createValidState({
      paths: {
        projectRoot: "/test/same-dir",
        agenticWikiRoot: "/test/same-dir",
        sourceRoot: "/test/same-dir/src",
        wikiRoot: "/test/same-dir/wiki",
        cacheRoot: "/test/same-dir/.agentic-wiki/cache",
      },
    });

    // 让 PATH-005/006 通过
    mockExistsSync.mockImplementation((filePath: string) => {
      if (filePath === "/test/same-dir") return true;
      if (filePath === "/test/same-dir/package.json") return true;
      return false;
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-001")!;
    expect(rule.passed).toBe(false);
    expect(rule.actual).toContain("EQUAL");
    expect(rule.detail).toContain("/test/same-dir");
    expect(result.criticalFailed).toBeGreaterThanOrEqual(1);
    expect(result.passed).toBe(false);
  });

  it("passes when paths are different strings even if one is a prefix", () => {
    const state = createValidState({
      paths: {
        projectRoot: "/test/project",
        agenticWikiRoot: "/test/project-agenticwiki",
        sourceRoot: "/test/project/src",
        wikiRoot: "/test/project/wiki",
        cacheRoot: "/test/project/.agentic-wiki/cache",
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-001")!;
    expect(rule.passed).toBe(true);
    expect(rule.actual).toContain("OK");
  });
});

// ─── Tests: PATH-002 - wikiRoot ──────────────────────────────────────────────

describe("PATH-002: wikiRoot = projectRoot + '/wiki'", () => {
  it("fails when wikiRoot is not under projectRoot", () => {
    const state = createValidState({
      paths: {
        wikiRoot: "/some/other/path/wiki",
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-002")!;
    expect(rule.passed).toBe(false);
    expect(rule.actual).toBe("/some/other/path/wiki");
    expect(rule.expected).toBe("/test/project/wiki");
    expect(result.criticalFailed).toBeGreaterThanOrEqual(1);
    expect(result.passed).toBe(false);
  });

  it("fails when wikiRoot is projectRoot but without /wiki suffix", () => {
    const state = createValidState({
      paths: {
        wikiRoot: "/test/project",
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-002")!;
    expect(rule.passed).toBe(false);
  });

  it("passes when wikiRoot equals projectRoot/wiki (resolved)", () => {
    // Use relative path to test path.resolve behavior
    const state = createValidState({
      paths: {
        projectRoot: "/test/project",
        wikiRoot: path.join("/test/project", "wiki"),
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-002")!;
    expect(rule.passed).toBe(true);
  });

  it("passes when wikiRoot uses different but equivalent path form", () => {
    // path.resolve normalizes double slashes etc.
    const state = createValidState({
      paths: {
        projectRoot: "/test/project",
        wikiRoot: "/test/project/./wiki",
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-002")!;
    expect(rule.passed).toBe(true);
  });
});

// ─── Tests: PATH-003 - cacheRoot under projectRoot ──────────────────────────

describe("PATH-003: cacheRoot under projectRoot", () => {
  it("fails when cacheRoot is completely outside projectRoot", () => {
    const state = createValidState({
      paths: {
        cacheRoot: "/somewhere/else/cache",
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-003")!;
    expect(rule.passed).toBe(false);
    expect(rule.actual).toContain("不在 projectRoot");
    expect(result.criticalFailed).toBeGreaterThanOrEqual(1);
    expect(result.passed).toBe(false);
  });

  it("fails when cacheRoot is a sibling path with similar prefix", () => {
    // Path separator + startsWith 防止前缀绕过
    const state = createValidState({
      paths: {
        projectRoot: "/test/project",
        cacheRoot: "/test/project-other/cache",
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-003")!;
    expect(rule.passed).toBe(false);
  });

  it("passes when cacheRoot is nested inside projectRoot", () => {
    const state = createValidState({
      paths: {
        cacheRoot: "/test/project/deeply/nested/cache",
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-003")!;
    expect(rule.passed).toBe(true);
  });

  it("passes when cacheRoot equals the standard path", () => {
    const state = createValidState();

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-003")!;
    expect(rule.passed).toBe(true);
    expect(rule.actual).toBe("OK");
    expect(rule.detail).toContain("在 projectRoot 内");
  });
});

// ─── Tests: PATH-004 - sourceRoot under projectRoot ─────────────────────────

describe("PATH-004: sourceRoot under projectRoot", () => {
  it("fails when sourceRoot is outside projectRoot", () => {
    const state = createValidState({
      paths: {
        sourceRoot: "/external/source",
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-004")!;
    expect(rule.passed).toBe(false);
    expect(rule.actual).toContain("不在 projectRoot");
    expect(result.requiredFailed).toBe(1);
  });

  it("passes when sourceRoot is directly inside projectRoot", () => {
    const state = createValidState({
      paths: {
        sourceRoot: "/test/project/packages/app/src",
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-004")!;
    expect(rule.passed).toBe(true);
  });

  it("fails when sourceRoot uses a prefix-matching sibling path", () => {
    const state = createValidState({
      paths: {
        projectRoot: "/test/project",
        sourceRoot: "/test/project-extension/src",
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-004")!;
    expect(rule.passed).toBe(false);
  });
});

// ─── Tests: PATH-005 - projectRoot exists with source code ──────────────────

describe("PATH-005: projectRoot exists with source code", () => {
  it("fails when projectRoot directory does not exist", () => {
    mockExistsSync.mockImplementation((filePath: string) => {
      // 所有路径都不存在
      return false;
    });

    const state = createValidState();
    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-005")!;
    expect(rule.passed).toBe(false);
    expect(rule.detail).toContain("不存在");
    expect(result.criticalFailed).toBeGreaterThanOrEqual(1);
    expect(result.passed).toBe(false);
  });

  it("fails when projectRoot exists but has no package.json or src/", () => {
    mockExistsSync.mockImplementation((filePath: string) => {
      if (filePath === "/test/project") return true;
      // 没有 package.json 也没有 src/
      return false;
    });

    const state = createValidState();
    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-005")!;
    expect(rule.passed).toBe(false);
    expect(rule.detail).toContain("未找到");
  });

  it("passes when projectRoot exists with package.json", () => {
    mockExistsSync.mockImplementation((filePath: string) => {
      if (filePath === "/test/project") return true;
      if (filePath === "/test/project/package.json") return true;
      return false;
    });

    const state = createValidState();
    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-005")!;
    expect(rule.passed).toBe(true);
    expect(rule.detail).toContain("package.json");
  });

  it("passes when projectRoot exists with src/ directory", () => {
    mockExistsSync.mockImplementation((filePath: string) => {
      if (filePath === "/test/project") return true;
      if (filePath === "/test/project/src") return true;
      return false;
    });

    const state = createValidState();
    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-005")!;
    expect(rule.passed).toBe(true);
    expect(rule.detail).toContain("src/");
  });

  it("passes when projectRoot exists with both package.json and src/", () => {
    mockExistsSync.mockImplementation((filePath: string) => {
      if (filePath === "/test/project") return true;
      if (filePath === "/test/project/package.json") return true;
      if (filePath === "/test/project/src") return true;
      return false;
    });

    const state = createValidState();
    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-005")!;
    expect(rule.passed).toBe(true);
  });
});

// ─── Tests: PATH-006 - projectRoot is NOT AgenticWiki itself ────────────────

describe("PATH-006: projectRoot is NOT AgenticWiki itself", () => {
  it("fails when projectRoot has both agents.md and skills/", () => {
    mockExistsSync.mockImplementation((filePath: string) => {
      if (filePath === "/test/project") return true;
      if (filePath === "/test/project/package.json") return true;
      if (filePath === "/test/project/agents.md") return true;
      if (filePath === "/test/project/skills") return true;
      return false;
    });

    const state = createValidState();
    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-006")!;
    expect(rule.passed).toBe(false);
    expect(rule.actual).toContain("AgenticWiki");
    expect(result.criticalFailed).toBeGreaterThanOrEqual(1);
    expect(result.passed).toBe(false);
  });

  it("passes when projectRoot has only agents.md (no skills/)", () => {
    mockExistsSync.mockImplementation((filePath: string) => {
      if (filePath === "/test/project") return true;
      if (filePath === "/test/project/package.json") return true;
      if (filePath === "/test/project/agents.md") return true;
      return false;
    });

    const state = createValidState();
    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-006")!;
    expect(rule.passed).toBe(true);
  });

  it("passes when projectRoot has only skills/ (no agents.md)", () => {
    mockExistsSync.mockImplementation((filePath: string) => {
      if (filePath === "/test/project") return true;
      if (filePath === "/test/project/package.json") return true;
      if (filePath === "/test/project/skills") return true;
      return false;
    });

    const state = createValidState();
    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-006")!;
    expect(rule.passed).toBe(true);
  });

  it("passes when neither agents.md nor skills/ exist", () => {
    // beforeEach 的默认 mock 已经满足：只返回 projectRoot + package.json
    const state = createValidState();
    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-006")!;
    expect(rule.passed).toBe(true);
    expect(rule.actual).toBe("OK (非 AgenticWiki)");
  });
});

// ─── Tests: Edge Cases ───────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles empty string projectRoot", () => {
    const state = createValidState({
      paths: {
        projectRoot: "",
        agenticWikiRoot: "/test/agentic-wiki",
        sourceRoot: "/src",
        wikiRoot: "/wiki",
        cacheRoot: "/.agentic-wiki/cache",
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    // 空的 projectRoot 导致 PATH-001 不会触发（不相等）
    const rule001 = result.rules.find((r) => r.id === "PATH-001")!;
    expect(rule001.passed).toBe(true); // "" !== "/test/agentic-wiki"

    // PATH-002: path.resolve("") = cwd, path.resolve(path.join("", "wiki")) = cwd/wiki
    // 在绝对路径上下文中，"" 解析为 cwd，所以这可能会通过也可能不通过
    // 我们只检查不崩溃
    expect(result.rules).toHaveLength(6);
  });

  it("handles state with extra unknown properties (forward compat)", () => {
    const state = createValidState() as any;
    state.config.unknownProp = "should-be-ignored";
    state.extraField = { nested: true };

    const result = validateAllPaths(state, "/test/state.json");
    expect(result.passed).toBe(true);
  });

  it("returns consistent rule order on every call", () => {
    const state = createValidState();
    const result1 = validateAllPaths(state, "/test/state.json");
    const result2 = validateAllPaths(state, "/test/state.json");

    const ids1 = result1.rules.map((r) => r.id);
    const ids2 = result2.rules.map((r) => r.id);
    expect(ids1).toEqual(ids2);
  });

  it("accepts custom state path in result", () => {
    const customPath = "/custom/path/state.json";
    const state = createValidState();
    const result = validateAllPaths(state, customPath);
    expect(result.statePath).toBe(customPath);
  });
});

// ─── Tests: Combined Fails ───────────────────────────────────────────────────

describe("multiple simultaneous failures", () => {
  it("reports multiple failures at once (PATH-001 + PATH-002 + PATH-003)", () => {
    const state = createValidState({
      paths: {
        projectRoot: "/test/project",
        agenticWikiRoot: "/test/project", // PATH-001 fail
        sourceRoot: "/test/project/src",
        wikiRoot: "/not-under-project/wiki", // PATH-002 fail
        cacheRoot: "/outside/cache", // PATH-003 fail
      },
    });

    // PATH-005: 让 projectRoot 存在性通过
    mockExistsSync.mockImplementation((filePath: string) => {
      if (filePath === "/test/project") return true;
      if (filePath === "/test/project/package.json") return true;
      return false;
    });

    const result = validateAllPaths(state, "/test/state.json");

    expect(result.rules.filter((r) => !r.passed)).toHaveLength(3);
    expect(result.rules.find((r) => r.id === "PATH-001")!.passed).toBe(false);
    expect(result.rules.find((r) => r.id === "PATH-002")!.passed).toBe(false);
    expect(result.rules.find((r) => r.id === "PATH-003")!.passed).toBe(false);
    expect(result.criticalFailed).toBe(3);
    expect(result.requiredFailed).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("reports mixed CRITICAL and REQUIRED failures", () => {
    const state = createValidState({
      paths: {
        projectRoot: "/test/project",
        agenticWikiRoot: "/test/project", // PATH-001 fail (CRITICAL)
        sourceRoot: "/outside/src", // PATH-004 fail (REQUIRED)
        wikiRoot: "/test/project/wiki",
        cacheRoot: "/test/project/.agentic-wiki/cache",
      },
    });

    mockExistsSync.mockImplementation((filePath: string) => {
      if (filePath === "/test/project") return true;
      if (filePath === "/test/project/package.json") return true;
      return false;
    });

    const result = validateAllPaths(state, "/test/state.json");

    expect(result.criticalFailed).toBe(1); // PATH-001
    expect(result.requiredFailed).toBe(1); // PATH-004
    expect(result.passed).toBe(false); // CRITICAL 有失败
  });
});

// ─── Tests: Same projectRoot traversal via path.resolve ─────────────────────

describe("path.resolve behavior", () => {
  it("resolves relative wikiRoot correctly via path.resolve", () => {
    const state = createValidState({
      paths: {
        projectRoot: "/test/project",
        wikiRoot: path.join("/test/project", "wiki"),
      },
    });

    const result = validateAllPaths(state, "/test/state.json");
    const rule = result.rules.find((r) => r.id === "PATH-002")!;
    expect(rule.passed).toBe(true);
  });

  it("startsWith check prevents path prefix bypass in PATH-003", () => {
    // 类似 /test/project-extra/.agentic-wiki/cache 不应被 /test/project 匹配
    const state = createValidState({
      paths: {
        projectRoot: "/test/project",
        cacheRoot: "/test/project-extra/.agentic-wiki/cache",
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-003")!;
    expect(rule.passed).toBe(false);
  });

  it("startsWith check prevents path prefix bypass in PATH-004", () => {
    const state = createValidState({
      paths: {
        projectRoot: "/test/project",
        sourceRoot: "/test/project-another/src",
      },
    });

    const result = validateAllPaths(state, "/test/state.json");

    const rule = result.rules.find((r) => r.id === "PATH-004")!;
    expect(rule.passed).toBe(false);
  });
});
