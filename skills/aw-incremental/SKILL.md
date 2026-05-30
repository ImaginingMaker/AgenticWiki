# aw-incremental — 增量分析引擎

> 基于 Git diff 和依赖传播，计算受影响的文件和文件夹

## 触发条件

- 用户说"增量分析"、"只分析变更"
- 用户指定 `--since` 参数（如 `--since HEAD~1`）
- `aw-orchestrator` 检测到 `config.mode = incremental`

---

## 你的任务

1. 获取 Git diff 变更文件列表
2. 基于依赖图计算受影响范围（依赖传播）
3. 按文件夹分组受影响文件
4. 输出增量分析结果

---

## 执行步骤

### Step 1: 获取 Git diff + 依赖传播（🔧 脚本，一步完成）

使用 `terminal` 工具运行增强版命令：

```bash
npx tsx src/lib/git-diff.ts \
  --since HEAD~1 \
  --repo <项目路径> \
  --output .agentic-wiki/cache/incremental-analysis.json \
  --deps .agentic-wiki/cache/dependency-graph.json \
  --issues-path <项目路径>/wiki/volume-2-issues/
```

**参数说明**：
- `--since`: 起始 commit（默认 `HEAD~1`）
- `--repo`: Git 仓库路径（默认当前目录）
- `--output`: 输出文件路径
- `--deps`: 依赖图路径（提供后自动计算传播范围）
- `--issues-path` 🆕: Issue 目录路径（提供后自动反向查询受影响 Issue）

**脚本功能**（一步完成，无需编排器手动计算）：
- 使用 `simple-git` 获取 diff
- 解析变更文件列表（modified/added/deleted）
- 基于依赖图自动传播：将依赖于变更文件的模块也标记为受影响
- 按文件夹分组受影响/未受影响文件
- 🆕 反向查询 Issue：扫描 `source_files` frontmatter，匹配受影响的 Issue

**输出示例**：
```json
{
  "since": "HEAD~1",
  "sinceCommit": "abc1234",
  "currentCommit": "def5678",
  "changedFiles": [
    { "path": "src/App.tsx", "status": "modified" },
    { "path": "src/utils/helper.ts", "status": "modified" }
  ],
  "affectedFiles": [
    { "path": "src/App.tsx", "reason": "Directly modified" },
    { "path": "src/utils/helper.ts", "reason": "Directly modified" },
    { "path": "src/pages/Home.tsx", "reason": "Depends on changed file" }
  ],
  "affectedFolders": [
    { "path": "src/", "reason": "Directly modified", "files": ["src/App.tsx"] },
    { "path": "src/utils/", "reason": "Directly modified", "files": ["src/utils/helper.ts"] },
    { "path": "src/pages/", "reason": "Depends on changed file", "files": ["src/pages/Home.tsx"] }
  ],
  "unaffectedFolders": [
    { "path": "src/hooks/", "reason": "No propagation from changes" }
  ],
  "analysisScope": {
    "totalFolders": 12,
    "affectedFolders": 3,
    "unaffectedFolders": 9,
    "reductionRatio": "75%"
  },
  "affectedIssues": [
    {
      "id": "IS-2026-003",
      "path": "volume-2-issues/ch-03-missing-types/IS-2026-003.md",
      "type": "missing_types",
      "severity": "high",
      "reason": "1 source file(s) modified",
      "action": "recheck",
      "matchedSourceFiles": ["src/utils/helper.ts"]
    }
  ]
}
```

**自检**：运行后用 `read_file` 读取 `incremental-analysis.json`，确认文件存在且包含 `changedFiles` 数组。

---

### Step 2: 更新状态

使用 `edit_file` 工具更新 `state.json`：

```json
{
  "phaseHistory": [
    {
      "phase": "INCREMENTAL",
      "status": "completed",
      "startedAt": "<时间戳>",
      "completedAt": "<时间戳>",
      "output": ".agentic-wiki/cache/incremental-analysis.json",
      "artifacts": [
        ".agentic-wiki/cache/incremental-analysis.json"
      ]
    }
  ],
  "currentPhase": "GEN",
  "config": {
    "mode": "incremental",
    "since": "HEAD~1"
  }
}
```

---

## 输出产物

| 文件 | 说明 |
|------|------|
| `.agentic-wiki/cache/incremental-analysis.json` | 增量分析结果（含传播 + 范围） |

---

## 决策输出

增量分析完成后，向用户展示：

```
✅ 增量分析完成

变更范围：
- 起始: HEAD~1 (abc1234)
- 当前: HEAD (def5678)
- 直接变更: 2 个文件

传播分析：
- 直接受影响: 2 个
- 依赖传播: 1 个
- 总计: 3 个文件，3 个文件夹

优化效果：
- 全量分析: 12 个文件夹
- 增量分析: 3 个文件夹
- 减少: 75% 分析量

是否继续分析受影响的文件夹？
```

---

## 增量模式 vs 全量模式

| 维度 | 全量模式 | 增量模式 |
|------|---------|---------|
| 触发 | 首次分析 | 后续分析 |
| 分析范围 | 所有文件夹 | 受影响文件夹 |
| SCAN 阶段 | 扫描所有文件 | 只扫描受影响文件夹 |
| GEN 阶段 | 生成所有 Wiki | 只更新受影响 Wiki |
| ASSEMBLE 阶段 | 全量组装 | 组装（只更新变化部分） |
| VALIDATE 阶段 | 验证所有 Wiki | 验证所有 Wiki（确保一致性） |

---

## 下一步

增量分析完成后：
- 调用 `aw-scan`（只扫描 `affectedFolders` 中的文件夹）
- 调用 `aw-generate`（只生成受影响文件夹的 Wiki）
- 🆕 对 `affectedIssues` 运行 `validate-issue-content.ts --only <ids>`（只重检受影响的 Issue）
- 调用 `aw-validate`（验证所有 Wiki 确保一致性）
