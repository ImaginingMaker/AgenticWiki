/**
 * Build File-Issue Reverse Index — 🆕 Issue ↔ Code 双向绑定基础设施。
 *
 * 扫描 volume-2-issues/ 下所有 Issue 文件，解析其 source_files frontmatter，
 * 生成反向索引 file-issues-index.json，实现"从源文件查找关联 Issue"。
 *
 * 同时生成一个副产物 wiki/file-issues.md（可选 Markdown 摘要），供
 * assemble-master-index.ts 在统一入口中引用。
 *
 * Usage:
 *   npx tsx src/lib/assemble/build-file-issue-index.ts \
 *     --issues wiki/volume-2-issues/ \
 *     --output .agentic-wiki/cache/file-issues-index.json
 */

import path from "node:path";
import fs from "fs-extra";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { parseIssueFrontmatter } from "../shared/issue-parser.js";

// === Types ===

interface IssueSummary {
  id: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  sourceFiles: string[];
  relativePath: string;
}

interface FileIssueIndex {
  generatedAt: string;
  fileToIssues: Record<string, IssueSummary[]>;
  stats: {
    totalIssues: number;
    totalFilesWithIssues: number;
    bySeverity: Record<string, number>;
  };
}

// === Extract title from issue content ===

function extractIssueTitle(content: string): string {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  const h2 = content.match(/^##\s+(.+)$/m);
  return h2 ? h2[1].trim() : "Untitled";
}

// === Core ===

export async function buildFileIssueIndex(
  issuesDir: string,
): Promise<FileIssueIndex> {
  const mdFiles = await globby(["**/*.md"], {
    cwd: issuesDir,
    ignore: ["**/index.md", "ch-99-archived/**"],
    onlyFiles: true,
  });

  const fileToIssues: Record<string, IssueSummary[]> = {};
  const bySeverity: Record<string, number> = {};
  let totalIssues = 0;

  for (const rel of mdFiles) {
    const fullPath = path.join(issuesDir, rel);
    let content: string;
    try {
      content = await fs.readFile(fullPath, "utf-8");
    } catch {
      continue;
    }

    const fm = parseIssueFrontmatter(content);
    if (!fm?.id || !fm?.type) continue;

    const sourceFiles: string[] = fm.source_files || [];
    const severity = fm.severity || "medium";
    const status = fm.status || "detected";
    const title = extractIssueTitle(content);

    totalIssues++;
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;

    const summary: IssueSummary = {
      id: fm.id,
      type: fm.type,
      severity,
      status,
      title,
      sourceFiles,
      relativePath: rel,
    };

    // Map each source file to this issue
    for (const sf of sourceFiles) {
      if (!fileToIssues[sf]) fileToIssues[sf] = [];
      fileToIssues[sf].push(summary);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    fileToIssues,
    stats: {
      totalIssues,
      totalFilesWithIssues: Object.keys(fileToIssues).length,
      bySeverity,
    },
  };
}

// === Generate Markdown summary (observable in Obsidian graph) ===

export function generateFileIssuesMarkdown(
  index: FileIssueIndex,
  issuesRelativePath: string,
): string {
  const lines: string[] = [
    "# 📋 文件 → Issue 反向索引",
    "",
    `> ${index.stats.totalIssues} 个 Issue 关联到 ${index.stats.totalFilesWithIssues} 个源文件`,
    `> 生成时间：${index.generatedAt}`,
    "",
    "## 严重等级分布",
    "",
    "| 严重等级 | 数量 |",
    "|---------|------|",
  ];

  const sevOrder = ["critical", "high", "medium", "low"];
  const sevLabels: Record<string, string> = {
    critical: "⛔ 致命",
    high: "🔴 高",
    medium: "🟡 中",
    low: "🟢 低",
  };
  for (const sev of sevOrder) {
    const count = index.stats.bySeverity[sev] || 0;
    if (count > 0) {
      lines.push(`| ${sevLabels[sev] || sev} | ${count} |`);
    }
  }

  lines.push("", "---", "", "## 文件 → Issue 映射", "");

  // Sort files alphabetically
  const sortedFiles = Object.keys(index.fileToIssues).sort();
  for (const file of sortedFiles) {
    const issues = index.fileToIssues[file];
    lines.push(`### \`${file}\``, "");

    for (const issue of issues) {
      const sevEmoji: Record<string, string> = {
        critical: "⛔",
        high: "🔴",
        medium: "🟡",
        low: "🟢",
      };
      const emoji = sevEmoji[issue.severity] || "⚪";
      const issueLink = `${issuesRelativePath}/${issue.relativePath.replace(/\.md$/, "")}`;
      lines.push(
        `- ${emoji} [[${issueLink}|${issue.id}]] — ${issue.title} _( ${issue.type} )_`,
      );
    }

    lines.push("");
  }

  lines.push("---", "", `> 💡 由 \`build-file-issue-index.ts\` 自动生成`);

  return lines.join("\n") + "\n";
}

// === CLI ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("issues", {
      type: "string",
      demandOption: true,
      description: "Path to volume-2-issues/ directory",
    })
    .option("output", {
      type: "string",
      description: "Path to write file-issues-index.json",
    })
    .option("markdown", {
      type: "string",
      description: "Path to write file-issues.md (optional Markdown output)",
    })
    .parseSync();

  const issuesDir = path.resolve(argv.issues);

  if (!(await fs.pathExists(issuesDir))) {
    console.log("file-issue-index: volume-2-issues not found, skipping.");
    process.exit(0);
  }

  const index = await buildFileIssueIndex(issuesDir);

  if (argv.output) {
    await fs.outputJson(path.resolve(argv.output), index, { spaces: 2 });
  }

  if (argv.markdown) {
    const md = generateFileIssuesMarkdown(index, "volume-2-issues");
    await fs.outputFile(path.resolve(argv.markdown), md, "utf-8");
  }

  console.log(
    `File-Issue Index: ${index.stats.totalIssues} issues → ${index.stats.totalFilesWithIssues} files`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("build-file-issue-index.ts") ||
  process.argv[1]?.endsWith("build-file-issue-index.js");
if (isMainModule) main();
