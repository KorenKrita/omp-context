# 03 — Derive agent-facing tool guidance from canonical source

**What to build:** Generate concise tool descriptions and context-sensitive next cues from marked canonical guidance so that checkpoint, timeline, and travel teach the same domain process without independently maintained prose.

**Blocked by:** 01 — Deliver canonical always-on CORE in standalone; 02 — Route advanced context-management branches progressively

**Status:** resolved

- [x] Canonical guidance exposes explicit derivation sections for checkpoint, timeline, travel, normal next cues, and exceptional recovery pointers.
- [x] Generated tool descriptions use the same leading words and normal-path decisions as CORE.
- [x] Successful checkpoint guidance contains observed placement facts and one next cue rather than restating the full discipline.
- [x] Successful timeline guidance identifies the selected view and one relevant navigation cue without loading advanced recovery prose.
- [x] Successful travel guidance contains factual transition evidence and one state-appropriate next cue.
- [x] Exceptional guidance selects only the recovery branch relevant to the observed failure.
- [x] Generated descriptions and cues remain concise enough that loading a tool does not reproduce CORE or the advanced Skill.
- [x] A canonical guidance edit updates every derived artifact through one generation operation.
- [x] Generation is deterministic, idempotent, and fails when required canonical markers are missing or duplicated.
- [x] Contract tests prove that generated artifacts match the canonical source and contain no independently authored behavioral rules.
- [x] Tool schema, result-detail fields, and raw context-delta behavior remain outside this ticket and retain their current contract until the agent-tool-contract tickets land.
