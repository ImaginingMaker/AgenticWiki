# Issue 检测标准与严重等级指南

> **设计参考**：`pi-code-reviewer` 的 7 维度审查体系（类型安全、React规范、性能与体积、边界处理、代码质量、副作用分析）。
> GEN SubAgent 必须按此指南评估代码问题，确保检测一致性。

---

## 一、维度 → IssueType 映射

| pi-code-reviewer 维度 | → AgenticWiki IssueType | 关键检测项 |
|------------------------|------------------------|-----------|
| 1. 类型安全 | `missing_types` | any 滥用、缺类型守卫、Props 无接口 |
| 2. React/Vue 规范 | `complex_logic` | 组件 > 200 行、Hooks 依赖缺失、职责混杂 |
| 3. 性能与体积 | `potential_bug` | 内存泄漏、过宽操作、不必要重渲染 |
| 4. 边界处理 | `potential_bug` | 缺 Loading/Empty/Error 状态、竞态条件 |
| 5. 代码质量与复用 | `dead_code` / `inconsistent_api` | 重复造轮子、未使用导出、API 签名不一致 |
| 6. 副作用分析 | `potential_bug` | 错误被吞、全局状态无保护、未清理副作用 |
| — 架构级 | `circular_dependency` | 由 `build-deps.ts` 脚本自动检测 |

---

## 二、各 IssueType 详细检测标准

### 1. missing_types（类型缺失）

**对应 pi-code-reviewer 维度**：类型安全

| 检测项 | 严重等级 | 规则 |
|--------|:---:|------|
| Props/返回值使用 `any` | 🔴 high | ≥ 3 处或核心接口 |
| Props/返回值使用 `any` | 🟡 medium | 1-2 处或非核心工具函数 |
| 缺少类型守卫 | 🟡 medium | unknown 类型直接 as 转换 |
| 函数参数无类型标注 | 🟢 low | 仅非导出内部函数 |
| 事件处理器类型缺失 | 🟡 medium | `(e) =>` 而非 `(e: MouseEvent) =>` |
| API 响应无类型 | 🔴 high | fetch/axios 返回值标注为 any |

**评估模板**：
```
检测到 [{N}] 处类型缺失：
- [{file}:{line}] {问题描述}
影响范围：{被依赖数} 个模块依赖此类型
```

### 2. complex_logic（复杂逻辑）

**对应 pi-code-reviewer 维度**：React/Vue 规范 + 代码质量

| 检测项 | 严重等级 | 规则 |
|--------|:---:|------|
| 组件 > 200 行 | 🔴 high | 单一文件超过阈值 |
| 函数 > 100 行 | 🟡 medium | 单个函数超过阈值 |
| 嵌套 > 4 层 | 🟡 medium | if/for/回调 嵌套深度 |
| Hooks 依赖数组缺失 | 🔴 high | useEffect/useMemo 等缺少依赖项 |
| 组件职责混杂 | 🟡 medium | 一个文件同时处理 UI + 数据获取 + 状态管理 |
| JSX 内复杂表达式 | 🟢 low | 三元嵌套 > 2 层 |

**评估模板**：
```
检测到 [{N}] 处复杂逻辑：
- [{file}:{line}] {函数名}: {行数} 行，嵌套 {深度} 层
建议：提取为独立 Hook 或拆分子组件
```

### 3. dead_code（死代码）

| 检测项 | 严重等级 | 规则 |
|--------|:---:|------|
| 导出但无引用 | 🔴 high | 被 0 个文件 import（非入口文件） |
| 重复造轮子 | 🟡 medium | 新函数与已有 utils/helpers 功能重叠 |
| 未使用的 import | 🟢 low | 单文件内未使用的导入 |

**评估模板**：
```
检测到 [{N}] 处死代码：
- [{file}] 导出 {N} 个符号，0 个被引用
建议：删除或标记为 @deprecated
```

### 4. inconsistent_api（API 不一致）

**对应 pi-code-reviewer 维度**：代码质量与复用

| 检测项 | 严重等级 | 规则 |
|--------|:---:|------|
| 同类组件签名不一致 | 🔴 high | 如 Button 用 `onClick`，Input 用 `handleClick` |
| 参数顺序不一致 | 🟡 medium | 同类函数参数顺序不同 |
| 返回值类型不一致 | 🟡 medium | 有的返回数组，有的返回对象 |
| 命名风格不一致 | 🟢 low | camelCase vs snake_case 混用 |
| Props 功能重复 | 🟡 medium | 如 `content` 和 `default` 同时存在且功能重叠 |

### 5. potential_bug（潜在 Bug）

**对应 pi-code-reviewer 维度**：性能与体积 + 边界处理 + 副作用分析

| 检测项 | 严重等级 | 来源维度 |
|--------|:---:|------|
| 内存泄漏 | 🔴 high | 性能：useEffect 无清理、订阅未取消、定时器未清除 |
| 错误被吞 | 🔴 high | 副作用：catch 块空实现、只 console.error 不处理 |
| 竞态条件 | 🔴 high | 边界：异步操作无 AbortController、重复提交 |
| 缺少兜底 | 🔴 high | 边界：无 loading / empty / error 状态 |
| 生产环境 console | 🟡 medium | 副作用：console.warn/error 未在 production 移除 |
| 过宽操作 | 🟡 medium | 性能：读取全部只需部分 |
| 不必要重渲染 | 🟡 medium | 性能：渲染内创建新对象/函数 |

### 6. circular_dependency（循环依赖）

**由 `build-deps.ts` 脚本自动检测**，SubAgent 无需主动发现。

| 检测项 | 严重等级 | 规则 |
|--------|:---:|------|
| ≥ 3 模块循环 | 🔴 high | A → B → C → A |
| 2 模块循环 | 🟡 medium | A → B → A |
| 通过 type import 循环 | 🟢 low | 运行时无影响，仅类型层面 |

---

## 三、严重等级决策矩阵

| 影响范围 | 无运行时影响 | 可能影响边缘场景 | 影响核心功能 |
|---------|:---:|:---:|:---:|
| 单文件 | 🟢 low | 🟡 medium | 🔴 high |
| 多文件（2-5） | 🟡 medium | 🟡 medium | 🔴 high |
| 全局/核心模块 | 🟡 medium | 🔴 high | 🔴 high |

**快速决策**：
- 可能导致运行时崩溃 → 🔴 high
- 可能导致用户体验问题 → 🟡 medium
- 纯代码风格/可读性 → 🟢 low

---

## 四、高频问题模式速查

从 `pi-code-reviewer` 的高频模式移植，GEN SubAgent 优先检查：

| 模式 | IssueType | 严重等级 | 检测方法 |
|------|-----------|:---:|------|
| 内存泄漏 | `potential_bug` | 🔴 high | useEffect/onMounted 无清理函数 |
| 错误被吞 | `potential_bug` | 🔴 high | catch {} 空块 |
| 竞态条件 | `potential_bug` | 🔴 high | 异步操作无取消机制 |
| any 滥用 | `missing_types` | 🔴 high | ≥ 3 处 any |
| 缺兜底状态 | `potential_bug` | 🔴 high | 无 loading/empty/error |
| 组件过大 | `complex_logic` | 🟡 medium | > 200 行 |
| 重复造轮子 | `dead_code` 或 `inconsistent_api` | 🟡 medium | 功能与已有代码重叠 |
| 深度嵌套 | `complex_logic` | 🟡 medium | > 4 层 |
| 签名不一致 | `inconsistent_api` | 🟡 medium | 同类函数参数不同 |
| 生产环境日志 | `potential_bug` | 🟡 medium | console.warn/error |

---

## 五、Issue 输出格式（统一模板）

```markdown
---
id: IS-{YYYY}-{NNN}
type: {circular_dependency|dead_code|missing_types|complex_logic|inconsistent_api|potential_bug}
severity: {high|medium|low}
confidence: {high|medium|low}
status: detected
detected_at: <ISO时间戳>
detected_by: aw-generate
source_files:
  - {相对路径}
related_wiki:
  - "[[../../volume-1-code/{chapter}/index]]"
history:
  - at: <ISO时间戳>
    event: detected
    by: aw-generate
    note: "<一句话描述>"
---

# IS-{id}：{简短标题}

## 检测依据

> 维度：{对应的 pi-code-reviewer 维度}
> 模式：{高频模式名称}
> 检测项：{具体检测项}

**位置**：`{file}:{line}` — `{函数名/组件名}`

## 问题描述

{2-3 句话说明问题}

## 影响范围

| 指标 | 值 |
|------|-----|
| 影响文件数 | {N} |
| 下游依赖数 | {N} |
| 风险 | {运行时崩溃 / 用户体验 / 维护性} |

## 建议方案

1. **{方案 1}**：{一句话描述 + 代码示例}
2. **{方案 2}**：{备选}

## 相关 Wiki

- [[../../volume-1-code/{chapter}/index]]

## 状态时间线

| 时间 | 事件 | 操作者 | 备注 |
|------|------|--------|------|
| <时间> | 🔍 发现 | aw-generate | {模式}: {概述} |
```
