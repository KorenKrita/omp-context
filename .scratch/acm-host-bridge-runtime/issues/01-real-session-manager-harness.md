# 01 — Establish real SessionManager contract harness

**What to build:** Create a deterministic no-model test seam around the isolated OMP `16.4.2` candidate so ACM can verify real entry journals, aliases, branches, leaves, and reconstructed messages before that host release is promoted to the public support contract.

**Blocked by:** acm-sync-version-contract/02 — Stage OMP 16.4.2 as the host-test candidate

**Status:** resolved

- [x] Tests create isolated temporary session storage and instantiate the real OMP `16.4.2` candidate SessionManager from the pinned fixture without an API key or model provider.
- [x] The harness can append representative USER, AI, tool-call, tool-result, label, branch-summary, and compaction entries through real host behavior.
- [x] The harness can reload persisted sessions and prove label-journal replay, current leaf, tree topology, and built session messages survive restoration.
- [x] The harness exposes observable snapshots of entries, aliases, leaf, tree, and built messages without asserting private field layouts.
- [x] Tests prove same-node label reuse is idempotent and multiple case-sensitive aliases remain independently resolvable after reload.
- [x] Tests prove branch-summary creation preserves the abandoned branch and moves the leaf to the summary branch.
- [x] Tests prove real session-context construction follows the selected leaf.
- [x] Temporary files and session state are removed after every test, including failures.
- [x] The harness is reusable by checkpoint, travel, context-rebuild, sanitation, and compaction tickets.
- [x] Existing pure tests continue to run unchanged and do not depend on the new host fixture.
