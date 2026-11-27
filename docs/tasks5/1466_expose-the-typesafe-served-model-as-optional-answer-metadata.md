---
schema_version: 1
name: Expose the TypeSafe served model as optional answer metadata in ts-ai-decision
status: done
template: feature-impl
created_at: 2026-11-27T07:35:45.741Z
updated_at: "2026-11-27T18:46:05.264Z"
feature_id: P12

estimate_hours: 4
priority: P2
done_forced: "false"
done_reason: unforced close
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

- [x] R1. `DecisionDriver` and `DecisionMaker` (ts-ai-runner) gain an **optional** `askWithMeta(req)` that returns `{ answers, servedModel?: string }`. The `ask` signatures are unchanged.
- [x] R2. `createDecisionMaker` implements `askWithMeta` by delegating to `driver.askWithMeta` when the driver has it, and otherwise to `driver.ask` with no `servedModel`. Answer validation is identical on both paths.
- [x] R3. The `typesafe` driver (ts-ai-decision) implements `askWithMeta` and sets `servedModel` from `SystemOneResult.model`. The R8 comment is updated to say `model` is surfaced only through `askWithMeta`; `usage` stays unsurfaced.
- [x] R4. `DecisionResultBase` gains optional `servedModel?: string`. The hub calls `maker.askWithMeta` when present, falls back to `maker.ask`, runs `validateAnswers` on the answers from either path (as `hub.ts:518-520` does today), and sets `servedModel` only on `source: 'model'` results.
- [x] R5. The fm-local, laya-local and llm-agent makers leave `servedModel` absent.
- [x] R6. The ts-libs gate (`bun run spur-check`) passes. Bump and publish wait for Robin's explicit authorization.

Out of scope: surfacing `usage`; Spur persistence (task 1467).

### Acceptance Criteria

- [x] AC1 — the decision library exposes the served model without breaking existing callers (req: R1; R2; R3; R4; R6) — unit (ts-libs): `packages/ai-runner/tests` proves a driver without `askWithMeta` keeps `ask` unchanged; `packages/ai-decision/tests` proves the typesafe driver with a stubbed `systemOne` (`model: 'm-x'`) yields `servedModel: 'm-x'` on an accepted hub result, validated answers on the `askWithMeta` path, and no `servedModel` on a fallback.
- [x] AC2 — non-typesafe makers leave the served model empty (req: R5) — unit (ts-libs): `packages/ai-decision/tests` proves fm-local, laya-local (stubbed driver) and llm-agent hub results carry no `servedModel`.

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

Scope note: the deliverable lives in the sibling ts-libs repo (`../ts-libs`, base `b0612dca`, both packages at 0.8.5). Citations outside this repo are root-relative with `../`. No bump or publish ran — that waits for Robin's authorization (R6).

| File | Change |
| --- | --- |
| `../ts-libs/packages/ai-runner/src/decision/types.ts:104-110` | New `DecisionAnswersMeta` (`answers` + optional `servedModel`). |
| `../ts-libs/packages/ai-runner/src/decision/types.ts:125-129` | `DecisionDriver.askWithMeta?` — optional, additive; `ask` is untouched. |
| `../ts-libs/packages/ai-runner/src/decision/decision-maker.ts:37-42` | `DecisionMaker.askWithMeta?` stays optional, so a maker object registered directly (hub test doubles) needs no new method. |
| `../ts-libs/packages/ai-runner/src/decision/decision-maker.ts:215-220` | `DecisionMakerWithMeta` — the factory's return type, so a caller that wants the model skips the presence check. |
| `../ts-libs/packages/ai-runner/src/decision/decision-maker.ts:259-273` | `createDecisionMaker` implements `askWithMeta`: prefer `driver.askWithMeta`, else `driver.ask`; one shared `validateAnswers`, and `servedModel` is omitted (not `undefined`-valued) when the driver reports none (R2). |
| `../ts-libs/packages/ai-decision/src/typesafe-driver.ts:58-61` | `TypesafeDriver` return type — the seam is always implemented here. |
| `../ts-libs/packages/ai-decision/src/typesafe-driver.ts:88-133` | The single request path `askOnce` returns `{answers, servedModel}` from `SystemOneResult.model`; `ask` drops the model, `askWithMeta` returns both, so mapping and validation cannot drift (R3). The R8 comment now says `model` surfaces only through `askWithMeta` and `usage` stays unsurfaced. |
| `../ts-libs/packages/ai-decision/src/hub.ts:111-117` | `DecisionResultBase.servedModel?`, populated only on accepted `source: 'model'` results (R4). |
| `../ts-libs/packages/ai-decision/src/hub.ts:521-530` | `askOne` prefers `maker.askWithMeta`, falls back to `maker.ask`, and runs the existing `validateAnswers` on the answers from either path. |
| `../ts-libs/packages/ai-runner/tests/decision/ask-with-meta.test.ts:1-120` | New suite: driver without the seam yields no `servedModel`; a meta driver contributes one; `ask` keeps its Answer-record shape; `askWithMeta` rejects invalid answers identically to `ask`. |
| `../ts-libs/packages/ai-decision/tests/served-model.test.ts:1-200` | New suite: typesafe driver reports the wire's model; an accepted hub result carries it; a low-confidence fallback and an invalid-answer fallback carry none; `createFmDriver`/`createAgentDriver` have no seam and fm-local/laya-local/llm-agent hub results carry no `servedModel` (R5). |
| `../ts-libs/packages/ai-decision/tests/output/hub-e2e-transcript.json:163-173` | The tracked e2e artifact's "parameterless decision" row gains `servedModel: "stub"` — a real typesafe driver over a stub fetch now reports the model, which is exactly the behaviour change R4 introduces. Byte-reproducible: the suite regenerates the same row. |

Rationale: `ask` is unchanged in signature and return shape, so no existing caller or custom driver breaks (the Q&A's rejected alternatives — a breaking `{answers, meta}` and a symbol stashed on the answers object — stay rejected). Requested-vs-served stays honest: only the model TypeSafe echoes back is reported, never the configured one.

Real proof (Plan step 4): a hub over a stub TypeSafe client with `model: 'served-m-42'` printed
`{"source":"model","reason":"accepted","value":"alpha","servedModel":"served-m-42"}`.

Gate (R6): `cd ../ts-libs && bun run spur-check` → `3302 pass, 0 fail` (lint + typecheck + test-pre-check + full suite + test-post-check).
probe: not-applicable (no public CLI/HTTP surface changed — library seam only).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `../ts-libs/packages/ai-runner/src/decision/types.ts:104-110` adds `DecisionAnswersMeta`; `:125-129` adds the OPTIONAL `DecisionDriver.askWithMeta?`; `ask` is byte-identical in signature and body. `../ts-libs/packages/ai-runner/src/decision/decision-maker.ts:37-42` adds the same seam to `DecisionMaker` as optional, and `../ts-libs/packages/ai-runner/tests/decision/ask-with-meta.test.ts:51` proves `ask` still returns the plain Answer record. |
| R2 | MET | `../ts-libs/packages/ai-runner/src/decision/decision-maker.ts:259-273` prefers `driver.askWithMeta` and falls back to `driver.ask` with no model, both through one `validateAnswers` call; `servedModel` is omitted (never `undefined`-valued). `../ts-libs/packages/ai-runner/tests/decision/ask-with-meta.test.ts:36` (no-seam driver, `Object.keys(meta)` = `['answers']`), `:44` (seam contributes), `:58` (same rejection class and message on both paths). |
| R3 | MET | `../ts-libs/packages/ai-decision/src/typesafe-driver.ts:88-133` folds both entries onto one `askOnce`; `servedModel` comes from `SystemOneResult.model` and is omitted when the backend echoes nothing; the R8 comment now scopes `model` to `askWithMeta` and keeps `usage` unsurfaced. `../ts-libs/packages/ai-decision/tests/served-model.test.ts:107` asserts `servedModel: 'm-x'` from the wire and that `ask` surfaces no model. |
| R4 | MET | `../ts-libs/packages/ai-decision/src/hub.ts:111-117` adds `DecisionResultBase.servedModel?`; `:521-530` calls `maker.askWithMeta` when it is a function and falls back to `maker.ask`, then runs the existing `validateAnswers` on either path; `:573` spreads `servedModel` only into the accepted `source: 'model'` base. `../ts-libs/packages/ai-decision/tests/served-model.test.ts:128` (accepted carries `m-x`), `:135` (low-confidence fallback carries none), `:143` (invalid answers through the seam become the hub's `error` fallback, so validation really ran). |
| R5 | MET | `../ts-libs/packages/ai-decision/tests/served-model.test.ts:160` asserts `createFmDriver({}).askWithMeta` and `createAgentDriver({}).askWithMeta` are `undefined`; `:165` drives fm-local, laya-local and llm-agent makers through the hub and gets no `servedModel` key. |
| R6 | MET | `cd ../ts-libs && bun run spur-check` → `3302 pass, 0 fail` (lint + typecheck + test-pre-check + full suite + test-post-check). No version bump, no publish. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — the decision library exposes the served model without breaking existing callers (req: R1; R2; R3; R4; R6) | MET | test | `../ts-libs/packages/ai-runner/tests/decision/ask-with-meta.test.ts:36` (no-seam driver unchanged, no `servedModel`) and `../ts-libs/packages/ai-decision/tests/served-model.test.ts:107` / `:128` / `:135` / `:143` (stubbed `systemOne` model `m-x` → `servedModel` on an accepted hub result, validated answers through the seam, none on either fallback); gate `bun run spur-check` 3302 pass / 0 fail. |
| AC2 — non-typesafe makers leave the served model empty (req: R5) | MET | test | `../ts-libs/packages/ai-decision/tests/served-model.test.ts:160` and `:165` — fm-local and llm-agent drivers expose no seam and all three makers' hub results carry no `servedModel`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

P1 (blocker): none.

P2 (major): none.

P3 (minor): none open.

P4 (advisory): the ts-libs gate `bun run spur-check` is load-sensitive — its `scripts/` suites spawn subprocesses under bun's 5 s per-test default, so a first run under a heavily loaded host reported 17 timeout-shaped failures that a re-run on an idle host cleared (`3302 pass, 0 fail`). Not caused by this diff (none of those tests import the changed packages), but worth knowing before reading a red gate as a finding.

P4 (advisory): `../ts-libs/packages/ai-decision/tests/output/hub-e2e-transcript.json` gained `servedModel: "stub"` on the "parameterless decision" row. That is a required consequence of R4 (the row is produced by a real typesafe driver over a stub fetch), and the row is byte-reproducible — but it does edit recorded e2e evidence, so it is called out rather than buried in the diff.

Residual risk: `servedModel` reports what the backend echoes, so a backend that reports nothing (a local process, an agent CLI) reads identically to a fallback — consumers must branch on `source === 'model'`, which the tests pin. Bump and publish (expected 0.8.6) stay unauthorized; task 1472/1467's catalogs keep pointing at 0.8.5 until the operator authorizes the release.

Disposition: PASS — additive seam (`ask` untouched), one request path in the typesafe driver so mapping/validation cannot drift, hub validation shared across both entries, non-typesafe makers verified to carry no model, ts-libs gate green.

### References

- `@gobing-ai/ts-ai-runner` `src/decision/types.ts:104`, `src/decision/decision-maker.ts:23,234`
- `@gobing-ai/ts-ai-decision` `src/typesafe-driver.ts:80-108`, `src/hub.ts:95,516`
- Feature P12; task 1456 (cross-repo precedent)

### History

- 2026-11-27T07:54:33.342Z backlog → todo (system)
- 2026-11-27T18:45:07.608Z todo → wip (system)
- 2026-11-27T18:45:59.572Z wip → testing (system)
- 2026-11-27T18:46:05.257Z testing → done (system)

