/**
 * Phase definitions — maps each pipeline phase to its scripts and arguments.
 *
 * Responsibilities:
 *   - Define PhaseScript and PhaseDef types
 *   - Define the DAG execution order
 *   - Map phase name → list of scripts with CLI args (getPhaseDefinition)
 *
 * Usage:
 *   import { getPhaseDefinition, DAG_ORDER } from "./phase-definitions.js";
 */

import path from "node:path";
import fs from "fs-extra";
import type { ResolvedPaths, RunnerArgs } from "./path-resolver.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface PhaseScript {
  name: string;
  args: string[];
  critical: boolean;
  timeout?: number;
  maxBuffer?: number;
}

export interface PhaseDef {
  id: string;
  label: string;
  order: number;
  scripts: PhaseScript[];
  requiresAgent: boolean;
}

/**
 * Compute the range of phases to run given CLI arguments and current state.
 * Pure function — no I/O.
 *
 * @param startPhase - The phase to start from (typically `getCurrentPhase(state)` or `args.only`)
 * @param targetPhase - The phase to end at (`args.only`, `args.to`, or "DONE")
 * @returns Ordered array of phase names to execute
 */
export function computePhaseRange(
  startPhase: string | null,
  targetPhase: string | null,
): string[] {
  if (!startPhase && !targetPhase) return [];

  const effectiveStart = startPhase || DAG_ORDER[0];
  const effectiveTarget = targetPhase || "DONE";

  const phasesToRun: string[] = [];
  let inRange = false;
  for (const phase of DAG_ORDER) {
    if (phase === effectiveStart) inRange = true;
    if (inRange) phasesToRun.push(phase);
    if (phase === effectiveTarget) break;
  }

  // When targeting DONE, always include ASSEMBLE and VALIDATE
  if (effectiveTarget === "DONE") {
    for (const p of ["ASSEMBLE", "VALIDATE"] as const) {
      if (!phasesToRun.includes(p)) phasesToRun.push(p);
    }
  }

  return phasesToRun;
}

export const DAG_ORDER: string[] = [
  "INIT",
  "SCAN",
  "DEPENDENCY",
  "GEN",
  "ASSEMBLE",
  "VALIDATE",
];

// ─── Phase Definition ─────────────────────────────────────────────────

export function getPhaseDefinition(
  phase: string,
  paths: ResolvedPaths,
  args: RunnerArgs,
): PhaseDef | null {
  const { projectRoot, sourceRoot, cacheRoot, wikiRoot, statePath } = paths;

  const script = (
    name: string,
    scriptArgs: string[],
    critical = true,
    opts?: { timeout?: number; maxBuffer?: number },
  ): PhaseScript => ({
    name,
    args: scriptArgs,
    critical,
    ...(opts?.timeout ? { timeout: opts.timeout } : {}),
    ...(opts?.maxBuffer ? { maxBuffer: opts.maxBuffer } : {}),
  });

  const define = (
    order: number,
    label: string,
    scripts: PhaseScript[],
    requiresAgent = false,
  ): PhaseDef => ({ id: phase, label, order, scripts, requiresAgent });

  switch (phase) {
    case "INIT":
      return define(0, "项目初始化 + 技术栈识别 + 路径自检", [
        script("scan/scan-project.ts", [
          "--path",
          projectRoot,
          "--output",
          path.join(cacheRoot, "project-scan.json"),
        ]),
        script("dependency/compute-hashes.ts", [
          "--path",
          sourceRoot,
          "--output",
          path.join(cacheRoot, "file-hashes.json"),
        ]),
      ]);

    case "SCAN":
      return define(1, "文件扫描 + 样式过滤", [
        script("scan/scan-files.ts", [
          "--path",
          sourceRoot,
          "--output",
          path.join(cacheRoot, "file-list.json"),
        ]),
        script(
          "scan/filter-styles.ts",
          [
            "--input",
            path.join(cacheRoot, "file-list.json"),
            "--output",
            path.join(cacheRoot, "filtered-files.json"),
          ],
          false,
        ),
      ]);

    case "DEPENDENCY":
      return define(
        2,
        "依赖图 + 优先级 + 拆分策略 + 子图提取 + 文件元信息 + 依赖聚簇",
        [
          script(
            "dependency/build-deps.ts",
            [
              "--path",
              sourceRoot,
              "--output",
              path.join(cacheRoot, "dependency-graph.json"),
              "--format",
              "json",
              "--max-buffer",
              "104857600",
              "--timeout",
              "300000",
            ],
            true,
            { timeout: 300_000, maxBuffer: 104_857_600 },
          ),
          script(
            "dependency/build-deps.ts",
            [
              "--path",
              sourceRoot,
              "--output",
              path.join(cacheRoot, "dependency-graph.mmd"),
              "--format",
              "mermaid",
              "--max-buffer",
              "104857600",
              "--timeout",
              "300000",
            ],
            false,
            { timeout: 300_000, maxBuffer: 104_857_600 },
          ),
          script("dependency/file-priorities.ts", [
            "--files",
            path.join(cacheRoot, "file-list.json"),
            "--deps",
            path.join(cacheRoot, "dependency-graph.json"),
            "--output",
            path.join(cacheRoot, "file-priorities.json"),
          ]),
          script("dependency/analyze-folders.ts", [
            "--input",
            path.join(cacheRoot, "file-priorities.json"),
            "--output",
            path.join(cacheRoot, "folder-strategy.json"),
            "--source",
            sourceRoot,
          ]),
          script("dependency/extract-subgraph.ts", [
            "--deps",
            path.join(cacheRoot, "dependency-graph.json"),
            "--all",
            "--strategy",
            path.join(cacheRoot, "folder-strategy.json"),
            "--output-dir",
            path.join(cacheRoot, "deps"),
          ]),
          script("dependency/extract-file-meta.ts", [
            "--files",
            path.join(cacheRoot, "file-list.json"),
            "--source",
            sourceRoot,
            "--output",
            path.join(cacheRoot, "file-meta.json"),
          ]),
          script("dependency/cluster-tasks.ts", [
            "--deps",
            path.join(cacheRoot, "dependency-graph.json"),
            "--meta",
            path.join(cacheRoot, "file-meta.json"),
            "--files",
            path.join(cacheRoot, "file-list.json"),
            "--output",
            path.join(cacheRoot, "task-clusters.json"),
          ]),
        ],
      );

    case "GEN": {
      const genArgs: string[] = [];
      const clustersPath = path.join(cacheRoot, "task-clusters.json");
      if (fs.existsSync(clustersPath)) {
        genArgs.push("--clusters", clustersPath);
      } else {
        genArgs.push(
          "--strategy",
          path.join(cacheRoot, "folder-strategy.json"),
        );
      }
      genArgs.push(
        "--state",
        statePath,
        "--output",
        path.join(cacheRoot, "gen-schedule.json"),
        "--write-state",
      );
      if (args.tokenLimit && args.tokenLimit > 0) {
        genArgs.push("--token-limit", String(args.tokenLimit));
      } else if (args.limit !== undefined && args.limit > 0) {
        genArgs.push("--limit", String(args.limit));
      } else {
        // Dynamic default: read pending genTasks, compute batch size as ceil(total / 3).
        // This avoids the "11 batches for 52 tasks" problem while keeping batches manageable.
        let pendingCount = 0;
        try {
          const st = JSON.parse(fs.readFileSync(statePath, "utf-8"));
          pendingCount = (st.genTasks || []).filter(
            (t: { status: string }) => t.status === "pending",
          ).length;
        } catch {
          /* ignore */
        }
        const dynamicLimit = Math.max(10, Math.ceil((pendingCount || 1) / 3));
        genArgs.push("--limit", String(dynamicLimit));
      }
      if (args.resume) genArgs.push("--resume");

      return define(
        3,
        "GEN 调度 + SubAgent Prompt 生成（自动聚簇模式）",
        [script("gen/gen-scheduler.ts", genArgs)],
        true,
      );
    }

    case "ASSEMBLE":
      return define(4, "符号索引 + Issue 仪表盘 + 组装成书", [
        script("gen/sync-gen-tasks.ts", [
          "--state",
          statePath,
          "--wiki",
          wikiRoot,
          "--write",
        ]),
        script("gen/progress-dashboard.ts", [
          "--state",
          statePath,
          "--strategy",
          path.join(cacheRoot, "folder-strategy.json"),
          "--output",
          path.join(wikiRoot, "PROGRESS.md"),
        ]),
        script("assemble/symbol-index.ts", [
          "--wiki",
          wikiRoot,
          "--output",
          path.join(cacheRoot, "..", "search", "symbol-index.json"),
        ]),
        script(
          "assemble/fix-issue-paths.ts",
          ["--wiki", wikiRoot, "--apply"],
          false,
        ),
        script(
          "assemble/issue-dashboard.ts",
          [
            "--issues",
            path.join(wikiRoot, "volume-2-issues"),
            "--output",
            path.join(wikiRoot, "issues.md"),
          ],
          false,
        ),
        script(
          "validate/validate-issue-types.ts",
          [
            "--issues",
            path.join(wikiRoot, "volume-2-issues"),
            "--fix",
            "--output",
            path.join(cacheRoot, "issue-validation.json"),
          ],
          false, // 非关键：Issue 格式问题不阻塞流水线
        ),
        script(
          "validate/validate-issue-content.ts",
          [
            "--issues",
            path.join(wikiRoot, "volume-2-issues"),
            "--source",
            sourceRoot,
            "--deps",
            path.join(cacheRoot, "dependency-graph.json"),
            "--output",
            path.join(cacheRoot, "issue-content-validation.json"),
          ],
          false,
        ),
        script("assemble/assemble-book.ts", [
          "--wiki",
          wikiRoot,
          "--strategy",
          path.join(cacheRoot, "folder-strategy.json"),
        ]),
      ]);

    case "VALIDATE":
      return define(5, "交叉引用验证 + 源码引用校验", [
        script(
          "validate/validate-references.ts",
          [
            "--wiki",
            wikiRoot,
            "--output",
            path.join(cacheRoot, "reference-validation.json"),
          ],
          false,
        ),
        script(
          "validate/validate-code-refs.ts",
          [
            "--wiki",
            wikiRoot,
            "--source",
            sourceRoot,
            "--deps",
            path.join(cacheRoot, "dependency-graph.json"),
            "--output",
            path.join(cacheRoot, "code-ref-validation.json"),
          ],
          false,
        ),
      ]);

    default:
      return null;
  }
}
