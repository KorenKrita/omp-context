# AGENTS.md - omp-context 项目知识库

## 概述

**omp-context** 是 [pi-context](https://github.com/ttttmr/pi-context) 的 OMP (oh-my-pi) 适配版。它给 OMP agent 提供主动上下文管理能力，让 agent 能在长任务中自己打锚点、查看会话树、穿越时间线并在目标节点继续。

项目当前暴露三个工具：

| 工具 | 作用 |
|---|---|
| `acm_checkpoint` | 给会话历史节点打语义 checkpoint label |
| `acm_timeline` | 输出 active path / full tree / search 视图和 context HUD |
| `acm_travel` | 穿越到任意 checkpoint 或节点，创建 summary continuation branch |

## 技术栈

- TypeScript ESM (`"type": "module"`, `module: Node16`, `target: ES2022`, `strict: true`)
- `@oh-my-pi/pi-coding-agent` ExtensionAPI 作为 peer dependency（`^16.1.22`）, 由 OMP 运行时提供
- `@oh-my-pi/pi-agent-core`（token estimator）同为 peer/dev dependency（`^16.1.22`）
- 工具参数 schema 使用运行时注入的 `pi.zod`
- Source-first: OMP 直接加载 `src/*.ts`, 不打包 `dist/`

## 当前实现

### 扩展入口

`src/index.ts` 默认导出 `function(pi: ExtensionAPI): void`，在加载时注册三个工具和三个事件 handler（`context`、`session_start`、`session_shutdown`）。

`package.json` 的 `omp` 字段是 OMP 发现入口：

```json
{
  "extensions": ["./src/index.ts"],
  "skills": ["./skills"]
}
```

### checkpoint 使用 appendLabelChange

不要用 `pi.setLabel(id, name)` 给会话节点打 label。OMP 16.1.x 的类型声明看起来支持两个参数，但实际 `ConcreteExtensionAPI.setLabel(label: string)` 只修改扩展显示名，不会写 session label。

当前实现用 `setEntryLabel(sm, entryId, label)` guarded cast 到完整 `SessionManager`，调用：

```ts
sm.appendLabelChange(entryId, label)
```

`acm_checkpoint` 的默认 target 是 active branch 上最近的有意义 **USER/AI 消息**，跳过 tool result、bash/custom/system 消息、无可见文字的 internal-tool-only AI turn、空消息等。显式 `target` 可用任意节点 ID（含 tool result），但会 warning；**auto-resolve 仍只选 USER/AI**。

checkpoint / `backupCurrentHeadAs` **名称**在整棵树内必须唯一且**大小写敏感**（`Foo` ≠ `foo`），但**同一节点可挂多个别名**（多次 `acm_checkpoint` 或 `backupCurrentHeadAs` 追加 label journal entry，不覆盖旧名）。omp-context 通过扫描全部 `label` 条目重建别名索引；OMP 原生 `getLabel()` 只反映最新一个。label 重放时若同名指向新 entry，会从旧 entry 的 alias list 移除该名。`acm_timeline` 的 `search` 对 label/内容**大小写不敏感**。

`list_checkpoints` 按**别名**逐条列出（同一 `entryId` 可出现多行）。timeline / `full_tree` 显示为 `checkpoint: foo, bar`。

`target: "root"` 解析为 **第一个 top-level 节点**；多根会话会 notify，优先用显式 checkpoint 名或节点 ID。

`acm_travel` 的 `backupCurrentHeadAs` 同样落在最近有意义的 USER/AI 消息上，而不是 raw HEAD（避免 backup 打在 `acm_timeline` 等 tool result 上）。若从 HEAD 回退，tool result 会写明 `backup@entryId (resolved from HEAD …)`。若 backup 已写入但 `branchWithSummary` 失败，extension 会 **best-effort 回滚** backup label；回滚失败时 error/details 会注明 label 仍留在树上。

### timeline 是会话树结构视图

`acm_timeline` 默认只展示 **active path**（LLM 实际看到的 spine），并附带 context HUD。`verbose: true` 仅在 **active path 模式**下显示 ACM 工具调用及 system/custom 元消息；`list_checkpoints` / `search` / `full_tree` 会忽略 `verbose`。

- context usage
- active path 节点数
- off-path summary 数（abandoned `branch_summary` 脚注，非所有分叉）
- 距离最近 checkpoint 的 step 数
- travel cue
- 大树提示：优先 `list_checkpoints` 或 `search`

**默认模式不再把 off-path 的 `branch_summary` / `compaction` 插进主序列。** 在分支点以 `[off-path]` 脚注标出，避免假线性叙事。

`list_checkpoints: true` 扫描整棵树上的 checkpoint（显示上限 50，可用 `search` 缩小）；深树时优先于 `full_tree`。

`full_tree: true` 会渲染 `sm.getTree()` 返回的整棵会话树，包含 off-path branch、checkpoint label、HEAD、`branch_summary` 的 `branchPoint` / `origin` 元数据等。深度/行数超限时会截断并提示用 `list_checkpoints` 或 `search`。

`search` **默认全树搜索**（active + off-path），按 label、节点 ID、内容匹配；传了 `search` 就不再限于 active path。`list_checkpoints` 可与 `search` 组合缩小清单。

**模式优先级**（多参数同时传时只跑一种，其余忽略）：`list_checkpoints` > `search` > `full_tree` > 默认 active path。

### travel 使用 branchWithSummary + context event

当前 travel 方案是同步执行：

1. 解析 `target`，支持 checkpoint 名、节点 ID、`root`。
2. 如传入 `backupCurrentHeadAs`，先给当前 HEAD 打恢复 label（不是 travel 目标）。
3. 构造 handoff summary（用户提供的 `summary` 正文）。
4. guarded cast 到完整 `SessionManager`，调用：

```ts
sm.branchWithSummary(targetId, summary, {
  originId,
  originLabel,
  target,
  targetId,
  backupCurrentHeadAs,
}, true)
```

5. 设置 `contextRefresh.markPending(sessionManager)`（按 session 实例隔离）。
6. `pi.on("context", ...)` 在**每次** LLM 调用前从 `sm.buildSessionContext()` 重建 messages 并覆盖发给模型的上下文。`branchWithSummary` 只切 session-manager 的 leaf，不同步 OMP agent 持有的 `agent.state.messages`（扩展无 `agent.replaceMessages` 能力——OMP 核心每次改 tree 后都显式调它，扩展层做不到）。因此采用持久覆盖：travel 后**每个** LLM turn 都 rebuild，保证模型始终看到新分支。session-manager leaf 正确、新消息也 append 到正确 leaf，故每轮 rebuild 都含最新交互。rebuild 失败则 `recordFailedAttempt`（最多 3 次重试，HUD 显示 retry 进度），耗尽后 `clearPending` 并回退到 `event.messages`、保留 failure 提示 reload。pending 由 `session_start`/`session_shutdown` 或 rebuild 失败耗尽清除。

travel tool result `details` 含 `sessionMessages`（字符串 delta）、`messagesBefore`/`messagesAfter`、`summaryEntryId`、`contextRefreshPending`。**无** legacy `summaryEntry` 别名字段。

travel 改的是 OMP 会话历史树和发给模型的上下文，不会回滚磁盘文件、进程、浏览器状态、远端服务或任何外部副作用。

travel 不保证降 token：目标在噪音之前通常 structural `shrunk`，目标在大量 raw history 之后通常 structural `restored`。tool result 报告可靠的 `usageBefore` 与同步 **估算** `estimatedUsageAfter` / `estimatedEffect`（`buildSessionContext` + token estimator）；官方 `usageAfter` 仍为 `pending_next_context_event`，下一步 `acm_timeline` HUD 可确认。details **无** legacy `effect` 字段。`list_checkpoints` 的 `~% est.` 仅估算 target path（不含 travel summary）。`sessionMessages` / `structuralEffect` 立即可信。

### 已知限制：compaction 可能冲掉 travel

持久覆盖只修了 LLM outbound context——模型每轮看到的 messages 是对的。但 OMP agent 内部的 `agent.state.messages` 仍旧是 travel 前的旧数组，扩展无法同步（需 OMP 上游暴露 `replaceMessages` 或在 `branchWithSummary(fromExtension=true)` 时自动同步）。

由此带来一个隐患：`#runPrePromptCompactionIfNeeded`（agent-session 内部，在 `emitContext` 之前）基于 `agent.state.messages` 判断是否触发自动压缩。travel 的目的常是逃离大上下文，但旧 `agent.state.messages` 仍是大数组——若它触发 compaction，会用旧路径压缩后的 messages 调 `replaceMessages`，彻底覆盖 travel。扩展层的持久 context 覆盖拦不住这个（compaction 在 `emitContext` 之前执行）。

当前缓解：无扩展层方案。旧 `agent.state.messages` 若已低于 compaction 阈值则安全；若接近/超过阈值，travel 后仍可能触发 compaction 冲掉新分支。用户可手动检查 `acm_timeline` HUD 确认状态。彻底修复需 OMP 上游配合（暴露 state 同步能力，或让 extension 触发的 `branchWithSummary` 也走核心的 state-sync 路径）。

### 没有 /acm command

当前代码没有 `/acm` command、`navigateTree()`、`turn_end`/`agent_end`/`session_before_tree` 流程，也没有 `session_stop` continuation。

## 关键设计决策

### 使用 guarded runtime cast

`ctx.sessionManager` 类型是 `ReadonlySessionManager`，但运行时是完整 `SessionManager`。当前实现为了获得必要能力，使用 guarded cast 调用内部方法：

- `appendLabelChange`
- `branchWithSummary`
- `buildSessionContext`

调用前必须检查方法存在，并在缺失时返回清晰错误。不要静默失败。

### BranchSummaryEntry.fromId 是 branch point，不是 origin

OMP 的 `fromId` 字段表示 branch point（travel target），不是旧 HEAD。timeline 渲染使用 `branchPoint` / `origin`（来自 `details`），不要把 `fromId` 显示成 `from`。

### zod schema 使用 TSchema cast

`registerTool<TParams extends TSchema>` 的类型约束不直接接受 `pi.zod.object(...)` 生成的 schema。当前代码使用：

```ts
parameters: schema as unknown as TSchema
```

运行时 schema 仍来自 `pi.zod`，不要改成独立导入的 zod 实例。

### 类型导入用子路径

Node16 moduleResolution 下需要从 OMP 子路径导入类型：

- `@oh-my-pi/pi-coding-agent/extensibility/extensions/types`
- `@oh-my-pi/pi-coding-agent/session/session-manager`
- `@oh-my-pi/pi-coding-agent/session/session-entries`
- `@oh-my-pi/pi-ai/types`

### 工具命名使用 acm_ 前缀

三个工具名固定为 `acm_checkpoint`、`acm_timeline`、`acm_travel`。

## 结构

| 路径 | 作用 |
|---|---|
| `src/index.ts` | 三个工具注册、checkpoint label、timeline 渲染、同步 travel、context refresh |
| `src/lib.ts` | 可单测的纯逻辑（label maps、resolve、usage 估算、meaningful entry、timeline 模式） |
| `src/lib.test.ts` | `lib.ts` 单元测试 |
| `skills/context-management/SKILL.md` | 驱动 agent 使用 checkpoint/timeline/travel 的 prompt |
| `skills/context-management/references/` | 场景化上下文管理参考 |
| `README.md` | 面向用户的安装和功能说明 |
| `.omp-plugin/marketplace.json` | marketplace 元数据 |

## 开发注意事项

- 改实现前先读 `src/index.ts` 中对应工具的完整 execute flow。
- 不要在代码中用 `console.log`；需要日志时优先使用 OMP 提供的 logger 能力。
- 不要把 travel 解释成文件系统回滚。它只影响会话上下文。
- 验证类型用 `bun run typecheck`。
