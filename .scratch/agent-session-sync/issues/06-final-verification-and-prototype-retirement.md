# 06 — Complete pinned-host verification and retire the prototype

**What to build:** Close the parent specification with one coherent pinned-OMP verification pass that combines the completed travel, recovery, lifecycle, and isolation behaviours. Replace the feasibility prototype with production fixtures and leave the repository with no prototype-only runner or duplicated implementation.

**Blocked by:** 03 — Preserve travel and recovery when live synchronization fails; 04 — Support repeated travel, off-path restoration, and resume; 05 — Isolate sessions, subagents, and extension reloads.

**Status:** resolved

- [x] The primary pinned-OMP prompt-loop acceptance fixture exercises travel, the complete in-flight tool pair, next provider context, and native stored-context behaviour in one scenario.
- [x] The full focused verification matrix covers successful shrinking travel, repeated travel, off-path restoration, resume, native compaction threshold behaviour, unsupported host shape, synchronization failure, and multi-session/subagent isolation.
- [x] Native auto-compaction no longer immediately retriggers from the pre-travel AgentSession array after successful synchronization.
- [x] Pre-compaction checkpoints are created only for real compaction attempts rather than stale post-travel accounting.
- [x] Existing version-contract and maintenance checks continue to enforce the exact supported OMP host version.
- [x] Production code contains no generic private-access framework and synchronizes no unrelated AgentSession state without evidence.
- [x] The throwaway prototype, prototype-only runner commands, and duplicated helper code are removed only after equivalent production fixtures pass.
- [x] Implementation notes record the final adapter decision, verified invariants, private-host risks, and replacement path if OMP later exposes an official refresh interface.
- [x] All focused project checks required by the touched production and host-fixture surfaces pass.

## Comments

Resolved with the exact declared OMP acceptance matrix in `test/host-fixture/travel-live-sync.test.ts`, `agent-session-adapter.test.ts`, and `compaction-lifecycle.test.ts`. The primary scenario now proves that the pre-travel stored message estimate crosses the native compaction threshold, the synchronized traveled branch falls below it, no synthetic `pre-compact-*` checkpoint is created by travel, the in-flight tool pair remains valid, and provider context/tree recovery remain truthful. Repeated travel, off-path restore, resume, failure, unsupported-host, lifecycle, and two-session parent/subagent isolation are covered by the same pinned host fixture suite.

The throwaway `prototype-agent-session-sync.ts` and both prototype runner commands were removed after focused production fixtures passed. `implementation-notes.html`, `README.md`, and `AGENTS.md` now document the production adapter decision, exact host seam, fallback guarantees, private-host risk, and migration path to a future official OMP refresh API.
