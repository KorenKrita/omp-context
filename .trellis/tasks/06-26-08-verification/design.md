# Design: Final Verification

## Automated Checks

```bash
cd ~/Coding/omp-context
npm install
npx tsc --noEmit
omp install .
```

## Manual Smoke Test Protocol

1. Start new OMP session
2. Type `/acm` → expect notification "Agentic Context Management enabled."
3. Ask agent to call `acm_checkpoint({ name: "test-start" })` → expect "Created checkpoint..."
4. Ask agent to call `acm_checkpoint({ name: "test-start" })` again → expect error
5. Have a short conversation (2-3 turns)
6. Ask agent to call `acm_timeline({})` → expect active path + HUD with checkpoint label
7. Ask agent to call `acm_timeline({ full_tree: true })` → expect tree structure with all node IDs
8. Ask agent to call `acm_compact({ target: "test-start", summary: "Testing compact. Next: verify fromId.", backupCheckpoint: "pre-compact" })`
9. Expect: "compact start" → turn ends → notification with usage change → new turn starts automatically
10. Ask agent to call `acm_timeline({ full_tree: true })` → verify:
    - `pre-compact` checkpoint visible on old branch
    - SUM node visible with `from:` marker showing originId
11. Ask agent to call `acm_compact({ target: "<originId from step 10>" })` → verify "回到未来" works

## Failure Modes

- TypeScript errors → fix in respective task
- `omp install` fails → check `package.json` manifest paths
- `/acm` not in help → check `registerCommand` call
- Tools not visible → check `registerTool` calls, check OMP tool discovery
- Compact event flow fails → check `session_before_tree` handler registration, check `waitForIdle` timing
