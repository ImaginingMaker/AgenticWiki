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
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import type {
  DependencyGraphResult,
  FolderStrategyResult,
} from "./types/index.js";
import {
  parseArgs,
  resolvePaths,
  validatePathRules,
} from "./lib/path-resolver.js";
import type { RunnerArgs, ResolvedPaths } from "./lib/path-resolver.js";
import { runScript } from "./lib/script-runner.js";
import {
  loadState,
  saveStatePhase,
  isPhaseCompleted,
  getCurrentPhase,
  initializeState,
} from "./lib/state-utils.js";
import { getPhaseDefinition, DAG_ORDER } from "./lib/phase-definitions.js";
import {
  outputGenPrompts,
  injectFeedbackIntoPrompts,
  recordFailure,
  propagateDeps,
  markAffectedGenTasks,
} from "./lib/gen-helpers.js";
import { ensureDirectories, ensureFeedbackSeed } from "./lib/setup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Cleanup Registry ────────────────────────────────────────────
let _tmpFilesToClean: string[] = [];
function registerCleanupPath(filePath: string): void {
  _tmpFilesToClean.push(filePath);
}
function cleanupTempFiles(exitCode = 1): void {
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
    const gitCmd = `git -C "${paths.projectRoot}" diff --name-only ${args.since}...HEAD`;
    let changedFiles: string[] = [];
    try {
      const output = execSync(gitCmd, { encoding: "utf-8", timeout: 30_000 });
      changedFiles = output
        .split("\n")
        .map((f: string) => f.trim())
        .filter(Boolean);
    } catch (err: any) {
      console.error(`  ❌ Git diff 失败: ${err.message?.slice(0, 200)}`);
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
    const affectedFiles = propagateDeps(sourceChanged, depGraph);
    console.log(`  影响范围: ${affectedFiles.size} 个文件（含依赖传播）`);

    const strategyPath = path.join(paths.cacheRoot, "folder-strategy.json");
    if (!fs.existsSync(strategyPath)) {
      console.error("❌ folder-strategy.json 不存在");
      process.exit(1);
    }
    const folderStrategy = fs.readJsonSync(
      strategyPath,
    ) as FolderStrategyResult;
    const updated = markAffectedGenTasks(
      paths.statePath,
      affectedFiles,
      folderStrategy,
    );
    if (updated === 0) {
      console.log("✅ 受影响文件夹的 Wiki 章节已全部完成，无需更新。");
      return;
    }
    console.log(`  🔄 重置了 ${updated} 个 GEN 任务状态为 pending\n`);

    console.log("  📋 重新生成调度清单...");
    runScript(
      "gen-scheduler.ts",
      [
        "--strategy",
        strategyPath,
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
  let targetPhase: string | null = null;
  let startPhase: string | null = null;
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

  const phasesToRun: string[] = [];
  let inRange = false;
  for (const phase of DAG_ORDER) {
    if (phase === startPhase) inRange = true;
    if (inRange) phasesToRun.push(phase);
    if (phase === targetPhase) break;
  }
  if (targetPhase === "DONE") {
    for (const p of ["ASSEMBLE", "VALIDATE"]) {
      if (!phasesToRun.includes(p)) phasesToRun.push(p);
    }
  }
  if (phasesToRun.length === 0) {
    console.log("✅ 没有需要执行的阶段。");
    return;
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
          paths.projectRoot,
        );
      }

      console.log("  🔄 同步已完成 GEN 任务状态...");
      runScript(
        "sync-gen-tasks.ts",
        ["--state", paths.statePath, "--wiki", paths.wikiRoot, "--write"],
        paths.libDir,
        paths.projectRoot,
      );
      console.log("  🔍 验证 SubAgent 产物...");
      runScript(
        "verify-gen-artifacts.ts",
        [
          "--state",
          paths.statePath,
          "--output",
          path.join(paths.cacheRoot, "gen-verify.json"),
        ],
        paths.libDir,
        paths.projectRoot,
      );

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
          ["gen-scheduler.ts:0", "verify-gen-artifacts.ts:0"],
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
        "validate-issue-types.ts",
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
        ["gen-scheduler.ts:0", "verify-gen-artifacts.ts:0"],
      );
      state = loadState(paths.statePath);
      console.log(`  ✅ [GEN] → 下一阶段: ASSEMBLE\n`);
      continue;
    }

    console.log(`━`.repeat(40));
    console.log(`▶️  [${phase}] ${def.label}`);
    console.log(`━`.repeat(40));

    let phaseFailed = false;
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
      recordFailure(paths, phase, "脚本执行返回非零退出码");
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
