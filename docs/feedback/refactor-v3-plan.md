# AgenticWiki v3 重构实施方案 — 索引

> 版本：v3.0 | 起草时间：2026-06-25
> 基于 `remaining-issues.md` 8 项遗留问题 + 3 项新增需求 + 全量代码审计

---

## 重构目标

| # | 目标 | 当前状态 | 期望状态 |
|---|------|---------|---------|
| G1 | 增量模式与聚簇兼容 | 增量模式硬编码 `folder-strategy.json`，聚簇项目完全失效 | 统一文件→任务索引，增量模式同时支持文件夹/聚簇两种策略 |
| G2 | Token 容量控制 | 硬编码上限 80K，`file-meta.ts` 仅读 4KB，估算严重偏差 | 以 1M 模型为基准，全量读取文件，Token 预算上限提升至 200K+，动态比例自适应 |
| G3 | Wiki 生成方案升级 | 7 个固定章节，缺少业务维度 | 每个聚簇生成完整结构化章节（含需求背景、技术实现方案、公共组件索引等 12+ 章节） |

---

## 阶段文档索引

按流水线执行顺序，每个阶段独立文档：

| 序号 | 阶段 | 文档 | 涉及脚本数 | 核心改动 |
|:---:|------|------|:---:|---------|
| 1 | INIT + SCAN | [phase-1-init-scan.md](./v3/phase-1-init-scan.md) | 5 | 技术栈检测修复、扫描鲁棒性、filter-styles 死代码清理、compute-hashes 并发控制 |
| 2 | DEPENDENCY | [phase-2-dependency.md](./v3/phase-2-dependency.md) | 7 | 4KB 截断修复、Token 估算全量化、聚簇阈值调整、RCE 安全修复、文件读取去重、FileTaskIndex |
| 3 | GEN | [phase-3-gen.md](./v3/phase-3-gen.md) | 4 | Token 预算公式 v3、12 章节 Prompt 模板、Prompt 构建函数去重、死代码清理、Resume 逻辑提取 |
| 4 | ASSEMBLE | [phase-4-assemble.md](./v3/phase-4-assemble.md) | 4 | Issue 去重、Issue 状态机激活、assemble-book 聚簇感知、symbol-index 增强 |
| 5 | VALIDATE | [phase-5-validate.md](./v3/phase-5-validate.md) | 4 | Issue 状态流转、issue-parser 统一为 gray-matter、validate-references 路径净化一致性 |
| 6 | PIPELINE + SHARED | [phase-6-pipeline-shared.md](./v3/phase-6-pipeline-shared.md) | 7 | runner.ts 增量路径重构、state-manager 文件锁修复、反馈注入优化、原型污染防护 |

---

## 实施顺序与依赖关系

```
Phase 1: INIT+SCAN 基础修复（无依赖）
  │
Phase 2: DEPENDENCY 核心重构（依赖 Phase 1 的扫描修复）
  │
  ├──→ Phase 3: GEN 调度升级（依赖 Phase 2 的 Token + 聚簇）
  │
  └──→ Phase 6: PIPELINE+SHARED 基础设施（依赖 Phase 2 的 FileTaskIndex）
         │
         ├──→ Phase 4: ASSEMBLE 组装增强（依赖 Phase 3 + Phase 6）
         │
         └──→ Phase 5: VALIDATE 验证闭环（依赖 Phase 4 的 Issue 状态机）
```

---

## 全局受影响文件总览

| 文件 | 改动类型 | 涉及阶段 |
|------|---------|---------|
| `src/types/index.ts` | 新增 `FileTaskIndex` | Phase 2 |
| `src/lib/scan/scan-project.ts` | 修改 | Phase 1 |
| `src/lib/scan/scan-files.ts` | 修改 | Phase 1 |
| `src/lib/scan/filter-styles.ts` | 修改/清理 | Phase 1 |
| `src/lib/dependency/compute-hashes.ts` | 修改 | Phase 1 |
| `src/lib/dependency/build-deps.ts` | 修改 | Phase 2 |
| `src/lib/dependency/file-priorities.ts` | 修改 | Phase 2 |
| `src/lib/dependency/extract-file-meta.ts` | 修改 | Phase 2 |
| `src/lib/dependency/cluster-tasks.ts` | 修改 | Phase 2 |
| `src/lib/dependency/build-file-task-index.ts` | **新增** | Phase 2 |
| `src/lib/gen/gen-scheduler.ts` | 修改 | Phase 3 |
| `src/lib/gen/sync-gen-tasks.ts` | 修改 | Phase 3 |
| `src/lib/gen/verify-gen-artifacts.ts` | 修改 | Phase 3 |
| `src/lib/gen/progress-dashboard.ts` | 修改 | Phase 3 |
| `src/lib/assemble/assemble-book.ts` | 修改 | Phase 4 |
| `src/lib/assemble/symbol-index.ts` | 修改 | Phase 4 |
| `src/lib/assemble/issue-dashboard.ts` | 修改 | Phase 4 |
| `src/lib/validate/validate-issue-content.ts` | 修改 | Phase 5 |
| `src/lib/validate/validate-references.ts` | 修改 | Phase 5 |
| `src/lib/validate/dedup-issues.ts` | **新增** | Phase 4 |
| `src/lib/shared/state-manager.ts` | 修改 | Phase 6 |
| `src/lib/shared/issue-parser.ts` | 修改 | Phase 5 |
| `src/lib/shared/issue-status.ts` | **新增** | Phase 5 |
| `src/lib/shared/id-utils.ts` | 修改 | Phase 6 |
| `src/lib/pipeline/gen-helpers.ts` | 修改 | Phase 6 |
| `src/lib/pipeline/gen-resume-handler.ts` | **新增** | Phase 6 |
| `src/lib/pipeline/phase-definitions.ts` | 修改 | Phase 6 |
| `src/lib/pipeline/script-runner.ts` | 修改 | Phase 6 |
| `src/runner.ts` | 修改 | Phase 6 |
| `README.md` | 更新 | 收尾 |
| `AGENTS.md` | 更新 | 收尾 |

**新增文件**：5 个 | **修改文件**：26 个 | **新增测试**：≥ 5 个

---

> 📎 相关文档：`docs/feedback/remaining-issues.md` | `AGENTS.md` | `README.md`
