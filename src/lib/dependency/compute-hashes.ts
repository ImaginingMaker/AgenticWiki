import crypto from "node:crypto";
import path from "node:path";
import fse from "fs-extra";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { FileHashes } from "../types/index.js";

const DEFAULT_EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
];

export async function computeHashes(
  sourcePath: string,
  excludePatterns: string[] = [],
): Promise<FileHashes> {
  const allExcludes = [...DEFAULT_EXCLUDE_PATTERNS, ...excludePatterns];
  const negatedExcludes = allExcludes.map((p) => `!${p}`);

  const files = await globby(["**/*", ...negatedExcludes], {
    cwd: sourcePath,
    absolute: false,
    onlyFiles: true,
  });

  const hashes: FileHashes = {};

  await Promise.all(
    files.map(async (file) => {
      const content = await fse.readFile(`${sourcePath}/${file}`);
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      hashes[file] = hash;
    }),
  );

  return hashes;
}

// === CLI Entry Point ===
async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("path", {
      type: "string",
      demandOption: true,
      description: "Source path to compute hashes for",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      description: "Output JSON file path",
    })
    .option("exclude", {
      type: "string",
      array: true,
      default: [],
      description: "Additional glob patterns to exclude",
    })
    .parseSync();

  const hashes = await computeHashes(path.resolve(argv.path), argv.exclude);
  await fse.outputJson(argv.output, hashes, { spaces: 2 });

  const count = Object.keys(hashes).length;
  process.stdout.write(
    `Hash computation complete: ${count} files hashed\n` +
      `Written to ${argv.output}\n`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("compute-hashes.ts") ||
  process.argv[1]?.endsWith("compute-hashes.js");
if (isMainModule) main();
