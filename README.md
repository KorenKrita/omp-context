# omp-context

`omp-context` 是由 KorenKrita 独立维护的第三方 OMP Agentic Context Management（ACM）插件，不是 OMP 官方组件。它注册 `acm_checkpoint`、`acm_timeline`、`acm_travel`，并通过公开的 `before_agent_start` hook 交付 always-on CORE。

## 仓库关系

- 在 KorenKrita 维护的 `omp-context` / `magic-acm-context` 两个仓库之间，`omp-context` 是 ACM 实现与 guidance 的唯一同步源；Host Bridge、CORE、advanced Skill 与生成产物都从这里维护。
- `magic-acm-context` 是 consumer，只能通过本仓库的 `bun run sync:acm` 手动接收已声明的 ACM surface；同步方向不可逆。
- standalone extension 直接注册 CORE prompt hook；integrated consumer 禁用该 hook，并由唯一的 consumer prompt orchestrator 调用 canonical `ensureAcmCoreSegment` 后组合 Magic Context-owned segments。两者共享同一 CORE producer，不形成 functional fork。

## 架构与 guidance 所有权

| 区域 | 责任 |
|---|---|
| `src/index.ts` | 短 composition root；只组装 runtime、工具和 lifecycle |
| `src/checkpoint-tool.ts` / `src/timeline-tool.ts` / `src/travel-tool.ts` | 各工具独立的 schema、执行流与结果契约 |
| `src/travel-coordinator.ts` | 单次 travel mutation transaction、compensation 与 refresh obligation |
| `src/host-bridge.ts` | typed guarded mutation ports；区分 `not_applied`、`applied`、`indeterminate` |
| `src/runtime-lifecycle.ts` / `src/runtime.ts` | context rebuild、live AgentSession sync、compaction、usage 与 session-scoped state |
| `src/live-agent-session-adapter.ts` | OMP 16.4.5 专用的窄 live-state adapter；按 SessionManager identity 捕获并同步 AgentSession |
| `src/label-journal.ts` / `src/lib.ts` | dependency-free label replay 与纯领域逻辑 |
| [`skills/context-management/CORE.md`](skills/context-management/CORE.md) | normal-path agent contract 的唯一来源 |
| [`skills/context-management/SKILL.md`](skills/context-management/SKILL.md) | 只路由 non-obvious target、archive round trip 与 exceptional recovery |
| `src/generated-guidance.ts` | 由 CORE marker 生成；禁止手改 |

七槽 handoff 是 agent completion criterion，不是 runtime 对语义正确性的证明。插件只能校验可观察结构，不能证明 target 位于正确的 semantic boundary 之前、rebase snapshot 通过 cold start、raw detail 足够可恢复，或 `NEXT` 真正可执行。高 context pressure 只触发 rebase check，不会降低 cold start gate 或自动授权 travel。

## 安装

```bash
# 本地
omp install .

# GitHub
omp install github:KorenKrita/omp-context

# marketplace
/marketplace add KorenKrita/omp-context
/marketplace install omp-context@omp-context
```

## 支持的 OMP 版本

支持的 OMP 版本：`16.4.5`。`@oh-my-pi/pi-coding-agent`、`@oh-my-pi/pi-agent-core` 和 `@oh-my-pi/pi-ai` 的 peer、development、lock 与本地安装版本必须完全一致；项目不声明兼容范围，也不维护多版本 shim。

未来升级必须先把候选版本作为 **isolated candidate** 放进 `test/host-fixture`，在不启动模型或使用 API key 的前提下验证 real SessionManager 与 captured extension handlers。候选验证至少审查：

- `extension events`
- `public context APIs`
- `Host Bridge capabilities`
- `session-context construction`
- `tool registration`
- `token estimation`
- `compaction events`
- `changelog review`

运行 `bun run test:host`、相关 focused tests 和 `bun run typecheck` 后，才可在一个原子变更中 **atomically replace every exact OMP version**：同时更新根 peer/development 声明、lock、已安装依赖、支持文档与隔离 fixture。不得扩大版本范围。

`16.4.2 → 16.4.5` 审查结论：`SessionManager`、session entry、token estimation 与 ACM 使用的 tool registration/event contract 未发生破坏性变化；`session-context` 只新增 transcript 专用的 `keepDanglingToolCalls` 选项，默认 provider-context 重建行为不变。OMP 16.4.5 的 task tool wire schema 发生 breaking change，但 ACM extension 不调用或封装该 tool，因此无需兼容代码。

## 手动同步到 consumer

canonical 与 consumer root 都是必填绝对或可解析路径：

```bash
bun run sync:acm -- \
  --canonical-root /path/to/omp-context \
  --consumer-root /path/to/magic-acm-context
```

同步命令读取 `scripts/acm-sync-manifest.json`。它先校验 package identity、consumer layout、source、destination、transform match cardinality 与 preserved wrapper；随后在 consumer 内的 staging tree 生成并独立验证全部产物。发布阶段为所有目标建立 rollback journal，任一 rename 或最终验证失败都会恢复本次已替换的全部文件，不留下 partial consumer state。

Manifest 当前声明 46 个 canonical mappings，并额外生成带 canonical version、exact host version、manifest hash 与每个产物 SHA-256 的 `acm-provenance.json`。映射包含 pinned live AgentSession adapter、runtime regression tests 与对应 real-host fixtures，避免 consumer 接收引用却缺少实现。输出逐行 `changed <path>`；重复运行输出 `no changes`。

```bash
bun run sync:acm -- \
  --canonical-root /path/to/omp-context \
  --consumer-root /path/to/magic-acm-context \
  --verify-only
```

命令不会执行任何 Git 操作：不 stage、commit、fetch、merge、rebase 或 push。canonical 与 consumer 的结果必须在各自仓库分别提交。

## 已知 host 限制

- OMP 16.4.5 未向普通 tool context 暴露原子的 tree-navigation/state-sync API。Typed host mutation ports 因而观察 mutation 前后状态，并返回 `not_applied`、`applied` 或 `indeterminate`；只要 branch mutation 已发生或无法排除，travel coordinator 就保留恢复标签并安排 context refresh。
- 成功 travel 会在对应 `acm_travel` 的 `tool_execution_end` 后，通过精确版本检查的窄 adapter 从当前 SessionManager leaf 重建消息并调用 live AgentSession 的公开 `agent.replaceMessages()`。关联只按 SessionManager 对象 identity 建立，使用弱引用，不猜测其他私有字段，也不复制 synthetic tool call 或 compaction entry。
- adapter 依赖 OMP 16.4.5 的 `AgentSession.getContextUsage` lifecycle seam 来捕获 live session。host 版本或 shape 不匹配、association 缺失或 replacement 失败时，持久 SessionManager branch 与公开 `context` event rebuild 仍然有效；HUD 会报告 `unavailable`、`failed` 或 `skipped` 并给出 reload guidance。
- 成功 live sync 后，native stored-context accounting 使用 traveled branch，不会因 pre-travel message array 立即触发 stale auto-compaction。插件仍不取消、延迟或替换真实的 OMP compaction。
- timeline 报告 active summary depth，并在 checkpoint catalog 中显示 root structural candidate 与 travel 后的 projected summary depth；这些都是 target-selection evidence，不是 rebase safety verdict。
- travel 只改变会话树与后续 model context；不会回滚文件、进程、浏览器、commit 或远端副作用。成功结果会报告 factual summary-depth delta，但不会声称 runtime 已证明 cold start completeness。

## Guidance 维护

人类文档只记录架构、支持与维护事实；agent normal path 以 [CORE](skills/context-management/CORE.md) 为准，advanced branches 以 [Skill package](skills/context-management/SKILL.md) 为准。不要把 agent operating discipline 复制回 README。

真实会话观察记录在 [`docs/agents/acm-dogfooding.md`](docs/agents/acm-dogfooding.md)。未来 guidance 变更必须由一条带证据的 **observed failure** 或 **changed host contract** 驱动；不要为假设中的弱模型行为追加规则。

## 验证

```bash
# 非写入式 canonical gate：generated guidance、exact version、fixture 和 provenance contracts
bun run verify:acm

bun run typecheck
bun test
bun run test:host
```

## 参考

- [pi-context](https://github.com/ttttmr/pi-context) — 原始项目 by ttttmr
- [让 AI 主动管理自己的上下文](https://blog.xlab.app/p/6a966aeb/) — 设计思路
