import path from "node:path";
import fs from "node:fs";
import fse from "fs-extra";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { FileListResult } from "../types/index.js";

const SOURCE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "vue",
  "svelte",
  "mjs",
  "cjs",
  "mts",
];

/** Directories containing build artifacts / caches — always excluded. */
const BUILD_IGNORE = [
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
];

/** Asset directories: post-scan filtered to avoid false-positively excluding
 *  code files like `src/assets/constants.ts`. Only files without source extensions
 *  are removed from these directories. */
const ASSET_DIR_PATTERNS = [
  /(?:^|\/)assets\//,
  /(?:^|\/)images\//,
  /(?:^|\/)img\//,
  /(?:^|\/)static\//,
  /(?:^|\/)public\//,
  /(?:^|\/)fonts\//,
  /(?:^|\/)icons\//,
  /(?:^|\/)media\//,
  /(?:^|\/)resources\//,
];

function isAssetDir(filePath: string): boolean {
  return ASSET_DIR_PATTERNS.some((re) => re.test(filePath));
}

export async function scanFiles(
  sourcePath: string,
  extraExtensions?: string[],
): Promise<FileListResult> {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`源码目录不存在: ${sourcePath}`);
  }

  const extensions = extraExtensions
    ? [...SOURCE_EXTENSIONS, ...extraExtensions]
    : SOURCE_EXTENSIONS;
  const extSet = new Set(extensions.map((e) => `.${e}`));
  const patterns = extensions.map((ext) => `**/*.${ext}`);

  const files = await globby(patterns, {
    cwd: sourcePath,
    ignore: BUILD_IGNORE,
    onlyFiles: true,
    gitignore: true,
    absolute: false,
  });

  // Post-scan: remove files in asset directories that have non-source extensions.
  // Source-extension files inside asset dirs (e.g. src/assets/constants.ts) are kept.
  const filtered = files.filter((f) => {
    if (!isAssetDir(f)) return true;
    return extSet.has(path.extname(f));
  });

  const byExtension: Record<string, number> = {};
  for (const file of filtered) {
    const ext = path.extname(file);
    byExtension[ext] = (byExtension[ext] || 0) + 1;
  }

  return {
    scannedAt: new Date().toISOString(),
    sourcePath,
    totalFiles: filtered.length,
    files: filtered.sort(),
    byExtension,
  };
}

// === CLI Entry Point ===
async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("path", {
      type: "string",
      demandOption: true,
      description: "Source path to scan for files",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      description: "Output JSON file path",
    })
    .option("extensions", {
      type: "string",
      array: true,
      description: "Additional file extensions to scan",
    })
    .parseSync();

  const result = await scanFiles(path.resolve(argv.path), argv.extensions);
  await fse.outputJson(argv.output, result, { spaces: 2 });

  process.stdout.write(
    `File scan complete: ${result.totalFiles} files found\n` +
      `Extensions: ${Object.entries(result.byExtension)
        .map(([ext, count]) => `${ext}=${count}`)
        .join(", ")}\n` +
      `Written to ${argv.output}\n`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("scan-files.ts") ||
  process.argv[1]?.endsWith("scan-files.js");
if (isMainModule) main();
