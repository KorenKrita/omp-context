# omp-context

让 OMP agent 主动维护自己的上下文，而不是等窗口耗尽后被动压缩。

`omp-context` 是由 KorenKrita 独立维护的第三方 OMP 插件。核心理念是**压缩即智能**：理解一段过程，就是能把它说得更短而不丢失关键信息。扩展让 agent 能够：

- **Save** — 在高风险操作、验证过的 baseline、策略分叉前建立可恢复的语义 save point；
- **Orient** — 查看当前会话 spine、历史分支、checkpoint 与上下文占用；
- **Fold** — 把已经提炼完的过程折叠成可通过 cold start 检验的 handoff；
- **Rebase** — 在 summary 堆叠或竞争时合并到更早的安全基底，重新获得浅层、低负载的 working set；
- **Rehydrate / Fork** — travel 到归档分支取回精确细节再返回，或从 save point 分叉探索后折回；
- 在 travel 后同步持久会话树、下一轮模型上下文与 live AgentSession。

Guidance 采用道/术/度分层：always-on CORE 注入判断力与 cadence 偏好，工具描述和 result cue 携带机制，advanced Skill 只在复杂场景按需加载。没有强制 preflight、固定 transition 表或后缀状态机——agent 自主判断何时压缩。

## 为什么需要它

长任务的问题不只是 token 数量。

即使每个阶段都做了局部摘要，summary 仍可能一层层堆在 active spine 上：

```text
root → summary A → summary B → summary C → current work
```

这些历史 handoff 会持续占用上下文和注意力。`omp-context` 不把压缩当作单纯的 token 操作，而是按**语义边界**管理 working set：保留下一步真正需要的内容，把已完成过程移到可恢复的 archive。

## 三个工具

| Tool | 作用 |
|---|---|
| `acm_checkpoint` | 给会话节点建立唯一、可恢复的语义 save point |
| `acm_timeline` | 查看 active spine、checkpoint catalog、全文搜索、完整树和 summary depth |
| `acm_travel` | 将已提炼的过程折叠为七槽 handoff、把累计 summaries rebase 到最早安全基底，或 rehydrate 归档分支 |

插件会通过 OMP 的公开 prompt hook 注入精简的 always-on CORE。复杂的 target selection、archive round trip 和异常恢复按需从 advanced Skill 加载，不会把整套 playbook 常驻在上下文里。

## Semantic rebase

普通 fold 压缩一个局部阶段；rebase 处理长期累积的 summary depth。

agent 会在以下时机主动检查 rebase：

- 下一次 fold 会继续叠加 summary；
- 一个稳定 chain 或 subchain 已结束；
- 同一 session 即将开始新目标；
- context pressure 上升。

rebase 不等于强制跳到 `root`。agent 会从最早候选开始执行 **cold start** 检查：如果一个全新的 agent 只依赖当前 snapshot 和直接 evidence pointers 就能执行 `NEXT`，该基底才安全。root 是理想候选，不是默认答案。

Timeline 会提供事实证据：

- 当前 active summary depth；
- root structural candidate；
- 每个 checkpoint travel 后的 projected summary depth；
- usage、message count 与 branch topology。

Runtime 不会伪装成能判断语义完整性，也不会自动批准或执行 rebase。

## Context usage reminder

插件通过 OMP 的 `context` 事件观察真实 active tokens，并按 ACM working-budget pressure 判断 30%、50%、70% 档位：

```text
workingBudgetTokens = min(contextWindow, 400K)
pressurePercent = activeTokens / workingBudgetTokens × 100
```

物理窗口不超过 400K 时沿用实际窗口；超过 400K 时统一使用 400K 工作预算。因此 200K、350K 模型的触发节奏不变，1M 模型在 120K / 200K / 280K active tokens 时分别触发 30% / 50% / 70%。真实 hard-window usage 仍单独保留，reminder details 与 `acm_timeline` dashboard 会同时展示 hard usage 和 ACM pressure，避免把工作预算误读成模型窗口容量。
- **30%**：离开舒适巡航区，留意下一个已提炼完、可干净折叠的语义批次——现在在边界打一个 `acm_checkpoint` 会让之后的 fold 更便宜；
- **50%**：主动寻找下一个值得 fold 或 rebase 的表示增益，按批次提交而不是逐步支付；批次不明确时用 `acm_timeline`（active 视图）查看 spine 上还承载着什么；
- **70%**：当前周期最后一次提醒，构造能通过 cold start 的最小 handoff，在最近的安全时机 `acm_travel`。

有工具调用时，reminder 作为隐藏 steering context 注入当前 agent loop；主会话正常结束但没有工具结果可承载时，插件会在 `session_stop` 之后通过隐藏的 OMP `nextTurn` continuation 交付，不会把 reminder 放进可编辑的 pending-message UI。

成功 `acm_travel`、OMP 原生 compaction 或手动 `/tree` 导航会开始一个 **baseline-only** 新周期：第一条真实 post-transition usage 只建立基线，不会因为刚完成上下文切换而立即提醒。该基线与已发送档位会写入 session；reload、resume、switch、branch 从 journal 恢复，tree navigation 则强制开新周期。

Reminder 只建议根据当前任务要求判断 travel 是否合适，不自动执行 summary、fold、rebase 或 travel。正确性、任务连续性和可恢复性优先；真正的长任务继续增长并进入 OMP 原生 compaction 是可接受的。

## 安装

### 本地安装

```bash
omp install .
```

### GitHub

```bash
omp install github:KorenKrita/omp-context
```

### Marketplace

```text
/marketplace add KorenKrita/omp-context
/marketplace install omp-context@omp-context
```

安装后无需手动调用命令。Agent 会根据 CORE 在任务边界主动使用三个 ACM tools；你也可以直接要求它创建 checkpoint、查看 timeline 或恢复某个 archive。

## 可观察性与恢复

每次操作都会返回可核对的结构事实：

- resolved target 与 entry ID；
- checkpoint aliases；
- branch summary leaf；
- backup checkpoint outcome；
- message、token、percentage-point 与 summary-depth delta；
- persistent context rebuild 和 live AgentSession sync 状态。

Checkpoint 名称在整棵会话树中大小写敏感且必须唯一；同一节点可以拥有多个 alias。异常 mutation 明确区分 `not_applied`、`applied` 和 `indeterminate`，避免把未知状态伪装成成功或失败。

## 安全边界

- Travel 只改变 OMP 会话树和后续模型上下文。
- 它不会回滚文件、进程、浏览器、Git commit 或远端服务。
- 插件不会取消、替换或延迟 OMP 原生 compaction。
- Context reminder 不会自动执行 travel，也不会把 usage 阈值当作安全批准。
- 如果当前任务仍依赖不可压缩的中间推理，agent 会保留 working set 或接受 native compaction，而不是为了降低数字强行 rebase。
- Host 不支持 live synchronization 时，持久 branch 和公开 context rebuild 仍然保留；结果会给出明确恢复指引。

## 验证

```bash
bun test
bun run typecheck
bun run verify:acm
```

开发架构、host compatibility、Git hook、版本提升流程和维护契约见 [`AGENTS.md`](AGENTS.md)。

## 致谢

- [pi-context](https://github.com/ttttmr/pi-context) — 原始项目 by ttttmr
- [让 AI 主动管理自己的上下文](https://blog.xlab.app/p/6a966aeb/) — 设计思路

MIT License
