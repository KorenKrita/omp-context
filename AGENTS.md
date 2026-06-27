# AGENTS.md — omp-context 项目知识库

## 概述

**omp-context** 是 [pi-context](https://github.com/ttttmr/pi-context) 的 OMP (oh-my-pi) 适配版。提供三个 agentic context management 工具:`acm_checkpoint`、`acm_timeline`、`acm_compact`。

## 技术栈

- TypeScript ESM (`"type": "module"`, `module: Node16`, `target: ES2022`, `strict: true`)
- `@oh-my-pi/pi-coding-agent` ExtensionAPI(peer dependency,由 OMP 运行时提供)
- zod v4(工具参数 schema,通过 `pi.zod` 注入)
- Source-first:OMP 直接加载 `src/*.ts`,不打包 `dist/`

## 关键设计决策

### compact 用同步 branchWithSummary + session_stop continuation

`ctx.sessionManager` 类型是 `ReadonlySessionManager`(只读 Pick),运行时是完整 `SessionManager`。通过 guarded runtime cast 直接调 `branchWithSummary(tid, summary)` — 在 tool execute 内同步执行。`session_stop` 事件返回 `{ continue: true }` 触发 continuation turn。

同步执行避免 agent 困惑:compact 返回时 leaf 已切换,agent 可立即用 `acm_timeline` 验证。

### pi.setLabel() bug

`ConcreteExtensionAPI.setLabel(label: string)` 只设扩展显示名(`this.extension.label = label`),不调 `appendLabelChange`。`pi.setLabel(id, name)` 的第二个参数被忽略。用 `setEntryLabel(sm, entryId, label)` guarded cast 调 `sm.appendLabelChange(entryId, label)` 绕过。

### zod schema 用 `as unknown as TSchema` 绕过类型约束

`registerTool<TParams extends TSchema>` 的泛型约束不接受 zod 对象。运行时正常,编译期用 `parameters: schema as unknown as TSchema`。

### 类型导入用子路径

`export type *` 在 Node16 moduleResolution 下不传播具名导出。必须从子路径导入:
- `@oh-my-pi/pi-coding-agent/extensibility/extensions/types`
- `@oh-my-pi/pi-coding-agent/session/session-manager`
- `@oh-my-pi/pi-coding-agent/session/session-entries`
- `@oh-my-pi/pi-ai/types`

### 工具命名加 sg_ 前缀

避开 OMP 内置 `checkpoint`/`rewind` 的语义冲突。

## 结构

| 路径 | 作用 |
|---|---|
| `src/index.ts` | 三个工具注册 + 同步 compact + session_stop continuation + full_tree/search timeline |
| `skills/context-management/SKILL.md` | 驱动 agent 行为的 prompt |
| `skills/context-management/references/` | 7 个场景 reference |

## 注意事项

- OMP 直接加载 TS 源码,不预编译。`package.json` 的 `files` 只包含 `src`/`skills`/`README.md`
- `@oh-my-pi/pi-coding-agent` 作为 peerDependency,devDependencies 仅供类型检查
- 不要在代码中用 `console.log`(OMP 用 logger),但扩展工具可以用 `pi.logger`

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->
