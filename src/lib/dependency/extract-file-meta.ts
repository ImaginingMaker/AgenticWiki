/**
 * Extract file metadata — 轻量文件元信息扫描。
 *
 * 在 DEPENDENCY 阶段运行，为每个逻辑文件提取精简摘要，
 * 供 GEN 阶段 SubAgent 读取，减少 SubAgent 直接读源码的 Token 消耗。
 *
 * 不进行完整 AST 解析（已有 dependency-cruiser 做依赖分析），
 只用正则 + 有穷状态机从文件前 8KB 提取关键信息：
 *   组件名、Props 类型名、Hook 调用、Export、是否纯 re-export
 *
 * Usage:
 *   npx tsx src/lib/dependency/extract-file-meta.ts \
 *     --files   .agentic-wiki/cache/file-list.json \
 *     --source  /path/to/project/src \
 *     --output  .agentic-wiki/cache/file-meta.json
 */

import path from "node:path";
import fs from "fs-extra";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { FileListResult } from "../types/index.js";

// === Types ===

export interface FileMeta {
  path: string;
  lineCount: number;
  estimatedTokens: number;
  hasJSX: boolean;
  isReexportBarrel: boolean;
  isReactComponent: boolean;
  componentName: string | null;
  hookNames: string[];
  exportNames: string[];
  propTypeNames: string[];
  topLevelFunctionNames: string[];
}

export type FileMetaMap = Record<string, FileMeta>;

// === Constants ===

/** File extensions that are binary/style and should be skipped. */
const SKIP_EXTENSIONS = new Set([
  ".css",
  ".scss",
  ".less",
  ".sass",
  ".styl",
  ".json",
  ".md",
  ".svg",
  ".png",
  ".jpg",
  ".gif",
]);

/** File patterns that indicate test/story files. */
const TEST_PATTERNS = [
  /\.test\.(ts|tsx|js|jsx)$/,
  /\.spec\.(ts|tsx|js|jsx)$/,
  /\.stories\.(ts|tsx|js|jsx)$/,
  /\.story\.(ts|tsx|js|jsx)$/,
  /\/__tests__\//,
];

// === Detection Helpers ===

function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(filePath));
}

function isStyleFile(filePath: string): boolean {
  return SKIP_EXTENSIONS.has(path.extname(filePath));
}

/**
 * Token estimation using character count / type-specific divisor.
 * Mirrors the logic in file-priorities.ts for consistency.
 *
 * Divisors: .d.ts=5.5, .tsx/.jsx=3.8, .css/etc=5.0, default=4.5
 */
function estimateTokens(
  filePath: string,
  charCount: number,
  hasJSX: boolean,
): number {
  const ext = path.extname(filePath);
  const base = path.basename(filePath);

  if (ext === ".ts" && base.endsWith(".d.ts")) {
    return Math.max(1, Math.round(charCount / 5.5));
  }
  if ([".tsx", ".jsx"].includes(ext) && hasJSX) {
    return Math.max(1, Math.round(charCount / 3.8));
  }
  return Math.max(1, Math.round(charCount / 4.5));
}

/**
 * Check if file is a pure re-export barrel file.
 * All non-blank/non-comment lines must be re-export statements.
 */
function checkReexportBarrel(content: string): boolean {
  const lines = content.split("\n");
  for (const raw of lines) {
    const t = raw.trim();
    if (
      t === "" ||
      t.startsWith("//") ||
      t.startsWith("/*") ||
      t.startsWith("*")
    )
      continue;
    if (t.startsWith("export * from")) continue;
    if (/^export\s*(?:type|interface)?\s*\{/.test(t) && t.includes("} from"))
      continue;
    if (
      t === '"use client"' ||
      t === "'use client'" ||
      t === '"use server"' ||
      t === "'use server'"
    )
      continue;
    return false;
  }
  return true;
}

/**
 * Extract prop type names from file content.
 */
function extractPropTypes(content: string): string[] {
  const names: string[] = [];
  // interface ButtonProps
  const interfaceRe = /interface\s+(\w+Props)\b/g;
  let m;
  while ((m = interfaceRe.exec(content)) !== null) {
    names.push(m[1]);
  }
  // type ButtonProps = ...
  const typeRe = /type\s+(\w+Props)\s*=/g;
  while ((m = typeRe.exec(content)) !== null) {
    names.push(m[1]);
  }
  // React.FC<ButtonProps> / ComponentType<ButtonProps>
  const genericRe = /<\s*(\w+Props)\s*>/g;
  while ((m = genericRe.exec(content)) !== null) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

/**
 * Extract hook calls from file content (including names).
 */
function extractHooks(content: string): string[] {
  const hooks: string[] = [];
  const seen = new Set<string>();

  // Match useXxx(...) patterns
  const hookRe = /\b(use[A-Z]\w+)\s*\(/g;
  let m;
  while ((m = hookRe.exec(content)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      hooks.push(name);
    }
  }
  return hooks;
}

/**
 * Extract export names from file content.
 */
function extractExports(content: string): string[] {
  const exports: string[] = [];
  const seen = new Set<string>();

  const patterns = [
    // export const Xxx / export function Xxx
    /export\s+(?:const|function|let|var|class)\s+(\w+)/g,
    // export default function Xxx / export default class Xxx
    /export\s+default\s+(?:function|class)\s+(\w+)/g,
    // export { Xxx }  or  export { Xxx as Yyy }
    /export\s*\{\s*(\w+)/g,
    // export default Xxx  (where Xxx is a name)
    /export\s+default\s+(\w+)/g,
    // export interface Xxx / export type Xxx
    /export\s+(?:interface|type)\s+(\w+)/g,
    // export enum Xxx
    /export\s+enum\s+(\w+)/g,
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(content)) !== null) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        exports.push(m[1]);
      }
    }
  }
  return exports;
}

/**
 * Extract top-level function/component names by looking at indentation.
 * A top-level function starts at column 0 (not inside another block).
 */
function extractTopLevelFunctions(content: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  const lines = content.split("\n");
  for (const line of lines) {
    // Skip indented lines (inside other blocks)
    if (line.startsWith(" ") || line.startsWith("\t")) continue;

    const m = line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      names.push(m[1]);
    }
  }
  return names;
}

/**
 * Detect if content contains JSX.
 */
function hasJSX(content: string): boolean {
  // Look for self-closing tags <Xxx /> or opening tags <Xxx> or closing tags </Xxx>
  // Must not match generic comparisons like <number> or <string>
  return (
    /<[A-Z]\w+\s*\/?>/.test(content) ||
    /<\/[A-Z]\w+\s*>/.test(content) ||
    /<[a-z]+\s+(?:[^>]*\/)?>/.test(content)
  );
}

/**
 * Check if a component name looks like a React component (PascalCase).
 */
function isComponentName(name: string | null): boolean {
  return name !== null && /^[A-Z]/.test(name);
}

// === Core Logic ===

/**
 * Extract file metadata for all source files.
 */
export function extractFileMeta(
  fileList: FileListResult,
  sourceRoot: string,
): FileMetaMap {
  const metaMap: FileMetaMap = {};

  for (const filePath of fileList.files) {
    // Skip non-logical files
    if (isStyleFile(filePath)) continue;
    if (isTestFile(filePath)) continue;

    const fullPath = path.join(sourceRoot, filePath);
    let content: string;
    let lineCount: number;
    let charCount: number;

    try {
      const fullContent = fs.readFileSync(fullPath, "utf-8");
      lineCount = fullContent.split("\n").length;
      charCount = fullContent.length;
      // Use first 8KB for regex-based meta extraction (performance optimization).
      // Token estimation uses the full charCount, not the 8KB window.
      content = fullContent.slice(0, 8192);
    } catch {
      // File missing or unreadable — skip
      continue;
    }

    const hasJSXFlag = hasJSX(content);
    const isBarrel = checkReexportBarrel(content);
    const exports = extractExports(content);
    const topLevelFunctions = extractTopLevelFunctions(content);
    const propTypes = extractPropTypes(content);
    const hooks = extractHooks(content);

    // Determine component
    let componentName: string | null = null;
    let isComponent = false;

    if (hasJSXFlag) {
      // Try to find component name from exports
      for (const exp of exports) {
        if (isComponentName(exp)) {
          componentName = exp;
          isComponent = true;
          break;
        }
      }
      // Fallback: try the first top-level PascalCase function
      if (!componentName) {
        for (const fn of topLevelFunctions) {
          if (isComponentName(fn)) {
            componentName = fn;
            isComponent = true;
            break;
          }
        }
      }
      // If has JSX but no PascalCase name found, still mark as component
      if (!componentName) {
        isComponent = true;
      }
    } else {
      // No JSX — check if it exports something that looks like a component
      for (const exp of exports) {
        if (isComponentName(exp)) {
          componentName = exp;
          isComponent = true;
          break;
        }
      }
    }

    const estTokens = estimateTokens(filePath, charCount, hasJSXFlag);

    metaMap[filePath] = {
      path: filePath,
      lineCount,
      estimatedTokens: estTokens,
      hasJSX: hasJSXFlag,
      isReexportBarrel: isBarrel,
      isReactComponent: isComponent,
      componentName,
      hookNames: hooks,
      exportNames: exports,
      propTypeNames: propTypes,
      topLevelFunctionNames: topLevelFunctions,
    };
  }

  return metaMap;
}

// === CLI Entry Point ===

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("files", {
      type: "string",
      demandOption: true,
      description: "Path to file-list.json (or filtered-files.json)",
    })
    .option("source", {
      type: "string",
      demandOption: true,
      description: "Project source root path (e.g. /path/to/project/src)",
    })
    .option("output", {
      type: "string",
      demandOption: true,
      description: "Output path for file-meta.json",
    })
    .parseSync();

  const fileList: FileListResult = await fs.readJson(argv.files);
  const sourceRoot = path.resolve(argv.source);

  const meta = extractFileMeta(fileList, sourceRoot);

  await fs.outputJson(argv.output, meta, { spaces: 2 });

  // Count stats
  const total = Object.keys(meta).length;
  const components = Object.values(meta).filter(
    (m) => m.isReactComponent,
  ).length;
  const barrels = Object.values(meta).filter((m) => m.isReexportBarrel).length;
  const withHooks = Object.values(meta).filter(
    (m) => m.hookNames.length > 0,
  ).length;

  process.stdout.write(
    `File metadata extracted: ${total} files (${components} components, ${barrels} barrels, ${withHooks} with hooks)\n` +
      `  Source: ${sourceRoot}\n` +
      `  Written to ${argv.output}\n`,
  );
}

const isMainModule =
  process.argv[1]?.endsWith("extract-file-meta.ts") ||
  process.argv[1]?.endsWith("extract-file-meta.js");
if (isMainModule) main();
