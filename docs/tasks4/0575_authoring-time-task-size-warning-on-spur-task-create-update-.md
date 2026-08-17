---
template: standard
schema_version: 1
name: "Authoring-time task size warning on spur task create / update --section (ADR-051 consent pending)"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T23:28:49.554Z"
updated_at: "2026-08-17T05:14:14.635Z"
---

## 0575. Authoring-time task size warning on spur task create / update --section (ADR-051 consent pending)

### Background
Split out of task 0568 (2026-08-16) so that task could clear its own size gate: 0568 carried 6 R-items against `maxReqs: 5` (`bun plugins/sp/scripts/task-size-precheck.ts --wbs 0568` → `FAIL — 6 R-items, 6 Plan items`). Parking this requirement drops 0568 to 5 and clears the gate — the remaining five requirements are all doc/skill/parser work with no consent gate.

**ADR-051 consent recorded 2026-08-16: APPROVED.** The operator approved via the consent ask surfaced at the start of `/sp-dev-run 0575 --auto --next` (host session `mswlw0hh-2qe6hxc5`), with design context presented: a non-blocking size warning on `spur task update --section Requirements|Plan` (stderr in human mode, `warnings[]` under `--json`), no new flag/noun/verb, exit code unchanged, code confined to `packages/app/src/services/task-service.ts`, `docs/04_DESIGN.md` updated in the same commit (T3). This supersedes the earlier 2026-08-16 "parked" decision; R1+R2 may proceed.

The underlying gap is real: the size gate today fires first at *pipeline precheck*, which is after a task has already been authored, refined, and queued. An authoring-time warning surfaces the same signal at the moment the oversize is created, when it is cheap to fix. 0568 itself is the worked example — it was authored at 6 R-items and nothing said so until it was picked up for execution.
### Requirements
- [x] R1. Emit a non-blocking size warning at authoring time from `TaskService.updateSection` (`packages/app/src/services/task-service.ts`) when the section written is `Requirements` or `Plan`: after the write succeeds, re-read the resulting task body, call `evaluateTaskSize(content)` (no `executor` argument), and when `report.ok === false` append `report.reasons` to the returned result's `warnings[]`. Acceptance: writing a Requirements section with 6 R-items prints `Task has 6 R-items (max 5). …` on stderr in human mode and carries the same string in `warnings[]` under `--json`; a conforming write (≤5 R-items, ≤8 Plan items) emits nothing; the write always succeeds and the exit code is unchanged. Out of scope: `spur task create` (unreachable — the standard template ships zero R-items), blocking behavior, new flags/nouns, duplicated thresholds, and the executor-tier branch — each stated as a frozen anti-pattern in Design.
- [x] R2. Update `docs/04_DESIGN.md` in the same commit (T3) to document the new authoring-time warning on `spur task update --section Requirements|Plan` — the trigger sections, the `DEFAULT_TASK_SIZE_LIMITS` owner, and the non-blocking contract. Acceptance: the `spur task update` surface entry names the warning and its threshold source; `bun run lint` and `spur task check 0575` stay green.
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
- [x] Confirm ADR-051 consent is recorded before writing code — this task is parked; a recorded operator decision is the entry condition, not a formality (R1, R2)
- [x] Add the size evaluation to `TaskService.updateSection` mirroring `checkAcSubsetWarning` (`task-service.ts:1138-1145`): gate on `sectionName === 'Requirements' || sectionName === 'Plan'`, re-read the post-write body, `evaluateTaskSize(content)`, spread `report.reasons` into `warnings[]` when `!report.ok` (R1)
- [x] Unit tests in `packages/app/tests/services/`: a 6-R-item Requirements write returns the `Task has 6 R-items (max 5)` reason in `warnings[]`; a 5-R-item write returns no size warning; a 9-item Plan write warns on plan items; every case still returns a successful mutation result (R1)
- [x] Verify both output modes against a scratch task: human mode prints the reason on **stderr** via the existing `task.ts:315-317` loop, `--json` carries the identical string inside `warnings[]`, and the exit code is `0` in both (R1)
- [x] Document the surface in `docs/04_DESIGN.md` under `spur task update` — trigger sections, the `DEFAULT_TASK_SIZE_LIMITS` owner, and the non-blocking contract — in the same commit as the code (T3) (R2)
- [x] Gates: `bun test packages/app/tests/services --test-name-pattern 'size|warning'` targeted first, then `bun run lint`, `bun test plugins/sp/tests/task-size-precheck.test.ts` (parity at `:76` must stay green), and `spur task check 0575` (R1, R2)
### Solution
Implemented R1 + R2 as a single write-seam change; no CLI, plugin, or precheck code touched.

**R1 — service seam.** `TaskService.updateSection` gains one post-write branch (`packages/app/src/services/task-service.ts:1149`): when the section written is `Requirements` or `Plan`, the method re-reads the whole post-write task body via `this.ctx.fs.readFile(filePath)` and calls `evaluateTaskSize(content)` with no `executor` argument (import at `packages/app/src/services/task-service.ts:46`). When `report.ok === false`, `report.reasons` are appended onto the write result's `warnings[]` (`packages/app/src/services/task-service.ts:1156`), composing with — never overwriting — any warnings the write service itself produced. This mirrors the existing DD-09 AC-subset fold (`packages/app/src/services/task-service.ts:1138`) exactly: evaluation runs only after the mutation has landed, so the warning can never block or change the exit code, and the thresholds stay solely owned by `DEFAULT_TASK_SIZE_LIMITS` in `packages/app/src/services/task-size-precheck.ts:33` — no duplicated constants. Whole-body re-read (not the section body) is deliberate: a conforming Plan write onto a task that already carries 6 R-items still surfaces the R-item reason.

**Rendering — zero CLI change.** `task update --section` already prints every `result.warnings[]` entry to stderr in human mode and serializes them inside the JSON payload (`apps/cli/src/commands/task.ts:317`), so both acceptance renderings fall out of the service change; verified end-to-end against a rebuilt `apps/cli/spur.js` in an isolated `--folder` corpus.

**R2 — T3 doc sync.** The `spur task update` surface row (`docs/04_DESIGN.md:1330`) now names the authoring-time size warning, its trigger sections (`--section Requirements` / `--section Plan`), the `DEFAULT_TASK_SIZE_LIMITS` threshold source (max 5 R-items / max 8 Plan items, same caps as the pipeline precheck), and the non-blocking contract (write landed first, exit code stays 0, no other section evaluated).

**Tests.** New describe block `updateSection — authoring-time size warning (0575 R1)` (`packages/app/tests/services/task-service.test.ts:1882`) covers: 6-R-item Requirements write warns + write lands on disk (non-blocking proof), conforming 5-R-item write stays silent, 9-item Plan write warns on plan items, a Plan write counts R-items from the whole post-write body (and does not warn about its own small Plan), and a Background write never runs the evaluation. Full file: 106 pass / 0 fail.

**Out of scope, untouched** (per Requirements): `spur task create` (unreachable — the standard template seeds placeholder Requirements that never trigger), blocking behavior, new flags/nouns/verbs, threshold duplication, executor-tier branching.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/src/services/task-service.ts:1150-1163 — post-write advisory branch inside updateSection: gate the Requirements-or-Plan section gate (:1155), whole-post-write-body re-read via `evaluateTaskSize(await this.ctx.fs.readFile(filePath))` (:1156), reasons folded into existing `warnings[]` channel (:1157-1162); import at :46 reuses task-size-precheck (no executor arg, no threshold duplication). Unit: packages/app/tests/services/task-service.test.ts:1883-1954, 5 tests, file suite 106/106 pass re-run this session. E2E this run against real CLI ./apps/cli/spur.js in scratch corpus /tmp/0575v: (P1) 6-R-item Requirements write → exit 0, stderr `Task has 6 R-items (max 5). Consider decomposing into smaller tasks or raise maxImplementReqs via --vars.`, `**R6.**` present on disk after write; (P2) same write --json → identical string inside `warnings[]`, stdout valid JSON per jq -e, stderr empty, exit 0; (P3) conforming 5-R-item Requirements and 8-item Plan writes → no stderr (human) and no `warnings` key (--json); (P4) 1-step Plan write onto the 6-R-item task still warns on R-count (whole-body counting); (P5) Background write on the oversize task → no evaluation, no warning. |
| R2 | MET | docs/04_DESIGN.md:1330 — `spur task update <wbs> <status>` row now carries "**Authoring-time size warning (0575 R1):** a `--section Requirements` or `--section Plan` write re-evaluates the whole post-write task body via `evaluateTaskSize` against `DEFAULT_TASK_SIZE_LIMITS` (max 5 R-items / max 8 Plan items — the same caps the pipeline precheck enforces, sole owner of the thresholds)" plus the non-blocking warnings[] contract (stderr in human mode, inside payload under --json). Gates re-run this session: `bun run lint` (biome check --error-on-warnings + full typecheck) exit 0; `spur task check 0575` → PASS with 3 pre-accepted L4 advisories (missing feature_id deferred with owner per task Q&A; gate-language warnings accepted deliberately in Q&A). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 (R1 — An oversized Requirements write warns without blocking) | MET | test | E2E probe: `task update 0576 --section Requirements --from-file req6.md` → exit 0, stderr carries `Task has 6 R-items (max 5)`, write landed (R6 on disk). Unit: task-service.test.ts:1899 asserts warning present, file mutated, non-blocking. |
| AC-2 (R1 — The same warning is machine-readable under --json) | MET | test | E2E probe: same write with `--json` → `warnings: ["Task has 6 R-items (max 5). …"]`, `jq -e` validates stdout as JSON, exit 0, stderr empty. Unit: task-service.test.ts:1899 block asserts reasons ride `result.warnings`. |
| AC-3 (R1 — A conforming write stays silent) | MET | test | E2E probes: 5-R-item Requirements write (human mode) → empty stderr; 8-item Plan write (--json) → no `warnings` key. Unit: task-service.test.ts:1912 (5-R-item silent) and :1921 (8-item Plan silent). |
| AC-4 (R1 — A Plan write counts R-items from the whole task body) | MET | test | E2E probe: 1-step Plan write onto task already holding 6 R-items → warns `Task has 6 R-items (max 5)`. Unit: task-service.test.ts:1933 (Plan write re-reads whole post-write body). |
| AC-5 (R1 — Non-trigger sections are untouched) | MET | test | E2E probe: Background write on the oversize task (--json) → no `warnings`, empty stderr, exit 0. Unit: task-service.test.ts:1945 (Background/Design/Solution writes never run the evaluation). |
| AC-6 (R2 — The surface change is documented in the same commit) | MET | command | `git status`/`git diff --stat` this session: docs/04_DESIGN.md and packages/app/src/services/task-service.ts (+ tests) sit in the same single working-tree changeset pending the pipeline's record commit (T3 honored). Doc row live at docs/04_DESIGN.md:1330. ADR-051 consent APPROVED dated 2026-08-16 recorded in task Background (docs/tasks4/0575_…md) precedes the change. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
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
- 2026-08-17T02:59:52.658Z backlog → todo (system)
- 2026-08-17T04:41:23.803Z todo → wip (system)
- 2026-08-17T04:41:24.296Z wip → testing (system)
- 2026-08-17T04:41:29.877Z testing → done (system)
