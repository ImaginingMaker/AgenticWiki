# 第六章 GEN 阶段：SubAgent 调度与 Prompt 生成

| 属性 | 值 |
|:---|:---|
| **阶段序号** | 3 |
| **自动化** | ⚠️ 部分（调度自动，SubAgent 手动） |
| **脚本数** | 4 |
| **关键产物** | SubAgent Prompt 文件 |

---

## 6.1 背景

这是**唯一需要 Agent 参与**的阶段。前面所有阶段全部由 Runner 自动完成。

GEN 阶段的基本流程：

```
Runner生成调度清单
  → 生成 SubAgent Prompt 文件
  → 暂停并输出指令
  → Agent 读取 Prompts → spawn SubAgent（每批多个并发）
  → SubAgent write_file 生成 Wiki 页面
  → Agent 运行 --resume（Runner 验证产物 + 生成下一批）
  → 重复直到全部完成
```

## 6.2 解决的问题

| 问题 | 方案 |
|:---|:---|
| 如何将 subTask 转换为 Prompt？ | `gen-scheduler.ts` 交叉比对状态 + 构建 Prompt 内容 |
| 每批处理多少任务？ | 动态批次 `ceil(pending/3)` 或 `--token-limit N` |
| 如何验证 SubAgent 写了文件？ | 内置 self-check + `.gen-done` 标记 + Runner 验证 |
| 如何管理 Token 预算？ | v3 分段预算（≤10K→2.5×+8K, ≤50K→2.0×+10K, >50K→1.5×+15K），上限 300K |
| 如何避免重复劳动？ | `sync-gen-tasks.ts` 同步已完成任务，跳过 |

## 6.3 子章节

- [6.1 调度方案](01-scheduling.md)
- [6.2 Prompt 结构与模板系统](02-prompt-structure.md)
- [6.3 Agent 工作流](03-agent-workflow.md)

---

> **上一篇**: [第五章 DEPENDENCY 阶段](../05-dependency-phase/index.md) | **下一篇**: [6.1 调度方案](01-scheduling.md)
