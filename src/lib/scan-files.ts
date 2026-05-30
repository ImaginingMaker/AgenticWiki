import path from "node:path";
import fse from "fs-extra";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { FileListResult } from "../types/index.js";

const SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "vue", "svelte"];

/** Directories containing non-code assets (images, fonts, static files) */
const ASSET_DIRS = [
  "**/assets/**",
  "**/images/**",
  "**/img/**",
  "**/static/**",
  "**/public/**",
  "**/fonts/**",
  "**/icons/**",
  "**/media/**",
  "**/resources/**",
];

const DEFAULT_IGNORE = [
  ...ASSET_DIRS,
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
];

export async function scanFiles(sourcePath: string): Promise<FileListResult> {
  const patterns = SOURCE_EXTENSIONS.map((ext) => `**/*.${ext}`);

  const files = await globby(patterns, {
    cwd: sourcePath,
    ignore: DEFAULT_IGNORE,
    onlyFiles: true,
    gitignore: true,
    absolute: false,
  });

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
    .parseSync();

  const result = await scanFiles(path.resolve(argv.path));
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
