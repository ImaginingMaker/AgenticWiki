# 11.6 文件元信息提取

> SubAgent 读取文件元信息摘要代替源码全文，Token 减少 ~60%。

---

## 背景

SubAgent 的传统工作模式：接收文件列表 → `read_file` 读取每个文件的源码全文 → 分析 → 生成 Wiki。

对于大型组件文件（500+ 行），读取全文的 Token 消耗极大。而 SubAgent 实际需要的只是文件的关键信息——组件名、Props 类型、Export 列表等。

## 方案

DEPENDENCY 阶段的 `extract-file-meta.ts` 预分析每个文件的**前 4KB**：

```
源码全文 (2-5K tokens)
  → 正则扫描前 4KB（非完整 AST，不解析 HTML/JSX）
  → 精简摘要 (0.3-1K tokens)
  → 写入 file-meta.json
  → SubAgent 读此摘要代替源码全文
```

### 提取内容

| 信息 | 检测方式 |
|:---|:---|
| 组件名（PascalCase） | 匹配 export 名 + 函数名 |
| Props 类型名 | `interface XxxProps` / `type XxxProps =` |
| Hook 调用 | `\buse[A-Z]\w+\s*\(` |
| Export 列表 | `export const/function/class/interface/type/enum` |
| 是否纯 barrel 文件 | 所有有效行都是 re-export |
| 是否包含 JSX | `<[A-Z]\w+` / `</[A-Z]\w+` |

### 为什么只读 4KB？

- 足够覆盖大多数文件的 import 段 + 类型声明 + 函数签名
- 4KB 约等于 50-80 行代码，性能开销极小
- 后续如果需要完整内容，SubAgent 仍可 `read_file` 读取

### 跳过文件

- 样式文件（CSS/SCSS/LESS）——已在 SCAN 阶段过滤
- 测试文件（`.test.` / `.spec.` / `.stories.`）

## 收益

| 指标 | 优化前 | 优化后 | 改善 |
|:---|:---:|:---:|:---:|
| SubAgent 单文件 Token 消耗 | 2-5K | 0.3-1K | **-60%** |
| 全项目 Token 节省 | — | 显著 | ✅ |

---

> **上一篇**: [11.5 入口文件内联](05-entry-inlining.md) | **下一篇**: [11.7 依赖聚簇划分](07-dependency-clustering.md)
