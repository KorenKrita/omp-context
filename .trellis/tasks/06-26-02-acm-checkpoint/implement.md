# Implement: acm_checkpoint Tool

## Steps

1. Define `checkpointSchema` and `type CheckpointParams`
2. Call `pi.registerTool({ name: "acm_checkpoint", ... })` inside factory function
3. Implement execute body per design.md flow
4. Run `npx tsc --noEmit`

## Validation

```bash
cd ~/Coding/omp-context && npx tsc --noEmit
```

After `omp install .`, manually test in OMP session:
- Call tool with unique name → success
- Call with same name → error
- Call with `target: "root"` → labels root
