---
schema_version: 1
name: Route evidence-mode operator gates through catalog decisions
status: todo
template: feature-impl
created_at: 2026-10-07T01:02:20.692Z
updated_at: "2026-10-07T05:57:51.434Z"
feature_id: P1
priority: P2
tags:
  - decision
estimate_hours: 4

dependencies: ["1096"]
---

## 1099. Route evidence-mode operator gates through catalog decisions

### Background

Slice S7 of docs/design/decision-observability-and-adoption.md §5. Evidence-mode operator gate answers come from the legacy defaultDecisionMaker().choice in the workflow gate responder (packages/app/src/workflow/, evidence path lines 340 and 442). Covers R13. Starts only when reliability evidence exists for gate-evidence.

### Requirements

- [ ] R1. Add catalog file `config/decisions/gates.yaml` with `gate-evidence`:
  - `type: choice`; criteria `yes`, `no`, `defer`; `fallback: defer`.
  - Parameters: `prompt` (string), `evidence` (json), `node` (string).
- [ ] R2. In `packages/app/src/workflow/decision-hitl-responder.ts`, `evaluateEvidence` (`:371`), replace the `maker.choice(...)` call at `:442-447` for `confirm` requests with `DecisionService.decide('gate-evidence', {prompt, evidence: payload, node}, {bus, context: {caller: 'gate', correlation: {runId: request.runId, nodeId: request.node}}})`.
  - `DecisionEvaluationDeps` gains `decisionService?: () => Promise<DecisionService>` and `bus?`, injected in `WorkflowService.buildDecisionEvaluator` (`packages/app/src/services/workflow-service.ts:2163`): change the call at `:2044` to `this.buildDecisionEvaluator(bus)`, using the run bus that `:2047` passes as `observabilityBus`, and build the service with `getDecisionService(this.ctx.spurConfig ?? null, <workflow cwd>)`.
  - Mapping: `source == "model"` with value `yes` or `no` → `accepted`, with provenance confidence from the served result. A `defer` value, or any default → `deferred` with reason = served `reason`.
- [ ] R3. `select` requests (dynamic option lists) and `evaluateLegacy` (`:286`, `:340`) keep the current `defaultDecisionMaker` path unchanged. A catalog cannot declare per-request choices.
- [ ] R4. Bundled gates keep `mode: never` and still pause for the operator. No bundled workflow YAML changes.
- [ ] R5. Start condition: the 1096 reliability report shows recorded samples for `gate-evidence`. Cite them in Solution.

### Acceptance Criteria

- [ ] AC1 — Operator gates in evidence mode resolve through catalog decisions

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T01:02:49.711Z

- Scope and approach closed at idea-pipeline run 4111db4a-101f-420c-8b6f-9530bf678534: chosen approach and rejected alternatives recorded in Design; contract in docs/design/decision-observability-and-adoption.md.
- Adoption slices start only after the reliability report shows recorded evidence for their decision id and maker (feature P1 entry condition).

#### Q&A entry — 2026-10-07T01:19:12.888Z

- Scope is evidence-mode `confirm` only. `select` and legacy mode keep `defaultDecisionMaker`, because the catalog has no runtime-choice support. Revisit if `ts-ai-decision` adds per-call choices.
- The `defer` choice and the `defer` fallback both map to `deferred`, so the operator still answers whenever the model is not confident.

### Design

**Chosen: route only evidence-mode `confirm` through the catalog.** A confirm gate's choices are fixed (yes/no plus defer), so a catalog entry describes them exactly. Going through `DecisionService` gives evidence-mode gates the catalog's minConfidence, maker resolution and lifecycle events (caller `gate`).

**Rejected:** routing `select` gates through the catalog. Their options are per-request, and a catalog entry cannot declare them, so they stay on the legacy maker until the catalog supports runtime choices.

**Seams:**
- `packages/app/src/workflow/decision-hitl-responder.ts:371` (`evaluateEvidence`)
- `:442-447` (maker call)
- `:233` (`defaultDecisionMaker`)
- `packages/app/src/decision/decision-service.ts:182`
- `config/decisions/gates.yaml` (new)

**Invariants:**
- Evidence selection, the size bound and the summary envelope checks (`:378-433`) run before any decide, unchanged.
- A served default never yields `accepted`.
- `mode: never` gates are never evaluated.

**Execution budget:**
- About 3 source files and 1 YAML.
- `requireDiff: true`.
- No public surface change.

### Plan

1. Failure list:
   - A default `defer` is read as accepted.
   - A select gate is broken by the catalog path.
   - Oversized evidence reaches decide.
   - A `mode: never` gate calls a maker.
   - Events are missing runId/nodeId correlation.
2. Add `config/decisions/gates.yaml`. Check it with `spur decision show gate-evidence --json`.
3. Add the `decisionService` and `bus` deps, wire them in `workflow-service.ts:2044/2163`, and replace the confirm branch.
4. E2E, with a workflow fixture using an evidence-mode override on one confirm gate and no backend:
   - The run pauses (deferred to the operator).
   - `system_events` holds `gate-evidence` start/failure/end rows with caller `gate` and the run's runId.
   - The same fixture with `mode: never` writes no decision rows.
   - Save the results as `.spur/run/1099-gate.json`.
5. Gate: `bun run spur-check`.

### Solution

- `config/decisions/gates.yaml:1` (new): `gate-evidence` choice decision — criteria yes/no/defer, fallback `defer`, required params `prompt` (string), `evidence` (json), `node` (string). Serves at the upstream 0.7 confidence floor (R1 declares no override); verified with `decision show gate-evidence --json` (shared layer, effective maker `typesafe`).
- `packages/app/src/workflow/decision-hitl-responder.ts` (`evaluateEvidence` confirm branch `decision-hitl-responder.ts:455-500`, before the legacy maker call): when the request is `confirm` and `decisionService` is injected, decide through `DecisionService.decide('gate-evidence', { prompt, evidence: payload, node }, { bus, context: { caller: 'gate', correlation: { runId, nodeId } } })`. Mapping: `source === 'model'` with value `yes`/`no` → `accepted` (value + served confidence, unchanged evidence ids/digest/artifact); a `defer` value or any served fallback → `deferred` — explicit model defer keeps the D5 `explicit-defer` reason, served fallbacks carry the hub reason (`low-confidence`/`no-backend`/`timeout`/`error`), so a served default never yields `accepted`. `DecisionEvaluationDeps` gains `decisionService?`/`bus?` (`decision-hitl-responder.ts:76-78`); service throws (unknown id / duplicate catalog / unregistered maker) land in the existing catch → deferred `provider-unavailable` (fail closed to the operator, `decision.rejected` still emitted).
- `packages/app/src/services/workflow-service.ts` (`createEngineService` / `buildDecisionEvaluator`): the call passes the run bus (`workflow-service.ts:2046`, the same bus given as `observabilityBus`); `buildDecisionEvaluator` injects `decisionService: () => getDecisionService(...)` (`workflow-service.ts:2179`) and the bus (`workflow-service.ts:2182`) (ADR-044 structural-bridge cast, as decide.ts).
- Unchanged by design (R3/R4): `evaluateLegacy`, select gates, direct construction without a service, bundled `mode: never` gates, and all workflow YAML.

**Start condition (R5) — NOT met, overridden by batch order:** `decision status --reliability --json` on this worktree reports `evidence: none`, 0 samples for every group, and no `gate-evidence` group exists (no recorded samples anywhere). Implementation proceeds on the batch's explicit sequencing; the first real gate-evidence samples can only appear after this slice lands and an operator runs an evidence-mode override or `decision run gate-evidence`.

### Testing

- `packages/app/tests/workflow/decision-gate-catalog.test.ts` (new, 9 tests): catalog confirm path (decide id/input/context + accepted provenance with served confidence), explicit model defer → `explicit-defer`, every served fallback → deferred with the served reason (defaults never accepted), service rejection → deferred `provider-unavailable`, oversized evidence defers before any decide, never mode never decides, select gates and direct construction keep the legacy maker, and an integration test over the REAL bundled catalog + service + recording bus (no backend): `decision.start/failure/end` with caller `gate`, runId/nodeId correlation, shared layer, makerSource `catalog-default`, fallback value `defer`.
- E2E evidence: `.spur/run/1099-gate.json` (script `.spur/run/1099-gate-e2e.ts`) — evidence confirm + no backend pauses the run (answer cleared, `statusValue: 'deferred'`, reason `no-backend`) with the three decision events; `mode: never` writes no decision rows and hands to the operator; select writes no decision rows.
- Targeted: `bun test tests/workflow/decision-gate-catalog.test.ts tests/workflow/decision-evidence.test.ts tests/workflow/decision-hitl-responder.test.ts tests/workflow/builtins.test.ts tests/decision` — 71 + 9 pass. `tsc --noEmit` and `biome check` clean on changed files. Repo gate: `bun run spur-check` (see gate result below).
- `packages/app/tests/services/workflow-service.test.ts` (resume update): the evidence-mode workflow E2E now exercises the catalog path — env-var hygiene around `TYPESAFE_API_KEY` (as the catalog tests), the context-level legacy maker asserted untouched in both modes, and the retained registered summary proven by the served `no-backend` fallback (`data.decision` provenance) after scratch removal; `disabled` for the off branch.
- Final gate (resume): `bun run spur-check` EXIT=0 — 10361 pass / 0 fail across 604 files (the one pre-resume repo failure was this same evidence-mode workflow test, updated above to the 1099 contract).

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
