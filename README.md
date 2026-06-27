# omp-context

> 让 AI agent 主动管理自己的上下文。

**Agentic Context Management** — agent 自己决定何时打锚点、何时压缩、压缩到哪个节点。不是被动等系统自动压缩，而是主动的、语义级别的上下文管理。

## 为什么需要

AI agent 在长对话中会积累大量噪音：搜索结果、调试日志、失败尝试、中间产物。自动压缩（snapcompact）按 token 阈值触发，不理解任务语义，经常压缩掉有用的东西。

omp-context 让 agent 像管理 git 分支一样管理上下文：

- **开始前**打个锚点（零成本）
- **做完一阶段**后回头看结构
- **觉得太乱了**就 compact 回某个锚点，只留一份精炼总结
- **发现丢了东西**还能跳回旧路径找回

## 工具

| 工具 | 做什么 |
|---|---|
| `acm_checkpoint` | 打锚点。零成本——不改上下文、不分支、不摘要。多打 = 后续更多选择 |
| `acm_timeline` | 看结构图 + token 用量。`full_tree` 看所有分支，`search` 搜特定节点 |
| `acm_compact` | 跳到任意锚点，留一份 handoff summary。旧路径保留，随时跳回 |

## 时间旅行

**回到过去** — compact 到更早的锚点，把噪音替换成总结：
- 失败的探索后重新开始
- 完成嘈杂阶段后只留结论
- 进入新阶段前压缩调查过程

**前往未来** — compact 到 off-path 分支上的旧节点，恢复原始上下文：
- 回到 backup checkpoint 找回细节
- 比较不同方案
- 恢复被压缩丢失的信息

旧路径永远不删除——每次 compact 创建新分支，老分支完整保留在树里。

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
| `snapcompact` | 互补——snapcompact 自动按阈值压缩，acm_compact 让 agent 按语义主动压缩 |
| `checkpoint`/`rewind` | 互补——rewind 丢弃草稿，acm_compact 整理成笔记再翻篇 |
| `/context` | 互补——token 可视化 |

## 参考

- [pi-context](https://github.com/ttttmr/pi-context) — 原始项目 by ttttmr
- [让 AI 主动管理自己的上下文](https://blog.xlab.app/p/6a966aeb/) — 设计思路
