import path from "node:path";
import fse from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type {
  FileListResult,
  FilteredFilesResult,
  FilteredFile,
} from "../types/index.js";

// Track filtered file paths for fast lookup
const FILTERED_PATH_SET = new Set<string>();

const STYLE_EXTENSIONS = [".css", ".scss", ".less", ".sass", ".styl"];

const STYLED_FILENAME_PATTERNS = [".styled.", ".styles."];

function isStyleExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return STYLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isStyledComponentsFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return STYLED_FILENAME_PATTERNS.some((pattern) => lower.includes(pattern));
}

export async function filterStyles(
  fileList: FileListResult,
): Promise<FilteredFilesResult> {
  const filteredFiles: FilteredFile[] = [];

  for (const filePath of fileList.files) {
    if (isStyleExtension(filePath)) {
      filteredFiles.push({
        path: filePath,
        reason: `Style extension: ${path.extname(filePath)}`,
        filterType: "pure_style",
      });
      FILTERED_PATH_SET.add(filePath);
    } else if (isStyledComponentsFile(filePath)) {
      filteredFiles.push({
        path: filePath,
        reason: "Styled-components definition file",
        filterType: "styled_components",
      });
      FILTERED_PATH_SET.add(filePath);
    }
  }

  // Compute the remaining (non-filtered) file list for downstream compatibility
  const remainingFiles = fileList.files.filter(
    (f) => !FILTERED_PATH_SET.has(f),
  );

  return {
    filteredAt: new Date().toISOString(),
    totalFiles: fileList.totalFiles,
    files: remainingFiles,
    filteredFiles,
    filteredCount: filteredFiles.length,
    remainingCount: fileList.totalFiles - filteredFiles.length,
  };
}

// === CLI Entry Point ===
async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("input", {
      type: "string",
      demandOption: true,
      description: "Path to file-list.json",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      description: "Output JSON file path",
    })
    .parseSync();

  const fileList: FileListResult = await fse.readJson(argv.input);
  const result = await filterStyles(fileList);
  await fse.outputJson(argv.output, result, { spaces: 2 });

  process.stdout.write(
    `Style filter complete: ${result.filteredCount} files filtered, ` +
      `${result.remainingCount} files remaining\n` +
      `Written to ${argv.output}\n`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("filter-styles.ts") ||
  process.argv[1]?.endsWith("filter-styles.js");
if (isMainModule) main();
