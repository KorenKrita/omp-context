# ACM Canonical Repository, Version, and Manual Sync Contract

Status: resolved

## Problem Statement

`omp-context` is the canonical ACM implementation, while the integrated `magic-acm-context` repository consumes the same module with additional Magic Context composition. The current manual sync script copies only part of the ACM implementation, so tests, Skill/reference content, generated guidance, metadata, and interface updates can require separate manual work.

This creates misleading drift signals. During investigation, the local standalone checkout appeared functionally behind the integrated repository, but the latest remote standalone implementation and integrated ACM implementation were identical; the local branch was simply ahead by one documentation commit and behind by four remote commits. The commit history and sync script confirm that changes originate in `omp-context` and are then copied into the integrated repository.

The package also declares caret OMP peer ranges while validation is performed against one installed version. This overstates compatibility. The maintainer has chosen OMP `16.4.2` as the exact supported host release and will replace that value deliberately when updating.

## Solution

Make the repository and version contracts explicit and mechanically supported:

- `omp-context` remains the sole canonical ACM source.
- The integrated repository receives ACM changes only through an expanded manual sync script.
- The script synchronizes implementation, pure logic, canonical guidance package, generated guidance artifacts, corresponding tests, and relevant metadata mappings.
- The script performs local preflight and post-copy verification but does not add cross-repository CI or automatic pull requests.
- OMP peer and development dependencies for `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-agent-core`, and `@oh-my-pi/pi-ai` declare exact version `16.4.2`.
- Updating OMP is a deliberate maintenance operation: replace `16.4.2` with the selected new exact release, inspect the host surface, run focused tests, update known limits, then synchronize the integrated repository.
- README is maintainer-facing and documents installation, architecture, canonical direction, exact version, sync operation, verification, and known host limits without duplicating agent guidance.

## User Stories

1. As a maintainer, I want `omp-context` named as the canonical ACM repository, so that feature work begins in the correct place.
2. As a maintainer, I want the integrated repository described as a consumer, so that reverse synchronization does not overwrite canonical work.
3. As a maintainer comparing the repositories, I want intentional wrapper differences distinguished from drift, so that Magic Context composition is not mistaken for a fork.
4. As a maintainer, I want one manual sync command, so that implementation and guidance move together.
5. As a maintainer, I want the sync command to copy the complete ACM implementation surface, so that a new runtime helper cannot be omitted accidentally.
6. As a maintainer, I want canonical CORE, Skill, and advanced references synchronized together, so that both agents receive the same operating contract.
7. As a maintainer, I want generated prompt and tool-description artifacts refreshed during sync, so that derived output cannot remain stale.
8. As a maintainer, I want corresponding unit, Host Bridge, handler, and tool-contract tests synchronized or mapped, so that the consumer retains equivalent evidence.
9. As a maintainer, I want source and destination mappings declared centrally in the script, so that adding one canonical artifact is a visible maintenance change.
10. As a maintainer, I want the script to fail when a required canonical source is missing, so that a partial sync is never reported as successful.
11. As a maintainer, I want the script to fail when the destination layout is incompatible, so that it does not create misplaced copies silently.
12. As a maintainer, I want the script to preserve known integrated wrappers, so that Magic Context-specific composition is not overwritten by standalone files.
13. As a maintainer, I want a post-copy comparison of every mapped artifact, so that successful completion means byte or generated-semantic parity.
14. As a maintainer, I want the script to print every changed destination, so that the resulting integrated commit is reviewable.
15. As a maintainer, I want a no-change result when repositories are already aligned, so that repeated syncs are idempotent.
16. As a maintainer, I want no network automation or repository token requirement, so that personal maintenance remains simple.
17. As a maintainer, I want no automatic cross-repository pull request, so that synchronization remains an explicit local action.
18. As a maintainer, I want OMP `16.4.2` declared in peer metadata, so that compatibility claims match the host surface audited by this specification.
19. As a maintainer, I want OMP `16.4.2` in development dependencies and lock state, so that local tests exercise the declared host.
20. As a maintainer updating OMP, I want a defined host-surface review, so that changes to extension events, SessionManager, session-context building, tool registration, or token estimation are examined deliberately.
21. As a maintainer updating OMP, I want real SessionManager and registered-handler tests run before changing the supported version, so that the version bump is evidence-backed.
22. As a maintainer updating OMP, I want public APIs preferred when they replace guarded internals, so that the Host Bridge can become shallower over time.
23. As a maintainer updating OMP, I want unsupported public behavior detected rather than shimmed across old versions, so that latest-only support remains simple.
24. As a maintainer, I want no compatibility matrix, so that the project does not claim support it does not continuously verify.
25. As a maintainer, I want README to state that the supported OMP release is exactly `16.4.2` until a deliberate version-update change replaces it, so that installation expectations are unambiguous.
26. As a maintainer, I want README to document the canonical sync direction, so that future agents do not infer direction from directory nesting.
27. As a maintainer, I want README to explain the intentional standalone/integrated wrapper difference, so that prompt composition does not appear as drift.
28. As a maintainer, I want README to link to canonical guidance rather than reproduce it, so that the agent contract remains single-source.
29. As a maintainer, I want local branch divergence checked before implementation or sync, so that stale checkouts are not used for architectural conclusions.
30. As a maintainer, I want pre-existing local commits preserved during updates, so that synchronization work does not discard unrelated documentation or user changes.
31. As a maintainer, I want every cross-repository sync committed separately in the integrated repository, so that provenance and rollback remain clear.
32. As a maintainer, I want the sync script usable from either repository location with explicit path resolution, so that current working directory does not change its target.
33. As a maintainer, I want failures to identify the missing or mismatched artifact, so that repair does not require reading the whole script.
34. As a maintainer, I want the script tested in temporary fixture repositories, so that copying and preservation behavior is deterministic.

## Implementation Decisions

- `omp-context` is the canonical ACM implementation and guidance repository.
- `magic-acm-context` consumes ACM through a manual local sync operation.
- Synchronization direction is one-way from canonical standalone to integrated consumer.
- The manual sync script remains the only synchronization mechanism. No CI parity job, webhook, scheduled task, or automatic pull request is added.
- The script maps all canonical implementation modules, Host Bridge modules, canonical guidance files, advanced references, generated artifacts, and corresponding test suites.
- Integrated-only wrappers remain owned by the integrated repository and are never overwritten wholesale.
- Where standalone and integrated test harnesses need different imports or registration helpers, the script performs a declared transformation or invokes a generator; it must not rely on undocumented hand editing.
- The script validates source existence, destination root identity, supported layout, and required generation tools before copying.
- After copying/generation, the script verifies every declared mapping and exits non-zero on mismatch.
- The script is idempotent and prints a concise changed-file report.
- The script does not stage, commit, fetch, rebase, merge, or push. Git operations remain explicit maintainer actions.
- Both peer and development dependency declarations for the OMP coding-agent, agent-core, and pi-ai packages use exact version `16.4.2`.
- A version update atomically replaces every `16.4.2` declaration with one selected new exact release rather than widening a range or retaining compatibility aliases.
- The OMP update checklist covers extension event types, public context APIs, SessionManager methods used by the Host Bridge, session-context construction, tool schema registration, token estimation, compaction events, and relevant changelog entries.
- Focused tests and type checking must pass before the new exact version is documented or synchronized.
- README is maintainer-facing and contains no duplicated normal-path agent discipline.
- The implementation must preserve unrelated local commits and working-tree changes; stale/diverged branches are reconciled before edits begin.

## Testing Decisions

- The highest sync seam is the manual sync command executed against temporary canonical and consumer fixture directories.
- Sync tests cover a clean first copy, an already-aligned no-op, one changed source, one removed/missing required source, an incompatible destination layout, and an integrated-only wrapper that must remain unchanged.
- Mapping tests assert that every canonical guidance and runtime artifact has an explicit destination or declared transformation.
- Generation tests assert deterministic output and idempotence across repeated syncs.
- Post-copy verification tests intentionally corrupt one destination and assert a non-zero failure naming that artifact.
- Tests assert that the script never modifies Git index, commits, remotes, branches, or unrelated files.
- Version-contract tests assert exact `16.4.2` equality among all three OMP peer declarations, all three development declarations, installed packages, lock state, and the documented supported version.
- OMP update verification uses the real SessionManager and captured public extension handlers specified by the runtime-reliability spec.
- README tests may verify key maintenance facts such as canonical direction and exact supported version, but should not snapshot explanatory prose.
- Existing source comparison and sync-script behavior are prior art; tests should exercise the script as a command rather than testing individual shell statements.

## Out of Scope

- Cross-repository CI parity checks.
- Automatic synchronization pull requests.
- Scheduled or webhook-driven synchronization.
- Supporting multiple OMP versions at once.
- Compatibility shims for older OMP hosts.
- Making the integrated repository canonical.
- Extracting ACM into a separately published shared package.
- Letting the sync script stage, commit, rebase, merge, or push.
- Duplicating the agent operating contract in README.
- Synchronizing unrelated Magic Context modules.

## Further Notes

- Directory nesting does not define authority. Commit history and the existing script establish the standalone-to-integrated direction.
- The local standalone branch observed during specification was ahead of its remote by one documentation commit and behind by four remote commits; implementation must reconcile that state without losing the local commit.
- Exact-version support intentionally trades installation breadth for truthful evidence and lower maintenance complexity.
- The implementation must record the user-decided canonical direction, latest-only policy, and manual-sync-only constraint in the repository implementation notes before code changes begin.
