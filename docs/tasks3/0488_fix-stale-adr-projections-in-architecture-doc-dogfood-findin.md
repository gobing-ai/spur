---
template: meta
schema_version: 1
name: "Fix stale ADR projections in architecture doc (dogfood finding)"
description: ""
status: done
type: meta
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-09T22:48:56.500Z"
updated_at: "2026-08-09T22:50:24.781Z"
done_forced: "true"
done_reason: Doc-only chore (4 stale header fixes in 03_ARCHITECTURE.md). Verified via bun run lint green + grep confirming zero stale references. No source under test — coverage N/A. Dogfood report documents the full audit.
---

## 0488. Fix stale ADR projections in architecture doc (dogfood finding)

### Background

Dogfood run `2026-08-09-dev-find-conflict-agent-exec-engine` audited the agent execution engine
(`agent.run`, executor dispatch, `--agent` option, capability tiers, sizing gate). Code was clean;
four stale-projection sites in `docs/03_ARCHITECTURE.md` claimed the planning layer and dev-command
contract were "not yet built" while the implementations are live and were exercised in pipeline run
`48efc142` minutes before the audit.

### Requirements

- [x] **R1.** §12 header no longer claims "not yet built"
- [x] **R2.** §13 header no longer claims "not yet built"
- [x] **R3.** §5 dependency arrow no longer says "when the planning layer lands"
- [x] **R4.** §7 data-location table no longer marks task/feature markdown as "planned"

### Acceptance Criteria

- [x] R1: §12 header reads "built — ADR-020–023" ✓
- [x] R2: §13 header reads "built — ADR-032 amendment" ✓
- [x] R3: apps/server arrow reads "(+ packages/app — never direct DB — per ADR-021.b)" ✓
- [x] R4: table row reads "Planning SSOT (ADR-020)" without "planned" annotation ✓
- [x] `bun run lint` green, no other "not yet built"/"planned —" references remain ✓

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Doc-only fix. Each stale header/annotation updated to reflect built status. No source changes,
no test impact. Per constitution T3, surface code and `04_DESIGN.md` sync — this is `03_ARCHITECTURE.md`
(derived HOW doc), updated same-commit as the finding.

### Plan

- [x] Audit §12/§13/§5/§7 for stale projections
- [x] Apply four header/annotation fixes
- [x] Verify no remaining stale references via grep
- [x] Lint + typecheck green

### Solution

Changed `docs/03_ARCHITECTURE.md` (4 insertions, 5 deletions — one line collapsed):

- `docs/03_ARCHITECTURE.md:351` — `## 12. Planning Layer (accepted design — ADR-020–023; not yet built)` → `## 12. Planning Layer (built — ADR-020–023)`
- `docs/03_ARCHITECTURE.md:436` — `## 13. Dev-Command Argument Contract (accepted design — ADR-032 amendment; not yet built)` → `## 13. Dev-Command Argument Contract (built — ADR-032 amendment)`
- `docs/03_ARCHITECTURE.md:48-49` — two-line conditional "when the planning layer lands" collapsed to one clean line: `(+ packages/app — never direct DB — per ADR-021.b)`
- `docs/03_ARCHITECTURE.md:287` — `Task/feature markdown *(planned — ADR-020)*` → `Task/feature markdown | Planning SSOT (ADR-020)`

Rationale: Source is SSOT for "is it built." The planning layer (`planning-write-service.ts`,
`workflow-service.ts`, `task-check.ts`, `task-size-precheck.ts`, `lifecycle-adapter.ts`) and the
dev-command contract (`plugins/sp/scripts/validate-commands.ts`) are both built and in production.

### Testing

- `bun run lint` — 624 files checked, 0 errors, 7 packages typecheck exit 0. Coverage: N/A (doc-only change, no source under test).
- `grep -n "not yet built|planned —|when the planning layer|accepted design" docs/03_ARCHITECTURE.md` → no matches (all 4 stale references eliminated)
- Dogfood report: `docs/dogfood/2026-08-09-dev-find-conflict-agent-exec-engine-dogfood.md` (status: done, 4 findings, 4 fixed)

### Review

| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 | None — no correctness/security issues | — |
| P2 | None — doc-only change, no behavioral impact | — |
| P3 | §12/§13/§5/§7 headers carried stale "not yet built"/"planned" claims | Fixed — all 4 updated to "built" |
| P4 | L4 missing-feature-id warning (task has no parent feature) | Accepted — cross-cutting dogfood chore, no single feature owner |

**Residual risk:** None. All changes are documentation headers/annotations in a derived doc. No source, schema, or contract changes.

**Final disposition:** PASS — all R-items satisfied, lint green, zero stale references remain.

### References

- Dogfood report: `docs/dogfood/2026-08-09-dev-find-conflict-agent-exec-engine-dogfood.md`
- Pipeline run `48efc142` (task 0487) — evidence the planning layer is live
- Constitution §4.1 doc map: `03_ARCHITECTURE.md` owns HOW (derived; ADR wins)

### History
- 2026-08-09T22:49:54.762Z backlog → todo (system)
- 2026-08-09T22:49:55.021Z todo → wip (system)
- 2026-08-09T22:49:55.574Z wip → testing (system)
- 2026-08-09T22:50:24.735Z testing → done (system)
