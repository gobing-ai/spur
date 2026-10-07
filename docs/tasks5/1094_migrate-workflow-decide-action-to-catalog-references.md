---
schema_version: 1
name: Migrate workflow decide action to catalog references
status: todo
template: feature-impl
created_at: 2026-10-06T17:55:55.426Z
updated_at: "2026-10-07T16:29:37.970Z"
feature_id: P1
priority: P2
tags:
  - decision
  - workflow

dependencies: ["1092", "1093", "1096", "1113"]
estimate_hours: 6
---

## 1094. Migrate workflow decide action to catalog references

### Background

Feature P1, slice S4 framework (`docs/design/decision-observability-and-adoption.md` §5). Covers P1 scenarios R1 and R3, plus the validation half of R2.

Refined 2026-10-07 (P1 review): the original task bundled the catalog-reference `decide` framework with the migration of three task-pipeline decision points. Per the 2026-10-06 operator decision ("split per decision point at refine time; one decision point per slice"), this task now owns only the framework, which needs no reliability evidence because it changes no shipped workflow. The three migrations are separate slices that depend on this task and stay blocked until their evidence bar is met (feature P1 Entry condition):

- task-triage — task 1114
- failure-class — task 1115
- review-failure-class — task 1116 (also closes R2: no inline decide left in shipped workflows)

Today the workflow `decide` action (`packages/app/src/workflow/actions/decide.ts`) accepts only the inline form `{id, method, question, choices, default, evidence, minConfidence, resultFile}` and runs it on the ts-ai-runner `DecisionMaker` through `runDecide` (`packages/app/src/workflow/decide.ts:84`). Catalog decisions run on a different stack: `DecisionService` over ts-ai-decision makers (`packages/app/src/decision/decision-service.ts`). The evidence-mode gate (task 1099) already injects that service lazily (`packages/app/src/services/workflow-service.ts:2179`); the decide action reuses the same injection.

### Requirements

- [ ] R1. `DecideOptionsSchema` (`packages/app/src/workflow/actions/decide.ts:25`) accepts a second, strict form `{decision, params?, evidence?, resultFile}`. The inline form stays accepted unchanged. The catalog form rejects `question`, `choices`, `default`, `method` and `minConfidence`: the catalog owns them.
- [ ] R2. The catalog form calls `DecisionService.decide` through a lazy `decisionService` dependency on `DecideActionDeps`, wired in `packages/app/src/workflow/builtins.ts:108` from the same factory the gate path uses (`workflow-service.ts:2179`). It passes the run bus and `context: { caller: 'workflow', correlation }` with the full correlation of task 1113 (runId, workflowName, nodeId, wbs).
- [ ] R3. Evidence files are read relative to the workdir, redacted and bounded with `DECIDE_EVIDENCE_MAX_CHARS`, and joined into input `instructions`, exactly as `spur decision run --evidence` does (`apps/cli/src/commands/decision.ts:351`). Extract that read-redact-join into one shared helper in `packages/app` that both the CLI and the runner call, so CLI-gathered reliability evidence stays representative of the workflow path. A missing evidence file degrades with reason `error` (same as the inline path).
- [ ] R4. The served result maps onto the unchanged schemaVersion-1 row (`DecideResult`, `decide.ts`): `id` = decision id, `method` = catalog `type` (only `choice` and `noul` types are valid for the action; any other type fails validation), `backend` = maker, `degraded` = `source === 'default'`, plus `value`, `confidence`, `reason`, `source`, `evidenceDigest`, `durationMs`. Guards and resultFile paths are untouched.
- [ ] R5. With `workflow.decideDecisionMaker` off (`packages/config/src/index.ts:842`, default off), the catalog form makes no service call and emits no events; the row carries the catalog fallback with `source: default`, `reason: disabled` (feature R1).
- [ ] R6. Caller mistakes in the catalog form (unknown id, bad params, unregistered maker) fail the action (`ok: false`) with the service error. They are configuration errors, not model problems, so they do not degrade. The service already emits `decision.rejected`.
- [ ] R7. Validation: `collectDecideViolations` (`packages/app/src/workflow/composition-lint.ts:200`) resolves a catalog-form decision id against the resolvable catalogs and fails with the missing id (feature R2, second clause). An inline-form action produces one deprecation warning naming its `id` and the replacement form; the runner logs the same warning once per execution through the warn sink (feature R3).
- [ ] R8. The inline driver (`runDecideForInlineRun`, `packages/app/src/services/inline-run-setup.ts:864`; `runInlineRunDecide`, `:1538`) executes the same runner for both forms and writes the same row.
- [ ] R9. No shipped workflow YAML changes in this task. No new public `spur` noun, verb or flag.

### Acceptance Criteria

- [ ] AC1 — Workflow decide action resolves a catalog decision by id
- [ ] AC2 — Inline decide options keep working for one release with a deprecation warning

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-06T17:56:36.916Z

- Union schema with a one-release deprecation for inline options; removal is a later task.
- resultFile stays schemaVersion 1 with identical fields, so guards are untouched.
- Evidence is passed as one redacted/bounded `${params.evidence}` string; per-file params deferred until a decision needs them.

#### Q&A entry — 2026-10-06T18:16:30.738Z

- Postponed: stays in backlog until feature P is done and reliability evidence exists for the first decision point (P1 entry condition).
- Gradual adoption: split per decision point at refine time; one decision point per slice.
- Union schema with a one-release deprecation for inline options; removal is a later slice.
- resultFile stays schemaVersion 1 with identical fields, so guards are untouched.
- Evidence is passed as one redacted/bounded `${params.evidence}` string; per-file params deferred until a decision needs them.

#### Q&A entry — 2026-10-07 P1 review

- Split: this task is the framework only; tasks 1114–1116 migrate one decision point each and stay blocked until the evidence bar recorded in their own Q&A is met. Framework needs no evidence because no shipped workflow changes.
- Evidence goes in input `instructions`, not `${params.evidence}` (supersedes the 2026-10-06 entry). `instructions` is what `spur decision run --evidence` sends and what the service digests, so CLI-gathered samples measure the same input the workflow sends.
- The catalog form uses `DecisionService` (ts-ai-decision makers). The legacy `decisionMaker` dependency stays only for the inline form and is removed with it in S8.
- Runtime caller mistakes fail the action instead of degrading: a typo'd decision id must not silently run the fallback forever.
- Depends on task 1113 for input pre-validation and full correlation on the service path.
- S8 (remove the inline form) is not filed: it needs one release of deprecation after 1116. File it at that release.

### Design

Union schema over a flag day, so third-party workflows keep running for one release. The catalog form is a thin adapter: options → `service.decide` → the frozen schemaVersion-1 row. Guards and resultFile paths are unchanged, so routing is identical with the switch off. One evidence helper serves the CLI and the runner.

Rejected: a new resultFile schemaVersion (breaks existing guards for no gain); running catalog decisions on the ts-ai-runner maker (two maker stacks for one catalog would make the reliability report measure a different maker than the workflow uses).

### Plan

1. Failure list first:
   - A catalog-form action with the switch off calls the service or emits events.
   - The row shape differs from the inline row (field set, `method`, `degraded`).
   - CLI and workflow send different `instructions` text for the same evidence files.
   - An unknown decision id degrades instead of failing the action, or passes validation.
   - An inline action runs without a deprecation warning, or the warning repeats per state re-entry within one execution.
   - The inline driver writes a different row than the subprocess runner.
2. Shared evidence helper; switch the CLI to it (behavior unchanged).
3. Schema union, catalog-form runner path, deps wiring in `builtins.ts`, validation and deprecation warning.
4. Inline driver parity.
5. E2E in a temp project with a fixture workflow (not a shipped one) holding one catalog-form decide on `task-triage`: run with the switch off (row = `standard`, `source: default`, `reason: disabled`, no events), then on with no backend (row = `standard`, `reason: no-backend`, `decision.start/failure/end` in `system_events` with `caller: workflow` and the run id). Run the same fixture through the inline driver and diff the rows. Save `.spur/run/1094-decide.json`.
6. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-06T18:16:39.105Z todo → blocked (system)
- 2026-10-07T16:29:37.970Z blocked → todo (system)

