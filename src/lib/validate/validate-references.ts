import { globby } from "globby";
import matter from "gray-matter";
import fs from "fs-extra";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import type { ValidationIssue, ValidationReport } from "../types/index.js";

const REQUIRED_FRONTMATTER_FIELDS: Record<string, "error" | "warning"> = {
  tags: "warning",
  lastUpdated: "warning",
  sourceFiles: "error",
};

const WIKILINK_REGEX = /\[\[([^\]]+)\]\]/g;

function generateId(file: string, type: string, location: string): string {
  return `${type}-${file}-${location}`.replace(/[^a-zA-Z0-9-]/g, "-");
}

function extractPageName(filePath: string): string {
  return path.basename(filePath, ".md");
}

export async function validateReferences(
  wikiPath: string,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // Scan all markdown files
  const mdFiles = await globby("**/*.md", {
    cwd: wikiPath,
    absolute: true,
  });

  // Collect all page names for link validation
  const pageNames = new Set<string>();
  for (const file of mdFiles) {
    pageNames.add(extractPageName(file));
  }

  // Validate each file
  for (const file of mdFiles) {
    const relativePath = path.relative(wikiPath, file);

    // Skip frontmatter validation for:
    // - Issue files (volume-2-issues/) — use a different frontmatter schema
    // - Pipeline-generated files (PROGRESS.md, book.md, glossary.md, issues.md)
    const isIssueFile = relativePath.startsWith("volume-2-issues/");
    const isPipelineFile = [
      "PROGRESS.md",
      "book.md",
      "glossary.md",
      "issues.md",
    ].includes(path.basename(file));
    const skipFrontmatter = isIssueFile || isPipelineFile;

    const content = await fs.readFile(file, "utf-8");

    // Parse frontmatter
    const parsed = matter(content);
    const frontmatter = parsed.data;

    // Check required frontmatter fields (skip for issue & pipeline files)
    if (!skipFrontmatter) {
      for (const [field, severity] of Object.entries(
        REQUIRED_FRONTMATTER_FIELDS,
      )) {
        if (
          frontmatter[field] === undefined ||
          frontmatter[field] === null ||
          frontmatter[field] === ""
        ) {
          issues.push({
            id: generateId(relativePath, `missing_${field}`, "frontmatter"),
            type: `missing_frontmatter`,
            severity,
            file: relativePath,
            location: "frontmatter",
            message: `Missing required frontmatter field: ${field}`,
            suggestion: `Add '${field}' to the frontmatter of ${relativePath}`,
          });
        }
      }
    }

    // Extract and validate wikilinks
    const body = parsed.content;
    let match: RegExpExecArray | null;
    WIKILINK_REGEX.lastIndex = 0;
    const seenLinks = new Set<string>();

    while ((match = WIKILINK_REGEX.exec(body)) !== null) {
      const rawLink = match[1].trim();
      // Support [[path|display name]] → extract "path"
      const pipeIdx = rawLink.indexOf("|");
      const linkTarget = pipeIdx >= 0 ? rawLink.slice(0, pipeIdx).trim() : rawLink;

      // Skip duplicate links in the same file
      if (seenLinks.has(linkTarget)) continue;
      seenLinks.add(linkTarget);

      // Check if the link target exists
      if (!pageNames.has(linkTarget)) {
        issues.push({
          id: generateId(relativePath, "broken_link", linkTarget),
          type: "broken_link",
          severity: "warning",
          file: relativePath,
          location: `link:[[${linkTarget}]]`,
          message: `Broken wikilink: [[${linkTarget}]] — target page does not exist`,
          suggestion: `Create the page '${linkTarget}.md' or fix the link in ${relativePath}`,
        });
      }
    }
  }

  return issues;
}

// === CLI Entry Point ===
async function main() {
  const argv = yargs(hideBin(process.argv))
    .option("wiki", {
      type: "string",
      demandOption: true,
      description: "Path to wiki root directory",
    })
    .option("output", {
      type: "string",
      description: "Output validation report to JSON file",
    })
    .parseSync();

  const issues = await validateReferences(argv.wiki);

  const report: ValidationReport = {
    validatedAt: new Date().toISOString(),
    totalPages: 0,
    issues,
    summary: {
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      passed: 0,
    },
  };

  // Count total pages
  const mdFiles = await globby("**/*.md", { cwd: argv.wiki });
  report.totalPages = mdFiles.length;

  // Compute passed count: pages with zero issues
  const pagesWithIssues = new Set(issues.map((i) => i.file));
  report.summary.passed = report.totalPages - pagesWithIssues.size;

  if (argv.output) {
    await fs.outputJson(argv.output, report, { spaces: 2 });
    process.stdout.write(
      `Validation report written to ${argv.output}\n` +
        `  Pages: ${report.totalPages}, Errors: ${report.summary.errors}, Warnings: ${report.summary.warnings}\n`,
    );
  } else {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }

  // Exit with non-zero code if there are errors
  if (report.summary.errors > 0) {
    process.exit(1);
  }
}

const isMainModule =
  process.argv[1]?.endsWith("validate-references.ts") ||
  process.argv[1]?.endsWith("validate-references.js");
if (isMainModule) main();
