/**
 * GEN Scheduler — 从 folder-strategy.json + state.json 生成调度清单。
 *
 * 交叉比对 subTasks 与 genTasks 状态，过滤已完成任务，
 * 输出结构化的调度计划（含跳过列表、待执行列表、预构建 Prompt）。
 *
 * 替代编排器 Phase 2 Step 1-2 中约 130 行的手工交叉比对逻辑。
 *
 * Usage:
 *   npx tsx src/lib/gen/gen-scheduler.ts \
 *     --strategy .agentic-wiki/cache/folder-strategy.json \
 *     --state    .agentic-wiki/state.json \
 *     --output   .agentic-wiki/cache/gen-schedule.json
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { sanitizePathId } from "../shared/id-utils.js";
import { atomicUpdate } from "../shared/state-manager.js";
import {
  MAX_SUBAGENT_BUDGET,
  MIN_SUBAGENT_BUDGET,
  BUDGET_BRACKET_SMALL,
  BUDGET_BRACKET_MEDIUM,
  BUDGET_MULT_SMALL,
  BUDGET_MULT_MEDIUM,
  BUDGET_MULT_LARGE,
  BUDGET_BUFFER_SMALL,
  BUDGET_BUFFER_MEDIUM,
  BUDGET_BUFFER_LARGE,
  PROJECT_BUDGET_RATIO,
  ISSUE_ID_GAP,
} from "../shared/constants.js";
import type {
  WikiState,
  FolderStrategyResult,
  GenTask,
  ArtifactVolume,
} from "../../types/index.js";
import { ALL_VOLUMES } from "../../types/index.js";
import type {
  ClusterTaskResult,
  TaskCluster,
} from "../dependency/cluster-tasks.js";

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
    dedupSkipped?: number;
  };
}

// === Constants ===

/**
 * Token budget v3 — dynamic scaling for 1M context models.
 *
 * Small tasks (≤10K): generous buffer for exploration
 * Medium tasks (10K-50K): moderate buffer
 * Large tasks (>50K): lean buffer, cap at 300K
 */
export function calcTokenBudget(
  estimatedTokens: number,
  projectTotalTokens?: number,
): number {
  let budget: number;
  if (estimatedTokens <= BUDGET_BRACKET_SMALL) {
    budget = estimatedTokens * BUDGET_MULT_SMALL + BUDGET_BUFFER_SMALL;
  } else if (estimatedTokens <= BUDGET_BRACKET_MEDIUM) {
    budget = estimatedTokens * BUDGET_MULT_MEDIUM + BUDGET_BUFFER_MEDIUM;
  } else {
    budget = estimatedTokens * BUDGET_MULT_LARGE + BUDGET_BUFFER_LARGE;
  }

  // Cap at PROJECT_BUDGET_RATIO of project total
  if (projectTotalTokens && projectTotalTokens > 0) {
    budget = Math.min(budget, projectTotalTokens * PROJECT_BUDGET_RATIO);
  }

  return Math.max(
    MIN_SUBAGENT_BUDGET,
    Math.min(MAX_SUBAGENT_BUDGET, Math.round(budget)),
  );
}

/**
 * Shared Issue detection rules section — used by all prompt builders.
 * Replaces the old getIssueRulesTemplate() + getOutputFormatTemplate() +
 * getPathSafetyTemplate() + ensureTemplates() dead code.
 */
function buildIssueRulesSection(
  issueIdStart: number,
  issueIdGap: number,
): string {
  const issueIdEnd = issueIdStart + issueIdGap - 1;
  return [
    `## ⚡ 规则内联（已嵌入，无需额外读取模板文件）`,
    ``,
    `### Issue 检测标准（3 层优先级体系）`,
    `分类原则：`,
    `- 🔴 P0: 功能正确性 — 运行时崩溃/数据错误/安全漏洞 → critical/high`,
    `- 🟡 P1: 代码健康 — 类型安全/性能债 → high/medium`,
    `- 🟢 P2: 优化建议 — 不影响运行但影响维护 → medium/low`,
    ``,
    `| 类型 | 层级 | 维度 | 关键检测项 | 典型严重等级 |`,
    `|------|:---:|------|-----------|:---:|`,
    `| bug | 🔴 P0 | 运行时 | 空值访问、错误被吞、闭包陷阱、竞态、内存泄漏、循环依赖 | critical/high |`,
    `| security | 🔴 P0 | 安全 | XSS(dangerouslySetInnerHTML)、JSON.parse无try-catch、敏感数据硬编码 | critical/high |`,
    `| typescript | 🟡 P1 | 类型 | any≥3处=high, 缺Props接口, @ts-ignore/类型断言逃逸, API未类型化 | high/medium |`,
    `| performance | 🟡 P1 | 性能 | 不必要渲染(useState→useMemo)、大列表无虚拟化、useCallback缺依赖 | high/medium |`,
    `| dead_code | 🟢 P2 | 代码 | 注释代码块、未使用导入、死状态/死变量、console.log残留、废弃API | medium/low |`,
    `| complexity | 🟢 P2 | 规范 | 组件>200行, 单个函数>100行, 嵌套>4层, 职责过多 | medium/low |`,
    `| maintainability | 🟢 P2 | 质量 | 重复代码应抽取为工具函数、Magic Number、命名不一致、Props重复 | low |`,
    `| ux | 🟢 P2 | 体验 | 缺loading状态、空状态无提示、错误反馈缺失、操作确认提示缺失 | low |`,
    ``,
    `### ⚠️ 严重等级与优先级的关系`,
    `| Severity | 含义 | 对应层级 | 响应要求 |`,
    `|:---|:---|:---:|:---|`,
    `| critical | 运行时崩溃 / 数据丢失 / 安全漏洞 | P0 | 必须立即修复 |`,
    `| high | 逻辑错误 / 输出不正确 | P0/P1 | 应尽快修复 |`,
    `| medium | 性能退化 / 类型不安全 | P1/P2 | 计划修复 |`,
    `| low | 代码风格 / UX 打磨 / 维护性 | P2 | 有空再修 |`,
    ``,
    `**Issue ID 范围：IS-${String(issueIdStart).padStart(4, "0")} 至 IS-${String(issueIdEnd).padStart(4, "0")}**`,
    `每发现一个新 Issue 序号递增 1，严格在此范围内创建，不得超出。`,
    ``,
    `**Issue 文件路径**（按类型）：`,
    `- bug → ch-01-bugs/IS-{NNNN}-{SEVERITY}-{slug}.md`,
    `- security → ch-02-security/IS-{NNNN}-{SEVERITY}-{slug}.md`,
    `- typescript → ch-03-typescript/IS-{NNNN}-{SEVERITY}-{slug}.md`,
    `- performance → ch-04-performance/IS-{NNNN}-{SEVERITY}-{slug}.md`,
    `- dead_code → ch-05-dead-code/IS-{NNNN}-{SEVERITY}-{slug}.md`,
    `- complexity → ch-06-complexity/IS-{NNNN}-{SEVERITY}-{slug}.md`,
    `- maintainability → ch-07-maintainability/IS-{NNNN}-{SEVERITY}-{slug}.md`,
    `- ux → ch-08-ux/IS-{NNNN}-{SEVERITY}-{slug}.md`,
    ``,
    `### Issue 输出格式（YAML frontmatter 模板）`,
    `\`\`\`yaml`,
    `id: IS-{NNNN}-{SEVERITY}-{slug}`,
    `type: {bug|security|typescript|performance|dead_code|complexity|maintainability|ux}`,
    `severity: {critical|high|medium|low}`,
    `confidence: {high|medium|low}`,
    `status: detected`,
    `detected_at: <ISO时间戳>`,
    `source_files:`,
    `  - {相对路径}`,
    `\`\`\``,
    `**type 字段不加引号**：正确写法 \`type: bug\`，错误写法 \`type: "bug"\``,
    ``,
    `### 路径安全规则（红线）`,
    `- 只能写入 \`wiki/volume-1-code/\` 和 \`wiki/volume-2-issues/\` 下`,
    `- Mermaid 必须包裹在 \`\`\`mermaid 块内`,
    `- 文件名只使用字母、数字、连字符、下划线`,
  ].join("\n");
}

/**
 * 12-chapter wiki structure requirements (G3).
 */
function buildChapterRequirements(): string {
  return [
    `**必需章节**（严格按照以下顺序和结构生成）：`,
    ``,
    `- YAML frontmatter（tags、lastUpdated、sourceFiles）`,
    `- ## 目录（章节号 + 标题列表）`,
    `- ## 1. 需求背景（从代码注释/命名/调用上下文推断业务意图）`,
    `- ## 2. 架构概述（整体架构、设计模式、项目定位）`,
    `- ## 3. 组件/函数清单（表格：名称 | 类型 | 用途 | 源文件）`,
    `- ## 4. 技术实现方案（核心实现思路、关键算法/模式、状态管理）`,
    `- ## 5. 实现细节（签名、Props、状态管理、生命周期、错误处理）`,
    `- ## 6. 依赖关系（Mermaid 图 ≤ 30 节点 + 外部/内部依赖说明）`,
    `- ## 7. 数据流（入：来源 | 出：去向 | 内：流转）`,
    `- ## 8. 公共组件索引清单（导出名 | 导入路径 | 签名 | 示例）`,
    `- ## 9. 设计决策与替代方案（推断的设计选择与技术权衡）`,
    `- ## 10. 使用示例（外部代码如何引用，从 dependents 提取或构造）`,
    `- ## 11. Issue 分析（11.1 已知 + 11.2 新发现 + 11.3 汇总表）`,
    `- ## 12. 相关章节（Obsidian wiki 链接格式）`,
  ].join("\n");
}

/**
 * Build the experience extraction step for cluster-based prompts.
 * Inline version — uses cluster.id as the cluster identifier.
 */
function buildExperienceStep(
  clusterId: string,
  wikiChapter: string,
  projectRoot: string,
): string {
  return [
    `### 步骤 4.5：提取通用开发经验（🆕 不可跳过）`,
    ``,
    `在生成 Wiki 章节后，提取本聚簇中可复用的开发模式，写入 wiki/volume-3-experience/。`,
    ``,
    `**识别维度**（按以下 category 分类）：`,
    `- \`hook\`: 自定义 Hooks（useXxx），具有通用签名的异步/状态/副作用封装`,
    `- \`component\`: 组件组合模式（Container/Presenter、插槽组合、高阶组件）`,
    `- \`state\`: 状态管理模式（Context+Reducer、全局状态库使用模式）`,
    `- \`data-flow\`: 数据获取/转换/传递模式`,
    `- \`error\`: 错误处理模式（ErrorBoundary、try-catch 封装、降级 UI）`,
    `- \`utility\`: 通用工具函数（格式化、验证、类型守卫）`,
    `- \`architecture\`: 架构决策（模块分层、依赖注入、插件/中间件模式）`,
    ``,
    `**输出路径**：`,
    `  write_file(${projectRoot}/wiki/volume-3-experience/{category}/EXP-${clusterId}-{slug}.md)`,
    ``,
    `**文档格式**：`,
    `\`\`\`markdown`,
    `---`,
    `id: EXP-${clusterId}-{slug}`,
    `category: {hook|component|state|data-flow|error|utility|architecture}`,
    `status: candidate`,
    `title: "{模式名称}"`,
    `summary: "{一句话描述}"`,
    `tags: ["{tag1}", "{tag2}"]`,
    `source_clusters:`,
    `  - ${clusterId}`,
    `source_files:`,
    `  - {source-root-relative-path}`,
    `wiki_chapters:`,
    `  - ${wikiChapter}`,
    `lastUpdated: {ISO时间戳}`,
    `---`,
    ``,
    `# {模式名称}`,
    ``,
    `## 概述`,
    `{一句话总结这个模式解决什么问题}`,
    ``,
    `## 适用场景`,
    `{什么时候应该使用这个模式}`,
    ``,
    `## 实现方案`,
    `{核心实现思路，关键步骤}`,
    ``,
    `## 代码示例`,
    ``,
    `\`\`\`typescript`,
    `// 从实际代码中提取（简化但可运行）`,
    `\`\`\``,
    ``,
    `## 注意事项`,
    `{使用此模式时需要注意的陷阱、限制、边界条件}`,
    `\`\`\``,
    ``,
    `**质量准则**：`,
    `1. 仅提取在本聚簇代码中**实际出现**的模式（不虚构）`,
    `2. 同一聚簇内同一模式只创建 1 个文档（单文档内可用多个 source_files）`,
    `3. 如果 volume-3-experience/{category}/ 中已有同名文件，追加本聚簇信息`,
    `4. 每个文档控制在 100-300 行`,
    `5. 代码示例必须可从本聚簇源码中直接提取或简化`,
    ``,
    `**自检**：`,
    `  Bash(ls -la ${projectRoot}/wiki/volume-3-experience/ 2>/dev/null || echo "NOT FOUND")`,
    `  Bash(find ${projectRoot}/wiki/volume-3-experience/ -name "EXP-*.md" 2>/dev/null | wc -l)`,
  ].join("\n");
}

// The old getIssueRulesTemplate(), getOutputFormatTemplate(), getPathSafetyTemplate(),
// and ensureTemplates() functions were removed in Phase 3. Their content is now
// inline in buildIssueRulesSection() above. All callers were updated accordingly.

export function buildGenTaskLookup(
  genTasks: GenTask[] | undefined,
): Map<string, GenTask> {
  const map = new Map<string, GenTask>();
  if (!genTasks) return map;
  for (const task of genTasks) {
    map.set(task.id, task);
  }
  return map;
}

export function buildSubTaskPrompt(
  entry: ScheduleEntry,
  projectRoot: string,
  cacheRoot: string,
  issueIdStart: number,
  issueIdGap: number = 10,
  sourceRoot?: string,
  volumes?: ArtifactVolume[],
): string {
  const effectiveVolumes = volumes ?? [...ALL_VOLUMES];
  const hasWiki = effectiveVolumes.includes("wiki");
  const hasIssue = effectiveVolumes.includes("issue");
  const hasExperience = effectiveVolumes.includes("experience");
  const budget = calcTokenBudget(entry.estimatedTokens);

  const wikiChapterDir = entry.wikiChapter
    ? path.dirname(entry.wikiChapter)
    : entry.wikiChapter || "";

  const sections: string[] = [
    `你是 AgenticWiki GEN SubAgent。`,
    ``,
  ];

  // Issue rules section — only if issue volume is enabled
  if (hasIssue) {
    sections.push(buildIssueRulesSection(issueIdStart, issueIdGap));
    sections.push(``);
  }

  sections.push(
    `## 上下文`,
    ``,
    `项目根目录：${projectRoot}`,
    `  源码根目录：${sourceRoot || projectRoot}（文件路径相对此目录）`,
    `  读取文件时使用绝对路径：${sourceRoot || projectRoot}/{relativePath}`,
    ``,
    `文件优先级清单：.agentic-wiki/cache/file-priorities.json`,
    `  完整路径：${projectRoot}/.agentic-wiki/cache/file-priorities.json`,
    ``,
    `依赖子图：.agentic-wiki/cache/deps/${path.basename(entry.folder)}-deps.json`,
    `  完整路径：${projectRoot}/.agentic-wiki/cache/deps/${path.basename(entry.folder)}-deps.json`,
    ``,
  );

  if (hasWiki) {
    sections.push(
      `Wiki 输出：wiki/volume-1-code/${entry.wikiChapter}`,
      `  完整路径：${projectRoot}/wiki/volume-1-code/${entry.wikiChapter}`,
      ``,
    );
  }

  sections.push(`Token 预算：${budget} tokens（基于文件夹大小动态计算）`);
  sections.push(``);

  // Build volumes badge
  const volumesBadge = effectiveVolumes
    .map((v) => ({ wiki: "📖 Wiki", issue: "🐛 Issue", experience: "🧠 经验" }[v]))
    .join(" + ");
  sections.push(`## 你的任务（产物: ${volumesBadge}）`);
  sections.push(``);
  sections.push(
    `为文件夹 "${entry.folder}" 生成分析产物。**不要创建任何 JSON 文件。**`,
    ``,
  );

  // Step 1: Read files (always needed)
  sections.push(
    `### 步骤 1：按优先级读取源文件`,
    `1. 读取 file-priorities.json，找到文件夹 "${entry.folder}" 的条目`,
    `2. 读取所有 P0 文件（入口文件、桶文件）— **始终读取**`,
    `3. 在 token 预算允许的条件下读取 P1 文件（核心逻辑：组件、Hooks、状态管理）`,
    `4. 仅在 P0/P1 的 import 语句引用时读取 P2 文件（工具函数、类型定义）— **按需读取**`,
    `5. 跳过 P3 和 P4 文件（测试、样式）`,
    `6. 记录你实际读取了哪些文件`,
    ``,
  );

  // Step 2: Generate Wiki chapter (conditionally)
  if (hasWiki) {
    sections.push(
      `### 步骤 2：生成 Wiki 章节`,
      `使用 write_file 将输出写入：${projectRoot}/wiki/volume-1-code/${entry.wikiChapter}`,
      ``,
      buildChapterRequirements(),
      ``,
    );
  }

  // Step 2.5: Collect existing Issues (conditionally)
  if (hasIssue) {
    sections.push(
      `### 步骤 2.5：🔴 收集已有 Issue（不可跳过）`,
      `使用 find_path 扫描 wiki/volume-2-issues/ 目录，查找 source_files 中包含当前文件夹路径的 Issue 文件。`,
      ``,
    );
  }

  // Step 3: Create Issue files (conditionally)
  if (hasIssue) {
    sections.push(
      `### 步骤 3：发现问题时按规则创建 Issue 文件`,
      `按上述 Issue 检测标准评估，使用上述 YAML 模板创建 Issue 文件。`,
      `**type 字段不加引号**：正确 \`type: bug\`，错误 \`type: "bug"\``,
      ``,
    );
  }

  // Step 3.5: Self-check artifacts (conditionally)
  sections.push(`### 步骤 3.5：自检产物（不可跳过）`);
  if (hasWiki) {
    sections.push(
      `  Bash(ls -la ${projectRoot}/wiki/volume-1-code/${entry.wikiChapter} 2>/dev/null || echo "NOT FOUND")`,
    );
  }
  if (hasIssue) {
    sections.push(
      `  Bash(ls -la ${projectRoot}/wiki/volume-2-issues/ch-*/IS-*.md 2>/dev/null | tail -5)`,
    );
  }
  if (hasExperience) {
    sections.push(
      `  Bash(find ${projectRoot}/wiki/volume-3-experience/ -name "EXP-*.md" 2>/dev/null | wc -l)`,
    );
  }
  if (hasWiki) {
    sections.push(`确认 index.md 存在且 size > 0。如果文件不存在，重新用 write_file 写入。`);
  }
  sections.push(``);

  // Step 4: Summary
  sections.push(
    `### 步骤 4：输出摘要`,
    `简短报告：读取了哪些文件、收集到了哪些已有 Issue、发现了哪些新 Issue、预估 token 使用量。`,
    ``,
  );

  // Step 4.5: Experience extraction (conditionally)
  if (hasExperience) {
    sections.push(buildExperienceStep(wikiChapterDir, entry.wikiChapter, projectRoot));
  }

  // Step 5: Done marker (always write to wiki chapter dir for verify-gen-artifacts)
  sections.push(`### 步骤 5：写入完成标记`);
  sections.push(`所有产物确认无误后，在章节目录下写入完成标记文件：`);
  const doneMarkerContent =
    `generated_at: ${new Date().toISOString()}\nsubagent: completed\nvolumes: ${effectiveVolumes.join(",")}`;
  // Always use wiki chapter dir for marker — verify-gen-artifacts.ts looks here
  const markerTargetDir = wikiChapterDir || "ch-misc";
  sections.push(`  首先确保目录存在：Bash(mkdir -p ${projectRoot}/wiki/volume-1-code/${markerTargetDir})`);
  sections.push(
    `  write_file(${projectRoot}/wiki/volume-1-code/${markerTargetDir}/.gen-done, "${doneMarkerContent}")`,
  );
  sections.push(`该标记文件用于 runner 恢复时验证 SubAgent 确实完成了全部写入。`);

  return sections.join("\n");
}

/**
 * Scan wiki/volume-2-issues/ for existing Issue files and return the next available ID.
 * Scans both root-level and chapter-directory issues.
 * Returns 1 if no issues exist yet.
 */
export function computeNextIssueId(projectRoot: string): number {
  const issuesRoot = path.join(projectRoot, "wiki", "volume-2-issues");
  if (!fs.existsSync(issuesRoot)) return 1;

  try {
    const maxIds: number[] = [0];
    const entries = fs.readdirSync(issuesRoot, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(issuesRoot, entry.name);
      if (entry.isDirectory()) {
        // Scan chapter subdirectories
        try {
          const chapterFiles = fs
            .readdirSync(fullPath)
            .filter((f) => f.endsWith(".md"));
          for (const cf of chapterFiles) {
            const m = cf.match(/^IS-(\d{3,5})-/);
            if (m) maxIds.push(parseInt(m[1], 10));
          }
        } catch {
          /* skip unreadable dirs */
        }
      } else if (
        entry.isFile() &&
        entry.name.startsWith("IS-") &&
        entry.name.endsWith(".md")
      ) {
        const m = entry.name.match(/^IS-(\d{3,5})-/);
        if (m) maxIds.push(parseInt(m[1], 10));
      }
    }
    const maxId = Math.max(...maxIds);
    return maxId + 1; // Next available ID
  } catch {
    return 1; // Default to 1 if can't scan
  }
}

export function buildGenSchedule(
  strategy: FolderStrategyResult,
  state: WikiState,
  projectRoot: string,
  cacheRoot: string,
  limit?: number,
  tokenLimit?: number,
  resume?: boolean,
  issueIdBase?: number,
  sourceRoot?: string,
  volumes?: ArtifactVolume[],
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

  // === Centralized Issue ID Counter ===
  // Scan existing issue files to determine the next available ID.
  // This prevents ID collisions between different batches of SubAgents.
  // The issueIdBase parameter allows the caller to override (e.g., from CLI --issue-id-base).
  const computedBase = computeNextIssueId(projectRoot);
  let issueIdCounter = issueIdBase ?? computedBase;

  // Track scheduled task IDs to detect duplicates across the strategy
  const scheduledIds = new Set<string>();
  let dedupSkipped = 0;

  // Process each folder's subTasks
  for (const folder of strategy.folders) {
    if (!folder.subTasks || folder.subTasks.length === 0) continue;

    for (const subTask of folder.subTasks) {
      totalSubTasks++;
      const genTask = genTaskLookup.get(subTask.id);

      // === Dedup check: skip if this subTask ID was already scheduled in this batch ===
      if (scheduledIds.has(subTask.id)) {
        dedupSkipped++;
        skip.push({
          id: subTask.id,
          folder: folder.path,
          role: subTask.role,
          label: subTask.label,
          estimatedTokens: subTask.estimatedTokens,
          wikiChapter: subTask.wikiChapter || "",
          files: [...subTask.files],
          action: "skip",
          reason: "重复调度（已在本批次中）",
          prompt: "",
        });
        continue;
      }
      scheduledIds.add(subTask.id);

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
        entry.prompt = buildSubTaskPrompt(
          entry,
          projectRoot,
          cacheRoot,
          issueIdCounter,
          ISSUE_ID_GAP,
          sourceRoot,
          volumes,
        );
        issueIdCounter += ISSUE_ID_GAP;
        schedule.push(entry);
      } else if (genTask.status === "pending") {
        // Pending tasks: skip unless --resume (avoids duplicate scheduling with --limit)
        if (resume) {
          // Resume from interrupted session: re-schedule pending tasks
          runCount++;
          const entry: ScheduleEntry = {
            ...baseEntry,
            action: "run",
            reason: "恢复执行（--resume，前次中断未完成）",
            prompt: "",
          };
          entry.prompt = buildSubTaskPrompt(
            entry,
            projectRoot,
            cacheRoot,
            issueIdCounter,
            ISSUE_ID_GAP,
            sourceRoot,
            volumes,
          );
          issueIdCounter += ISSUE_ID_GAP;
          schedule.push(entry);
        } else {
          // Normal run: skip pending (they'll be picked up by --resume if truly needed)
          skip.push({
            ...baseEntry,
            action: "skip",
            reason: "待处理（未调度，需后续批次执行）",
            prompt: "",
          });
        }
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
        entry.prompt = buildSubTaskPrompt(
          entry,
          projectRoot,
          cacheRoot,
          issueIdCounter,
          ISSUE_ID_GAP,
          sourceRoot,
          volumes,
        );
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
        entry.prompt = buildSubTaskPrompt(
          entry,
          projectRoot,
          cacheRoot,
          issueIdCounter,
          ISSUE_ID_GAP,
          sourceRoot,
          volumes,
        );
        issueIdCounter += ISSUE_ID_GAP;
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

  // Apply --limit (count-based) and/or --token-limit (token-based), defer rest to next batch
  let pendingFromLimit = 0;
  if (limit !== undefined && limit > 0 && schedule.length > limit) {
    pendingFromLimit = schedule.length - limit;
    schedule.length = limit;
  }
  if (tokenLimit !== undefined && tokenLimit > 0) {
    let tokenSum = 0;
    let cutoffIdx = 0;
    for (let i = 0; i < schedule.length; i++) {
      if (tokenSum + schedule[i].estimatedTokens > tokenLimit) break;
      tokenSum += schedule[i].estimatedTokens;
      cutoffIdx = i + 1;
    }
    if (cutoffIdx < schedule.length) {
      pendingFromLimit += schedule.length - cutoffIdx;
      schedule.length = cutoffIdx;
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
      dedupSkipped,
    },
  };

  return result;
}

// === Cluster Schedule Builder ===

/**
 * Build a SubAgent prompt for a cluster-based task.
 * References file-meta.json instead of file-priorities.json,
 * and lists the exact files in the cluster rather than relying
 * on the SubAgent to discover them.
 */
/**
 * Pre-extract cluster-relevant file metadata from file-meta.json.
 * Returns a compact summary table for inclusion in the SubAgent prompt,
 * avoiding the need for the SubAgent to read a 0.4MB+ JSON file.
 */
function extractClusterMetaTable(
  files: string[],
  projectRoot: string,
  cacheRoot: string,
): string {
  const metaPath = path.join(cacheRoot, "file-meta.json");
  if (!fs.existsSync(metaPath)) return "";

  try {
    const fullMeta = fs.readJsonSync(metaPath) as Record<
      string,
      Record<string, unknown>
    >;
    const rows: string[] = [];
    for (const f of files) {
      const entry = fullMeta[f];
      if (!entry) {
        rows.push(`| \`${f}\` | — | — | — |`);
        continue;
      }
      const compName = (entry.componentName as string) || "—";
      const hooks = ((entry.hookNames as string[]) || []).join(", ") || "—";
      const exports =
        ((entry.exportNames as string[]) || []).slice(0, 5).join(", ") || "—";
      const isReact = entry.isReactComponent ? "✅" : "";
      const hasJSX = entry.hasJSX ? "✅" : "";
      const metaFlag =
        isReact || hasJSX ? ` ${isReact}${isReact ? "" : hasJSX}` : "";
      rows.push(
        `| \`${f}\` | ${compName}${metaFlag} | ${hooks} | ${exports} |`,
      );
    }

    return (
      `| 文件 | 组件/类型 | Hooks | 导出 |\n` +
      `|------|----------|-------|------|\n` +
      rows.join("\n")
    );
  } catch {
    return "";
  }
}

export function buildClusterPrompt(
  cluster: TaskCluster,
  projectRoot: string,
  cacheRoot: string,
  issueIdStart: number,
  issueIdGap: number = 10,
  sourceRoot?: string,
  volumes?: ArtifactVolume[],
): string {
  const effectiveVolumes = volumes ?? [...ALL_VOLUMES];
  const hasWiki = effectiveVolumes.includes("wiki");
  const hasIssue = effectiveVolumes.includes("issue");
  const hasExperience = effectiveVolumes.includes("experience");
  const budget = calcTokenBudget(cluster.estimatedTokens);

  // Pre-extract cluster metadata from file-meta.json
  const metaTable = extractClusterMetaTable(
    cluster.files,
    projectRoot,
    cacheRoot,
  );

  // Format file list for prompt inclusion
  const fileBullets = cluster.files.map((f) => `    - \`${f}\``).join("\n");

  const sections: string[] = [
    `你是 AgenticWiki GEN SubAgent。`,
    ``,
  ];

  if (hasIssue) {
    sections.push(buildIssueRulesSection(issueIdStart, issueIdGap));
    sections.push(``);
  }

  sections.push(
    `## 上下文`,
    ``,
    `项目根目录：${projectRoot}`,
    `  源码根目录：${sourceRoot || projectRoot}（聚簇文件路径相对此目录）`,
    `  读取文件时使用绝对路径：${sourceRoot || projectRoot}/{relativePath}`,
    ``,
  );

  if (hasWiki) {
    sections.push(
      `Wiki 输出：wiki/volume-1-code/${cluster.wikiChapter}`,
      `  完整路径：${projectRoot}/wiki/volume-1-code/${cluster.wikiChapter}`,
      ``,
    );
  }

  sections.push(
    `Token 预算：${budget} tokens（基于聚簇大小动态计算）`,
    ``,
  );

  // Build volumes badge
  const volumesBadge = effectiveVolumes
    .map((v) => ({ wiki: "📖 Wiki", issue: "🐛 Issue", experience: "🧠 经验" }[v]))
    .join(" + ");
  sections.push(`## 你的任务（产物: ${volumesBadge}）`);
  sections.push(``);
  sections.push(
    `为组件聚簇 "${cluster.label}" 生成分析产物。`,
    `**不要创建任何 JSON 文件。**`,
    ``,
    `## 聚簇文件摘要（已从 file-meta.json 预提取）`,
    ``,
    metaTable,
    ``,
    `## 聚簇文件清单（${cluster.files.length} 个文件）`,
    ``,
    fileBullets,
    ``,
    `### 步骤 1：选择性读取源码`,
    `1. 以上表格已包含组件名、Hooks、导出列表 — 优先据此判断重要性`,
    `2. 仅当表格信息不足时再读完整源码（优先读有 JSX/组件的文件）`,
    `3. 在 token 预算允许的条件下选择性读取关键文件的完整源码`,
    `4. 跳过测试和样式文件`,
    `5. 记录你实际读取了哪些文件`,
    ``,
  );

  // Step 2: Generate Wiki (conditionally)
  if (hasWiki) {
    sections.push(
      `### 步骤 2：生成 Wiki 章节`,
      `使用 write_file 将输出写入：${projectRoot}/wiki/volume-1-code/${cluster.wikiChapter}`,
      ``,
      buildChapterRequirements(),
      ``,
    );
  }

  // Step 2.5: Collect issues (conditionally)
  if (hasIssue) {
    sections.push(
      `### 步骤 2.5：🔴 收集已有 Issue（不可跳过）`,
      `使用 find_path 扫描 wiki/volume-2-issues/ 目录，查找 source_files 中包含本聚簇文件路径的 Issue。`,
      ``,
    );
  }

  // Step 3: Create issues (conditionally)
  if (hasIssue) {
    sections.push(
      `### 步骤 3：发现问题时按规则创建 Issue 文件`,
      `按上述 Issue 检测标准评估，使用上述 YAML 模板创建 Issue 文件。`,
      `**type 字段不加引号**：正确 \`type: bug\`，错误 \`type: "bug"\``,
      ``,
    );
  }

  // Step 3.5: Self-check
  sections.push(`### 步骤 3.5：自检产物（不可跳过）`);
  if (hasWiki) {
    sections.push(
      `  Bash(ls -la ${projectRoot}/wiki/volume-1-code/${cluster.wikiChapter} 2>/dev/null || echo "NOT FOUND")`,
    );
  }
  if (hasIssue) {
    sections.push(
      `  Bash(ls -la ${projectRoot}/wiki/volume-2-issues/ch-*/IS-*.md 2>/dev/null | tail -5)`,
    );
  }
  if (hasExperience) {
    sections.push(
      `  Bash(find ${projectRoot}/wiki/volume-3-experience/ -name "EXP-*.md" 2>/dev/null | wc -l)`,
    );
  }
  if (hasWiki) {
    sections.push(`确认 index.md 存在且 size > 0。如果文件不存在，重新用 write_file 写入。`);
  }
  sections.push(``);

  // Step 4: Summary
  sections.push(
    `### 步骤 4：输出摘要`,
    `简短报告：读取了哪些文件、收集到了哪些已有 Issue、发现了哪些新 Issue、预估 token 使用量。`,
    ``,
  );

  // Step 4.5: Experience (conditionally)
  if (hasExperience) {
    sections.push(buildExperienceStep(cluster.id, cluster.wikiChapter, projectRoot));
    sections.push(``);
  }

  // Step 5: Done marker (always write to wiki chapter dir for verify-gen-artifacts)
  sections.push(`### 步骤 5：写入完成标记`);
  sections.push(`所有产物确认无误后，在章节目录下写入完成标记文件：`);
  const doneMarkerContent =
    `generated_at: ${new Date().toISOString()}\nsubagent: completed\nvolumes: ${effectiveVolumes.join(",")}`;
  const markerTargetDir = cluster.wikiChapter
    ? path.dirname(cluster.wikiChapter)
    : "ch-misc";
  sections.push(`  首先确保目录存在：Bash(mkdir -p ${projectRoot}/wiki/volume-1-code/${markerTargetDir})`);
  sections.push(
    `  write_file(${projectRoot}/wiki/volume-1-code/${markerTargetDir}/.gen-done, "${doneMarkerContent}")`,
  );
  sections.push(`该标记文件用于 runner 恢复时验证 SubAgent 确实完成了全部写入。`);

  return sections.join("\n");
}

/**
 * Build a gen schedule from task clusters (alternative to folder-strategy-based buildGenSchedule).
 */
export function buildClusterSchedule(
  clusterResult: ClusterTaskResult,
  state: WikiState,
  projectRoot: string,
  cacheRoot: string,
  limit?: number,
  tokenLimit?: number,
  resume?: boolean,
  issueIdBase?: number,
  sourceRoot?: string,
  volumes?: ArtifactVolume[],
): GenScheduleResult {
  const genTaskLookup = buildGenTaskLookup(state.genTasks);
  const skip: ScheduleEntry[] = [];
  const schedule: ScheduleEntry[] = [];
  let issueIdCounter = issueIdBase ?? computeNextIssueId(projectRoot);

  let totalSubTasks = 0;
  let runCount = 0;
  let retryCount = 0;

  const scheduledIds = new Set<string>();
  let dedupSkipped = 0;

  for (const cluster of clusterResult.clusters) {
    totalSubTasks++;

    const clusterId = cluster.id;
    if (scheduledIds.has(clusterId)) {
      dedupSkipped++;
      skip.push({
        id: clusterId,
        folder: cluster.files[0] || ".",
        role: cluster.source,
        label: cluster.label,
        estimatedTokens: cluster.estimatedTokens,
        wikiChapter: cluster.wikiChapter,
        files: [...cluster.files],
        action: "skip",
        reason: "重复调度",
        prompt: "",
      });
      continue;
    }
    scheduledIds.add(clusterId);

    const genTask = genTaskLookup.get(clusterId);
    const baseEntry = {
      id: clusterId,
      folder: cluster.files[0] || ".",
      role: cluster.source,
      label: cluster.label,
      estimatedTokens: cluster.estimatedTokens,
      wikiChapter: cluster.wikiChapter,
      files: [...cluster.files],
      prompt: "",
    };

    if (!genTask) {
      runCount++;
      const entry: ScheduleEntry = {
        ...baseEntry,
        action: "run",
        reason: "首次调度（聚簇）",
        prompt: buildClusterPrompt(
                  cluster,
                  projectRoot,
                  cacheRoot,
                  issueIdCounter,
                  ISSUE_ID_GAP,
                  sourceRoot,
                  volumes,
                ),
              };
              issueIdCounter += ISSUE_ID_GAP;
              schedule.push(entry);
            } else if (genTask.status === "pending") {
              if (resume) {
                runCount++;
                const entry: ScheduleEntry = {
                  ...baseEntry,
                  action: "run",
                  reason: "恢复执行（聚簇，前次中断未完成）",
                  prompt: buildClusterPrompt(
                    cluster,
                    projectRoot,
                    cacheRoot,
                    issueIdCounter,
                    ISSUE_ID_GAP,
                    sourceRoot,
                    volumes,
                  ),
        };
        issueIdCounter += ISSUE_ID_GAP;
        schedule.push(entry);
      } else {
        skip.push({
          ...baseEntry,
          action: "skip",
          reason: "待处理（未调度）",
          prompt: "",
        });
      }
    } else if (genTask.status === "completed") {
      skip.push({ ...baseEntry, action: "skip", reason: "已完成", prompt: "" });
    } else if (
      genTask.status === "failed" ||
      genTask.status === "in_progress"
    ) {
      retryCount++;
      const reason = genTask.status === "failed" ? "上次失败" : "中断时未完成";
      const entry: ScheduleEntry = {
        ...baseEntry,
        action: "retry",
        reason,
        prompt: buildClusterPrompt(
          cluster,
          projectRoot,
          cacheRoot,
          issueIdCounter,
          ISSUE_ID_GAP,
          sourceRoot,
          volumes,
        ),
      };
      issueIdCounter += ISSUE_ID_GAP;
      if (genTask.status === "failed") {
        entry.prompt += `\n\n## ⚠️ 重试指令\n上一次你声称生成完成但验证失败。本次必须用 write_file 工具实际写入文件。`;
      }
      schedule.push(entry);
    }
  }

  // Sort: retry first, then run
  schedule.sort((a, b) => {
    const order: Record<ScheduleAction, number> = { skip: 2, run: 1, retry: 0 };
    return order[a.action] - order[b.action];
  });

  // Apply batch limits
  let pendingFromLimit = 0;
  if (limit !== undefined && limit > 0 && schedule.length > limit) {
    pendingFromLimit = schedule.length - limit;
    schedule.length = limit;
  }
  if (tokenLimit !== undefined && tokenLimit > 0) {
    let tokenSum = 0;
    let cutoffIdx = 0;
    for (let i = 0; i < schedule.length; i++) {
      if (tokenSum + schedule[i].estimatedTokens > tokenLimit) break;
      tokenSum += schedule[i].estimatedTokens;
      cutoffIdx = i + 1;
    }
    if (cutoffIdx < schedule.length) {
      pendingFromLimit += schedule.length - cutoffIdx;
      schedule.length = cutoffIdx;
    }
  }

  const totalEstimatedTokens = schedule.reduce(
    (sum, e) => sum + e.estimatedTokens,
    0,
  );

  return {
    generatedAt: new Date().toISOString(),
    skip,
    schedule,
    summary: {
      totalSubTasks,
      skipCount: skip.length,
      runCount,
      retryCount,
      pendingCount: pendingFromLimit,
      totalEstimatedTokens,
      dedupSkipped,
    },
  };
}

// === CLI Entry Point ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("strategy", {
      type: "string",
      description: "Path to folder-strategy.json（与 --clusters 二选一）",
    })
    .option("clusters", {
      type: "string",
      description: "Path to task-clusters.json（与 --strategy 二选一）",
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
    .option("token-limit", {
      type: "number",
      description:
        "Max total estimated tokens per batch (e.g. 300000), overrides --limit for token-based batching",
    })
    .option("write-state", {
      type: "boolean",
      default: false,
      description:
        "Write new genTasks entries back to state.json (default: false)",
    })
    .option("resume", {
      type: "boolean",
      default: false,
      description:
        "Re-schedule pending tasks from a previous interrupted session (default: skip pending)",
    })
    .option("issue-id-base", {
      type: "number",
      description:
        "Starting Issue ID number (auto-detected from existing files if not set)",
    })
    .option("volumes", {
      type: "string",
      description:
        "要产出的分析产物类型（逗号分隔）。可选: wiki, issue, experience。默认全部产出",
    })
    .parseSync();

  const state: WikiState = await fs.readJson(argv.state);
  const projectRoot = state.config.paths?.projectRoot || state.projectPath;
  const sourceRoot = state.config.paths?.sourceRoot || projectRoot;
  const cacheRoot =
    state.config.paths?.cacheRoot ||
    path.join(projectRoot, ".agentic-wiki", "cache");

  // Parse volumes from CLI --volumes, fall back to state.config.volumes, then default to all
  const volumes: ArtifactVolume[] = argv.volumes
    ? parseVolumesFromString(argv.volumes)
    : state.config.volumes ?? [...ALL_VOLUMES];

  // Choose mode: clusters or folder-strategy
  const isClusterMode = !!argv.clusters;

  let result: GenScheduleResult;
  if (isClusterMode) {
    // Cluster mode — read task-clusters.json
    const clusterResult: ClusterTaskResult = await fs.readJson(argv.clusters!);
    result = buildClusterSchedule(
      clusterResult,
      state,
      projectRoot,
      cacheRoot,
      argv.limit,
      argv.tokenLimit,
      argv.resume,
      argv.issueIdBase,
      sourceRoot,
      volumes,
    );
  } else {
    // Folder-strategy mode (original)
    if (!argv.strategy) {
      throw new Error("必须提供 --strategy 或 --clusters");
    }
    const strategy: FolderStrategyResult = await fs.readJson(argv.strategy);
    result = buildGenSchedule(
      strategy,
      state,
      projectRoot,
      cacheRoot,
      argv.limit,
      argv.tokenLimit,
      argv.resume,
      argv.issueIdBase,
      sourceRoot,
      volumes,
    );
  }

  // Write schedule (without prompts in JSON to keep it manageable)
  const { skip, schedule, summary } = result;
  const outputSchedule = schedule.map((entry: { prompt: string }) => {
    const { prompt: _prompt, ...rest } = entry;
    return {
      ...rest,
      promptTruncated: _prompt.slice(0, 200) + "...",
    };
  });
  const outputSkip = skip.map(({ prompt: _prompt, ...rest }) => rest);

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
  // NOTE: selective cleanup — only remove prompts for already-completed (skip) tasks,
  // preserving prompts for pending tasks from previous batches. This prevents the
  // "in-flight prompt deletion" problem where old prompts vanish on each --resume.
  const promptsDir = path.join(path.dirname(argv.output), "gen-prompts");
  await fs.ensureDir(promptsDir);
  const completedIds = new Set(skip.map((e) => e.id));
  for (const file of await fs.readdir(promptsDir)) {
    const taskId = file.replace(/\.md$/, "");
    if (completedIds.has(taskId)) {
      await fs.remove(path.join(promptsDir, file));
    }
  }
  for (const entry of schedule) {
    const promptFile = path.join(promptsDir, `${sanitizePathId(entry.id)}.md`);
    await fs.outputFile(promptFile, entry.prompt, "utf-8");
  }

  // Write genTasks back to state.json if --write-state is set
  // Uses atomicUpdate from state-manager.ts for lock + backup + atomic write safety
  if (argv["write-state"]) {
    const existingIds = new Set((state.genTasks || []).map((t) => t.id));
    const newGenTasks: GenTask[] = [];

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

    // Also add skip tasks (already completed) if not in state
    for (const entry of skip) {
      if (!existingIds.has(entry.id)) {
        newGenTasks.push({
          id: entry.id,
          folder: entry.folder,
          role: entry.role,
          status: "completed",
          estimatedTokens: entry.estimatedTokens,
          wikiChapter: entry.wikiChapter,
        });
      }
    }

    // Use atomicUpdate to safely merge (handles lock + backup + atomic rename)
    if (newGenTasks.length > 0) {
      await atomicUpdate(argv.state, (current) => {
        const currentIds = new Set((current.genTasks || []).map((t) => t.id));
        const filteredNew = newGenTasks.filter((t) => !currentIds.has(t.id));
        return {
          ...current,
          genTasks: [...(current.genTasks || []), ...filteredNew],
        };
      });
    }
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

  const stateNote = argv["write-state"]
    ? "  genTasks written to " + argv.state + "\n"
    : "";

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
      " files)\n" +
      stateNote,
  );
}

// Also exported for tests
export function parseVolumesFromString(raw: string): ArtifactVolume[] {
  const parts = raw.split(",").map((s) => s.trim().toLowerCase());
  const valid: ArtifactVolume[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if ((ALL_VOLUMES as string[]).includes(p)) {
      valid.push(p as ArtifactVolume);
    } else {
      invalid.push(p);
    }
  }
  if (invalid.length > 0) {
    console.warn(
      `⚠️  无效的 volumes 值: ${invalid.join(", ")}。有效值: ${ALL_VOLUMES.join(", ")}`,
    );
  }
  if (valid.length === 0) {
    console.warn(`⚠️  无有效 volumes，回退到默认值: ${ALL_VOLUMES.join(", ")}`);
    return [...ALL_VOLUMES];
  }
  return valid;
}

const isMainModule =
  process.argv[1]?.endsWith("gen-scheduler.ts") ||
  process.argv[1]?.endsWith("gen-scheduler.js");
if (isMainModule) main();
