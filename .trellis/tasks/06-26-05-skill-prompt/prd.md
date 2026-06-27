# PRD: SKILL.md Adaptation

## Requirements

1. Copy upstream `skills/context-management/SKILL.md` from `https://github.com/ttttmr/pi-context/blob/main/skills/context-management/SKILL.md`
2. Replace all `context_checkpoint` → `acm_checkpoint`, `context_timeline` → `acm_timeline`, `context_compact` → `acm_compact`
3. Add `/acm` bootstrap instruction: frontmatter description + "Use only these tools" section + Main loop step 0
4. Add `full_tree` guidance in `acm_timeline` tool policy section

## Acceptance Criteria

- No `context_*` tool names remain in the file
- `/acm` bootstrap mentioned in 3 places (frontmatter, tool list, main loop)
- `full_tree` usage guidance present in timeline policy
- Frontmatter `name: context-management` unchanged (skill name stays same)

## Dependencies

- None — independent file creation
