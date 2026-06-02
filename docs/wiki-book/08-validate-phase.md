# 第八章 VALIDATE 阶段：交叉引用校验

| 属性 | 值 |
|:---|:---|
| **阶段序号** | 5 |
| **自动化** | ✅ 完全自动 |
| **脚本数** | 6 |
| **关键产物** | 验证报告（JSON） |
| **关键标记** | 非关键阶段（失败不阻塞流水线） |

---

## 8.1 背景

Wiki 生成完成后，需要验证质量——确保引用有效、源码可回溯、Issue 格式正确。

## 8.2 解决的问题

| 问题 | 验证脚本 |
|:---|:---|
| Wiki 引用的目标页面是否存在？ | `validate-references.ts` |
| Wiki 引用的源文件是否存在？ | `validate-code-refs.ts` |
| 章节标题中的符号是否在源码中出现？ | `validate-code-refs.ts` |
| Issue 类型是否在白名单内？ | `validate-issue-types.ts` |
| Issue 中的可量化断言是否正确？ | `validate-issue-content.ts` |
| 所有阶段产物是否完整？ | `validate-artifacts.ts` |
| 路径配置是否正确？ | `validate-paths.ts` |

## 8.3 策略设计

### 非关键阶段标记（v2.1）

`validate-references.ts` 标记为 `critical: false`：

```typescript
// phase-definitions.ts
script("validate/validate-references.ts", ["--wiki", wikiRoot, ...], false)
//                                                                    ^^^^^
//                                                          critical: false
```

即使有 sourceFiles 缺失，也只记录警告，不阻塞流水线。

### 分层验证

```
1. 引用完整性 (file_exists)
   → Wiki 引用的源文件在磁盘上存在吗？
2. 符号一致性 (symbol_in_file)
   → Wiki 中的函数名/组件名在源文件中出现吗？
3. 依赖一致性 (dep_consistency)
   → Wiki 中的依赖关系与 dependency-graph.json 一致吗？
```

## 8.4 脚本实现

### `validate-references.ts`

- `WikiLink 正则 [[...]]` → 验证目标页面存在
- Frontmatter 必填字段校验（tags, lastUpdated, sourceFiles）
- 跳过 Issue 文件和流水线文件（PROGRESS.md, book.md, glossary.md, issues.md）

### `validate-code-refs.ts`

三项检查：

```
checkSourceFileExists(wikiPage, sourceFile, projectRoot):
  → fs.pathExists(fullPath)
  → 结果: EXISTS / NOT_FOUND

checkSymbolInFile(wikiPage, symbolName, sourceFile):
  → fs.readFile + grep 符号名
  → 结果: FOUND / NOT_FOUND

checkDepConsistency(wikiPage, deps, depGraph):
  → 比对 Wiki frontmatter 中的依赖列表 vs depGraph
  → 结果: MATCH / MISMATCH
```

### `validate-issue-types.ts`

- Issue type 必须在 6 类白名单内（circular_dependency, dead_code, missing_types, complex_logic, inconsistent_api, potential_bug）
- Issue 文件所在章节路径必须匹配 type
- `--fix` 自动将放错章节的 Issue 移动到正确位置

### `validate-issue-content.ts`

对 Issue 中的可量化断言进行脚本验证：

| 检测项 | 方法 |
|:---|:---|
| 行数（line_count） | 读取源文件，统计行数 |
| any 次数（any_count） | grep `/any` |
| 嵌套深度（nesting_depth） | 缩进分析 |
| 导出引用（export_references） | depGraph 查询 |
| 文件存在（file_exists） | pathExists |

## 8.5 产物

```
cache/reference-validation.json     # WikiLink + Frontmatter 验证
cache/code-ref-validation.json      # 源码引用 + 符号 + 依赖一致性
cache/issue-validation.json         # Issue 类型白名单 + 章节映射
cache/issue-content-validation.json # Issue 可量化断言验证
cache/artifact-validation.json      # 阶段产物完整性
```

---

> **上一篇**: [第七章 ASSEMBLE 阶段](07-assemble-phase.md) | **下一篇**: [第九章 增量模式](09-incremental-mode.md)
