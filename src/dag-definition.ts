/**
 * DAG Definition — 流水线阶段的单一数据源。
 *
 * 当前编排器 Agent 需要手动记住 aw-orchestrator/SKILL.md 中的脚本调用顺序。
 * 此文件将 DAG 定义为代码级数据结构，使 Agent 可以程序化地获取：
 * - 当前阶段需要执行哪些脚本
 * - 哪些产物是门控检查必需的
 * - 阶段间依赖关系
 *
 * Agent 使用方式：
 *   1. 读取 dag-definition.ts 获取当前阶段的 scripts/gates
 *   2. 按 scripts 列表执行脚本
 *   3. 按 gates 列表运行门控
 *   4. 使用 transitions 确定下一阶段
 *
 * 淘汰：编排器 Agent 不再需要手动从 SKILL.md 文本中提取脚本调用序列。
 */

import type { Phase } from "./types/index.js";

// === Phase Definition ===

export interface PhaseDefinition {
  /** Phase identifier */
  id: Phase;
  /** Human-readable label */
  label: string;
  /** Scripts to run, in order. Each entry: [scriptName, isCritical] */
  scripts: Array<{ name: string; critical: boolean }>;
  /** Gate artifacts that must exist after phase completes */
  gates: Array<{ artifact: string; level: "CRITICAL" | "REQUIRED" }>;
  /** Whether this phase requires LLM (Agent) involvement */
  requiresAgent: boolean;
  /** Whether this phase uses SubAgent concurrency */
  usesSubAgents: boolean;
}

// === Phase Definitions ===

export const PHASES: Record<Phase, PhaseDefinition> = {
  INIT: {
    id: "INIT",
    label: "项目初始化 + 哈希基线 + 技术栈识别 + 路径自检",
    scripts: [
      { name: "scan-project.ts", critical: true },
      { name: "compute-hashes.ts", critical: true },
    ],
    gates: [
      { artifact: "project-scan.json", level: "CRITICAL" },
      { artifact: "state.json", level: "CRITICAL" },
    ],
    requiresAgent: true,
    usesSubAgents: false,
  },

  SCAN: {
    id: "SCAN",
    label: "文件扫描 + 样式过滤",
    scripts: [
      { name: "scan-files.ts", critical: true },
      { name: "filter-styles.ts", critical: false },
    ],
    gates: [
      { artifact: "file-list.json", level: "CRITICAL" },
      { artifact: "filtered-files.json", level: "REQUIRED" },
    ],
    requiresAgent: true,
    usesSubAgents: false,
  },

  DEPENDENCY: {
    id: "DEPENDENCY",
    label: "依赖图 + 优先级 + 拆分策略 + 子图提取",
    scripts: [
      { name: "build-deps.ts (JSON)", critical: true },
      { name: "build-deps.ts (Mermaid)", critical: false },
      { name: "file-priorities.ts", critical: true },
      { name: "analyze-folders.ts", critical: true },
      { name: "extract-subgraph.ts", critical: true },
    ],
    gates: [
      { artifact: "dependency-graph.json", level: "CRITICAL" },
      { artifact: "dependency-graph.mmd", level: "REQUIRED" },
      { artifact: "file-priorities.json", level: "CRITICAL" },
      { artifact: "folder-strategy.json", level: "CRITICAL" },
      { artifact: "cache/deps/*.json", level: "CRITICAL" },
    ],
    requiresAgent: true,
    usesSubAgents: false,
  },

  INCREMENTAL: {
    id: "INCREMENTAL",
    label: "Git diff + 依赖传播（增量模式）",
    scripts: [
      { name: "git-diff.ts", critical: true },
      { name: "extract-subgraph.ts", critical: true },
    ],
    gates: [
      { artifact: "incremental-analysis.json", level: "CRITICAL" },
    ],
    requiresAgent: true,
    usesSubAgents: false,
  },

  GEN: {
    id: "GEN",
    label: "SubAgent 并发 Wiki 生成 + Issue 发现 + 进度追踪",
    scripts: [
      { name: "gen-scheduler.ts (调度)", critical: true },
      { name: "verify-gen-artifacts.ts (产物验证)", critical: true },
      { name: "sync-gen-tasks.ts (进度同步)", critical: true },
      { name: "progress-dashboard.ts (进度面板)", critical: true },
    ],
    gates: [
      { artifact: "wiki/volume-1-code/", level: "CRITICAL" },
      { artifact: "gen-schedule.json", level: "CRITICAL" },
      { artifact: "wiki/PROGRESS.md", level: "REQUIRED" },
    ],
    requiresAgent: true,
    usesSubAgents: true,
  },

  ASSEMBLE: {
    id: "ASSEMBLE",
    label: "符号索引 + Issue 仪表盘 + 类型校验 + 组装成书",
    scripts: [
      { name: "symbol-index.ts", critical: true },
      { name: "fix-issue-paths.ts", critical: true },
      { name: "issue-dashboard.ts", critical: false },
      { name: "validate-issue-types.ts", critical: true },
      { name: "validate-issue-content.ts", critical: false },
      { name: "assemble-book.ts", critical: true },
    ],
    gates: [
      { artifact: "wiki/book.md", level: "CRITICAL" },
      { artifact: "wiki/glossary.md", level: "REQUIRED" },
      { artifact: "wiki/_toc.md (volume-1)", level: "CRITICAL" },
      { artifact: "wiki/_toc.md (volume-2)", level: "REQUIRED" },
      { artifact: "symbol-index.json", level: "CRITICAL" },
      { artifact: "issue-dashboard.md", level: "REQUIRED" },
    ],
    requiresAgent: true,
    usesSubAgents: false,
  },

  VALIDATE: {
    id: "VALIDATE",
    label: "交叉引用验证 + 源码引用校验",
    scripts: [
      { name: "validate-references.ts", critical: true },
      { name: "validate-code-refs.ts", critical: true },
    ],
    gates: [
      { artifact: "validation-report.json", level: "CRITICAL" },
    ],
    requiresAgent: true,
    usesSubAgents: false,
  },

  FEEDBACK: {
    id: "FEEDBACK",
    label: "验证失败时根因分析 + 回退重试 + 策略升级",
    scripts: [],
    gates: [],
    requiresAgent: true,
    usesSubAgents: false,
  },

  DONE: {
    id: "DONE",
    label: "流水线完成",
    scripts: [],
    gates: [],
    requiresAgent: false,
    usesSubAgents: false,
  },
};

// === Transition Map ===

/** All valid next-phase transitions from each phase. */
export const TRANSITIONS: Record<Phase, Phase[]> = {
  INIT: ["SCAN", "DONE"],
  SCAN: ["DEPENDENCY"],
  DEPENDENCY: ["GEN"],
  INCREMENTAL: ["GEN"],
  GEN: ["ASSEMBLE"],
  ASSEMBLE: ["VALIDATE"],
  VALIDATE: ["DONE", "FEEDBACK"],    // Conditional: FEEDBACK if errors
  FEEDBACK: ["GEN", "ASSEMBLE"],      // Backtrack to redo
  DONE: [],
};

// === Condition Routing ===

/** Conditions that determine branching at a phase boundary. */
export interface ConditionCheck {
  check: string;
  source: "project-scan.json" | "folder-strategy.json" | "state.json";
  key: string;
}

/**
 * Phase 1.5 条件路由定义。
 *
 * 编排器不再手工读取 3 个 JSON + if-else 判断，
 * 改为运行 `route-check.ts` 脚本获得结构化决策。
 *
 * Usage:
 *   npx tsx src/lib/route-check.ts \
 *     --project-scan   .agentic-wiki/cache/project-scan.json \
 *     --folder-strategy .agentic-wiki/cache/folder-strategy.json \
 *     --state          .agentic-wiki/state.json
 */
export const CONDITION_ROUTES = {
  PRE_GEN: {
    checks: [
      { check: "totalFiles > 0", source: "project-scan.json" as const, key: "totalFiles" },
      { check: "foldersToAnalyze > 0", source: "folder-strategy.json" as const, key: "foldersToAnalyze" },
    ],
    routing: {
      empty: { condition: "totalFiles === 0", action: "goto DONE" },
      noFolders: { condition: "foldersToAnalyze === 0", action: "warn + goto DONE" },
      allCompleted: { condition: "all genTasks completed", action: "skip GEN → goto ASSEMBLE" },
      partial: { condition: "some genTasks pending", action: "enter GEN (auto-skip completed)" },
    },
  },
};

// === Script Command Builder ===

/**
 * Generate the terminal command for a given script.
 * All scripts follow the pattern: `npx tsx src/lib/<name> [args...]`
 */
export function buildScriptCommand(
  scriptName: string,
  agenticWikiRoot: string,
  extraArgs: string[] = [],
): string {
  return `npx tsx "${agenticWikiRoot}/src/lib/${scriptName}" ${extraArgs.join(" ")}`.trim();
}

// === Artifact Path Builder ===

/**
 * Get the expected path of a gate artifact.
 */
export function resolveArtifactPath(
  artifact: string,
  projectRoot: string,
): string {
  const cacheRoot = `${projectRoot}/.agentic-wiki/cache`;
  const wikiRoot = `${projectRoot}/wiki`;

  // Handle glob patterns
  if (artifact.includes("*")) {
    return `${cacheRoot}/${artifact}`;
  }

  // Known prefixes
  if (artifact.startsWith("wiki/")) {
    return `${projectRoot}/${artifact}`;
  }
  if (artifact.startsWith("cache/")) {
    return `${projectRoot}/.agentic-wiki/${artifact}`;
  }
  if (artifact.endsWith(".json")) {
    return `${cacheRoot}/${artifact}`;
  }
  if (artifact.endsWith(".md")) {
    return `${wikiRoot}/${artifact}`;
  }

  return `${projectRoot}/${artifact}`;
}

// === Unit Tests ===

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("dag-definition", () => {
    it("all phases have valid transitions", () => {
      for (const [phase, def] of Object.entries(PHASES)) {
        const transitions = TRANSITIONS[phase as Phase];
        expect(transitions).toBeDefined();
        for (const next of transitions) {
          expect(PHASES[next]).toBeDefined();
        }
      }
    });

    it("INIT → SCAN → DEPENDENCY → GEN → ASSEMBLE → VALIDATE chain", () => {
      expect(TRANSITIONS.INIT).toContain("SCAN");
      expect(TRANSITIONS.SCAN).toContain("DEPENDENCY");
      expect(TRANSITIONS.DEPENDENCY).toContain("GEN");
      expect(TRANSITIONS.GEN).toContain("ASSEMBLE");
      expect(TRANSITIONS.ASSEMBLE).toContain("VALIDATE");
      expect(TRANSITIONS.VALIDATE).toContain("DONE");
    });

    it("DEPENDENCY phase has 5 scripts", () => {
      expect(PHASES.DEPENDENCY.scripts.length).toBe(5);
    });

    it("GEN phase requires agent and uses sub-agents", () => {
      expect(PHASES.GEN.requiresAgent).toBe(true);
      expect(PHASES.GEN.usesSubAgents).toBe(true);
    });

    it("DONE phase has no scripts and no gates", () => {
      expect(PHASES.DONE.scripts).toHaveLength(0);
      expect(PHASES.DONE.gates).toHaveLength(0);
      expect(PHASES.DONE.requiresAgent).toBe(false);
    });
  });
}
