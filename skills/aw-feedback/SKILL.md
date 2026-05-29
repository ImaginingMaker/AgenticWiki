# aw-feedback — 反馈循环

> 收集验证阶段发现的问题，生成改进策略，沉淀到反馈文档

## 触发条件

- `aw-validate` 验证失败
- 用户说"记录反馈"、"改进策略"
- `aw-orchestrator` 检测到需要回退

---

## 你的任务

1. 收集验证阶段发现的问题
2. 分析问题根因
3. 生成改进策略
4. 沉淀到 `feedback/prompts.md`
5. 决定是否回退到某个阶段

---

## 执行步骤

### Step 1: 读取验证报告

使用 `read_file` 工具读取 `.agentic-wiki/cache/validation-report.json`。

---

### Step 2: 分析问题根因

对每个验证错误，分析根因：

| 问题类型 | 可能根因 | 影响技能 |
|---------|---------|---------|
| Wiki 内容与代码不一致 | GEN SubAgent 分析逻辑错误 | aw-generate |
| 依赖关系错误 | 依赖图构建错误 | aw-dependency |
| 链接失效 | Wiki 生成时引用不存在页面 | aw-generate |
| 函数/组件不存在 | 代码已删除但 Wiki 未更新 | aw-generate |
| Props 不一致 | AST 解析错误或类型提取错误 | aw-generate |

---

### Step 3: 生成改进策略

为每个问题生成改进策略：

**示例**：

```markdown
## 2026-05-29: 循环依赖检测改进

**触发**: VALIDATE 阶段发现 Wiki 中的依赖关系与实际不一致
**问题**: Wiki 显示 A → B，但实际代码中 A 不依赖 B
**根因**: aw-dependency 未检测间接循环依赖，导致依赖图不完整
**改进**: 在构建依赖图时增加传递性分析，深度 ≥ 3
**影响技能**: aw-dependency
**回退阶段**: DEPENDENCY
```

---

### Step 4: 沉淀到反馈文档

使用 `edit_file` 工具追加到 `.agentic-wiki/feedback/prompts.md`：

```markdown
# 反馈积累与策略改进

## 2026-05-29: 循环依赖检测改进

**触发**: VALIDATE 阶段发现 Wiki 中的依赖关系与实际不一致
**问题**: Wiki 显示 A → B，但实际代码中 A 不依赖 B
**根因**: aw-dependency 未检测间接循环依赖，导致依赖图不完整
**改进**: 在构建依赖图时增加传递性分析，深度 ≥ 3
**影响技能**: aw-dependency
**回退阶段**: DEPENDENCY

---

## 2026-05-28: 样式文件过滤优化

**触发**: VALIDATE 阶段发现 Wiki 包含了纯样式文件的描述
**问题**: Button.styled.ts 被分析为逻辑文件，但实际只包含样式定义
**根因**: aw-scan 未识别 styled-components 定义的样式
**改进**: 在过滤逻辑中增加 styled-components 识别规则
**影响技能**: aw-scan
**回退阶段**: SCAN
```

---

### Step 5: 决定回退阶段

根据问题类型决定回退到哪个阶段：

| 问题类型 | 回退阶段 | 说明 |
|---------|---------|------|
| Wiki 内容与代码不一致 | GEN | 重新生成该 Wiki |
| 生成逻辑错误 | GEN | 重新分析该文件夹并生成 Wiki |
| 依赖图错误 | DEPENDENCY | 重新构建依赖图 |
| 文件遗漏 | SCAN | 重新扫描 |
| 初始化错误 | INIT | 重新初始化 |

---

### Step 6: 更新状态

使用 `edit_file` 工具更新 `state.json`：

```json
{
  "phaseHistory": [
    {
      "phase": "FEEDBACK",
      "status": "completed",
      "startedAt": "<时间戳>",
      "completedAt": "<时间戳>",
      "output": ".agentic-wiki/feedback/prompts.md"
    }
  ],
  "currentPhase": "<回退阶段>",
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
| `.agentic-wiki/feedback/prompts.md` | 反馈积累文档 |

---

## 反馈加载机制

`aw-orchestrator` 启动时：

1. 使用 `read_file` 工具读取 `.agentic-wiki/feedback/prompts.md`
2. 解析为结构化的改进策略列表
3. 在调度对应 Skill 的 SubAgent 时，将相关策略注入到 prompt 中

**注入示例**：

```
## 历史反馈与改进策略

### aw-dependency 改进
- 问题: 未检测间接循环依赖
- 改进: 增加传递性分析，深度 ≥ 3

请在构建依赖图时应用此改进策略。
```

---

## 反向回退流程

```
VALIDATE 失败
    │
    ├─→ FEEDBACK 分析根因
    │       │
    │       └─→ 决定回退阶段
    │               │
    │               └─→ 清理该阶段的产物
    │                       │
    │                       └─→ 重新执行该阶段
    │                               │
    │                               └─→ 注入改进策略
```

---

## 清理产物

回退到某个阶段时，需要清理该阶段及后续阶段的产物：

| 回退到 | 清理产物 |
|--------|---------|
| GEN | `wiki/volume-1-code/**/*.md`（受影响的） |
| GEN | `wiki/volume-2-issues/**/*.md`（受影响的） |
| DEPENDENCY | `cache/dependency-graph.*` |
| SCAN | `cache/file-list.json`, `cache/folder-strategy.json` |
| INIT | 整个 `.agentic-wiki/` 目录 |

---

## 用户确认

回退前，向用户确认：

```
⚠️ 验证发现问题，需要回退

问题：
- Wiki 内容与代码不一致

根因：
- aw-dependency 未检测间接循环依赖

改进策略：
- 增加传递性分析，深度 ≥ 3

回退方案：
- 回退到 DEPENDENCY 阶段
- 重新构建依赖图
- 应用改进策略

是否继续？
- 输入 "yes" 继续回退
- 输入 "no" 跳过，稍后手动处理
```

---

## 下一步

- **用户确认回退**：调用回退阶段的 Skill，注入改进策略
- **用户跳过**：任务结束，提示用户手动修复
