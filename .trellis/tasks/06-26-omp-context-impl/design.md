# Design: omp-context OMP Plugin

## Architecture

```
src/index.ts (single file, ~500 LOC)
├── imports (ExtensionAPI, SessionEntry, SessionTreeNode from OMP)
├── module-level state (CommandCtx, PendingCompact, PendingSummary)
├── helper functions (tree traversal, formatting)
├── registerCommand("acm") → captures ExtensionCommandContext
├── registerTool("acm_checkpoint") → pi.setLabel()
├── registerTool("acm_timeline") → sm.getBranch() + getTree() + HUD
├── registerTool("acm_compact") → stores PendingCompact, returns "compact start"
├── pi.on("turn_end") → ctx.abort() if PendingCompact
├── pi.on("agent_end") → setTimeout(waitForIdle → navigateTree → sendMessage)
└── pi.on("session_before_tree") → returns { summary: { summary: PendingSummary } }
```

## Key API Mappings (verified from OMP 16.1.22 source)

| pi-context (upstream) | OMP adaptation |
|---|---|
| `sm.getChildren(id)` | `getChildren(tree, id)` — recursive find on `sm.getTree()` |
| `sm.branchWithSummary(tid, summary)` | `commandCtx.navigateTree(tid, { summarize: true })` + `session_before_tree` hook |
| `SessionManager` (full) | `ReadonlySessionManager` (Pick subset) for tools; `ExtensionCommandContext` for navigateTree |
| `Type.Object(...)` from pi-ai | `pi.zod.object(...)` (zod/v4) |
| `Static<typeof Schema>` | `z.infer<typeof Schema>` via `import type * as z from "zod/v4"` |

## Compact Event Flow (critical timing)

```
1. acm_compact execute: store PendingCompact, return "compact start"
2. turn_end: ctx.abort() — terminate agent loop, prevent further tool calls
3. agent_end: 
   - PendingSummary = enrichedMessage (with from: originId)
   - setTimeout(0) — defer until agent truly idle
   - await commandCtx.waitForIdle()
   - await commandCtx.navigateTree(tid, { summarize: true })
     ↳ internally fires session_before_tree event
     ↳ hook returns { summary: { summary: PendingSummary } }
     ↳ skips default summarizer
     ↳ calls sm.branchWithSummary internally
   - pi.sendMessage({ triggerTurn: true, deliverAs: "followUp" })
4. New turn starts, agent sees injected summary
```

## "回到未来" (Back to the Future)

`enrichedMessage = "(handoff summary from ${originLabel}, from: ${originId})\n${summary}"`

- `from: ${originId}` marks which node the compact originated from
- `acm_timeline({ full_tree: true })` shows all branches including SUM nodes with their `from` markers
- Agent can compact back to `originId` at any time — same node can be target multiple times (tree branches, not destructive)

## SessionTreeNode Type (verified exported)

From `session-entries.d.ts:155-161`:
```typescript
export interface SessionTreeNode {
    entry: SessionEntry;
    children: SessionTreeNode[];
    label?: string;
}
```

`sm.getTree()` returns `SessionTreeNode[]` — matches our assumption. Import directly, no local definition needed.

## BranchSummaryEntry (for "from" marker)

From `session-entries.d.ts:64-72`:
```typescript
export interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
    type: "branch_summary";
    fromId: string;      // ← built-in "from" field!
    summary: string;
    details?: T;
    fromExtension?: boolean;
}
```

OMP's `BranchSummaryEntry` already has `fromId` — `navigateTree` populates it from the tree navigation. Our `enrichedMessage` `from:` marker is redundant with this field but visible in the summary text itself (for agent readability). Timeline's full_tree mode should display `fromId` when rendering SUM nodes.
