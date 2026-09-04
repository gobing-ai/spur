# Dogfood report ledger

The tracked index of dogfood run reports. `docs/dogfood/*.md` is gitignored — run reports are
machine-local — so this file is what the `L4.dogfood-missing` gate reads
(`packages/app/src/services/feature-check.ts`, task 0700 R4). Without it the gate fell back to a
`readdir` of the working tree and decided ~36 features' readiness from files a fresh clone does not
have.

**A feature id must appear as a delimited segment of a filename here for its dogfood gate to pass.**
Adding a report to the working tree is not enough; add its filename below in the same commit.

Regenerate with:

```bash
git ls-files docs/dogfood | grep -Ev '(README|INDEX)\.md$'
```

## Reports

- `2026-08-08-E1-history-data-plane-dogfood.md`
- `2026-08-10-H12-dev-find-next-dogfood.md`
- `2026-08-13-D4-0533-workflow-yaml-extensions-dogfood.md`
- `2026-08-15-agent-inline-G5-dogfood.md`
- `2026-08-19-sp-dev-runall-feature-I6-dogfood.md`
- `2026-08-28-sp-dev-verifyall-F95-dogfood.md`
- `2026-08-29-sp-dev-runall-feature-A6-dogfood.md`
- `2026-09-02-dev-runall-feature-D8-dogfood.md`
- `2026-09-04-sp-dev-verifyall-feature-D9-dogfood.md`
