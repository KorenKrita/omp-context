# omp-context: Agentic Context Management for OMP

**ACM** = **A**gentic **C**ontext **M**anagement。与 OMP 内置的自动上下文管理（snapcompact、rewind）不同，ACM 让 agent 自己决定何时打锚点、何时压缩、压缩到哪个节点——agent 是上下文管理的主体，不是被动接受自动压缩。

工具名以 `acm_` 为前缀，避免与 OMP 内置 `checkpoint`/`rewind` 工具冲突。

让 AI agent 主动管理上下文：打语义锚点、查看会话结构图、在相位转换时用 state summary 续接。

## 工具

| 工具 | 作用 |
|---|---|
| `acm_checkpoint` | 给对话节点打语义锚点（零成本，不分支、不摘要） |
| `acm_timeline` | 输出活跃路径的结构图 + token HUD，支持 `full_tree` 和 `search` 参数 |
| `acm_compact` | 从任意 tree 节点创建带手写 state summary 的续接分支，支持"回到未来" |

## 核心概念

**Checkpoint** — 标记对话中的某个时刻。零成本：不改变上下文、不分支、不摘要。多打锚点 = 后续 compact 时有更多目标选择。

**Timeline** — 查看对话的树形结构：活跃路径、锚点、分支摘要、off-path 分支。用 `full_tree: true` 查看所有分支（包括可以跳转的"未来"路径），用 `search: "keyword"` 在大树中搜索特定节点。

**Compact** — 跳转到任意锚点或节点 ID，留下一份 handoff summary 作为桥梁。这会从该点创建新分支，旧路径作为 off-path 分支保留——随时可以 compact 回去（"回到未来"）。

### 回到过去

当前路径充满噪音时，compact 到更早的锚点：
- 失败的探索后重新开始
- 完成一个嘈杂阶段后，只保留结论
- 进入新阶段前，压缩调查过程

### 前往未来

需要访问之前留下的路径时，compact 到 off-path 分支上的节点：
- 回到 backup checkpoint 恢复原始上下文
- 比较不同方案
- 恢复丢失的细节

## 与 OMP 内置机制的关系

| 机制 | 关系 |
|---|---|
| `checkpoint`/`rewind` | 互补：rewind 丢弃草稿，acm_compact 整理成笔记 |
| `snapcompact` | 独立：自动触发，不依赖 agent |
| `semantic-compression` | 正交：压缩文本语法，不管理会话结构 |
| `/context` | 互补：token 可视化 |

## 安装

```bash
omp install .
# 或
omp install github:KorenKrita/omp-context
```

## 参考

- [pi-context](https://github.com/ttttmr/pi-context) by ttttmr
- [设计哲学](https://blog.xlab.app/p/6a966aeb/)
