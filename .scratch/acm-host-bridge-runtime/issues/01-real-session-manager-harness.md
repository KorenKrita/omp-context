# 01 — Establish real SessionManager contract harness

**What to build:** Create a deterministic no-model test seam around the exact supported OMP SessionManager so ACM can verify real entry journals, aliases, branches, leaves, and reconstructed messages instead of relying on hand-written host stubs.

**Blocked by:** acm-sync-version-contract/02 — Pin and verify the exact OMP 16.4.2 host contract

**Status:** ready-for-agent

- [ ] Tests create isolated temporary session storage and instantiate the real OMP `16.4.2` SessionManager without an API key or model provider.
- [ ] The harness can append representative USER, AI, tool-call, tool-result, label, branch-summary, and compaction entries through real host behavior.
- [ ] The harness can reload persisted sessions and prove label-journal replay, current leaf, tree topology, and built session messages survive restoration.
- [ ] The harness exposes observable snapshots of entries, aliases, leaf, tree, and built messages without asserting private field layouts.
- [ ] Tests prove same-node label reuse is idempotent and multiple case-sensitive aliases remain independently resolvable after reload.
- [ ] Tests prove branch-summary creation preserves the abandoned branch and moves the leaf to the summary branch.
- [ ] Tests prove real session-context construction follows the selected leaf.
- [ ] Temporary files and session state are removed after every test, including failures.
- [ ] The harness is reusable by checkpoint, travel, context-rebuild, sanitation, and compaction tickets.
- [ ] Existing pure tests continue to run unchanged and do not depend on the new host fixture.
