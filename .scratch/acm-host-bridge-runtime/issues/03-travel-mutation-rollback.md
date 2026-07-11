# 03 — Make travel mutation and rollback structurally reliable

**What to build:** Route travel's branch mutation through the Host Bridge with complete prevalidation and tested backup-label rollback, so every rejected or failed transition has an observable and recoverable tree outcome.

**Blocked by:** 02 — Isolate host capabilities and checkpoint labels behind Host Bridge

**Status:** resolved

- [x] Target resolution, target warnings, label uniqueness, backup target resolution, handoff structure, host capabilities, and abort state are checked before the first tree or label mutation.
- [x] Every prevalidation failure leaves entries, aliases, current leaf, and tree topology unchanged.
- [x] Travel creates the branch summary through the bridge and verifies the returned summary identifier and resulting leaf before reporting success.
- [x] On-path, off-path, raw-node, label, and `root` targets report their actual resolved entry.
- [x] Multi-root `root` resolution remains observable and does not conceal the selected root.
- [x] Backup labels resolve to the nearest meaningful USER/AI entry rather than transient tool traffic.
- [x] A branch-creation failure after a newly created backup label attempts rollback.
- [x] Rollback removes only a label created by the current operation on an entry that had no prior aliases.
- [x] Existing aliases are never removed by rollback.
- [x] Rollback failure reports the remaining label, entry identifier, and recovery action.
- [x] Real SessionManager tests cover successful travel, restored off-path travel, every prevalidation failure, successful rollback, skipped rollback, rollback failure, and abandoned-branch preservation.
- [x] The bridge returns structural facts only and does not judge boundary quality, handoff sufficiency, or fold value.
