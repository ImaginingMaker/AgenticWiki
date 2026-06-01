import { describe, it, expect } from "vitest";
import { filterStyles } from "../filter-styles.js";
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
  it("should filter .css files as pure_style", async () => {
    const fileList = makeFileList([
      "src/App.tsx",
      "src/styles/global.css",
      "src/components/Button.tsx",
    ]);

    const result = await filterStyles(fileList);

    expect(result.filteredCount).toBe(1);
    expect(result.remainingCount).toBe(2);
    expect(result.files).toEqual(["src/App.tsx", "src/components/Button.tsx"]);
    expect(result.filteredFiles[0]).toEqual({
      path: "src/styles/global.css",
      reason: "Style extension: .css",
      filterType: "pure_style",
    });
  });

  it("should filter .scss files as pure_style", async () => {
    const fileList = makeFileList(["src/theme/variables.scss", "src/index.ts"]);

    const result = await filterStyles(fileList);

    expect(result.filteredCount).toBe(1);
    expect(result.filteredFiles[0].filterType).toBe("pure_style");
    expect(result.filteredFiles[0].reason).toContain(".scss");
  });

  it("should filter .less files as pure_style", async () => {
    const fileList = makeFileList(["src/antd.overrides.less"]);

    const result = await filterStyles(fileList);

    expect(result.filteredCount).toBe(1);
    expect(result.filteredFiles[0].filterType).toBe("pure_style");
  });

  it("should filter .sass files as pure_style", async () => {
    const fileList = makeFileList(["src/legacy-styles.sass"]);

    const result = await filterStyles(fileList);

    expect(result.filteredCount).toBe(1);
    expect(result.filteredFiles[0].filterType).toBe("pure_style");
  });

  it("should filter .styl files as pure_style", async () => {
    const fileList = makeFileList(["src/theme/colors.styl"]);

    const result = await filterStyles(fileList);

    expect(result.filteredCount).toBe(1);
    expect(result.filteredFiles[0].filterType).toBe("pure_style");
  });

  it("should filter styled-components files by .styled. pattern", async () => {
    const fileList = makeFileList([
      "src/components/Button.styled.ts",
      "src/components/Button.tsx",
    ]);

    const result = await filterStyles(fileList);

    expect(result.filteredCount).toBe(1);
    expect(result.files).toEqual(["src/components/Button.tsx"]);
    expect(result.filteredFiles[0]).toEqual({
      path: "src/components/Button.styled.ts",
      reason: "Styled-components definition file",
      filterType: "styled_components",
    });
    expect(result.remainingCount).toBe(1);
  });

  it("should filter styled-components files by .styles. pattern", async () => {
    const fileList = makeFileList([
      "src/components/Card.styles.ts",
      "src/components/Card.tsx",
    ]);

    const result = await filterStyles(fileList);

    expect(result.filteredCount).toBe(1);
    expect(result.files).toEqual(["src/components/Card.tsx"]);
    expect(result.filteredFiles[0].filterType).toBe("styled_components");
  });

  it("should return empty filtered list when no style files", async () => {
    const fileList = makeFileList([
      "src/App.tsx",
      "src/utils/helpers.ts",
      "src/index.ts",
    ]);

    const result = await filterStyles(fileList);

    expect(result.filteredCount).toBe(0);
    expect(result.filteredFiles).toEqual([]);
    expect(result.remainingCount).toBe(3);
    expect(result.files).toEqual([
      "src/App.tsx",
      "src/utils/helpers.ts",
      "src/index.ts",
    ]);
  });

  it("should handle mixed file types correctly", async () => {
    const fileList = makeFileList([
      "src/App.tsx",
      "src/styles/global.css",
      "src/components/Button.styled.ts",
      "src/utils/helpers.ts",
      "src/theme/variables.scss",
      "src/components/Card.styles.tsx",
      "src/index.ts",
    ]);

    const result = await filterStyles(fileList);

    expect(result.filteredCount).toBe(4);
    expect(result.remainingCount).toBe(3);
    expect(result.files).toEqual([
      "src/App.tsx",
      "src/utils/helpers.ts",
      "src/index.ts",
    ]);

    const pureStyleFiles = result.filteredFiles.filter(
      (f) => f.filterType === "pure_style",
    );
    const styledCompFiles = result.filteredFiles.filter(
      (f) => f.filterType === "styled_components",
    );

    expect(pureStyleFiles).toHaveLength(2);
    expect(styledCompFiles).toHaveLength(2);
  });

  it("should correctly set totalFiles from input", async () => {
    const fileList = makeFileList(["src/a.css", "src/b.ts", "src/c.tsx"]);

    const result = await filterStyles(fileList);

    expect(result.totalFiles).toBe(3);
  });

  it("should include filteredAt timestamp", async () => {
    const fileList = makeFileList(["src/a.css"]);

    const result = await filterStyles(fileList);

    expect(result.filteredAt).toBeTruthy();
    expect(new Date(result.filteredAt).getTime()).not.toBeNaN();
  });

  it("should handle empty file list", async () => {
    const fileList = makeFileList([]);

    const result = await filterStyles(fileList);

    expect(result.filteredCount).toBe(0);
    expect(result.remainingCount).toBe(0);
    expect(result.files).toEqual([]);
    expect(result.totalFiles).toBe(0);
  });

  it("should prioritize pure_style over styled_components for CSS files with .styled. in name", async () => {
    // A .css file that also matches .styled. pattern should be caught by extension first
    const fileList = makeFileList(["src/components/Button.styled.css"]);

    const result = await filterStyles(fileList);

    expect(result.filteredCount).toBe(1);
    expect(result.filteredFiles[0].filterType).toBe("pure_style");
  });

  it("should be case-insensitive for extension matching", async () => {
    const fileList = makeFileList(["src/styles/Global.CSS"]);

    const result = await filterStyles(fileList);

    expect(result.filteredCount).toBe(1);
    expect(result.filteredFiles[0].filterType).toBe("pure_style");
  });

  it("should be case-insensitive for styled pattern matching", async () => {
    const fileList = makeFileList(["src/components/Button.STYLED.ts"]);

    const result = await filterStyles(fileList);

    expect(result.filteredCount).toBe(1);
    expect(result.filteredFiles[0].filterType).toBe("styled_components");
  });
});
