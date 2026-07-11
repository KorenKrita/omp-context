# 02 — Make checkpoint results concise and progressively disclosed

**What to build:** Apply the canonical progressive-guidance contract to checkpoint execution so normal success reports placement evidence and one next cue while collisions and host failures disclose only their relevant recovery path.

**Blocked by:** acm-agent-guidance-delivery/03 — Derive agent-facing tool guidance from canonical source; acm-host-bridge-runtime/02 — Isolate host capabilities and checkpoint labels behind Host Bridge

**Status:** ready-for-agent

- [ ] Successful checkpoint text reports the created label, resolved entry, meaningful role, aliases, available context usage, and one context-sensitive next cue.
- [ ] Automatic target resolution reports how many transient or non-meaningful entries were skipped when that evidence is available.
- [ ] Milestone `-done` checkpoints receive a retreat/archive cue without restating the task-end procedure.
- [ ] Start checkpoints receive a recoverability cue without presenting the nearest anchor as the correct future fold target.
- [ ] Normal success output does not reproduce CORE, the fold gate, the handoff template, or advanced recovery instructions.
- [ ] Structured details preserve every existing recovery-relevant identifier and outcome even when display text is shortened.
- [ ] Name collisions identify the existing entry and provide only the semantic renaming path.
- [ ] Missing host capabilities provide only the Host Bridge recovery/error context.
- [ ] Unknown context usage remains explicitly unknown and does not remove structural placement facts.
- [ ] Generated next cues and exceptional guidance come from the canonical guidance source.
- [ ] Registered-handler tests cover automatic target, explicit target, idempotent same-node reuse, second aliases, collision, missing capability, milestone cue, start cue, and unavailable usage.
- [ ] Result tests assert stable structured fields and essential concise text rather than full prose snapshots.
