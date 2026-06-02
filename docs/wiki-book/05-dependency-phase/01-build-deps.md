# 5.1 依赖图构建 — `build-deps.ts`

> 使用 dependency-cruiser 对源码目录做全量依赖分析。

---

## 策略

采用业界成熟的 [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) 代替自研 AST 解析。Cruiser 支持 TypeScript、JSX、别名路径解析、循环依赖检测。

## 实现细节

### 外部调用

```typescript
const result = execSync(
  `${binPath} dependency-cruiser --output-type json --no-config --ts-config ${tsConfig} ${sourcePath}`,
  { encoding: "utf-8", maxBuffer, timeout }
);
```

通过 npx/直接二进制路径调用（定位到 `node_modules/.bin/dependency-cruiser`）。

### 输出转换

Cruiser 原始输出包含模块名、依赖关系、循环标记等。`transformCruiserOutput()` 将其转换为 AgenticWiki 的内部格式：

```
Cruiser 原始格式 → ModuleInfo[]
                    ├── source:      文件路径（相对化）
                    ├── dependencies: 依赖列表（含 local/external 分类）
                    ├── dependents:   反向依赖列表
                    └── hasCircular:  是否参与循环依赖
```

### 关键能力

| 能力 | 实现 |
|:---|:---|
| **TypeScript 支持** | 自动查找 `tsconfig.json`（向上 3 级目录搜索） |
| **循环依赖检测** | 解析 cruiser 的 `no-circular` 违规记录 |
| **热点分析** | 计算 Top 10 最被依赖 + Top 10 最依赖文件 |
| **大项目支持** | `--max-buffer` 和 `--timeout` 参数 |
| **Mermaid 输出** | `--format mermaid` 生成可视化图 |

### 路径相对化

依赖图中的绝对路径会被相对化到项目根目录：

```typescript
function relativize(cruiserPath: string): string {
  // absolutize → realpath → path.relative(projectRoot, file)
  // 无法解析的路径按模块名处理
}
```

## 脚本头信息

```bash
npx tsx src/lib/dependency/build-deps.ts \
  --path <sourcePath> \
  --output <jsonFile> \
  --format json|mermaid \
  --max-buffer 104857600 \
  --timeout 300000
```

---

> **上一篇**: [DEPENDENCY 阶段总览](index.md) | **下一篇**: [5.2 文件哈希](02-compute-hashes.md)
