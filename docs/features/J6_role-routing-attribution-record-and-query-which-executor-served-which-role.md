---
schema_version: 1
id: "J6"
name: "Role routing attribution: record and query which executor served which role"
status: active
priority: P2
tags: []
created_at: "2026-08-14T00:18:07.003Z"
updated_at: "2026-08-14T22:31:27.396Z"
---

# J6: Role routing attribution: record and query which executor served which role

## Goal
Every agent run records **which role it was serving, which tier that implied, and which executor
actually ran** — and that record is queryable and joinable to **token consumption**, so the operator
can answer whether tier routing is doing what it was built to do.

This closes feature B2's standing telemetry gap: *"Nothing currently records which executor served
which intention. Without it, the operator cannot tell whether the routing is actually saving money —
the stated motivation for tiers."* Batch 1 makes the routing decision explicit; this feature makes it
observable and measurable.

**Tokens, never prices** (operator ruling, 2026-08-13). The unit of account is input tokens, cached
tokens, and output tokens. Per-model pricing is too volatile to capture correctly, so no dollar
figure is computed, stored, or displayed anywhere in this feature — now or later. Tokens are the
durable measurement; a price is a snapshot that is wrong by the time it is read.

Two questions, two layers: *is routing behaving as declared* (answerable from the event ledger alone)
and *what did each role consume* (a join to the history plane). The first carries no external
dependency and ships first.
## Scope
- In:
    - Emitting the routing decision on agent-run lifecycle events through the **existing** J5 payload
      envelope: role, resolved tier, resolved executor, selection source (role / pin / default), and
      whether an escalation occurred with its trigger.
    - Persisting it as envelope metadata on rows the ledger already writes — no new table, no new
      column, no historical rewrite. Rows carry `run_id`, which is already indexed
      (`idx_system_events_run_id`) and is the join key to the history plane.
    - A query path answering "which executor served which role, how often, and how often did it
      escalate" in one indexed round trip rather than client-side sifting.
    - **Token attribution by role**: input, cache-read, cache-write, and output tokens per role,
      joined from the history plane over `run_id`, honouring the existing never-fabricate invariant
      (absent usage is reported absent, never as zero-as-fact).
    - Coverage for all four selection sources so an unrecorded path is a test failure, not a silent
      hole.
- Out:
    - **Any dollar figure.** No pricing table, no `costUsd` in any new surface, no "estimated spend".
      Ruled out by the operator 2026-08-13 because per-model pricing is too volatile to hold
      correctly. The existing `costUsd` field on `CostRecord` / `TokenTotals` is neither extended nor
      consumed by this feature.
    - A new CLI noun. The query rides an existing surface — J5 ruled new nouns/verbs out for this
      plane and ADR-051 gates them regardless.
    - New observability transport, tables, or columns; the J5 envelope and the existing `run_id`
      indexes are the carriers.
    - Board UI for routing or tokens. J4 owns Board surfaces; this feature ships the data.
    - Changing selection or escalation behavior. This feature observes; feature B2 decides and task
      0540 exercises.
    - Repairing history-plane ETL coverage gaps. Feature E1 owns ingestion health; this feature
      reports honestly over whatever coverage exists rather than papering over it.
## Acceptance Criteria
```gherkin
Feature: Role routing attribution

  @core
  Scenario: R1 — An agent run records the routing decision it made
    Given a run resolved through a declared role
    When its lifecycle events are read
    Then the payload carries the role, the resolved tier, and the resolved executor
    And it carries the selection source distinguishing a role resolution from a pin or a default

  @core
  Scenario: R2 — An escalation is recorded with the trigger that caused it
    Given a run whose starting-tier executor failed on an objective signal
    When the run's events are read
    Then the escalation is visible with the originating tier, the resulting tier, and the trigger
    And a run that never escalated is distinguishable from one that escalated once

  @core
  Scenario: R3 — The record rides the existing envelope
    Given the J5 payload envelope is the carrier
    When attribution is persisted
    Then no new table or column is introduced
    And rows written before this feature project cleanly without a rewrite

  @core
  Scenario: R4 — Routing is queryable in one indexed round trip
    Given persisted attribution across many runs
    When the operator asks which executor served which role
    Then the answer comes from an indexed query rather than client-side filtering
    And it reports per pair the run count and the escalation count

  @core
  Scenario: R5 — Every selection source is covered
    Given the four selection sources role, pin, default, and escalated
    When the test suite runs
    Then each source has coverage asserting its recorded value
    And a source that records nothing fails the suite rather than passing silently

  @edge
  Scenario: R6 — Attribution never carries secrets or prompt bodies
    Given the payload bounds and redaction rules established by J5
    When attribution metadata is written
    Then it contains only identifiers, tiers, counts, and token totals
    And it carries no prompt text, command line, or configured secret value

  @core
  Scenario: R7 — Token totals are attributable to a role
    Given runs whose attribution and history rows share a run_id
    When token consumption is aggregated by role
    Then each role reports input, cache-read, cache-write, and output token totals
    And no dollar figure is computed, stored, or displayed

  @core
  Scenario: R8 — Unmeasured consumption is reported as unmeasured
    Given a role whose runs have no matched history rows or no provider usage object
    When token totals are read
    Then that role reports its consumption as unmeasured with the matched-run count
    And it does not report zero tokens as though zero were an observed fact
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0545 | Emit the routing decision on agent run events via the J5 envelope | done |
| 0546 | Make role-to-executor routing queryable in one indexed round trip | done |
| 0547 | Attribute token totals to roles by joining run attribution to the history plane | todo |
<!-- END AUTO-GENERATED -->

## Notes
### Sequencing

Blocked on feature B2 task 0536, which makes the routing decision explicit enough to record. Before
it, `extractPhase` means most dispatches have no role to attribute.

Internal order: 0545 (emit) → 0546 (query routing) → 0547 (join tokens). 0546 carries no external
dependency and is the one that answers "is routing behaving as declared". 0547 depends on
history-plane coverage and is deliberately last.

### Tokens, not prices (operator ruling, 2026-08-13)

The unit of account is tokens: input, cache-read, cache-write, output. No dollar figure is computed,
stored, or shown — the operator's reasoning is that per-model pricing changes faster than any table
in this repo could track, so a stored price is a stored error. Token counts are provider-reported
facts with an indefinite shelf life.

This is a **permanent** scope boundary, not a deferral. The existing `costUsd` field on `CostRecord`
and `TokenTotals` (`packages/domain/src/analytics/run-cost.ts`) stays where it is and is neither
extended nor read by this feature.

### What already exists (verified 2026-08-13)

The token half is mostly built; only the role dimension is missing.

- `packages/domain/src/analytics/query.ts:57-97` — `extractClaudeTokens` returns `inputTokens`,
  `outputTokens`, `cacheReadTokens` (`cache_read_input_tokens`), `cacheCreationTokens`
  (`cache_creation_input_tokens`), and `usageReported`.
- `packages/domain/src/analytics/run-cost.ts:237-260` — builds a record from an ETL payload and
  encodes the **never-fabricate invariant**: *"Absent usage yields zero tokens with
  `usageReported: false` — the never-fabricate invariant, not a guessed number."* Task 0474 R7
  removed a 4-chars-per-token estimate for exactly this reason. Do not reintroduce estimation.
- `run_id` is the join key and is indexed on both sides: `idx_system_events_run_id`
  (`packages/domain/src/migrations.ts:95`) and the `(provenance, run_id)` index on
  `history_message` (migration `0009`, `:200-211`).
- `run-cost.ts` already joins over that key, with an exact path and a time-window heuristic variant
  that marks its result **estimated**. Keep that distinction visible rather than flattening it.

### Known dependency risk

History-plane coverage is imperfect — feature E1 records `history_etl_*` as dead for six sources.
Task 0547 must therefore report its coverage rather than assume it: a role with no matched history
rows reads as *unmeasured*, never as zero tokens. Fixing ingestion is E1's job, not this feature's.

### Deferred to batch 3

- Board UI rendering routing and token data — J4 owns Board surfaces.
- Parallel fan-out attribution: whether each subagent dispatched by `sp:parallel-execution` carries
  its own role or inherits the parent's is still an open question in feature B2's fog, not an
  implementation. It needs deciding before it can be attributed.
## History
- 2026-08-14T22:31:27.396Z backlog → active (system)
