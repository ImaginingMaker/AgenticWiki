# 11.10 状态-磁盘一致性检查

> 检测 state.json 标记 completed 但磁盘产物缺失的不一致状态。

---

## 背景

流水线可能因各种原因进入"死胡同"状态：

| 场景 | 后果 |
|:---|:---|
| SubAgent 声明完成但未写文件 | state.json 中 genTask 标记为 completed，但磁盘上无产物 |
| 手动修改了 state.json（如 `--force` 后部分恢复） | genTasks 状态与磁盘目录不一致 |
| 磁盘被清理/回滚 | genTasks 仍标记 completed |

此时 `gen-scheduler` 认为所有任务已完成（state.json 中全是 `completed`），无法生成新的 Prompt。但产物的确缺失。

## 方案

`verify-gen-artifacts.ts` 在 `--resume` 时执行一致性检查：

```typescript
// 对每个标记为 completed 的 genTask:
// 1. 检查章节目录是否存在
// 2. 检查 .gen-done 标记是否存在
// 3. 如果两者缺失 → 状态-磁盘不一致

if (pendingCount === 0 && tasksMissing > 0) {
  console.error("❌ 检测到状态-磁盘不一致：");
  console.error("   N 个任务标记为 completed 但产物缺失。");
  console.error("   gen-scheduler 无法生成新的 prompt。");
  console.error("   → 诊断命令:");
  console.error("     ls -d wiki/volume-1-code/*/ 2>/dev/null | wc -l");
  console.error("     (对比 state.json 中 genTasks 数量)");
  console.error("   → 手动生成缺失章节或使用 --force 重置");
  process.exit(1);
}
```

## 修正方式

1. **诊断**：用 `ls -d wiki/volume-1-code/*/ | wc -l` 对比实际章节数与 genTasks 数
2. **手动修复**：对有问题的 genTask 重新 dispatch SubAgent
3. **暴力修复**：`--force` 重置整个流水线

---

> **上一篇**: [11.9 SubAgent 完成标记](09-completion-marker.md) | **下一篇**: [11.11 聚簇命名多数投票](11-cluster-naming.md)
