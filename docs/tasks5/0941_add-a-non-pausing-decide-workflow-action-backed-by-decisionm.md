---
schema_version: 1
name: Add a non-pausing decide workflow action backed by DecisionMaker
status: todo
template: feature-impl
created_at: 2026-09-24T00:13:17.005Z
updated_at: "2026-09-24T00:25:57.512Z"
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

- [ ] R1. Register action kind `decide` with options:
  - `id` (required);
  - `method: choice | noul` (required);
  - `question` (required, interpolated);
  - `choices` (required for `choice`, at least 2 labels; `noul` uses the engine outcomes);
  - `evidence` (a list of file paths, each read and bounded via `redactAndBound`);
  - `default` (required, must be one of `choices`);
  - `minConfidence` (0–1, default 0.8);
  - `resultFile` (required).
- [ ] R2. The action writes `resultFile` as JSON `{schemaVersion: 1, id, value, method, backend, confidence, degraded, reason, evidenceDigest, durationMs}` and returns `ok: true` with `data.value`, so the trace row carries it.
- [ ] R3. Each of the following yields `value = default`, `degraded: true` and a `reason` of `disabled | no-backend | error | timeout | low-confidence`, and never pauses or fails the run:
  - the feature switch is off;
  - there is no backend;
  - the backend throws or times out (15s);
  - confidence is below `minConfidence`.
- [ ] R4. Config switch `workflow.decideDecisionMaker` defaults to `false`, so degraded-default is the traditional path. When enabled, the backend comes from existing DecisionMaker config.
- [ ] R5. The inline driver runs the action through `bun plugins/sp/scripts/inline-run-setup.ts --decide --run-id <id> --node <state> --options-json <file>`. This calls the same app function and writes the same `resultFile` and trace row. `inline-pipeline-parity-check` and its driver markdown list `decide`.
- [ ] R6. Workflow validation rejects a `decide` action that lacks `default`, has a `default` not in `choices`, or omits `resultFile`.

### Acceptance Criteria

- [ ] AC1 — Fuzzy branching uses an explicit non-pausing decide action

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History
