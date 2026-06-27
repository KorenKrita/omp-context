# Implement: SKILL.md Adaptation

## Steps

1. Fetch upstream SKILL.md content
2. Apply 3 global replacements (context_* → acm_*)
3. Insert `/acm` bootstrap instructions in 3 locations
4. Insert `full_tree` guidance in timeline policy
5. Write to `skills/context-management/SKILL.md`

## Validation

- `grep -c "context_checkpoint\|context_timeline\|context_compact" skills/context-management/SKILL.md` → 0
- `/acm` mentioned at least 3 times
- `full_tree` mentioned at least once
