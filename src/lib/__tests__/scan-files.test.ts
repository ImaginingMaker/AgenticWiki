import { describe, it, expect, vi, beforeEach } from "vitest";
import { globby } from "globby";
import { scanFiles } from "../scan/scan-files.js";

// Mock 外部依赖
vi.mock("globby");

const { mockExistsSync } = vi.hoisted(() => {
  const fn = vi.fn(() => true);
  return { mockExistsSync: fn };
});

vi.mock("node:fs", () => ({
  default: { existsSync: mockExistsSync },
  existsSync: mockExistsSync,
}));

const mockedGlobby = vi.mocked(globby);
import fs from "node:fs";
const mockedExistsSync = vi.mocked(fs.existsSync);

describe("scanFiles", () => {
  const sourcePath = "/fake/project/src";

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: sourcePath exists
    mockedExistsSync.mockReturnValue(true);
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

    it("应正确按扩展名统计（动态计数，含新增扩展名）", async () => {
      mockedGlobby.mockResolvedValue([
        "App.tsx",
        "index.ts",
        "utils/helper.ts",
        "components/Button.tsx",
        "main.jsx",
        "style.js",
        "Page.vue",
        "Widget.svelte",
        "config.mjs",
        "server.cjs",
        "types.mts",
      ]);

      const result = await scanFiles(sourcePath);

      expect(result.byExtension).toEqual({
        ".ts": 2,
        ".tsx": 2,
        ".js": 1,
        ".jsx": 1,
        ".vue": 1,
        ".svelte": 1,
        ".mjs": 1,
        ".cjs": 1,
        ".mts": 1,
      });
    });

    it("应只扫描源码文件扩展名，未知扩展名不出现", async () => {
      // globby 使用 SOURCE_EXTENSIONS patterns，不应返回 .md/.json 等非源码文件
      mockedGlobby.mockResolvedValue(["App.tsx", "index.ts"]);

      const result = await scanFiles(sourcePath);

      expect(result.byExtension[".ts"]).toBe(1);
      expect(result.byExtension[".tsx"]).toBe(1);
      expect(result.byExtension[".md"]).toBeUndefined();
    });

    it("应传递正确的 globby 参数（含 .mjs/.cjs/.mts）", async () => {
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
          "**/*.mjs",
          "**/*.cjs",
          "**/*.mts",
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
      expect(result.byExtension).toEqual({});
    });

    it("只有一种扩展名的文件", async () => {
      mockedGlobby.mockResolvedValue(["a.ts", "b.ts", "c.ts"]);

      const result = await scanFiles(sourcePath);

      expect(result.totalFiles).toBe(3);
      expect(result.byExtension[".ts"]).toBe(3);
      expect(result.byExtension[".tsx"]).toBeUndefined();
    });

    it("深层嵌套文件应被正确扫描", async () => {
      mockedGlobby.mockResolvedValue(["a/b/c/d/deep.ts"]);

      const result = await scanFiles(sourcePath);

      expect(result.totalFiles).toBe(1);
      expect(result.files).toEqual(["a/b/c/d/deep.ts"]);
    });

    // === Phase 1 S2-2: sourcePath 不存在时抛错 ===
    it("S2-2: sourcePath 不存在时应抛出中文错误", async () => {
      mockedExistsSync.mockReturnValue(false);

      await expect(scanFiles("/nonexistent/src")).rejects.toThrow(
        "源码目录不存在: /nonexistent/src",
      );
    });

    // === Phase 1 S2-3: 支持 extraExtensions ===
    it("S2-3: 支持通过 extraExtensions 添加额外扩展名", async () => {
      mockedGlobby.mockResolvedValue(["worker.cts", "utils.mts"]);

      const result = await scanFiles(sourcePath, ["cts"]);

      // globby 应包含额外扩展名的 pattern
      const patterns = mockedGlobby.mock.calls[0][0] as string[];
      expect(patterns).toContain("**/*.cts");
    });

    // === Phase 1 S2-1: asset 目录中的源码文件不被误杀 ===
    it("S2-1: src/assets/constants.ts 等源码文件应被保留（后置过滤 vs globby ignore）", async () => {
      // 模拟 globby 返回源码扩展名文件（这些不会被 BUILD_IGNORE 忽略）
      mockedGlobby.mockResolvedValue([
        "assets/constants.ts",
        "assets/icons/IconPaths.tsx",
        "images/logo.svg", // 非源码扩展名，globby 不会返回
      ]);

      const result = await scanFiles(sourcePath);

      // 源码文件在 assets 目录中应被保留
      expect(result.files).toContain("assets/constants.ts");
      expect(result.files).toContain("assets/icons/IconPaths.tsx");
    });
  });

  describe("错误处理", () => {
    it("globby 扫描失败时应抛出错误", async () => {
      mockedGlobby.mockRejectedValue(new Error("Permission denied"));

      await expect(scanFiles(sourcePath)).rejects.toThrow("Permission denied");
    });
  });

  describe("忽略规则", () => {
    it("应忽略 node_modules 目录", async () => {
      mockedGlobby.mockResolvedValue(["src/App.tsx"]);

      await scanFiles(sourcePath);

      const callArgs = mockedGlobby.mock.calls[0][1] as Record<string, unknown>;
      expect(callArgs.ignore).toContain("node_modules");
    });

    it("应忽略 dist 目录", async () => {
      mockedGlobby.mockResolvedValue([]);

      await scanFiles(sourcePath);

      const callArgs = mockedGlobby.mock.calls[0][1] as Record<string, unknown>;
      expect(callArgs.ignore).toContain("dist");
    });

    it("应忽略 build 目录", async () => {
      mockedGlobby.mockResolvedValue([]);

      await scanFiles(sourcePath);

      const callArgs = mockedGlobby.mock.calls[0][1] as Record<string, unknown>;
      expect(callArgs.ignore).toContain("build");
    });

    it("应忽略 .git 目录", async () => {
      mockedGlobby.mockResolvedValue([]);

      await scanFiles(sourcePath);

      const callArgs = mockedGlobby.mock.calls[0][1] as Record<string, unknown>;
      expect(callArgs.ignore).toContain(".git");
    });

    it("应支持 gitignore", async () => {
      mockedGlobby.mockResolvedValue([]);

      await scanFiles(sourcePath);

      const callArgs = mockedGlobby.mock.calls[0][1] as Record<string, unknown>;
      expect(callArgs.gitignore).toBe(true);
    });
  });

  // === Boundary: structural ignores only (asset dirs now post-filtered) ===
  it("应不将 ASSET 目录放入 globby ignore（改为后置过滤）", async () => {
    mockedGlobby.mockResolvedValue([]);
    await scanFiles(sourcePath);
    const ignore = (mockedGlobby.mock.calls[0][1] as Record<string, unknown>)
      .ignore as string[];
    // ASSET 目录不应在 ignore 列表中
    expect(ignore).not.toContain("**/assets/**");
    expect(ignore).not.toContain("**/images/**");
    // 结构目录仍在
    expect(ignore).toContain("node_modules");
    expect(ignore).toContain("build");
  });

  it("应覆盖所有 9 个源码扩展名", async () => {
    mockedGlobby.mockResolvedValue([
      "a.ts",
      "b.tsx",
      "c.js",
      "d.jsx",
      "e.vue",
      "f.svelte",
      "g.mjs",
      "h.cjs",
      "i.mts",
    ]);
    const result = await scanFiles(sourcePath);
    expect(result.totalFiles).toBe(9);
    expect(result.byExtension).toEqual({
      ".ts": 1,
      ".tsx": 1,
      ".js": 1,
      ".jsx": 1,
      ".vue": 1,
      ".svelte": 1,
      ".mjs": 1,
      ".cjs": 1,
      ".mts": 1,
    });
  });
});
