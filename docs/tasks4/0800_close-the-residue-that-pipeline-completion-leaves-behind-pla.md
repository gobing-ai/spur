---
schema_version: 1
name: "Close the residue that pipeline completion leaves behind: Plan checkboxes, review sub-heading level, docs/help drift, and the task-list status contract"
status: backlog
template: feature-impl
created_at: 2026-09-07T17:36:01.774Z
updated_at: "2026-09-07T17:45:28.156Z"
feature_id: H1

ac_altitude: task-local
---

## 0800. Close the residue that pipeline completion leaves behind: Plan checkboxes, review sub-heading level, docs/help drift, and the task-list status contract

### Background

Session review of the `/sp:dev-verify 0795 --auto --next --force --focus all --fix all` run
(2026-09-07), triaged against the earlier `/sp:dev-verifyall --feature F21` run. Four findings
survived triage; each is unowned by an existing task.

The unifying symptom: **pipeline completion marks a task `done` while leaving structural residue
that nothing ever closes.** `spur task check --strict-core` reports these as `warning`, and the
done-gate reads only the verdict artifact, so a PASS verdict clears the gate with warnings intact.
They accumulate silently and surface later as noise in every subsequent check.

Evidence that this recurs rather than being a one-off — three tasks from two different runs:

| Task | Run | Residue at `done` |
| --- | --- | --- |
| 0787 | F21 verifyall | 1 unchecked Plan box + 8 `L2.disallowed-section` |
| 0788 | F21 verifyall | 1 unchecked Plan box |
| 0795 | this run | 15 unchecked Plan boxes (cleared by hand this session) |

Already fixed inline during the review, and therefore **out of scope here**: the
`plugins/sp/skills/spur-cli/references/tasks/section-editing.md` recipe never said a section body's
sub-headings must be `####` or deeper. That doc gap is closed; F2 below is the code-side guard that
would have caught 0787 regardless of what the doc said.

### Requirements

- [ ] R1. **(F1 — Plan checkboxes have no owner)** Something closes `Plan` checkboxes when a task
      reaches `done`. Today nothing does: `spur task record` auto-flips proven boxes in
      `Requirements` and `Acceptance Criteria` only — the loop is hard-coded to those two sections
      at `packages/app/src/services/task-service.ts:1347` — and `spur task check --fix` explicitly
      disclaims the job ("flipping verified boxes is task record's job, not --fix",
      `apps/cli/src/commands/task.ts:1306`). Plan steps are keyed `1.`/`2.`/`(R1)`, not by verdict
      requirement id, so `flipVerifiedCheckboxes` cannot match them as written. Decide the owner
      and implement it: either `record` flips Plan steps whose keyed requirement is MET, or
      `L3.unchecked-checklist` becomes an error at `done` so the gate refuses to close a task with
      open boxes. Do not "fix" this by deleting the warning.
- [ ] R2. **(F2 — `###` in a section body creates phantom sections)** A section body containing a
      `###` heading parses as new top-level sections. Task 0787's `## Review` body grew 8 of them
      (`### Findings`, `### Functional traceability (R1–R5)`, `### SECUA / architecture depth`,
      `### Residual risk & disposition`, `### Re-review (post-remediation)`,
      `### Prior-finding resolution`, `### New findings`, `### Re-review sweep …`), each now a
      permanent `L2.disallowed-section` warning. `spur task update --section --from-file` should
      reject a body whose first-level headings collide with the section level, or demote them, at
      the write boundary — the same seam that already normalizes Gherkin fences
      (`packages/app/src/services/planning-write-service.ts:540`). Repair 0787 as part of this.
- [ ] R3. **(F3 — `docs/help/` has no drift guard)** The 14 `docs/help/cmd_*.md` files mirror
      `spur <noun> --help` output and are hand-maintained with no check of any kind: no test, no
      script, and `plugins/sp/scripts/validate-flag-contracts.ts` covers five surfaces (command
      files, flag-glossary.md, cross-cutting.md, dev-operations.md, docs/00_ADR.md) but not these.
      This session found `cmd_task.md:116` and `cmd_feature.md:108` still saying "Section name to
      replace" long after the CLI said "write". Extend `validate-flag-contracts.ts` (or add a
      sibling check) so a flag description that disagrees with the live CLI help fails a gate.
- [ ] R4. **(F4 — the task-list status contract is untyped)** `taskListInputSchema.status` is
      `z.string().optional()` (`packages/contracts/src/task.ts:32`), not the canonical enum, so
      contract validation cannot reject a bad status and it reaches the service. When task 0795 R1
      made `TaskService.list()` throw on an unknown status, `GET /tasks?status=bogus` became a 500
      (`globalErrorHandler` classifies a plain `Error` as `INTERNAL_ERROR`) where it had been
      `200 {ok:true,data:[]}`. The oRPC handler now normalizes and raises `HTTPException(400)`
      (`apps/server/src/modules/task/handlers.ts:18-24`), which fixes the symptom at one seam.
      Decide whether the contract should carry the enum instead — that is the durable fix, but it
      changes a published contract shape, so it needs design and operator consent, not a drive-by.

**Non-goals.**

- No change to `L3.unchecked-checklist`/`L2.disallowed-section` severity as a way of silencing them.
  Either close the residue or make the gate refuse it; do not lower the signal.
- No corpus-wide sweep of historical tasks. R1/R2 fix the writers and repair 0787; every other
  already-closed task keeps its residue until it is next rewritten.
- No widening of `--status` to comma lists (settled in 0795, operator decision).

### Acceptance Criteria

```gherkin
Scenario: AC1 (R1) a task cannot reach done carrying open Plan boxes
  Given a task at "testing" whose Plan has an unchecked step keyed to a MET requirement
  When the completion path runs
  Then either the step is flipped to "[x]", or the transition is refused naming the open boxes
  And "spur task check <wbs> --strict-core" reports no L3.unchecked-checklist finding

Scenario: AC2 (R1) the three known offenders come back clean
  Given tasks 0787, 0788 and 0795
  When "spur task check <wbs> --strict-core --json" runs for each
  Then every one reports zero findings

Scenario: AC3 (R2) a section body cannot mint a phantom section
  Given a body file whose first line is "### Findings"
  When "spur task update <wbs> --section Review --from-file <file>" runs
  Then the write is refused naming the colliding heading, or the heading is demoted to "####"
  And the task's parsed section list is unchanged apart from Review

Scenario: AC4 (R2) task 0787 is repaired
  When "spur task check 0787 --strict-core --json" runs
  Then it reports no L2.disallowed-section finding

Scenario: AC5 (R3) docs/help drift fails a gate
  Given a docs/help/cmd_*.md flag description that disagrees with the live CLI help text
  When the contract check runs
  Then it exits non-zero naming the file, the flag, and both spellings

Scenario: AC6 (R4) an unknown status is a client error at every transport
  Given the server is running
  When "GET /tasks?status=bogus" is requested
  Then the response status is 400, not 500
  And the body names the offending value and the allowed set
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Session evidence (`/sp:dev-verify 0795`, 2026-09-07):

- `packages/app/src/services/task-service.ts:1343-1352` — record's flip loop, `Requirements` and
  `Acceptance Criteria` only ("never on PARTIAL/FAIL/UNKNOWN beyond the proven ids").
- `apps/cli/src/commands/task.ts:1306` — `--fix` help text assigning box-flipping to `record`.
- `docs/tasks4/0787_*.md:204-283` — the 8 `###` sub-headings inside `## Review`.
- `packages/app/src/services/planning-write-service.ts:540` — the write-boundary seam that already
  normalizes AC fences; the natural home for R2's guard.
- `plugins/sp/scripts/validate-flag-contracts.ts:1-24` — the five covered surfaces; `docs/help/` is
  absent from the list.
- `packages/contracts/src/task.ts:32` — `status: z.string().optional()`.
- `apps/server/src/modules/task/handlers.ts:14-24` — the 400 seam added by 0795's verify fix.
- Commit `d2e9a0d9c` — 0795 R1-R3, where the 500 regression was found and patched.

Related: task 0795 (the register these findings came out of), task 0692 R2 (record's
Requirements/AC auto-flip), feature F21 (the earlier verifyall whose tasks 0787/0788 carry the
same residue).

### History
