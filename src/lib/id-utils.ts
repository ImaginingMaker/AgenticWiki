/**
 * ID Utilities — 统一的 ID 生成与路径净化工具。
 *
 * 所有需要生成 subTask.id / genTask.id / wikiChapter 的地方
 * 都必须通过此模块，确保 ID 一致性，消除字符串匹配的脆弱性。
 *
 * 使用者：
 *   - analyze-folders.ts → 生成 subTask.id + wikiChapter
 *   - progress-dashboard.ts → 匹配 subTask.id ↔ genTask.id
 *   - aw-orchestrator → 创建 genTask.id
 */

/**
 * 净化路径片段为 ID 安全字符串。
 * 规则：字母数字下划线保留，其他替换为 _，去重下划线，去首尾下划线，小写。
 */
export function sanitizePathId(input: string): string {
  return (
    input
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase() || "root"
  );
}

/**
 * 净化角色名（去掉连字符，统一为下划线）。
 */
function sanitizeRole(role: string): string {
  return role.replace(/-/g, "_");
}

/**
 * 生成 subTask.id 和 genTask.id（两者必须相同）。
 *
 * 格式: `{sanitizedFolder}-{sanitizedRole}[-{index}]`
 *
 * @param folderPath - 文件夹相对路径，如 "src/components/"
 * @param role - 文件角色，如 "ui-components"
 * @param index - 可选序号，> 1 时追加到 ID 末尾
 *
 * @example
 *   generateSubTaskId("src/components/", "ui-components")     // "src_components-ui_components"
 *   generateSubTaskId("src/components/", "business-components", 2) // "src_components-business_components-2"
 */
export function generateSubTaskId(
  folderPath: string,
  role: string,
  index?: number,
): string {
  const sanitized = sanitizePathId(folderPath);
  const roleName = sanitizeRole(role);
  const suffix = index && index > 1 ? `-${index}` : "";
  return `${sanitized}-${roleName}${suffix}`;
}

/**
 * 生成 Wiki 章节路径。
 *
 * 格式: `ch-{sanitizedFolder}/sec-{sanitizedRole}[-{index}].md`
 *
 * @example
 *   generateWikiChapterPath("src/components/", "ui-components", 1)  // "ch-src_components/sec-ui_components.md"
 *   generateWikiChapterPath("src/components/", "business-components", 2) // "ch-src_components/sec-business_components-2.md"
 */
export function generateWikiChapterPath(
  folderPath: string,
  role: string,
  index?: number,
): string {
  const folderName = sanitizePathId(folderPath);
  const roleName = sanitizeRole(role);
  const suffix = index && index > 1 ? `-${index}` : "";
  return `ch-${folderName}/sec-${roleName}${suffix}.md`;
}

/**
 * 检查两个 ID 是否匹配（类型安全比较）。
 * 当前实现为严格相等，未来可扩展为规范化比较。
 */
export function subTaskIdEquals(a: string, b: string): boolean {
  return a === b;
}

/**
 * 从 subTask 信息生成 genTask 的初始条目（编排器使用）。
 */
export function createGenTaskEntry(
  folderPath: string,
  role: string,
  estimatedTokens: number,
  index?: number,
) {
  const id = generateSubTaskId(folderPath, role, index);
  return {
    id,
    folder: folderPath,
    role,
    status: "in_progress" as const,
    estimatedTokens,
    wikiChapter: generateWikiChapterPath(folderPath, role, index),
  };
}
