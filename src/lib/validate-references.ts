import { globby } from "globby";
import matter from "gray-matter";
import fs from "fs-extra";
import path from "path";
import type { ValidationIssue } from "../types/index.js";

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
    const content = await fs.readFile(file, "utf-8");

    // Parse frontmatter
    const parsed = matter(content);
    const frontmatter = parsed.data;

    // Check required frontmatter fields
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

    // Extract and validate wikilinks
    const body = parsed.content;
    let match: RegExpExecArray | null;
    WIKILINK_REGEX.lastIndex = 0;
    const seenLinks = new Set<string>();

    while ((match = WIKILINK_REGEX.exec(body)) !== null) {
      const linkTarget = match[1].trim();

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
