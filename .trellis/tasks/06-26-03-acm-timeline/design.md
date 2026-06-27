# Design: acm_timeline Tool

## Schema

```typescript
const timelineSchema = zod.object({
    limit: zod.number().optional().describe("Maximum visible entries (default: 50)."),
    verbose: zod.boolean().optional().describe("Show all messages including internal tool traffic. Default false."),
    full_tree: zod.boolean().optional().describe("Show all branches including off-path nodes with IDs. Default false (active path only)."),
});
type TimelineParams = z.infer<typeof timelineSchema>;
```

## Default Mode (full_tree: false)

Reuses upstream pi-context logic, adapted for `getChildren(tree, id)` instead of `sm.getChildren(id)`:

1. `const branch = sm.getBranch()` — active path from root to HEAD
2. Build sequence: for each branch entry, append it, then append off-path children that are `branch_summary` or `compaction` type
3. Filter "interesting" (non-verbose): HEAD, Root, labeled entries, branch_summary/compaction, branch points (children > 1), user messages
4. Apply limit (default 50): keep last N visible entries
5. Format: `marker id (meta) [ROLE] body`
   - marker: `*` for HEAD, `•` for USER, `|` for others
   - meta: ROOT/HEAD/checkpoint labels
   - body: content truncated to 100 chars
6. Append HUD

## full_tree Mode (full_tree: true)

1. `const tree = getTreeCached(sm)`
2. Recursive render with depth limit (default 5):
   ```
   ├─ {id} (ROOT) [USER] "first message..."
   │  ├─ {id} [AI] "response..."
   │  │  ├─ {id} (checkpoint: phase-1) [USER] "..."
   │  │  │  ├─ {id} [AI] "..."  ← *HEAD*
   │  │  │  └─ {id} (SUMMARY from: {fromId}) "compacted path..."
   │  │  └─ {id} [USER] "alternate branch..."
   ```
3. Each node shows: id (8-char prefix), label if exists, role, content snippet (50 chars), HEAD marker
4. SUM nodes (`branch_summary` type) show `from: {entry.fromId}` — `BranchSummaryEntry.fromId` is built-in field (session-entries.d.ts:66)
5. Compaction nodes show `firstKeptEntryId`
6. Depth limit prevents unbounded output on very deep trees

## HUD Format

```
[Context Dashboard]
• Context Usage:    {percent}% ({tokens}/{contextWindow})
• Segment Size:     {n} steps since last checkpoint '{name}'
• Compact Cue:      {suggestion}
---------------------------------------------------
```

- Context Usage: `ctx.getContextUsage()` → `formatContextUsage(usage, true)`
- Segment Size: iterate `branch` from end, count steps until `sm.getLabel(id)` is truthy
- Compact Cue: if no checkpoint → "create a checkpoint before the next noisy phase"; if checkpoint exists → "if this segment has produced a stable result and another phase remains, compact to '{name}' with a handoff summary before continuing"

## Content Extraction (getMsgContent)

Same logic as upstream:
- `branch_summary`/`compaction` → `entry.summary`
- `label` → `checkpoint: ${entry.label}`
- `message` with `role === "toolResult"` → `(${toolName}) ${text}` (skip internal if not verbose)
- `message` with `role === "bashExecution"` → `[Bash] ${command}`
- `message` with `role === "user"`/`"assistant"` → text + toolCalls
- Custom messages → hidden (return "")
