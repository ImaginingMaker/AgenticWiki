import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs-extra", () => ({
  default: {
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readdirSync: vi.fn(),
    readJsonSync: vi.fn(),
  },
}));

import fs from "fs-extra";
import { resolvePaths, validatePathRules } from "../pipeline/path-resolver.js";

const mockExistsSync = vi.mocked(fs.existsSync) as any;
const mockStatSync = vi.mocked(fs.statSync) as any;
const mockReaddirSync = vi.mocked(fs.readdirSync) as any;

function makeDirent(name: string, isDir: boolean) {
  return { name, isFile: () => !isDir, isDirectory: () => isDir };
}

describe("resolvePaths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves default paths when src/ exists", () => {
    mockExistsSync.mockImplementation(
      (p: string) => p.endsWith("/src") || p.includes("package.json"),
    );
    const paths = resolvePaths("/project", undefined);
    expect(paths.projectRoot).toBe("/project");
    expect(paths.dataRoot).toBe("/project");
    expect(paths.sourceRoot).toBe("/project/src");
    expect(paths.wikiRoot).toBe("/project/wiki");
    expect(paths.cacheRoot).toContain(".agentic-wiki/cache");
  });

  it("resolves source override path", () => {
    // Only src/ exists, NOT a package.json in the source parent
    mockExistsSync.mockImplementation(
      (p: string) => p === "/project" || p.endsWith("/src"),
    );
    const paths = resolvePaths("/project", "packages/app/src");
    expect(paths.sourceRoot).toBe("/project/packages/app/src");
    expect(paths.dataRoot).toBe("/project");
  });

  it("detects monorepo source parent for dataRoot", () => {
    mockExistsSync.mockImplementation(
      (p: string) =>
        (p.includes("package.json") && p.includes("packages/app")) ||
        p.includes("src"),
    );
    const paths = resolvePaths("/monorepo", "packages/app/src");
    expect(paths.dataRoot).toBe("/monorepo/packages/app");
    expect(paths.wikiRoot).toBe("/monorepo/packages/app/wiki");
  });
});

describe("validatePathRules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes when all rules are valid", () => {
    mockExistsSync.mockReturnValue(true);
    const paths = {
      projectRoot: "/project",
      agenticWikiRoot: "/aw",
      wikiRoot: "/project/wiki",
      sourceRoot: "/project/src",
      cacheRoot: "/project/.agentic-wiki/cache",
      dataRoot: "/project",
      statePath: "",
      libDir: "",
    };
    // Should not throw or exit
    expect(() => validatePathRules(paths)).not.toThrow();
  });
});
