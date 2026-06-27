# Implement: acm_timeline Tool

## Steps

1. Define `timelineSchema` and `type TimelineParams`
2. Implement `getMsgContent(entry, sm, verbose)` helper — content extraction per role
3. Implement `isInteresting(entry, sm, tree, branch, currentLeafId)` — filter predicate for default mode
4. Implement default mode: build sequence, filter, format, append HUD
5. Implement `renderTreeNode(node, sm, depth, maxDepth, currentLeafId)` — recursive tree formatter
6. Implement full_tree mode: call `renderTreeNode` on each root, join output, append HUD
7. `pi.registerTool({ name: "acm_timeline", ... })`
8. Run `npx tsc --noEmit`

## Validation

```bash
cd ~/Coding/omp-context && npx tsc --noEmit
```

Manual: after checkpoint exists, call `acm_timeline({})` and `acm_timeline({ full_tree: true })` in OMP session.
