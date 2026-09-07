---
schema_version: 1
name: "Close the residue that pipeline completion leaves behind: Plan checkboxes, review sub-heading level, docs/help drift, and the task-list status contract"
status: todo
template: feature-impl
created_at: 2026-09-07T17:36:01.774Z
updated_at: "2026-09-07T18:30:37.550Z"
feature_id: H1

ac_altitude: task-local
---

## 0800. Close the residue that pipeline completion leaves behind: Plan checkboxes, review sub-heading level, docs/help drift, and the task-list status contract

### Background

Session review of the `/sp:dev-verify 0795 --auto --next --force --focus all --fix all` run
(2026-09-07), triaged against the earlier `/sp:dev-verifyall --feature F21` run. Four findings
survived triage — F1–F4 below, mapping to R1–R4 in order; each is unowned by an existing task.

The unifying symptom: **pipeline completion marks a task `done` while leaving structural residue
that nothing ever closes.** Evidence that this recurs rather than being a one-off — three tasks
from two different runs:

| Task | Run | Residue at `done` |
| --- | --- | --- |
| 0787 | F21 verifyall | 1 unchecked Plan box + 8 `L2.disallowed-section` |
| 0788 | F21 verifyall | 1 unchecked Plan box |
| 0795 | this run | 15 unchecked Plan boxes (cleared by hand this session) |

Refinement traced each finding to its seam, and two of the four first-pass premises turned out to
be wrong. The corrected picture:

- **The open box is not unobserved — it is observed and discarded.** The done gate does run
  `spur task check $wbs --as done` (`config/workflows/task-lifecycle.yaml:93`), `check()` honours
  `--as` (`task-check.ts:541`), and the terminal-status rule therefore fires at the exact moment
  the transition could be refused (`:891`). It fires at `warning`, and `pass: !hasError`
  (`planning-check-base.ts:375`) drops it. The gap is one severity decision, not a missing check.
- **The write-boundary guard for phantom sections already exists and works.**
  `assertNoNewPhantomSections` (`planning-write-service.ts:523`, shipped in `692e091f9`, task 0115)
  aborts any `PlanningWriteService` mutation that would introduce a non-canonical heading; verified
  live this session by replacing `Review` with a body starting `### Findings` — it comes back
  `#### Findings`, phantoms `[]`. 0787's 8 phantoms arrived in the pipeline's own commit
  `272451a8d`, i.e. from a write that bypassed the service. The real gap is that **no repair
  exists**: `structural-repair.ts` has four kinds, none for off-variant sections, so `--fix` cannot
  clean a task the guard never got to see.
- **`docs/help` drift is real but smaller than it looks.** Measured this session across
  `docs/help/cmd_*.md` and the live commander tree: 236 documented flag rows, **72** CLI flags with
  no row, **0** documented rows for flags that do not exist, and **89** rows whose description text
  differs from the CLI's. 56 of the 72 are the global `--json-envelope`.
- **The 500-on-bad-status root cause is an untyped throw, not a loose contract.**
  `normalizeTaskStatus` resolves aliases and case (`packages/domain/src/planning/schema.ts:180`),
  so the wire schema cannot be narrowed to the bare enum without breaking `?status=BACKLOG`. It
  throws a plain `Error`, which the transport maps to 500 (`error-handler.ts:166`). 0795 patched
  that in the HTTP handler only; the CLI and any future transport still see the untyped throw.

Already fixed inline during the review, and therefore **out of scope here**: the
`plugins/sp/skills/spur-cli/references/tasks/section-editing.md` recipe never said a section body's
sub-headings must be `####` or deeper. That doc gap is closed.

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
- **No second phantom-section write guard, and no section-delete verb.** The write guard works;
  the damage came from a raw write that bypasses it. Detecting non-CLI corpus writes is a
  separate problem. R2's repair demotes and merges — it never deletes content (0619 stands).
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
  And the testing to done transition is blocked naming the open box

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

Scenario: AC4 (R2) the repair engine folds a phantom section back into its owner
  Given a task whose body carries a non-canonical "### Findings" section after "### Review"
  When applyStructuralRepairs runs for the task domain
  Then a repair of kind "disallowed-section" is reported for "Findings"
  And the heading is emitted as "#### Findings" inside the Review body
  And no line of its content is dropped

Scenario: AC5 (R2) a phantom with no preceding canonical section is left alone
  Given a task whose first body heading is a non-canonical section
  When applyStructuralRepairs runs
  Then the content is returned byte-identical with changed false
  And the L2.disallowed-section finding is still reported

Scenario: AC6 (R2) task 0787 is repaired through the CLI
  When "spur task check 0787 --fix" runs
  Then "spur task check 0787 --strict-core --json" reports no L2.disallowed-section finding
  And the eight former section titles survive as "####" headings inside Review

Scenario: AC7 (R3) an undocumented CLI flag fails the parity check
  Given a subcommand declares a flag with no row in its docs/help/cmd_<noun>.md
  When the flag-set parity check runs
  Then it exits non-zero naming the file, the subcommand, and the flag
  And a documented flag the CLI does not declare fails the same way

Scenario: AC8 (R3) the parity check is green on the repaired tree
  Given the 16 undocumented per-command flags have rows and --json-envelope and --help are allow-listed
  When the flag-set parity check runs
  Then it exits zero

Scenario: AC9 (R4) an unknown status is a validation error at every transport
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

#### Q&A entry — 2026-09-07T18:09:06.091Z

**Q: Does R2's repair contradict task 0619's "deliberately no section-delete verb"?**
No. 0619 refused *deletion* because the engine must never destroy content it cannot re-author
(`packages/app/src/services/structural-repair.ts:8-9`). A demote-and-merge destroys nothing: the
heading survives one level down and every line of the body is preserved under the canonical
section that already precedes it. It is the exact inverse of the corruption — a body's `###`
became a section, so the section becomes a body's `####` again — and it reuses the same pure
string-transform contract (`changed === false` when there is nothing to repair).

**Q: Why does 0787 need a repair verb at all — can't the Review section just be rewritten?**
No. `spur task update 0787 --section Review --from-file <f>` replaces the *body* of `Review`,
which ends at the next same-level heading — `### Findings`. The 8 phantom sections sit after it
and survive the write untouched. Nothing else in the CLI can remove or fold a section, and
hand-editing a corpus file is forbidden, so without R2's repair kind task 0787 is unrepairable.

### Design

Four independent slices, one seam each. Nothing here adds a module, a config key, an interface or
an abstraction: every change lands inside a function that already exists.

#### R1 — severity depends on whether `--as` names a *target*

`packages/app/src/services/task-check.ts` already holds both facts it needs, four lines apart:
`status` (on-disk, `:536`) and `effectiveStatus = options?.asStatus ?? status` (`:541`). Derive
one boolean beside them and thread it into `runL3`:

```ts
// A lifecycle guard evaluating the row the task is about to enter, not the row it is in.
const isTransitionTarget = options?.asStatus !== undefined && options.asStatus !== status;
```

`runL3` (`:631`) gains it as a parameter, and the terminal-status block (`:891`) uses it for one
finding only:

```ts
severity: isTransitionTarget ? 'error' : 'warning',
```

Invariants:

- `severityOverrides` still applies last in `summarizeWithStatus`, so an operator can pin the
  rule back to `warning` per folder without a code change.
- `strict` is untouched — no blanket warning elevation (the 0147 bug).
- `L3.review-testing-contradiction`, in the same block, is already `error`; it does not move.

Blast radius is exactly the callers that pass a *differing* `asStatus`:
`config/workflows/task-lifecycle.yaml:86` (`--as testing`) and `:93` (`--as done`), plus the
adapter-unavailable fallback `runDoneGateCheck` (`apps/cli/src/commands/task.ts:1720`). `testing`
and `todo` are both non-terminal, so the wip→testing edge and the create-time readiness check
(`apps/cli/src/commands/task.ts:252`, `asStatus: 'todo'`) never reach the rule. The behaviour
change is confined to the testing→done edge.

#### R2 — a fifth repair kind: demote-and-merge

`packages/app/src/services/structural-repair.ts` is a pure `string → string` transform over the
body's heading list (`HeadingLine`, `:52-60`) with a per-domain heading level
(`LEVEL = { task: 3, feature: 2 }`, `:34`). Add `'disallowed-section'` to the `StructuralRepair`
union (`:22`) and one pass:

1. Walk the domain-level headings in order, tracking the last canonical one seen.
2. For a heading whose name is outside `canonicalOrder(domain) ∪ UNIVERSAL_SECTIONS`:
   - no canonical heading seen yet → leave it, emit no repair (the check still reports it);
   - otherwise rewrite its `###` to `####` in place and record
     `{ kind: 'disallowed-section', section: name, detail: 'folded into <owner>' }`.
3. Body text is never moved — demoting the heading is what makes the following lines part of the
   preceding section on the next parse. That is why the transform is lossless and why it is not a
   delete.

Run it before the existing order/level passes so a folded section is no longer a section when
order is computed.

#### R3 — flag-set parity as a test, not a new script

The mechanical claim is set equality, measured this session at 236 documented rows / 72
undocumented CLI flags / 0 phantom rows. Implement it as a test in `apps/cli/tests/` (it needs the
commander tree, which lives there) rather than extending
`plugins/sp/scripts/validate-flag-contracts.ts`, whose five surfaces are sp *plugin* command files
— a different vocabulary that happens to share the word "flag".

- Source of truth: walk the commander program, `cmd.name()` path → `cmd.options[].long`.
- Documented set: rows matching ``| `--flag …` | … |`` under each `## spur <path>` heading in
  `docs/help/cmd_<noun>.md`.
- Allow-list: `--json-envelope` and `--help` only, with a one-line note in the `docs/help`
  overview. 56 of the 72 gaps are `--json-envelope`; 56 identical rows would bury the 16 real ones.
- Assert both directions and name file + subcommand + flag in the failure message.

Descriptions are explicitly out of scope: 89 of 236 rows differ, almost all editorially.

#### R4 — one typed throw replaces one transport patch

`packages/app` already depends on `@gobing-ai/ts-utils`. In
`packages/app/src/services/task-service.ts:1681-1682`, wrap the two normalizations so the service
speaks the error vocabulary the transport already maps:

```ts
const canonical = (raw: string): TaskStatus => {
    try {
        return normalizeTaskStatus(raw);
    } catch (err) {
        // Plain Error from the domain reads as INTERNAL_ERROR/500 at the HTTP boundary
        // (error-handler.ts:166). A caller-supplied filter is a validation failure.
        throw new ValidationError(err instanceof Error ? err.message : String(err));
    }
};
```

`ValidationError` carries `code: 'VALIDATION'`, which `isAppErrorLike` maps to **422
VALIDATION_FAILED** (`apps/server/src/middleware/error-handler.ts:158-164`, table `:107`). Then
delete `apps/server/src/modules/task/handlers.ts:18-24` — the whole `try`/`catch` and the
`normalizeTaskStatus`/`HTTPException` imports it needed — leaving `toFilters` a plain mapper
again. Update the one assertion at `apps/server/tests/modules/task/handlers.test.ts:116` from 400
to 422 and add a service-level test that `list({ status: 'bogus' })` throws `ValidationError`.

The domain function keeps throwing a plain `Error`: `packages/domain` has no `ts-utils`
dependency, and the same function is called on values read from disk, where a throw means a
corrupt file rather than a bad request.

### Plan

Four slices, independent — each is committable on its own. R2 is the only one that also repairs a
corpus file (0787), so it runs after its code lands.

#### R1 — transition-target severity

- [ ] 1. Add `isTransitionTarget` beside `effectiveStatus` in `check()` (`packages/app/src/services/task-check.ts:541`) and thread it through `runL3` (`:631`) into the terminal-status block (`:891`); `severity: isTransitionTarget ? 'error' : 'warning'` on `L3.unchecked-checklist` only.
- [ ] 2. Test in `packages/app/tests/services/task-check.test.ts`: a `testing` task with one open box → `--as done` yields severity `error` and `pass: false`; the same task checked without `--as` yields `warning` and `pass: true`; a `done` task with an open box still yields `warning` (0182's deferral survives).
- [ ] 3. Test that `--as testing` on the same task is unaffected (non-terminal target, no finding).

#### R2 — `disallowed-section` repair kind

- [ ] 4. Add `'disallowed-section'` to the `StructuralRepair` union (`packages/app/src/services/structural-repair.ts:22`) and a demote pass that runs before the order/level passes: for each domain-level heading outside `canonicalOrder(domain) ∪ UNIVERSAL_SECTIONS` that follows a canonical heading, rewrite its marker one level deeper and record the repair; leave a phantom with no canonical predecessor untouched.
- [ ] 5. Test in `packages/app/tests/services/structural-repair.test.ts`: a task body with `### Findings` after `### Review` folds to `#### Findings` with the body text byte-identical; a phantom before any canonical section is reported, not moved; two consecutive phantoms both fold.
- [ ] 6. Run `spur task check 0787 --fix --json` and confirm the 8 phantoms clear with no content loss (`git diff` shows heading markers only).

#### R3 — flag-set parity

- [ ] 7. Add `apps/cli/tests/help-doc-parity.test.ts`: walk the commander tree for `<path> → long flags`, parse ``| `--flag …` |`` rows under each `## spur <path>` heading in `docs/help/cmd_*.md`, assert set equality both ways with `--json-envelope` and `--help` allow-listed; failure names file, subcommand and flag.
- [ ] 8. Run it, document the ~16 real gaps it reports as new rows in the owning `docs/help/cmd_<noun>.md` files, and note the two allow-listed global flags once in the `docs/help` overview.
- [ ] 9. Re-run until green from inside `apps/cli`.

#### R4 — typed validation error

- [ ] 10. Wrap both `normalizeTaskStatus` calls in `TaskService.list()` (`packages/app/src/services/task-service.ts:1681-1682`) so an unknown value throws `ValidationError` from `@gobing-ai/ts-utils`.
- [ ] 11. Delete the `try`/`catch` and the now-unused `normalizeTaskStatus` / `HTTPException` imports from `apps/server/src/modules/task/handlers.ts:3,5,18-24`, leaving `toFilters` a plain mapper.
- [ ] 12. Move `apps/server/tests/modules/task/handlers.test.ts:116` from 400 to 422 and assert `VALIDATION_FAILED`; add a `packages/app` test that `list({ status: 'bogus' })` rejects with `ValidationError` and that `list({ status: 'BACKLOG' })` and an alias still resolve.

#### Close

- [ ] 13. `bun run spur-check`, `bun run lint`, `bun run test`, `bun run build`.
- [ ] 14. `spur task check 0800 --strict-core --json` clean; verify PASS; four atomic commits (one per requirement).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Verified this session (2026-09-07), against the working tree at commit `bf11979da`.

**R1 — the open box is observed at the edge**

- `config/workflows/task-lifecycle.yaml:86,93` — the gate commands: `spur task check $wbs --as testing` and `--as done`.
- `packages/app/src/services/task-check.ts:541` — `const effectiveStatus = options?.asStatus ?? status;`, passed to `runL3` at `:552`.
- `packages/app/src/services/task-check.ts:891-902` — the terminal-status block that raises `L3.unchecked-checklist` at `severity: 'warning'`.
- `packages/app/src/services/planning-check-base.ts:375` — `pass: !hasError`; why a warning never blocks.
- `apps/cli/src/commands/task.ts:1702-1723` — `runDoneGateCheck`, the adapter-unavailable fallback; already passes `asStatus: targetStatus`.
- `packages/app/src/services/task-record.ts:194-224` + `packages/domain/src/bdd/checklist.ts:29-73` — record flips only `Requirements`/`Acceptance Criteria`, and the anchored id regex means a Plan step never carries a requirement id, so record structurally cannot own a Plan box.
- Commit `4e12bd478` — 0788 verified PASS with item 6 deliberately open ("unrunnable rule-preset gate (SQLite lock)"): the counter-example that rules out flipping boxes from a verdict.
- Task 0182 R7-optional — open boxes on an already-terminal task are warning-only by design; preserved.

**R2 — guard exists, repair does not**

- `packages/app/src/services/planning-write-service.ts:393,406,507,523` — `phantomSections` / `assertNoNewPhantomSections`; shipped `692e091f9` (task 0115).
- `packages/app/src/services/structural-repair.ts:8-9` — "there is deliberately no section-delete verb" (task 0619); `:22` — the four existing repair kinds; `:34` — per-domain heading level.
- `docs/tasks4/0787_*.md:204-283` — the 8 `###` sub-headings inside `## Review`, introduced by the pipeline's own commit `272451a8d`.

**R3 — measured drift**

- `docs/help/cmd_*.md` vs the live commander tree: 236 / 72 / 0 / 89 (documented rows / undocumented flags / phantom rows / description mismatches); 56 of the 72 are `--json-envelope`.
- `plugins/sp/scripts/validate-flag-contracts.ts:1-24` — the five covered surfaces are sp *plugin* command files, a different vocabulary; `docs/help/` is deliberately not one of them.

**R4 — untyped throw at the service**

- `packages/domain/src/planning/schema.ts:180-187` — `normalizeTaskStatus`, alias- and case-tolerant, throws a plain `Error`.
- `packages/app/src/services/task-service.ts:1681-1682` — the two call sites in `list()`.
- `apps/server/src/middleware/error-handler.ts:107` (mapping table), `:158-164` (`code === 'VALIDATION'` → 422 `VALIDATION_FAILED`), `:166-172` (unknown `Error` → 500).
- `apps/server/src/modules/task/handlers.ts:18-24` — the transport-local 400 patch from 0795, to be deleted; `apps/server/tests/modules/task/handlers.test.ts:105-117` — its assertion, 400 → 422.
- `packages/contracts/src/task.ts:29-33` — `status: z.string().optional()`; stays free-form.

Related: task 0795 (the register these findings came out of), task 0692 R2 (record's
Requirements/AC auto-flip), task 0115 (the write-boundary guard), task 0619 (the no-delete rule),
task 0182 (terminal-status open boxes), feature F21 (the earlier verifyall whose tasks 0787/0788
carry the same residue).

### History
- 2026-09-07T18:30:37.550Z backlog → todo (system)
