---
schema_version: 1
name: Project inline state visits and surface unmapped action rows in the progress projection
status: backlog
template: standard
created_at: 2026-10-04T22:48:26.495Z
updated_at: "2026-10-04T23:16:13.141Z"

feature_id: E72
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

- [ ] R1. An inline run's projection marks every state whose action rows were recorded as visited, so a
  state with recorded work is never presented as `pending`.
- [ ] R2. Visit order and `currentState` come from recorded evidence, not from the definition's
  declaration order: states are ordered by their earliest recorded row (the driver writes rows in
  execution order), and a non-terminal run's `currentState` is its last visited state.
- [ ] R3. Repeated visits stay distinguishable — a state the run re-entered (e.g. `implement`, a
  `loopBack` state) yields one visit per contiguous group of its rows, numbered per state as today.
- [ ] R4. No recorded row is silently dropped: any `action_runs` row that the projection does not
  surface as an attempt or a skipped/ambiguous action keeps producing a diagnostic naming the row
  (`orphan-action-row` or a named sibling for the unvisited-state case).
- [ ] R5. Engine runs are unchanged: when transition rows exist they stay the visit source, their
  projections and diagnostics are byte-identical, and no engine, persistence-adapter or migration
  change is introduced.
- [ ] R6. One projection for both transports: the Board consumes the same output unchanged (no
  web-side derivation), and `workflowProgressProjectionSchema` needs no wire change (or gains only
  additive fields with the 1069 assignability guard still green).

### Acceptance Criteria

- [ ] AC1 — An inline run's detail shows every state it visited and hides no recorded action

Task-local verification: a projection fixture seeded with `action_runs` rows across several states and
zero transition rows reports each of those states as visited (in row order) with its attempts, and a
terminal run has no visited state left `pending`; a row whose state the run did not visit, and a row
whose node matches no declared state, each produce their own diagnostic. Live check on this repo's DB:
`spur workflow progress inline-1071-2be5d0be --json` shows `implement`, `test`, `review`, `verify`,
`record` and `done` visited with their attempts instead of `pending`.

- [ ] AC2 — A run detail shows states, actions with durations and transitions

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
- [ ] 5. Gates:
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

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
