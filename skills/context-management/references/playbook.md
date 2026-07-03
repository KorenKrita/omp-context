# Scenario Playbook

How the anchor → work → look → fold rhythm adapts to common task shapes. Anchor names below are examples; keep yours semantic (`<task>-<phase>`). All summaries must honor the summary contract in SKILL.md.

## Research and heavy reading

Search, web/browser work, reading many files/logs/pages — process much larger than the conclusion, and the raw trail goes stale fast.

- Checkpoint before the first big search pass and before each new evidence branch.
- Fold as soon as the investigation yields a stable finding **and the next step will use it** — including the next phase of the same request (found the API shape → now implement). Do not wait for a new user message.
- Research summaries are the most sensitive to quality. Include the finding, key evidence (numbers, errors, IDs), source anchors (files, URLs, queries), expensive dead ends not to repeat, open questions, and the next step. Never compress research to just "found the answer".

```javascript
acm_travel({
  target: "timeout-investigation-start",
  backupCurrentHeadAs: "timeout-investigation-raw",
  summary: "Task: mitigate API timeouts. Finding: DB connection pool exhaustion is the root cause. Evidence: pool wait timeouts in logs during peak; pool size 10 in config; no network errors. Rejected lead: gateway timeout was downstream of DB waits. Backup timeout-investigation-raw holds exact log lines. Next step: propose pool sizing + queue mitigation and how to validate."
});
```

## Development and debugging

Implementation, debugging, refactoring, migration, review.

- Checkpoint before serious work, before risky edits, before each alternative fix, and after milestones like "root cause confirmed".
- Fold after a failed attempt (record what failed, why, and what not to repeat) or after a stable milestone when validation or the next phase remains.
- Files and processes changed on disk stay changed — the summary must state the current external state and what has not been validated yet.
- Warning signs you are overdue to fold: multiple partial theories accumulating, multiple fix attempts in one thread, re-reading your own earlier reasoning.

```javascript
acm_travel({
  target: "memory-leak-fix-start",
  backupCurrentHeadAs: "memory-leak-weakref-raw",
  summary: "Task: fix memory leak. WeakRef approach failed: objects collected too early, cache hit rate collapsed — do not retry. Files src/cache.ts reverted to pre-attempt state on disk. Decision: object pooling next. Next step: implement pooling in src/cache.ts."
});
```

## Plan-driven execution

Work anchored to an explicit plan, roadmap, or todo list that execution keeps returning to.

- Checkpoint the plan-ready state; checkpoint each phase start.
- After each subtask stabilizes and another remains, fold back to the plan-ready or phase anchor. The summary must carry the plan's current status (done / in progress / remaining) so the plan itself survives the fold.
- On a material replan: summarize the direction change, checkpoint the new plan-ready state, continue from there.

## Repeated batch items

Many similar items (tickets, reviews, cases) processed with a reusable method.

- Checkpoint the batch start; checkpoint again once the first item teaches a reusable method (`<batch>-method-clear`).
- Default between-item move: fold to the method anchor after each item, carrying only the cumulative tally + method refinements. Item-specific reasoning should not accumulate across items.

```javascript
acm_travel({
  target: "vendor-review-method-clear",
  summary: "Task: vendor review batch, 4 of 12 done (results in review-notes.md). Method unchanged: check SLA terms, then security addendum, then pricing deltas. Item 4 flagged missing DPA — logged. Next step: review vendor 5 with the same method."
});
```

## Retry, branch, and pivot

Trying approaches A/B/C, comparisons, strategy changes. Cross-cutting: applies on top of any shape above.

- Always checkpoint before opening a risky branch — that anchor is what makes a clean retreat possible.
- The moment a branch is decided (failed, won, or superseded), fold: preserve what was tried, why it was rejected, what remains valid, and the chosen next approach. Never drag a dead branch's raw trail into the next attempt.
- Multiple travels to the same anchor are fine — each creates a sibling branch (attempt 1, attempt 2, ...).

## Task switching and cleanup

Side tasks, interruptions, new task after a noisy completed one, or a thread that is already messy.

- Before switching away: checkpoint the paused mainline (`<task>-paused`) so you can return.
- New user task after a noisy completed task: fold the old task first so the new task starts on a clean working set. This is the single most commonly missed fold.
- Adopting context management late in an already-messy thread: run `acm_timeline` to find (or create) the best pre-noise anchor, then fold with a strong summary. It is never too late.
- Finished a task with no known continuation: answer and wait. Fold when the next message starts new work.

## Interleaved async fronts

Background jobs, subagents, delayed results, user decisions — several overlapping lines of work in one thread.

Treat each line as a **front**. Keep at most one front raw (the one you are reasoning about now); park the rest as capsules:

```text
Front: docs-build | Goal: validate docs before publish | State: background build running
Stable result: source edits complete | Pointers: task docs-build, dist/docs/
Trigger: build exit status | Next: on success summarize validation; on failure inspect first error
```

- When a delayed result returns: capture it into its front, decide whether it interrupts the current focus, park it if not.
- Fold when switching fronts after a noisy phase, or when the middle of the thread is completed fronts. Interleaving makes recent anchors poor targets — an old anchor (even `root`) plus capsules for every live front is often the right fold.
- Before a deep fold, answer: which front is active, which are parked (with pointers), which are done, and what is the immediate next action.
