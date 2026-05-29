/**
 * Incrementally update a specific ##-level section in a Markdown document.
 * Only matches h2 headings (## ), not h1 (# ) or h3 (### ) or deeper.
 */
export function updateWikiSection(
  markdown: string,
  sectionTitle: string,
  newContent: string,
): string {
  const lines = markdown.split("\n");
  const targetHeading = `## ${sectionTitle}`;

  // Find the target section start
  let sectionStartIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === targetHeading) {
      sectionStartIndex = i;
      break;
    }
  }

  // If section not found, append it at the end
  if (sectionStartIndex === -1) {
    const separator = markdown.endsWith("\n") ? "" : "\n";
    return `${markdown}${separator}${targetHeading}\n${newContent}\n`;
  }

  // Find the next ## section (h2 level only)
  let sectionEndIndex = lines.length;
  for (let i = sectionStartIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^## /.test(trimmed) && trimmed !== targetHeading) {
      // Preserve the blank line separator before the next heading
      sectionEndIndex = i > 0 && lines[i - 1].trim() === "" ? i - 1 : i;
      break;
    }
  }

  // Build the result: before + heading + new content + after
  const before = lines.slice(0, sectionStartIndex + 1);
  const after = lines.slice(sectionEndIndex);

  let result = [...before, newContent, ...after].join("\n");

  // Normalize: ensure exactly one blank line before the next h2 heading
  // (handles both sections with internal blank lines and simple replacements)
  result = result.replace(/\n{2,}(## )/g, "\n\n$1");

  return result;
}
