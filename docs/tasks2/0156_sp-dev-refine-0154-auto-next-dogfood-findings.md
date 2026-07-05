---
template: review
schema_version: 1
name: /sp:dev-refine 0154 --auto --next dogfood findings
description: ""
status: done
type: task
profile: standard
parent_wbs: null
priority: P2
tags: [review]
dependencies: []
created_at: 2026-06-29T21:20:42.317Z
updated_at: 2026-06-29T21:53:50.008Z
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
- [x] Fix P1 findings — L3 Review rule tolerance for prose-only `### Review` at optional status (`task-check.ts:122-131,239-241` + 2 new tests)
- [x] Fix P2 findings — Skip-gate scoping to target sections only (`dev-operations.md:93-103`, `dev-refine.md:71-75`)
- [x] Disposition all remaining findings — P2 FSM deferred; P3 stale/unverifiable closed; P4 routed out-of-repo
- [x] Re-review the changed code — all gates green (lint, test, test-cf)
### Solution

Changed files and why:

- `packages/app/src/services/task-check.ts:122-131` — Added `isProseOnlyReview` helper: detects a `### Review` body that has prose text but no markdown table rows at all (no `|` characters). This is the "P1 bug" state — an operator may write reflection prose without a table before the findings are known. Returns `true` (tolerated) when: the body has no `|` chars after stripping HTML comments, has no populated P-table, and is not a pure placeholder.

- `packages/app/src/services/task-check.ts:239-241` — Updated `runL3` Review block: when Review is *optional* (pre-fix-round window), the scaffold-tolerated check now ORs `isReviewScaffold(revBody)` with `isProseOnlyReview(revBody)`. When Review is *required* (`wip`+), only `isPlaceholderBody` is tolerated — a populated findings table is still mandatory. The comment was updated to document both branches explicitly.

- `packages/app/tests/services/task-check.test.ts:347-391` — Added two new L3 tests: (a) regression test proving prose-only `### Review` at optional status is tolerated (was failing before the fix), (b) guard test confirming prose-only `### Review` at required status still errors (prevents over-tolerance).

- `plugins/sp/skills/spur-dev/references/dev-operations.md:93-103` — P2 doc fix: scoped the pre-synthesis skip gate PASS test to L3 findings whose `section` ∈ {Background, Requirements, Plan} only. The old text keyed off the overall exit code; a `### Review` L3 error (non-target section) blocked the SKIP gate even when all target sections were clean. Updated the SKIP reason string and added an explicit Scope note.

- `plugins/sp/commands/dev-refine.md:71-75` — P2 doc fix: same scope correction — the SKIP gate now filters to target sections only, explicitly noting that findings on sections refine does not own must not block the gate.

### Review
Post-implementation reflection — what went wrong, what was fixed, and back-issues.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1 | `packages/app/src/services/task-check.ts:122-131,239-241` | L3 Review rule rejected prose-only `### Review` at optional status — `isReviewScaffold` required at least one empty-cell P-row; no-table prose failed the check. | Fixed: added `isProseOnlyReview` helper; updated `runL3` to OR it into the optional-context tolerance. Two regression tests added. `[fixed]` |
| P2 | `plugins/sp/skills/spur-dev/references/dev-operations.md:93-103` + `plugins/sp/commands/dev-refine.md:71-75` | Skip gate keyed off overall `task check` exit code; a `### Review` L3 error (non-target section) blocked SKIP even when all refine target sections were clean. | Fixed: scoped the gate to L3 findings for {Background, Requirements, Plan} only; updated SKIP reason string; added explicit Scope note in both docs. `[fixed]` |
| P2 | `packages/app/src/services/task-service.ts` (done-FSM) | done-FSM does not enforce L2 section matrix at the `testing → done` guard (carried from 0154). | Deferred: in-flight 0152/0153/0155 FSM work on the same files; implementing here risks merge conflicts. Track as a follow-up task. `[deferred]` |
| P3 | driver monitoring discipline | Cache hit rate `~45%` across the dogfood run — below the 50% floor. | Deferred to driver: reuse `task check` JSON across skip-gate and post-transition gate calls; reference already-read `task-check.ts` ranges. Lever documented in dogfood report; proof requires a re-run. `[unverifiable]` |
| P3 | `plugins/sp/commands/dev-refine.md:67` | Finding already fixed on the working tree (0154 P2 #1 corrected `spur task path`). | Closed as stale. `[stale]` |
| P3 | `plugins/sp/skills/spur-dev/references/dev-operations.md:90` | Finding already fixed (idempotent `backlog → todo` documented). | Closed as stale. `[stale]` |
| P3 | global `~/.bun/bin/superskill` | `superskill hook run` now exposed by the installed binary; finding was stale. | Closed as stale. `[stale]` |
| P4 | `plugins/cc/skills/cc-hooks/references/cross-platform.md:57` (out-of-repo) | Targets a path in the superskill repo; not actionable from spur-new. | Routed to superskill repo tracker. `[out-of-scope]` |
### References

### History
- 2026-06-29T21:44:34.340Z backlog → todo (system)
- 2026-06-29T21:44:38.257Z todo → wip (system)
- 2026-06-29T21:53:41.772Z wip → testing (system)
- 2026-06-29T21:53:50.008Z testing → done (system)
