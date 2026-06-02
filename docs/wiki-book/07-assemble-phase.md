# 第七章 ASSEMBLE 阶段：Wiki 组装

| 属性 | 值 |
|:---|:---|
| **阶段序号** | 4 |
| **自动化** | ✅ 完全自动 |
| **脚本数** | 8 |
| **关键产物** | `book.md`, `glossary.md`, `issues.md`, `symbol-index.json` |

---

## 7.1 背景

SubAgent 生成的 Wiki 页面是**分散的**——每个文件夹独立生成。Issue 文件也可能被放在错误位置（直接放在 `volume-2-issues` 根目录而非 `ch-xx` 子目录下）。

ASSEMBLE 阶段负责将这些零散的页面组装为完整的文档体系。

## 7.2 解决的问题

1. 如何将分散的章节页面组装为带目录的书册？
2. 如何建立跨页面的符号索引（搜索基础）？
3. Issue 文件放在错误位置怎么办？
4. 如何生成 Issue 汇总仪表盘？

## 7.3 策略设计

| 步骤 | 脚本 | 职责 |
|:---|:---|:---|
| 1. 状态同步 | `sync-gen-tasks.ts` | 扫描 wiki 目录 → 更新 genTasks 状态 |
| 2. 进度面板 | `progress-dashboard.ts` | 从 `state.genTasks` 生成进度仪表盘 |
| 3. 符号索引 | `symbol-index.ts` | 扫描所有 Wiki 页面 → 提取符号 → 构建反向索引 |
| 4. Issue 修复 | `fix-issue-paths.ts` | 检测 Issue 错位 → 移动到正确章节 |
| 5. Issue 仪表盘 | `issue-dashboard.ts` | 汇总 Issue metadata → 生成 issues.md |
| 6. Issue 类型校验 | `validate-issue-types.ts` | 校验 type 白名单 + `--fix` 自动修正 |
| 7. Issue 内容校验 | `validate-issue-content.ts` | 对可量化断言做脚本验证 |
| 8. 装订成书 | `assemble-book.ts` | 全书组装 + 术语表生成 |

## 7.4 核心脚本说明

### `assemble-book.ts` — 书组装

**流程**：

```
globby 扫描 wiki/volume-1-code/**/*.md
  → gray-matter 解析 Frontmatter（title, tags, sourceFiles）
  → 提取 h1 标题
  → 按 chapter 分组
  → 提取符号（h2/h3 中的标识符）
  → 生成 book.md（含目录 + 章节 + 页码索引）
  → 生成 glossary.md（术语表）
```

**符号提取**：

```typescript
function extractSymbols(content: string): { name: string; type: string }[] {
  const hRe = /^#{2,3}\s+`?([A-Za-z_]\w*)`?/gm;
  // useAuth → type: "hook"
  // Button → type: "component"
  // formatDate → type: "function"
}
```

### `symbol-index.ts` — 符号索引

从 YAML Frontmatter、Markdown 标题、代码块三处提取：类型、Hook、函数、常量、枚举 → 建立 `symbol → wiki 页面` 反向索引。

### `fix-issue-paths.ts` — Issue 路径修正

检测两类错误：

| 错误类型 | 错误位置 | 正确位置 | 检测方式 |
|:---|:---|:---|:---|
| A 类 | `volume-2-issues/IS-*.md`（根目录） | `volume-2-issues/ch-XX-type/IS-*.md` | 扫描 volume-2-issues 根目录 |
| B 类 | `volume-1-code/ch-XX/issues/IS-*.md` | `volume-2-issues/ch-XX-type/IS-*.md` | 扫描 volume-1-code 下各章节 |

修正方式：读 Issue Frontmatter 的 `type` → 按 `TYPE_TO_CHAPTER` 映射移动到正确子目录 → 清理空目录。

### `issue-dashboard.ts` — Issue 仪表盘

支持两种 SubAgent 输出格式：

```
格式 1: YAML frontmatter
  ---
  id: IS-0001
  type: dead_code
  severity: high
  status: detected
  ---

格式 2: 内联 Markdown 表格
  | **ID** | IS-0001 |
  | **类型** | dead_code |
```

## 7.5 产物

```
wiki/volume-1-code/           # 章节文件（已就位）
wiki/volume-2-issues/         # Issue 文件（已修正路径）
wiki/book.md                  # 全书（带目录）
wiki/glossary.md              # 术语表
wiki/issues.md                # Issue 汇总仪表盘
wiki/PROGRESS.md              # 进度面板
cache/../search/symbol-index.json  # 符号索引
```

---

> **上一篇**: [第六章 GEN 阶段](../06-gen-phase/index.md) | **下一篇**: [第八章 VALIDATE 阶段](08-validate-phase.md)
