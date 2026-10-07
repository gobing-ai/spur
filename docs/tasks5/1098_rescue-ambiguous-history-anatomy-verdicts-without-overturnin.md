---
schema_version: 1
name: Rescue ambiguous history-anatomy verdicts without overturning FAIL
status: todo
template: feature-impl
created_at: 2026-10-07T01:02:20.692Z
updated_at: "2026-10-07T01:19:57.308Z"
feature_id: P1
priority: P2
tags:
  - decision
estimate_hours: 3

dependencies: ["1096"]
---

## 1098. Rescue ambiguous history-anatomy verdicts without overturning FAIL

### Background

Slice S6 of docs/design/decision-observability-and-adoption.md §5. history-anatomy normalizes validator prose with a shell `Verdict:` line rewrite (config/workflows/history-anatomy.yaml:236). Covers R12. Starts only when reliability evidence exists for anatomy-validation-verdict.

### Requirements

- [ ] R1. Add catalog file `config/decisions/history-anatomy.yaml` with `anatomy-validation-verdict`: `type: choice`, criteria `PASS`/`FAIL`, `fallback: FAIL`.
- [ ] R2. In `config/workflows/history-anatomy.yaml`, extend the verdict-normalization shell step at `:236-251`. The rescue runs only when, after normalization, the last line is not exactly `Verdict: PASS` and there are zero exact `Verdict: FAIL` lines. That covers zero PASS lines, or several. Any exact `Verdict: FAIL` line short-circuits, and no maker is called.
- [ ] R3. In the ambiguous case, run `$spurBin decision run anatomy-validation-verdict --evidence "$f" --json`. Append `Verdict: PASS` only when `source == "model"` and `value == "PASS"`. Otherwise append `Verdict: FAIL`. A deterministic FAIL can never become PASS, and a fallback is always FAIL.
- [ ] R4. Add a workflow scan test that asserts the deterministic status checks contain no `decision run` or `kind: decide`. The checks are pr-review, wayfinder-resolution, wrapup-pipeline, feature-verification, and the history-anatomy structure gate. The allowlist is the single rescue step above.
- [ ] R5. Start condition: the 1096 reliability report shows recorded samples for `anatomy-validation-verdict`. Cite them in Solution.

### Acceptance Criteria

- [ ] AC1 — A deterministic FAIL is never overturned by a decision

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T01:02:48.887Z

- Scope and approach closed at idea-pipeline run 4111db4a-101f-420c-8b6f-9530bf678534: chosen approach and rejected alternatives recorded in Design; contract in docs/design/decision-observability-and-adoption.md.
- Adoption slices start only after the reliability report shows recorded evidence for their decision id and maker (feature P1 entry condition).

#### Q&A entry — 2026-10-07T01:19:12.051Z

- The rescue lives inside the existing normalization step, not a new state, so the 0771 guard and `assert-clean` are untouched.
- An ambiguous verdict with no model answer becomes FAIL. That is stricter than today, where the guard also fails, so the routing is the same.

### Design

**Chosen: extend the existing normalization step** (`config/workflows/history-anatomy.yaml:236-251`) instead of adding a new state.

- The 0771 guard and the `assert-clean` step (`:252-255`) stay the authorities.
- The rescue only decides which verdict line the guard reads when the file is ambiguous.

**Rejected:** asking the model whenever the last line is not PASS. That would put a maker in front of real FAILs.

**Invariants:**
- An exact `Verdict: FAIL` line anywhere in the file means no maker call and a FAIL result.
- A fallback or non-model answer means FAIL.
- PASS is written only from `source == "model"`.

**Execution budget:**
- 2 YAML files and 1 test file.
- `requireDiff: true`.
- Run `build:bundle` after the YAML edit.

### Plan

1. Failure list:
   - A file with both `Verdict: PASS` and `Verdict: FAIL` calls the maker.
   - A no-backend fallback writes PASS.
   - A file with a single correct `Verdict: PASS` already in the final line calls the maker.
   - The normalization step from 2026-09-13 regresses.
2. Add the catalog. Check it with `spur decision show anatomy-validation-verdict --json`.
3. Extend the shell step, then run `build:bundle`.
4. Add the scan test as `apps/cli/tests/workflow-decision-scan.test.ts` (reads `config/workflows/*.yaml`) to assert R4.
5. E2E, no backend, with four fixture validation files run through the step's command:
   - exact FAIL
   - FAIL plus PASS
   - prose only
   - single leading PASS
   - Expected final lines: FAIL with no decision rows, FAIL with no decision rows, FAIL with start/failure/end rows, and PASS from normalization with no decision rows.
   - Save the results as `.spur/run/1098-verdicts.json`.
6. Gate: `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
