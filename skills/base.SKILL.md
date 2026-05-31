# base.SKILL.md — 全局共享规则

> 🔴 **所有 aw-* SKILL.md 的开头共享部分。**
> Agent 在读取任何 `skills/aw-*/SKILL.md` 前，**必须先读取此文件**加载全局规则。
> 
> 这些规则之前重复在 5+ 个文件中（README、agents.md、aw-init、aw-orchestrator、state-manager.ts），
> 现在集中到此单一文件，消除知识冗余。

---

## 🔴 路径铁律（违反必须阻断）

| # | 规则 | 正确 | 错误 | 级别 |
|---|------|------|------|:---:|
| 1 | `projectRoot` ≠ AgenticWiki 自身目录 | `.../AgenticWiki/project/xxx` | `.../AgenticWiki` ❌ | 🔴 CRITICAL |
| 2 | Wiki 输出到 `{projectRoot}/wiki/` | `.../project/xxx/wiki/` | `.../AgenticWiki/wiki/` ❌ | 🔴 CRITICAL |
| 3 | `.agentic-wiki/` 在 projectRoot 下 | `.../project/xxx/.agentic-wiki/` | 漏到 AgenticWiki 目录 ❌ | 🔴 CRITICAL |

**自动化验证**：在每个阶段开始前运行路径验证脚本：
```bash
npx tsx src/lib/validate-paths.ts --state .agentic-wiki/state.json
```
退出码 0 = 通过，1 = 阻断。

---

## 🔒 强制脚本调用规则

**脚本写 JSON，LLM 写 Markdown。两者永远不交叉。**

- 凡是标注 `🔧 脚本` 的步骤，**必须**通过 `terminal` 工具调用脚本完成
- **禁止**用 `read_file` + `write_file` 手动模拟脚本产出
- **禁止**跳过脚本调用直接进入下一阶段
- 脚本调用失败时，**必须**记录到 `state.json.blockers` 并暂停流水线

### DAG 定义（代码级 — 已替代 SKILL.md 文本中的硬编码）

所有阶段的脚本调用顺序、门控产物、阶段间依赖关系定义在：
```
src/dag-definition.ts
```
Agent 可读取此文件获取当前阶段需要执行哪些脚本，而非手动从 SKILL.md 文本中提取。

---

## 🔴 Phase Gate: 阶段门控

每个阶段完成后，进入下一阶段之前，**必须**通过门控检查：

1. 运行产物门控脚本：
   ```bash
   npx tsx src/lib/validate-artifacts.ts --state .agentic-wiki/state.json --phase <当前阶段>
   ```
2. 检查退出码：非零则暂停流水线
3. 🔴 CRITICAL 产物缺失 → 记录到 `blockers`，暂停，询问用户
4. 🟡 REQUIRED 产物缺失 → 记录为 warning，可以继续

---

## 🔒 写入安全

- `state.json` 只能通过 `state-manager.ts` 的 `update` 或 `transition` 命令操作
- 禁止使用 `edit_file` / `write_file` 直接修改 `state.json`
- `state-manager.ts` 自动保证：文件锁 → 备份 → 原子写入(tmp→rename) → 失败回滚

---

## 🚀 进度追踪

GEN 阶段完成后，**必须按顺序执行**：

```bash
# Step 1: 同步 genTasks 状态
npx tsx src/lib/sync-gen-tasks.ts --state .agentic-wiki/state.json --wiki wiki/ --write

# Step 2: 生成进度面板
npx tsx src/lib/progress-dashboard.ts --state .agentic-wiki/state.json --strategy .agentic-wiki/cache/folder-strategy.json --output wiki/PROGRESS.md

# Step 3: 验证进度已更新
read_file wiki/PROGRESS.md  # 确认 completed > 0
```

---

## 🔄 反馈循环

- **全局策略**：`docs/feedback/global-strategies.md`（跨项目通用，缺失不阻断）
- **项目策略**：`.agentic-wiki/feedback/prompts.md`（缺失阻断，运行 aw-init 创建）
- GEN 阶段前必须在 SubAgent Prompt 末尾注入两层策略
- 失败时自动沉淀到 `prompts.md`（使用 `state-manager.ts append-feedback` 命令）

---

## ⚠️ 错误处理

使用结构化错误码（`src/lib/shared/errors.ts`）替代字符串匹配：

| 错误码 | 含义 | 动作 |
|--------|------|------|
| E001 | 产物缺失 | retry_phase |
| E002 | JSON 解析错误 | retry_phase |
| E201 | 路径铁律违反 | abort |
| E401 | SubAgent 超时 | retry_task |
| E501 | dependency-cruiser 失败 | retry_phase |
| E502 | maxBuffer 溢出 | split_and_retry |

---

## 📊 Issue 类型白名单

GEN SubAgent 只能使用以下 6 种预定义类型：
1. `missing_types` — 类型缺失
2. `complex_logic` — 复杂逻辑
3. `circular_dependency` — 循环依赖
4. `dead_code` — 死代码
5. `inconsistent_api` — API 不一致
6. `potential_bug` — 潜在 Bug
