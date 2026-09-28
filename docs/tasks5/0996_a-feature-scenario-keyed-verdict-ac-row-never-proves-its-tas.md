---
schema_version: 1
name: A feature-scenario-keyed verdict AC row never proves its task AC box
status: todo
template: issue
created_at: 2026-09-28T23:16:58.188Z
updated_at: "2026-09-28T23:17:34.255Z"
feature_id: D62

ac_altitude: task-local
---

## 0996. A feature-scenario-keyed verdict AC row never proves its task AC box

### Background

Found during the 0968 and 0969 runs (2026-09-28), both feature-linked tasks (G67, H21). Two surfaces disagree about how a verdict AC row is keyed:

- `spur task verdict --from-answer` requires every row keyed to a feature scenario. Keying the AC rows as `AC1`/`AC2` made it exit non-zero: `Verdict rows key to no scenario of linked feature G67: R1, R2, R3, R4, R5 (+2 more)`.
- Keying the AC rows by the feature scenario title (`R3 — The agent loop is an application service`, the tool's first-listed accepted form) satisfies the verdict, but `flipVerifiedCheckboxes` (`packages/app/src/services/task-record.ts`) derives its proof set through `prefixId`, whose `/^(?:AC|R)\d+/` maps that key to `R3` — the **Requirements** namespace — while the task's AC checkbox is `AC1`. The AC box is therefore never flipped.

Consequence, observed twice: `task record` leaves the AC boxes `[ ]`, the record-stage residual sweep classifies them blocking, folds `PASS → PARTIAL`, and the `record → done` gate fails (`Task is done but carries N unchecked checklist box(es)`). Recovery required a manual `spur task update <wbs> --section "Acceptance Criteria"` tick, then a **second** verdict derivation + residual sweep + done gate.

The task file already carries the alias on the AC line itself (`- [ ] AC1 — R3 — The agent loop is an application service`), so the mapping information exists where the flip runs; only the lookup is missing. `prefixId`'s own comment names the intended contract ("Without the AC form, an AC row keyed by scenario title for feature credit could never tick its own task box") — it handles `AC1 — <scenario title>` but not the reverse, `<scenario> — <title>` for an AC that aliases a feature scenario.

### Requirements

- [ ] R1. A verdict AC row keyed by a feature-scenario identifier proves the task AC checkbox that aliases that scenario, so a feature-linked task needs no manual AC tick between `record` and `done`.
- [ ] R2. Existing keying forms keep their behavior: `AC1`, `AC1 — <scenario title>`, and `R1`-style requirement keys flip exactly what they flip today; a scenario key that the task does not alias flips nothing.
- [ ] R3. Tests cover the aliased-scenario key flipping its AC box, the non-aliased key flipping nothing, and the existing forms staying green.

### Acceptance Criteria

- [ ] AC1 — A feature-linked task whose AC lines alias feature scenarios reaches `done` from `record` with no manual AC tick and no PASS→PARTIAL downgrade (req: R1)
- [ ] AC2 — `AC1`, `AC1 — <title>` and `R1` keying still flip exactly their boxes; an unaliased scenario key flips none (req: R2)
- [ ] AC3 — Focused `task-record` tests cover all three cases and the full gate is green (req: R3)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Resolve the id in `flipVerifiedCheckboxes` against the section body before matching. Two viable shapes, pick one:

1. **Alias resolution at flip time.** After computing `proven`, for each proven id that is not a `AC\d+`/`R\d+` prefix, scan the checklist items for a line whose AC label aliases that key (`AC1 — R3 — <title>` → the `AC1` box is proven by a `R3` key). The section body is already in hand and `parseChecklist` returns the per-line text.
2. **Accept the combined key at the verdict layer.** Confirm whether `AC1 (feature R3)` satisfies both the lint's accepted forms and the verdict's scenario keying; if it does, the fix is a documented answer-schema rule rather than flip-time logic.

Verify the chosen shape by reproducing the 0968/0969 path end to end (feature-linked task + scenario-keyed AC rows) and confirming the AC boxes flip during `task record`.

### Plan

- [ ] Reproduce the two-keying conflict in a focused test (feature-linked task, scenario-keyed AC row).
- [ ] Implement the chosen alias resolution; keep `prefixId`'s existing forms intact.
- [ ] Cover the three R3 cases in the `task-record` suite, then run `bun run spur-check`.
- [ ] Update the verdict-answer authoring guidance with the keying rule that works for feature-linked tasks.

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
