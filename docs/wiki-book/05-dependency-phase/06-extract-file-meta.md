# 5.6 文件元信息提取 — `extract-file-meta.ts`

> 从文件前 4KB 提取关键元信息，SubAgent 读此摘要而非源码全文。

---

## 策略

传统方案：SubAgent 直接读取源码全文 → Token 消耗大（尤其是大型组件文件）。

优化方案：DEPENDENCY 阶段预扫描每个文件的前 4KB，用正则 + 有穷状态机提取关键信息：

```
源码全文 (2-5K tokens) → [元信息提取] → 精简摘要 (0.3-1K tokens)
                                             Token 减少 ~60%
```

**不需要完整 AST 解析**——已有 dependency-cruiser 做依赖分析。

## 提取内容

| 信息 | 正则模式 | 示例 |
|:---|:---|:---|
| **组件名** | PascalCase export / 函数名 | `Button` |
| **Props 类型** | `interface XxxProps` / `type XxxProps =` | `ButtonProps` |
| **Hook 调用** | `\buse[A-Z]\w+\s*\(` | `useState`, `useEffect` |
| **Export 列表** | `export const/function/class/default` | `Button`, `formatDate` |
| **是否 barrel 文件** | 所有有效行都是 re-export | `export * from './Button'` |
| **是否包含 JSX** | `<[A-Z]\w+...` / `</[A-Z]\w+...` | `<Button>` |
| **顶层函数** | column-0 的 function 声明 | `handleClick` |

## 实现细节

### Barrel 检测

```typescript
function checkReexportBarrel(content: string): boolean {
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("//") || t.startsWith("/*")) continue;
    if (t.startsWith("export * from")) continue;          // export * from './Button'
    if (/^export\s*\{[^}]*\}\s+from/.test(t)) continue;   // export { Button } from './Button'
    if (t === '"use client"' || t === "'use server'") continue;
    return false;  // 非 re-export 行 → 不是 barrel
  }
  return true;
}
```

### Token 估算

与 `file-priorities.ts` 保持一致的加权乘数，确保估算值在各脚本间一致。

## 价值

SubAgent 读取 `file-meta.json` 中对应文件的元信息条目（约 300-1000 tokens）代替源码全文（2K-5K tokens），**Token 减少约 60%**。

---

> **上一篇**: [5.5 子图提取](05-extract-subgraph.md) | **下一篇**: [5.7 依赖聚簇划分](07-cluster-tasks.md)
