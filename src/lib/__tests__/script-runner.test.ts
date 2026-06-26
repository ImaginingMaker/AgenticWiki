import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  ExecSyncOptions: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { runScript } from "../pipeline/script-runner.js";

const mockExecFileSync = vi.mocked(execFileSync);

describe("runScript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success with trimmed output", () => {
    mockExecFileSync.mockReturnValue("  result  ");
    const result = runScript("test.ts", ["--flag"], "/lib", "/cwd");
    expect(result.success).toBe(true);
    expect(result.output).toBe("result");
  });

  it("builds correct npx tsx command via execFileSync", () => {
    mockExecFileSync.mockReturnValue("");
    runScript("scan.ts", ["--path", "/src"], "/lib", "/cwd");
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "npx",
      ["tsx", "/lib/scan.ts", "--path", "/src"],
      expect.objectContaining({
        cwd: "/cwd",
        timeout: 120_000,
        maxBuffer: 50 * 1024 * 1024,
      }),
    );
  });

  it("passes args without shell escaping (array args)", () => {
    mockExecFileSync.mockReturnValue("");
    runScript("test.ts", [`--path=/my "project"`], "/lib", "/cwd");
    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain(`--path=/my "project"`);
  });

  it("uses custom timeout and maxBuffer when provided", () => {
    mockExecFileSync.mockReturnValue("");
    runScript("test.ts", [], "/lib", "/cwd", {
      timeout: 5000,
      maxBuffer: 1024,
    });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "npx",
      expect.any(Array),
      expect.objectContaining({ timeout: 5000, maxBuffer: 1024 }),
    );
  });

  it("returns failure with stderr on error", () => {
    const err = Object.assign(new Error("command failed"), {
      stderr: Buffer.from(""),
    });
    err.stderr = Buffer.from("error output");
    mockExecFileSync.mockImplementation(() => {
      throw err;
    });
    const result = runScript("test.ts", [], "/lib", "/cwd");
    expect(result.success).toBe(false);
    expect(result.output).toContain("error output");
  });

  it("returns failure with error message when no stderr", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("failed");
    });
    const result = runScript("test.ts", [], "/lib", "/cwd");
    expect(result.success).toBe(false);
    expect(result.output).toContain("failed");
  });

  it("detects maxBuffer error and adds hint", () => {
    const err = Object.assign(new Error("stderr maxBuffer exceeded"), {
      stderr: Buffer.from(""),
    });
    err.stderr = Buffer.from("maxBuffer");
    mockExecFileSync.mockImplementation(() => {
      throw err;
    });
    const result = runScript("test.ts", [], "/lib", "/cwd");
    expect(result.success).toBe(false);
    expect(result.output).toContain("💡");
  });
});
