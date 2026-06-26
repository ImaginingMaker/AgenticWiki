/**
 * Script execution utility — wraps execSync for running pipeline scripts.
 *
 * Responsibilities:
 *   - Execute a TypeScript script via npx tsx
 *   - Handle errors (maxBuffer, timeouts, non-zero exit)
 *
 * Usage:
 *   import { runScript } from "./script-runner.js";
 *   const result = runScript("scan-files.ts", ["--path", src], libDir, cwd);
 */

import path from "node:path";
import { execFileSync, ExecSyncOptions } from "node:child_process";

export interface ScriptResult {
  success: boolean;
  output: string;
}

/**
 * Run a pipeline script via npx tsx.
 * @param scriptName  Filename in libDir (e.g. "scan-files.ts")
 * @param args        CLI argument strings
 * @param libDir      Directory containing the script
 * @param cwd         Working directory for execution
 * @param scriptOpts  Optional timeout (ms) and maxBuffer (bytes) overrides
 */
export function runScript(
  scriptName: string,
  args: string[],
  libDir: string,
  cwd: string,
  scriptOpts?: { timeout?: number; maxBuffer?: number },
): ScriptResult {
  const scriptPath = path.join(libDir, scriptName);

  try {
    const opts: ExecSyncOptions = {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: scriptOpts?.timeout ?? 120_000,
      maxBuffer: scriptOpts?.maxBuffer ?? 50 * 1024 * 1024,
    };
    const output = execFileSync("npx", ["tsx", scriptPath, ...args], opts);
    return { success: true, output: String(output).trim() };
  } catch (err: unknown) {
    const execErr =
      err instanceof Error ? (err as Record<string, unknown>) : null;
    const stderr =
      (execErr?.stderr as string | undefined)?.toString() ||
      (err instanceof Error ? err.message : "Unknown error");
    const isMaxBuffer = stderr.includes("maxBuffer");
    const output = isMaxBuffer
      ? `${stderr}\n  💡 提示: 输出超过 ${((scriptOpts?.maxBuffer ?? 50 * 1024 * 1024) / 1024 / 1024).toFixed(0)}MB 缓冲限制。`
      : stderr;
    return { success: false, output };
  }
}
