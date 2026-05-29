/**
 * Parse all ISSUE Markdown files, extract YAML frontmatter metadata,
 * and generate an aggregated dashboard Markdown page.
 *
 * Usage:
 *   npx tsx src/lib/issue-dashboard.ts \
 *     --issues wiki/volume-2-issues/ \
 *     --output wiki/issues.md
 */

import fs from "fs-extra";
import path from "node:path";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

interface IssueMeta {
  id: string;
  type: string;
  severity: "high" | "medium" | "low";
  status: string;
  detected_at: string;
  source_files: string[];
}

/** Parse YAML frontmatter from a Markdown file. */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const result: Record<string, unknown> = {};
  const lines = match[1].split("\n");

  for (const line of lines) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;

    const key = kv[1];
    let value: unknown = kv[2].trim();

    if (
      typeof value === "string" &&
      value.startsWith("[") &&
      value.endsWith("]")
    ) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
    }

    result[key] = value;
  }

  return result;
}

function generateDashboard(issues: IssueMeta[]): string {
  const byStatus: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const pendingHigh: IssueMeta[] = [];
  const pendingMedium: IssueMeta[] = [];

  for (const issue of issues) {
    byStatus[issue.status] = (byStatus[issue.status] || 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    byType[issue.type] = (byType[issue.type] || 0) + 1;

    const isPending = ["detected", "verified", "fixing"].includes(issue.status);
    if (isPending && issue.severity === "high") pendingHigh.push(issue);
    if (isPending && issue.severity === "medium") pendingMedium.push(issue);
  }

  const total = issues.length;

  function chapterLink(issue: IssueMeta): string {
    const ch = getChapterForType(issue.type);
    return `[[volume-2-issues/${ch}/${issue.id}]]`;
  }

  function getChapterForType(type: string): string {
    const map: Record<string, string> = {
      circular_dependency: "ch-01-circular-deps",
      dead_code: "ch-02-dead-code",
      missing_types: "ch-03-missing-types",
      complex_logic: "ch-04-complex-logic",
      inconsistent_api: "ch-05-inconsistent-api",
      potential_bug: "ch-06-potential-bugs",
    };
    return map[type] || "ch-99-archived";
  }

  const lines: string[] = [
    "# ISSUE 仪表盘",
    "",
    `> 最后更新：${new Date().toISOString()}`,
    "",
    "## 概览",
    "",
    "| 状态 | 数量 |",
    "|------|------|",
  ];

  const statusOrder = [
    "detected",
    "verified",
    "fixing",
    "fixed",
    "false_positive",
    "archived",
  ];
  const statusEmoji: Record<string, string> = {
    detected: "🔍",
    verified: "✅",
    fixing: "🔧",
    fixed: "✅",
    false_positive: "❌",
    archived: "📦",
  };

  for (const status of statusOrder) {
    const count = byStatus[status] || 0;
    if (count > 0) {
      lines.push(`| ${statusEmoji[status] || ""} ${status} | ${count} |`);
    }
  }
  lines.push(`| **合计** | **${total}** |`);

  lines.push("", "## 严重等级分布", "", "```mermaid", "pie 严重等级分布");
  for (const [sev, count] of Object.entries(bySeverity)) {
    const label = { high: "高", medium: "中", low: "低" }[sev] || sev;
    lines.push(`    "${label}" : ${count}`);
  }
  lines.push("```");

  lines.push("", "## 按类型分布", "", "| 类型 | 数量 |", "|------|------|");
  for (const [type, count] of Object.entries(byType).sort()) {
    const pending = issues.filter(
      (i) =>
        i.type === type &&
        ["detected", "verified", "fixing"].includes(i.status),
    ).length;
    lines.push(
      `| ${type} | ${count} | ${pending > 0 ? `待处理 ${pending}` : ""} |`,
    );
  }

  if (pendingHigh.length > 0) {
    lines.push(
      "",
      "## 🔴 待处理 — 高严重性",
      "",
      "| ID | 类型 | 文件 | 发现日期 |",
      "|----|------|------|---------|",
    );
    for (const issue of pendingHigh) {
      const date = issue.detected_at?.slice(0, 10) || "-";
      lines.push(
        `| ${chapterLink(issue)} | ${issue.type} | ${issue.source_files?.join(", ") || "-"} | ${date} |`,
      );
    }
  }

  if (pendingMedium.length > 0) {
    lines.push(
      "",
      "## 🟡 待处理 — 中等严重性",
      "",
      "| ID | 类型 | 文件 | 发现日期 |",
      "|----|------|------|---------|",
    );
    for (const issue of pendingMedium.slice(0, 10)) {
      const date = issue.detected_at?.slice(0, 10) || "-";
      lines.push(
        `| ${chapterLink(issue)} | ${issue.type} | ${issue.source_files?.join(", ") || "-"} | ${date} |`,
      );
    }
  }

  return lines.join("\n");
}

export async function generateIssueDashboard(
  issuesPath: string,
  outputPath: string,
): Promise<void> {
  const mdFiles = await globby(["**/*.md"], {
    cwd: issuesPath,
    ignore: ["_toc.md", "index.md", "**/index.md"],
    onlyFiles: true,
  });

  const issues: IssueMeta[] = [];

  for (const file of mdFiles) {
    const fullPath = path.join(issuesPath, file);
    const content = await fs.readFile(fullPath, "utf-8");
    const fm = parseFrontmatter(content);

    if (fm?.id && fm?.type) {
      issues.push({
        id: fm.id as string,
        type: fm.type as string,
        severity: (fm.severity as IssueMeta["severity"]) || "medium",
        status: (fm.status as string) || "detected",
        detected_at: (fm.detected_at as string) || "",
        source_files: (fm.source_files as string[]) || [],
      });
    }
  }

  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => {
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return b.detected_at.localeCompare(a.detected_at);
  });

  const dashboard = generateDashboard(issues);
  await fs.outputFile(outputPath, dashboard, "utf-8");

  process.stdout.write(
    `Issue dashboard: ${issues.length} issues across ${mdFiles.length} files\n` +
      `Written to ${outputPath}\n`,
  );
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("issues", { type: "string", demandOption: true })
    .option("output", { type: "string", demandOption: true })
    .parseSync();

  await generateIssueDashboard(argv.issues, argv.output);
}

const isMainModule =
  process.argv[1]?.endsWith("issue-dashboard.ts") ||
  process.argv[1]?.endsWith("issue-dashboard.js");
if (isMainModule) main();
