# 04 — Support repeated travel, off-path restoration, and resume

**What to build:** Make live synchronization remain correct as a session travels repeatedly, restores an off-path branch, and crosses lifecycle boundaries. Each operation must converge to the latest resulting leaf without reintroducing messages from branches abandoned by earlier travels.

**Blocked by:** 02 — Synchronize one successful shrinking travel end to end.

**Status:** ready-for-agent

- [ ] Two or more consecutive travel operations synchronize the live AgentSession to the latest resulting leaf.
- [ ] A later travel supersedes only pending work for the same SessionManager and cannot apply an obsolete replacement after the newer travel.
- [ ] Traveling to an off-path checkpoint expands to the selected branch and synchronizes the live state to that restored branch.
- [ ] Folded branches remain available for later restoration after their messages have been removed from live AgentSession state.
- [ ] Session persistence and resume reconstruct the same active branch without relying on AgentSession objects captured by the previous process.
- [ ] Session start, reload, compact, shutdown, and terminal synchronization outcomes clear or rebuild adapter state according to their lifecycle meaning.
- [ ] The next provider context after each scenario equals the sanitized active branch and contains no messages from an unrelated abandoned path.
- [ ] Host-fixture scenarios cover repeated shrinking travel, expanding off-path restoration, persistence, resume, and lifecycle cleanup.
