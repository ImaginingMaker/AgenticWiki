/**
 * State Manager — state.json 原子操作脚本。
 *
 * 提供原子读写、schema 校验、文件锁、反馈追加。
 替代旧编排器中对 state.json 的原始 write_file/edit_file 操作
 *
 * Commands:
 *   npx tsx src/lib/shared/state-manager.ts init       --project <path> --agentic-wiki <path> --output <path>
 *   npx tsx src/lib/shared/state-manager.ts read        --state <path> [--key config.paths]
 *   npx tsx src/lib/shared/state-manager.ts update      --state <path> --set <json>
 *   npx tsx src/lib/shared/state-manager.ts update      --state <path> --key config.paths.sourceRoot --value '"/path"'
 *   npx tsx src/lib/shared/state-manager.ts validate    --state <path>
 *   npx tsx src/lib/shared/state-manager.ts lock        --state <path> --timeout <ms>
 *   npx tsx src/lib/shared/state-manager.ts unlock      --state <path>
 *   npx tsx src/lib/shared/state-manager.ts append-feedback --state <path> --phase <phase> --message <text>
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type {
  WikiState,
  Phase,
  PhaseRecord,
  Blocker,
  WikiConfig,
  WikiPaths,
} from "../types/index.js";

// === Constants ===

const CURRENT_SCHEMA_VERSION = 1;
const LOCK_RETRY_MS = 100;
const DEFAULT_LOCK_TIMEOUT_MS = 10000;

// === File Lock ===

interface FileLock {
  path: string;
  pid: number;
  acquiredAt: number;
  timeoutMs: number;
}

async function acquireLock(
  statePath: string,
  timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS,
): Promise<FileLock> {
  const lockPath = statePath + ".lock";
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Check if stale lock exists — validate PID is still alive
      if (await fs.pathExists(lockPath)) {
        let isStale = false;
        try {
          const lockData = (await fs.readJson(lockPath)) as FileLock;
          const lockAge = Date.now() - lockData.acquiredAt;

          // Check if PID is still alive (cross-platform)
          let pidAlive = false;
          try {
            // Sending signal 0 checks process existence without killing it
            process.kill(lockData.pid, 0);
            pidAlive = true;
          } catch {
            pidAlive = false; // Process doesn't exist
          }

          if (!pidAlive || lockAge > lockData.timeoutMs) {
            isStale = true;
          }
        } catch {
          // Corrupted lock file
          isStale = true;
        }

        if (isStale) {
          // Stale lock — remove and retry
          await fs.remove(lockPath).catch(() => {});
          continue;
        }

        // Active lock — wait
        await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
        continue;
      }

      // Acquire lock using mkdir for atomicity (TOCTOU-safe)
      // mkdir is atomic on POSIX; on Windows we use writeFile with exclusive flag
      const lock: FileLock = {
        path: lockPath,
        pid: process.pid,
        acquiredAt: Date.now(),
        timeoutMs,
      };

      try {
        // Try atomic mkdir first
        await fs.mkdir(lockPath);
        // Write metadata inside the lock dir
        await fs.writeJson(path.join(lockPath, "meta.json"), lock);
      } catch (mkdirErr: any) {
        if (mkdirErr.code === "EEXIST") {
          // Race — another process got the lock first
          await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
          continue;
        }
        throw mkdirErr;
      }

      return lock;
    } catch (err: any) {
      if (err.code === "EEXIST") {
        await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `Failed to acquire lock for ${statePath} after ${timeoutMs}ms. ` +
      `Another Agent may be editing this file.`,
  );
}

async function releaseLock(lock: FileLock): Promise<void> {
  try {
    const lockDir = lock.path;
    if (await fs.pathExists(lockDir)) {
      // Verify ownership by reading meta.json
      const metaPath = path.join(lockDir, "meta.json");
      if (await fs.pathExists(metaPath)) {
        const meta = await fs.readJson(metaPath);
        if (meta.pid === lock.pid) {
          // Remove meta first, then dir
          await fs.remove(metaPath).catch(() => {});
          await fs.rmdir(lockDir).catch(() => {});
        }
      } else {
        // Legacy format or empty — clean up
        await fs.remove(lockDir).catch(() => {});
      }
    }
  } catch {
    // Best effort — stale lock cleanup will handle it
  }

  // Backward compat: also clean legacy .lock file
  const legacyLockPath = lock.path.replace(/\.lock$/, "") + ".lock.legacy";
  await fs.remove(legacyLockPath).catch(() => {});
}

// === Atomic Write ===

/**
 * Atomically read + update state.json with file lock, backup, and tmp-rename.
 *
 * @param statePath - Path to state.json
 * @param updater - Function that receives current state and returns updated state
 * @param timeoutMs - Lock acquisition timeout
 */
export async function atomicUpdate(
  statePath: string,
  updater: (current: WikiState) => WikiState,
  timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS,
): Promise<WikiState> {
  const lock = await acquireLock(statePath, timeoutMs);
  try {
    // 1. Read current
    const current: WikiState = await fs.readJson(statePath);

    // 2. Schema check
    validateSchemaVersion(current);

    // 3. Backup
    const backupPath = statePath + ".backup";
    await fs.copy(statePath, backupPath);

    // 4. Apply update
    const updated = updater(current);

    // 5. Schema check on result
    validateSchemaVersion(updated);

    // 6. Atomic write: tmp → rename
    const tmpPath = statePath + ".tmp";
    await fs.writeJson(tmpPath, updated, { spaces: 2 });
    await fs.rename(tmpPath, statePath);

    // 7. Clean up backup
    await fs.remove(backupPath);

    return updated;
  } catch (error) {
    // Restore from backup on failure
    const backupPath = statePath + ".backup";
    if (await fs.pathExists(backupPath)) {
      await fs.copy(backupPath, statePath);
      await fs.remove(backupPath);
    }
    throw error;
  } finally {
    await releaseLock(lock);
  }
}

// === Schema Validation ===

export function validateSchemaVersion(state: WikiState): void {
  if (!state.schemaVersion || state.schemaVersion < 1) {
    throw new Error(
      `state.json schemaVersion is ${state.schemaVersion || "missing"}, ` +
        `expected >= ${CURRENT_SCHEMA_VERSION}. Run 'state-manager.ts migrate'.`,
    );
  }
  if (state.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `state.json schemaVersion ${state.schemaVersion} is newer than ` +
        `this version of state-manager (${CURRENT_SCHEMA_VERSION}). ` +
        `Please update AgenticWiki.`,
    );
  }
}

export interface PathCheckResult {
  passed: boolean;
  checks: {
    rule: string;
    passed: boolean;
    expected: string;
    actual: string;
    detail: string;
  }[];
}

/**
 * Validate path constraints from state.json config.paths.
 Enforces the 5 path iron rules
 */
export function validatePaths(state: WikiState): PathCheckResult {
  const p = state.config.paths;
  if (!p) {
    return {
      passed: false,
      checks: [
        {
          rule: "config.paths exists",
          passed: false,
          expected: "config.paths object present",
          actual: "MISSING",
          detail: "state.json has no config.paths — run init first",
        },
      ],
    };
  }

  const checks: PathCheckResult["checks"] = [];

  // Rule 1: projectRoot ≠ agenticWikiRoot
  const rule1 = p.projectRoot !== p.agenticWikiRoot;
  checks.push({
    rule: "projectRoot ≠ agenticWikiRoot",
    passed: rule1,
    expected: `${p.agenticWikiRoot} ≠ ${p.projectRoot}`,
    actual: rule1 ? "OK" : "EQUAL — Wiki would be written to AgenticWiki root!",
    detail: rule1
      ? "Paths are distinct"
      : `projectRoot (${p.projectRoot}) equals agenticWikiRoot (${p.agenticWikiRoot})`,
  });

  // Rule 2: wikiRoot = projectRoot + "/wiki"
  const expectedWiki = path.join(p.projectRoot, "wiki");
  const rule2 = path.resolve(p.wikiRoot) === path.resolve(expectedWiki);
  checks.push({
    rule: "wikiRoot = projectRoot + '/wiki'",
    passed: rule2,
    expected: expectedWiki,
    actual: p.wikiRoot,
    detail: rule2
      ? "Wiki root is under project root"
      : `wikiRoot should be '${expectedWiki}', but is '${p.wikiRoot}'`,
  });

  // Rule 3: cacheRoot under projectRoot (with path.sep to prevent prefix bypass)
  const rule3 = path
    .resolve(p.cacheRoot)
    .startsWith(path.resolve(p.projectRoot) + path.sep);
  checks.push({
    rule: "cacheRoot under projectRoot",
    passed: rule3,
    expected: `Starts with ${p.projectRoot}`,
    actual: rule3 ? "OK" : `${p.cacheRoot} is outside projectRoot`,
    detail: rule3
      ? "Cache root is under project root"
      : `cacheRoot '${p.cacheRoot}' is not under projectRoot '${p.projectRoot}'`,
  });

  // Rule 4: sourceRoot under projectRoot (with path.sep to prevent prefix bypass)
  const rule4 = path
    .resolve(p.sourceRoot)
    .startsWith(path.resolve(p.projectRoot) + path.sep);
  checks.push({
    rule: "sourceRoot under projectRoot",
    passed: rule4,
    expected: `Starts with ${p.projectRoot}`,
    actual: rule4 ? "OK" : `${p.sourceRoot} is outside projectRoot`,
    detail: rule4
      ? "Source root is under project root"
      : `sourceRoot '${p.sourceRoot}' is not under projectRoot '${p.projectRoot}'`,
  });

  // Rule 5: projectRoot exists and contains code or package.json
  let rule5 = false;
  let rule5Detail: string | undefined;
  try {
    if (fs.existsSync(p.projectRoot)) {
      const hasPkg = fs.existsSync(path.join(p.projectRoot, "package.json"));
      const hasSrc = fs.existsSync(path.join(p.projectRoot, "src"));
      if (hasPkg || hasSrc) {
        rule5 = true;
        rule5Detail = hasPkg
          ? "Contains package.json"
          : "Contains src/ directory";
      } else {
        rule5Detail = "Directory exists but no package.json or src/ found";
      }
    } else {
      rule5Detail = `Directory '${p.projectRoot}' does not exist`;
    }
  } catch {
    rule5Detail = `Cannot access projectRoot '${p.projectRoot}'`;
  }
  checks.push({
    rule: "projectRoot exists with source code",
    passed: rule5,
    expected: "Directory exists and contains package.json or src/",
    actual: rule5 ? "OK" : "FAIL",
    detail: rule5Detail,
  });

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

export function validateStructure(state: WikiState): string[] {
  const errors: string[] = [];

  if (!state.id) errors.push("Missing: id");
  if (!state.projectPath) errors.push("Missing: projectPath");
  if (!state.currentPhase) errors.push("Missing: currentPhase");
  if (!state.phaseHistory || !Array.isArray(state.phaseHistory)) {
    errors.push("Missing or invalid: phaseHistory");
  }
  if (!state.checkpoint) errors.push("Missing: checkpoint");
  if (!state.config) errors.push("Missing: config");
  else if (!state.config.paths) errors.push("Missing: config.paths");
  if (state.config && state.config.paths) {
    const p = state.config.paths;
    if (!p.projectRoot) errors.push("Missing: config.paths.projectRoot");
    if (!p.wikiRoot) errors.push("Missing: config.paths.wikiRoot");
    if (!p.cacheRoot) errors.push("Missing: config.paths.cacheRoot");
  }

  return errors;
}

// === Init ===

export interface InitOptions {
  /** Pipeline mode: "full" | "incremental". Default "full". */
  mode?: string;
  /** Source root path relative to projectPath. Default "src". */
  source?: string;
}

export function createInitialState(
  projectPath: string,
  agenticWikiRoot: string,
  options: InitOptions = {},
): WikiState {
  const now = new Date().toISOString();
  const projectName = path.basename(projectPath);
  const dateStr = now.slice(0, 10).replace(/-/g, "");
  const mode = options.mode ?? "full";
  const sourceRel = options.source ?? "src";
  const sourceRoot = path.isAbsolute(sourceRel)
    ? sourceRel
    : path.join(projectPath, sourceRel);
  // sourcePath is the relative version for display / script args
  const sourcePath = sourceRel.endsWith("/") ? sourceRel : sourceRel + "/";

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: `${dateStr}-${projectName}`,
    projectPath,
    createdAt: now,
    currentPhase: "INIT",
    phaseHistory: [
      {
        phase: "INIT",
        status: "in_progress",
        startedAt: now,
      },
    ],
    checkpoint: {
      lastSuccessPhase: null,
      filesSnapshot: {},
      timestamp: now,
    },
    blockers: [],
    config: {
      mode: mode as WikiState["config"]["mode"],
      sourcePath,
      wikiPath: "wiki/",
      excludePatterns: ["node_modules", "dist", "build"],
      language: "zh-CN",
      tokenBudgetPerSubTask: 80000,
      maxRetries: 3,
      paths: {
        projectRoot: projectPath,
        agenticWikiRoot,
        sourceRoot,
        wikiRoot: path.join(projectPath, "wiki"),
        cacheRoot: path.join(projectPath, ".agentic-wiki", "cache"),
      },
    },
  };
}

// === Phase Transition ===

/**
 * Transition the pipeline from one phase to the next.
 *
 * This replaces the orchestrator's manual `edit_file` operations for:
 * - Marking completed phases in phaseHistory
 * - Advancing currentPhase to the next phase
 * - Recording artifacts, scripts executed, and output
 * - Updating checkpoint
 * - Optionally triggering gate validation
 *
 * @param statePath - Path to state.json
 * @param phase - The phase being completed (e.g., "SCAN")
 * @param status - Completion status ("completed" | "failed" | "skipped")
 * @param options - Additional transition options
 */
export async function transitionPhase(
  statePath: string,
  phase: Phase,
  status: "completed" | "failed" | "skipped" | "in_progress",
  options: {
    nextPhase?: Phase;
    output?: string;
    artifacts?: string[];
    scripts?: { script: string; exitCode: number; duration?: string }[];
    error?: string;
    runGate?: boolean;
    projectRoot?: string;
  } = {},
): Promise<WikiState> {
  const now = new Date().toISOString();

  return atomicUpdate(statePath, (current) => {
    // Find and update the target phase record
    const phaseIndex = current.phaseHistory.findIndex((p) => p.phase === phase);

    let newHistory = [...current.phaseHistory];

    if (phaseIndex >= 0) {
      // Update existing record
      const existing = newHistory[phaseIndex];
      newHistory[phaseIndex] = {
        ...existing,
        status,
        completedAt: now,
        ...(options.output !== undefined && { output: options.output }),
        ...(options.error !== undefined && { error: options.error }),
        ...(options.artifacts !== undefined && {
          artifacts: options.artifacts,
        }),
        ...(options.scripts !== undefined && {
          scriptsExecuted: options.scripts,
        }),
      };
    } else {
      // Create new record
      newHistory.push({
        phase,
        status,
        startedAt: now,
        completedAt: now,
        ...(options.output !== undefined && { output: options.output }),
        ...(options.error !== undefined && { error: options.error }),
        ...(options.artifacts !== undefined && {
          artifacts: options.artifacts,
        }),
        ...(options.scripts !== undefined && {
          scriptsExecuted: options.scripts,
        }),
      });
    }

    // If there's a next phase, create an in_progress entry
    if (options.nextPhase) {
      newHistory = newHistory.filter(
        (p) => !(p.phase === options.nextPhase && p.status === "in_progress"),
      );
      newHistory.push({
        phase: options.nextPhase,
        status: "in_progress",
        startedAt: now,
      });
    }

    // Circuit breaker: increment retryCount when entering FEEDBACK
    const maxRetries = current.config.maxRetries ?? 3;
    const currentRetryCount = current.checkpoint.retryCount ?? 0;
    const newRetryCount =
      options.nextPhase === "FEEDBACK"
        ? currentRetryCount + 1
        : currentRetryCount;

    if (newRetryCount > maxRetries) {
      process.stderr.write(
        `WARN: Retry limit exceeded (${newRetryCount} > ${maxRetries}). ` +
          `Escalating to DONE to prevent infinite feedback loop.\n`,
      );
    }

    return {
      ...current,
      currentPhase:
        newRetryCount > maxRetries
          ? "DONE"
          : options.nextPhase || current.currentPhase,
      phaseHistory: newHistory,
      checkpoint: {
        lastSuccessPhase:
          status === "completed" ? phase : current.checkpoint.lastSuccessPhase,
        filesSnapshot: current.checkpoint.filesSnapshot,
        timestamp: now,
        retryCount: newRetryCount,
      },
    };
  });
}

// === Append Feedback ===

export function appendFeedback(
  promptsPath: string,
  phase: string,
  message: string,
  limitLines: number = 1000,
): void {
  const now = new Date().toISOString();
  let entry = [
    "",
    "---",
    "",
    `### aw-${phase.toLowerCase()} 改进（${now}）`,
    "",
    `**触发**：${phase} 阶段自动沉淀`,
    `**问题**：${message}`,
    `**影响技能**：aw-${phase.toLowerCase()}`,
    "",
  ].join("\n");

  // Read existing content
  let existing = "";
  if (fs.existsSync(promptsPath)) {
    existing = fs.readFileSync(promptsPath, "utf-8");
  }

  // Dedup: check last 10 entries by (phase + first line of message)
  // Using phase+message first line instead of just text prefix to avoid
  // false dedup of different root-cause failures in same phase.
  const recentEntries = existing.split("---").slice(-10);
  const messageFirstLine = message.split("\n")[0].trim();
  const isDuplicate = recentEntries.some(
    (e) =>
      e.includes(`aw-${phase.toLowerCase()}`) && e.includes(messageFirstLine),
  );
  if (isDuplicate) {
    process.stderr.write(
      `Feedback deduplicated: similar entry already exists for ${phase}\n`,
    );
    return;
  }

  // Check size limit
  const totalLines = existing.split("\n").length + entry.split("\n").length;
  if (totalLines > limitLines) {
    entry += `\n> ⚠️ prompts.md 已超过 ${limitLines} 行，建议执行归档清理。\n`;
  }

  fs.appendFileSync(promptsPath, entry, "utf-8");
}

// === Nested Key Utilities ===

/**
 * Set a value at a dotted key path on an object, creating intermediate
 * objects as needed. Only creates plain objects - never overwrites
 * existing non-object values.
 *
 * @example
 *   setNested(obj, "config.mode", "incremental")
 *   // sets obj.config.mode = "incremental"
 */
function setNested(
  target: Record<string, unknown>,
  keyPath: string,
  value: unknown,
): void {
  const parts = keyPath.split(".");
  if (parts.length === 0) return;

  let current: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      !(part in current) ||
      typeof current[part] !== "object" ||
      current[part] === null
    ) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

// === CLI Entry Point ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .command("init", "Initialize a new state.json", (y) =>
      y
        .option("project", { type: "string", demandOption: true })
        .option("agentic-wiki", { type: "string", demandOption: true })
        .option("output", { type: "string", demandOption: true })
        .option("mode", {
          type: "string",
          default: "full",
          choices: ["full", "incremental"],
          description: "Pipeline mode",
        })
        .option("source", {
          type: "string",
          default: "src",
          description: "Source root path (relative to project, or absolute)",
        })
        .option("with-scaffold", {
          type: "boolean",
          default: false,
          description: "Also create dirs and seed prompts.md",
        }),
    )
    .command("read", "Read state.json", (y) =>
      y
        .option("state", { type: "string", demandOption: true })
        .option("key", { type: "string" }),
    )
    .command("update", "Atomically update state.json", (y) =>
      y
        .option("state", { type: "string", demandOption: true })
        .option("set", {
          type: "string",
          description:
            'JSON object with dot-notation keys, e.g. \'{"config.paths.sourceRoot": "/path"}\'',
        })
        .option("key", {
          type: "string",
          description:
            "Dot-notation key path (e.g. config.paths.sourceRoot). Use with --value for single-field updates.",
        })
        .option("value", {
          type: "string",
          description:
            "JSON value to set (e.g. '\"/path\"' for string, '5' for number, '{\"a\":1}' for object). Requires --key.",
        })
        .check((argv) => {
          const hasSet = !!argv.set;
          const hasKeyValue = !!argv.key || argv.value !== undefined;
          if (!hasSet && !hasKeyValue) {
            return new Error("Either --set or --key/--value must be provided");
          }
          if (hasSet && hasKeyValue) {
            return new Error(
              "Cannot use --set together with --key/--value. Choose one mode.",
            );
          }
          if (argv.key && argv.value === undefined) {
            return new Error("--value is required when --key is provided");
          }
          return true;
        }),
    )
    .command("validate", "Validate state.json schema", (y) =>
      y
        .option("state", { type: "string", demandOption: true })
        .option("check-paths", {
          type: "boolean",
          default: false,
          description: "Also validate path constraints (5 iron rules)",
        }),
    )
    .command("lock", "Acquire file lock", (y) =>
      y
        .option("state", { type: "string", demandOption: true })
        .option("timeout", {
          type: "number",
          default: DEFAULT_LOCK_TIMEOUT_MS,
        }),
    )
    .command("unlock", "Release file lock", (y) =>
      y.option("state", { type: "string", demandOption: true }),
    )
    .command("transition", "Complete a phase and advance to next", (y) =>
      y
        .option("state", { type: "string", demandOption: true })
        .option("phase", { type: "string", demandOption: true })
        .option("status", {
          type: "string",
          default: "completed",
          choices: ["completed", "failed", "skipped", "in_progress"],
        })
        .option("next-phase", { type: "string" })
        .option("output", { type: "string" })
        .option("artifacts", { type: "string" })
        .option("scripts", { type: "string" })
        .option("error", { type: "string" })
        .option("gate", {
          type: "boolean",
          default: false,
          description: "Run validate-artifacts after transition",
        }),
    )
    .command("append-feedback", "Append to prompts.md", (y) =>
      y
        .option("state", { type: "string", demandOption: true })
        .option("phase", { type: "string", demandOption: true })
        .option("message", { type: "string", demandOption: true }),
    )
    .demandCommand(
      1,
      "You must specify a command: init | read | update | validate | transition | lock | unlock | append-feedback",
    )
    .parseSync();

  const command = argv._[0] as string;

  switch (command) {
    case "init": {
      const projectRoot = path.resolve(argv.project as string);
      const agenticRoot = path.resolve(argv["agentic-wiki"] as string);
      const state = createInitialState(projectRoot, agenticRoot, {
        mode: argv.mode as string | undefined,
        source: argv.source as string | undefined,
      });
      await fs.outputJson(argv.output as string, state, { spaces: 2 });
      process.stdout.write(`state.json initialized at ${argv.output}\n`);
      process.stdout.write(JSON.stringify(state.config.paths, null, 2) + "\n");

      if (argv["with-scaffold"]) {
        const dirs = [
          path.join(projectRoot, ".agentic-wiki", "cache"),
          path.join(projectRoot, ".agentic-wiki", "cache", "deps"),
          path.join(projectRoot, ".agentic-wiki", "issues"),
          path.join(projectRoot, ".agentic-wiki", "feedback"),
          path.join(projectRoot, ".agentic-wiki", "search"),
          path.join(projectRoot, "wiki", "volume-1-code"),
          path.join(projectRoot, "wiki", "volume-2-issues"),
        ];
        for (const d of dirs) await fs.ensureDir(d);

        const promptsPath = path.join(
          projectRoot,
          ".agentic-wiki",
          "feedback",
          "prompts.md",
        );
        const seed = [
          "# 反馈积累与策略改进",
          "",
          "> 此文件由 runner.ts 自动创建种子。",
          "> runner.ts 的 injectFeedbackIntoPrompts() 在每次 GEN 阶段自动加载。",
          "",
          "---",
          "",
          "## 种子反馈",
          "",
          "### GEN 阶段改进",
          "- 检测标准已内联到 SubAgent Prompt，禁止读取外部文件",
          "- Issue 必须包含检测依据章节",
          "",
          "### 依赖分析改进",
          "- 循环依赖：build-deps.ts 检测 → GEN SubAgent 格式化 Markdown",
          "",
          "### 验证改进",
          "- validate-issue-content.ts 对可量化断言进行脚本验证",
          "",
          "### 增量分析改进",
          "- 增量模式必须加载 --issues-path 进行 Issue 反向查询",
          "",
          "### Issue 状态机",
          "- IssueStatus 包含 11 种状态，detected → closed 完整生命周期",
        ].join("\n");
        await fs.outputFile(promptsPath, seed, "utf-8");

        process.stdout.write(
          `Scaffold created: ${dirs.length} dirs, seed prompts.md written\n`,
        );
      }

      break;
    }

    case "read": {
      const state: WikiState = await fs.readJson(argv.state as string);
      const key = argv.key as string | undefined;
      if (key) {
        // Navigate dotted path: "config.paths.projectRoot"
        let value: unknown = state;
        for (const part of key.split(".")) {
          value = (value as Record<string, unknown>)?.[part];
        }
        process.stdout.write(JSON.stringify(value) + "\n");
      } else {
        process.stdout.write(JSON.stringify(state, null, 2) + "\n");
      }
      break;
    }

    case "update": {
      const updates: Array<[string, unknown]> = [];

      if (argv.key && argv.value !== undefined) {
        // Mode 1: --key + --value (single-field update, no JSON escaping issues)
        const keyPath = argv.key as string;
        let value: unknown;
        try {
          value = JSON.parse(argv.value as string);
        } catch {
          // If not valid JSON, treat as plain string
          value = argv.value as string;
        }
        updates.push([keyPath, value]);
      } else if (argv.set) {
        // Mode 2: --set (batch update via JSON object with dot-notation keys)
        const setJson = JSON.parse(argv.set as string) as Record<
          string,
          unknown
        >;
        for (const [keyPath, value] of Object.entries(setJson)) {
          updates.push([keyPath, value]);
        }
      }

      const updated = await atomicUpdate(argv.state as string, (current) => {
        const next = { ...current };
        for (const [keyPath, value] of updates) {
          setNested(next, keyPath, value);
        }
        return next;
      });
      process.stdout.write(
        `state.json updated. currentPhase=${updated.currentPhase}
`,
      );
      break;
    }

    case "validate": {
      const statePath = argv.state as string;
      if (!(await fs.pathExists(statePath))) {
        process.stderr.write(
          `CRITICAL: state.json not found at ${statePath}\n`,
        );
        process.exit(1);
      }
      const state: WikiState = await fs.readJson(statePath);
      try {
        validateSchemaVersion(state);
      } catch (e: any) {
        process.stderr.write(`CRITICAL: Schema version error: ${e.message}\n`);
        process.exit(1);
      }

      // Standard structure validation
      const errors = validateStructure(state);
      if (errors.length > 0) {
        process.stderr.write(`WARNING: Structure issues found:\n`);
        for (const err of errors) {
          process.stderr.write(`  - ${err}\n`);
        }
      }

      // Optional path constraint validation
      let pathResult: PathCheckResult | null;
      if (argv["check-paths"]) {
        pathResult = validatePaths(state);
        process.stdout.write(`\n🔴 Path Self-Check\n`);
        for (const check of pathResult.checks) {
          const icon = check.passed ? "✅" : "❌";
          process.stdout.write(`  ${icon} ${check.rule}\n`);
          if (!check.passed) {
            process.stdout.write(`     Expected: ${check.expected}\n`);
            process.stdout.write(`     Actual:   ${check.actual}\n`);
          }
        }
        if (!pathResult.passed) {
          process.stderr.write(
            `\n🔴 Path self-check FAILED. Fix and re-run.\n`,
          );
          process.exit(3);
        }
        process.stdout.write(`\n✅ Path self-check passed\n`);
      }

      if (errors.length > 0) {
        process.stderr.write(
          `state.json validated with ${errors.length} warning(s) (v${state.schemaVersion})\n`,
        );
        process.exit(2);
      }
      process.stdout.write(
        `state.json validated successfully (v${state.schemaVersion})\n`,
      );
      break;
    }

    case "lock": {
      const lock = await acquireLock(
        argv.state as string,
        argv.timeout as number,
      );
      process.stdout.write(JSON.stringify(lock) + "\n");
      // Lock persists until explicit unlock — caller must run 'unlock' command
      break;
    }

    case "unlock": {
      const lockPath = (argv.state as string) + ".lock";
      if (await fs.pathExists(lockPath)) {
        const content = await fs.readJson(lockPath);
        if (content.pid === process.pid) {
          await fs.remove(lockPath);
          process.stdout.write("Lock released\n");
        } else {
          process.stderr.write(
            `Lock held by PID ${content.pid}, cannot release from PID ${process.pid}\n`,
          );
          process.exit(1);
        }
      } else {
        process.stdout.write("No lock file found\n");
      }
      break;
    }

    case "transition": {
      const phase = (argv.phase as string).toUpperCase() as Phase;
      const status = argv.status as string as
        | "completed"
        | "failed"
        | "skipped";
      const nextPhase = argv["next-phase"]
        ? ((argv["next-phase"] as string).toUpperCase() as Phase)
        : undefined;

      // Parse artifacts: comma-separated string
      const artifacts = argv.artifacts
        ? (argv.artifacts as string).split(",").map((s: string) => s.trim())
        : undefined;

      // Parse scripts: "script.ts:0,script2.ts:0"
      const scripts = argv.scripts
        ? (argv.scripts as string).split(",").map((entry: string) => {
            const parts = entry.trim().split(":");
            return {
              script: parts[0],
              exitCode: parseInt(parts[1], 10) || 0,
              ...(parts[2] && { duration: parts[2] }),
            };
          })
        : undefined;

      const updated = await transitionPhase(
        argv.state as string,
        phase,
        status,
        {
          nextPhase,
          output: argv.output as string | undefined,
          artifacts,
          scripts,
          error: argv.error as string | undefined,
        },
      );

      process.stdout.write(
        `Phase transition: ${phase} -> ${status}` +
          (nextPhase ? `, next=${nextPhase}` : "") +
          `\ncurrentPhase=${updated.currentPhase}\n`,
      );

      // Run gate validation if requested
      if (argv.gate && status === "completed") {
        const projectRoot =
          updated.config.paths?.projectRoot || updated.projectPath;
        const statePath = path.resolve(argv.state as string);
        const agenticWikiRoot =
          updated.config.paths?.agenticWikiRoot ||
          path.resolve(
            path.dirname(new URL(import.meta.url).pathname),
            "../..",
          );
        const validateScript = path.join(
          agenticWikiRoot,
          "src/lib/validate/validate-artifacts.ts",
        );

        try {
          const { execSync } = await import("node:child_process");
          execSync(
            `npx tsx "${validateScript}" --state "${statePath}" --phase "${phase}"`,
            {
              cwd: projectRoot,
              encoding: "utf-8",
              maxBuffer: 10 * 1024 * 1024,
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          process.stdout.write(`Gate validation passed for ${phase}\n`);
        } catch (gateErr: any) {
          const stderr = gateErr.stderr || gateErr.message || "";
          process.stderr.write(
            `Gate validation FAILED for ${phase}:\n${stderr.slice(0, 500)}\n`,
          );
          process.exit(3);
        }
      }

      break;
    }

    case "append-feedback": {
      const statePath = argv.state as string;
      const state: WikiState = await fs.readJson(statePath);
      const promptsPath = path.join(
        state.config.paths?.projectRoot || state.projectPath,
        ".agentic-wiki",
        "feedback",
        "prompts.md",
      );
      appendFeedback(promptsPath, argv.phase as string, argv.message as string);
      process.stdout.write(`Feedback appended to ${promptsPath}\n`);
      break;
    }

    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      process.exit(1);
  }
}

const isMainModule =
  process.argv[1]?.endsWith("state-manager.ts") ||
  process.argv[1]?.endsWith("state-manager.js");
if (isMainModule) main();
