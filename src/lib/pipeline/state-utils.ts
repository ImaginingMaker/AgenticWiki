/**
 * State management utilities for the pipeline runner.
 *
 * Responsibilities:
 *   - Load/save pipeline state (loadState, saveStatePhase)
 *   - Phase status queries (isPhaseCompleted, getCurrentPhase)
 *   - State initialization (initializeState)
 *
 * Usage:
 *   import { loadState, saveStatePhase, initializeState } from "./state-utils.js";
 */

import path from "node:path";
import fs from "fs-extra";
import { execSync } from "node:child_process";
import type { ResolvedPaths, RunnerArgs } from "./path-resolver.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface WikiState {
  schemaVersion: number;
  id: string;
  projectPath: string;
  currentPhase: string;
  phaseHistory: Array<{ phase: string; status: string; completedAt?: string }>;
  genTasks?: GenTask[];
  config: {
    paths: {
      projectRoot: string;
      agenticWikiRoot: string;
      wikiRoot: string;
      sourceRoot: string;
      cacheRoot: string;
    };
  };
  blockers: Array<{ description: string }>;
}

export interface GenTask {
  id: string;
  folder: string;
  role: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  output?: string;
  issuesFound?: string[];
  estimatedTokens: number;
  actualTokens?: number;
  mergeWith?: string;
  wikiChapter?: string;
}

// ─── State Operations ─────────────────────────────────────────────────

export function loadState(statePath: string): WikiState | null {
  if (!fs.existsSync(statePath)) return null;
  return fs.readJsonSync(statePath) as WikiState;
}

export function saveStatePhase(
  statePath: string,
  libDir: string,
  cwd: string,
  phase: string,
  status: string,
  nextPhase: string,
  artifacts: string[],
  scripts: string[],
): void {
  const stateManagerPath = path.join(libDir, "shared", "state-manager.ts");
  const artifactsStr = artifacts.join(",");
  const scriptsStr = scripts.join(",");

  const cmd = [
    `npx tsx "${stateManagerPath}" transition`,
    `--state "${statePath}"`,
    `--phase ${phase}`,
    `--status ${status}`,
    `--next-phase ${nextPhase}`,
    `--artifacts "${artifactsStr}"`,
    `--scripts "${scriptsStr}"`,
    `--gate`,
  ].join(" ");

  try {
    execSync(cmd, { cwd, encoding: "utf-8", stdio: "pipe", timeout: 30_000 });
  } catch (err: unknown) {
    const errMsg =
      err instanceof Error
        ? (err as Record<string, unknown>).message
        : String(err);
    console.warn(
      `  ⚠️  状态更新失败（流水线不阻断）: ${String(errMsg).slice(0, 200)}`,
    );
  }
}

export function isPhaseCompleted(
  state: WikiState | null,
  phase: string,
): boolean {
  if (!state) return false;
  const record = state.phaseHistory?.find((r) => r.phase === phase);
  return record?.status === "completed";
}

export function getCurrentPhase(state: WikiState | null): string {
  if (!state) return "INIT";
  return state.currentPhase || "INIT";
}

export function initializeState(
  paths: ResolvedPaths,
  args: RunnerArgs,
): WikiState {
  const stateManagerPath = path.join(
    paths.libDir,
    "shared",
    "state-manager.ts",
  );
  const initArgs = [
    `npx tsx "${stateManagerPath}" init`,
    `--project "${paths.projectRoot}"`,
    `--agentic-wiki "${paths.agenticWikiRoot}"`,
    `--output "${paths.statePath}"`,
  ];
  if (args.source) {
    initArgs.push(`--source "${args.source}"`);
  }

  try {
    execSync(initArgs.join(" "), {
      cwd: paths.projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch (err: unknown) {
    const initErrMsg =
      err instanceof Error
        ? (err as Record<string, unknown>).message
        : String(err);
    console.error(
      `  ❌ state.json 初始化失败: ${String(initErrMsg).slice(0, 300)}`,
    );
    process.exit(1);
  }

  const state = fs.readJsonSync(paths.statePath) as WikiState;
  if (state.config?.paths) {
    state.config.paths.wikiRoot = paths.wikiRoot;
    state.config.paths.cacheRoot = paths.cacheRoot;
    state.config.paths.sourceRoot = paths.sourceRoot;
    state.config.paths.projectRoot = paths.dataRoot;
    fs.writeJsonSync(paths.statePath, state, { spaces: 2 });
  }

  // Persist volumes from CLI args into state config
  if (args.volumes) {
    const volumes = parseVolumesFromString(args.volumes);
    if (state.config) {
      (state.config as Record<string, unknown>).volumes = volumes;
      fs.writeJsonSync(paths.statePath, state, { spaces: 2 });
    }
  }

  return state;
}

/** Parse --volumes string to array (lightweight in-file duplicate for gen-scheduler). */
function parseVolumesFromString(raw: string): string[] {
  const ALL = ["wiki", "issue", "experience"];
  const parts = raw.split(",").map((s) => s.trim().toLowerCase());
  const valid = parts.filter((p) => ALL.includes(p));
  return valid.length > 0 ? valid : [...ALL];
}
