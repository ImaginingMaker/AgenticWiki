import fse from "fs-extra";
import path from "node:path";
import { globby } from "globby";
import type { ProjectScanResult, TechStack } from "../types/index.js";

/**
 * 识别框架类型
 */
function detectFramework(dependencies: Record<string, string>): string {
  if (dependencies["react"] || dependencies["next"]) {
    if (dependencies["next"]) return "next";
    return "react";
  }
  if (dependencies["vue"] || dependencies["nuxt"]) {
    if (dependencies["nuxt"]) return "nuxt";
    return "vue";
  }
  if (dependencies["@angular/core"]) return "angular";
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
  // 检查依赖
  if (dependencies["typescript"] || devDependencies["typescript"]) {
    return true;
  }
  // 检查 tsconfig.json
  if (await fse.pathExists(path.join(projectPath, "tsconfig.json"))) {
    return true;
  }
  // 检查是否有 .ts 文件
  const tsFiles = await globby("**/*.ts", {
    cwd: projectPath,
    ignore: ["node_modules", "dist", "build"],
    onlyFiles: true,
    deep: 2,
  });
  // 过滤确保只保留 .ts 和 .tsx 文件
  const validTsFiles = tsFiles.filter(
    (f) => f.endsWith(".ts") || f.endsWith(".tsx"),
  );
  return validTsFiles.length > 0;
}

/**
 * 统计源码文件数量
 */
async function countSourceFiles(projectPath: string): Promise<number> {
  const sourceExtensions = ["ts", "tsx", "js", "jsx", "vue", "svelte"];
  const patterns = sourceExtensions.map((ext) => `**/*.${ext}`);

  const files = await globby(patterns, {
    cwd: projectPath,
    ignore: ["node_modules", "dist", "build", ".git"],
    onlyFiles: true,
    gitignore: true,
  });

  return files.length;
}

/**
 * 扫描项目，识别技术栈
 */
export async function scanProject(
  projectPath: string,
): Promise<ProjectScanResult> {
  // 验证项目路径
  if (!(await fse.pathExists(projectPath))) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  const packageJsonPath = path.join(projectPath, "package.json");

  // 默认值
  let dependencies: Record<string, string> = {};
  let devDependencies: Record<string, string> = {};

  // 读取 package.json（如果存在）
  if (await fse.pathExists(packageJsonPath)) {
    const packageJson = await fse.readJson(packageJsonPath);
    dependencies = packageJson.dependencies || {};
    devDependencies = packageJson.devDependencies || {};
  }

  // 检测技术栈
  const hasTypeScript = await checkHasTypeScript(
    projectPath,
    dependencies,
    devDependencies,
  );
  const hasJSX = checkHasJSX(dependencies, devDependencies);

  const techStack: TechStack = {
    framework: detectFramework(dependencies),
    language: detectLanguage(hasTypeScript),
    buildTool: detectBuildTool(devDependencies),
    packageManager: await detectPackageManager(projectPath),
    hasJSX,
    hasTypeScript,
  };

  // 统计源码文件
  const totalFiles = await countSourceFiles(projectPath);

  // 统计文件夹数量
  const allFiles = await globby("**/*", {
    cwd: projectPath,
    ignore: ["node_modules", "dist", "build", ".git"],
    onlyFiles: true,
    gitignore: true,
  });

  const folderSet = new Set<string>();
  allFiles.forEach((file) => {
    const dir = path.dirname(file);
    if (dir !== ".") {
      folderSet.add(dir);
      // 添加所有父目录
      const parts = dir.split("/");
      for (let i = 1; i < parts.length; i++) {
        folderSet.add(parts.slice(0, i).join("/"));
      }
    }
  });

  return {
    projectPath,
    scannedAt: new Date().toISOString(),
    techStack,
    sourcePath: path.join(projectPath, "src"),
    totalFiles,
    totalFolders: folderSet.size,
  };
}
