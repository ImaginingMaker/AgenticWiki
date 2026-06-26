import fs from "fs-extra";
import matter from "gray-matter";
import type { IssueStatus } from "../types/index.js";

/**
 * Update an Issue file's status and append a history entry.
 * Idempotent: skips if status is already the target value.
 * Returns true if the file was modified.
 */
export function updateIssueStatus(
  issueFilePath: string,
  newStatus: IssueStatus,
  actor: string = "aw-validate",
  note?: string,
): boolean {
  if (!fs.existsSync(issueFilePath)) return false;

  const raw = fs.readFileSync(issueFilePath, "utf-8");
  const parsed = matter(raw);
  const oldStatus = parsed.data.status as string;
  if (oldStatus === newStatus) return false;

  parsed.data.status = newStatus;

  // Append history entry
  if (!Array.isArray(parsed.data.history)) parsed.data.history = [];
  parsed.data.history.push({
    at: new Date().toISOString(),
    event: "status_change",
    from: oldStatus || "unknown",
    to: newStatus,
    by: actor,
    note: note || `${oldStatus || "unknown"} → ${newStatus}`,
  });

  fs.writeFileSync(
    issueFilePath,
    matter.stringify(parsed.content, parsed.data),
    "utf-8",
  );
  return true;
}

/**
 * Batch-mark issues as stale (source files changed in incremental mode).
 * Returns the count of successfully updated issues.
 */
export function markIssuesStale(
  issueFiles: string[],
  reason: string,
): number {
  let count = 0;
  for (const file of issueFiles) {
    if (updateIssueStatus(file, "stale", "aw-incremental", reason)) {
      count++;
    }
  }
  return count;
}
