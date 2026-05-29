import path from "node:path";
import { globby } from "globby";
import type { FileListResult } from "../types/index.js";

/**
 * 源码文件扩展名
 */
const SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "vue", "svelte"];

/**
 * 默认忽略的目录
 */
const DEFAULT_IGNORE = [
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
];

/**
 * 扫描源码文件列表
 */
export async function scanFiles(sourcePath: string): Promise<FileListResult> {
  // 构建匹配模式
  const patterns = SOURCE_EXTENSIONS.map((ext) => `**/*.${ext}`);

  // 扫描文件
  const files = await globby(patterns, {
    cwd: sourcePath,
    ignore: DEFAULT_IGNORE,
    onlyFiles: true,
    gitignore: true,
    absolute: false,
  });

  // 按扩展名统计
  const byExtension: Record<string, number> = {};

  for (const ext of SOURCE_EXTENSIONS) {
    byExtension[`.${ext}`] = 0;
  }

  for (const file of files) {
    const ext = path.extname(file);
    if (byExtension[ext] !== undefined) {
      byExtension[ext]++;
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    sourcePath,
    totalFiles: files.length,
    files: files.sort(),
    byExtension,
  };
}
