---
schema_version: 1
name: "Remove the unreliable AUTH column from spur agent doctor table output"
status: todo
template: feature-impl
created_at: 2026-08-20T23:18:21.608Z
updated_at: "2026-08-20T23:18:38.999Z"
feature_id: A3
priority: P1
dependencies: ["0613"]
---

## 0621. Remove the unreliable AUTH column from spur agent doctor table output

### Background

`renderDoctorTable` in `packages/app/src/services/agent-service.ts` renders an AUTH column from
`result.authenticated`. The signal is not reliable — this tree's own `spur agent doctor omp` reports
`auth: no` for an agent that is installed and usable, with the detail line explaining that no probe
is registered for the provider. A column that reports "no" for working agents trains operators to
ignore the table.

The removal is scoped to the human table. `--json` keeps `authenticated`, because the `doctor.probe`
built-in classifies authentication failures downstream and dropping the field would break it. The
single-agent detail rendering (`renderDoctorDetail`) is a separate surface and is not in scope — the
request was the column.

Rubric: E1 D1 L0 C1 R2 = 5 → keep standalone; it carries its own scenarios, its own `--json`
invariant, and its own doc surface, and folding it into an unrelated sibling would mix two tasks'
evidence into one diff.

### Requirements

- [ ] R1. Remove the AUTH column from the `spur agent doctor` table rendering, including its header.
- [ ] R2. Keep the `authenticated` field present for every agent in `--json` output, so the `doctor.probe` built-in's auth classification is unaffected.
- [ ] R3. Keep the remaining columns aligned with their headers and the tier-1 summary footer unchanged.
- [ ] R4. Leave the single-agent detail rendering out of scope and state that explicitly in the change.
- [ ] R5. Update `docs/help/cmd_agent.md` and any test or snapshot asserting the AUTH column.

### Acceptance Criteria

```gherkin
@core
Scenario: R12 — spur agent doctor omits the AUTH column from its table
  Given the auth signal is unreliable and misreports usable agents
  When the doctor table is rendered
  Then no AUTH column appears in the table output
  And the remaining columns stay aligned with their headers
  And the tier-1 summary footer is unchanged

@edge
Scenario: R16 — Machine-readable doctor output keeps the auth field
  Given consumers that classify authentication failures from doctor output
  When spur agent doctor is run with --json
  Then the authenticated field is still present for every agent
  And only the human table rendering drops the column
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Drop the column, keep the data.** The unreliability is in the *presentation* — a two-state column
that cannot distinguish "not authenticated" from "no probe exists for this provider". The underlying
field still carries signal that a downstream classifier uses, so removing it from `--json` would
break the `doctor.probe` built-in for no benefit.

**Column widths are computed from the rows.** `renderDoctorTable` derives each column width from the
header plus every row, so removing one column must not leave a stale width computation or a doubled
separator — the alignment assertion in the AC exists because that is the plausible regression.

**The detail view is deliberately untouched.** `renderDoctorDetail` shows a labelled `auth:` line for
a single agent, where the accompanying `detail:` line supplies the context the table column lacked.
That is a different surface with a different failure mode; the operator asked for the column.

**This is an observable output change on an existing verb**, which ADR-051's consent gate covers and
the authority task's amendment records.

### Plan

- [ ] Read `renderDoctorTable` and its callers to confirm the column and width computation boundaries
- [ ] Remove the AUTH column and its header, and re-derive the column widths (R1, R3)
- [ ] Confirm `--json` still emits `authenticated` for every agent and the `doctor.probe` classifier is unaffected (R2)
- [ ] Leave `renderDoctorDetail` unchanged and note the scope boundary in the change (R4)
- [ ] Update tests and snapshots asserting the AUTH column, and `docs/help/cmd_agent.md` (R5)
- [ ] Run `bun run lint` and `bun run test`

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
