---
schema_version: 1
name: "dogfood 0114 implementation findings"
description: ""
status: todo
type: review
template: review
profile: standard
feature_id: H2
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-25T20:53:10.000Z"
updated_at: 2026-06-25T20:54:54.353Z
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

- [ ] Fix P1 findings
- [ ] Fix P2 findings
- [ ] Re-review the changed code

### Review
Findings from dogfooding the `/sp:dev-*` pipeline while implementing 0114 (2026-06-25). Priority table below; full detail + recommendations in `### Background → #### Review Findings`. (This task is the *input* to a fix round — `### Review` reflection is filled after fixes land.)

| Priority | Finding |
|----------|---------|
| P2 | 0114's pre-impl Design typed the preview as `renderRunPlan(walk: WorkflowRunResult)`, but that type has no step list — the "reuse dry-run walk" plan was unbuildable. Corrected during impl (preview reads the parsed def). Process gap: pre-impl review verified a capability existed, not the return type's fields. |
| P2 | The dogfood/verify loop ran `bun run lint` but the real gate is `biome check --error-on-warnings` + format; a formatter-only diff passed `lint` yet failed the gate. Verify must run `bun run format` before claiming green. |
| P2 | dev-dogfood protocol conflict: it instructs writing findings to `#### Review Findings` under Background, but `task check` L3 requires the P1–P4 table in `### Review` for the `review` template. Following the protocol verbatim produces a FAIL. Align the dogfood `--task` instruction with the L3 requirement. |
| P3 | `spur task check` PASSes tasks with empty placeholder AC/Plan (0114 passed precheck while content-incomplete). Candidate: a `--strict` warning on placeholder-only AC/Plan for AC-requiring variants. |
| P3 | DD-09 L4 emits a per-scenario warning when task AC isn't a subset of the (AC-less) parent feature — noisy with no reconciliation path. Candidate: suppress when the feature has zero AC. |
| P4 | Bash sandbox denied a `… | head` + `rm -rf` compound cleanup line; keep `rm` unchained in dogfood scripts. |
### References

### History
