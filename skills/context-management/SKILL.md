---
name: context-management
description: "Use this skill for multi-turn, phased, or noisy work: research/reading, debugging, plan-then-execute, retries/pivots, background or asynchronous work, handoffs, user decisions, task switching, repeated items, or repeated progress checks. It keeps the conversation as a clean working set with checkpoints, timeline review, and compaction at continuation boundaries. Always use when resuming after context compaction or when a long phase reaches a decision, handoff, validation, or task-switch boundary. Usually skip simple one-shot tasks."
---

# Context Management

Use this skill to keep the active conversation as a useful **working set** for the next step. Keep raw only the context that still needs direct reasoning; carry the rest as compact task state when that is more efficient.

## Core concept: time travel

This skill gives you three capabilities:

1. **Checkpoint** — Mark a moment in the conversation with a semantic name. Zero cost: no context change, no branch, no side effect. Just a label you can return to later. **Create checkpoints liberally** — before noisy work, at phase boundaries, before risky attempts, after milestones. More checkpoints = more options for compact targets later.

2. **Timeline** — See the structure of your conversation as a tree: active path, checkpoints, branch summaries, off-path branches. Use `full_tree: true` to see all branches (including "future" paths you can jump to), or `search: "keyword"` to find specific nodes without rendering the entire tree.

3. **Compact** — Jump to any checkpoint or node ID, leaving a handoff summary as a bridge. This creates a new branch from that point. The old path is NOT deleted — it remains as an off-path branch visible in `full_tree`. You can always compact back to it later ("return to the future").

### When to go back in time ("回到过去")

Go back when the current path is cluttered with noise and you need a cleaner working set:

- **After a failed approach**: you explored direction A, it didn't work, you want to start fresh from an earlier checkpoint with a summary of what failed and why. Compact to the pre-exploration checkpoint.
- **After completing a noisy phase**: debugging, searching, reading many files — the raw trail is no longer needed, only the conclusions. Compact to the pre-work checkpoint.
- **Before a new phase**: investigation is done, implementation begins. The investigation trail is noise for implementation. Compact to the investigation-start checkpoint.
- **When context is getting large**: you've accumulated many tool calls, reads, searches. Compact to an earlier anchor to shed the raw trail while keeping the state summary.

### When to go forward ("前往未来")

Go forward when you need to access a path you previously left behind:

- **Revisiting a backup**: you compacted away from path X with a `backupCheckpoint`. Now you need the raw context from that path. Use `acm_timeline({ full_tree: true })` to find the backup node ID, then compact to it.
- **Comparing approaches**: you tried approach A (compacted away), then approach B. Now you want to return to A's raw state to compare. Compact to A's backup checkpoint.
- **Recovering lost context**: a summary was too aggressive and you lost important details. The old path still has them — compact to a node on the old path.

### Benefits of time travel

- **Lower context cost**: compact away noise, keep only state summaries
- **Safe exploration**: checkpoint before risky work, compact back if it fails
- **Multiple approaches**: branch from the same anchor multiple times, each branch is independent
- **Non-destructive**: old paths are never deleted, always recoverable via `full_tree`
- **Same node, multiple jumps**: a checkpoint can be the target of unlimited compacts — each creates a new sibling branch

## Working-set model

Before choosing a tool, ask:

- What am I trying to do next?
- What facts, constraints, or artifacts must stay raw for that next action?
- What important data has a reliable external source I can re-check instead of carrying raw?
- What history is useful only as a conclusion, pointer, or state update?
- What history is process noise or stale baggage?

Classify context into:

- **Raw context:** user intent, constraints, code/log/error details, evidence, or plan text you expect to inspect directly soon.
- **State summary:** decisions, findings, lessons, changed files, validation status, source pointers, rejected leads, and next steps that can replace raw process.
- **Discardable process:** repetitive searches, verbose logs, abandoned hypotheses, false starts, and unrelated turns whose useful value is already captured or gone.

If the active context is already small, coherent, and directly useful for the next step, do not manage it just to be tidy.

## When to use

Use this mode when the work may outgrow one clean thread:

- search, research, browser work, or reading many files/logs/pages/results
- investigate -> decide -> execute -> validate
- plan -> implement -> verify
- background or asynchronous work, handoffs, user decisions, or delayed results
- multiple approaches, retries, failed branches, comparisons, or pivots
- repeated similar cases, tickets, reviews, or batch items
- a main task that may be interrupted by side tasks
- repeated progress/status checks that indicate active state is hard to track
- scattered threads that need cleanup before continuing
- debugging, troubleshooting, refactoring, migration, or code-facing work that may get noisy

If one of these clearly applies, take a structural action now, usually a checkpoint. Do not merely describe the workflow. If the user has not provided enough task details, still checkpoint the workflow shape before asking clarifying questions.

Usually skip this skill for one-shot reads, bounded summaries, direct rewrites, simple lookups, deterministic scripts, short tasks that can stay clean, or moments where the active context is already a good working set.

## Start-of-turn check

At the start of each new user message, classify it:

- **Same task / next phase:** continue; if the previous phase is complete and noisy, compact before the next phase.
- **Correction or follow-up:** usually answer from recent context; do not compact yet.
- **New task or direction shift:** if the previous task left a complete noisy segment, inspect timeline when anchors are unclear, then compact to a continuation anchor that gives the new task a clean working set.

Think of the tools as a phase pipeline: checkpoint marks anchors, work happens, timeline shows structure, and compact creates a new branch from the chosen continuation anchor with a summary of what happened after it. The target is a working-set choice, not an age choice.

## Main loop

1. Before noisy work, create a semantic checkpoint as the first context-management action. Checkpoints are free — create them generously. If the first job is orientation over existing history, run `acm_timeline` before adding a new checkpoint.
2. When the task shape is clear, read one matching scenario reference only if it will change tool timing, anchor choice, or summary content. Skip reference loading for obvious short applications where this main skill body is enough.
3. Add checkpoints at meaningful milestones: phase boundaries, risky attempts, reusable batch methods, and interruptions. More checkpoints = more compact target options later.
4. Use `acm_timeline` when the active path structure affects the next decision or compact target. Use `full_tree: true` to see off-path branches. Use `search: "keyword"` to find specific nodes in large trees without overflowing context.
5. At continuation boundaries, run the compact gate before starting another phase. If the whole requested task is complete and only the final response remains, answer and wait.
6. After a successful compact, your context has already switched. Continue working directly — the target's context + your summary is now the active working set.

## Continuation boundaries

A continuation boundary is a point where the current phase has produced a stable result and the next action will use that result to start a different phase. It is not necessarily the end of the user's whole task.

Examples: investigation -> decision/plan/implementation, implementation -> validation, failed validation -> next approach, delayed result -> routing/action, user decision -> execution, rejected branch -> replacement direction, side request -> pause/summarize mainline before switching.

Do not ask only "is the whole task done?" Ask "will the next action start a new phase using the stable result of this phase?" If yes, this is often a compaction boundary.

Handoffs are not final answers: if a response transfers control to the user, another actor/process, later validation, or a queued phase, compact when the prior phase was noisy and the next action needs only stable state.

## Read the right reference

Read **one primary reference** only when the scenario pattern will affect tool timing, anchor choice, or summary content:

- search / research / reading-heavy work -> `references/search-research-and-reading.md`
- development / debugging / troubleshooting / refactoring / migration -> `references/development-and-troubleshooting.md`
- planning / staged execution / todo-driven work -> `references/planning-and-execution.md`
- repeated similar items / batch work -> `references/repeated-items-and-batch-work.md`
- task switching / pause-resume / interruptions / cleanup-and-continue -> `references/task-switching-and-cleanup.md`
- interleaved async work / overlapping fronts / background results / user decisions -> `references/interleaved-async-work.md`

Also read `references/retry-branch-and-pivot.md` when multiple approaches, failed branches, comparisons, retries, or pivots become central.

## Tool policy

### `acm_checkpoint`

**Zero cost. Create liberally.** A checkpoint is just a label on a conversation node — no context change, no branch, no side effect. More checkpoints means more options when you need to compact later.

Use before noisy work, a new phase, a risky attempt, switching subtasks, or after a meaningful milestone. Use semantic names such as `<task>-start`, `<task>-<phase>`, `<task>-<attempt>`, or `<task>-<milestone>`. Avoid generic names like `start`, `checkpoint-1`, or `retry`.

### `acm_timeline`

Use it as the structural view of the active path:

- when the current path shape affects the next decision
- when several checkpoints, branches, or task switches exist
- before choosing a non-obvious compact target
- when the thread feels cluttered and you need to distinguish useful context from baggage

When reading the timeline, ask which raw messages are still needed for the immediate next action, which paths are now baggage, and which anchor gives the smallest sufficient working set after summary injection.

Use `full_tree: true` when you need to see off-path branches (e.g. to jump to a backup checkpoint or alternate path). The tree is depth-limited to prevent context overflow; use `search: "keyword"` to find specific nodes across the entire tree without rendering everything.

Use `search: "keyword"` to find checkpoints or nodes by content, label, or ID. This is more efficient than `full_tree` for large conversation trees.

### `acm_compact`

Use it to replace raw history with a state summary when the next phase would benefit from a smaller working set. Compact creates a new branch from the target — the old path is preserved as an off-path branch, not deleted.

Typical compact boundaries: investigation -> execution, diagnosis -> fix, implementation -> validation, failed attempt -> next attempt, representative item -> remaining batch, completed noisy task -> new user task.

Strong signals to consider compaction:

- repeated progress/status checks
- inability to summarize current state, next action, and open risks in one short paragraph
- rejected, abandoned, or superseded branches
- stable result after many tool calls or long output
- returned background/asynchronous/delegated result
- material plan or approach change
- side question arriving while stale process history is active

Do not compact while exploration is still active, when the result is unstable, just because the skill triggered, or just because the user-visible task ended.

After calling `acm_compact`, the compact executes immediately. Your context switches instantly to the target node's original conversation + the summary you provided. Token usage drops on the same turn. You can verify the new tree structure with `acm_timeline` right away.

## Compact gate

Before calling `acm_compact`, require all three:

1. The segment being left behind is noisy, stale, failed, low-value in raw form, or actively reducing focus.
2. You can restore the useful task state in a clear summary.
3. There is an immediate continuation that benefits from cleaner context.

If the compact is prompted by a new user message, a direction shift, or several possible checkpoint targets, run `acm_timeline` first and choose the target from visible structure rather than memory.

If the whole task is done and only the final answer remains, wait. Compact later only if the next user message makes it useful.

Checkpoint-only failure mode: a checkpoint is useful because it gives you a clean anchor to compact back to later. After any checkpointed phase produces a stable result, ask what the phase settled, whether the next step is different, and whether a summary can replace the raw trail. If yes, compact; do not keep accumulating raw history just because the overall task is still active.

## Choosing target and backup

Choose the continuation anchor by designing the next working set:

1. Name the immediate next action.
2. Decide what must remain raw: active user intent, current constraints, still-open evidence/code context, an approved plan being executed, or details you expect to inspect directly next.
3. Decide what can become state summary or disappear: completed searches, verbose logs, failed attempts, stale branches, earlier unrelated tasks, externally recoverable data, and clear process details.
4. Pick the anchor that leaves the new branch with the **smallest sufficient context** after summary injection.
5. If an older anchor plus a stronger summary is cleaner than a recent anchor plus stale context, prefer the older anchor. When completed fronts fill the middle of the thread, it can be correct to compact to a much older anchor or even `root` if the summary restores the active front and source pointers.

Avoid targets that are too late, too early with a weak summary, or semantically wrong. If there are several checkpoints, a task switch, or uncertainty about the best working set, run `acm_timeline` first.

Use `backupCheckpoint` when raw history may still matter later. A backup is a recovery safety net, not a substitute for the summary. The backup node remains visible in `full_tree` and can be used as a compact target to "return to the future." The backup name must be unique across the whole tree (same as `acm_checkpoint`) — reusing an existing checkpoint name is rejected, so pick a distinct name like `<task>-<phase>-raw-history`.

## Compact summary contract

The summary is not a transcript recap. It is the state needed to resume work from the chosen anchor; older or cleaner anchors require stronger summaries.

Context tools change conversation state, not the outside world. Files, processes, browser state, tickets, databases, remote services, and other side effects stay current. If you compact to an anchor before those changes, the summary must bridge the gap between old conversation context and current external state.

A compact summary must restore:

1. **Task state:** current task, user intent, constraints, decisions, assumptions, and known result/progress/failure.
2. **External state:** changed files, created/deleted artifacts, running/stopped processes, browser actions, tickets/records, deployments, remote changes.
3. **Verification state:** commands already run, validation status, notable outputs, and remaining risks or open questions.
4. **Navigation state:** source anchors/evidence when needed, rejected leads worth avoiding, backup checkpoint guidance, and explicit next step.

If important data has a reliable external source, preserve the pointer and retrieval method rather than copying the raw data. Examples: file path and line/query, database table/query, task/job id, log path, URL, record id, branch/commit, or command to inspect status. Include raw values only when they are small, unstable, hard to retrieve, or needed for immediate reasoning.

For long-running work, shape the summary as a state capsule: goal, stable result, decisions, rejected paths, current artifacts/source pointers, active work, pending input, risks/open questions, and next action. Include why compacting is appropriate only when it helps future orientation. Avoid vague summaries like `Done`, `Investigated`, `Switching context`, or `Going back`.

Before compacting, quickly check: stable state? real continuation? smallest sufficient working set? summary restores state after the anchor? externally recoverable data represented by pointers? external side effects and validation captured? explicit next step?

## After compact

Your context has already switched — you are now working from the target node's conversation history plus the summary. Treat the current context as the ground truth:

1. The summary you wrote is now part of your visible context. Verify it contains enough state for the next action.
2. Disk and external systems were not rolled back; inspect current files/tools/services when state matters.
3. If a missing detail is cheap to reconstruct from disk, tools, or source anchors, retrieve it directly.
4. Return to the backup checkpoint only when the missing raw context cannot be reconstructed cheaply. Use `acm_timeline({ full_tree: true, search: "backup-name" })` to find it.

## Common mistakes

Avoid:

- not creating enough checkpoints — checkpoints are free, create them generously
- checkpointing constantly without phase meaning — still prefer semantic names
- checkpointing early but never compacting after a stable phase result
- compacting blindly without timeline when anchor choice is unclear
- preserving too much raw history because older anchors or `root` feel risky
- using an old anchor or `root` with a weak summary
- compacting immediately after a final deliverable when no next user intent is known
- carrying completed noisy phases into a new task
- treating handoff or decision prompts as final answers when a continuation is expected
- writing summaries that recap history but fail to restore current task state
- assuming compact or branch navigation reverts files, processes, browser state, or remote services
- omitting decisions, constraints, external side effects, changed files, validation status, or next step
