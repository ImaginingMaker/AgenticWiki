# 11.2 动态 Token 预算

> SubAgent Token 预算按任务规模动态分配。v3 升级为分段公式，上限提升至 200K。

---

## 背景（v2）

所有 SubAgent 固定分配 80K Token 预算。v2 引入基础动态公式 `estimatedTokens × 1.5 + 5000`，范围 [10K, 80K]。

## v3 方案

以 1M Token 上下文窗口为基准，分段计算预算，上限提升至 200K：

```typescript
function calcTokenBudget(estimatedTokens: number): number {
  // v3 分段公式，以 1M 模型为基准，上限 200K
  if (estimatedTokens <= 10000) {
    return Math.min(estimatedTokens * 2.5 + 8000, 200000);   // 小任务：高倍数保障
  }
  if (estimatedTokens <= 50000) {
    return Math.min(estimatedTokens * 2.0 + 10000, 200000);  // 中任务：适中倍数
  }
  return Math.min(estimatedTokens * 1.5 + 15000, 200000);    // 大任务：保守增长
}
```

| 文件规模 | estimatedTokens | v2 预算 | v3 预算 |
|:---|---:|---:|---:|
| 极小型（如 50 行 utils） | ~75 | **10K** | **~10K** |
| 小型（1 个组件 + 1 个 Hook） | ~3,000 | **9.5K** | **~15.5K** |
| 中型（几个组件） | ~10,000 | **20K** | **~33K** |
| 大型（文件夹 + 子文件夹） | ~50,000 | **80K** | **~110K** |
| 超大型（多文件聚簇） | ~120,000 | **80K（不足）** | **~195K** |

## 收益

| 指标 | v1 | v2 | v3 |
|:---|:---:|:---:|:---:|
| 预算上限 | 80K | 80K | **200K** |
| 小任务预算 | 80K（浪费） | ~10K | ~10K+ |
| 大任务预算 | 80K（不足） | 80K（不足） | **110-195K** |
| 估算精度 | 固定 | 线性 | **分段自适应** |

---

> **上一篇**: [11.1 Prompt 模板外置](01-prompt-templates.md) | **下一篇**: [11.3 Token 阈值批次](03-token-threshold-batch.md)
