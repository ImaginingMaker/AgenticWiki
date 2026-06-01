/**
 * cluster-tasks.ts — 依赖驱动聚簇划分。
 *
 * 替代 analyze-folders.ts 的「文件夹+角色」划分方式，
 * 使用依赖图 BFS 将文件按实际调用关系聚簇。
 *
 * 一个聚簇 = 组件 + 其专属 hooks + 其局部 utils + 子组件
 * 效果 = subTask 数量减少 50-60%，每个 subTask 内容更完整
 *
 * Usage:
 *   npx tsx src/lib/cluster-tasks.ts \
 *     --deps  .agentic-wiki/cache/dependency-graph.json \
 *     --meta  .agentic-wiki/cache/file-meta.json \
 *     --files .agentic-wiki/cache/file-list.json \
 *     --output .agentic-wiki/cache/task-clusters.json
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type {
  DependencyGraphResult,
  ModuleInfo,
  FileListResult,
} from "../types/index.js";
import type { FileMeta, FileMetaMap } from "./extract-file-meta.js";
import { sanitizePathId, generateWikiChapterPath } from "./id-utils.js";

// === Types ===

export interface TaskCluster {
  id: string;
  label: string;
  files: string[];
  estimatedTokens: number;
  rootFiles: string[];
  wikiChapter: string;
  priority: "high" | "medium" | "low";
  source: "component" | "shared" | "orphan";
}

export interface ClusterTaskResult {
  generatedAt: string;
  clusters: TaskCluster[];
  stats: {
    totalClusters: number;
    totalFiles: number;
    totalEstimatedTokens: number;
    avgClusterTokens: number;
    unassignedCount: number;
  };
}

// === Constants ===

/** A file is "shared" if imported by >= this many different seed clusters. */
const SHARED_IMPORT_THRESHOLD = 3;

/** Overlap ratio to merge two clusters. */
const MERGE_OVERLAP_RATIO = 0.3;

/** BFS depth limit for dependency traversal. */
const MAX_BFS_DEPTH = 2;

/**
 * Compute dynamic cluster thresholds based on total project tokens.
 * This ensures both small test projects (7 files) and large monorepos (500+ files)
 * get reasonable cluster sizes.
 */
function calcClusterThresholds(totalProjectTokens: number) {
  return {
    // Max cluster tokens: 20% of project total OR 50K, whichever is smaller, min 500
    maxCluster: Math.max(
      500,
      Math.min(50000, Math.round(totalProjectTokens * 0.2)),
    ),
    // Min cluster tokens: 5% of project total OR 10K, whichever is smaller, min 30
    minCluster: Math.max(
      30,
      Math.min(10000, Math.round(totalProjectTokens * 0.05)),
    ),
  };
}

// === Helpers ===

/** Build a Map<source, ModuleInfo> for O(1) lookups. */
function buildModuleMap(
  depGraph: DependencyGraphResult,
): Map<string, ModuleInfo> {
  const map = new Map<string, ModuleInfo>();
  for (const mod of depGraph.modules) {
    map.set(mod.source, mod);
  }
  return map;
}

/** Get all local dependency paths from a module. */
function getLocalDeps(mod: ModuleInfo | undefined): string[] {
  if (!mod) return [];
  return mod.dependencies
    .filter((d) => d.type === "local")
    .map((d) => d.resolved);
}

/** Estimate tokens for a file from meta, or default to 1000. */
function fileTokens(file: string, metaMap: FileMetaMap): number {
  return metaMap[file]?.estimatedTokens ?? 1000;
}

/** Check if path looks like a page/feature file. */
function isBusinessComponent(filePath: string): boolean {
  const dir = path.dirname(filePath).toLowerCase();
  return (
    dir.includes("/pages/") ||
    dir.includes("/features/") ||
    dir.includes("/modules/") ||
    filePath.startsWith("pages/") ||
    filePath.startsWith("features/") ||
    filePath.startsWith("modules/")
  );
}

/** Token estimation with file-type multipliers (consistent with file-priorities.ts). */
function estimateTokensForClusterFiles(files: string[]): number {
  // We derive tokens from file-meta.json at runtime instead.
  // This is a fallback for when metaMap is not available.
  return files.length * 1000;
}

/**
 * Sanitize a cluster name into an ID-safe string.
 */
function sanitizeClusterName(name: string): string {
  return (
    sanitizePathId(name)
      .replace(/_/g, "-")
      .replace(/--+/g, "-")
      .replace(/^-|-$/g, "") || "cluster"
  );
}

/**
 * Generate a Wiki chapter path for a cluster.
 */
function clusterWikiChapter(clusterId: string): string {
  return `ch-${clusterId}/index.md`;
}

/**
 * Pick the best label for a cluster from its root files' component names.
 */
function pickClusterLabel(files: string[], metaMap: FileMetaMap): string {
  // Try to find a component name among root files
  for (const f of files) {
    const meta = metaMap[f];
    if (meta?.componentName) return `${meta.componentName} 组件簇`;
  }
  // Fall back to the shortest meaningful dir segment
  const dirs = files.map((f) => path.dirname(f)).filter(Boolean);
  const common = findCommonPrefix(dirs);
  const label = common || dirs[0] || files[0];
  return `${label} 模块`;
}

function findCommonPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  let prefix = paths[0];
  for (const p of paths.slice(1)) {
    while (!p.startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, prefix.lastIndexOf("/"));
    }
  }
  return prefix;
}

// === Core Algorithm ===

export function clusterTasks(
  depGraph: DependencyGraphResult,
  metaMap: FileMetaMap,
  fileList: FileListResult,
): ClusterTaskResult {
  const moduleMap = buildModuleMap(depGraph);
  const allFiles = fileList.files;

  // Dynamic thresholds based on project scale
  const totalProjectTokens = allFiles.reduce(
    (s, f) => s + fileTokens(f, metaMap),
    0,
  );
  const TH = calcClusterThresholds(totalProjectTokens);
  const seeds: string[] = [];
  const seedSet = new Set<string>();

  for (const f of allFiles) {
    const meta = metaMap[f];
    if (!meta) continue;

    // Components are seeds
    if (meta.isReactComponent) {
      seeds.push(f);
      seedSet.add(f);
      continue;
    }

    // Re-export barrels are NOT seeds (they merge into their consumers)
    if (meta.isReexportBarrel) continue;

    // Business components (pages, features)
    if (isBusinessComponent(f)) {
      seeds.push(f);
      seedSet.add(f);
      continue;
    }
  }

  // Sort seeds by tokens descending (largest first = best anchor)
  seeds.sort((a, b) => fileTokens(b, metaMap) - fileTokens(a, metaMap));

  // ----------------------------------------------------------------
  // Step 2: Compute hub scores — files imported by many seeds
  // ----------------------------------------------------------------
  const fileToSeeds = new Map<string, Set<string>>();

  // For each seed, trace imports to see which files it reaches
  for (const seed of seeds) {
    const visited = new Set<string>([seed]);
    const queue: { file: string; depth: number }[] = [{ file: seed, depth: 0 }];

    while (queue.length > 0) {
      const { file, depth } = queue.shift()!;
      if (depth >= MAX_BFS_DEPTH) continue;

      const mod = moduleMap.get(file);
      if (!mod) continue;

      for (const dep of getLocalDeps(mod)) {
        if (visited.has(dep)) continue;
        if (metaMap[dep]?.isReexportBarrel) continue; // skip barrels
        visited.add(dep);

        // Record that this seed reaches this file
        if (!fileToSeeds.has(dep)) fileToSeeds.set(dep, new Set());
        fileToSeeds.get(dep)!.add(seed);
        seedSet.add(dep); // also mark as seed-reachable

        queue.push({ file: dep, depth: depth + 1 });
      }
    }
  }

  // Hub file = reached by >= SHARED_IMPORT_THRESHOLD different seeds
  const hubFiles = new Set<string>();
  for (const [file, seedGroup] of fileToSeeds) {
    if (seedGroup.size >= SHARED_IMPORT_THRESHOLD) {
      hubFiles.add(file);
    }
  }

  // ----------------------------------------------------------------
  // Step 3: BFS from each seed to form actual clusters
  // ----------------------------------------------------------------
  const assigned = new Set<string>();
  const clusters: TaskCluster[] = [];

  for (const seed of seeds) {
    if (assigned.has(seed)) continue;

    const clusterFiles = new Set<string>([seed]);
    const queue: { file: string; depth: number }[] = [{ file: seed, depth: 0 }];

    // BFS along imports (dependencies) — what this seed needs
    while (queue.length > 0) {
      const { file, depth } = queue.shift()!;
      if (depth >= MAX_BFS_DEPTH) continue;

      const mod = moduleMap.get(file);
      if (!mod) continue;

      for (const dep of getLocalDeps(mod)) {
        if (clusterFiles.has(dep)) continue;
        if (assigned.has(dep)) continue;
        if (hubFiles.has(dep)) continue; // shared utilities stay out
        if (metaMap[dep]?.isReexportBarrel) continue; // skip barrels
        clusterFiles.add(dep);
        queue.push({ file: dep, depth: depth + 1 });
      }
    }

    // Also include files that depend ON the seed (dependents)
    // These are the consumers that should be grouped with the component
    const seedMod = moduleMap.get(seed);
    if (seedMod) {
      for (const dependent of seedMod.dependents) {
        if (clusterFiles.has(dependent)) continue;
        if (assigned.has(dependent)) continue;
        if (hubFiles.has(dependent)) continue;
        if (metaMap[dependent]?.isReexportBarrel) continue;
        clusterFiles.add(dependent);
      }
    }

    // Compute tokens
    const tokens = [...clusterFiles].reduce(
      (sum, f) => sum + fileTokens(f, metaMap),
      0,
    );

    // Skip tiny clusters — they'll be reassigned in orphan step
    if (tokens < TH.minCluster && clusters.length > 0) {
      // Don't assign these files yet — leave them for orphan processing
      continue;
    }

    const fileList = [...clusterFiles];
    const clusterId = sanitizeClusterName(
      metaMap[seed]?.componentName || path.basename(seed, path.extname(seed)),
    );
    const label = pickClusterLabel(fileList, metaMap);

    clusters.push({
      id: clusterId,
      label,
      files: fileList,
      estimatedTokens: tokens,
      rootFiles: [seed],
      wikiChapter: clusterWikiChapter(clusterId),
      priority: "high",
      source: "component",
    });

    for (const f of clusterFiles) {
      assigned.add(f);
    }
  }

  // ----------------------------------------------------------------
  // Step 4: Handle unassigned files
  // ----------------------------------------------------------------
  const unassigned = allFiles.filter(
    (f) =>
      !assigned.has(f) &&
      !hubFiles.has(f) &&
      metaMap[f] &&
      !metaMap[f].isReexportBarrel,
  );

  // Group unassigned by directory proximity
  const dirGroups = new Map<string, string[]>();
  for (const f of unassigned) {
    const dir = path.dirname(f) || ".";
    if (!dirGroups.has(dir)) dirGroups.set(dir, []);
    dirGroups.get(dir)!.push(f);
  }

  for (const [dir, dirFiles] of dirGroups) {
    const tokens = dirFiles.reduce((sum, f) => sum + fileTokens(f, metaMap), 0);
    if (tokens < TH.minCluster) {
      // Too small — merge into nearest cluster by shared dir prefix
      const bestCluster = findBestMergeTarget(dirFiles, clusters, metaMap);
      if (bestCluster) {
        bestCluster.files.push(...dirFiles);
        bestCluster.estimatedTokens += tokens;
        // Don't overwrite source — only tag as "orphan" if truly new
        continue;
      }
    }

    const clusterId = sanitizeClusterName(dir);
    clusters.push({
      id: clusterId,
      label: `${dir} 工具`,
      files: dirFiles,
      estimatedTokens: tokens,
      rootFiles: [],
      wikiChapter: clusterWikiChapter(clusterId),
      priority: "medium",
      source: "orphan",
    });
  }

  // Handle hub files (shared utilities) — one global cluster
  const hubFileList = [...hubFiles].filter(
    (f) => metaMap[f] && !metaMap[f].isReexportBarrel,
  );
  if (hubFileList.length > 0) {
    const tokens = hubFileList.reduce(
      (sum, f) => sum + fileTokens(f, metaMap),
      0,
    );
    clusters.push({
      id: "shared-utilities",
      label: "共享工具函数",
      files: hubFileList,
      estimatedTokens: tokens,
      rootFiles: [],
      wikiChapter: clusterWikiChapter("shared-utilities"),
      priority: "medium",
      source: "shared",
    });
  }

  // ----------------------------------------------------------------
  // Step 5: Normalize — merge overlapping clusters
  // ----------------------------------------------------------------
  normalizeClusters(clusters, TH.maxCluster);

  // ----------------------------------------------------------------
  // Build result
  // ----------------------------------------------------------------
  const totalTokens = clusters.reduce((s, c) => s + c.estimatedTokens, 0);
  const totalFiles = clusters.reduce((s, c) => s + c.files.length, 0);

  return {
    generatedAt: new Date().toISOString(),
    clusters,
    stats: {
      totalClusters: clusters.length,
      totalFiles,
      totalEstimatedTokens: totalTokens,
      avgClusterTokens:
        clusters.length > 0 ? Math.round(totalTokens / clusters.length) : 0,
      unassignedCount: unassigned.length,
    },
  };
}

/**
 * Find the best existing cluster to merge orphan files into,
 * based on shared directory prefix overlap.
 */
function findBestMergeTarget(
  orphanFiles: string[],
  clusters: TaskCluster[],
  metaMap: FileMetaMap,
): TaskCluster | null {
  if (clusters.length === 0) return null;

  const orphanDirs = new Set(orphanFiles.map((f) => path.dirname(f)));
  let best: TaskCluster | null = null;
  let bestOverlap = 0;

  for (const cluster of clusters) {
    const clusterDirs = new Set(cluster.files.map((f) => path.dirname(f)));
    let overlap = 0;
    for (const od of orphanDirs) {
      for (const cd of clusterDirs) {
        if (od === cd || od.startsWith(cd + "/") || cd.startsWith(od + "/")) {
          overlap++;
        }
      }
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = cluster;
    }
  }

  return best;
}

/**
 * Normalize clusters: merge overlapping small ones, split large ones.
 */
function normalizeClusters(
  clusters: TaskCluster[],
  maxClusterTokens: number,
): void {
  // Step A: Merge clusters with significant overlap
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = new Set(clusters[i].files);
        const b = new Set(clusters[j].files);
        const intersection = [...a].filter((f) => b.has(f));
        const overlapRatio = intersection.length / Math.min(a.size, b.size);

        if (overlapRatio >= MERGE_OVERLAP_RATIO) {
          // Merge j into i
          const mergedFiles = [
            ...new Set([...clusters[i].files, ...clusters[j].files]),
          ];
          clusters[i] = {
            ...clusters[i],
            id: `${clusters[i].id}-merged`,
            label: `${clusters[i].label} / ${clusters[j].label}`,
            files: mergedFiles,
            estimatedTokens:
              clusters[i].estimatedTokens + clusters[j].estimatedTokens,
            source: "component",
          };
          clusters.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  // Step B: Split clusters that are too large
  const toAdd: TaskCluster[] = [];
  const toRemove: number[] = [];

  for (let i = 0; i < clusters.length; i++) {
    if (clusters[i].estimatedTokens > maxClusterTokens) {
      const split = splitLargeCluster(clusters[i]);
      if (split.length > 1) {
        toRemove.push(i);
        toAdd.push(...split);
      }
    }
  }

  for (const idx of toRemove.sort((a, b) => b - a)) {
    clusters.splice(idx, 1);
  }
  clusters.push(...toAdd);

  // Sort clusters: high priority first, then by tokens descending
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  clusters.sort((a, b) => {
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return b.estimatedTokens - a.estimatedTokens;
  });
}

/**
 * Split a cluster that exceeds the max token threshold into smaller chunks.
 * Uses a simple greedy approach: group root files separately, then rest.
 */
function splitLargeCluster(cluster: TaskCluster): TaskCluster[] {
  const split: TaskCluster[] = [];

  if (cluster.rootFiles.length > 0) {
    // Root files get their own cluster
    split.push({
      ...cluster,
      id: `${cluster.id}-root`,
      label: `${cluster.label} (入口)`,
      files: [...cluster.rootFiles],
      estimatedTokens: 0,
    });
    // Recalculate tokens for root files
    split[0].estimatedTokens = split[0].files.length * 1000;
  }

  // Remaining files
  const remaining = cluster.files.filter((f) => !cluster.rootFiles.includes(f));

  if (remaining.length > 0) {
    // Simple split: just chunk by file count
    const chunkSize = Math.max(5, Math.ceil(remaining.length / 3));
    for (let i = 0; i < remaining.length; i += chunkSize) {
      const chunk = remaining.slice(i, i + chunkSize);
      split.push({
        id: `${cluster.id}-part-${split.length + 1}`,
        label: `${cluster.label} (${split.length + 1})`,
        files: chunk,
        estimatedTokens: chunk.length * 1000,
        rootFiles: [],
        wikiChapter: clusterWikiChapter(`${cluster.id}-part-${split.length}`),
        priority: cluster.priority,
        source: cluster.source,
      });
    }
  }

  return split.length > 0 ? split : [cluster];
}

// === CLI Entry Point ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("deps", {
      type: "string",
      demandOption: true,
      description: "Path to dependency-graph.json",
    })
    .option("meta", {
      type: "string",
      demandOption: true,
      description: "Path to file-meta.json",
    })
    .option("files", {
      type: "string",
      demandOption: true,
      description: "Path to file-list.json",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      description: "Output path for task-clusters.json",
    })
    .parseSync();

  const depGraph: DependencyGraphResult = await fs.readJson(argv.deps);
  const metaMap: FileMetaMap = await fs.readJson(argv.meta);
  const fileList: FileListResult = await fs.readJson(argv.files);

  const result = clusterTasks(depGraph, metaMap, fileList);

  await fs.outputJson(argv.output, result, { spaces: 2 });

  process.stdout.write(
    `Task clusters: ${result.stats.totalClusters} clusters, ` +
      `${result.stats.totalFiles} files, ` +
      `~${result.stats.totalEstimatedTokens.toLocaleString()} tokens ` +
      `(avg ${result.stats.avgClusterTokens.toLocaleString()}/cluster)\n` +
      `  Unassigned: ${result.stats.unassignedCount}\n` +
      `  Written to ${argv.output}\n`,
  );

  // Detailed cluster breakdown
  process.stdout.write("\nCluster breakdown:\n");
  for (const c of result.clusters) {
    process.stdout.write(
      `  [${c.source === "component" ? "🟢" : "🔵"}] ${c.id}: ` +
        `${c.files.length} files, ~${c.estimatedTokens.toLocaleString()} tokens` +
        ` [${c.label}]\n`,
    );
  }
}

const isMainModule =
  process.argv[1]?.endsWith("cluster-tasks.ts") ||
  process.argv[1]?.endsWith("cluster-tasks.js");
if (isMainModule) main();
