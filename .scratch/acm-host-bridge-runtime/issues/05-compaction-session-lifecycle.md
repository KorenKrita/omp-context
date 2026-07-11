# 05 — Verify compaction and session lifecycle recovery

**What to build:** Integrate ACM refresh and recovery state with native OMP compaction and session lifecycle events, preserving resolvable pre-compaction anchors while documenting the remaining host-owned in-memory message limitation accurately.

**Blocked by:** 04 — Rebuild and sanitize model context after travel and restore

**Status:** resolved

- [x] Native `session_before_compact` creates a unique recovery checkpoint through the Host Bridge and real label journal.
- [x] The automatic checkpoint remains discoverable and resolvable after a real compaction entry is appended.
- [x] Native compaction clears pending travel-refresh and retry state for the affected SessionManager before later context reconstruction can use an obsolete leaf.
- [x] Session start and session shutdown clear all session-scoped refresh, retry, and sanitation state.
- [x] State belonging to one SessionManager cannot leak into another concurrent or subsequent session.
- [x] Compaction handling does not cancel, replace, or delay OMP native compaction.
- [x] The plugin does not attempt to mutate OMP's private `agent.state.messages` or claim atomic host synchronization.
- [x] Maintainer-facing diagnostics describe the remaining tree-versus-agent-memory limitation without presenting it as inevitable data loss.
- [x] Real SessionManager and captured lifecycle-handler tests cover pre-compaction anchoring, post-compaction resolution, state clearing, session restart, session shutdown, and session isolation.
- [x] Existing normal travel and restored-session behavior remains valid after lifecycle integration.
- [x] User-decided Host Bridge, plugin-only, and no-compaction-cancellation choices are recorded in implementation notes.
