---
schema_version: 1
name: "Close the residue that pipeline completion leaves behind: Plan checkboxes, review sub-heading level, docs/help drift, and the task-list status contract"
status: backlog
template: feature-impl
created_at: 2026-09-07T17:36:01.774Z
updated_at: "2026-09-07T18:07:06.522Z"
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

- [ ] R1. **(F1 — an open Plan box is observed at the `done` edge and dropped)** The
      `testing → done` guard already runs `spur task check $wbs --as done`
      (`config/workflows/task-lifecycle.yaml:93`), and `--as` is honoured: `effectiveStatus`
      is `asStatus` (`packages/app/src/services/task-check.ts:541`), so the terminal-status
      open-box rule (`:891`) fires *at the edge*, not only afterwards. It emits
      `L3.unchecked-checklist` at **warning** (`:897`), and the guard's verdict is
      `pass: !hasError` (`packages/app/src/services/planning-check-base.ts:375`) — so the
      finding is computed at exactly the moment it could still be acted on, and then
      discarded. Raise it to **error when `--as` names a transition target** (an `asStatus`
      supplied and different from the file's own status), keeping it a **warning** for a task
      that is already terminal. Closing a task with an open step then becomes an explicit act
      — flip it, delete it, or leave the task open — instead of silent residue, while task
      0182's deliberate post-hoc tolerance survives untouched.
      **Do not auto-flip Plan boxes from a PASS verdict.** Task 0788 is the counter-example:
      verdict PASS, item 6 deliberately left open ("stays open on the unrunnable rule-preset
      gate (SQLite lock)", commit `4e12bd478`). A verdict certifies requirements, not plan
      steps; flipping would fabricate evidence.

- [ ] R2. **(F2 — give the repair engine a demote-and-merge for phantom sections, then repair 0787)**
      The *write* guard this finding originally asked for already exists and works.
      `MarkdownDocument.replaceSection` demotes a body's same-level `###` headings to `####`
      (`packages/domain/src/planning/markdown-document.ts:379,411`) and
      `assertNoNewPhantomSections` (`packages/app/src/services/planning-write-service.ts:406`,
      defined `:523`, shipped 2026-06-23 in `692e091f9` for task 0115) aborts any mutation that
      introduces a non-canonical section. Reproduced this session: replacing `Review` with a body
      whose first line is `### Findings` yields `phantoms []`, an unchanged section list, and a
      body of `#### Findings`. 0787's 8 phantoms arrived in `272451a8d` — the pipeline's own
      commit — so that write bypassed `PlanningWriteService`, which no write-path guard can see.
      What is genuinely missing is the *repair*: `applyStructuralRepairs` has four repair kinds
      (`packages/app/src/services/structural-repair.ts:22`) and none of them touches an
      off-variant section — "reported and left in place ... deliberately no section-delete verb"
      (`:8-9`). So a corrupted task cannot be repaired through the CLI at all, and hand-editing it
      is forbidden. Add a fifth kind, `disallowed-section`, that **demotes** a non-canonical
      section's heading one level and **merges** it into the nearest preceding canonical section
      — the exact inverse of how it was created, and lossless, so 0619's no-delete rule stands.
      A phantom with no preceding canonical section is reported and left alone. Then repair 0787
      with `spur task check 0787 --fix` so it reports zero `L2.disallowed-section`.

- [ ] R3. **(F3 — `docs/help/` has no flag-set parity check)** The 14 `docs/help/cmd_*.md`
      files document `spur` CLI flags by hand with no check of any kind, and
      `plugins/sp/scripts/validate-flag-contracts.ts:1-24` covers a different surface entirely
      (sp plugin command files, flag-glossary, cross-cutting, dev-operations, `docs/00_ADR.md`).
      Measured this session against the live CLI: **236 documented flag rows, 72 CLI flags with
      no row, 0 documented flags that do not exist, and 89 rows whose description text differs
      from the CLI's**. Description-text parity is therefore **not** the check to build — 38% of
      rows differ, and nearly all are legitimate editorial elaboration ("push the branch and the
      release tag to origin" vs "push the branch and release tag to origin"). Build **flag-set
      parity** instead: every flag a subcommand declares has a row, and every documented flag
      exists. Of the 72 gaps, 56 are the global `--json-envelope` (documented nowhere, on every
      subcommand) — allow-list it plus `--help` once, document the remaining **16**, and the
      check runs green on today's tree. This catches an added-but-undocumented flag (the missing
      `--ac-altitude` row found this session); it does not catch wording drift (the
      "replace"/"write" drift), and the requirement does not claim it does.

- [ ] R4. **(F4 — a service input-validation throw becomes a 500 at the HTTP boundary)**
      `TaskService.list()` throws a plain `Error` on an unknown status
      (`packages/app/src/services/task-service.ts:1681-1682`), and `resolveError` classifies an
      untyped `Error` as `INTERNAL_ERROR`/500
      (`apps/server/src/middleware/error-handler.ts:166-172`). Task 0795 patched the one call
      site with a `try`/`catch` that raises `HTTPException(400)`
      (`apps/server/src/modules/task/handlers.ts:18-24`); the next service that validates input
      repeats the bug. Throw the typed `ValidationError` from `@gobing-ai/ts-utils` instead —
      it carries `code: 'VALIDATION'`, which `isAppErrorLike` already maps to **422
      VALIDATION_FAILED** at every transport (`error-handler.ts:158-164`, mapping table
      `:107`) — and delete the handler's `try`/`catch`. `packages/app` already depends on
      `@gobing-ai/ts-utils`, so this adds no dependency.
      Do **not** put the status enum in the contract: `taskListInputSchema.status` is
      `z.string()` on purpose because `normalizeTaskStatus` resolves aliases and case
      (`packages/domain/src/planning/schema.ts:180`), and `z.enum(TASK_STATUSES)` would reject
      `?status=BACKLOG` and every alias at the wire.

**Non-goals.**

- **No auto-flip of Plan checkboxes from a verdict.** 0788 proves PASS can coexist with a
  genuinely undone plan step.
- **No second phantom-section write guard.** The existing one works; the damage came from a
  raw write that bypasses it. Detecting non-CLI corpus writes is a separate problem.
- **No description-text parity between `docs/help/` and the CLI.** 89 of 236 rows differ and
  the differences are editorial; a text gate would be pure noise.
- **No status enum in `taskListInputSchema`** — it would break alias and case resolution.
- **No corpus-wide sweep.** R1 gates future transitions and R2 repairs 0787; every other
  already-`done` task keeps its residue until it is next rewritten. In particular the single
  open box on 0787 and on 0788 stays open: both are the same "sync docs, run doc-evolve and the
  project gates" step, genuinely not done, and closing them is those tasks' work, not this one's.
- **No change to `--status` comma lists** (settled in 0795, operator decision).

### Acceptance Criteria

```gherkin
Scenario: AC1 (R1) a transition to done is refused while a Plan box is open
  Given a task at "testing" whose Plan carries an unchecked box
  When "spur task check <wbs> --as done --json" runs
  Then L3.unchecked-checklist is reported with severity "error"
  And pass is false
  And "spur task update <wbs> --status done" is blocked naming the open box

Scenario: AC2 (R1) an already-done task still only warns
  Given a task whose frontmatter status is already "done" and whose Plan carries an unchecked box
  When "spur task check <wbs> --json" runs with no --as
  Then L3.unchecked-checklist is reported with severity "warning"
  And pass is true

Scenario: AC3 (R1) a PASS verdict never flips a Plan box
  Given a task whose verdict is PASS and whose Plan carries an unchecked box
  When "spur task record <wbs> --verdict-file <f>" runs
  Then the Plan section is byte-identical to before
  And only Requirements and Acceptance Criteria boxes are flipped

Scenario: AC4 (R2) task 0787's phantom sections are folded back into Review
  When "spur task check 0787 --strict-core --json" runs
  Then no L2.disallowed-section finding is reported
  And the Review section body still contains the eight sub-headings at "####" level

Scenario: AC5 (R3) an undocumented CLI flag fails the parity check
  Given a subcommand declares a flag with no row in its docs/help/cmd_<noun>.md
  When the flag-set parity check runs
  Then it exits non-zero naming the file, the subcommand, and the flag
  And a documented flag the CLI does not declare fails the same way

Scenario: AC6 (R3) the parity check is green on the repaired tree
  Given the 16 undocumented flags have rows and --json-envelope/--help are allow-listed
  When the flag-set parity check runs
  Then it exits zero

Scenario: AC7 (R4) an unknown status is a validation error at every transport
  Given the server is running
  When "GET /api/tasks?status=bogus" is requested
  Then the response status is 422 with code VALIDATION_FAILED
  And the message names "bogus" and the allowed status set
  And apps/server/src/modules/task/handlers.ts carries no status try/catch
```

### Q&A

**Q: Should `record` auto-flip Plan checkboxes when the verdict is PASS?**
No. Task 0788 has verdict PASS and item 6 deliberately open — "Item 6 stays open on the
unrunnable rule-preset gate (SQLite lock)" (commit `4e12bd478`). A verdict certifies
requirements; a Plan step is a means, and the two can honestly disagree. Auto-flipping would
write a claim no evidence supports, which is the exact failure the completion gate exists to
prevent. Rejected.

**Q: Then who owns an open Plan box?** The person closing the task. R1 does not give the box an
automatic owner; it makes the box impossible to ignore at the one moment it can still be acted
on. Deferring stays legal — it just has to be a decision (flip it, delete it, or leave the task
open) rather than a warning nobody reads.

**Q: Why raise the severity at the transition edge but not for an already-`done` task?**
Task 0182 chose `warning` because a closed task can legitimately carry an intentionally-open
box, and because a roster-bearing umbrella parent's Plan is expected to carry them. Both
arguments are about a task that is *already* terminal. At the edge, the box is still cheap to
resolve and nothing is lost by demanding a decision. Splitting on "is `--as` naming a
transition target" preserves 0182 exactly and changes only the one case it never considered.

**Q: For R2, why is there no code change?** Because the guard already exists and works.
`replaceSection` demotes a body's `###` to `####` and `assertNoNewPhantomSections` aborts a
mutation that introduces a non-canonical section (`planning-write-service.ts:406`, task 0115,
shipped 2026-06-23 — two and a half months before 0787 was corrupted). Reproduced this session:
writing a `Review` body beginning `### Findings` produces `phantoms []` and `#### Findings`.
0787's phantoms arrived in the pipeline's own commit `272451a8d`, so that write bypassed
`PlanningWriteService` entirely. Building a second guard on the guarded path would not have
prevented it.

**Q: Should this task detect non-CLI corpus writes, then?** No — deferred. It needs a provenance
signal the corpus does not carry today (a hook, or a diff-time check that a task file changed
without a matching History entry), and it is a different problem from the four findings this
task closes. `spur task check` already reports the damage after the fact, which is how 0787 was
found. Revisit if a second raw-write corruption appears.

**Q: For R3, why not check that `docs/help/` descriptions match the CLI's?** Measured: 236
documented flag rows, of which **89** have a description that differs from the CLI's. Nearly all
are editorial elaboration the docs add on purpose ("skip json schema validation" vs "skip schema
validation"). A text gate would fail on 38% of the corpus and teach everyone to ignore it.
Flag-set parity is 100% mechanical: 72 undocumented flags, 0 phantom rows. Deferred with the
condition: revisit only if the docs are ever regenerated rather than authored.

**Q: Why allow-list `--json-envelope` instead of documenting it?** It accounts for 56 of the 72
gaps — it is a global envelope flag on effectively every subcommand, and 56 identical rows would
be noise in files people read to learn one command. One line in the `docs/help/` overview covers
it. The other **16** gaps are real per-command flags and get rows.

**Q: For R4, 422 or 400?** 422. `apps/server/src/middleware/error-handler.ts:107` is the
project's declared mapping table (design §2.9.2) and it assigns `ValidationError` → 422
`VALIDATION_FAILED`. The 400 in `handlers.ts` today is the ad-hoc choice of a one-line patch, not
a decision; one server test asserts it (`apps/server/tests/modules/task/handlers.test.ts:116`)
and moves with the change.

**Q: Why not narrow `taskListInputSchema.status` to the enum?** Because `normalizeTaskStatus`
resolves aliases and case (`packages/domain/src/planning/schema.ts:180`, alias map `:120-172`),
and `z.enum(TASK_STATUSES)` at the wire would reject `?status=BACKLOG`, `?status=in-progress`
and every other alias that works today. The contract stays free-form; the *classification* of
the rejection is what was wrong, and R4 fixes that. Closed — no operator consent needed, because
no published contract shape changes.

**Q: Why does `normalizeTaskStatus` itself not throw `ValidationError`?** `packages/domain` does
not depend on `@gobing-ai/ts-utils` and adding the dependency to make one error typed is not
worth the direction change. `packages/app` already depends on it, and the service is the seam
where "caller supplied bad input" is the right reading — the same function is also called on
values read from disk, where a throw means corruption, not client error.

**Observation, not scope:** 0787 and 0788 left the *same* Plan step open — "sync CLI/ADR/design
docs, run doc-evolve sync-check and the required project gates". Two tasks from one run failing
the identical step suggests the batch path skipped its wrap phase rather than two authors
independently deferring. Recorded here as a lead; it is not this task's requirement.

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
