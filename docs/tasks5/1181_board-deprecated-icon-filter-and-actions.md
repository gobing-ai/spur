---
schema_version: 1
name: Board deprecated icon, filter and actions
status: done
template: feature-impl
created_at: 2026-10-12T05:21:53.040Z
updated_at: "2026-10-12T20:52:27.087Z"
feature_id: F42
priority: P2
tags:
  - feature-lifecycle
  - web

dependencies: ["1179"]
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1181-verdict.json
---

## 1181. Board deprecated icon, filter and actions

### Background

Implements: R6 — The Board shows deprecated features and offers deprecate and undeprecate actions.

Design: docs/design/feature-deprecated-status.md; ADR-136; ADR-133 (icon system). Surface S13. Depends on 1179 (enum + graph edges).

**Refine corrections (2026-10-11)**
- "Add a filter entry in `FeaturesShell.tsx`" → the filter maps `FEATURE_STATUSES` (`apps/web/src/modules/features/FeaturesShell.tsx:265`), so it lists deprecated once 1179 lands → no code change there, only a test.
- "Icon from DESIGN.md tokens" → status icons are `FEATURE_STATUS_MAP` entries with an `Icon` component and a `colorClass` (`apps/web/src/modules/features/status-icons.tsx:20`); ADR-133 requires Lucide over new ad-hoc SVG → use `lucide-react` `Archive` (installed, `apps/web/package.json:28`) with `text-spur-text-muted`.
- "done offers deprecate" → `done` currently offers no actions (`apps/web/src/modules/features/feature-actions.ts:7`) → adding `deprecate` there is the first done action; intended.
- Actions route through `transitionFeature` (`apps/web/src/modules/features/FeatureDetail.tsx:347`) → server in-process graph guard (ADR-135); no new client API.

### Requirements

- [x] R1. `FEATURE_STATUS_MAP.deprecated` = `{status: 'deprecated', label: 'Deprecated', colorClass: 'text-spur-text-muted', Icon: <lucide Archive>}` honoring the existing `className`/`ariaLabel` Icon props.
- [x] R2. The status filter lists Deprecated (via `FEATURE_STATUSES`) and filtering shows only deprecated features.
- [x] R3. `FEATURE_STATUS_ACTIONS`: `deprecate` appended for backlog, active, verifying, blocked and done; `deprecated: ['undeprecate', 'cancel']`. Labels `Deprecate` / `Un-deprecate`; tiers `deprecate: 'hazard'`, `undeprecate: 'primary'`; `FSM_ACTIONS` marks both; `FSM_TRANSITION_TARGET` maps `deprecate → 'deprecated'`, `undeprecate → 'active'`.
- [x] R4. Clicking either action calls `transitionFeature` and re-renders the new status; a 409 GUARD_DENIED surfaces through the existing error path.
- Out of scope: other UI restyling, migrating the existing inline SVG icons to Lucide.

### Acceptance Criteria

- [x] AC1 — The Board shows deprecated features and offers deprecate and undeprecate actions (req: R1, R2, R3, R4)

Verify lens: `components.test.tsx` observes the icon and action membership; the browser check observes the real transition round-trip.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Approach.** Data-only change in the existing action tables plus one icon entry; `FeatureDetail` and `FeaturesShell` already render from those tables. Why: `feature-actions.ts` is the declared single source of truth for button visibility.

**Frozen names.** Action ids `deprecate`, `undeprecate`; labels `Deprecate`, `Un-deprecate`; icon `Archive` from `lucide-react`; color `text-spur-text-muted`.

**Files.** `apps/web/src/modules/features/feature-actions.ts`; `apps/web/src/modules/features/status-icons.tsx` (+ header comment listing canonical statuses); tests `apps/web/tests/modules/features/components.test.tsx` (`:198` iterates statuses — extend to deprecated) and the feature-actions test if present.

**Anti-patterns.** No new component or confirm dialog. No emoji in the web icon. Do not convert other status icons (no drive-by). Do not compute legality client-side beyond the action table — the server graph decides.

**Handoff.** Relies on 1179's enum and edges. 1182 screenshots/notes nothing extra.

### Plan

- [x] Step 0: 1179 merged; Board server runs against the source tree.
- [x] Icon map entry (R1); component test renders the deprecated icon with its aria label.
- [x] Action tables (R3); unit test on `FEATURE_STATUS_ACTIONS` for done and deprecated.
- [x] Browser check (R2, R4): filter by Deprecated; open a done feature → Deprecate; then Un-deprecate; save screenshots under `.spur/run/1181-board/`.
- [x] `bun run spur-check` — owned by the pipeline `test` stage (the implement stage is barred from the full gate); implement ran the targeted `components.test.tsx` + `feature-actions.test.ts` suites, `apps/web` `tsc --noEmit`, and the repo-wide `recommended-pre-check` preset (0 findings).

### Solution

Data-only change in the two Board tables that `FeatureDetail`/`FeaturesShell` already render from, plus one Lucide icon entry. `feature-actions.ts` is the declared single source of truth for button visibility; `status-icons.tsx` is the icon map. No component, dialog, legend or graph logic was added — the server graph (1179/1180 `feature-transition.ts`) still decides legality.

#### Change map (file:line — subject of the row)

| file:line | change |
| --- | --- |
| `apps/web/src/modules/features/feature-actions.ts:3` | `FEATURE_STATUS_ACTIONS.backlog` gains the appended `deprecate` action |
| `apps/web/src/modules/features/feature-actions.ts:4` | `FEATURE_STATUS_ACTIONS.active` gains the appended `deprecate` action |
| `apps/web/src/modules/features/feature-actions.ts:5` | `FEATURE_STATUS_ACTIONS.verifying` gains the appended `deprecate` action |
| `apps/web/src/modules/features/feature-actions.ts:6` | `FEATURE_STATUS_ACTIONS.blocked` gains the appended `deprecate` action |
| `apps/web/src/modules/features/feature-actions.ts:7` | `FEATURE_STATUS_ACTIONS.done` becomes `['deprecate']` (first done action; intended) |
| `apps/web/src/modules/features/feature-actions.ts:8` | `FEATURE_STATUS_ACTIONS.deprecated` = `['undeprecate', 'cancel']` |
| `apps/web/src/modules/features/feature-actions.ts:27` | `FEATURE_ACTION_LABELS.deprecate` = `'Deprecate'` |
| `apps/web/src/modules/features/feature-actions.ts:28` | `FEATURE_ACTION_LABELS.undeprecate` = `'Un-deprecate'` |
| `apps/web/src/modules/features/feature-actions.ts:48` | `FEATURE_ACTION_TIER.deprecate` = `'hazard'` |
| `apps/web/src/modules/features/feature-actions.ts:49` | `FEATURE_ACTION_TIER.undeprecate` = `'primary'` |
| `apps/web/src/modules/features/feature-actions.ts:61` | `FSM_ACTIONS.deprecate` marked as an FSM transition |
| `apps/web/src/modules/features/feature-actions.ts:62` | `FSM_ACTIONS.undeprecate` marked as an FSM transition |
| `apps/web/src/modules/features/feature-actions.ts:74` | `FSM_TRANSITION_TARGET.deprecate` = `'deprecated'` |
| `apps/web/src/modules/features/feature-actions.ts:75` | `FSM_TRANSITION_TARGET.undeprecate` = `'active'` |
| `apps/web/src/modules/features/status-icons.tsx:1` | imports `Archive` from the installed `lucide-react` (ADR-133) |
| `apps/web/src/modules/features/status-icons.tsx:19` | header comment now lists the canonical statuses including `deprecated` |
| `apps/web/src/modules/features/status-icons.tsx:140` | `FEATURE_STATUS_MAP.deprecated` entry (`label: 'Deprecated'`, `colorClass: 'text-spur-text-muted'`) |
| `apps/web/src/modules/features/status-icons.tsx:145` | the `Archive` render honoring the existing `className`/`ariaLabel` Icon props (`role="img"`) |
| `apps/web/tests/modules/features/components.test.tsx:175` | FeatureTree icon/label test extended from 6 to 7 canonical statuses |
| `apps/web/tests/modules/features/components.test.tsx:381` | `FeatureStatusIcon` cases now include `['deprecated', 'Deprecated']` |
| `apps/web/tests/modules/features/components.test.tsx:677` | R3: a done feature offers `Deprecate` as its only action |
| `apps/web/tests/modules/features/components.test.tsx:706` | R4: deprecated offers `Un-deprecate` + `Cancel`, clicking Un-deprecate re-renders `active` |
| `apps/web/tests/modules/features/components.test.tsx:754` | R4: 409 `GUARD_DENIED` surfaces through the existing error path, status unchanged |
| `apps/web/tests/modules/features/feature-actions.test.ts:23` | action membership for the deprecate pair; `done` = `['deprecate']` |
| `apps/web/tests/modules/features/feature-actions.test.ts:31` | labels and tiers for `deprecate`/`undeprecate` |
| `apps/web/tests/modules/features/feature-actions.test.ts:38` | `FSM_ACTIONS` marks + `FSM_TRANSITION_TARGET` targets |
| `apps/web/tests/modules/features/feature-actions.test.ts:138` | terminal-egress test now checks only the declared terminal (`cancelled`), since `done → deprecated` is a legal 1181 edge |

No change was needed in `FeaturesShell.tsx`: the filter maps `FEATURE_STATUSES`, so 1179 already lists `deprecated`; a test covers it instead.

#### Targeted tests — exact commands and observed output

```
$ cd apps/web && bun test tests/modules/features/components.test.tsx tests/modules/features/feature-actions.test.ts
(pass) FeatureTree > renders mapped status icons and accessible labels for all 7 canonical statuses
(pass) FeatureStatusIcon > every canonical status renders one img-role SVG named by its capitalized label
(pass) FeatureStatusIcon > every canonical status maps to distinct shape markup (task 0334, R1/R2/R6)
(pass) FeatureStatusIcon > every canonical status renders through its assigned text-spur-* colorClass (0338 R3/R4)
(pass) FeatureDetail > R3: a done feature offers Deprecate as its only action (1181)
(pass) FeatureDetail > R4: a deprecated feature offers Un-deprecate + Cancel and re-renders the new status (1181)
(pass) FeatureDetail > R4: a 409 GUARD_DENIED on Un-deprecate surfaces through the existing error path (1181)
(pass) feature action group — FSM legality floor (0351 matrix invariant) > every surfaced FSM action is a legal transition from that status

 77 pass
 0 fail
 512 expect() calls
Ran 77 tests across 2 files. [1.75s]
```

```
$ cd apps/web && bun run typecheck
$ tsc --noEmit          # exit 0, no output
```

```
$ bun run rule run --preset recommended-pre-check --fail-on warning --no-logo --json
exit=0, total findings: 0   (repo-wide pre-check preset; no finding on any changed path)
```

#### Public-surface probe (task 1135 R1/R2/R6) — real Board round trip

Browser automation: `agent-browser` (Chromium) against `spur serve` over a disposable
scratch project so no real feature was mutated. The Board static bundle was rebuilt first
(`bun run --filter '@gobing-ai/spur-web' build` → `dist/web`), because `spur serve` serves
`dist/web`, not `src/`; without the rebuild the probe would have exercised the pre-change bundle.

```
$ cd .spur/run/1181-board/scratch && bun <repo>/apps/cli/src/index.ts --no-logo serve --port 4179 --no-open
Spur server listening on http://localhost:4179
Board UI available at http://localhost:4179/board
$ curl -s localhost:4179/api/features
{"ok":true,"data":[{"id":"X","name":"Scratch done feature","status":"done","priority":"P2"},
                   {"id":"Y","name":"Scratch deprecated feature","status":"deprecated","priority":"P2"}]}

$ agent-browser open http://localhost:4179/board/features ; snapshot
listitem button "Done Done X Scratch done feature"   image "Done"
listitem button "Deprecated Deprecated Y Scratch deprecated feature"   image "Deprecated"

$ click "Filter features by status" ; snapshot
button "Deprecated Deprecated" (image "Deprecated")     # filter lists Deprecated  → R2
$ click "Deprecated" ; snapshot
list: only "Deprecated Deprecated Y Scratch deprecated feature"   # filters to deprecated only → R2

$ click "All" ; click "Done Done X Scratch done feature" ; snapshot
button "Deprecate"     # done offers deprecate, and only it → R3/R1
$ eval status-pill.textContent  →  "done"
$ click "Deprecate"
$ eval status-pill.textContent  →  "deprecated"     # real in-process graph-guarded transition → R4

$ snapshot  →  button "Un-deprecate" [e65] ; button "Cancel" [e66]
$ click "Un-deprecate"
$ eval status-pill.textContent  →  "active"         # → R4

$ grep -m1 '^status:' scratch/docs/features/X_scratch-done-feature.md
status: active                                       # frontmatter really written by the round trip
```

Screenshots (fresh build): `.spur/run/1181-board/01-board-initial.png`,
`02-filter-menu-shows-deprecated.png`, `03-filter-deprecated-only.png`,
`04-done-feature-offers-deprecate.png`, `05-after-deprecate.png`,
`06-deprecated-state-offers-undeprecate.png`, `07-after-undeprecate-active.png`.
Transcript: `.spur/run/1181-e2e.txt`.

Extra bounded probe of the server-side guard (out-of-scope observation, not required by 1181):
`PATCH /api/features/Y/status {"toStatus":"done"}` (an undeclared `deprecated → done` edge)
wrote nothing and left `Y` at `deprecated`, but the response was a 500 after Bun's 10 s
request timeout rather than a clean 409 GUARD_DENIED. That path belongs to 1179/1180's guard
surface and is untouched by this task; R4's 409 client path is covered by the component test
above.

#### Scope notes

- No new component or confirm dialog; `deprecated` reuses the existing
  `appliedFSMTransition`/cancel-modal paths.
- No emoji: the web icon is `lucide-react` `Archive` with `text-spur-text-muted`.
- No other status icon was converted (the legacy inline SVGs are untouched).
- No client-side legality computation: the action table only lists buttons; the server graph
  refuses undeclared edges.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/features/status-icons.tsx:140` — Deprecated Archive icon has muted class and preserves accessible label/class props; web focused suite 94 pass / 0 fail. Verification artifacts refreshed: `.spur/run/1181-verify-answer.txt:1-34`; `.spur/run/1181-verdict.json:1-10` (verdict header, requirements and AC rows re-derived by CLI). |
| R2 | MET | `apps/web/tests/modules/features/components.test.tsx:1270` — New behavioral filter check selects deprecated, retains Frozen and hides Live; web focused suite 94 pass / 0 fail. |
| R3 | MET | `apps/web/src/modules/features/feature-actions.ts:3` — All five entry statuses offer deprecate; deprecated offers undeprecate/cancel; labels, tiers and FSM targets asserted; web focused suite 94 pass / 0 fail. |
| R4 | MET | `apps/server/tests/modules/feature/transition-gate.test.ts:266` — Real oRPC endpoint returns 409 GUARD_DENIED and preserves deprecated file; server focused suite 33 pass / 0 fail. Component click rerenders active and denial shows error; typed-client decoder tests also pass; web focused suite 94 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R6 — The Board shows deprecated features and offers deprecate and undeprecate actions | MET | test | `apps/web/tests/modules/features/components.test.tsx:175`, `apps/web/tests/modules/features/components.test.tsx:677`, `apps/web/tests/modules/features/components.test.tsx:706`, `apps/web/tests/modules/features/components.test.tsx:1270`, `apps/server/tests/modules/feature/transition-gate.test.ts:266` — icon, filter, actions, click rerender and guard-denial path: web suite 94 pass / 0 fail; server suite 33 pass / 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1181 (Board deprecated icon, filter and actions) — fresh digest after R4 remediation

**Scope:** 1181 change set (`apps/web/src/modules/features/feature-actions.ts`, `status-icons.tsx`, `apps/web/tests/modules/features/components.test.tsx`, `feature-actions.test.ts`) **plus the R4-denial remediation** (`apps/server/src/middleware/error-handler.ts`, `apps/server/src/bootstrap.ts`, `apps/server/tests/middleware/error-handler.test.ts`, `apps/server/tests/modules/feature/transition-gate.test.ts`).
**Dimensions:** functional traceability (R1–R4, AC1), SECUA (security / correctness / efficiency / usability / accessibility), architecture.
**Verdict:** PASS
**Independent verification (fresh session):** `cd apps/server && bun test tests/middleware/error-handler.test.ts tests/modules/feature/transition-gate.test.ts` → **31 pass, 0 fail** (incl. `denied transition over the /api oRPC path (task 1181 R4) > … 409 GUARD_DENIED, not a generic 500`); `cd apps/server && bun test tests/modules/feature tests/modules/task` → 53 pass / 0 fail; `cd apps/web && bun test tests/modules/features/components.test.tsx tests/modules/features/feature-actions.test.ts tests/rpc-client.test.ts` → 78 pass / 0 fail; `cd apps/web && bun test tests/modules/task-kanban/index.test.tsx` → 5 pass / 0 fail; `bun test packages/contracts/tests/contract.test.ts` → 62 pass / 0 fail.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness/transport | The new oRPC error envelope is **not decodable by the repo's own typed client**. `bootstrap.ts` re-shapes the three domain errors to `{ ok:false, error:{ code, message, details } }`, but `apps/web/src/lib/rpc-client.ts`'s `OpenAPILink` has no `customErrorResponseBodyDecoder`, so `isORPCErrorJson` fails and the client throws a synthesised `ORPCError('CONFLICT', status:409, message:'Conflict')` (503 error → `SERVICE_UNAVAILABLE`) — losing `code:'GUARD_DENIED'` and the guard reason. Demonstrated against the installed `@orpc/openapi-client` 1.14.4: `NEW-envelope(409) -> {code:'CONFLICT',status:409,message:'Conflict'}` vs `OLD-toJSON(409) -> {code:'GUARD_DENIED',status:409,message:'undeclared edge…'}`. Non-regressive (before the fix this path emitted 500 `INTERNAL_SERVER_ERROR`, so the reason was already unavailable) and it does not touch 1181's Board path (which uses raw `fetch` in `feature-client.ts`), so it is not blocking for R4 — but the shipped typed client (`api.task.transition`, `KanbanBoard.tsx:196`) can no longer read the documented envelope for these codes. Fix: add a matching `customErrorResponseBodyDecoder` to `OpenAPILink`, or express the mapping via oRPC's native `errorMap`/`oc.errors` so both decode paths agree. | `apps/server/src/bootstrap.ts:54-63`; `apps/web/src/lib/rpc-client.ts:91-99` | RESOLVED (fixed in this change: `apps/web/src/lib/rpc-client.ts` now sets `customErrorResponseBodyDecoder`, decoding the seam's envelope via the shared `decodeApiErrorBody` in `packages/contracts/src/shared.ts`; the decoder reads the status off the response, so no second code→status table exists to drift. `WBS_COLLISION` was also missing from the envelope vocabulary the response was validated against and is added. Proven by `apps/web/tests/lib/rpc-client.test.ts` — without the decoder the same response degrades to `CONFLICT` and the reason is lost — and by the encoder→decoder round-trip in `apps/server/tests/middleware/error-handler.test.ts`.) |
| 2 | P3 (minor) | correctness/transport | **[prior pass, now RESOLVED]** The live guard denial over `/api/*` returned HTTP 500 `INTERNAL_SERVER_ERROR` instead of the documented `409 GUARD_DENIED` (oRPC's `toORPCError` converted the thrown `GuardDeniedError` before any Hono mapping ran). The remediation's `clientInterceptors` + `customErrorResponseBodyEncoder` now carry the denial to a real `409 {"ok":false,"error":{"code":"GUARD_DENIED",…}}`; the refused write still writes nothing. Verified fresh: `apps/server/tests/modules/feature/transition-gate.test.ts:266-285` asserts 409 + envelope + file unchanged; passes in this session. | `apps/server/src/middleware/error-handler.ts:200-215`; `apps/server/src/bootstrap.ts:45-63`; `apps/server/tests/modules/feature/transition-gate.test.ts:266` | RESOLVED (fixed in this change; verified on the fresh digest) |
| 3 | P4 (advisory) | security | Production mode leaks no stack and no raw message (verified: `NODE_ENV=production` → `GUARD_DENIED` 409 / `LOCK_TIMEOUT` 503 / `WBS_COLLISION` 409 all return the generic `resolveError` message, `details` emptied of `requestId`). The one residual: `WbsCollisionError`'s `details` still carries server-absolute `existingPath`/`attemptedPath` in production, and the remediation now surfaces that on the `/api/*` path. This is the pre-existing, documented `resolveError` mapping (identical to the Hono path), reused verbatim — not a new leak, but the new HTTP exposure is worth knowing. | `apps/server/src/middleware/error-handler.ts:140-147`; `apps/server/src/bootstrap.ts:54-63` | ACCEPTED |
| 4 | P4 (advisory) | correctness (coverage) | The `clientInterceptors` interceptor is deliberately narrow (three `instanceof` checks; every other throw passes through untouched), which is correct for R4 — but it makes the oRPC path honour design §2.6 only for those three codes. `NotFoundError`/`ValidationError`/`ConflictError` thrown inside a procedure still collapse to `500 INTERNAL_SERVER_ERROR` via `toORPCError` (pre-existing). Not a 1181 requirement; flagged so the partial mapping is a known state, not an assumption. | `apps/server/src/middleware/error-handler.ts:200-204`; `apps/server/src/bootstrap.ts:45-51`; `docs/design/server-side-adjustment-design.md:675-680` | ACCEPTED |
| 5 | P4 (advisory) | usability (test coverage) | R2 has no direct component test: the filter-menu test (`components.test.tsx:1242`) exercises only non-deprecated statuses, so "the filter lists Deprecated and filtering shows only deprecated features" rests on the enum-pin test (7 canonical statuses) plus the browser probe. `FeaturesShell.tsx:265` maps `FEATURE_STATUSES` verbatim, so the behaviour is sound; this is coverage polish. | `apps/web/tests/modules/features/components.test.tsx:1242`; `apps/web/src/modules/features/FeaturesShell.tsx:265` | ACCEPTED |
| 6 | P4 (advisory) | architecture (deepening) | One action still costs five coordinated edits across parallel string-keyed maps (`FEATURE_STATUS_ACTIONS`, `FEATURE_ACTION_LABELS`, `FEATURE_ACTION_TIER`, `FSM_ACTIONS`, `FSM_TRANSITION_TARGET`), and the status maps are `Record<string, …>` — a future action added to only some tables degrades silently (no button / fallback icon). A single action-descriptor record, or a completeness test over `FEATURE_STATUSES`, would make the convention `test`-enforced. Non-blocking: this round's entries are complete and guarded by the legality-floor + tier/label tests. | `apps/web/src/modules/features/feature-actions.ts:1-76`; `apps/web/src/modules/features/status-icons.tsx:23` | ACCEPTED |
| 7 | P4 (advisory) | docs coherence | `docs/tasks3/0351…:123` still reads "Terminal statuses (done, cancelled) get **no FSM buttons** — matches current `FEATURE_STATUS_ACTIONS` empty rows", and the changed 1181 test cites that matrix as its rationale authority. The sentence is stale (`done` is no longer a declared terminal and 1181 gives it a button); it is a frozen task record superseded by ADR-136 / design §4.1, so nothing functional depends on it. | `docs/tasks3/0351_decide-which-operations-belong-on-the-features-detail-action.md:123` | ACCEPTED |
| 8 | P4 (advisory) | evidence hygiene | `05-after-deprecate.png` and `06-deprecated-state-offers-undeprecate.png` are byte-identical (md5 `9a8ce749efa54d5f763b28a20958936b`), so the run has 6 distinct frames rather than the 7 claimed. Both captions describe the same screen, so no claim is unsupported — the count is. | `.spur/run/1181-board/05-after-deprecate.png`, `.spur/run/1181-board/06-deprecated-state-offers-undeprecate.png` | ACCEPTED |

No P1 (blocker) or P2 (major) findings.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `status-icons.tsx:1` (Lucide `Archive`, an installed `apps/web` dep — ADR-133), `:140-146` map entry `{status:'deprecated', label:'Deprecated', colorClass:'text-spur-text-muted', Icon}`; the `Archive` render honors both Icon props as the sibling six do (`className` merged, `role="img"`, `aria-label={ariaLabel}`). Pinned by `components.test.tsx` (7 canonical statuses, `svg[role="img"][aria-label="Deprecated"]`), `:381`, colorClass cases. |
| R2 | MET | No code change (correctly): `FeaturesShell.tsx:265` maps `FEATURE_STATUSES`, which 1179 extended (`packages/domain/src/planning/schema.ts`); pinned by the verbatim re-export + exact 7-value list test and `packages/contracts/tests/contract.test.ts` (`deprecated` round-trips through the transition schemas). Browser frames `02/03` show the menu + filter. See finding #5. |
| R3 | MET | `feature-actions.ts:3-8` (`deprecate` appended to backlog/active/verifying/blocked, `done: ['deprecate']`, `deprecated: ['undeprecate','cancel']`), `:27-28` labels (`Deprecate`/`Un-deprecate`), `:48-49` tiers (`hazard`/`primary`), `:61-62` FSM marks, `:74-75` targets (`deprecated`/`active`) — every clause matches design §3.1 S13 and ADR-136. Render path untouched; tests `feature-actions.test.ts:23-43`, `components.test.tsx:677-704`. |
| R4 | MET | Actions route through `handleFSMTransition → applyFsmTransition → transitionFeature` (`FeatureDetail.tsx:340-367`; `feature-client.ts:53-69`) — no new API/component/dialog. Re-render proven (`components.test.tsx:706-752`, pill `deprecated → active`) plus the browser round trip. **The 409 `GUARD_DENIED` clause is now real end-to-end**: the server emits `409 {"ok":false,"error":{"code":"GUARD_DENIED",…}}` on a live denial (`transition-gate.test.ts:266`, verified fresh) and the Board's `transitionFeature` reads `body.error.message` on `!res.ok` (the mocked component test `components.test.tsx:754-793` matches the now-real server shape). |
| AC1 | MET | Board lists deprecated with the `Archive` icon (R1/R2), offers `Deprecate` on a done feature (R3), `Un-deprecate`/`Cancel` on a deprecated one (R3), and the real click round trip mutates frontmatter through the graph guard, with a denial now transport-correct (R4). |

##### Dimensions checked beyond the requirements

- **Narrowness of the remediation**: the interceptor matches only `GuardDeniedError | WbsCollisionError | LockTimeoutError` and returns the throw unchanged otherwise; the encoder returns `undefined` (→ oRPC default body) for every code outside `{GUARD_DENIED, WBS_COLLISION, LOCK_TIMEOUT}`. No general error-shape rewrite. Verified against the installed `@orpc/server`/`@orpc/openapi` sources (`clientInterceptors` wrap the procedure client; `validateORPCError` preserves `status` for a code absent from the (empty) `errorMap`).
- **Contract preservation**: 409 `GUARD_DENIED`, 409 `WBS_COLLISION`, 503 `LOCK_TIMEOUT` are exactly the `resolveError` outputs, reused rather than re-derived, so the statuses/codes cannot drift; `toDomainORPCError` unit-test covers all three plus the pass-through case.
- **Unrelated errors**: no status or body change — confirmed by the full server + web + contracts suites and by reading the two seams.
- **Production**: no stack/raw-message leak on the new path (probed with `NODE_ENV=production`); the pre-existing `WbsCollision` path disclosure is noted in finding #3.
- **Security / efficiency**: no new input, fetch, or compute; the interceptor adds one `instanceof` chain per procedure call.

**Next:** no corrective action required for 1181; the one worthwhile follow-up is the typed-client decoder (finding #1) if any typed-client consumer ever needs the domain `code`/message.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-12T07:22:47.238Z todo → wip (system)
- 2026-10-12T08:06:16.326Z wip → testing (system)
- 2026-10-12T08:07:08.526Z testing → done (system)

