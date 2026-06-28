/**
 * Build module dependency graph using dependency-cruiser.
 *
 * Usage (via runner.ts):
 *   npx tsx src/lib/dependency/build-deps.ts --path <sourcePath> --output <jsonFile> [--format json|mermaid]
 *
 * New options (v2.1):
 *   --max-buffer <bytes>  Max stdout buffer (default 50MB, increase for large projects)
 *   --timeout <ms>        Max execution time (default 5min)
 */

import { execFileSync } from "node:child_process";
import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type {
  DependencyGraphResult,
  Dependency,
  ModuleInfo,
  CycleInfo,
  HotspotItem,
} from "../types/index.js";

/**
 * Run dependency-cruiser and return raw JSON output.
 * @param maxBuffer - Maximum stdout buffer in bytes (default 50MB, increase for large projects)
 * @param timeout - Maximum execution time in ms (default 5 minutes)
 */
function runDependencyCruiser(
  sourcePath: string,
  tsConfigPath?: string,
  maxBuffer: number = 50 * 1024 * 1024,
  timeout: number = 5 * 60 * 1000,
): unknown {
  const args = ["--output-type", "json", "--no-config"];

  // Include TypeScript/JSX support
  const tsConfig = tsConfigPath || findTsConfig(sourcePath);
  if (tsConfig) {
    args.push("--ts-config", tsConfig);
  }

  // Files to analyze
  args.push(sourcePath);

  // Resolve the locally-installed dependency-cruiser binary
  const currentFilePath = fileURLToPath(import.meta.url);
  const projectRoot = findProjectRoot(path.dirname(currentFilePath));
  const binPath = path.join(
    projectRoot,
    "node_modules/.bin/dependency-cruiser",
  );

  try {
    const result = execFileSync(binPath, args, {
      cwd: "/tmp",
      encoding: "utf-8",
      maxBuffer,
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(result);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    // Specific error for maxBuffer exceeded
    if (err.message.includes("stdout maxBuffer")) {
      throw new Error(
        `dependency-cruiser output exceeded ${(maxBuffer / 1024 / 1024).toFixed(0)}MB buffer. ` +
          `Re-run with --max-buffer to increase (e.g., --max-buffer 104857600 for 100MB) ` +
          `or analyze fewer files by targeting a subdirectory.`,
        { cause: error },
      );
    }
    // Timeout
    if (err.killed || err.signal === "SIGTERM") {
      throw new Error(
        `dependency-cruiser timed out after ${(timeout / 1000 / 60).toFixed(0)} minutes. ` +
          `Consider increasing --timeout or analyzing a smaller scope.`,
        { cause: error },
      );
    }
    // dependency-cruiser may exit with non-zero for warnings (e.g., violations)
    // Try to extract the JSON output from stderr/stdout
    const execErr = err as Record<string, unknown>;
    if (typeof execErr.stdout === "string") {
      try {
        return JSON.parse(execErr.stdout);
      } catch {
        // fall through
      }
    }
    if (typeof execErr.stderr === "string") {
      try {
        return JSON.parse(execErr.stderr);
      } catch {
        // fall through
      }
    }
    throw err;
  }
}

// ... (rest of file unchanged until buildDependencyGraph)

/**
 * Find tsconfig.json by walking up the directory tree recursively.
 */
function findTsConfig(basePath: string): string | undefined {
  let current = path.resolve(basePath);
  const root = path.parse(current).root;
  while (current !== root) {
    const candidate = path.join(current, "tsconfig.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    current = path.dirname(current);
  }
  const rootCandidate = path.join(root, "tsconfig.json");
  if (fs.existsSync(rootCandidate)) return rootCandidate;
  return undefined;
}

/**
 * Walk up from startDir to find the project root (directory containing node_modules).
 */
function findProjectRoot(startDir: string): string {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;
  while (current !== root) {
    if (fs.existsSync(path.join(current, "node_modules"))) {
      return current;
    }
    current = path.resolve(current, "..");
  }
  // Fallback: return startDir's parent if nothing found
  return path.resolve(startDir, "..");
}

/**
 * Normalize path separators to forward slashes and resolve relative paths.
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/** Dependency-cruiser module dependency entry. */
interface CruiserDep {
  resolved?: string;
  couldNotResolve?: string;
  module?: string;
  moduleName?: string;
  circular?: boolean;
  cycle?: boolean;
}

/** Dependency-cruiser module entry. */
interface CruiserModule {
  source: string;
  dependencies: CruiserDep[];
}

/** Dependency-cruiser violation entry. */
interface CruiserViolation {
  rule?: { name?: string; severity?: string };
  from?: string;
  to?: string;
}

/** Dependency-cruiser summary. */
interface CruiserSummary {
  violations?: CruiserViolation[];
}

/** Dependency-cruiser output format. */
interface CruiserOutput {
  modules: CruiserModule[];
  summary?: CruiserSummary;
}

/**
 * Convert dependency-cruiser JSON output to AgenticWiki DependencyGraphResult.
 *
 * Path normalization base: `sourcePath` (the sourceRoot), NOT `projectPath`.
 * This keeps dep-graph paths aligned with `file-list.json` (produced by
 * scan-files.ts via `globby({ cwd: sourcePath, absolute: false })`), so
 * downstream consumers (cluster-tasks.ts, file-priorities.ts) can do O(1)
 * `moduleMap.get(file)` lookups across both artifacts.
 *
 * `projectPath` is still used for tsconfig discovery and remains a separate
 * concern — the two responsibilities must not be mixed.
 */
export function transformCruiserOutput(
  rawOutput: unknown,
  sourcePath: string,
  projectPath: string,
): DependencyGraphResult {
  const output = rawOutput as CruiserOutput;
  const modulesMap = new Map<string, ModuleInfo>();

  const rawModules: CruiserModule[] = output?.modules || [];
  // Normalize relative to sourceRoot (same base as scan-files.ts), so paths
  // in dependency-graph.json match file-list.json. `projectPath` is retained
  // in the signature only because callers pass it; it is not used here.
  void projectPath;
  const resolvedBase = path.resolve(sourcePath);

  function relativize(cruiserPath: string): string {
    if (!cruiserPath) return cruiserPath;
    const absolute = path.resolve("/tmp", cruiserPath);
    try {
      const realBase = fs.realpathSync(resolvedBase);
      const realFile = fs.realpathSync(absolute);
      const rel = path.relative(realBase, realFile);
      if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
        return normalizePath(rel);
      }
    } catch {
      // File doesn't exist (external module)
    }
    const moduleName = cruiserPath
      .replace(/^(\.\.\/)+/, "")
      .replace(/^.*?node_modules\//, "");
    return normalizePath(moduleName || cruiserPath);
  }

  /**
   * Classify a cruiser dependency as local or external using RAW cruiser
   * fields, NOT the relativized path.
   *
   * The previous logic checked `resolved.includes("node_modules")` AFTER
   * relativize, but relativize's fallback strips "node_modules/" — making
   * external deps (bare "react", "/path/node_modules/lodash", or
   * couldNotResolve entries) indistinguishable from local files. This caused
   * external deps to be misclassified as "local", polluting cluster-tasks
   * BFS traversal and file-priorities dependent counts.
   */
  function classifyDep(
    dep: CruiserDep,
  ): { type: "local" | "external"; resolved: string } {
    const rawResolved = dep.resolved || "";
    const couldNotResolve = dep.couldNotResolve || "";

    // External: cruiser couldn't resolve, or resolved into node_modules
    if (couldNotResolve || rawResolved.includes("node_modules")) {
      return {
        type: "external",
        resolved:
          dep.moduleName || dep.module || couldNotResolve || rawResolved,
      };
    }

    // Local: cruiser resolved to a project path — normalize it
    if (rawResolved) {
      return { type: "local", resolved: relativize(rawResolved) };
    }

    // No resolved field. If module is a bare specifier (not relative),
    // treat as external; otherwise relativize as local.
    const mod = dep.module || "";
    if (mod && !mod.startsWith(".")) {
      return { type: "external", resolved: dep.moduleName || mod };
    }
    return {
      type: "local",
      resolved: relativize(mod || couldNotResolve),
    };
  }

  for (const mod of rawModules) {
    // cruiser only analyzes files under --path, so mod.source is normally
    // local. Guard against node_modules leakage using the RAW source path
    // (relativize's fallback would strip "node_modules/" and hide it).
    if (mod.source.includes("node_modules")) continue;
    const source = relativize(mod.source);
    if (source.includes("node_modules")) continue;

    const dependencies: Dependency[] = [];
    const dependents: string[] = [];

    for (const dep of mod.dependencies || []) {
      const { type, resolved } = classifyDep(dep);
      const circular = dep.circular === true || dep.cycle === true || false;

      dependencies.push({
        resolved: type === "local" ? resolved : dep.moduleName || resolved,
        type,
        circular,
      });
    }

    modulesMap.set(source, {
      source,
      dependencies,
      dependents,
      hasCircular: false,
    });
  }

  // Second pass: populate dependents
  const hasCircular = new Set<string>();
  for (const [source, info] of modulesMap) {
    for (const dep of info.dependencies) {
      if (dep.circular) {
        hasCircular.add(dep.resolved);
        hasCircular.add(source);
      }
      const target = modulesMap.get(dep.resolved);
      if (target) {
        target.dependents.push(source);
      }
    }
  }

  for (const source of hasCircular) {
    const mod = modulesMap.get(source);
    if (mod) mod.hasCircular = true;
  }

  // Detect dependency cycles — strict no-circular rule matching only
  const cycles: CycleInfo[] = [];
  if (output?.summary?.violations) {
    for (const violation of output.summary.violations) {
      if (violation.rule?.name === "no-circular") {
        const from = normalizePath(violation.from || "");
        const to = normalizePath(violation.to || "");
        const cyclePath = (violation as Record<string, unknown>).cycle as
          | string[]
          | undefined;
        if (from && to && from !== to) {
          cycles.push({
            path:
              cyclePath && cyclePath.length > 0 ? cyclePath : [from, to, from],
            severity: violation.rule?.severity || "error",
            description: `循环依赖: ${from} → ${to} → ${from}`,
          });
        }
      }
    }
  }

  // Compute hotspots
  const allModules = Array.from(modulesMap.values());
  const mostDepended: HotspotItem[] = allModules
    .filter((m) => m.dependents.length > 0)
    .sort((a, b) => b.dependents.length - a.dependents.length)
    .slice(0, 10)
    .map((m) => ({
      source: m.source,
      dependentsCount: m.dependents.length,
    }));

  const mostDependent: HotspotItem[] = allModules
    .sort(
      (a, b) =>
        b.dependencies.filter((d) => d.type === "local").length -
        a.dependencies.filter((d) => d.type === "local").length,
    )
    .slice(0, 10)
    .map((m) => ({
      source: m.source,
      dependenciesCount: m.dependencies.filter((d) => d.type === "local")
        .length,
    }));

  return {
    generatedAt: new Date().toISOString(),
    modules: allModules,
    cycles,
    hotspots: { mostDepended, mostDependent },
  };
}

/**
 * Build dependency graph from source files.
 * @param maxBuffer - Max stdout buffer for dependency-cruiser (default 50MB)
 * @param timeout - Max execution time in ms (default 5min)
 */
export async function buildDependencyGraph(
  sourcePath: string,
  projectPath?: string,
  maxBuffer?: number,
  timeout?: number,
): Promise<DependencyGraphResult> {
  const resolvedPath = path.resolve(sourcePath);
  const resolvedProject = projectPath
    ? path.resolve(projectPath)
    : path.resolve(sourcePath, "..");

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Source path does not exist: ${resolvedPath}`);
  }

  const tsConfigPath = findTsConfig(resolvedProject);
  const rawOutput = runDependencyCruiser(
    resolvedPath,
    tsConfigPath,
    maxBuffer,
    timeout,
  );

  return transformCruiserOutput(rawOutput, resolvedPath, resolvedProject);
}

/**
 * Generate Mermaid diagram from dependency graph.
 */
export function generateMermaid(
  graph: DependencyGraphResult,
  maxNodes: number = 50,
): string {
  const lines: string[] = ["graph TD"];
  const addedEdges = new Set<string>();
  let nodeCount = 0;

  for (const mod of graph.modules) {
    if (nodeCount >= maxNodes) break;
    const sourceId = sanitizeNodeId(mod.source);
    const sourceLabel = path.basename(mod.source);

    for (const dep of mod.dependencies) {
      if (dep.type !== "local") continue;

      const targetId = sanitizeNodeId(dep.resolved);
      const edge = `${sourceId} --> ${targetId}`;
      if (!addedEdges.has(edge)) {
        addedEdges.add(edge);
        const targetLabel = path.basename(dep.resolved);
        lines.push(
          `  ${sourceId}[${sourceLabel}] --> ${targetId}[${targetLabel}]`,
        );
      }
      nodeCount++;
      if (nodeCount >= maxNodes) break;
    }
  }

  if (lines.length === 1) {
    lines.push("  // No dependencies found");
  }
  return lines.join("\n");
}

export function sanitizeNodeId(filePath: string): string {
  return filePath
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// === CLI Entry Point ===
async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("path", {
      type: "string",
      demandOption: true,
      description: "Source code path to analyze",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      description: "Output file path (JSON)",
    })
    .option("format", {
      type: "string",
      choices: ["json", "mermaid"],
      default: "json",
      description: "Output format",
    })
    .option("max-nodes", {
      type: "number",
      default: 50,
      description: "Maximum nodes in Mermaid output",
    })
    .option("max-buffer", {
      type: "number",
      default: 50 * 1024 * 1024,
      description:
        "Maximum stdout buffer in bytes (increase for large projects)",
    })
    .option("timeout", {
      type: "number",
      default: 5 * 60 * 1000,
      description: "Maximum execution time in ms",
    })
    .parseSync();

  try {
    const graph = await buildDependencyGraph(
      argv.path,
      undefined,
      argv["max-buffer"],
      argv.timeout,
    );

    if (argv.format === "mermaid") {
      const mermaid = generateMermaid(graph, argv["max-nodes"]);
      await fs.outputFile(argv.output, mermaid, "utf-8");
      process.stdout.write(`Mermaid graph written to ${argv.output}\n`);
    } else {
      await fs.outputJson(argv.output, graph, { spaces: 2 });
      process.stdout.write(
        `Dependency graph written to ${argv.output} (${graph.modules.length} modules, ${graph.cycles.length} cycles)\n`,
      );
    }
  } catch (error: unknown) {
    const errMsg =
      error instanceof Error
        ? error.message
        : `Non-Error thrown: ${String(error)}`;
    process.stderr.write(`Error: ${errMsg}\n`);
    process.exit(2);
  }
}

const isMainModule =
  process.argv[1]?.endsWith("build-deps.ts") ||
  process.argv[1]?.endsWith("build-deps.js");
if (isMainModule) main();
