# 11.3 Token 阈值批次

> 按 Token 总数切分批次，替代按任务数切分。

---

## 背景

`--limit N` 按任务数量切分批次。例如 100 个任务分 10 批，每批 10 个。但如果 10 个任务中包含一个巨型文件夹（5 个组件 + 3 个 Hook + 工具函数）和 9 个小文件，该批次的 Token 消耗极不均匀。

## 方案

```bash
npx tsx src/runner.ts --project <path> --token-limit 300000
```

按累计 Token 数切分：每批不超过 300K Token，而非不超过 10 个任务。

## 对比

| 方式 | 切分依据 | 适用场景 |
|:---|:---|:---|
| `--limit N` | 任务数量 | 任务规模均匀 |
| `--token-limit N` | Token 总和 | 任务规模分布不均 |

两者互斥，后指定的参数生效。

---

> **上一篇**: [11.2 动态 Token 预算](02-dynamic-token-budget.md) | **下一篇**: [11.4 动态拆分阈值](04-dynamic-split-thresholds.md)
