# 03 — Report travel through raw evidence and progressive recovery

**What to build:** Complete travel's agent-facing contract by validating every side-effect-free condition before mutation, reporting raw structural/context evidence after success, and disclosing only the recovery path relevant to each failure.

**Blocked by:** acm-agent-guidance-delivery/03 — Derive agent-facing tool guidance from canonical source; acm-host-bridge-runtime/03 — Make travel mutation and rollback structurally reliable; acm-host-bridge-runtime/04 — Rebuild and sanitize model context after travel and restore

**Status:** ready-for-agent

- [ ] Target resolution, target warnings, backup-name uniqueness, backup-target resolution, fixed seven-slot handoff structure, host capabilities, and abort state are validated before the first label or tree mutation.
- [ ] Every prevalidation rejection leaves entries, aliases, leaf, and tree topology unchanged.
- [ ] No separate `preview` or `apply` mode is added; non-obvious candidate comparison remains a timeline responsibility.
- [ ] Successful structured details report resolved target, origin, summary entry, backup outcome, usage before, estimated usage after, token delta, percentage-point delta, message counts, structural message delta, and context-refresh state.
- [ ] Unavailable usage values are represented as `null` or `unknown` and never classified as no saving.
- [ ] The threshold-based 500-token/2-percent effect classifier and its `shrunk/restored/unchanged` action-like label are removed.
- [ ] Message-count direction may be reported as factual increase, decrease, or equality but is not presented as a fold recommendation.
- [ ] Successful non-task travel contains one next-phase checkpoint cue; successful task-chain travel contains one answer-from-handoff cue.
- [ ] Backup collision, branch failure with successful rollback, skipped rollback, rollback failure, context-rebuild pending, retry exhaustion, and restored off-path travel each disclose only their relevant recovery information.
- [ ] Generated cues and recovery text come from the canonical guidance source.
- [ ] Result field names and nullability remain stable while concise display prose may evolve.
- [ ] Registered-handler and real SessionManager tests cover on-path/off-path travel, with/without backup, known/unknown usage, message increase/decrease/equality, every prevalidation failure, rollback outcomes, pending rebuild, successful rebuild, and retry exhaustion.
- [ ] Tests assert exact raw deltas and the absence of threshold-derived semantic verdicts.
