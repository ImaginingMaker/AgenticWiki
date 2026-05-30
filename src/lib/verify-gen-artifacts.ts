/**
 * Verify GEN Artifacts — 验证 GEN SubAgent 产物完整性。
 *
 * 功能：
 *   1. Mermaid 泄露扫描 — 检测项目根目录和 wiki 目录中的 Mermaid 语法泄露文件
 *   2. Wiki 目录存在性验证 — 验证每个 completed genTask 的 wiki 目录存在且非空
 *   3. 输出结构化报告，标记需要重跑的 genTask
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
  tasksNeedingRetry: string[];
  summary: {
    allPassed: boolean;
    leaksDetected: number;
    dirsFailed: number;
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
  const completedTasks = genTasks.filter((t) => t.status === "completed");

  for (const task of completedTasks) {
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

  // Build report
  const failedWikiChecks = wikiChecks.filter((c) => !c.passed);
  const passedWikiChecks = wikiChecks.filter((c) => c.passed);
  const tasksNeedingRetry = failedWikiChecks.map((c) => c.genTaskId);

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
    tasksNeedingRetry,
    summary: {
      allPassed: leaks.length === 0 && failedWikiChecks.length === 0,
      leaksDetected: leaks.length,
      dirsFailed: failedWikiChecks.length,
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
