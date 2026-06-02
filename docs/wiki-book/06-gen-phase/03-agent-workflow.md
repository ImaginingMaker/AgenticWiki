# 6.3 Agent 工作流

> Agent（人类或 LLM 操作员）在 GEN 阶段的具体操作步骤。

---

## 完整工作流

### 首次全量分析

```
步骤 1: 启动 Runner（全量模式）
  → npx tsx src/runner.ts --project /path/to/target
  
步骤 2: Runner 自动完成 INIT → SCAN → DEPENDENCY → GEN（生成第一批 Prompt）
  → 暂停并输出：
     📝 SubAgent Prompts 已输出到: /path/.agentic-wiki/gen-prompts/
     共 N 个 prompt 文件。

步骤 3: Agent 读取 Prompt 文件
  → 从 gen-prompts/ 目录读取第一个 prompt 文件

步骤 4: Agent spawn SubAgent
  → 使用 spawn_agent 工具启动 SubAgent
  → 每次并发处理多个（建议 3-5 个）

步骤 5: SubAgent 完成工作
  → 读取模板文件（read_file）
  → 读取文件元信息
  → 分析源码
  → write_file 写入 Wiki 页面
  → write_file 写入 Issue 文件
  → write_file 写入 .gen-done 标记（步骤 5）

步骤 6: 所有当前批次 SubAgent 完成后
  → 运行: npx tsx src/runner.ts --project <path> --resume
  
  Runner 自动执行：
    - 重新注入最新反馈策略
    - 同步已完成 GEN 任务状态
    - 验证 SubAgent 产物
    - 生成下一批 Prompt（如有剩余任务）
    - 暂停

步骤 7: 重复步骤 3-6（--resume → spawn → --resume → ...）
  → 直到全部完成
  
步骤 8: 全部 GEN 任务完成后
  → Runner 自动进入 ASSEMBLE → VALIDATE → ✅ DONE
```

### 断点续跑（模式 B）

```bash
npx tsx src/runner.ts --project /path/to/target --resume
```

Runner 自动：
1. 扫描已完成 GEN 任务 → 同步状态
2. 验证 SubAgent 产物（检查 `.gen-done`）
3. 检测状态-磁盘一致性
4. 生成剩余任务的 Prompt
5. 暂停 → 等待 Agent spawn

## 典型时序图

```
时间 →
─────

npx src/runner.ts --project ./my-app
  ├── INIT (自动, ~2s)
  ├── SCAN (自动, ~3s)
  ├── DEPENDENCY (自动, ~30s)
  ├── GEN (自动, ~5s) → 暂停
  │
  → Agent: spawn_agent (批次 1, 5 个 SubAgent) ◀── Agent 手动
  → Agent: 等待 SubAgent 完成 (~2-5min 每个)
  │
npx src/runner.ts --project ./my-app --resume
  ├── 状态同步 + 产物验证 (自动)
  ├── GEN 批次 2 (自动) → 暂停
  │
  → Agent: spawn_agent (批次 2, 5 个 SubAgent) ◀── Agent 手动
  │
npx src/runner.ts --project ./my-app --resume
  ├── 状态同步 + 产物验证 (自动)
  ├── 全部完成
  ├── ASSEMBLE (自动, ~10s)
  └── VALIDATE (自动, ~5s) → ✅ DONE
```

## 关键注意事项

| 场景 | 操作 |
|:---|:---|
| **SubAgent 写入后未验证** | Prompt 内置步骤 3.5（`ls -la` 自检） |
| **SubAgent 中途中断** | SubAgent 下次 resume 时重新执行 |
| **多个 SubAgent 写相同文件** | 每个 SubAgent 的写入目录不重叠 |
| **--resume 后卡住** | 检查 `verify-gen-artifacts.ts` 输出 |
| **全部完成后** | 直接进入 ASSEMBLE，无需人工干预 |

---

> **上一篇**: [6.2 Prompt 结构与模板系统](02-prompt-structure.md) | **下一篇**: [第七章 ASSEMBLE 阶段](../07-assemble-phase.md)
