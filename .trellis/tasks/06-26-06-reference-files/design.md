# Design: 7 Reference Files

## Source URLs

Base: `https://raw.githubusercontent.com/ttttmr/pi-context/main/skills/context-management/references/`

Fetch each of the 7 files from `{base}/{filename}` and write to `skills/context-management/references/{filename}`.

## No Modifications

These files contain scenario-specific guidance (when to checkpoint, how to write summaries for debugging vs research vs batch work). They reference tool names (`context_checkpoint` etc.) but since the SKILL.md maps `acm_*` tools to the same behaviors, the reference content remains valid as-is.

The reference files do NOT need `context_` → `acm_` replacement because:
1. They describe behavioral patterns, not API calls
2. The SKILL.md already establishes the `acm_*` tool names
3. Agent reads SKILL.md first, then references — the mapping is clear

## Acceptance

File count = 7. `ls skills/context-management/references/` shows exactly these 7 files.
