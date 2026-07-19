---
template: standard
schema_version: 1
name: "Harden Review scaffold detection against dash-filled placeholder cells"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-19T06:13:33.190Z"
updated_at: "2026-07-19T06:25:06.408Z"
---

## 0297. Harden Review scaffold detection against dash-filled placeholder cells

### Background
The 0296 post-done audit (2026-07-19, Review P2) found that `isReviewScaffold` / `hasPopulatedPriorityTable` in `packages/app/src/services/task-check.ts` treat em-dash (`—`) cells as real table content: a `| P1 | — | — | — |` placeholder Review counts as a populated findings table. Empirically, task 0296 reached `done` at 05:52:36Z with exactly such an unauthored scaffold — the Review L3 layer of the 0292 done-gate stack (defense-in-depth export used by `done-transition-guard`, task 0278 R1) accepted it. Dash-filled tables are a common agent-emitted placeholder shape, so the hole is reachable in practice, not just in theory. Corpus impact was measured before tightening: an in-process sweep of all 169 task files with Review sections found **zero flips** between the old and new predicate — every existing verdict is preserved; the tightening only affects future unauthored tables.
### Requirements
- R1. A table cell containing only dash runs (`—`, `–`, `-`, `---`) or bare `n/a`/`N/A` counts as empty in `hasPopulatedPriorityTable` — an all-dash P1–P4 table is not a populated findings table and fails the Review L3 rule where Review is required.
- R2. The same dash-filled table classifies as the shipped scaffold in `isReviewScaffold`, so it stays tolerated at statuses where Review is optional (pre-fix-round window) — tightening R1 must not create new errors at optional-Review statuses.
- R3. A P-row with at least one substantive cell beside dash cells (`| P2 | real finding | — | action |`) still counts as populated — no regression on mixed rows.
- R4. Zero corpus flips: no existing task's check outcome changes (verified by sweep before and after).
- R5. Unit tests cover the three behaviors (dash table errors where required; dash scaffold tolerated where optional; mixed row stays populated).
### Acceptance Criteria
Scenario: Dash-filled placeholder table fails Review L3 where Review is required
Given a done-status task whose Review is a P1–P4 table with only dash or n/a cells
When spur task check runs
Then an L3 error "Review must contain P1–P4 priority findings table" is emitted

Scenario: Dash-filled scaffold stays tolerated where Review is optional
Given a review-template task at todo whose Review is an all-dash P-table
When spur task check runs
Then no L3 Review error is emitted

Scenario: Mixed rows keep the table populated
Given a Review table with one all-dash row and one row containing a substantive finding cell
When spur task check runs
Then no L3 Review error is emitted

Scenario: Existing corpus is unaffected
Given all task files under docs/tasks2 at the fix commit
When the old and new predicates are compared over every Review section
Then zero tasks flip their populated/unpopulated classification
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Single shared predicate `isPlaceholderCell(cell)` (`task-check.ts:71`): trimmed cell is `''`, matches `/^[—–-]+$/`, or `/^n\/?a$/i`. Used in `hasPopulatedPriorityTable` (`:98`, replacing `c.trim().length > 0`) and in `isReviewScaffold`'s `isEmptyPRow` (`:140`, replacing `c === ''`). The separator/header row classification is untouched — hyphen-run separator rows already match before the placeholder branch is consulted. Rejected alternative: severity downgrade to warning for dash tables — unnecessary since the sweep proved zero corpus flips, and a warning would leave the 0296-style bypass open. The tightening also flows into the lifecycle done-gate for free because `done-transition-guard` imports the exported `hasPopulatedPriorityTable` (0278 R1 defense-in-depth).
### Plan
1. Measure corpus blast radius (old-vs-new predicate sweep) — decide error vs warning from data.
2. Implement `isPlaceholderCell` + wire into both predicates; update doc comments.
3. Add the three unit tests to `packages/app/tests/services/task-check.test.ts`.
4. Run task-check suite + full app package suite + biome + tsc; re-run the corpus sweep post-change.
5. Lifecycle: run-link, verdict artifact, Review, done.
### Solution
- `packages/app/src/services/task-check.ts:66-74` — new `isPlaceholderCell` helper (dash runs `—`/`–`/`-`, bare `n/a`, empty), with the 0296 incident cited as the WHY.
- `packages/app/src/services/task-check.ts:98` — `hasPopulatedPriorityTable` counts a cell as content only when `!isPlaceholderCell(c)` (was `c.trim().length > 0`). Doc comment updated to name both false-passes (empty-cell and dash-filled).
- `packages/app/src/services/task-check.ts:140-141` — `isReviewScaffold`'s `isEmptyPRow` accepts placeholder cells, so an all-dash table classifies as the shipped scaffold and stays tolerated at optional-Review statuses.
- `packages/app/tests/services/task-check.test.ts` — three new tests (dash table errors at done; dash scaffold tolerated at optional todo; mixed dash+content row stays populated), following the existing scaffold-test fixtures.
- Blast radius: in-process sweep over all 169 Review-bearing task files — 0 flips old→new; 46 done tasks with authored-but-unpopulated Reviews are pre-existing state identical under both rules (their done-gates predate this check layer) and are intentionally untouched.
### Testing
Coverage: task-check.test.ts suite extended to 75 tests (was 72); all task-check L3 Review paths exercised.

| Req | Status | Evidence |
|---|---|---|
| R1 | MET | Test "dash-filled P-table placeholder does not satisfy the rule where Review is required (0297)" — L3 error asserted; 75/75 pass. |
| R2 | MET | Test "dash-filled Review scaffold is tolerated where Review is optional (0297)" — zero L3 Review errors asserted. |
| R3 | MET | Test "a P-row with real content beside dash cells still counts as populated (0297)" — zero L3 Review errors asserted. |
| R4 | MET | In-process sweep over docs/tasks2 (169 Review-bearing files): 0 flips between old and new predicates, before and after implementation. |
| R5 | MET | Three tests added at packages/app/tests/services/task-check.test.ts; suite 75 pass / 0 fail. |

**Fresh command evidence**
- `bun test packages/app/tests/services/task-check.test.ts` → 75 pass / 0 fail.
- `bun test packages/app/tests` → 915 pass / 0 fail (includes done-transition-guard suite consuming the exported predicate).
- `bunx biome check` on both changed files → clean; `tsc --noEmit` in packages/app → clean.
- Corpus flip sweep (in-process, both predicates) → `flips: 0`.

Verdict: PASS
### Review
| Priority | Finding | Location | Action |
|----------|---------|----------|--------|
| P1 | — no blocker: zero corpus flips measured before and after; done-gate integrity restored for future dash-filled scaffolds. | `packages/app/src/services/task-check.ts:71` | None. |
| P2 | 46 done tasks carry authored-but-unpopulated Review tables under BOTH old and new rules — pre-existing corpus debt from before this L3 layer existed; today's checks would flag them if re-run at done. Out of 0297 scope (zero-flip constraint was deliberate). | `docs/tasks2/` (sweep list in Solution) | Optional future sweep task: backfill or explicitly waive historical Reviews; do not silently relax the rule. |
| P3 | `isPlaceholderCell` accepts Unicode dashes `—`/`–` and ASCII `-` but not other dash-like glyphs (e.g. `−` minus sign); an agent emitting exotic placeholders could still slip through. | `packages/app/src/services/task-check.ts:73` | Accept as-is; extend the character class only if observed in practice. |
| P4 | The linked `spur` binary bundles the old predicate until `build:bundle` is re-run; in-repo source paths (`bun run apps/cli/src/index.ts`, workspace imports) pick the fix up immediately. | `apps/cli/spur.js` | Rebuild the CLI bundle at the next release; noted for operators using the linked binary. |

Review outcome: PASS.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-19T06:24:39.237Z backlog → todo (system)
- 2026-07-19T06:24:41.644Z todo → wip (system)
- 2026-07-19T06:24:44.202Z wip → testing (system)
- 2026-07-19T06:25:06.408Z testing → done (system)
