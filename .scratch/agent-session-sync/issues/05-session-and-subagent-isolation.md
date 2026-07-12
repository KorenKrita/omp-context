# 05 — Isolate sessions, subagents, and extension reloads

**What to build:** Ensure private live-state synchronization is scoped to the exact SessionManager and AgentSession pair that performed travel, even when multiple sessions, parent agents, subagents, or repeated extension registrations coexist in one process.

**Blocked by:** 02 — Synchronize one successful shrinking travel end to end.

**Status:** resolved

- [x] Travel in one of two concurrently registered sessions changes only that session's live AgentSession messages.
- [x] A parent session and subagent session remain isolated when either runtime performs travel.
- [x] Session association uses object identity and cannot cross-match sessions that share a working directory, model, or similar session metadata.
- [x] Duplicate extension registration and extension reload install only one effective wrapper.
- [x] The wrapped host lifecycle method invokes its original implementation exactly once per call.
- [x] Clearing or completing one session's synchronization state does not remove another session's pending work or captured association.
- [x] Completed sessions remain garbage-collectable; the implementation introduces no strong global registry of live sessions.
- [x] Real-host fixture coverage exercises at least two distinct SessionManager/AgentSession pairs in one process and verifies both message-state and diagnostic isolation.

## Comments

Resolved by extending `test/host-fixture/travel-live-sync.test.ts` with a two-session pinned-host scenario that models a parent and subagent in one process. Both travels are pending concurrently; completing the parent updates only its live messages and diagnostics while the subagent remains unchanged and pending, then completing the subagent updates only its own state. Existing pinned-host adapter coverage proves duplicate installation preserves one wrapper and invokes the original lifecycle method exactly once. The production adapter already uses `WeakMap<SessionManager, WeakRef<AgentSession>>`, so no global current-session pointer or strong live-session registry was added.
