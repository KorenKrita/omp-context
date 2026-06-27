# Implement: omp-context OMP Plugin (Parent / Rollup)

This is an umbrella task. Implementation is tracked in 8 child tasks with the following dependency graph:

## Child Task Dependency Graph

```
01-skeleton-bootstrap (foundation: imports, state, helpers, /acm command)
  ├── 02-acm-checkpoint     (depends on 01: uses helpers + setLabel)
  ├── 03-acm-timeline        (depends on 01: uses helpers + getTree/getBranch)
  └── 04-acm-compact         (depends on 01+02+03: uses all helpers + CommandCtx)
                                (04 is the critical path — most complex)

05-skill-prompt              (independent — no code dependency)
06-reference-files           (independent — no code dependency)
07-docs-update               (depends on 01-06 complete — docs must match reality)
08-verification              (depends on ALL — final check)
```

## Execution Order

1. **01-skeleton-bootstrap** → creates `src/index.ts` shell + all helpers + `/acm` command
2. **02-acm-checkpoint** + **03-acm-timeline** → can run in parallel (both depend only on 01)
3. **04-acm-compact** → depends on 01 (critical path, most complex)
4. **05-skill-prompt** + **06-reference-files** → can run in parallel (independent of code)
5. **07-docs-update** → after 01-06, update README + AGENTS to match implementation
6. **08-verification** → final: typecheck + install + manual smoke test

## Validation Commands

```bash
cd ~/Coding/omp-context
npm install
npx tsc --noEmit
omp install .
```

## Rollback Points

- After 01: skeleton compiles, no functionality
- After 02+03: checkpoint + timeline work independently
- After 04: compact is the only risky step — if event flow fails, checkpoint + timeline still work
- After 05+06: skill + references ready, can be tested with existing tools
