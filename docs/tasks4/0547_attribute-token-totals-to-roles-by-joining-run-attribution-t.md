---
template: feature-impl
schema_version: 1
name: "Attribute token totals to roles by joining run attribution to the history plane"
description: ""
status: todo
type: task
profile: standard
feature_id: J6
parent_wbs: null
priority: P2
tags: []
dependencies: ["0545", "0546", "0557", "0558"]
ac_numbering: task-local
created_at: "2026-08-14T00:31:56.915Z"
updated_at: "2026-08-14T02:46:27.758Z"
---

## 0547. Attribute token totals to roles by joining run attribution to the history plane

### Background
Task 0545 records which role served each run; task 0546 aggregates the routing decision. Neither says
what the routing *consumed* — and consumption is the operator's actual motivation for tiers: a
`scribe` role served by a `capable-3` executor is only obviously wasteful once you can see the tokens.

**Tokens, never prices** (operator ruling, 2026-08-13). Per-model pricing changes faster than any
table in this repo could track, so a stored price is a stored error. The unit of account is input,
cache-read, cache-write, and output tokens.

Most of this is already built — only the role dimension is missing. Verified 2026-08-13:

- `packages/domain/src/analytics/query.ts:57-97` extracts exactly those four counts plus
  `usageReported` from a provider `usage` object.
- `run_id` is the join key and is indexed on both sides — `idx_system_events_run_id`
  (`packages/domain/src/migrations.ts:95`) and the `(provenance, run_id)` index on `history_message`
  added by migration `0009` (`:200-211`) specifically to make this join fast.
- `packages/domain/src/analytics/run-cost.ts` already performs that join, with an exact path and a
  time-window heuristic variant that marks its result **estimated**.

So this task adds a dimension to an existing join rather than building a new data path.
### Requirements
- [ ] **R1.** Aggregate token consumption **by role**: for each role, report `inputTokens`,
      `cacheReadTokens`, `cacheCreationTokens`, and `outputTokens` over a bounded window, joined from
      the history plane to routing attribution over `run_id`. Reuse `extractClaudeTokens`
      (`packages/domain/src/analytics/query.ts:79-98`) — do not write a second extractor.
      Measurable: a dataset with known usage produces the expected four totals per role.
- [ ] **R2.** No dollar figure is computed, stored, or displayed. The existing `costUsd` field on
      `CostRecord` / `TokenTotals` is neither extended nor read by this task. Measurable: the new
      surface's output contains no currency field, and a test asserts no price is emitted.
- [ ] **R3.** Honour the never-fabricate invariant. A role whose runs have no matched history rows,
      or whose rows carry no provider `usage` object, reports its consumption as **unmeasured** with
      the matched-run count — never zero tokens presented as an observed fact. Do not reintroduce any
      length-based estimate; task 0474 R7 removed the 4-chars-per-token heuristic for this reason.
      Measurable: a role with zero matched rows reads as unmeasured and is visually distinct from a
      role that genuinely consumed nothing.
- [ ] **R4.** Preserve the exact-versus-estimated join distinction that `run-cost.ts` already makes.
      A total assembled via the time-window heuristic is reported as estimated; a total from exact
      `run_id` matches is reported as exact; the two are never silently summed into one number.
      Measurable: a mixed dataset reports both counts separately.
- [ ] **R5.** Report coverage alongside the totals: how many attributed runs found matching history
      rows, out of how many attributed runs. Feature E1 records `history_etl_*` as dead for six
      sources, so partial coverage is the expected condition and must be visible rather than
      inferred. Measurable: the result states matched and total run counts for the window.
### Acceptance Criteria
Covers feature J6 scenarios:

- **R7 — Token totals are attributable to a role**
- **R8 — Unmeasured consumption is reported as unmeasured**

```gherkin
Scenario: R7 — Token totals are attributable to a role
  Given runs whose attribution and history rows share a run_id
  When token consumption is aggregated by role
  Then each role reports input, cache-read, cache-write, and output token totals
  And no dollar figure is computed, stored, or displayed

Scenario: R8 — Unmeasured consumption is reported as unmeasured
  Given a role whose runs have no matched history rows or no provider usage object
  When token totals are read
  Then that role reports its consumption as unmeasured with the matched-run count
  And it does not report zero tokens as though zero were an observed fact
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Does the token extraction need building?** No. `extractClaudeTokens` (`query.ts:71-98`) already
  returns all four counts plus `usageReported`. Reuse it.
- **Does the join need building?** No. `run-cost.ts` already joins `system_events` to
  `history_message` over `run_id`, with both sides indexed (migration `0009`). This task adds the
  role dimension to an existing fold.
- **What about `costUsd`?** It exists on `CostRecord` / `TokenTotals` and stays untouched — not
  populated, not read, not removed. Removing it is a separate operator decision.
- **Is `inputTokens` exclusive of cache?** No — it is the summed total (fresh + cache-read +
  cache-write), per `query.ts:73`. Do not subtract; report the four numbers as extracted.

**Deferred with owner.**

- **Dollar cost** — owner: nobody. Permanently excluded 2026-08-13; per-model pricing is too volatile
  to hold correctly, and `UNKNOWN_MODEL_PRICING`'s unmeasured $3/$15 fallback is why the existing
  figures are already untrustworthy.
- **History-plane coverage gaps** (`history_etl_*` dead for six sources) — owner: feature E1. This
  task reports coverage; it does not repair ingestion.

**Reopened by measurement (2026-08-13).**

- **Is the existing `run-cost.ts` join reusable?** **No** — corrected. All 10 `history_etl_*` tables
  hold 0 rows, so that path reads nothing. The earlier "add a dimension to an existing join"
  instruction was written from code shape, not from data, and is wrong.
- **Where do tokens actually live?** Typed columns on `history_message`
  (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`) — 166,162 rows carry
  them. No JSON extraction needed.
- **Does the `run_id` join work?** **No.** `history_message.run_id` is NULL for all 1,296,633 rows.
  The column and its index exist; nothing populates them. This blocks the task.

**Open — operator decision required before implementing.**

- **How is an agent run correlated to a history session?** Populate `run_id` at import (preferred), or
  fall back to `(source, session_id, time-window)` matching and accept that every total becomes
  estimated. Owner: operator. This task is not startable until it is answered.
- **Why do `claude` and `codex` carry 0 token rows** while `omp`, `pi`, `opencode`, `gemini`, `grok`
  do? Full-fidelity sources per feature E1, yet no usage captured. Owner: feature E1 / the next batch;
  it bounds how much of the roster this feature can ever measure.
### Design
**Add a dimension to an existing join; do not build a second data path.** `run-cost.ts` already joins
`system_events` to `history_message` over `run_id` and folds token totals. This task groups that fold
by the role recorded in task 0545's attribution rather than introducing a parallel query.

**Reuse the extractor (R1).** `extractClaudeTokens` (`query.ts:79-98`) is the single place that knows
how a provider `usage` object maps to the four counts, including that `inputTokens` is the summed
total of fresh + cache-read + cache-write. A second extractor is how the two drift.

**Absent is not zero (R3).** This is the load-bearing invariant and it is already recorded in the
codebase: *"Absent usage yields zero tokens with `usageReported: false` — the never-fabricate
invariant, not a guessed number"* (`run-cost.ts:240-241`). A role reporting `0` tokens must mean
"observed zero", and a role with no measurement must say so. Collapsing the two makes every ratio the
operator reads quietly wrong, and makes a broken ETL source look like a free role.

**Keep exact and estimated apart (R4).** `run-cost.ts` distinguishes an exact `run_id` join from a
time-window heuristic and marks the latter estimated. Summing them into one number throws away the
only signal the operator has about how much to trust the total.

**Coverage is part of the answer (R5).** Feature E1 records `history_etl_*` as dead for six sources,
so a partial join is the normal case, not an error. Report matched-of-total so a thin dataset reads
as thin. Fixing ingestion is E1's job — this task must not silently compensate for it.

**No prices, ever (R2).** Not deferred — excluded. `costUsd` exists on the shared record types and
must be left alone: not extended, not populated, not read. If a reviewer finds a currency symbol in
this task's output, it has failed its own contract.

**Not in scope:** Board rendering (J4), repairing history ETL coverage (E1), and any change to
routing behavior (feature B2).

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Token extractor (**reuse**) | `extractClaudeTokens(payload)` → `{ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, usageReported }` | `packages/domain/src/analytics/query.ts:71-98` |
| Token semantics | `inputTokens` = fresh + cache-read + cache-write (summed total) | `query.ts:73`, `:93` |
| Totals bucket | `TokenTotals` — includes `costUsd` (**do not read, do not populate**) | `packages/domain/src/analytics/run-cost.ts:200-235` |
| Fold (reuse) | `foldTotals(records)` | `run-cost.ts:210` |
| Record builder | `payloadToCostRecord(payload, source)` | `run-cost.ts:246` |
| Never-fabricate invariant | absent usage → zero tokens **with `usageReported: false`** | `run-cost.ts:240-241` |
| Join key (both sides indexed) | `system_events.run_id` · `history_message.run_id` | `migrations.ts:87`/`:95`, `:200-211` (`idx_history_message_provenance_run`, migration `0009`) |
| Exact vs estimated | existing exact-`run_id` path vs the time-window heuristic variant marked estimated | `run-cost.ts` (variant below `payloadToCostRecord`) |
| Pricing (**never call**) | `MODEL_PRICING` · `UNKNOWN_MODEL_PRICING` ($3/$15 per 1M) · `getModelPricing` | `packages/domain/src/analytics/models.ts:4`, `:31`, `:35` |

**No dollar figure is computed, stored, or emitted.** `costUsd` stays on the shared record types
untouched — neither extended, populated, nor read by this task.

#### Anti-patterns — what not to implement

- Do **not** write a second token extractor. `extractClaudeTokens` is the single place that knows the
  `usage` mapping, including that `inputTokens` is the summed total.
- Do **not** reintroduce any length-based estimate. Task 0474 R7 removed a 4-chars-per-token heuristic
  precisely because an estimate entering a total is the fabrication the forensic contract exists to end.
- Do **not** report `0` for a role with no matched rows (R3). Observed-zero and unmeasured are
  different facts, and conflating them makes a broken ETL source look like a free role.
- Do **not** sum exact and time-window-estimated totals into one number (R4) — that discards the only
  trust signal the operator has.
- Do **not** silently compensate for history-plane coverage gaps. Feature E1 owns ingestion health;
  report coverage (R5) and leave it.
- Do **not** call `getModelPricing` or read `costUsd`.

#### Cross-task contract

**Assumes from 0545:** attribution rows carry `run_id` and a role, so the join has something to group
by. **Assumes from 0546:** the `(role, executor)` grouping exists; this task adds a consumption
dimension to it rather than re-implementing it.

**Assumes from feature E1 (done):** `history_message.run_id` is populated for imported sessions.
Where it is not, R5's coverage reporting is the honest response — not a workaround.

**Leaves for dependents:** task **0552** (feature J7, batch 3) renders these totals and must preserve
the unmeasured and estimated states as distinct; flattening them to `0` is the failure this task's R3
and R4 exist to prevent.

**Note on E3 (batch 3):** feature E3's operation-triggered refresh is what makes this task's numbers
non-empty in practice. It is not a hard dependency — this task is correct against a stale history, it
just reports most roles as unmeasured.

#### PREMISE CORRECTION (2026-08-13) — this task is BLOCKED as specified

Measured against the live `.spur/spur.db`, **after** the frozen-names table above was written. Two of
its premises are false. Do not start this task until the blocker below is resolved.

| Measured | Value | Consequence |
| --- | --- | --- |
| All 10 `history_etl_*` tables | **0 rows** | `loadAllEtlPayloads` / `SOURCE_TABLES` / `payloadToCostRecord` / `extractClaudeTokens` operate on nothing. The "reuse the existing join" instruction above is **wrong**. |
| `history_message` | 1,296,633 rows | the real data lives here, in **typed columns**, not in JSON payloads |
| `history_message` rows with token data | 166,162 | usable — but `claude` and `codex` contribute **0** despite being full-fidelity sources |
| `history_message` rows with `run_id` | **0** | **the join key is never populated.** The column and `idx_history_message_provenance_run` (migration `0009`) exist; nothing writes them. |

**Corrected token source.** Tokens are first-class columns on `history_message`, not a JSON `usage`
object: `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, plus `model`,
`duration_ms`, and `cost_usd`. No extractor is needed — `extractClaudeTokens` is for the dead ETL
payload path. (`cost_usd` exists as a column and must still **not** be read: tokens, never prices.)

**The blocker.** This task joins routing attribution (`system_events.run_id`, written by task 0545)
to history rows over `run_id`. `history_message.run_id` is NULL for all 1.3M rows, so the join
returns nothing and every role reports `unmeasured` — a correct result, and a useless feature.

**Resolution required before implementing.** One of:

1. **Populate `run_id` at import** — correlate an agent run to the session it produced. This is the
   real fix and is proposed as the next batch (see § *Cross-task contract*).
2. **Correlate by `(source, session_id, time window)`** instead — the approach `run-cost.ts`'s
   estimated variant already takes. Weaker, and it would make *every* total estimated rather than
   exact, collapsing R4's exact-versus-estimated distinction into a single degraded mode.

Option 1 is preferred and is an operator decision, not an implementer's. Until it is settled this
task stays `todo` with the blocker recorded here rather than being handed to an implementer who
would discover it after building the query.
### Plan
- [ ] Group the existing `run_id` join's token fold by the role recorded in task 0545's attribution (R1)
- [ ] Reuse `extractClaudeTokens` to report input, cache-read, cache-write, and output totals per role over a bounded window (R1)
- [ ] Assert no currency field is emitted and leave `costUsd` untouched (R2)
- [ ] Report a role with no matched rows or no usage object as unmeasured, never as zero (R3)
- [ ] Keep exact and time-window-estimated totals reported separately (R4)
- [ ] Report matched-of-total run coverage for the window (R5)
- [ ] Add tests: known-usage totals, unmeasured vs observed-zero, exact vs estimated, partial coverage (R1-R5)
- [ ] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Token extractor to reuse (R1):** `packages/domain/src/analytics/query.ts:57-67` (`TokenCounts`
  shape), `:71-98` (`extractClaudeTokens`; note `inputTokens` = fresh + cache-read + cache-write)
- **Existing join and fold (R1/R4):** `packages/domain/src/analytics/run-cost.ts:200-235`
  (`foldTotals`), `:237-260` (`payloadToCostRecord`), and the estimated-variant path below it
- **Never-fabricate invariant (R3):** `packages/domain/src/analytics/run-cost.ts:240-241`; task 0474
  R7 (removal of the 4-chars-per-token estimate)
- **Join key and indexes:** `packages/domain/src/migrations.ts:87` + `:95`
  (`system_events.run_id`, `idx_system_events_run_id`), `:200-211` (`history_message`
  `(provenance, run_id)` index, migration `0009`)
- **Upstream dependencies:** task 0545 (writes the role attribution), task 0546 (the routing
  aggregate this extends with a consumption dimension)
- **Coverage risk (R5):** feature E1 — `history_etl_*` dead for six sources; history ingestion health
  is E1's scope, not this task's
- **Pricing boundary (R2):** feature J6 § *Tokens, not prices*; `costUsd` on `CostRecord` /
  `TokenTotals` stays untouched
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`
### History
