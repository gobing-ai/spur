---
schema_version: 1
name: Project inline state visits and surface unmapped action rows in the progress projection
status: done
template: standard
created_at: 2026-10-04T22:48:26.495Z
updated_at: "2026-10-05T01:57:46.497Z"

feature_id: E72
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-1085-7647/.spur/memory/evidence/1085-verdict.json
---

## 1085. Project inline state visits and surface unmapped action rows in the progress projection

### Background

Found by the E72 dogfood (2026-10-04): for an inline-driver run, the progress projection presents only
the initial state as visited, so the Observability Trace tab — and `spur workflow progress` — show a
near-empty detail for runs that actually executed the whole pipeline. Every run this harness produces
locally is an inline run, so the gap covers the common case, not an edge.

Evidence (worktree `sp/runall-e72-4191`, runs from the E72 batch):

- `spur workflow progress inline-1071-2be5d0be --json` reports 15 states, only `precheck` visited
  (`status: passed`), the other 14 `pending` with 0 attempts and `diagnostics: []` — while
  `action_runs` holds 23 rows for that run (`implement`, `test`, `triage`, `review`, `verify`,
  `record`, `done`).
- All three batch runs report `transitions: 0`; the same rows exist for each.
- The Board renders exactly that projection (`06-trace-detail-estimated-badges.png`: `precheck`
  visited, every later state `visit 1 pending`), so Board and CLI agree — the gap is the projection's
  input, not the rendering. E72's "one projection" invariant is intact.

Root cause:

- State visits are derived only from transition history: `transitions.length === 0` records just the
  definition's `initialState`, and every other declared state is appended as `visit: 1, pending`
  (`packages/app/src/workflow/progress-projection.ts:342-372`). The inline driver writes `action_runs`
  rows but no state/transition rows (the engine's `DbWorkflowPersistenceAdapter` is not part of the
  inline path).
- For a state the projection does not consider visited, its candidate rows are marked consumed
  without producing attempts (`packages/app/src/workflow/progress-projection.ts:418-435`), so the
  trailing `orphan-action-row` diagnostic (`:526-533`) never fires either: recorded evidence is
  silently invisible.

Out of scope: changing how the engine persists its own state/transition rows; Board-side derivation;
the four minor Trace-tab advisories the same dogfood recorded (load-more stale-filter window,
cross-tab `CopyValueButton`/`formatDuration` import, missing `aria-controls`, pre-existing global
agent-bar overlay occlusion) — they belong to a separate small task.

### Requirements

- [x] R1. An inline run's projection marks every state whose action rows were recorded as visited, so a
  state with recorded work is never presented as `pending`.
- [x] R2. Visit order and `currentState` come from recorded evidence, not from the definition's
  declaration order: states are ordered by their earliest recorded row (the driver writes rows in
  execution order), and a non-terminal run's `currentState` is its last visited state.
- [x] R3. Repeated visits stay distinguishable — a state the run re-entered (e.g. `implement`, a
  `loopBack` state) yields one visit per contiguous group of its rows, numbered per state as today.
- [x] R4. No recorded row is silently dropped: any `action_runs` row that the projection does not
  surface as an attempt or a skipped/ambiguous action keeps producing a diagnostic naming the row
  (`orphan-action-row` or a named sibling for the unvisited-state case).
- [x] R5. Engine runs are unchanged: when transition rows exist they stay the visit source, their
  projections and diagnostics are byte-identical, and no engine, persistence-adapter or migration
  change is introduced.
- [x] R6. One projection for both transports: the Board consumes the same output unchanged (no
  web-side derivation), and `workflowProgressProjectionSchema` needs no wire change (or gains only
  additive fields with the 1069 assignability guard still green).

### Acceptance Criteria

- [x] AC1 — An inline run's detail shows every state it visited and hides no recorded action

Task-local verification: a projection fixture seeded with `action_runs` rows across several states and
zero transition rows reports each of those states as visited (in row order) with its attempts, and a
terminal run has no visited state left `pending`; a row whose state the run did not visit, and a row
whose node matches no declared state, each produce their own diagnostic. Live check on this repo's DB:
`spur workflow progress inline-1071-2be5d0be --json` shows `implement`, `test`, `review`, `verify`,
`record` and `done` visited with their attempts instead of `pending`.

- [x] AC2 — A run detail shows states, actions with durations and transitions

Task-local verification: an engine-style fixture (transition rows plus state visits) produces the same
visits, attempts, statuses and empty diagnostics as before the change — the seeded projection in
`packages/app/tests/workflow/progress-projection.test.ts:63-77` extended with transitions — and
`apps/web/tests/modules/observability/trace-tab.test.tsx` keeps passing unchanged.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Chosen: derive visits in the projection from the run's recorded `action_runs` rows when the run has
  no transition history. Build a visit sequence by grouping the already-loaded rows (`actionRows`,
  `progress-projection.ts:264`) into contiguous runs of the same `node`, ordered by the rows'
  recorded order; each group is one visit, numbered per state. `currentState` becomes the last visited
  state for a non-terminal run. Reuse the existing state loop so attempts, statuses, `slowest`
  emphasis and `nextTransitions` keep their current semantics.
- Chosen (diagnostics): keep `orphan-action-row` for rows whose node matches no declared state, and add
  one named diagnostic for a row whose state the run did not visit, so R4 holds in both directions.
  Rows consumed for a visited state keep today's ambiguous/skipped behaviour.
- Chosen (provenance): derive only from rows the inline path already writes — no new column, no new
  DAO, no engine touch. The run-record text log stays human evidence, never a projection input.
- Rejected: have the inline driver write `workflow_state_runs`/transition rows. It would populate
  `transitions` too, but it widens the blast radius into the engine persistence adapter and the
  inline delegate; it stays a possible follow-up if the Trace tab later needs real transition history.
- Rejected: Board-side derivation — a second source of truth, and it breaks E72's one-projection rule.
- Rejected: ordering visits by the definition's declaration order — it would report a state order the
  run never executed (e.g. `test` after `review`), misreading a diagnosis.
- Invariants: engine runs byte-identical; a run with no rows keeps today's initial-state-only shape;
  no state is invented for a node with no rows; the contract wire shape is unchanged unless a field is
  added additively (then the 1069 bidirectional guard must stay green).
- Key signatures:
  - `function deriveInlineStateVisits(defStates, rows): Array<{ state: string; visit: number }>` — pure,
    grouping contiguous same-node rows in recorded order.
  - `WorkflowProgressDiagnostic.code` gains one value for the unvisited-state row case (or reuses
    `orphan-action-row` with a distinct message; decide in implementation and record it here).
- Anchors: `packages/app/src/workflow/progress-projection.ts:342-372` (visit build),
  `:418-435` (candidate-row consumption), `:526-533` (orphan diagnostic), `:264` (row load).

### Plan

- [x] 1. Tests first in `packages/app/tests/workflow/progress-projection.test.ts`: an inline-style seed
  (rows for `precheck`, `implement`, `test` with no transition rows) asserting each state is visited
  in row order with its attempts and a non-null `currentState`; a terminal-inline case with no state
  left `pending`; an unvisited-state row case and an unknown-node row case asserting one diagnostic
  each; and an engine-style case with transitions asserting the projection is unchanged.
- [x] 2. Implement the visit derivation in `packages/app/src/workflow/progress-projection.ts`
  (`deriveInlineStateVisits` + the visit-build branch + `currentState`) and the unvisited-state
  diagnostic; keep the engine branch untouched.
- [x] 3. Board check: confirm `apps/web/src/modules/observability/TraceTab.tsx` renders the richer
  detail without changes and add a component assertion only if the fixtures need the new shape.
  (`trace-tab.test.tsx` was already engine-style — its `precheck → test` transition — so no fixture
  conversion and no web edit were needed.)
- [x] 4. Docs: `docs/design/workflow-observability.md` (visit derivation for transition-less runs) and
  the Feature E72 section of `docs/design/run-record-contract.md`; `docs/design/cli-contracts.md` only
  if a payload field is added. (No field was added — the contract change is one diagnostic enum
  member — so `cli-contracts.md` is untouched.)
- [x] 5. Gates:
  - `(cd packages/app && bun test tests/workflow/progress-projection.test.ts)`
  - `(cd apps/web && bun test tests/modules/observability/)`
  - `bun run typecheck`
  - `bun run spur-check`
  - live check on this repo's DB: `spur workflow progress inline-1071-2be5d0be --json` shows the
    visited states with attempts (paste the output).

### Solution

Root cause fixed at the projection, not at the driver: an inline run writes `action_runs` rows and no
state/transition rows, so with `transitions: []` the visit builder recorded only the definition's
`initialState` and every later declared state was appended as `visit: 1, pending`, while its rows were
marked consumed without an attempt or a diagnostic.

**Visit derivation** — `packages/app/src/workflow/progress-projection.ts:211-232`
(`deriveInlineStateVisits`, pure): rows whose `node` names a declared state are grouped into
contiguous same-node runs in recorded order (`actionRowsByRunId` is `ORDER BY created_at`), one visit
per group, numbered per state, each visit owning its group. `DerivedStateVisit:160-168` carries that
group, and the visit loop consumes it via `visitRows` (`:448`, `:479`), so a re-entered `loopBack`
state (R3) reads as visit 1 then visit 2, each with its own attempts instead of the first visit's rows
replayed. Rows whose `node` names no declared state neither start, split nor extend a visit.

**Branch + current state** — `:385-390` derives inline visits only when `transitions.length === 0`;
`:395-412` replaces the transition-less visit seed with the derived sequence, falling back to
`initialState` when there are no rows at all (a run with no rows keeps today's initial-state-only
shape). `:386-392` sets `currentState` to the last derived visit for an active (`pending`/`running`)
run — R2 "visit order and `currentState` come from recorded evidence". Terminal transition-less runs
keep today's `currentState: null`; the engine branch (`:415-423`) and the `currentState` from
`transitions` (`:320-322`) are untouched.

**Diagnostics (R4)** — `:496-501` marks candidate rows consumed only for a *visited* state, so a row
belonging to a declared state the run did not visit reaches the trailing pass, which `:588-605` splits
by cause: `unvisited-state-row` when the `node` is a declared state without a visit, and the unchanged
`orphan-action-row` when the `node` matches no declared state action (unknown node, or a kind no
declared action claims). Exactly one diagnostic per unclaimed row, each naming the row. *Design
decision left to implementation* ("gains one value for the unvisited-state row case … or reuses
`orphan-action-row` with a distinct message; decide in implementation and record it here"): the new
`code: 'unvisited-state-row'` was chosen over a message-only variant — the cause must be readable
without parsing English, and the pre-existing `orphan-action-row` message ("matches no declared state
action") would be false for a declared state. Codes: `packages/app/src/workflow/progress-projection.ts:151` (`WorkflowProgressDiagnostic`), mirrored at `packages/contracts/src/runs.ts:75`.

**Contract** — `packages/contracts/src/runs.ts:73-76` adds the one enum member to
`workflowProgressDiagnosticSchema`. No field was added or changed, so
`docs/design/cli-contracts.md` is untouched and the Board's client-side parse stays valid (a widened
enum accepts every body it accepted before).

**Board** — no web change: `apps/web/src/modules/observability/TraceTab.tsx` renders the projection
as-is, and its fixture in `apps/web/tests/modules/observability/trace-tab.test.tsx` is already
engine-style (it carries a `precheck → test` transition), so AC2's "engine-run projections unchanged"
keeps its meaning and the trace-tab suite passes unchanged.

**Tests** — `packages/app/tests/workflow/progress-projection.test.ts`: inline fixture + seed helpers
`:412-483`; R1/R2/AC1 inline case `:485`; terminal-inline case `:537`; re-entry R3 case `:587`;
unvisited-state R4 case `:653`; engine-style R5/R6 case `:686` (rows seeded in the reverse of the
transition order to prove rows do not drive visits); the 0868 orphan case `:83` now asserts exactly
one `orphan-action-row`.

**Invariants held**
- Engine runs with transitions: `deriveInlineStateVisits` is not called (`:385`), visits still come
  from `transition_runs`, and the engine fixture asserts the same visits, statuses, attempts and empty
  diagnostics as before (`:686`, plus the pre-existing completed-run case at `:174`).
- Schema: additive enum member only; the 1069 bidirectional assignability guard
  (`apps/server/tests/modules/runs/index.test.ts:338`) stays green.
- No new `action_runs` column, no DAO change, no `DbWorkflowPersistenceAdapter`, engine or migration
  change; the projection stays the single implementation shared by `spur workflow progress` and
  `GET /api/runs/:runId/progress` (no web-side derivation).
- Scope note (the one deliberate diagnostic change for transition-present runs): an engine row whose
  `node` is a declared state the run did not visit used to be consumed silently; it now yields
  `unvisited-state-row`. That is the design's R4 direction ("a row whose state the run did not
  visit"), and it changes no engine visit, attempt or status.

**Live evidence** (probe run seeded through the driver's own surface, then removed):
`inline-run-setup --run-id verify-1085-probe --file config/workflows/task-pipeline.yaml` plus rows for
`precheck`/`implement` (and later `test`/`review`/`verify`/`record`/`done`). Before:
`implement@1:pending:attempts=0`, `currentState: precheck`. After:
`precheck, implement, test, review, verify, record, done` all visited with their attempts,
`currentState: done`, `diagnostics: []`. This worktree's real in-flight run
`inline-1085-8b6cdda2` projects byte-identically before and after (`precheck@1:running:attempts=2`,
`currentState: precheck`, same three `ambiguous-action` diagnostics). The probe's `runs`/`action_runs`
rows and `.spur/memory/runs/verify-1085-probe.{md,state.json}` were deleted; `workflow progress
verify-1085-probe` now reports "Run verify-1085-probe not found."

**Deferred (not this task)**: mapping more than one row per declared action inside a single visit
(retries recorded as repeated `node`+`kind`) still keeps today's behaviour — the first match is the
attempt and the extras are consumed silently; the design scoped visited-state rows there ("rows
consumed for a visited state keep today's ambiguous/skipped behaviour"), and changing it would alter
engine projections (R5). Ordering also inherits `action_runs.created_at` ties from the DAO. Both are
pre-existing; neither is reachable from the inline evidence this task fixes.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Visits are derived from recorded rows: `packages/app/src/workflow/progress-projection.ts:211` holds `deriveInlineStateVisits`, which groups rows whose `node` names a declared state into contiguous visits, and `packages/app/src/workflow/progress-projection.ts:385` derives them only when `transitions.length === 0`; `packages/app/src/workflow/progress-projection.ts:405-413` seeds the visit sequence from them, falling back to `initialState` only when there are no rows at all, and `packages/app/src/workflow/progress-projection.ts:496-501` marks candidate rows consumed only for a visited state. Re-ran (cd packages/app && bun test tests/workflow/progress-projection.test.ts) this verify: 14 pass / 0 fail (83 expect, 1.89s). `packages/app/tests/workflow/progress-projection.test.ts:485` asserts each seeded state with rows is visited in row order with its attempts at `:530-532`; the terminal inline case at `packages/app/tests/workflow/progress-projection.test.ts:537` asserts no recorded-work state is left pending at `:575`. Live on this worktree's DB, re-run this verify: `bun apps/cli/src/index.ts workflow progress inline-1085-8b6cdda2 --json` reports transitions 0 with precheck@1 passed attempts=2, implement@1 passed attempts=4, test@1 passed attempts=1, test-recheck@1 passed attempts=2, triage@1 passed attempts=2, review@1 running attempts=2 — no state holding recorded rows reads pending. |
| R2 | MET | Visit order and current state come from recorded evidence: `packages/domain/src/dao/action-run-dao.ts:39` loads rows with ORDER BY created_at, the recorded order `deriveInlineStateVisits` groups, and `packages/app/src/workflow/progress-projection.ts:388-392` sets `currentState` to the last derived visit for a pending or running run instead of the definition's `initialState`. Re-ran the app suite (14 pass / 0 fail): `packages/app/tests/workflow/progress-projection.test.ts:522` expects `currentState` `test` rather than the declared initial `precheck`, and `:524-528` expects row order first with rowless declared states appended after; the re-entry case pins the order at `packages/app/tests/workflow/progress-projection.test.ts:638` with `currentState` `implement` at `:645`. Live: `inline-1085-8b6cdda2` reports `currentState` review (its last recorded node) with transitions 0. |
| R3 | MET | One visit per contiguous same-node row group, numbered per state, each visit owning its own rows: `packages/app/src/workflow/progress-projection.ts:214-231` numbers visits per state, `packages/app/src/workflow/progress-projection.ts:160-168` carries the group on the visit, and `packages/app/src/workflow/progress-projection.ts:479` consumes it through `visitRows`. Re-ran the app suite (14 pass / 0 fail): `packages/app/tests/workflow/progress-projection.test.ts:587` seeds two contiguous `implement` groups separated by a `test` row and asserts `implement@1` owns ar-i1-agent and ar-i1-shell while `implement@2` owns ar-i2-agent and ar-i2-shell at `:647-648`, so the re-entered visit is not a replay of the first. Live: `inline-1085-8b6cdda2` projects one visit number per contiguous group, no state duplicated. |
| R4 | MET | The two-cause split is delivered and tested: `packages/app/src/workflow/progress-projection.ts:590-606` splits unclaimed rows by cause, `packages/app/src/workflow/progress-projection.ts:596-601` emits the new `unvisited-state-row` for a declared state the run did not visit, `packages/app/src/workflow/progress-projection.ts:603-605` keeps `orphan-action-row` for a node no declared state action claims, one diagnostic per unclaimed row; the enum member is declared at `packages/app/src/workflow/progress-projection.ts:151` and mirrored at `packages/contracts/src/runs.ts:73-76`. Re-ran the app suite (14 pass / 0 fail): `packages/app/tests/workflow/progress-projection.test.ts:653` asserts exactly one `unvisited-state-row` naming row a2 and implement at `:677-680`; the 0868 case at `packages/app/tests/workflow/progress-projection.test.ts:62` now asserts exactly one `orphan-action-row` naming a2 and ghost at `:83-87`. Live: `inline-1085-8b6cdda2` yields 11 `ambiguous-action` plus 1 `orphan-action-row` naming row bd8ed76e (node test-recheck, kind file.read.into-var). Residual, deferred and not fixed (review P3 finding 1, Disposition Deferred, operator 2026-10-04): of that run's 36 recorded rows, 22 are named in no diagnostic — 17 are consumed by actions the projection marks `ambiguous` (a per-action mapping gap the projection does diagnose, not a per-row drop) and 5 are extra same-kind rows of a passed action (test proof.fingerprint 8d41846d, d8735648, 494296bb; test-recheck shell c68a6b71; triage decide 5861da85). That case is pre-existing behaviour the task Design scoped out (rows consumed for a visited state keep today's behaviour) and is the retry-row visibility follow-up named in the Review dispositions. |
| R5 | MET | The engine visit source is untouched: `packages/app/src/workflow/progress-projection.ts:385` gates derivation on `transitions.length === 0`, so with transition rows present visits still come from `transition_runs` at `packages/app/src/workflow/progress-projection.ts:415-423` and `currentState` from the last transition at `packages/app/src/workflow/progress-projection.ts:320-322`. Re-ran the app suite (14 pass / 0 fail): the engine-style case at `packages/app/tests/workflow/progress-projection.test.ts:686` seeds rows in the reverse of the transition order and asserts the transition-derived visits, statuses and empty diagnostics at `:723-736`, and the pre-existing completed-run case at `packages/app/tests/workflow/progress-projection.test.ts:174` stays green. No engine, persistence-adapter, action_runs column or migration change: commit e9cd06aa0 touches exactly 5 files — `packages/app/src/workflow/progress-projection.ts`, `packages/contracts/src/runs.ts`, `packages/app/tests/workflow/progress-projection.test.ts`, `docs/design/workflow-observability.md`, `docs/design/run-record-contract.md`. Documented deviation, deferred and not fixed (review P3 finding 2, Disposition Deferred): diagnostics are not byte-identical for transition-present runs, because the consumed-rows gate at `packages/app/src/workflow/progress-projection.ts:496` also applies when transitions exist, so a row of a declared state the run never visited now yields `unvisited-state-row` where it was previously consumed silently; the commit's own R4 case proves it on an engine-branch fixture at `packages/app/tests/workflow/progress-projection.test.ts:653`, the task Solution carries it as a scope note, and the two doc sentences still claiming byte-identical diagnostics (`docs/design/workflow-observability.md:279`, `docs/design/run-record-contract.md:64`) are the deferred reword. No engine visit, attempt or status changes. |
| R6 | MET | One projection for both transports: the contract change is a single enum member at `packages/contracts/src/runs.ts:75` with no field added or changed, so no wire or client-side parse change is needed and `apps/web` is absent from commit e9cd06aa0; the Board renders the same projection as before, reading `diagnostic.code` and the message at `apps/web/src/modules/observability/TraceTab.tsx:684`. Re-ran this verify: (cd apps/server && bun test tests/modules/runs/index.test.ts) 15 pass / 0 fail, including the 1069 bidirectional assignability guard; (cd apps/web && bun test tests/modules/observability/) 136 pass / 0 fail across 7 files, unchanged. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — An inline run's detail shows every state it visited and hides no recorded action | MET | test | Re-ran (cd packages/app && bun test tests/workflow/progress-projection.test.ts) this verify: 14 pass / 0 fail (83 expect, 1.89s). `packages/app/tests/workflow/progress-projection.test.ts:485` seeds rows across several states with zero transition rows and asserts each is visited in row order with its attempts at `:524-532`; the terminal inline case at `packages/app/tests/workflow/progress-projection.test.ts:537` asserts no visited state is left pending at `:575`; `packages/app/tests/workflow/progress-projection.test.ts:653` asserts a row whose state the run did not visit produces its own diagnostic at `:677-680`; `packages/app/tests/workflow/progress-projection.test.ts:62` asserts a row whose node matches no declared state keeps exactly one `orphan-action-row` at `:83-87`. Live check on this worktree's DB, re-run this verify: `bun apps/cli/src/index.ts workflow progress inline-1085-8b6cdda2 --json` reports transitions 0, `currentState` review, and six states visited with their attempts (precheck 2, implement 4, test 1, test-recheck 2, triage 2, review 2) with no definition-drift diagnostic. Limit, deferred and not fixed (review P3 finding 1, Disposition Deferred): five extra same-kind rows on that run (test proof.fingerprint 8d41846d, d8735648, 494296bb; test-recheck shell c68a6b71; triage decide 5861da85) are hidden without a diagnostic naming them — the retry-row visibility follow-up, not the state-visit gap this AC was raised for. |
| AC2 — A run detail shows states, actions with durations and transitions | MET | test | Re-ran this verify: (cd packages/app && bun test tests/workflow/progress-projection.test.ts) 14 pass / 0 fail and (cd apps/web && bun test tests/modules/observability/) 136 pass / 0 fail across 7 files. `packages/app/tests/workflow/progress-projection.test.ts:686` seeds transition rows plus state visits and asserts the transition-derived visits, statuses, per-attempt durations and empty diagnostics at `:723-736`, with rows deliberately in reverse transition order; the pre-existing completed-run case at `packages/app/tests/workflow/progress-projection.test.ts:174` (states, actions, attempts with durations, transitions, artifacts, nextTransitions) is green in the same run; terminal transition-less runs keep a null current state at `packages/app/tests/workflow/progress-projection.test.ts:574`. `apps/web/tests/modules/observability/trace-tab.test.tsx:348` (states in order with attempts and durations, transitions, diagnostics) passes unchanged, and no `apps/web` file is part of commit e9cd06aa0, so the Board consumes the same projection. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1085

**Scope:** commit `e9cd06aa0` on `sp/run-1085-7647` (Step 3 recipe: one commit tagged `(1085)`; 5 changed files, task file excluded) — `packages/app/src/workflow/progress-projection.ts`, `packages/contracts/src/runs.ts`, `packages/app/tests/workflow/progress-projection.test.ts`, `docs/design/workflow-observability.md`, `docs/design/run-record-contract.md`.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture (`--focus all`)
**Verdict:** PASS — no P1/P2 findings; 2 × P3 (minor) and 2 × P4 (advisory) recorded. R1/R2/R3/R6 MET, R4/R5 MET-as-scoped with the residual clauses named in findings 1–2. Engine visit source untouched; the derived-transition-less path is correct and covered by fresh tests, and every gate named in the task re-ran green this review.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | functional | R4 / AC1 "no recorded row is silently dropped" is not met for same-kind rows beyond the first match inside one visit: a visited state's whole candidate set is marked claimed while only `candidateRows[0]` becomes an attempt, so extra `node`+`kind` rows (retries) are consumed with neither attempt nor diagnostic. The task's Solution records this as deferred, but R4's text, AC1's "hides no recorded action" and E72 R10's "no recorded action row is dropped without a diagnostic naming it" still assert it. Live this review, 5 of 34 `action_runs` rows on `inline-1085-8b6cdda2` appear in no attempt and in no diagnostic message: `8d41846d…`/`d8735648…`/`494296bb…` (`test`/`proof.fingerprint`), `c68a6b71…` (`test-recheck`/`shell`), `5861da85…` (`triage`/`decide`). Disposition required: accept explicitly by narrowing R4/AC1 (+ E72 R10) to the delivered two-cause split and filing the retry-row follow-up, or fix — a fix also adds diagnostics to transition-present runs and must reword R5 with it. | `packages/app/src/workflow/progress-projection.ts:494-540`, `:588-605` | Deferred — pre-declared scope boundary (## Design: rows consumed for a visited state keep today's behaviour); operator decision 2026-10-04: remaining issues wait; follow-up = retry-row visibility task |
| 2 | P3 (minor) | correctness | Engine-run diagnostics are not byte-identical, contradicting R5's clause and two same-commit doc sentences: the `isVisited` consumption gate applies to transition-present runs too, so a row whose `node` is a declared state the run never visited now yields `unvisited-state-row` where the old code consumed it silently. The commit's own R4 test seeds a transition (`precheck → done`), i.e. an engine-branch fixture, and asserts exactly that new diagnostic — the deviation is proven by the shipped tests, disclosed in the task's Solution scope note, and absent from the design docs. | `packages/app/src/workflow/progress-projection.ts:496`, `packages/app/tests/workflow/progress-projection.test.ts:653`, `docs/design/workflow-observability.md:279`, `docs/design/run-record-contract.md:64` | Deferred — documentation-wording accuracy only; delivered path additive and covered; operator decision 2026-10-04: remaining issues wait; follow-up = reword the two doc sentences |
| 3 | P4 (advisory) | usability | A terminal transition-less run keeps `currentState: null` by design, so a failed inline run's last state reads `passed` while its own action row reads `failed`, and `nextTransitions` is empty — the engine path marks the current state `failed`. Worth a follow-up if the Trace tab is to name the failing state for inline runs. | `packages/app/src/workflow/progress-projection.ts:388-392`, `:461-472` | Deferred — advisory; operator decision 2026-10-04: remaining issues wait |
| 4 | P4 (advisory) | usability | `isCurrent` compares state ids, not visit numbers, so both visits of a re-entered current state read `running`; the new R3 test deliberately leaves statuses unpinned, so the derived path's per-visit statuses have no assertion pinning them and a future regression there would still pass. | `packages/app/src/workflow/progress-projection.ts:458`, `packages/app/tests/workflow/progress-projection.test.ts:587-640` | Deferred — advisory; operator decision 2026-10-04: remaining issues wait |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `deriveInlineStateVisits` (`packages/app/src/workflow/progress-projection.ts:211-232`) + derive branch (`:385-412`); test `:485` asserts rows drive visits in row order; live `inline-1085-8b6cdda2` reports `precheck@1 passed attempts=2`, `implement@1 passed attempts=4`, `test@1 passed attempts=1`, `test-recheck@1 passed attempts=2`, `triage@1 running attempts=2` — no state with rows left `pending`. |
| R2 | MET | `:388-392` sets `currentState` to the last derived visit for `pending`/`running`; test `:485` expects `test`, not the declared initial `precheck`; live probe reports `currentState: triage` with `transitions: 0`. |
| R3 | MET | contiguous same-`node` grouping numbered per state (`:214-231`); test `:587` asserts `implement@1` then `implement@2`, each owning its own rows (`ar-i1-*` vs `ar-i2-*`). |
| R4 | PARTIAL | Two-cause split delivered and tested — `unvisited-state-row` (`:596-601`) vs unchanged `orphan-action-row` (`:602-605`), named by test `:653` (declared state not visited) and `:83` (unknown node, exactly one diagnostic). Residual: same-kind rows beyond the first match inside one visit stay unnamed (finding 1); live accounting on `inline-1085-8b6cdda2`: 34 rows = 11 attempts + 17 rows consumed under `ambiguous-action` + 1 `orphan-action-row` + 5 unnamed. |
| R5 | PARTIAL | Engine branch untouched (`:385` gate; visits still from transitions at `:413-423`), engine-style test `:686` passes with rows seeded in reverse transition order; diff is 5 files with no engine / `DbWorkflowPersistenceAdapter` / migration / `action_runs` column change. Diagnostics are not byte-identical for a declared-but-unvisited state's rows (finding 2). |
| R6 | MET | Contract change is one enum member only (`packages/contracts/src/runs.ts:73-76`), no field; 1069 bidirectional assignability guard green (`apps/server/tests/modules/runs/index.test.ts`); no web edit — the Board consumes the one projection (`apps/web/src/modules/observability/TraceTab.tsx:684-690` renders `diagnostic.code` + `message` unchanged). |

##### Verification Evidence (re-run this review)

| Check | Result |
|-------|--------|
| `(cd packages/app && bun test tests/workflow/progress-projection.test.ts)` | 14 pass / 0 fail (83 expect, 4.06s) — includes all 6 new 1085 cases and the tightened 0868 orphan assertion |
| `(cd apps/web && bun test tests/modules/observability/)` | 136 pass / 0 fail across 7 files (845 expect, 6.42s) — Board suites unchanged |
| `(cd apps/server && bun test tests/modules/runs/index.test.ts)` | 15 pass / 0 fail — "WorkflowProgressProjection and …Dto stay assignable in both directions (R5)" green |
| `bun run typecheck` | exit 0 — all 7 workspaces plus `scripts` and `plugins/sp` |
| `(cd packages/contracts && bun test tests/runs-contract.test.ts)` | 4 pass / 0 fail — widened enum accepted; `schemaVersion 2` / bad status still rejected |
| `(cd apps/cli && bun test tests/commands/workflow.test.ts -t "spur workflow progress")` | 4 pass / 0 fail — CLI consumer of the projection unchanged |
| `bun apps/cli/src/index.ts workflow progress inline-1085-8b6cdda2 --json` (live repo DB) | `status: running`, `currentState: triage`, `transitions: 0`; 5 states with rows visited with attempts, the other 10 declared states appended `pending`; diagnostics = 11 `ambiguous-action` + 1 `orphan-action-row`, no drift |

##### Residual Risk

- Findings 1–2 are wording-scope issues on the requirement/design side; the code path the task targeted (derived visits, two-cause diagnostics, additive contract enum) is correct, additive and covered. Leaving finding 1 un-dispositioned means the Trace tab still hides a retried action's later rows for inline runs.
- Out of the reviewed commit: `docs/features/E72_observability-trace-tab-for-workflow-run-inspection.md:132` still lists 1085 as `backlog` while the task is `wip`; the record stage's feature sync should refresh it.
- Not re-litigated per the run brief: the repo-wide `bun run spur-check` FAIL is host-attributable subprocess timeouts (`proof-fingerprint`, `config-layering`, `agent doctor`), not this diff.

**Next:** disposition finding 1 (accept-and-narrow the R4/AC1/E72 R10 wording, or file the retry-row follow-up) and correct the two `byte-identical` engine-diagnostics sentences for finding 2 — both wording-level, no code change required in the derived-visit path.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-04T23:18:50.647Z backlog → wip (system)
- 2026-10-05T01:56:57.914Z wip → testing (system)
- 2026-10-05T01:57:46.492Z testing → done (system)

