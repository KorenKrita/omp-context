# 03 — Promote OMP 16.4.2 to the exact public host contract

**What to build:** After the isolated `16.4.2` candidate passes the complete real-host verification chain, atomically make that exact release the root peer, development, lock, installed, and documented support contract for all OMP packages ACM uses.

**Blocked by:** 02 — Stage OMP 16.4.2 as the host-test candidate; acm-host-bridge-runtime/05 — Verify compaction and session lifecycle recovery

**Status:** ready-for-agent

- [ ] Real SessionManager, captured extension-handler, travel, context-rebuild, sanitation, compaction, and session-lifecycle tests have passed against the isolated `16.4.2` fixture before promotion begins.
- [ ] Peer dependencies for the OMP coding-agent, agent-core, and pi-ai packages are exactly `16.4.2` with no caret, tilde, wildcard, or compatibility range.
- [ ] Development dependencies for the same three packages are exactly `16.4.2`.
- [ ] Root lock state and installed package metadata resolve all three packages to `16.4.2` with no mixed OMP graph.
- [ ] Maintainer-facing support metadata changes to `16.4.2` in the same behavior boundary as package and lock changes.
- [ ] A focused version-contract check fails when any peer declaration, development declaration, lock entry, installed package, or documented supported version differs from `16.4.2`.
- [ ] Focused type checking and all ACM runtime/tool tests pass against the promoted root dependency graph.
- [ ] The isolated fixture remains usable as evidence for the promoted release or is regenerated from the same exact version without changing semantics.
- [ ] The OMP update checklist covers extension events, public context APIs, Host Bridge capabilities, session-context construction, tool registration, token estimation, compaction events, and changelog review.
- [ ] Future updates atomically replace every exact version only after the same isolated-candidate verification process passes.
- [ ] No compatibility matrix, older-host shim, fallback range, or unrelated dependency update is introduced.
