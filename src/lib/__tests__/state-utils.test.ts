import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs-extra", () => ({
  default: {
    existsSync: vi.fn(),
    readJsonSync: vi.fn(),
    writeJsonSync: vi.fn(),
  },
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import fs from "fs-extra";
import { execSync } from "node:child_process";
import {
  loadState,
  saveStatePhase,
  isPhaseCompleted,
  getCurrentPhase,
  initializeState,
} from "../pipeline/state-utils.js";
import type { ResolvedPaths, RunnerArgs } from "../pipeline/path-resolver.js";

const mockExistsSync = vi.mocked(fs.existsSync) as any;
const mockReadJsonSync = vi.mocked(fs.readJsonSync) as any;
const mockWriteJsonSync = vi.mocked(fs.writeJsonSync) as any;
const mockExecSync = vi.mocked(execSync) as any;

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
    mode: "full" as const,
    since: undefined,
    dryRun: false,
    force: false,
    ...overrides,
  };
}

describe("loadState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when state.json does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadState("/path/to/state.json")).toBeNull();
  });

  it("reads and returns state when file exists", () => {
    mockExistsSync.mockReturnValue(true);
    const mockState = { currentPhase: "GEN", phaseHistory: [] };
    mockReadJsonSync.mockReturnValue(mockState);
    expect(loadState("/path/to/state.json")).toEqual(mockState);
    expect(mockReadJsonSync).toHaveBeenCalledWith("/path/to/state.json");
  });
});

describe("saveStatePhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls state-manager with correct args", () => {
    mockExecSync.mockReturnValue("");
    saveStatePhase(
      "/state.json",
      "/lib",
      "/cwd",
      "SCAN",
      "completed",
      "DEPENDENCY",
      ["file.json"],
      ["script.ts:0"],
    );
    const cmd = mockExecSync.mock.calls[0][0] as string;
    expect(cmd).toContain("state-manager.ts");
    expect(cmd).toContain("transition");
    expect(cmd).toContain("--phase SCAN");
    expect(cmd).toContain("--status completed");
    expect(cmd).toContain("--next-phase DEPENDENCY");
    expect(cmd).toContain("--gate");
  });

  it("does not throw on failure", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("fail");
    });
    expect(() =>
      saveStatePhase(
        "/s.json",
        "/lib",
        "/cwd",
        "GEN",
        "in_progress",
        "GEN",
        [],
        [],
      ),
    ).not.toThrow();
  });
});

describe("initializeState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls state-manager init and patches paths", () => {
    mockExecSync.mockReturnValue("");
    mockReadJsonSync.mockReturnValue({
      config: {
        paths: {
          projectRoot: "",
          agenticWikiRoot: "",
          wikiRoot: "",
          sourceRoot: "",
          cacheRoot: "",
        },
      },
    });

    const state = initializeState(makePaths(), makeArgs());
    expect(mockExecSync).toHaveBeenCalled();
    const cmd = mockExecSync.mock.calls[0][0] as string;
    expect(cmd).toContain("state-manager.ts");
    expect(cmd).toContain("init");
    expect(cmd).toContain('--project "/project"');
    expect(mockWriteJsonSync).toHaveBeenCalled();
  });

  it("passes --source when source is specified", () => {
    mockExecSync.mockReturnValue("");
    mockReadJsonSync.mockReturnValue({
      config: {
        paths: {
          projectRoot: "",
          agenticWikiRoot: "",
          wikiRoot: "",
          sourceRoot: "",
          cacheRoot: "",
        },
      },
    });
    initializeState(makePaths(), makeArgs({ source: "packages/app/src" }));
    const cmd = mockExecSync.mock.calls[0][0] as string;
    expect(cmd).toContain('--source "packages/app/src"');
  });

  it("exits on execSync failure", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("init failed");
    });
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    initializeState(makePaths(), makeArgs());
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe("isPhaseCompleted", () => {
  it("returns false when state is null", () => {
    expect(isPhaseCompleted(null, "INIT")).toBe(false);
  });
  it("returns true when phase is completed", () => {
    expect(
      isPhaseCompleted(
        { phaseHistory: [{ phase: "INIT", status: "completed" }] } as any,
        "INIT",
      ),
    ).toBe(true);
  });
  it("returns false when phase is not completed", () => {
    expect(
      isPhaseCompleted(
        { phaseHistory: [{ phase: "INIT", status: "in_progress" }] } as any,
        "INIT",
      ),
    ).toBe(false);
  });
  it("returns false when phase not in history", () => {
    expect(isPhaseCompleted({ phaseHistory: [] } as any, "SCAN")).toBe(false);
  });
});

describe("getCurrentPhase", () => {
  it("returns INIT when state is null", () =>
    expect(getCurrentPhase(null)).toBe("INIT"));
  it("returns currentPhase from state", () =>
    expect(getCurrentPhase({ currentPhase: "ASSEMBLE" } as any)).toBe(
      "ASSEMBLE",
    ));
  it("returns INIT when currentPhase is empty", () =>
    expect(getCurrentPhase({ currentPhase: "" } as any)).toBe("INIT"));
});
