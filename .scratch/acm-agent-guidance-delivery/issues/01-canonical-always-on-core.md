# 01 — Deliver canonical always-on CORE in standalone

**What to build:** Establish the ACM Skill package as the single source of truth for the normal operating contract, generate the always-on CORE from that source, and inject it through OMP's public `before_agent_start` boundary without losing or duplicating any existing system-prompt segment.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] The canonical CORE defines working set, boundary, handoff, archive, chain, burst, and anchor gravity in one co-located vocabulary section.
- [ ] The normal path is expressed as a lightweight, checkable state-transition table without adding persisted runtime state.
- [ ] High context pressure triggers a boundary check and does not independently authorize travel.
- [ ] The fold gate retains boundary identification, a semantically executable NEXT requirement, and raw recoverability as agent completion criteria.
- [ ] The handoff contract contains Goal, State, Evidence, External, Exclusions, Recover, and NEXT in fixed order and requires `none` for an empty category.
- [ ] CORE contains the burst, failed-direction, and finished-task-chain representative examples.
- [ ] Canonical sections used by generated artifacts have explicit, stable boundaries and remain the only editable source.
- [ ] Generation is deterministic and idempotent.
- [ ] The standalone extension appends a stable, versioned ACM marker and CORE through `before_agent_start`.
- [ ] Every pre-existing system-prompt segment remains byte-for-byte present and in the same order.
- [ ] An existing ACM marker prevents duplicate injection without removing unrelated prompt content.
- [ ] Focused tests exercise the captured public handler with empty, populated, already-marked, and multi-extension system prompts.
