---
schema_version: 1
name: "Fix clef DecisionMaker: the hub passes state null and Cloudflare rejects the request with 422"
status: todo
template: standard
created_at: 2026-10-13T18:11:35.494Z
updated_at: "2026-10-13T18:23:20.591Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 2
feature_id: P1
---

## 1195. Fix clef DecisionMaker: the hub passes state null and Cloudflare rejects the request with 422

### Background

Found by dogfooding the DecisionMaker enablement (2026-10-13) while running real workflow decisions
with `decisions.makers.task-triage: clef`.

`clef` is the only maker that never answers on any real decision. Every invocation degrades to the
declared fallback with `reason: error` (or `low-confidence` when the failure happens after a
degraded retry), and `spur decision status --probe` reports `✗ unclear via errored`.

**Reproduction and evidence (no guesswork, all re-runnable):**

```
spur decision run maker-liveness --maker clef --json
  {"maker":"clef","source":"default","reason":"error","value":"unclear","confidence":null}

# direct driver call with a state payload works
bun -e '... createClefDriver({accountId,apiToken}).ask({state:{}, questions:{...}})'
  OK {"q":{"kind":"choice","label":"no","confidence":0.7897,...}}

# the shape the hub actually sends is rejected by the backend
curl -s -X POST ".../ai/run/@cf/cloudflare/clef-flash" -d '{"model":"clef-flash","state":null,"questions":{...}}'
  HTTP 422  AiError: Request body failed validation
            fieldErrors: {"state":["Input should be a valid string","Input should be a valid dictionary","Input should be a valid list"]}
# same request with "state":{} -> HTTP 200 with a real answer
```

The hub sends `state: null` when the decision declares no parameter beside `instructions`
(`packages/app/node_modules/@gobing-ai/ts-ai-decision/dist/hub.js:154-160` — `buildState(...)` returns
null for a parameterless decision), and `@gobing-ai/ts-decision-clef` (0.5.24) forwards it verbatim
(`dist/driver.js:212`). Cloudflare's Workers AI Clef endpoint requires `state` to be a string,
dictionary or list — `null` fails request-body validation, so the driver maps it to
`DecisionRequestError` and the hub to the declared fallback.

**This is the same defect class as the already-fixed `typesafe` case.** `docs/design/decision-catalog.md`
§5 records it for TypeSafe: "the hub sends `state: null` when a decision declares no parameter beside
`instructions`, the SDK drops the null field, and TypeSafe answers `422 state: Field required` ...
Fixed in `ts-libs` (`typesafe-driver`: the same null→`''` mapping the laya and fm drivers already
apply) but not yet released". So `fm-local` and `laya-local` already normalize null→`''` and work;
`typesafe` was fixed upstream; **`clef` was missed**.

**Impact.** `clef` is registered and shows as healthy in `spur decision status` (`✓ clef ...
SERVES 1`), so a per-decision route to it (`decisions.makers.task-triage: clef`, set by the same
dogfood) silently converts a real decision into a permanent fallback. In the task-pipeline that means
`task-triage` can never return `low`, so the fast lane is unreachable for any diff. A configured,
healthy-looking maker that can never answer is worse than an unregistered one, because the readiness
report says it is fine.

**Two candidate fixes (the implementer picks, with evidence):**
1. Spur-side, in the maker wrapper this repo owns (`packages/app/src/decision/decision-service.ts`,
   alongside the existing `clefCredentials` gating): normalize a null `state` to `''` before the
   driver forwards it — matching what the laya/fm/typesafe drivers already do.
2. Upstream in `@gobing-ai/ts-decision-clef` (ts-libs): apply the same null→`''` mapping inside
   `createClefDriver`, then bump the catalog pin. Preferred if a ts-libs change is in scope, because
   the defect is the driver's, not the caller's.

### Requirements

- [ ] R1. Decide and implement the normalization (Spur-side wrapper or the upstream driver) so a parameterless catalog decision served by `clef` reaches the backend and returns `source: model`.
- [ ] R2. Add a regression check that fails today: a parameterless decision (e.g. `maker-liveness`) served by `clef` must not report `reason: error`.
- [ ] R3. Make the readiness surface honest: if a registered maker cannot answer for any parameterless decision, `spur decision status` must not present it as healthy.
- [ ] R4. No new public surface; keep the degraded-fallback contract for genuine backend failures.

### Acceptance Criteria

```gherkin
Declared: `ac_altitude: task-local`, `ac_numbering: task-local` (no feature_id; regression criteria owned by this task).

Scenario: AC1 — stateless ask reaches the wire as empty-string state (req: R1, R2)
Given a clef driver built with valid options and an injected fetch capturing the POST body,
When `ask()` is called with no `state` (undefined) and again with explicit `state: null`,
Then each captured wire body has `state === ''` while `model` and `questions` are unchanged.

Scenario: AC2 — structured state passes through unchanged (req: R1, R2)
Given a call with structured state `{ context: 'test' }`,
When `ask()` runs,
Then the captured wire `state` equals `{ context: 'test' }` (regression: existing assertion in `ts-libs/packages/decision-clef/tests/driver.test.ts:193` stays green).

Scenario: AC3 — spur-new consumes the fixed release (req: R3)
Given ts-libs publishes the patched patch release and spur-new's catalog pins it,
When `bun install` runs in spur-new,
Then the installed `ts-decision-clef` dist maps absent state to `''` and `bun run build` plus the decision-service tests (`packages/app/tests/decision/decision-service.test.ts`) pass.

Scenario: AC4 — a clef-served answer derives its HIGH/MEDIUM/LOW level (req: R4)
Given the fixed clef driver parses a successful answer envelope whose answer carries confidence c,
When that answer flows through the existing derivation seams (`confidenceLevel()` at `packages/app/src/workflow/decide.ts:154` for the receipt and `packages/app/src/decision/decision-log-query.ts:140` for the log row),
Then c ≥ 0.8 reads HIGH, c ≥ 0.5 reads MEDIUM, anything lower reads LOW, and an absent or out-of-[0,1] confidence reads LOW (fail-conservative).

Test observability: AC1/AC2 are observed in `ts-libs/packages/decision-clef/tests/driver.test.ts` through the injected-fetch wire capture (the real POST body, no network mock of the behavior under test). AC3 is observed via the installed dist in spur-new's tree plus build/tests. AC4 is observed by a spur-new integration case chaining the injected-fetch clef driver through `createDecisionMaker` into the decide receipt — the full parse → validate → derive chain minus network; the thresholds themselves are already pinned by `packages/app/tests/workflow/actions/decide-catalog.test.ts:170-217` with stub makers. The live 422 itself is env-gated (requires real Cloudflare credentials) and is not asserted by any AC; see Plan step 6 for the optional live confirmation.
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-13T18:17:43.683Z

- CLOSED (2026-10-13): fix location — `ts-libs/packages/decision-clef` driver, not the spur-new hub. Reason: the null reaches the wire from the driver's own `state ?? null` mapping regardless of caller; repo policy fixes released `@gobing-ai/ts-*` engines rather than adding Spur workarounds; the typesafe driver in `ts-ai-runner` already fixed the same defect in the same layer.
- CLOSED (2026-10-13): mapping value — `state ?? ''`. Reason: proven accepted by the same Cloudflare API by the typesafe driver since its fix; `''` also matches what laya/fm paths send for "no context" per the typesafe comment. Rejected: omitting the field (the API still treats it as missing-required → 422) and defaulting hub state to `{}` (masks the driver bug; other callers still 422).
- CLOSED (2026-10-13): delivery path — patch release of `ts-decision-clef` (0.5.24 → 0.5.25, or next patch at release time), then spur-new root catalog bump + `bun install`.
- DEFERRED: live-account probe confirmation (needs an environment with real clef credentials). Condition: one maker-liveness probe run by the operator after the bump; wire-level AC1/AC2 do not depend on it.

- CLOSED (2026-10-13, operator request): confidence-level verification added (R4/AC4). The HIGH/MEDIUM/LOW vocabulary and thresholds already exist and are unit-tested (`packages/app/src/decision/confidence-level.ts`, `packages/app/tests/decision/confidence-level.test.ts`, seam tests `packages/app/tests/workflow/actions/decide-catalog.test.ts:170-217`); what the 422 bug blocked is any clef answer reaching those seams. This task therefore verifies the clef→level path only — no new mapping code, thresholds stay 0.8/0.5, driver answers keep carrying numeric confidence.

### Design

**WHAT** — one wire-mapping line in the clef driver plus its regression test, then release, consume the patch, and verify the confidence-level derivation on the reopened clef path.

**WHY** — Cloudflare's Workers AI REST endpoint drops a `null` state field and answers 422 "state: Field required" (documented from the identical, already-fixed defect in `ts-libs/packages/ai-runner/src/decision/typesafe-driver.ts:73-83`). The neutral driver contract legitimately allows `null` state in-memory; only the wire shape is wrong. The 422 also meant no clef answer ever reached the HIGH/MEDIUM/LOW derivation, so that path needs verification, not new code.

**WHERE** (primary targets)
- `ts-libs/packages/decision-clef/src/driver.ts:295` — `state: state ?? null` → `state: state ?? ''`.
- `ts-libs/packages/decision-clef/tests/driver.test.ts` — wire-capture assertions (AC1/AC2); the injected-fetch harness already captures the body (`tests/driver.test.ts:61-72`).
- `spur-new/package.json` — root `workspaces.catalog` entry `"@gobing-ai/ts-decision-clef": "^0.5.24"` → `^0.5.25`; then `bun.lock`.
- `packages/app/tests/decision/decision-service.test.ts` — new AC4 integration case (clef driver → `createDecisionMaker` → decide receipt level); derivation seams read-only: `packages/app/src/workflow/decide.ts:154`, `packages/app/src/decision/decision-log-query.ts:140`.

**Frozen names** — body field `state`; mapping expression `state ?? ''`; level vocabulary `HIGH | MEDIUM | LOW` with thresholds `CONFIDENCE_HIGH_THRESHOLD = 0.8`, `CONFIDENCE_MEDIUM_THRESHOLD = 0.5` (`packages/app/src/decision/confidence-level.ts:17-21`); no new types, flags, env vars, or API surface; driver `ask()` signature unchanged. No new API.

**Precedence/algorithm** — state mapping: `undefined`/`null` → `''`; any structured JSON value (already validated by `assertJsonSerializable`, driver.ts:287) passes through. Level derivation is existing code and total: absent, NaN or out-of-[0,1] confidence → LOW.

**Anti-patterns (do not implement)**
- Do not default hub state or `buildState` to `{}`/`''` — masks the driver defect; non-hub callers still 422.
- Do not conditionally omit the `state` key — the API treats a missing field as missing-required and still 422s.
- Do not add a Spur-side shim in `packages/app` — engine fixes belong in the released package (AGENTS.md reuse policy).
- Do not duplicate the level thresholds in the driver or tests — import/reuse `confidenceLevel()`; driver answers carry numeric confidence only.

**Handoff/dependencies** — single-owner ordered chain: ts-libs change+test+publish must precede the spur-new catalog bump. No spur `dependencies[]` edges (cross-repo precondition lives in Plan ordering).

### Plan

1. Confirm the reproducibility chain (probe, direct driver ask, curl with state:null vs state:{}).
2. Implement the normalization at the chosen layer.
3. Re-run `spur decision run maker-liveness --maker clef --json` and `spur decision status --probe`.
4. Re-run the task-pipeline triage with `decisions.makers.task-triage: clef` and confirm a real answer reaches the lane decision.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `ts-libs/packages/decision-clef/src/driver.ts:295` — defective wire mapping (`state: state ?? null`), 0.5.24.
- `ts-libs/packages/ai-runner/src/decision/typesafe-driver.ts:73-83` — the same defect, its 422 "state: Field required" evidence, and the `state ?? ''` fix this task ports.
- `ts-libs/packages/ai-decision/src/params.ts:165` — `buildState` returns `Record<string, Json> | null` (hub can produce null state).
- `spur-new/packages/app/src/decision/decision-service.ts:184,239-241,516` — probe passes no state; clef maker registration; hub routing.
- `spur-new/packages/app/node_modules/@gobing-ai/ts-decision-clef/dist/driver.js:213` — installed 0.5.24 dist with the defect.
- `spur-new/packages/app/tests/decision/decision-service.test.ts` — decision-service tests (AC3 gate).
- ts-libs feature `A3_cloudflare-clef-decision-backend-in-ts-decision-clef.md` + `docs/design/decision-clef-backend.md` — backend contract (body `{ model, state, questions }`; null is JSON-serializable in-memory).

### History

- 2026-10-13T18:18:40.112Z backlog → todo (system)

