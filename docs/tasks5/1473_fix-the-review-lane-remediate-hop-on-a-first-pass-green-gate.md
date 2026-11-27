---
schema_version: 1
name: Fix the review-lane remediate hop on a first-pass-green gate
status: todo
template: issue
created_at: 2026-11-27T18:18:55.414Z
updated_at: "2026-11-27T18:19:57.256Z"

ac_altitude: task-local
ac_numbering: task-local
feature_id: H16
---

## 1473. Fix the review-lane remediate hop on a first-pass-green gate

### Background

A PARTIAL review verdict on a task whose quality gate passed **on the first attempt** dead-ends the
task-pipeline at `failed(reason: failed-check)`. Observed 2026-11-27 in the knowledge-kit D9 batch,
task 0451 (`/Users/robin/xprojects/knowledge-kit`, run `ae0d9e4a-5ec0-43f2-9398-07b753d7da60`): the
gate wrote `DEFERRED` (light tier PASS), the reviewer returned PARTIAL, `review → remediate` fired —
and the remediate hop's fourth action (`file.read.into-var` on `.spur/run/0451-test-gate.findings`)
returned `file not found`, failing the step and the run. The operator's only way forward was to hand-
write the findings file and start a second pipeline run.

Two defects combine:

1. **The deferred tier does not write the findings artifact on a pass.**
   `packages/app/src/services/quality-gate.ts:886-896` (`runDeferredGate`) writes
   `<wbs>-test-gate.findings` **only** when `status === 'FAIL'`. The full tier writes it on every
   outcome — `packages/app/tests/services/quality-gate.test.ts:216` asserts `readFileSync(...).toBe('')`
   for a passing gate — so the two tiers disagree about the same contract, and the comment above the
   deferred write ("The findings artifact is part of every mode's contract") is currently false for
   the pass case.
2. **The reader treats a missing artifact as a step failure, unconditionally.**
   `packages/app/src/workflow/actions/file-read-into-var.ts:57-60` returns `{ok:false, error: 'file
   not found'}`. `task-pipeline.yaml`'s remediate onEnter (`file.read.into-var` of
   `${vars.wbs}-test-gate.findings` into `gateFindings`) has no way to say "this artifact is optional
   on the review lane", so the review lane inherits a hard dependency only the gate-red lane can
   satisfy.

Even with 1 fixed, the review lane would pass `--findings ""`, which tells the fixer nothing: the
review lane's *own* anchors (`P<n>-<m>` in `<runId>-review-answer.txt`, already appended to
`<wbs>-test-gate.log` by the projection action added in 1262 R6) are the findings it should hand over.

### Requirements

Write <wbs>-test-gate.findings on every deferred-gate outcome (empty on DEFERRED); add missing:'error'|'empty' to file.read.into-var (default error) and use 'empty' for the remediate findings read; seed the review lane's findings from the reviewer's own P-anchors; cover the green-gate→review→remediate route in the triage-routing test.

### Acceptance Criteria

```gherkin
@core
Scenario: AC1 — A green deferred gate always leaves a findings artifact (req: R1)
  Given a task whose light tier passes so the deferred gate writes DEFERRED
  When the gate finishes
  Then .spur/run/<wbs>-test-gate.findings exists
  And its content is empty rather than the tail of a green log

@core
Scenario: AC2 — file.read.into-var can read an optional artifact (req: R2)
  Given a file.read.into-var action whose path does not exist
  When the action runs with missing: 'empty'
  Then it succeeds with an empty string projected into its var
  And the same action without the option still fails with 'file not found'

@core
Scenario: AC3 — A PARTIAL review on a first-pass-green gate reaches remediate with real anchors (req: R3)
  Given a run whose gate wrote DEFERRED and whose review cert returned PARTIAL with P2 anchors
  When the review transitions to remediate
  Then the run is not terminal-failed with reason failed-check
  And gateFindings names the reviewer's anchors instead of an empty string
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Three small, independently testable changes; no schema, config or CLI-surface change.

**(a) Writer consistency — `runDeferredGate` writes the artifact on every outcome.**
`quality-gate.ts:886`: drop the `if (status === 'FAIL')` guard and write
`extractFindings(gateLog)` (empty string when nothing matched, matching the full tier). No
`tailLines(...)` fallback on the pass path — an empty findings set must read as empty, not as the last
40 lines of a green log.

**(b) Reader robustness — `file.read.into-var` gains `missing`.**
`missing: 'error' | 'empty'`, default `'error'` so every existing workflow keeps today's fail-closed
behaviour. `'empty'` returns `{ok: true, data: {content: '', ...}, setVars: {[var]: ''}}` for an absent
file. `task-pipeline.yaml`'s remediate read opts in with `missing: empty`; the artifact is genuinely
optional there because the review lane can reach `remediate` without a red gate.

**(c) Review-lane content — seed the findings from the reviewer's anchors.**
One `shell` action in remediate's onEnter, before the read: when
`$(cat .spur/run/$__runId-gate.status) = PASS` and the findings file is missing or empty, extract the
reviewer's finding anchors from `<runId>-review-answer.txt` (the `**P<n>-<m>` bullets the review
contract already emits) into `<wbs>-test-gate.findings`. It reuses the existing lane marker, so the
fixer receives real `file:line`-bearing anchors instead of an empty string.

Why not the alternatives: making the review→remediate guard write the file duplicates (a) and leaves
(b) latent for every other optional artifact; hard-failing the review lane instead of repairing it
throws away a legitimate repair hop; a `softFail` read would silently hide a genuinely missing
required artifact.

ADR/contract note: (b) is a workflow-action surface change — `docs/04_DESIGN` (spur) owns the action
table and must name the new option in the same commit.

### Plan

1. Reproduce in tests first: extend `packages/app/tests/services/quality-gate*.test.ts` with a
   deferred-tier PASS case asserting `<wbs>-test-gate.findings` exists and is empty (today's deferred
   pass writes nothing).
2. (a) Write the artifact unconditionally in `runDeferredGate`; keep the FAIL path's
   `tailLines(...)` fallback untouched.
3. (b) Add `missing` to `file.read.into-var` (+ its action test matrix: absent/empty/present ×
   error/empty), document the option in the action's TSDoc and the design doc's action table.
4. Set `missing: empty` on the remediate findings read in `task-pipeline.yaml`.
5. (c) Add the review-lane seeding shell action before that read; guard it on
   `gate.status = PASS` so the gate-red lane is untouched.
6. Regression test in `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts`: a green
   deferred gate + a PARTIAL review cert reaches `remediate` with a non-empty `gateFindings` and does
   not end at `failed-check` (mirror the existing gate-red case at `:208`).
7. `bun run gate` (lint + full suite + rules) and one live dogfood: force a first-pass-green gate plus
   a PARTIAL review on a scratch task and confirm the run reaches `remediate`.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
