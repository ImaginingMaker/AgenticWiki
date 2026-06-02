import { describe, it, expect, vi, beforeEach } from "vitest";
import { globby } from "globby";
import { scanFiles } from "../scan/scan-files.js";

// Mock 外部依赖
vi.mock("globby");

const mockedGlobby = vi.mocked(globby);

describe("scanFiles", () => {
  const sourcePath = "/fake/project/src";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("正常路径", () => {
    it("应正确扫描并返回文件列表", async () => {
      mockedGlobby.mockResolvedValue([
        "components/Button.tsx",
        "components/Input.tsx",
        "utils/helper.ts",
        "App.tsx",
        "index.ts",
      ]);

      const result = await scanFiles(sourcePath);

      expect(result.sourcePath).toBe(sourcePath);
      expect(result.totalFiles).toBe(5);
      expect(result.files).toEqual([
        "App.tsx",
        "components/Button.tsx",
        "components/Input.tsx",
        "index.ts",
        "utils/helper.ts",
      ]);
      expect(result.scannedAt).toBeTruthy();
    });

    it("应正确按扩展名统计", async () => {
      mockedGlobby.mockResolvedValue([
        "App.tsx",
        "index.ts",
        "utils/helper.ts",
        "components/Button.tsx",
        "main.jsx",
        "style.js",
        "Page.vue",
        "Widget.svelte",
      ]);

      const result = await scanFiles(sourcePath);

      expect(result.byExtension).toEqual({
        ".ts": 2,
        ".tsx": 2,
        ".js": 1,
        ".jsx": 1,
        ".vue": 1,
        ".svelte": 1,
      });
    });

    it("应只扫描源码文件扩展名", async () => {
      mockedGlobby.mockResolvedValue([
        "App.tsx",
        "index.ts",
        "readme.md",
        "config.json",
      ]);

      const result = await scanFiles(sourcePath);

      // globby 的 patterns 已限定扩展名，但 byExtension 只统计已知扩展名
      expect(result.byExtension[".ts"]).toBe(1);
      expect(result.byExtension[".tsx"]).toBe(1);
      // .md 和 .json 不在统计范围内
      expect(result.byExtension[".md"]).toBeUndefined();
    });

    it("应传递正确的 globby 参数", async () => {
      mockedGlobby.mockResolvedValue([]);

      await scanFiles(sourcePath);

      expect(mockedGlobby).toHaveBeenCalledWith(
        [
          "**/*.ts",
          "**/*.tsx",
          "**/*.js",
          "**/*.jsx",
          "**/*.vue",
          "**/*.svelte",
        ],
        expect.objectContaining({
          cwd: sourcePath,
          ignore: expect.arrayContaining([
            "node_modules",
            "dist",
            "build",
            ".git",
          ]),
          onlyFiles: true,
          gitignore: true,
          absolute: false,
        }),
      );
    });

    it("文件列表应按字母排序", async () => {
      mockedGlobby.mockResolvedValue([
        "z-last.ts",
        "a-first.ts",
        "m-middle.ts",
      ]);

      const result = await scanFiles(sourcePath);

      expect(result.files).toEqual(["a-first.ts", "m-middle.ts", "z-last.ts"]);
    });
  });

  describe("边界情况", () => {
    it("空目录应返回空文件列表", async () => {
      mockedGlobby.mockResolvedValue([]);

      const result = await scanFiles(sourcePath);

      expect(result.totalFiles).toBe(0);
      expect(result.files).toEqual([]);
      expect(result.byExtension).toEqual({
        ".ts": 0,
        ".tsx": 0,
        ".js": 0,
        ".jsx": 0,
        ".vue": 0,
        ".svelte": 0,
      });
    });

    it("只有一种扩展名的文件", async () => {
      mockedGlobby.mockResolvedValue(["a.ts", "b.ts", "c.ts"]);

      const result = await scanFiles(sourcePath);

      expect(result.totalFiles).toBe(3);
      expect(result.byExtension[".ts"]).toBe(3);
      expect(result.byExtension[".tsx"]).toBe(0);
    });

    it("深层嵌套文件应被正确扫描", async () => {
      mockedGlobby.mockResolvedValue(["a/b/c/d/deep.ts"]);

      const result = await scanFiles(sourcePath);

      expect(result.totalFiles).toBe(1);
      expect(result.files).toEqual(["a/b/c/d/deep.ts"]);
    });
  });

  describe("错误处理", () => {
    it("globby 扫描失败时应抛出错误", async () => {
      mockedGlobby.mockRejectedValue(new Error("Permission denied"));

      await expect(scanFiles(sourcePath)).rejects.toThrow("Permission denied");
    });

    it("路径不存在时 globby 应抛出错误", async () => {
      mockedGlobby.mockRejectedValue(new Error("ENOENT: no such directory"));

      await expect(scanFiles("/nonexistent/src")).rejects.toThrow("ENOENT");
    });
  });

  describe("忽略规则", () => {
    it("应忽略 node_modules 目录", async () => {
      mockedGlobby.mockResolvedValue(["src/App.tsx"]);

      await scanFiles(sourcePath);

      const callArgs = mockedGlobby.mock.calls[0][1] as unknown;
      expect(callArgs.ignore).toContain("node_modules");
    });

    it("应忽略 dist 目录", async () => {
      mockedGlobby.mockResolvedValue([]);

      await scanFiles(sourcePath);

      const callArgs = mockedGlobby.mock.calls[0][1] as unknown;
      expect(callArgs.ignore).toContain("dist");
    });

    it("应忽略 build 目录", async () => {
      mockedGlobby.mockResolvedValue([]);

      await scanFiles(sourcePath);

      const callArgs = mockedGlobby.mock.calls[0][1] as unknown;
      expect(callArgs.ignore).toContain("build");
    });

    it("应忽略 .git 目录", async () => {
      mockedGlobby.mockResolvedValue([]);

      await scanFiles(sourcePath);

      const callArgs = mockedGlobby.mock.calls[0][1] as unknown;
      expect(callArgs.ignore).toContain(".git");
    });

    it("应支持 gitignore", async () => {
      mockedGlobby.mockResolvedValue([]);

      await scanFiles(sourcePath);

      const callArgs = mockedGlobby.mock.calls[0][1] as unknown;
      expect(callArgs.gitignore).toBe(true);
    });
  });

  // === Boundary: all asset directories excluded ===
  it("should exclude all 9 asset directories", async () => {
    mockedGlobby.mockResolvedValue([]);
    await scanFiles(sourcePath);
    const ignore = (mockedGlobby.mock.calls[0][1] as unknown).ignore as string[];
    const assetDirs = [
      "assets",
      "images",
      "img",
      "static",
      "public",
      "fonts",
      "icons",
      "media",
      "resources",
    ];
    for (const dir of assetDirs) {
      expect(ignore).toContain(`**/${dir}/**`);
    }
  });
  it("should cover all 6 source extensions", async () => {
    mockedGlobby.mockResolvedValue([
      "a.ts",
      "b.tsx",
      "c.js",
      "d.jsx",
      "e.vue",
      "f.svelte",
    ]);
    const result = await scanFiles(sourcePath);
    expect(result.byExtension).toEqual({
      ".ts": 1,
      ".tsx": 1,
      ".js": 1,
      ".jsx": 1,
      ".vue": 1,
      ".svelte": 1,
    });
  });
});
