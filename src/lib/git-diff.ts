import { simpleGit } from "simple-git";
import type {
  ChangedFile,
  AffectedFile,
  DependencyGraphResult,
} from "../types/index.js";

export async function getGitDiff(
  repoPath: string,
  since: string,
): Promise<ChangedFile[]> {
  const git = simpleGit(repoPath);
  const diffSummary = await git.diffSummary([since]);

  return diffSummary.files.map((file) => {
    let status: ChangedFile["status"] = "modified";

    if (file.binary) {
      status = "modified";
    }

    // simple-git diffSummary uses: number of insertions/deletions to infer status
    // If file is newly added, it appears with insertions only; deleted with deletions only
    // However, diffSummary doesn't directly expose the status, so we check the flags
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

  // Step 1: Add all directly changed files
  for (const file of changedFiles) {
    affectedSet.add(file.path);
  }

  // Build a map from source -> dependents for quick lookup
  const dependentsMap = new Map<string, string[]>();
  for (const module of dependencyGraph.modules) {
    dependentsMap.set(module.source, module.dependents);
  }

  // Step 2: Recursively find all dependents of changed files
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

  // Build result with reason
  const directPaths = new Set(changedFiles.map((f) => f.path));
  const result: AffectedFile[] = [];

  for (const path of affectedSet) {
    if (directPaths.has(path)) {
      const changed = changedFiles.find((f) => f.path === path)!;
      result.push({
        path,
        reason: `Directly ${changed.status}`,
      });
    } else {
      result.push({
        path,
        reason: "Depends on changed file",
      });
    }
  }

  return result;
}
