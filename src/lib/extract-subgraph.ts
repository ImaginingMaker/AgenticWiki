/**
 * Extract per-folder dependency subgraph from the full dependency graph.
 *
 * Usage:
 *   npx tsx src/lib/extract-subgraph.ts \
 *     --deps .agentic-wiki/cache/dependency-graph.json \
 *     --folder src/components/ \
 *     --output .agentic-wiki/cache/deps/src-components-deps.json
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

  // Filter modules inside the folder
  const internalModules = fullGraph.modules.filter((m) =>
    m.source.startsWith(folderPrefix) || m.source === folder,
  );

  // Collect external dependencies (imported by internal modules but outside the folder)
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
      if (
        !dependent.startsWith(folderPrefix) &&
        dependent !== folder
      ) {
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

// Folder name → filesystem-safe hash
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
    .option("deps", { type: "string", demandOption: true })
    .option("folder", { type: "string", demandOption: true })
    .option("output", { type: "string", demandOption: true })
    .parseSync();

  const fullGraph: DependencyGraphResult = await fs.readJson(argv.deps);
  const subgraph = extractSubgraph(fullGraph, argv.folder);

  const outputPath = argv.output || path.join(
    path.dirname(argv.deps),
    "deps",
    `${folderToHash(argv.folder)}-deps.json`,
  );

  await fs.outputJson(outputPath, subgraph, { spaces: 2 });

  process.stdout.write(
    `Subgraph for "${argv.folder}": ${subgraph.internalModules.length} internal, ` +
    `${subgraph.externalDeps.length} external deps, ${subgraph.externalDependents.length} external dependents\n` +
    `Written to ${outputPath}\n`,
  );
}

const isMainModule = process.argv[1]?.endsWith("extract-subgraph.ts") || process.argv[1]?.endsWith("extract-subgraph.js");
if (isMainModule) main();
