import { describe, it, expect } from "vitest";
import { generateMasterIndex } from "../assemble/assemble-master-index.js";

describe("generateMasterIndex", () => {
  it("generates index with all three volumes", () => {
    const data = {
      wiki: {
        exists: true,
        totalPages: 42,
        totalChapters: 8,
        totalSymbols: 156,
      },
      issues: {
        exists: true,
        totalIssues: 23,
        critical: 2,
        high: 5,
      },
      experience: {
        exists: true,
        totalPatterns: 12,
        active: 9,
        stale: 2,
      },
      glossary: { exists: true },
      fileIssues: { exists: true },
    };

    const md = generateMasterIndex(data);

    // Contains unified title
    expect(md).toContain("项目知识库");

    // Contains all three volume sections
    expect(md).toContain("Volume 1: 代码 Wiki");
    expect(md).toContain("Volume 2: 代码问题");
    expect(md).toContain("Volume 3: 开发经验");

    // Contains stats
    expect(md).toContain("8 章");
    expect(md).toContain("42 页");
    expect(md).toContain("23 个 Issue");
    expect(md).toContain("12 个模式");

    // Contains links to sub-indices
    expect(md).toContain("[[book");
    expect(md).toContain("[[issues");
    expect(md).toContain("[[experience");
    expect(md).toContain("[[glossary");
    expect(md).toContain("[[file-issues");
  });

  it("generates index with only wiki available", () => {
    const data = {
      wiki: { exists: true, totalPages: 10, totalChapters: 2 },
      issues: { exists: false },
      experience: { exists: false },
      glossary: { exists: true },
      fileIssues: { exists: false },
    };

    const md = generateMasterIndex(data);

    expect(md).toContain("Volume 1: 代码 Wiki");
    expect(md).toContain("⚠️ Volume 2 尚未生成");
    expect(md).toContain("⚠️ Volume 3 尚未生成");
  });

  it("generates frontmatter with type marker", () => {
    const data = {
      wiki: { exists: false },
      issues: { exists: false },
      experience: { exists: false },
      glossary: { exists: false },
      fileIssues: { exists: false },
    };

    const md = generateMasterIndex(data);

    expect(md).toContain("type: master_index");
    expect(md).toContain("generated_at");
  });
});
