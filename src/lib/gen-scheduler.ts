/**
 * GEN Scheduler — 从 folder-strategy.json + state.json 生成调度清单。
 *
 * 交叉比对 subTasks 与 genTasks 状态，过滤已完成任务，
 * 输出结构化的调度计划（含跳过列表、待执行列表、预构建 Prompt）。
 *
 * 替代编排器 Phase 2 Step 1-2 中约 130 行的手工交叉比对逻辑。
 *
 * Usage:
 *   npx tsx src/lib/gen-scheduler.ts \
 *     --strategy .agentic-wiki/cache/folder-strategy.json \
 *     --state    .agentic-wiki/state.json \
 *     --output   .agentic-wiki/cache/gen-schedule.json
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { sanitizePathId } from "./id-utils.js";
import type {
  WikiState,
  FolderStrategyResult,
  GenTask,
} from "../types/index.js";

// === Types ===

export type ScheduleAction = "skip" | "run" | "retry";

export interface ScheduleEntry {
  id: string;
  folder: string;
  role: string;
  label: string;
  action: ScheduleAction;
  reason: string;
  estimatedTokens: number;
  wikiChapter: string;
  files: string[];
  /** Ready-to-inject SubAgent prompt (excludes feedback injection — that's the orchestrator's job). */
  prompt: string;
}

export interface GenScheduleResult {
  generatedAt: string;
  /** Tasks that are already completed — skip. */
  skip: ScheduleEntry[];
  /** Tasks that need to be executed (first-time or retry), limited by --limit. */
  schedule: ScheduleEntry[];
  /** Summary statistics. */
  summary: {
    totalSubTasks: number;
    skipCount: number;
    runCount: number;
    retryCount: number;
    pendingCount: number;
    totalEstimatedTokens: number;
  };
}

// === Constants ===

function buildGenTaskLookup(
  genTasks: GenTask[] | undefined,
): Map<string, GenTask> {
  const map = new Map<string, GenTask>();
  if (!genTasks) return map;
  for (const task of genTasks) {
    map.set(task.id, task);
  }
  return map;
}

function buildSubTaskPrompt(
  entry: ScheduleEntry,
  projectRoot: string,
  state: WikiState,
): string {
  const budget = state.config.tokenBudgetPerSubTask || 80000;

  // Build the SubAgent prompt from aw-generate SKILL.md template
  const lines: string[] = [
    `你是 AgenticWiki GEN SubAgent。`,
    ``,
    `## 🔴 Issue 检测标准（最高优先级 — 已内联）`,
    ``,
    `> 完整的 6 种 IssueType 检测规则、严重等级决策矩阵、高频问题模式速查`,
    `> 均已在本 Skill 的 "🔴 Issue 类型约束" 章节中内联。**禁止读取任何外部文件**。`,
    ``,
    `**速查**：`,
    ``,
    `| 类型 | 维度 | 关键检测项 | 严重等级 |`,
    `|------|------|-----------|:---:|`,
    `| circular_dependency | 架构 | 子图 circular: true | ≥3模块=high |`,
    `| dead_code | 代码质量 | 导出0引用=high, 重复造轮子=medium | 0引用=high |`,
    `| missing_types | 类型安全 | any≥3处=high, 缺类型守卫/API无类型 | 核心接口=high |`,
    `| complex_logic | 规范+质量 | 组件>200行=high, 嵌套>4层=medium, Hook缺依赖 | 单文件超阈值=high |`,
    `| inconsistent_api | 代码质量 | 签名不一致=high, Props重复=medium | 同类组件不同=high |`,
    `| potential_bug | 性能+边界+副作用 | 内存泄漏/错误被吞/竞态/缺兜底=high | 运行时崩溃=high |`,
    ``,
    `### 🔴 Issue ID 编号规则（不可违反）`,
    ``,
    `- 格式：IS-{YYYY}-{NNN}，其中 YYYY 为当前年份，NNN 为 3 位递增序号`,
    `- 同一批次（同一次 GEN 运行）中，ID 必须从 IS-{YYYY}-001 开始递增`,
    `- 不同 Issue **绝对不能共享同一个 ID**`,
    `- 编号按 Issue 生成顺序递增，不按类型分组`,
    ``,
    `**Issue 文件路径**（按类型，而非源文件夹）：`,
    `- circular_dependency → wiki/volume-2-issues/ch-01-circular-deps/IS-{YYYY}-{NNN}.md`,
    `- dead_code → wiki/volume-2-issues/ch-02-dead-code/IS-{YYYY}-{NNN}.md`,
    `- missing_types → wiki/volume-2-issues/ch-03-missing-types/IS-{YYYY}-{NNN}.md`,
    `- complex_logic → wiki/volume-2-issues/ch-04-complex-logic/IS-{YYYY}-{NNN}.md`,
    `- inconsistent_api → wiki/volume-2-issues/ch-05-inconsistent-api/IS-{YYYY}-{NNN}.md`,
    `- potential_bug → wiki/volume-2-issues/ch-06-potential-bugs/IS-{YYYY}-{NNN}.md`,
    ``,
    `**Issue 输出格式**：`,
    ``,
    "```markdown",
    `---`,
    `id: IS-{YYYY}-{NNN}`,
    `type: {类型}`,
    `severity: {high|medium|low}`,
    `confidence: {high|medium|low}`,
    `status: detected`,
    `detected_at: <ISO时间戳>`,
    `detected_by: aw-generate`,
    `source_files:`,
    `  - {相对路径}`,
    `related_wiki:`,
    `  - "[[../../volume-1-code/{chapter}/index]]"`,
    `history:`,
    `  - at: <ISO时间戳>`,
    `    event: detected`,
    `    by: aw-generate`,
    `    note: "<模式>: <概述>"`,
    `---`,
    ``,
    `# IS-{id}：{简短标题}`,
    ``,
    `## 检测依据`,
    ``,
    `> 维度：{pi-code-reviewer 维度}`,
    `> 模式：{高频模式名称}`,
    `> 检测项：{具体检测项}`,
    ``,
    `**位置**：\`{file}:{line}\` — \`{函数名/组件名}\``,
    ``,
    `## 问题描述`,
    ``,
    `{2-3 句话}`,
    ``,
    `## 影响范围`,
    ``,
    `| 指标 | 值 |`,
    `|------|-----|`,
    `| 影响文件数 | {N} |`,
    `| 下游依赖数 | {N} |`,
    `| 风险 | {运行时崩溃 / 用户体验 / 维护性} |`,
    ``,
    `## 建议方案`,
    ``,
    `1. **{方案 1}**：{一句话 + 代码示例}`,
    `2. **{方案 2}**：{备选}`,
    ``,
    `## 相关 Wiki`,
    ``,
    `- [[../../volume-1-code/{chapter}/index]]`,
    ``,
    `## 状态时间线`,
    ``,
    `| 时间 | 事件 | 操作者 | 备注 |`,
    `|------|------|--------|------|`,
    `| <时间> | 🔍 发现 | aw-generate | {模式}: {概述} |`,
    "```",
    ``,
    `## 上下文`,
    ``,
    `项目根目录：${projectRoot}`,
    `  所有文件路径相对于此目录解析。`,
    `  读取文件时使用绝对路径：${projectRoot}/{relativePath}`,
    ``,
    `文件优先级清单：.agentic-wiki/cache/file-priorities.json`,
    `  完整路径：${projectRoot}/.agentic-wiki/cache/file-priorities.json`,
    ``,
    `依赖子图：.agentic-wiki/cache/deps/${path.basename(entry.folder)}-deps.json`,
    `  完整路径：${projectRoot}/.agentic-wiki/cache/deps/${path.basename(entry.folder)}-deps.json`,
    ``,
    `Wiki 输出：wiki/volume-1-code/${entry.wikiChapter}`,
    `  完整路径：${projectRoot}/wiki/volume-1-code/${entry.wikiChapter}`,
    ``,
    `Token 预算：${budget} tokens`,
    ``,
    `## 你的任务`,
    ``,
    `为文件夹 "${entry.folder}" 生成 Wiki 章节。**不要创建任何 JSON 文件。**`,
    ``,
    `### 步骤 0：解析路径`,
    ``,
    `所有路径相对于项目根目录 \`${projectRoot}\`。读取/写入时始终拼接为绝对路径。`,
    ``,
    `### 步骤 1：按优先级读取文件`,
    ``,
    `1. 读取 file-priorities.json（使用上述完整路径），找到文件夹 "${entry.folder}" 的条目`,
    `2. 读取所有 P0 文件（入口文件、桶文件）— **始终读取**`,
    `3. 在 token 预算允许的条件下读取 P1 文件（核心逻辑：组件、Hooks、状态管理）`,
    `4. 仅在 P0/P1 的 import 语句引用时读取 P2 文件（工具函数、类型定义）— **按需读取**`,
    `5. 跳过 P3 和 P4 文件（测试、样式）`,
    `6. 记录你实际读取了哪些文件`,
    ``,
    `### 步骤 2：生成 Wiki 章节`,
    ``,
    `使用 write_file 将输出写入完整路径：${projectRoot}/wiki/volume-1-code/${entry.wikiChapter}`,
    ``,
    `**必需章节**：`,
    `- YAML frontmatter（tags、lastUpdated、sourceFiles — 仅包含实际读取的文件）`,
    `- ## 概述（1-2 段，描述文件夹用途和包含内容）`,
    `- ## 组件/函数列表（表格：名称 | 类型 | 用途）`,
    `- ## 每个组件的详细说明（签名、Props、状态管理、依赖）`,
    `- ## 依赖关系（来自子图 JSON 的 Mermaid 图，≤ 20 个节点）`,
    `- ## 数据流（入：数据来源 | 出：数据去向 | 内：内部流转）`,
    `- ## 相关章节（Obsidian wiki 链接格式：[[../../volume-1-code/ch-nn/sec-name]]）`,
    `- ## 已知问题（🔴 必须收集该文件夹已有的 Issue，不可为空）`,
    ``,
    `### 步骤 2.5：🔴 收集已有 Issue（不可跳过）`,
    ``,
    `在生成 Wiki 之前，使用 \`find_path\` 扫描 \`wiki/volume-2-issues/\` 目录，查找 \`source_files\` 中包含当前文件夹路径的 Issue 文件。`,
    ``,
    `### 步骤 3：发现问题时创建 Issue`,
    ``,
    `按本 Prompt 中内联的检测标准评估。使用上述统一 Issue 输出模板。`,
    ``,
    `### 步骤 4：输出摘要`,
    ``,
    `简短报告：读取了哪些文件、收集到了哪些已有 Issue、发现了哪些新 Issue、预估 token 使用量。`,
    ``,
    `## 🔴 文件写入路径安全规则（最高优先级，违反即阻塞）`,
    ``,
    `### 规则 1：路径白名单`,
    `- 只能写入 \`wiki/volume-1-code/\` 和 \`wiki/volume-2-issues/\` 下的文件`,
    `- 禁止写入项目根目录、src/、.agentic-wiki/cache/`,
    ``,
    `### 规则 2：Mermaid 语法隔离`,
    `- Mermaid 代码块必须包裹在 \`\`\`mermaid 标记内`,
    `- 禁止在代码块外使用 \`[\` \`]\` \`{\` \`}\` 等 Mermaid 节点语法`,
    `- \`isSub=true\` 等边标签必须出现在 mermaid 代码块内`,
    ``,
    `### 规则 3：路径字符安全`,
    `- 文件名只能使用字母、数字、连字符、下划线`,
    `- 禁止创建以 \`[\` \`]\` \`{\` \`}\` \`(\` \`)\` 开头的文件`,
    ``,
    `### 规则 4：自检清单`,
    `- [ ] 所有 write_file 的目标路径以 \`wiki/\` 开头`,
    `- [ ] 所有 Mermaid 语法包裹在 \`\`\`mermaid 块内`,
    `- [ ] 没有创建包含特殊字符的文件`,
  ];

  return lines.join("\n");
}

// === Core Logic ===

export function buildGenSchedule(
  strategy: FolderStrategyResult,
  state: WikiState,
  projectRoot: string,
  limit?: number,
): GenScheduleResult {
  // === Input validation: detect incomplete folder-strategy ===
  let totalSubTasksInStrategy = 0;
  for (const folder of strategy.folders) {
    totalSubTasksInStrategy += folder.subTasks?.length || 0;
  }

  if (totalSubTasksInStrategy === 0) {
    const hasSubTasks = strategy.folders.some(
      (f) => f.subTasks && f.subTasks.length > 0,
    );
    const hasCrossFolderMerges =
      !!strategy.crossFolderMerges && strategy.crossFolderMerges.length > 0;

    if (!hasSubTasks && !hasCrossFolderMerges) {
      throw new Error(
        `[gen-scheduler] folder-strategy.json 不包含 subTasks。\n` +
          `原因：analyze-folders.ts 输入格式不正确，未生成 subTasks。\n` +
          `解决方案：\n` +
          `  1. 传入 file-priorities.json：--input .agentic-wiki/cache/file-priorities.json\n` +
          `  2. 或确保 analyze-folders.ts 已升级到最新版本\n` +
          `  3. 手动在 state.json 中添加已完成的 genTasks（不推荐）`,
      );
    }
  }
  // === End validation ===

  const genTaskLookup = buildGenTaskLookup(state.genTasks);
  const skip: ScheduleEntry[] = [];
  const schedule: ScheduleEntry[] = [];

  let totalSubTasks = 0;
  let runCount = 0;
  let retryCount = 0;

  // Process each folder's subTasks
  for (const folder of strategy.folders) {
    if (!folder.subTasks || folder.subTasks.length === 0) continue;

    for (const subTask of folder.subTasks) {
      totalSubTasks++;
      const genTask = genTaskLookup.get(subTask.id);

      const baseEntry = {
        id: subTask.id,
        folder: folder.path,
        role: subTask.role,
        label: subTask.label,
        estimatedTokens: subTask.estimatedTokens,
        wikiChapter: subTask.wikiChapter || "",
        files: [...subTask.files],
        prompt: "",
      };

      if (!genTask) {
        // First-time task
        runCount++;
        const entry: ScheduleEntry = {
          ...baseEntry,
          action: "run",
          reason: "首次调度",
          prompt: "",
        };
        entry.prompt = buildSubTaskPrompt(entry, projectRoot, state);
        schedule.push(entry);
      } else if (genTask.status === "completed") {
        skip.push({
          ...baseEntry,
          action: "skip",
          reason: "已完成",
          prompt: "",
        });
      } else if (
        genTask.status === "failed" ||
        genTask.status === "in_progress"
      ) {
        retryCount++;
        const reason =
          genTask.status === "failed" ? `上次失败` : `中断时未完成`;
        const entry: ScheduleEntry = {
          ...baseEntry,
          action: "retry",
          reason,
          prompt: "",
        };
        entry.prompt = buildSubTaskPrompt(entry, projectRoot, state);
        // Append retry instruction
        if (genTask.status === "failed") {
          entry.prompt += `\n\n## ⚠️ 重试指令\n上一次你声称生成完成但验证失败。本次必须用 write_file 工具实际写入文件。`;
        }
        schedule.push(entry);
      }
    }
  }

  // Process cross-folder merges
  if (strategy.crossFolderMerges) {
    for (const merge of strategy.crossFolderMerges) {
      totalSubTasks++;
      const genTask = genTaskLookup.get(merge.id);

      const baseEntry = {
        id: merge.id,
        folder: merge.folders.join(", "),
        role: `cross-${merge.label}`,
        label: merge.label,
        estimatedTokens: merge.estimatedTokens,
        wikiChapter: merge.wikiChapter,
        files: [...merge.files],
        prompt: "",
      };

      if (!genTask) {
        runCount++;
        const entry: ScheduleEntry = {
          ...baseEntry,
          action: "run",
          reason: "首次调度（跨文件夹合并）",
          prompt: "",
        };
        entry.prompt = buildSubTaskPrompt(entry, projectRoot, state);
        schedule.push(entry);
      } else if (genTask.status === "completed") {
        skip.push({
          ...baseEntry,
          action: "skip",
          reason: "已完成（跨文件夹合并）",
          prompt: "",
        });
      }
    }
  }

  // Count skips
  const skipCount = skip.length;

  // Sort schedule: retry first, then run (retries have priority)
  schedule.sort((a, b) => {
    const order: Record<ScheduleAction, number> = { skip: 2, run: 1, retry: 0 };
    return order[a.action] - order[b.action];
  });

  // Apply --limit: only take first N, defer rest to next batch
  let pendingFromLimit = 0;
  if (limit !== undefined && limit > 0 && schedule.length > limit) {
    pendingFromLimit = schedule.length - limit;
    schedule.length = limit;
  }

  // Pre-create genTasks entries for schedule items
  const newGenTasks: GenTask[] = [];
  const existingGenTasks = state.genTasks || [];
  const existingIds = new Set(existingGenTasks.map((t) => t.id));

  for (const entry of schedule) {
    if (!existingIds.has(entry.id)) {
      newGenTasks.push({
        id: entry.id,
        folder: entry.folder,
        role: entry.role,
        status: "pending",
        estimatedTokens: entry.estimatedTokens,
        wikiChapter: entry.wikiChapter,
      });
    }
  }

  const totalEstimatedTokens = schedule.reduce(
    (sum, e) => sum + e.estimatedTokens,
    0,
  );

  const result: GenScheduleResult = {
    generatedAt: new Date().toISOString(),
    skip,
    schedule,
    summary: {
      totalSubTasks,
      skipCount,
      runCount,
      retryCount,
      pendingCount: pendingFromLimit,
      totalEstimatedTokens,
    },
  };

  return result;
}

// === CLI Entry Point ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("strategy", {
      type: "string",
      demandOption: true,
      description: "Path to folder-strategy.json",
    })
    .option("state", {
      type: "string",
      demandOption: true,
      description: "Path to .agentic-wiki/state.json",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      description: "Output path for gen-schedule.json",
    })
    .option("limit", {
      type: "number",
      description: "Max tasks to schedule this batch (剩余任务下次继续)",
    })
    .parseSync();

  const strategy: FolderStrategyResult = await fs.readJson(argv.strategy);
  const state: WikiState = await fs.readJson(argv.state);
  const projectRoot = state.config.paths?.projectRoot || state.projectPath;

  const result = buildGenSchedule(strategy, state, projectRoot, argv.limit);

  // Write schedule (without prompts in JSON to keep it manageable)
  const { skip, schedule, summary } = result;
  const outputSchedule = schedule.map(({ prompt, ...rest }) => ({
    ...rest,
    promptTruncated: prompt.slice(0, 200) + "...",
  }));
  const outputSkip = skip.map(({ prompt, ...rest }) => rest);

  await fs.outputJson(
    argv.output,
    {
      generatedAt: result.generatedAt,
      skip: outputSkip,
      schedule: outputSchedule,
      summary,
    },
    { spaces: 2 },
  );

  // Also write prompts to individual files for SubAgent consumption
  const promptsDir = path.join(path.dirname(argv.output), "gen-prompts");
  await fs.ensureDir(promptsDir);
  for (const entry of schedule) {
    const promptFile = path.join(promptsDir, `${sanitizePathId(entry.id)}.md`);
    await fs.outputFile(promptFile, entry.prompt, "utf-8");
  }

  const batchNote = argv.limit
    ? "  [BATCH] " +
      (summary.runCount + summary.retryCount) +
      " tasks this round (limit=" +
      argv.limit +
      ", " +
      summary.pendingCount +
      " remaining)\n"
    : "";

  // Use template-free concatenation for safe CLI output
  const totalStr = String(summary.totalSubTasks);
  const skipStr = String(summary.skipCount);
  const runStr = String(summary.runCount);
  const retryStr = String(summary.retryCount);
  const tokenStr = String(summary.totalEstimatedTokens);

  process.stdout.write(
    "GEN Schedule:\n" +
      "  Total:  " +
      totalStr +
      " sub-tasks\n" +
      "  Skip:   " +
      skipStr +
      " (already completed)\n" +
      "  Run:    " +
      runStr +
      " (new)\n" +
      "  Retry:  " +
      retryStr +
      " (failed/interrupted)\n" +
      batchNote +
      "  Tokens: ~" +
      tokenStr +
      "\n" +
      "Written to " +
      argv.output +
      "\n" +
      "Prompts written to " +
      promptsDir +
      "/ (" +
      schedule.length +
      " files)\n",
  );
}

const isMainModule =
  process.argv[1]?.endsWith("gen-scheduler.ts") ||
  process.argv[1]?.endsWith("gen-scheduler.js");
if (isMainModule) main();
