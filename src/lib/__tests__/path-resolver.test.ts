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
import {
  resolvePaths,
  validatePathRules,
  detectMonorepoSources,
  countSourceFilesQuick,
} from "../pipeline/path-resolver.js";

const mockExistsSync = vi.mocked(
  fs.existsSync,
) as unknown as typeof fs.existsSync;
const mockStatSync = vi.mocked(fs.statSync) as unknown as typeof fs.statSync;
const mockReaddirSync = vi.mocked(
  fs.readdirSync,
) as unknown as typeof fs.readdirSync;

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
    // package.json exists at packages/app/ level, NOT inside packages/app/src/
    mockExistsSync.mockImplementation(
      (p: string) =>
        (p.includes("package.json") &&
          p.includes("packages/app") &&
          !p.includes("packages/app/src")) ||
        p === "/monorepo/packages/app/src",
    );
    const paths = resolvePaths("/monorepo", "packages/app/src");
    expect(paths.dataRoot).toBe("/monorepo/packages/app");
    expect(paths.wikiRoot).toBe("/monorepo/packages/app/wiki");
  });

  it("falls through to default source when src/ missing and no monorepo candidates", () => {
    // Only awRoot package.json exists (to resolve agentic-wiki root)
    // src/ does NOT exist, and no monorepo dirs exist
    mockExistsSync.mockImplementation(
      (p: string) => p.includes("package.json") && p.includes("agentic-wiki"),
    );
    const paths = resolvePaths("/project", undefined);
    expect(paths.sourceRoot).toBe("/project/src");
    expect(paths.dataRoot).toBe("/project");
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

describe("detectMonorepoSources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects packages with src/ directory", () => {
    mockExistsSync.mockImplementation((p: string) => p.includes("packages"));
    mockStatSync.mockReturnValue({
      isDirectory: () => true,
    } as unknown as fs.Stats);
    mockReaddirSync.mockReturnValueOnce([
      makeDirent("app", true),
      makeDirent("lib", true),
    ]);

    const result = detectMonorepoSources("/project");
    expect(result).toHaveLength(2);
    expect(result[0].packageName).toBe("app");
    expect(result[0].relativePath).toBe("packages/app/src");
  });

  it("returns empty when no known monorepo dirs exist", () => {
    mockExistsSync.mockReturnValue(false);
    const result = detectMonorepoSources("/project");
    expect(result).toEqual([]);
  });

  it("skips entries that are not directories", () => {
    mockExistsSync.mockImplementation((p: string) => p.includes("packages"));
    mockStatSync.mockReturnValue({
      isDirectory: () => false,
    } as unknown as fs.Stats);
    const result = detectMonorepoSources("/project");
    expect(result).toEqual([]);
  });

  it("skips packages without src/ directory", () => {
    mockExistsSync.mockImplementation(
      (p: string) => p.includes("packages") && !p.endsWith("/src"),
    );
    mockStatSync.mockReturnValue({
      isDirectory: () => true,
    } as unknown as fs.Stats);
    mockReaddirSync.mockReturnValue([makeDirent("app", true)]);

    const result = detectMonorepoSources("/project");
    expect(result).toEqual([]);
  });

  it("reads package.json for package name", () => {
    mockExistsSync.mockImplementation((p: string) => p.includes("packages"));
    mockStatSync.mockReturnValue({
      isDirectory: () => true,
    } as unknown as fs.Stats);
    mockReaddirSync.mockReturnValue([makeDirent("app", true)]);
    (
      vi.mocked(fs.readJsonSync) as unknown as typeof fs.readJsonSync
    ).mockReturnValue({ name: "@scope/app" });

    const result = detectMonorepoSources("/project");
    expect(result[0].packageName).toBe("@scope/app");
  });

  it("checks all known monorepo dirs", () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({
      isDirectory: () => true,
    } as unknown as fs.Stats);
    // Return different subdir for each known dir
    // mockReturnValueOnce consumed in call order: packages, apps, libs, modules
    mockReaddirSync
      .mockReturnValueOnce([makeDirent("pkg1", true)]) // packages/
      .mockReturnValueOnce([makeDirent("app1", true)]) // apps/
      .mockReturnValueOnce([makeDirent("lib1", true)]) // libs/
      .mockReturnValueOnce([makeDirent("mod1", true)]); // modules/

    const result = detectMonorepoSources("/project");
    expect(result).toHaveLength(4);
    expect(result.map((c) => c.relativePath).sort()).toEqual([
      "apps/app1/src",
      "libs/lib1/src",
      "modules/mod1/src",
      "packages/pkg1/src",
    ]);
  });
});

describe("countSourceFilesQuick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts .ts files at top level", () => {
    mockReaddirSync.mockReturnValue([
      makeDirent("a.ts", false),
      makeDirent("b.ts", false),
      makeDirent("readme.md", false),
    ]);

    const count = countSourceFilesQuick("/project/src");
    expect(count).toBe(2);
  });

  it("counts .tsx and .js files", () => {
    mockReaddirSync.mockReturnValue([
      makeDirent("a.tsx", false),
      makeDirent("b.js", false),
      makeDirent("c.jsx", false),
      makeDirent("d.json", false),
    ]);

    const count = countSourceFilesQuick("/project/src");
    expect(count).toBe(3);
  });

  it("counts files in subdirectories one level deep", () => {
    mockReaddirSync
      .mockReturnValueOnce([
        makeDirent("components", true),
        makeDirent("index.ts", false),
      ])
      .mockReturnValueOnce([
        makeDirent("Button.tsx", false),
        makeDirent("Input.tsx", false),
      ]);

    const count = countSourceFilesQuick("/project/src");
    expect(count).toBe(3);
  });

  it("returns 0 when readdirSync throws", () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error("read error");
    });
    const count = countSourceFilesQuick("/project/src");
    expect(count).toBe(0);
  });

  it("counts only source files in subdirectories", () => {
    mockReaddirSync
      .mockReturnValueOnce([makeDirent("utils", true)])
      .mockReturnValueOnce([
        makeDirent("helper.ts", false),
        makeDirent("notes.txt", false),
        makeDirent("data.json", false),
      ]);

    const count = countSourceFilesQuick("/project/src");
    expect(count).toBe(1);
  });
});
