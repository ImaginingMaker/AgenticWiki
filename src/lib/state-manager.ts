/**
 * State Manager — state.json 原子操作脚本。
 *
 * 提供原子读写、schema 校验、文件锁、反馈追加。
 * 替代编排器和 aw-init 中所有对 state.json 的原始 write_file/edit_file 操作。
 *
 * Commands:
 *   npx tsx src/lib/state-manager.ts init       --project <path> --agentic-wiki <path> --output <path>
 *   npx tsx src/lib/state-manager.ts read        --state <path> [--key config.paths]
 *   npx tsx src/lib/state-manager.ts update      --state <path> --set <json>
 *   npx tsx src/lib/state-manager.ts validate    --state <path>
 *   npx tsx src/lib/state-manager.ts lock        --state <path> --timeout <ms>
 *   npx tsx src/lib/state-manager.ts unlock      --state <path>
 *   npx tsx src/lib/state-manager.ts append-feedback --state <path> --phase <phase> --message <text>
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
      // Check if stale lock exists
      if (await fs.pathExists(lockPath)) {
        const lockStat = await fs.stat(lockPath);
        const lockAge = Date.now() - lockStat.mtimeMs;
        if (lockAge > timeoutMs) {
          // Stale lock — remove and retry
          await fs.remove(lockPath);
          continue;
        }
        // Active lock — wait
        await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
        continue;
      }

      // Acquire lock
      const lock: FileLock = {
        path: lockPath,
        pid: process.pid,
        acquiredAt: Date.now(),
        timeoutMs,
      };
      await fs.writeJson(lockPath, lock, { spaces: 2 });
      return lock;
    } catch {
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }

  throw new Error(
    `Failed to acquire lock for ${statePath} after ${timeoutMs}ms. ` +
      `Another Agent may be editing this file.`,
  );
}

async function releaseLock(lock: FileLock): Promise<void> {
  try {
    if (await fs.pathExists(lock.path)) {
      const content = await fs.readJson(lock.path);
      if (content.pid === lock.pid) {
        await fs.remove(lock.path);
      }
    }
  } catch {
    // Best effort — lock file will be cleaned up as stale
  }
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
  if (!state.config.paths) errors.push("Missing: config.paths");
  if (state.config.paths) {
    const p = state.config.paths;
    if (!p.projectRoot) errors.push("Missing: config.paths.projectRoot");
    if (!p.wikiRoot) errors.push("Missing: config.paths.wikiRoot");
    if (!p.cacheRoot) errors.push("Missing: config.paths.cacheRoot");
  }

  return errors;
}

// === Init ===

export function createInitialState(
  projectPath: string,
  agenticWikiRoot: string,
): WikiState {
  const now = new Date().toISOString();
  const projectName = path.basename(projectPath);
  const dateStr = now.slice(0, 10).replace(/-/g, "");

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
      mode: "full",
      sourcePath: "src/",
      wikiPath: "wiki/",
      excludePatterns: ["node_modules", "dist", "build"],
      language: "zh-CN",
      tokenBudgetPerSubTask: 80000,
      maxConcurrentSubAgents: 5,
      paths: {
        projectRoot: projectPath,
        agenticWikiRoot,
        sourceRoot: path.join(projectPath, "src"),
        wikiRoot: path.join(projectPath, "wiki"),
        cacheRoot: path.join(projectPath, ".agentic-wiki", "cache"),
      },
    },
  };
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

  // Dedup: check last 5 entries for similar trigger
  const recentEntries = existing.split("---").slice(-5);
  const isDuplicate = recentEntries.some(
    (e) => e.includes(phase) && e.includes(message.slice(0, 40)),
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

// === CLI Entry Point ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .command("init", "Initialize a new state.json", (y) =>
      y
        .option("project", { type: "string", demandOption: true })
        .option("agentic-wiki", { type: "string", demandOption: true })
        .option("output", { type: "string", demandOption: true }),
    )
    .command("read", "Read state.json", (y) =>
      y
        .option("state", { type: "string", demandOption: true })
        .option("key", { type: "string" }),
    )
    .command("update", "Atomically update state.json", (y) =>
      y
        .option("state", { type: "string", demandOption: true })
        .option("set", { type: "string", demandOption: true }),
    )
    .command("validate", "Validate state.json schema", (y) =>
      y.option("state", { type: "string", demandOption: true }),
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
    .command("append-feedback", "Append to prompts.md", (y) =>
      y
        .option("state", { type: "string", demandOption: true })
        .option("phase", { type: "string", demandOption: true })
        .option("message", { type: "string", demandOption: true }),
    )
    .demandCommand(
      1,
      "You must specify a command: init | read | update | validate | lock | unlock | append-feedback",
    )
    .parseSync();

  const command = argv._[0] as string;

  switch (command) {
    case "init": {
      const state = createInitialState(
        path.resolve(argv.project as string),
        path.resolve(argv["agentic-wiki"] as string),
      );
      await fs.outputJson(argv.output as string, state, { spaces: 2 });
      process.stdout.write(`state.json initialized at ${argv.output}\n`);
      process.stdout.write(JSON.stringify(state.config.paths, null, 2) + "\n");
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
      const setJson = JSON.parse(argv.set as string);
      const updated = await atomicUpdate(argv.state as string, (current) => ({
        ...current,
        ...setJson,
      }));
      process.stdout.write(
        `state.json updated. currentPhase=${updated.currentPhase}\n`,
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
      const errors = validateStructure(state);
      if (errors.length > 0) {
        process.stderr.write(`WARNING: Structure issues found:\n`);
        for (const err of errors) {
          process.stderr.write(`  - ${err}\n`);
        }
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
