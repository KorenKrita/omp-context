# omp-context

让 OMP agent 主动整理自己的上下文，同时保留可恢复的会话历史。

## 它解决什么问题

长任务会积累大量已消化的日志、试错和中间结果。OMP 原生 compaction 能在窗口压力下压缩历史，但它是面向容量恢复的单向摘要。`omp-context` 增加一套可逆的主动整理机制：agent 自己判断何时保存、观察或折叠上下文，原始路径仍留在会话树中。

一句话：**OMP compaction 负责兜底，omp-context 负责可恢复地整理工作集。**

## 三个工具

| 工具 | 一句话 |
|---|---|
| `acm_checkpoint` | 给一个会话节点添加语义化存档名，不改变当前上下文。 |
| `acm_timeline` | 查看当前主干、存档点、搜索结果和会话树证据。 |
| `acm_travel` | 把已消化过程折叠为结构化 handoff，并保留原始历史用于恢复。 |

安装后 agent 会根据正典 guidance 自主使用；也可以直接要求“存个档”“看看时间线”或“恢复到某个点”。

## Handoff

`acm_travel` 使用固定七字段交接单：

```json
{
  "goal": "完成 parser 迁移并保持现有行为。",
  "state": "实现已完成，测试通过；仍需更新 README 示例。",
  "evidence": "bun test；src/parser.ts；test/parser.test.ts",
  "external": "src/parser.ts 已修改，尚未提交。",
  "exclusions": "不再尝试 recursive-descent 方案。",
  "recover": "parser-raw",
  "next": "更新 README 中的 parser 示例。"
}
```

- **goal / state / next** 必填：目标是什么、现在什么状态、下一步做什么。
- **evidence / external / exclusions / recover** 可选：证据在哪、改过哪些文件、放弃过哪些方向、想回头时去哪——用到才写，省略自动记为 `none`。简单场景三个字段就够。
- 每次折叠都会自动给折叠前的位置记一张"回程票"（archive alias），写进 Recover 行——想找回原文时直接 travel 过去。

合格标准是一个不知道前情的新 agent 能仅靠 handoff 和其中的指针继续工作。

## 上下文仪表

非 ACM 工具结果末尾会带一行仪表：

```text
[ctx 41% budget · 12% window · boundary · 2pts · fold@turn→24%/38 · fold@task→11%/92]
```

依次是：注意力预算占用（预算 = 模型窗口和 400K 取小）、物理窗口占用、`boundary` 标记（每个新请求的首次读数）、路径上的存档数，以及两根折叠针——折到上一段开头 / 折到最早存档点，各自显示折后压力和会折掉的消息数。整数位变了才显示，每个新请求的首次读数必显示。

它只报数，从不建议做什么——什么时候整理，是 agent 自己的判断。设 `ACM_GAUGE_DISABLED=1` 可以关掉。

## 安装

从 Git 仓库安装：

```bash
omp install github:KorenKrita/omp-context
```

本地开发可在仓库目录安装：

```bash
bun install
omp install .
```

## 安全边界

- Travel 只改变 OMP 会话树及后续模型上下文，不回滚文件、进程、Git 提交或外部系统。
- 原始历史留在树中；checkpoint、节点 ID 或 raw archive alias 可用于恢复。
- 扩展不替代 OMP 原生 compaction。
- 变更返回 `applied`、`not_applied` 或 `indeterminate` 等可核对结果，不把未知状态伪装成成功。
- Provider context 可在 finalized travel receipt 后切换；native AgentSession replacement 只在 OMP `session_stop` 且会话确实 idle、无 pending message 时执行。

## OMP 兼容契约

当前精确支持并测试 OMP **17.1.5**：

- `@oh-my-pi/pi-agent-core`
- `@oh-my-pi/pi-ai`
- `@oh-my-pi/pi-coding-agent`
- `@oh-my-pi/pi-tui`

工具参数使用 OMP 注入的 `pi.zod` 严格 schema；Pi-only prompt metadata（promptSnippet/promptGuidelines）等价注入 `before_agent_start.systemPrompt`；Pi 的 `agent_settled` 语义映射到 OMP 原生 `session_stop`。

## 开发与验证

```bash
bun install --frozen-lockfile
bun run verify:acm
```

完整 gate 包含 guidance 一致性、根测试、TypeScript 类型检查，以及真实 OMP 17.1.5 host fixture。架构、host 兼容性契约、文案宪法与维护规则见 [`AGENTS.md`](AGENTS.md)。

## 来源

本项目将 [`KorenKrita/pi-context`](https://github.com/KorenKrita/pi-context) 的 ACM 行为移植到 OMP，并针对 OMP 生命周期、schema、rendering 和 session API 做宿主适配。

MIT License
