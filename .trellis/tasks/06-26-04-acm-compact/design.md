# Design: acm_compact Tool + Event Flow

## Schema

```typescript
const compactSchema = zod.object({
    target: zod.string().describe("Checkpoint name, history node ID, or 'root'. Use acm_timeline with full_tree to see all available targets."),
    summary: zod.string().describe("Handoff state summary: current task/state, decisions/constraints, external side effects, validation status, source anchors, and explicit next step."),
    backupCheckpoint: zod.string().optional().describe("Optional name to label current HEAD before branching. Recovery pointer only."),
});
type CompactParams = z.infer<typeof compactSchema>;
```

## Execute Flow

1. If `!CommandCtx` → return error message
2. `const sm = ctx.sessionManager; const tree = getTreeCached(sm)`
3. `const tid = resolveTargetId(sm, tree, params.target)`
4. If `tid === sm.getLeafId()` → return "Already at target"
5. If `params.backupCheckpoint && sm.getLeafId()` → `pi.setLabel(sm.getLeafId(), params.backupCheckpoint)`
6. `const originId = sm.getLeafId() ?? "unknown"; const originLabel = sm.getLabel(originId) ?? originId;`
7. `const enrichedMessage = "(handoff summary from ${originLabel}, from: ${originId})\n${params.summary}"`
8. `const usageBeforeText = formatContextUsage(ctx.getContextUsage())`
9. Store `PendingCompact = { tid, enrichedMessage, target: params.target, backupCheckpoint: params.backupCheckpoint, usageBeforeText }`
10. Return "compact start"

## Event Handler: turn_end

```typescript
pi.on("turn_end", async (_event, ctx) => {
    if (!PendingCompact) return;
    ctx.abort();
});
```

Purpose: terminate agent loop after compact tool returns. Prevents further tool calls in the same turn.

## Event Handler: agent_end

```typescript
pi.on("agent_end", async () => {
    if (!PendingCompact || !CommandCtx) return;
    const compactParams = PendingCompact;
    const commandCtx = CommandCtx;
    PendingCompact = null;
    PendingSummary = compactParams.enrichedMessage;

    setTimeout(async () => {
        try {
            await commandCtx.waitForIdle();
            await commandCtx.navigateTree(compactParams.tid, { summarize: true });
            // navigateTree internally fires session_before_tree → hook returns PendingSummary
            // navigateTree internally calls sm.branchWithSummary with hook summary

            const usageAfter = commandCtx.getContextUsage();
            commandCtx.ui.notify([...].join("\n"), "info");

            pi.sendMessage({
                customType: "omp-context",
                content: "context_compact complete. A handoff summary was injected above. Read it to understand current state. Execute the Next Step from the summary.",
                display: false,
            }, { triggerTurn: true, deliverAs: "followUp" });
        } catch (err) {
            commandCtx.ui.notify(`acm_compact failed: ${err.message}`, "error");
        }
    }, 0);
});
```

### Why setTimeout + waitForIdle

From upstream source comment: `agent_end` is emitted before the core Agent is actually idle. If `sendMessage({ triggerTurn: true })` is called inside this handler, pi still sees an active stream and queues the message as steering; after `agent_end` the loop has stopped, so that queued message is never drained.

`setTimeout(fn, 0)` defers execution to the next event loop tick. `waitForIdle()` then blocks until the agent truly stops streaming. Only then is it safe to call `navigateTree` and `sendMessage`.

## Event Handler: session_before_tree

```typescript
pi.on("session_before_tree", async (event) => {
    if (!PendingSummary) return;
    if (!event.preparation.userWantsSummary) return;
    const summary = PendingSummary;
    PendingSummary = null;
    return { summary: { summary } };
});
```

From `shared-events.d.ts:289-300`: `SessionBeforeTreeResult.summary` — "Custom summary (skips default summarizer). Only used if preparation.userWantsSummary is true."

`navigateTree(tid, { summarize: true })` sets `userWantsSummary = true` internally, fires this event, and if the hook returns a summary, skips the LLM summarizer and uses the hook-provided text for `branchWithSummary`.

## Timing Coordination

```
PendingCompact set in execute
  → turn_end: ctx.abort()
  → agent_end: PendingSummary = enrichedMessage; setTimeout
    → waitForIdle
    → navigateTree({ summarize: true })
      → session_before_tree fires
      → hook reads PendingSummary, returns { summary: { summary } }
      → navigateTree calls branchWithSummary(tid, summary, ...)
    → sendMessage({ triggerTurn: true })
  → new turn begins, agent sees injected summary
```

## Edge Cases

- `CommandCtx` null → explicit error, no side effects
- `tid === leafId` → "Already at target", no side effects
- `navigateTree` fails (invalid target) → catch block notifies error, PendingSummary cleared
- `sendMessage` fails → same catch block
- Multiple compacts in quick succession → `PendingCompact` is module-level singleton; second compact overwrites first. The first's turn_end abort still fires but PendingCompact now points to the second. This is acceptable — agent should not call compact twice in one turn.
