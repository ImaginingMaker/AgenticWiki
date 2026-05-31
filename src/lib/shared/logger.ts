/**
 * 结构化日志系统 — 替代散落的 process.stdout.write/process.stderr.write。
 *
 * 解决痛点：
 * - 当前所有输出用 stdout/stderr，无日志级别、无结构化输出
 * - 编排器 Agent 通过解析 stdout 文本获取结果 — 脆弱且不可靠
 *
 * 输出约定：
 * - 所有脚本的 stdout 输出 JSON 行（一行一条记录）
 * - 人类可读的进度信息通过 stderr 输出（不影响 JSON 解析）
 * - Agent 可以用 JSON.parse(line) 解析结果
 */

/** Log entry structure for programmatic consumption. */
export interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Log level */
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  /** Structured message */
  message: string;
  /** Optional structured data payload */
  data?: Record<string, unknown>;
}

// === Helpers ===

function now(): string {
  return new Date().toISOString();
}

function formatLine(entry: LogEntry): string {
  return JSON.stringify(entry);
}

// === Public API ===

export const log = {
  debug(message: string, data?: Record<string, unknown>): void {
    process.stderr.write(
      formatLine({ timestamp: now(), level: "DEBUG", message, data }) + "\n",
    );
  },

  info(message: string, data?: Record<string, unknown>): void {
    process.stderr.write(
      formatLine({ timestamp: now(), level: "INFO", message, data }) + "\n",
    );
  },

  warn(message: string, data?: Record<string, unknown>): void {
    process.stderr.write(
      formatLine({ timestamp: now(), level: "WARN", message, data }) + "\n",
    );
  },

  error(message: string, data?: Record<string, unknown>): void {
    process.stderr.write(
      formatLine({ timestamp: now(), level: "ERROR", message, data }) + "\n",
    );
  },

  /**
   * Output structured result to stdout for Agent consumption.
   * This is the ONLY channel Agent should parse for data.
   */
  result(payload: Record<string, unknown>): void {
    process.stdout.write(JSON.stringify(payload) + "\n");
  },
};
