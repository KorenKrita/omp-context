# 02 — Stage OMP 16.4.2 as the host-test candidate

**What to build:** Create an isolated host-test fixture that resolves OMP `16.4.2` for real SessionManager and extension-handler verification without changing the root package's peer declarations, development declarations, lock state, documentation, or public install resolution.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] A dedicated test fixture has its own manifest and lock state for the OMP coding-agent, agent-core, and pi-ai packages at exact version `16.4.2`.
- [ ] The fixture proves all three host packages resolve together at `16.4.2` with no mixed OMP package graph.
- [ ] The real SessionManager harness and captured public extension-handler tests can execute against the isolated fixture without reading the root dependency graph.
- [ ] The tested ACM source is copied, linked, or executed inside the fixture package with resolver roots pinned to the fixture; it cannot fall back to the repository root `node_modules`.
- [ ] The fixture records resolved module paths and package metadata for all three OMP imports and proves they originate from the fixture's `16.4.2` installation before host tests run.
- [ ] Existing ACM type checking and pure tests can be run against the staged fixture through an explicit test command or environment.
- [ ] Root peer dependencies, root development dependencies, root lock state, maintainer documentation, and public install resolution remain byte-for-byte unchanged.
- [ ] No compatibility range, older-host fallback, or multi-version matrix is added.
- [ ] The fixture changes no unrelated dependency versions and is deterministic from a clean checkout.
- [ ] A focused check fails if any of the three fixture packages resolves to a version other than `16.4.2`.
- [ ] The ticket records the isolated fixture command and evidence needed by downstream host-runtime tickets.
- [ ] Promotion of `16.4.2` into the root support contract remains blocked until the real host-runtime ticket chain passes.
