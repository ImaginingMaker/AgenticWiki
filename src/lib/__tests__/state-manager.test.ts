/**
 * state-manager.ts 单元测试
 *
 * 覆盖核心功能：createInitialState、validatePaths、atomicUpdate、
 * transitionPhase、appendFeedback、schema version validation。
 *
 * 之前：state-manager.ts (~1000行) 零测试覆盖。
 * 现在：核心路径全部有测试。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
} from "../state-manager.js";

import type { WikiState } from "../../types/index.js";

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
    expect(state.config.maxConcurrentSubAgents).toBe(5);
    expect(state.config.tokenBudgetPerSubTask).toBe(80000);
    expect(state.config.paths).toBeDefined();
    expect(state.config.paths!.projectRoot).toBe(projectPath);
    expect(state.config.paths!.agenticWikiRoot).toBe(agenticRoot);
    expect(state.config.paths!.wikiRoot).toBe(
      path.join(projectPath, "wiki"),
    );
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
      { mode: "single-folder" },
    );
    expect(state.config.mode).toBe("single-folder");
  });

  it("resolves absolute source path when relative is given", () => {
    const projectPath = path.join(tmpDir, "proj");
    const state = createInitialState(
      projectPath,
      path.join(tmpDir, "aw"),
      { source: "app/src" },
    );
    expect(state.config.sourcePath).toBe("app/src/");
    expect(state.config.paths!.sourceRoot).toBe(
      path.join(projectPath, "app/src"),
    );
  });
});

// === Tests: validatePaths ===

describe("validatePaths", () => {
  it("passes when all paths are correct", () => {
    const { projectPath, agenticWikiRoot, statePath } = createTestProject();
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
    (state as any).config.paths.wikiRoot = wrongWiki;

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
    (state as any).config.paths = undefined;

    const result = validatePaths(state);
    expect(result.passed).toBe(false);
    expect(result.checks[0].rule).toContain("config.paths");
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
    (state as any).schemaVersion = undefined;
    expect(() => validateSchemaVersion(state)).toThrow("missing");
  });

  it("rejects newer schema version", () => {
    const state = createInitialState(
      path.join(tmpDir, "proj"),
      path.join(tmpDir, "aw"),
    );
    (state as any).schemaVersion = 999;
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
    (state as any).config = undefined;
    const errors = validateStructure(state);
    expect(errors.some((e) => e.includes("config"))).toBe(true);
  });
});

// === Tests: transitionPhase ===

describe("transitionPhase", () => {
  it("transitions INIT -> SCAN", async () => {
    const { statePath, projectPath, agenticWikiRoot } = createTestProject();

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
});

// === Tests: appendFeedback ===

describe("appendFeedback", () => {
  it("creates prompts.md if it does not exist", () => {
    const promptsPath = path.join(tmpDir, "prompts.md");

    appendFeedback(promptsPath, "GEN", "SubAgent timeout on folder src/components");

    const content = fs.readFileSync(promptsPath, "utf-8");
    expect(content).toContain("aw-gen 改进");
    expect(content).toContain("SubAgent timeout on folder src/components");
  });

  it("appends without duplicating identical feedback", () => {
    const promptsPath = path.join(tmpDir, "prompts.md");

    appendFeedback(promptsPath, "GEN", "SubAgent timeout on folder src/components");
    appendFeedback(promptsPath, "GEN", "SubAgent timeout on folder src/components");

    const content = fs.readFileSync(promptsPath, "utf-8");
    // Should only appear once
    const matches = content.match(/SubAgent timeout on folder src\/components/g);
    expect(matches).toHaveLength(1);
  });

  it("appends different feedback for same phase (no false dedup)", () => {
    const promptsPath = path.join(tmpDir, "prompts.md");

    appendFeedback(promptsPath, "GEN", "SubAgent timeout on folder src/components");
    appendFeedback(promptsPath, "GEN", "Mermaid leak in folder src/hooks");

    const content = fs.readFileSync(promptsPath, "utf-8");
    // Both should be present — different root causes in same phase
    expect(content).toContain("src/components");
    expect(content).toContain("src/hooks");
    expect(content.match(/---/g)!.length).toBe(2);
  });

  it("appends different root causes for different folders", () => {
    const promptsPath = path.join(tmpDir, "prompts.md");

    appendFeedback(promptsPath, "GEN", "SubAgent timeout on folder src/pages/Home");
    appendFeedback(promptsPath, "GEN", "SubAgent timeout on folder src/pages/Admin");

    const content = fs.readFileSync(promptsPath, "utf-8");
    // Both should be present — different folders may have different root causes
    expect(content).toContain("src/pages/Home");
    expect(content).toContain("src/pages/Admin");
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
});
