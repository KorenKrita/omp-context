# Design: SKILL.md Adaptation

## Source

`https://raw.githubusercontent.com/ttttmr/pi-context/main/skills/context-management/SKILL.md`

## Edits

1. **Frontmatter description** — append to end of description string:
   `If acm_compact reports 'not initialized', execute /acm once then retry.`

2. **"Use only these tools" section** — after the tool list, add:
   `Before first use of acm_compact in a session, run /acm if not already initialized.`

3. **Main loop** — before step 1, add step 0:
   `0. If this is the first time using acm_compact in this session and you haven't run /acm yet, execute /acm first (one-time initialization).`

4. **acm_timeline tool policy** — append:
   `Use full_tree: true when you need to see off-path branches (e.g. to jump to a backup checkpoint or alternate path).`

5. **Global text replacements**:
   - `context_checkpoint` → `acm_checkpoint`
   - `context_timeline` → `acm_timeline`
   - `context_compact` → `acm_compact`

## No Other Changes

- Keep all scenario descriptions, compact gate logic, summary contract, common mistakes unchanged
- Keep all 7 reference file paths unchanged (filenames don't have the `context_` prefix)
