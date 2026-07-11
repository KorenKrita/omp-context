# omp-context

`omp-context` 是 OMP 的 Agentic Context Management（ACM）插件，也是唯一 canonical ACM 实现与 guidance 仓库。它注册 `acm_checkpoint`、`acm_timeline`、`acm_travel`，并通过公开的 `before_agent_start` hook 交付 always-on CORE。

## 仓库关系

- `omp-context` 是唯一 canonical ACM；实现、Host Bridge、CORE、advanced Skill 与生成产物都从这里维护。
- `magic-acm-context` 是 consumer，只能通过本仓库的 `bun run sync:acm` 手动接收已声明的 ACM surface；同步方向不可逆。
- standalone 与 integrated wrapper 的差异是有意的组合边界，不是 functional fork：ACM extension 负责注入 CORE，Magic Context 只负责外围组合材料。

## 架构与 guidance 所有权

| 区域 | 责任 |
|---|---|
| `src/index.ts` | 注册工具与公开事件 handler，组合 runtime 结果 |
| `src/host-bridge.ts` | 隔离所有 guarded SessionManager host capability |
| `src/lib.ts` | 纯领域逻辑与可单测的结构判断 |
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

同步命令读取 `scripts/acm-sync-manifest.json`，先执行完整 **preflight**：校验两个 package identity、consumer layout、所有 source、destination、transform 和 preserved wrapper；任何 preflight 失败都发生在第一次写入前。写入后执行 **post-copy verification**，确认所有 mapped artifact 与 preserved wrapper。

输出逐行 `changed <path>` 作为 **changed-file report**；重复运行时输出 `no changes`，因此可验证 idempotent no-op。只验证不写入：

```bash
bun run sync:acm -- \
  --canonical-root /path/to/omp-context \
  --consumer-root /path/to/magic-acm-context \
  --verify-only
```

命令不会执行任何 Git 操作：不 stage、commit、fetch、merge、rebase 或 push。canonical 与 consumer 的结果必须在各自仓库分别提交。

## 已知 host 限制

- OMP 16.4.2 未向普通 tool context 暴露原子的 tree-navigation/state-sync API。Host Bridge 因而使用 guarded SessionManager access 调用已验证的 host capabilities；缺失或畸形 capability 会在 mutation 前失败。
- `branchWithSummary()` 会先更新 SessionManager tree，但不会同步 host 私有的 `agent.state.messages`。插件不修改该私有数组，而是在每次公开 `context` event 中从当前 leaf 持续重建 provider context。
- native pre-prompt compaction 依据 host-owned message state 估算，因此 travel 后可能发生一次不必要的提前 compaction。插件不取消、延迟或替换 OMP compaction。
- travel 只改变会话树与后续 model context；不会回滚文件、进程、浏览器、commit 或远端副作用。

## Guidance 维护

人类文档只记录架构、支持与维护事实；agent normal path 以 [CORE](skills/context-management/CORE.md) 为准，advanced branches 以 [Skill package](skills/context-management/SKILL.md) 为准。不要把 agent operating discipline 复制回 README。

真实会话观察记录在 [`docs/agents/acm-dogfooding.md`](docs/agents/acm-dogfooding.md)。未来 guidance 变更必须由一条带证据的 **observed failure** 或 **changed host contract** 驱动；不要为假设中的弱模型行为追加规则。

## 验证

```bash
bun run generate:guidance
bun run typecheck
bun run test:host
bun test src/guidance.test.ts src/tool-descriptions.test.ts src/sync-command.test.ts
```

## 参考

- [pi-context](https://github.com/ttttmr/pi-context) — 原始项目 by ttttmr
- [让 AI 主动管理自己的上下文](https://blog.xlab.app/p/6a966aeb/) — 设计思路
