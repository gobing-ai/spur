---
template: feature-impl
schema_version: 1
name: "Capture the run-to-session mapping at the agent invoke boundary"
description: ""
status: todo
type: task
profile: standard
feature_id: E6
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T02:43:12.908Z"
updated_at: "2026-08-14T02:53:00.592Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
