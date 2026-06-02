/**
 * GEN phase helpers — prompt output, feedback injection, incremental mode.
 *
 * Responsibilities:
 *   - Output SubAgent prompt listing (outputGenPrompts)
 *   - Inject feedback strategies into prompts (injectFeedbackIntoPrompts)
 *   - Record phase failures to prompts.md (recordFailure)
 *   - BFS dependency propagation (propagateDeps)
 *   - Mark affected genTasks in state (markAffectedGenTasks)
 *
 * Usage:
 *   import { outputGenPrompts, injectFeedbackIntoPrompts, recordFailure } from "./gen-helpers.js";
 */

import path from "node:path";
import fs from "fs-extra";
import { execSync } from "node:child_process";
import type { ResolvedPaths } from "./path-resolver.js";
import type {
  DependencyGraphResult,
  FolderStrategyResult,
  ModuleInfo,
} from "../types/index.js";
import type { WikiState } from "./state-utils.js";

// ─── GEN Prompt Output ───────────────────────────────────────────────

export function outputGenPrompts(
  paths: ResolvedPaths,
  limit: number = 5,
): void {
  const schedulePath = path.join(paths.cacheRoot, "gen-schedule.json");
  if (!fs.existsSync(schedulePath)) {
    console.error("  ❌ gen-schedule.json 不存在，无法生成 SubAgent prompts");
    return;
  }

  const schedule = fs.readJsonSync(schedulePath);
  const toRun = schedule.schedule || [];
  const skipped = schedule.skip || [];
  const summary = schedule.summary || {};

  console.log("─".repeat(60));
  console.log("🎯 GEN 阶段：SubAgent 调度清单");
  console.log("─".repeat(60));
  console.log(`  总计:   ${summary.totalSubTasks || "?"} 个子任务`);
  console.log(`  待执行: ${toRun.length} 个`);
  console.log(`  已跳过: ${skipped.length} 个`);
  console.log(
    `  预估 Token: ${summary.totalEstimatedTokens?.toLocaleString() || "?"}`,
  );
  console.log("─".repeat(60));

  if (toRun.length === 0) {
    console.log("\n✅ 所有 GEN 任务已完成，可直接进入 ASSEMBLE 阶段。");
    console.log(
      `   运行: npx tsx src/runner.ts --project ${paths.projectRoot} --only ASSEMBLE`,
    );
    return;
  }

  const genPromptsDir = path.join(paths.cacheRoot, "gen-prompts");
  if (!fs.existsSync(genPromptsDir)) {
    console.error(`  ❌ gen-prompts 目录不存在: ${genPromptsDir}`);
    return;
  }

  injectFeedbackIntoPrompts(
    genPromptsDir,
    paths.agenticWikiRoot,
    paths.projectRoot,
  );

  console.log(`\n📝 SubAgent Prompts 已输出到: ${genPromptsDir}/`);
  console.log(`   共 ${toRun.length} 个 prompt 文件。`);
  console.log(`\n🔴 Agent 下一步操作：`);
  console.log(`   1. 依次读取 ${genPromptsDir}/ 下的 prompt 文件`);
  console.log(
    `   2. 使用 spawn_agent 工具启动 SubAgent（每次 ${limit || toRun.length} 个并发）`,
  );
  console.log(`   3. SubAgent 全部完成后，运行:`);
  console.log(
    `      npx tsx src/runner.ts --project ${paths.projectRoot} --resume`,
  );
  console.log("─".repeat(60));

  if (toRun.length > 0) {
    const first = toRun[0];
    console.log(
      `\n📋 首个 SubAgent: ${first.id} (${first.label || first.folder})`,
    );
    console.log(`   Prompt 文件: ${genPromptsDir}/${first.id}.md`);
    console.log(
      `   预估 Token: ${first.estimatedTokens?.toLocaleString() || "?"}`,
    );
  }
}

// ─── Feedback Injection ───────────────────────────────────────────────

export function injectFeedbackIntoPrompts(
  promptsDir: string,
  agenticWikiRoot: string,
  projectRoot: string,
  mode: "append" | "replace" = "append",
): void {
  if (!fs.existsSync(promptsDir)) {
    console.warn("  ⚠️  prompts 目录不存在，跳过反馈注入");
    return;
  }

  let globalFeedback = "";
  const globalPath = path.join(
    agenticWikiRoot,
    "docs",
    "feedback",
    "global-strategies.md",
  );
  if (fs.existsSync(globalPath)) {
    globalFeedback = fs.readFileSync(globalPath, "utf-8");
  }

  const projectFeedbackPath = path.join(
    projectRoot,
    ".agentic-wiki",
    "feedback",
    "prompts.md",
  );
  let projectFeedback = "";
  if (fs.existsSync(projectFeedbackPath)) {
    projectFeedback = fs.readFileSync(projectFeedbackPath, "utf-8");
  } else {
    console.warn("  ⚠️  prompts.md 缺失，项目级反馈策略为空（首次运行正常）");
  }

  const INJECTION_SENTINEL = "AGENTICWIKI_FEEDBACK_INJECTED";
  const injectionBlock = [
    "",
    "---",
    "",
    `<!-- ${INJECTION_SENTINEL} -->`,
    "",
    "## 🔴 历史反馈与改进策略（Runner 自动注入，必须遵守）",
    "",
  ];
  if (globalFeedback)
    injectionBlock.push("### 全局策略（跨项目通用）", "", globalFeedback, "");
  if (projectFeedback)
    injectionBlock.push("### 项目策略（本项目专属）", "", projectFeedback, "");
  injectionBlock.push(
    "> 以上策略来自历史验证失败的根因分析。必须在本次执行中应用。",
    "",
  );

  const injection = injectionBlock.join("\n");
  const promptFiles = fs
    .readdirSync(promptsDir)
    .filter((f) => f.endsWith(".md"));

  let injectedCount = 0;
  let replacedCount = 0;
  for (const file of promptFiles) {
    const filePath = path.join(promptsDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const hasSentinel = content.includes(INJECTION_SENTINEL);

    if (hasSentinel && mode === "replace") {
      const marker = `<!-- ${INJECTION_SENTINEL} -->`;
      const idx = content.indexOf(marker);
      if (idx !== -1) {
        const before = content.slice(0, idx).replace(/[\s\n]+$/, "");
        fs.writeFileSync(filePath, before + "\n\n" + injection, "utf-8");
        replacedCount++;
      }
    } else if (!hasSentinel) {
      fs.appendFileSync(filePath, injection, "utf-8");
      injectedCount++;
    }
  }

  if (replacedCount > 0)
    console.log(
      `  🔄 反馈策略已更新 ${replacedCount}/${promptFiles.length} 个 SubAgent prompt`,
    );
  if (injectedCount > 0)
    console.log(
      `  🔄 反馈策略已注入 ${injectedCount}/${promptFiles.length} 个 SubAgent prompt`,
    );
  if (globalFeedback) console.log("  📥 全局策略: 已加载");
  if (projectFeedback) console.log("  📥 项目策略: 已加载");
}

// ─── Failure Recording ───────────────────────────────────────────────

/** 阶段 → 改进建议模板 */
const PHASE_IMPROVEMENT_HINTS: Record<string, string> = {
  INIT: "检查项目路径是否正确、package.json 是否可读、tsconfig.json 是否存在",
  SCAN: "检查源码目录是否存在、扩展名白名单是否覆盖了项目文件类型",
  DEPENDENCY:
    "检查 dependency-cruiser 是否安装、--max-buffer / --timeout 是否足够",
  GEN: "检查 folder-strategy.json / task-clusters.json 是否存在、state.json 是否损坏",
  ASSEMBLE: "检查 SubAgent 产物的 Frontmatter 格式、wiki 目录完整性",
  VALIDATE: "检查验证脚本的输入文件是否齐全、引用路径是否正确",
};

export function recordFailure(
  paths: ResolvedPaths,
  phase: string,
  scriptName: string,
  errorDetail: string,
): void {
  const stateManagerPath = path.join(
    paths.libDir,
    "shared",
    "state-manager.ts",
  );

  const improvement =
    PHASE_IMPROVEMENT_HINTS[phase] || "检查脚本参数与输入文件完整性";

  const firstLine = errorDetail.split("\n")[0]?.slice(0, 200) || "未知错误";
  const message = [
    `**触发**: ${phase} 阶段 — ${scriptName} 执行失败`,
    `**问题**: ${firstLine}`,
    `**错误详情**:`,
    "```",
    errorDetail.slice(0, 800),
    "```",
    `**改进**: ${improvement}`,
  ].join("\n");

  const cmd = [
    `npx tsx "${stateManagerPath}" append-feedback`,
    `--state "${paths.statePath}"`,
    `--phase "${phase}"`,
    `--message "${message.replace(/"/g, '\\"')}"`,
  ].join(" ");

  try {
    execSync(cmd, {
      cwd: paths.projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 15_000,
    });
    console.log("  📝 失败原因已记录到 prompts.md");
  } catch {
    const promptsPath = path.join(
      paths.projectRoot,
      ".agentic-wiki",
      "feedback",
      "prompts.md",
    );
    const entry = [
      "",
      "---",
      "",
      `### aw-${phase.toLowerCase()} 改进 (${new Date().toISOString()})`,
      "",
      `**触发**: ${phase} 阶段执行失败`,
      `**问题**: ${errorDetail.slice(0, 500)}`,
      `**改进**: 检查脚本参数与输入文件完整性`,
      "",
    ].join("\n");
    try {
      fs.appendFileSync(promptsPath, entry, "utf-8");
    } catch {
      /* best-effort */
    }
  }
}

// ─── Incremental Mode ─────────────────────────────────────────────────

export function propagateDeps(
  changedFiles: string[],
  depGraph: DependencyGraphResult,
): Set<string> {
  const affected = new Set(changedFiles);
  const queue = [...changedFiles];
  const moduleMap = new Map<string, ModuleInfo>();
  for (const mod of depGraph.modules) moduleMap.set(mod.source, mod);

  while (queue.length > 0) {
    const file = queue.shift()!;
    const mod = moduleMap.get(file);
    if (!mod) continue;
    for (const dependent of mod.dependents) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return affected;
}

export function markAffectedGenTasks(
  statePath: string,
  affectedFiles: Set<string>,
  folderStrategy: FolderStrategyResult,
): number {
  const state = fs.readJsonSync(statePath) as WikiState;
  if (!state.genTasks || state.genTasks.length === 0) return 0;

  const affectedFolders = new Set<string>();
  for (const folder of folderStrategy.folders) {
    for (const subTask of folder.subTasks || []) {
      if (subTask.files.some((f) => affectedFiles.has(f))) {
        affectedFolders.add(folder.path);
        break;
      }
    }
  }

  if (folderStrategy.crossFolderMerges) {
    for (const merge of folderStrategy.crossFolderMerges) {
      if (merge.folders.some((f) => affectedFolders.has(f))) {
        for (const f of merge.folders) affectedFolders.add(f);
      }
    }
  }

  let updated = 0;
  for (const task of state.genTasks) {
    if (affectedFolders.has(task.folder) && task.status !== "in_progress") {
      task.status = "pending";
      updated++;
    }
  }

  if (updated > 0) fs.writeJsonSync(statePath, state, { spaces: 2 });
  return updated;
}
