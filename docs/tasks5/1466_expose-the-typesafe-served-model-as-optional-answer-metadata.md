---
schema_version: 1
name: Expose the TypeSafe served model as optional answer metadata in ts-ai-decision
status: todo
template: feature-impl
created_at: 2026-11-27T07:35:45.741Z
updated_at: "2026-11-27T16:54:58.131Z"
feature_id: P12

estimate_hours: 4
priority: P2
---

## 1466. Expose the TypeSafe served model as optional answer metadata in ts-ai-decision

### Background

Feature P12 R3: the decision library must expose the model that actually served each answer, without breaking existing callers. Today that model is discarded, and the work spans two ts-libs packages (v0.8.5, `../ts-libs`):

- `@gobing-ai/ts-ai-runner` `src/decision/types.ts:104`: `DecisionDriver.ask(req)` returns `Promise<Record<string, Answer>>` only.
- `src/decision/decision-maker.ts:23`: `DecisionMaker.ask` returns `AnswersFor<Q>`. At `:234` it calls `driver.ask(req)`.
- `@gobing-ai/ts-ai-decision` `src/typesafe-driver.ts:80-108`: `ask` calls `client.systemOne`, whose `SystemOneResult` carries `.model`, then drops it. The comment reads "R8: `model` and `usage` on the result are deliberately not surfaced".
- `src/hub.ts:516`: `const answers = await maker.ask(request);`. `DecisionResultBase` (`src/hub.ts:95`) has no model field.

Precedent from cross-repo task 1456: do the work in ts-libs and run its gates, then stop before bump/publish for Robin's authorization.

**Refine corrections (2026-11-27)**

- Package directories implied by the names `ts-ai-runner` / `ts-ai-decision` → the real paths are `../ts-libs/packages/ai-runner/` and `../ts-libs/packages/ai-decision/` (both 0.8.5) → Plan and References use the real paths.
- Line refs → verified: `createDecisionMaker` at `ai-runner/src/decision/decision-maker.ts:204`, `driver.ask` at `:234`, `DecisionDriver.ask` at `types.ts:~104`, typesafe `ask` at `ai-decision/src/typesafe-driver.ts:80-108` (R8 comment `~:99`), `maker.ask` at `hub.ts:516`, `DecisionResultBase` at `hub.ts:95`; SDK `SystemOneResult.model: string` (`@typesafe-ai/sdk` `dist/index.d.mts:171`) → premise holds.
- R4 omitted that the hub calls `validateAnswers(request.questions, answers)` after `maker.ask` (`hub.ts:518-520`) → the `askWithMeta` path must validate `result.answers` the same way; added to R4.
- R5 named only fm-local and llm-agent → the registry also pre-registers `laya-local` (`ai-decision/src/registry.ts:138-149`) → R5 covers all three non-typesafe makers.
- Plan step 3 "lint, typecheck, test" → the ts-libs gate is `bun run spur-check` (`lint && test-pre-check && test && test-post-check`; `lint` includes typecheck) → Plan uses it.
- AC rows used the non-canonical `R<n> —` form → rewritten as `AC<n> — … (req: …)` with test layers.

### Requirements

- [ ] R1. `DecisionDriver` and `DecisionMaker` (ts-ai-runner) gain an **optional** `askWithMeta(req)` that returns `{ answers, servedModel?: string }`. The `ask` signatures are unchanged.
- [ ] R2. `createDecisionMaker` implements `askWithMeta` by delegating to `driver.askWithMeta` when the driver has it, and otherwise to `driver.ask` with no `servedModel`. Answer validation is identical on both paths.
- [ ] R3. The `typesafe` driver (ts-ai-decision) implements `askWithMeta` and sets `servedModel` from `SystemOneResult.model`. The R8 comment is updated to say `model` is surfaced only through `askWithMeta`; `usage` stays unsurfaced.
- [ ] R4. `DecisionResultBase` gains optional `servedModel?: string`. The hub calls `maker.askWithMeta` when present, falls back to `maker.ask`, runs `validateAnswers` on the answers from either path (as `hub.ts:518-520` does today), and sets `servedModel` only on `source: 'model'` results.
- [ ] R5. The fm-local, laya-local and llm-agent makers leave `servedModel` absent.
- [ ] R6. The ts-libs gate (`bun run spur-check`) passes. Bump and publish wait for Robin's explicit authorization.

Out of scope: surfacing `usage`; Spur persistence (task 1467).

### Acceptance Criteria

- [ ] AC1 — the decision library exposes the served model without breaking existing callers (req: R1; R2; R3; R4; R6) — unit (ts-libs): `packages/ai-runner/tests` proves a driver without `askWithMeta` keeps `ask` unchanged; `packages/ai-decision/tests` proves the typesafe driver with a stubbed `systemOne` (`model: 'm-x'`) yields `servedModel: 'm-x'` on an accepted hub result, validated answers on the `askWithMeta` path, and no `servedModel` on a fallback.
- [ ] AC2 — non-typesafe makers leave the served model empty (req: R5) — unit (ts-libs): `packages/ai-decision/tests` proves fm-local, laya-local (stubbed driver) and llm-agent hub results carry no `servedModel`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:54:02.757Z

- **Q: Change `ask` to return `{answers, meta}`?** A: No. It breaks every direct caller and custom driver. An optional sibling method is additive.
- **Q: Attach the model as a symbol on the answers object?** A: No. That is hidden coupling, and it does not survive spread/validation copies.
- **Q: Report the requested model or the served model?** A: The served model, exactly as TypeSafe returns it. Requested and served can differ under routing.
- **Q: Set `servedModel` on fallback results too?** A: No. A fallback has no served answer, so only `source: 'model'` carries it.

#### Q&A entry — 2026-11-27 (refine, depth=ready)

- **Q: Does `laya-local` need handling?** A: Yes, as a non-typesafe maker: it leaves `servedModel` absent and gets a test case (R5).
- **Q: Where does answer validation run on the new path?** A: In the hub, on the answers from either `askWithMeta` or `ask`, unchanged in behaviour.

### Design

- **Chosen:** an optional `askWithMeta` on the driver and maker, with the hub preferring it, and an optional `servedModel` on `DecisionResultBase`.
- **Rejected:** a breaking `ask` return shape; a per-instance "last model" field, which races under concurrent asks.
- **Frozen names:** `askWithMeta`, `servedModel`.
- **Invariants:** every existing `ask` caller compiles and behaves the same; `servedModel` is absent unless a driver reported one.
- **Anti-patterns:** inferring the model from config when the driver did not report it.
- **Handoff:** Robin authorizes the ts-libs release (expected 0.8.6). Task 1467 then bumps the Spur catalog.

### Plan

1. Failure modes first (ts-libs tests, under `packages/ai-runner/tests` and `packages/ai-decision/tests`):
   - (a) a driver without `askWithMeta` yields no `servedModel`, and `ask` is unchanged;
   - (b) the typesafe driver with a stubbed `systemOne` returning `model: 'm-x'` yields `servedModel: 'm-x'` on an accepted hub result;
   - (c) a low-confidence fallback carries no `servedModel`;
   - (d) invalid answers returned through `askWithMeta` are rejected by `validateAnswers` exactly as through `ask`;
   - (e) the fm-local, laya-local and llm-agent makers carry none.
2. Implement `askWithMeta` in `packages/ai-runner` (`src/decision/types.ts`, `createDecisionMaker` at `decision-maker.ts:204`), then the typesafe driver (`packages/ai-decision/src/typesafe-driver.ts`), then the hub (`hub.ts:516-520`).
3. Run the ts-libs gate from `../ts-libs`: `bun run spur-check`.
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

