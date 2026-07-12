# 06 — Complete pinned-host verification and retire the prototype

**What to build:** Close the parent specification with one coherent pinned-OMP verification pass that combines the completed travel, recovery, lifecycle, and isolation behaviours. Replace the feasibility prototype with production fixtures and leave the repository with no prototype-only runner or duplicated implementation.

**Blocked by:** 03 — Preserve travel and recovery when live synchronization fails; 04 — Support repeated travel, off-path restoration, and resume; 05 — Isolate sessions, subagents, and extension reloads.

**Status:** ready-for-agent

- [ ] The primary pinned-OMP prompt-loop acceptance fixture exercises travel, the complete in-flight tool pair, next provider context, and native stored-context behaviour in one scenario.
- [ ] The full focused verification matrix covers successful shrinking travel, repeated travel, off-path restoration, resume, native compaction threshold behaviour, unsupported host shape, synchronization failure, and multi-session/subagent isolation.
- [ ] Native auto-compaction no longer immediately retriggers from the pre-travel AgentSession array after successful synchronization.
- [ ] Pre-compaction checkpoints are created only for real compaction attempts rather than stale post-travel accounting.
- [ ] Existing version-contract and maintenance checks continue to enforce the exact supported OMP host version.
- [ ] Production code contains no generic private-access framework and synchronizes no unrelated AgentSession state without evidence.
- [ ] The throwaway prototype, prototype-only runner commands, and duplicated helper code are removed only after equivalent production fixtures pass.
- [ ] Implementation notes record the final adapter decision, verified invariants, private-host risks, and replacement path if OMP later exposes an official refresh interface.
- [ ] All focused project checks required by the touched production and host-fixture surfaces pass.
