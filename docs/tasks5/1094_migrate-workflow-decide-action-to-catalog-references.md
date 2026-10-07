---
schema_version: 1
name: Migrate workflow decide action to catalog references
status: todo
template: feature-impl
created_at: 2026-10-06T17:55:55.426Z
updated_at: "2026-10-07T17:23:56.791Z"
feature_id: P1
priority: P2
tags:
  - decision
  - workflow

dependencies: ["1092", "1093", "1096", "1113"]
estimate_hours: 8
---

## 1094. Migrate workflow decide action to catalog references

### Background

Feature P1, slice S4 framework (`docs/design/decision-observability-and-adoption.md` §5). Covers P1 scenarios R1 and R3, plus the validation half of R2.

Refined 2026-10-07 (P1 review): the original task bundled the catalog-reference `decide` framework with the migration of three task-pipeline decision points. Per the 2026-10-06 operator decision ("split per decision point at refine time; one decision point per slice"), this task now owns only the framework, which needs no reliability evidence because it changes no shipped workflow. The three migrations are separate slices that depend on this task and stay blocked until their evidence bar is met (feature P1 Entry condition):

- task-triage — task 1114
- failure-class — task 1115
- review-failure-class — task 1116 (also closes R2: no inline decide left in shipped workflows)

Today the workflow `decide` action (`packages/app/src/workflow/actions/decide.ts`) accepts only the inline form `{id, method, question, choices, default, evidence, minConfidence, resultFile}` and runs it on the ts-ai-runner `DecisionMaker` through `runDecide` (`packages/app/src/workflow/decide.ts:84`). Catalog decisions run on a different stack: `DecisionService` over ts-ai-decision makers (`packages/app/src/decision/decision-service.ts`). The evidence-mode gate (task 1099) already injects that service lazily (`packages/app/src/services/workflow-service.ts:2179`); the decide action reuses the same injection.

**Refine corrections (2026-10-07)**

- R4 "`value` maps directly" → wrong for `noul`. The hub serves a boolean (`probability >= 0.5`, ts-ai-decision `dist/hub.js` `case 'noul'`), but `DecideResult.value` is a `string` and inline `noul` rows write `yes`/`no` (`packages/app/src/workflow/decide.ts:53`). File guards compare strings. → The catalog form maps `true → 'yes'` and `false → 'no'`, and the fallback value goes through the same mapping.
- R4 "`evidenceDigest`" was unspecified → the inline row digests the evidence array (`evidencePayloadDigest`, `decision-evidence.ts:155`), while service events digest the `instructions` string (`decision-service.ts:235-240`). → The catalog-form row uses the event digest (`sha256:` of the joined `instructions`), so one invocation carries one digest. The shared helper returns it.
- R3 "missing evidence file degrades (same as the inline path)" → the CLI treats unreadable evidence as a caller mistake and emits `decision.rejected` (`apps/cli/src/commands/decision.ts:175`). → In a workflow, the file comes from an upstream step, so the row still degrades: `ok: true`, reason `error`, value = mapped catalog fallback, and no service decide call. The row also emits one `decision.rejected` (errorKind `error`), as the CLI does, so the reliability report never counts it as a maker failure.
- R7 assumed validation can see catalogs → `collectDecideViolations(def)` (`packages/app/src/workflow/composition-lint.ts:205`) is synchronous and takes only the definition. It is called from async `validate` (`packages/app/src/services/workflow-service.ts:674`). → It gains an optional `catalogIds?: ReadonlySet<string>` parameter. `validate` loads the service and passes the ids only when the definition has a catalog-form action. Validate results have no warnings field, and the composition advisory's `measure.kind` union is ADR-115-specific. → The deprecation warning goes through the composition-root sink `this.ctx.warn`, the same sink run warnings use (`workflow-service.ts:867`), with no result-shape change.
- R8 "inline driver executes the same runner" → `runDecideForInlineRun` builds `DecideActionRunner` with only `enabled` + bus (`packages/app/src/services/inline-run-setup.ts:879-882`) and `vars: {}`. A catalog form would have no service, and the app may not load config itself (`packages/config/src/loader.ts:305-313`, ADR-082). → The plugin delegate (`plugins/sp/scripts/inline-run-setup.ts:152`) loads config once through a new bundled-lib export of `loadSpurConfig`, using the same pattern as `scripts/commands/bundle-plugin-lib.ts:639`. It passes `spurConfig` to `runInlineRunDecide`, which builds the lazy `getDecisionService(spurConfig, cwd)` factory. The inline driver already taps `system_events` (`:1545-1572`).
- The runner has no warn sink → add `DecideActionDeps.warn?` and a `RegisterSpurBuiltinsOptions.warn`, wired from `this.ctx.warn` at `workflow-service.ts:2042`.

### Requirements

- [ ] R1. `DecideOptionsSchema` (`packages/app/src/workflow/actions/decide.ts:25`) becomes a union.
  - The inline form stays accepted unchanged.
  - The new strict catalog form is `{decision: string, params?: Record<string, string|number|boolean|null>, evidence?: string[], resultFile: string}`. It rejects `id`, `question`, `choices`, `default`, `method` and `minConfidence`: the catalog owns them.
  - Export `isCatalogDecideOptions(options)` for the validator and the runner.
- [ ] R2. The catalog form calls `DecisionService.decide(decision, input, { bus, context })` through a lazy `decisionService?: () => Promise<DecisionService>` dependency on `DecideActionDeps`.
  - The dependency is wired in `packages/app/src/workflow/builtins.ts:108` from a new `RegisterSpurBuiltinsOptions.decisionService`. `workflow-service.ts:2042` supplies it with the same factory the gate uses (`() => getDecisionService(this.ctx.spurConfig ?? null, this.ctx.cwd)`, `:2179`).
  - `context` is `{ caller: 'workflow', correlation: decisionCorrelationFromVars({...context.vars, __runId: context.runId, __nodeId: context.stateOrNodeId}) }`; the helper comes from task 1113.
  - A missing `decisionService` dependency fails the action (`ok: false`): it is a wiring error.
- [ ] R3. Extract `readDecisionEvidence(paths, readFile): Promise<{ instructions: string; evidenceDigest: string }>` into `packages/app/src/decision/decision-evidence-input.ts`.
  - Each file is redacted and bounded with `redactAndBound(text, [], DECIDE_EVIDENCE_MAX_CHARS)`. The files are joined with `'\n\n'`, and the digest is `sha256:` of the joined string.
  - An unreadable file throws `Error('evidence file "<path>" is unreadable')`.
  - The CLI (`apps/cli/src/commands/decision.ts:158-172` and the join in `parseParams` at `:351`) and the runner both call it. The CLI's output is byte-identical to today.
  - The runner resolves paths against the workdir. On a throw it writes the degraded row (reason `error`) and emits one `decision.rejected` (errorKind `error`), with no service decide call.
- [ ] R4. The served result maps onto the unchanged schemaVersion-1 `DecideResult` row (`packages/app/src/workflow/decide.ts:53`):

  | Row field | Source |
  | --- | --- |
  | `id` | decision id |
  | `method` | catalog `type`; only `choice` and `noul` are valid, and `score` fails validation |
  | `value` | the choice label as is; `noul` booleans map to `'yes'`/`'no'` |
  | `backend` | `maker` |
  | `degraded` | `source === 'default'` |
  | `evidenceDigest` | the R3 digest, or `null` without evidence |
  | `confidence`, `reason`, `source`, `durationMs` | passed through |

  Guards and resultFile paths are untouched.
- [ ] R5. With `workflow.decideDecisionMaker` off (`packages/config/src/index.ts:842`, default off), the catalog form:
  - makes no `decide` call, reads no evidence and emits no events;
  - writes the catalog fallback, mapped per R4, with `source: 'default'`, `reason: 'disabled'`, `backend: null`;
  - reads the fallback from `service.describe(decision).fallback`, the only service call allowed.

  This is feature R1.
- [ ] R6. Caller mistakes in the catalog form fail the action (`ok: false`, the service error message) and do not degrade. The mistakes are an unknown id, bad params and an unregistered maker. The service already emits `decision.rejected`.
- [ ] R7. Validation.
  - `collectDecideViolations(def, catalogIds?)` reports a catalog-form `decision` that is absent from `catalogIds`, naming the id. It also reports a catalog decision whose type is not `choice`/`noul`, which requires passing types: use `ReadonlyMap<string, DecisionType>` instead of a Set.
  - `validate` (`workflow-service.ts:674`) builds the map from `(await getDecisionService(...)).list()` only when the definition contains a catalog-form action. If the service fails to load, that becomes a violation.
  - Each inline-form action emits one warning through `this.ctx.warn`: `decide <state>/<id>: inline decide options are deprecated; use { decision: <catalog-id>, params?, evidence?, resultFile }` (feature R3).
  - The runner emits the same text once per run per inline `id` through `DecideActionDeps.warn`.
- [ ] R8. Inline driver parity.
  - `InlineRunDecideInput` and `InlineDecideInput` gain `spurConfig?: SpurConfig | null`.
  - `runDecideForInlineRun` (`packages/app/src/services/inline-run-setup.ts:864`) passes `decisionService: () => getDecisionService(spurConfig ?? null, workdir)` to the runner.
  - The plugin delegate (`plugins/sp/scripts/inline-run-setup.ts:152`) loads config once through a new bundled-lib `loadSpurConfig` export, derives `enabled` from it and passes both.
  - Both forms write the same row as the engine runner. Regenerate the bundles (`bun run --filter @gobing-ai/spur build:bundle`), then run `bun run plugin-smoke`.
- [ ] R9. No shipped workflow YAML changes. No new public `spur` noun, verb or flag. The inline form keeps working unchanged.

**Out of scope:**

- migrating any shipped decision point (tasks 1114–1116);
- removing the inline form (S8, filed after one release);
- decision log rows (task 1100).

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

**What.** The catalog-reference form of the workflow `decide` action is a thin adapter: options → `DecisionService.decide` → the frozen schemaVersion-1 row. A union schema replaces a flag day, so third-party workflows keep running for one release. One evidence helper serves the CLI and the runner, so CLI-gathered reliability samples measure the input the workflow sends.

**Where (frozen names).**

| File | Change |
| --- | --- |
| `packages/app/src/workflow/actions/decide.ts` | `CatalogDecideOptionsSchema`, `DecideOptionsSchema = z.union([Inline…, Catalog…])`, `isCatalogDecideOptions`, `DecideActionDeps.decisionService?` / `warn?`, private `executeCatalog(options, context)` |
| `packages/app/src/decision/decision-evidence-input.ts` (new) | `readDecisionEvidence` |
| `packages/app/src/workflow/builtins.ts:108` | thread `decisionService`, `warn` |
| `packages/app/src/services/workflow-service.ts` | `:674` pass catalog types to the validator and warn per inline action; `:2042` pass `decisionService` and `warn` |
| `packages/app/src/workflow/composition-lint.ts:205` | `collectDecideViolations(def, catalogTypes?)` |
| `packages/app/src/services/inline-run-setup.ts:864,:1538` | `spurConfig` input and the service factory |
| `plugins/sp/scripts/inline-run-setup.ts:152` + `scripts/commands/bundle-plugin-lib.ts:639` | config loaded once at the delegate |
| `apps/cli/src/commands/decision.ts` | switch to `readDecisionEvidence` |

**`executeCatalog` algorithm.**

1. If `!enabled`: call `describe` for the fallback, write the `disabled` row and return `ok: true`. No events.
2. If `decisionService` is absent: return `ok: false`.
3. If evidence is declared, call `readDecisionEvidence`. On a throw, emit `decision.rejected` and write the degraded `error` row with the mapped fallback.
4. Build `input = { ...params, ...(instructions ? { instructions } : {}) }`. If `params.instructions` is also set, the action fails: it is reserved.
5. `await service.decide(...)`. A throw means a caller mistake, so return `ok: false` with the message.
6. Map per R4, write the row, return `{ ok: true, data: { value, decision: row } }`.

**Invariants.** Routing is identical with the switch off, because guards read the same resultFile field. The service owns lifecycle events; the runner emits only the evidence-read `rejected`. With the switch off, nothing leaves the process.

**Anti-patterns.**

- Do not run catalog decisions on the ts-ai-runner `DecisionMaker`: two maker stacks for one catalog would make the reliability report measure a maker the workflow does not use.
- Do not add a resultFile `schemaVersion: 2`.
- Do not put evidence in a `params.evidence` key: it must be `instructions`, which supersedes the 2026-10-06 Q&A.
- Do not read config inside `packages/app` (ADR-082).
- Do not change the inline form's behavior or row.

**Dependencies.**

- From 1113: `decisionCorrelationFromVars`, `errorKind: 'input'` and pre-validation, so a bad `params` fails before `decision.start`.
- From 1092, 1093 and 1096: the catalog service, layering and maker resolution, all shipped.
- Left for 1114–1116: a working catalog form and validator, so their slices are YAML-only.

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

