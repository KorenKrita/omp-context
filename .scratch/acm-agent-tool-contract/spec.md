# ACM Agent-Facing Tool Contract

Status: resolved

## Problem Statement

The three ACM tools expose the right domain responsibilities, but parts of their agent-facing contract are more complex and instructional than necessary.

`acm_timeline` currently selects among active path, checkpoint catalog, search, and full tree through competing optional parameters with an implicit precedence rule. This permits contradictory calls and requires the agent to memorize which arguments are ignored.

Successful checkpoint and travel results repeat large portions of the operating discipline, while context-effect reporting includes a hidden 500-token/2-percent classifier. The classifier does not block travel, but labels an estimated effect rather than reporting only the underlying evidence. Guidance also refers to a fold "preview" even though no separate travel-preview operation exists.

## Solution

Keep the three-tool domain boundary but simplify each public contract:

- `acm_checkpoint` creates recoverability.
- `acm_timeline` observes structure through one explicit view.
- `acm_travel` validates and applies one recoverable fold.

Replace timeline's competing booleans with a single `view` discriminator. Let timeline provide candidate evidence when target choice is non-obvious. Do not add a separate travel preview/apply protocol.

Make every tool result progressively disclosed: concise facts and one next cue on success; detailed recovery only on exceptional paths. Remove threshold-based effect labels and report raw before/after/delta estimates plus structural message changes.

## User Stories

1. As an agent inspecting the active path, I want one explicit `active` view, so that no other timeline mode can silently override it.
2. As an agent listing anchors, I want one explicit `checkpoints` view, so that I receive the full-tree checkpoint catalog without setting competing booleans.
3. As an agent finding a known label, node, or content fragment, I want one explicit `search` view with a query, so that the search scope is unambiguous.
4. As an agent inspecting branch topology, I want one explicit `tree` view, so that full-tree rendering is deliberate.
5. As an agent calling timeline without a view, I want the default to remain the active path, so that the common operation is short.
6. As an agent filtering the checkpoint catalog, I want an optional case-insensitive `filter` that matches checkpoint labels or entry IDs, so that large catalogs remain searchable without changing views.
7. As an agent providing a search query or checkpoint filter with an incompatible view, I want schema validation to reject the call, so that ignored parameters do not hide mistakes.
8. As an agent requesting verbose output outside the active view, I want the schema to reject or omit that unsupported combination explicitly, so that behavior is predictable.
9. As an agent limiting output, I want the limit semantics documented for the selected view, so that one number does not silently mean unrelated things.
10. As an agent using the checkpoint catalog, I want every alias listed independently with active/off-path status, so that aliases remain first-class travel targets.
11. As an agent comparing candidate targets, I want estimated target usage, meaningful-step distance, active/off-path state, and structural direction, so that I can reason from evidence.
12. As an agent when usage cannot be estimated, I want `unknown` reported explicitly, so that missing evidence is not converted into a false negative.
13. As an agent viewing a truncated tree, I want the result to point to checkpoints or search, so that truncation is not mistaken for absence.
14. As an agent creating a checkpoint, I want a short confirmation containing the label, resolved entry, aliases, and usage, so that the normal result stays legible.
15. As an agent whose checkpoint auto-target skipped transient nodes, I want the selected meaningful role and skipped count reported, so that the placement is explainable.
16. As an agent creating a milestone checkpoint, I want one context-sensitive next cue, so that the result does not repeat the entire task-end discipline.
17. As an agent encountering a checkpoint collision, I want the existing target and a semantic renaming cue, so that recovery is immediate.
18. As an agent preparing to travel, I want timeline to own candidate comparison, so that travel does not require a separate preview state.
19. As an agent calling travel, I want all side-effect-free validation completed before any backup label or branch mutation, so that rejected calls leave the tree unchanged.
20. As an agent whose target resolves from an off-path branch, I want that fact reported before execution, so that restored history is expected.
21. As an agent traveling successfully, I want resolved target, origin, summary entry, backup outcome, raw context estimates, message delta, and sync state, so that the transition is observable.
22. As an agent reviewing travel context usage, I want before, after estimate, token delta, percentage-point delta, and message delta, so that no hidden classifier substitutes for judgment.
23. As an agent seeing `unknown` usage, I want structural message facts preserved, so that I can still reason about the boundary.
24. As an agent after a successful non-task fold, I want one cue to checkpoint the next phase before its first action, so that the state transition completes.
25. As an agent after a task-chain fold, I want one cue to answer from the handoff branch, so that archived process does not re-enter the response.
26. As an agent whose travel fails, I want only the relevant rollback and recovery details, so that exceptional output is actionable without normal-path noise.
27. As an agent inspecting tool details programmatically, I want stable structured field names, so that textual presentation can evolve independently.
28. As a maintainer, I want one timeline discriminator rather than precedence logic, so that every valid parameter combination has one meaning.
29. As a maintainer, I want invalid combinations rejected by the parameter schema, so that execution code does not need ignored-argument branches.
30. As a maintainer, I want old timeline booleans removed without compatibility shims, so that the clean cutover remains the only contract.
31. As a maintainer, I want the old estimated-effect classifier removed, so that unvalidated thresholds do not become implicit product policy.
32. As a maintainer, I want success and failure result builders separated, so that progressive disclosure remains consistent across tools.
33. As a maintainer, I want tool descriptions generated from the canonical ACM guidance, so that interface wording cannot drift from the Skill.
34. As a maintainer, I want tests at registered tool schemas and execute handlers, so that validation and observed results are covered together.
35. As a maintainer, I want result tests to assert structured details and essential concise text rather than entire prose snapshots, so that harmless wording changes remain cheap.
36. As a maintainer, I want raw evidence fields to remain available even when UI rendering is shortened, so that agent reasoning is not coupled to presentation.

## Implementation Decisions

- The public tool set remains exactly `acm_checkpoint`, `acm_timeline`, and `acm_travel`.
- `acm_timeline` uses a single view discriminator with values `active`, `checkpoints`, `search`, and `tree`.
- Omitting the view selects `active`.
- The search view requires a trimmed, non-blank, case-insensitive `query` that matches labels, node IDs, or rendered content across the full tree. The checkpoints view accepts an optional trimmed, non-blank, case-insensitive `filter` that matches checkpoint labels or entry IDs only. `query` and `filter` are invalid in every other view.
- Verbose output applies only to the active view.
- Every timeline view accepts the same integer `limit` range `1..50`, default `50`, with a view-specific unit: `active` limits the most recent visible active-path entries; `checkpoints` limits sorted alias rows after filtering; `search` limits deterministic full-tree matches; `tree` limits traversal depth per root.
- The active view reports how many otherwise-visible entries were omitted. The checkpoints view reports total matching aliases and displayed aliases. The search view reports whether additional matches were truncated. The tree view retains a hard 200-line output ceiling in addition to depth and reports `treeTruncated` when either bound is reached.
- Timeline parameters use a strict discriminated schema. Unknown keys, legacy booleans, misspelled fields, and fields invalid for the selected view are rejected with validation errors rather than stripped or ignored.
- View-specific schema validation replaces mode precedence and ignored parameters.
- The old boolean parameters and precedence behavior are removed without aliases or deprecation shims.
- Timeline is the decision-support surface for non-obvious target selection. No `preview` or `apply` mode is added to travel.
- Travel performs target resolution, label uniqueness checks, backup-target resolution, handoff structure checks, host capability checks, abort checks, and other side-effect-free validation before the first mutation.
- Travel does not reject or approve semantic boundaries based on token thresholds.
- The 500-token/2-percent estimated-effect classifier and its `shrunk/restored/unchanged` semantic label are removed.
- Context reporting includes observed/estimated values directly: usage before, estimated usage after, token delta, percentage-point delta when available, message counts, and structural message delta.
- Unavailable estimates are represented as `null` or `unknown`, never synthesized.
- A structural direction may describe whether message count increased, decreased, or stayed equal; it must not be presented as a recommendation.
- Successful text output is short and contains one context-sensitive next cue.
- Structured details retain all recovery-relevant identifiers and outcomes even when text is concise.
- Exceptional outputs disclose the failure-specific recovery procedure and omit unrelated teaching.
- Tool descriptions derive from canonical guidance fragments and use the same leading words as CORE.

## Testing Decisions

- The highest interface seam is the registered tool schema plus its execute handler against a controlled session context.
- Timeline schema tests cover every valid view, the default view, required trimmed search query, whitespace-only query rejection, optional trimmed checkpoint filter, whitespace-only filter rejection, label/entry-ID filter matching, forbidden query/filter/view combinations, unknown-key rejection, legacy-boolean rejection, verbose restrictions, and the shared `1..50` limit bound.
- Clean-cutover tests assert that legacy booleans are rejected rather than silently interpreted.
- Timeline behavior tests cover active path, alias catalog, full-tree search, off-path matches, tree truncation, empty results, unavailable usage, and aborted rendering.
- Limit behavior tests cover default `50`, minimum `1`, maximum `50`, out-of-range rejection, active-path omission counts, checkpoint total/displayed counts, search truncation, tree depth truncation, and the independent 200-line tree ceiling.
- Checkpoint result tests cover automatic target resolution, explicit target resolution, aliases, idempotence, collisions, unavailable usage, milestone cues, and concise success text.
- Travel prevalidation tests assert that entries, leaf, and label journal remain unchanged for every failure discovered before mutation.
- Travel result tests cover on-path and off-path targets, with and without backup, known and unknown usage, message increase/decrease/equality, pending context rebuild, and actual context rebuild.
- Effect-reporting tests assert exact raw deltas and absence of threshold-derived action labels.
- Progressive-disclosure tests assert that success output contains one next cue and that each failure class contains only its relevant recovery information.
- Structured-detail tests treat field names and nullability as the stable contract while allowing concise display prose to evolve.
- Tool-description tests assert consistency with canonical generated guidance rather than independent manually maintained strings.
- Existing pure rendering and target-resolution tests remain prior art; new tests should prefer the registered-tool seam where practical.

## Out of Scope

- Adding more ACM tools.
- Splitting timeline into separate search, checkpoints, and tree tools.
- Adding a two-call travel preview/apply protocol.
- Runtime approval or rejection of semantic boundary quality.
- Numeric task-end fold thresholds.
- Backward-compatible aliases for old timeline parameters.
- A model benchmark for determining whether result prose is understood.
- Changing SessionManager mutation mechanics, which belong to the Host Bridge specification.
- Changing the canonical guidance content, which belongs to the agent-guidance specification.

## Further Notes

- "Preview" in agent guidance should mean inspecting timeline candidate evidence, not invoking a separate travel state.
- Boundary decides whether a fold is semantically valid; timeline measures available structural/context evidence.
- The implementation should preserve unknown values as unknown. Missing context usage must not be classified as no saving.
- The single-view cutover requires simultaneous updates to CORE, the advanced Skill, examples, tool descriptions, tests, README maintenance notes, and the integrated repository copy.
- The implementation must record the user-decided interface cutover and evidence-only result policy in the repository implementation notes before code changes begin.
