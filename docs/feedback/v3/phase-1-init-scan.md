# Phase 1: INIT + SCAN 阶段重构

> 涉及脚本：`scan-project.ts` · `scan-files.ts` · `filter-styles.ts` · `compute-hashes.ts` · `setup.ts`
> 依赖关系：无前置依赖，可最先开始

---

## 1. 问题清单

### 1.1 scan-project.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| S1-1 | 🔴 | `sourcePath` 硬编码为 `src/`，忽略 `--source` 参数。`ProjectScanResult.sourcePath` 始终为 `projectPath + "/src"`，与实际 `sourceRoot` 不一致 | L179 |
| S1-2 | 🟡 | `checkHasTypeScript` 的 globby 模式 `"**/*.ts"` 不匹配 `.tsx`，但 filter 里检查了 `.tsx` — 后半条件永远为 false | L88-97 |
| S1-3 | 🟡 | `detectFramework` 只检查 `dependencies`，遗漏 `devDependencies` 中的框架（如组件库项目的 `next`/`vue`） | L11 |
| S1-4 | 🟡 | `countSourceFiles` + 后续 globby 两次扫描文件系统，重复 I/O | L103-161 |
| S1-5 | 🟢 | 框架检测缺少 Svelte/SvelteKit、Remix、Astro、Solid | 全局 |
| S1-6 | 🟢 | 路径分隔符 `dir.split("/")` 硬编码，Windows 不兼容 | L168 |

### 1.2 scan-files.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| S2-1 | 🟡 | `ASSET_DIRS` 可能误杀 `src/assets/constants.ts` 等代码文件，缺少白名单机制 | 常量定义 |
| S2-2 | 🟡 | `sourcePath` 存在性未校验，路径不存在时 globby 静默返回空数组 | `scanFiles()` 入口 |
| S2-3 | 🟢 | 扩展名列表不可配置，缺少 `.mjs`/`.cjs`/`.mts` 支持 | `SOURCE_EXTENSIONS` |
| S2-4 | 🟢 | `byExtension` 只统计已知扩展名，globby 返回意外扩展名的文件不计入 | 统计逻辑 |

### 1.3 filter-styles.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| S3-1 | 🔴 | **死代码**：`isStyleExtension` 过滤纯样式文件（.css/.scss），但上游 `scan-files.ts` 的 `SOURCE_EXTENSIONS` 已排除这些扩展名。`fileList.files` 中永远不会出现纯样式文件，该过滤分支永远不会命中 | 全局 |
| S3-2 | 🟡 | `totalFiles` 直接复用输入值不校验，`remainingCount` 用减法而非 `remainingFiles.length` 计算，可能不一致 | L69 |
| S3-3 | 🟢 | `async` 声明但无异步操作 | 函数签名 |
| S3-4 | 🟢 | CSS-in-JS 检测仅靠文件名模式（`.styled.`/`.styles.`），不检查文件内容 | 检测逻辑 |

### 1.4 compute-hashes.ts

| # | 严重度 | 问题 | 位置 |
|---|:---:|------|------|
| S4-1 | 🔴 | **无限并发读取文件**：`Promise.all(files.map(...))` 在大项目中同时打开数千个文件描述符，可能触发 `EMFILE` 错误 | L30-37 |
| S4-2 | 🟢 | 未过滤 `node_modules`、`.git` 等目录，大项目中浪费 I/O | globby 模式 |

---

## 2. 重构方案

### 2.1 scan-project.ts — 修复 sourcePath + 合并扫描

**改动 1**：`sourcePath` 从参数传入而非硬编码

```typescript
// 新增 CLI 参数
.option("source", {
  type: "string",
  description: "Source root override (default: src/)",
})

// scanProject() 签名变更
export async function scanProject(
  projectPath: string,
  sourceOverride?: string,
): Promise<ProjectScanResult> {
  const sourcePath = sourceOverride
    ? path.resolve(projectPath, sourceOverride)
    : path.join(projectPath, "src");
  // ...
  return { ...result, sourcePath };
}
```

**改动 2**：`detectFramework` 同时检查 `dependencies` + `devDependencies`

```typescript
function detectFramework(pkg: Record<string, unknown>): string {
  const allDeps = {
    ...(pkg.dependencies as Record<string, string> || {}),
    ...(pkg.devDependencies as Record<string, string> || {}),
  };
  if (allDeps["next"]) return "next";
  if (allDeps["@angular/core"]) return "angular";
  // ... 补充 svelte, remix, astro, solid
}
```

**改动 3**：合并两次文件系统扫描为一次

```typescript
// 一次 globby 扫描，按扩展名分类
const allFiles = await globby(["**/*"], { cwd: sourcePath, ... });
const sourceFiles = allFiles.filter(f => SOURCE_EXTENSIONS.has(path.extname(f)));
const dirs = new Set(allFiles.map(f => path.dirname(f)));
```

**改动 4**：`checkHasTypeScript` globby 模式修正

```typescript
// 旧：["**/*.ts"]
// 新：
const tsFiles = await globby(["**/*.ts", "**/*.tsx"], { ... });
```

### 2.2 scan-files.ts — 源路径校验 + 扩展名可配置

```typescript
export async function scanFiles(
  sourcePath: string,
  extraExtensions?: string[],
): Promise<FileListResult> {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`源码目录不存在: ${sourcePath}`);
  }

  const extensions = [...SOURCE_EXTENSIONS, ...(extraExtensions || [])];
  // ...
}
```

### 2.3 filter-styles.ts — 清理死代码

方案 A（推荐）：**删除 `isStyleExtension` 分支**，仅保留 CSS-in-JS 文件名检测。

方案 B：将 filter-styles 的职责扩展为"标注文件类型"，给每个文件打 tag（logic/style/mixed），供下游使用。

```typescript
// 方案 A：精简后的 filterStyles
export function filterStyles(fileList: FileListResult): FilteredFilesResult {
  const filtered: FilteredFile[] = [];
  const remaining: string[] = [];

  for (const file of fileList.files) {
    if (isCSSInJSFile(file)) {
      filtered.push({ path: file, reason: "CSS-in-JS pattern", filterType: "style" });
    } else {
      remaining.push(file);
    }
  }

  return {
    filteredAt: new Date().toISOString(),
    totalFiles: fileList.files.length,
    files: remaining,
    filteredFiles: filtered,
    filteredCount: filtered.length,
    remainingCount: remaining.length,
  };
}
```

### 2.4 compute-hashes.ts — 并发控制

```typescript
import pLimit from "p-limit";

export async function computeHashes(sourcePath: string): Promise<FileHashes> {
  const files = await globby(["**/*"], {
    cwd: sourcePath,
    ignore: ["**/node_modules/**", "**/.git/**"],
  });

  const limit = pLimit(50); // 最多 50 并发文件读取
  const entries = await Promise.all(
    files.map(f => limit(async () => {
      const content = await fs.readFile(path.join(sourcePath, f));
      const hash = createHash("sha256").update(content).digest("hex");
      return [f, hash] as const;
    }))
  );

  return Object.fromEntries(entries);
}
```

> 注：`p-limit` 已在 globby 的依赖链中，无需额外安装。如需零依赖方案，可用自实现的信号量。

---

## 3. 受影响文件

| 文件 | 改动类型 |
|------|---------|
| `src/lib/scan/scan-project.ts` | 修改：sourcePath 参数化、detectFramework 扩展、扫描合并 |
| `src/lib/scan/scan-files.ts` | 修改：路径校验、扩展名可配置 |
| `src/lib/scan/filter-styles.ts` | 修改：清理死代码 |
| `src/lib/dependency/compute-hashes.ts` | 修改：并发控制 |
| `src/lib/pipeline/phase-definitions.ts` | 修改：INIT 阶段传 `--source` 参数 |

---

## 4. 测试要点

- [ ] `scan-project.ts`：传入 `--source packages/muya/src` 时 `sourcePath` 正确
- [ ] `scan-project.ts`：`detectFramework` 识别 `devDependencies` 中的框架
- [ ] `scan-files.ts`：`sourcePath` 不存在时抛错
- [ ] `filter-styles.ts`：上游不传入 `.css` 文件时输出正确
- [ ] `compute-hashes.ts`：5000 文件项目无 EMFILE 错误
