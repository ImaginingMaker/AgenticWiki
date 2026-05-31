/**
 * 结构化错误码体系 — 替代全局 catch (error: any) + error.message 字符串匹配。
 *
 * 解决痛点：
 * - 无自定义错误类，无法区分 "文件不存在" vs "JSON 解析错误" vs "锁超时"
 * - 反馈循环中编排器 Agent 需要人工解析日志文本提取根因
 * - 没有错误码，无法进行结构化错误传播
 *
 * 使用方式：
 *   throw new AppError(ErrorCodes.ARTIFACT_MISSING, { path: "wiki/book.md" });
 *
 * Agent 解析方式：
 *   try { ... } catch (e) {
 *     if (e instanceof AppError) {
 *       switch (e.code) { case "E001": ... }
 *     }
 *   }
 */

// === Error Code Definitions ===

export const ERROR_DEFS = {
  /** Artifact does not exist where expected */
  E001_ARTIFACT_MISSING: {
    code: "E001",
    action: "retry_phase",
    severity: "CRITICAL",
    message: "Required artifact is missing",
  },

  /** JSON file cannot be parsed */
  E002_JSON_PARSE_ERROR: {
    code: "E002",
    action: "retry_phase",
    severity: "CRITICAL",
    message: "JSON parse error",
  },

  /** Schema version mismatch */
  E003_SCHEMA_VERSION: {
    code: "E003",
    action: "abort",
    severity: "CRITICAL",
    message: "Schema version mismatch",
  },

  /** Broken cross-reference in Wiki */
  E101_REFERENCE_BROKEN: {
    code: "E101",
    action: "patch_gen",
    severity: "WARNING",
    message: "Broken wiki cross-reference",
  },

  /** Code in wiki does not match actual source */
  E102_CODE_MISMATCH: {
    code: "E102",
    action: "feedback_only",
    severity: "WARNING",
    message: "Wiki content does not match source code",
  },

  /** Path isolation violation (iron laws) */
  E201_PATH_VIOLATION: {
    code: "E201",
    action: "abort",
    severity: "CRITICAL",
    message: "Path isolation violation",
  },

  /** File lock acquisition timeout */
  E301_LOCK_TIMEOUT: {
    code: "E301",
    action: "abort",
    severity: "CRITICAL",
    message: "Lock acquisition timeout",
  },

  /** Stale lock from crashed process */
  E302_LOCK_STALE: {
    code: "E302",
    action: "auto_recover",
    severity: "WARNING",
    message: "Stale lock detected and recovered",
  },

  /** SubAgent timeout during GEN phase */
  E401_SUBAGENT_TIMEOUT: {
    code: "E401",
    action: "retry_task",
    severity: "ERROR",
    message: "SubAgent execution timed out",
  },

  /** SubAgent produced empty/invalid output */
  E402_SUBAGENT_EMPTY_OUTPUT: {
    code: "E402",
    action: "retry_task",
    severity: "ERROR",
    message: "SubAgent produced empty output",
  },

  /** Mermaid syntax leaked into output */
  E403_MERMAID_LEAK: {
    code: "E403",
    action: "clean_artifact",
    severity: "WARNING",
    message: "Mermaid syntax leak detected in artifact",
  },

  /** dependency-cruiser execution failed */
  E501_DEPCRUISER_FAILED: {
    code: "E501",
    action: "retry_phase",
    severity: "CRITICAL",
    message: "dependency-cruiser execution failed",
  },

  /** Max buffer exceeded (likely too many modules) */
  E502_DEPCRUISER_BUFFER_OVERFLOW: {
    code: "E502",
    action: "split_and_retry",
    severity: "CRITICAL",
    message: "dependency-cruiser output exceeded maxBuffer",
  },
} as const;

// === Error Action Types ===

export type ErrorAction =
  | "retry_phase"
  | "retry_task"
  | "split_and_retry"
  | "patch_gen"
  | "clean_artifact"
  | "feedback_only"
  | "auto_recover"
  | "abort";

export type ErrorSeverity = "CRITICAL" | "ERROR" | "WARNING";

export interface ErrorDef {
  code: string;
  action: ErrorAction;
  severity: ErrorSeverity;
  message: string;
}

// === AppError Class ===

export class AppError extends Error {
  public readonly code: string;
  public readonly action: ErrorAction;
  public readonly severity: ErrorSeverity;
  public readonly context: Record<string, unknown>;

  constructor(
    def: ErrorDef,
    context: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(def.message);
    this.name = "AppError";
    this.code = def.code;
    this.action = def.action;
    this.severity = def.severity;
    this.context = context;
    if (cause) {
      this.cause = cause;
    }
  }

  /**
   * Serialize error for structured logging / stdout output.
   * Agent can JSON.parse this for programmatic handling.
   */
  toJSON(): Record<string, unknown> {
    return {
      error: true,
      code: this.code,
      action: this.action,
      severity: this.severity,
      message: this.message,
      context: this.context,
      ...(this.cause instanceof Error
        ? { cause: this.cause.message }
        : {}),
    };
  }

  /**
   * Check if this is a retryable error (action allows retry).
   */
  isRetryable(): boolean {
    return ["retry_phase", "retry_task", "split_and_retry", "auto_recover"].includes(
      this.action,
    );
  }

  /**
   * Check if this error should block the pipeline.
   */
  isBlocking(): boolean {
    return this.severity === "CRITICAL" || this.action === "abort";
  }
}
