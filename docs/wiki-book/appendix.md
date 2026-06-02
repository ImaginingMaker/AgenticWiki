# 附录：项目测试与验证要点

> 补充说明运行测试和验证时的实用信息。

---

## 快速命令

```bash
# 全量测试
npm test
# → vitest run，32 个测试文件 657 个用例

# ESLint 检查
npm run lint
# → eslint 'src/**/*.ts'，无 error 即通过

# 覆盖率报告
npm run test:coverage
# → 生成 coverage/ 目录

# 运行指定测试文件
npx vitest run src/lib/__tests__/state-manager.test.ts

# 运行测试时附带 ui
npx vitest --ui
```

## 常见测试失败场景

| 失败场景 | 原因 | 修复 |
|:---|:---|:---|
| 路径相关测试失败 | 绝对路径在不同系统上不一致 | 使用 `path.resolve()` 相对化 |
| 状态测试失败 | 并发写入 state.json | 检查文件锁机制（FileLock） |
| 依赖图测试失败 | dependency-cruiser 版本变更 | 检查 cruiser 输出格式 |
| 快照测试失败 | SubAgent Prompts 输出格式变更 | 更新快照 `npx vitest --update` |

## 覆盖率收集策略

- 使用 `c8`（通过 vitest 配置）
- 排除 `src/types/`（纯类型定义）和 `src/runner.ts`（入口文件）
- 阈值在 `vitest.config.js` 中配置

## CLI 参数速查

| 参数 | 用途 | 示例 |
|:---|:---|:---|
| `--project` | 目标项目路径（必填） | `--project /path/to/app` |
| `--source` | 源码目录覆盖 | `--source packages/muya/src` |
| `--mode` | 流水线模式 | `--mode incremental` |
| `--resume` | 断点续跑 | `--resume` |
| `--limit` | GEN 每批任务数 | `--limit 10` |
| `--token-limit` | GEN 每批 Token 上限 | `--token-limit 300000` |
| `--to` | 运行到指定阶段停止 | `--to SCAN` |
| `--only` | 仅运行指定阶段 | `--only ASSEMBLE` |
| `--force` | 清除已有状态重置 | `--force` |
| `--dry-run` | 仅展示执行计划 | `--dry-run` |
| `--since` | 增量模式基准 | `--since HEAD~1` |

---

> **上一篇**: [第十二章 开发纪律](12-development-discipline.md) | **回到首页**: [SUMMARY.md](SUMMARY.md)
