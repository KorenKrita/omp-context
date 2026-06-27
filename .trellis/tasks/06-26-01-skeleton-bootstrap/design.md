# Design: Skeleton + Bootstrap + Helpers

## Imports

```typescript
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent";
import type { SessionEntry, SessionTreeNode } from "@oh-my-pi/pi-coding-agent";
import type * as z from "zod/v4";
```

`SessionTreeNode` is exported from `session-entries.d.ts:155-161` — verified. Shape:
```typescript
interface SessionTreeNode { entry: SessionEntry; children: SessionTreeNode[]; label?: string; }
```

## Module State

```typescript
let CommandCtx: ExtensionCommandContext | null = null;
let PendingCompact: { tid: string; enrichedMessage: string; target: string; backupCheckpoint?: string; usageBeforeText: string } | null = null;
let PendingSummary: string | null = null;
const InternalTools = ["acm_checkpoint", "acm_timeline", "acm_compact"];
```

## Command Bootstrap

`pi.registerCommand("acm", { handler })` — handler receives `ExtensionCommandContext` (the only path to `navigateTree`). Store to `CommandCtx`.

## Helper Functions

| Function | Signature | Purpose |
|---|---|---|
| `getTreeCached` | `(sm: ReadonlySessionManager) => SessionTreeNode[]` | Call `sm.getTree()` once |
| `findInTree` | `(nodes: SessionTreeNode[], predicate) => SessionTreeNode \| undefined` | Iterative DFS (avoid stack overflow on deep trees) |
| `getChildren` | `(tree: SessionTreeNode[], entryId: string) => SessionTreeNode[]` | Replace `sm.getChildren()` (not on ReadonlySessionManager) |
| `findCheckpointInTree` | `(tree, sm, name) => string \| null` | Find entry ID by label match |
| `resolveTargetId` | `(sm, tree, target) => string` | Resolve "root" / label / raw ID to entry ID |
| `formatTokens` | `(tokens: number) => string` | K/M suffix formatting |
| `formatContextUsage` | `(usage, includeTokens?) => string` | "85.3% (120.5K/200.0K)" format |

`resolveTargetId` logic:
- `"root"` → `tree[0].entry.id`
- `/^[0-9a-f]{8,}$/i` → raw ID, return as-is
- Otherwise → `findInTree` by `sm.getLabel(n.entry.id) === target`
- Fallback → return target unchanged (let downstream handle invalid)
