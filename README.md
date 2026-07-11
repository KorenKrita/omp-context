# omp-context

> 让 AI agent 主动管理自己的上下文。

**Agentic Context Management** — agent 自己决定何时打锚点、何时穿越时间线、穿越到哪个节点。不是被动等系统自动压缩，而是主动的、语义级别的上下文管理。

## 为什么需要

AI agent 在长对话中会积累大量噪音：搜索结果、调试日志、失败尝试、中间产物。自动压缩（snapcompact）按 token 阈值触发，不理解任务语义，经常压缩掉有用的东西。

omp-context 让 agent 像管理 git 分支一样管理上下文：

- **开始前**打个锚点（零成本）
- **做完一阶段**后回头看结构
- **觉得太乱了**就 travel 回更早的锚点，用 handoff summary 翻篇
- **需要找回旧路径**就 travel 到 off-path 节点，恢复当时的 raw context

## 工具

| 工具 | 做什么 |
|---|---|
| `acm_checkpoint` | 打锚点。零成本——不改上下文、不分支、不摘要。多打 = 后续更多选择 |
| `acm_timeline` | 看 active path 结构图 + token HUD（含 context sync 状态）。默认只显示当前路径；`verbose: true` 可显示 ACM 工具调用。off-path 摘要以脚注标出。`search` 全树搜索（含 off-path，并避免对未命中的大型 tool result 做完整格式化）。`list_checkpoints: true` 按路径/时间列 checkpoint 清单（可配合 `search` 缩小，显示上限 50），`full_tree: true` 看整棵树 |
| `acm_travel` | 穿越到任意锚点，留一份 handoff summary。上下文切换到目标节点 + summary；token 可能降（回到过去）也可能升（前往未来）。旧路径保留，随时再 travel。返回 `estimatedUsageAfter`、`estimatedEffect`、`structuralEffect`、`sessionMessages`；官方 `usageAfter` 为 pending 直到下次 LLM context event |

## 时间旅行

**回到过去** — travel 到更早的锚点，把当前路径的噪音替换成 summary：
- 失败的探索后重新开始
- 完成嘈杂阶段后只留结论
- 进入新阶段前整理调查过程

副作用**可能**是 context 变小（目标在噪音产生之前），也可能不变或变大——以 travel 返回的 `estimatedEffect`、`structuralEffect` 和 `sessionMessages` 为准，再用 `acm_timeline` HUD 确认官方 %（`usageAfter` 在下次 LLM 调用前为 pending）。

**前往未来** — travel 到 off-path 或更晚的锚点，恢复该节点之前的 raw history：
- 通过 `backupCurrentHeadAs` 找回被离开的分支
- 比较不同方案
- 恢复 summary 里丢失的细节

副作用**可能**是 context 变大（目标在大量 read/tool 结果之后），也可能不变或变小——以 travel 返回的 `estimatedEffect`、`structuralEffect` 和 `sessionMessages` 为准。

旧路径永远不删除——每次 travel 创建新分支，老分支完整保留在树里。

travel 后扩展会按 session 持续重建模型 context，并在当前 leaf 暂时不可用时回退到新建的 summary leaf；孤立 tool call/result 会在发给 provider 前修复。重建失败会显示原因并最多重试 3 次，避免静默退回旧上下文。

## 支持的 OMP 版本

支持的 OMP 版本：`16.4.2`。`@oh-my-pi/pi-coding-agent`、`@oh-my-pi/pi-agent-core` 和 `@oh-my-pi/pi-ai` 的 peer、development、lock 与本地安装版本必须完全一致；项目不声明兼容范围，也不维护多版本 shim。

升级 OMP 时必须先把候选版本作为 **isolated candidate** 放进隔离的 `test/host-fixture`，在不启动模型的前提下完成 real SessionManager 与 extension-handler 验证。候选通过后再执行以下检查：

- `extension events`
- `public context APIs`
- `Host Bridge capabilities`
- `session-context construction`
- `tool registration`
- `token estimation`
- `compaction events`
- `changelog review`

运行 `bun run test:host`、相关 focused tests 和 `bun run typecheck` 后，才可在一个原子变更中 **atomically replace every exact OMP version**：同时更新根 package peer/development 声明、lock、已安装依赖、支持文档与隔离 fixture。不得扩大版本范围；canonical 仓库验证通过后再手动同步 consumer。

## 安装

```bash
# 从本地
omp install .

# 从 GitHub
omp install github:KorenKrita/omp-context

# 从 marketplace
/marketplace add KorenKrita/omp-context
/marketplace install omp-context@omp-context
```

## 与 OMP 内置功能的关系

| 内置功能 | 关系 |
|---|---|
| `snapcompact` | 互补——snapcompact 自动按阈值压缩，acm_travel 让 agent 按语义主动穿越时间线 |
| `checkpoint`/`rewind` | 互补——rewind 丢弃草稿，acm_travel 整理成笔记再翻篇 |
| `/context` | 互补——token 可视化 |

## 参考

- [pi-context](https://github.com/ttttmr/pi-context) — 原始项目 by ttttmr
- [让 AI 主动管理自己的上下文](https://blog.xlab.app/p/6a966aeb/) — 设计思路
