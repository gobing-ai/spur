---
schema_version: 1
name: Expose the TypeSafe served model as optional answer metadata in ts-ai-decision
status: todo
template: feature-impl
created_at: 2026-11-27T07:35:45.741Z
updated_at: "2026-11-27T07:54:33.342Z"
feature_id: P12

estimate_hours: 4
---

## 1466. Expose the TypeSafe served model as optional answer metadata in ts-ai-decision

### Background

Feature P12 R3: the decision library must expose the model that actually served each answer, without breaking existing callers. Today that model is discarded, and the work spans two ts-libs packages (v0.8.5, `../ts-libs`):

- `@gobing-ai/ts-ai-runner` `src/decision/types.ts:104`: `DecisionDriver.ask(req)` returns `Promise<Record<string, Answer>>` only.
- `src/decision/decision-maker.ts:23`: `DecisionMaker.ask` returns `AnswersFor<Q>`. At `:234` it calls `driver.ask(req)`.
- `@gobing-ai/ts-ai-decision` `src/typesafe-driver.ts:80-108`: `ask` calls `client.systemOne`, whose `SystemOneResult` carries `.model`, then drops it. The comment reads "R8: `model` and `usage` on the result are deliberately not surfaced".
- `src/hub.ts:516`: `const answers = await maker.ask(request);`. `DecisionResultBase` (`src/hub.ts:95`) has no model field.

Precedent from cross-repo task 1456: do the work in ts-libs and run its gates, then stop before bump/publish for Robin's authorization.

### Requirements

- [ ] R1. `DecisionDriver` and `DecisionMaker` (ts-ai-runner) gain an **optional** `askWithMeta(req)` that returns `{ answers, servedModel?: string }`. The `ask` signatures are unchanged.
- [ ] R2. `createDecisionMaker` implements `askWithMeta` by delegating to `driver.askWithMeta` when the driver has it, and otherwise to `driver.ask` with no `servedModel`. Answer validation is identical on both paths.
- [ ] R3. The `typesafe` driver (ts-ai-decision) implements `askWithMeta` and sets `servedModel` from `SystemOneResult.model`. The R8 comment is updated to say `model` is surfaced only through `askWithMeta`; `usage` stays unsurfaced.
- [ ] R4. `DecisionResultBase` gains optional `servedModel?: string`. The hub calls `maker.askWithMeta` when present, falls back to `maker.ask`, and sets `servedModel` only on `source: 'model'` results.
- [ ] R5. The fm-local and llm-agent makers leave `servedModel` absent.
- [ ] R6. Both packages' gates pass. Bump and publish wait for Robin's explicit authorization.

Out of scope: surfacing `usage`; Spur persistence (task 1467).

### Acceptance Criteria

- [ ] R3 — the decision library exposes the served model without breaking existing callers
- [ ] R2 — non-typesafe makers leave the served model empty

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:54:02.757Z

- **Q: Change `ask` to return `{answers, meta}`?** A: No. It breaks every direct caller and custom driver. An optional sibling method is additive.
- **Q: Attach the model as a symbol on the answers object?** A: No. That is hidden coupling, and it does not survive spread/validation copies.
- **Q: Report the requested model or the served model?** A: The served model, exactly as TypeSafe returns it. Requested and served can differ under routing.
- **Q: Set `servedModel` on fallback results too?** A: No. A fallback has no served answer, so only `source: 'model'` carries it.

### Design

- **Chosen:** an optional `askWithMeta` on the driver and maker, with the hub preferring it, and an optional `servedModel` on `DecisionResultBase`.
- **Rejected:** a breaking `ask` return shape; a per-instance "last model" field, which races under concurrent asks.
- **Frozen names:** `askWithMeta`, `servedModel`.
- **Invariants:** every existing `ask` caller compiles and behaves the same; `servedModel` is absent unless a driver reported one.
- **Anti-patterns:** inferring the model from config when the driver did not report it.
- **Handoff:** Robin authorizes the ts-libs release (expected 0.8.6). Task 1467 then bumps the Spur catalog.

### Plan

1. Failure modes first (ts-libs tests):
   - (a) a driver without `askWithMeta` yields no `servedModel`, and `ask` is unchanged;
   - (b) the typesafe driver with a stubbed `systemOne` returning `model: 'm-x'` yields `servedModel: 'm-x'` on an accepted hub result;
   - (c) a low-confidence fallback carries no `servedModel`;
   - (d) the fm-local and agent makers carry none.
2. Implement `askWithMeta` in ts-ai-runner (types plus `createDecisionMaker`), then the typesafe driver, then the hub.
3. Run the ts-libs gates for both packages: lint, typecheck, test.
4. Real proof: in ts-libs, one `hub.decide` against a stub TypeSafe client prints `servedModel`.
5. Stop and request bump/publish authorization. Record the evidence in Solution.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `@gobing-ai/ts-ai-runner` `src/decision/types.ts:104`, `src/decision/decision-maker.ts:23,234`
- `@gobing-ai/ts-ai-decision` `src/typesafe-driver.ts:80-108`, `src/hub.ts:95,516`
- Feature P12; task 1456 (cross-repo precedent)

### History

- 2026-11-27T07:54:33.342Z backlog → todo (system)

