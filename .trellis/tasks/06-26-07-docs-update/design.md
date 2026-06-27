# Design: Update README.md and AGENTS.md

## README.md Changes

### §2.1 Compact Flow — Full Replacement

Replace the current 7-step calling chain with:

```
1. registerCommand("acm") → handler captures ExtensionCommandContext
2. acm_compact tool execute:
   - Validate CommandCtx exists
   - resolveTargetId(sm, tree, params.target) → tid
   - Set backupCheckpoint label if provided
   - Construct enrichedMessage with `from: <originId>` marker
   - Store PendingCompact
   - Return "compact start"
3. turn_end handler: ctx.abort() if PendingCompact exists
4. agent_end handler:
   - PendingSummary = enrichedMessage
   - setTimeout(async () => {
       await commandCtx.waitForIdle()
       await commandCtx.navigateTree(tid, { summarize: true })
       // navigateTree fires session_before_tree internally
       pi.sendMessage({ triggerTurn: true, deliverAs: "followUp" })
     }, 0)
5. session_before_tree handler: return { summary: { summary: PendingSummary } }
   → skips default summarizer, uses hand-written summary for branchWithSummary
```

### §4 Discard Table

Remove row: `| /acm 命令 | extension factory 加载时直接初始化... |`

Add section after table:
> **保留项**: `/acm` 命令 — `ExtensionCommandContext` 是获取 `navigateTree` 的唯一路径。由 skill prompt 指导 agent 首次 compact 前自动执行。

### §2 Zod Example

```typescript
import type * as z from "zod/v4";

export default function (pi: ExtensionAPI) {
    const zod = pi.zod;
    const schema = zod.object({ name: zod.string() });
    type Params = z.infer<typeof schema>;
    pi.registerTool({ name: "acm_checkpoint", parameters: schema as any, ... });
}
```

### Other Changes
- "6 个场景 reference" → "7 个场景 reference"
- `src/index.ts` description: "三个工具注册 + compact 流程 + session_before_tree handler + full_tree timeline 模式"

## AGENTS.md Changes

1. `|路径|作用|` table: `references/` row "6 个" → "7 个"
2. compact 流程描述: sync with README §2.1
3. "丢弃的内容" table: remove `/acm` row
4. zod note: add `import type * as z from "zod/v4"` for type inference
