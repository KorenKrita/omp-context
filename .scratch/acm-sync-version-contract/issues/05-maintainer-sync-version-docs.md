# 05 — Publish canonical sync and version maintenance contract

**What to build:** Document the completed one-way manual synchronization and exact-host policy for maintainers without creating another copy of the agent operating discipline.

**Blocked by:** 03 — Promote OMP 16.4.2 to the exact public host contract; 04 — Synchronize the complete canonical ACM surface

**Status:** ready-for-agent

- [ ] Maintainer documentation names `omp-context` as the sole canonical ACM implementation and guidance repository.
- [ ] The integrated repository is described as a consumer reached only through the manual sync command.
- [ ] The documented supported OMP release is exactly `16.4.2` for coding-agent, agent-core, and pi-ai.
- [ ] Documentation explains the isolated candidate-verification process required before a future exact-version promotion.
- [ ] Documentation describes the sync command, root/path expectations, preflight guarantees, changed-file report, post-copy verification, and idempotent no-op behavior.
- [ ] Documentation states that the sync command never performs Git operations and that each repository's resulting changes are committed separately.
- [ ] The intentional standalone/integrated wrapper difference is explained without implying a functional fork.
- [ ] Known host limitations describe guarded SessionManager access and private agent-message non-synchronization accurately.
- [ ] Human documentation links to canonical CORE and the advanced Skill instead of repeating normal agent guidance.
- [ ] Focused maintenance checks verify canonical direction and exact version facts without snapshotting explanatory prose.
- [ ] User-decided canonical direction, manual-sync-only policy, exact-version policy, and plugin-only boundary are recorded with provenance in implementation notes.
