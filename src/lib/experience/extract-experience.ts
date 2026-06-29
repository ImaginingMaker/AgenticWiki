/**
 * extract-experience.ts — 通用开发经验辅助库。
 *
 * 提供 computeAffectedExperience() 用于增量模式检测受影响的经验文档。
 *
 * 注意：经验提取不再由此脚本生成独立 SubAgent prompt。
 * 经验提取已移至 GEN 阶段，由每个 SubAgent 并行完成（步骤 4.5），
 * 合并由 assemble-experience.ts 的 mergeClusterExperiences() 完成。
 *
 * Usage:
 *   import { computeAffectedExperience } from "./lib/experience/extract-experience.js";
 */

import path from "node:path";
import fs from "fs-extra";
import type {
  AffectedExperience,
  ExperienceCategory,
} from "../../types/index.js";

// === Incremental Support ===

/**
 * Compute which experience patterns are affected by code changes.
 *
 * For each pattern in volume-3-experience/, checks:
 *   1. Does any source_cluster overlap with affectedClusterIds?
 *   2. After removing affected clusters, are there >= 2 remaining?
 *
 * Returns actions:
 *   - "stale": pattern needs re-validation (source code changed, but pattern still has >= 2 sources)
 *   - "orphaned": pattern no longer qualifies as "common" (< 2 remaining source clusters)
 *   - "unchanged": no source cluster affected
 */
export function computeAffectedExperience(
  experienceDir: string,
  affectedClusterIds: Set<string>,
  allClusterIds: Set<string>,
): {
  affected: AffectedExperience[];
  summary: {
    stale: number;
    orphaned: number;
    unchanged: number;
    total: number;
  };
} {
  const affected: AffectedExperience[] = [];
  const summary = { stale: 0, orphaned: 0, unchanged: 0, total: 0 };

  if (!fs.existsSync(experienceDir)) return { affected, summary };

  // Walk all experience .md files (recursive)
  const walkDir = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkDir(fullPath));
      } else if (
        entry.name.endsWith(".md") &&
        entry.name !== ".gen-done" &&
        entry.name !== "index.md"
      ) {
        files.push(fullPath);
      }
    }
    return files;
  };

  const files = walkDir(experienceDir);
  summary.total = files.length;

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf-8");

    // Extract YAML frontmatter
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    const fm = fmMatch[1];
    const idMatch = fm.match(/^id:\s*(.+)$/m);
    const catMatch = fm.match(/^category:\s*(.+)$/m);

    // Parse source_clusters (supports both inline and multiline formats)
    let sourceClusters: string[] = [];
    const clusterInline = fm.match(/^source_clusters:\s*\[([^\]]*)\]/m);
    const clusterMulti = fm.match(/^source_clusters:\s*\n((?:\s*-\s*.+\n?)*)/m);

    if (clusterInline) {
      sourceClusters = clusterInline[1]
        .split(",")
        .map((s) => s.trim().replace(/["']/g, ""))
        .filter(Boolean);
    } else if (clusterMulti) {
      sourceClusters = clusterMulti[1]
        .split("\n")
        .map((l) =>
          l
            .replace(/^\s*-\s*/, "")
            .trim()
            .replace(/["']/g, ""),
        )
        .filter(Boolean);
    }

    const id = idMatch ? idMatch[1].trim() : path.basename(file, ".md");
    const category = (
      catMatch ? catMatch[1].trim() : "utility"
    ) as ExperienceCategory;

    // Check affected clusters
    const matchedClusters = sourceClusters.filter((c) =>
      affectedClusterIds.has(c),
    );
    const remainingClusters = sourceClusters.filter(
      (c) => !affectedClusterIds.has(c) && allClusterIds.has(c),
    );

    const relPath = path.relative(experienceDir, file);

    if (matchedClusters.length > 0) {
      if (remainingClusters.length < 2) {
        affected.push({
          id,
          path: relPath,
          category,
          action: "orphaned",
          reason: `Source clusters [${matchedClusters.join(", ")}] changed. Only ${remainingClusters.length} remaining (< 2, no longer a common pattern).`,
          matchedClusters,
          remainingClusters,
        });
        summary.orphaned++;
      } else {
        affected.push({
          id,
          path: relPath,
          category,
          action: "stale",
          reason: `Source clusters [${matchedClusters.join(", ")}] changed in incremental mode.`,
          matchedClusters,
          remainingClusters,
        });
        summary.stale++;
      }
    } else {
      affected.push({
        id,
        path: relPath,
        category,
        action: "unchanged",
        reason: "No affected source clusters.",
        matchedClusters: [],
        remainingClusters: sourceClusters,
      });
      summary.unchanged++;
    }
  }

  return { affected, summary };
}
