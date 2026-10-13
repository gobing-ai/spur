---
schema_version: 1
name: "Fix clef DecisionMaker: the hub passes state null and Cloudflare rejects the request with 422"
status: todo
template: standard
created_at: 2026-10-13T18:11:35.494Z
updated_at: "2026-10-13T19:04:33.466Z"

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

**Refine corrections (2026-10-13, ready re-audit)**

- "Two candidate fixes (the implementer picks)" → Q&A already closed the location as the upstream `ts-decision-clef` driver → Requirements/Plan now state the chosen layer; the Spur-side wrapper option is rejected (see Design anti-patterns).
- Design WHY "the wire drops a null field and answers 422 `state: Field required`" → that wording is the TypeSafe SDK case (`ts-libs/packages/ai-runner/src/decision/typesafe-driver.ts:73-83`). The clef evidence above shows the explicit `"state":null` reaching Cloudflare and failing with `Input should be a valid string / dictionary / list` → WHY rewritten to the clef evidence; the fix (`state ?? ''`) is the same.
- Installed dist line `dist/driver.js:212` → `packages/app/node_modules/@gobing-ai/ts-decision-clef/dist/driver.js:213` (`state: state ?? null`, 0.5.24); source `ts-libs/packages/decision-clef/src/driver.ts:295` confirmed.
- R3 "make `spur decision status` honest" had no AC (AC3 cited R3 but tests release consumption) → `status` never calls a backend by design (`packages/app/src/decision/decision-service.ts:219`, probe hub "never by `status`"), and `status --probe` already reports clef `✗ … errored` (Background evidence), so the probe surface is truthful today → R3 restated: no new readiness logic; after the bump the probe flips to `✓` (operator-run live check, deferred).
- R4 "no new public surface" was cited by AC4, which is about confidence levels → requirements renumbered: R4 = no new surface + degraded-fallback contract, R5 = clef answer derives its level.
- AC note "(no feature_id …)" → frontmatter carries `feature_id: P1` (P1 `verifying`) → note corrected; refine does not write `feature_id`; `ac_altitude: task-local` keeps the AC valid.
- AC4 cited `decide-catalog.test.ts:170-217` → shifted by `eb57f0a40`; level assertions are now at `:172-173` and `:263` → cited by content. `decision-service.test.ts` cannot inject a fetch (clef options come from env via `clefCredentials`, `decision-service.ts:678`) → AC4 observed in `packages/app/tests/workflow/actions/decide.test.ts` with an injected-fetch clef driver passed as `decisionMaker`.
- Publishing the ts-libs patch is an external action → Plan carries an explicit operator gate before publish.

### Requirements

- [ ] R1. `createClefDriver().ask()` sends `state: ''` on the wire when the caller's `state` is `null` or `undefined`; the fix lives in `ts-libs/packages/decision-clef/src/driver.ts` (upstream driver, not Spur).
- [ ] R2. A regression test in `ts-libs/packages/decision-clef/tests/driver.test.ts` fails on 0.5.24 (`state: null` on the wire) and passes after the fix; structured state still passes through unchanged.
- [ ] R3. spur-new consumes the patched release: root `workspaces.catalog` pins `@gobing-ai/ts-decision-clef` to the new patch and the installed dist maps absent state to `''`. No new readiness logic in `spur decision status`; the existing `--probe` is the truth surface.
- [ ] R4. No new public surface (types, flags, env vars, driver signature); genuine backend failures still degrade to the declared fallback.
- [ ] R5. A clef answer with confidence c flows through the existing derivation to HIGH (c ≥ 0.8) / MEDIUM (c ≥ 0.5) / LOW otherwise; absent or out-of-[0,1] → LOW.

Out of scope: hub/`buildState` changes; omitting the `state` key; a Spur-side shim in `packages/app`; changing the level thresholds; changing `status` to call backends. Live 422/200 confirmation is env-gated and deferred to the operator.

### Acceptance Criteria

Declared: `ac_altitude: task-local`, `ac_numbering: task-local` (regression criteria owned by this task; `feature_id: P1` is present but the scenarios are not P1 ship scenarios).

```gherkin
Scenario: AC1 — stateless ask reaches the wire as empty-string state (req: R1, R2)
  Given a clef driver built with valid options and the injected-fetch recorder in `driver.test.ts`
  When `ask()` is called with `state: null` and again with `state` omitted
  Then each captured wire body has `state === ''` while `model` and `questions` are unchanged

Scenario: AC2 — structured state passes through unchanged (req: R1, R2)
  Given a call with structured state `{ context: 'test' }`
  When `ask()` runs
  Then the captured wire `state` equals `{ context: 'test' }` (existing assertion in "default route is clef-flash and the body model matches the route" stays green)

Scenario: AC3 — spur-new consumes the fixed release (req: R3, R4)
  Given ts-libs has published the patched `@gobing-ai/ts-decision-clef` and spur-new's root catalog pins it
  When `bun install` runs in spur-new
  Then `packages/app/node_modules/@gobing-ai/ts-decision-clef/dist/driver.js` contains `state ?? ''`
  And `bun run build` and `packages/app/tests/decision/decision-service.test.ts` pass with no public-surface diff

Scenario: AC4 — a clef-served answer derives its HIGH/MEDIUM/LOW level (req: R5)
  Given an injected-fetch clef driver wrapped by `createDecisionMaker` and passed as `decisionMaker` to the inline `DecideActionRunner`
  When the stubbed backend answers with confidence 0.91, 0.6 and 0.2
  Then the receipt's `confidenceLevel` is HIGH, MEDIUM and LOW respectively, with `degraded: false`
```

Test observability: AC1/AC2 observe the real POST body through the injected-fetch recorder (`driver.test.ts:56-72`), not a mock of the mapping. AC3 observes the installed dist plus build/tests. AC4 runs the real driver parse → maker → `runDecide` → `confidenceLevel()` (`packages/app/src/workflow/decide.ts:154`) chain with only the network stubbed; threshold edges stay pinned by `packages/app/tests/decision/confidence-level.test.ts`.

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

#### Q&A entry — 2026-10-13 (ready re-audit)

- CLOSED: R3 readiness — no new `status` logic. `status` never calls backends by design (`decision-service.ts:219`); `--probe` already reports clef as errored, so it is truthful. After the bump the probe is the confirmation (deferred, operator-run).
- CLOSED: AC4 test location — `decide.test.ts` with an injected-fetch clef maker, because `DecisionService` builds clef from env and cannot inject `fetch`.
- DEFERRED (owner: operator): ts-libs patch publish approval (Plan step 3) and the live-credential probe (Plan step 7).
- Superseded: "no feature_id" — frontmatter has `feature_id: P1`; refine leaves the edge to the operator.

### Design

**WHAT** — one wire-mapping change in the upstream clef driver plus its regression test; an operator-gated patch release; the spur-new catalog bump; one spur-new integration test proving a clef answer reaches the level derivation.

**WHY** — `ts-decision-clef` 0.5.24 sends `state: state ?? null` (`src/driver.ts:295`). The hub produces `null` for a parameterless decision (`ts-ai-decision` `buildState`, `params.ts:165`), and Cloudflare's Clef endpoint rejects `"state": null` with HTTP 422 (`Input should be a valid string / dictionary / list`), while `"state": {}` and `''` are accepted. Every parameterless clef decision therefore degrades to its fallback. TypeSafe hit the same class and ships `state ?? ''` (`ai-runner/src/decision/typesafe-driver.ts:73-83`); laya/fm map null→`''` too.

**WHERE**

- `ts-libs/packages/decision-clef/src/driver.ts:295` — `state: state ?? null` → `state: state ?? ''`, with a one-line comment citing the 422.
- `ts-libs/packages/decision-clef/tests/driver.test.ts` — AC1 cases using the existing recorder (`:56-72`); AC2 already pinned in the "default route" test.
- `spur-new/package.json` — root `workspaces.catalog` `"@gobing-ai/ts-decision-clef": "^0.5.24"` (`:34`) → the published patch; then `bun.lock`.
- `spur-new/packages/app/tests/workflow/actions/decide.test.ts` — AC4 integration case: `createDecisionMaker({ driver: createClefDriver({ accountId, apiToken, fetch }) })` passed as `decisionMaker`; reuse the success-envelope shape from the ts-libs recorder's `respond`.
- Read-only seams: `packages/app/src/workflow/decide.ts:154`, `packages/app/src/decision/decision-log-query.ts:140`, `packages/app/src/decision/confidence-level.ts:17-21`.

**Frozen names** — wire field `state`; mapping `state ?? ''`; levels `HIGH | MEDIUM | LOW` with `CONFIDENCE_HIGH_THRESHOLD = 0.8`, `CONFIDENCE_MEDIUM_THRESHOLD = 0.5`. No new types, flags, env vars or API; `ask()` signature unchanged.

**Algorithm** — `undefined`/`null` → `''`; any structured JSON value (validated by `assertJsonSerializable`, `driver.ts:287`) passes through. Level derivation is existing and total.

**Anti-patterns**

- Do not default hub state / `buildState` to `{}` or `''` — masks the driver defect for non-hub callers.
- Do not omit the `state` key — the backend treats it as required.
- Do not add a Spur-side shim in `packages/app` (engine fixes go in the released package).
- Do not add readiness logic to `spur decision status`; `--probe` is the truth surface.
- Do not duplicate thresholds; use `confidenceLevel()`.

**Concurrency** — 2026-10-13: ts-libs has one worktree (`main` at `067b5f47`, clean); spur-new has one worktree (`main`), no `wip` tasks. Sibling 1193 edits `decide.test.ts` too — run 1193 first or rebase the AC4 case onto it.

**Handoff/dependencies** — single-owner ordered chain across repos: ts-libs change + test → operator-approved publish → spur-new bump. No spur `dependencies[]` edge (1193 overlap is a file, not a contract).

### Plan

1. ts-libs: add AC1 tests to `packages/decision-clef/tests/driver.test.ts`; confirm they fail on `state ?? null`.
2. ts-libs: change `src/driver.ts:295` to `state ?? ''`; run the package tests (AC1/AC2) and the repo gate.
3. **Operator gate:** publishing the ts-libs patch is an external action — stop for explicit approval, then release via the ts-libs release procedure.
4. spur-new: bump `@gobing-ai/ts-decision-clef` in root `workspaces.catalog`, `bun install`, confirm the dist contains `state ?? ''` (AC3).
5. spur-new: add the AC4 injected-fetch integration case in `packages/app/tests/workflow/actions/decide.test.ts`.
6. spur-new: `bun run build` and `bun run spur-check`.
7. Deferred, operator-run (needs Cloudflare creds): `spur decision run maker-liveness --maker clef --json` returns `source: model`, and `spur decision status --probe` shows clef `✓`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `ts-libs/packages/decision-clef/src/driver.ts:287`, `:295` — `assertJsonSerializable(state)` and the defective `state ?? null` (0.5.24).
- `ts-libs/packages/decision-clef/tests/driver.test.ts:56-72` — injected-fetch recorder; "default route…" test pins structured state.
- `ts-libs/packages/ai-runner/src/decision/typesafe-driver.ts:73-83` — same defect class, `state ?? ''` fix.
- `ts-libs/packages/ai-decision/src/params.ts:165` — `buildState` returns `Record<string, Json> | null`.
- `spur-new/package.json:34` — catalog pin `^0.5.24`.
- `spur-new/packages/app/node_modules/@gobing-ai/ts-decision-clef/dist/driver.js:213` — installed defect.
- `spur-new/packages/app/src/decision/decision-service.ts:219`, `:239-241`, `:371-373`, `:678` — probe hub, clef registration, `clefCredentials`.
- `spur-new/packages/app/src/decision/confidence-level.ts:17-21`; `packages/app/src/workflow/decide.ts:154`; `packages/app/src/decision/decision-log-query.ts:140` — level derivation.
- `spur-new/packages/app/tests/decision/confidence-level.test.ts` — threshold edges.
- `docs/design/decision-catalog.md` §5 — TypeSafe precedent; §3.6 clef maker.

### History

- 2026-10-13T18:18:40.112Z backlog → todo (system)

