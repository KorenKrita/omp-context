# 02 — Synchronize one successful shrinking travel end to end

**What to build:** Make one successful ACM travel shrink both the persisted active branch and the live AgentSession state. Synchronization must occur after the matching travel tool execution finishes, preserve the in-flight tool call/result pair, keep folded history recoverable off-path, and make the next provider context and native stored-context accounting reflect the traveled branch.

**Blocked by:** 01 — Establish the version-checked live AgentSession adapter.

**Status:** ready-for-agent

- [ ] Only a definitively successful travel mutation schedules synchronization for its resulting SessionManager leaf.
- [ ] Message replacement occurs after the matching `acm_travel` tool execution ends, not inside the tool body.
- [ ] Replacement messages are rebuilt from the resulting active branch rather than derived from the pre-travel AgentSession array.
- [ ] The in-flight prompt retains a valid `acm_travel` tool call and tool result while live state synchronization occurs.
- [ ] The persisted active branch remains truthful: no synthetic tool call is copied into it and no fake compaction entry is created.
- [ ] The next provider context equals the sanitized active branch and excludes the folded path.
- [ ] Native stored-context accounting after synchronization is based on the active branch and no longer immediately crosses the threshold because of pre-travel messages.
- [ ] The complete session tree still retains the abandoned branch and its backup checkpoint for recovery.
- [ ] Travel result details and timeline diagnostics expose pending and applied synchronization states.
- [ ] A real pinned-OMP prompt-loop fixture proves the complete travel, tool-pair, provider-context, tree-recovery, and native-accounting contract.
