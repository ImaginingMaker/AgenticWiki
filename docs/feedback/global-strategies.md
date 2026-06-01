# 全局反馈策略

> 此文件存储跨项目通用的工作流改进经验。
> `runner.ts` 的 `injectFeedbackIntoPrompts()` 在每次 GEN 阶段自动加载此文件 + 项目级 `prompts.md`，
> 合并注入到每个 SubAgent prompt 末尾。Agent 无需手动操作。
>
> **升级规则**：项目 `prompts.md` 中的策略如果与具体项目无关，应升级到此文件。

---

## GEN-001: SubAgent "只说不写"问题

- **问题**：SubAgent 在摘要中声称"文件已生成"，但实际未调用 `write_file` 写入文件系统。
  根因是 Agent 将"描述计划完成的工作"等同于"实际完成工作"。
- **严重度**：🔴 CRITICAL — 导致 Wiki 产物丢失，需重跑
- **改进**：
  1. SubAgent prompt 末尾必须追加：
     ```
     ## ⚠️ 你必须使用 write_file 工具实际写入文件。描述计划不等于完成。
     ```
  2. `runner.ts` 在 `--resume` 时自动运行 `verify-gen-artifacts.ts` 检测产物缺失
- **执行者**：runner.ts（自动注入 prompt + 自动验证产物）
- **来源**：mini-longfor-online (2026-05-30)

---

## GEN-002: Issue 文件命名规范

- **问题**：SubAgent 生成的 Issue 文件名格式不统一（`IS-01-xxx.md` vs `IS-001-xxx.md` vs `IS-xxx.md`），
  导致 `issue-dashboard.ts` 和 `validate-issue-types.ts` 无法正确解析。
- **严重度**：🟡 WARNING — Issue 仪表盘数据丢失，但不影响 Wiki 正文
- **改进**：SubAgent prompt 中明确指定 Issue 文件命名格式：
  ```
  Issue 文件命名：`IS-{NNN}-{SEVERITY}-{slug}.md`
  - NNN: 3 位数字编号（001, 002, ...），按发现顺序递增
  - SEVERITY: CRITICAL | WARNING | INFO
  - slug: kebab-case 简短描述
  示例: IS-001-CRITICAL-null-safety.md
  ```
- **执行者**：`gen-scheduler.ts` 的 `buildSubTaskPrompt()` 内联了 Issue 模板，统一格式
- **来源**：mini-longfor-online (2026-05-30)

---

## GEN-003: genTask ID 必须与 subTask ID 对齐

- **问题**：编排器手动创建的 `genTask.id`（如 `"utils"`）与 `folder-strategy.json` 中
  `subTask.id`（如 `"utils-entry"`）不一致，导致 `progress-dashboard.ts` 交叉比对失败，
  `wiki/PROGRESS.md` 始终显示 0%。
- **严重度**：🟡 WARNING — 进度仪表盘失效，但不阻塞流水线
- **改进**：
  1. `gen-scheduler.ts` 带 `--write-state` 运行时，自动从 `folder-strategy.json` 的 `subTask.id` 生成 `genTask.id`
  2. 由 `id-utils.ts` 的 `generateSubTaskId(folderPath, role)` 统一生成
  3. `runner.ts` 已移除手工拼接 genTask ID 的路径（全部由 `gen-scheduler.ts` 自动化）
- **执行者**：runner.ts → gen-scheduler.ts（全自动）
- **来源**：mini-longfor-online (2026-05-30)

---

## SCRIPT-001: 脚本字段名与类型定义一致性

- **问题**：`WikiState` 类型定义使用 `projectPath`，但 `state.json` 实际字段为 `projectRoot`，
  导致 `state.projectPath === undefined`，下游脚本崩溃。
- **严重度**：🔴 CRITICAL — `progress-dashboard.ts` 崩溃，阻塞 ASSEMBLE
- **改进**：
  1. 脚本侧添加防御性回退（临时修复）：
     ```typescript
     const projectPath = state.projectPath || (state as any).projectRoot || "";
     ```
  2. `state-manager.ts` 初始化时统一使用 `projectPath` 字段名（长期修复）
  3. 所有读取 `state.json` 的脚本统一使用 `state-manager.ts read` 而非直接 `fs.readJson`
- **执行者**：脚本层（防御性代码） + state-manager（长期统一）
- **来源**：mini-longfor-online (2026-05-30)
- **状态**：✅ 临时修复已应用，长期修复待 state-manager 统一

---

## RUNNER-001: `--resume` 在 GEN 阶段死循环

- **问题**：`runner.ts --resume` 在 GEN 阶段标记为 `in_progress` 时，重新运行 `gen-scheduler.ts`
  并再次暂停，导致 Agent 永远无法进入 ASSEMBLE 阶段。
- **严重度**：🔴 CRITICAL — 流水线卡死
- **改进**：`runner.ts` 在 `--resume` 时检测 GEN 阶段 `phaseHistory` 中状态为 `in_progress`，
  自动跳过 `gen-scheduler`，运行 `verify-gen-artifacts.ts` 验证产物后直接进入 ASSEMBLE
- **执行者**：runner.ts（已修复，2026-06-01）
- **来源**：AgenticWiki 重构

---

## RUNNER-002: 反馈链路自动化

- **问题**：旧架构中，Agent 需手工读取 `global-strategies.md` + `prompts.md` 并手动拼接到
  SubAgent prompt 中，常被遗漏导致历史改进策略未生效。
- **严重度**：🟡 WARNING — 反馈循环断裂，同类错误重复出现
- **改进**：
  1. `runner.ts` 的 `injectFeedbackIntoPrompts()` 在 GEN 阶段自动加载两层策略并注入
  2. `runner.ts` 的 `recordFailure()` 在阶段失败时自动追加到 `prompts.md`
  3. `ensureFeedbackSeed()` 在首次 INIT 时自动创建种子 `prompts.md`
- **执行者**：runner.ts（全自动，2026-06-01）
- **来源**：AgenticWiki 重构

---

## 维护规则

### 何时创建项目级策略
- 策略与特定项目的技术栈、目录结构、业务逻辑强相关
- 例如："xx 项目的 API 层使用双重请求封装，需特殊处理"

### 何时升级为全局策略
- 策略描述的是 AgenticWiki 工作流本身的通用问题（不依赖任何项目特性）
- 策略在 2+ 个项目中间接复现
- 升级后从项目 `prompts.md` 中移除，添加到此处

### 反馈链路（自动）

```
runner.ts GEN 阶段
  → injectFeedbackIntoPrompts()
    → 读取 global-strategies.md（本文件）
    → 读取 .agentic-wiki/feedback/prompts.md（项目级）
    → 合并注入每个 SubAgent prompt 末尾
  → SubAgent 执行时自动应用历史改进策略

runner.ts 失败时
  → recordFailure()
    → state-manager.ts append-feedback
    → 追加到 prompts.md
    → 下次 GEN 自动加载
```
