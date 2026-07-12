# 01 — Establish the version-checked live AgentSession adapter

**What to build:** Introduce the narrow host adapter that associates each live AgentSession with its SessionManager and can schedule and apply an active-branch message synchronization. The adapter must remain inert when the pinned OMP capability contract is unavailable, expose structured outcomes, and leave existing travel behaviour unchanged until the integration ticket consumes it.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The adapter captures the AgentSession associated with each SessionManager through the pinned host lifecycle point and invokes the original host behaviour exactly once.
- [ ] Associations are keyed by SessionManager identity with weak references; there is no global current-session pointer or file-path matching.
- [ ] Installation is idempotent across duplicate registration and extension reload.
- [ ] Exact host-version and runtime capability checks produce `unavailable` rather than guessing private property shapes.
- [ ] The synchronization lifecycle reports `unavailable`, `pending`, `applied`, `failed`, and `skipped` outcomes without exposing private host objects.
- [ ] A real pinned-OMP host fixture proves one captured session can replace its live conversation messages with messages rebuilt from its active SessionManager leaf.
- [ ] Focused failure tests cover unsupported host shape, missing association, duplicate installation, and a replacement failure.
- [ ] HostBridge remains the sole seam for SessionManager label and branch mutations; this adapter does not absorb tree mutation responsibilities.
