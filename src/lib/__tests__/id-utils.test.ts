import { describe, it, expect } from "vitest";
import {
  sanitizePathId,
  generateSubTaskId,
  generateWikiChapterPath,
  subTaskIdEquals,
} from "../shared/id-utils.js";

describe("sanitizePathId", () => {
  it("replaces non-alphanumeric characters with underscores", () => {
    expect(sanitizePathId("hello world")).toBe("hello_world");
  });

  it("collapses consecutive underscores", () => {
    expect(sanitizePathId("a!!b??c")).toBe("a_b_c");
  });

  it("strips leading and trailing underscores", () => {
    expect(sanitizePathId("!!!hello!!!")).toBe("hello");
  });

  it("converts to lowercase", () => {
    expect(sanitizePathId("HelloWorld")).toBe("helloworld");
  });

  it("preserves hyphens and underscores", () => {
    expect(sanitizePathId("my-component_name")).toBe("my-component_name");
  });

  it("returns 'root' for empty input after sanitization", () => {
    expect(sanitizePathId("!!!")).toBe("root");
  });

  it("handles forward slashes in paths", () => {
    expect(sanitizePathId("src/components/")).toBe("src_components");
  });
});

describe("generateSubTaskId", () => {
  it("generates ID from folder path and role (preserves hyphens)", () => {
    expect(generateSubTaskId("src/components/", "ui-components")).toBe(
      "src_components-ui-components",
    );
  });

  it("appends index suffix when index > 1", () => {
    expect(generateSubTaskId("src/components/", "ui-components", 2)).toBe(
      "src_components-ui-components-2",
    );
  });

  it("does not append suffix for index 1", () => {
    expect(generateSubTaskId("src/components/", "ui-components", 1)).toBe(
      "src_components-ui-components",
    );
  });

  it("handles empty folder path", () => {
    // sanitizePathId("") returns "root"
    expect(generateSubTaskId("", "root-files")).toBe("root-root-files");
  });

  it("preserves hyphens in role, lowercases", () => {
    expect(generateSubTaskId("src/utils", "helper-functions")).toBe(
      "src_utils-helper-functions",
    );
  });
});

describe("generateWikiChapterPath", () => {
  it("generates chapter path from folder and role (preserves hyphens)", () => {
    expect(generateWikiChapterPath("src/components/", "ui-components")).toBe(
      "ch-src_components/sec-ui-components.md",
    );
  });

  it("appends index suffix when index > 1", () => {
    expect(generateWikiChapterPath("src/components/", "ui-components", 2)).toBe(
      "ch-src_components/sec-ui-components-2.md",
    );
  });

  it("does not append suffix for index 1", () => {
    expect(generateWikiChapterPath("src/components/", "ui-components", 1)).toBe(
      "ch-src_components/sec-ui-components.md",
    );
  });

  it("handles empty folder path", () => {
    // sanitizePathId("") returns "root"
    expect(generateWikiChapterPath("", "root-files")).toBe(
      "ch-root/sec-root-files.md",
    );
  });
});

describe("subTaskIdEquals", () => {
  it("returns true for equal strings", () => {
    expect(subTaskIdEquals("a-b", "a-b")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(subTaskIdEquals("a-b", "a-c")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(subTaskIdEquals("", "")).toBe(true);
  });
});
