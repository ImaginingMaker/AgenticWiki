// @ts-nocheck — mock types for vi.mocked(fse.readFile) have Buffer compatibility
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeHashes } from "../dependency/compute-hashes.js";

vi.mock("fs-extra", () => ({
  default: {
    readFile: vi.fn(),
  },
}));

vi.mock("globby", () => ({
  globby: vi.fn(),
}));

import fse from "fs-extra";
import { globby } from "globby";

const mockGlobby = vi.mocked(globby);
const mockReadFile = vi.mocked(fse.readFile);

describe("computeHashes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should compute SHA-256 hashes for all files", async () => {
    mockGlobby.mockResolvedValue(["a.ts", "b.tsx"]);
    mockReadFile
      .mockResolvedValueOnce(Buffer.from("content of a"))
      .mockResolvedValueOnce(Buffer.from("content of b"));

    const result = await computeHashes("/project/src");

    expect(Object.keys(result)).toHaveLength(2);
    expect(result["a.ts"]).toMatch(/^[a-f0-9]{64}$/);
    expect(result["b.tsx"]).toMatch(/^[a-f0-9]{64}$/);
    expect(result["a.ts"]).not.toBe(result["b.tsx"]);
  });

  it("should return same hash for identical content", async () => {
    mockGlobby.mockResolvedValue(["file1.ts", "file2.ts"]);
    mockReadFile
      .mockResolvedValueOnce(Buffer.from("same content"))
      .mockResolvedValueOnce(Buffer.from("same content"));

    const result = await computeHashes("/project/src");

    expect(result["file1.ts"]).toBe(result["file2.ts"]);
  });

  it("should return empty object when no files found", async () => {
    mockGlobby.mockResolvedValue([]);

    const result = await computeHashes("/project/src");

    expect(result).toEqual({});
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("should use default exclude patterns (含 build)", async () => {
    mockGlobby.mockResolvedValue([]);

    await computeHashes("/project/src");

    const globbyCall = mockGlobby.mock.calls[0];
    const patterns = globbyCall![0] as string[];
    expect(patterns).toContain("!**/node_modules/**");
    expect(patterns).toContain("!**/dist/**");
    expect(patterns).toContain("!**/build/**");
    expect(patterns).toContain("!**/.git/**");
  });

  it("should merge custom exclude patterns with defaults", async () => {
    mockGlobby.mockResolvedValue([]);

    await computeHashes("/project/src", ["**/coverage/**", "**/__tests__/**"]);

    const globbyCall = mockGlobby.mock.calls[0];
    const patterns = globbyCall![0] as string[];
    expect(patterns).toContain("!**/node_modules/**");
    expect(patterns).toContain("!**/coverage/**");
    expect(patterns).toContain("!**/__tests__/**");
  });

  it("should pass correct cwd to globby", async () => {
    mockGlobby.mockResolvedValue([]);

    await computeHashes("/my/project/src");

    const options = mockGlobby.mock.calls[0]![1] as Record<string, unknown>;
    expect(options.cwd).toBe("/my/project/src");
  });

  it("should read files from sourcePath with correct paths", async () => {
    mockGlobby.mockResolvedValue(["utils/helpers.ts"]);
    mockReadFile.mockResolvedValueOnce(Buffer.from("export const x = 1;"));

    await computeHashes("/project/src");

    expect(mockReadFile).toHaveBeenCalledWith("/project/src/utils/helpers.ts");
  });

  it("should produce correct SHA-256 hash for known content", async () => {
    mockGlobby.mockResolvedValue(["test.txt"]);
    mockReadFile.mockResolvedValueOnce(Buffer.from("hello"));

    const result = await computeHashes("/project/src");

    expect(result["test.txt"]).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("should handle files with special characters in path", async () => {
    mockGlobby.mockResolvedValue(["components/[id]/page.tsx"]);
    mockReadFile.mockResolvedValueOnce(Buffer.from("special"));

    const result = await computeHashes("/project/src");

    expect(result["components/[id]/page.tsx"]).toMatch(/^[a-f0-9]{64}$/);
    expect(mockReadFile).toHaveBeenCalledWith(
      "/project/src/components/[id]/page.tsx",
    );
  });

  // === Phase 1 S4-1: 并发控制 — 大文件批处理不分批 ===
  it("S4-1: should process large file lists in chunks (concurrency control)", async () => {
    // 120 files → 3 chunks of 50
    const fileCount = 120;
    const files = Array.from({ length: fileCount }, (_, i) => `file${i}.ts`);
    mockGlobby.mockResolvedValue(files);
    // Mock all readFile calls to return same content
    mockReadFile.mockImplementation(() =>
      Promise.resolve(Buffer.from("content")),
    );

    const result = await computeHashes("/project/src");

    expect(Object.keys(result)).toHaveLength(fileCount);
    // Verify readFile was called for each file
    expect(mockReadFile).toHaveBeenCalledTimes(fileCount);
  });

  it("S4-1: should handle single chunk (under 50 files)", async () => {
    const files = ["a.ts", "b.ts"];
    mockGlobby.mockResolvedValue(files);
    mockReadFile
      .mockResolvedValueOnce(Buffer.from("aaa"))
      .mockResolvedValueOnce(Buffer.from("bbb"));

    const result = await computeHashes("/project/src");

    expect(Object.keys(result)).toHaveLength(2);
    expect(mockReadFile).toHaveBeenCalledTimes(2);
  });

  // === Phase 1 S4-2: build 目录已在默认排除列表中 ===
  it("S4-2: build directory is excluded by default", async () => {
    mockGlobby.mockResolvedValue([]);

    await computeHashes("/project/src");

    const patterns = mockGlobby.mock.calls[0]![0] as string[];
    expect(patterns).toContain("!**/build/**");
  });
});
