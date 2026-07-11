# 04 — Rebuild and sanitize model context after travel and restore

**What to build:** Ensure the model receives the selected summary branch on every subsequent context event, while repairing persisted tool-call/tool-result mismatches that can survive travel or session restoration.

**Blocked by:** 03 — Make travel mutation and rollback structurally reliable

**Status:** resolved

- [x] Successful travel activates session-scoped persistent context reconstruction for subsequent public `context` events.
- [x] Reconstructed messages come from the real SessionManager's current summary leaf rather than the abandoned branch.
- [x] Later USER/AI/tool messages appended to the summary branch appear in every subsequent reconstructed context.
- [x] Restored sessions are sanitized even when no in-memory travel-refresh marker exists.
- [x] Orphaned ACM travel tool results are removed when their corresponding assistant tool call is no longer on the selected branch.
- [x] Assistant tool calls whose results exist only on an abandoned branch are repaired or removed according to provider-valid pairing rules.
- [x] Sanitation preserves valid non-ACM tool-call/tool-result pairs and unrelated message content.
- [x] Context-build failures record bounded session-scoped retry state and remain observable through tool details and timeline state.
- [x] A later successful build clears retry state and resumes authoritative reconstruction.
- [x] Retry exhaustion clears pending reconstruction, returns the host-provided context for that event, and exposes an actionable reload path.
- [x] Captured public handler tests and real SessionManager fixtures cover successful travel, later turns, restored sessions, orphaned result sanitation, orphaned call sanitation, transient failure, eventual success, and exhaustion.
- [x] No test requires a model provider or mutates OMP's private agent message array.
