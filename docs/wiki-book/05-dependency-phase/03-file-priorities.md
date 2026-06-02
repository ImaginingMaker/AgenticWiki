# 5.3 优先级分配 — `file-priorities.ts`

> 按 5 级优先级（P0-P4）对每个文件分类，并估算 Token 消耗。

---

## 策略

### P0-P4 优先级系统

| 优先级 | 含义 | 识别规则 |
|:---|:---|:---|
| **P0** | 入口/核心 | `index.ts` / `main.ts` / `app.ts` + 被依赖数 ≥ 10 |
| **P1** | 业务逻辑 | 含 JSX / React 组件 + React Hook + 被依赖数 ≥ 5 |
| **P2** | 工具函数 | 默认分类，无特殊模式匹配 |
| **P3** | 测试/故事 | `.test.` / `.spec.` / `.stories.` 模式 |
| **P4** | 纯样式 | `.css` / `.scss` / `.less` 等扩展名 |

### 文件级 Token 估算

替代旧的固定 `lineCount × 1.5`，使用文件类型感知的**加权乘数**：

| 文件类型 | 乘数 | 依据 |
|:---|:---:|:---|
| `.d.ts` 纯类型声明 | ×1.0 | 类型定义不含逻辑，Token 密度低 |
| CSS / SCSS / LESS | ×1.2 | 选择器/属性格式紧凑 |
| `.tsx` / `.jsx`（含 JSX） | ×2.5 | JSX 标签密集，Token 消耗高 |
| 其他 TypeScript | ×1.5 | 普通逻辑含类型注解 |

### 文件内容检测

- **JSX 检测**: 用正则 `<[A-Z]\w+|<\w+\s+...` 匹配文件前 4KB
- **React Hook 检测**: 用 `\buse[A-Z]\w+\s*\(` 匹配 Hook 调用
- **被依赖计数**: 从 `dependency-graph.json` 的 `dependents` 数组获取

### 分组逻辑

按父文件夹分组，每组内按 `P0 → P1 → P2 → P3 → P4` 排序，相同优先级按被依赖数降序。

## 产物

```json
// file-priorities.json
{
  "folders": {
    "src/components": {
      "folder": "src/components",
      "totalTokens": 45800,
      "files": [
        { "path": "src/components/Button.tsx", "priority": "P0", "estimatedTokens": 3200, "dependentCount": 12, "reason": "entry file (naming pattern)" },
        { "path": "src/components/Dropdown.tsx", "priority": "P1", "estimatedTokens": 5800, "dependentCount": 3, "reason": "contains JSX + contains hooks" }
      ]
    }
  }
}
```

---

> **上一篇**: [5.2 文件哈希](02-compute-hashes.md) | **下一篇**: [5.4 文件夹拆分策略](04-analyze-folders.md)
