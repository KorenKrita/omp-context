# AGENTS.md — omp-context 项目知识库

## 概述

**omp-context** 是 [pi-context](https://github.com/ttttmr/pi-context) 的 OMP (oh-my-pi) 适配版。提供三个 agentic context management 工具:`acm_checkpoint`、`acm_timeline`、`acm_compact`。

## 技术栈

- TypeScript ESM (`"type": "module"`, `module: Node16`, `target: ES2022`, `strict: true`)
- `@oh-my-pi/pi-coding-agent` ExtensionAPI(peer dependency,由 OMP 运行时提供)
- zod v4(工具参数 schema,通过 `pi.zod` 注入)
- Source-first:OMP 直接加载 `src/*.ts`,不打包 `dist/`

## 关键设计决策

### compact 用 session_before_tree 事件注入 summary

OMP 的 `ctx.sessionManager` 在工具执行上下文里是 `ReadonlySessionManager`(只读 Pick),不暴露 `branchWithSummary`。通过 `commandCtx.navigateTree(tid, { summarize: true })` + `session_before_tree` handler 返回自定义 summary,让 OMP 内部调 `branchWithSummary`。这是 OMP 官方设计的扩展路径(`SessionBeforeTreeResult.summary` 注释:"skips default summarizer")。

### zod schema 用 `as any` 绕过类型约束

`registerTool<TParams extends TSchema>` 的泛型约束是 `ArkSchema`,不接受 zod 对象。运行时正常(`toolWireSchema` 检测 zod 用 `z.toJSONSchema`),编译期用 `parameters: schema as any` + `type Params = z.infer<typeof schema>`。

### 工具命名加 acm_ 前缀

避开 OMP 内置 `checkpoint`/`rewind` 的语义冲突。

## 结构

| 路径 | 作用 |
|---|---|
| `src/index.ts` | 三个工具注册 + compact 流程 + session_before_tree handler |
| `skills/context-management/SKILL.md` | 驱动 agent 行为的 prompt |
| `skills/context-management/references/` | 6 个场景 reference |

## 来源映射

| pi-context 原文件 | omp-context 处理 |
|---|---|
| `src/index.ts` | 重写:zod schema + session_before_tree compact + getTree 遍历 + acm_ 前缀 |
| `src/context.ts` | 丢弃(OMP 内置 `/context` 更好) |
| `src/utils.ts` | 丢弃(只被 context.ts 用) |
| `skills/context-management/SKILL.md` | 适配:工具名改 acm_ 前缀,移除 `/acm` 引用 |
| `skills/context-management/references/*` | 照搬(场景指导与平台无关) |

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
