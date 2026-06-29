import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs-extra", () => ({
  default: { existsSync: vi.fn() },
}));

import fs from "fs-extra";
import {
  getPhaseDefinition,
  DAG_ORDER,
  computePhaseRange,
} from "../pipeline/phase-definitions.js";
import type { ResolvedPaths, RunnerArgs } from "../pipeline/path-resolver.js";

const mockExistsSync = vi.mocked(
  fs.existsSync,
) as unknown as typeof fs.existsSync;

function makePaths(overrides?: Partial<ResolvedPaths>): ResolvedPaths {
  return {
    projectRoot: "/project",
    agenticWikiRoot: "/aw",
    wikiRoot: "/project/wiki",
    sourceRoot: "/project/src",
    cacheRoot: "/project/.agentic-wiki/cache",
    statePath: "/project/.agentic-wiki/state.json",
    libDir: "/aw/src/lib",
    dataRoot: "/project",
    ...overrides,
  };
}

function makeArgs(overrides?: Partial<RunnerArgs>): RunnerArgs {
  return {
    project: "/project",
    source: undefined,
    to: undefined,
    only: undefined,
    resume: false,
    limit: 5,
    tokenLimit: undefined,
    mode: "full",
    since: undefined,
    dryRun: false,
    force: false,
    ...overrides,
  };
}

describe("DAG_ORDER", () => {
  it("defines correct phase order", () => {
    expect(DAG_ORDER).toEqual([
      "INIT",
      "SCAN",
      "DEPENDENCY",
      "GEN",
      "ASSEMBLE",
      "VALIDATE",
    ]);
  });
});

// ─── computePhaseRange (pure) ─────────────────────────────────────

describe("computePhaseRange", () => {
  it("returns empty array when both start and target are null", () => {
    expect(computePhaseRange(null, null)).toEqual([]);
  });

  it("returns phases from start to DONE when target is null", () => {
    const result = computePhaseRange("SCAN", null);
    expect(result).toContain("SCAN");
    expect(result).toContain("DEPENDENCY");
    expect(result).toContain("GEN");
    expect(result).toContain("ASSEMBLE");
    expect(result).toContain("VALIDATE");
    expect(result).not.toContain("INIT");
  });

  it("returns single phase when --only is used (start === target)", () => {
    const result = computePhaseRange("INIT", "INIT");
    expect(result).toEqual(["INIT"]);
  });

  it("returns phases from INIT to GEN when targeting GEN", () => {
    const result = computePhaseRange("INIT", "GEN");
    expect(result).toEqual(["INIT", "SCAN", "DEPENDENCY", "GEN"]);
  });

  it("includes ASSEMBLE and VALIDATE when targeting DONE", () => {
    const result = computePhaseRange("GEN", "DONE");
    expect(result).toContain("GEN");
    expect(result).toContain("ASSEMBLE");
    expect(result).toContain("VALIDATE");
  });

  it("returns phases from start to target in correct order", () => {
    const result = computePhaseRange("DEPENDENCY", "ASSEMBLE");
    expect(result).toEqual(["DEPENDENCY", "GEN", "ASSEMBLE"]);
  });

  it("starts from INIT when startPhase is null and target is provided", () => {
    const result = computePhaseRange(null, "GEN");
    expect(result).toEqual(["INIT", "SCAN", "DEPENDENCY", "GEN"]);
  });

  it("includes GEN when going from GEN to DONE", () => {
    const result = computePhaseRange("GEN", "DONE");
    expect(result[0]).toBe("GEN");
    expect(result[result.length - 1]).toBe("VALIDATE");
  });

  it("includes all 6 phases from INIT to DONE", () => {
    const result = computePhaseRange("INIT", "DONE");
    expect(result).toHaveLength(6);
    expect(result).toEqual([
      "INIT",
      "SCAN",
      "DEPENDENCY",
      "GEN",
      "ASSEMBLE",
      "VALIDATE",
    ]);
  });

  // BUG-13 regression: startPhase=VALIDATE, target=DONE must keep DAG order
  it("BUG-13: VALIDATE→DONE returns [ASSEMBLE, VALIDATE] in DAG order, not [VALIDATE, ASSEMBLE]", () => {
    const result = computePhaseRange("VALIDATE", "DONE");
    expect(result).toEqual(["ASSEMBLE", "VALIDATE"]);
  });

  it("BUG-13: ASSEMBLE→DONE returns [ASSEMBLE, VALIDATE] in DAG order", () => {
    const result = computePhaseRange("ASSEMBLE", "DONE");
    expect(result).toEqual(["ASSEMBLE", "VALIDATE"]);
  });
});

describe("getPhaseDefinition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for unknown phase", () => {
    expect(getPhaseDefinition("UNKNOWN", makePaths(), makeArgs())).toBeNull();
  });

  it("returns INIT phase with 2 scripts", () => {
    const def = getPhaseDefinition("INIT", makePaths(), makeArgs());
    expect(def).not.toBeNull();
    expect(def!.id).toBe("INIT");
    expect(def!.label).toContain("项目初始化");
    expect(def!.order).toBe(0);
    expect(def!.requiresAgent).toBe(false);
    expect(def!.scripts).toHaveLength(2);
    expect(def!.scripts[0].name).toBe("scan/scan-project.ts");
    expect(def!.scripts[1].name).toBe("dependency/compute-hashes.ts");
  });

  it("INIT: does NOT pass --source when sourceRoot is projectRoot/src (default)", () => {
    const def = getPhaseDefinition("INIT", makePaths(), makeArgs());
    const args = def!.scripts[0].args;
    expect(args).toContain("--path");
    expect(args).not.toContain("--source");
  });

  it("INIT: passes --source when sourceRoot differs from default src", () => {
    const paths = makePaths({
      sourceRoot: "/project/packages/muya/src",
    });
    const def = getPhaseDefinition("INIT", paths, makeArgs());
    const args = def!.scripts[0].args;
    expect(args).toContain("--source");
    expect(args).toContain("packages/muya/src");
  });

  it("returns SCAN phase with 2 scripts", () => {
    const def = getPhaseDefinition("SCAN", makePaths(), makeArgs());
    expect(def).not.toBeNull();
    expect(def!.order).toBe(1);
    expect(def!.scripts).toHaveLength(2);
    expect(def!.scripts[0].name).toBe("scan/scan-files.ts");
    expect(def!.scripts[1].name).toBe("scan/filter-styles.ts");
    expect(def!.scripts[1].critical).toBe(false);
  });

  it("returns DEPENDENCY phase with 8 scripts", () => {
    const def = getPhaseDefinition("DEPENDENCY", makePaths(), makeArgs());
    expect(def).not.toBeNull();
    expect(def!.order).toBe(2);
    expect(def!.scripts).toHaveLength(8);
    expect(def!.scripts[0].name).toBe("dependency/build-deps.ts");
    expect(def!.scripts[0].args).toContain("--format");
    expect(def!.scripts[0].args).toContain("json");
  });

  it("returns GEN phase with cluster mode when task-clusters.json exists", () => {
    mockExistsSync.mockReturnValue(true);
    const def = getPhaseDefinition("GEN", makePaths(), makeArgs());
    expect(def).not.toBeNull();
    expect(def!.order).toBe(3);
    expect(def!.requiresAgent).toBe(true);
    expect(def!.scripts).toHaveLength(1);
    expect(def!.scripts[0].args).toContain("--clusters");
  });

  it("returns GEN phase with folder strategy when no clusters", () => {
    mockExistsSync.mockReturnValue(false);
    const def = getPhaseDefinition("GEN", makePaths(), makeArgs());
    expect(def).not.toBeNull();
    expect(def!.scripts[0].args).toContain("--strategy");
    expect(def!.scripts[0].args).not.toContain("--clusters");
  });

  it("GEN uses token-limit when specified", () => {
    mockExistsSync.mockReturnValue(false);
    const def = getPhaseDefinition(
      "GEN",
      makePaths(),
      makeArgs({ tokenLimit: 300000 }),
    );
    expect(def!.scripts[0].args).toContain("--token-limit");
    expect(def!.scripts[0].args).toContain("300000");
  });

  it("GEN uses limit when no token-limit", () => {
    mockExistsSync.mockReturnValue(false);
    const def = getPhaseDefinition("GEN", makePaths(), makeArgs({ limit: 10 }));
    expect(def!.scripts[0].args).toContain("--limit");
    expect(def!.scripts[0].args).toContain("10");
  });

  it("GEN adds --resume when resume is true", () => {
    mockExistsSync.mockReturnValue(false);
    const def = getPhaseDefinition(
      "GEN",
      makePaths(),
      makeArgs({ resume: true }),
    );
    expect(def!.scripts[0].args).toContain("--resume");
  });

  it("returns ASSEMBLE phase with 10 scripts", () => {
    const def = getPhaseDefinition("ASSEMBLE", makePaths(), makeArgs());
    expect(def).not.toBeNull();
    expect(def!.order).toBe(4);
    expect(def!.scripts).toHaveLength(10);
    const names = def!.scripts.map((s) => s.name);
    expect(names).toContain("assemble/assemble-book.ts");
    expect(names).toContain("assemble/symbol-index.ts");
    expect(names).toContain("assemble/fix-issue-paths.ts");
    expect(names).toContain("experience/assemble-experience.ts");
    expect(names).toContain("validate/dedup-issues.ts");
  });

  it("ASSEMBLE passes --clusters when task-clusters.json exists", () => {
    mockExistsSync.mockReturnValue(true);
    const def = getPhaseDefinition("ASSEMBLE", makePaths(), makeArgs());
    const bookScript = def!.scripts.find(
      (s) => s.name === "assemble/assemble-book.ts",
    );
    expect(bookScript!.args).toContain("--clusters");
  });

  it("returns VALIDATE phase with 2 scripts", () => {
    const def = getPhaseDefinition("VALIDATE", makePaths(), makeArgs());
    expect(def).not.toBeNull();
    expect(def!.order).toBe(5);
    expect(def!.scripts).toHaveLength(2);
    expect(def!.scripts[0].name).toBe("validate/validate-references.ts");
  });

  it("SCRIPT builds correct CLI paths", () => {
    const paths = makePaths({ cacheRoot: "/cache" });
    const def = getPhaseDefinition("INIT", paths, makeArgs());
    const outputFlag = def!.scripts[0].args.indexOf("--output");
    expect(def!.scripts[0].args[outputFlag + 1]).toBe(
      "/cache/project-scan.json",
    );
  });
});
