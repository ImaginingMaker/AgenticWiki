# 11.8 SubAgent 产物自检

> Prompt 内置自检步骤，要求 SubAgent 验证文件写入结果。

---

## 背景

SubAgent 最典型的问题模式：**"只说不写"**（GEN-001）。SubAgent 在回复中说"已生成 Button 组件的 Wiki 页面"，但实际上从未调用 `write_file` 工具。

根因：LLM 倾向于"描述计划完成的工作"并将其混淆为"实际完成工作"。

## 方案

每个 SubAgent Prompt 中内置**步骤 3.5**：

```
### 步骤 3.5：验证产物写入（必须执行）

你已在上一步调用了 write_file 工具写入了一个或多个 Markdown 文件。

**立即执行以下验证**：
1. 对所有你刚刚写入的文件执行：
   ```
   ls -la wiki/volume-1-code/ch-<folder>/*.md
   ```
2. 确认文件存在且大小 > 0 字节
3. 如果文件缺失或大小为 0，重新调用 write_file 写入
```

**同时**，Runner 的 `--resume` 模式自动运行 `verify-gen-artifacts.ts` 做二次验证。

## 效果

| 措施 | 目的 |
|:---|:---|
| **Prompt 步骤 3.5** | 事前预防——在 SubAgent 退出前自检 |
| **verify-gen-artifacts.ts** | 事后验证——Runner 在 resume 时检查产物 |
| **.gen-done 标记** | 确认 SubAgent 完成了全部步骤 |

---

> **上一篇**: [11.7 依赖聚簇划分](07-dependency-clustering.md) | **下一篇**: [11.9 SubAgent 完成标记](09-completion-marker.md)
