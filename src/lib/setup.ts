/**
 * Setup utilities — directory creation and feedback seed initialization.
 *
 * Responsibilities:
 *   - Create required directory structure (ensureDirectories)
 *   - Initialize feedback seed file (ensureFeedbackSeed)
 *
 * Usage:
 *   import { ensureDirectories, ensureFeedbackSeed } from "./setup.js";
 */

import path from "node:path";
import fs from "fs-extra";
import type { ResolvedPaths } from "./path-resolver.js";

export function ensureDirectories(paths: ResolvedPaths): void {
  const root = paths.dataRoot;
  const dirs = [
    path.join(root, ".agentic-wiki", "cache", "deps"),
    path.join(root, ".agentic-wiki", "issues"),
    path.join(root, ".agentic-wiki", "feedback"),
    path.join(root, ".agentic-wiki", "search"),
    path.join(root, "wiki", "volume-1-code"),
    path.join(root, "wiki", "volume-2-issues"),
    path.join(root, "wiki", "volume-2-issues", "ch-01-circular-deps"),
    path.join(root, "wiki", "volume-2-issues", "ch-02-dead-code"),
    path.join(root, "wiki", "volume-2-issues", "ch-03-missing-types"),
    path.join(root, "wiki", "volume-2-issues", "ch-04-complex-logic"),
    path.join(root, "wiki", "volume-2-issues", "ch-05-inconsistent-api"),
    path.join(root, "wiki", "volume-2-issues", "ch-06-potential-bugs"),
    path.join(root, "wiki", "volume-2-issues", "ch-99-archived"),
  ];
  for (const dir of dirs) {
    fs.ensureDirSync(dir);
  }
}

export function ensureFeedbackSeed(feedbackRoot: string): void {
  const feedbackPath = path.join(feedbackRoot, ".agentic-wiki", "feedback", "prompts.md");
  if (fs.existsSync(feedbackPath)) return;

  const seed = [
    "# 反馈积累与策略改进",
    "",
    "> 此文件由 runner.ts 自动创建种子。失败时 recordFailure() 自动追加。",
    "> injectFeedbackIntoPrompts() 在每次 GEN 阶段自动加载。",
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
    "",
  ].join("\n");

  fs.writeFileSync(feedbackPath, seed, "utf-8");
  console.log("  ✅ 种子反馈已创建: .agentic-wiki/feedback/prompts.md");
}
