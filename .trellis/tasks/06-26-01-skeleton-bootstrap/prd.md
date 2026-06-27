# PRD: Skeleton + Bootstrap + Helpers

## Requirements

1. Create `src/index.ts` with correct imports from `@oh-my-pi/pi-coding-agent` and `zod/v4`
2. Define module-level state: `CommandCtx`, `PendingCompact`, `PendingSummary`, `InternalTools`
3. Register `/acm` command via `pi.registerCommand` — handler captures `ExtensionCommandContext` to module variable
4. Implement 7 helper functions used by all subsequent tools

## Acceptance Criteria

- `npx tsc --noEmit` passes with stub `registerTool` calls (or no tools registered yet)
- `/acm` command appears in `/help` output after `omp install .`
- `SessionTreeNode` imported from OMP, not locally defined

## Dependencies

- None — this is the foundation task
