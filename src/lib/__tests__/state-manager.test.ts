/**
 * state-manager.ts 单元测试
 *
 * 覆盖核心功能：createInitialState、validatePaths、atomicUpdate、
 * transitionPhase、appendFeedback、schema version validation。
 *
 * 之前：state-manager.ts (~1000行) 零测试覆盖。
 * 现在：核心路径全部有测试。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "fs-extra";
import os from "node:os";

import {
  createInitialState,
  validatePaths,
  validateSchemaVersion,
  validateStructure,
  transitionPhase,
  appendFeedback,
  atomicUpdate,
} from "../shared/state-manager.js";

// === Test Helpers ===

let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-wiki-test-"));
});

afterEach(async () => {
  await fs.remove(tmpDir).catch(() => {});
});

function createTestStatePath(): string {
  return path.join(tmpDir, "state.json");
}

function createTestProject(): {
  statePath: string;
  projectPath: string;
  agenticWikiRoot: string;
} {
  const projectPath = path.join(tmpDir, "my-project");
  const agenticWikiRoot = path.join(tmpDir, "agentic-wiki");
  fs.ensureDirSync(projectPath);
  fs.ensureDirSync(agenticWikiRoot);
  fs.writeFileSync(path.join(projectPath, "package.json"), "{}");

  const statePath = path.join(projectPath, ".agentic-wiki", "state.json");
  fs.ensureDirSync(path.dirname(statePath));

  const state = createInitialState(projectPath, agenticWikiRoot);
  fs.writeJsonSync(statePath, state, { spaces: 2 });

  return { statePath, projectPath, agenticWikiRoot };
}

// === Tests: createInitialState ===

describe("createInitialState", () => {
  it("creates valid initial state", () => {
    const projectPath = path.join(tmpDir, "proj");
    const agenticRoot = path.join(tmpDir, "aw");
    const state = createInitialState(projectPath, agenticRoot);

    expect(state.schemaVersion).toBe(1);
    expect(state.currentPhase).toBe("INIT");
    expect(state.projectPath).toBe(projectPath);
    expect(state.config.mode).toBe("full");
    expect(state.config.tokenBudgetPerSubTask).toBe(80000);
    expect(state.config.paths).toBeDefined();
    expect(state.config.paths!.projectRoot).toBe(projectPath);
    expect(state.config.paths!.agenticWikiRoot).toBe(agenticRoot);
    expect(state.config.paths!.wikiRoot).toBe(path.join(projectPath, "wiki"));
    expect(state.config.paths!.cacheRoot).toBe(
      path.join(projectPath, ".agentic-wiki", "cache"),
    );
  });

  it("sets INIT as in_progress in phaseHistory", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    const initPhase = state.phaseHistory.find((p) => p.phase === "INIT");
    expect(initPhase).toBeDefined();
    expect(initPhase!.status).toBe("in_progress");
  });

  it("uses custom mode when specified", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
      { mode: "incremental" },
    );
    expect(state.config.mode).toBe("incremental");
  });

  it("resolves absolute source path when relative is given", () => {
    const projectPath = path.join(tmpDir, "proj");
    const state = createInitialState(projectPath, path.join(tmpDir, "aw"), {
      source: "app/src",
    });
    expect(state.config.sourcePath).toBe("app/src/");
    expect(state.config.paths!.sourceRoot).toBe(
      path.join(projectPath, "app/src"),
    );
  });
});

// === Tests: validatePaths ===

describe("validatePaths", () => {
  it("passes when all paths are correct", () => {
    const { projectPath, agenticWikiRoot } = createTestProject();
    fs.ensureDirSync(path.join(projectPath, "src"));

    const state = createInitialState(projectPath, agenticWikiRoot);
    const result = validatePaths(state);

    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails when projectRoot equals agenticWikiRoot", () => {
    const samePath = path.join(tmpDir, "both");
    fs.ensureDirSync(samePath);
    fs.writeFileSync(path.join(samePath, "package.json"), "{}");

    const state = createInitialState(samePath, samePath);
    const result = validatePaths(state);

    const rule1 = result.checks.find(
      (c) => c.rule === "projectRoot ≠ agenticWikiRoot",
    );
    expect(rule1!.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("fails when wikiRoot is not under projectRoot", () => {
    const projectPath = path.join(tmpDir, "proj");
    const wrongWiki = path.join(tmpDir, "somewhere-else", "wiki");
    fs.ensureDirSync(projectPath);
    fs.writeFileSync(path.join(projectPath, "package.json"), "{}");

    const state = createInitialState(projectPath, path.join(tmpDir, "aw"));
    (state as Record<string, unknown>).config.paths.wikiRoot = wrongWiki;

    const result = validatePaths(state);
    const rule2 = result.checks.find(
      (c) => c.rule === "wikiRoot = projectRoot + '/wiki'",
    );
    expect(rule2!.passed).toBe(false);
  });

  it("fails when projectRoot does not exist", () => {
    const fakeRoot = path.join(tmpDir, "nonexistent");
    const state = createInitialState(fakeRoot, path.join(tmpDir, "aw"));

    const result = validatePaths(state);
    const rule5 = result.checks.find(
      (c) => c.rule === "projectRoot exists with source code",
    );
    expect(rule5!.passed).toBe(false);
  });

  it("fails when no config.paths", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    (state as Record<string, unknown>).config.paths = undefined;

    const result = validatePaths(state);
    expect(result.passed).toBe(false);
    expect(result.checks[0].rule).toContain("config.paths");
  });

  it("fails when cacheRoot not under projectRoot", () => {
    const projectPath = path.join(tmpDir, "proj");
    const wrongCache = path.join(tmpDir, "outside", "cache");
    fs.ensureDirSync(projectPath);
    fs.writeFileSync(path.join(projectPath, "package.json"), "{}");

    const state = createInitialState(projectPath, path.join(tmpDir, "aw"));
    (state as Record<string, unknown>).config.paths.cacheRoot = wrongCache;

    const result = validatePaths(state);
    const rule3 = result.checks.find((c) => c.rule.includes("cacheRoot"));
    expect(rule3!.passed).toBe(false);
  });

  it("fails when sourceRoot not under projectRoot", () => {
    const projectPath = path.join(tmpDir, "proj");
    fs.ensureDirSync(projectPath);
    fs.writeFileSync(path.join(projectPath, "package.json"), "{}");

    const state = createInitialState(projectPath, path.join(tmpDir, "aw"));
    (state as Record<string, unknown>).config.paths.sourceRoot = path.join(
      tmpDir,
      "outside",
      "src",
    );

    const result = validatePaths(state);
    const rule4 = result.checks.find((c) => c.rule.includes("sourceRoot"));
    expect(rule4!.passed).toBe(false);
  });

  it("passes sourceRoot existence check when src/ exists", () => {
    const { projectPath, agenticWikiRoot } = createTestProject();
    fs.ensureDirSync(path.join(projectPath, "src"));

    const state = createInitialState(projectPath, agenticWikiRoot);
    const result = validatePaths(state);
    const rule5 = result.checks.find(
      (c) => c.rule === "projectRoot exists with source code",
    );
    expect(rule5!.passed).toBe(true);
  });

  it("fails when no package.json or src/ exists", () => {
    const projectPath = path.join(tmpDir, "empty-proj");
    fs.ensureDirSync(projectPath);
    // No package.json, no src/ — should fail

    const state = createInitialState(projectPath, path.join(tmpDir, "aw"));
    const result = validatePaths(state);
    const rule5 = result.checks.find(
      (c) => c.rule === "projectRoot exists with source code",
    );
    expect(rule5!.passed).toBe(false);
  });

  it("passes when package.json exists without src/", () => {
    const projectPath = path.join(tmpDir, "pkg-only");
    fs.ensureDirSync(projectPath);
    fs.writeFileSync(path.join(projectPath, "package.json"), "{}");
    // No src/ directory, but package.json exists

    const state = createInitialState(projectPath, path.join(tmpDir, "aw"));
    const result = validatePaths(state);
    const rule5 = result.checks.find(
      (c) => c.rule === "projectRoot exists with source code",
    );
    expect(rule5!.passed).toBe(true);
  });
});

// === Tests: validateSchemaVersion ===

describe("validateSchemaVersion", () => {
  it("accepts valid schema version", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    expect(() => validateSchemaVersion(state)).not.toThrow();
  });

  it("rejects missing schema version", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    (state as Record<string, unknown>).schemaVersion = undefined;
    expect(() => validateSchemaVersion(state)).toThrow("missing");
  });

  it("rejects newer schema version", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    (state as Record<string, unknown>).schemaVersion = 999;
    expect(() => validateSchemaVersion(state)).toThrow("newer");
  });
});

// === Tests: validateStructure ===

describe("validateStructure", () => {
  it("reports no errors for valid state", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    const errors = validateStructure(state);
    expect(errors).toHaveLength(0);
  });

  it("reports missing config", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    (state as Record<string, unknown>).config = undefined;
    const errors = validateStructure(state);
    expect(errors.some((e) => e.includes("config"))).toBe(true);
  });

  it("reports missing id", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    (state as Record<string, unknown>).id = undefined;
    const errors = validateStructure(state);
    expect(errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("reports missing projectPath", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    (state as Record<string, unknown>).projectPath = undefined;
    const errors = validateStructure(state);
    expect(errors.some((e) => e.includes("projectPath"))).toBe(true);
  });

  it("reports missing checkpoint", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    (state as Record<string, unknown>).checkpoint = undefined;
    const errors = validateStructure(state);
    expect(errors.some((e) => e.includes("checkpoint"))).toBe(true);
  });

  it("reports missing config.paths", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    (state as Record<string, unknown>).config = {};
    const errors = validateStructure(state);
    expect(errors.some((e) => e.includes("config.paths"))).toBe(true);
  });

  it("reports missing config.paths.projectRoot", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    (state as Record<string, unknown>).config.paths = {
      wikiRoot: "/wiki",
      cacheRoot: "/cache",
    } as Record<string, unknown>;
    const errors = validateStructure(state);
    expect(errors.some((e) => e.includes("projectRoot"))).toBe(true);
  });

  it("reports missing config.paths.wikiRoot", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    (state as Record<string, unknown>).config.paths = {
      projectRoot: "/proj",
      cacheRoot: "/cache",
    } as Record<string, unknown>;
    const errors = validateStructure(state);
    expect(errors.some((e) => e.includes("wikiRoot"))).toBe(true);
  });

  it("reports missing config.paths.cacheRoot", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    (state as Record<string, unknown>).config.paths = {
      projectRoot: "/proj",
      wikiRoot: "/wiki",
    } as Record<string, unknown>;
    const errors = validateStructure(state);
    expect(errors.some((e) => e.includes("cacheRoot"))).toBe(true);
  });

  it("reports invalid phaseHistory", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    (state as Record<string, unknown>).phaseHistory = "not-array";
    const errors = validateStructure(state);
    expect(errors.some((e) => e.includes("phaseHistory"))).toBe(true);
  });
});

// === Tests: transitionPhase ===

describe("transitionPhase", () => {
  it("transitions INIT -> SCAN", async () => {
    const { statePath } = createTestProject();

    const updated = await transitionPhase(statePath, "INIT", "completed", {
      nextPhase: "SCAN",
      artifacts: ["project-scan.json"],
    });

    expect(updated.currentPhase).toBe("SCAN");
    expect(updated.phaseHistory).toHaveLength(2);

    const initRecord = updated.phaseHistory.find((p) => p.phase === "INIT");
    expect(initRecord!.status).toBe("completed");
    expect(initRecord!.completedAt).toBeDefined();
    expect(initRecord!.artifacts).toContain("project-scan.json");

    const scanRecord = updated.phaseHistory.find((p) => p.phase === "SCAN");
    expect(scanRecord!.status).toBe("in_progress");
  });

  it("preserves existing phase history", async () => {
    const { statePath } = createTestProject();

    // First transition
    await transitionPhase(statePath, "INIT", "completed", {
      nextPhase: "SCAN",
    });

    // Second transition
    const updated = await transitionPhase(statePath, "SCAN", "completed", {
      nextPhase: "DEPENDENCY",
    });

    expect(updated.currentPhase).toBe("DEPENDENCY");
    expect(updated.phaseHistory.length).toBeGreaterThanOrEqual(3);
  });

  it("records failed status", async () => {
    const { statePath } = createTestProject();

    const updated = await transitionPhase(statePath, "INIT", "failed", {
      error: "scan-project.ts crashed",
    });

    const initRecord = updated.phaseHistory.find((p) => p.phase === "INIT");
    expect(initRecord!.status).toBe("failed");
    expect(initRecord!.error).toBe("scan-project.ts crashed");
  });

  it("updates checkpoint on completion", async () => {
    const { statePath } = createTestProject();

    const updated = await transitionPhase(statePath, "INIT", "completed", {
      nextPhase: "SCAN",
    });

    expect(updated.checkpoint.lastSuccessPhase).toBe("INIT");
    expect(updated.checkpoint.timestamp).toBeDefined();
  });

  it("creates new phase record when phase not in history", async () => {
    const { statePath } = createTestProject();

    // Transition to a phase not in initial history directly
    const updated = await transitionPhase(statePath, "SCAN", "completed", {
      nextPhase: "DEPENDENCY",
      artifacts: ["scan-result.json"],
    });

    const scanRecord = updated.phaseHistory.find((p) => p.phase === "SCAN");
    expect(scanRecord).toBeDefined();
    expect(scanRecord!.status).toBe("completed");
    expect(scanRecord!.artifacts).toContain("scan-result.json");
    expect(scanRecord!.startedAt).toBeDefined();
    expect(scanRecord!.completedAt).toBeDefined();
    expect(updated.currentPhase).toBe("DEPENDENCY");
  });

  it("records scripts executed", async () => {
    const { statePath } = createTestProject();

    const updated = await transitionPhase(statePath, "INIT", "completed", {
      nextPhase: "SCAN",
      scripts: [
        { script: "scan-project.ts", exitCode: 0, duration: "1.2s" },
        { script: "filter-styles.ts", exitCode: 0, duration: "0.5s" },
      ],
    });

    const initRecord = updated.phaseHistory.find((p) => p.phase === "INIT");
    expect(initRecord!.scriptsExecuted).toHaveLength(2);
    expect(initRecord!.scriptsExecuted![0].script).toBe("scan-project.ts");
    expect(initRecord!.scriptsExecuted![1].exitCode).toBe(0);
  });

  it("records output on completion", async () => {
    const { statePath } = createTestProject();

    const updated = await transitionPhase(statePath, "INIT", "completed", {
      nextPhase: "SCAN",
      output: "Scan completed: 42 files found",
    });

    const initRecord = updated.phaseHistory.find((p) => p.phase === "INIT");
    expect(initRecord!.output).toBe("Scan completed: 42 files found");
  });

  it("circuit breaker increments retry count on FEEDBACK", async () => {
    const { statePath } = createTestProject();

    const updated = await transitionPhase(statePath, "INIT", "failed", {
      nextPhase: "FEEDBACK",
    });

    expect(updated.checkpoint.retryCount).toBe(1);

    // Second retry
    await transitionPhase(statePath, "FEEDBACK", "completed", {
      nextPhase: "GEN",
    });

    await transitionPhase(statePath, "GEN", "failed", {
      nextPhase: "FEEDBACK",
    });

    const updated2State = await fs.readJson(statePath);
    expect(updated2State.checkpoint.retryCount).toBe(2);
  });

  it("circuit breaker escalates to DONE when retry limit exceeded", async () => {
    const { statePath } = createTestProject();
    const state = await fs.readJson(statePath);
    state.config.maxRetries = 2;
    state.checkpoint.retryCount = 2;
    await fs.writeJson(statePath, state);

    const updated = await transitionPhase(statePath, "GEN", "failed", {
      nextPhase: "FEEDBACK",
    });

    expect(updated.currentPhase).toBe("DONE");
    expect(updated.checkpoint.retryCount).toBe(3);
  });

  it("preserves currentPhase when no nextPhase given", async () => {
    const { statePath } = createTestProject();

    const updated = await transitionPhase(statePath, "INIT", "completed", {});

    expect(updated.currentPhase).toBe("INIT");
    const initRecord = updated.phaseHistory.find((p) => p.phase === "INIT");
    expect(initRecord!.status).toBe("completed");
  });
});

// === Tests: appendFeedback ===

describe("appendFeedback", () => {
  it("creates prompts.md if it does not exist", () => {
    const promptsPath = path.join(tmpDir, "prompts.md");

    appendFeedback(
      promptsPath,
      "GEN",
      "SubAgent timeout on folder src/components",
    );

    const content = fs.readFileSync(promptsPath, "utf-8");
    expect(content).toContain("aw-gen 改进");
    expect(content).toContain("SubAgent timeout on folder src/components");
  });

  it("appends without duplicating identical feedback", () => {
    const promptsPath = path.join(tmpDir, "prompts.md");

    appendFeedback(
      promptsPath,
      "GEN",
      "SubAgent timeout on folder src/components",
    );
    appendFeedback(
      promptsPath,
      "GEN",
      "SubAgent timeout on folder src/components",
    );

    const content = fs.readFileSync(promptsPath, "utf-8");
    // Should only appear once
    const matches = content.match(
      /SubAgent timeout on folder src\/components/g,
    );
    expect(matches).toHaveLength(1);
  });

  it("appends different feedback for same phase (no false dedup)", () => {
    const promptsPath = path.join(tmpDir, "prompts.md");

    appendFeedback(
      promptsPath,
      "GEN",
      "SubAgent timeout on folder src/components",
    );
    appendFeedback(promptsPath, "GEN", "Mermaid leak in folder src/hooks");

    const content = fs.readFileSync(promptsPath, "utf-8");
    // Both should be present — different root causes in same phase
    expect(content).toContain("src/components");
    expect(content).toContain("src/hooks");
    expect(content.match(/---/g)!.length).toBe(2);
  });

  it("appends different root causes for different folders", () => {
    const promptsPath = path.join(tmpDir, "prompts.md");

    appendFeedback(
      promptsPath,
      "GEN",
      "SubAgent timeout on folder src/pages/Home",
    );
    appendFeedback(
      promptsPath,
      "GEN",
      "SubAgent timeout on folder src/pages/Admin",
    );

    const content = fs.readFileSync(promptsPath, "utf-8");
    // Both should be present — different folders may have different root causes
    expect(content).toContain("src/pages/Home");
    expect(content).toContain("src/pages/Admin");
  });

  it("appends limit warning when lines exceed limit", () => {
    const promptsPath = path.join(tmpDir, "prompts.md");

    // Seed with enough lines to trigger limit
    const seedLines = Array.from({ length: 995 }, (_, i) => `Line ${i + 1}`);
    fs.writeFileSync(promptsPath, seedLines.join("\n"), "utf-8");

    appendFeedback(
      promptsPath,
      "GEN",
      "SubAgent timeout",
      1000, // limitLines = 1000
    );

    const content = fs.readFileSync(promptsPath, "utf-8");
    expect(content).toContain("⚠️ prompts.md 已超过");
    expect(content).toContain("SubAgent timeout");
  });

  it("no limit warning when lines are within limit", () => {
    const promptsPath = path.join(tmpDir, "prompts.md");

    // Small existing file
    fs.writeFileSync(promptsPath, "Some existing content\n", "utf-8");

    appendFeedback(promptsPath, "GEN", "SubAgent timeout", 1000);

    const content = fs.readFileSync(promptsPath, "utf-8");
    expect(content).not.toContain("⚠️");
    expect(content).toContain("SubAgent timeout");
  });

  it("handles append when prompts.md exists with content", () => {
    const promptsPath = path.join(tmpDir, "prompts.md");

    // Pre-create file with some content
    fs.writeFileSync(
      promptsPath,
      "# Existing feedback\n\nSome notes\n",
      "utf-8",
    );

    appendFeedback(promptsPath, "SCAN", "Missing file type detection");

    const content = fs.readFileSync(promptsPath, "utf-8");
    expect(content).toContain("# Existing feedback");
    expect(content).toContain("Missing file type detection");
    expect(content).toContain("aw-scan 改进");
  });
});

// === Tests: atomicUpdate ===

describe("atomicUpdate", () => {
  it("applies update function atomically", async () => {
    const statePath = createTestStatePath();
    const projectPath = path.join(tmpDir, "proj");
    const awRoot = path.join(tmpDir, "aw");
    const state = createInitialState(projectPath, awRoot);
    await fs.writeJson(statePath, state, { spaces: 2 });

    const updated = await atomicUpdate(statePath, (current) => ({
      ...current,
      currentPhase: "SCAN",
    }));

    expect(updated.currentPhase).toBe("SCAN");

    // Re-read from disk
    const onDisk = await fs.readJson(statePath);
    expect(onDisk.currentPhase).toBe("SCAN");
  });

  it("rolls back on update failure", async () => {
    const statePath = createTestStatePath();
    const projectPath = path.join(tmpDir, "proj");
    const awRoot = path.join(tmpDir, "aw");
    const state = createInitialState(projectPath, awRoot);
    await fs.writeJson(statePath, state, { spaces: 2 });

    const originalPhase = state.currentPhase;

    await expect(
      atomicUpdate(statePath, () => {
        throw new Error("update failed");
      }),
    ).rejects.toThrow("update failed");

    // State should be unchanged
    const onDisk = await fs.readJson(statePath);
    expect(onDisk.currentPhase).toBe(originalPhase);
  });

  it("rolls back on schema validation failure of updated state", async () => {
    const statePath = createTestStatePath();
    const projectPath = path.join(tmpDir, "proj");
    const awRoot = path.join(tmpDir, "aw");
    const state = createInitialState(projectPath, awRoot);
    await fs.writeJson(statePath, state, { spaces: 2 });

    const originalPhase = state.currentPhase;

    await expect(
      atomicUpdate(statePath, (current) => ({
        ...current,
        schemaVersion: 999, // Invalid — newer than current
      })),
    ).rejects.toThrow("newer");

    // State should be unchanged after rollback
    const onDisk = await fs.readJson(statePath);
    expect(onDisk.currentPhase).toBe(originalPhase);
    expect(onDisk.schemaVersion).toBe(1);
  });

  it("handles backup cleanup when no backup exists", async () => {
    const statePath = createTestStatePath();
    const projectPath = path.join(tmpDir, "proj");
    const awRoot = path.join(tmpDir, "aw");
    const state = createInitialState(projectPath, awRoot);
    await fs.writeJson(statePath, state, { spaces: 2 });

    // First update succeeds
    const updated = await atomicUpdate(statePath, (current) => ({
      ...current,
      currentPhase: "SCAN",
    }));

    expect(updated.currentPhase).toBe("SCAN");

    // Second update works with new backup
    const updated2 = await atomicUpdate(statePath, (current) => ({
      ...current,
      currentPhase: "DEPENDENCY",
    }));

    expect(updated2.currentPhase).toBe("DEPENDENCY");
  });
});
