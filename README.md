# omp-context: Agentic Context Management for OMP

将 [pi-context](https://github.com/ttttmr/pi-context) 适配为 OMP (oh-my-pi) 插件。让 AI agent 主动管理上下文:打语义锚点、查看会话结构图、在相位转换时用 state summary 续接。

## 与 OMP 内置机制的关系

OMP 已有三套上下文管理机制,本插件不替代它们,而是填补"相位转换时压缩续接"的空缺:

| 机制 | 作用 | 与本插件关系 |
|---|---|---|
| `checkpoint`/`rewind` 工具 | 探索后丢弃中间上下文 | 互补:rewind 是"扔掉草稿",acm_compact 是"整理成笔记再翻篇" |
| `snapcompact` | 自动 compaction(token 超阈值) | 独立:自动触发,不依赖 agent 主动调用 |
| `semantic-compression` skill | 文本级 token 压缩 | 正交:压缩文本语法,不管理会话结构 |
| OMP `/context` 命令 | token 用量可视化 | 优于 pi-context 的 `/context`,本插件不重复实现 |

本插件提供三个工具:

1. **`acm_checkpoint`** — 给对话节点打语义锚点(不分支、不摘要)
2. **`acm_timeline`** — 输出活跃路径的结构图 + token HUD
3. **`acm_compact`** — 从锚点创建带手写 state summary 的续接分支

## 适配方案

### 1. compact 流程:方案 B(核心适配)

pi-context 原版直接调 `SessionManager.branchWithSummary()`。OMP 的工具执行上下文 `ctx.sessionManager` 是 `ReadonlySessionManager`(只读 Pick),不暴露此方法。

适配方案:用 OMP 官方扩展钩子 `session_before_tree` 事件注入手写 summary。

**调用链:**

```
1. acm_compact 工具存储 pendingCompact 参数 + ctx.abort()
2. agent_end 回调:commandCtx.navigateTree(tid, { summarize: true })
3. navigateTree 内部触发 session_before_tree 事件
4. acm 扩展的 session_before_tree handler 返回 { summary: { summary: 手写文本 } }
5. navigateTree 检测 hookSummary,跳过默认 summarizer
6. navigateTree 内部调用 sm.branchWithSummary(newLeafId, summaryText, ...)
7. pi.sendMessage({ customType, content }, { triggerTurn: true, deliverAs: "followUp" })
```

**关键类型:**

```typescript
// shared-events.ts:356
interface SessionBeforeTreeResult {
    cancel?: boolean;
    summary?: { summary: string; details?: unknown };  // skips default summarizer
}
```

`navigateTree` 内部实现(agent-session.ts:12307-12475):
- `userWantsSummary = options.summarize ?? false`(12348)
- 有 hookSummary 时跳过默认 summarizer(`!hookSummary` 条件,12377)
- 用 hookSummary.summary 调 `branchWithSummary`(12439)
- `fromExtension = true` 标记来源

**优势:** ReadonlySessionManager 约束完全规避(navigateTree 内部自己调 branchWithSummary),零类型安全妥协。

### 2. schema:迁移到 zod

pi-context 用 `Type.Object(...)` from `@earendil-works/pi-ai`。OMP 三选一:`pi.zod`(canonical)、`pi.arktype`(canonical)、`pi.typebox`(legacy)。

选用 zod。运行时 `toolWireSchema` 检测 zod v4 schema 用 `z.toJSONSchema` 转换。TypeScript 类型约束 `registerTool<TParams extends TSchema>` 不接受 zod 对象,用 `parameters: schema as any` + `type Params = z.infer<typeof schema>` 处理。

```typescript
export default function (pi: ExtensionAPI) {
    const z = pi.zod;
    const schema = z.object({
        name: z.string().describe("Unique semantic anchor name..."),
        target: z.string().optional(),
    });
    type Params = z.infer<typeof schema>;

    pi.registerTool({
        name: "acm_checkpoint",
        parameters: schema as any,
        async execute(_id, params: Params, _signal, _onUpdate, ctx) { ... }
    });
}
```

### 3. 工具命名:`acm_` 前缀

OMP 内置 `checkpoint`/`rewind` 语义不同(丢弃式 vs 标注式),名字重复会让 agent 困惑。本插件工具统一加 `acm_` 前缀。

### 4. 丢弃的内容

| 丢弃项 | 原因 |
|---|---|
| `context.ts`(`/context` 仪表盘) | OMP 内置 `/context` 功能更强(真实计算 + snapcompact 估算) |
| `utils.ts`(`formatTokens`) | 只被 `context.ts` 使用 |
| `/acm` 命令 | extension factory 加载时直接初始化,不需要用户手动启用 |

### 5. `getChildren` → `getTree()` 递归

pi-context 的 `context_timeline` 和 `resolveTargetId` 用 `sm.getChildren(id)` 查找子节点。`ReadonlySessionManager` 不暴露 `getChildren`。改用 `sm.getTree()` 获取完整树,递归遍历 `SessionTreeNode.children`。

```typescript
// 替代 sm.getChildren(entryId)
function getChildren(sm: ReadonlySessionManager, entryId: string): SessionTreeNode[] {
    function find(nodes: SessionTreeNode[]): SessionTreeNode | undefined {
        for (const n of nodes) {
            if (n.entry.id === entryId) return n;
            const found = find(n.children);
            if (found) return found;
        }
    }
    return find(sm.getTree())?.children ?? [];
}
```

## 文件结构

```
omp-context/
├── package.json              # OMP 插件配置(peerd @oh-my-pi/*)
├── tsconfig.json
├── README.md                 # 本文件(方案文档)
├── AGENTS.md                 # 项目知识库
├── src/
│   └── index.ts              # 三个工具注册 + compact 流程 + session_before_tree handler
└── skills/
    └── context-management/
        ├── SKILL.md          # 驱动 agent 行为的 skill prompt(适配 OMP)
        └── references/       # 6 个场景 reference(从 pi-context 原版照搬)
```

## 安装

```bash
# 本地开发
cd ~/Coding/omp-context
omp install .

# 或通过 git
omp install github:KorenKrita/omp-context
```

## 参考

- 原项目: [pi-context](https://github.com/ttttmr/pi-context) by ttttmr
- 设计哲学: [blog.xlab.app](https://blog.xlab.app/p/51d26495/) / [中文版](https://blog.xlab.app/p/6a966aeb/)
- OMP 扩展 API: `@oh-my-pi/pi-coding-agent` ExtensionAPI / SessionManager / session_before_tree
