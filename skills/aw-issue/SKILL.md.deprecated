# aw-issue — Issue 管理

> 检测、验证、追踪代码中的潜在问题

## 触发条件

- `aw-dependency` 检测到循环依赖
- `aw-analyze` 检测到代码问题
- 用户说"检查 Issue"、"验证 Issue"
- 用户说"这个 Issue 修复了吗"

---

## 你的任务

1. 检测代码中的潜在问题
2. 验证 Issue 是否已修复
3. 维护 Issue 索引
4. 更新 Wiki 中的"已知问题"章节

---

## Issue 类型

| 类型 | 说明 | 检测阶段 | 严重性 |
|------|------|---------|--------|
| `circular_dependency` | 循环依赖 | DEPENDENCY | high |
| `dead_code` | 未使用的导出 | ANALYZE | medium |
| `missing_types` | 缺少类型定义 | ANALYZE | medium |
| `complex_logic` | 过于复杂的逻辑 | ANALYZE | low |
| `inconsistent_api` | API 使用不一致 | ANALYZE | medium |
| `potential_bug` | 潜在 bug | ANALYZE | high |

---

## 执行步骤

### Step 1: 检测 Issue

**循环依赖检测**（DEPENDENCY 阶段）：

使用 `read_file` 工具读取 `dependency-graph.json`，检查 `cycles` 字段。

**代码问题检测**（ANALYZE 阶段）：

使用 `read_file` 工具读取 `analysis/*.json`，检查：
- 缺少类型定义的函数
- 复杂度过高的函数（圈复杂度 > 10）
- 未使用的导出

---

### Step 2: 创建 Issue

使用 `write_file` 工具创建 `.agentic-wiki/issues/ISSUE-{ID}.json`：

```json
{
  "id": "ISSUE-001",
  "type": "circular_dependency",
  "severity": "high",
  "status": "detected",
  "location": {
    "files": ["src/A.ts", "src/B.ts"],
    "startLine": 10,
    "description": "循环依赖: A → B → A"
  },
  "detectedAt": "2026-05-29T10:00:00Z",
  "detectedBy": "aw-dependency",
  "verifiedAt": null,
  "fixedAt": null,
  "verificationHistory": [],
  "relatedWikiPages": ["wiki/src-A.md", "wiki/src-B.md"]
}
```

---

### Step 3: 更新 Issue 索引

使用 `edit_file` 工具更新 `.agentic-wiki/issues/index.json`：

```json
{
  "lastUpdated": "2026-05-29T10:00:00Z",
  "issues": [
    {
      "id": "ISSUE-001",
      "type": "circular_dependency",
      "severity": "high",
      "status": "detected",
      "summary": "循环依赖: A → B → A",
      "files": ["src/A.ts", "src/B.ts"]
    }
  ],
  "stats": {
    "total": 3,
    "bySeverity": { "high": 1, "medium": 1, "low": 1 },
    "byStatus": { "detected": 2, "verified": 1 }
  }
}
```

---

### Step 4: 验证 Issue

**触发条件**：
- 用户说"验证 Issue"
- 用户说"这个 Issue 修复了吗"
- 定期自动验证（可选）

**验证流程**：

1. 使用 `read_file` 工具读取 Issue 文件
2. 根据 Issue 类型执行验证：
   - `circular_dependency`: 重新运行 `build-deps.js`，检查循环是否仍存在
   - `dead_code`: 检查导出是否仍未被使用
   - `missing_types`: 检查类型定义是否已添加
3. 更新 Issue 状态

**验证代码示例**：

```bash
# 验证循环依赖
npx tsx src/lib/build-deps.ts --path src/ --output /tmp/deps-check.json
# 检查 /tmp/deps-check.json 中的 cycles 字段
```

---

### Step 5: 更新 Issue 状态

**如果 Issue 已修复**：

使用 `edit_file` 工具更新 Issue 文件：

```json
{
  "status": "fixed",
  "fixedAt": "2026-05-30T10:00:00Z",
  "verificationHistory": [
    {
      "verifiedAt": "2026-05-30T10:00:00Z",
      "result": "fixed",
      "details": "循环依赖已解除"
    }
  ]
}
```

**如果 Issue 仍存在**：

```json
{
  "status": "verified",
  "verifiedAt": "2026-05-30T10:00:00Z",
  "verificationHistory": [
    {
      "verifiedAt": "2026-05-30T10:00:00Z",
      "result": "still_exists",
      "details": "循环依赖仍存在"
    }
  ]
}
```

---

### Step 6: 更新 Wiki

如果 Issue 状态变更，更新相关 Wiki 页面的"已知问题"章节：

**Issue 新增时**：

```markdown
## 已知问题

- [[ISSUE-001]] 循环依赖: A → B → A (high)
```

**Issue 修复时**：

```markdown
## 已知问题

- 无

## 历史问题

- ~~[[ISSUE-001]] 循环依赖: A → B → A~~ (已修复于 2026-05-30)
```

---

## Issue 生命周期

```
detected → verified → fixing → fixed → archived
   │          │          │         │
   │          │          │         └─ 归档（移到历史）
   │          │          └─ 用户正在修复
   │          └─ 验证确认存在
   └─ 检测到问题
```

**状态说明**：

| 状态 | 说明 |
|------|------|
| `detected` | 检测到，未验证 |
| `verified` | 已验证，确认存在 |
| `fixing` | 用户正在修复 |
| `fixed` | 已修复 |
| `archived` | 已归档 |
| `false_positive` | 验证为误报 |
| `stale` | 长期未验证 |

---

## 输出产物

| 文件 | 说明 |
|------|------|
| `.agentic-wiki/issues/ISSUE-*.json` | Issue 详情 |
| `.agentic-wiki/issues/index.json` | Issue 索引 |
| `wiki/issues/index.md` | Issue Wiki 页面（可选） |

---

## Issue Wiki 页面

可选生成 `wiki/issues/index.md`：

```markdown
# Issue 列表

## 高优先级

| ID | 类型 | 描述 | 状态 | 文件 |
|----|------|------|------|------|
| ISSUE-001 | 循环依赖 | A → B → A | detected | src/A.ts, src/B.ts |

## 中优先级

| ID | 类型 | 描述 | 状态 | 文件 |
|----|------|------|------|------|
| ISSUE-002 | 缺少类型 | helper.ts 返回值无类型 | verified | src/utils/helper.ts |

## 已修复

| ID | 类型 | 描述 | 修复日期 |
|----|------|------|---------|
| ISSUE-003 | 死代码 | unused.ts 未被使用 | 2026-05-28 |
```

---

## 与 Wiki 集成

每个 Wiki 页面的"已知问题"章节自动从 Issue 索引中提取：

```markdown
## 已知问题

本文件夹相关的 Issue：

- [[ISSUE-001]] 循环依赖 (high) — 涉及 Button.tsx
```

提取规则：
- Issue 的 `location.files` 包含该文件夹下的文件
- 或 Issue 的 `relatedWikiPages` 包含该 Wiki 页面
