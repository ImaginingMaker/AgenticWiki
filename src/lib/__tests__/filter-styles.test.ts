import { describe, it, expect } from "vitest";
import { filterStyles } from "../scan/filter-styles.js";
import type { FileListResult } from "../../types/index.js";

function makeFileList(files: string[]): FileListResult {
  const byExtension: Record<string, number> = {};
  for (const f of files) {
    const ext = f.substring(f.lastIndexOf("."));
    byExtension[ext] = (byExtension[ext] || 0) + 1;
  }
  return {
    scannedAt: new Date().toISOString(),
    sourcePath: "/project/src",
    totalFiles: files.length,
    files,
    byExtension,
  };
}

describe("filterStyles", () => {
  // === Phase 1 S3-1: 纯样式过滤已移除，仅保留 CSS-in-JS 检测 ===

  it("should filter styled-components files by .styled. pattern", () => {
    const fileList = makeFileList([
      "src/components/Button.styled.ts",
      "src/components/Button.tsx",
    ]);

    const result = filterStyles(fileList);

    expect(result.filteredCount).toBe(1);
    expect(result.remainingCount).toBe(1);
    expect(result.files).toEqual(["src/components/Button.tsx"]);
    expect(result.filteredFiles[0]).toEqual({
      path: "src/components/Button.styled.ts",
      reason: "Styled-components definition file",
      filterType: "styled_components",
    });
  });

  it("should filter styled-components files by .styles. pattern", () => {
    const fileList = makeFileList([
      "src/components/Card.styles.ts",
      "src/components/Card.tsx",
    ]);

    const result = filterStyles(fileList);

    expect(result.filteredCount).toBe(1);
    expect(result.files).toEqual(["src/components/Card.tsx"]);
    expect(result.filteredFiles[0].filterType).toBe("styled_components");
  });

  it("should return empty filtered list when no styled files", () => {
    const fileList = makeFileList([
      "src/App.tsx",
      "src/utils/helpers.ts",
      "src/index.ts",
    ]);

    const result = filterStyles(fileList);

    expect(result.filteredCount).toBe(0);
    expect(result.filteredFiles).toEqual([]);
    expect(result.remainingCount).toBe(3);
    expect(result.files).toEqual([
      "src/App.tsx",
      "src/utils/helpers.ts",
      "src/index.ts",
    ]);
  });

  it("should only filter styled-components files (pure style filtering removed)", () => {
    const fileList = makeFileList([
      "src/App.tsx",
      "src/components/Button.styled.ts",
      "src/utils/helpers.ts",
      "src/components/Card.styles.tsx",
      "src/index.ts",
    ]);

    const result = filterStyles(fileList);

    // Only 2 styled-components files filtered, no pure_style
    expect(result.filteredCount).toBe(2);
    expect(result.remainingCount).toBe(3);
    expect(result.files).toEqual([
      "src/App.tsx",
      "src/utils/helpers.ts",
      "src/index.ts",
    ]);

    // All filtered files should be styled_components type
    const nonStyled = result.filteredFiles.filter(
      (f) => f.filterType !== "styled_components",
    );
    expect(nonStyled).toHaveLength(0);
  });

  it("should correctly set totalFiles from input", () => {
    const fileList = makeFileList(["src/a.ts", "src/b.ts", "src/c.tsx"]);

    const result = filterStyles(fileList);

    expect(result.totalFiles).toBe(3);
  });

  it("should include filteredAt timestamp", () => {
    const fileList = makeFileList(["src/a.styled.ts"]);

    const result = filterStyles(fileList);

    expect(result.filteredAt).toBeTruthy();
    expect(new Date(result.filteredAt).getTime()).not.toBeNaN();
  });

  it("should handle empty file list", () => {
    const fileList = makeFileList([]);

    const result = filterStyles(fileList);

    expect(result.filteredCount).toBe(0);
    expect(result.remainingCount).toBe(0);
    expect(result.files).toEqual([]);
    expect(result.totalFiles).toBe(0);
  });

  it("should be case-insensitive for styled pattern matching", () => {
    const fileList = makeFileList(["src/components/Button.STYLED.ts"]);

    const result = filterStyles(fileList);

    expect(result.filteredCount).toBe(1);
    expect(result.filteredFiles[0].filterType).toBe("styled_components");
  });

  // === Bug fixes ===
  it("should NOT filter .styled.spec.ts (false positive fix)", () => {
    const fileList = makeFileList(["src/components/Button.styled.spec.ts"]);
    const result = filterStyles(fileList);
    expect(result.filteredCount).toBe(0);
    expect(result.files).toContain("src/components/Button.styled.spec.ts");
  });

  it("should be pure — no cross-call state pollution", () => {
    filterStyles(makeFileList(["a.styled.ts", "b.styled.tsx"]));
    const result = filterStyles(makeFileList(["c.ts", "d.tsx"]));
    expect(result.filteredCount).toBe(0);
    expect(result.files).toEqual(["c.ts", "d.tsx"]);
  });

  it("should use basename only for styled matching (dir name not matched)", () => {
    const fileList = makeFileList(["src/styled/Button.ts"]);
    const result = filterStyles(fileList);
    expect(result.filteredCount).toBe(0);
  });

  // === Phase 1 S3-2: remainingCount 按 remainingFiles.length 计算 ===
  it("S3-2: remainingCount should equal remainingFiles.length", () => {
    const fileList = makeFileList([
      "src/App.tsx",
      "src/Button.styled.ts",
      "src/Card.styles.ts",
    ]);

    const result = filterStyles(fileList);

    expect(result.remainingCount).toBe(result.files.length);
    expect(result.remainingCount).toBe(1);
  });

  // === Phase 1 S3-3: filterStyles 不再是 async ===
  it("S3-3: filterStyles should return synchronously (not a Promise)", () => {
    const fileList = makeFileList(["src/App.tsx"]);

    const result = filterStyles(fileList);

    // result should not be a Promise
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.files).toEqual(["src/App.tsx"]);
  });
});
