# PRD: acm_timeline Tool

## Requirements

1. Register tool `acm_timeline` with zod schema (`limit`, `verbose`, `full_tree` all optional)
2. Default mode: active path only — branch entries + off-path summaries, filtered to "interesting" nodes, with Context Dashboard HUD
3. `full_tree` mode: render entire session tree as indented structure with all node IDs, labels, roles, content snippets, HEAD marker, and `fromId` on SUM nodes
4. HUD shows: context usage %, segment size since last checkpoint, compact cue

## Acceptance Criteria

- `acm_timeline({})` → outputs active path with checkpoint labels + HUD
- `acm_timeline({ verbose: true })` → shows all messages including internal tool traffic
- `acm_timeline({ full_tree: true })` → outputs tree structure with all branches, node IDs visible
- `acm_timeline({ limit: 5 })` → only last 5 visible entries shown
- HUD appears in both modes
- SUM nodes in full_tree show `from: <fromId>` when available

## Dependencies

- Task `01-skeleton-bootstrap` must be complete
