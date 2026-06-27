# Implement: Skeleton + Bootstrap + Helpers

## Steps

1. Create `src/index.ts` with imports + module state + extension factory shell
2. Add `pi.registerCommand("acm", ...)` with handler that stores `CommandCtx`
3. Implement 7 helper functions at module level
4. Run `npx tsc --noEmit` — expect pass (no tools registered yet, or stub tools)

## Validation

```bash
cd ~/Coding/omp-context && npx tsc --noEmit
```

## Rollback

If tsc fails on imports, check that `npm install` has been run and `@oh-my-pi/pi-coding-agent` resolves types from `~/.bun/install/global/node_modules/`.
