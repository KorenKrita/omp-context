# 04 — Synchronize the complete canonical ACM surface

**What to build:** Extend the declared manual sync manifest to cover every canonical runtime, guidance, generated, metadata, and test artifact produced by the completed ACM changes while preserving the integrated plugin's owned wrappers.

**Blocked by:** 01 — Establish declarative manual sync foundation; acm-agent-guidance-delivery/04 — Adopt canonical CORE in the integrated plugin; acm-host-bridge-runtime/05 — Verify compaction and session lifecycle recovery; acm-agent-tool-contract/03 — Report travel through raw evidence and progressive recovery

**Status:** ready-for-agent

- [ ] The manifest maps every canonical ACM implementation and pure-domain module used by the standalone plugin.
- [ ] The manifest maps the complete Host Bridge and its real SessionManager, handler, sanitation, rollback, and lifecycle tests.
- [ ] The manifest maps canonical CORE, the advanced Skill, all three references, generated guidance artifacts, and their contract tests.
- [ ] The manifest maps the strict timeline contract, checkpoint progressive results, travel raw-evidence contract, and corresponding tests.
- [ ] Integrated-only Magic Context wrappers are declared as preserved and remain byte-for-byte unchanged except for intentional composition edits already delivered by the guidance adoption ticket.
- [ ] Any standalone/integrated harness difference is represented by an explicit deterministic transformation rather than hand editing.
- [ ] A clean sync produces equivalent ACM runtime and guidance behavior in the integrated consumer.
- [ ] A second sync is a no-op.
- [ ] Removing one required mapping or corrupting one generated destination causes a named non-zero verification failure.
- [ ] Post-sync focused type checking and mapped ACM tests pass in the integrated repository.
- [ ] The sync operation prints every changed destination and performs no Git staging, commits, branch changes, fetches, merges, rebases, or pushes.
- [ ] Cross-repository changes remain separately committable and recoverable.
