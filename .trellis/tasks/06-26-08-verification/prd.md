# PRD: Final Verification

## Requirements

1. `npm install` succeeds
2. `npx tsc --noEmit` passes with zero errors
3. `omp install .` succeeds without errors
4. `/acm` command visible in `/help`
5. All 3 tools registered and discoverable
6. Manual smoke test: checkpoint → timeline → timeline full_tree → compact end-to-end

## Acceptance Criteria

- Zero TypeScript errors
- `omp install .` exits 0
- `/help` lists `/acm`
- `acm_checkpoint` creates label, rejects duplicates
- `acm_timeline` outputs active path + HUD
- `acm_timeline({ full_tree: true })` outputs full tree with IDs
- `acm_compact` triggers full event flow: tool return → turn abort → notification → new turn

## Dependencies

- All implementation tasks (01-07) must be complete
