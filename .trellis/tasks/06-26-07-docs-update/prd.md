# PRD: Update README.md and AGENTS.md

## Requirements

### README.md
1. §2.1 compact flow: replace with correct flow (turn_end abort + setTimeout + waitForIdle + session_before_tree hook)
2. §4 discard table: remove `/acm` row, add note about keeping it as bootstrap
3. §2 zod example: use `import type * as z from "zod/v4"` + `pi.zod` separation
4. Reference count: 6 → 7
5. File structure: `src/index.ts` description add "+ full_tree timeline mode"
6. Add `from: <originId>` mention in compact section

### AGENTS.md
1. "6 个场景 reference" → "7 个场景 reference"
2. Compact flow description: sync with README
3. Remove "丢弃 /acm 命令" statement
4. zod type note: `import type * as z from "zod/v4"` for types, `pi.zod` for runtime

## Acceptance Criteria

- README.md compact flow matches actual implementation (turn_end → agent_end → setTimeout → waitForIdle → navigateTree → hook → sendMessage)
- No mention of "丢弃 /acm 命令" in either file
- Both files say 7 references
- zod example shows `import type` pattern

## Dependencies

- All implementation tasks (01-06) should be complete to ensure docs match reality
