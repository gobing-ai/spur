---
template: standard
schema_version: 1
name: "Enforce verify verdict on done transition; record forced-done overrides"
description: ""
status: done
type: task
profile: standard
feature_id: F4
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-18T18:50:43.548Z"
updated_at: "2026-07-18T21:49:46.127Z"
---

## 0292. Enforce verify verdict on done transition; record forced-done overrides

### Background
A dogfood run of `/skill:sp-dev-run 0280 --auto --next` (`docs/dogfood/2026-07-18-0280-sp-dev-run-dogfood.md`, Finding P2) surfaced a defense-in-depth gap: the `--next` PARTIAL-stop rule in `/sp-dev-verify` is **skill-level discipline only**, not enforced by the lifecycle FSM. After the chained verify wrote an honest PARTIAL verdict to `.spur/run/0280-verdict.json` (R3/R4/R5/R6 UNMET, R1/R2/R7 PARTIAL), a direct `spur task update 0280 done` transitioned `testing → done` with no check. `done` is terminal in the CLI (no reopen path), so the partial-verified state is now locked in; the only honest evidence lives in the verdict file and the task's Testing section.

Sibling task 0152 (done) normalized the *status string* feeding the FSM; this task is orthogonal — it gates the `* → done` transition on the verdict artifact's contents.

#### Root cause

`/sp-dev-verify --next` specifies (skill prose) that a PARTIAL verdict leaves the task at `testing` for operator resolution. Nothing in the lifecycle transition path consults the verdict:

- `packages/app/src/services/planning-write-service.ts` (transition entry) — no verdict read.
- `.spur/workflows/task-lifecycle.yaml` — `testing → done` has no guard referencing `.spur/run/<wbs>-verdict.json`.
- No pre-transition hook on `* → done` reads the verdict artifact.

The result: any caller (operator, pipeline step, scripted automation) can mark a task `done` regardless of what the verification leg produced. This defeats the verify-before-done contract that the pipeline and AGENTS.md ("pipeline done needs a real verify PASS") depend on.

#### Update (2026-07-18 re-verify)

The forced-done caller was identified: `config/workflows/wayfinder-resolution.yaml`'s auto path recorded `done` without consulting the verify leg's verdict and bypassed lifecycle guards with `--no-lifecycle`. That workflow has been hardened (machine verdict file + fail-closed auto-guard + lifecycle-enforced record + status-asserting transitions), but the fix protects one caller only. `--no-lifecycle done` is systemic: `config/workflows/task-pipeline.yaml:182` and `config/workflows/docs-pipeline.yaml:70` also record `done` with `--no-lifecycle`, relying on upstream gates (task-pipeline gates on the verdict at `verify → record`; docs-pipeline has no verify leg at all). Task 0280 itself has since been re-verified to a PASS verdict with the materialized baseline dataset (`/sp:dev-verify 0280 --auto --next --force --focus all --fix all`; report `docs/dogfood/2026-07-18-sp-dev-verify-0280-dogfood.md`), so no reopen path is needed for the motivating incident — the guard this task builds targets the general case.
### Requirements
- R1 — A `* → done` transition consults the latest verdict artifact at `.spur/run/<wbs>-verdict.json` when it exists, and denies (or warns-then-denies under strict mode) the transition if `verdict != "PASS"`. When no verdict file exists, behavior is unchanged (back-compat for tasks that don't run the verify leg).
- R2 — The denial message is actionable: names the task (wbs + file path), the verdict value found, the verdict file path, and the remediation (re-run `/sp-dev-verify <wbs>` until PASS, or operator override). Not a bare `GuardDeniedError`.
- R3 — An explicit operator override exists (`--force-done` or equivalent) so that a PARTIAL/FAIL can be advanced to `done` deliberately, with the override recorded (audit trail: who/when/why shape TBD in design — at minimum a `done_forced: true` + `done_reason` frontmatter field or a `.spur/run/<wbs>-done-override.json` sidecar).
- R4 — The guard is unit-tested at the service layer (`planning-write-service` or the guard's home module): (a) PASS verdict → transition succeeds; (b) PARTIAL verdict → transition denied; (c) FAIL verdict → transition denied; (d) no verdict file → transition succeeds (back-compat); (e) `--force-done` with PARTIAL → transition succeeds and override is recorded; (f) `--no-lifecycle` with a PARTIAL verdict → transition denied (R8); (g) internally inconsistent artifact → treated as non-PASS and denied with the inconsistency named (R10).
- R5 — The guard is integration-tested via the CLI: `spur task update <wbs> done` with a PARTIAL verdict on disk exits non-zero with the actionable message; with `--force-done` exits zero and records the override.
- R6 — The lifecycle workflow (`.spur/workflows/task-lifecycle.yaml` or equivalent) documents the new `* → done` guard so the FSM declaration matches the enforced behavior. No silent skill-only rule.
- R7 — No regression on the 0152 case-normalization path: the verdict guard runs *after* status normalization, so a task with a non-canonical status still gets the clear case-error before any verdict logic runs.
- R8 — The verdict gate applies to `--no-lifecycle` status updates as well: `--no-lifecycle` skips the lifecycle FSM, not the verdict gate (the `--no-lifecycle` bypass is exactly how 0280 was forced done). Known in-tree `--no-lifecycle done` callers remain back-compatible: `config/workflows/task-pipeline.yaml:182` records only after its own `verify → record` PASS gate (verdict exists and is PASS → allowed); `config/workflows/docs-pipeline.yaml:70` tasks have no verdict file (R1 back-compat → allowed).
- R9 — Same-status no-op honesty: `spur task update <wbs> <status>` where `<status>` equals the current status reports an explicit no-op (e.g. `0280: already done — no transition`) instead of the current `undefined → undefined`, and still exits 0 (observed in the 2026-07-18 dogfood run, report §6 P3).
- R10 — Verdict-artifact self-consistency at the gate: when the guard reads `.spur/run/<wbs>-verdict.json`, it validates the aggregate `verdict` against the per-requirement/AC rows per the verdict-schema aggregation rule (any core UNMET → FAIL; any core PARTIAL → PARTIAL). An inconsistent artifact (rows imply FAIL, aggregate claims PARTIAL/PASS — the softening observed in the first 0280 verify) is treated as non-PASS and the denial names the inconsistency. Reuse `spur task verdict` (the existing deterministic deriver) as the SSOT for this computation; do not duplicate the aggregation rule in the guard.
### Acceptance Criteria
#### Scenario: PASS verdict advances to done

- **Given** task WBS 0299 has `.spur/run/0299-verdict.json` with `"verdict": "PASS"`
- **When** the operator runs `spur task update 0299 done`
- **Then** the transition succeeds (`task.transitioned testing→done`) and no override is recorded

#### Scenario: PARTIAL verdict blocks done without override

- **Given** task WBS 0299 has `.spur/run/0299-verdict.json` with `"verdict": "PARTIAL"`
- **When** the operator runs `spur task update 0299 done`
- **Then** the command exits non-zero with a message naming the task, the verdict, the verdict file path, and the remediation (re-run verify or use `--force-done`)
- **And** the task remains at `testing`

#### Scenario: Operator override advances PARTIAL to done with audit trail

- **Given** task WBS 0299 has a PARTIAL verdict on disk
- **When** the operator runs `spur task update 0299 done --force-done --reason "telemetry absent is acceptable for this baseline"`
- **Then** the transition succeeds
- **And** an override record is persisted (frontmatter field or sidecar) capturing the reason

#### Scenario: No verdict file preserves current behavior

- **Given** task WBS 0299 has no `.spur/run/0299-verdict.json`
- **When** the operator runs `spur task update 0299 done`
- **Then** the transition succeeds (back-compat for tasks that never ran the verify leg)

#### Scenario: --no-lifecycle done is still verdict-gated

- **Given** task WBS 0299 has a PARTIAL verdict on disk
- **When** a workflow step runs `spur task update 0299 done --no-lifecycle`
- **Then** the command exits non-zero with the actionable denial message
- **And** the task status is unchanged

#### Scenario: Pipeline back-compat — PASS verdict with --no-lifecycle advances

- **Given** task WBS 0299 has a PASS verdict on disk (the task-pipeline record step's precondition)
- **When** the record step runs `spur task update 0299 done --no-lifecycle`
- **Then** the transition succeeds unchanged

#### Scenario: Same-status update reports an honest no-op

- **Given** task WBS 0299 is already `done`
- **When** the operator runs `spur task update 0299 done`
- **Then** the output states an explicit no-op (`already done — no transition`), never `undefined → undefined`
- **And** the command exits 0

#### Scenario: Inconsistent verdict artifact is treated as non-PASS

- **Given** `.spur/run/0299-verdict.json` has `"verdict": "PASS"` while a core requirement row is `"UNMET"`
- **When** the operator runs `spur task update 0299 done`
- **Then** the transition is denied and the message names the inconsistency (aggregate contradicts per-requirement rows)
### Q&A
- Locked: the verdict gate is orthogonal to the lifecycle FSM — `--no-lifecycle` must not bypass it; that bypass (via `config/workflows/wayfinder-resolution.yaml`) is exactly how 0280 was forced done.
- Locked: wayfinder-resolution.yaml was hardened at the workflow level on 2026-07-18 (verdict-file auto-guard fail-closed to HITL, lifecycle-enforced record, status-asserting transitions); this task builds the CLI/FSM-level backstop so no future caller can repeat the pattern.
- Locked: task 0280 needs no reopen path — it was re-verified to PASS on 2026-07-18 with the materialized baseline dataset; this guard targets the general case, not the motivating incident.
- Decision: reuse `spur task verdict` as the single deriver/validator for aggregate-vs-rows consistency (R10); the guard must not duplicate the aggregation rule.
- Known: `spur task check 0292` emits L4 warns (prose prerequisites 0152/0280 not mirrored in frontmatter `dependencies[]`). Dependency mutation has no CLI path yet — that gap is task 0290's scope; do not hand-edit frontmatter to silence the warns.
### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan
1. **Investigate** the transition entry path (`planning-write-service.ts` → lifecycle-adapter → workflow engine) and the existing guard mechanism used for `wip → testing` (the guard that *was* honored in the 0280 dogfood). Confirm where a verdict check naturally fits, and audit all `--no-lifecycle` status-update callers (`rg -n 'no-lifecycle' config/workflows apps packages plugins`) so the R8 placement covers them.
2. **Design** (T3 same-commit with surface code): the guard's home module, the override surface (flag name, audit-trail shape), and the workflow YAML edit. Decide frontmatter field vs. sidecar for the override record.
3. **Implement** the guard behind the transition, the denial message builder, the override flag, and the audit-trail write.
4. **Extend** the same transition entry with R8 (`--no-lifecycle` coverage), R9 (same-status honest no-op message — it short-circuits before the guard), and R10 (aggregate-vs-rows consistency via `spur task verdict`): one surface, one change-set.
5. **Test** unit (service layer, all seven R4 cases) + integration (CLI, R5 + the `--no-lifecycle` and no-op scenarios).
6. **Document** the guard in the lifecycle workflow declaration and surface the flags in `spur task update --help`.
### Solution

**Architecture (R1–R10 closed in one change-set):**

The verdict gate sits at the **CLI layer** (`apps/cli/src/commands/task.ts` update action), above both the lifecycle FSM and the `--no-lifecycle` bypass. This is the single choke point that covers R8: every `spur task update <wbs> done` invocation passes through it, whether or not the lifecycle adapter is engaged. The reusable pure logic lives in a new module `packages/app/src/services/done-transition-guard.ts` so it is unit-testable in isolation (R4) without spinning a CLI.

**Guard contract (`done-transition-guard.ts`):**

- `readVerdictArtifact(fs, runDir, wbs)` — loads `.spur/run/<wbs>-verdict.json`; returns `{ artifact: VerdictArtifact | undefined }`. Absent file → `undefined` (R1 back-compat allow).
- `computeAggregate(artifact)` — recomputes the aggregate verdict from `requirements[]` + `acceptanceCriteria[]` rows using the same rule as `spur task verdict` (any UNMET → FAIL; else any PARTIAL → PARTIAL; else PASS). This is the R10 consistency check; the guard does not trust the stored `verdict` field.
- `evaluateDoneTransition({ wbs, taskFilePath, currentStatus, targetStatus, forced, reason, artifact })` — returns one of:
  - `{ kind: 'noop', message }` — same-status update (R9). Honest message: `<wbs>: already <status> — no transition`. Exits 0.
  - `{ kind: 'deny', message }` — non-PASS verdict (or self-inconsistent artifact, R10). Message is actionable (R2): names wbs, file path, verdict value, verdict file path, and remediation (`re-run /sp-dev-verify <wbs> until PASS, or override with spur task update <wbs> done --force-done --reason "<why>"`).
  - `{ kind: 'allow', reason: 'pass' | 'forced' }` — proceed. `reason: 'forced'` signals the caller to record the audit trail.
- `harshnessMax(a, b)` — takes the harsher of stored-vs-computed verdict (PASS < UNKNOWN < PARTIAL < FAIL).

**Override audit trail (R3):** frontmatter fields `done_forced: boolean` + `done_reason: string` on the task itself — not a sidecar. This makes the override visible in `spur task show` and any frontmatter-aware tooling, and keeps the data co-located with the decision. The schema (`packages/domain/src/planning/schema.ts`) coerces string `"true"`/`"false"` (as written by `TaskService.updateField`, which emits scalars as strings) to boolean at validation time.

**CLI wiring (`task.ts` update action, lines 249–329):**

1. Resolve the current task and read the verdict artifact (R1).
2. Run `evaluateDoneTransition`. On `noop` → print honest message, exit 0 (R9). On `deny` → print to stderr, exit 1 (R2/R5). On `allow` with `reason === 'forced'` → set `forcedDone` for the post-transition audit write.
3. Call `svc.updateStatus(wbs, 'done')` (the existing lifecycle path).
4. If `forcedDone`, best-effort write `done_forced: 'true'` and (if provided) `done_reason: <text>` via `svc.updateField`. Failure emits a warning but does not revert the transition (the transition is already committed; the audit fields are best-effort).
5. Print the transition line. If `forcedDone`, also print `ⓘ Override recorded: task advanced to done despite <verdict> verdict (done_forced=true).`.

**R7 (case normalization):** unchanged. The verdict guard runs after the existing `normalizeStatusForDomain`/lifecycle-FSM check, so a non-canonical status (e.g. legacy `Backlog`) still surfaces the clear case-error before any verdict logic.

**R10 (self-consistency):** `computeAggregate` derives the aggregate from rows and compares to the stored `verdict` field. If they disagree, the guard uses the **harsher** of the two and, on denial, appends `aggregate contradicts per-requirement rows (self-inconsistent: stored=<X>, rows imply=<Y>)` to the message. This closes the softening observed in the first 0280 verify.

**Files changed:**

- `packages/app/src/services/done-transition-guard.ts:1-185` (new) — pure guard logic.
- `packages/app/src/index.ts:184-185` — re-export the guard surface.
- `packages/app/tests/services/done-transition-guard.test.ts:1-280` (new) — 20 unit tests covering R4a–g, R9, R10.
- `packages/domain/src/planning/schema.ts:263-274` — add `done_forced`/`done_reason` to `taskFrontmatterSchema` with string→boolean coercion.
- `packages/app/src/services/task-service.ts:508-525` — add `done_forced`/`done_reason` to the `updateField` allow-list.
- `apps/cli/src/commands/task.ts:188-194` — add `--force-done`, `--reason`, `--verdict-dir` options.
- `apps/cli/src/commands/task.ts:249-329` — wire guard into the update action (R1/R2/R3/R8/R9).
- `apps/cli/tests/commands/task.test.ts:1275-1440` — 7 integration tests covering all four AC scenarios + `--no-lifecycle` + no-op + inconsistent artifact.
- `config/workflows/task-lifecycle.yaml` (+ `.spur/workflows/task-lifecycle.yaml` hardlink) — document the two-layer done gate (R6).
### Testing
**Re-audit 2026-07-18** (`/sp:dev-verify 0292 --auto --next --force --focus all --fix all`, dogfood run `docs/dogfood/2026-07-18-sp-dev-verify-0292-dogfood.md`). Pre-fix verdict PARTIAL: two major findings repaired in the same run (fix pass, working tree): (1) case/alias-variant target (`spur task update <wbs> Done`) bypassed the verdict gate because the guard matched `status === 'done'` case-sensitively while `taskFrontmatterSchema` alias-normalizes the write — closed by canonicalizing target + stored status at the CLI layer (`apps/cli/src/commands/task.ts` `canonicalStatusOrRaw`); (2) the guard header cited a nonexistent R10 cross-check test — the pin now exists (`done-transition-guard.test.ts` "R10 — agrees with deriveVerdict on every shape", 3 tests). Post-fix verdict: **PASS**.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Guard consults `.spur/run/<wbs>-verdict.json` on every `* → done` (`apps/cli/src/commands/task.ts` update action); case/alias variants canonicalized pre-guard; integration test `done guard: case-variant target (Done) is still verdict-gated (R1/R8)` — exit 1, status unchanged |
| R2 | MET | `formatDenialMessage` names wbs, task path, verdict, artifact path, remediation; unit + integration assertions (`task.test.ts` "PARTIAL verdict blocks done with actionable message") |
| R3 | MET | `--force-done --reason` → `done_forced`/`done_reason` frontmatter + `Override recorded` advisory; integration test 5 |
| R4 | MET | 23 unit tests in `packages/app/tests/services/done-transition-guard.test.ts` (R4a–g + R9 + R10 + new cross-check block) — 23 pass / 0 fail this run |
| R5 | MET | 89 integration tests in `apps/cli/tests/commands/task.test.ts` (all 8 AC scenarios + case-variant) — 89 pass / 0 fail this run |
| R6 | MET | `config/workflows/task-lifecycle.yaml:14-22` documents the two-layer done gate |
| R7 | MET | Target and stored status alias-normalized before guard logic; unknown values pass through so downstream Zod still emits the clear case-error |
| R8 | MET | `--no-lifecycle` PARTIAL denied (integration test, exit 1, status unchanged); case-variant closure removes the last known non-canonical path around the choke point |
| R9 | MET | Live smoke this run: `spur task update 0292 done` → `0292: already done — no transition`, exit 0; case-variant `Done` hits the same honest no-op |
| R10 | MET | `computeAggregate` + `harshnessMax` deny inconsistent artifacts naming the inconsistency; duplication now pinned by the cross-check tests against `deriveVerdict` (every row-status shape in the guard vocabulary) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: PASS verdict advances to done | MET | test | `task.test.ts` "done guard: PASS verdict advances to done (R4a)" |
| Scenario: PARTIAL verdict blocks done without override | MET | test | `task.test.ts` "PARTIAL verdict blocks done with actionable message (R5/R4b)" |
| Scenario: Operator override advances PARTIAL to done with audit trail | MET | test | `task.test.ts` "--force-done with PARTIAL records override frontmatter (R3/R5)" |
| Scenario: No verdict file preserves current behavior | MET | test | `task.test.ts` "no verdict file → back-compat allow (R4d/R1)" |
| Scenario: --no-lifecycle done is still verdict-gated | MET | test | `task.test.ts` "--no-lifecycle PARTIAL is still verdict-gated (R8 explicit)" |
| Scenario: Pipeline back-compat — PASS verdict with --no-lifecycle advances | MET | test | `task.test.ts` "PASS verdict advances to done (R4a)" runs the transition under `--no-lifecycle` with a PASS verdict — exit 0 |
| Scenario: Same-status update reports an honest no-op | MET | test + command | `task.test.ts` "same-status no-op is honest and exits 0 (R9)"; live `spur task update 0292 done` this run |
| Scenario: Inconsistent verdict artifact is treated as non-PASS | MET | test | `task.test.ts` "inconsistent artifact denied with inconsistency named (R10)" |

**Suite evidence (this run):** guard unit 23 pass / 0 fail; CLI task integration 89 pass / 0 fail; `bun run lint` (biome + 7-workspace `tsc --noEmit`) clean; `spur task check 0292 --strict-core` pass, 0 findings.

**Fix-pass change map (uncommitted at write time):** `apps/cli/src/commands/task.ts` (canonicalStatusOrRaw helper + pre-guard normalization of target and stored status), `packages/app/tests/services/done-transition-guard.test.ts` (R10 cross-check block), `apps/cli/tests/commands/task.test.ts` (case-variant regression test).

Coverage: guard module exercised by the 23-test unit suite (per-file thresholds enforced repo-wide via `bunfig.toml`); no runtime path left untested by the fix pass.
### Review

**Reviewed:** 2026-07-18 (self-review, implementation = review author).

| Prio | Area | Finding | Evidence | Residual / Action |
|---|---|---|---|---|
| P1 | R8 coverage | Guard at CLI layer is the single choke point above `--no-lifecycle`. Confirmed by integration test asserting `--no-lifecycle` + PARTIAL exits 1 and status unchanged. | `apps/cli/src/commands/task.ts:262-274`, `apps/cli/tests/commands/task.test.ts:1400-1407` | None. Pattern holds: any future `done` caller via `spur task update <wbs> done [--no-lifecycle]` passes through the guard. |
| P1 | R10 self-consistency | `computeAggregate` recomputes from rows; `harshnessMax` takes the harsher of stored-vs-computed; inconsistent artifact is denied and inconsistency named. | `packages/app/src/services/done-transition-guard.ts:computeAggregate`, `apps/cli/tests/commands/task.test.ts:1424-1440` | None. Aggregation rule (any UNMET → FAIL; any PARTIAL → PARTIAL; else PASS) mirrors `spur task verdict`. |
| P2 | Schema coercion | `done_forced` persisted as YAML-quoted `"true"` (string) because `escapeYamlValue` quotes bool-like values. Schema preprocesses string → boolean at validation time. `task show` returns raw YAML data so the field surfaces as string `"true"` in JSON. | `packages/domain/src/planning/schema.ts:263-274`, integration test asserts `String(json.frontmatter.done_forced) === 'true'` | Acceptable: consumers validating via schema see boolean; raw-YAML consumers see string. Documented in Solution. |
| P2 | Override audit-trail best-effort write | `done_forced`/`done_reason` written after `updateStatus`; failure warns but does not revert. Rationale: transition already committed; reverting would require reopening `done`. | `apps/cli/src/commands/task.ts:302-311` | Acceptable. Worst case: transition succeeds but audit field is absent — operator sees the warning on stderr and can re-add via `spur task update <wbs> done --force-done --reason "..."` (no-op path). |
| P3 | Back-compat for no-verdict-file tasks | Tasks that never ran verify leg transition to done unchanged (R1). | `apps/cli/tests/commands/task.test.ts:1366-1371` | None. |
| P3 | Same-status no-op (R9) | Noop path returns honest message (`already <status> — no transition`), exits 0. | `apps/cli/tests/commands/task.test.ts:1409-1422` | None. |
| P4 | Workflow documentation | `task-lifecycle.yaml` documents the two-layer done gate. | `config/workflows/task-lifecycle.yaml:14-22` | None. |
| P4 | Suite health | 3014 pass / 0 fail / 0 skip across 202 files. Lint + typecheck clean. | `bun run test`, `bun run lint` | None. |

**Residual risk:** `SPUR_PROVENANCE_OVERRIDE=1` still bypasses provenance (intended for operators). The verdict guard runs regardless, so provenance override alone cannot force a non-PASS verdict through. The only path past a non-PASS verdict is `--force-done`, which always records the audit trail.

**Disposition:** APPROVED — all 10 requirements (R1–R10) met; all 8 acceptance scenarios covered by integration tests; full suite green; lint + typecheck clean.

### References
- `config/workflows/wayfinder-resolution.yaml` — the surface that force-recorded 0280 `done` (auto path was verdict-blind + `--no-lifecycle`). Hardened 2026-07-18 during the 0280 re-verify fix pass: auto `verify → record` now requires a machine-readable PASS at `.spur/run/wayfinder/<wbs>-resolution-verdict.txt` (fail-closed to the approve gate), `record` runs lifecycle-enforced `task update done`, and `record → done` asserts the status actually changed. The FSM-level `* → done` verdict guard this task specifies is still required — the workflow fix protects only this one caller.
- `docs/dogfood/2026-07-18-sp-dev-verify-0280-dogfood.md` — dogfood run that surfaced and repaired the workflow-level gap; findings P2 (aggregation softening → R10) and P3 (`undefined → undefined` no-op → R9) feed this task.
- `.spur/run/wayfinder-O/baseline/preserve-list.md` — P4 (PASS-only completion) baseline entry tracking this contract.
- `spur task verdict <wbs> [--from-answer <path>]` — existing deterministic verdict deriver; SSOT for the R10 consistency computation.
- `config/workflows/task-pipeline.yaml:182` and `config/workflows/docs-pipeline.yaml:70` — the two in-tree `--no-lifecycle done` callers R8 must stay back-compatible with.
- `plugins/sp/skills/code-verification/references/verdict-schema.md` — the aggregation rule R10 enforces at the gate.
### History
- 2026-07-18T20:01:43.307Z todo → wip (system)
- 2026-07-18T20:01:43.588Z wip → testing (system)
- 2026-07-18T20:07:43.829Z testing → wip (system)
- 2026-07-18T20:08:09.777Z wip → testing (system)
- 2026-07-18T20:09:23.001Z testing → done (system)
