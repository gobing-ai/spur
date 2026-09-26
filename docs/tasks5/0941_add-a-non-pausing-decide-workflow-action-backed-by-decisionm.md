---
schema_version: 1
name: Add a non-pausing decide workflow action backed by DecisionMaker
status: done
template: feature-impl
created_at: 2026-09-24T00:13:17.005Z
updated_at: "2026-09-26T02:50:01.233Z"
feature_id: D64
priority: P1
tags:
  - workflow
  - decision

dependencies: ["0937"]
estimate_hours: 6
---

## 0941. Add a non-pausing decide workflow action backed by DecisionMaker

### Background

Implements: R5 — Fuzzy branching uses an explicit non-pausing decide action. ADR-125; docs/design/workflow-catalogue-refactor.md §6. Distinct from ADR-123, which decorates pausing operator actions.

**Refine corrections (2026-09-23)**

1. *DecisionMaker methods.* The claim was `method: ask|choice|score`. The installed `@gobing-ai/ts-ai-runner` `DecisionMaker` (`src/decision/decision-maker.ts`) exposes `ask`, `choice(state, prompt, labels)`, `score(state, prompt, rubric)` and `noul(state, prompt?, outcomes?)`. v1 ships `choice` and `noul`, which both return a bounded label that a guard can compare. `ask` (free text) and `score` (numeric) are deferred until a candidate needs them.
2. *Backends.* The claim was "typesafe / laya-local / fm-local". The installed `DecisionBackend` is `'typesafe' | 'laya-local'`, and no fm-local backend exists.
3. *Reuse ADR-123 plumbing.* `packages/app/src/workflow/decision-hitl-responder.ts` already provides:
   - `DecisionProvenance` (schemaVersion 1: mode, outcome, reason, provider, confidence, selectedProbability, evidenceActionIds, evidenceDigest, artifactId, durationMs);
   - `redactAndBound` (from `../observability/agent-execution`);
   - the `enabled` switch;
   - the lazy `defaultDecisionMaker()` = `createDecisionMaker({timeoutMs: 15000, maxRetries: 0})`.

   `decide` reuses these rather than re-implementing them. The difference from ADR-123: `hitl.select decision: {mode: evidence}` may defer to the operator (a pause), while `decide` never pauses.
4. *Registration seam.* Built-in actions register in `packages/app/src/workflow/builtins.ts` as runners under `packages/app/src/workflow/actions/` (for example `proof-fingerprint.ts`, `hitl-select.ts`).
5. *Inline parity.* `plugins/sp/scripts/inline-pipeline-parity-check.ts` is a three-way diff over *action/guard kinds*: its `DOCUMENTED` constant, the driver markdown list, and the YAML union. `decide` must be added to all three. The inline execution path is a new `--decide` mode on `plugins/sp/scripts/inline-run-setup.ts`, which reaches the app via `resolveAppEntry` (plugin standalone contract).

### Requirements

- [x] R1. Register action kind `decide` with options:
  - `id` (required);
  - `method: choice | noul` (required);
  - `question` (required, interpolated);
  - `choices` (required for `choice`, at least 2 labels; `noul` uses the engine outcomes);
  - `evidence` (a list of file paths, each read and bounded via `redactAndBound`);
  - `default` (required, must be one of `choices`);
  - `minConfidence` (0–1, default 0.8);
  - `resultFile` (required).
- [x] R2. The action writes `resultFile` as JSON `{schemaVersion: 1, id, value, method, backend, confidence, degraded, reason, evidenceDigest, durationMs}` and returns `ok: true` with `data.value`, so the trace row carries it.
- [x] R3. Each of the following yields `value = default`, `degraded: true` and a `reason` of `disabled | no-backend | error | timeout | low-confidence`, and never pauses or fails the run:
  - the feature switch is off;
  - there is no backend;
  - the backend throws or times out (15s);
  - confidence is below `minConfidence`.
- [x] R4. Config switch `workflow.decideDecisionMaker` defaults to `false`, so degraded-default is the traditional path. When enabled, the backend comes from existing DecisionMaker config.
- [x] R5. The inline driver runs the action through `bun plugins/sp/scripts/inline-run-setup.ts --decide --run-id <id> --node <state> --options-json <file>`. This calls the same app function and writes the same `resultFile` and trace row. `inline-pipeline-parity-check` and its driver markdown list `decide`.
- [x] R6. Workflow validation rejects a `decide` action that lacks `default`, has a `default` not in `choices`, or omits `resultFile`.

### Acceptance Criteria

- [x] AC1 — Fuzzy branching uses an explicit non-pausing decide action

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:57.418Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:25:33.212Z

**Refine decisions — 2026-09-23 (ready depth)**

- **v1 methods are `choice` and `noul`.** Both return bounded labels that guards can compare. `ask` and `score` are deferred until a Phase 2 candidate needs them.
- **Backends are whatever the installed DecisionMaker supports (typesafe, laya-local).** fm-local does not exist and is not added here.
- **Default off (`workflow.decide.enabled: false`).** The traditional path is unchanged. A degraded default is recorded, not silent.
- **Estimate: 6h.**

#### Q&A entry — 2026-09-24T00:25:57.512Z

- **Config key renamed to `workflow.decideDecisionMaker`.** This supersedes `workflow.decide.enabled` in the entry above. It is a sibling of the existing `workflow.hitlDecisionMaker` boolean in `WorkflowConfigSchema`, keeping one naming pattern.

### Design

**Approach.**
- New `packages/app/src/workflow/actions/decide.ts` (`DecideActionRunner`) plus a pure core `runDecide(options, deps): Promise<DecideResult>` in `packages/app/src/workflow/decide.ts`. Its `deps` are `{enabled, decisionMaker?, readFile, now}`, which makes it testable with a fake maker.
- It reuses `redactAndBound` and the lazy default-maker factory from `decision-hitl-responder.ts`. Extract `defaultDecisionMaker` into a shared export only if both callers need it; that is the one allowed move.
- It is registered in `builtins.ts`. Option validation uses zod in the runner, and workflow validation calls the same schema.

**Frozen names:**
- action kind `decide`;
- `DecideActionRunner`, `runDecide`, `DecideOptions`, `DecideResult`;
- `resultFile` schema v1;
- degraded reasons `disabled|no-backend|error|timeout|low-confidence`;
- config key `workflow.decideDecisionMaker`;
- inline flag `--decide`.

**Guard contract.** A guard reads the result with existing file guards, for example `file.read-into-var` followed by a var equality guard. It never re-invokes the maker.

**Invariants:**
- Never pause.
- Never throw out of the action for model problems. Only an invalid options schema throws.
- A deterministic fact (diffstat, check receipt) is never asked of `decide`.
- Evidence is bounded and redacted before it leaves the process.

**Rejected alternatives:**
- Extending the ADR-123 responder, which conflates routing with operator pauses.
- Classifying inside `agent.run` prompts, which is untraced.
- Shipping `ask`/`score` now, which is speculative.

**Anti-patterns:**
- A value import of app code into `plugins/sp`.
- Reading `resultFile` inside the runner for guards.

**Targets:**
- `decide.ts` core branch coverage of 100% across the degraded reasons.
- Parity check green.

**Handoff:** 0943 consumes `decide` for `task-triage` and `failure-class`.

### Plan

1. `packages/app/src/workflow/decide.ts` core, with `packages/app/tests/workflow/decide.test.ts` using a fake DecisionMaker. Cover: accepted; each degraded reason; default not in choices rejected; evidence bounded and redacted; `noul` path.
2. `actions/decide.ts` runner and `builtins.ts` registration. Add the validation rule (missing default, default not in choices, missing resultFile), with a test in the existing workflow-validate tests.
3. Config key `workflow.decideDecisionMaker` in `packages/config/src/index.ts` (default false), with a config test.
4. `inline-run-setup.ts --decide` via `resolveAppEntry`, with a test in `plugins/sp/tests/`. Add `decide` to the parity-check `DOCUMENTED` constant and to the driver reference `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`.
5. Run `bun run plugin-smoke`, `bun run --filter @gobing-ai/spur build:bundle` and `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/index.ts:317` |
| `packages/app/src/index.ts:321` |
| `packages/app/src/index.ts:733` |
| `packages/app/src/index.ts:764` |
| `packages/app/src/index.ts:918` |
| `packages/app/src/services/inline-run-setup.ts:311` |
| `packages/app/src/services/inline-run-setup.ts:33` |
| `packages/app/src/services/inline-run-setup.ts:43` |
| `packages/app/src/services/workflow-service.ts:1920` |
| `packages/app/src/services/workflow-service.ts:2170` |
| `packages/app/src/services/workflow-service.ts:51` |
| `packages/app/src/services/workflow-service.ts:68` |
| `packages/app/src/services/workflow-service.ts:696` |
| `packages/app/src/services/workflow-service.ts:958` |
| `packages/app/src/services/workflow-service.ts:966` |
| `packages/app/src/workflow/action-trace.ts:178` |
| `packages/app/src/workflow/action-trace.ts:188` |
| `packages/app/src/workflow/action-trace.ts:284` |
| `packages/app/src/workflow/action-trace.ts:294` |
| `packages/app/src/workflow/action-trace.ts:41` |
| `packages/app/src/workflow/builtins.ts:100` |
| `packages/app/src/workflow/builtins.ts:14` |
| `packages/app/src/workflow/builtins.ts:2` |
| `packages/app/src/workflow/builtins.ts:56` |
| `packages/app/src/workflow/decision-hitl-responder.ts:228` |
| `packages/app/src/workflow/lifecycle-adapter.ts:243` |
| `packages/app/src/workflow/observability.ts:26` |
| `packages/app/src/workflow/observability.ts:472` |
| `packages/app/tests/services/inline-run-setup.test.ts:15` |
| `packages/app/tests/services/inline-run-setup.test.ts:3` |
| `packages/app/tests/services/inline-run-setup.test.ts:649` |
| `packages/app/tests/workflow/builtins.test.ts:34` |
| `packages/config/src/index.ts:771` |
| `packages/config/src/loader.ts:299` |
| `packages/config/tests/loader.test.ts:1112` |
| `packages/config/tests/loader.test.ts:30` |
| `packages/domain/src/dao/run-dao.ts:121` |
| `packages/domain/src/dao/run-dao.ts:127` |
| `packages/domain/src/migrations.ts:1540` |
| `packages/domain/src/migrations.ts:1778` |
| `packages/domain/src/migrations.ts:1844` |
| `packages/domain/src/migrations.ts:310` |
| `packages/domain/tests/dao/migrations.test.ts:12` |
| `packages/domain/tests/dao/migrations.test.ts:129` |
| `packages/domain/tests/dao/migrations.test.ts:225` |
| `packages/domain/tests/dao/migrations.test.ts:331` |
| `packages/domain/tests/dao/migrations.test.ts:385` |
| `packages/domain/tests/dao/migrations.test.ts:598` |
| `packages/domain/tests/dao/migrations.test.ts:657` |
| `packages/domain/tests/dao/migrations.test.ts:660` |
| `plugins/sp/scripts/inline-pipeline-parity-check.ts:53` |
| `plugins/sp/scripts/inline-run-setup.ts:103` |
| `plugins/sp/scripts/inline-run-setup.ts:318` |
| `plugins/sp/scripts/inline-run-setup.ts:34` |
| `plugins/sp/scripts/inline-run-setup.ts:347` |
| `plugins/sp/scripts/inline-run-setup.ts:36` |
| `plugins/sp/scripts/inline-run-setup.ts:430` |
| `plugins/sp/scripts/inline-run-setup.ts:465` |
| `plugins/sp/scripts/inline-run-setup.ts:48` |
| `plugins/sp/scripts/inline-run-setup.ts:557` |
| `plugins/sp/scripts/inline-run-setup.ts:562` |
| `plugins/sp/scripts/inline-run-setup.ts:575` |
| `plugins/sp/scripts/inline-run-setup.ts:580` |
| `plugins/sp/scripts/inline-run-setup.ts:596` |
| `plugins/sp/scripts/inline-run-setup.ts:612` |
| `plugins/sp/scripts/inline-run-setup.ts:629` |
| `plugins/sp/scripts/quality-gate.ts:102` |
| `plugins/sp/scripts/quality-gate.ts:18` |
| `plugins/sp/scripts/quality-gate.ts:180` |
| `plugins/sp/scripts/quality-gate.ts:27` |
| `plugins/sp/scripts/quality-gate.ts:515` |
| `plugins/sp/scripts/quality-gate.ts:578` |
| `plugins/sp/scripts/quality-gate.ts:609` |
| `plugins/sp/scripts/quality-gate.ts:613` |
| `plugins/sp/scripts/quality-gate.ts:621` |
| `plugins/sp/scripts/quality-gate.ts:85` |
| `plugins/sp/tests/inline-run-setup.test.ts:399` |
| `plugins/sp/tests/quality-gate.test.ts:324` |
| `scripts/commands/bundle-plugin-lib.ts:129` |
| `scripts/commands/bundle-plugin-lib.ts:176` |
| `scripts/commands/real-run-cost.test.ts:104` |
| `scripts/commands/real-run-cost.test.ts:19` |
| `scripts/commands/real-run-cost.test.ts:22` |
| `scripts/commands/real-run-cost.test.ts:236` |
| `scripts/commands/real-run-cost.test.ts:25` |
| `scripts/commands/real-run-cost.test.ts:32` |
| `scripts/commands/real-run-cost.test.ts:41` |
| `scripts/commands/real-run-cost.test.ts:44` |
| `scripts/commands/real-run-cost.test.ts:54` |
| `scripts/commands/real-run-cost.test.ts:57` |
| `scripts/commands/real-run-cost.test.ts:6` |
| `scripts/commands/real-run-cost.test.ts:83` |
| `scripts/commands/real-run-cost.ts:118` |
| `scripts/commands/real-run-cost.ts:128` |
| `scripts/commands/real-run-cost.ts:172` |
| `scripts/commands/real-run-cost.ts:178` |
| `scripts/commands/real-run-cost.ts:182` |
| `scripts/commands/real-run-cost.ts:195` |
| `scripts/commands/real-run-cost.ts:213` |
| `scripts/commands/real-run-cost.ts:244` |
| `scripts/commands/real-run-cost.ts:255` |
| `scripts/commands/real-run-cost.ts:273` |
| `scripts/commands/real-run-cost.ts:292` |
| `scripts/commands/real-run-cost.ts:318` |
| `scripts/commands/real-run-cost.ts:329` |
| `scripts/commands/real-run-cost.ts:34` |
| `scripts/commands/real-run-cost.ts:41` |
| `scripts/commands/real-run-cost.ts:5` |
| `scripts/commands/real-run-cost.ts:500` |
| `scripts/commands/real-run-cost.ts:505` |
| `scripts/commands/real-run-cost.ts:515` |
| `scripts/commands/real-run-cost.ts:531` |
| `scripts/commands/real-run-cost.ts:533` |
| `scripts/commands/real-run-cost.ts:56` |
| `scripts/commands/real-run-cost.ts:89` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/src/workflow/actions/decide.ts:22-56 DecideOptionsSchema (id, method enum, question, choices min2, evidence, default superRefine in choices, minConfidence 0-1 default 0.8, resultFile, strict); packages/app/src/workflow/decide.ts:24 DEFAULT_MIN_CONFIDENCE; packages/app/tests/workflow/decide.test.ts:150 |
| R2 | MET | packages/app/src/workflow/decide.ts:52-63 frozen v1 row; packages/app/src/workflow/actions/decide.ts:99-100 writes JSON + returns ok:true data.value; row shape asserted packages/app/tests/workflow/actions/decide.test.ts:119-146; engine persists result_json at finalize |
| R3 | MET | packages/app/src/workflow/decide.ts:21 closed vocab; degraded() branches disabled packages/app/src/workflow/decide.ts:99, no-backend packages/app/src/workflow/decide.ts:105, error packages/app/src/workflow/decide.ts:122,134,168-170, timeout packages/app/src/workflow/decide.ts:166-170 (15s shared factory packages/app/src/workflow/decision-hitl-responder.ts:235), low-confidence packages/app/src/workflow/decide.ts:137,153; ok:true when degraded packages/app/tests/workflow/actions/decide.test.ts:147-160; 54 pass live |
| R4 | MET | packages/config/src/index.ts:772 decideDecisionMaker optional; enabled = === true packages/app/src/workflow/builtins.ts:109 (test packages/app/tests/workflow/decide.test.ts:156); enabled path defaultDecisionMaker -> createDecisionMaker timeoutMs 15000; loader projection loader.ts:302-310 |
| R5 | MET | plugins/sp/scripts/inline-run-setup.ts:466-545 --decide -> app runDecideForInlineRun (services/inline-run-setup.ts:346-386) same DecideActionRunner; trace row plugins/sp/scripts/inline-run-setup.ts:529-538; parity-check DOCUMENTED plugins/sp/scripts/inline-pipeline-parity-check.ts:52 run ok; driver markdown plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:26,500-509; plugin suite 14 pass |
| R6 | MET | collectDecideViolations re-parses runner schema packages/app/src/services/workflow-service.ts:2230-2255 wired packages/app/src/services/workflow-service.ts:702; rejects missing default / default outside choices / missing resultFile — packages/app/tests/workflow/actions/decide.test.ts:182-202 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Fuzzy branching uses an explicit non-pausing decide action | MET | test | example workflow packages/app/tests/services/fixtures/decision-routing-example.yaml:63-68 kind decide non-pausing w/ degraded guards packages/app/tests/services/fixtures/decision-routing-example.yaml:124-139; targeted suites 54+14 pass 0 fail; fingerprint sha256:2851f179407e9c7eb150bf480bd15a6a565fbefa713bd6fd8fdf67b8133ba279 reproduced; gate PASS 9093 tests 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0941 (decide action)

**Review #1** (fresh sp-super-reviewer, run 64dba8de): PASS — R1–R6 + AC1 all MET; critical invariants hold (never pauses/throws for model problems; evidence redacted+bounded, digest over canonical JSON; 15s timeout via shared factory, no leaked timers; guard contract — runner never reads resultFile back).

**Gate hardening (3 worker hops + driver tsdoc):** attempt 1 app-layer loadSpurConfig rule violation → switch threaded as explicit parameter from composition boundary (b476190b); attempt 2 stale inline-run-setup.mjs twin + example-YAML regression (classify guards read degraded rows as accepted → both 0911 example tests got done instead of paused; fixed with degraded=="false" guard idiom) (0fb327c9); attempt 3 service-layer coverage gap (85.71/72.90 → 100% funcs/99.52% lines, +10 service tests incl. local Bun.serve backend) (d9f41dc2); tsdoc one-liner on DecideActionRunner (driver). Gate attempt-6 PASS (9093 tests).

| P | Finding | Disposition |
| --- | --- | --- |
| P4 | no-backend unreachable through service layer (lazy driver; missing key → error) | ACCEPTED — upstream source-verified seam note; vocabulary live at core layer + injected-factory rejections; in-test comment is standing docs |
| P4 | duplicate choice labels silently collapse | ACCEPTED — spec requires only ≥2 labels; optional refine for a future task |
| P4 | noul 0.65-yes degrades low-confidence (probability is the honest gate number) | ACCEPTED — deliberate, documented, tested |

Residual: advisories are optional polish; no blocking findings.

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History

- 2026-09-25T06:31:04.160Z todo → wip (system)
- 2026-09-25T08:38:29.187Z wip → testing (system)
- 2026-09-25T08:38:29.873Z testing → done (system)

