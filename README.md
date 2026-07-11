# omp-context

`omp-context` 是 OMP 的 Agentic Context Management（ACM）插件，也是唯一 canonical ACM 实现与 guidance 仓库。它注册 `acm_checkpoint`、`acm_timeline`、`acm_travel`，并通过公开的 `before_agent_start` hook 交付 always-on CORE。

## 仓库关系

- `omp-context` 是唯一 canonical ACM；实现、Host Bridge、CORE、advanced Skill 与生成产物都从这里维护。
- `magic-acm-context` 是 consumer，只能通过本仓库的 `bun run sync:acm` 手动接收已声明的 ACM surface；同步方向不可逆。
- standalone extension 直接注册 CORE prompt hook；integrated consumer 禁用该 hook，并由唯一的 consumer prompt orchestrator 调用 canonical `ensureAcmCoreSegment` 后组合 Magic Context-owned segments。两者共享同一 CORE producer，不形成 functional fork。

## 架构与 guidance 所有权

| 区域 | 责任 |
|---|---|
| `src/index.ts` | 短 composition root；只组装 runtime、工具和 lifecycle |
| `src/checkpoint-tool.ts` / `src/timeline-tool.ts` / `src/travel-tool.ts` | 各工具独立的 schema、执行流与结果契约 |
| `src/travel-coordinator.ts` | 单次 travel mutation transaction、compensation 与 refresh obligation |
| `src/host-bridge.ts` | typed guarded mutation ports；区分 `not_applied`、`applied`、`indeterminate` |
| `src/runtime-lifecycle.ts` / `src/runtime.ts` | context rebuild、compaction、usage 与 session-scoped state |
| `src/label-journal.ts` / `src/lib.ts` | dependency-free label replay 与纯领域逻辑 |
| [`skills/context-management/CORE.md`](skills/context-management/CORE.md) | normal-path agent contract 的唯一来源 |
| [`skills/context-management/SKILL.md`](skills/context-management/SKILL.md) | 只路由 non-obvious target、archive round trip 与 exceptional recovery |
| `src/generated-guidance.ts` | 由 CORE marker 生成；禁止手改 |

七槽 handoff 是 agent completion criterion，不是 runtime 对语义正确性的证明。插件只能校验可观察结构，不能证明 target 位于正确的 semantic boundary 之前、raw detail 足够可恢复，或 `NEXT` 真正可执行。高 context pressure 只触发 boundary check，不会自动授权 travel。

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

支持的 OMP 版本：`16.4.2`。`@oh-my-pi/pi-coding-agent`、`@oh-my-pi/pi-agent-core` 和 `@oh-my-pi/pi-ai` 的 peer、development、lock 与本地安装版本必须完全一致；项目不声明兼容范围，也不维护多版本 shim。

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

## 手动同步到 consumer

canonical 与 consumer root 都是必填绝对或可解析路径：

```bash
bun run sync:acm -- \
  --canonical-root /path/to/omp-context \
  --consumer-root /path/to/magic-acm-context
```

同步命令读取 `scripts/acm-sync-manifest.json`。它先校验 package identity、consumer layout、source、destination、transform match cardinality 与 preserved wrapper；随后在 consumer 内的 staging tree 生成并独立验证全部产物。发布阶段为所有目标建立 rollback journal，任一 rename 或最终验证失败都会恢复本次已替换的全部文件，不留下 partial consumer state。

Manifest 当前声明 42 个 canonical mappings，并额外生成带 canonical version、exact host version、manifest hash 与每个产物 SHA-256 的 `acm-provenance.json`。输出逐行 `changed <path>`；重复运行输出 `no changes`。

```bash
bun run sync:acm -- \
  --canonical-root /path/to/omp-context \
  --consumer-root /path/to/magic-acm-context \
  --verify-only
```

命令不会执行任何 Git 操作：不 stage、commit、fetch、merge、rebase 或 push。canonical 与 consumer 的结果必须在各自仓库分别提交。

## 已知 host 限制

- OMP 16.4.2 未向普通 tool context 暴露原子的 tree-navigation/state-sync API。Typed host mutation ports 因而观察 mutation 前后状态，并返回 `not_applied`、`applied` 或 `indeterminate`；只要 branch mutation 已发生或无法排除，travel coordinator 就保留恢复标签并安排 context refresh。
- `branchWithSummary()` 更新 SessionManager tree，但不会同步 host 私有的 `agent.state.messages`。插件不修改该私有数组，而是在每次公开 `context` event 中从当前 leaf 持续重建 provider context。
- native pre-prompt compaction 依据 host-owned message state 估算，因此 travel 后可能发生一次不必要的提前 compaction。插件不取消、延迟或替换 OMP compaction。
- travel 只改变会话树与后续 model context；不会回滚文件、进程、浏览器、commit 或远端副作用。

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
