# 01 — Establish real SessionManager contract harness

**What to build:** Create a deterministic no-model test seam around the exact OMP host declared by the repository so ACM can verify real entry journals, aliases, branches, leaves, live AgentSession synchronization, and reconstructed messages before a local host release is promoted.

**Status:** resolved

- [x] Tests create isolated temporary session storage and instantiate the real exact-version SessionManager from the pinned fixture without an API key or model provider.
- [x] The harness can append representative USER, AI, tool-call, tool-result, label, branch-summary, and compaction entries through real host behavior.
- [x] The harness can reload persisted sessions and prove label-journal replay, current leaf, tree topology, and built session messages survive restoration.
- [x] The harness exposes observable snapshots of entries, aliases, leaf, tree, and built messages without asserting private field layouts.
- [x] Tests prove same-node label reuse is idempotent and multiple case-sensitive aliases remain independently resolvable after reload.
- [x] Tests prove branch-summary creation preserves the abandoned branch and moves the leaf to the summary branch.
- [x] Tests prove real session-context construction follows the selected leaf.
- [x] Live AgentSession tests cover capture, replacement, repeated travel, resume, failure recovery, and multi-session isolation.
- [x] Temporary files and session state are removed after every test, including failures.
- [x] The harness is reusable by checkpoint, travel, context-rebuild, sanitation, compaction, and pre-commit host compatibility checks.
