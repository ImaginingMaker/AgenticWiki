# 第三章 INIT 阶段：项目扫描与状态初始化

| 属性 | 值 |
|:---|:---|
| **阶段序号** | 0 |
| **自动化** | ✅ 完全自动 |
| **脚本数** | 2 |
| **关键产物** | `project-scan.json`, `file-hashes.json`, `state.json` |

---

## 3.1 背景

Runner 需要一个**目标项目的完整快照**才能开始分析。不同项目的技术栈、构建工具、包管理器各不相同，Runner 需要自适应地识别它们。

## 3.2 解决的问题

1. 目标项目是什么技术栈（React / Vue / Angular / Node）？
2. 用什么语言（TypeScript / JavaScript）？
3. 用什么构建工具（Vite / Webpack / Rollup）？
4. 包管理器是什么（npm / yarn / pnpm）？
5. 初始的文件哈希快照是什么？（供后续增量检测）
6. 项目的目录结构和文件规模如何？

## 3.3 策略设计

### 自顶向下探测

```
package.json → dependencies → 框架判断
            → devDependencies → 构建工具判断
            → 锁文件 → 包管理器判断
```

通过读取 `package.json` 逐层推断，而非硬编码配置。

### 文件系统辅助探测

| 标志性文件 | 推断结果 |
|:---|:---|
| `tsconfig.json` | TypeScript 支持 |
| `pnpm-lock.yaml` | pnpm 包管理器 |
| `yarn.lock` | yarn 包管理器 |
| `package-lock.json` | npm 包管理器 |

### 轻量内容扫描

当 `tsconfig.json` 不存在时，扫描前 2 层目录的 `.ts`/`.tsx` 文件来辅助 TypeScript 检测。

### SHA256 快照

对所有源文件计算 SHA256 哈希，作为增量检测的基线。后续增量模式通过对比哈希判断文件是否变更。

## 3.4 脚本实现

### 3.4.1 `scan-project.ts` — 技术栈识别

**流程**：

```
读 package.json
  ├→ dependencies → detectFramework()
  │    React → "react" / "next"
  │    Vue   → "vue" / "nuxt"
  │    Angular → "@angular/core"
  │    其他   → "node"
  │
  ├→ devDependencies → detectBuildTool()
  │    "vite" → vite | "webpack" → webpack
  │
  ├→ detectPackageManager()
  │    锁文件判断 → pnpm / yarn / npm
  │
  └→ checkHasTypeScript()
       tsconfig.json 存在? 或 .ts 文件存在?

结果写入 project-scan.json
```

**关键技术**：globby 递归文件扫描 → `pathExists` 检查标志文件 → 正则解析 package.json。

### 3.4.2 `compute-hashes.ts` — 文件哈希快照

**流程**：

```
globby(["**/*", "!node_modules/**", "!dist/**", "!**/.git/**"])
  → 对每个文件: crypto.createHash("sha256").update(content).digest("hex")
  → 写入 file-hashes.json
```

**关键技术**：并行 Promise 批处理哈希计算，避免大量文件时的性能瓶颈。

## 3.5 产物说明

```
cache/project-scan.json     # 技术栈信息 + 项目规模（文件数、文件夹数）
cache/file-hashes.json      # 全量文件 SHA256 哈希映射
state.json                  # 初始流水线状态（含路径配置、时间戳、ID）
```

其中 `state.json` 是整个流水线的"大脑"，后续所有阶段都会读写它：

```json
{
  "schemaVersion": 1,
  "currentPhase": "INIT",
  "phaseHistory": [{ "phase": "INIT", "status": "completed", ... }],
  "config": {
    "paths": { "projectRoot": "...", "sourceRoot": "...", ... },
    "mode": "full"
  }
}
```

---

> **上一篇**: [第二章 目录规范](02-directory-structure.md) | **下一篇**: [第四章 SCAN 阶段](04-scan-phase.md)
