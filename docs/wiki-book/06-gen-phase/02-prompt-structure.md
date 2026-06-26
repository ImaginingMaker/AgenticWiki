# 6.2 Prompt 结构与模板系统

> 每个 SubAgent Prompt 的结构、模板系统、以及反馈注入机制。

---

## Prompt 结构概览

每个 Prompt 文件（`.agentic-wiki/cache/gen-prompts/<task-id>.md`）包含 8 个部分：

```
┌─ 1. 任务信息 ─────────────────────────────────┐
│   文件夹/聚簇名、角色、文件清单、预估 Token       │
├─ 2. 上下文 ────────────────────────────────────┤
│   子图依赖摘要、文件元信息                        │
├─ 3. 输出指令 ──────────────────────────────────┤
│   Wiki 页面目录、命名规范、Frontmatter 格式      │
├─ 4. Issue 检测 ───────────────────────────────┤
│   6 类问题检测标准（内联，v3 已移除模板文件）     │
├─ 6. 自检步骤（步骤 3.5）───────────────────────┤
│   ls -la 验证文件存在且非空                      │
├─ 7. 完成标记（步骤 5）─────────────────────────┤
│   写入 .gen-done 标记文件                       │
└─ 8. 反馈注入 ──────────────────────────────────┘
   全局策略 + 项目历史改进
```

## 模板系统（v3 已移除）

> ⚠️ **v3 重构后，模板外置机制已移除。** Issue 检测规则、输出格式规范、路径安全规则
> 现在直接内联在每个 SubAgent Prompt 中，无需读取外部模板文件。
> 原先由 `getIssueRulesTemplate()`、`getOutputFormatTemplate()`、`getPathSafetyTemplate()`、
> `ensureTemplates()` 生成的 `.agentic-wiki/templates/` 目录不再创建。
>
> **移除原因**：模板函数与 Prompt 构建函数内联了等价文本，模板文件从未被实际引用，
> 属于死代码。v3 清理了这 ~200 行死代码，简化了 Prompt 生成逻辑。

## 反馈注入

Runner 自动读取两层反馈策略，注入每个 SubAgent Prompt 末尾：

```
[docs/feedback/global-strategies.md]  ← 跨项目通用策略
                  +
[.agentic-wiki/feedback/prompts.md]   ← 本项目历史改进
                  ↓
每个 SubAgent Prompt 末尾的反馈注入块
```

注入点使用标记区分模式：

```markdown
<!-- AGENTICWIKI_FEEDBACK_INJECTED -->

## 🔴 历史反馈与改进策略（Runner 自动注入，必须遵守）

### 全局策略（跨项目通用）
(GEN-001: SubAgent "只说不写"问题...)
(GEN-002: Issue 文件命名规范...)

### 项目策略（本项目专属）
(从上一次运行积累的改进记录...)
```

---

> **上一篇**: [6.1 调度方案](01-scheduling.md) | **下一篇**: [6.3 Agent 工作流](03-agent-workflow.md)
