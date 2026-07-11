# 02 — Make checkpoint results concise and progressively disclosed

**What to build:** Apply the canonical progressive-guidance contract to checkpoint execution so normal success reports placement evidence and one next cue while collisions and host failures disclose only their relevant recovery path.

**Blocked by:** acm-agent-guidance-delivery/03 — Derive agent-facing tool guidance from canonical source; acm-host-bridge-runtime/02 — Isolate host capabilities and checkpoint labels behind Host Bridge

**Status:** resolved

- [x] Successful checkpoint text reports the created label, resolved entry, meaningful role, aliases, available context usage, and one context-sensitive next cue.
- [x] Automatic target resolution reports how many transient or non-meaningful entries were skipped when that evidence is available.
- [x] Milestone `-done` checkpoints receive a retreat/archive cue without restating the task-end procedure.
- [x] Start checkpoints receive a recoverability cue without presenting the nearest anchor as the correct future fold target.
- [x] Normal success output does not reproduce CORE, the fold gate, the handoff template, or advanced recovery instructions.
- [x] Structured details preserve every existing recovery-relevant identifier and outcome even when display text is shortened.
- [x] Name collisions identify the existing entry and provide only the semantic renaming path.
- [x] Missing host capabilities provide only the Host Bridge recovery/error context.
- [x] Unknown context usage remains explicitly unknown and does not remove structural placement facts.
- [x] Generated next cues and exceptional guidance come from the canonical guidance source.
- [x] Registered-handler tests cover automatic target, explicit target, idempotent same-node reuse, second aliases, collision, missing capability, milestone cue, start cue, and unavailable usage.
- [x] Result tests assert stable structured fields and essential concise text rather than full prose snapshots.
