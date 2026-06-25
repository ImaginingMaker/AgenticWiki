/**
 * Shared Issue frontmatter & metadata parser.
 *
 * Extracts a single `parseIssueFrontmatter()` used by all validation,
 * assembly, and dashboard scripts. Eliminates the 4-way duplication that
 * existed across:
 *   - validate/validate-issue-content.ts
 *   - validate/validate-issue-types.ts
 *   - assemble/issue-dashboard.ts
 *   - assemble/fix-issue-paths.ts
 *
 * Handles both SubAgent output formats:
 *   1. YAML frontmatter (`--- ... ---`)
 *   2. Inline Markdown table (`| **字段** | 值 |`)
 *
 * Normalizations applied:
 *   - issueId   → id
 *   - detectedAt → detected_at
 *   - sourceFile → source_files (singular → plural array)
 *   - Array strings in brackets → parsed arrays
 */

// === Result type ===

export interface IssueFrontmatter {
  id?: string;
  type?: string;
  severity?: string;
  status?: string;
  /** Normalized from `detectedAt`. */
  detected_at?: string;
  /** Normalized from singular `sourceFile`. Always an array when extracted from YAML. */
  source_files?: string[];
  /** SubAgent emits `confidence: high|medium|low`. */
  confidence?: string;
}

// === YAML parser ===

export function parseYamlFrontmatter(content: string): IssueFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const result: IssueFrontmatter = {};
  const lines = match[1].split("\n");

  for (const line of lines) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;

    const rawKey = kv[1];
    let value: unknown = kv[2].trim();

    // Parse inline arrays: ["a", "b"]
    if (
      typeof value === "string" &&
      value.startsWith("[") &&
      value.endsWith("]")
    ) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
    }

    // Normalizations
    switch (rawKey) {
      case "issueId":
        result["id"] = value as string;
        break;
      case "detectedAt":
        result["detected_at"] = value as string;
        break;
      case "sourceFile":
        result["source_files"] =
          typeof value === "string" ? [value] : (value as string[]);
        break;
      default:
        (result as Record<string, unknown>)[rawKey] = value;
    }
  }

  return result;
}

// === Markdown table parser (fallback) ===

export function parseMarkdownTable(content: string): IssueFrontmatter | null {
  // Match rows like: | **ID** | IS-2026-006 |  or  | **类型** | bug |
  const tablePattern =
    /\|\s*\*\*(ID|类型|严重等级|文件|检测时间|状态|置信度)\*\*\s*\|\s*(.+?)\s*\|/g;
  const result: IssueFrontmatter = {};
  let match: RegExpExecArray | null;

  while ((match = tablePattern.exec(content)) !== null) {
    const label = match[1];
    const rawValue = match[2].trim();

    switch (label) {
      case "ID":
        result["id"] = rawValue;
        break;
      case "类型":
        result["type"] = rawValue;
        break;
      case "严重等级": {
        // Strip emoji prefix: "⛔ Critical" → "critical"
        result["severity"] = rawValue
          .replace(/[⛔🔴🟡🟢]\s*/gu, "")
          .toLowerCase();
        break;
      }
      case "文件": {
        const files = rawValue
          .replace(/`/g, "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        result["source_files"] = files;
        break;
      }
      case "检测时间":
        result["detected_at"] = rawValue;
        break;
      case "状态":
        result["status"] = rawValue;
        break;
      case "置信度":
        result["confidence"] = rawValue.toLowerCase();
        break;
    }
  }

  // Only return if we extracted at least an ID and type
  if (result["id"] && result["type"]) return result;
  return null;
}

// === Unified parser (YAML first, then markdown table fallback) ===

export function parseIssueFrontmatter(
  content: string,
): IssueFrontmatter | null {
  return parseYamlFrontmatter(content) ?? parseMarkdownTable(content);
}
