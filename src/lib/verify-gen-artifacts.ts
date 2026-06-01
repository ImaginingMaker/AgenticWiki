/**
 * Verify GEN Artifacts — 验证 GEN SubAgent 产物完整性。
 *
 * 功能：
 *   1. Mermaid 泄露扫描 — 检测项目根目录和 wiki 目录中的 Mermaid 语法泄露文件
 *   2. Wiki 目录存在性验证 — 验证每个 completed genTask 的 wiki 目录存在且非空
 *   3. Issue 文件交叉验证 — 检测 Wiki "已知问题" 章节引用的 Issue 是否有对应独立文件
 *   4. 输出结构化报告，标记需要重跑的 genTask
 *
 * 替代编排器 Phase 2 Step 5a + 5b 中的手工 find_path + list_directory 操作。
 *
 * Usage:
 *   npx tsx src/lib/verify-gen-artifacts.ts \
 *     --state .agentic-wiki/state.json \
 *     --output .agentic-wiki/cache/gen-verification.json \
 *     [--clean]          # 自动删除泄露文件
 *     [--only-failed]    # 只输出失败的条目
 */

import path from "node:path";
import fs from "fs-extra";
import { globby } from "globby";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { WikiState, GenTask } from "../types/index.js";

// === Types ===

export interface LeakedFile {
  path: string;
  matchType:
    | "mermaid_rect"
    | "mermaid_diamond"
    | "mermaid_edge"
    | "mermaid_other";
  matched: string;
}

export interface WikiDirCheck {
  genTaskId: string;
  folder: string;
  wikiChapter: string;
  expectedDir: string;
  exists: boolean;
  isEmpty: boolean;
  mdFileCount: number;
  passed: boolean;
  error?: string;
}

export interface IssueFileCheck {
  genTaskId: string;
  folder: string;
  wikiFile: string;
  /** Issue IDs extracted from Wiki "已知问题" section */
  referencedIssueIds: string[];
  /** Issue IDs that have a corresponding file in volume-2-issues/ */
  resolved: string[];
  /** Issue IDs that are mentioned but have NO file */
  orphaned: string[];
  passed: boolean;
  /** true if Wiki has no "已知问题" section at all */
  noIssuesSection: boolean;
}

export interface GenVerificationReport {
  validatedAt: string;
  projectRoot: string;
  mermaidLeaks: {
    found: boolean;
    files: LeakedFile[];
    cleaned: boolean;
  };
  wikiDirs: {
    total: number;
    passed: number;
    failed: number;
    checks: WikiDirCheck[];
  };
  issueLinks: {
    total: number;
    passed: number;
    failed: number;
    checks: IssueFileCheck[];
  };
  tasksNeedingRetry: string[];
  summary: {
    allPassed: boolean;
    leaksDetected: number;
    dirsFailed: number;
    issueLinksFailed: number;
  };
}

// === Mermaid Leak Detection ===

/** Patterns that indicate Mermaid syntax leaked into filenames. */
const MERMAID_LEAK_GLOBS = [
  { glob: "**/*[*", type: "mermaid_rect" as const },
  { glob: "**/*{*", type: "mermaid_diamond" as const },
  { glob: "**/*(*", type: "mermaid_other" as const },
];

/** Strings that indicate Mermaid edge labels leaked into file content (searched in filenames). */
const MERMAID_EDGE_PATTERNS = [
  "isSub=true",
  "isSub=false",
  "circular: true",
  "circular: false",
];

async function scanMermaidLeaks(projectRoot: string): Promise<LeakedFile[]> {
  const leaks: LeakedFile[] = [];

  // Scan for files with Mermaid node characters in their names
  for (const { glob: pattern, type } of MERMAID_LEAK_GLOBS) {
    try {
      const files = await globby([pattern], {
        cwd: projectRoot,
        onlyFiles: true,
        ignore: ["node_modules", ".git", "dist", "build", ".agentic-wiki"],
        dot: false,
      });

      for (const file of files) {
        leaks.push({
          path: file,
          matchType: type,
          matched: file,
        });
      }
    } catch {
      // globby may fail with certain patterns — skip
    }
  }

  // Scan for files with Mermaid edge labels
  try {
    const allFiles = await globby(["**/*"], {
      cwd: projectRoot,
      onlyFiles: true,
      ignore: [
        "node_modules",
        ".git",
        "dist",
        "build",
        ".agentic-wiki",
        "wiki",
      ],
      dot: false,
    });

    for (const file of allFiles) {
      const basename = path.basename(file);
      for (const pattern of MERMAID_EDGE_PATTERNS) {
        if (basename.includes(pattern)) {
          leaks.push({
            path: file,
            matchType: "mermaid_edge",
            matched: pattern,
          });
          break;
        }
      }
    }
  } catch {
    // skip
  }

  return leaks;
}

async function cleanLeakedFiles(
  leaks: LeakedFile[],
  projectRoot: string,
): Promise<string[]> {
  const cleaned: string[] = [];
  for (const leak of leaks) {
    const fullPath = path.join(projectRoot, leak.path);
    try {
      if (await fs.pathExists(fullPath)) {
        await fs.remove(fullPath);
        cleaned.push(leak.path);
      }
    } catch (err: any) {
      process.stderr.write(`Failed to remove ${leak.path}: ${err.message}\n`);
    }
  }
  return cleaned;
}

// === Wiki Directory Verification ===

async function verifyWikiDirs(
  genTasks: GenTask[],
  projectRoot: string,
): Promise<WikiDirCheck[]> {
  const checks: WikiDirCheck[] = [];
  // Check ALL genTasks that have a wikiChapter, regardless of status.
  // Pending tasks with missing output must be detected so --resume
  // doesn't silently skip cancelled SubAgents.
  const tasksToCheck = genTasks.filter((t) => t.wikiChapter);

  for (const task of tasksToCheck) {
    const wikiDir = path.join(
      projectRoot,
      "wiki",
      "volume-1-code",
      task.wikiChapter || "",
    );
    // wikiChapter might include a filename like "ch-src/sec-ui.md" — get the parent dir
    const dirPath = wikiDir.endsWith(".md") ? path.dirname(wikiDir) : wikiDir;

    let exists = false;
    let isEmpty = true;
    let mdCount = 0;
    let error: string | undefined;

    try {
      exists = await fs.pathExists(dirPath);
      if (exists) {
        const entries = await fs.readdir(dirPath);
        const mdFiles = entries.filter(
          (e) => e.endsWith(".md") && !e.startsWith("."),
        );
        mdCount = mdFiles.length;
        isEmpty = mdCount === 0;

        // Check each MD file for non-empty content
        for (const md of mdFiles) {
          const stat = await fs.stat(path.join(dirPath, md));
          if (stat.size === 0) {
            isEmpty = true;
            error = `文件 ${md} 为空 (0 bytes)`;
            break;
          }
        }
      }
    } catch (err: any) {
      error = err.message;
    }

    const passed = exists && !isEmpty;

    checks.push({
      genTaskId: task.id,
      folder: task.folder,
      wikiChapter: task.wikiChapter || "",
      expectedDir: path.relative(projectRoot, dirPath),
      exists,
      isEmpty,
      mdFileCount: mdCount,
      passed,
      error,
    });
  }

  return checks;
}

// === Issue File Cross-Verification ===

/**
 * Regex to match Issue ID patterns in Wiki "已知问题" sections:
 *   - IS-{YYYY}-{NNN}           (global numbering, e.g. IS-2026-001)
 *   - IS-{YYYY}-{NNN}-{序号}     (component-scoped, e.g. IS-2026-201-1)
 *   - [[...IS-{YYYY}-{NNN}...]] (Obsidian wiki links)
 */
const ISSUE_ID_RE = /\bIS-(\d{4})-(\d{3})(?:-(\d+))?\b/g;

/** Regex to find the "已知问题" section header in Markdown */
const KNOWN_ISSUES_HEADER_RE = /^##\s*已知问题\s*$/m;

/**
 * Extract Issue IDs referenced in a single Wiki Markdown file.
 */
async function extractIssueIdsFromWiki(
  wikiFilePath: string,
): Promise<string[]> {
  try {
    const content = await fs.readFile(wikiFilePath, "utf-8");
    const ids = new Set<string>();
    let match: RegExpExecArray | null;
    // Reset regex state
    ISSUE_ID_RE.lastIndex = 0;
    while ((match = ISSUE_ID_RE.exec(content)) !== null) {
      ids.add(match[0]);
    }
    return Array.from(ids);
  } catch {
    return [];
  }
}

/**
 * Check if a Wiki file has a "已知问题" section with non-empty content.
 * Returns true if the section exists and has substantive content (not just "暂无").
 */
async function hasKnownIssuesSection(wikiFilePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(wikiFilePath, "utf-8");
    const match = content.match(KNOWN_ISSUES_HEADER_RE);
    if (!match || match.index === undefined) return false;

    // Get content after the header until next ## section or EOF
    const afterHeader = content.slice(match.index + match[0].length);
    const nextSectionIdx = afterHeader.search(/^##\s/m);
    const sectionContent =
      nextSectionIdx >= 0 ? afterHeader.slice(0, nextSectionIdx) : afterHeader;

    // Check if section has substantive content (more than just whitespace/placeholder)
    const trimmed = sectionContent.trim();
    if (!trimmed) return false;
    // "暂无" means "none", treat as no issues
    if (/^暂无/i.test(trimmed)) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Build a lookup map of existing Issue files in volume-2-issues/.
 * Key: Issue ID (e.g. "IS-2026-001"), Value: relative file path.
 */
async function buildIssueFileIndex(
  projectRoot: string,
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const issuesRoot = path.join(projectRoot, "wiki", "volume-2-issues");

  try {
    if (!(await fs.pathExists(issuesRoot))) return index;

    const files = await globby(["**/IS-*.md"], {
      cwd: issuesRoot,
      onlyFiles: true,
      dot: false,
    });

    for (const file of files) {
      const basename = path.basename(file, ".md");
      // Extract Issue ID from filename: "IS-2026-001" or "IS-2026-001-something"
      const idMatch = basename.match(/^(IS-\d{4}-\d{3})/);
      if (idMatch) {
        index.set(idMatch[1], file);
      }
    }
  } catch {
    // volume-2-issues doesn't exist — no files indexed
  }

  return index;
}

/**
 * Verify that each Wiki's "已知问题" section has corresponding Issue files.
 *
 * For each completed genTask:
 *   1. Find its Wiki .md files in volume-1-code
 *   2. Check if they have a "已知问题" section
 *   3. If yes, extract referenced Issue IDs
 *   4. Cross-reference against actual files in volume-2-issues/
 *   5. Flag orphaned IDs (mentioned but no file)
 */
async function verifyIssueFiles(
  genTasks: GenTask[],
  projectRoot: string,
): Promise<IssueFileCheck[]> {
  const checks: IssueFileCheck[] = [];
  const completedTasks = genTasks.filter((t) => t.status === "completed");
  const issueFileIndex = await buildIssueFileIndex(projectRoot);

  // Track which genTasks have entry role (main Wiki) vs ui_components role
  const seenFolders = new Set<string>();

  for (const task of completedTasks) {
    const wikiDir = path.join(
      projectRoot,
      "wiki",
      "volume-1-code",
      task.wikiChapter || "",
    );
    const dirPath = wikiDir.endsWith(".md") ? path.dirname(wikiDir) : wikiDir;

    // Only check the "entry" or first role for each folder to avoid duplicates
    const folderKey = task.folder;
    if (
      task.role !== "entry" &&
      task.role !== "ui-components" &&
      task.role !== "cross"
    ) {
      continue;
    }

    if (!(await fs.pathExists(dirPath))) {
      // Wiki dir doesn't exist — covered by verifyWikiDirs, skip here
      continue;
    }

    // Find the main wiki file (index.md or sec-entry.md)
    let entries: string[];
    try {
      entries = await fs.readdir(dirPath);
    } catch {
      continue;
    }

    const mdFile = entries.find(
      (e) => (e.endsWith(".md") && !e.startsWith(".")) || e === "index.md",
    );
    if (!mdFile) continue;

    const wikiFilePath = path.join(dirPath, mdFile);
    const hasSection = await hasKnownIssuesSection(wikiFilePath);

    if (!hasSection) {
      // Primary Wiki file has no "已知问题" section — valid (no issues to report)
      // But check if this folder has multiple genTask roles and the ui_components one has issues
      // Only record for entry roles, skip ui_components/sec-* files
      if (task.role === "entry" && !seenFolders.has(folderKey)) {
        seenFolders.add(folderKey);
        checks.push({
          genTaskId: task.id,
          folder: task.folder,
          wikiFile: path.relative(projectRoot, wikiFilePath),
          referencedIssueIds: [],
          resolved: [],
          orphaned: [],
          passed: true, // No issues = pass
          noIssuesSection: true,
        });
      }
      continue;
    }

    // Extract Issue IDs and check against volume-2-issues
    const allIds = await extractIssueIdsFromWiki(wikiFilePath);

    // Filter to root Issue IDs (IS-YYYY-NNN) — strip per-component suffixes like -1, -2
    const rootIds = new Set<string>();
    for (const id of allIds) {
      const rootMatch = id.match(/^(IS-\d{4}-\d{3})/);
      if (rootMatch) {
        rootIds.add(rootMatch[1]);
      }
    }

    const referenced = Array.from(rootIds).sort();
    const resolved: string[] = [];
    const orphaned: string[] = [];

    for (const id of referenced) {
      if (issueFileIndex.has(id)) {
        resolved.push(id);
      } else {
        orphaned.push(id);
      }
    }

    const passed = orphaned.length === 0;

    checks.push({
      genTaskId: task.id,
      folder: task.folder,
      wikiFile: path.relative(projectRoot, wikiFilePath),
      referencedIssueIds: referenced,
      resolved,
      orphaned,
      passed,
      noIssuesSection: false,
    });
  }

  return checks;
}

// === Main ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("state", {
      type: "string",
      demandOption: true,
      description: "Path to .agentic-wiki/state.json",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      description: "Output path for verification report JSON",
    })
    .option("clean", {
      type: "boolean",
      default: false,
      description: "Automatically delete Mermaid leak files",
    })
    .option("only-failed", {
      type: "boolean",
      default: false,
      description: "Only output failed items in console",
    })
    .parseSync();

  const state: WikiState = await fs.readJson(argv.state);
  const projectRoot = path.resolve(
    state.config.paths?.projectRoot || state.projectPath,
  );

  // 1. Mermaid leak scan
  const leaks = await scanMermaidLeaks(projectRoot);
  let cleaned: string[] = [];
  if (leaks.length > 0 && argv.clean) {
    cleaned = await cleanLeakedFiles(leaks, projectRoot);
  }

  // 2. Wiki directory verification
  const genTasks = state.genTasks || [];
  const wikiChecks = await verifyWikiDirs(genTasks, projectRoot);

  // 3. Issue file cross-verification
  const issueChecks = await verifyIssueFiles(genTasks, projectRoot);
  // Build report
  const failedWikiChecks = wikiChecks.filter((c) => !c.passed);
  const passedWikiChecks = wikiChecks.filter((c) => c.passed);
  const failedIssueChecks = issueChecks.filter((c) => !c.passed);
  const passedIssueChecks = issueChecks.filter((c) => c.passed);

  // Merge retry candidates from both wiki dir and issue link failures
  const dirRetryIds = new Set(failedWikiChecks.map((c) => c.genTaskId));
  for (const check of failedIssueChecks) {
    dirRetryIds.add(check.genTaskId);
  }
  const tasksNeedingRetry = Array.from(dirRetryIds);

  const report: GenVerificationReport = {
    validatedAt: new Date().toISOString(),
    projectRoot: path.relative(process.cwd(), projectRoot),
    mermaidLeaks: {
      found: leaks.length > 0,
      files: leaks,
      cleaned: cleaned.length > 0,
    },
    wikiDirs: {
      total: wikiChecks.length,
      passed: passedWikiChecks.length,
      failed: failedWikiChecks.length,
      checks: wikiChecks,
    },
    issueLinks: {
      total: issueChecks.length,
      passed: passedIssueChecks.length,
      failed: failedIssueChecks.length,
      checks: issueChecks,
    },
    tasksNeedingRetry,
    summary: {
      allPassed:
        leaks.length === 0 &&
        failedWikiChecks.length === 0 &&
        failedIssueChecks.length === 0,
      leaksDetected: leaks.length,
      dirsFailed: failedWikiChecks.length,
      issueLinksFailed: failedIssueChecks.length,
    },
  };

  await fs.outputJson(argv.output, report, { spaces: 2 });

  // Console output
  if (!argv["only-failed"] || !report.summary.allPassed) {
    process.stdout.write(
      `\n🔍 GEN Artifact Verification\n` + `────────────────────────────\n`,
    );

    // Mermaid leaks
    if (leaks.length > 0) {
      process.stdout.write(
        `\n🔴 Mermaid Leaks: ${leaks.length} file(s) detected\n`,
      );
      for (const leak of leaks) {
        process.stdout.write(
          `   [${leak.matchType}] ${leak.path}${cleaned.includes(leak.path) ? " (已删除)" : ""}\n`,
        );
      }
    } else {
      process.stdout.write(`\n✅ No Mermaid leaks detected\n`);
    }

    // Wiki dirs
    process.stdout.write(
      `\n📁 Wiki Directories: ${wikiChecks.length} completed genTasks\n` +
        `   ✅ Passed: ${passedWikiChecks.length}\n` +
        `   ❌ Failed: ${failedWikiChecks.length}\n`,
    );

    if (failedWikiChecks.length > 0) {
      process.stdout.write(`\nFailed directories:\n`);
      for (const check of failedWikiChecks) {
        const reason = check.error
          ? check.error
          : !check.exists
            ? "目录不存在"
            : "目录为空";
        process.stdout.write(
          `   ❌ [${check.genTaskId}] ${check.expectedDir}\n` +
            `      ${reason}\n`,
        );
      }
    }

    // Issue links
    process.stdout.write(
      `\nIssue Links: ${issueChecks.length} Wikis with known issues section\n` +
        `   Passed: ${passedIssueChecks.length}\n` +
        `   Failed: ${failedIssueChecks.length}\n`,
    );

    if (failedIssueChecks.length > 0) {
      process.stdout.write(
        `\nOrphaned Issues (Wiki references but no file):\n`,
      );
      for (const check of failedIssueChecks) {
        process.stdout.write(
          `   [${check.genTaskId}] ${check.folder}\n` +
            `      Wiki: ${check.wikiFile}\n` +
            `      Orphaned: ${check.orphaned.join(", ")}\n`,
        );
      }
    }

    if (tasksNeedingRetry.length > 0) {
      process.stdout.write(
        `\n⚠️  Tasks needing retry: ${tasksNeedingRetry.length}\n`,
      );
      for (const id of tasksNeedingRetry) {
        process.stdout.write(`   - ${id}\n`);
      }
    }
  }

  process.stdout.write(`\nReport written to ${argv.output}\n`);

  // Exit code: 0 = all passed, 1 = issues found
  if (report.summary.allPassed) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

const isMainModule =
  process.argv[1]?.endsWith("verify-gen-artifacts.ts") ||
  process.argv[1]?.endsWith("verify-gen-artifacts.js");
if (isMainModule) main();
