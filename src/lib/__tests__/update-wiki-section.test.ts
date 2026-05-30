import { describe, it, expect } from "vitest";
import { updateWikiSection } from "../update-wiki-section";

describe("updateWikiSection", () => {
  it("should replace content of an existing section", () => {
    const markdown = `# Project Wiki

## Overview
Old overview content.

## Components
Component details.
`;

    const result = updateWikiSection(
      markdown,
      "Overview",
      "New overview content.",
    );

    expect(result).toContain("## Overview\nNew overview content.");
    expect(result).toContain("## Components\nComponent details.");
    expect(result).not.toContain("Old overview content.");
  });

  it("should append a new section if not found", () => {
    const markdown = `# Project Wiki

## Overview
Overview content.
`;

    const result = updateWikiSection(
      markdown,
      "Components",
      "Component details.",
    );

    expect(result).toContain("## Overview\nOverview content.");
    expect(result).toContain("## Components\nComponent details.");
  });

  it("should preserve other sections unchanged", () => {
    const markdown = `## Section A
Content A

## Section B
Content B

## Section C
Content C
`;

    const result = updateWikiSection(markdown, "Section B", "Updated B");

    expect(result).toContain("## Section A\nContent A");
    expect(result).toContain("## Section B\nUpdated B");
    expect(result).toContain("## Section C\nContent C");
  });

  it("should only match h2 headings, not h1 or h3", () => {
    const markdown = `# Project Wiki

## Overview
Old content

### Sub-section
Sub content

`;

    const result = updateWikiSection(markdown, "Overview", "New content");

    expect(result).toContain("## Overview\nNew content");
    // h3 is inside the replaced h2 section, so it should be removed too
    expect(result).not.toContain("### Sub-section");
  });

  it("should not match h3 as a section boundary", () => {
    const markdown = `## Target
Old target content

### Sub-heading inside target
Sub content

## Next
Next content
`;

    const result = updateWikiSection(markdown, "Target", "Replaced target");

    expect(result).toContain("## Target\nReplaced target");
    expect(result).toContain("## Next\nNext content");
    // The ### heading should have been replaced along with the section
    expect(result).not.toContain("### Sub-heading inside target");
  });

  it("should handle section at the end of document", () => {
    const markdown = `## First
First content

## Last
Last content
`;

    const result = updateWikiSection(markdown, "Last", "Updated last");

    expect(result).toContain("## Last\nUpdated last");
    expect(result).toContain("## First\nFirst content");
  });

  it("should handle empty new content", () => {
    const markdown = `## Target
Old content

## Next
Next content
`;

    const result = updateWikiSection(markdown, "Target", "");

    expect(result).toContain("## Target\n\n## Next");
    expect(result).not.toContain("Old content");
  });

  it("should handle new content with trailing newline", () => {
    const markdown = `## Target
Old content

## Next
Next content
`;

    const result = updateWikiSection(markdown, "Target", "New content\n");

    expect(result).toContain("## Target\nNew content\n\n## Next");
  });

  it("should handle section with exact heading match only", () => {
    const markdown = `## Overview
Overview content

## Overview Details
Detail content
`;

    const result = updateWikiSection(markdown, "Overview", "Updated overview");

    expect(result).toContain("## Overview\nUpdated overview");
    expect(result).toContain("## Overview Details\nDetail content");
  });

  it("should handle appending section when markdown ends with newline", () => {
    const markdown = `## Existing
Content
`;

    const result = updateWikiSection(markdown, "New Section", "New content");

    expect(result).toContain("## Existing\nContent");
    expect(result).toContain("## New Section\nNew content");
  });

  it("should handle appending section when markdown does not end with newline", () => {
    const markdown = `## Existing
Content`;

    const result = updateWikiSection(markdown, "New Section", "New content");

    expect(result).toContain("## New Section\nNew content");
  });

  it("should handle multi-line new content", () => {
    const markdown = `## Target
Old

## Next
Next
`;

    const newContent = `Line 1
Line 2
Line 3`;

    const result = updateWikiSection(markdown, "Target", newContent);

    expect(result).toContain("Line 1\nLine 2\nLine 3");
    expect(result).toContain("## Next\nNext");
  });

  it("should handle document with only one section", () => {
    const markdown = `## Only Section
Only content
`;

    const result = updateWikiSection(markdown, "Only Section", "Updated only");

    expect(result).toContain("## Only Section\nUpdated only");
  });

  it("should handle section with blank lines in content", () => {
    const markdown = `## Target
Line 1

Line 3

## Next
Next content
`;

    const result = updateWikiSection(markdown, "Target", "Replaced");

    expect(result).toContain("## Target\nReplaced\n\n## Next");
  });
});
