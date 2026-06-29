---
schema_version: 1
name: "/sp:dev-refine 0153 --auto --next fix-mode dogfood findings"
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
created_at: "2026-06-29T21:02:38.964Z"
updated_at: 2026-06-29T21:02:57.371Z
---

## 0155. /sp:dev-refine 0153 --auto --next fix-mode dogfood findings

### Background
#### Review Findings

Findings from a **full-fix-mode** dogfood run of `/sp:dev-refine 0153 --auto --next` (driver:
`sp:dogfood-testing`, `--max-retry 2`). Full report: `docs/dogfood/2026-06-29-dev-refine-0153-dogfood.md`.
The refine verb behaved correctly (a clean step-4 SKIP — 0153 was already L3-clean). The `--next` chain
then implemented all 7 of task 0153's findings end-to-end (`backlog → done`); these are the **residual**
findings surfaced by that run, plus back-issues from the fix itself.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P2 | `.spur/tasks/templates/review.md` | The project-local review template had drifted from the bundled SSOT (`config/templates/task/review.md`): its `### Review` section was missing the empty-cell P1/P2 table. Every `spur task create --template review` in this project rendered a table-less Review → failed L3 check at backlog. This was the REAL root cause of the original 0151/0153 "review task fails its own check" finding (not the bundled template, which is correct). | Fixed: synced `.spur/tasks/templates/review.md` `### Review` to carry the P-table. Add a drift check (or regenerate `.spur/` templates from bundled on `spur init`/upgrade) so project-local copies don't silently rot. `[feasible]` |
| P3 | `config/tasks/section-matrix.yaml:104-141` | The L3 Review hardening shipped this run makes any `review`-type task unable to reach `testing`/`done` until `### Review` carries a populated P-table (empty scaffold no longer passes at wip+). Intended, but undocumented in the matrix and hit live this run. | Document the wip+ populated-Review requirement in the `review` variant matrix comment so authors expect it. `[feasible]` |
| P3 | `plugins/sp/commands/dev-refine.md:77-88` | `refine --auto --next` on a well-specified task is effectively "run the whole pipeline": a step-4 SKIP short-circuits synthesis but NOT the `--next` chain, so a no-op refine still triggers a repo-mutating implement+verify. | Emit a one-line notice when a SKIP feeds a mutating `--next` chain, so refinement-only intent isn't silently escalated. `[feasible]` |
| P3 | driver discipline (monitor-ledger §cache-conservation) | Low cache hit rate: aggregate ~42% (<50% floor); implement step ~39%. Much is unavoidable first-touch I/O, but re-running `task check 0153` at each FSM transition added avoidable re-fetches. | Reuse the prior `task check` JSON across transitions instead of re-invoking; cache files read once. `[unverifiable]` — no per-step token telemetry; lever shippable, measured proof deferred. |
| P4 | `apps/cli/src/commands/task.ts` | `spur task delete` human-readable guard error prints under the figlet banner — correct but buried (`--json` path is clean). | Suppress the banner on `delete` error output. `[feasible]` |
| P4 | `AGENTS.md:175` | `spur task path` is implemented + registered but absent from the documented CLI surface (only `resolve` listed). Pre-existing gap, noticed while adding `delete`. | Add the `path` row alongside `resolve`/`delete`. `[feasible]` |
| P4 | `hooks/security_reminder_hook.py` | The PreToolUse security hook false-positived on a pure-FileSystem edit (no `child_process`), blocking the first write on the literal substring "child". | Require an actual `child_process` import/call token, not a bare substring match. `[feasible]` |

**Note:** the headline checker finding from 0153 ("review task fails its own check") was re-verified at
implement time and found **stale as written** — resolved as a real L3 hardening (not a no-op), covered by
3 new tests. See the 0153 `## Solution` STALE note and the dogfood report §4.
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
