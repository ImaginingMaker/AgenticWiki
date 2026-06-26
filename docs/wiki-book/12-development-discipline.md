# 第十二章 开发纪律

> 修改 AgenticWiki 脚本或文档时必须遵守的纪律。

---

## 12.1 文档同步（强约束）

修改任何脚本或文档后，必须同步更新入口文档 `README.md` 和 `AGENTS.md` 中的对应描述：

| 修改了什么 | 必须同步更新 |
|:---|:---|
| `src/lib/` 下的脚本（新增/改名/删除/行为变更） | `README.md`（架构表格、阶段描述、脚本计数）+ `AGENTS.md`（目录速览、脚本计数、Runner 自动功能列表） |
| 新增/删除 CLI 参数 | `README.md`（参数速查表）+ `AGENTS.md`（入口表格） |
| `docs/` 下的内容 | `AGENTS.md`（文档索引）+ `README.md`（如有引用） |
| `src/runner.ts` 流水线逻辑变更 | `README.md`（阶段表格、工作流）+ `AGENTS.md`（Runner 自动功能列表、故障排查） |
| 测试文件变更 | `AGENTS.md`（目录速览中的测试用例计数） |

**检查清单**：改代码后，`grep` 搜索 `AGENTS.md` 和 `README.md` 中所有与被修改主题相关的描述，确保数字和描述一致。

## 12.2 测试纪律

```bash
npm test                   # 全量测试必须通过（vitest run）
npm run lint               # ESLint 检查无 error
npm run test:coverage      # 覆盖率达标
```

### 覆盖率阈值

| 指标 | 当前阈值 |
|:---|:---:|
| Lines | ≥ 85% |
| Functions | ≥ 85% |
| Branches | ≥ 80% |
| Statements | ≥ 85% |

### 新增脚本配套测试

新增加的 `src/lib/*.ts` 脚本原则上应配套对应的 `src/lib/__tests__/*.test.ts` 测试文件。

### 已知短板

以下历史脚本覆盖率较低，属遗留债。**新改代码不允许降低已有覆盖率**，新增文件的覆盖率目标 ≥ 全局阈值：

- `assemble-book.ts`
- `gen-scheduler.ts`
- `validate-*` 系列脚本

## 12.3 当前测试概况

| 统计 | 数量 |
|:---|:---:|
| 测试文件 | 35 |
| 测试用例 | **740** |
| 测试通过率 | 100% |

---

> **上一篇**: [第十一章 优化特性详解](../11-optimizations/index.md) | **下一篇**: [附录](appendix.md)
