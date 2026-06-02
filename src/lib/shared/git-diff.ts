import fse from "fs-extra";
import path from "node:path";
import { simpleGit } from "simple-git";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type {
  ChangedFile,
  AffectedFile,
  AffectedIssue,
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

interface IssueFrontmatter {
  id?: string;
  type?: string;
  severity?: string;
  source_files?: string[];
}

export function parseIssueFrontmatter(
  content: string,
): IssueFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const result: IssueFrontmatter = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    let value: unknown = kv[2].trim();
    if (
      typeof value === "string" &&
      value.startsWith("[") &&
      value.endsWith("]")
    ) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
    }
    (result as Record<string, unknown>)[key] = value;
  }
  return result;
}

/**
 * Reverse-lookup: scan all Issue Markdown files and match their source_files
 * against the affected file set after dependency propagation.
 *
 * Issues whose source_files intersect with affectedFiles are marked for recheck.
 * Issues referencing deleted files are marked as stale.
 */
export async function computeAffectedIssues(
  affectedFiles: AffectedFile[],
  changedFiles: ChangedFile[],
  issuesPath: string,
): Promise<AffectedIssue[]> {
  const { globby } = await import("globby");

  const issueFiles = await globby("**/IS-*.md", {
    cwd: issuesPath,
    onlyFiles: true,
  });

  if (issueFiles.length === 0) return [];

  const affectedFilePaths = new Set(affectedFiles.map((f) => f.path));
  const deletedFilePaths = new Set(
    changedFiles.filter((f) => f.status === "deleted").map((f) => f.path),
  );

  const results: AffectedIssue[] = [];

  for (const relPath of issueFiles) {
    const fullPath = path.join(issuesPath, relPath);
    const content = await fse.readFile(fullPath, "utf-8");
    const fm = parseIssueFrontmatter(content);

    if (!fm || !fm.source_files || fm.source_files.length === 0) continue;

    // Match: any source_file is in the affected set
    const matchedFiles = fm.source_files.filter((sf) =>
      affectedFilePaths.has(sf),
    );
    const matchedDeleted = fm.source_files.filter((sf) =>
      deletedFilePaths.has(sf),
    );

    let action: AffectedIssue["action"] = "unchanged";
    let reason = "No source files affected";

    if (matchedFiles.length > 0 && matchedDeleted.length > 0) {
      action = "stale";
      reason = `${matchedDeleted.length} source file(s) deleted, ${matchedFiles.length} source file(s) modified`;
    } else if (matchedFiles.length > 0) {
      action = "recheck";
      reason = `${matchedFiles.length} source file(s) modified`;
    }

    if (action !== "unchanged") {
      results.push({
        id: fm.id || path.basename(relPath, ".md"),
        path: relPath,
        type: fm.type,
        severity: fm.severity,
        reason,
        action,
        matchedSourceFiles: [...matchedFiles, ...matchedDeleted],
      });
    }
  }

  return results;
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
    .option("issues-path", {
      type: "string",
      description: "Path to wiki/volume-2-issues/ for reverse Issue lookup",
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

  // Reverse Issue lookup: find Issues whose source_files were affected
  if (argv.issuesPath && changedFiles.length > 0) {
    const affectedIssues = await computeAffectedIssues(
      result.affectedFiles.length > 0
        ? result.affectedFiles
        : changedFiles.map((f) => ({
            path: f.path,
            reason: `Directly ${f.status}`,
          })),
      changedFiles,
      argv.issuesPath,
    );
    result.affectedIssues = affectedIssues;
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

  if (result.affectedIssues && result.affectedIssues.length > 0) {
    process.stdout.write(
      `Issues affected: ${result.affectedIssues.length} (${result.affectedIssues.filter((i) => i.action === "recheck").length} recheck, ${result.affectedIssues.filter((i) => i.action === "stale").length} stale)\n`,
    );
  }

  process.stdout.write(`Written to ${argv.output}\n`);
}

const isMainModule =
  process.argv[1]?.endsWith("git-diff.ts") ||
  process.argv[1]?.endsWith("git-diff.js");
if (isMainModule) main();
