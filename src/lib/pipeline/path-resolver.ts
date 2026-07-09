/**
 * Path resolution and validation utilities for the pipeline runner.
 *
 * Responsibilities:
 *   - CLI argument parsing (parseArgs)
 *   - Project path resolution (resolvePaths, detectMonorepoSources)
 *   - Path validation (validatePathRules)
 *
 * Usage:
 *   import { parseArgs, resolvePaths, validatePathRules } from "./path-resolver.js";
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { ArtifactVolume } from "../../types/index.js";
import { ALL_VOLUMES } from "../../types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Types ────────────────────────────────────────────────────────────

export interface RunnerArgs {
  project: string;
  source?: string;
  to?: string;
  only?: string;
  resume: boolean;
  limit?: number;
  tokenLimit?: number;
  mode: "full" | "incremental";
  since?: string;
  dryRun: boolean;
  force: boolean;
  /** Skip prerequisite phase dependency checks (e.g. --only ASSEMBLE without GEN). */
  skipDepsCheck: boolean;
  /** 要产出的分析产物类型（逗号分隔，默认 wiki,issue,experience 全部产出） */
  volumes?: string;
}

export interface ResolvedPaths {
  projectRoot: string;
  agenticWikiRoot: string;
  wikiRoot: string;
  sourceRoot: string;
  cacheRoot: string;
  statePath: string;
  libDir: string;
  /** Effective data root for .agentic-wiki/ and wiki/. */
  dataRoot: string;
}

interface MonorepoCandidate {
  packageName: string;
  sourcePath: string;
  relativePath: string;
}

// ─── CLI ────────────────────────────────────────────────────────────

export function parseArgs(): RunnerArgs {
  const argv = yargs(hideBin(process.argv))
    .option("project", {
      type: "string",
      demandOption: true,
      description: "目标项目路径",
    })
    .option("source", {
      type: "string",
      description: "源码目录（相对路径，覆盖默认 src/）",
    })
    .option("to", { type: "string", description: "运行到指定阶段后停止" })
    .option("only", { type: "string", description: "仅运行指定阶段" })
    .option("resume", {
      type: "boolean",
      default: false,
      description: "从上次中断继续",
    })
    .option("limit", {
      type: "number",
      default: 5,
      description: "GEN 阶段每批任务数",
    })
    .option("token-limit", {
      type: "number",
      description: "GEN 阶段每批 Token 上限",
    })
    .option("mode", {
      type: "string",
      choices: ["full", "incremental"] as const,
      default: "full",
      description: "流水线模式",
    })
    .option("since", { type: "string", description: "增量模式的 Git 基准引用" })
    .option("dry-run", {
      type: "boolean",
      default: false,
      description: "仅展示执行计划",
    })
    .option("force", {
      type: "boolean",
      default: false,
      description: "清除已有状态重新开始",
    })
    .option("skip-deps-check", {
      type: "boolean",
      default: false,
      description:
        "跳过前置阶段依赖检查（高级用法，如 --only ASSEMBLE 不强制要求 GEN 完成）",
    })
    .option("volumes", {
      type: "string",
      description:
        "要产出的分析产物类型（逗号分隔）。可选: wiki, issue, experience。默认全部产出",
    })
    .parseSync() as unknown as ResolvedPaths;

  return {
    project: path.resolve(argv.project),
    source: argv.source,
    to: argv.to,
    only: argv.only,
    resume: argv.resume,
    limit: argv.limit,
    tokenLimit: argv["token-limit"],
    mode: argv.mode,
    since: argv.since,
    dryRun: argv["dry-run"],
    force: argv.force,
    skipDepsCheck: argv["skip-deps-check"],
    volumes: argv.volumes,
  };
}

/**
 * Parse --volumes CLI string into ArtifactVolume array.
 * Validates each value against ALL_VOLUMES and returns defaults if not provided.
 */
export function parseVolumes(raw?: string): ArtifactVolume[] {
  if (!raw || raw.trim() === "") return [...ALL_VOLUMES];
  const parts = raw.split(",").map((s) => s.trim().toLowerCase());
  const valid: ArtifactVolume[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if ((ALL_VOLUMES as string[]).includes(p)) {
      valid.push(p as ArtifactVolume);
    } else {
      invalid.push(p);
    }
  }
  if (invalid.length > 0) {
    console.warn(
      `⚠️  无效的 volumes 值: ${invalid.join(", ")}。有效值: ${ALL_VOLUMES.join(", ")}`,
    );
  }
  if (valid.length === 0) {
    console.warn(`⚠️  无有效 volumes，回退到默认值: ${ALL_VOLUMES.join(", ")}`);
    return [...ALL_VOLUMES];
  }
  return valid;
}

// ─── Monorepo Detection ─────────────────────────────────────────────

export function detectMonorepoSources(
  projectRoot: string,
): MonorepoCandidate[] {
  const candidates: MonorepoCandidate[] = [];
  const knownMonorepoDirs = ["packages", "apps", "libs", "modules"];

  for (const dir of knownMonorepoDirs) {
    const dirPath = path.join(projectRoot, dir);
    if (!fs.existsSync(dirPath)) continue;
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;

      const srcPath = path.join(dirPath, entry.name, "src");
      if (!fs.existsSync(srcPath)) continue;
      if (!fs.statSync(srcPath).isDirectory()) continue;

      let packageName = entry.name;
      const pkgJsonPath = path.join(dirPath, entry.name, "package.json");
      try {
        const pkg = fs.readJsonSync(pkgJsonPath);
        packageName = pkg.name || entry.name;
      } catch {
        /* fall back to directory name */
      }

      candidates.push({
        packageName,
        sourcePath: srcPath,
        relativePath: path.join(dir, entry.name, "src"),
      });
    }
  }

  return candidates;
}

export function countSourceFilesQuick(srcPath: string): number {
  const exts = new Set([".ts", ".tsx", ".js", ".jsx"]);
  let count = 0;
  try {
    const entries = fs.readdirSync(srcPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (exts.has(ext)) count++;
      } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
        try {
          const sub = fs.readdirSync(path.join(srcPath, entry.name), {
            withFileTypes: true,
          });
          for (const s of sub) {
            if (s.isFile()) {
              const ext2 = path.extname(s.name);
              if (exts.has(ext2)) count++;
            }
          }
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    /* skip */
  }
  return count;
}

// ─── Path Resolution ─────────────────────────────────────────────────

export function resolvePaths(
  projectRoot: string,
  sourceOverride?: string,
): ResolvedPaths {
  let awRoot = __dirname;
  while (awRoot !== path.dirname(awRoot)) {
    try {
      const pkg = fs.readJsonSync(path.join(awRoot, "package.json"));
      if (pkg.name === "agentic-wiki") break;
    } catch {
      /* continue */
    }
    awRoot = path.dirname(awRoot);
  }

  let dataRoot: string;
  if (sourceOverride) {
    const resolvedSource = path.resolve(projectRoot, sourceOverride);
    const sourceParent = path.dirname(resolvedSource);
    // Check source dir itself first (when source IS the package dir, e.g. --source packages/components),
    // then fall back to parent (when source is a subdir like --source packages/components/src).
    if (fs.existsSync(path.join(resolvedSource, "package.json"))) {
      dataRoot = resolvedSource;
    } else if (fs.existsSync(path.join(sourceParent, "package.json"))) {
      dataRoot = sourceParent;
    } else {
      dataRoot = projectRoot;
    }
  } else {
    dataRoot = projectRoot;
  }

  const wikiRoot = path.join(dataRoot, "wiki");
  const defaultSource = path.join(projectRoot, "src");
  let sourceRoot: string;

  if (sourceOverride) {
    sourceRoot = path.resolve(projectRoot, sourceOverride);
  } else if (fs.existsSync(defaultSource)) {
    sourceRoot = defaultSource;
  } else {
    const candidates = detectMonorepoSources(projectRoot);
    if (candidates.length > 0) {
      console.log("\n📦 检测到 monorepo 结构，但未指定要分析哪个包。\n");
      console.log("可用源码目录：");
      for (const c of candidates) {
        const fileCount = countSourceFilesQuick(c.sourcePath);
        console.log(
          `  ${fileCount > 0 ? "📄" : "📁"}  ${c.relativePath}  ← ${c.packageName}${fileCount > 0 ? ` (${fileCount} 个源文件)` : ""}`,
        );
      }
      console.log("\n请用 --source 参数指定要分析哪个包，例如：");
      console.log(
        `  npx tsx src/runner.ts --project "${projectRoot}" --source ${candidates[0].relativePath}\n`,
      );
      process.exit(0);
    }
    sourceRoot = defaultSource;
  }

  const cacheRoot = path.join(dataRoot, ".agentic-wiki", "cache");
  const statePath = path.join(dataRoot, ".agentic-wiki", "state.json");
  const libDir = path.join(awRoot, "src", "lib");

  return {
    projectRoot,
    agenticWikiRoot: awRoot,
    wikiRoot,
    sourceRoot,
    cacheRoot,
    statePath,
    libDir,
    dataRoot,
  };
}

// ─── Path Validation ─────────────────────────────────────────────────

export function validatePathRules(paths: ResolvedPaths): void {
  const { projectRoot, agenticWikiRoot, wikiRoot, cacheRoot, sourceRoot } =
    paths;
  const checks: Array<{ rule: string; pass: boolean; detail: string }> = [];

  const r1 = path.resolve(projectRoot) !== path.resolve(agenticWikiRoot);
  checks.push({
    rule: "projectRoot ≠ agenticWikiRoot",
    pass: r1,
    detail: r1 ? "OK" : "CRITICAL: projectRoot equals agenticWikiRoot",
  });

  const expectedWiki = path.join(paths.dataRoot, "wiki");
  const r2 = path.resolve(wikiRoot) === path.resolve(expectedWiki);
  checks.push({
    rule: "wikiRoot = projectRoot + '/wiki'",
    pass: r2,
    detail: r2 ? "OK" : `Expected ${expectedWiki}, got ${wikiRoot}`,
  });

  const r3 = path
    .resolve(cacheRoot)
    .startsWith(path.resolve(projectRoot) + path.sep);
  checks.push({
    rule: "cacheRoot under projectRoot",
    pass: r3,
    detail: r3 ? "OK" : `${cacheRoot} is outside ${projectRoot}`,
  });

  const r4 = path
    .resolve(sourceRoot)
    .startsWith(path.resolve(projectRoot) + path.sep);
  checks.push({
    rule: "sourceRoot under projectRoot",
    pass: r4,
    detail: r4 ? "OK" : `${sourceRoot} is outside ${projectRoot}`,
  });

  const r5 = fs.existsSync(sourceRoot);
  checks.push({
    rule: "sourceRoot exists on disk",
    pass: r5,
    detail: r5 ? `OK (${sourceRoot})` : `NOT FOUND: ${sourceRoot}`,
  });

  console.log("🔴 路径自检:");
  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? "✅" : "❌"} ${c.rule}: ${c.detail}`);
    if (!c.pass) allPass = false;
  }
  if (!allPass) {
    console.error("\n❌ 路径铁律违反，阻断流水线。");
    process.exit(1);
  }
  console.log("");
}
