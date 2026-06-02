# 第二章 目录规范

> 理解源码和运行时生成的目录结构，是深入项目的前提。

---

## 2.1 源码目录

```
AgenticWiki/
  src/
    runner.ts                    # 🚀 统一流水线入口（Agent 只需知道这个）
    types/index.ts               # TypeScript 类型字典（35+ 接口/类型）

    lib/
      pipeline/                  # 流水线编排层
        path-resolver.ts         # CLI 参数解析 + 路径解析（含 monorepo 自动探测）
        phase-definitions.ts     # 阶段定义——每个阶段的脚本清单和参数
        script-runner.ts         # 脚本执行器——npx tsx 封装
        setup.ts                 # 目录创建 + 反馈种子初始化
        state-utils.ts           # 状态加载/保存/查询
        gen-helpers.ts           # GEN 辅助——Prompt 输出、反馈注入、增量传播

      scan/                      # 🔍 扫描阶段
        scan-project.ts          # 技术栈识别（框架/语言/构建工具）
        scan-files.ts            # 文件递归扫描
        filter-styles.ts         # 样式文件过滤

      dependency/                # 🔗 依赖分析阶段
        build-deps.ts            # dependency-cruiser 依赖图构建
        compute-hashes.ts        # 文件哈希计算
        file-priorities.ts       # P0-P4 优先级分配
        analyze-folders.ts       # 文件夹拆分策略
        extract-subgraph.ts      # 子图提取
        extract-file-meta.ts     # 文件元信息提取
        cluster-tasks.ts         # 依赖聚簇划分（v2.1 核心）

      gen/                       # 📝 生成阶段
        gen-scheduler.ts         # 调度 + Prompt 生成
        sync-gen-tasks.ts        # 状态同步
        verify-gen-artifacts.ts  # 产物自检
        progress-dashboard.ts    # 进度面板

      assemble/                  # 📚 组装阶段
        assemble-book.ts         # 书组装 + 术语表
        symbol-index.ts          # 符号索引
        issue-dashboard.ts       # Issue 汇总仪表盘
        fix-issue-paths.ts       # Issue 路径修正

      validate/                  # ✅ 验证阶段
        validate-artifacts.ts    # 产物完整性验证
        validate-references.ts   # 交叉引用验证
        validate-code-refs.ts    # 源码引用校验
        validate-issue-types.ts  # Issue 类型校验
        validate-issue-content.ts# Issue 内容定量校验
        validate-paths.ts        # 路径自检

      shared/                    # 🔧 共享模块
        state-manager.ts         # 完整状态管理（原子更新、锁、反馈记录）
        git-diff.ts              # Git diff + BFS 依赖传播
        id-utils.ts              # ID/路径生成工具

      __tests__/                 # 32 个测试文件，657 个用例
```

### 分组逻辑

| 子目录 | 阶段映射 | 脚本数 |
|:---|:---|:---:|
| `pipeline/` | 全阶段 | 6 |
| `scan/` | INIT + SCAN | 3 |
| `dependency/` | DEPENDENCY | 7 |
| `gen/` | GEN | 4 |
| `assemble/` | ASSEMBLE | 4 |
| `validate/` | VALIDATE | 6 |
| `shared/` | 全阶段 | 3 |

## 2.2 运行时生成目录

目标项目在被分析时，Runner 会在其目录下创建以下结构：

```
<project>/
  .agentic-wiki/
    state.json                 # 🗃️ 流水线全生命周期状态
    cache/                     # 📦 中间产物
      deps/                    #   每个文件夹的局部依赖子图
      gen-prompts/             #   GEN 阶段的 SubAgent Prompt 文件
      templates/               #   SubAgent 模板（自动生成）
        issue-rules.md         #     6 类 Issue 检测标准
        output-format.md       #     Wiki 页面格式规范
        path-safety.md         #     路径书写规则
    feedback/
      prompts.md               # 📝 项目级反馈积累
    search/
      symbol-index.json        # 🔍 全量符号索引

  wiki/
    volume-1-code/             # 📖 第一卷：代码档案
      ch-<folder>/             #   每个文件夹一个章节
    volume-2-issues/           # 🔴 第二卷：Issue 面板
      ch-01-circular-deps/     #   循环依赖
      ch-02-dead-code/         #   死代码
      ch-03-missing-types/     #   类型缺失
      ch-04-complex-logic/     #   复杂逻辑
      ch-05-inconsistent-api/  #   API 不一致
      ch-06-potential-bugs/    #   潜在 Bug
      ch-99-archived/          #   归档
    PROGRESS.md                # 📊 进度面板
    book.md                    # 📖 完整书册
    glossary.md                # 📖 术语表
    issues.md                  # 📊 Issue 汇总仪表盘
```

### Monorepo 数据隔离

使用 `--source packages/<包名>/src` 时，`.agentic-wiki/` 和 `wiki/` 存放在该包目录下，多个包可同时独立分析：

```
<monorepo>/packages/muya/
  .agentic-wiki/          ← 此包独有
  wiki/                   ← 此包独有
```

---

> **上一篇**: [第一章 项目概览](01-overview.md) | **下一篇**: [第三章 INIT 阶段](03-init-phase.md)
