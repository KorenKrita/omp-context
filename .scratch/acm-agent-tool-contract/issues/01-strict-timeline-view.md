# 01 — Cut timeline over to one strict view contract

**What to build:** Replace timeline's competing mode booleans with one strict, view-discriminated public interface and make every active, checkpoints, search, and tree call validate and render according to one explicit contract.

**Blocked by:** acm-agent-guidance-delivery/03 — Derive agent-facing tool guidance from canonical source

**Status:** resolved

- [x] The public view values are `active`, `checkpoints`, `search`, and `tree`; omitting view selects `active`.
- [x] The parameter schema is strict and rejects unknown keys, misspelled fields, legacy booleans, and fields invalid for the selected view rather than stripping them.
- [x] Search requires a trimmed non-blank query and rejects whitespace-only input.
- [x] Checkpoints accepts an optional trimmed non-blank filter matching labels or entry IDs and rejects whitespace-only input.
- [x] Query and filter are invalid outside their declared views; verbose is valid only for active.
- [x] Every view accepts integer limit `1..50`, default `50`.
- [x] Active limit counts recent visible active-path entries and reports omitted entries.
- [x] Checkpoints limit counts sorted alias rows after filtering and reports total matching and displayed aliases.
- [x] Search limit counts deterministic full-tree matches and reports truncation.
- [x] Tree limit counts traversal depth per root and independently enforces the 200-line output ceiling with `treeTruncated` reporting.
- [x] Checkpoint filtering remains case-insensitive and matches checkpoint labels or entry IDs only.
- [x] Full-tree search remains case-insensitive and matches labels, node IDs, or rendered content across active and off-path branches.
- [x] The legacy precedence behavior and compatibility aliases are removed in the same cutover.
- [x] Registered-schema and execute-handler tests cover every valid view, invalid combination, bound, default, filter/query case, truncation path, and unknown usage path.
- [x] Canonical CORE, advanced references, and derived timeline description use only the new view contract.
