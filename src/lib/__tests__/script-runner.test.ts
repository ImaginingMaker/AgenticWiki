import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  ExecSyncOptions: vi.fn(),
}));

import { execSync } from "node:child_process";
import { runScript } from "../pipeline/script-runner.js";

const mockExecSync = vi.mocked(execSync);

describe("runScript", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns success with trimmed output", () => {
    mockExecSync.mockReturnValue("  result  ");
    const result = runScript("test.ts", ["--flag"], "/lib", "/cwd");
    expect(result.success).toBe(true);
    expect(result.output).toBe("result");
  });

  it("builds correct npx tsx command", () => {
    mockExecSync.mockReturnValue("");
    runScript("scan.ts", ["--path", "/src"], "/lib", "/cwd");
    expect(mockExecSync).toHaveBeenCalledWith(
      'npx tsx "/lib/scan.ts" "--path" "/src"',
      expect.objectContaining({ cwd: "/cwd", timeout: 120_000, maxBuffer: 50 * 1024 * 1024 }),
    );
  });

  it("escapes double quotes in args", () => {
    mockExecSync.mockReturnValue("");
    runScript("test.ts", [`--path=/my "project"`], "/lib", "/cwd");
    const cmd = mockExecSync.mock.calls[0][0] as string;
    expect(cmd).toContain('--path=/my \\"project\\"');
  });

  it("uses custom timeout and maxBuffer when provided", () => {
    mockExecSync.mockReturnValue("");
    runScript("test.ts", [], "/lib", "/cwd", { timeout: 5000, maxBuffer: 1024 });
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 5000, maxBuffer: 1024 }),
    );
  });

  it("returns failure with stderr on error", () => {
    const err = Object.assign(new Error("command failed"), { stderr: Buffer.from("") });
    err.stderr = Buffer.from("error output");
    mockExecSync.mockImplementation(() => { throw err; });
    const result = runScript("test.ts", [], "/lib", "/cwd");
    expect(result.success).toBe(false);
    expect(result.output).toContain("error output");
  });

  it("returns failure with error message when no stderr", () => {
    mockExecSync.mockImplementation(() => { throw new Error("failed"); });
    const result = runScript("test.ts", [], "/lib", "/cwd");
    expect(result.success).toBe(false);
    expect(result.output).toContain("failed");
  });

  it("detects maxBuffer error and adds hint", () => {
    const err = Object.assign(new Error("stderr maxBuffer exceeded"), { stderr: Buffer.from("") });
    err.stderr = Buffer.from("maxBuffer");
    mockExecSync.mockImplementation(() => { throw err; });
    const result = runScript("test.ts", [], "/lib", "/cwd");
    expect(result.success).toBe(false);
    expect(result.output).toContain("💡");
  });
});
