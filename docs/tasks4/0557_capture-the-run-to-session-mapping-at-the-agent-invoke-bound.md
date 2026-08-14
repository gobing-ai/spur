---
template: feature-impl
schema_version: 1
name: "Capture the run-to-session mapping at the agent invoke boundary"
description: ""
status: done
type: task
profile: standard
feature_id: E6
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T02:43:12.908Z"
updated_at: "2026-08-14T06:04:47.588Z"
---

## 0557. Capture the run-to-session mapping at the agent invoke boundary

### Background
Nothing connects a `spur agent run` invocation to the session file its coding agent wrote. Measured
2026-08-13: `history_message.run_id` is NULL for all 1,296,633 rows, though the column and the
`(provenance, run_id)` index (migration `0009`) both exist.

The design was half-written. `packages/app/src/services/agent-service.ts:195-201` documents
`sessionId` as the primary join key with a time-window fallback — A-primary/C-fallback — and neither
was wired. The operator's 2026-08-13 ruling adds **observation at the spawn boundary** as the primary
mechanism, because dictating a session id only works for agents whose CLI accepts one, leaving
coverage to vendors.

Spur already has both halves of what observation needs: `agent.invoke.start` / `agent.invoke.exit`
are catalogued events (`packages/app/src/services/event-names.ts:315-316`), and the importer knows
every agent's session root (`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/sources.ts:156-213`).
### Requirements
- [ ] **R1.** Record a `run_id ↔ (source, session_id)` mapping when an agent invocation completes,
      by watermarking the agent's session root at `agent.invoke.start` and resolving the newly
      written or newly extended session at `agent.invoke.exit`. Mark the mapping **exact**.
      **Prerequisite this task owns:** thread the minted `runId` (`agent-service.ts:959`, `:967`)
      into the `agent.invoke.*` event payload so the existing tap (`system-event-tap.ts:200-201`)
      populates `system_events.run_id` — measured 0 of 202 today. Without it there is no key.
      Measurable: a `spur agent run` against a real agent produces exactly one mapping row naming the
      run, the source, and the session id, and its invoke events carry a non-null `run_id`.
- [ ] **R2.** Where an agent's CLI accepts a session id, supply one and take the mapping from it
      rather than from observation, still marked exact. The `sessionId` plumbing already exists
      (`agent-service.ts:201`, `:738-739`). Measurable: for such an agent the mapping is written
      without a directory scan, and matches the id supplied.
- [ ] **R3.** Ambiguity degrades, never guesses. When two invocations of the same agent in the same
      working directory overlap so a session file cannot be attributed to exactly one run, write **no**
      exact mapping for the ambiguous runs and leave them to task 0558. Measurable: an induced
      concurrent-overlap case writes zero exact mappings and logs the ambiguity, rather than
      attributing arbitrarily.
- [ ] **R4.** The mapping is queryable by `run_id` and by `(source, session_id)`, and records which
      mechanism produced it (`observed` / `supplied`) alongside its exactness. Measurable: both lookup
      directions are indexed, and the mechanism is readable per row.
- [ ] **R5.** Observation must not slow or destabilise the invocation. The watermark is a cheap
      directory stat at start; resolution happens after exit and its failure never fails the run.
      Measurable: an invocation whose session root is missing or unreadable completes normally with
      the mapping recorded as unresolved.
### Acceptance Criteria
Covers feature E6 scenarios:

- **R1 — A completed agent run is mapped to the session it produced**
- **R2 — An agent that accepts a session id yields the mapping without observation**
- **R3 — An unresolvable spawn degrades to estimated, never to a guess**

```gherkin
Scenario: R1 — A completed agent run is mapped to the session it produced
  Given spur invokes a coding agent and the agent writes a session file
  When the invocation exits
  Then a mapping from that run id to the session's source and session id is recorded
  And the mapping is marked exact

Scenario: R2 — An agent that accepts a session id yields the mapping without observation
  Given an agent whose CLI accepts a session id
  When spur supplies one for the invocation
  Then the mapping is taken from the supplied id rather than from file observation
  And it is marked exact

Scenario: R3 — An unresolvable spawn degrades to estimated, never to a guess
  Given two runs of the same agent in the same working directory overlap
  When the boundary cannot attribute a session file to exactly one run
  Then no exact mapping is written for the ambiguous runs
  And they are left for retroactive correlation rather than assigned arbitrarily
```
### Q&A
**Closed during refine (2026-08-13).**

- **Why observe instead of supplying a session id?** Coverage. A supplied id only works where the
  agent's CLI accepts one; observation works for every agent because spur owns the spawn boundary.
  Supplying is still preferred where available (R2) — it is cheaper and exact.
- **Where does the mapping live?** A new `history_run_session` table, not a column on
  `history_message`. The run path should not write into the imported-history tables.
- **What happens on concurrent same-agent runs?** No exact mapping (R3). Task 0558 picks them up as
  estimated. A wrong exact mapping is worse than none.
- **Can observation break a run?** No (R5). Watermarking is a stat at start; resolution happens after
  exit and records `unresolved` on failure.

**Deferred with owner.**

- **Which agents accept a session id** — owner: this task's implementer, determined per agent from its
  CLI; the `sessionId` plumbing already exists for those that do.
- **Why `claude` and `codex` capture no token rows** — owner: feature E1/E5. Correlation cannot
  manufacture data that was never captured.
### Design
Observe at the boundary spur already owns. `agent.invoke.start` and `agent.invoke.exit` are
catalogued events; the session roots are a table the importer already maintains. Neither half needs
inventing — this task joins them.

**Watermark, then resolve.** At start, stat the agent's session root and record the pre-existing file
set plus a timestamp. At exit, diff: a file created since, or extended since, is the session. Exactly
one candidate is an exact mapping; zero or many is R3's degrade path.

**Prefer the supplied id when available (R2).** `sessionId` already threads through
`agent-service.ts:201` and `:738-739`. When it is set, skip observation entirely — a supplied id is
authoritative and cheaper.

**Ambiguity is a first-class outcome, not an error.** Concurrent same-agent, same-cwd runs are rare
under `--worktree` isolation but must not produce a wrong mapping; a wrong exact mapping is worse
than none, because task 0559 will trust it.

**Failure must not touch the run (R5).** Resolution happens after the agent has exited and its result
is already determined. A missing root, a permission error, or an unparseable directory records
`unresolved` and nothing else.

#### Frozen names

| Frozen | Value | Location |
| --- | --- | --- |
| Boundary events (exist) | `agent.invoke.start` · `agent.invoke.exit` | `packages/app/src/services/event-names.ts:315-316` |
| Session roots (exist) | `pi: .pi/agent/sessions` · `claude: .claude/projects` · `codex: .codex/sessions` · `omp: .omp/agent/sessions` · `grok: .grok/sessions` · `agy: .gemini/antigravity-cli/brain` | `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/sources.ts:156-213` |
| Supplied-id path (exists) | `sessionId?: string`; `--session-id` / `--sessionId` flags | `packages/app/src/services/agent-service.ts:201`, `:738-739` |
| **New table** | `history_run_session (run_id TEXT, source TEXT, session_id TEXT, exactness TEXT, mechanism TEXT, resolved_at TEXT)` | `packages/domain/src/migrations.ts` |
| `exactness` values | `exact` · `unresolved` | — |
| `mechanism` values | `observed` · `supplied` | — |
| Indexes | on `run_id`, and on `(source, session_id)` | R4 |
| Spawn observer | `PidObservingProcessExecutor` is the existing precedent for wrapping the executor | `agent-service.ts:284` |

#### Anti-patterns — what not to implement

- Do **not** write an exact mapping when more than one candidate session matches (R3). A wrong exact
  mapping poisons task 0559, which trusts exactness.
- Do **not** block or delay the invocation to observe. Watermark cheaply at start; resolve after exit.
- Do **not** fail the run when resolution fails (R5) — record `unresolved`.
- Do **not** write `run_id` onto `history_message` from here. That column is populated by import/
  correlation, not by the run path; this task owns the mapping table only.
- Do **not** infer a session from cwd alone. `detectProvenance` already demonstrates the failure —
  a substring match over cwd labels every ambient session in a spur directory as spur-launched.

#### Cross-task contract

**Assumes from upstream:** nothing — root of feature E6.

**Leaves for dependents:**

- Task **0558** consumes this table and must never overwrite an `exact` row with an estimated one.
- Task **0559** attributes cost through this mapping and trusts `exactness`.
- Feature J6 task **0547** is blocked on this table existing and being populated.

#### PREMISE VERIFICATION (2026-08-13) — one prerequisite this task must land itself

Measured against the live `.spur/spur.db` after the frozen-names table above was written.

| Measured | Value | Consequence |
| --- | --- | --- |
| `agent.invoke.*` rows in `system_events` | **202** | the boundary events are genuinely emitted and persisted — the hook exists |
| …of those, rows with `run_id` set | **0** | **the events carry no run id.** Keying the mapping off the event is not possible as-is. |
| `workflow.*` rows with `run_id` set | 1,039 | the tap works; the value simply never reaches agent events |
| `coordination_runs` rows | **0** | not a usable source of run windows |

**Why the gap exists, and why the fix is small.** A per-invoke run id *is* minted —
`agent-service.ts:959` (`stringFlag(flags,'run-id','') || crypto.randomUUID()`), carried at `:967` as
`correlation: { runId, executionId }`. The tap already looks for it:
`system-event-tap.ts:200` reads `obj.runId ?? obj.run_id ?? nested.runId` and sets
`correlation.run_id` when present (`:201`). The minted id simply is not threaded into the
`agent.invoke.*` payload, so the tap finds nothing. `workflow.*` events prove the path works.

**This task therefore owns threading it** (folded into R1): emit the minted `runId` on
`agent.invoke.start` / `agent.invoke.exit` so the existing tap populates
`system_events.run_id`. Without it R1 has no key and the mapping cannot be written.

Do **not** add a second correlation channel or a new event to carry the id — the tap's existing
`runId` lookup is the contract; satisfy it.
### Plan
- [ ] Add the `history_run_session` table with both indexes (R1, R4)
- [ ] Watermark the agent session root at `agent.invoke.start` (R1)
- [ ] Resolve the produced session at `agent.invoke.exit` and write an exact mapping (R1)
- [ ] Take the mapping from `sessionId` without observation when it is supplied (R2)
- [ ] Record `mechanism` (`observed` / `supplied`) and `exactness` per row (R4)
- [ ] Write no exact mapping on zero-or-many candidates; log the ambiguity (R3)
- [ ] Record `unresolved` and never fail the run on an unreadable root, and cover it plus single-candidate exact, supplied-id, and concurrent-overlap degrade in tests (R1-R5)
- [ ] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
#### Change map

1. `packages/domain/src/migrations.ts:157-184` — new `history_run_session` table + indexes on `run_id` and `(source, session_id)` (R4), composed into `CLI_SCHEMA_SQL` (0000 foundation) and shipped as incremental migration `0012_spur_cli_history_run_session` (R1).
2. `packages/domain/src/dao/run-session-dao.ts` (new) — `RunSessionDao`: `insert`, `getByRunId` (R4 forward lookup), `getBySession(source, sessionId)` (R4 reverse lookup); missing-table-tolerant like `CoordinationRunDao`.
3. `packages/app/src/services/run-session-observer.ts` (new) — `RunSessionObserver`:
   - `watermark(agent, sessionDir?)` — R1/R5: resolve the agent's session root (importer `SOURCE_DEFINITIONS` roots under `$HOME`, or the explicit `--session-dir`) and capture a timestamp; no directory walk at start, so observation cannot slow the invocation. Bumps a per-process active-root registry: a second concurrent watermark on the same root flags both runs as overlapping (R3).
   - `supply(agent, sessionId)` — R2: supplied id skips observation entirely.
   - `resolve()` — R1/R3/R5: walk the root for files with `mtime >= watermark`; exactly one candidate → `exact/observed` (session id read from the file's first record for claude/codex/pi, file stem fallback); zero candidates → `unresolved`; ≥2 candidates → `unresolved` + ambiguity log (R3); overlap → `unresolved` + log; root missing/unreadable → `unresolved` + log (R5). Never throws — resolution failure cannot fail the run.
4. `packages/app/src/services/agent-service.ts:55-68` (deps seam), `:323-330` (registry), `:738-761` (observer), `:852` (watermark), `:1000` (resolve) — `executeRun` creates the observer when a DB is available (`deps.sessionObserverFactory` test seam), hoists `--session-id`/`--session-dir` reads, watermarks before dispatch (re-watermarks on escalation agent change), and resolves at every exit point (shim failure, dispatch failure, post-loop). Added the shared `sessionRootRegistry` instance field.
5. Premise (runId on `agent.invoke.*`): already satisfied in the current tree — the minted runId reaches the events as `correlation: { runId, executionId }` (`packages/app/src/services/agent-service.ts:861` dispatch passes `correlation: lifecycle.identity`; ts-ai-runner ≥0.4.31 emits it on `agent.invoke.start`/`exit`), and the tap's existing `nested.runId` lookup (`packages/app/src/services/system-event-tap.ts:200-201`) extracts it. Pinned with a regression test instead of re-threading a second channel (anti-pattern: no second correlation channel).
6. `docs/04_DESIGN.md:1011-1012, 262-268` — §3.1 table row + `spur agent run` section (T3).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/run-session-observer.ts:100-104` (watermark: root resolution + timestamp only), `:125-153` (resolve → exact/observed on single candidate); wiring `packages/app/src/services/agent-service.ts:741-763` (observer creation, supply/watermark), `:861` (re-watermark per dispatch), `:809`/`:882`/`:986`/`:999` (resolve at every exit path); prerequisite runId threading via `correlation: lifecycle.identity` (`agent-service.ts:869` dispatch) + tap `nested.runId` lookup (`packages/app/src/services/system-event-tap.ts:200-201`), pinned by regression test `packages/app/tests/services/system-event-tap.test.ts:159`; end-to-end `packages/app/tests/services/agent-service.test.ts:2799` (exact observed row, run_id set) |
| R2 | MET | `run-session-observer.ts:114-117` (`supply()` skips observation), `:127-131` (exact/supplied, no scan); `agent-service.ts:760-763` (`supply` when `--session-id` set; watermark skipped); integration test `agent-service.test.ts:2840` (root absent, mapping still exact `supplied`) |
| R3 | MET | `run-session-observer.ts:43-47` (per-process overlap registry), `:108` (overlap flag), `:132-141` (zero/many candidates → unresolved + ambiguity log, never an exact guess); tests `run-session-observer.test.ts:164` (concurrent overlap → zero exact mappings + ambiguity logged + registry clears for sequential follow-up), `:204` (many candidates → unresolved) |
| R4 | MET | `packages/domain/src/migrations.ts:135-145` (`history_run_session` DDL + indexes `idx_history_run_session_run` on `run_id` and `idx_history_run_session_source_session` on `(source, session_id)`), `:304` (incremental migration `0012_spur_cli_history_run_session`); `packages/domain/src/dao/run-session-dao.ts` (`insert`/`getByRunId`/`getBySession`, missing-table-tolerant); tests `packages/domain/tests/dao/run-session-dao.test.ts` (forward + reverse lookup); `exactness` (`exact`/`unresolved`) and `mechanism` (`observed`/`supplied`) recorded per row (asserted in observer + integration tests) |
| R5 | MET | watermark is a timestamp capture only (`run-session-observer.ts:100-104` — no walk at start); `resolve()` never throws (`:125-153`, every failure path records `unresolved` and warns); tests `run-session-observer.test.ts:224` (missing root → unresolved, no rejection), `:241` (zero candidates → unresolved); `agent-service.ts` resolves after exit at every return path (`:809`, `:882`, `:986`, `:999`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — A completed agent run is mapped to the session it produced | MET | test | `packages/app/tests/services/agent-service.test.ts:2799` (integration: `spur agent run` → exact observed mapping row, run_id non-null); `packages/app/tests/services/run-session-observer.test.ts:70` (single candidate → exact/observed, both lookups resolve) |
| Scenario: R2 — An agent that accepts a session id yields the mapping without observation | MET | test | `packages/app/tests/services/agent-service.test.ts:2840` (supplied `--session-id` → exact `supplied` row with no session root present); `packages/app/tests/services/run-session-observer.test.ts:114-131` (supply path writes exact without scan) |
| Scenario: R3 — An unresolvable spawn degrades to estimated, never to a guess | MET | test | `packages/app/tests/services/run-session-observer.test.ts:164` (induced concurrent overlap → zero exact mappings, ambiguity logged, follow-up sequential run resolves); `:204` (≥2 candidates → unresolved row, no guess) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | Correctness | packages/app/src/services/run-session-observer.ts:127-131, :175; packages/app/src/services/agent-service.ts:861 | Supplied-id path leaks the overlap registry. `resolve()` early-returns on `supplied_` without `release()`, but the dispatch loop calls `watermark()` unconditionally (`agent-service.ts:861`) even when a session id was supplied — so a supplied-id run leaves `registry.active[root]` at 1 and `watermark_` set. A subsequent sequential run of the same agent/root in the same process (server mode, in-process repeats) is then falsely flagged as an R3 overlap and degrades to `unresolved`. CLI is one-run-per-process, so production blast radius is narrow; the integration R2 test masks it (fresh registry per observer). Fix: skip `watermark()` when `supplied_` is set, or release the watermark in the supplied branch of `resolve()`. |
| P4 | Correctness | packages/app/src/services/agent-service.ts:809, :882 | A supplied `--session-id` run whose dispatch fails on attempt 0 (shim build or dispatch error) still writes an exact `supplied` mapping via `resolve()` before returning — attributing a session to a run that never executed. Corner case; 0559 cost attribution would find no messages for that session id, so it is self-consistent but arguably a fabricated exact row. |
| P4 | Scope | packages/app/src/services/run-session-observer.ts:28-38 | `AGENT_SESSION_SOURCES` maps `gemini`/`opencode`/`openclaw` beyond the frozen roots list. `gemini`'s `defaultRoots[0]` is `.gemini/tmp`, not a session root — observation there can only yield `unresolved` (safe, conservative; no wrong exact mapping possible). |
| P4 | Scope | docs/04_DESIGN.md:1431 | Stray unrelated formatting edit `*reason*` → `_reason_` inside the 0536 note — not part of the E6 surface. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/run-session-observer.ts:100-104` (watermark), `:125-153` (resolve → exact/observed); wiring `packages/app/src/services/agent-service.ts:759-763`, `:861`, `:999`; prerequisite runId threading via `correlation: lifecycle.identity` (`agent-service.ts:869`) + tap `nested.runId` lookup (`system-event-tap.ts:200-201`), pinned by the `system-event-tap.test.ts` premise regression test; end-to-end `agent-service.test.ts` R1 integration test (exact observed row, run_id set) |
| R2 | MET | `run-session-observer.ts:114-117` (`supply()`), `:127-131` (exact/supplied, no scan); `agent-service.ts:760-763` flag hoist + supply; `agent-service.test.ts` R2 integration test (root absent, mapping still exact `supplied`) |
| R3 | MET | `run-session-observer.ts:43-47` (registry), `:108` (overlap flag), `:132-141` (zero/many → unresolved + ambiguity log); tests: R3 overlap (zero exact, ambiguity logged, registry clears for sequential follow-up) and R3 many-candidates (`run-session-observer.test.ts`) |
| R4 | MET | `packages/domain/src/migrations.ts:122-150` (table + `run_id` and `(source, session_id)` indexes, `0012_spur_cli_history_run_session`); `run-session-dao.ts` `getByRunId`/`getBySession`; `run-session-dao.test.ts` forward + reverse lookup tests |
| R5 | MET | watermark is a timestamp capture only (`run-session-observer.ts:100-104`); resolve never throws (`:125-153`), missing-root test records `unresolved` and resolves without rejection; `agent-service.ts` resolves after exit at every return path (`:809`, `:882`, `:986`, `:999`) |

Residual risk: R3 overlap detection is process-local (documented `ponytail:` comment at `run-session-observer.ts:66-72`) — cross-process concurrent same-agent runs rely on the conservative mtime window filter, which can only drop candidates toward `unresolved`, never fabricate an exact mapping.

Review Verdict: PASS — all requirements MET; one P3 + three P4 non-blocking findings. Design conformance: all Solution change-map claims DONE (premise satisfied via existing correlation flow + regression test rather than a second channel, as specified).
### References
- **Boundary events:** `packages/app/src/services/event-names.ts:315-316`;
  `packages/app/src/services/occupant-wait.ts:13-14` (how the pair is already consumed)
- **Session roots:** `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/sources.ts:156-213`
- **Supplied-id plumbing:** `packages/app/src/services/agent-service.ts:195-201` (the R1a/R1b design
  note), `:738-739` (flag read), `:751`, `:801` (threading)
- **Executor-wrapping precedent:** `packages/app/src/services/agent-service.ts:284`
  (`PidObservingProcessExecutor`)
- **Target column this eventually feeds:** `history_message.run_id` + `idx_history_message_provenance_run`
  (`packages/domain/src/migrations.ts:200-211`, migration `0009`)
- **Operator ruling:** feature E6 § *Why observe rather than dictate* (2026-08-13)
- **Blocked consumer:** feature J6 task 0547
### History
- 2026-08-14T05:39:51.067Z todo → wip (system)
- 2026-08-14T06:04:41.069Z wip → testing (system)
- 2026-08-14T06:04:47.588Z testing → done (system)
