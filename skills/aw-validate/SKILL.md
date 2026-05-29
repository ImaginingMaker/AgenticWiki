# aw-validate — Wiki 验证

> 验证 Wiki 准确性，检测过时内容和缺失引用

## 触发条件

- `aw-generate` 完成后
- 用户说"验证 Wiki"、"检查 Wiki"
- `aw-orchestrator` 调度 VALIDATE 阶段

---

## 你的任务

1. 验证 Wiki 中的代码引用是否存在
2. 验证依赖关系是否与实际一致
3. 验证交叉引用链接是否有效
4. 验证 Frontmatter 完整性
5. 输出验证报告

---

## 执行步骤

### Step 1: 读取所有 Wiki 页面

使用 `find_path` 工具查找所有 Wiki 文件：

```bash
wiki/**/*.md
```

然后使用 `read_file` 工具逐个读取。

---

### Step 2: 验证代码引用

**验证规则**：

| 检查项 | 说明 | 严重性 |
|--------|------|--------|
| 文件是否存在 | Wiki 中提到的源文件是否存在 | error |
| 函数/组件是否存在 | Wiki 中描述的函数/组件是否在代码中 | error |
| Props 是否一致 | Wiki 中的 Props 是否与代码一致 | warning |

**验证方式**：

1. 从 Wiki 中提取源文件路径（frontmatter 的 `sourceFiles`）
2. 使用 `read_file` 工具读取源文件
3. 使用 `terminal` 工具运行 AST 解析：
   ```bash
   npx tsx src/lib/parse-ast.ts --file <文件路径>
   ```
4. 对比 Wiki 描述与 AST 结果

---

### Step 3: 验证依赖关系

**验证规则**：

| 检查项 | 说明 | 严重性 |
|--------|------|--------|
| 依赖是否存在 | Wiki 中的依赖是否在依赖图中 | error |
| 循环依赖是否修复 | Issue 中的循环依赖是否已修复 | info |

**验证方式**：

1. 从 Wiki 中提取 Mermaid 依赖图
2. 使用 `read_file` 工具读取 `dependency-graph.json`
3. 对比 Wiki 中的依赖与实际依赖

---

### Step 4: 验证交叉引用

**验证规则**：

| 检查项 | 说明 | 严重性 |
|--------|------|--------|
| 链接是否有效 | `[[页面名]]` 链接是否指向存在的 Wiki | warning |
| 双向引用 | A 引用 B，B 是否也引用 A | info |

**验证方式**：

使用 `terminal` 工具运行：

```bash
npx tsx src/lib/validate-references.ts --wiki-path wiki/
```

**脚本功能**：
- 解析所有 Wiki 中的 `[[链接]]`
- 检查链接目标是否存在
- 检查双向引用

---

### Step 5: 验证 Frontmatter

**验证规则**：

| 字段 | 必需 | 说明 |
|------|------|------|
| `tags` | 是 | 标签列表 |
| `lastUpdated` | 是 | 最后更新日期 |
| `sourceFiles` | 是 | 源文件列表 |
| `analysisVersion` | 是 | 分析版本 |

**验证方式**：

使用 `gray-matter` 解析 frontmatter，检查必需字段。

---

### Step 6: 生成验证报告

使用 `write_file` 工具创建 `.agentic-wiki/cache/validation-report.json`：

```json
{
  "validatedAt": "2026-05-29T11:00:00Z",
  "totalPages": 15,
  "issues": [
    {
      "id": "V-001",
      "type": "broken_link",
      "severity": "warning",
      "file": "wiki/src-components.md",
      "location": "## 相关页面 章节",
      "message": "链接 [[src/pages/NotFound]] 指向不存在的 Wiki 页面",
      "suggestion": "创建 src/pages/NotFound 页面或移除该链接"
    },
    {
      "id": "V-002",
      "type": "outdated_content",
      "severity": "error",
      "file": "wiki/src-utils.md",
      "location": "## 函数列表 章节",
      "message": "函数 formatDate 已被移除，但 Wiki 仍在引用",
      "suggestion": "从 Wiki 中移除该函数的描述"
    }
  ],
  "summary": {
    "errors": 1,
    "warnings": 1,
    "passed": 13
  }
}
```

---

### Step 7: 更新状态

使用 `edit_file` 工具更新 `state.json`：

**如果验证通过**（errors = 0）：

```json
{
  "phaseHistory": [
    {
      "phase": "VALIDATE",
      "status": "completed",
      "startedAt": "<时间戳>",
      "completedAt": "<时间戳>",
      "output": ".agentic-wiki/cache/validation-report.json"
    }
  ],
  "currentPhase": "DONE"
}
```

**如果验证失败**（errors > 0）：

```json
{
  "phaseHistory": [
    {
      "phase": "VALIDATE",
      "status": "failed",
      "startedAt": "<时间戳>",
      "error": "发现 1 个错误，1 个警告"
    }
  ],
  "currentPhase": "FEEDBACK",
  "blockers": [
    {
      "phase": "VALIDATE",
      "message": "Wiki 内容与代码不一致",
      "timestamp": "<时间戳>",
      "resolved": false
    }
  ]
}
```

---

## 输出产物

| 文件 | 说明 |
|------|------|
| `.agentic-wiki/cache/validation-report.json` | 验证报告 |

---

## 验证结果处理

### 验证通过

向用户展示：

```
✅ Wiki 验证通过

验证结果：
- 总页面数: 15
- 错误: 0
- 警告: 1
- 通过: 14

Wiki 已生成完成！
- 索引: wiki/index.md
- 总页面: 15 个
```

### 验证失败

向用户展示：

```
⚠️ Wiki 验证发现问题

验证结果：
- 总页面数: 15
- 错误: 1
- 警告: 1
- 通过: 13

错误详情：
- [V-002] wiki/src-utils.md
  函数 formatDate 已被移除，但 Wiki 仍在引用
  建议: 从 Wiki 中移除该函数的描述

是否需要修复这些问题？
- 输入 "fix" 自动修复
- 输入 "skip" 跳过，稍后手动修复
```

---

## 下一步

- **验证通过**：任务完成，输出 Wiki 路径
- **验证失败**：调用 `aw-feedback` 记录问题，决定是否回退
