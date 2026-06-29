#!/usr/bin/env npx tsx
/**
 * AgenticWiki Unified Pipeline Runner
 *
 * 替代 Agent 手工编排 7 个阶段、28 个脚本、10 个 SKILL.md 的复杂流程。
 * Agent 只需关注 GEN 阶段的 SubAgent 调度，其余全部自动化。
 *
 * 职责：CLI 入口 → 解析参数 → 解析路径 → 按 DAG 顺序执行阶段 → 更新状态。
 * 所有逻辑细节已拆分为 src/lib/ 下的独立模块。
 *
 * Usage:
 *   npx tsx src/runner.ts --project /path/to/target
 *   npx tsx src/runner.ts --project /path/to/target --resume
 *   npx tsx src/runner.ts --project /path/to/target --mode incremental --since HEAD~1
 */

import { execSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import type {
  DependencyGraphResult,
  FolderStrategyResult,
  ChangedFile,
} from "./types/index.js";
import {
  parseArgs,
  resolvePaths,
  validatePathRules,
} from "./lib/pipeline/path-resolver.js";
import { runScript } from "./lib/pipeline/script-runner.js";
import {
  loadState,
  saveStatePhase,
  isPhaseCompleted,
  getCurrentPhase,
  initializeState,
} from "./lib/pipeline/state-utils.js";
import {
  getPhaseDefinition,
  DAG_ORDER,
  computePhaseRange,
} from "./lib/pipeline/phase-definitions.js";
import {
  outputGenPrompts,
  injectFeedbackIntoPrompts,
  recordFailure,
  propagateDeps,
  markAffectedGenTasks,
  markAffectedGenTasksByIndex,
} from "./lib/pipeline/gen-helpers.js";
import { ensureDirectories, ensureFeedbackSeed } from "./lib/pipeline/setup.js";
import { buildFileTaskIndex } from "./lib/dependency/build-file-task-index.js";
import { computeAffectedIssues } from "./lib/shared/git-diff.js";
import { markIssuesStale } from "./lib/shared/issue-status.js";
import { computeAffectedExperience } from "./lib/experience/extract-experience.js";
import { markExperienceStale } from "./lib/experience/assemble-experience.js";

// ─── Cleanup Registry ────────────────────────────────────────────
let _tmpFilesToClean: string[] = [];
function cleanupTempFiles(_exitCode = 1): void {
  for (const file of _tmpFilesToClean) {
    try {
      if (fs.existsSync(file)) fs.removeSync(file);
    } catch {
      /* best-effort */
    }
  }
  _tmpFilesToClean = [];
}

process.on("SIGINT", () => {
  console.warn("\n⛔ 收到 SIGINT，清理临时文件后退出...");
  cleanupTempFiles();
  process.exit(130);
});
process.on("SIGTERM", () => {
  console.warn("\n⛔ 收到 SIGTERM，清理临时文件后退出...");
  cleanupTempFiles();
  process.exit(143);
});
process.on("uncaughtException", (err) => {
  console.error("\n❌ 未捕获异常:", err.message?.slice(0, 200));
  cleanupTempFiles();
  process.exit(1);
});

// ─── Main Runner ─────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const paths = resolvePaths(args.project, args.source);

  console.log("═".repeat(60));
  console.log("AgenticWiki Unified Pipeline Runner");
  console.log("═".repeat(60));
  console.log(`  目标项目:     ${paths.projectRoot}`);
  if (args.source)
    console.log(
      `  源码目录:     ${paths.sourceRoot} (--source ${args.source})`,
    );
  else console.log(`  源码目录:     ${paths.sourceRoot}`);
  console.log(`  Wiki 输出:    ${paths.wikiRoot}`);
  console.log(`  缓存目录:     ${paths.cacheRoot}`);
  if (args.source) console.log(`  数据根目录:   ${paths.dataRoot}`);
  console.log(`  模式:         ${args.mode}`);
  if (args.tokenLimit && args.tokenLimit > 0)
    console.log(`  GEN Token 上限: ${args.tokenLimit.toLocaleString()}`);
  else if (args.limit) console.log(`  GEN 批量:     ${args.limit}`);
  console.log("═".repeat(60));
  console.log("");

  validatePathRules(paths);
  ensureDirectories(paths);

  let state = loadState(paths.statePath);
  if (!state) {
    console.log("🆕 首次运行，初始化项目...\n");
    state = initializeState(paths, args);
    ensureFeedbackSeed(paths.dataRoot);
    console.log("  ✅ state.json 已创建");
    console.log(`  ✅ 当前阶段: ${state.currentPhase}\n`);
  } else if (args.force) {
    console.log("🔄 --force: 清除已有状态，从 INIT 重新开始...\n");
    fs.removeSync(paths.statePath);
    state = initializeState(paths, args);
    console.log("  ✅ state.json 已重建");
    console.log(`  ✅ 当前阶段: ${state.currentPhase}\n`);
  } else {
    console.log(`📂 已存在状态文件: ${paths.statePath}`);
    console.log(`  当前阶段: ${state.currentPhase}\n`);
  }

  // ─── Incremental Mode ──────────────────────────────────────────────
  if (args.mode === "incremental") {
    if (!args.since) {
      console.error("❌ 增量模式需要 --since 参数");
      process.exit(1);
    }
    if (!state) {
      console.error("❌ 增量模式需要已有全量分析结果，请先运行模式 A");
      process.exit(1);
    }

    console.log(`🔍 增量模式：检测 ${args.since}...HEAD 的变更...\n`);
    // Use --name-status to capture add/modify/delete for Issue stale detection
    const gitCmd = `git -C "${paths.projectRoot}" diff --name-status ${args.since}...HEAD`;
    /** Repo-root-relative paths (e.g. "src/foo.ts") — for display & filtering. */
    const changedFiles: string[] = [];
    /** ChangedFile entries with status — for Issue stale detection. */
    const changedFilesWithStatus: ChangedFile[] = [];
    try {
      const output = execSync(gitCmd, { encoding: "utf-8", timeout: 30_000 });
      for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Format: "<status>\t<path>" or "<status>\t<old>\t<new>" for renames
        const parts = trimmed.split("\t");
        const statusChar = parts[0];
        const filePath = parts[parts.length - 1]; // last segment for renames
        if (!filePath) continue;
        changedFiles.push(filePath);
        let status: ChangedFile["status"] = "modified";
        if (statusChar === "A") status = "added";
        else if (statusChar === "D") status = "deleted";
        changedFilesWithStatus.push({ path: filePath, status });
      }
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error
          ? (err as Record<string, unknown>).message
          : String(err);
      console.error(`  ❌ Git diff 失败: ${String(errMsg).slice(0, 200)}`);
      process.exit(1);
    }

    if (changedFiles.length === 0) {
      console.log("✅ 没有文件变更，Wiki 已是最新。");
      return;
    }
    console.log(`  变更文件: ${changedFiles.length} 个`);

    const sourceExts = /\.(ts|tsx|js|jsx)$/;
    const sourceChanged = changedFiles.filter(
      (f: string) => sourceExts.test(f) && !f.includes("node_modules"),
    );
    if (sourceChanged.length === 0) {
      console.log("✅ 源代码无变更，Wiki 已是最新。");
      return;
    }
    console.log(`  源代码变更: ${sourceChanged.length} 个`);
    for (const f of sourceChanged.slice(0, 5)) console.log(`    - ${f}`);
    if (sourceChanged.length > 5)
      console.log(`    ... 还有 ${sourceChanged.length - 5} 个`);

    const depsPath = path.join(paths.cacheRoot, "dependency-graph.json");
    if (!fs.existsSync(depsPath)) {
      console.error("❌ 依赖图不存在，增量模式需要完整的全量分析结果");
      process.exit(1);
    }
    const depGraph = fs.readJsonSync(depsPath) as DependencyGraphResult;

    // BUG-7 fix: git diff 输出相对 projectRoot 的路径（如 "packages/muya/src/foo.ts"），
    // 但 depGraph 的 mod.source 是 sourceRoot-relative（如 "foo.ts"）。
    // 需剥离 sourceRoot 相对 projectRoot 的前缀，否则 propagateDeps 的
    // moduleMap.get(file) 永远 undefined，依赖传播静默失效。
    const sourcePrefix = path.relative(paths.projectRoot, paths.sourceRoot);
    const sourceChangedRel = sourceChanged
      .filter((f: string) => {
        // Monorepo: f = "packages/muya/src/foo.ts", prefix = "packages/muya/src"
        // Normal:    f = "src/foo.ts",              prefix = "src"
        return (
          sourcePrefix === "" ||
          f === sourcePrefix ||
          f.startsWith(sourcePrefix + "/") ||
          f.startsWith(sourcePrefix + "\\")
        );
      })
      .map((f: string) => {
        if (sourcePrefix === "") return f;
        // 剥离前缀及分隔符
        return f.slice(sourcePrefix.length).replace(/^[\\/]/, "");
      });

    const affectedFiles = propagateDeps(sourceChangedRel, depGraph);
    console.log(`  影响范围: ${affectedFiles.size} 个文件（含依赖传播）`);

    const clustersPath = path.join(paths.cacheRoot, "task-clusters.json");
    const strategyPath = path.join(paths.cacheRoot, "folder-strategy.json");

    let updated = 0;
    const schedulerArgs: string[] = [];

    if (fs.existsSync(clustersPath)) {
      // Cluster mode: build file-task index and mark affected by index
      const clusterResult = fs.readJsonSync(clustersPath);
      const fileTaskIndex = buildFileTaskIndex(undefined, clusterResult);
      updated = markAffectedGenTasksByIndex(
        paths.statePath,
        affectedFiles,
        fileTaskIndex,
      );
      schedulerArgs.push("--clusters", clustersPath);
    } else if (fs.existsSync(strategyPath)) {
      // Folder-strategy mode (legacy fallback)
      const folderStrategy = fs.readJsonSync(
        strategyPath,
      ) as FolderStrategyResult;
      updated = markAffectedGenTasks(
        paths.statePath,
        affectedFiles,
        folderStrategy,
      );
      schedulerArgs.push("--strategy", strategyPath);
    } else {
      console.error("❌ 未找到 task-clusters.json 或 folder-strategy.json");
      process.exit(1);
    }

    if (updated === 0) {
      console.log("✅ 受影响文件夹的 Wiki 章节已全部完成，无需更新。");
      return;
    }
    console.log(`  🔄 重置了 ${updated} 个 GEN 任务状态为 pending\n`);

    // ─── BUG-11 修复：更新 Issue 状态（stale/recheck）──────────────
    // 源文件变更后，引用这些文件的 Issue 结论可能过时，需标记为 stale
    // 供 ASSEMBLE/VALIDATE 阶段的 validate-issue-content.ts 识别需重验的 Issue。
    const issuesPath = path.join(paths.wikiRoot, "volume-2-issues");
    if (fs.existsSync(issuesPath)) {
      try {
        // 构造 AffectedFile[]：受影响文件（含依赖传播），path 为 sourceRoot-relative
        const affectedFileList = [...affectedFiles].map((f) => ({
          path: f,
          reason: "Affected by incremental change",
        }));
        const affectedIssues = await computeAffectedIssues(
          affectedFileList,
          changedFilesWithStatus,
          issuesPath,
        );
        if (affectedIssues.length > 0) {
          const issueFullPaths = affectedIssues
            .filter((i) => i.action === "stale" || i.action === "recheck")
            .map((i) => path.join(issuesPath, i.path));
          const marked = markIssuesStale(
            issueFullPaths,
            `Source files changed in incremental mode (${args.since}...HEAD)`,
          );
          console.log(
            `  📋 Issue 状态更新: ${marked} 个 Issue 标记为 stale ` +
              `(${affectedIssues.filter((i) => i.action === "stale").length} stale, ` +
              `${affectedIssues.filter((i) => i.action === "recheck").length} recheck)\n`,
          );
        } else {
          console.log("  📋 无受影响的 Issue\n");
        }
      } catch (issueErr: unknown) {
        // Issue 状态更新失败不阻断增量流程（非关键路径）
        const issueErrMsg =
          issueErr instanceof Error ? issueErr.message : String(issueErr);
        console.warn(
          `  ⚠️  Issue 状态更新失败（不阻断）: ${issueErrMsg.slice(0, 200)}\n`,
        );
      }
    }

    // ─── 标记受影响经验模式（stale/orphaned）────────────────────
    const expDir = path.join(paths.wikiRoot, "volume-3-experience");
    if (fs.existsSync(expDir)) {
      try {
        const affectedClusterIds = new Set<string>();
        let allClusterIds = new Set<string>();

        if (fs.existsSync(clustersPath)) {
          const clusters = fs.readJsonSync(clustersPath);
          allClusterIds = new Set(clusters.clusters.map((c: { id: string }) => c.id));
          for (const cluster of clusters.clusters) {
            const hasAffected = cluster.files.some((f: string) => affectedFiles.has(f));
            if (hasAffected) affectedClusterIds.add(cluster.id);
          }
        }

        if (affectedClusterIds.size > 0) {
          const { affected, summary } = computeAffectedExperience(
            expDir,
            affectedClusterIds,
            allClusterIds,
          );
          if (affected.length > 0) {
            const { staleCount, orphanedCount } = await markExperienceStale(
              affected.filter((a) => a.action !== "unchanged"),
              expDir,
            );
            console.log(
              "  📚 经验模式状态更新: " + staleCount + " stale, " + orphanedCount + " orphaned " +
              "(共 " + summary.total + " 个模式, " + summary.unchanged + " 个未变化)\n",
            );
          } else {
            console.log("  📚 无受影响的经验模式\n");
          }
        } else {
          console.log("  📚 无受影响的聚簇，跳过经验模式更新\n");
        }
      } catch (expErr: unknown) {
        const expErrMsg =
          expErr instanceof Error ? expErr.message : String(expErr);
        console.warn(
          "  ⚠️  经验模式状态更新失败（不阻断）: " + expErrMsg.slice(0, 200) + "\n",
        );
      }
    }

    console.log("  📋 重新生成调度清单...");
    runScript(
      "gen/gen-scheduler.ts",
      [
        ...schedulerArgs,
        "--state",
        paths.statePath,
        "--output",
        path.join(paths.cacheRoot, "gen-schedule.json"),
        "--write-state",
        "--resume",
        "--limit",
        String(args.limit ?? 5),
      ],
      paths.libDir,
      paths.projectRoot,
    );

    console.log("");
    outputGenPrompts(paths, args.limit || 5);
    console.log(
      "\n⏸️  增量模式：已生成受影响文件夹的 SubAgent prompts，runner 暂停。",
    );
    console.log(
      `   SubAgent 完成后运行: npx tsx src/runner.ts --project ${paths.projectRoot} --resume`,
    );
    return;
  }

  // ─── Full / Resume Mode ────────────────────────────────────────────
  let targetPhase: string | null;
  let startPhase: string | null;
  if (args.only) {
    startPhase = args.only;
    targetPhase = args.only;
  } else if (args.to) {
    startPhase = getCurrentPhase(state);
    targetPhase = args.to;
  } else {
    startPhase = getCurrentPhase(state);
    targetPhase = "DONE";
  }

  const phasesToRun = computePhaseRange(startPhase, targetPhase);
  if (phasesToRun.length === 0) {
    console.log("✅ 没有需要执行的阶段。");
    return;
  }

  // ─── BUG-14 修复：前置阶段依赖门控 ────────────────────────────────
  // --only ASSEMBLE 等显式跳过前置阶段时，若 GEN 未完成则产物不完整。
  // 门控阻断并提示用户，除非显式 --skip-deps-check（高级逃生阀）。
  if (!args.skipDepsCheck) {
    const phaseDeps: Record<string, string[]> = {
      ASSEMBLE: ["GEN"],
      VALIDATE: ["ASSEMBLE"],
    };
    for (const phase of phasesToRun) {
      const deps = phaseDeps[phase];
      if (!deps) continue;
      for (const dep of deps) {
        const depInRun = phasesToRun.includes(dep);
        const depCompleted = isPhaseCompleted(state, dep);
        if (!depInRun && !depCompleted) {
          console.error(
            `❌ 阶段 ${phase} 需要先完成前置阶段 ${dep}，但 ${dep} 未完成且不在当前执行计划中。`,
          );
          console.error(
            `   先运行: npx tsx src/runner.ts --project ${paths.projectRoot} --only ${dep}`,
          );
          console.error(
            `   或强制跳过检查（高级用法）: 加 --skip-deps-check`,
          );
          process.exit(1);
        }
      }
    }
  }

  if (
    args.resume &&
    !phasesToRun.includes("GEN") &&
    phasesToRun.includes("ASSEMBLE")
  ) {
    const pendingGenTasks =
      state?.genTasks?.filter((t) => t.status === "pending") ?? [];
    if (pendingGenTasks.length > 0) {
      console.warn(
        `⚠️  检测到 ${pendingGenTasks.length} 个 GEN 子任务仍为 pending 状态，`,
      );
      console.warn(
        `   但当前执行计划缺少 GEN 阶段（startPhase: ${startPhase}）。`,
      );
      console.warn(
        `   建议: npx tsx src/runner.ts --project ${paths.projectRoot} --force`,
      );
      console.log("");
    }
  }

  console.log(`📋 执行计划: ${phasesToRun.join(" → ")}\n`);
  if (args.dryRun) {
    console.log("🔍 DRY RUN — 不实际执行脚本。\n");
    for (const phase of phasesToRun) {
      const def = getPhaseDefinition(phase, paths, args);
      if (!def) continue;
      console.log(`  [${phase}] ${def.label}`);
      for (const s of def.scripts)
        console.log(`    → ${s.name} ${s.args.join(" ")}`);
    }
    return;
  }

  // ─── Execute Phases ────────────────────────────────────────────────
  for (const phase of phasesToRun) {
    const def = getPhaseDefinition(phase, paths, args);
    if (!def) {
      console.log(`⚠️  未知阶段: ${phase}，跳过`);
      continue;
    }
    if (isPhaseCompleted(state, phase) && !args.only) {
      console.log(`✅ [${phase}] 已完成，跳过`);
      continue;
    }

    // Resume handling for GEN
    if (
      phase === "GEN" &&
      args.resume &&
      state?.phaseHistory?.some(
        (r) => r.phase === "GEN" && r.status === "in_progress",
      )
    ) {
      const genPromptsDir = path.join(paths.cacheRoot, "gen-prompts");
      if (fs.existsSync(genPromptsDir)) {
        console.log("  🔄 重新注入最新反馈策略...");
        injectFeedbackIntoPrompts(
          genPromptsDir,
          paths.agenticWikiRoot,
          paths.dataRoot,
        );
      }

      console.log("  🔄 同步已完成 GEN 任务状态...");
      runScript(
        "gen/sync-gen-tasks.ts",
        ["--state", paths.statePath, "--wiki", paths.wikiRoot, "--write"],
        paths.libDir,
        paths.projectRoot,
      );
      console.log("  🔍 验证 SubAgent 产物...");
      const verifyResult = runScript(
        "gen/verify-gen-artifacts.ts",
        [
          "--state",
          paths.statePath,
          "--output",
          path.join(paths.cacheRoot, "gen-verify.json"),
        ],
        paths.libDir,
        paths.projectRoot,
      );
      // 设计缺陷-2 修复：verify-gen-artifacts 的 stdout 被 runScript 的
      // stdio:"pipe" 捕获但未打印。验证失败时打印详细输出供诊断。
      if (!verifyResult.success && verifyResult.output) {
        console.log("  📋 验证报告详情:");
        console.log(
          verifyResult.output
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n"),
        );
      }

      const verifyReportPath = path.join(paths.cacheRoot, "gen-verify.json");
      let tasksMissing = 0,
        mermaidLeaks = 0;
      if (fs.existsSync(verifyReportPath)) {
        try {
          const report = fs.readJsonSync(verifyReportPath);
          tasksMissing = report.summary?.dirsFailed || 0;
          mermaidLeaks = report.summary?.leaksDetected || 0;
        } catch {
          /* ignore */
        }
      }

      const schedulePath = path.join(paths.cacheRoot, "gen-schedule.json");
      let pendingCount = 0;
      if (fs.existsSync(schedulePath)) {
        try {
          const schedule = fs.readJsonSync(schedulePath);
          pendingCount = schedule.summary?.pendingCount ?? 0;
        } catch {
          /* ignore */
        }
      }

      if (pendingCount > 0 || tasksMissing > 0) {
        if (pendingCount > 0)
          console.log(
            `  📋 还有 ${pendingCount} 个 GEN 任务待处理，生成下一批...`,
          );
        if (tasksMissing > 0)
          console.warn(
            `  ⚠️  ${tasksMissing} 个 SubAgent 产物缺失${mermaidLeaks > 0 ? `，${mermaidLeaks} 个 Mermaid 泄露` : ""}`,
          );

        // Auto-reset: if pendingCount == 0 but tasksMissing > 0,
        // automatically reset failed tasks to pending (with retry limit).
        // This replaces the old hard-block that required manual intervention.
        if (pendingCount === 0 && tasksMissing > 0) {
          // BUG-5 fix: 重新读取磁盘 state，避免用陈旧内存覆盖 sync-gen-tasks
          // 刚写入的 completed 状态。sync-gen-tasks --write 已更新磁盘 state.json，
          // 内存中的 state 变量仍是 runner 启动时加载的旧版本。
          state = loadState(paths.statePath) ?? state;

          const MAX_RETRIES = 3;
          let resetCount = 0;
          let failCount = 0;

          // Read verify report to get specific failed task IDs
          let failedTaskIds: string[] = [];
          try {
            const report = fs.readJsonSync(verifyReportPath);
            failedTaskIds = report.tasksNeedingRetry || [];
          } catch {
            // If report can't be read, we can't identify specific tasks
          }

          for (const task of state?.genTasks || []) {
            if (failedTaskIds.length > 0 && !failedTaskIds.includes(task.id)) {
              continue;
            }
            // Only reset tasks that appear to be stuck (completed in state but failed verify)
            if (task.status !== "completed") continue;

            const retryCount = task.retryCount || 0;
            if (retryCount >= MAX_RETRIES) {
              task.status = "failed";
              task.lastError = `超过最大重试次数 (${MAX_RETRIES})`;
              failCount++;
              console.warn(
                `  ⚠️  ${task.id} 已重试 ${retryCount} 次，标记为 failed 并跳过`,
              );
            } else {
              task.status = "pending";
              task.retryCount = retryCount + 1;
              resetCount++;
              console.log(
                `  🔄 ${task.id} 自动重置为 pending（第 ${task.retryCount} 次重试）`,
              );
            }
          }

          // Write updated state back
          if (resetCount > 0 || failCount > 0) {
            fs.writeJsonSync(paths.statePath, state, { spaces: 2 });
          }

          if (resetCount > 0) {
            console.log(
              `  🔧 已重置 ${resetCount} 个任务，重新生成调度清单...`,
            );
          } else if (failCount > 0) {
            console.warn(
              `  ⚠️  有 ${failCount} 个任务超限跳过，但无任务可重置。`,
            );
            console.log(`  ✅ 无待处理 GEN 任务，继续后续阶段...`);
            // Skip gen-scheduler re-run, move to next phase
            continue;
          }
        }

        const genDef = getPhaseDefinition("GEN", paths, args);
        if (genDef) {
          for (const script of genDef.scripts) {
            console.log(`  🔧 ${script.name}...`);
            const result = runScript(
              script.name,
              script.args,
              paths.libDir,
              paths.projectRoot,
              { timeout: script.timeout, maxBuffer: script.maxBuffer },
            );
            if (!result.success) {
              console.error(
                `     ❌ gen-scheduler 失败: ${result.output.slice(0, 300)}`,
              );
              process.exit(1);
            }
            console.log(`     ✅ 完成`);
          }
        }
        saveStatePhase(
          paths.statePath,
          paths.libDir,
          paths.projectRoot,
          phase,
          "in_progress",
          "GEN",
          ["gen-schedule.json"],
          ["gen/gen-scheduler.ts:0", "gen/verify-gen-artifacts.ts:0"],
        );
        console.log("");
        outputGenPrompts(paths, args.limit || 5);
        console.log("\n⏸️  GEN 阶段需要 Agent 操作 SubAgent，runner 暂停。");
        console.log(
          `   SubAgent 完成后运行: npx tsx src/runner.ts --project ${paths.projectRoot} --resume`,
        );
        return;
      }

      console.log(
        `  ✅ 所有 SubAgent 产物验证通过${mermaidLeaks > 0 ? `（${mermaidLeaks} 个 Mermaid 泄露已清理）` : ""}`,
      );
      console.log("  🔧 增量校验 Issue 文件格式...");
      runScript(
        "validate/validate-issue-types.ts",
        [
          "--issues",
          path.join(paths.wikiRoot, "volume-2-issues"),
          "--fix",
          "--output",
          path.join(paths.cacheRoot, "issue-validation-batch.json"),
        ],
        paths.libDir,
        paths.projectRoot,
      );
      saveStatePhase(
        paths.statePath,
        paths.libDir,
        paths.projectRoot,
        phase,
        "completed",
        "ASSEMBLE",
        ["wiki/volume-1-code/", "gen-schedule.json"],
        ["gen/gen-scheduler.ts:0", "gen/verify-gen-artifacts.ts:0"],
      );
      state = loadState(paths.statePath);
      console.log(`  ✅ [GEN] → 下一阶段: ASSEMBLE\n`);
      continue;
    }

    console.log(`━`.repeat(40));
    console.log(`▶️  [${phase}] ${def.label}`);
    console.log(`━`.repeat(40));

    let phaseFailed = false;
    let phaseFailedDetail: string | undefined;
    let phaseFailedScript: string | undefined;
    const executedScripts: string[] = [];
    for (const script of def.scripts) {
      console.log(`  ${script.critical ? "🔧" : "🔩"} ${script.name}...`);
      const result = runScript(
        script.name,
        script.args,
        paths.libDir,
        paths.projectRoot,
        { timeout: script.timeout, maxBuffer: script.maxBuffer },
      );

      if (result.success) {
        console.log(`     ✅ 完成`);
        if (result.output && result.output.length < 500) {
          for (const line of result.output
            .split("\n")
            .filter(Boolean)
            .slice(-3))
            console.log(`     │ ${line}`);
        }
        executedScripts.push(`${script.name}:0`);
      } else {
        const errorPreview = result.output.slice(0, 300);
        if (script.critical) {
          console.error(`     ❌ 失败 (CRITICAL): ${errorPreview}`);
          phaseFailed = true;
          phaseFailedDetail = result.output;
          phaseFailedScript = script.name;
          break;
        } else {
          console.warn(`     ⚠️  失败 (非关键): ${errorPreview}`);
        }
      }
    }

    if (phaseFailed) {
      console.error(`\n❌ [${phase}] 阶段失败，流水线暂停。`);
      console.error(
        `   修复后运行: npx tsx src/runner.ts --project ${paths.projectRoot} --resume`,
      );
      // 记录失败时携带脚本的实际错误输出，而非硬编码消息
      const errSnippet = (phaseFailedDetail || "").slice(0, 500).trim();
      recordFailure(paths, phase, phaseFailedScript || "", errSnippet);
      process.exit(1);
    }

    if (phase === "GEN" && def.requiresAgent) {
      saveStatePhase(
        paths.statePath,
        paths.libDir,
        paths.projectRoot,
        phase,
        "in_progress",
        "GEN",
        ["gen-schedule.json"],
        executedScripts,
      );
      console.log("");
      outputGenPrompts(paths, args.limit || 5);
      console.log("\n⏸️  GEN 阶段需要 Agent 操作 SubAgent，runner 暂停。");
      console.log(
        `   SubAgent 完成后运行: npx tsx src/runner.ts --project ${paths.projectRoot} --resume`,
      );
      return;
    }

    const phaseIdx = DAG_ORDER.indexOf(phase);
    const nextPhase =
      phaseIdx < DAG_ORDER.length - 1 ? DAG_ORDER[phaseIdx + 1] : "DONE";
    const artifacts: string[] = [];
    switch (phase) {
      case "INIT":
        artifacts.push("project-scan.json", "state.json");
        break;
      case "SCAN":
        artifacts.push("file-list.json", "filtered-files.json");
        break;
      case "DEPENDENCY":
        artifacts.push(
          "dependency-graph.json",
          "file-priorities.json",
          "folder-strategy.json",
        );
        break;
      case "ASSEMBLE":
        artifacts.push("wiki/book.md", "wiki/glossary.md", "symbol-index.json");
        break;
      case "VALIDATE":
        artifacts.push("reference-validation.json");
        break;
    }
    saveStatePhase(
      paths.statePath,
      paths.libDir,
      paths.projectRoot,
      phase,
      "completed",
      nextPhase,
      artifacts,
      executedScripts,
    );
    console.log(`  ✅ [${phase}] 阶段完成 → 下一阶段: ${nextPhase}\n`);
    state = loadState(paths.statePath);
  }

  console.log("═".repeat(60));
  console.log("✅ 流水线执行完成！");
  console.log("═".repeat(60));
}

main().catch((err) => {
  console.error("❌ Runner 异常退出:", err.message?.slice(0, 200));
  cleanupTempFiles();
  process.exit(1);
});
