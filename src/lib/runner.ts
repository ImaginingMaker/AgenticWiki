/**
 * runner.ts — 阶段编排运行器
 *
 * 负责解析路径、校验路径铁律、检测阶段完成状态、
 * 以及根据阶段返回对应的脚本定义。
 */

import path from "node:path";
import type { Phase, WikiState, WikiPaths } from "../types/index.js";

// === Script Definition ===

export interface ScriptDef {
  /** 可执行脚本名（如 "scan:project"） */
  name: string;
  /** 是否为关键脚本（失败则阻断阶段） */
  critical: boolean;
  /** 可选描述 */
  description?: string;
}

// === Phase Definition ===

export interface PhaseDefinition {
  phase: Phase;
  scripts: ScriptDef[];
  /** 是否需要 Agent 参与（如 GEN 阶段需要 LLM SubAgent） */
  requiresAgent?: boolean;
  /** 可选描述 */
  description?: string;
}

// ============================================================
// resolvePaths
// ============================================================

/**
 * 从 projectRoot 解析出 wikiRoot、cacheRoot、statePath。
 *
 * @param projectRoot - 被分析项目的根目录（绝对路径）
 * @returns 解析后的路径对象
 */
export function resolvePaths(projectRoot: string): {
  wikiRoot: string;
  cacheRoot: string;
  statePath: string;
} {
  // 规范化路径（去掉尾部斜杠）
  const normalized = projectRoot.replace(/\/+$/, "");

  return {
    wikiRoot: path.join(normalized, "wiki"),
    cacheRoot: path.join(normalized, ".agentic-wiki", "cache"),
    statePath: path.join(normalized, ".agentic-wiki", "state.json"),
  };
}

// ============================================================
// validatePathRules
// ============================================================

/**
 * 校验路径铁律。返回 false 表示违反关键规则。
 *
 * 规则：
 *   1. projectRoot ≠ agenticWikiRoot  — 防止 Wiki 写入 AgenticWiki 自身
 *   2. wikiRoot = projectRoot + "/wiki" — Wiki 必须输出到项目的 wiki/ 子目录
 *
 * @param paths - 包含 projectRoot / agenticWikiRoot / wikiRoot 的路径对象
 * @returns true 表示全部通过，false 表示存在违规
 */
export function validatePathRules(paths: WikiPaths): boolean {
  // Rule 1: projectRoot ≠ agenticWikiRoot
  if (paths.projectRoot === paths.agenticWikiRoot) {
    return false;
  }

  // Rule 2: wikiRoot = projectRoot + "/wiki"
  const expectedWikiRoot = path.join(paths.projectRoot, "wiki");
  if (path.resolve(paths.wikiRoot) !== path.resolve(expectedWikiRoot)) {
    return false;
  }

  return true;
}

// ============================================================
// isPhaseCompleted
// ============================================================

/**
 * 检查某阶段是否已完成。
 *
 * @param state   - Wiki 状态对象
 * @param phase   - 要检测的阶段
 * @returns true 表示该阶段在 phaseHistory 中有 completed 记录
 */
export function isPhaseCompleted(
  state: WikiState | null,
  phase: Phase,
): boolean {
  if (!state) return false;

  return state.phaseHistory.some(
    (record) => record.phase === phase && record.status === "completed",
  );
}

// ============================================================
// getCurrentPhase
// ============================================================

/**
 * 获取当前阶段。
 *
 * @param state - Wiki 状态对象
 * @returns 当前阶段名；若 state 为 null 则返回 "INIT"
 */
export function getCurrentPhase(state: WikiState | null): Phase {
  if (!state) return "INIT";
  return state.currentPhase;
}

// ============================================================
// getPhaseDefinition
// ============================================================

/**
 * 根据阶段返回其脚本定义。
 *
 * 阶段映射：
 *   INIT       → 2 个关键脚本（init 环境准备）
 *   SCAN       → 2 个脚本（第二个非关键，不阻断流程）
 *   DEPENDENCY → 5 个脚本
 *   GEN        → requiresAgent=true（LLM SubAgent 参与）
 *   其他       → null 表示不支持的阶段
 *
 * @param phase - 阶段名
 * @param paths - 路径配置（保留参数，供未来扩展脚本根据路径差异化）
 * @param args  - 额外参数（保留参数，供未来扩展）
 * @returns 阶段定义对象或 null
 */
export function getPhaseDefinition(
  phase: Phase,
  _paths?: WikiPaths,
  _args?: Record<string, unknown>,
): PhaseDefinition | null {
  switch (phase) {
    case "INIT":
      return {
        phase: "INIT",
        description: "初始化项目 Wiki 结构",
        scripts: [
          { name: "scan:project", critical: true, description: "扫描项目元信息" },
          { name: "state:transition", critical: true, description: "状态初始化" },
        ],
      };

    case "SCAN":
      return {
        phase: "SCAN",
        description: "扫描项目文件与结构",
        scripts: [
          { name: "scan:files", critical: true, description: "扫描并列出所有源文件" },
          {
            name: "scan:filter",
            critical: false,
            description: "过滤样式/测试等非核心文件（非关键）",
          },
        ],
      };

    case "DEPENDENCY":
      return {
        phase: "DEPENDENCY",
        description: "构建依赖图并分析",
        scripts: [
          { name: "deps:build", critical: true, description: "构建全量依赖图" },
          { name: "deps:extract", critical: true, description: "提取子图" },
          { name: "deps:diff", critical: true, description: "增量差异分析" },
          { name: "scan:folders", critical: true, description: "分析文件夹策略" },
          { name: "scan:priorities", critical: true, description: "文件优先级排序" },
        ],
      };

    case "GEN":
      return {
        phase: "GEN",
        description: "生成 Wiki 页面（需 Agent 参与）",
        requiresAgent: true,
        scripts: [],
      };

    default:
      return null;
  }
}
