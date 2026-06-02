# 11.5 入口文件内联

> 纯 re-export 的 `index.ts`（barrel 文件）合并到相邻 subTask，不单独生成。

---

## 背景

许多项目使用 `index.ts` 作为 barrel 文件——只包含 `export * from './Button'`、`export { Dropdown } from './Dropdown'` 等 re-export 语句。

这些文件的分析价值极低（没有自己的逻辑），但会浪费一个 SubAgent 槽位 + Token 预算。

## 方案

```typescript
function isPureReexportFile(filePath: string): boolean {
  // 读取文件前 4KB
  // 对每行进行检查：
  //   空白行 / 注释 → 跳过
  //   export * from → 允许
  //   export { ... } from → 允许
  //   "use client" / "use server" → 允许
  //   其他 → return false（不是纯 barrel）
  // 所有行都通过 → return true
}
```

如果文件夹下的所有入口文件都是纯 barrel → 将入口文件合并到第一个非空角色（如 `ui-components`）的 subTask 中 → 不单独生成入口 subTask。

## 收益

- 减少无效 subTask（尤其在 `src/index.ts` 多的项目中）
- 避免 SubAgent 为 barrel 文件生成无意义的 Wiki 页面
- 节省 Token 预算

---

> **上一篇**: [11.4 动态拆分阈值](04-dynamic-split-thresholds.md) | **下一篇**: [11.6 文件元信息提取](06-file-meta-extraction.md)
