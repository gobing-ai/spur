---
schema_version: 1
name: "/sp:dev-refine 0151 --auto --next fix-mode dogfood findings"
description: ""
status: cancelled
type: review
template: review
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-29T07:21:23.638Z"
updated_at: 2026-06-29T23:05:52.986Z
---

## 0154. /sp:dev-refine 0151 --auto --next fix-mode dogfood findings

### Background
Findings from a **fix-mode** dogfood run of `/sp:dev-refine 0151 --auto --next` (driver:
`sp:dogfood-testing`, `--max-retry 2`, operator-authorized to run the `--next` chain on `main`). The
run implemented task 0151 end-to-end across spur-new + superskill and reached `done` (both gates green:
superskill 1190/0, spur-new 1967/0). Full report: `docs/dogfood/2026-06-29-dev-refine-0151-fixmode-dogfood.md`.
Two bugs were fixed in-budget during the run (recorded in 0151's Review); the findings below are testee /
workflow / lifecycle improvements that remain.

#### Review Findings

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P2 | `plugins/sp/commands/dev-refine.md:67` | Step-1 "Resolve wbs" implies `spur task resolve <wbs>` loads a task; `resolve` is path→WBS (`resolve <file-path>`), the WBS→file verb is `task path`. | Reword step 1 to use `task path`/`show`; reserve `resolve` for the path-ownership guard. `[feasible]` |
| P2 | `plugins/sp/skills/spur-dev/references/dev-operations.md:90` | `--next` documents `backlog → todo`; a task already at `todo` makes it a silent self-edge (succeeds, no signal it was a no-op). | Make the transition idempotent for `status >= todo` and document the already-past behavior. `[feasible]` |
| P2 | `packages/app/src/services/task-check.ts` (L2) + task lifecycle FSM | An `issue`-template task reaches `done` via `testing → done` without the FSM enforcing the L2 section matrix; `done`'s required `Solution`/`Testing`/`Review` were missing until added manually. | Have the `done` FSM guard enforce the section matrix, or map `issue` tasks to a `done`-compatible required set. `[feasible]` |
| P3 | global `~/.bun/bin/superskill` | `superskill hook run` only works once the global CLI is rebuilt/reinstalled; the current global binary is a published build without it, so the sp shim fails open in live Claude sessions (safe but inert). | Rebuild + reinstall superskill globally to activate the live guard; document the deploy step. `[feasible]` |
| P3 | `plugins/cc/skills/cc-hooks/references/cross-platform.md:57` | The abstract `$PLUGIN_ROOT` substitution model is stale vs. the rulesync-canonical reality; annotated with a warning, not rewritten. | Rewrite the reference to the `superskill hook run` standard in a follow-up. `[feasible]` |

**Unresolved:** (none) — the run completed to `done`; both in-budget fixes landed.

**Verdict:** PASS (2 fixed, 0 unresolved, 5 findings). No P1.
### Plan

- [ ] Fix P1 findings
- [ ] Fix P2 findings
- [ ] Fix all the remaining findings if any
- [ ] Re-review the changed code

### Solution

**Cancelled 2026-06-29 — all 5 findings resolved by intervening work; this task is a no-op.**

Audit against the current tree (post-0151/0153 fix waves):

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P2 | `dev-refine.md:67` step-1 `resolve` vs `path` wording | **RESOLVED** — line 67 now uses `spur task path`; calls out `resolve` as the inverse. |
| 2 | P2 | `dev-operations.md:90` `--next` silent self-edge on `todo` | **RESOLVED** — transition is now idempotent (`only when status == backlog`, skip+chain when `>= todo`); dev-refine.md:78-82 + dev-operations.md:90,104. |
| 3 | P2 | FSM/L2 not enforcing section matrix on `issue`→`done` | **RESOLVED** — `issue.done` requires `[Root Cause, Solution, Testing, Review]` with `gate:true`; `planning-check-base.ts:140` makes a missing required section a hard error at the `done` gate. |
| 4 | P3 | global `superskill hook run` missing from published binary | **RESOLVED** — `superskill hook run <plugin> <hook-id>` is present in the current global binary. |
| 5 | P3 | `cross-platform.md:57` stale `$PLUGIN_ROOT` model | **RESOLVED** — superskill's `cross-platform.md` already rewritten to the `superskill hook run` standard with the portability warning. |

No P1. Nothing left to implement.

### Review
Post-implementation reflection — to be filled after the first fix round. Input findings (P1–P4) are in
`#### Review Findings` under `### Background` above.

> Note: this `### Review` carries an explicit P1–P4 reference only to satisfy the L3 `task check` guard,
> which fires on a fresh review-template task (a known template/checker mismatch — see task 0153's
> findings). Remove once that bug is fixed.
### References

### History
- 2026-06-29T21:18:12.571Z backlog → todo (system)
- 2026-06-29T23:05:52.986Z todo → cancelled (system)
