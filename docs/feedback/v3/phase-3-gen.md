# Phase 3: GEN 阶段重构

> 涉及脚本：`gen-scheduler.ts` · `sync-gen-tasks.ts` · `verify-gen-artifacts.ts` · `progress-dashboard.ts`
> 依赖关系：依赖 Phase 2（Token 估算 + 聚簇阈值）
> 核心目标：G2（Token 预算 v3）、G3（12 章节 Prompt）、#5（Resume 提取）、#8（Issue ID）

---

## 1. 问题清单

### 1.1 gen-scheduler.ts（1385 行）

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| G1-1 | 🔴 | **80% 代码重复**：`buildSubTaskPrompt()`(L275-413) 与 `buildClusterPrompt()`(L818-964) 内容 ~80% 相同；`buildGenSchedule()`(L461-760) 与 `buildClusterSchedule()`(L970-1145) 调度逻辑几乎完全重复 | 全局 |
| G1-2 | 🔴 | **死代码**：`getIssueRulesTemplate()`、`getOutputFormatTemplate()`、`getPathSafetyTemplate()`、`ensureTemplates()` 生成模板文件，但 `buildSubTaskPrompt()` 和 `buildClusterPrompt()` 直接内联等价文本，从不引用这些文件 | L86-262 |
| G1-3 | 🔴 | **Token 预算上限 80K 不足**：`calcTokenBudget()` 硬编码 `Math.min(..., 80000)`，1M 模型下过于保守 | L77-80 |
| G1-4 | 🟡 | `crossFolderMerges` 不支持 retry：只处理 `!genTask` 和 `completed`，`failed`/`in_progress`/`pending` 被静默忽略 | L647-689 |
| G1-5 | 🟡 | `buildGenSchedule` 内部创建的 `newGenTasks`(L721-736) 未被使用或返回 — 死代码 | L721-736 |
| G1-6 | 🟢 | `replace(/\\\$/g, "$")` 无效操作，模板字符串 join 后不含转义序列 | L135-136, L208-209 |

### 1.2 sync-gen-tasks.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| G2-1 | 🟡 | **副作用突变**：直接修改传入 `state.genTasks` 数组中的对象，`atomicUpdate` 重新读磁盘可能导致数据冲突 | L250 |
| G2-2 | 🟡 | `hasWikiContent` 只检查 `.md` 文件存在，不检查 size > 0（空文件也算完成） | L61 |
| G2-3 | 🟡 | `findWikiChapterDir` 用 `replace(/[/\\]/g, "_")` 匹配目录名，与 `id-utils.ts` 的 `sanitizePathId` 规则不一致 | L100-104 |

### 1.3 verify-gen-artifacts.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| G3-1 | 🟡 | `scanMermaidLeaks` 对全项目 `globby(["**/*"])` 扫描所有文件仅检查文件名，大项目性能差 | L141-152 |
| G3-2 | 🟡 | `verifyIssueFiles` 只检查 3 种角色（entry/ui-components/cross），其他角色的 Issue 交叉验证被遗漏 | L458-460 |
| G3-3 | 🟡 | `ISSUE_ID_RE` 与 `sync-gen-tasks.ts` 重复定义 | L335 |

### 1.4 progress-dashboard.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| G4-1 | 🟡 | 聚簇模式下如果 `state.genTasks` 为空（首次运行未 `--write-state`），进度面板显示 0% | 回退逻辑 |

---

## 2. 重构方案

### 2.1 Token 预算公式 v3（G2 核心）

```typescript
export function calcTokenBudget(
  estimatedTokens: number,
  projectTotalTokens?: number,
): number {
  let budget: number;
  if (estimatedTokens <= 10_000) {
    budget = estimatedTokens * 2.5 + 8_000;
  } else if (estimatedTokens <= 50_000) {
    budget = estimatedTokens * 2.0 + 10_000;
  } else {
    budget = estimatedTokens * 1.5 + 15_000;
  }

  if (projectTotalTokens && projectTotalTokens > 0) {
    budget = Math.min(budget, projectTotalTokens * 0.3);
  }

  return Math.max(15_000, Math.min(200_000, Math.round(budget)));
}
```

### 2.2 Prompt 构建函数合并去重（G1-1）

将 `buildSubTaskPrompt` 和 `buildClusterPrompt` 合并为统一入口：

```typescript
interface PromptContext {
  type: "folder" | "cluster";
  id: string;
  label: string;
  folder: string;
  files: string[];
  estimatedTokens: number;
  wikiChapter: string;
  projectRoot: string;
  sourceRoot?: string;
  cacheRoot: string;
  issueIdStart: number;
  issueIdGap: number;
}

export function buildPrompt(ctx: PromptContext): string {
  const budget = calcTokenBudget(ctx.estimatedTokens);
  const metaTable = ctx.type === "cluster"
    ? extractClusterMetaTable(ctx.files, ctx.projectRoot, ctx.cacheRoot)
    : "";
  const depsContext = extractClusterDepsContext(ctx.files, ctx.cacheRoot);

  return [
    buildPromptHeader(ctx),
    buildIssueRulesSection(ctx.issueIdStart, ctx.issueIdGap),
    buildContextSection(ctx, budget),
    buildTaskSection(ctx, metaTable, depsContext),
    buildStepsSection(ctx, budget),
  ].join("\n");
}
```

同理，`buildGenSchedule` 和 `buildClusterSchedule` 合并为 `buildSchedule`，通过 `source` 字段区分模式。

### 2.3 12 章节 Prompt 模板（G3 核心）

在统一的 `buildTaskSection` 中替换必需章节列表：

```typescript
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
```

### 2.4 注入聚簇依赖上下文

新增 `extractClusterDepsContext()`，从 `dependency-graph.json` 提取聚簇的外部依赖和被依赖方，注入 Prompt 中为 SubAgent 生成「需求背景」「使用示例」「设计决策」提供上下文。

### 2.5 清理死代码

- 删除 `getIssueRulesTemplate()`、`getOutputFormatTemplate()`、`getPathSafetyTemplate()`
- 删除 `ensureTemplates()`（及其在 `buildGenSchedule` 和 CLI `main()` 中的调用）
- 删除 `buildGenSchedule` 内部的未使用 `newGenTasks` 数组
- 删除无效 `replace()` 调用

### 2.6 sync-gen-tasks.ts 修复

```typescript
// 改为返回新数组而非突变原对象
export function syncGenTasks(state: WikiState, wikiRoot: string): GenTask[] {
  return (state.genTasks || []).map(task => {
    if (task.status === "completed") return { ...task };
    const hasContent = hasWikiContent(wikiRoot, task);
    if (hasContent) return { ...task, status: "completed" as const };
    return { ...task };
  });
}

// hasWikiContent 增加 size 检查
function hasWikiContent(wikiRoot: string, task: GenTask): boolean {
  // ... 查找 .md 文件
  if (!mdFile) return false;
  const stat = fs.statSync(mdFile);
  return stat.size >= 500; // 与 verify-gen-artifacts 对齐
}
```

### 2.7 共享正则提取

将 `ISSUE_ID_RE` 提取到 `src/lib/shared/issue-parser.ts`，sync-gen-tasks 和 verify-gen-artifacts 共用。

---

## 3. 受影响文件

| 文件 | 改动类型 |
|------|---------|
| `src/lib/gen/gen-scheduler.ts` | 大幅修改：合并去重、Token v3、12 章节、清理死代码 |
| `src/lib/gen/sync-gen-tasks.ts` | 修改：immutable 返回、size 检查、共享正则 |
| `src/lib/gen/verify-gen-artifacts.ts` | 修改：共享正则、角色过滤去硬编码 |
| `src/lib/gen/progress-dashboard.ts` | 修改：聚簇模式空 genTasks 处理 |
| `src/lib/shared/issue-parser.ts` | 修改：新增 ISSUE_ID_RE 导出 |

---

## 4. 测试要点

- [ ] `calcTokenBudget(80000)` = 135000（非旧版 80000）
- [ ] `calcTokenBudget(1000)` = 15000（下限保障）
- [ ] `buildPrompt` 输出包含 12 个 `## N.` 章节标题
- [ ] `buildPrompt` 输出包含聚簇外部依赖和被依赖方列表
- [ ] 合并后的 `buildSchedule` 对文件夹和聚簇模式输出一致的调度结构
- [ ] `syncGenTasks` 不突变原数组
- [ ] `hasWikiContent` 对 0 字节 .md 文件返回 false
