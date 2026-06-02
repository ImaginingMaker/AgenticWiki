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

内容为空即可。此文件用于 Runner 验证您的任务是否实际完成。
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

## 状态-磁盘一致性

`verify-gen-artifacts.ts` 同时检测一类特殊问题——状态标记为 `completed` 但整个章节目录缺失：

```
❌ 检测到状态-磁盘不一致：N 个任务标记为 completed 但产物缺失。
   gen-scheduler 无法生成新的 prompt（所有任务已完成状态）。
   → 运行以下命令诊断缺失的章节：
     ls -d wiki/volume-1-code/*/
   → 对比 state.json 中 genTasks 数量
   → 手动生成缺失章节或使用 --force 重置流水线
```

---

> **上一篇**: [11.8 SubAgent 产物自检](08-self-check.md) | **下一篇**: [11.10 状态-磁盘一致性检查](10-consistency-check.md)
