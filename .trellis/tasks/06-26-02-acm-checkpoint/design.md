# Design: acm_checkpoint Tool

## Schema

```typescript
const checkpointSchema = zod.object({
    name: zod.string().describe("Unique semantic anchor name encoding task+phase, e.g. parser-fix-start, timeout-investigation-search. Avoid generic names like start, checkpoint-1."),
    target: zod.string().optional().describe("History node ID or checkpoint name to label. Defaults to current meaningful position near HEAD."),
});
type CheckpointParams = z.infer<typeof checkpointSchema>;
```

## Execute Flow

1. `const sm = ctx.sessionManager` (ReadonlySessionManager)
2. `const tree = getTreeCached(sm)`
3. Uniqueness: `findCheckpointInTree(tree, sm, params.name)` → if found, return error
4. Target resolution:
   - If `params.target`: `resolveTargetId(sm, tree, params.target)`
   - If no target: iterate `sm.getBranch()` from end to start:
     - Skip `entry.type === "message" && entry.message.role === "toolResult"` where `toolName` is in `InternalTools`
     - Skip assistant messages where all content items are `toolCall` with names in `InternalTools`
     - Take first non-skipped entry's `id`
     - Fallback: `sm.getLeafId() ?? ""`
5. `pi.setLabel(id, params.name)`
6. Return `{ content: [{ type: "text", text: "Created checkpoint '${name}' at ${id}." }], details: {} }`

## Edge Cases

- Empty branch (no entries): fallback to `sm.getLeafId()` which may be null → use `""`
- Target string doesn't match any label or ID: `resolveTargetId` returns the string unchanged → `pi.setLabel` will no-op or error
- Duplicate name: explicit error message with existing ID
