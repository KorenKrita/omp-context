# 03 — Preserve travel and recovery when live synchronization fails

**What to build:** Keep a successful traveled branch usable and recoverable when private live-state synchronization is unavailable or fails. Users must receive actionable state and reload guidance, while failed or indeterminate branch mutations must never schedule message replacement.

**Blocked by:** 02 — Synchronize one successful shrinking travel end to end.

**Status:** resolved

- [x] An unsupported host capability leaves travel functional through the persistent context rebuild and reports synchronization as unavailable.
- [x] A failed or indeterminate branch mutation does not schedule or apply live message replacement.
- [x] A synchronization failure after a successful branch mutation preserves the traveled branch, branch summary, and backup checkpoint.
- [x] Post-mutation synchronization failure does not attempt to roll back an otherwise valid travel.
- [x] Persistent context rebuild remains active and continues to provide the traveled branch to the next provider request.
- [x] Travel output and timeline diagnostics distinguish unavailable, failed, skipped, and still-pending states and include actionable reload guidance where recovery is possible.
- [x] Terminal failure clears only the corresponding pending synchronization work and cannot consume a later travel request for the same session.
- [x] Failure-path tests verify that no unrelated AgentSession state is modified and no synthetic compaction or tool call is introduced.

## Comments

Implemented failure recovery without coupling live-state replacement to the persistent travel transaction. Successful tree mutation remains authoritative even when live replacement fails; persistent context rebuild continues serving the traveled branch. Unsupported and failed live synchronization now surface explicit reload guidance, while non-successful branch mutations report live synchronization as skipped and never schedule replacement. Focused pinned-host coverage lives in `test/host-fixture/travel-live-sync.test.ts`; tool-call request isolation is covered by `src/runtime.test.ts`.
