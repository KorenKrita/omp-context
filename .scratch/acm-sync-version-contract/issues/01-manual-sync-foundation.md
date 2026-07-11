# 01 — Establish declarative manual sync foundation

**What to build:** Turn the existing one-way ACM sync command into a deterministic, declared synchronization boundary that can copy or transform canonical artifacts, preserve integrated-only wrappers, verify every result, and remain safe to run repeatedly without performing Git operations.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] The command verifies the canonical standalone root and integrated consumer root before reading or writing mapped artifacts.
- [ ] Source/destination mappings and declared transformations are defined centrally and are inspectable as one synchronization manifest.
- [ ] Every required source, destination root, mapping, transform, generator capability, and duplicate-path conflict is validated before the first destination write; any preflight failure leaves the complete consumer tree byte-for-byte unchanged.
- [ ] Integrated-only wrappers can be declared as preserved and remain byte-for-byte unchanged.
- [ ] The command supports direct copies and declared generated/transformed outputs without undocumented hand editing.
- [ ] Every mapped destination is compared with its expected source or generated result after synchronization.
- [ ] Any post-copy mismatch exits non-zero and names the failing artifact.
- [ ] A successful run prints a concise list of changed destinations.
- [ ] Repeating the command on aligned repositories produces a no-change result.
- [ ] The command behaves identically when launched from the canonical repository, the integrated repository, or another working directory with explicit roots.
- [ ] The command never fetches, stages, commits, rebases, merges, pushes, or modifies Git configuration.
- [ ] Temporary fixture tests cover first copy, no-op repeat, changed source, missing source, incompatible destination, missing transform capability, duplicate mapping, transformed output, corrupted destination, and preserved wrapper behavior; every preflight-failure test compares the destination snapshot before and after and proves no write occurred.
