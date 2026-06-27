# PRD: Implement omp-context OMP Plugin

## Background

omp-context 是 pi-context 的 OMP 适配版。提供 3 个 agentic context management 工具：`acm_checkpoint`、`acm_timeline`、`acm_compact`。当前项目零实现——`src/index.ts` 不存在、`skills/` 为空。

## Requirements

1. **3 个工具**：
   - `acm_checkpoint`：给对话节点打语义 label（`pi.setLabel()`）
   - `acm_timeline`：输出对话路径结构图 + token HUD，支持 `full_tree` 参数展示所有分支
   - `acm_compact`：选 target → agent 写 summary → 从 target 分支续接，summary 中标记 `from: <originId>` 支持"回到未来"

2. **`/acm` command bootstrap**：`registerCommand("acm")` 获取 `ExtensionCommandContext`（`navigateTree` 的唯一入口）。由 skill prompt 指导 agent 首次 compact 前自动执行。

3. **Skill prompt + 7 个 reference 文件**：从上游 pi-context 适配，工具名改为 `acm_*` 前缀。

4. **compact 事件流**：`turn_end` → `ctx.abort()` → `agent_end` → `setTimeout + waitForIdle + navigateTree({ summarize: true })` → `session_before_tree` hook 注入手写 summary → `sendMessage` 触发续接 turn。

5. **更新 README.md 和 AGENTS.md**：修正 compact 流程描述、reference 数量、zod 类型用法、保留 `/acm` 命令。

## Acceptance Criteria

- `npm install && npx tsc --noEmit` 通过
- `omp install .` 无报错
- `/acm` 命令执行后 notification 出现
- `acm_checkpoint` 创建 label 成功，重复名返回错误
- `acm_timeline` 默认模式输出活跃路径 + HUD
- `acm_timeline({ full_tree: true })` 输出完整 tree 含所有分支 ID
- `acm_compact` 端到端：tool 返回 → turn 终止 → navigateTree → summary 注入 → 新 turn 开始
- compact 后 `acm_timeline({ full_tree: true })` 可见 `from: <id>` 标记和 backup 分支
- SKILL.md 中工具名全部为 `acm_*`，无残留 `context_*`
- reference 文件数量 = 7

## Technical Constraints

- OMP `ReadonlySessionManager` 不暴露 `getChildren`/`branchWithSummary` → 用 `getTree()` 递归 + `session_before_tree` hook
- `navigateTree` 仅在 `ExtensionCommandContext` 上 → 必须 `registerCommand`
- `agent_end` 在 agent idle 前触发 → 必须 `setTimeout + waitForIdle`
- zod schema 用 `import type * as z from "zod/v4"` 用于类型，`pi.zod` 用于 runtime
- `SessionTreeNode` 已从 OMP 导出（session-entries.d.ts），直接 import 无需本地定义

## Source

- 上游：https://github.com/ttttmr/pi-context
- OMP 类型：`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/types/`
- 已批准计划：`local://omp-context-review-plan.md`
