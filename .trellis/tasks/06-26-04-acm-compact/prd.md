# PRD: acm_compact Tool + Event Flow

## Requirements

1. Register tool `acm_compact` with zod schema (`target` required, `summary` required, `backupCheckpoint` optional)
2. Execute: validate CommandCtx → resolve target → set backup label → construct enrichedMessage with `from: <originId>` → store PendingCompact → return "compact start"
3. `turn_end` handler: abort agent loop if PendingCompact exists
4. `agent_end` handler: setTimeout → waitForIdle → navigateTree({ summarize: true }) → notify → sendMessage({ triggerTurn: true })
5. `session_before_tree` handler: return `{ summary: { summary: PendingSummary } }` to inject hand-written summary, skipping default summarizer

## Acceptance Criteria

- `acm_compact` without prior `/acm` → returns "Context management not initialized. Execute /acm once, then retry."
- `acm_compact({ target: "phase-done", summary: "..." })` → returns "compact start"
- After return: turn terminates (no further tool calls), notification shows usage change, new turn starts automatically
- Injected summary contains `(handoff summary from {originLabel}, from: {originId})` prefix
- `acm_timeline({ full_tree: true })` after compact shows backup branch and SUM node with fromId
- Same target can be used for multiple compacts (each creates a new branch)

## Dependencies

- Tasks `01-skeleton-bootstrap`, `02-acm-checkpoint`, `03-acm-timeline` must be complete
