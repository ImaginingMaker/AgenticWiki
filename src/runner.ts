#!/usr/bin/env npx tsx
/**
 * AgenticWiki Unified Pipeline Runner
 *
 * 替代 Agent 手工编排 7 个阶段、28 个脚本、10 个 SKILL.md 的复杂流程。
 * Agent 只需关注 GEN 阶段的 SubAgent 调度，其余全部自动化。
 *
 * Usage:
 *   # 完整运行（到 GEN 阶段输出 SubAgent prompts 后暂停）
 *   npx tsx src/runner.ts --project /path/to/target
 *
 *   # 只运行到指定阶段
 *   npx tsx src/runner.ts --project /path/to/target --to DEPENDENCY
 *
 *   # GEN 阶段限制批量大小
 *   npx tsx src/runner.ts --project /path/to/target --limit 5
 *
 *   # 断点续跑（SubAgent 完成后继续 ASSEMBLE→VALIDATE→DONE）
 *   npx tsx src/runner.ts --project /path/to/target --resume
 *
 *   # 单阶段执行
 *   npx tsx src/runner.ts --project /path/to/target --only GEN
 *
 *   # 增量模式
 *   npx tsx src/runner.ts --project /path/to/target --mode incremental --since HEAD~1
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import { execSync, ExecSyncOptions } from "node:child_process";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Types ──────────────────────────────────────────────────────────

interface RunnerArgs {
  project: string;
  to?: string;
  only?: string;
  resume: boolean;
  limit?: number;
  mode: "full" | "incremental" | "single-folder";
  since?: string;
  dryRun: boolean;
  force: boolean;
}

interface WikiState {
  schemaVersion: number;
  id: string;
  projectPath: string;
  currentPhase: string;
  phaseHistory: Array<{ phase: string; status: string; completedAt?: string }>;
  genTasks?: Array<{ id: string; status: string }>;
  config: {
    paths: {
      projectRoot: string;
      agenticWikiRoot: string;
      wikiRoot: string;
      sourceRoot: string;
      cacheRoot: string;
    };
  };
  blockers: Array<{ description: string }>;
}

// ─── CLI ────────────────────────────────────────────────────────────

function parseArgs(): RunnerArgs {
  const argv = yargs(hideBin(process.argv))
    .option("project", {
      type: "string",
      demandOption: true,
      description: "目标项目路径（被分析的代码所在项目）",
    })
    .option("to", {
      type: "string",
      description:
        "运行到指定阶段（含）。可选: INIT, SCAN, DEPENDENCY, GEN, ASSEMBLE, VALIDATE, DONE",
    })
    .option("only", {
      type: "string",
      description: "仅运行指定阶段",
    })
    .option("resume", {
      type: "boolean",
      default: false,
      description: "从上次中断的阶段继续",
    })
    .option("limit", {
      type: "number",
      description: "GEN 阶段批量大小（每次调度 N 个文件夹）",
    })
    .option("mode", {
      type: "string",
      choices: ["full", "incremental", "single-folder"] as const,
      default: "full",
      description: "流水线模式",
    })
    .option("since", {
      type: "string",
      description: "增量模式的 Git 基准（如 HEAD~1）",
    })
    .option("dry-run", {
      type: "boolean",
      default: false,
      description: "仅展示将执行的阶段，不实际运行",
    })
    .option("force", {
      type: "boolean",
      default: false,
      description: "清除已有状态，从 INIT 重新开始",
    })
    .parseSync();

  return {
    project: path.resolve(argv.project),
    to: argv.to?.toUpperCase(),
    only: argv.only?.toUpperCase(),
    resume: argv.resume,
    limit: argv.limit,
    mode: argv.mode as "full" | "incremental" | "single-folder",
    since: argv.since,
    dryRun: argv["dry-run"],
    force: argv.force,
  };
}

// ─── Path Resolution ─────────────────────────────────────────────────

interface ResolvedPaths {
  projectRoot: string;
  agenticWikiRoot: string;
  wikiRoot: string;
  sourceRoot: string;
  cacheRoot: string;
  statePath: string;
  libDir: string;
}

function resolvePaths(projectRoot: string): ResolvedPaths {
  // Find AgenticWiki root by searching for package.json with "agentic-wiki" name
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

  const wikiRoot = path.join(projectRoot, "wiki");
  const sourceRoot = path.join(projectRoot, "src");
  const cacheRoot = path.join(projectRoot, ".agentic-wiki", "cache");
  const statePath = path.join(projectRoot, ".agentic-wiki", "state.json");
  const libDir = path.join(awRoot, "src", "lib");

  return {
    projectRoot,
    agenticWikiRoot: awRoot,
    wikiRoot,
    sourceRoot,
    cacheRoot,
    statePath,
    libDir,
  };
}

// ─── Phase Definitions ───────────────────────────────────────────────

interface PhaseScript {
  name: string;
  /** CLI args as an array of strings, ready to pass to execSync */
  args: string[];
  critical: boolean;
}

interface PhaseDef {
  id: string;
  label: string;
  order: number;
  scripts: PhaseScript[];
  /** If true, this phase requires Agent intervention (GEN = spawn SubAgents) */
  requiresAgent: boolean;
}

const DAG_ORDER: string[] = [
  "INIT",
  "SCAN",
  "DEPENDENCY",
  "GEN",
  "ASSEMBLE",
  "VALIDATE",
];

function getPhaseDefinition(
  phase: string,
  paths: ResolvedPaths,
  args: RunnerArgs,
): PhaseDef | null {
  const { libDir, projectRoot, sourceRoot, cacheRoot, wikiRoot, statePath } =
    paths;
  const awRoot = paths.agenticWikiRoot;

  const script = (
    name: string,
    scriptArgs: string[],
    critical = true,
  ): PhaseScript => ({
    name,
    args: scriptArgs,
    critical,
  });

  const define = (
    order: number,
    label: string,
    scripts: PhaseScript[],
    requiresAgent = false,
  ): PhaseDef => ({
    id: phase,
    label,
    order,
    scripts,
    requiresAgent,
  });

  switch (phase) {
    case "INIT":
      return define(0, "项目初始化 + 技术栈识别 + 路径自检", [
        script("scan-project.ts", [
          "--path",
          projectRoot,
          "--output",
          path.join(cacheRoot, "project-scan.json"),
        ]),
        script("compute-hashes.ts", [
          "--path",
          sourceRoot,
          "--output",
          path.join(cacheRoot, "file-hashes.json"),
        ]),
      ]);

    case "SCAN":
      return define(1, "文件扫描 + 样式过滤", [
        script("scan-files.ts", [
          "--path",
          sourceRoot,
          "--output",
          path.join(cacheRoot, "file-list.json"),
        ]),
        script(
          "filter-styles.ts",
          [
            "--input",
            path.join(cacheRoot, "file-list.json"),
            "--output",
            path.join(cacheRoot, "filtered-files.json"),
          ],
          false,
        ),
      ]);

    case "DEPENDENCY":
      return define(2, "依赖图 + 优先级 + 拆分策略 + 子图提取", [
        script("build-deps.ts", [
          "--path",
          sourceRoot,
          "--output",
          path.join(cacheRoot, "dependency-graph.json"),
          "--format",
          "json",
        ]),
        script(
          "build-deps.ts",
          [
            "--path",
            sourceRoot,
            "--output",
            path.join(cacheRoot, "dependency-graph.mmd"),
            "--format",
            "mermaid",
          ],
          false,
        ),
        script("file-priorities.ts", [
          "--files",
          path.join(cacheRoot, "file-list.json"),
          "--deps",
          path.join(cacheRoot, "dependency-graph.json"),
          "--output",
          path.join(cacheRoot, "file-priorities.json"),
        ]),
        script("analyze-folders.ts", [
          "--input",
          path.join(cacheRoot, "file-priorities.json"),
          "--output",
          path.join(cacheRoot, "folder-strategy.json"),
        ]),
        script("extract-subgraph.ts", [
          "--deps",
          path.join(cacheRoot, "dependency-graph.json"),
          "--all",
          "--strategy",
          path.join(cacheRoot, "folder-strategy.json"),
          "--output-dir",
          path.join(cacheRoot, "deps"),
        ]),
      ]);

    case "GEN":
      // GEN phase has two sub-steps: schedule + output prompts
      // The actual SubAgent spawning is done by the Agent after reading prompts
      const genArgs: string[] = [
        "--strategy",
        path.join(cacheRoot, "folder-strategy.json"),
        "--state",
        statePath,
        "--output",
        path.join(cacheRoot, "gen-schedule.json"),
        "--write-state",
      ];
      if (args.limit) {
        genArgs.push("--limit", String(args.limit));
      }
      return define(
        3,
        "GEN 调度 + SubAgent Prompt 生成",
        [script("gen-scheduler.ts", genArgs)],
        true,
      );

    case "ASSEMBLE":
      return define(4, "符号索引 + Issue 仪表盘 + 组装成书", [
        script("sync-gen-tasks.ts", [
          "--state",
          statePath,
          "--wiki",
          wikiRoot,
          "--write",
        ]),
        script("progress-dashboard.ts", [
          "--state",
          statePath,
          "--strategy",
          path.join(cacheRoot, "folder-strategy.json"),
          "--output",
          path.join(wikiRoot, "PROGRESS.md"),
        ]),
        script("symbol-index.ts", [
          "--wiki",
          wikiRoot,
          "--output",
          path.join(cacheRoot, "..", "search", "symbol-index.json"),
        ]),
        script("fix-issue-paths.ts", ["--wiki", wikiRoot, "--apply"], false),
        script(
          "issue-dashboard.ts",
          [
            "--issues",
            path.join(wikiRoot, "volume-2-issues"),
            "--output",
            path.join(wikiRoot, "issues.md"),
          ],
          false,
        ),
        script("validate-issue-types.ts", [
          "--issues",
          path.join(wikiRoot, "volume-2-issues"),
          "--output",
          path.join(cacheRoot, "issue-validation.json"),
        ]),
        script(
          "validate-issue-content.ts",
          [
            "--issues",
            path.join(wikiRoot, "volume-2-issues"),
            "--source",
            sourceRoot,
            "--deps",
            path.join(cacheRoot, "dependency-graph.json"),
            "--output",
            path.join(cacheRoot, "issue-content-validation.json"),
          ],
          false,
        ),
        script("assemble-book.ts", [
          "--wiki",
          wikiRoot,
          "--strategy",
          path.join(cacheRoot, "folder-strategy.json"),
        ]),
      ]);

    case "VALIDATE":
      return define(5, "交叉引用验证 + 源码引用校验", [
        script("validate-references.ts", [
          "--wiki",
          wikiRoot,
          "--output",
          path.join(cacheRoot, "reference-validation.json"),
        ]),
        script(
          "validate-code-refs.ts",
          [
            "--wiki",
            wikiRoot,
            "--source",
            sourceRoot,
            "--deps",
            path.join(cacheRoot, "dependency-graph.json"),
            "--output",
            path.join(cacheRoot, "code-ref-validation.json"),
          ],
          false,
        ),
      ]);

    default:
      return null;
  }
}

// ─── Script Execution ────────────────────────────────────────────────

function runScript(
  scriptName: string,
  args: string[],
  libDir: string,
  cwd: string,
): { success: boolean; output: string } {
  const scriptPath = path.join(libDir, scriptName);
  const cmd = `npx tsx "${scriptPath}" ${args.join(" ")}`;

  try {
    const opts: ExecSyncOptions = {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 120_000, // 2 min timeout per script
      maxBuffer: 50 * 1024 * 1024, // 50MB
    };
    const output = execSync(cmd, opts);
    return { success: true, output: String(output).trim() };
  } catch (err: any) {
    const stderr = err.stderr?.toString() || err.message || "Unknown error";
    return { success: false, output: stderr.trim() };
  }
}

// ─── State Management ────────────────────────────────────────────────

function loadState(statePath: string): WikiState | null {
  if (!fs.existsSync(statePath)) return null;
  return fs.readJsonSync(statePath) as WikiState;
}

function saveStatePhase(
  statePath: string,
  libDir: string,
  cwd: string,
  phase: string,
  status: string,
  nextPhase: string,
  artifacts: string[],
  scripts: string[],
): void {
  const stateManagerPath = path.join(libDir, "state-manager.ts");
  const artifactsStr = artifacts.join(",");
  const scriptsStr = scripts.join(",");

  const cmd = [
    `npx tsx "${stateManagerPath}" transition`,
    `--state "${statePath}"`,
    `--phase ${phase}`,
    `--status ${status}`,
    `--next-phase ${nextPhase}`,
    `--artifacts "${artifactsStr}"`,
    `--scripts "${scriptsStr}"`,
    `--gate`,
  ].join(" ");

  try {
    execSync(cmd, { cwd, encoding: "utf-8", stdio: "pipe", timeout: 30_000 });
  } catch (err: any) {
    console.warn(
      `  ⚠️  状态更新失败（流水线不阻断）: ${err.message?.slice(0, 200)}`,
    );
  }
}

function isPhaseCompleted(state: WikiState | null, phase: string): boolean {
  if (!state) return false;
  const record = state.phaseHistory?.find((r) => r.phase === phase);
  return record?.status === "completed";
}

function getCurrentPhase(state: WikiState | null): string {
  if (!state) return "INIT";
  return state.currentPhase || "INIT";
}

// ─── Path Validation ─────────────────────────────────────────────────

function validatePathRules(paths: ResolvedPaths): void {
  const { projectRoot, agenticWikiRoot, wikiRoot, cacheRoot, sourceRoot } =
    paths;

  const checks: Array<{ rule: string; pass: boolean; detail: string }> = [];

  // Rule 1: projectRoot ≠ agenticWikiRoot
  const r1 = path.resolve(projectRoot) !== path.resolve(agenticWikiRoot);
  checks.push({
    rule: "projectRoot ≠ agenticWikiRoot",
    pass: r1,
    detail: r1
      ? "OK"
      : `CRITICAL: projectRoot equals agenticWikiRoot — Wiki would leak into tool dir!`,
  });

  // Rule 2: wikiRoot = projectRoot + "/wiki"
  const expectedWiki = path.join(projectRoot, "wiki");
  const r2 = path.resolve(wikiRoot) === path.resolve(expectedWiki);
  checks.push({
    rule: "wikiRoot = projectRoot + '/wiki'",
    pass: r2,
    detail: r2 ? "OK" : `Expected ${expectedWiki}, got ${wikiRoot}`,
  });

  // Rule 3: cacheRoot under projectRoot
  const r3 = cacheRoot.startsWith(projectRoot);
  checks.push({
    rule: "cacheRoot under projectRoot",
    pass: r3,
    detail: r3 ? "OK" : `${cacheRoot} is outside ${projectRoot}`,
  });

  console.log("🔴 路径自检:");
  let allPass = true;
  for (const c of checks) {
    const icon = c.pass ? "✅" : "❌";
    console.log(`  ${icon} ${c.rule}: ${c.detail}`);
    if (!c.pass) allPass = false;
  }

  if (!allPass) {
    console.error("\n❌ 路径铁律违反，阻断流水线。请修正 --project 参数。");
    process.exit(1);
  }
  console.log("");
}

// ─── Directory Initialization ────────────────────────────────────────

function ensureDirectories(projectRoot: string): void {
  const dirs = [
    path.join(projectRoot, ".agentic-wiki", "cache", "deps"),
    path.join(projectRoot, ".agentic-wiki", "issues"),
    path.join(projectRoot, ".agentic-wiki", "feedback"),
    path.join(projectRoot, ".agentic-wiki", "search"),
    path.join(projectRoot, "wiki", "volume-1-code"),
    path.join(projectRoot, "wiki", "volume-2-issues"),
  ];
  for (const dir of dirs) {
    fs.ensureDirSync(dir);
  }
}

// ─── Feedback Initialization ─────────────────────────────────────────

function ensureFeedbackSeed(projectRoot: string): void {
  const feedbackPath = path.join(
    projectRoot,
    ".agentic-wiki",
    "feedback",
    "prompts.md",
  );
  if (fs.existsSync(feedbackPath)) return;

  const seed = `# 反馈积累与策略改进

> 此文件由 runner.ts 自动创建种子，aw-feedback 运行时追加。
> 编排器每次进入 GEN 阶段时强制加载。

---

## 种子反馈

### aw-generate 改进
- 检测标准已内联到 SubAgent Prompt，禁止读取外部文件
- Issue 必须包含检测依据章节

### aw-dependency 改进
- 循环依赖：build-deps.ts 检测 → GEN SubAgent 格式化 Markdown

### aw-validate 改进
- validate-issue-content.ts 对可量化断言进行脚本验证

### aw-incremental 改进
- 增量模式必须加载 --issues-path 进行 Issue 反向查询

### Issue 状态机
- IssueStatus 包含 11 种状态，detected → closed 完整生命周期
`;

  fs.writeFileSync(feedbackPath, seed, "utf-8");
  console.log("  ✅ 种子反馈已创建: .agentic-wiki/feedback/prompts.md");
}

// ─── State Initialization ────────────────────────────────────────────

function initializeState(paths: ResolvedPaths, args: RunnerArgs): WikiState {
  const stateManagerPath = path.join(paths.libDir, "state-manager.ts");

  // Run state-manager init
  const cmd = [
    `npx tsx "${stateManagerPath}" init`,
    `--project "${paths.projectRoot}"`,
    `--agentic-wiki "${paths.agenticWikiRoot}"`,
    `--output "${paths.statePath}"`,
  ].join(" ");

  try {
    execSync(cmd, {
      cwd: paths.projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch (err: any) {
    console.error(`  ❌ state.json 初始化失败: ${err.message?.slice(0, 300)}`);
    process.exit(1);
  }

  return fs.readJsonSync(paths.statePath) as WikiState;
}

// ─── GEN Phase: Output SubAgent Prompts ──────────────────────────────

function outputGenPrompts(paths: ResolvedPaths): void {
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

  // Output prompts to file for Agent consumption
  const promptsDir = path.join(paths.projectRoot, ".agentic-wiki", "prompts");
  fs.ensureDirSync(promptsDir);

  for (const entry of toRun) {
    const promptFile = path.join(promptsDir, `${entry.id}.txt`);
    const promptContent =
      entry.prompt || `[No prompt generated for ${entry.id}]`;
    fs.writeFileSync(promptFile, promptContent, "utf-8");
  }

  // Inject feedback strategies into prompts BEFORE Agent reads them
  injectFeedbackIntoPrompts(paths);

  console.log(`\n📝 SubAgent Prompts 已输出到: ${promptsDir}/`);
  console.log(`   共 ${toRun.length} 个 prompt 文件。`);
  console.log(`\n🔴 Agent 下一步操作：`);
  console.log(`   1. 依次读取 ${promptsDir}/ 下的 prompt 文件`);
  console.log(
    `   2. 使用 spawn_agent 工具启动 SubAgent（每次 ${args.limit || toRun.length} 个并发）`,
  );
  console.log(`   3. SubAgent 全部完成后，运行:`);
  console.log(
    `      npx tsx src/runner.ts --project ${paths.projectRoot} --resume`,
  );
  console.log("─".repeat(60));

  // Output quick reference for the first prompt
  if (toRun.length > 0) {
    const first = toRun[0];
    console.log(
      `\n📋 首个 SubAgent: ${first.id} (${first.label || first.folder})`,
    );
    console.log(`   Prompt 文件: ${promptsDir}/${first.id}.txt`);
    console.log(
      `   预估 Token: ${first.estimatedTokens?.toLocaleString() || "?"}`,
    );
  }
}

// Need args reference in outputGenPrompts — make it accessible
let args: RunnerArgs;

// ─── Feedback Loop: Injection ───────────────────────────────────────

/**
 * Load feedback strategies (global + project) and inject into all
 * generated SubAgent prompts. This is the critical bridge between
 * historical failure analysis and future SubAgent execution.
 */
function injectFeedbackIntoPrompts(paths: ResolvedPaths): void {
  const promptsDir = path.join(paths.projectRoot, ".agentic-wiki", "prompts");
  if (!fs.existsSync(promptsDir)) {
    console.warn("  ⚠️  prompts 目录不存在，跳过反馈注入");
    return;
  }

  // Step A: Load global strategies (optional, missing is OK)
  let globalFeedback = "";
  const globalPath = path.join(
    paths.agenticWikiRoot,
    "docs",
    "feedback",
    "global-strategies.md",
  );
  if (fs.existsSync(globalPath)) {
    globalFeedback = fs.readFileSync(globalPath, "utf-8");
  }

  // Step B: Load project strategies (mandatory, missing = blocker)
  const projectFeedbackPath = path.join(
    paths.projectRoot,
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

  // Step C: Build injection block
  const injectionBlock = [
    "",
    "---",
    "",
    "## 🔴 历史反馈与改进策略（Runner 自动注入，必须遵守）",
    "",
  ];

  if (globalFeedback) {
    injectionBlock.push("### 全局策略（跨项目通用）", "", globalFeedback, "");
  }

  if (projectFeedback) {
    injectionBlock.push("### 项目策略（本项目专属）", "", projectFeedback, "");
  }

  injectionBlock.push(
    "> 以上策略来自历史验证失败的根因分析。必须在本次执行中应用。",
    "",
  );

  const injection = injectionBlock.join("\n");

  // Step D: Append to every prompt file
  const promptFiles = fs
    .readdirSync(promptsDir)
    .filter((f) => f.endsWith(".txt"));

  let injectedCount = 0;
  for (const file of promptFiles) {
    const filePath = path.join(promptsDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    // Only inject if not already injected (idempotent)
    if (!content.includes("历史反馈与改进策略")) {
      fs.appendFileSync(filePath, injection, "utf-8");
      injectedCount++;
    }
  }

  if (injectedCount > 0) {
    console.log(
      `  🔄 反馈策略已注入 ${injectedCount}/${promptFiles.length} 个 SubAgent prompt`,
    );
  }
  if (globalFeedback) {
    console.log("  📥 全局策略: 已加载");
  }
  if (projectFeedback) {
    console.log("  📥 项目策略: 已加载");
  }
}

// ─── Feedback Loop: Recording ───────────────────────────────────────

/**
 * Record a phase failure to prompts.md for future improvement.
 * Uses state-manager.ts append-feedback for atomic append.
 */
function recordFailure(
  paths: ResolvedPaths,
  phase: string,
  errorDetail: string,
): void {
  const stateManagerPath = path.join(paths.libDir, "state-manager.ts");
  const message = `**触发**: ${phase} 阶段执行失败\n**问题**: ${errorDetail.slice(0, 500)}\n**改进**: 检查脚本参数与输入文件完整性`;

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
    // Best-effort: fallback to direct append
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
      // Silently fail — feedback recording is best-effort
    }
  }
}

// ─── Main Runner ─────────────────────────────────────────────────────

async function main() {
  args = parseArgs();
  const paths = resolvePaths(args.project);

  console.log("═".repeat(60));
  console.log("AgenticWiki Unified Pipeline Runner");
  console.log("═".repeat(60));
  console.log(`  目标项目:     ${paths.projectRoot}`);
  console.log(`  Wiki 输出:    ${paths.wikiRoot}`);
  console.log(`  缓存目录:     ${paths.cacheRoot}`);
  console.log(`  模式:         ${args.mode}`);
  if (args.limit) console.log(`  GEN 批量:     ${args.limit}`);
  console.log("═".repeat(60));
  console.log("");

  // Step 0: Path validation
  validatePathRules(paths);

  // Step 0.5: Ensure directories
  ensureDirectories(paths.projectRoot);

  // Step 1: Load or initialize state
  let state = loadState(paths.statePath);

  if (!state) {
    console.log("🆕 首次运行，初始化项目...");
    console.log("");
    state = initializeState(paths, args);
    ensureFeedbackSeed(paths.projectRoot);
    console.log("  ✅ state.json 已创建");
    console.log(`  ✅ 当前阶段: ${state.currentPhase}`);
    console.log("");
  } else if (args.force) {
    console.log("🔄 --force: 清除已有状态，从 INIT 重新开始...");
    console.log("");
    fs.removeSync(paths.statePath);
    state = initializeState(paths, args);
    console.log("  ✅ state.json 已重建");
    console.log(`  ✅ 当前阶段: ${state.currentPhase}`);
    console.log("");
  } else {
    console.log(`📂 已存在状态文件: ${paths.statePath}`);
    console.log(`  当前阶段: ${state.currentPhase}`);
    console.log("");
  }

  // Step 2: Determine which phases to run
  let targetPhase: string | null = null;
  let startPhase: string | null = null;

  if (args.only) {
    // Single phase
    startPhase = args.only;
    targetPhase = args.only;
  } else if (args.to) {
    // Run from current to specified phase
    startPhase = getCurrentPhase(state);
    targetPhase = args.to;
  } else if (args.resume) {
    // Resume from current
    startPhase = getCurrentPhase(state);
    targetPhase = "DONE";
  } else {
    // Full run
    startPhase = getCurrentPhase(state);
    targetPhase = "DONE";
  }

  // Step 3: Collect phases to execute
  const phasesToRun: string[] = [];
  let inRange = false;
  for (const phase of DAG_ORDER) {
    if (phase === startPhase) inRange = true;
    if (inRange) phasesToRun.push(phase);
    if (phase === targetPhase) break;
  }

  // Also add ASSEMBLE and VALIDATE if target is DONE
  if (targetPhase === "DONE") {
    for (const p of ["ASSEMBLE", "VALIDATE"]) {
      if (!phasesToRun.includes(p)) phasesToRun.push(p);
    }
  }

  if (phasesToRun.length === 0) {
    console.log("✅ 没有需要执行的阶段。");
    return;
  }

  console.log(`📋 执行计划: ${phasesToRun.join(" → ")}`);
  console.log("");

  if (args.dryRun) {
    console.log("🔍 DRY RUN — 不实际执行脚本。");
    console.log("");
    for (const phase of phasesToRun) {
      const def = getPhaseDefinition(phase, paths, args);
      if (!def) continue;
      console.log(`  [${phase}] ${def.label}`);
      for (const s of def.scripts) {
        console.log(`    → ${s.name} ${s.args.join(" ")}`);
      }
    }
    return;
  }

  // Step 4: Execute phases
  for (const phase of phasesToRun) {
    const def = getPhaseDefinition(phase, paths, args);
    if (!def) {
      console.log(`⚠️  未知阶段: ${phase}，跳过`);
      continue;
    }

    // Check if already completed
    if (isPhaseCompleted(state, phase) && !args.only) {
      console.log(`✅ [${phase}] 已完成，跳过`);
      continue;
    }

    // Resume-aware: if GEN was "in_progress", SubAgents were already spawned.
    // Skip gen-scheduler, run verification, and continue to ASSEMBLE.
    if (
      phase === "GEN" &&
      args.resume &&
      state?.phaseHistory?.some(
        (r) => r.phase === "GEN" && r.status === "in_progress",
      )
    ) {
      console.log(`✅ [GEN] SubAgent 阶段已完成，验证产物...`);

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

      console.log(`  ✅ [GEN] → 下一阶段: ASSEMBLE\n`);

      // Mark GEN as completed so ASSEMBLE transition passes gate check
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
      continue;
    }

    console.log(`━`.repeat(40));
    console.log(`▶️  [${phase}] ${def.label}`);
    console.log(`━`.repeat(40));

    // Execute phase scripts
    let phaseFailed = false;
    const executedScripts: string[] = [];

    for (const script of def.scripts) {
      const statusIcon = script.critical ? "🔧" : "🔩";
      console.log(`  ${statusIcon} ${script.name}...`);

      const result = runScript(
        script.name,
        script.args,
        paths.libDir,
        paths.projectRoot,
      );

      if (result.success) {
        console.log(`     ✅ 完成`);
        if (result.output && result.output.length < 500) {
          // Show short output inline
          const lines = result.output.split("\n").filter(Boolean);
          for (const line of lines.slice(-3)) {
            console.log(`     │ ${line}`);
          }
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

      // 🔴 Feedback recording: persist failure to prompts.md
      recordFailure(paths, phase, "脚本执行返回非零退出码");

      process.exit(1);
    }

    // GEN phase: output prompts and pause (requires Agent intervention)
    if (phase === "GEN" && def.requiresAgent) {
      // Update state to "in_progress" for GEN
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
      outputGenPrompts(paths);

      console.log("\n⏸️  GEN 阶段需要 Agent 操作 SubAgent，runner 暂停。");
      console.log(
        `   SubAgent 完成后运行: npx tsx src/runner.ts --project ${paths.projectRoot} --resume`,
      );
      return; // Pause here for Agent to spawn SubAgents
    }

    // Update state after successful phase
    const phaseIdx = DAG_ORDER.indexOf(phase);
    const nextPhase =
      phaseIdx < DAG_ORDER.length - 1 ? DAG_ORDER[phaseIdx + 1] : "DONE";

    // Collect artifacts for this phase
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

    console.log(`  ✅ [${phase}] 阶段完成 → 下一阶段: ${nextPhase}`);
    console.log("");

    // Reload state after update
    state = loadState(paths.statePath);
  }

  console.log("═".repeat(60));
  console.log("✅ 流水线执行完成！");
  console.log("═".repeat(60));
}

// ─── Entry ───────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("💥 Runner 崩溃:", err.message);
  console.error(err.stack?.slice(0, 500));
  process.exit(1);
});
