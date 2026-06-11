---
name: Workflow engine observability and action-level persistence
description: Add action_runs two-phase persistence, enrich the workflow event map (runId, dryRun, HITL, guards), lock the custom-event design, and define the event-map compatibility policy
status: Done
created_at: 2026-06-11T21:00:00.000Z
updated_at: 2026-06-11T20:25:22.345Z
folder: docs/tasks
type: task
feature-id: ""
preset: complex
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0039. Workflow engine observability and action-level persistence

### Background

Extracted from task 0038 (see its "Alignment decisions") after the event-design discussion showed the
engine-side persistence + observability work had outgrown a sub-item. Task 0038 keeps the CLI surface
(`workflow list` fix, `workflow trace` + filters over existing tables, `rule trace` placeholder);
this task owns everything `ts-dual-workflow-engine`-side.

**Verified facts this design rests on (2026-06-11):**

- The engine persists run history through **direct adapter calls** (`RunLifecycle` →
  `WorkflowPersistenceAdapter`), written **incrementally during execution**: `runs` row at start
  (status `running`), `workflow_states` + `phase_runs` at every state entry (before actions run),
  `transition_runs` per transition, finalize at end. The EventBus mirrors these moments but persists
  nothing.
- `actionStart`/`actionDone` (`run-lifecycle.ts:155-164`) emit events + OTel spans only — **no
  persistence call**. Action kind/duration/ok/result never reach the DB. This is the gap.
- The bus is per-run (`WorkflowRunOptions.events`), emission is fire-and-forget (`void emit`),
  handler errors are swallowed, async handlers are not awaited — a bus-downstream persister would be
  best-effort by construction (the CLI process can exit before subscribers finish).
- The README "Event Map" section matches `events.ts` exactly (verified) — 10 events, all fixed names.
- Interactive HITL prompts emit **no events** (only the `note` action emits `workflow.hitl.note`).
- Guard evaluation (`firstPassingTransition`) is silent — no event for which edge was chosen or why.

### Requirements

#### R1 — Action-level persistence (`action_runs` + two-phase `saveAction`)

1. `WORKFLOW_ENGINE_SCHEMA_SQL`: add `action_runs` (id, run_id, node, kind, status, duration_ms, ok,
   result_json, started_at, completed_at, created_at, updated_at; FK → runs).
2. `WorkflowPersistenceAdapter`: add `saveAction()` (or start/finalize pair) — **two-phase**: insert
   with status `running` at action start, update with duration/ok/result at settle. Two-phase is what
   makes an in-flight action visible to `spur workflow trace <run-id>` (the progress requirement).
3. Call sites: `StateMachineDriver.runActions()` and `TransitionFlowDriver.loop()`, next to the
   existing `actionStart`/`actionDone` emission sites. Direct adapter calls — NOT an EventBus
   subscriber (see Q1).
4. `DbWorkflowPersistenceAdapter` + `MemoryWorkflowPersistenceAdapter` implementations + upstream tests.
5. Skipped under `dryRun` (actions don't run; nothing to record).

#### R2 — Event payload enrichment (additive only)

1. Add `runId` to **every** event payload (today only `run.started` carries it; all else relies on
   the one-bus-per-run convention, which breaks if a bus is shared or events are forwarded).
2. Add `dryRun: boolean` to `run.started` so observers can label dry runs without metadata lookups.
3. All additions are optional/additive — see R6 compatibility policy.

#### R3 — HITL observability events

1. Emit when an interactive prompt starts and resolves (names at impl time, e.g.
   `workflow.hitl.ask` `{ node, kind, message }` / `workflow.hitl.response` `{ node, ok }`).
2. "Waiting on human input" is the most important live state for a HITL workflow and is currently
   invisible to observers.

#### R4 — Guard observability

1. Emit guard evaluation outcome (e.g. `workflow.guard.evaluated` `{ from, to, kind, passed }`), or
   enrich `node.transition` with the selected guard — decide at impl time, additive either way.
2. Motivation: guard-ordering bugs are real (see cerebrum history); today they are undebuggable from
   events.

#### R5 — Custom-event YAML mapping (design locked, implementation DEFERRED)

1. Keep the event map **fixed/closed**; dynamic semantics live in payloads. The customization
   mechanism compiles down to the existing `workflow.custom { name, payload }` envelope:

```yaml
events:
  - on: node.enter            # fixed engine event
    when: { node: deploy }    # optional selector
    emit: deploy.started      # dynamic name (rides workflow.custom)
    payload: { env: '${vars.env}' }
```

2. **Do not implement until a real consumer exists** (notifications/webhooks, server-mode streaming).
   The `event.emit` builtin action already covers emission at action positions; this mapping adds
   non-action positions (transitions, run start/end) only.

#### R6 — Event-map compatibility policy + SSOT

1. The event map is a cross-package public contract. Policy: **additive-only** — new events allowed,
   new optional payload fields allowed; never rename, remove, or repurpose.
2. README "Event Map" section stays the documented SSOT; add an upstream conformance test asserting
   the README table matches `WorkflowEngineEvents` (drift guard).
3. Document the subscriber contract: handlers must be fast and non-throwing; async handlers are not
   awaited by the engine; durable behavior must never depend on event delivery.

#### R7 — Redaction boundary for `result_json`

1. Once action results/options persist, secrets in action options (e.g. `http.request` headers) land
   on disk. Decide: engine accepts an optional redactor hook on the adapter/options, vs Spur passes
   pre-redacted values. Resolve at design review before R1 ships.

#### R8 — Spur integration + release

1. Release the engine (train also carries the pending 0.3.12 `dryRun` fix); bump Spur catalog; drop
   the temporary `link:` entries (tracked in 0038).
2. Spur: `spur workflow trace <run-id>` joins `action_runs` into the `created_at`-ordered timeline
   (no re-architecture — one more table in the same join).
3. Retention note for the roadmap: `phase_runs`/`transition_runs`/`action_runs` grow unbounded;
   define a prune/cap policy later (not in this task).

### Q&A

**Q1. Why direct persistence instead of an EventBus subscriber?**
Verified grounds: the engine emits fire-and-forget (`void emit`), the bus swallows handler errors,
async handlers are not awaited, and no bus injected = no events at all. A bus-downstream persister is
best-effort by construction — wrong property for an audit/history store. Direct writes keep one
ordered write path (`RunLifecycle`) consistent with every other run record. Events remain the channel
for in-process, lossy-tolerant observers (live progress UI, logging, telemetry, future server SSE).
**Durable state → direct adapter calls; ephemeral observation → events.**

**Q2. Why two-phase action persistence?**
Single insert-at-done is simpler but leaves the in-flight action invisible — `trace <run-id>` on a
running workflow couldn't show "shell action running, 90s elapsed", which is the progress
requirement. Two-phase mirrors the `runs` pattern (createRun → finalizeRun).

**Q3. Why keep the event map fixed?**
The ts-infra EventBus is key-typed by deliberate design; subscribers get compile-checked payloads; a
closed map is a versionable public contract consumed across a semver boundary. Dynamic event names
make subscribers stringly-typed. Dynamic semantics belong in the payload — `workflow.custom` is that
escape hatch, and R5's mapping compiles down to it.

**Q4. How is execution progress observed without push infrastructure?**
DB polling. The engine already writes states/transitions incrementally mid-run; with R1, in-flight
actions become visible too. `spur workflow trace <run-id>` re-run (or a later `--follow` sugar flag)
is sufficient for the CLI; SSE/push belongs to future server mode.

### Plan

1. **Upstream (ts-libs, one change set):** R1 schema + adapter + driver call sites; R2 payload
   enrichment; R3 HITL events; R4 guard event; R6 conformance test + README/event-map policy; R7
   redaction decision. Upstream gates green.
2. **Release:** publish engine (with the pending dryRun fix), bump Spur catalog, drop `link:` entries.
3. **Spur:** join `action_runs` into `trace <run-id>`; label in-flight actions; tests.
4. **Docs:** README Event Map update (SSOT), `docs/04_DESIGN.md` trace output gains action lines.

Follow-on task (create after this one completes): **rule-engine persistence seam** (option (a) —
`RulePersistenceAdapter` + `rule_runs`/`rule_eval_runs`, mirroring this task's pattern) to put real
data behind 0038's `spur rule trace` placeholder. Seed notes live in 0038's Design section.

### Design

- Engine-owned persistence remains direct adapter writes, not EventBus subscription. The released
  `@gobing-ai/ts-dual-workflow-engine@0.3.14` schema owns `action_runs`; drivers insert a running row
  at action start and finalize it with duration, ok flag, and result payload when the action settles.
- Spur owns only the CLI read model: `ActionRunDao` reads `action_runs` if present and `WorkflowAppService`
  interleaves phases, transitions, and actions by `created_at` for `spur workflow trace <run-id>`.
- Event observability remains typed and additive. HITL prompt actions emit `workflow.hitl.ask` and
  `workflow.hitl.response`; guard evaluation emits `workflow.guard.evaluated`; dynamic event semantics
  remain inside the fixed `workflow.custom` envelope.
- The public surface is the released `0.3.14` package train. No `link:` dependency or unpublished engine
  assumption remains in Spur.

### Solution

- Bumped the root Bun catalog and lockfile to the released `@gobing-ai/ts-*` `0.3.14` train.
- Removed HITL `@ts-expect-error` suppressions now that the released engine event map defines the
  prompt events.
- Added `ActionRunDao` and wired `WorkflowAppService.traceRun()` / CLI formatting so action rows appear
  in trace timelines with kind, duration, and in-flight/success/failure marker.
- Added regression coverage proving a normal workflow action persists through engine migrations and is
  rendered by `spur workflow trace <run-id>`.
- Narrowed optional-table tolerance so missing `action_runs` returns an empty timeline for old DBs, while
  unrelated DB failures still surface.
- Updated `docs/04_DESIGN.md` to document action execution rows in workflow trace output.

### Testing

- `action_runs` rows: two-phase (running row visible mid-action; finalized with duration/ok/result)
- Dry run writes no action rows
- Every event payload carries `runId`; `run.started` carries `dryRun`
- HITL ask/response events fire around an interactive prompt; guard event reflects chosen edge
- README Event Map conformance test fails on drift
- Spur: `trace <run-id>` timeline interleaves states, transitions, and actions in `created_at` order

### Verification — 2026-06-11

**Verdict:** PASS
**Mode:** `rd3-dev-verify 0039 --auto --fix all --force`
**Scope:** task 0039 plus current Spur working-tree changes and released `@gobing-ai/ts-*` `0.3.14`.
**Gate:** `bun run lint` pass; `bun run test` pass (537 tests); `bun run test-cf` pass; `bun run build` pass.

#### Requirements Traceability

- [x] **R1** Action-level persistence -> **MET** | Spur resolves released `@gobing-ai/ts-dual-workflow-engine@0.3.14`; installed `WORKFLOW_ENGINE_SCHEMA_SQL` contains `action_runs`, and the CLI trace regression proves a normal workflow action is persisted and rendered.
- [x] **R2** Event payload enrichment -> **MET** | Installed `events.d.ts` includes `runId` on workflow event payloads and `dryRun` on `workflow.run.started`.
- [x] **R3** HITL observability events -> **MET** | Spur HITL runners emit typed `workflow.hitl.ask` / `workflow.hitl.response` with no `@ts-expect-error` suppressions.
- [x] **R4** Guard observability -> **MET** | Installed engine `0.3.14` exposes and emits `workflow.guard.evaluated`.
- [x] **R5** Custom-event YAML mapping -> **MET** | Design-only/deferred; no implementation expected.
- [x] **R6** Event-map compatibility policy + SSOT -> **MET** | Released README documents the event map, including `workflow.guard.evaluated` and `workflow.hitl.ask`.
- [x] **R7** Redaction boundary -> **MET** | Released engine exposes `ActionRedactor` in the action persistence contract.
- [x] **R8** Spur integration + release -> **MET** | Root catalog and `bun.lock` resolve the full `@gobing-ai/ts-*` train to `0.3.14`; `workflow trace <run-id>` joins action rows into the timeline and docs describe the action line shape.

#### SECU Findings

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | ActionRunDao swallowed non-schema DB failures | Correctness | `packages/domain/src/dao/action-run-dao.ts:28` | Fixed: only `no such table: action_runs` returns an empty timeline; other DB errors now rethrow, covered by `packages/domain/tests/dao/action-run-dao.test.ts:95`. |

**Fix-pass 2026-06-11:** 3 fixed, 0 failed, 0 skipped. Dependency resolution now points to released `0.3.14`; HITL suppressions removed; DAO error handling narrowed.

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| | | | |

### References

- Task 0038 — CLI surface, alignment decisions, verification findings
- `~/xprojects/ts-libs/packages/dual-workflow-engine/src/run-lifecycle.ts` — write path + emission sites
- `~/xprojects/ts-libs/packages/dual-workflow-engine/src/persistence.ts`, `schema-sql.ts` — adapter + schema to extend
- `~/xprojects/ts-libs/packages/dual-workflow-engine/README.md` §"Event Map" — event SSOT (verified accurate 2026-06-11)
- `~/xprojects/ts-libs/packages/infra/src/event-bus/event-bus.ts` — emit semantics (fire-and-forget, errors swallowed)
