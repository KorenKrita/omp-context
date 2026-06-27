# PRD: acm_checkpoint Tool

## Requirements

1. Register tool `acm_checkpoint` with zod schema (`name` required, `target` optional)
2. Execute: uniqueness check → auto-resolve target (or use provided) → `pi.setLabel()` → return confirmation
3. Auto-target logic: skip internal tool results and internal-only assistant messages when finding last meaningful node

## Acceptance Criteria

- `acm_checkpoint({ name: "test-anchor" })` → returns "Created checkpoint 'test-anchor' at {id}"
- `acm_checkpoint({ name: "test-anchor" })` again → returns error about duplicate name
- `acm_checkpoint({ name: "x", target: "root" })` → labels root node
- `acm_checkpoint({ name: "x", target: "existing-checkpoint" })` → resolves and labels that node

## Dependencies

- Task `01-skeleton-bootstrap` must be complete (helpers + factory shell exist)
