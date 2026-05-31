/**
 * Route Check — Phase 1.5 条件路由自动化决策脚本。
 *
 * 替代编排器 Agent 手工读取 3 个 JSON 做 if-else 判断。
 * 每次 Phase 1.5 前运行，输出结构化路由决策供编排器消费。
 *
 * Usage:
 *   npx tsx src/lib/route-check.ts \
 *     --project-scan .agentic-wiki/cache/project-scan.json \
 *     --folder-strategy .agentic-wiki/cache/folder-strategy.json \
 *     --state .agentic-wiki/state.json
 */

import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type {
  ProjectScanResult,
  FolderStrategyResult,
  WikiState,
  Phase,
} from "../types/index.js";

export type RouteDecision =
  | { action: "goto"; phase: Phase; reason: string }
  | { action: "goto_with_warning"; phase: Phase; reason: string; warning: string }
  | { action: "enter_gen"; reason: string; runCount: number; skipCount: number; totalCount: number };

export interface RouteCheckResult {
  checkedAt: string;
  totalFiles: number;
  foldersToAnalyze: number;
  genTasksStatus: {
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
    failed: number;
  };
  decision: RouteDecision;
}

export function computeRoute(
  projectScan: ProjectScanResult,
  folderStrategy: FolderStrategyResult,
  state: WikiState,
): RouteCheckResult {
  const totalFiles = projectScan.totalFiles;
  const foldersToAnalyze = folderStrategy.foldersToAnalyze;
  const genTasks = state.genTasks || [];

  const genTasksStatus = {
    total: genTasks.length,
    completed: genTasks.filter((t) => t.status === "completed").length,
    pending: genTasks.filter((t) => t.status === "pending").length,
    inProgress: genTasks.filter((t) => t.status === "in_progress").length,
    failed: genTasks.filter((t) => t.status === "failed").length,
  };

  let decision: RouteDecision;

  if (totalFiles === 0) {
    decision = {
      action: "goto",
      phase: "DONE",
      reason: "空项目：project-scan 无文件",
    };
  } else if (foldersToAnalyze === 0) {
    decision = {
      action: "goto_with_warning",
      phase: "DONE",
      reason: "有文件但无文件夹待分析",
      warning: "folder-strategy.json.foldersToAnalyze === 0，所有文件可能被过滤或项目结构无法分析",
    };
  } else if (
    genTasks.length > 0 &&
    genTasksStatus.completed === genTasks.length &&
    genTasksStatus.failed === 0
  ) {
    decision = {
      action: "goto",
      phase: "ASSEMBLE",
      reason: `全部 ${genTasks.length} 个 genTasks 已完成，跳过 GEN`,
    };
  } else {
    const runCount =
      genTasksStatus.pending + genTasksStatus.inProgress + genTasksStatus.failed;
    decision = {
      action: "enter_gen",
      reason:
        runCount > 0
          ? `${runCount} 个子任务待执行（${genTasksStatus.completed} 已完成）`
          : `无 genTasks 记录，全量执行`,
      runCount: runCount || foldersToAnalyze,
      skipCount: genTasksStatus.completed,
      totalCount: genTasks.length || foldersToAnalyze,
    };
  }

  return {
    checkedAt: new Date().toISOString(),
    totalFiles,
    foldersToAnalyze,
    genTasksStatus,
    decision,
  };
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("project-scan", {
      type: "string",
      demandOption: true,
      description: "Path to project-scan.json",
    })
    .option("folder-strategy", {
      type: "string",
      demandOption: true,
      description: "Path to folder-strategy.json",
    })
    .option("state", {
      type: "string",
      demandOption: true,
      description: "Path to state.json",
    })
    .parseSync();

  const projectScan: ProjectScanResult = await fs.readJson(argv["project-scan"]);
  const folderStrategy: FolderStrategyResult = await fs.readJson(
    argv["folder-strategy"],
  );
  const state: WikiState = await fs.readJson(argv.state);

  const result = computeRoute(projectScan, folderStrategy, state);

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

const isMainModule =
  process.argv[1]?.endsWith("route-check.ts") ||
  process.argv[1]?.endsWith("route-check.js");
if (isMainModule) main();
