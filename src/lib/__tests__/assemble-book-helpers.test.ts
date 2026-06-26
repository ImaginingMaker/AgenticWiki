import { describe, it, expect } from "vitest";
import {
  extractTitle,
  extractSymbols,
  chapterLabel,
  generateBook,
  generateGlossary,
} from "../assemble/assemble-book";
import type { FolderStrategyResult } from "../types/index";

// ─── extractTitle (pure) ────────────────────────────────────────────

describe("extractTitle", () => {
  it("extracts title from frontmatter data", () => {
    const result = extractTitle("# Ignored", {
      data: { title: "My Page" },
    } as unknown as {
      data: Record<string, unknown>;
      content: string;
      excerpt?: string;
    });
    expect(result).toBe("My Page");
  });

  it("falls back to H1 heading when no frontmatter title", () => {
    const result = extractTitle("# My Heading\n\nContent", {
      data: {},
    } as unknown as {
      data: Record<string, unknown>;
      content: string;
      excerpt?: string;
    });
    expect(result).toBe("My Heading");
  });

  it("returns empty string when no title or H1 exists", () => {
    const result = extractTitle("Just some text", { data: {} } as unknown as {
      data: Record<string, unknown>;
      content: string;
      excerpt?: string;
    });
    expect(result).toBe("");
  });

  it("trims the H1 heading content", () => {
    const result = extractTitle("#   Spaced Title   \n\nContent", {
      data: {},
    } as unknown as {
      data: Record<string, unknown>;
      content: string;
      excerpt?: string;
    });
    expect(result).toBe("Spaced Title");
  });
});

// ─── extractSymbols (pure) ─────────────────────────────────────────

describe("extractSymbols", () => {
  it("extracts function symbols from h2/h3 headings", () => {
    const result = extractSymbols("## formatDate\n\nContent\n\n### parseInput");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "formatDate", type: "function" });
    expect(result[1]).toEqual({ name: "parseInput", type: "function" });
  });

  it("detects component type for PascalCase", () => {
    const result = extractSymbols("## Button\n\nContent\n\n## InputField");
    expect(result[0].type).toBe("component");
    expect(result[1].type).toBe("component");
  });

  it("detects hook type for useXxx", () => {
    const result = extractSymbols("## useAuth\n\n## useState");
    expect(result[0].type).toBe("hook");
    expect(result[1].type).toBe("hook");
  });

  it("deduplicates duplicate symbol names", () => {
    const result = extractSymbols("## Button\n\nMore content\n\n## Button");
    expect(result).toHaveLength(1);
  });

  it("filters out symbols with name length < 2", () => {
    const result = extractSymbols("## a\n\n## bb");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("bb");
  });

  it("extracts symbols with backtick-wrapped names", () => {
    const result = extractSymbols("## `useCustomHook`");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("useCustomHook");
  });

  it("returns empty array for content without headings", () => {
    const result = extractSymbols("Just some text\nwith no headings");
    expect(result).toEqual([]);
  });
});

// ─── chapterLabel (pure) ───────────────────────────────────────────

describe("chapterLabel", () => {
  const strategy: FolderStrategyResult = {
    generatedAt: "",
    folders: [
      {
        path: "src/components/Button",
        fileCount: 5,
        logicFileCount: 4,
        styleFileCount: 1,
        shouldSplit: false,
        reason: "",
        priority: "high",
        subTasks: [
          {
            id: "bt",
            label: "Button",
            role: "primary",
            files: [],
            estimatedTokens: 1000,
            priority: "high",
          },
        ],
      },
      {
        path: "src/hooks",
        fileCount: 3,
        logicFileCount: 3,
        styleFileCount: 0,
        shouldSplit: false,
        reason: "",
        priority: "medium",
        subTasks: [
          {
            id: "hk",
            label: "Hooks",
            role: "primary",
            files: [],
            estimatedTokens: 1000,
            priority: "medium",
          },
        ],
      },
    ],
    totalFolders: 2,
    foldersToAnalyze: 2,
  };

  it("resolves chapter label from strategy by matching ID", () => {
    const result = chapterLabel("ch-src_components_Button", strategy);
    expect(result).toBe("src/components/Button");
  });

  it("resolves second folder correctly", () => {
    const result = chapterLabel("ch-src_hooks", strategy);
    expect(result).toBe("src/hooks");
  });

  it("falls back to path when no strategy match", () => {
    const result = chapterLabel("ch-src_unknown", strategy);
    expect(result).toBe("src/unknown");
  });

  it("falls back to path when strategy is null", () => {
    const result = chapterLabel("ch-src_components", null);
    expect(result).toBe("src/components");
  });

  it("handles ch- prefix correctly", () => {
    const result = chapterLabel("ch-src_utils", null);
    expect(result).toBe("src/utils");
  });
});

// ─── generateBook (pure) ───────────────────────────────────────────

describe("generateBook", () => {
  const makePage = (chapter: string, section: string, title?: string) => ({
    relPath: `${chapter}/${section}.md`,
    chapter,
    section: `${section}.md`,
    title: title || section,
    tags: ["test"],
    sourceFiles: [`src/${section}.ts`],
    size: 100,
  });

  it("generates book with frontmatter", () => {
    const pages = [makePage("ch-01-core", "Button")];
    const stats = {
      totalChapters: 1,
      totalPages: 1,
      totalSymbols: 1,
      totalSourceFiles: 1,
    };
    const result = generateBook(pages, null, null, stats);
    expect(result).toContain("generated_at:");
    expect(result).toContain("chapters: 1");
    expect(result).toContain("pages: 1");
  });

  it("generates TOC with chapter sections", () => {
    const pages = [
      makePage("ch-01-core", "Button"),
      makePage("ch-02-utils", "formatDate"),
    ];
    const stats = {
      totalChapters: 2,
      totalPages: 2,
      totalSymbols: 2,
      totalSourceFiles: 2,
    };
    const result = generateBook(pages, null, null, stats);
    expect(result).toContain("## 目录");
    expect(result).toContain("Button");
    expect(result).toContain("formatDate");
    // Chapters should be sorted
    const ch01Idx = result.indexOf("ch-01-core");
    const ch02Idx = result.indexOf("ch-02-utils");
    expect(ch01Idx).toBeLessThan(ch02Idx);
  });

  it("includes chapter details section", () => {
    const pages = [makePage("ch-01-core", "Button", "My Button")];
    const stats = {
      totalChapters: 1,
      totalPages: 1,
      totalSymbols: 1,
      totalSourceFiles: 1,
    };
    const result = generateBook(pages, null, null, stats);
    expect(result).toContain("## 章节详情");
    expect(result).toContain("My Button");
  });

  it("handles empty pages array", () => {
    const stats = {
      totalChapters: 0,
      totalPages: 0,
      totalSymbols: 0,
      totalSourceFiles: 0,
    };
    const result = generateBook([], null, null, stats);
    expect(result).toContain("## 目录");
    expect(result).toContain("## 章节详情");
  });

  it("uses strategy for chapter labels", () => {
    const strategy: FolderStrategyResult = {
      generatedAt: "",
      folders: [
        {
          path: "src/core",
          fileCount: 1,
          logicFileCount: 1,
          styleFileCount: 0,
          shouldSplit: false,
          reason: "",
          priority: "high",
          subTasks: [
            {
              id: "t1",
              label: "Core",
              role: "primary",
              files: [],
              estimatedTokens: 1000,
              priority: "high",
            },
          ],
        },
      ],
      totalFolders: 1,
      foldersToAnalyze: 1,
    };
    const pages = [makePage("ch-src_core", "Button")];
    const stats = {
      totalChapters: 1,
      totalPages: 1,
      totalSymbols: 1,
      totalSourceFiles: 1,
    };
    const result = generateBook(pages, strategy, null, stats);
    expect(result).toContain("### src/core");
  });
});

// ─── generateGlossary (pure) ───────────────────────────────────────

describe("generateGlossary", () => {
  it("generates glossary with frontmatter", () => {
    const symbols = [
      {
        name: "Button",
        type: "component",
        wikiPage: "button.md",
        chapter: "ch-01",
      },
    ];
    const stats = {
      totalChapters: 1,
      totalPages: 1,
      totalSymbols: 1,
      totalSourceFiles: 1,
    };
    const result = generateGlossary(symbols, stats);
    expect(result).toContain("generated_at:");
    expect(result).toContain("total_symbols: 1");
  });

  it("groups symbols by type and orders correctly", () => {
    const symbols = [
      { name: "useAuth", type: "hook", wikiPage: "hooks.md", chapter: "ch-01" },
      {
        name: "Button",
        type: "component",
        wikiPage: "button.md",
        chapter: "ch-01",
      },
      {
        name: "formatDate",
        type: "function",
        wikiPage: "utils.md",
        chapter: "ch-02",
      },
    ];
    const stats = {
      totalChapters: 2,
      totalPages: 3,
      totalSymbols: 3,
      totalSourceFiles: 3,
    };
    const result = generateGlossary(symbols, stats);

    // Component section before hook section
    expect(result).toContain("🧩 组件");
    expect(result).toContain("🪝 Hooks");
    expect(result).toContain("🔧 函数");

    // Component should appear first in the ordered list
    const componentIdx = result.indexOf("🧩 组件");
    const hookIdx = result.indexOf("🪝 Hooks");
    const functionIdx = result.indexOf("🔧 函数");
    expect(componentIdx).toBeLessThan(hookIdx);
    expect(hookIdx).toBeLessThan(functionIdx);
  });

  it("includes type count table", () => {
    const symbols = [
      {
        name: "Button",
        type: "component",
        wikiPage: "button.md",
        chapter: "ch-01",
      },
      {
        name: "Input",
        type: "component",
        wikiPage: "input.md",
        chapter: "ch-01",
      },
    ];
    const stats = {
      totalChapters: 1,
      totalPages: 2,
      totalSymbols: 2,
      totalSourceFiles: 2,
    };
    const result = generateGlossary(symbols, stats);
    expect(result).toContain("| 🧩 组件 | 2 |");
  });

  it("includes wiki links in symbol listing", () => {
    const symbols = [
      {
        name: "Button",
        type: "component",
        wikiPage: "button.md",
        chapter: "ch-01-core",
      },
    ];
    const stats = {
      totalChapters: 1,
      totalPages: 1,
      totalSymbols: 1,
      totalSourceFiles: 1,
    };
    const result = generateGlossary(symbols, stats);
    expect(result).toContain("[[volume-1-code/ch-01-core/button.md]]");
  });

  it("handles unknown type gracefully", () => {
    const symbols = [
      {
        name: "Config",
        type: "config",
        wikiPage: "config.md",
        chapter: "ch-01",
      },
    ];
    const stats = {
      totalChapters: 1,
      totalPages: 1,
      totalSymbols: 1,
      totalSourceFiles: 1,
    };
    const result = generateGlossary(symbols, stats);
    expect(result).toContain("config");
  });

  it("sorts symbols alphabetically within each type", () => {
    const symbols = [
      { name: "Zebra", type: "component", wikiPage: "z.md", chapter: "ch-01" },
      { name: "Alpha", type: "component", wikiPage: "a.md", chapter: "ch-01" },
    ];
    const stats = {
      totalChapters: 1,
      totalPages: 2,
      totalSymbols: 2,
      totalSourceFiles: 2,
    };
    const result = generateGlossary(symbols, stats);
    const alphaIdx = result.indexOf("Alpha");
    const zebraIdx = result.indexOf("Zebra");
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });

  it("handles empty symbols array", () => {
    const stats = {
      totalChapters: 0,
      totalPages: 0,
      totalSymbols: 0,
      totalSourceFiles: 0,
    };
    const result = generateGlossary([], stats);
    expect(result).toContain("total_symbols: 0");
  });
});
