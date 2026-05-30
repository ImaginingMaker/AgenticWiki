/**
 * Extract per-folder dependency subgraph from the full dependency graph.
 *
 * Supports both exact path matching and fuzzy last-segment matching:
 *   --folder "packages/components/button"  → exact prefix match
 *   --folder "button"                       → last-segment match (fallback)
 *
 * Usage:
 *   # Single folder mode
 *   npx tsx src/lib/extract-subgraph.ts \
 *     --deps .agentic-wiki/cache/dependency-graph.json \
 *     --folder src/components/ \
 *     --output .agentic-wiki/cache/deps/src-components-deps.json
 *
 *   # Batch mode (recommended for large projects)
 *   npx tsx src/lib/extract-subgraph.ts \
 *     --deps .agentic-wiki/cache/dependency-graph.json \
 *     --all \
 *     --strategy .agentic-wiki/cache/folder-strategy.json \
 *     --output-dir .agentic-wiki/cache/deps
 */

import fs from "fs-extra";
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { DependencyGraphResult, SubGraph } from "../types/index.js";

export function extractSubgraph(
  fullGraph: DependencyGraphResult,
  folder: string,
): SubGraph {
  // Normalize folder path: ensure trailing slash for prefix matching
  const folderPrefix = folder.endsWith("/") ? folder : folder + "/";

  // Attempt 1: exact prefix match
  let internalModules = fullGraph.modules.filter(
    (m) => m.source.startsWith(folderPrefix) || m.source === folder,
  );

  // Attempt 2: if no matches, try fuzzy last-segment matching
  if (internalModules.length === 0) {
    const lastSegment = path.basename(folder) + "/";
    internalModules = fullGraph.modules.filter(
      (m) =>
        m.source.startsWith(lastSegment) ||
        m.source.includes("/" + lastSegment),
    );

    if (internalModules.length > 0) {
      // Update folder prefix for external dep detection to use the actual matched prefix
      const matchedPrefixes = internalModules.map((m) => {
        const idx = m.source.lastIndexOf("/" + lastSegment);
        return idx >= 0
          ? m.source.substring(0, idx + lastSegment.length + 1)
          : lastSegment;
      });
      // Use the most common prefix
      const prefixCounts = new Map<string, number>();
      for (const p of matchedPrefixes) {
        prefixCounts.set(p, (prefixCounts.get(p) || 0) + 1);
      }
      const bestPrefix = [...prefixCounts.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0][0];
      return buildSubGraphResult(
        fullGraph,
        internalModules,
        bestPrefix,
        folder,
      );
    }
  }

  return buildSubGraphResult(fullGraph, internalModules, folderPrefix, folder);
}

function buildSubGraphResult(
  fullGraph: DependencyGraphResult,
  internalModules: DependencyGraphResult["modules"],
  folderPrefix: string,
  folder: string,
): SubGraph {
  const externalDeps = new Set<string>();
  const externalDependents = new Set<string>();

  for (const mod of internalModules) {
    for (const dep of mod.dependencies) {
      if (
        dep.type === "local" &&
        !dep.resolved.startsWith(folderPrefix) &&
        dep.resolved !== folder
      ) {
        externalDeps.add(dep.resolved);
      }
    }
    for (const dependent of mod.dependents) {
      if (!dependent.startsWith(folderPrefix) && dependent !== folder) {
        externalDependents.add(dependent);
      }
    }
  }

  return {
    folder,
    internalModules,
    externalDeps: [...externalDeps].sort(),
    externalDependents: [...externalDependents].sort(),
  };
}

// Folder name to filesystem-safe hash
function folderToHash(folder: string): string {
  return folder
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

// === CLI Entry Point ===
async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("deps", {
      type: "string",
      demandOption: true,
      description: "Path to dependency-graph.json",
    })
    .option("folder", {
      type: "string",
      description: "Single folder path to extract subgraph for",
    })
    .option("output", {
      type: "string",
      description: "Output path for single folder subgraph",
    })
    .option("all", {
      type: "boolean",
      default: false,
      description: "Extract subgraphs for all folders in folder-strategy.json",
    })
    .option("strategy", {
      type: "string",
      description: "Path to folder-strategy.json (required with --all)",
    })
    .option("output-dir", {
      type: "string",
      description:
        "Output directory for batch subgraphs (required with --all). Defaults to deps/ alongside --deps.",
    })
    .check((argv) => {
      const isBatch = !!argv.all;
      const isSingle = !!argv.folder;
      if (!isBatch && !isSingle) {
        return new Error("Either --folder or --all must be provided");
      }
      if (isBatch && isSingle) {
        return new Error(
          "Cannot use --folder together with --all. Choose one mode.",
        );
      }
      if (isBatch && !argv.strategy) {
        return new Error("--strategy is required when using --all");
      }
      return true;
    })
    .parseSync();

  const fullGraph: DependencyGraphResult = await fs.readJson(argv.deps);

  if (argv.all && argv.strategy) {
    // Batch mode: extract subgraphs for all folders in strategy
    const strategy = await fs.readJson(argv.strategy as string);
    const outputDir =
      (argv.outputDir as string) ||
      path.join(path.dirname(argv.deps as string), "deps");
    await fs.ensureDir(outputDir);

    let extracted = 0;
    let skipped = 0;
    const folders: Array<{ path: string }> = strategy.folders || [];

    for (const folder of folders) {
      const hash = folderToHash(folder.path);
      const outputPath = path.join(outputDir, `${hash}-deps.json`);

      // Skip if already extracted and non-empty
      if (await fs.pathExists(outputPath)) {
        try {
          const existing = await fs.readJson(outputPath);
          if (existing.internalModules && existing.internalModules.length > 0) {
            skipped++;
            continue;
          }
        } catch {
          // Corrupted file, re-extract
        }
      }

      const subgraph = extractSubgraph(fullGraph, folder.path);
      await fs.outputJson(outputPath, subgraph, { spaces: 2 });
      extracted++;
    }

    process.stdout.write(
      `Batch subgraph extraction complete: ${extracted} extracted, ${skipped} skipped (already exist), ` +
        `${folders.length} total folders\n` +
        `Output directory: ${outputDir}\n`,
    );
  } else {
    // Single folder mode (original behavior)
    const subgraph = extractSubgraph(fullGraph, argv.folder!);

    const outputPath =
      argv.output ||
      path.join(
        path.dirname(argv.deps as string),
        "deps",
        `${folderToHash(argv.folder!)}-deps.json`,
      );

    await fs.outputJson(outputPath, subgraph, { spaces: 2 });

    process.stdout.write(
      `Subgraph for "${argv.folder}": ${subgraph.internalModules.length} internal, ` +
        `${subgraph.externalDeps.length} external deps, ${subgraph.externalDependents.length} external dependents\n` +
        `Written to ${outputPath}\n`,
    );
  }
}

const isMainModule =
  process.argv[1]?.endsWith("extract-subgraph.ts") ||
  process.argv[1]?.endsWith("extract-subgraph.js");
if (isMainModule) main();
