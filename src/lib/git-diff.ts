import fse from "fs-extra";
import path from "node:path";
import { simpleGit } from "simple-git";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type {
  ChangedFile,
  AffectedFile,
  DependencyGraphResult,
  IncrementalAnalysisResult,
  AffectedFolder,
} from "../types/index.js";

export async function getGitDiff(
  repoPath: string,
  since: string,
): Promise<ChangedFile[]> {
  const git = simpleGit(repoPath);
  const diffSummary = await git.diffSummary([since]);

  return diffSummary.files.map((file) => {
    let status: ChangedFile["status"] = "modified";

    const rawFile = file as unknown as Record<string, unknown>;
    if (rawFile.status === "A" || rawFile.status === "added") {
      status = "added";
    } else if (rawFile.status === "D" || rawFile.status === "deleted") {
      status = "deleted";
    }

    return {
      path: file.file,
      status,
    };
  });
}

export function computeAffectedScope(
  changedFiles: ChangedFile[],
  dependencyGraph: DependencyGraphResult,
): AffectedFile[] {
  const affectedSet = new Set<string>();

  for (const file of changedFiles) {
    affectedSet.add(file.path);
  }

  const dependentsMap = new Map<string, string[]>();
  for (const module of dependencyGraph.modules) {
    dependentsMap.set(module.source, module.dependents);
  }

  const queue = [...changedFiles.map((f) => f.path)];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = dependentsMap.get(current) ?? [];
    for (const dep of dependents) {
      if (!affectedSet.has(dep)) {
        affectedSet.add(dep);
        queue.push(dep);
      }
    }
  }

  const directPaths = new Set(changedFiles.map((f) => f.path));
  const result: AffectedFile[] = [];

  for (const fp of affectedSet) {
    if (directPaths.has(fp)) {
      const changed = changedFiles.find((f) => f.path === fp)!;
      result.push({
        path: fp,
        reason: `Directly ${changed.status}`,
      });
    } else {
      result.push({
        path: fp,
        reason: "Depends on changed file",
      });
    }
  }

  return result;
}

// === CLI Entry Point ===
async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("since", {
      type: "string",
      demandOption: true,
      description: "Starting commit (e.g., HEAD~1)",
    })
    .option("repo", {
      type: "string",
      default: ".",
      description: "Path to git repository",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      description: "Output JSON file path",
    })
    .option("deps", {
      type: "string",
      description: "Path to dependency-graph.json for propagation analysis",
    })
    .parseSync();

  const repoPath = path.resolve(argv.repo);
  const changedFiles = await getGitDiff(repoPath, argv.since);

  const git = simpleGit(repoPath);
  const log = await git.log({ maxCount: 2 });
  const sinceCommit = log.all.length >= 2 ? log.all[1].hash : "unknown";
  const currentCommit = log.latest?.hash || "HEAD";

  const result: IncrementalAnalysisResult = {
    since: argv.since,
    sinceCommit,
    currentCommit,
    changedFiles,
    affectedFiles: [],
    affectedFolders: [],
    unaffectedFolders: [],
  };

  // If dependency graph is provided, compute affected scope
  if (argv.deps && changedFiles.length > 0) {
    const depGraph: DependencyGraphResult = await fse.readJson(argv.deps);
    const affectedFiles = computeAffectedScope(changedFiles, depGraph);
    result.affectedFiles = affectedFiles;

    // Group by folder
    const folderMap = new Map<string, { reason: string; files: string[] }>();
    const affectedPaths = new Set(affectedFiles.map((f) => f.path));

    for (const af of affectedFiles) {
      const folder = path.dirname(af.path) || ".";
      if (!folderMap.has(folder)) {
        folderMap.set(folder, { reason: af.reason, files: [] });
      }
      folderMap.get(folder)!.files.push(af.path);
    }

    result.affectedFolders = [...folderMap.entries()].map(
      ([folderPath, info]) => ({
        path: folderPath,
        reason: info.reason,
        files: info.files,
      }),
    );

    // Find unaffected folders from dependency-graph
    const allFolders = new Set<string>();
    for (const mod of depGraph.modules) {
      const folder = path.dirname(mod.source) || ".";
      allFolders.add(folder);
    }

    const unaffectedFolders: AffectedFolder[] = [];
    for (const folder of allFolders) {
      if (!folderMap.has(folder)) {
        unaffectedFolders.push({
          path: folder,
          reason: "No propagation from changes",
        });
      }
    }
    result.unaffectedFolders = unaffectedFolders;

    // Analysis scope
    result.analysisScope = {
      totalFolders: allFolders.size,
      affectedFolders: folderMap.size,
      unaffectedFolders: unaffectedFolders.length,
      reductionRatio:
        allFolders.size > 0
          ? `${Math.round((1 - folderMap.size / allFolders.size) * 100)}%`
          : "0%",
    };
  }

  await fse.outputJson(argv.output, result, { spaces: 2 });

  process.stdout.write(
    `Git diff (${argv.since}): ${changedFiles.length} files changed\n` +
      `  modified: ${changedFiles.filter((f) => f.status === "modified").length}\n` +
      `  added:    ${changedFiles.filter((f) => f.status === "added").length}\n` +
      `  deleted:  ${changedFiles.filter((f) => f.status === "deleted").length}\n`,
  );

  if (argv.deps) {
    process.stdout.write(
      `Propagation: ${result.affectedFiles.length} files affected across ${result.affectedFolders.length} folders\n` +
        `Reduction: ${result.analysisScope?.reductionRatio || "N/A"}\n`,
    );
  }

  process.stdout.write(`Written to ${argv.output}\n`);
}

const isMainModule =
  process.argv[1]?.endsWith("git-diff.ts") ||
  process.argv[1]?.endsWith("git-diff.js");
if (isMainModule) main();
