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
 *   npx tsx src/lib/dependency/cluster-tasks.ts \
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
import type { FileMetaMap } from "./extract-file-meta.js";
import { sanitizePathId } from "../shared/id-utils.js";

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
    // Max cluster: up to 120K tokens (25% of project), min 1000
    maxCluster: Math.max(
      1000,
      Math.min(120_000, Math.round(totalProjectTokens * 0.25)),
    ),
    // Min cluster: up to 15K tokens (5% of project), min 50
    minCluster: Math.max(
      50,
      Math.min(15_000, Math.round(totalProjectTokens * 0.05)),
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

/** Directories excluded from cluster naming (generic/infrastructure). */
const EXCLUDED_NAMING_DIRS = new Set([
  ".",
  "src",
  "common",
  "_common",
  "components",
  "_components",
  "_util",
  "hooks",
  "_hooks",
  "_example",
  "interface",
  "type",
  "types",
  "utils",
  "util",
  "shared",
  "locale",
  "style",
  "lib",
]);

/**
 * Find the most specific non-excluded directory segment from a file path.
 * For "components/goodsFilter/index.tsx", returns "goodsFilter" (skip "components").
 * For "_util/dom.ts", falls back to the raw last segment "_util".
 */
function findBestDirSegment(filePath: string): string {
  const dir = path.dirname(filePath);
  if (dir === "." || dir === "") return "";

  const segments = dir.split("/");
  // Scan from deepest segment upward, return first non-excluded one
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!EXCLUDED_NAMING_DIRS.has(segments[i])) {
      return segments[i];
    }
  }
  // All segments excluded → return the deepest one as-is
  return segments[segments.length - 1];
}

/**
 * Find the longest common directory prefix among an array of paths,
 * split by "/". Returns segment-based prefix (not character-based).
 */
function findCommonPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  if (paths.length === 1) return paths[0];

  const parts = paths.map((p) => p.split("/").filter((s) => s !== ""));
  let prefix = "";
  const minLen = Math.min(...parts.map((p) => p.length));
  for (let i = 0; i < minLen; i++) {
    const seg = parts[0][i];
    if (parts.every((p) => p[i] === seg)) {
      prefix = prefix ? `${prefix}/${seg}` : seg;
    } else {
      break;
    }
  }
  return prefix;
}

/**
 * Compute the scope (contextual path prefix) for a cluster's files.
 *
 * The scope captures the parent directory context that distinguishes
 * clusters with the same leaf directory name in different locations.
 *
 * Strategy:
 *   1. Compute the common directory prefix of all files in the cluster
 *   2. Strip the cluster name segment (it will be in `name` already)
 *   3. Walk remaining segments from deepest to shallowest, pick the
 *      first non-excluded, non-generic segment as the scope
 *
 * Example:
 *   files in "packages/user/balance/_al/" → commonDir = "packages/user/balance/_al"
 *   name = "al" (or "balance")
 *   scope segments = ["packages", "user", "balance"]
 *   → scope = "balance" (deepest non-excluded)
 *
 * @returns scope string (may be empty if no meaningful scope exists)
 */
function computeClusterScope(files: string[], name: string): string {
  if (files.length === 0) return "";

  const dirs = files.map((f) => path.dirname(f));
  const commonDir = findCommonPrefix(dirs);
  if (!commonDir || commonDir === ".") return "";

  const segments = commonDir.split("/").filter((s) => s !== "" && s !== ".");

  // Remove the name segment from the end if it matches
  // (the name is already captured separately)
  const nameLower = name.toLowerCase();
  const filtered = segments.filter(
    (s) => s.toLowerCase().replace(/^_/, "") !== nameLower,
  );

  // Walk from deepest to shallowest, return first non-excluded segment
  for (let i = filtered.length - 1; i >= 0; i--) {
    if (!EXCLUDED_NAMING_DIRS.has(filtered[i])) {
      return filtered[i];
    }
  }

  return "";
}

/**
 * Compute the best cluster name via directory majority voting.
 *
 * Strategy:
 *   1. Count files by their best (deepest non-excluded) directory segment
 *   2. Filter out generic directories (common, hooks, _util, etc.)
 *   3. Pick the most frequent directory as the name
 *   4. If all files are in generic dirs, fall back to componentName from meta
 *   5. Final fallback: sanitize the seed file's basename
 */
function computeClusterName(
  files: string[],
  metaMap: FileMetaMap,
  seed?: string,
): string {
  // Count files by best directory segment
  const dirCount = new Map<string, number>();
  const dirComponentName = new Map<string, string>();

  for (const f of files) {
    const best = findBestDirSegment(f);
    if (!best) continue;
    dirCount.set(best, (dirCount.get(best) || 0) + 1);

    // Track componentName in this dir (use first one found)
    const meta = metaMap[f];
    if (meta?.componentName && !dirComponentName.has(best)) {
      dirComponentName.set(best, meta.componentName);
    }
  }

  if (dirCount.size > 0) {
    // Sort by frequency descending, excluding generic dirs
    const sorted = [...dirCount.entries()]
      .filter(([d]) => !EXCLUDED_NAMING_DIRS.has(d))
      .sort((a, b) => b[1] - a[1]);

    if (sorted.length > 0) {
      const bestDir = sorted[0][0];
      const majorityCount = sorted[0][1];
      const totalCount = files.length;

      // Require at least 30% of files in the winning dir, or at least 1 file
      if (majorityCount >= Math.max(1, Math.round(totalCount * 0.3))) {
        // Prefer dir name over componentName for directory clusters
        return bestDir;
      }

      // Fallback: use componentName from the best dir if available
      const compName = dirComponentName.get(bestDir);
      if (compName) {
        return compName.toLowerCase();
      }
    }
  }

  // Fallback to componentName from seed
  if (seed) {
    const seedMeta = metaMap[seed];
    if (seedMeta?.componentName) {
      return seedMeta.componentName.toLowerCase();
    }
    return path.basename(seed, path.extname(seed)).toLowerCase();
  }

  // Final fallback: first file's dir
  const firstDir = path.dirname(files[0]);
  return firstDir && firstDir !== "." ? firstDir : "cluster";
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
 * Build a unique cluster ID from name + scope, with collision-safe suffix.
 *
 * This is the single point of truth for cluster ID generation.
 * Instead of generating IDs and post-hoc deduplicating, we build
 * scope-aware IDs upfront and use a registry to append numeric
 * suffixes only when true collisions occur (rare edge case).
 *
 * @param name    - The cluster's display name (e.g., "al", "header")
 * @param scope   - The parent-directory context (e.g., "balance", "shop")
 * @param registry - Set of already-used IDs; the new ID is added to it
 * @returns A unique cluster ID string
 *
 * Examples:
 *   name="al", scope="balance"  → "balance-al"
 *   name="al", scope="membercenter" → "membercenter-al"
 *   name="header", scope=""     → "header"
 *   name="header", scope=""     → "header-2" (collision fallback)
 */
function buildUniqueClusterId(
  name: string,
  scope: string,
  registry: Set<string>,
): string {
  const rawName = sanitizeClusterName(name);
  const rawScope = scope ? sanitizeClusterName(scope) : "";

  // Build candidate: scope-name or just name
  let candidate = rawScope ? `${rawScope}-${rawName}` : rawName;

  // Avoid scope === name duplication (e.g., scope="header", name="header" → "header" not "header-header")
  if (rawScope === rawName) {
    candidate = rawName;
  }

  // Fast path: no collision
  if (!registry.has(candidate)) {
    registry.add(candidate);
    return candidate;
  }

  // Collision: append numeric suffix
  let counter = 2;
  while (registry.has(`${candidate}-${counter}`)) {
    counter++;
  }
  const uniqueId = `${candidate}-${counter}`;
  registry.add(uniqueId);
  return uniqueId;
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
  // Global ID registry — ensures every cluster ID is unique from the start
  const idRegistry = new Set<string>();

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

    const clusterFileList = [...clusterFiles];
    const rawName = computeClusterName(clusterFileList, metaMap, seed);
    const scope = computeClusterScope(clusterFileList, rawName);
    const clusterId = buildUniqueClusterId(rawName, scope, idRegistry);
    const label = pickClusterLabel(clusterFileList, metaMap);

    clusters.push({
      id: clusterId,
      label,
      files: clusterFileList,
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

  for (const [, dirFiles] of dirGroups) {
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

    const rawName = computeClusterName(dirFiles, metaMap);
    const scope = computeClusterScope(dirFiles, rawName);
    const clusterId = buildUniqueClusterId(rawName, scope, idRegistry);
    clusters.push({
      id: clusterId,
      label: `${rawName} 工具`,
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
    const sharedId = buildUniqueClusterId(
      "shared-utilities",
      "",
      idRegistry,
    );
    clusters.push({
      id: sharedId,
      label: "共享工具函数",
      files: hubFileList,
      estimatedTokens: tokens,
      rootFiles: [],
      wikiChapter: clusterWikiChapter(sharedId),
      priority: "medium",
      source: "shared",
    });
  }

  // ----------------------------------------------------------------
  // Step 5: Normalize — merge overlapping clusters, split oversized ones
  // ----------------------------------------------------------------
  normalizeClusters(clusters, TH.maxCluster, metaMap, idRegistry);

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
  _metaMap: FileMetaMap,
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
 * The idRegistry is updated to reflect any ID changes from merges/splits.
 */
function normalizeClusters(
  clusters: TaskCluster[],
  maxClusterTokens: number,
  metaMap: FileMetaMap,
  idRegistry: Set<string>,
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
          // Remove old IDs from registry before merge
          idRegistry.delete(clusters[i].id);
          idRegistry.delete(clusters[j].id);

          // Merge j into i
          const mergedFiles = [
            ...new Set([...clusters[i].files, ...clusters[j].files]),
          ];
          const mergedName = computeClusterName(
            mergedFiles,
            metaMap,
            // Use the larger cluster's seed as fallback
            clusters[i].rootFiles?.[0] || clusters[j].rootFiles?.[0],
          );
          const mergedScope = computeClusterScope(mergedFiles, mergedName);
          const mergedId = buildUniqueClusterId(
            mergedName,
            mergedScope,
            idRegistry,
          );
          clusters[i] = {
            ...clusters[i],
            id: mergedId,
            label: `组件簇: ${mergedName}`,
            files: mergedFiles,
            estimatedTokens:
              clusters[i].estimatedTokens + clusters[j].estimatedTokens,
            wikiChapter: clusterWikiChapter(mergedId),
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
      const split = splitLargeCluster(clusters[i], metaMap, idRegistry);
      if (split.length > 1) {
        // Remove the original cluster's ID from registry
        idRegistry.delete(clusters[i].id);
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
 * Each sub-cluster gets a unique ID via the shared idRegistry.
 */
function splitLargeCluster(
  cluster: TaskCluster,
  metaMap: FileMetaMap,
  idRegistry: Set<string>,
): TaskCluster[] {
  const split: TaskCluster[] = [];

  if (cluster.rootFiles.length > 0) {
    // Root files get their own cluster
    const rootName = computeClusterName(
      cluster.rootFiles,
      metaMap,
      cluster.rootFiles[0],
    );
    const rootId = buildUniqueClusterId(
      `${cluster.id}-${rootName}`,
      "",
      idRegistry,
    );
    split.push({
      ...cluster,
      id: rootId,
      label: `${cluster.label} (入口)`,
      files: [...cluster.rootFiles],
      wikiChapter: clusterWikiChapter(rootId),
      estimatedTokens: 0,
    });
    // Recalculate tokens for root files using metaMap
    split[0].estimatedTokens = split[0].files.reduce(
      (sum, f) => sum + fileTokens(f, metaMap),
      0,
    );
  }

  // Remaining files
  const remaining = cluster.files.filter((f) => !cluster.rootFiles.includes(f));

  if (remaining.length > 0) {
    // Split remaining files into chunks by directory affinity
    const chunkSize = Math.max(5, Math.ceil(remaining.length / 3));
    for (let i = 0; i < remaining.length; i += chunkSize) {
      const chunk = remaining.slice(i, i + chunkSize);
      const chunkName = computeClusterName(chunk, metaMap);
      const partId = buildUniqueClusterId(
        `${cluster.id}-${chunkName}`,
        "",
        idRegistry,
      );
      split.push({
        id: partId,
        label: `${cluster.label} (${chunkName})`,
        files: chunk,
        estimatedTokens: chunk.reduce(
          (sum, f) => sum + fileTokens(f, metaMap),
          0,
        ),
        rootFiles: [],
        wikiChapter: clusterWikiChapter(partId),
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
