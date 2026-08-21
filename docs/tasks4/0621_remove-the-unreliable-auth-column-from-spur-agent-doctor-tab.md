---
schema_version: 1
name: "Remove the unreliable AUTH column from spur agent doctor table output"
status: done
template: feature-impl
created_at: 2026-08-20T23:18:21.608Z
updated_at: "2026-08-21T17:56:10.167Z"
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

- [x] R1. Remove the AUTH column from the `spur agent doctor` table rendering, including its header.
- [x] R2. Keep the `authenticated` field present for every agent in `--json` output, so the `doctor.probe` built-in's auth classification is unaffected.
- [x] R3. Keep the remaining columns aligned with their headers and the tier-1 summary footer unchanged.
- [x] R4. Leave the single-agent detail rendering out of scope and state that explicitly in the change.
- [x] R5. Update `docs/help/cmd_agent.md` and any test or snapshot asserting the AUTH column.

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

- [x] Read `renderDoctorTable` and its callers to confirm the column and width computation boundaries
- [x] Remove the AUTH column and its header, and re-derive the column widths (R1, R3)
- [x] Confirm `--json` still emits `authenticated` for every agent and the `doctor.probe` classifier is unaffected (R2)
- [x] Leave `renderDoctorDetail` unchanged and note the scope boundary in the change (R4)
- [x] Update tests and snapshots asserting the AUTH column, and `docs/help/cmd_agent.md` (R5)
- [x] Run `bun run lint` and `bun run test`

### Solution
Removed the AUTH column from the `spur agent doctor` text table: the auth signal
cannot distinguish "not authenticated" from "no probe registered for the provider",
so the column misreported usable agents.

- `renderDoctorTable` drops the `auth` row field, the `auth: 'AUTH'` header entry,
  its width computation, and the auth cell from the line template — remaining columns
  (`STATUS AGENT TIER VERSION MODEL`) stay aligned via the same `padEnd` width logic,
  and the tier-1 summary footer is untouched (`packages/app/src/services/agent-service.ts:2137-2184`).
- `renderAuth` is kept for `renderDoctorDetail`; the single-agent detail view is
  explicitly out of scope for this change (R4).
- `--json` output is unchanged: `DoctorRow.authenticated` still flows through
  `svc.doctor({ json: true })`, so the `doctor.probe` built-in's auth classification
  is unaffected (R2).
- `docs/help/cmd_agent.md` §doctor documents the new table shape, the removal
  rationale, and the `--json` `authenticated` note (`docs/help/cmd_agent.md:142-147`).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Scenario: R12 — spur agent doctor omits the AUTH column from its table | MET | R1/R3/R4/R5: `renderDoctorTable` no longer has an `auth` field, `AUTH` header entry, or auth cell; remaining columns aligned via the same `line()`/`width()` logic and the footer untouched (`packages/app/src/services/agent-service.ts:2137-2184`); detail view out of scope, stated in the doc rationale (`docs/help/cmd_agent.md:142-147`); test asserts no `AUTH` header and shared 5-cell counts (`packages/app/tests/services/agent-service.test.ts:301-344`) |
| Scenario: R16 — Machine-readable doctor output keeps the auth field | MET | R2/R5: `DoctorRow.authenticated` still flows through `svc.doctor({ json: true })`; asserted by the `parsed.agents[].authenticated` check in the `renderDoctorTable` test (`packages/app/tests/services/agent-service.test.ts:301-344`) and the smoke `agent doctor --json` run; doc records the `--json` note (`docs/help/cmd_agent.md:142-147`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Kind | Finding | Ref |
|---|---|---|---|
| P4 | Verify | No P1–P3 findings. `renderDoctorTable` drops the `auth` field, `AUTH` header, width, and cell; columns still render through the same `line()`/`width()` logic (`packages/app/src/services/agent-service.ts:2137-2184`) | R1/R3 MET |
| P4 | Risk | `--json` contract preserved: `DoctorRow.authenticated` untouched, asserted by the `authenticated` check in the rewritten test and smoke run | R2 MET |
| P4 | Verify | Single-agent detail rendering (`renderDoctorDetail` + `renderAuth`) explicitly left out of scope; rationale stated in Solution and docs | R4 MET |
| P4 | Verify | `cmd_agent.md` §doctor documents the new table shape and removal rationale; the sole AUTH-asserting test rewritten; no other test/snapshot asserted AUTH (repo grep) | R5 MET |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-21T17:55:39.930Z todo → wip (system)
- 2026-08-21T17:55:40.524Z wip → testing (system)
- 2026-08-21T17:56:10.167Z testing → done (system)
