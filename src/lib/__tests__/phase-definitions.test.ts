import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs-extra", () => ({
  default: { existsSync: vi.fn() },
}));

import fs from "fs-extra";
import { getPhaseDefinition, DAG_ORDER } from "../pipeline/phase-definitions.js";
import type { ResolvedPaths, RunnerArgs } from "../pipeline/path-resolver.js";

const mockExistsSync = vi.mocked(fs.existsSync) as any;

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
    expect(DAG_ORDER).toEqual(["INIT", "SCAN", "DEPENDENCY", "GEN", "ASSEMBLE", "VALIDATE"]);
  });
});

describe("getPhaseDefinition", () => {
  beforeEach(() => { vi.clearAllMocks(); });

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
    expect(def!.scripts[0].name).toBe("scan-project.ts");
    expect(def!.scripts[1].name).toBe("compute-hashes.ts");
  });

  it("returns SCAN phase with 2 scripts", () => {
    const def = getPhaseDefinition("SCAN", makePaths(), makeArgs());
    expect(def).not.toBeNull();
    expect(def!.order).toBe(1);
    expect(def!.scripts).toHaveLength(2);
    expect(def!.scripts[0].name).toBe("scan-files.ts");
    expect(def!.scripts[1].name).toBe("filter-styles.ts");
    expect(def!.scripts[1].critical).toBe(false);
  });

  it("returns DEPENDENCY phase with 7 scripts", () => {
    const def = getPhaseDefinition("DEPENDENCY", makePaths(), makeArgs());
    expect(def).not.toBeNull();
    expect(def!.order).toBe(2);
    expect(def!.scripts).toHaveLength(7);
    expect(def!.scripts[0].name).toBe("build-deps.ts");
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
    const def = getPhaseDefinition("GEN", makePaths(), makeArgs({ tokenLimit: 300000 }));
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
    const def = getPhaseDefinition("GEN", makePaths(), makeArgs({ resume: true }));
    expect(def!.scripts[0].args).toContain("--resume");
  });

  it("returns ASSEMBLE phase with 8 scripts", () => {
    const def = getPhaseDefinition("ASSEMBLE", makePaths(), makeArgs());
    expect(def).not.toBeNull();
    expect(def!.order).toBe(4);
    expect(def!.scripts).toHaveLength(8);
    const names = def!.scripts.map((s) => s.name);
    expect(names).toContain("assemble-book.ts");
    expect(names).toContain("symbol-index.ts");
    expect(names).toContain("fix-issue-paths.ts");
  });

  it("returns VALIDATE phase with 2 scripts", () => {
    const def = getPhaseDefinition("VALIDATE", makePaths(), makeArgs());
    expect(def).not.toBeNull();
    expect(def!.order).toBe(5);
    expect(def!.scripts).toHaveLength(2);
    expect(def!.scripts[0].name).toBe("validate-references.ts");
  });

  it("SCRIPT builds correct CLI paths", () => {
    const paths = makePaths({ cacheRoot: "/cache" });
    const def = getPhaseDefinition("INIT", paths, makeArgs());
    const outputFlag = def!.scripts[0].args.indexOf("--output");
    expect(def!.scripts[0].args[outputFlag + 1]).toBe("/cache/project-scan.json");
  });
});
