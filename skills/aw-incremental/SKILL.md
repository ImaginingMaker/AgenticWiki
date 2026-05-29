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

### Step 1: 获取 Git diff

使用 `terminal` 工具运行：

```bash
npx tsx src/lib/git-diff.ts --since <commit> --output .agentic-wiki/cache/incremental-analysis.json
```

**参数说明**：
- `--since`: 起始 commit（默认 `HEAD~1`）
- `--output`: 输出文件路径

**脚本功能**：
- 使用 `simple-git` 获取 diff
- 解析变更文件列表
- 识别变更类型（modified/added/deleted）

**输出示例**：
```json
{
  "since": "HEAD~1",
  "sinceCommit": "abc1234",
  "currentCommit": "def5678",
  "changedFiles": [
    { "path": "src/App.tsx", "status": "modified" },
    { "path": "src/utils/helper.ts", "status": "modified" },
    { "path": "src/pages/NewPage.tsx", "status": "added" }
  ],
  "stats": {
    "modified": 2,
    "added": 1,
    "deleted": 0
  }
}
```

---

### Step 2: 计算依赖传播

使用 `read_file` 工具读取：
- `.agentic-wiki/cache/incremental-analysis.json`（变更文件）
- `.agentic-wiki/cache/dependency-graph.json`（依赖图）

然后计算受影响范围：

**传播算法**：
```
输入: changedFiles[], dependencyGraph
输出: affectedFiles[]

1. affectedSet = Set(changedFiles)
2. for each file in changedFiles:
3.   dependents = dependencyGraph.getDependents(file)  // 谁依赖了这个文件
4.   for each dependent in dependents:
5.     if dependent not in affectedSet:
6.       affectedSet.add(dependent)
7.       changedFiles.push(dependent)  // 递归传播
8. return affectedSet
```

**示例**：
```
变更文件: src/App.tsx
依赖图: 
  - src/pages/Home.tsx 依赖 src/App.tsx
  - src/components/Header.tsx 依赖 src/App.tsx

受影响文件:
  - src/App.tsx (直接变更)
  - src/pages/Home.tsx (依赖 App.tsx)
  - src/components/Header.tsx (依赖 App.tsx)
```

---

### Step 3: 按文件夹分组

将受影响文件按文件夹分组：

```json
{
  "affectedFolders": [
    {
      "path": "src/",
      "reason": "包含直接变更",
      "files": ["src/App.tsx"]
    },
    {
      "path": "src/pages/",
      "reason": "包含受影响文件",
      "files": ["src/pages/Home.tsx"]
    },
    {
      "path": "src/components/",
      "reason": "包含受影响文件",
      "files": ["src/components/Header.tsx"]
    }
  ],
  "unaffectedFolders": [
    {
      "path": "src/hooks/",
      "reason": "无变更传播"
    },
    {
      "path": "src/utils/",
      "reason": "无变更传播（helper.ts 变更但无依赖者）"
    }
  ]
}
```

---

### Step 4: 更新增量分析结果

使用 `edit_file` 工具更新 `.agentic-wiki/cache/incremental-analysis.json`：

```json
{
  "since": "HEAD~1",
  "sinceCommit": "abc1234",
  "currentCommit": "def5678",
  "changedFiles": [...],
  "affectedFiles": [
    { "path": "src/App.tsx", "reason": "直接变更" },
    { "path": "src/pages/Home.tsx", "reason": "依赖 App.tsx" },
    { "path": "src/components/Header.tsx", "reason": "依赖 App.tsx" }
  ],
  "affectedFolders": [
    { "path": "src/", "reason": "包含直接变更" },
    { "path": "src/pages/", "reason": "包含受影响文件" },
    { "path": "src/components/", "reason": "包含受影响文件" }
  ],
  "unaffectedFolders": [
    { "path": "src/hooks/", "reason": "无变更传播" }
  ],
  "analysisScope": {
    "totalFolders": 12,
    "affectedFolders": 3,
    "unaffectedFolders": 9,
    "reductionRatio": "75%"  // 减少了 75% 的分析量
  }
}
```

---

### Step 5: 更新状态

使用 `edit_file` 工具更新 `state.json`：

```json
{
  "phaseHistory": [
    {
      "phase": "INCREMENTAL",
      "status": "completed",
      "startedAt": "<时间戳>",
      "completedAt": "<时间戳>",
      "output": ".agentic-wiki/cache/incremental-analysis.json"
    }
  ],
  "currentPhase": "ANALYZE",
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
| `.agentic-wiki/cache/incremental-analysis.json` | 增量分析结果 |

---

## 决策输出

增量分析完成后，向用户展示：

```
✅ 增量分析完成

变更范围：
- 起始 commit: HEAD~1 (abc1234)
- 当前 commit: HEAD (def5678)
- 变更文件: 3 个

受影响范围：
- 直接受影响: 3 个文件
- 传播受影响: 2 个文件
- 总计: 5 个文件

文件夹影响：
- src/ (直接变更)
- src/pages/ (受影响)
- src/components/ (受影响)

优化效果：
- 全量分析: 12 个文件夹
- 增量分析: 3 个文件夹
- 减少: 75% 分析量

是否继续分析受影响的文件夹？(aw-analyze)
```

---

## 增量模式 vs 全量模式

| 维度 | 全量模式 | 增量模式 |
|------|---------|---------|
| 触发 | 首次分析 | 后续分析 |
| 分析范围 | 所有文件夹 | 受影响文件夹 |
| ANALYZE 阶段 | 分析所有文件夹 | 只分析受影响文件夹 |
| GENERATE 阶段 | 生成所有 Wiki | 只更新受影响 Wiki |
| VALIDATE 阶段 | 验证所有 Wiki | 验证所有 Wiki（确保一致性） |

---

## 下一步

增量分析完成后，调用 `aw-analyze`，但只分析 `affectedFolders` 中的文件夹。
