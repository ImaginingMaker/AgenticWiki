/**
 * Tests for extract-experience.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeAffectedExperience } from "../experience/extract-experience.js";

// Mock fs-extra
vi.mock("fs-extra", () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    readJsonSync: vi.fn(),
    ensureDir: vi.fn(),
    outputJson: vi.fn(),
    outputFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import fs from "fs-extra";

const mockExistsSync = vi.mocked(fs.existsSync);
// Minimal Dirent-like type to avoid Node.js generic parameter issues
const mockReaddirSync = vi.mocked(fs.readdirSync) as unknown as (
  ...args: Parameters<typeof fs.readdirSync>
) => Array<{ name: string; isDirectory: () => boolean }>;
const mockReadFileSync = vi.mocked(fs.readFileSync);

describe("computeAffectedExperience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty when experience dir does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const result = computeAffectedExperience(
      "/fake/volume-3-experience",
      new Set(["cluster-1"]),
      new Set(["cluster-1", "cluster-2"]),
    );
    expect(result.affected).toHaveLength(0);
    expect(result.summary.total).toBe(0);
  });

  it("detects unchanged patterns when no clusters affected", () => {
    mockExistsSync.mockReturnValueOnce(true); // dir exists
    mockReaddirSync.mockReturnValueOnce([
      { name: "hook", isDirectory: () => true },
    ]);
    mockReaddirSync.mockReturnValueOnce([
      { name: "EXP-001.md", isDirectory: () => false },
    ]);
    mockReadFileSync.mockReturnValueOnce(`---
id: EXP-001
category: hook
status: active
title: "useFetch pattern"
source_clusters: ["cluster-1", "cluster-2"]
---`);

    const result = computeAffectedExperience(
      "/fake/volume-3-experience",
      new Set(["cluster-3"]), // Different cluster affected
      new Set(["cluster-1", "cluster-2", "cluster-3"]),
    );

    expect(result.affected).toHaveLength(1);
    expect(result.affected[0].action).toBe("unchanged");
    expect(result.summary.unchanged).toBe(1);
  });

  it("marks pattern as stale when one source cluster changes", () => {
    mockExistsSync.mockReturnValueOnce(true); // dir exists
    mockReaddirSync.mockReturnValueOnce([
      { name: "hook", isDirectory: () => true },
    ]);
    mockReaddirSync.mockReturnValueOnce([
      { name: "EXP-001.md", isDirectory: () => false },
    ]);
    mockReadFileSync.mockReturnValueOnce(`---
id: EXP-001
category: hook
status: active
title: "useFetch pattern"
source_clusters: ["cluster-1", "cluster-2"]
---`);

    const result = computeAffectedExperience(
      "/fake/volume-3-experience",
      new Set(["cluster-1"]),
      new Set(["cluster-1", "cluster-2"]),
    );

    expect(result.affected).toHaveLength(1);
    expect(result.affected[0].action).toBe("orphaned");
    expect(result.summary.orphaned).toBe(1);
  });

  it("marks pattern as orphaned when remaining clusters < 2", () => {
    mockExistsSync.mockReturnValueOnce(true);
    mockReaddirSync.mockReturnValueOnce([
      { name: "hook", isDirectory: () => true },
    ]);
    mockReaddirSync.mockReturnValueOnce([
      { name: "EXP-001.md", isDirectory: () => false },
    ]);
    mockReadFileSync.mockReturnValueOnce(`---
id: EXP-001
category: hook
status: active
title: "useFetch pattern"
source_clusters: ["cluster-1", "cluster-2"]
---`);

    const result = computeAffectedExperience(
      "/fake/volume-3-experience",
      new Set(["cluster-1", "cluster-2"]), // Both clusters affected
      new Set([]), // No remaining valid clusters
    );

    expect(result.affected).toHaveLength(1);
    expect(result.affected[0].action).toBe("orphaned");
    expect(result.summary.orphaned).toBe(1);
  });

  it("parses multiline source_clusters format", () => {
    mockExistsSync.mockReturnValueOnce(true);
    mockReaddirSync.mockReturnValueOnce([
      { name: "component", isDirectory: () => true },
    ]);
    mockReaddirSync.mockReturnValueOnce([
      { name: "EXP-003.md", isDirectory: () => false },
    ]);
    mockReadFileSync.mockReturnValueOnce(`---
id: EXP-003
category: component
source_clusters:
  - cluster-a
  - cluster-b
  - cluster-c
---`);

    const result = computeAffectedExperience(
      "/fake/volume-3-experience",
      new Set(["cluster-a"]),
      new Set(["cluster-a", "cluster-b", "cluster-c"]),
    );

    expect(result.affected).toHaveLength(1);
    expect(result.affected[0].action).toBe("stale");
    expect(result.affected[0].remainingClusters).toEqual([
      "cluster-b",
      "cluster-c",
    ]);
  });
});
