/**
 * Update or append a section in a Markdown document.
 * Sections are identified by h2 headings (## Title).
 */

/**
 * Find the line index of the next h2 heading after a given line.
 * Returns -1 if no next h2 heading is found.
 */
function findNextH2(lines: string[], startLine: number): number {
  for (let i = startLine; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      return i;
    }
  }
  return -1;
}

/**
 * Find the line index of an h2 heading with a specific title.
 * Returns -1 if not found.
 */
function findH2Section(lines: string[], title: string): number {
  const targetHeading = `## ${title}`;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === targetHeading) {
      return i;
    }
  }
  return -1;
}

/**
 * Update or append a section in a Markdown document.
 *
 * @param markdown - The original Markdown content
 * @param sectionTitle - The h2 section title (without the ## prefix)
 * @param newContent - The new content for the section (without the heading)
 * @returns The updated Markdown content
 */
export function updateWikiSection(
  markdown: string,
  sectionTitle: string,
  newContent: string,
): string {
  const lines = markdown.split("\n");
  const sectionIndex = findH2Section(lines, sectionTitle);

  if (sectionIndex === -1) {
    // Section not found, append it
    let result = markdown;

    // Ensure there's a newline before the new section
    if (result.length > 0 && !result.endsWith("\n")) {
      result += "\n";
    }

    // Add the new section
    result += `## ${sectionTitle}\n${newContent}`;

    // Ensure trailing newline if original had one
    if (markdown.endsWith("\n") && !result.endsWith("\n")) {
      result += "\n";
    }

    return result;
  }

  // Section found, find the next h2 heading
  const nextSectionIndex = findNextH2(lines, sectionIndex + 1);

  // Trim trailing newline from newContent to prevent extra blank lines
  const trimmedContent = newContent.replace(/\n+$/, "");

  // Build the new document
  const before = lines.slice(0, sectionIndex);
  const after = nextSectionIndex === -1 ? [] : lines.slice(nextSectionIndex);

  // Construct the new section
  const newSection = [`## ${sectionTitle}`, trimmedContent];

  // Join parts with proper blank lines
  const result: string[] = [...before];

  // Add the new section content
  for (const line of newSection) {
    result.push(line);
  }

  // Ensure blank line before next section
  if (after.length > 0) {
    // Check if we need a blank line
    const lastContent = result[result.length - 1];
    if (lastContent && lastContent.trim() !== "") {
      result.push("");
    }
  }

  // Add the remaining sections
  result.push(...after);

  return result.join("\n");
}
