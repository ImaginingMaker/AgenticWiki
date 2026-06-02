import { describe, it, expect } from "vitest";
import { buildSymbolIndex } from "../assemble/symbol-index";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

describe("symbol-index", () => {
  let tmpDir: string;

  function createWikiFile(relPath: string, content: string) {
    const fullPath = path.join(tmpDir, relPath);
    fs.ensureDirSync(path.dirname(fullPath));
    fs.writeFileSync(fullPath, content);
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "symbol-index-test-"));
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it("extracts symbols from markdown headings", async () => {
    createWikiFile(
      "ch-02-core/sec-components.md",
      `---
tags: [components, ui, react]
lastUpdated: 2026-05-29
sourceFiles: [src/components/Button.tsx]
---

## Button

### useButtonState

## Input
`,
    );
    const index = await buildSymbolIndex(tmpDir);
    expect(index.symbols["Button"]).toBeDefined();
    expect(index.symbols["Button"].type).toBe("component");
    expect(index.symbols["Button"].wiki).toBe("ch-02-core/sec-components.md");
  });

  it("extracts symbols from code blocks", async () => {
    createWikiFile(
      "ch-02-core/sec-utils.md",
      `---
tags: [utils, functions]
lastUpdated: 2026-05-29
sourceFiles: [src/utils/format.ts]
---

## formatDate

\`\`\`typescript
export function formatDate(date: Date): string {
  return date.toISOString();
}

export const MAX_RETRY = 3;
\`\`\`
`,
    );
    const index = await buildSymbolIndex(tmpDir);
    expect(index.symbols["formatDate"]).toBeDefined();
    expect(index.symbols["formatDate"].type).toBe("function");
  });

  it("detects hook type from tags", async () => {
    createWikiFile(
      "ch-02-core/sec-hooks.md",
      `---
tags: [hooks, react]
lastUpdated: 2026-05-29
sourceFiles: [src/hooks/useAuth.ts]
---

## useAuth
`,
    );
    const index = await buildSymbolIndex(tmpDir);
    expect(index.symbols["useAuth"]).toBeDefined();
    expect(index.symbols["useAuth"].type).toBe("hook");
  });

  it("ignores index and toc files", async () => {
    createWikiFile(
      "_toc.md",
      `---
tags: [overview]
---

## Architecture
`,
    );
    createWikiFile(
      "ch-01/index.md",
      `---
tags: [overview]
---

## Overview
`,
    );
    createWikiFile(
      "book.md",
      `# Book cover`,
    );
    const index = await buildSymbolIndex(tmpDir);
    // These should be ignored
    expect(Object.keys(index.symbols).length).toBe(0);
  });

  it("deduplicates by keeping first occurrence", async () => {
    createWikiFile(
      "ch-01/sec-a.md",
      `---
tags: [components]
sourceFiles: [src/Button.tsx]
---

## Button
`,
    );
    createWikiFile(
      "ch-02/sec-b.md",
      `---
tags: [components]
sourceFiles: [src/Button.tsx]
---

## Button
`,
    );
    const index = await buildSymbolIndex(tmpDir);
    // First occurrence wins (ch-01)
    expect(index.symbols["Button"]).toBeDefined();
    expect(index.symbols["Button"].wiki).toBe("ch-01/sec-a.md");
  });

  it("handles empty wiki directory", async () => {
    const index = await buildSymbolIndex(tmpDir);
    expect(Object.keys(index.symbols).length).toBe(0);
    expect(index.generatedAt).toBeDefined();
  });
});
