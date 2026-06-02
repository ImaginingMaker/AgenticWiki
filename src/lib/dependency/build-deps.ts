/**
 * Build module dependency graph using dependency-cruiser.
 *
 * Usage (via runner.ts):
 *   npx tsx src/lib/build-deps.ts --path <sourcePath> --output <jsonFile> [--format json|mermaid]
 *
 * New options (v2.1):
 *   --max-buffer <bytes>  Max stdout buffer (default 50MB, increase for large projects)
 *   --timeout <ms>        Max execution time (default 5min)
 */

import { execSync } from "node:child_process";
import fs from "fs-extra";
import path from "node:path";
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
  const args = ["dependency-cruiser", "--output-type", "json", "--no-config"];

  // Include TypeScript/JSX support
  const tsConfig = tsConfigPath || findTsConfig(sourcePath);
  if (tsConfig) {
    args.push("--ts-config", tsConfig);
  }

  // Files to analyze
  args.push(sourcePath);

  // Resolve the locally-installed dependency-cruiser binary
  const binPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../node_modules/.bin/dependency-cruiser",
  );
  args[0] = binPath;

  try {
    const result = execSync(args.join(" "), {
      cwd: "/tmp",
      encoding: "utf-8",
      maxBuffer,
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(result);
  } catch (error: any) {
    // Specific error for maxBuffer exceeded
    if (error.message && error.message.includes("stdout maxBuffer")) {
      throw new Error(
        `dependency-cruiser output exceeded ${(maxBuffer / 1024 / 1024).toFixed(0)}MB buffer. ` +
          `Re-run with --max-buffer to increase (e.g., --max-buffer 104857600 for 100MB) ` +
          `or analyze fewer files by targeting a subdirectory.`,
      );
    }
    // Timeout
    if (error.killed || (error.signal && error.signal === "SIGTERM")) {
      throw new Error(
        `dependency-cruiser timed out after ${(timeout / 1000 / 60).toFixed(0)} minutes. ` +
          `Consider increasing --timeout or analyzing a smaller scope.`,
      );
    }
    // dependency-cruiser may exit with non-zero for warnings (e.g., violations)
    // Try to extract the JSON output from stderr/stdout
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch {
        // fall through
      }
    }
    if (error.stderr) {
      try {
        return JSON.parse(error.stderr);
      } catch {
        // fall through
      }
    }
    throw error;
  }
}

// ... (rest of file unchanged until buildDependencyGraph)

/**
 * Find tsconfig.json in the project root.
 */
function findTsConfig(basePath: string): string | undefined {
  const candidates = [
    path.join(basePath, "tsconfig.json"),
    path.join(basePath, "..", "tsconfig.json"),
    path.join(basePath, "..", "..", "tsconfig.json"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }
  return undefined;
}

/**
 * Normalize path separators to forward slashes and resolve relative paths.
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Convert dependency-cruiser JSON output to AgenticWiki DependencyGraphResult.
 */
function transformCruiserOutput(
  rawOutput: unknown,
  sourcePath: string,
  projectPath: string,
): DependencyGraphResult {
  const output = rawOutput as any;
  const modulesMap = new Map<string, ModuleInfo>();

  const rawModules: any[] = output?.modules || [];
  const resolvedBase = path.resolve(projectPath);
  const resolvedSource = path.resolve(sourcePath);

  function relativize(cruiserPath: string): string {
    if (!cruiserPath) return cruiserPath;
    const absolute = path.resolve("/tmp", cruiserPath);
    try {
      const realBase = fs.realpathSync(resolvedBase);
      const realFile = fs.realpathSync(absolute);
      let rel = path.relative(realBase, realFile);
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

  for (const mod of rawModules) {
    const source = relativize(mod.source);
    const isExternal = source.includes("node_modules");
    if (isExternal) continue;

    const dependencies: Dependency[] = [];
    const dependents: string[] = [];

    for (const dep of mod.dependencies || []) {
      const resolved = relativize(
        dep.resolved || dep.couldNotResolve || dep.module || "",
      );
      const type: Dependency["type"] = resolved.includes("node_modules")
        ? "external"
        : "local";
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

  // Detect dependency cycles
  const cycles: CycleInfo[] = [];
  if (output?.summary?.violations) {
    for (const violation of output.summary.violations) {
      if (
        violation.rule?.name === "no-circular" ||
        violation.rule?.severity === "error"
      ) {
        const from = normalizePath(violation.from || "");
        const to = normalizePath(violation.to || "");
        if (from && to && from !== to) {
          cycles.push({
            path: [from, to, from],
            severity: "error",
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
  } catch (error: any) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(2);
  }
}

const isMainModule =
  process.argv[1]?.endsWith("build-deps.ts") ||
  process.argv[1]?.endsWith("build-deps.js");
if (isMainModule) main();
