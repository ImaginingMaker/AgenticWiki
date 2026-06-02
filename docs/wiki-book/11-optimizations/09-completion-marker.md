# 11.9 SubAgent 完成标记

> SubAgent 写入 `.gen-done` 标记文件，Runner 据此区分完成/未完成。

---

## 背景

当 Runner 用 `--resume` 恢复时，需要知道哪些 SubAgent 任务已经完成。仅仅检查 `state.json` 中的 genTasks 状态不可靠——SubAgent 可能只执行了 Prompt 的一部分步骤，但 genTasks 已经标记为 `completed`。

## 方案

SubAgent Prompts 的**步骤 5**要求：

```
### 步骤 5：标记完成

完成所有写入后，在您写入的章节目录下创建一个完成标记文件：
  write_file <wiki-chapter-directory>/.gen-done

内容格式：
  generated_at: <当前时间戳>
  subagent: completed
```

Runner 在 `--resume` 时：

```typescript
// verify-gen-artifacts.ts
for (const task of genTasks) {
  if (task.status === "completed") {
    const wikiDir = getTaskWikiDir(task);
    if (!fs.existsSync(path.join(wikiDir, ".gen-done"))) {
      // 标记为 completed 但磁盘没有 .gen-done → 未完成
      report.missing.push(task.id);
    }
  }
}
```

## 格式校验

从 v2.2 开始，`.gen-done` 文件不再是"内容为空即可"。`verify-gen-artifacts.ts` 会校验内容格式：

```typescript
const content = fs.readFileSync(".gen-done", "utf-8");
const lines = content.trim().split("\n");
const hasCompleted = lines.some(l => l.startsWith("subagent: completed"));
const hasTimestamp = lines.some(l => l.startsWith("generated_at:"));

if (!hasCompleted || !hasTimestamp) {
  // 标记为无效，触发自动重置
  task.status = "pending";
}
```

## 状态-磁盘一致性

`verify-gen-artifacts.ts` 检测到状态-磁盘不一致时，**不再阻断流水线**，而是自动执行重置逻辑：

```
状态: completed × 磁盘: 无目录
  → retryCount < 3: 自动重置为 pending，重新调度
  → retryCount ≥ 3: 标记为 failed，跳过该任务
```

详见 [11.10 状态-磁盘一致性检查](10-consistency-check.md)。

---

> **上一篇**: [11.8 SubAgent 产物自检](08-self-check.md) | **下一篇**: [11.10 状态-磁盘一致性检查](10-consistency-check.md)
