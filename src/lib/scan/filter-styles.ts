import path from "node:path";
import fse from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type {
  FileListResult,
  FilteredFilesResult,
  FilteredFile,
} from "../types/index.js";

const STYLE_EXTENSIONS = [".css", ".scss", ".less", ".sass", ".styl"];

const STYLED_FILENAME_PATTERNS = [".styled.", ".styles."];

// Files matching these should NOT be treated as styled-components.
// e.g. Button.styled.spec.ts is a test file, not a style definition.
const STYLED_FALSE_POSITIVE_PATTERNS = [/\.spec\./, /\.test\./];

function isStyleExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return STYLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isStyledComponentsFile(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();

  const matchesPattern = STYLED_FILENAME_PATTERNS.some((pattern) =>
    basename.includes(pattern),
  );
  if (!matchesPattern) return false;

  // Exclude test/spec files that happen to have .styled. or .styles. in name
  if (STYLED_FALSE_POSITIVE_PATTERNS.some((p) => p.test(basename))) {
    return false;
  }

  return true;
}

export async function filterStyles(
  fileList: FileListResult,
): Promise<FilteredFilesResult> {
  // Local set — no global state pollution across calls
  const filteredSet = new Set<string>();
  const filteredFiles: FilteredFile[] = [];

  for (const filePath of fileList.files) {
    if (isStyleExtension(filePath)) {
      filteredFiles.push({
        path: filePath,
        reason: `Style extension: ${path.extname(filePath)}`,
        filterType: "pure_style",
      });
      filteredSet.add(filePath);
    } else if (isStyledComponentsFile(filePath)) {
      filteredFiles.push({
        path: filePath,
        reason: "Styled-components definition file",
        filterType: "styled_components",
      });
      filteredSet.add(filePath);
    }
  }

  const remainingFiles = fileList.files.filter((f) => !filteredSet.has(f));

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
