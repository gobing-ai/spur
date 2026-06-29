---
schema_version: 1
name: "/sp:dev-refine 0154 --auto --next dogfood findings"
description: ""
status: backlog
type: review
template: review
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-29T21:20:42.317Z"
updated_at: 2026-06-29T21:21:11.971Z
---

## 0156. /sp:dev-refine 0154 --auto --next dogfood findings

### Background
#### Review Findings

Findings from a **fix-mode** dogfood run of `/sp:dev-refine 0154 --auto --next` (driver:
`sp:dogfood-testing`, `--max-retry 2`). The chain ran end-to-end through the implement step and
correctly stopped at a review-pending boundary — it did **not** reach `done`. No in-budget Edit/Write
fix was warranted: every prospective fix was already on the working tree, out-of-repo, or a hiding fix.
Full report: `docs/dogfood/2026-06-29-dev-refine-0154-auto-next-dogfood.md`.

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P1 | `packages/app/src/services/task-check.ts:93-112` + `config/tasks/templates/review.md` | `--auto --next` on a fresh `review`-template fix-task dead-ends at the `done` gate: prose-only `### Review` trips the L3 hard-core rule ("must contain P1–P4 priority findings table"), but `### Review` is legitimately empty (findings live in `#### Review Findings`) until a fix round runs — and a fresh fix-task may have all findings already stale, leaving nothing to table. | Make the L3 Review rule tolerate prose-only `### Review` as a scaffold at `todo`/`wip` for the `review` variant (the pre-fix-round window), OR ship the empty-cell P-table in the `review` template by default so a fresh fix-task passes L3 until filled. `[feasible]` |
| P2 | `plugins/sp/skills/spur-dev/references/dev-operations.md:93-102` + `plugins/sp/commands/dev-refine.md:71-75` | refine's `--auto` pre-synthesis skip gate keys off the **overall** `task check` exit code, not whether refine's own target sections (Background/Requirements/Plan) are at L3. An L3 error on a non-target section (`### Review`) forces synthesis even though targets are clean. | Scope the skip-gate PASS test to L3 findings whose `section` ∈ {Background, Requirements, Plan}; ignore findings on sections refine does not own. `[feasible]` |
| P2 | `packages/app/src/services/task-service.ts` (lifecycle guard) + `packages/app/src/services/task-check.ts` (L2) | done-FSM does not enforce the L2 section matrix (carried from 0154 P2 #3, re-verified still-open): a task can transition `testing → done` without the FSM checking `done`'s required sections; L2 is a separate advisory pass not wired into the transition guard. | Wire the L2 section-matrix check into the `testing → done` FSM guard (or map `review`/`issue` variants to a `done`-compatible required set). Defer until in-flight 0152/0153/0155 FSM work lands. `[feasible]` |
| P3 | driver monitoring discipline | Low cache hit rate — aggregate ~45% (< 50% floor); steps 3/5/6/7 each at/below 40%. Driver re-invoked `task check 0154` at three lifecycle points and re-read `task-check.ts` ranges. | Reuse the first `task check` JSON across the skip-gate and post-transition gate; reference the already-read `task-check.ts` rule rather than re-reading. Lever ships; measured proof deferred. `[unverifiable]` |
| P3 | `plugins/sp/commands/dev-refine.md:67` | 0154 P2 #1 already fixed on the working tree (reworded to `spur task path`); the fix-task carries it as still-open. | Close as `[stale]` in 0154's record; do not file an implementation task. `[stale]` |
| P3 | `plugins/sp/skills/spur-dev/references/dev-operations.md:90` | 0154 P2 #2 already fixed (idempotent `backlog → todo` documented). | Close as `[stale]` in 0154's record. `[stale]` |
| P3 | global `~/.bun/bin/superskill` | 0154 P3 #1 stale: `superskill hook run <plugin> <hook-id>` is now exposed by the installed global binary. | Close as `[stale]`; the rebuild/deploy already happened. `[stale]` |
| P4 | `plugins/cc/skills/cc-hooks/references/cross-platform.md:57` (out-of-repo) | 0154 P3 #2 targets a path that does not exist in spur-new (it is a superskill-repo file). | Route to the superskill repo's tracker; not actionable from spur-new. `[unverifiable]` |

**Unresolved:** The `--auto --next` pipeline cannot carry a fresh `review`-template fix-task to `done` —
the task's prose-only `### Review` trips the L3 hard-core rule, and the legitimately-empty section cannot
be populated without a real fix round (none warranted; 4/5 findings stale) or a hiding fix (forbidden).
This is the P1 above.

**Verdict:** PARTIAL (0 fixed, 1 unresolved, 7 findings). One P1.
### Plan

- [ ] Fix P1 findings
- [ ] Fix P2 findings
- [ ] Fix all the remaining findings if any
- [ ] Re-review the changed code

### Review

Post-implementation reflection — filled **after** the first fix round: what went wrong, what
remains to fix before closing, and any **back-issues** (new findings surfaced by the fix).

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1       |      |         |                |
| P2       |      |         |                |

### References

### History
