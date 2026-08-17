---
template: standard
schema_version: 1
name: "Authoring-time task size warning on spur task create / update --section (ADR-051 consent pending)"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T23:28:49.554Z"
updated_at: "2026-08-16T23:56:33.918Z"
---

## 0575. Authoring-time task size warning on spur task create / update --section (ADR-051 consent pending)

### Background
Split out of task 0568 (2026-08-16) so that task could clear its own size gate: 0568 carried 6 R-items against `maxReqs: 5` (`bun plugins/sp/scripts/task-size-precheck.ts --wbs 0568` → `FAIL — 6 R-items, 6 Plan items`). Parking this requirement drops 0568 to 5 and clears the gate — the remaining five requirements are all doc/skill/parser work with no consent gate.

**Held pending operator consent.** This is a change to the **public** `spur` CLI surface (`spur task create`, `spur task update --section`), which per **ADR-051** requires explicit operator consent with design context before it is built, plus `docs/04_DESIGN.md` updated in the same commit (T3). Operator decision 2026-08-16: **parked** — not approved, not rejected. Do not implement without revisiting that call.

The underlying gap is real: the size gate today fires first at *pipeline precheck*, which is after a task has already been authored, refined, and queued. An authoring-time warning surfaces the same signal at the moment the oversize is created, when it is cheap to fix. 0568 itself is the worked example — it was authored at 6 R-items and nothing said so until it was picked up for execution.
### Requirements
- [ ] R1. Emit a non-blocking size warning at authoring time from `TaskService.updateSection` (`packages/app/src/services/task-service.ts`) when the section written is `Requirements` or `Plan`: after the write succeeds, re-read the resulting task body, call `evaluateTaskSize(content)` (no `executor` argument), and when `report.ok === false` append `report.reasons` to the returned result's `warnings[]`. Acceptance: writing a Requirements section with 6 R-items prints `Task has 6 R-items (max 5). …` on stderr in human mode and carries the same string in `warnings[]` under `--json`; a conforming write (≤5 R-items, ≤8 Plan items) emits nothing; the write always succeeds and the exit code is unchanged. Out of scope: `spur task create` (unreachable — the standard template ships zero R-items), blocking behavior, new flags/nouns, duplicated thresholds, and the executor-tier branch — each stated as a frozen anti-pattern in Design.
- [ ] R2. Update `docs/04_DESIGN.md` in the same commit (T3) to document the new authoring-time warning on `spur task update --section Requirements|Plan` — the trigger sections, the `DEFAULT_TASK_SIZE_LIMITS` owner, and the non-blocking contract. Acceptance: the `spur task update` surface entry names the warning and its threshold source; `bun run lint` and `spur task check 0575` stay green.
### Acceptance Criteria
```gherkin
Scenario: R1 — An oversized Requirements write warns without blocking
  Given a task whose Requirements section is being written with 6 R-items
  When `spur task update <wbs> --section Requirements --from-file <path>` runs
  Then the mutation succeeds and the exit code is 0
  And stderr carries "Task has 6 R-items (max 5)"

Scenario: R1 — The same warning is machine-readable under --json
  Given the same 6-R-item write
  When the command runs with --json
  Then the emitted payload's warnings[] contains the identical "Task has 6 R-items (max 5)" string
  And stdout remains valid JSON

Scenario: R1 — A conforming write stays silent
  Given a task written with 5 R-items and 8 Plan items
  When the Requirements or Plan section is updated
  Then no size warning is emitted in either output mode

Scenario: R1 — A Plan write counts R-items from the whole task body
  Given a task that already has 6 R-items in Requirements
  When only its Plan section is updated
  Then the R-item warning still fires
  And the count reflects the post-write task body, not the Plan body alone

Scenario: R1 — Non-trigger sections are untouched
  Given a Background, Design, or Solution section write
  When the section is updated
  Then no size evaluation runs and no size warning is emitted

Scenario: R2 — The surface change is documented in the same commit
  Given the warning has been implemented
  When the commit is inspected
  Then docs/04_DESIGN.md documents the trigger, the DEFAULT_TASK_SIZE_LIMITS owner, and the non-blocking contract (T3)
  And a recorded ADR-051 operator consent precedes the change
```
### Q&A
Q3, Q4 and Q8 moved verbatim from task 0568's Q&A at the 2026-08-16 split — all three are specific to this requirement. Q11–Q13 were added by the 2026-08-16 `--depth ready` refine.

**Q3: Where should the plan-time size check live?** Reuse the caps already centralized in
`packages/app/src/services/task-size-precheck.ts` (`maxReqs: 5`, `maxPlanItems: 8`) rather than
duplicating them. The `task-size-precheck.ts` script and the app service must stay in parity — there
is already a test pinning them (`plugins/sp/tests/task-size-precheck.test.ts:76`, "plugin large-task
thresholds stay aligned").

**Q4: Hook vs guidance?** A hook (e.g. task-file-policy) could block Plan writes over the cap, but
that is heavier than needed and risks false positives during legitimate multi-edit workflows. A
visible authoring-time warning is the right calibration — the pipeline precheck remains the hard
gate; this requirement just moves the discovery earlier so the operator does not burn a run +
round-trip.

**Q8: New CLI flag or warning on existing verbs?** Warning on existing verbs — no new flag, no new
noun (ADR-051 noun discipline). Caps and counting logic are reused from the app service, never
duplicated in the CLI layer (ADR-021).

**Q10 (2026-08-16): Why is this its own task?** Split from 0568, which carried 6 R-items against
`maxReqs: 5` and therefore failed its own size gate. This was the only requirement in that set behind
a consent gate, so parking it both cleared 0568 to exactly 5 R-items and isolated the decision the
operator still owns. 0568 is now `todo` and gate-clean.

**Q11 (refine 2026-08-16): Why was `spur task create` dropped as a trigger?** Because the warning is
unreachable there. Verified against the current tree: `config/templates/task/standard.md` ships an
empty Requirements section whose body is the comment "Keep empty until requirements are known", so a
freshly created task has 0 R-items and 0 Plan items — `evaluateTaskSize` can never report `!ok` at
create time. The original requirement (inherited from 0568 R1) named both verbs; wiring `create`
would have been dead code that a downstream implementer either writes uselessly or stops to question.
Corrected here rather than deferred, per the `--depth ready` premise-verification rule.

**Q12 (refine 2026-08-16): Why the `warnings[]` channel instead of a direct stderr write?** The
original design said "thin wiring in `apps/cli/src/commands/task.ts`". Reading the current code
changed the answer: `updateSection` already returns `warnings?: string[]` (`task-service.ts:191`) and
`checkAcSubsetWarning` (`:1138-1145`) is an existing section-scoped check that folds findings into it.
The CLI already renders that channel in both modes — stderr in human mode (`task.ts:315-317`), inside
the payload under `--json` (`:313`). Riding it means **no `apps/cli` change at all**, automatic
`--json` correctness, and composition with other warnings. A direct stderr write from the CLI would
have forked the channel and silently skipped `--json` consumers.

**Q13 (refine 2026-08-16): Does the smaller diff weaken the ADR-051 consent requirement?** No. The
code lands entirely in `packages/app`, but the gate is about the **public CLI surface**, and the
observable output of an existing verb changes — a new stderr line and a new `warnings[]` entry that
scripts may parse. Consent per ADR-051 (`docs/00_ADR.md:436`) plus `docs/04_DESIGN.md` in the same
commit (T3) still apply. Recorded explicitly so the small diff is not later mistaken for an exemption.

**Deferred with owner — `feature_id`.** `spur task check 0575` reports the `L4.missing-feature-id`
advisory. Deliberately left unset, matching parent task 0568 (also featureless): both are harness
self-improvement fixes with no feature in the current tree that covers authoring-surface ergonomics.
Owner: operator, at the same time as the ADR-051 consent decision — if this is approved and a home
feature exists by then, link it with `spur task update 0575 --feature <id>`. DD-09 does not apply
while `feature_id` is unset.

**Accepted advisory — gate language.** `spur task check` flags `L4.gate-language` in Background,
Design, and Acceptance Criteria. The advisory suggests modelling a gate as a frontmatter dependency;
that does not apply here, because the gate is a **human consent decision**, not an upstream task. The
language is intentional and must stay visible — it is the whole reason the task is parked. Verified
rather than deferred, per the advisory's own second option.
### Design
**WHAT.** Surface the existing task-size evaluation at *authoring* time — when a Requirements or Plan section is written — instead of first at pipeline precheck, by appending the already-computed size reasons to the mutation result's existing `warnings[]` channel.

**WHY.** The size gate today fires at `precheck`, after a task has been authored, refined, and queued. By then the oversize costs a failed pipeline run plus an operator round-trip. Task 0568 is the worked example: authored at 6 R-items, and nothing said so until it was picked up for execution weeks later. Moving the signal to the moment the oversize is created makes it cheap to fix.

**WHERE — frozen file targets.**

| File | Change |
| --- | --- |
| `packages/app/src/services/task-service.ts` | in `updateSection`, after `writeService.updateSection` returns: when `sectionName` is `Requirements` or `Plan`, re-read the task body, `evaluateTaskSize(content)`, append `report.reasons` to `warnings[]` when `!report.ok` |
| `packages/app/tests/services/task-service*.test.ts` | unit coverage: 6-R-item write warns; 5-R-item write silent; write still succeeds |
| `docs/04_DESIGN.md` | T3 same-commit surface note (R2) |

**Frozen names / shapes — no new API.**

- Reuse `evaluateTaskSize(content: string): TaskSizeReport` from `packages/app/src/services/task-size-precheck.ts:112`. Call it with **one argument** — omit `limits` (defaults to `DEFAULT_TASK_SIZE_LIMITS`, `:33`) and omit `executor` so the tier branch (`:121-131`) stays dormant.
- `TaskSizeReport` (`:21`) = `{ reqCount, planItemCount, ok, reasons }`. **Emit `report.reasons` verbatim** — it already contains the exact strings (`Task has N R-items (max 5). Consider decomposing…`, `:132-144`). Do not compose new message text; identical wording at authoring time and pipeline time is the point.
- Emission channel is the existing `warnings?: string[]` on the mutation result (`task-service.ts:191`). **No CLI change is required**: `apps/cli/src/commands/task.ts:315-317` already loops `result.warnings` to `context.output.error` (stderr) in human mode, and `:313` already serialises the whole result — warnings included — under `--json`.

**Precedent to mirror exactly.** `checkAcSubsetWarning` (`task-service.ts:1138-1145`) is the same shape: a section-scoped check that runs after the write and folds its findings into `warnings[]` via `{...result, warnings: [...(result.warnings ?? []), ...extra]}`. Follow that spread pattern so multiple warning sources compose instead of overwriting.

**Algorithm / precedence.**

1. Write the section first — the warning is advisory and must never gate the mutation.
2. Count against the **whole post-write task body**, not the section body just written. R-items live in Requirements and checklist items in Plan; a Plan write must still see the file's R-item count, so evaluating the section body alone would under-count.
3. `ok === true` → return the result untouched (no empty-array churn).

**Anti-patterns — do NOT:**

- Do NOT write to stderr directly from `apps/cli` — that bypasses `--json` and forks the warning channel.
- Do NOT duplicate `5` / `8` anywhere; `DEFAULT_TASK_SIZE_LIMITS` is the sole owner and `plugins/sp/tests/task-size-precheck.test.ts:76` pins plugin↔app parity.
- Do NOT pass an `executor` to `evaluateTaskSize` — that turns on the size-vs-capability gate, which needs a resolved executor and belongs to the pipeline.
- Do NOT add a flag, verb, or noun, and do NOT make the warning blocking or exit-code-bearing — the write always succeeds and the exit code is unchanged.
- Do NOT wire `spur task create`. Verified 2026-08-16: `config/templates/task/standard.md` ships an empty Requirements section ("Keep empty until requirements are known"), so a freshly created task has 0 R-items and 0 Plan items and the warning can never fire. Wiring it is dead code.
- Do NOT evaluate on any other section — only `Requirements` and `Plan` trigger it. Background, Design, Solution, Testing and Review writes must stay evaluation-free.

**Consent status — the gate on this task.** Parked by operator decision 2026-08-16: neither approved nor rejected. Implementation must not begin until that call is revisited and recorded. Note the precision: because the emission rides an existing channel, the *code* change is confined to `packages/app` and touches no `apps/cli` file — but the **observable CLI output changes** (a new stderr line on an existing verb), which is what ADR-051 (`docs/00_ADR.md:436`) gates. Consent is still required; the diff being small does not exempt it.

**Handoff.** No `dependencies[]` and no dependents. Split from task 0568 on 2026-08-16 (0568 kept R2–R6 and is unblocked); nothing in 0568 waits on this.
### Plan
- [ ] Confirm ADR-051 consent is recorded before writing code — this task is parked; a recorded operator decision is the entry condition, not a formality (R1, R2)
- [ ] Add the size evaluation to `TaskService.updateSection` mirroring `checkAcSubsetWarning` (`task-service.ts:1138-1145`): gate on `sectionName === 'Requirements' || sectionName === 'Plan'`, re-read the post-write body, `evaluateTaskSize(content)`, spread `report.reasons` into `warnings[]` when `!report.ok` (R1)
- [ ] Unit tests in `packages/app/tests/services/`: a 6-R-item Requirements write returns the `Task has 6 R-items (max 5)` reason in `warnings[]`; a 5-R-item write returns no size warning; a 9-item Plan write warns on plan items; every case still returns a successful mutation result (R1)
- [ ] Verify both output modes against a scratch task: human mode prints the reason on **stderr** via the existing `task.ts:315-317` loop, `--json` carries the identical string inside `warnings[]`, and the exit code is `0` in both (R1)
- [ ] Document the surface in `docs/04_DESIGN.md` under `spur task update` — trigger sections, the `DEFAULT_TASK_SIZE_LIMITS` owner, and the non-blocking contract — in the same commit as the code (T3) (R2)
- [ ] Gates: `bun test packages/app/tests/services --test-name-pattern 'size|warning'` targeted first, then `bun run lint`, `bun test plugins/sp/tests/task-size-precheck.test.ts` (parity at `:76` must stay green), and `spur task check 0575` (R1, R2)
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **ADR-051** — `docs/00_ADR.md:436` "Public CLI Surface vs Internal spur-dev Tooling — Ownership and Consent Gate". The consent gate this task is parked behind.
- **Parent task 0568** — `docs/tasks4/0568_fix-0567-run-process-bottlenecks-plan-time-size-gate-verdict.md`. This task was its R1 until the 2026-08-16 split; 0568 kept R2–R6.
- **Size service (reuse target)** — `packages/app/src/services/task-size-precheck.ts`: `evaluateTaskSize` `:112`, `TaskSizeReport` `:21`, `DEFAULT_TASK_SIZE_LIMITS` `:33`, `countRItems` `:81`, `countPlanItems` `:91`, reason strings `:132-144`.
- **Emission precedent** — `packages/app/src/services/task-service.ts`: `warnings?: string[]` `:191`, `checkAcSubsetWarning` fold `:1138-1145`.
- **CLI render points (no change needed)** — `apps/cli/src/commands/task.ts`: `--json` serialise `:313`, human-mode warning loop `:315-317`.
- **Parity gate to keep green** — `plugins/sp/tests/task-size-precheck.test.ts:76` ("plugin large-task thresholds stay aligned with the application defaults").
- **Hard gate that stays authoritative** — `plugins/sp/scripts/task-size-precheck.ts` (pipeline precheck; task 0454 R2, task 0487 R3).
- **ADR-021** — apps are thin transports; logic lives in `packages/app`. The reason the evaluation belongs in the service, not the command file.
### History
