import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClusterTaskResult } from "../dependency/cluster-tasks.js";

// Mock dependencies before importing the module
vi.mock("globby", () => ({
  globby: vi.fn(),
}));

vi.mock("gray-matter", () => ({
  default: vi.fn(),
}));

vi.mock("fs-extra", () => ({
  default: {
    readFile: vi.fn(),
    outputFile: vi.fn(),
  },
}));

import { globby } from "globby";
import matter from "gray-matter";
import fs from "fs-extra";
import { assembleBook, chapterLabel } from "../assemble/assemble-book.js";
import type { FolderStrategyResult } from "../../types/index.js";

const mockGlobby = vi.mocked(globby);
const mockMatter = vi.mocked(matter) as unknown as typeof matter;
const mockReadFile = vi.mocked(fs.readFile) as unknown as typeof fs.readFile;
const mockOutputFile = vi.mocked(
  fs.outputFile,
) as unknown as typeof fs.outputFile;

function makeFolderStrategy(
  overrides?: Partial<FolderStrategyResult>,
): FolderStrategyResult {
  return {
    generatedAt: "2024-06-01T00:00:00.000Z",
    folders: [
      {
        path: "My Components",
        fileCount: 1,
        logicFileCount: 1,
        styleFileCount: 0,
        shouldSplit: false,
        reason: "test",
        priority: "high",
      },
    ],
    totalFolders: 1,
    foldersToAnalyze: 1,
    ...overrides,
  };
}

function makeMatterResult(data: Record<string, unknown>, content: string) {
  return { data, content } as unknown as matter.GrayMatterFile<string>;
}

describe("assembleBook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Test 1: Happy path ───────────────────────────────────────────────

  it("should assemble a single chapter with one page and create book + glossary", async () => {
    mockGlobby.mockResolvedValue(["ch-01/Button.md"]);
    mockReadFile.mockResolvedValue(`---
title: Button
tags: ["react"]
sourceFiles: ["src/Button.tsx"]
---
# Button

A reusable button component.

## \`Button\`

The main button component.

## \`onClick\`

Click handler function.
`);
    mockMatter.mockReturnValue(
      makeMatterResult(
        { title: "Button", tags: ["react"], sourceFiles: ["src/Button.tsx"] },
        "\n# Button\n\nA reusable button component.\n\n## `Button`\n\nThe main button component.\n\n## `onClick`\n\nClick handler function.\n",
      ),
    );

    const { bookPath, glossaryPath, stats } = await assembleBook(
      "/test/wiki",
      null,
    );

    expect(stats).toEqual({
      totalChapters: 1,
      totalPages: 1,
      totalSymbols: 2, // Button + onClick
      totalSourceFiles: 1, // src/Button.tsx
    });
    expect(bookPath).toBe("/test/wiki/book.md");
    expect(glossaryPath).toBe("/test/wiki/glossary.md");

    // Two outputFile calls: book.md then glossary.md
    expect(mockOutputFile).toHaveBeenCalledTimes(2);
    expect(mockOutputFile.mock.calls[0][0]).toBe("/test/wiki/book.md");
    expect(mockOutputFile.mock.calls[1][0]).toBe("/test/wiki/glossary.md");
  });

  // ─── Test 2: Multiple chapters ────────────────────────────────────────

  it("should handle multiple chapters with multiple pages and sort correctly", async () => {
    mockGlobby.mockResolvedValue([
      "ch-02/useAuth.md",
      "ch-01/Button.md",
      "ch-01/Input.md",
    ]);
    mockReadFile.mockResolvedValueOnce(`---
title: Input
tags: []
sourceFiles: ["src/Input.tsx"]
---
# Input
`).mockResolvedValueOnce(`---
title: Button
tags: []
sourceFiles: ["src/Button.tsx"]
---
# Button
`).mockResolvedValueOnce(`---
title: useAuth
tags: []
sourceFiles: ["src/hooks/useAuth.ts"]
---
# useAuth
`);
    mockMatter
      .mockReturnValueOnce(
        makeMatterResult(
          { title: "Input", tags: [], sourceFiles: ["src/Input.tsx"] },
          "\n# Input\n",
        ),
      )
      .mockReturnValueOnce(
        makeMatterResult(
          { title: "Button", tags: [], sourceFiles: ["src/Button.tsx"] },
          "\n# Button\n",
        ),
      )
      .mockReturnValueOnce(
        makeMatterResult(
          { title: "useAuth", tags: [], sourceFiles: ["src/hooks/useAuth.ts"] },
          "\n# useAuth\n",
        ),
      );

    const { stats } = await assembleBook("/test/wiki", null);

    expect(stats).toEqual({
      totalChapters: 2,
      totalPages: 3,
      totalSymbols: 0,
      totalSourceFiles: 3,
    });

    // Verify sorting order in generated book
    // globby returns as-is, but the book sorts chapters and pages alphabetically
    const bookContent = mockOutputFile.mock.calls[0][1];
    // ch-01 should appear before ch-02; Find them after the TOC heading
    const tocSection = bookContent.indexOf("## 目录");
    const chapterSection = bookContent.indexOf("## 章节详情");
    const firstCh01InToc = bookContent.indexOf("01", tocSection);
    const firstCh02InToc = bookContent.indexOf("02", tocSection);
    const firstCh01InDetail = bookContent.indexOf("01", chapterSection);
    const firstCh02InDetail = bookContent.indexOf("02", chapterSection);

    expect(firstCh01InToc).toBeGreaterThan(0);
    expect(firstCh02InToc).toBeGreaterThan(firstCh01InToc);
    expect(firstCh01InDetail).toBeGreaterThan(0);
    expect(firstCh02InDetail).toBeGreaterThan(firstCh01InDetail);
  });

  // ─── Test 3: Empty wiki ──────────────────────────────────────────────

  it("should return empty stats when there are no markdown files", async () => {
    mockGlobby.mockResolvedValue([]);

    const { stats } = await assembleBook("/test/wiki", null);

    expect(stats).toEqual({
      totalChapters: 0,
      totalPages: 0,
      totalSymbols: 0,
      totalSourceFiles: 0,
    });

    // Should still create both files with empty content
    expect(mockOutputFile).toHaveBeenCalledTimes(2);
    const bookContent = mockOutputFile.mock.calls[0][1];
    expect(bookContent).toContain("0 个章节");
  });

  // ─── Test 4: No frontmatter title (fallback to H1) ────────────────────

  it("should fall back to H1 heading when frontmatter has no title", async () => {
    mockGlobby.mockResolvedValue(["ch-01/Button.md"]);
    mockReadFile.mockResolvedValue(`---
tags: ["react"]
sourceFiles: ["src/Button.tsx"]
---
# My Custom Button

Content here.
`);
    mockMatter.mockReturnValue(
      makeMatterResult(
        { tags: ["react"], sourceFiles: ["src/Button.tsx"] },
        "\n# My Custom Button\n\nContent here.\n",
      ),
    );

    const { stats } = await assembleBook("/test/wiki", null);

    expect(stats).toEqual({
      totalChapters: 1,
      totalPages: 1,
      totalSymbols: 0,
      totalSourceFiles: 1,
    });

    // Book should use the H1 as the page title
    const bookContent = mockOutputFile.mock.calls[0][1];
    expect(bookContent).toContain("My Custom Button");

    // Title should be linked with the section filename
    expect(bookContent).toContain("Button.md");
  });

  // ─── Test 5: With strategy ──────────────────────────────────────────

  it("should use strategy to resolve chapter labels", async () => {
    const strategy = makeFolderStrategy();

    // Chapter "ch-my_components" → folderId "my_components"
    // Strategy folder "My Components" → cleaned "my_components" → match!
    mockGlobby.mockResolvedValue(["ch-my_components/Button.md"]);
    mockReadFile.mockResolvedValue(`---
title: Button
tags: []
sourceFiles: ["src/Button.tsx"]
---
# Button
`);
    mockMatter.mockReturnValue(
      makeMatterResult(
        { title: "Button", tags: [], sourceFiles: ["src/Button.tsx"] },
        "\n# Button\n",
      ),
    );

    await assembleBook("/test/wiki", strategy);

    const bookContent = mockOutputFile.mock.calls[0][1];
    // Strategy label "My Components" should appear (not the fallback "my/components")
    expect(bookContent).toContain("My Components");
  });

  // ─── Test 6: Symbol extraction ──────────────────────────────────────

  it("should extract symbols with correct types from headings", async () => {
    mockGlobby.mockResolvedValue(["ch-01/Components.md"]);
    mockReadFile.mockResolvedValue(`---
title: Components
tags: []
sourceFiles: []
---
# Components

## \`Button\`

A component.

## \`useAuth\`

A hook.

## \`formatDate\`

A function.

## \`_internal\`

A private helper (length >= 2, so included).

## X

Single char, excluded.
`);
    mockMatter.mockReturnValue(
      makeMatterResult(
        { title: "Components", tags: [], sourceFiles: [] },
        "\n# Components\n\n## `Button`\n\nA component.\n\n## `useAuth`\n\nA hook.\n\n## `formatDate`\n\nA function.\n\n## `_internal`\n\nA private helper (length >= 2, so included).\n\n## X\n\nSingle char, excluded.\n",
      ),
    );

    const { stats } = await assembleBook("/test/wiki", null);

    // Button (component), useAuth (hook), formatDate (function), _internal (symbol)
    expect(stats.totalSymbols).toBe(4);

    // Check glossary content for correct type categories
    const glossaryContent = mockOutputFile.mock.calls[1][1];
    expect(glossaryContent).toContain("🧩 组件");
    expect(glossaryContent).toContain("🪝 Hooks");
    expect(glossaryContent).toContain("🔧 函数");
    expect(glossaryContent).toContain("📌 符号");
    expect(glossaryContent).toContain("`Button`");
    expect(glossaryContent).toContain("`useAuth`");
    expect(glossaryContent).toContain("`formatDate`");
    expect(glossaryContent).toContain("`_internal`");
  });

  // ─── Test 7: Source files tracking ──────────────────────────────────

  it("should aggregate unique sourceFiles across multiple pages", async () => {
    mockGlobby.mockResolvedValue(["ch-01/PageA.md", "ch-01/PageB.md"]);
    mockReadFile.mockResolvedValueOnce(`---
title: PageA
tags: []
sourceFiles: ["src/utils.ts", "src/shared.ts"]
---
# PageA
`).mockResolvedValueOnce(`---
title: PageB
tags: []
sourceFiles: ["src/utils.ts", "src/other.ts"]
---
# PageB
`);
    mockMatter
      .mockReturnValueOnce(
        makeMatterResult(
          {
            title: "PageA",
            tags: [],
            sourceFiles: ["src/utils.ts", "src/shared.ts"],
          },
          "\n# PageA\n",
        ),
      )
      .mockReturnValueOnce(
        makeMatterResult(
          {
            title: "PageB",
            tags: [],
            sourceFiles: ["src/utils.ts", "src/other.ts"],
          },
          "\n# PageB\n",
        ),
      );

    const { stats } = await assembleBook("/test/wiki", null);

    // 3 unique: src/utils.ts, src/shared.ts, src/other.ts
    expect(stats.totalSourceFiles).toBe(3);
    expect(stats.totalPages).toBe(2);
    expect(stats.totalChapters).toBe(1);
  });

  // ─── Test 8: Null strategy explicitly ───────────────────────────────

  it("should fall back to path-based labels when strategy is null", async () => {
    mockGlobby.mockResolvedValue(["ch-01/Button.md"]);
    mockReadFile.mockResolvedValue(`---
title: Button
tags: []
sourceFiles: []
---
# Button
`);
    mockMatter.mockReturnValue(
      makeMatterResult(
        { title: "Button", tags: [], sourceFiles: [] },
        "\n# Button\n",
      ),
    );

    await assembleBook("/test/wiki", null);

    const bookContent = mockOutputFile.mock.calls[0][1];
    // Chapter "ch-01" → fallback label removes "ch-" prefix → "01"
    expect(bookContent).toContain("01");
    // Strategy label should NOT appear
    expect(bookContent).not.toContain("My Components");
  });

  // ─── Test 9: Tags parsing (array vs comma-separated string) ─────────

  it("should handle both array and comma-separated string tags", async () => {
    mockGlobby.mockResolvedValue(["ch-01/Page.md"]);
    mockReadFile.mockResolvedValue(`---
title: Page
tags: "react, typescript, testing"
sourceFiles: []
---
# Page
`);
    mockMatter.mockReturnValue(
      makeMatterResult(
        { title: "Page", tags: "react, typescript, testing", sourceFiles: [] },
        "\n# Page\n",
      ),
    );

    await assembleBook("/test/wiki", null);

    // The function should not crash with string tags
    expect(mockOutputFile).toHaveBeenCalledTimes(2);

    // Now test with array tags - should also work
    vi.clearAllMocks();
    mockGlobby.mockResolvedValue(["ch-01/Page.md"]);
    mockReadFile.mockResolvedValue(`---
title: Page
tags: ["react", "typescript"]
sourceFiles: []
---
# Page
`);
    mockMatter.mockReturnValue(
      makeMatterResult(
        { title: "Page", tags: ["react", "typescript"], sourceFiles: [] },
        "\n# Page\n",
      ),
    );

    await assembleBook("/test/wiki", null);
    expect(mockOutputFile).toHaveBeenCalledTimes(2);
  });

  // ─── Test 10: Glossary format structure ─────────────────────────────

  it("should generate glossary with correct structure and type groupings", async () => {
    mockGlobby.mockResolvedValue(["ch-01/Index.md"]);
    mockReadFile.mockResolvedValue(`---
title: Index
tags: []
sourceFiles: []
---
# Index

## \`Button\`

## \`useToggle\`

## \`parseValue\`
`);
    mockMatter.mockReturnValue(
      makeMatterResult(
        { title: "Index", tags: [], sourceFiles: [] },
        "\n# Index\n\n## `Button`\n\n## `useToggle`\n\n## `parseValue`\n",
      ),
    );

    await assembleBook("/test/wiki", null);

    const glossaryContent = mockOutputFile.mock.calls[1][1] as string;

    // Frontmatter
    expect(glossaryContent).toMatch(/^---\n/);

    // H1
    expect(glossaryContent).toContain("# 📚 术语表");

    // Summary table
    expect(glossaryContent).toContain("| 类型 | 数量 |");

    // Type sections in order: component, hook, function, symbol
    const componentIdx = glossaryContent.indexOf("## 🧩 组件");
    const hookIdx = glossaryContent.indexOf("## 🪝 Hooks");
    const functionIdx = glossaryContent.indexOf("## 🔧 函数");
    expect(componentIdx).toBeGreaterThan(0);
    expect(hookIdx).toBeGreaterThan(componentIdx);
    expect(functionIdx).toBeGreaterThan(hookIdx);

    // Each type section has a table with Name and 章节 columns
    const componentTableSection = glossaryContent.slice(componentIdx, hookIdx);
    expect(componentTableSection).toContain("| 名称 | 章节 |");

    // Symbol entries have backtick names
    expect(glossaryContent).toContain("`Button`");
    expect(glossaryContent).toContain("`useToggle`");
    expect(glossaryContent).toContain("`parseValue`");

    // Wiki links use double-bracket syntax
    expect(glossaryContent).toContain("[[volume-1-code/");
  });

  // ─── Test 11: Deduplicate symbols with same name ────────────────────

  it("should deduplicate symbols with the same name within a file", async () => {
    mockGlobby.mockResolvedValue(["ch-01/Components.md"]);
    mockReadFile.mockResolvedValue(`---
title: Components
tags: []
sourceFiles: []
---
# Components

## \`Button\`

Description.

### \`Button\`

More details (H3 with same name — should be deduped).
`);
    mockMatter.mockReturnValue(
      makeMatterResult(
        { title: "Components", tags: [], sourceFiles: [] },
        "\n# Components\n\n## `Button`\n\nDescription.\n\n### `Button`\n\nMore details (H3 with same name — should be deduped).\n",
      ),
    );

    const { stats } = await assembleBook("/test/wiki", null);

    // Button should only be counted once
    expect(stats.totalSymbols).toBe(1);
  });

  // ─── Test 12: Empty string frontmatter fields handled gracefully ────

  it("should handle empty string tags and sourceFiles gracefully", async () => {
    mockGlobby.mockResolvedValue(["ch-01/Page.md"]);
    mockReadFile.mockResolvedValue(`---
title: Page
tags: ""
sourceFiles: ""
---
# Page
`);
    mockMatter.mockReturnValue(
      makeMatterResult(
        { title: "Page", tags: "", sourceFiles: "" },
        "\n# Page\n",
      ),
    );

    const { stats } = await assembleBook("/test/wiki", null);

    // Empty string tags → split on "," → [""]
    // Empty string sourceFiles → typeof === "string", so wrapped in [""] → Set gets "" → size 1
    expect(stats.totalSourceFiles).toBe(1);
    expect(stats.totalPages).toBe(1);
    expect(mockOutputFile).toHaveBeenCalledTimes(2);
  });

  // ─── Test 13: Cluster-aware chapter label ────

  it("uses cluster label when clusters are provided", () => {
    const clusters = {
      clusters: [{ id: "my-component", label: "My Component Group" }],
    };
    const result = chapterLabel(
      "ch-my-component",
      null,
      clusters as ClusterTaskResult,
    );
    expect(result).toBe("My Component Group");
  });
});
