# 04 — Adopt canonical CORE in the integrated plugin

**What to build:** Use the declared manual sync boundary to make the integrated plugin consume the same ACM injection handler, canonical CORE, advanced Skill package, and derived guidance as the standalone plugin while retaining only Magic Context-specific composition around it.

**Blocked by:** 01 — Deliver canonical always-on CORE in standalone; 02 — Route advanced context-management branches progressively; 03 — Derive agent-facing tool guidance from canonical source; acm-sync-version-contract/01 — Establish declarative manual sync foundation

**Status:** resolved

- [x] The integrated plugin no longer maintains an independently editable full ACM prompt.
- [x] The canonical sync manifest maps CORE, the advanced Skill package, references, generated guidance, and required registration code into the integrated consumer.
- [x] The integrated plugin registers the same ACM `before_agent_start` injection behavior as the standalone plugin.
- [x] Magic Context composition preserves the existing prompt, appends only Magic Context-owned material, and does not duplicate ACM CORE.
- [x] Foreword, Magic Context guidance, closing material, and unrelated extension prompt segments retain their intended order.
- [x] The integrated plugin exposes the same model-invoked advanced Skill and the same three independently loadable references.
- [x] The integrated plugin uses the same generated checkpoint, timeline, and travel guidance artifacts as the standalone plugin.
- [x] Marker-based deduplication leaves every non-ACM system-prompt segment byte-for-byte intact.
- [x] Prompt-composition tests cover ACM registration before and after other extension handlers.
- [x] Parity tests prove that standalone and integrated ACM CORE content is identical after the manual sync command.
- [x] Existing Magic Context behavior outside prompt composition remains unchanged.
- [x] The change is verifiable without a model provider or stochastic behavior test.
