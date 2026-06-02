import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs-extra", () => ({
  default: {
    ensureDirSync: vi.fn(),
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

import fs from "fs-extra";
import { ensureDirectories, ensureFeedbackSeed } from "../pipeline/setup.js";

const mockEnsureDirSync = vi.mocked(fs.ensureDirSync) as unknown as typeof fs.ensureDirSync;
const mockExistsSync = vi.mocked(fs.existsSync) as unknown as typeof fs.existsSync;
const mockWriteFileSync = vi.mocked(fs.writeFileSync) as unknown as typeof fs.writeFileSync;

function makePaths(dataRoot: string) {
  return {
    projectRoot: dataRoot,
    agenticWikiRoot: "/aw",
    wikiRoot: "",
    sourceRoot: "",
    cacheRoot: "",
    statePath: "",
    libDir: "",
    dataRoot,
  };
}

describe("ensureDirectories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates all required directories", () => {
    ensureDirectories(makePaths("/root"));
    // 13 dirs total
    expect(mockEnsureDirSync).toHaveBeenCalledTimes(13);
    expect(mockEnsureDirSync).toHaveBeenCalledWith(
      "/root/.agentic-wiki/cache/deps",
    );
    expect(mockEnsureDirSync).toHaveBeenCalledWith(
      "/root/.agentic-wiki/feedback",
    );
    expect(mockEnsureDirSync).toHaveBeenCalledWith("/root/wiki/volume-1-code");
    expect(mockEnsureDirSync).toHaveBeenCalledWith(
      "/root/wiki/volume-2-issues/ch-06-potential-bugs",
    );
  });
});

describe("ensureFeedbackSeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips creation when file already exists", () => {
    mockExistsSync.mockReturnValue(true);
    ensureFeedbackSeed("/root");
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("creates seed file when missing", () => {
    mockExistsSync.mockReturnValue(false);
    ensureFeedbackSeed("/root");
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const path = mockWriteFileSync.mock.calls[0][0] as string;
    const content = mockWriteFileSync.mock.calls[0][1] as string;
    expect(path).toBe("/root/.agentic-wiki/feedback/prompts.md");
    expect(content).toContain("反馈积累与策略改进");
    expect(content).toContain("Issue 状态机");
  });
});
