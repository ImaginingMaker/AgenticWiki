import fse from "fs-extra";
import path from "node:path";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { ProjectScanResult, TechStack } from "../types/index.js";

/**
 * 识别框架类型（合并 dependencies + devDependencies）
 */
function detectFramework(allDeps: Record<string, string>): string {
  if (allDeps["next"]) return "next";
  if (allDeps["react"]) return "react";
  if (allDeps["nuxt"]) return "nuxt";
  if (allDeps["vue"]) return "vue";
  if (allDeps["@angular/core"]) return "angular";
  if (allDeps["svelte"] || allDeps["@sveltejs/kit"]) {
    if (allDeps["@sveltejs/kit"]) return "sveltekit";
    return "svelte";
  }
  if (allDeps["@remix-run/react"] || allDeps["@remix-run/node"]) return "remix";
  if (allDeps["astro"]) return "astro";
  if (allDeps["solid-js"] || allDeps["@solidjs/router"]) return "solid";
  return "node";
}

/**
 * 识别构建工具
 */
function detectBuildTool(devDependencies: Record<string, string>): string {
  if (devDependencies["vite"]) return "vite";
  if (devDependencies["webpack"]) return "webpack";
  if (devDependencies["rollup"]) return "rollup";
  if (devDependencies["esbuild"]) return "esbuild";
  return "unknown";
}

/**
 * 识别包管理器
 */
async function detectPackageManager(projectPath: string): Promise<string> {
  if (await fse.pathExists(path.join(projectPath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await fse.pathExists(path.join(projectPath, "yarn.lock"))) {
    return "yarn";
  }
  if (await fse.pathExists(path.join(projectPath, "package-lock.json"))) {
    return "npm";
  }
  return "npm";
}

/**
 * 识别语言
 */
function detectLanguage(hasTypeScript: boolean): string {
  return hasTypeScript ? "typescript" : "javascript";
}

/**
 * 检查是否有 JSX 支持
 */
function checkHasJSX(
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
): boolean {
  const allDeps = { ...dependencies, ...devDependencies };
  return Boolean(
    allDeps["react"] ||
    allDeps["vue"] ||
    allDeps["@vue/compiler-sfc"] ||
    allDeps["@babel/preset-react"],
  );
}

/**
 * 检查是否有 TypeScript
 */
async function checkHasTypeScript(
  projectPath: string,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
): Promise<boolean> {
  if (dependencies["typescript"] || devDependencies["typescript"]) {
    return true;
  }
  if (await fse.pathExists(path.join(projectPath, "tsconfig.json"))) {
    return true;
  }
  const tsFiles = await globby(["**/*.ts", "**/*.tsx"], {
    cwd: projectPath,
    ignore: ["node_modules", "dist", "build"],
    onlyFiles: true,
    deep: 2,
  });
  return tsFiles.length > 0;
}

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".vue",
  ".svelte",
]);

/**
 * 扫描项目，识别技术栈
 */
export async function scanProject(
  projectPath: string,
  sourceOverride?: string,
): Promise<ProjectScanResult> {
  if (!(await fse.pathExists(projectPath))) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  const sourcePath = sourceOverride
    ? path.resolve(projectPath, sourceOverride)
    : path.join(projectPath, "src");

  const packageJsonPath = path.join(projectPath, "package.json");

  let dependencies: Record<string, string> = {};
  let devDependencies: Record<string, string> = {};

  if (await fse.pathExists(packageJsonPath)) {
    const packageJson = await fse.readJson(packageJsonPath);
    dependencies = packageJson.dependencies || {};
    devDependencies = packageJson.devDependencies || {};
  }

  const hasTypeScript = await checkHasTypeScript(
    projectPath,
    dependencies,
    devDependencies,
  );
  const hasJSX = checkHasJSX(dependencies, devDependencies);

  const allDeps = { ...dependencies, ...devDependencies };

  const techStack: TechStack = {
    framework: detectFramework(allDeps),
    language: detectLanguage(hasTypeScript),
    buildTool: detectBuildTool(devDependencies),
    packageManager: await detectPackageManager(projectPath),
    hasJSX,
    hasTypeScript,
  };

  // 一次扫描合并 countSourceFiles + allFiles，避免重复 I/O
  const allFiles = await globby("**/*", {
    cwd: projectPath,
    ignore: ["node_modules", "dist", "build", ".git"],
    onlyFiles: true,
    gitignore: true,
  });

  const sourceFileCount = allFiles.filter((f) =>
    SOURCE_EXTENSIONS.has(path.extname(f)),
  ).length;

  const folderSet = new Set<string>();
  for (const file of allFiles) {
    const dir = path.dirname(file);
    if (dir !== ".") {
      folderSet.add(dir);
      const segments = dir.includes(path.sep)
        ? dir.split(path.sep)
        : dir.split("/");
      for (let i = 1; i < segments.length; i++) {
        folderSet.add(segments.slice(0, i).join(path.sep));
      }
    }
  }

  return {
    projectPath,
    scannedAt: new Date().toISOString(),
    techStack,
    sourcePath,
    totalFiles: sourceFileCount,
    totalFolders: folderSet.size,
  };
}

// === CLI Entry Point ===
async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("path", {
      type: "string",
      demandOption: true,
      description: "Project root path to scan",
    })
    .option("source", {
      type: "string",
      description: "Source root override (default: src/)",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      description: "Output JSON file path",
    })
    .parseSync();

  const result = await scanProject(path.resolve(argv.path), argv.source);
  await fse.outputJson(argv.output, result, { spaces: 2 });

  process.stdout.write(
    `Project scan complete: ${result.totalFiles} files, ` +
      `${result.totalFolders} folders, framework=${result.techStack.framework}\n` +
      `Written to ${argv.output}\n`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("scan-project.ts") ||
  process.argv[1]?.endsWith("scan-project.js");
if (isMainModule) main();
