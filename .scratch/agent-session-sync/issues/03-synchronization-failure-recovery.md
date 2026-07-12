# 03 — Preserve travel and recovery when live synchronization fails

**What to build:** Keep a successful traveled branch usable and recoverable when private live-state synchronization is unavailable or fails. Users must receive actionable state and reload guidance, while failed or indeterminate branch mutations must never schedule message replacement.

**Blocked by:** 02 — Synchronize one successful shrinking travel end to end.

**Status:** ready-for-agent

- [ ] An unsupported host capability leaves travel functional through the persistent context rebuild and reports synchronization as unavailable.
- [ ] A failed or indeterminate branch mutation does not schedule or apply live message replacement.
- [ ] A synchronization failure after a successful branch mutation preserves the traveled branch, branch summary, and backup checkpoint.
- [ ] Post-mutation synchronization failure does not attempt to roll back an otherwise valid travel.
- [ ] Persistent context rebuild remains active and continues to provide the traveled branch to the next provider request.
- [ ] Travel output and timeline diagnostics distinguish unavailable, failed, skipped, and still-pending states and include actionable reload guidance where recovery is possible.
- [ ] Terminal failure clears only the corresponding pending synchronization work and cannot consume a later travel request for the same session.
- [ ] Failure-path tests verify that no unrelated AgentSession state is modified and no synthetic compaction or tool call is introduced.
