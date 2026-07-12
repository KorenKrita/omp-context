# 05 — Isolate sessions, subagents, and extension reloads

**What to build:** Ensure private live-state synchronization is scoped to the exact SessionManager and AgentSession pair that performed travel, even when multiple sessions, parent agents, subagents, or repeated extension registrations coexist in one process.

**Blocked by:** 02 — Synchronize one successful shrinking travel end to end.

**Status:** ready-for-agent

- [ ] Travel in one of two concurrently registered sessions changes only that session's live AgentSession messages.
- [ ] A parent session and subagent session remain isolated when either runtime performs travel.
- [ ] Session association uses object identity and cannot cross-match sessions that share a working directory, model, or similar session metadata.
- [ ] Duplicate extension registration and extension reload install only one effective wrapper.
- [ ] The wrapped host lifecycle method invokes its original implementation exactly once per call.
- [ ] Clearing or completing one session's synchronization state does not remove another session's pending work or captured association.
- [ ] Completed sessions remain garbage-collectable; the implementation introduces no strong global registry of live sessions.
- [ ] Real-host fixture coverage exercises at least two distinct SessionManager/AgentSession pairs in one process and verifies both message-state and diagnostic isolation.
