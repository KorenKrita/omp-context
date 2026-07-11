# ACM OMP Host Bridge and Runtime Reliability

Status: resolved

## Problem Statement

ACM is an OMP plugin that must mutate the session tree and rebuild model context, but the public extension context does not expose a tool-safe atomic tree-navigation API. The current implementation therefore uses guarded access to runtime SessionManager capabilities while mixing those host-specific calls into a large tool-registration module.

This coupling is load-bearing: a change in OMP's internal SessionManager behavior can break checkpoint labels, travel, backup rollback, branch summaries, context rebuilding, or restored-session sanitation. Existing tests cover pure logic and several captured handlers, but most SessionManager behavior is represented by hand-written stubs rather than the real latest OMP implementation.

## Solution

Introduce a narrow Host Bridge as the sole boundary between ACM domain logic and OMP runtime internals. The bridge exposes only the capabilities ACM requires, validates them at runtime, and returns explicit structural results or actionable failures.

Verify the bridge and travel lifecycle against the real SessionManager from the exact supported OMP version without launching an LLM or requiring an API key. Keep tool orchestration and agent-facing semantics outside the bridge.

The runtime remains plugin-only. It continues using persistent context reconstruction after travel because OMP does not expose tool-safe atomic navigation. The known difference between SessionManager tree state and the host agent's in-memory messages remains a documented host limitation rather than an invented plugin-side state machine.

## User Stories

1. As an agent creating a checkpoint, I want the plugin to confirm that the host can append entry labels, so that failure is explicit instead of silent.
2. As an agent reusing a checkpoint name on the same node, I want idempotent behavior, so that retries do not corrupt the alias journal.
3. As an agent adding another alias to a node, I want prior aliases preserved, so that every recovery name remains usable.
4. As an agent traveling to a checkpoint, I want target resolution completed before mutation, so that invalid targets leave the tree unchanged.
5. As an agent traveling to an off-path node, I want the plugin to report that raw history may be restored, so that context growth is not mistaken for failure.
6. As an agent using `root`, I want the actual resolved top-level node reported, so that multi-root behavior remains observable.
7. As an agent requesting a backup bookmark, I want the bookmark placed on the nearest meaningful USER/AI entry, so that recovery does not point at transient tool traffic.
8. As an agent encountering a backup-name collision, I want travel aborted before any mutation, so that existing labels remain authoritative.
9. As an agent whose branch creation fails after writing a new backup label, I want a best-effort rollback, so that failed travel does not leave unnecessary state.
10. As an agent whose backup entry already had aliases, I want rollback to preserve those aliases, so that recovery does not destroy unrelated names.
11. As an agent whose rollback fails, I want the remaining label and entry identifier reported, so that I can recover deliberately.
12. As an agent after successful travel, I want the SessionManager leaf to point at the new branch summary, so that future entries append to the handoff branch.
13. As an agent after successful travel, I want the next model context rebuilt from the new branch, so that abandoned raw history is not sent forward.
14. As an agent on subsequent turns, I want the rebuilt branch to remain authoritative, so that one successful refresh is not followed by a stale context regression.
15. As an agent after a restored session, I want persisted orphaned ACM tool results sanitized, so that provider tool-call pairing remains valid.
16. As an agent after travel, I want orphaned tool calls repaired or removed according to provider requirements, so that the next request is accepted.
17. As an agent when context reconstruction fails transiently, I want bounded retries and visible status, so that a recoverable host error is not treated as permanent immediately.
18. As an agent after retry exhaustion, I want a clear reload recovery instruction, so that the failure remains actionable.
19. As an agent using timeline after travel, I want pending, rebuilt, retry, and failure states reported accurately, so that model-context synchronization is observable.
20. As an agent when OMP compacts the session, I want stale travel-refresh state cleared, so that the plugin does not rebuild from an obsolete leaf.
21. As an agent before native compaction, I want the automatic recovery checkpoint to use the real label journal, so that it remains resolvable after compaction.
22. As a maintainer updating OMP, I want all internal capability probes centralized, so that one audit identifies every compatibility risk.
23. As a maintainer, I want the bridge to reject missing or malformed host methods with named capability errors, so that version drift is diagnosed directly.
24. As a maintainer, I want the bridge to return typed structural facts, so that tools do not infer host behavior from prose or incidental objects.
25. As a maintainer, I want real SessionManager tests with temporary session storage, so that label replay, leaf movement, branch summaries, and context building match OMP itself.
26. As a maintainer, I want tests that do not instantiate an LLM, so that runtime verification remains deterministic and locally runnable.
27. As a maintainer, I want context handler tests to use captured public extension events, so that event composition is tested at the highest practical seam.
28. As a maintainer, I want travel mutation and context reconstruction tested separately, so that a failure identifies the host bridge or lifecycle layer precisely.
29. As a maintainer, I want no internal OMP types to leak into ACM pure-domain modules, so that domain logic remains independently testable.
30. As a maintainer, I want the known stale `agent.state.messages` limitation stated without implying data loss is inevitable, so that the risk is accurate and proportionate.
31. As a maintainer, I want no plugin-side attempt to cancel native compaction as a stale-state workaround, so that one host limitation is not replaced with permanent compaction failure.
32. As a maintainer, I want every significant tree mutation to have a focused regression test, so that future OMP updates cannot silently change session semantics.

## Implementation Decisions

- A dedicated Host Bridge is the only module allowed to perform guarded runtime access to non-public SessionManager methods.
- The bridge exposes narrowly named operations for appending/clearing entry labels, creating a branch summary, building session messages, and reading structural session state needed by ACM.
- The bridge validates method existence, argument expectations, and return identifiers before reporting success.
- The bridge does not decide semantic boundaries, target quality, handoff quality, or whether a fold is worthwhile.
- Tool orchestration resolves targets, validates label uniqueness, and completes every side-effect-free check before calling the first mutating bridge operation.
- Backup-label rollback remains best effort. It may clear a label only when the target entry had no prior aliases and the current call created the label.
- Travel remains synchronous at the SessionManager layer.
- Successful travel records the summary leaf and activates persistent context reconstruction for subsequent `context` events.
- Context reconstruction uses OMP's real session-context builder and then applies provider-valid tool-call/tool-result sanitation.
- Restored-session sanitation runs even when no in-memory travel refresh is pending.
- Refresh retries remain bounded and session-scoped. Success, compaction, session start, and session shutdown clear stale state.
- Native `session_before_compact` recovery checkpoints remain supported and are tested as host behavior; they are not used to cancel or replace native compaction.
- The plugin does not claim to synchronize OMP's private agent message array. The limitation is documented at the host boundary.
- The implementation remains plugin-only and does not require an OMP upstream API change.
- Runtime details returned to tools use observable structural facts: resolved identifiers, leaf identifiers, label outcomes, message counts, context-build outcomes, retry state, and rollback state.

## Testing Decisions

- The highest practical runtime seam is a real OMP SessionManager plus captured extension handlers; no model provider is involved.
- Tests create isolated temporary session storage and use the real append, label-journal, branch-summary, tree, branch, and context-building behavior.
- Bridge capability tests cover supported methods, missing methods, malformed return values, and explicit error classification.
- Label tests cover unique labels, case-sensitive aliases, same-node idempotence, multiple aliases, replay after reload, and clearing only when safe.
- Target-resolution tests cover active-path labels, off-path labels, raw node IDs, `root`, missing targets, multi-root sessions, and explicit non-message nodes.
- Travel tests assert the new summary entry, leaf movement, branch metadata, origin metadata, and preservation of the abandoned branch.
- Mutation-order tests snapshot entries, leaf, and labels before each failure path and assert that all side-effect-free validation failures leave them unchanged.
- Rollback tests cover successful rollback, skipped rollback when prior aliases exist, rollback failure, and the resulting recovery details.
- Context tests assert that rebuilt messages correspond to the summary branch rather than the abandoned branch.
- Sanitation tests cover orphaned travel tool results after session restore and assistant tool calls whose results live only on an abandoned branch.
- Retry tests cover first failure, bounded retry progression, eventual success, exhaustion, and cleanup on session lifecycle events.
- Native compaction tests assert that the pre-compaction checkpoint remains discoverable and resolvable after a real compaction entry is appended.
- Tests should assert observable tree and message contracts rather than private field layouts.
- Existing pure tests remain the prior art for target resolution, alias maps, usage estimation, meaningful-entry selection, and timeline modes.

## Out of Scope

- Adding a tool-safe tree-navigation API to OMP upstream.
- Direct access to or mutation of OMP's private agent message array.
- Full CLI plus real-model end-to-end tests.
- Supporting multiple historical OMP versions.
- Using native compaction cancellation to compensate for stale agent state.
- Moving semantic boundary decisions into the Host Bridge.
- Replacing SessionManager with an ACM-owned session store.
- Redesigning the three public ACM tool responsibilities.

## Further Notes

- The Host Bridge is a deep-module seam: a small interface hides the unstable host mechanics while leaving ACM domain behavior visible and testable.
- Runtime hard checks are limited to observable structural facts. The plugin cannot objectively prove that a target precedes the intended semantic boundary or that a handoff is sufficient.
- The exact supported OMP version and cross-repository update process are specified separately.
- The implementation must record the user-decided Host Bridge and plugin-only constraints in the repository implementation notes before code changes begin.
