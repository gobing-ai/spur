---
template: standard
schema_version: 1
name: "Enforce verify verdict on done transition; record forced-done overrides"
description: ""
status: todo
type: task
profile: standard
feature_id: F4
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-18T18:50:43.548Z"
updated_at: "2026-07-18T19:28:58.414Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing
Coverage: target ≥ 90% line on the new guard module; integration test exercises all four AC scenarios via the CLI. Evidence path: `/sp-dev-verify <this-wbs>`.
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- `config/workflows/wayfinder-resolution.yaml` — the surface that force-recorded 0280 `done` (auto path was verdict-blind + `--no-lifecycle`). Hardened 2026-07-18 during the 0280 re-verify fix pass: auto `verify → record` now requires a machine-readable PASS at `.spur/run/wayfinder/<wbs>-resolution-verdict.txt` (fail-closed to the approve gate), `record` runs lifecycle-enforced `task update done`, and `record → done` asserts the status actually changed. The FSM-level `* → done` verdict guard this task specifies is still required — the workflow fix protects only this one caller.
- `docs/dogfood/2026-07-18-sp-dev-verify-0280-dogfood.md` — dogfood run that surfaced and repaired the workflow-level gap; findings P2 (aggregation softening → R10) and P3 (`undefined → undefined` no-op → R9) feed this task.
- `.spur/run/wayfinder-O/baseline/preserve-list.md` — P4 (PASS-only completion) baseline entry tracking this contract.
- `spur task verdict <wbs> [--from-answer <path>]` — existing deterministic verdict deriver; SSOT for the R10 consistency computation.
- `config/workflows/task-pipeline.yaml:182` and `config/workflows/docs-pipeline.yaml:70` — the two in-tree `--no-lifecycle done` callers R8 must stay back-compatible with.
- `plugins/sp/skills/code-verification/references/verdict-schema.md` — the aggregation rule R10 enforces at the gate.
### History
