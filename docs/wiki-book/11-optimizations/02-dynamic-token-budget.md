# 11.2 动态 Token 预算

> SubAgent Token 预算从固定 80K 改为按任务规模动态分配。

---

## 背景

所有 SubAgent 固定分配 80K Token 预算。对于只有几十行代码的小文件夹（如 `utils/format.ts` 仅 50 行），80K 预算严重浪费。对于大文件夹（如多个组件 + Hooks），80K 又可能不够。

## 方案

```typescript
function calcTokenBudget(estimatedTokens: number): number {
  // estimatedTokens: 文件夹内所有文件的估算 Token 总和
  const dynamic = Math.min(estimatedTokens * 1.5 + 5000, 80000);
  return Math.max(dynamic, 10000);
}
```

| 文件规模 | estimatedTokens | 预算 | 
|:---|---:|---:|
| 极小型（如 50 行 utils） | ~75 | **10K** |
| 小型（1 个组件 + 1 个 Hook） | ~3,000 | **9.5K** |
| 中型（几个组件） | ~10,000 | **20K** |
| 大型（文件夹 + 子文件夹） | ~50,000 | **80K** |

## 收益

| 指标 | 优化前 | 优化后 | 改善 |
|:---|:---:|:---:|:---:|
| 小文件夹 Token 预算 | 80K | ~10K | **-87%** |
| 平台总 Token 浪费 | 高 | 低 | ✅ |

---

> **上一篇**: [11.1 Prompt 模板外置](01-prompt-templates.md) | **下一篇**: [11.3 Token 阈值批次](03-token-threshold-batch.md)
