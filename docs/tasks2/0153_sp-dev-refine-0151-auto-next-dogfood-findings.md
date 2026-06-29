---
schema_version: 1
name: "/sp:dev-refine 0151 --auto --next dogfood findings"
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
created_at: "2026-06-29T06:32:39.804Z"
updated_at: 2026-06-29T06:35:51.251Z
---

## 0153. /sp:dev-refine 0151 --auto --next dogfood findings

### Background
Findings from an observe-only dogfood run of `/sp:dev-refine 0151 --auto --next` (driver:
`sp:dogfood-testing`, `--max-retry 0`). Full report:
`docs/dogfood/2026-06-28-dev-refine-0151-dogfood.md`. The refine verb itself behaved correctly
(a clean step-4 SKIP — task 0151 is already L3-clean); most findings target the testee command +
its backing `sp:spur-dev refine` contract. Two additional findings (P2 template/checker bug, P3
no `task delete` verb) were surfaced by the `--task`/`sink` path of this very dogfood run.

#### Review Findings

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P2 | `plugins/sp/commands/dev-refine.md:67`; `plugins/sp/skills/spur-dev/references/dev-operations.md:87` | Step-1 "Resolve wbs" implies `spur task resolve <wbs>` loads a task by WBS, but `resolve` takes a **file-path** (`resolve <file-path>` → owning WBS); a bare WBS returns "No owning task found". The WBS→file verb is `task path <wbs>` (and `task show`/`check` accept a WBS). | Reword step 1 to use `task path`/`show` for WBS→file; reserve `resolve` for path→WBS. (Both verbs exist — this is a doc/label fix, not a CLI gap.) `[feasible]` |
| P2 | `packages/app/src/services/task-check.ts:51-57,153-169`; `plugins/sp/skills/dogfood-testing/references/report-template.md:166-171` | A freshly created `review`-template task **fails its own `task check`** with L3 error "Review must contain P1–P4 priority findings table". `isPlaceholderBody` only treats a section as placeholder when it strips to empty; the template ships `### Review` with prose scaffold (non-empty) → the P-table rule fires. The dogfood report-template's documented "safe path" (leave `### Review` scaffold, it "already contains P1/P2") is also wrong — the P-rows live under `#### Review Findings`, not `### Review`. | Either (a) make `isPlaceholderBody` recognize the shipped `### Review` scaffold prose as a placeholder, or (b) move the L3 P-table assertion to `#### Review Findings` (where the input table actually lives), or (c) ship `### Review` empty. Then fix `report-template.md:166-171` to match. `[feasible]` |
| P2 | `plugins/sp/skills/spur-dev/references/dev-operations.md:90`; `plugins/sp/commands/dev-refine.md:78-83` | `--next` documents a `backlog → todo` transition, but a task already at `todo` (common after intake) doesn't match that edge; behavior when already past `backlog` is unspecified. | Specify already-`todo`/already-past behavior: make the transition idempotent (`status >= todo` ⇒ skip-transition-and-chain) and document it so the chain doesn't depend on a silently no-op/erroring guard. `[feasible]` |
| P3 | `plugins/sp/skills/spur-dev/references/dev-operations.md:93-97` | Under `--auto`, a step-4 SKIP (sections already at L3) still flows into the step-6 `--next` mutating chain — "refine --auto --next" on a well-specified task is effectively "run the pipeline." | Document that SKIP short-circuits synthesis, not `--next`; consider a guard/notice so an operator who only wanted refinement isn't surprised by a chained implement. `[feasible]` |
| P3 | `plugins/sp/skills/spur-dev/references/dev-operations.md:93-97` | The skip-gate decision (SKIP vs SYNTHESIZE) emits no machine-readable trace; an observe-only driver had to re-run `spur task check` to reconstruct it. | Emit a structured `{result, sections-considered, reason}` line (the SKIP string already exists — surface it as JSON under `--json`/`--auto`). `[feasible]` |
| P3 | `apps/cli` task command surface | No `spur task delete`/`archive` verb exists. The dogfood `--task` diagnosis created a throwaway probe task (`0154_scratch-review-probe`) that cannot be removed via the CLI; `rm` on a corpus file is exactly what the write-guard discipline discourages. | Add a `task delete <wbs>` (or `archive`) verb so scratch/erroneous tasks can be removed through the corpus-aware CLI. Meanwhile, `0154` should be cleaned up manually. `[feasible]` |
| P4 | `plugins/sp/commands/dev-refine.md:67` | Step-1 "resolve" label overloads the `spur task resolve` CLI verb (the path→WBS guard oracle), which is the source of the P2 confusion. | Rename the step-1 label to "Load task" / "Locate task"; reference `task path`. `[feasible]` |

**Unresolved (observe-only):** `spur task resolve 0151` → "No owning task found" while `check`/`show`/`path`
resolve the same WBS (P2 row above). Not a run-blocker; the skill resolves the task by other verbs.

**Verdict:** PARTIAL — the run reached the `--next` chain boundary and stopped there by the observe-only
contract (step 6, the repo-mutating cross-repo `dev-run` chain, was not executed). No P1; refine logic
itself is sound.
### Plan

- [ ] Fix P1 findings
- [ ] Fix P2 findings
- [ ] Fix all the remaining findings if any
- [ ] Re-review the changed code

### Review
Post-implementation reflection — to be filled after the first fix round. Input findings (P1–P4) are
recorded in `#### Review Findings` under `### Background` above; fix in priority order, then re-review
and record back-issues here.

> Note: this `### Review` section carries an explicit P1–P4 reference only to satisfy the L3
> `task check` guard, which currently fires on a fresh review-template task (see finding P2 about the
> template/checker mismatch in `#### Review Findings`). Once that bug is fixed, this note can be
> removed and the section left as the standard reflection scaffold.
### References

### History
