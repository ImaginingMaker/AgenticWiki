# AgenticWiki — Agent 操作手册

> **阅读对象**：LLM Agent | **唯一切入点**：`README.md`

## 1. 这是什么？

Agent 驱动的前端代码 → Wiki 转换系统。

**核心原则**：Agent 运行 `runner.ts`，Runner 自动编排脚本，Agent 只需在 GEN 阶段 spawn SubAgent。

---

## 2. 路径铁律

**只需记住一条**：`--project` 指向被分析的项目，不要指向 AgenticWiki 自身。

Runner 启动时自动校验 3 条规则，违反则阻断。

---

## 3. 入口

Agent 读 `README.md` → 选模式 → 运行命令。

| 模式 | 命令 | 说明 |
|:---|:---|:---|
| 首次全量 | `npx tsx src/runner.ts --project <path>` | 初始化项目，分批调度 LLM |
| 断点续跑 | `npx tsx src/runner.ts --project <path> --resume` | 检查状态，继续未完成的 GEN 任务 |
| 增量更新 | `npx tsx src/runner.ts --project <path> --mode incremental --since HEAD~1` | 检测变更，标记受影响部分后续跑 |

---

## 4. 目录速览

```
src/
  runner.ts           # 统一流水线入口（Agent 只需知道这个）
  dag-definition.ts    # 已删除（逻辑内联到 runner.ts）
  types/index.ts       # TypeScript 类型定义
  lib/                 # 20 个脚本 + shared/ 基础设施
  lib/__tests__/       # 13 个测试文件

skills/
  main.SKILL.md        # 参考文档（按需查阅，非必读）

docs/
  feedback/            # 跨项目通用改进策略
  reference/           # 参考资料
```

---

## 5. Runner 自动完成的功能

- 路径自检（3 条铁律）
- 状态管理（state.json 全生命周期）
- 脚本调度（28 个脚本参数自动拼接）
- 门控验证（每阶段产物完整性）
- 反馈注入（global-strategies.md + prompts.md → SubAgent prompt）
- 失败记录（自动追加到 prompts.md）
- 进度同步（ASSEMBLE 阶段自动 sync + progress）

---

## 6. 故障排查

| 问题 | 排查 |
|:---|:---|
| Runner 启动阻断 | 确认 `--project` 指向目标项目，非 AgenticWiki 自身 |
| 产物缺失 | Runner 每阶段自动门控，查看控制台输出 |
| 状态异常 | `npx tsx src/runner.ts --project <path> --force` 重建 |
| dependency-cruiser 超时 | 增加 `--timeout` 或缩小范围 |
| GEN 阶段卡死 | `--resume` 续跑，Runner 自动跳过已完成任务 |

---

## 7. 文档索引

| 文档 | 用途 |
|:---|:---|
| `README.md` | 🔴 唯一切入点 |
| `skills/main.SKILL.md` | 参考文档（参数、故障排查） |
| `docs/feedback/global-strategies.md` | 全局改进策略 |
| `docs/reference/LLM-Wiki_karpathry.md` | LLM Wiki 原始思想参考 |
| `src/types/index.ts` | TypeScript 类型字典 |
