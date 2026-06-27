# Implement: Update README.md and AGENTS.md

## Steps

1. Read current README.md and AGENTS.md
2. Apply all changes per design.md
3. Verify no "丢弃 /acm" remains
4. Verify "7 个" reference count in both files

## Validation

```bash
grep -c "丢弃.*acm\|丢弃.*/acm" README.md AGENTS.md  # expect 0
grep -c "7 个" README.md AGENTS.md  # expect ≥2
```
