# 02 — Isolate host capabilities and checkpoint labels behind Host Bridge

**What to build:** Introduce the narrow Host Bridge as the sole guarded boundary to OMP internals and route checkpoint label operations through typed capability results verified against the real SessionManager.

**Blocked by:** 01 — Establish real SessionManager contract harness

**Status:** ready-for-agent

- [ ] All guarded access to non-public SessionManager methods is centralized in one Host Bridge boundary.
- [ ] The bridge exposes narrowly named operations for appending labels, safely clearing a newly created label, reading required structural state, and building session messages.
- [ ] Every operation validates method presence, callable shape, required arguments, and returned identifiers before reporting success.
- [ ] Missing or malformed host capabilities return named actionable errors rather than throwing opaque cast failures or silently continuing.
- [ ] Pure ACM domain modules no longer import or cast internal OMP SessionManager types.
- [ ] Checkpoint creation uses the bridge for automatic and explicit targets while preserving meaningful-entry selection outside the bridge.
- [ ] Same-node label reuse remains idempotent and adding a second alias preserves the first alias.
- [ ] Case-sensitive name uniqueness remains tree-wide and collisions identify the existing entry.
- [ ] Clearing a label is permitted only when the current operation created it and the entry had no prior aliases.
- [ ] Real SessionManager tests cover supported capabilities, missing/malformed capabilities, alias replay, idempotence, collisions, and safe clearing.
- [ ] Agent-facing checkpoint behavior and existing public tool names remain unchanged.
