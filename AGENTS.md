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
- `@oh-my-pi/pi-coding-agent` ExtensionAPI 作为 peer dependency（`^16.3.15`）, 由 OMP 运行时提供
- `@oh-my-pi/pi-agent-core`（token estimator）同为 peer/dev dependency（`^16.3.15`）
- 工具参数 schema 使用运行时注入的 `pi.zod`
- Source-first: OMP 直接加载 `src/*.ts`, 不打包 `dist/`

## 当前实现

### 扩展入口

`src/index.ts` 默认导出 `function(pi: ExtensionAPI): void`，在加载时注册三个工具和六个事件 handler（`context`、`turn_end`、`session_before_compact`、`session_compact`、`session_start`、`session_shutdown`）。

`package.json` 的 `omp` 字段是 OMP 发现入口：

```json
{
  "extensions": ["./src/index.ts"],
  "skills": ["./skills"]
}
```

### checkpoint 使用 appendLabelChange

不要用 `pi.setLabel(id, name)` 给会话节点打 label。OMP 16.3.15 的类型声明看起来支持两个参数，但实际 `ConcreteExtensionAPI.setLabel(label: string)` 仍只修改扩展显示名，不会写 session label。

当前实现用 `setEntryLabel(sm, entryId, label)` guarded cast 到完整 `SessionManager`，调用 `appendLabelChange` 前检查方法存在，调用后验证返回的是非空 entry ID；失败必须返回明确错误，不能静默继续。

`acm_checkpoint` 的默认 target 是 active branch 上最近的有意义 **USER/AI 消息**，跳过 tool result、bash/custom/system 消息、无可见文字的 internal-tool-only AI turn、空消息等。显式 `target` 可用任意节点 ID（含 tool result），但会 warning；**auto-resolve 仍只选 USER/AI**。

checkpoint / `backupCurrentHeadAs` **名称**在整棵树内必须唯一且**大小写敏感**（`Foo` ≠ `foo`），但**同一节点可挂多个别名**（多次 `acm_checkpoint` 或 `backupCurrentHeadAs` 追加 label journal entry，不覆盖旧名）。omp-context 通过扫描全部 `label` 条目重建别名索引；OMP 原生 `getLabel()` 只反映最新一个。label 重放时若同名指向新 entry，会从旧 entry 的 alias list 移除该名。`acm_timeline` 的 `search` 对 label/内容**大小写不敏感**。

`list_checkpoints` 按**别名**逐条列出（同一 `entryId` 可出现多行），active-path checkpoint 优先按路径顺序排列，off-path 再按时间、entry ID、label 排列；同一节点别名会聚在一起。timeline / `full_tree` 显示为 `checkpoint: foo, bar`。

`target: "root"` 解析为 **第一个 top-level 节点**；多根会话会 notify，优先用显式 checkpoint 名或节点 ID。

`acm_checkpoint` 的成功 tool result 会附带当前 context usage 和 **fold candidates**：最近锚点是 phase/burst candidate；active path 上最早的 `-start` 是 possible task-chain candidate。runtime 文案必须强调 **Choose by boundary, not proximity**，candidate 只有在位于要压缩的 semantic boundary 之前时才是正确 target，避免 agent 被最近锚点或机械 earliest 锚点吸走。名字以 `-done` 结尾的 checkpoint 结果描述为 milestone/archive pointer：后续失败可回到这里；任务结束时要从 handoff 给最终回答。

当前 skill 的核心领域模型是 `working set / boundary / handoff / archive / anchor gravity`。checkpoint 创建 recoverability；travel 把边界后的历史压缩成 recoverable handoff；handoff 使用 `Goal/State/Evidence/External/Exclusions/Recover/NEXT`，其中 `NEXT` 必须是一个可执行动作。task-end fold 仍通过 `acm_travel({ target: "<task-chain-start>", backupCurrentHeadAs: "<task>-done", summary })` 一次完成，随后从 handoff branch 给最终回答。锚点是便利品不是前提：`acm_travel`/`acm_checkpoint` 都接受裸 node ID；无锚时用 timeline 找到 boundary 前最后干净节点。三个工具的 description、参数说明、返回提示和错误恢复文案必须与 skill 同词，不要把 nearest/earliest 写成自动选择规则。

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

`search` **默认全树搜索**（active + off-path），按 label、节点 ID、内容匹配；传了 `search` 就不再限于 active path。搜索使用 literal pattern，并先做低成本字段匹配，只有命中时才构造 preview，避免对整棵树里的大型 tool result 反复拼接和 lower-case。`list_checkpoints` 可与 `search` 组合缩小清单。

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

5. 设置 `contextRefresh.markPending(sessionManager)`（按 session 实例隔离），并用 `WeakMap` 记录 branch-summary leaf 作为稳定 fallback。
6. `pi.on("context", ...)` 在**每次** LLM 调用前通过公开的 compaction-aware `buildSessionContext()` 重建 messages 并覆盖发给模型的上下文。`branchWithSummary` 只切 session-manager 的 leaf，不同步 OMP agent 持有的 `agent.state.messages`（扩展无 `agent.replaceMessages` 能力）。因此采用持久覆盖：travel 后**每个** LLM turn 都 rebuild；若当前 leaf 暂时无法重建，则回退到记录的 summary leaf。rebuild 会修复 orphan tool call/result；失败最多重试 3 次，HUD 显示原因和进度，成功后清除旧 failure/attempt 但保持 persistent pending。`session_start`/`session_shutdown`/`session_compact` 会清当前 session 的 refresh、fallback leaf 和 cached usage。

travel tool result `details` 含 `sessionMessages`（字符串 delta）、`messagesBefore`/`messagesAfter`、`summaryEntryId`、`contextRefreshPending`。**无** legacy `summaryEntry` 别名字段。

travel 改的是 OMP 会话历史树和发给模型的上下文，不会回滚磁盘文件、进程、浏览器状态、远端服务或任何外部副作用。

travel 不保证降 token：目标在噪音之前通常 structural `shrunk`，目标在大量 raw history 之后通常 structural `restored`。tool result 报告可靠的 `usageBefore` 与同步 **估算** `estimatedUsageAfter` / `estimatedEffect`（`buildSessionContext` + token estimator）；官方 `usageAfter` 仍为 `pending_next_context_event`，下一步 `acm_timeline` HUD 可确认。details **无** legacy `effect` 字段。`list_checkpoints` 的 `~% est.` 仅估算 target path（不含 travel summary）。`sessionMessages` / `structuralEffect` 立即可信。

### 已知限制：native agent state 仍可能滞后

持久覆盖只修复模型出站 context；OMP agent 内部的 `agent.state.messages` 在 extension 直接调用 `branchWithSummary` 后仍可能保留 travel 前数组。OMP 16.3.15 的原生 `AgentSession.navigateTree()` 会在 tree mutation 后调用 `agent.replaceMessages()`，但 `navigateTree` 只暴露给 command context，custom tool 的 `ExtensionContext` 无法调用，因此 ACM tool 仍不能走这条原生同步路径。

`#runPrePromptCompactionIfNeeded` 在 `emitContext` 前根据 agent state 估算阈值，所以 travel 后可能发生一次本不必要的 native compaction；compaction 会从当前 SessionManager branch 重建并同步 agent state，但可能比预期更早消耗 handoff。当前扩展层无法直接消除这个触发窗口。彻底修复需要 OMP 上游把 tree navigation/state sync 暴露给 tool context，或让 `branchWithSummary(fromExtension=true)` 自动同步 agent messages。

### 没有 /acm command

当前代码没有 `/acm` command，也不调用 command-only 的 `navigateTree()`，没有 `agent_end`/`session_before_tree` 流程或 `session_stop` continuation；`turn_end` 仅用于缓存真实 prompt token usage。

## 关键设计决策

### 使用 guarded runtime cast

`ctx.sessionManager` 类型是 `ReadonlySessionManager`，但运行时是完整 `SessionManager`。当前实现为了获得必要能力，使用 guarded cast 调用内部方法：

- `appendLabelChange`
- `branchWithSummary`

调用前必须检查方法存在并验证返回的 entry ID；缺失或异常时返回清晰错误。消息重建使用 `session-context` 公开导出的 `buildSessionContext()`，不再依赖 runtime cast。

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
| `skills/context-management/SKILL.md` | runtime prompt 的道层：working set / boundary / handoff / archive / anchor gravity，fold gate，checkpoint/fold discipline，handoff contract |
| `skills/context-management/references/playbook.md` | boundary reference：按 Burst / Phase / Failed direction / Batch / Task chain / Interleaved fronts / Missing anchor 帮助识别 boundary、选择 target、写 handoff |
| `README.md` | 面向用户的安装和功能说明 |
| `.omp-plugin/marketplace.json` | marketplace 元数据 |

## 开发注意事项

- 改实现前先读 `src/index.ts` 中对应工具的完整 execute flow。
- 不要在代码中用 `console.log`；需要日志时优先使用 OMP 提供的 logger 能力。
- 不要把 travel 解释成文件系统回滚。它只影响会话上下文。
- 验证类型用 `bun run typecheck`。
