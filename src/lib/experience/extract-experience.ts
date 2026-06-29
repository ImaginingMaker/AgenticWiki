/**
 * extract-experience.ts — 通用开发经验提取调度器。
 *
 * 在 ASSEMBLE 阶段末尾运行（非关键脚本），生成 SubAgent prompt
 * 用于跨聚簇模式提取。用户手动 spawn SubAgent 后，产物写入
 * wiki/volume-3-experience/。
 *
 * Usage:
 *   npx tsx src/lib/experience/extract-experience.ts \
 *     --project /path/to/project \
 *     --wiki wiki/ \
 *     --cache .agentic-wiki/cache/ \
 *     --source src/ \
 *     --output .agentic-wiki/cache/experience-schedule.json
 */

import path from "node:path";
import fs from "fs-extra";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { ClusterTaskResult } from "../dependency/cluster-tasks.js";
import type { AffectedExperience, ExperienceCategory } from "../../types/index.js";
import { calcTokenBudget } from "../gen/gen-scheduler.js";

// === Types ===

export interface ExperiencePromptEntry {
  id: string;
  label: string;
  prompt: string;
}

export interface ExperienceSchedule {
  generatedAt: string;
  prompts: ExperiencePromptEntry[];
  summary: {
    totalPrompts: number;
    totalClusters: number;
    totalWikiPages: number;
    incremental?: boolean;
  };
}

// === Prompt Building ===

const EXPERIENCE_CATEGORIES: Record<
  string,
  { label: string; description: string; lookFor: string }
> = {
  hook: {
    label: "自定义 Hook 模式",
    description: "跨聚簇复用的自定义 Hooks（useXxx 模式）",
    lookFor:
      "- 相同命名模式的自定义 Hooks（如 useFetch、useToggle、useDebounce 等）\n" +
      "- 相似的 Hook 签名和返回值结构\n" +
      "- 相同的外部依赖封装模式（如封装第三方库 API）",
  },
  component: {
    label: "组件组合模式",
    description: "跨聚簇复用的组件组合/封装模式",
    lookFor:
      "- Container/Presenter 分离模式\n" +
      "- Compound Components（复合组件）\n" +
      "- HOC（高阶组件）模式\n" +
      "- Render Props / Slots 模式\n" +
      "- 通用布局组件模式",
  },
  state: {
    label: "状态管理模式",
    description: "跨聚簇的状态管理方案",
    lookFor:
      "- Context + Reducer 模式\n" +
      "- 全局状态库（Zustand/Jotai/Redux）的使用模式\n" +
      "- 表单状态管理模式\n" +
      "- 服务端状态缓存模式（React Query/SWR）",
  },
  "data-flow": {
    label: "数据流模式",
    description: "跨聚簇的数据获取/转换/传递模式",
    lookFor:
      "- 数据获取（fetching）的封装模式\n" +
      "- 数据转换（mapping/formatting）的通用实现\n" +
      "- Props drilling 的解决方案\n" +
      "- 事件总线/消息传递模式",
  },
  error: {
    label: "错误处理模式",
    description: "跨聚簇的错误边界/异常处理模式",
    lookFor:
      "- Error Boundary 的实现方式\n" +
      "- try-catch 的封装模式\n" +
      "- 错误上报（Sentry/logging）的集成方式\n" +
      "- 降级 UI / fallback 的实现模式",
  },
  utility: {
    label: "工具函数模式",
    description: "跨聚簇的通用工具函数",
    lookFor:
      "- 相同功能的工具函数（如 formatDate、classNames 等）\n" +
      "- 类型守卫/类型工具函数\n" +
      "- 验证函数的通用模式\n" +
      "- 常量/枚举的定义模式",
  },
  architecture: {
    label: "架构决策模式",
    description: "跨聚簇的架构设计和工程决策",
    lookFor:
      "- 模块化/分层架构模式\n" +
      "- 依赖注入模式\n" +
      "- 插件/中间件模式\n" +
      "- 特性开关（Feature Flag）模式",
  },
};

/**
 * Build the SubAgent prompt for experience extraction.
 */
function buildExperiencePrompt(
  projectRoot: string,
  wikiRoot: string,
  cacheRoot: string,
  sourceRoot: string,
  clusterCount: number,
  wikiPageCount: number,
): string {
  const tokenBudget = calcTokenBudget(
    clusterCount * 8000 + wikiPageCount * 2000,
  );

  const categorySections = Object.entries(EXPERIENCE_CATEGORIES)
    .map(
      ([, cat]) =>
        `### ${cat.label}\n` +
        `${cat.description}\n\n` +
        `**识别要点**：\n${cat.lookFor}`,
    )
    .join("\n\n---\n\n");

  const outputDirs = Object.keys(EXPERIENCE_CATEGORIES)
    .map((c) => `  - ${c}/`)
    .join("\n");

  return [
    `你是 AgenticWiki EXPERIENCE SubAgent。`,
    ``,
    `## 上下文`,
    ``,
    `项目根目录：${projectRoot}`,
    `Wiki 目录：${wikiRoot}`,
    `缓存目录：${cacheRoot}`,
    `源码根目录：${sourceRoot}`,
    `聚簇数量：${clusterCount}`,
    `Wiki 页面数：${wikiPageCount}`,
    ``,
    `Token 预算：${tokenBudget} tokens`,
    ``,
    `## 你的任务：提取通用开发经验`,
    ``,
    `你已经有了所有聚簇的 Wiki 章节。现在需要**跨聚簇分析**，`,
    `提取不同聚簇中出现的**通用实现模式**，形成经验知识库。`,
    ``,
    `### 为什么需要这一步？`,
    `- 单一聚簇的 Wiki 描述"这个聚簇怎么实现"`,
    `- 通用开发经验描述"这类问题在项目中通常怎么解决"`,
    `- 价值：新人/新需求可以快速参考成熟方案，不用从零摸索`,
    ``,
    `### 步骤 1：扫描 Wiki 章节`,
    `1. 读取所有 wiki/volume-1-code/ 章节的 frontmatter（title, tags, sourceFiles）`,
    `2. 读取文件元信息：${cacheRoot}/file-meta.json`,
    `3. 读取聚簇信息：${cacheRoot}/task-clusters.json`,
    `4. 对于关键 Wiki 章节，读取「技术实现方案」和「实现细节」部分`,
    `5. 收集每个聚簇中的核心实现：Hooks、组件、状态管理、数据流、工具函数`,
    ``,
    `### 步骤 2：跨聚簇比较，识别通用模式`,
    `按以下维度分类比较：`,
    ``,
    categorySections,
    ``,
    `---`,
    ``,
    `### 步骤 3：生成经验文档`,
    ``,
    `为每个识别出的通用模式（≥2 个不同聚簇），在对应子目录下创建文档。`,
    ``,
    `**输出目录结构**：`,
    `\`\`\``,
    `wiki/volume-3-experience/`,
    outputDirs,
    `  index.md              ← 经验索引`,
    `.gen-done               ← 完成标记`,
    `\`\`\``,
    ``,
    `**单个经验文档格式**（每模式一个 .md 文件）：`,
    ``,
    `\`\`\`markdown`,
    `---`,
    `id: EXP-{NN}`,
    `category: {hook|component|state|data-flow|error|utility|architecture}`,
    `status: active`,
    `title: "{模式名称}"`,
    `summary: "{一句话描述}"`,
    `tags: ["{tag1}", "{tag2}"]`,
    `source_clusters: ["{cluster-id-1}", "{cluster-id-2}"]`,
    `source_files:`,
    `  - {source-root-relative-path}`,
    `wiki_chapters:`,
    `  - {wiki-chapter-path}`,
    `lastUpdated: {ISO时间戳}`,
    `---`,
    ``,
    `# {模式名称}`,
    ``,
    `## 概述`,
    `{一句话总结这是什么模式，解决什么问题}`,
    ``,
    `## 适用场景`,
    `{什么时候应该使用这个模式？列出典型场景}`,
    ``,
    `## 实现方案`,
    `{核心实现思路，关键步骤}`,
    ``,
    `## 代码示例`,
    ``,
    `\`\`\`typescript`,
    `// 从实际代码中提取或简化`,
    `\`\`\``,
    ``,
    `## 来源聚簇`,
    `| 聚簇 ID | 文件 | 说明 |`,
    `|---------|------|------|`,
    `| ... | ... | ... |`,
    ``,
    `## 变体与替代方案`,
    `{如果有变体或替代实现，列出并说明差异}`,
    ``,
    `## 注意事项`,
    `{使用此模式时需要注意的陷阱、限制、边界条件}`,
    ``,
    `## 相关经验`,
    `{链接到相关的其他经验文档}`,
    `\`\`\``,
    ``,
    `### 步骤 3.5：自检产物`,
    `验证写入的文件：`,
    `  Bash(ls -la ${wikiRoot}/volume-3-experience/ 2>/dev/null || echo "NOT FOUND")`,
    `  Bash(find ${wikiRoot}/volume-3-experience/ -name "*.md" 2>/dev/null | wc -l)`,
    ``,
    `### 步骤 4：输出摘要`,
    `报告：扫描了多少 Wiki 章节、识别出多少通用模式（按分类统计）、`,
    `每个模式对应哪些聚簇、预估 Token 使用量。`,
    ``,
    `### 步骤 5：写入完成标记`,
    `确认所有产物无误后：`,
    `  write_file(${wikiRoot}/volume-3-experience/.gen-done, "generated_at: ${new Date().toISOString()}\\nsubagent: completed")`,
    ``,
    `## 提取质量准则`,
    ``,
    `1. **真实性**：只提取实际存在于代码中的模式`,
    `2. **通用性**：仅在 ≥2 个不同聚簇中出现时才提取`,
    `3. **实用性**：每个模式必须包含可运行的代码示例`,
    `4. **简洁性**：每个经验文档控制在 200-500 行`,
    `5. **关联性**：必须标注来源聚簇 ID 和相关 Wiki 章节`,
    ``,
    `## 路径安全规则`,
    `- 只写入 wiki/volume-3-experience/ 目录下`,
    `- 文件名只使用字母、数字、连字符、下划线`,
    `- 不写入 wiki/volume-1-code/ 或 wiki/volume-2-issues/`,
  ].join("\n");
}

// === Core Logic ===

export async function generateExperiencePrompts(
  projectRoot: string,
  wikiRoot: string,
  cacheRoot: string,
  sourceRoot: string,
): Promise<ExperienceSchedule> {
  const v1 = path.join(wikiRoot, "volume-1-code");
  const clustersPath = path.join(cacheRoot, "task-clusters.json");

  // Count wiki pages
  let wikiPageCount = 0;
  if (fs.existsSync(v1)) {
    const files = await globby(["**/*.md"], { cwd: v1, onlyFiles: true });
    wikiPageCount = files.length;
  }

  // Count clusters
  let clusterCount = 0;
  if (fs.existsSync(clustersPath)) {
    try {
      const clusters: ClusterTaskResult = fs.readJsonSync(clustersPath);
      clusterCount = clusters.clusters?.length || 0;
    } catch {
      /* ignore */
    }
  }

  const prompt = buildExperiencePrompt(
    projectRoot,
    wikiRoot,
    cacheRoot,
    sourceRoot,
    clusterCount,
    wikiPageCount,
  );

  const prompts: ExperiencePromptEntry[] = [
    {
      id: "exp-001",
      label: "全部经验提取",
      prompt,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    prompts,
    summary: {
      totalPrompts: prompts.length,
      totalClusters: clusterCount,
      totalWikiPages: wikiPageCount,
    },
  };
}

// === Incremental Support ===

/**
 * Compute which experience patterns are affected by code changes.
 *
 * For each pattern in volume-3-experience/, checks:
 *   1. Does any source_cluster overlap with affectedClusterIds?
 *   2. After removing affected clusters, are there >= 2 remaining?
 *
 * Returns actions:
 *   - "stale": pattern needs re-validation (source code changed, but pattern still has >= 2 sources)
 *   - "orphaned": pattern no longer qualifies as "common" (< 2 remaining source clusters)
 *   - "unchanged": no source cluster affected
 */
export function computeAffectedExperience(
  experienceDir: string,
  affectedClusterIds: Set<string>,
  allClusterIds: Set<string>,
): {
  affected: AffectedExperience[];
  summary: { stale: number; orphaned: number; unchanged: number; total: number };
} {
  const affected: AffectedExperience[] = [];
  const summary = { stale: 0, orphaned: 0, unchanged: 0, total: 0 };

  if (!fs.existsSync(experienceDir)) return { affected, summary };

  // Walk all experience .md files (recursive)
  const walkDir = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkDir(fullPath));
      } else if (
        entry.name.endsWith(".md") &&
        entry.name !== ".gen-done" &&
        entry.name !== "index.md"
      ) {
        files.push(fullPath);
      }
    }
    return files;
  };

  const files = walkDir(experienceDir);
  summary.total = files.length;

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf-8");

    // Extract YAML frontmatter
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    const fm = fmMatch[1];
    const idMatch = fm.match(/^id:\s*(.+)$/m);
    const catMatch = fm.match(/^category:\s*(.+)$/m);

    // Parse source_clusters (supports both inline and multiline formats)
    let sourceClusters: string[] = [];
    const clusterInline = fm.match(
      /^source_clusters:\s*\[([^\]]*)\]/m,
    );
    const clusterMulti = fm.match(
      /^source_clusters:\s*\n((?:\s*-\s*.+\n?)*)/m,
    );

    if (clusterInline) {
      sourceClusters = clusterInline[1]
        .split(",")
        .map((s) => s.trim().replace(/["']/g, ""))
        .filter(Boolean);
    } else if (clusterMulti) {
      sourceClusters = clusterMulti[1]
        .split("\n")
        .map((l) => l.replace(/^\s*-\s*/, "").trim().replace(/["']/g, ""))
        .filter(Boolean);
    }

    const id = idMatch ? idMatch[1].trim() : path.basename(file, ".md");
    const category = (catMatch ? catMatch[1].trim() : "utility") as ExperienceCategory;

    // Check affected clusters
    const matchedClusters = sourceClusters.filter((c) =>
      affectedClusterIds.has(c),
    );
    const remainingClusters = sourceClusters.filter(
      (c) => !affectedClusterIds.has(c) && allClusterIds.has(c),
    );

    const relPath = path.relative(experienceDir, file);

    if (matchedClusters.length > 0) {
      if (remainingClusters.length < 2) {
        affected.push({
          id,
          path: relPath,
          category,
          action: "orphaned",
          reason: `Source clusters [${matchedClusters.join(", ")}] changed. Only ${remainingClusters.length} remaining (< 2, no longer a common pattern).`,
          matchedClusters,
          remainingClusters,
        });
        summary.orphaned++;
      } else {
        affected.push({
          id,
          path: relPath,
          category,
          action: "stale",
          reason: `Source clusters [${matchedClusters.join(", ")}] changed in incremental mode.`,
          matchedClusters,
          remainingClusters,
        });
        summary.stale++;
      }
    } else {
      affected.push({
        id,
        path: relPath,
        category,
        action: "unchanged",
        reason: "No affected source clusters.",
        matchedClusters: [],
        remainingClusters: sourceClusters,
      });
      summary.unchanged++;
    }
  }

  return { affected, summary };
}

// === CLI ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("project", { type: "string", demandOption: true })
    .option("wiki", { type: "string", demandOption: true })
    .option("cache", { type: "string", demandOption: true })
    .option("source", { type: "string", demandOption: true })
    .option("output", { type: "string", demandOption: true })
    .option("incremental", { type: "boolean", default: false })
    .parseSync();

  const projectRoot = path.resolve(argv.project);
  const wikiRoot = path.resolve(argv.wiki);
  const cacheRoot = path.resolve(argv.cache);
  const sourceRoot = path.resolve(argv.source);

  // Check if experience already exists
  const expDone = path.join(wikiRoot, "volume-3-experience", ".gen-done");
  if (fs.existsSync(expDone) && !argv.incremental) {
    console.log("✅ 经验文档已存在（.gen-done 标记已检测到），跳过。");
    console.log("   如需重新生成，删除 volume-3-experience/.gen-done 后重试。");
    const schedule: ExperienceSchedule = {
      generatedAt: new Date().toISOString(),
      prompts: [],
      summary: { totalPrompts: 0, totalClusters: 0, totalWikiPages: 0 },
    };
    await fs.outputJson(path.resolve(argv.output), schedule, { spaces: 2 });
    return;
  }

  const schedule = await generateExperiencePrompts(
    projectRoot,
    wikiRoot,
    cacheRoot,
    sourceRoot,
  );

  // Write schedule to output
  const outputPath = path.resolve(argv.output);
  await fs.outputJson(outputPath, schedule, { spaces: 2 });

  // Write individual prompt files
  const promptsDir = path.join(cacheRoot, "experience-prompts");
  await fs.ensureDir(promptsDir);

  for (const entry of schedule.prompts) {
    const promptFile = path.join(promptsDir, `${entry.id}.md`);
    await fs.writeFile(promptFile, entry.prompt, "utf-8");
  }

  console.log(
    `📝 经验提取 SubAgent Prompt 已生成:` +
      `\n   Wiki 页面: ${schedule.summary.totalWikiPages}` +
      `\n   聚簇数量: ${schedule.summary.totalClusters}` +
      `\n   输出目录: ${promptsDir}`,
  );
  console.log(
    `\n💡 下一步: spawn SubAgent，读取 ${promptsDir}/exp-001.md` +
      `\n   完成后手动运行 assemble-experience 追加到 book.md`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("extract-experience.ts") ||
  process.argv[1]?.endsWith("extract-experience.js");
if (isMainModule) main();
