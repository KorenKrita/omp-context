# Implement: acm_compact Tool + Event Flow

## Steps

1. Define `compactSchema` and `type CompactParams`
2. `pi.registerTool({ name: "acm_compact", ... })` with execute body per design.md
3. Register `pi.on("turn_end", ...)` handler
4. Register `pi.on("agent_end", ...)` handler with setTimeout + waitForIdle + navigateTree + sendMessage
5. Register `pi.on("session_before_tree", ...)` handler
6. Run `npx tsc --noEmit`

## Validation

```bash
cd ~/Coding/omp-context && npx tsc --noEmit
```

Manual end-to-end test (requires OMP session):
1. `/acm` → notification
2. `acm_checkpoint({ name: "phase-1" })`
3. Do some work (a few tool calls)
4. `acm_compact({ target: "phase-1", summary: "Phase 1 done. Next: implement Y.", backupCheckpoint: "pre-compact" })`
5. Expect: "compact start" → turn ends → notification → new turn starts with summary visible
6. `acm_timeline({ full_tree: true })` → verify backup branch + SUM node with fromId
