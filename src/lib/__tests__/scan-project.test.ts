// @ts-nocheck — mock types for vi.mocked(fse.pathExists) have return type issues
import { describe, it, expect, vi, beforeEach } from "vitest";
import fse from "fs-extra";
import path from "node:path";
import { globby } from "globby";
import { scanProject } from "../scan/scan-project.js";

// Mock 外部依赖
vi.mock("fs-extra");
vi.mock("globby");

const mockedFs = vi.mocked(fse);
const mockedGlobby = vi.mocked(globby);

describe("scanProject", () => {
  const projectPath = "/fake/project";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("正常路径", () => {
    it("应正确识别 React 项目", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        if (p === path.join(projectPath, "tsconfig.json")) return true;
        if (p === path.join(projectPath, "package-lock.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: { react: "^18.0.0" },
        devDependencies: { vite: "^5.0.0", typescript: "^5.0.0" },
      });

      mockedGlobby.mockResolvedValue(["src/App.tsx", "src/index.tsx"]);

      const result = await scanProject(projectPath);

      expect(result.projectPath).toBe(projectPath);
      expect(result.techStack.framework).toBe("react");
      expect(result.techStack.language).toBe("typescript");
      expect(result.techStack.buildTool).toBe("vite");
      expect(result.techStack.packageManager).toBe("npm");
      expect(result.techStack.hasTypeScript).toBe(true);
      expect(result.techStack.hasJSX).toBe(true);
      expect(result.totalFiles).toBe(2);
      expect(result.sourcePath).toBe(path.join(projectPath, "src"));
      expect(result.scannedAt).toBeTruthy();
    });

    it("应正确识别 Next.js 项目（优先于 React）", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        if (p === path.join(projectPath, "yarn.lock")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: { next: "^14.0.0", react: "^18.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      });

      mockedGlobby.mockResolvedValue(["app/page.tsx"]);

      const result = await scanProject(projectPath);

      expect(result.techStack.framework).toBe("next");
      expect(result.techStack.packageManager).toBe("yarn");
    });

    it("应正确识别 Vue 项目", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        if (p === path.join(projectPath, "pnpm-lock.yaml")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: { vue: "^3.0.0" },
        devDependencies: { vite: "^5.0.0" },
      });

      mockedGlobby.mockResolvedValue(["src/App.vue"]);

      const result = await scanProject(projectPath);

      expect(result.techStack.framework).toBe("vue");
      expect(result.techStack.packageManager).toBe("pnpm");
      expect(result.techStack.hasJSX).toBe(true);
    });

    it("应正确识别 Nuxt 项目（优先于 Vue）", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: { nuxt: "^3.0.0", vue: "^3.0.0" },
        devDependencies: {},
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.framework).toBe("nuxt");
    });

    it("应正确识别 Angular 项目", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: { "@angular/core": "^17.0.0" },
        devDependencies: {},
      });

      mockedGlobby.mockResolvedValue(["src/app/app.component.ts"]);

      const result = await scanProject(projectPath);

      expect(result.techStack.framework).toBe("angular");
    });

    it("应正确识别 Node 项目（无前端框架）", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: { express: "^4.0.0" },
        devDependencies: {},
      });

      // checkHasTypeScript → [] (no .ts/.tsx files), allFiles → ["src/index.js"]
      mockedGlobby
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(["src/index.js"]);

      const result = await scanProject(projectPath);

      expect(result.techStack.framework).toBe("node");
      expect(result.techStack.language).toBe("javascript");
      expect(result.techStack.hasJSX).toBe(false);
    });

    it("应正确识别 webpack 构建工具", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: { webpack: "^5.0.0" },
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.buildTool).toBe("webpack");
    });

    it("应正确识别 rollup 构建工具", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: { rollup: "^4.0.0" },
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.buildTool).toBe("rollup");
    });

    it("应正确识别 esbuild 构建工具", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: { esbuild: "^0.20.0" },
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.buildTool).toBe("esbuild");
    });

    it("应正确统计文件夹数量（合并扫描优化后减少一次 globby）", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: {},
      });

      // 合并扫描: checkHasTypeScript → 1 call, allFiles → 1 call
      mockedGlobby
        .mockResolvedValueOnce([]) // checkHasTypeScript
        .mockResolvedValueOnce([
          // 合并的 allFiles 扫描（含源文件统计 + 文件夹统计）
          "src/components/Button.tsx",
          "src/components/Input.tsx",
          "src/utils/helper.ts",
          "src/pages/Home.tsx",
          "src/pages/about/About.tsx",
        ]);

      const result = await scanProject(projectPath);

      // 文件夹: src, src/components, src/utils, src/pages, src/pages/about
      expect(result.totalFolders).toBe(5);
      expect(result.totalFiles).toBe(5);
      expect(mockedGlobby).toHaveBeenCalledTimes(2); // 从 3 减少到 2
    });

    // === Phase 1 新增测试 ===

    it("S1-1: 传入 --source 参数时 sourcePath 应正确", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: {},
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath, "packages/muya/src");

      expect(result.sourcePath).toBe(
        path.resolve(projectPath, "packages/muya/src"),
      );
    });

    it("S1-1: 不传 --source 时 sourcePath 默认为 projectPath/src", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: {},
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.sourcePath).toBe(path.join(projectPath, "src"));
    });

    it("S1-3: 应识别 devDependencies 中的框架（如组件库项目）", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      // 组件库项目可能把 next/vue 放在 devDependencies
      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: { next: "^14.0.0", react: "^18.0.0" },
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.framework).toBe("next");
    });

    it("S1-5: 应识别 Svelte 项目", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: { svelte: "^4.0.0" },
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.framework).toBe("svelte");
    });

    it("S1-5: 应识别 SvelteKit 项目（优先于 Svelte）", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: { "@sveltejs/kit": "^2.0.0", svelte: "^4.0.0" },
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.framework).toBe("sveltekit");
    });

    it("S1-5: 应识别 Remix 项目", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: { "@remix-run/react": "^2.0.0" },
        devDependencies: {},
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.framework).toBe("remix");
    });

    it("S1-5: 应识别 Astro 项目", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: { astro: "^4.0.0" },
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.framework).toBe("astro");
    });

    it("S1-5: 应识别 Solid 项目", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: { "solid-js": "^1.0.0" },
        devDependencies: {},
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.framework).toBe("solid");
    });

    it("S1-2: checkHasTypeScript 应匹配 .tsx 文件", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        if (p === path.join(projectPath, "tsconfig.json")) return false;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: {},
      });

      // 只有 .tsx 文件，无 .ts 文件
      mockedGlobby
        .mockResolvedValueOnce(["src/App.tsx"]) // checkHasTypeScript (.ts + .tsx)
        .mockResolvedValueOnce(["src/App.tsx"]); // allFiles

      const result = await scanProject(projectPath);

      expect(result.techStack.hasTypeScript).toBe(true);
      expect(result.techStack.language).toBe("typescript");
    });
  });

  describe("边界情况", () => {
    it("项目路径不存在时应抛出错误", async () => {
      mockedFs.pathExists.mockResolvedValue(false);

      await expect(scanProject("/nonexistent/path")).rejects.toThrow(
        "Project path does not exist: /nonexistent/path",
      );
    });

    it("无 package.json 时应使用默认值", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return false;
        return false;
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.framework).toBe("node");
      expect(result.techStack.buildTool).toBe("unknown");
      expect(result.techStack.packageManager).toBe("npm");
      expect(result.techStack.language).toBe("javascript");
      expect(result.techStack.hasTypeScript).toBe(false);
      expect(result.techStack.hasJSX).toBe(false);
    });

    it("package.json 无 dependencies 和 devDependencies 时应使用默认值", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({ name: "empty-project" });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.framework).toBe("node");
      expect(result.techStack.buildTool).toBe("unknown");
    });

    it("无源码文件时 totalFiles 应为 0", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: {},
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.totalFiles).toBe(0);
      expect(result.totalFolders).toBe(0);
    });

    it("有 tsconfig.json 但无 typescript 依赖时应识别为 TypeScript", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        if (p === path.join(projectPath, "tsconfig.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: {},
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.language).toBe("typescript");
      expect(result.techStack.hasTypeScript).toBe(true);
    });

    it("有 .ts 文件但无 typescript 依赖时应识别为 TypeScript", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        if (p === path.join(projectPath, "tsconfig.json")) return false;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: {},
      });

      // checkHasTypeScript → allFiles (合并扫描)
      mockedGlobby
        .mockResolvedValueOnce(["src/index.ts"]) // checkHasTypeScript
        .mockResolvedValueOnce(["src/index.ts"]); // 合并 allFiles 扫描

      const result = await scanProject(projectPath);

      expect(result.techStack.language).toBe("typescript");
      expect(result.techStack.hasTypeScript).toBe(true);
    });

    it("无 lock 文件时包管理器应默认为 npm", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        // 无任何 lock 文件
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: {},
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);

      expect(result.techStack.packageManager).toBe("npm");
    });
  });

  describe("错误处理", () => {
    it("读取 package.json 失败时应抛出错误", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockRejectedValue(new Error("Invalid JSON"));

      await expect(scanProject(projectPath)).rejects.toThrow("Invalid JSON");
    });

    it("globby 扫描失败时应抛出错误", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: {},
      });

      mockedGlobby.mockRejectedValue(new Error("Globby error"));

      await expect(scanProject(projectPath)).rejects.toThrow("Globby error");
    });
  });

  describe("框架优先级", () => {
    it("next 应优先于 react", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: { next: "^14.0.0", react: "^18.0.0" },
        devDependencies: {},
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);
      expect(result.techStack.framework).toBe("next");
    });

    it("nuxt 应优先于 vue", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: { nuxt: "^3.0.0", vue: "^3.0.0" },
        devDependencies: {},
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);
      expect(result.techStack.framework).toBe("nuxt");
    });

    it("sveltekit 应优先于 svelte", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: { "@sveltejs/kit": "^2.0.0", svelte: "^4.0.0" },
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);
      expect(result.techStack.framework).toBe("sveltekit");
    });
  });

  describe("构建工具优先级", () => {
    it("vite 应优先于 webpack（当两者同时存在时）", async () => {
      mockedFs.pathExists.mockImplementation(async (p: string) => {
        if (p === projectPath) return true;
        if (p === path.join(projectPath, "package.json")) return true;
        return false;
      });

      mockedFs.readJson.mockResolvedValue({
        dependencies: {},
        devDependencies: { vite: "^5.0.0", webpack: "^5.0.0" },
      });

      mockedGlobby.mockResolvedValue([]);

      const result = await scanProject(projectPath);
      expect(result.techStack.buildTool).toBe("vite");
    });
  });
});
