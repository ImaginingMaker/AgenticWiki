# 第九章 增量模式（Incremental）

> 项目持续迭代时，只更新被修改代码影响的部分。

---

## 9.1 背景

项目代码每天都在变化。每次重新全量分析 Wiki 是巨大的浪费（从头跑一遍 6 阶段 + 重新 spawn 所有 SubAgent）。

增量模式的目标：**只更新受 Git 变更影响的部分**。

## 9.2 解决的问题

1. 哪些文件被 Git 修改了？
2. 修改通过依赖传播影响到了哪些文件？
3. 哪些 Wiki 页面需要重新生成？
4. 哪些 Issue 需要重新检查？

## 9.3 策略：四步传播法

### 第一步：Git diff

```bash
git diff --name-only HEAD~1...HEAD
```

→ 获取变更文件列表（modified / added / deleted）

### 第二步：过滤源码

仅保留 `.ts` / `.tsx` / `.js` / `.jsx` 文件，排除非源码文件（`README.md`、`.gitignore` 等）和 `node_modules`。

### 第三步：BFS 依赖传播

从变更文件出发，沿 `dependents` 方向层层传播：

```
queue = [变更文件列表]
affected = Set(变更文件)

while queue 非空:
  file = queue.shift()
  dependents = getDependents(file)  // 从 dependency-graph.json 读取
  for dep in dependents:
    if dep 不在 affected:
      affected.add(dep)
      queue.push(dep)
```

**示例**：修改 `utils/format.ts` 会传播到所有使用它的组件：

```
utils/format.ts (变更)
  → src/components/Table.tsx (使用 formatDate)
     → src/pages/ReportPage.tsx (使用 Table)
        → src/App.tsx (使用 ReportPage)
```

### 第四步：标记 + 重跑

```
1. 匹配 affectedFiles 与 folderStrategy 的 subTask 文件列表
2. 找到受影响文件夹
3. 重置对应 genTasks 状态为 pending
4. 运行 gen-scheduler 为 pending 任务重新生成 Prompt
5. 暂停 → 等待 Agent spawn SubAgent
```

### Issue 反向查询（可选）

对有 `source_files` 字段的 Issue：

```typescript
function computeAffectedIssues(affectedFiles, changedFiles, issuesPath):
  for each Issue Markdown file:
    提取 frontmatter source_files
    if source_files ∩ affectedFiles 非空 → action: "recheck"
    if source_files ∩ deletedFiles 非空 → action: "stale"
    else → action: "unchanged"
```

## 9.4 脚本实现

| 函数/脚本 | 职责 | 位置 |
|:---|:---|:---|
| `getGitDiff()` | 执行 Git diff | `shared/git-diff.ts` |
| `computeAffectedScope()` | BFS 依赖传播 | `shared/git-diff.ts` |
| `computeAffectedIssues()` | Issue 反向查询 | `shared/git-diff.ts` |
| `propagateDeps()` | 在 Runner 中传播依赖 | `pipeline/gen-helpers.ts` |
| `markAffectedGenTasks()` | 重置 genTasks 状态 | `pipeline/gen-helpers.ts` |

## 9.5 边界情况

| 场景 | 行为 |
|:---|:---|
| **无变更** | `git diff` 无文件 → 直接退出 |
| **非源码变更** | 仅 `README.md` / `.gitignore` → 直接退出 |
| **底层库修改** | 修改 `utils/format.ts` → BFS 传播到大量上层文件（**预期行为**） |
| **依赖图缺失** | 增量模式需要已有全量分析结果（`dependency-graph.json`） |
| **无受影响文件夹** | 受影响文件夹的 Wiki 已全部完成 → 无需更新 |

---

> **上一篇**: [第八章 VALIDATE 阶段](08-validate-phase.md) | **下一篇**: [第十章 反馈闭环](10-feedback-loop.md)
