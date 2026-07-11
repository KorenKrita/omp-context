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
- `@oh-my-pi/pi-coding-agent` ExtensionAPI 作为 peer dependency（精确版本 `16.4.2`），由 OMP 运行时提供
- `@oh-my-pi/pi-agent-core`（token estimator）和 `@oh-my-pi/pi-ai` 同为精确版本 `16.4.2` 的 peer/dev dependency
- 工具参数 schema 使用运行时注入的 `pi.zod`
- Source-first: OMP 直接加载 `src/*.ts`, 不打包 `dist/`

## 当前实现

### 扩展入口

`src/index.ts` 是短 composition root，默认导出 `registerAcmExtension(pi, options?)`。standalone 默认注册三个工具和七个事件 handler；integrated consumer 传 `{ promptInjection: false }`，由 consumer 的唯一 prompt orchestrator 调用 canonical `ensureAcmCoreSegment`。

`package.json` 的 `omp` 字段是 OMP 发现入口：

```json
{
  "extensions": ["./src/index.ts"],
  "skills": ["./skills"]
}
```

### checkpoint 使用 appendLabelChange

不要用 `pi.setLabel(id, name)` 给会话节点打 label。OMP 16.4.2 的类型声明看起来支持两个参数，但实际 `ConcreteExtensionAPI.setLabel(label: string)` 仍只修改扩展显示名，不会写 session label。

当前实现通过 `appendCheckpointLabel()`、`applyBranchWithSummary()` 和 `rollbackCheckpointLabel()` 三个 typed mutation ports 访问完整 `SessionManager`。结果明确区分 `not_applied`、`applied` 与 `indeterminate`；返回值畸形时以 mutation 后可观察的 journal/leaf 状态为准，不能仅依赖 host 返回 ID。

`acm_checkpoint` 的默认 target 是 active branch 上最近的有意义 **USER/AI 消息**，跳过 tool result、bash/custom/system 消息、无可见文字的 internal-tool-only AI turn、空消息等。显式 `target` 可用任意节点 ID（含 tool result），但会 warning；**auto-resolve 仍只选 USER/AI**。

checkpoint / `backupCurrentHeadAs` **名称**在整棵树内必须唯一且**大小写敏感**（`Foo` ≠ `foo`），但**同一节点可挂多个别名**（多次 `acm_checkpoint` 或 `backupCurrentHeadAs` 追加 label journal entry，不覆盖旧名）。omp-context 通过扫描全部 `label` 条目重建别名索引；OMP 原生 `getLabel()` 只反映最新一个。label 重放时若同名指向新 entry，会从旧 entry 的 alias list 移除该名。`acm_timeline` 的 `{ view: "search", query }` 对 label/内容**大小写不敏感**。

`{ view: "checkpoints" }` 按**别名**逐条列出（同一 `entryId` 可出现多行），active-path checkpoint 优先按路径顺序排列，off-path 再按时间、entry ID、label 排列；同一节点别名会聚在一起。active/tree 视图显示为 `checkpoint: foo, bar`。

`target: "root"` 解析为 **第一个 top-level 节点**；多根会话会 notify，优先用显式 checkpoint 名或节点 ID。

`acm_checkpoint` 的成功结果是 progressive placement evidence：文本和 `details` 报告 `status`、checkpoint/label entry ID、resolved role、aliases、automatic/explicit target resolution、跳过的 transient entries 和当前 context usage。结果只附一个由 canonical guidance 生成的 next cue：普通 checkpoint 继续当前 working set；`-done` checkpoint 作为 milestone/archive retreat pointer。它不替 agent 选择 fold boundary 或 target，也不再返回 nearest/earliest fold candidates。

`skills/context-management/CORE.md` 是 normal-path agent guidance 的唯一可编辑来源，`SKILL.md` 只负责 advanced branch routing。本知识文档只记录实现所有权、生成链路与可观察 host contract，不重复 agent 的决策流程、handoff 模板或 fold policy。

`acm_travel` 的 `backupCurrentHeadAs` 落在最近有意义的 USER/AI 消息上。`travel-coordinator.ts` 拥有单次 mutation transaction：branch 明确未应用时通过 operation-scoped token 恢复之前的完整 alias 集；branch 已应用或状态不确定时保留 backup，并强制安排 context refresh，避免在未知 branch 上继续旧 provider context。

### timeline 是严格的单视图会话树接口

`acm_timeline` 使用单一 `view` 鉴别器；省略 `view` 等价于 `{ view: "active" }`。旧参数 `list_checkpoints`、`full_tree`、`search` 和竞争布尔组合会被 strict schema 拒绝，不做兼容转换。

- `{ view: "active", limit?, verbose? }`：只展示 active path（LLM 实际看到的 spine）并附带 context HUD；`verbose: true` 显示 ACM 工具调用及 system/custom 元消息。
- `{ view: "checkpoints", limit?, filter? }`：扫描整棵树上的 checkpoint alias；`filter` 对 label 和 entry ID 做大小写不敏感匹配。
- `{ view: "search", limit?, query }`：在整棵树（active + off-path）按 label、节点 ID、内容做大小写不敏感搜索；`query` 必填且非空。
- `{ view: "tree", limit? }`：渲染 `sm.getTree()` 的整棵树，包括 off-path branch、checkpoint label、HEAD 和 `branch_summary` 的 `branchPoint` / `origin` 元数据。

active HUD 包含 context usage、active path 节点数、off-path summary 数、距最近 checkpoint 的 step 数和 travel cue。默认 active 视图不会把 off-path `branch_summary` / `compaction` 插进主序列，而是在分支点以 `[off-path]` 脚注标出，避免假线性叙事。

checkpoint 列表上限 50；大树或 tree 截断时优先改用 `{ view: "checkpoints" }` 或 `{ view: "search", query: "..." }`。搜索先做低成本字段匹配，只有命中时才构造 preview，避免对大型 tool result 反复拼接和 lower-case。

### travel 使用 branchWithSummary + context event

当前 travel 方案由 `travel-tool.ts` 与 `travel-coordinator.ts` 分工：

1. Tool 解析 target、校验七槽 handoff、建立 usage/message evidence，并完成 branch 与 backup prevalidation。
2. Coordinator append backup label，获得包含 prior aliases 的 operation-scoped rollback token。
3. Typed branch port 调用 `branchWithSummary(..., true)`，随后验证实际 leaf、entry type、parent 与 summary，而不是信任返回 ID。
4. 精确观察到期望 summary 时提交 transaction；明确未应用时补偿 backup；mutation 已发生或无法排除时返回 `indeterminate`，保留恢复标签并设置 refresh obligation。
5. `runtime-lifecycle.ts` 在每次 LLM 调用前通过公开的 compaction-aware `buildSessionContext()` 重建 messages；失败最多重试 3 次，HUD 显示原因与进度。`session_start`、`session_shutdown`、`session_compact` 清当前 session state。

travel tool result `details` 保留 resolved target、origin、`summaryEntryId`、backup outcome、`messagesBefore`/`messagesAfter`、`contextRefreshPending` 等结构标识，并新增 raw `tokenDelta`、`percentagePointDelta`、`structuralMessageDelta` 与 factual `structuralMessageDirection`。**无** legacy `summaryEntry` 别名字段。

travel 改的是 OMP 会话历史树和发给模型的上下文，不会回滚磁盘文件、进程、浏览器状态、远端服务或任何外部副作用。

travel 不保证降 token，也不再给出基于 500-token/2-percent 阈值的 `estimatedEffect` / `structuralEffect` 语义 verdict。tool result 直接报告 `usageBefore`、同步估算的 `estimatedUsageAfter`、token delta、percentage-point delta、message counts 与精确 message-count direction；不可用 usage 用 `null` / `unknown`，不能归类为 no saving。官方 `usageAfter` 仍为 `pending_next_context_event`，下一步 `acm_timeline` HUD 可确认。

### 已知限制：native agent state 仍可能滞后

持久覆盖只修复模型出站 context；OMP agent 内部的 `agent.state.messages` 在 extension 直接调用 `branchWithSummary` 后仍可能保留 travel 前数组。OMP 16.4.2 的原生 `AgentSession.navigateTree()` 会在 tree mutation 后调用 `agent.replaceMessages()`，但 `navigateTree` 只暴露给 command context，custom tool 的 `ExtensionContext` 无法调用，因此 ACM tool 仍不能走这条原生同步路径。

`#runPrePromptCompactionIfNeeded` 在 `emitContext` 前根据 agent state 估算阈值，所以 travel 后可能发生一次本不必要的 native compaction；compaction 会从当前 SessionManager branch 重建并同步 agent state，但可能比预期更早消耗 handoff。当前扩展层无法直接消除这个触发窗口。彻底修复需要 OMP 上游把 tree navigation/state sync 暴露给 tool context，或让 `branchWithSummary(fromExtension=true)` 自动同步 agent messages。

### 没有 /acm command

当前代码没有 `/acm` command，也不调用 command-only 的 `navigateTree()`，没有 `agent_end`/`session_before_tree` 流程或 `session_stop` continuation；`turn_end` 仅用于缓存真实 prompt token usage。

## 关键设计决策

### Typed guarded mutation ports

`ctx.sessionManager` 的公开 read methods 直接作为 `SessionStructuralView` 使用。只有 OMP 未公开给 tool context 的 mutation capability 被隔离在 `src/host-bridge.ts`：

- `appendLabelChange`
- `branchWithSummary`

每个 port 都在调用前检查 capability，在调用后观察 journal/leaf，并返回穷尽 mutation state。Host Bridge 不保存跨操作的全局 rollback registry；rollback ownership 只存在于一次 travel transaction 的 token 中。消息重建使用公开的 `buildSessionContext()`。

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
| `src/index.ts` | 短 composition root；组装 prompt、三个工具和 lifecycle |
| `src/checkpoint-tool.ts` / `src/timeline-tool.ts` / `src/travel-tool.ts` | behavior-owned tool modules |
| `src/travel-coordinator.ts` | travel transaction、compensation 与 refresh obligation |
| `src/host-bridge.ts` | typed guarded mutation ports，不保存跨操作状态 |
| `src/runtime.ts` / `src/runtime-lifecycle.ts` | session-scoped refresh、usage、compaction 与 context rebuild |
| `src/entry-resolution.ts` / `src/message-sanitizer.ts` | meaningful entry resolution 与 orphan tool sanitation |
| `src/label-journal.ts` / `src/lib.ts` | dependency-free alias replay 与纯领域逻辑 |
| `src/generated-guidance.ts` | 从 canonical CORE / advanced guidance 派生的工具描述、正常 cue 与异常恢复片段 |
| `skills/context-management/CORE.md` | always-on 正常路径：领域词汇、fold gate、checkpoint/fold discipline、handoff contract |
| `skills/context-management/SKILL.md` | model-invoked advanced-only router |
| `skills/context-management/references/target-selection.md` | 非显然 target、interleaved fronts、missing anchor、raw node fallback、名称冲突 |
| `skills/context-management/references/archive-recovery.md` | archive detail recovery round trip 与 archive-drift 防护 |
| `skills/context-management/references/exceptional-recovery.md` | travel/rollback/refresh/restored-history/no-saving 异常恢复 |
| `test/host-fixture/` | 精确 OMP 16.4.2 的真实 SessionManager/runtime contract fixtures |
| `scripts/generate-guidance.mjs` | 从 canonical guidance 生成运行时 artifacts |
| `scripts/sync-acm.mjs` / `scripts/acm-sync-manifest.json` | declarative canonical → consumer 手动同步 |
| `README.md` | 面向用户的安装、行为与维护说明 |
| `.omp-plugin/marketplace.json` | marketplace 元数据 |

## 开发注意事项

- 改工具实现时直接读对应的 `*-tool.ts`；改 mutation/compensation 读 `travel-coordinator.ts` 与 `host-bridge.ts`；`src/index.ts` 只负责组合。
- 不要在代码中用 `console.log`；需要日志时优先使用 OMP 提供的 logger 能力。
- 不要把 travel 解释成文件系统回滚。它只影响会话上下文。
- 先运行对应 focused test；canonical 非写入式总 gate 使用 `bun run verify:acm`，类型检查使用 `bun run typecheck`。

## Agent skills

### Issue tracker

Issues are tracked as local Markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The canonical triage labels are `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain documentation layout. See `docs/agents/domain.md`.
