/**
 * 路径铁律独立验证脚本。
 *
 * 从 state-manager.ts 中提取路径校验逻辑，使其可独立作为门控脚本运行。
 * 解决痛点：路径铁律依赖于 Agent "自我检查"但缺少自动化运行时检测。
 *
 * 用法：
 *   npx tsx src/lib/validate-paths.ts --state ./.agentic-wiki/state.json
 *
 * 退出码：
 *   0 — 全部路径规则通过
 *   1 — 未通过（违反一条或多条）
 *   2 — 脚本错误（state.json 不存在、格式错误等）
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { WikiState } from "../types/index.js";

// === Rule Definitions ===

interface PathRule {
  id: string;
  label: string;
  level: "CRITICAL" | "REQUIRED";
  description: string;
  check(state: WikiState): {
    passed: boolean;
    expected: string;
    actual: string;
    detail: string;
  };
}

const RULES: PathRule[] = [
  // Rule 1: projectRoot ≠ agenticWikiRoot
  {
    id: "PATH-001",
    label: "projectRoot ≠ agenticWikiRoot",
    level: "CRITICAL",
    description:
      "被分析项目的根目录不能等于 AgenticWiki 自身目录。避免 Wiki 写入 AgenticWiki 自身。",
    check(state: WikiState) {
      const p = state.config.paths!;
      const ok = p.projectRoot !== p.agenticWikiRoot;
      return {
        passed: ok,
        expected: `projectRoot (${p.projectRoot}) ≠ agenticWikiRoot (${p.agenticWikiRoot})`,
        actual: ok
          ? "OK (paths are distinct)"
          : `EQUAL — 会导致 Wiki 写入 AgenticWiki 根目录！`,
        detail: ok
          ? `projectRoot=${p.projectRoot}, agenticWikiRoot=${p.agenticWikiRoot}`
          : `两个路径完全相同: ${p.projectRoot}`,
      };
    },
  },

  // Rule 2: wikiRoot = projectRoot + "/wiki"
  {
    id: "PATH-002",
    label: "wikiRoot = projectRoot + '/wiki'",
    level: "CRITICAL",
    description: "Wiki 输出必须位于被分析项目的 wiki/ 子目录下。",
    check(state: WikiState) {
      const p = state.config.paths!;
      const expected = path.join(p.projectRoot, "wiki");
      const ok = path.resolve(p.wikiRoot) === path.resolve(expected);
      return {
        passed: ok,
        expected,
        actual: p.wikiRoot,
        detail: ok
          ? `wikiRoot 正确地位于 projectRoot 下`
          : `预期 '${expected}'，实际 '${p.wikiRoot}'`,
      };
    },
  },

  // Rule 3: cacheRoot under projectRoot
  {
    id: "PATH-003",
    label: "cacheRoot under projectRoot",
    level: "CRITICAL",
    description: ".agentic-wiki/ 缓存目录必须在被分析项目的根目录下。",
    check(state: WikiState) {
      const p = state.config.paths!;
      const ok = path
        .resolve(p.cacheRoot)
        .startsWith(path.resolve(p.projectRoot));
      return {
        passed: ok,
        expected: `Starts with ${p.projectRoot}`,
        actual: ok ? "OK" : `${p.cacheRoot} 不在 projectRoot 下`,
        detail: ok
          ? `cacheRoot=${p.cacheRoot} 在 projectRoot 内`
          : `cacheRoot '${p.cacheRoot}' 不在 projectRoot '${p.projectRoot}' 下`,
      };
    },
  },

  // Rule 4: sourceRoot under projectRoot
  {
    id: "PATH-004",
    label: "sourceRoot under projectRoot",
    level: "REQUIRED",
    description: "源码根目录必须在被分析项目内。",
    check(state: WikiState) {
      const p = state.config.paths!;
      const ok = path
        .resolve(p.sourceRoot)
        .startsWith(path.resolve(p.projectRoot));
      return {
        passed: ok,
        expected: `Starts with ${p.projectRoot}`,
        actual: ok ? "OK" : `${p.sourceRoot} 不在 projectRoot 下`,
        detail: ok
          ? `sourceRoot=${p.sourceRoot} 在 projectRoot 内`
          : `sourceRoot '${p.sourceRoot}' 不在 projectRoot '${p.projectRoot}' 下`,
      };
    },
  },

  // Rule 5: projectRoot exists and contains code
  {
    id: "PATH-005",
    label: "projectRoot exists with source code",
    level: "CRITICAL",
    description: "被分析项目目录必须存在且包含 package.json 或 src/ 目录。",
    check(state: WikiState) {
      const p = state.config.paths!;
      let ok = false;
      let detail = "";

      try {
        if (fs.existsSync(p.projectRoot)) {
          const hasPkg = fs.existsSync(
            path.join(p.projectRoot, "package.json"),
          );
          const hasSrc = fs.existsSync(path.join(p.projectRoot, "src"));
          if (hasPkg || hasSrc) {
            ok = true;
            detail = hasPkg ? "包含 package.json" : "包含 src/ 目录";
          } else {
            detail = "目录存在但未找到 package.json 或 src/";
          }
        } else {
          detail = `目录 '${p.projectRoot}' 不存在`;
        }
      } catch (e: any) {
        detail = `无法访问 projectRoot: ${e.message}`;
      }

      return {
        passed: ok,
        expected: "目录存在且包含 package.json 或 src/",
        actual: ok ? "OK" : "FAIL",
        detail,
      };
    },
  },

  // Rule 6: projectRoot does not contain AgenticWiki feature files
  {
    id: "PATH-006",
    label: "projectRoot is NOT AgenticWiki itself",
    level: "CRITICAL",
    description:
      "被分析项目不能是 AgenticWiki 自身（检测特征文件 agents.md 和 skills/ 目录）。",
    check(state: WikiState) {
      const p = state.config.paths!;
      const hasAgentsMd = fs.existsSync(path.join(p.projectRoot, "agents.md"));
      const hasSkills = fs.existsSync(path.join(p.projectRoot, "skills"));
      const isAgenticWiki = hasAgentsMd && hasSkills;
      return {
        passed: !isAgenticWiki,
        expected: "projectRoot 不包含 agents.md + skills/",
        actual: isAgenticWiki
          ? `检测到 agents.md + skills/ — 这看起来是 AgenticWiki 自身！`
          : "OK (非 AgenticWiki)",
        detail: isAgenticWiki
          ? `特征文件: agents.md=${hasAgentsMd}, skills/=${hasSkills}`
          : "正常项目，无 AgenticWiki 特征文件",
      };
    },
  },
];

// === Main Logic ===

export interface PathValidationResult {
  validatedAt: string;
  statePath: string;
  passed: boolean;
  criticalFailed: number;
  requiredFailed: number;
  rules: Array<{
    id: string;
    label: string;
    level: string;
    passed: boolean;
    description: string;
    expected: string;
    actual: string;
    detail: string;
  }>;
}

export function validateAllPaths(
  state: WikiState,
  statePath: string,
): PathValidationResult {
  if (!state.config.paths) {
    return {
      validatedAt: new Date().toISOString(),
      statePath,
      passed: false,
      criticalFailed: 1,
      requiredFailed: 0,
      rules: [
        {
          id: "PATH-000",
          label: "config.paths exists",
          level: "CRITICAL",
          passed: false,
          description: "state.json 缺少 config.paths 配置",
          expected: "config.paths 对象存在",
          actual: "MISSING",
          detail: "state.json 未初始化 — 运行 aw-init 创建",
        },
      ],
    };
  }

  const results = RULES.map((rule) => {
    const result = rule.check(state);
    return {
      id: rule.id,
      label: rule.label,
      level: rule.level,
      description: rule.description,
      ...result,
    };
  });

  const criticalFailed = results.filter(
    (r) => !r.passed && r.level === "CRITICAL",
  ).length;
  const requiredFailed = results.filter(
    (r) => !r.passed && r.level === "REQUIRED",
  ).length;

  return {
    validatedAt: new Date().toISOString(),
    statePath,
    passed: criticalFailed === 0,
    criticalFailed,
    requiredFailed,
    rules: results,
  };
}

// === CLI Entry Point ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("state", {
      type: "string",
      demandOption: true,
      description: "Path to state.json",
    })
    .option("format", {
      type: "string",
      choices: ["text", "json"],
      default: "text",
      description: "Output format (text for human, json for Agent)",
    })
    .option("json-output", {
      type: "string",
      description: "Also write JSON result to this file",
    })
    .parseSync();

  // Read state
  if (!(await fs.pathExists(argv.state))) {
    process.stderr.write(
      `❌ CRITICAL: state.json not found at ${argv.state}. Run aw-init first.\n`,
    );
    process.exit(2);
  }

  let state: WikiState;
  try {
    state = await fs.readJson(argv.state);
  } catch (e: any) {
    process.stderr.write(
      `❌ CRITICAL: Failed to parse state.json: ${e.message}\n`,
    );
    process.exit(2);
  }

  const result = validateAllPaths(state, path.resolve(argv.state));

  // Output
  if (argv.format === "json") {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    // Human-readable output
    process.stdout.write(`🔴 Path Iron Law Validation\n`);
    process.stdout.write(`   State:   ${result.statePath}\n`);
    process.stdout.write(
      `   Project: ${state.config.paths?.projectRoot || "N/A"}\n`,
    );
    process.stdout.write(
      `   CRITICAL: ${result.criticalFailed} failed, REQUIRED: ${result.requiredFailed} failed\n\n`,
    );

    for (const rule of result.rules) {
      const icon = rule.passed ? "✅" : "❌";
      const level = rule.level === "CRITICAL" ? "🔴" : "🟡";
      process.stdout.write(`  ${icon} ${level} ${rule.label}\n`);
      if (!rule.passed) {
        process.stdout.write(`     Expected: ${rule.expected}\n`);
        process.stdout.write(`     Actual:   ${rule.actual}\n`);
        process.stdout.write(`     Detail:   ${rule.detail}\n`);
      }
    }

    process.stdout.write(`\n`);
    if (result.passed) {
      process.stdout.write(`✅ 全部 ${result.rules.length} 条路径规则通过。\n`);
    } else {
      process.stderr.write(
        `❌ ${result.criticalFailed} 条 CRITICAL 规则未通过。请修复后重试。\n`,
      );
    }
  }

  // Optional JSON output file
  if (argv["json-output"]) {
    await fs.outputJson(argv["json-output"], result, { spaces: 2 });
  }

  // Exit code: 0 if all CRITICAL pass, 1 otherwise
  process.exit(result.passed ? 0 : 1);
}

const isMainModule =
  process.argv[1]?.endsWith("validate-paths.ts") ||
  process.argv[1]?.endsWith("validate-paths.js");
if (isMainModule) main();
