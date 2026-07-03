---
name: context-management
description: "Self-manage your context window with checkpoints and time travel — treat this as a native ability, like reading files or running commands. Create a checkpoint at the start of any multi-step task and at each phase boundary. React to the context usage % that acm tool results report: above 40%, plan a travel at the next phase boundary; above 70%, travel at the next stable point. Travel back to fold a noisy finished phase into a handoff summary; travel forward to restore raw history you left behind. Skip only for trivial one-shot answers."
---

# Context Management

Your context window is a finite working set, and you are the one who manages it. Three tools:

- `acm_checkpoint` — label a conversation node with a semantic name. Zero cost: no branch, no summary, no context change. Its result reports current context usage.
- `acm_timeline` — see the conversation tree plus a context-usage HUD.
- `acm_travel` — jump to any checkpoint or node, leaving a handoff summary. The target becomes the branch point; everything after it is replaced by your summary. The old path is never deleted.

Use them on your own judgment, mid-task, without being asked. Do not wait for the user to mention context, and do not ask permission. When any tool result or HUD shows a context usage percentage, that number is addressed to you — read it and react.

## The rhythm

1. **Anchor** — at task start and at each phase start: `acm_checkpoint({ name: "<task>-<phase>" })`.
2. **Work** — do the phase; let it get noisy locally.
3. **Look** — read the context usage % from checkpoint results and the timeline HUD.
4. **Fold** — when the phase has a stable result and more work remains, `acm_travel` back to the phase anchor with a handoff summary. The raw trail becomes a capsule; you continue clean.

## Reflex table

| Moment | Reflex |
|---|---|
| Multi-step task starting | checkpoint `<task>-start` |
| Entering a new phase (investigate → implement → validate) | checkpoint the new phase; if the finished phase was noisy, travel back to its anchor first |
| About to try something risky or a new approach | checkpoint |
| Approach failed, switching to another | travel to the pre-attempt anchor; summary records what failed and why |
| Usage 40–70% | travel at the next phase boundary |
| Usage above 70% | travel at the next stable point, even mid-phase; run timeline first if the target is unclear |
| New user task after a noisy completed one | travel the old task away before starting |
| Lost orientation, or repeatedly re-checking status | timeline |
| Need raw details that a summary dropped | travel forward to the backup/off-path anchor (find it with `acm_timeline({ search })`) |
| Task fully done, about to give the final answer | do nothing — answer and wait |

## Two directions

- **Back** (usual): target sits before the noisy segment. Folds raw history into your summary; context usually shrinks.
- **Forward**: target is a backup or off-path anchor that still carries raw history. Restores details a summary dropped; context usually grows. Old paths survive every travel, so nothing is ever lost — recover via `search`.

Do not assume travel shrinks context. Read `estimatedUsageAfter`, `estimatedEffect`, and `structuralEffect` from the travel result; official token % confirms on the next `acm_timeline`.

## Calibration

Under-use and over-use are both failures:

- **One checkpoint per phase.** If the last checkpoint is only a few messages back and the phase has not changed, do not add another.
- **A checkpoint you never travel back to is dead weight.** Checkpointing is preparation for travel, not the goal. After a checkpointed phase stabilizes, ask: can a summary replace this trail? If yes, travel.
- Do not travel mid-exploration, on unstable results, or right before delivering the final answer with nothing left to do.
- Do not travel just to be tidy when usage is low and the thread is coherent.

## Summary contract

The summary IS your memory after the travel — everything after the target leaves your context. It must restore:

1. **Task state** — goal, decisions, constraints, what succeeded or failed.
2. **External state** — files changed, processes started or stopped, remote/browser/ticket side effects. Travel never rolls these back; the summary must bridge conversation state to real-world state.
3. **Validation state** — what was run, what passed, what remains risky.
4. **Pointers, not dumps** — file paths, IDs, URLs, queries, commands to re-fetch data instead of raw copies. Copy raw values only when small, volatile, or needed immediately.
5. **Next step** — one explicit action to take after the travel lands.

Set `backupCurrentHeadAs` when the raw path might still matter later. It is a recovery pointer on the path you are leaving, **not** the travel target, and never a substitute for the summary.

Choosing the target: pick the anchor that leaves the smallest context that still suffices. An older anchor plus a stronger summary usually beats a recent anchor plus stale baggage; `root` is legitimate when the summary can carry everything.

## After a travel

The injected summary is your new state — execute its next step. Disk and external systems were not rolled back; inspect them directly when in doubt. If a detail is missing, re-fetch it from pointers first; travel to the backup only if it cannot be reconstructed cheaply.

## Mechanics

- Checkpoint names are unique across the tree and **case-sensitive**; one node may hold multiple aliases. Omitting `target` auto-anchors the nearest meaningful USER/AI turn near HEAD. For phase-complete milestones, prefer an explicit `target` on the substantive turn rather than a short meta-instruction line.
- `acm_timeline` modes, in precedence order: `list_checkpoints` (catalog with per-anchor size estimates) > `search` (full tree, including off-path) > `full_tree` (bounded; truncates on deep trees) > default active path. On large trees use `list_checkpoints` or `search`; never conclude a checkpoint is missing from a truncated `full_tree`.
- Judge fill level by `contextUsage` / HUD, never by file bytes or lines read.
- `root` resolves to the first top-level node. `target` and `backupCurrentHeadAs` are validated; error messages include recovery hints — read them.
- If the runtime auto-compacts, a `pre-compact-<timestamp>` checkpoint is created automatically; you can travel back to it.

## Scenario playbook

`references/playbook.md` covers how the rhythm adapts to specific task shapes: research and heavy reading, development and debugging, plan-driven execution, repeated batch items, retries and pivots, task switching, and interleaved async fronts. Read it when the task shape changes what to anchor or what to put in the summary — not for routine application of the rhythm above.
