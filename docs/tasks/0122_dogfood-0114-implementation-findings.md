---
schema_version: 1
name: "dogfood 0114 implementation findings"
description: ""
status: done
type: review
template: review
profile: standard
feature_id: H2
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-25T20:53:10.000Z"
updated_at: 2026-06-25T21:13:21.357Z
---

## 0122. dogfood 0114 implementation findings

### Background
#### Review Findings

Findings from dogfooding the `/sp:dev-*` pipeline while implementing task 0114 (run on 2026-06-25). The implementation itself succeeded; these are issues surfaced in the **tooling, specs, and process** during the run.

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P2 | `docs/tasks/0114_*.md` (Design) | The pre-implementation Design specified `renderRunPlan(walk: WorkflowRunResult)`, but `WorkflowRunResult` is terminal (`{runId, workflowName, mode, status, finalState, transitionsTaken}`) — it carries **no step list**. The "reuse the dry-run walk" plan could not produce a state-by-state preview. | Pre-impl review should verify the *return type's fields*, not just that a capability ("dry-run walks transitions") exists. Caught + corrected during impl (preview now reads the parsed def). A reviewer checking signatures against real types would have caught it earlier. |
| P2 | dev-dogfood own loop | My verification ran `bun run lint` but the gate is `biome check . --error-on-warnings` + a separate `format` check — a formatter-only diff (multi-line import) passed `lint` locally yet failed the stricter gate twice. | The dogfood/verify loop must run `bun run format` (or `biome check --write`) before claiming green, not just `lint`. Consider folding format into the `check` script, or make `lint` include the formatter assertion. |
| P3 | `spur task check` | `task check` PASSes a task whose `## Acceptance Criteria` and `## Plan` are empty placeholders (only HTML comments). 0114 passed precheck while content-incomplete. | Documented behavior (check validates presence, refine fills content), but the dogfood confirms the gap is real friction. Candidate: a `--strict`-level warning when an AC-requiring variant has placeholder-only AC/Plan. |
| P3 | `spur task check` (L4 / DD-09) | Authoring detailed task AC emits `[WARN] task scenario "…" is not in feature "H2"'s AC` for every scenario, because the parent feature declares no AC. Noisy when a task is more specific than its feature. | Expected permissive-start behavior, but the warning fires per-scenario with no path to reconcile. Candidate: a verb to promote task AC into the feature, or suppress when the feature has zero AC (nothing to be a subset of). |
| P3 | `apps/cli` Bash sandbox | A dogfood cleanup command (`... | head` followed by `rm -rf /tmp/<dir>` in one compound line) was denied by the permission gate, forcing a re-run. | Minor: keep destructive cleanup (`rm`) as its own command, never chained after a pipe, in dogfood scripts. |
### Plan
- [x] Fix P1 findings — none present (highest severity in this task is P2)
- [x] Fix P2 findings — all three resolved (secu-review type-fit, fixall format gate, dogfood L3 contract)
- [x] Re-review the changed code — `bun run format` + `bun run lint` + `bun test plugins/sp packages/app/tests/services/task-check.test.ts` all green (100 pass / 0 fail)
### Review
Post-fix reflection (fixes landed 2026-06-25). All three actionable P2 findings from the 0114 dogfood are resolved as **docs/process** changes in the `sp` plugin — no runtime code logic changed. The three P3/P4 items were left as documented-behavior observations (no fix warranted). One back-issue surfaced and is logged below.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P2 | `plugins/sp/skills/code-verification/references/secu-review.md` | **Fixed.** Added a *type-fit* clause to the Correctness dimension + a dedicated "Type-fit check" subsection: every signature / field access / "reuse X" claim must resolve against the *actual* type's fields, not an assumed capability. Applies to pre-impl design review, where 0114's `renderRunPlan(walk: WorkflowRunResult)` slipped through. | Done. Reviewers now check return-type fields, not capability existence. |
| P2 | `plugins/sp/skills/spur-dev/references/dev-operations.md` §10 (fixall) | **Fixed.** Root cause refined: `bun run lint` already runs `--error-on-warnings`; the real gap is it never asserts *formatting*. Loop now runs `bun run format` first and in final verification; added an invariant forbidding "green on `lint` alone". | Done. A formatter-only diff (multi-line import reflow) can no longer pass as green. |
| P2 | `plugins/sp/commands/dev-dogfood.md` §Sinks | **Fixed.** Documented the `task check` L3 contract: `### Review`, if non-placeholder, must carry a `P1`–`P4` column or the check hard-FAILs (`task-check.ts:155`). Safe path: write only `#### Review Findings` and leave `### Review` as the template scaffold. | Done. The `--task` instruction no longer produces a check-FAILing task when followed verbatim. |
| P3 | `plugins/sp/commands/dev-dogfood.md` (back-issue) | The original finding claimed "following the protocol verbatim produces a FAIL." Ground-truthing showed the *template scaffold's* `### Review` placeholder already contains `P1`/`P2`, so the bare protocol does **not** FAIL — the FAIL only occurs when an agent overwrites `### Review` with prose lacking a P-table. The fix documents the real trigger; the finding's stated cause was slightly imprecise. | No further fix — the corrected fix already covers the real trigger. Logged for accuracy. |
### References

### History
- 2026-06-25T21:13:20.700Z todo → wip (system)
- 2026-06-25T21:13:21.035Z wip → testing (system)
- 2026-06-25T21:13:21.357Z testing → done (system)
