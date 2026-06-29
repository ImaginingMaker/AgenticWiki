# 6.1 调度方案

> GEN 阶段的调度逻辑——如何决定每批处理哪些任务。

---

## 调度流程

```
state.json (genTasks: pending/completed/failed)
  + folder-strategy.json (subTasks[]) 或 task-clusters.json (clusters[])
  ↓
gen-scheduler.ts 交叉比对
  ├── 状态匹配：subTask 已有 completed genTask → skip
  ├── 失败重试：failed genTask → retry（action: "retry"）
  └── 新任务：无对应 genTask → run（action: "run"）
  ↓
按 limit/token-limit 切分批次
  ↓
输出 gen-schedule.json（含 skip[] + schedule[] + summary）
  ↓
为 schedule 中的任务生成 Prompt 文件
```

## 批处理策略

### 动态批次大小（默认）

```
batchSize = Math.max(10, Math.ceil(pendingCount / 3))
```

避免"52 个任务分 11 批"的低效——分 4-5 批更合理。最少 10 个。

### Token 阈值批次（可选）

```bash
npx tsx src/runner.ts --project <path> --token-limit 300000
```

按累计 Token 数切分批次，而非按任务数量。适合 Token 分布不均的项目。

## 模式选择（自动）

| 条件 | 模式 |
|:---|:---|
| `task-clusters.json` 存在 | 聚簇模式——按 clusters[] 生成 Prompt |
| 仅 `folder-strategy.json` | 文件夹模式——按 subTasks[] 生成 Prompt |

## 动态 Token 预算

```typescript
function calcTokenBudget(estimatedTokens: number): number {
  // v3 分段公式，以 1M 模型为基准，上限 300K
  // ≤10K  → 2.5x + 8K
  // ≤50K  → 2.0x + 10K
  // >50K  → 1.5x + 15K
  return Math.min(
    estimatedTokens <= 10000 ? estimatedTokens * 2.5 + 8000
    : estimatedTokens <= 50000 ? estimatedTokens * 2.0 + 10000
    : estimatedTokens * 1.5 + 15000,
    300000
  );
}
```

## 脚本清单

| 脚本 | 职责 | 关键逻辑 |
|:---|:---|:---|
| `gen-scheduler.ts` | 调度 + Prompt 生成 | 状态交叉比对 → 构建 Prompt 内容（规则内联，无需模板文件） |
| `sync-gen-tasks.ts` | 状态同步 | 扫描 wiki 目录 → 对比 genTasks → 状态置为 completed |
| `verify-gen-artifacts.ts` | 产物自检 | 检查 `.gen-done` + 文件存在性 → 列出缺失任务 |
| `progress-dashboard.ts` | 进度面板 | 从 `state.genTasks` 构建 → 输出 PROGRESS.md |

## Prompt 目录选择性清理

`gen-scheduler.ts` 在生成新批次时，**仅清理已完成任务的 prompt 文件**，保留待处理任务的 prompt。

---

> **上一篇**: [GEN 阶段总览](index.md) | **下一篇**: [6.2 Prompt 结构与模板系统](02-prompt-structure.md)
