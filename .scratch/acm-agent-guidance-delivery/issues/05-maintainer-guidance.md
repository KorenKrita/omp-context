# 05 — Publish maintainer guidance and observed-use validation

**What to build:** Replace duplicated human-facing agent instructions with concise maintainer documentation for the unified ACM delivery model, and define how real-session failures are captured before future guidance changes are made.

**Blocked by:** 01 — Deliver canonical always-on CORE in standalone; 02 — Route advanced context-management branches progressively; 03 — Derive agent-facing tool guidance from canonical source; 04 — Adopt canonical CORE in the integrated plugin

**Status:** resolved

- [x] Maintainer documentation explains installation, architecture, canonical repository direction, prompt-delivery model, exact host version, manual synchronization, and known host limitations.
- [x] Human documentation links to the canonical CORE and advanced Skill package rather than reproducing the normal agent contract.
- [x] The standalone and integrated wrapper difference is described as intentional composition, not implementation drift.
- [x] Documentation identifies the ACM extension as the owner of CORE injection and Magic Context as the owner of its surrounding material.
- [x] Documentation states that the fixed seven-slot handoff is an agent completion criterion, not runtime proof of semantic correctness.
- [x] Documentation states that high context pressure triggers a boundary check rather than automatic travel.
- [x] A lightweight dogfooding record distinguishes missed checkpointing, wrong boundary selection, anchor gravity, archive drift, unnecessary Skill loading, and exceptional recovery failures.
- [x] Future guidance changes require an observed failure or a changed host contract rather than speculative weak-model rules.
- [x] Static contract checks confirm that README contains maintenance facts but does not duplicate canonical normal-path guidance.
- [x] User-decided implementation choices and provenance are recorded in the repository implementation notes.
