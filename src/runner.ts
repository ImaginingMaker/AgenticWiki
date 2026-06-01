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
import type {
  DependencyGraphResult,
  FolderStrategyResult,
  GenTask,
  ModuleInfo,
} from "./types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Cleanup Registry ────────────────────────────────────────────
// Track temporary files so SIGINT/SIGTERM can clean them up.
let _tmpFilesToClean: string[] = [];
function registerCleanupPath(filePath: string): void {
  _tmpFilesToClean.push(filePath);
}

function cleanupTempFiles(exitCode = 1): void {
  for (const file of _tmpFilesToClean) {
    try {
      if (fs.existsSync(file)) fs.removeSync(file);
    } catch {
      // best-effort cleanup
    }
  }
  _tmpFilesToClean = [];
}

// Trap SIGINT (Ctrl+C) and SIGTERM to clean up temporary files.
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

// Keep process alive for async operations (e.g. execSync may need SIGINT)
process.on("uncaughtException", (err) => {
  console.error("\n❌ 未捕获异常:", err.message?.slice(0, 200));
  cleanupTempFiles();
  process.exit(1);
});

// ─── Types ──────────────────────────────────────────────────────────

interface RunnerArgs {
  project: string;
  to?: string;
  only?: string;
  resume: boolean;
  limit?: number;
  tokenLimit?: number;
  mode: "full" | "incremental";
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
  genTasks?: GenTask[];
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
      default: 5,
      description:
        "GEN 阶段每次调度 N 个子任务（默认 5）。与 --token-limit 互斥（后指定者生效）",
    })
    .option("token-limit", {
      type: "number",
      description:
        "GEN 阶段每批总 token 上限（如 300000），按 Token 阈值调度而非任务数量",
    })
    .option("mode", {
      type: "string",
      choices: ["full", "incremental"] as const,
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
    tokenLimit: argv.tokenLimit,
    mode: argv.mode as "full" | "incremental",
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
  /** Per-script timeout in ms (overrides runScript default 120s) */
  timeout?: number;
  /** Per-script maxBuffer in bytes (overrides runScript default 50MB) */
  maxBuffer?: number;
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
    opts?: { timeout?: number; maxBuffer?: number },
  ): PhaseScript => ({
    name,
    args: scriptArgs,
    critical,
    ...(opts?.timeout ? { timeout: opts.timeout } : {}),
    ...(opts?.maxBuffer ? { maxBuffer: opts.maxBuffer } : {}),
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
      return define(
        2,
        "依赖图 + 优先级 + 拆分策略 + 子图提取 + 文件元信息 + 依赖聚簇",
        [
          script(
            "build-deps.ts",
            [
              "--path",
              sourceRoot,
              "--output",
              path.join(cacheRoot, "dependency-graph.json"),
              "--format",
              "json",
              "--max-buffer",
              "104857600",
              "--timeout",
              "300000",
            ],
            true,
            { timeout: 300_000, maxBuffer: 104_857_600 },
          ),
          script(
            "build-deps.ts",
            [
              "--path",
              sourceRoot,
              "--output",
              path.join(cacheRoot, "dependency-graph.mmd"),
              "--format",
              "mermaid",
              "--max-buffer",
              "104857600",
              "--timeout",
              "300000",
            ],
            false,
            { timeout: 300_000, maxBuffer: 104_857_600 },
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
            "--source",
            sourceRoot,
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
          script("extract-file-meta.ts", [
            "--files",
            path.join(cacheRoot, "file-list.json"),
            "--source",
            sourceRoot,
            "--output",
            path.join(cacheRoot, "file-meta.json"),
          ]),
          script("cluster-tasks.ts", [
            "--deps",
            path.join(cacheRoot, "dependency-graph.json"),
            "--meta",
            path.join(cacheRoot, "file-meta.json"),
            "--files",
            path.join(cacheRoot, "file-list.json"),
            "--output",
            path.join(cacheRoot, "task-clusters.json"),
          ]),
        ],
      );

    case "GEN":
      // GEN phase has two sub-steps: schedule + output prompts
      // The actual SubAgent spawning is done by the Agent after reading prompts
      const genArgs: string[] = [];
      // Auto-detect: use cluster mode if task-clusters.json exists
      const clustersPath = path.join(cacheRoot, "task-clusters.json");
      if (fs.existsSync(clustersPath)) {
        genArgs.push("--clusters", clustersPath);
      } else {
        genArgs.push(
          "--strategy",
          path.join(cacheRoot, "folder-strategy.json"),
        );
      }
      genArgs.push(
        "--state",
        statePath,
        "--output",
        path.join(cacheRoot, "gen-schedule.json"),
        "--write-state",
      );
      // Use --token-limit if specified, otherwise fall back to --limit
      if (args.tokenLimit && args.tokenLimit > 0) {
        genArgs.push("--token-limit", String(args.tokenLimit));
      } else {
        genArgs.push("--limit", String(args.limit ?? 5));
      }
      if (args.resume) {
        genArgs.push("--resume");
      }

      return define(3, "GEN 调度 + SubAgent Prompt 生成（自动聚簇模式）", [
        script("gen-scheduler.ts", genArgs)],
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
          "--fix",
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
  scriptOpts?: { timeout?: number; maxBuffer?: number },
): { success: boolean; output: string } {
  const scriptPath = path.join(libDir, scriptName);

  // Shell-escape args: wrap each arg in double quotes and escape inner quotes
  const escapedArgs = args.map((a) => `"${a.replace(/"/g, '\\"')}"`);
  const cmd = `npx tsx "${scriptPath}" ${escapedArgs.join(" ")}`;

  try {
    const opts: ExecSyncOptions = {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: scriptOpts?.timeout ?? 120_000, // default 2 min per script
      maxBuffer: scriptOpts?.maxBuffer ?? 50 * 1024 * 1024, // default 50MB
    };
    const output = execSync(cmd, opts);
    return { success: true, output: String(output).trim() };
  } catch (err: any) {
    // Detect maxBuffer exceeded and suggest increase
    const stderr = err.stderr?.toString() || err.message || "Unknown error";
    const isMaxBuffer =
      stderr.includes("maxBuffer") || stderr.includes("stdout maxBuffer");
    const output = isMaxBuffer
      ? `${stderr}\n  💡 提示: 此脚本输出超过 ${((scriptOpts?.maxBuffer ?? 50 * 1024 * 1024) / 1024 / 1024).toFixed(0)}MB 缓冲限制。可在 getPhaseDefinition 中为此脚本设置更大的 maxBuffer。`
      : stderr;
    return { success: false, output };
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

  // Rule 3: cacheRoot under projectRoot (use path.resolve + path.sep to prevent prefix bypass)
  const r3 = path
    .resolve(cacheRoot)
    .startsWith(path.resolve(projectRoot) + path.sep);
  checks.push({
    rule: "cacheRoot under projectRoot",
    pass: r3,
    detail: r3 ? "OK" : `${cacheRoot} is outside ${projectRoot}`,
  });

  // Rule 4: sourceRoot under projectRoot (same fix for prefix bypass)
  const r4 = path
    .resolve(sourceRoot)
    .startsWith(path.resolve(projectRoot) + path.sep);
  checks.push({
    rule: "sourceRoot under projectRoot",
    pass: r4,
    detail: r4 ? "OK" : `${sourceRoot} is outside ${projectRoot}`,
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
    path.join(projectRoot, "wiki", "volume-2-issues", "ch-01-circular-deps"),
    path.join(projectRoot, "wiki", "volume-2-issues", "ch-02-dead-code"),
    path.join(projectRoot, "wiki", "volume-2-issues", "ch-03-missing-types"),
    path.join(projectRoot, "wiki", "volume-2-issues", "ch-04-complex-logic"),
    path.join(projectRoot, "wiki", "volume-2-issues", "ch-05-inconsistent-api"),
    path.join(projectRoot, "wiki", "volume-2-issues", "ch-06-potential-bugs"),
    path.join(projectRoot, "wiki", "volume-2-issues", "ch-99-archived"),
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

> 此文件由 runner.ts 自动创建种子。失败时 recordFailure() 自动追加。
> injectFeedbackIntoPrompts() 在每次 GEN 阶段自动加载。

---

## 种子反馈

### GEN 阶段改进
- 检测标准已内联到 SubAgent Prompt，禁止读取外部文件
- Issue 必须包含检测依据章节

### 依赖分析改进
- 循环依赖：build-deps.ts 检测 → GEN SubAgent 格式化 Markdown

### 验证改进
- validate-issue-content.ts 对可量化断言进行脚本验证

### 增量分析改进
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

function outputGenPrompts(paths: ResolvedPaths, limit: number = 5): void {
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

  // Output prompts for Agent consumption.
  // gen-scheduler.ts writes prompts to cache/gen-prompts/*.md.
  // runner.ts reads them directly — no redundant copy.
  const genPromptsDir = path.join(paths.cacheRoot, "gen-prompts");

  if (!fs.existsSync(genPromptsDir)) {
    console.error(`  ❌ gen-prompts 目录不存在: ${genPromptsDir}`);
    console.error(`     gen-scheduler.ts 应生成此目录中的文件`);
    return;
  }

  // gen-scheduler.ts already wrote prompts to gen-prompts/.
  // Inject feedback, then tell Agent where to read.
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

  // Output quick reference for the first prompt
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

let args: RunnerArgs;

// ─── Incremental Mode Helpers ────────────────────────────────────────

function propagateDeps(
  changedFiles: string[],
  depGraph: DependencyGraphResult,
): Set<string> {
  const affected = new Set(changedFiles);
  const queue = [...changedFiles];

  const moduleMap = new Map<string, ModuleInfo>();
  for (const mod of depGraph.modules) {
    moduleMap.set(mod.source, mod);
  }

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

function markAffectedGenTasks(
  statePath: string,
  affectedFiles: Set<string>,
  folderStrategy: FolderStrategyResult,
): number {
  const state = fs.readJsonSync(statePath) as WikiState;
  if (!state.genTasks || state.genTasks.length === 0) return 0;

  // Build affected folders: a folder is affected if any of its subTasks references an affected file
  const affectedFolders = new Set<string>();
  for (const folder of folderStrategy.folders) {
    for (const subTask of folder.subTasks || []) {
      if (subTask.files.some((f) => affectedFiles.has(f))) {
        affectedFolders.add(folder.path);
        break;
      }
    }
  }

  // Cross-folder merges: mark folder if any of its merged folders is affected
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

  if (updated > 0) {
    fs.writeJsonSync(statePath, state, { spaces: 2 });
  }

  return updated;
}

// ─── Feedback Loop: Injection ───────────────────────────────────────

/**
 * Load feedback strategies (global + project) and inject into all
 * generated SubAgent prompts. This is the critical bridge between
 * historical failure analysis and future SubAgent execution.
 */
function injectFeedbackIntoPrompts(
  promptsDir: string,
  agenticWikiRoot: string,
  projectRoot: string,
  mode: "append" | "replace" = "append",
): void {
  if (!fs.existsSync(promptsDir)) {
    console.warn("  ⚠️  prompts 目录不存在，跳过反馈注入");
    return;
  }

  // Step A: Load global strategies (optional, missing is OK)
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

  // Step B: Load project strategies (mandatory, missing = blocker)
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

  // Sentinel marker used for idempotency check
  // Must be unique enough to never appear naturally in prompt content
  const INJECTION_SENTINEL = "AGENTICWIKI_FEEDBACK_INJECTED";

  // Step C: Build injection block
  const injectionBlock = [
    "",
    "---",
    "",
    `<!-- ${INJECTION_SENTINEL} -->`,
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

  // Step D: Inject into every prompt file
  //   append mode: skip if sentinel already present (existing behavior)
  //   replace mode: replace existing injection block with fresh feedback
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
      // Replace mode: remove old injection block (from sentinel comment to end),
      // then append fresh feedback.
      const marker = `<!-- ${INJECTION_SENTINEL} -->`;
      const idx = content.indexOf(marker);
      if (idx !== -1) {
        // Keep everything before the sentinel, trim trailing whitespace
        const before = content.slice(0, idx).replace(/[\s\n]+$/, "");
        fs.writeFileSync(filePath, before + "\n\n" + injection, "utf-8");
        replacedCount++;
      }
    } else if (!hasSentinel) {
      // Append mode (or first-time injection): append fresh feedback
      fs.appendFileSync(filePath, injection, "utf-8");
      injectedCount++;
    }
    // else: hasSentinel && mode === "append" → skip (existing behavior)
  }

  if (replacedCount > 0) {
    console.log(
      `  🔄 反馈策略已更新 ${replacedCount}/${promptFiles.length} 个 SubAgent prompt（--resume 替换模式）`,
    );
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
  if (args.tokenLimit && args.tokenLimit > 0) {
    console.log(`  GEN Token 上限: ${args.tokenLimit.toLocaleString()}`);
  } else if (args.limit) {
    console.log(`  GEN 批量:     ${args.limit}`);
  }
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

  // === Incremental Mode: detect changes, propagate deps, mark affected tasks ===
  if (args.mode === "incremental") {
    if (!args.since) {
      console.error("❌ 增量模式需要 --since 参数（如 --since HEAD~1）");
      process.exit(1);
    }

    if (!state) {
      console.error(
        "❌ 增量模式需要已有全量分析结果（state.json 不存在），请先运行模式 A",
      );
      process.exit(1);
    }

    console.log(`🔍 增量模式：检测 ${args.since}...HEAD 的变更...`);
    console.log("");

    // 1. Git diff
    const gitCmd = `git -C "${paths.projectRoot}" diff --name-only ${args.since}...HEAD`;
    let changedFiles: string[] = [];
    try {
      const output = execSync(gitCmd, { encoding: "utf-8", timeout: 30_000 });
      changedFiles = output
        .split("\n")
        .map((f) => f.trim())
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

    // 2. Filter to source files only
    const sourceExts = /\.(ts|tsx|js|jsx)$/;
    const sourceChanged = changedFiles.filter(
      (f) => sourceExts.test(f) && !f.includes("node_modules"),
    );

    if (sourceChanged.length === 0) {
      console.log("✅ 源代码无变更（仅非源码文件变动），Wiki 已是最新。");
      return;
    }

    console.log(`  源代码变更: ${sourceChanged.length} 个`);
    for (const f of sourceChanged.slice(0, 5)) {
      console.log(`    - ${f}`);
    }
    if (sourceChanged.length > 5) {
      console.log(`    ... 还有 ${sourceChanged.length - 5} 个`);
    }

    // 3. Load dependency graph
    const depsPath = path.join(paths.cacheRoot, "dependency-graph.json");
    if (!fs.existsSync(depsPath)) {
      console.error("❌ 依赖图不存在，增量模式需要完整的全量分析结果");
      process.exit(1);
    }
    const depGraph = fs.readJsonSync(depsPath) as DependencyGraphResult;

    // 4. Propagate dependencies (find all files affected by the changes)
    const affectedFiles = propagateDeps(sourceChanged, depGraph);
    console.log(`  影响范围: ${affectedFiles.size} 个文件（含依赖传播）`);

    // 5. Load folder strategy and mark affected genTasks as pending
    const strategyPath = path.join(paths.cacheRoot, "folder-strategy.json");
    if (!fs.existsSync(strategyPath)) {
      console.error(
        "❌ folder-strategy.json 不存在，增量模式需要完整的全量分析结果",
      );
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

    console.log(`  🔄 重置了 ${updated} 个 GEN 任务状态为 pending`);
    console.log("");

    // 6. Re-run gen-scheduler to regenerate schedule for pending tasks only
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

    // 7. Output prompts for pending tasks
    console.log("");
    outputGenPrompts(paths, args.limit || 5);
    console.log("");
    console.log(
      "⏸️  增量模式：已生成受影响文件夹的 SubAgent prompts，runner 暂停。",
    );
    console.log(
      `   SubAgent 完成后运行: npx tsx src/runner.ts --project ${paths.projectRoot} --resume`,
    );
    return;
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

  // 🔴 Guard: when resuming from a late phase (ASSEMBLE/VALIDATE/DONE),
  // verify that GEN tasks are not incomplete. If genTasks still have
  // pending items, the wiki will be assembled from partial artifacts.
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
      console.warn(`   继续执行将基于不完整的 Wiki 产物组装。`);
      console.warn(
        `   建议: npx tsx src/runner.ts --project ${paths.projectRoot} --force`,
      );
      console.warn(
        `   或使用: npx tsx src/runner.ts --project ${paths.projectRoot} --only GEN --limit ${args.limit ?? 5}`,
      );
      console.log("");
    }
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
    // Verify artifacts, then either generate next batch OR proceed to ASSEMBLE.
    if (
      phase === "GEN" &&
      args.resume &&
      state?.phaseHistory?.some(
        (r) => r.phase === "GEN" && r.status === "in_progress",
      )
    ) {
      // 🔄 Re-inject feedback: the previous batch may have recorded failures to
      // prompts.md via recordFailure().
      const genPromptsDir = path.join(paths.cacheRoot, "gen-prompts");
      if (fs.existsSync(genPromptsDir)) {
        console.log(
          "  🔄 重新注入最新反馈策略（前一批次可能导致 prompts.md 更新）...",
        );
        injectFeedbackIntoPrompts(
          genPromptsDir,
          paths.agenticWikiRoot,
          paths.projectRoot,
        );
      }

      // Step A: Auto-sync genTasks from wiki directory
      // This ensures SubAgent-generated files are reflected in state.json
      // before we verify them. Prevents Runner from re-generating prompts
      // for already-completed tasks.
      console.log(`  🔄 同步已完成 GEN 任务状态...`);

      runScript(
        "sync-gen-tasks.ts",
        ["--state", paths.statePath, "--wiki", paths.wikiRoot, "--write"],
        paths.libDir,
        paths.projectRoot,
      );

      console.log(`  🔍 验证 SubAgent 产物...`);

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

      // Read verification report
      const verifyReportPath = path.join(paths.cacheRoot, "gen-verify.json");
      let tasksMissing = 0;
      let mermaidLeaks = 0;
      if (fs.existsSync(verifyReportPath)) {
        try {
          const report = fs.readJsonSync(verifyReportPath);
          tasksMissing = report.summary?.dirsFailed || 0;
          mermaidLeaks = report.summary?.leaksDetected || 0;
        } catch {
          // ignore parse errors
        }
      }

      // 🔴 Fix: Check gen-schedule.json for remaining pending tasks.
      // If there are still pending tasks, re-schedule the next batch
      // instead of blindly marking GEN as completed.
      const schedulePath = path.join(paths.cacheRoot, "gen-schedule.json");
      let pendingCount = 0;
      if (fs.existsSync(schedulePath)) {
        try {
          const schedule = fs.readJsonSync(schedulePath);
          pendingCount = schedule.summary?.pendingCount ?? 0;
        } catch {
          // ignore parse errors
        }
      }

      if (pendingCount > 0 || tasksMissing > 0) {
        if (pendingCount > 0) {
          console.log(
            `  📋 还有 ${pendingCount} 个 GEN 任务待处理，生成下一批 SubAgent prompts...`,
          );
        }
        if (tasksMissing > 0) {
          console.warn(
            `  ⚠️  ${tasksMissing} 个 SubAgent 产物缺失${mermaidLeaks > 0 ? `，${mermaidLeaks} 个 Mermaid 泄露` : ""}`,
          );
        }

        // Re-run gen-scheduler to schedule the next batch of pending tasks
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

        // Update state to "in_progress" for GEN (scheduler already
        // wrote genTasks array via --write-state)
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
        return; // Pause here for Agent to spawn SubAgents
      }

      // All tasks completed — GEN can safely transition to ASSEMBLE
      console.log(
        `  ✅ 所有 SubAgent 产物验证通过${mermaidLeaks > 0 ? `（${mermaidLeaks} 个 Mermaid 泄露已清理）` : ""}`,
      );

      // Step B: Per-batch Issue type validation
      // Run validate-issue-types with --fix to catch and repair format issues
      // early, rather than deferring them all to the ASSEMBLE phase.
      console.log(`  🔧 增量校验 Issue 文件格式...`);
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
      console.log(`  ✅ [GEN] → 下一阶段: ASSEMBLE\n`);
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
        { timeout: script.timeout, maxBuffer: script.maxBuffer },
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
      outputGenPrompts(paths, args.limit || 5);

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
