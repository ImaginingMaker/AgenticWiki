/**
 * export-issues-csv.ts
 *
 * 从 volume-2-issues 目录下扫描所有 ISSUE 文件（根级 + 子章节），
 * 解析 YAML frontmatter + Markdown 内容，产出一个汇总 CSV 文件。
 *
 * 用法：
 *   npx tsx scripts/export-issues-csv.ts --project project/mini-longfor-online
 *   npx tsx scripts/export-issues-csv.ts --wiki project/mini-longfor-online/wiki
 *
 * 输出：
 *   <wiki>/issues-export.csv              —— 全部 Issue 明细
 *   <wiki>/issues-export-summary.csv      —— 按类型/严重度汇总
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================
// Types
// ============================================================

interface RootIssueMeta {
  id: string;
  title: string;
  priority: string;
  category?: string;
  status: string;
  createdAt: string;
  sourceFile?: string;
  location?: string;
  tags?: string[];
  relatedChapter?: string;
  relatedFiles?: string[];
}

interface ChapterIssueMeta {
  id: string;
  type?: string;
  severity?: string;
  confidence: string;
  status: string;
  detected_at: string;
  source_files: string[];
}

interface UnifiedIssue {
  id: string;
  title: string;
  type: string;
  severity: string;
  priority: string;
  status: string;
  date: string;
  sourceFiles: string[];
  chapter: string;
  source: "root" | "chapter";
  summary: string;
}

// ============================================================
// Helpers
// ============================================================

function parseFrontmatter(raw: string): Record<string, unknown> {
  const lines = raw.split("\n");
  const result: Record<string, unknown> = {};
  let currentKey = "";

  for (const line of lines) {
    if (!line.trim() || line.trim() === "---") continue;

    const match = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (match) {
      const key = match[1]!;
      let value = match[2]!.trim();

      if (value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1);
        result[key] = inner
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      } else {
        value = value.replace(/^['"]|['"]$/g, "");
        result[key] = value;
      }
      currentKey = key;
    } else if (currentKey && line.startsWith("  - ")) {
      const item = line
        .replace(/^\s*-\s*/, "")
        .trim()
        .replace(/^['"]|['"]$/g, "");
      const existing = result[currentKey];
      if (Array.isArray(existing)) {
        existing.push(item);
      } else {
        result[currentKey] = [item];
      }
    }
  }

  return result;
}

function severityToPriority(severity: string): string {
  const s = severity.toLowerCase();
  if (s === "critical" || s === "p0") return "P0 - 致命";
  if (s === "high" || s === "p1" || s === "major") return "P1 - 高";
  if (s === "medium" || s === "p2") return "P2 - 中";
  if (
    s === "low" ||
    s === "p3" ||
    s === "minor" ||
    s === "info" ||
    s === "warning"
  )
    return "P3 - 低";
  return severity;
}

function normalizeSeverity(raw: string | undefined): string {
  if (!raw) return "unknown";
  const s = raw.toLowerCase();
  if (s === "critical" || s === "p0") return "critical";
  if (s === "high" || s === "p1" || s === "major") return "high";
  if (s === "medium" || s === "p2") return "medium";
  if (
    s === "low" ||
    s === "p3" ||
    s === "minor" ||
    s === "info" ||
    s === "warning"
  )
    return "low";
  return "unknown";
}

function priorityToSeverity(priority: string): string {
  const p = priority.toUpperCase();
  if (p.startsWith("P0") || p === "CRITICAL") return "critical";
  if (p.startsWith("P1") || p === "HIGH") return "high";
  if (p.startsWith("P2") || p === "MEDIUM") return "medium";
  if (p.startsWith("P3") || p === "LOW") return "low";
  return "unknown";
}

/** 类型标准化，支持多种别名 */
const TYPE_MAP: Record<string, string> = {
  security: "security",
  performance: "performance",
  bug: "bug",
  bugs: "bug",
  typescript: "typescript",
  dead_code: "dead_code",
  "dead-code": "dead_code",
  deadcode: "dead_code",
  maintainability: "maintainability",
  complexity: "complexity",
  ux: "ux",
  riskcontrol: "riskcontrol",
  // 次要标签 → 主要分类
  "edge-case": "bug",
  "logic-error": "bug",
  "error-handling": "bug",
  "type-safety": "typescript",
  naming: "typescript",
  i18n: "maintainability",
  constants: "maintainability",
  refactor: "complexity",
  "defensive-programming": "security",
  "magic-number": "maintainability",
};

function normalizeType(
  raw: string | undefined,
  chapter?: string,
  fileName?: string,
): string {
  const t = (raw || "").toLowerCase().trim();

  if (TYPE_MAP[t]) return TYPE_MAP[t]!;

  // 从章节目录名推断（支持 ch-NN-xxx 和 ch-xxx 两种格式）
  if (chapter) {
    const chType = chapter.replace(/^ch-(\d+-)?/, "");
    if (TYPE_MAP[chType]) return TYPE_MAP[chType]!;
    return chType;
  }

  // 从文件名推断类型
  if (fileName) {
    const fn = fileName.toLowerCase();
    for (const [key, val] of Object.entries(TYPE_MAP)) {
      if (fn.includes(key.replace(/_/g, "-"))) return val;
      if (fn.includes(key)) return val;
    }
  }

  return t || "unknown";
}

function extractSummary(body: string): string {
  const descMatch = body.match(/##\s*问题描述\s*\n+([\s\S]*?)(?=\n##|\n---|$)/);
  if (descMatch) {
    return descMatch[1]!.trim().replace(/\n/g, " ").slice(0, 300);
  }

  const detectMatch = body.match(
    /##\s*检测依据\s*\n+([\s\S]*?)(?=\n##|\n---|$)/,
  );
  if (detectMatch) {
    return detectMatch[1]!.trim().replace(/\n/g, " ").slice(0, 300);
  }

  const firstPara = body
    .split("\n")
    .find(
      (l) =>
        l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith("---"),
    );
  return firstPara?.trim().slice(0, 300) || "";
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

// ============================================================
// Parsers
// ============================================================

function parseRootIssue(
  filePath: string,
  chapter: string,
): UnifiedIssue | null {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parts = raw.split(/^---\s*$/m);

  if (parts.length < 2) return null;

  const fmRaw = parts[1] || "";
  const body = parts.slice(2).join("---").trim();
  const fm = parseFrontmatter(fmRaw) as unknown as RootIssueMeta;

  const title = (fm.title as string) || "";
  const category = fm.category || "";
  const priority = (fm.priority as string) || "";
  const tags: string[] = (fm.tags as string[]) || [];
  const severity = priorityToSeverity(priority);

  // 优先 category + type，其次 tags 第一项，否则从文件名推断
  const typeSource =
    category ||
    ((fm as Record<string, unknown>).type as string) ||
    (tags.length > 0 ? tags[0] : "");
  const fileName = path.basename(filePath, ".md");
  const type = normalizeType(typeSource, chapter, fileName);

  const sourceFiles: string[] = [];
  if (fm.sourceFile) sourceFiles.push(fm.sourceFile);
  if (fm.relatedFiles) sourceFiles.push(...fm.relatedFiles);

  return {
    id: fm.id || fileName,
    title,
    type,
    severity,
    priority,
    status: fm.status || "unknown",
    date: fm.createdAt || "",
    sourceFiles,
    chapter,
    source: "root",
    summary: extractSummary(body),
  };
}

function parseChapterIssue(
  filePath: string,
  chapter: string,
): UnifiedIssue | null {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parts = raw.split(/^---\s*$/m);

  if (parts.length < 2) return null;

  const fmRaw = parts[1] || "";
  const body = parts.slice(2).join("---").trim();
  const fm = parseFrontmatter(fmRaw) as unknown as ChapterIssueMeta;

  const fileName = path.basename(filePath, ".md");

  const h1Match = body.match(/^#\s+(.+)$/m);
  const title = h1Match ? h1Match[1].trim() : fileName;

  // 从文件名提取严重度作为 fallback（如 IS-0001-CRITICAL-xxx.md）
  const sevFromName = fileName.match(
    /-(CRITICAL|HIGH|MEDIUM|LOW|P0|P1|P2|P3)-/i,
  )?.[1];
  const severity = normalizeSeverity(fm.severity || sevFromName);
  const type = normalizeType(fm.type, chapter, fileName);
  const priority = severityToPriority(severity);

  return {
    id: fm.id || fileName,
    title,
    type,
    severity,
    priority,
    status: fm.status || "detected",
    date: fm.detected_at ? fm.detected_at.slice(0, 10) : "",
    sourceFiles: fm.source_files || [],
    chapter,
    source: "chapter",
    summary: extractSummary(body),
  };
}

// ============================================================
// Scanner
// ============================================================

function scanIssues(volume2Path: string): UnifiedIssue[] {
  const issues: UnifiedIssue[] = [];

  // 1. 根级 IS-*.md
  const rootFiles = fs
    .readdirSync(volume2Path)
    .filter((f) => /^IS-\d{4}\.md$/.test(f))
    .sort();

  for (const file of rootFiles) {
    const issue = parseRootIssue(
      path.join(volume2Path, file),
      "volume-2-issues",
    );
    if (issue) issues.push(issue);
  }

  // 2. 子章节目录
  const entries = fs.readdirSync(volume2Path, { withFileTypes: true });
  const chapterDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("ch-"))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const dir of chapterDirs) {
    const chapterPath = path.join(volume2Path, dir.name);
    const files = fs
      .readdirSync(chapterPath)
      .filter((f) => f.endsWith(".md"))
      .sort();

    for (const file of files) {
      const issue = parseChapterIssue(path.join(chapterPath, file), dir.name);
      if (issue) issues.push(issue);
    }
  }

  return issues;
}

// ============================================================
// CSV Generator
// ============================================================

function generateDetailCsv(issues: UnifiedIssue[]): string {
  const headers = [
    "ID",
    "标题",
    "类型",
    "严重度",
    "优先级",
    "状态",
    "日期",
    "来源章节",
    "来源类型",
    "相关文件",
    "摘要",
  ];

  const rows = [headers.join(",")];

  for (const issue of issues) {
    rows.push(
      [
        csvEscape(issue.id),
        csvEscape(issue.title),
        csvEscape(issue.type),
        csvEscape(issue.severity),
        csvEscape(issue.priority),
        csvEscape(issue.status),
        csvEscape(issue.date),
        csvEscape(issue.chapter),
        csvEscape(issue.source),
        csvEscape(issue.sourceFiles.join("; ")),
        csvEscape(issue.summary),
      ].join(","),
    );
  }

  return rows.join("\n");
}

function generateSummaryCsv(issues: UnifiedIssue[]): string {
  const lines: string[] = [];

  // 概览
  lines.push("=== ISSUE 汇总报告 ===");
  lines.push("");
  lines.push("总 ISSUE 数," + issues.length);
  lines.push(
    "根级 ISSUE 数," + issues.filter((i) => i.source === "root").length,
  );
  lines.push(
    "章节 ISSUE 数," + issues.filter((i) => i.source === "chapter").length,
  );
  lines.push("");

  // 按类型分布
  lines.push("=== 按类型分布 ===");
  lines.push("类型,数量");
  const typeCount = new Map<string, number>();
  for (const i of issues) {
    typeCount.set(i.type, (typeCount.get(i.type) || 0) + 1);
  }
  for (const [type, count] of [...typeCount.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`${type},${count}`);
  }
  lines.push("");

  // 按严重度分布
  lines.push("=== 按严重度分布 ===");
  lines.push("严重度,数量");
  const sevCount = new Map<string, number>();
  for (const i of issues) {
    sevCount.set(i.severity, (sevCount.get(i.severity) || 0) + 1);
  }
  const sevOrder = ["critical", "high", "medium", "low", "unknown"];
  for (const sev of sevOrder) {
    if (sevCount.has(sev)) {
      lines.push(`${sev},${sevCount.get(sev)}`);
    }
  }
  for (const [sev, count] of [...sevCount.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    if (!sevOrder.includes(sev)) {
      lines.push(`${sev},${count}`);
    }
  }
  lines.push("");

  // 按优先级分布
  lines.push("=== 按优先级分布 ===");
  lines.push("优先级,数量");
  const priCount = new Map<string, number>();
  for (const i of issues) {
    const priGroup = i.priority.split(" - ")[0] || i.priority;
    priCount.set(priGroup, (priCount.get(priGroup) || 0) + 1);
  }
  for (const [pri, count] of [...priCount.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`${pri},${count}`);
  }
  lines.push("");

  // 按章节分布
  lines.push("=== 按来源章节分布 ===");
  lines.push("章节,数量");
  const chCount = new Map<string, number>();
  for (const i of issues) {
    chCount.set(i.chapter, (chCount.get(i.chapter) || 0) + 1);
  }
  for (const [ch, count] of [...chCount.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`${ch},${count}`);
  }
  lines.push("");

  // 按状态分布
  lines.push("=== 按状态分布 ===");
  lines.push("状态,数量");
  const stCount = new Map<string, number>();
  for (const i of issues) {
    stCount.set(i.status, (stCount.get(i.status) || 0) + 1);
  }
  for (const [st, count] of [...stCount.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`${st},${count}`);
  }
  lines.push("");

  // 类型 × 严重度交叉表
  lines.push("=== 类型 × 严重度交叉表 ===");
  lines.push("类型,critical,high,medium,low,unknown");
  const crossTypeSev = new Map<string, Map<string, number>>();
  for (const i of issues) {
    if (!crossTypeSev.has(i.type)) crossTypeSev.set(i.type, new Map());
    const m = crossTypeSev.get(i.type)!;
    m.set(i.severity, (m.get(i.severity) || 0) + 1);
  }
  for (const [type, sevs] of [...crossTypeSev.entries()].sort((a, b) => {
    const totalA = [...a[1].values()].reduce((s, v) => s + v, 0);
    const totalB = [...b[1].values()].reduce((s, v) => s + v, 0);
    return totalB - totalA;
  })) {
    lines.push(
      `${type},${sevs.get("critical") || 0},${sevs.get("high") || 0},${sevs.get("medium") || 0},${sevs.get("low") || 0},${sevs.get("unknown") || 0}`,
    );
  }
  lines.push("");

  // TOP 20 源文件
  lines.push("=== TOP 20 高频涉及文件 ===");
  lines.push("文件路径,涉及 ISSUE 数");
  const fileCount = new Map<string, number>();
  for (const i of issues) {
    for (const f of i.sourceFiles) {
      if (f && f !== "-") {
        fileCount.set(f, (fileCount.get(f) || 0) + 1);
      }
    }
  }
  const topFiles = [...fileCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  for (const [f, count] of topFiles) {
    lines.push(`${csvEscape(f)},${count}`);
  }

  return lines.join("\n");
}

// ============================================================
// Main
// ============================================================

function main() {
  const args = process.argv.slice(2);

  let wikiPath = "";
  const projectIdx = args.indexOf("--project");
  const wikiIdx = args.indexOf("--wiki");

  if (wikiIdx >= 0 && args[wikiIdx + 1]) {
    wikiPath = path.resolve(args[wikiIdx + 1]!);
  } else if (projectIdx >= 0 && args[projectIdx + 1]) {
    wikiPath = path.resolve(args[projectIdx + 1]!, "wiki");
  } else {
    console.error(
      "用法: npx tsx scripts/export-issues-csv.ts --project <project-path>",
    );
    console.error(
      "      npx tsx scripts/export-issues-csv.ts --wiki <wiki-path>",
    );
    process.exit(1);
  }

  const volume2Path = path.join(wikiPath, "volume-2-issues");

  if (!fs.existsSync(volume2Path)) {
    console.error(`❌ 目录不存在: ${volume2Path}`);
    process.exit(1);
  }

  console.log(`📂 扫描 ISSUE 文件: ${volume2Path}`);

  const issues = scanIssues(volume2Path);

  console.log(`   ✅ 共解析 ${issues.length} 个 ISSUE`);
  console.log(
    `      - 根级: ${issues.filter((i) => i.source === "root").length}`,
  );
  console.log(
    `      - 章节: ${issues.filter((i) => i.source === "chapter").length}`,
  );

  // 明细 CSV
  const detailCsv = generateDetailCsv(issues);
  const detailPath = path.join(wikiPath, "issues-export.csv");
  fs.writeFileSync(detailPath, "\ufeff" + detailCsv, "utf-8");
  console.log(`📊 明细 CSV 已生成: ${detailPath}`);

  // 汇总 CSV
  const summaryCsv = generateSummaryCsv(issues);
  const summaryPath = path.join(wikiPath, "issues-export-summary.csv");
  fs.writeFileSync(summaryPath, "\ufeff" + summaryCsv, "utf-8");
  console.log(`📈 汇总 CSV 已生成: ${summaryPath}`);

  // 快速统计
  console.log("\n📋 快速统计:");
  const typeCount = new Map<string, number>();
  for (const i of issues)
    typeCount.set(i.type, (typeCount.get(i.type) || 0) + 1);
  for (const [type, count] of [...typeCount.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`   ${type}: ${count}`);
  }

  console.log("");
  const sevCount = new Map<string, number>();
  for (const i of issues)
    sevCount.set(i.severity, (sevCount.get(i.severity) || 0) + 1);
  for (const [sev, count] of [...sevCount.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`   ${sev}: ${count}`);
  }
}

main();
