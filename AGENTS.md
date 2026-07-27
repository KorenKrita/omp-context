# AGENTS.md — omp-context 维护契约

## 项目定位

`omp-context` 将 `KorenKrita/pi-context` 的 Agentic Context Management 行为移植到 OMP。它提供三个工具：

- `acm_checkpoint`：追加可恢复的语义 label。
- `acm_timeline`：观察 active/checkpoints/search/tree 证据与 context HUD。
- `acm_travel`：通过七字段 handoff 执行 fold、rebase 或 rehydrate。

判断语义的唯一正典是 `skills/context-management/CORE.md`、`TOOL-CONTRACTS.md` 与按需加载的 advanced Skill references。`src/generated-guidance.ts` 必须由 `bun scripts/generate-guidance.mjs` 生成，不手改。

## 精确宿主契约

当前唯一支持的 OMP 版本是 **17.1.5**。根 package、peer dependencies、host fixture 与 lockfile 必须保持精确一致：

- `@oh-my-pi/pi-agent-core`
- `@oh-my-pi/pi-ai`
- `@oh-my-pi/pi-coding-agent`
- `@oh-my-pi/pi-tui`

版本升级必须通过 `scripts/precommit-host-contract.mjs` 的隔离 promotion，再更新契约。不要引入 `@earendil-works/*` 或 Pi-only API。

## OMP API 映射

- Extension 类型：`@oh-my-pi/pi-coding-agent/extensibility/extensions/types`。
- Session entries/tree：`@oh-my-pi/pi-coding-agent/session/session-entries`。
- Session manager：`@oh-my-pi/pi-coding-agent/session/session-manager`。
- Agent messages：`@oh-my-pi/pi-agent-core/types`。
- TUI：`@oh-my-pi/pi-tui`。
- Tool schema：只使用宿主注入的 `pi.zod`，顶层 object 必须 `.strict()`。
- OMP tool renderer 签名是 `renderCall(args, options, theme)` 与 `renderResult(result, options, theme, args?)`；返回普通 `Text`。
- OMP 没有 Pi 的 `promptSnippet`、`promptGuidelines`、`renderShell` 或 `constrainedSampling`。短 tool cues 经 `before_agent_start.systemPrompt: string[]` 幂等注入。
- OMP 没有 `agent_settled`。native context replacement 的等价边界是 `session_stop`，且必须通过 `ctx.isIdle()` 与 `ctx.hasPendingMessages()` 防止 queued continuation/retry 竞态。
- OMP `session_stop` 先于 notification-only `agent_end`，handler 返回 continuation 时宿主排入隐藏下一轮；ACM settlement handler本身不请求 continuation。
- OMP `session_before_tree` 只能取消或直接提供完整 summary，不能覆盖 summarizer prompt。保留 OMP 原生 tree summarization，不伪造等价能力。
- `SlashCommandInfo` 的来源路径字段是 `.path`。
- `BranchSummaryEntry` 的扩展来源字段是 `.fromExtension`。

## 架构边界

- `host-bridge.ts` 是 SessionManager mutation 与 context reconstruction 的唯一宿主 seam。
- `live-agent-session-adapter.ts` 只做 capability-probed native message replacement，不拥有树 mutation。
- `context-packet.ts` 是 provider continuation authority；必须保持 tool-call/result protocol valid。
- finalized `acm_travel` receipt 之前不得 provider cutover；matching non-error、`mutationStatus: applied`、structured-v1 receipt 才授权。
- native AgentSession replacement 与 provider packet delivery是两个独立状态；前者失败不能回滚已经核验的持久 travel。
- raw archive alias 只用于 restore/rehydrate，不作为 fold/rebase base。
- 每次 mutation 返回 `applied`、`not_applied` 或 `indeterminate`，未知结果不得降格为成功。

## Handoff 与恢复

结构化 handoff 固定为 `goal/state/evidence/external/exclusions/recover/next`。`goal`、`state`、`next` 不允许空或 `none`；其余字段无内容时写 `none`。兼容 fallback 只接受能精确解析为该对象的 JSON string。

Travel 只改变会话树和后续上下文，不触碰文件、进程、Git 或远端系统。发生 live replacement、provider rebuild 或 rollback 不确定性时，保留持久 branch 和 recovery pointer，并用 `ctx.ui.notify()` 提供可执行上下文。

## Context gauge

Gauge 使用模型窗口与 400K 的较小值作为 working budget。非 ACM、非错误 tool result 只在整数压力变化时显示；`ACM_GAUGE_DISABLED=1` 时完全禁用。Provider cutover 后优先使用实际 provider `turn_end` usage，不能让 origin-run native usage 覆盖新 epoch。

## 测试契约

旧 OMP 30/50/70 nudge 测试已被最新 pi-context 行为测试替换。非平凡分支、协议修复、mutation recovery 和生命周期竞态必须有 runnable coverage。

完整验证：

```bash
bun run verify:acm
```

该 gate 必须依次覆盖：

1. generated guidance 与 exact host version 契约；
2. 根测试套件；
3. production TypeScript typecheck；
4. `test/host-fixture` 在真实 OMP 17.1.5 上的 source build 与 host tests。

Host fixture 至少覆盖 strict schema、CORE/tool-cue prompt 注入、OMP Skills prompt、automatic checkpoint anchor、current/target protocol validation、finalized receipt ordering、provider cutover、idle `session_stop` native replacement、replacement failure recovery、cache fallback/exhaustion、repeat travel、off-path restore、resume 与 SessionManager 隔离。

## 文档与实现决策

宿主差异、无法等价映射的能力和选择理由写入 `implementation-notes.html`，标记 `agent-resolved` 或 `user-decided`。不要把 Pi 的宿主细节写成 OMP 当前事实。

不使用 `console.log`；用户可见 warning 使用 `ctx.ui.notify()`。
