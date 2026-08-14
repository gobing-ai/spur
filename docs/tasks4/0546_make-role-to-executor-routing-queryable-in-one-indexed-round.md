---
template: feature-impl
schema_version: 1
name: "Make role-to-executor routing queryable in one indexed round trip"
description: ""
status: todo
type: task
profile: standard
feature_id: J6
parent_wbs: null
priority: P2
tags: []
dependencies: ["0545"]
ac_numbering: task-local
created_at: "2026-08-14T00:19:15.171Z"
updated_at: "2026-08-14T01:38:47.641Z"
---

## 0546. Make role-to-executor routing queryable in one indexed round trip

### Background
Task 0545 records the routing decision. Recording it is not enough: the operator's question is
comparative — *which* executor served *which* role, how often, and how often did routing start too
cheap and have to escalate.

Feature J3's terrain finding is the warning here: the `system_events` ledger supported only exact
`name` + `since` + `limit` queries, so every Board filter degenerated into client-side sifting over a
fixed 100-row window that was statistically all heartbeat. Attribution written but not queryable
would land in exactly that state — present in the rows, unreachable in practice.

This task adds the read path. It rides an existing surface: J5 ruled new nouns and verbs out for this
plane, and ADR-051 gates them regardless.
### Requirements
- [ ] **R1.** Answer "which executor served which role" as an aggregate: per (role, executor) pair,
      the run count and the escalation count, over a bounded time window. Measurable: a dataset with
      known routing produces the expected counts per pair.
- [ ] **R2.** The answer comes from an indexed query, not client-side filtering over a fixed window.
      One round trip, bounded work. Measurable: the query plan uses an index on the correlating
      column(s), and result size does not depend on scanning unrelated event families.
- [ ] **R3.** No new CLI noun or verb. The query rides an existing surface — the observability read
      API and/or an existing `spur` noun's `--json` output. Adding a noun requires ADR-051 operator
      consent and is explicitly out of scope. Measurable: `spur --help` gains no top-level noun.
- [ ] **R4.** The result distinguishes the selection sources recorded by task 0545, so a pinned run
      is not counted as evidence that role routing chose that executor. Measurable: a dataset mixing
      pinned and role-resolved runs to the same executor reports them separately.
- [ ] **R5.** The query is correct on a ledger that predates attribution. Rows without routing
      metadata are excluded from counts rather than counted as an unknown role, and the result states
      the covered window. Measurable: a mixed dataset of pre- and post-attribution rows returns
      counts over the post-attribution rows only, with the window reported.
### Acceptance Criteria
Covers feature J6 scenario:

- **R4 — Routing is queryable in one indexed round trip**

```gherkin
Scenario: R4 — Routing is queryable in one indexed round trip
  Given persisted attribution across many runs
  When the operator asks which executor served which role
  Then the answer comes from an indexed query rather than client-side filtering
  And it reports per pair the run count and the escalation count
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **May an index be added?** Yes. Task 0545 R3 forbids a new *table or column*; an index on an
  existing column is the sanctioned way to make the access path indexed (R2).
- **Are pinned runs counted as role routing?** No — reported separately (R4). Pinning is the common
  case here, so merging them would flatter the routing badly.
- **What happens to rows written before attribution existed?** Excluded from counts, with the covered
  window reported (R5). Imputing "unknown role" would dilute every ratio.
- **Does this need a new CLI noun?** No (R3) — ADR-051 gates that, and J5 already ruled new
  nouns/verbs out for this plane.

**Deferred with owner.**

- **Which existing surface hosts the query** — owner: operator, if no existing surface fits cleanly.
  Prefer the observability read API; a noun addition is a decision brief, not an implementation choice.
- **Token totals in the same aggregate** — owner: task 0547. Kept separate so this query carries no
  history-plane dependency.
### Design
**The comparison is the product.** A flat list of runs is not an answer; the operator is asking
whether cheap roles land on cheap executors. Aggregate by (role, executor) with run and escalation
counts, and the defect — a `scribe` routinely served by a `capable-3` executor, or a `planner`
escalating on most runs — is visible at a glance.

**Separate pinned from role-resolved (R4).** A pinned run says nothing about whether role routing
works; counting it as evidence would make a fully-pinned pipeline look like perfectly-tuned routing.
This repo's own `task-pipeline.yaml` pins deliberately, so this is the common case, not an edge case.

**Exclude, do not impute (R5).** Rows predating attribution have no role. Counting them as an unknown
role would silently dilute every ratio the operator reads. Exclude them and report the covered
window, so a small dataset reads as a small dataset rather than as a skewed one.

**Ride an existing surface (R3).** J5 ruled new nouns and verbs out for this plane and ADR-051 gates
them regardless. If no existing surface fits cleanly, that is a decision brief for the operator, not
a licence to add a noun.

**Indexed, not sifted (R2).** Feature J3 fixed exactly this failure mode on this ledger; do not
reintroduce it. If the correlating column is not indexed for this access pattern, adding the index is
in scope — adding a *table* is not (task 0545 R3).

**Not in scope:** token totals per role — task 0547 adds that dimension by joining to the history
plane over `run_id`, and it is kept separate so this query carries no history-plane dependency. Any
dollar figure is excluded permanently, not deferred (feature J6 § *Tokens, not prices*). Board
rendering is J4's; routing behavior is feature B2's.

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Source rows | `system_events` filtered to attribution-bearing events | `packages/domain/src/migrations.ts:81-91` |
| Indexes available | `idx_system_events_run_id` · `_event_name` · `_occurred_at` · `_entity` · `_sequence` | `migrations.ts:93-98` |
| Aggregate key | `(role, executor)` | — |
| Aggregate shape | `{ role, executor, source, runs, escalations }` over a bounded window | new |
| Selection sources | `role` · `explicit` (pin) · `default` · escalated | from task 0545 |
| Window bound | explicit `since` / `until`, defaulting to a bounded recent range | no unbounded scan |

**No new CLI noun or verb** (R3). The query rides the existing observability read API and/or an
existing noun's `--json`; ADR-051 gates any noun addition regardless.

#### Anti-patterns — what not to implement

- Do **not** filter client-side over a fixed row window. That is precisely the failure feature J3
  fixed on this ledger (exact-`name` + `since` + `limit` only, forcing 100-row client sifting).
- Do **not** count pinned runs as evidence of role routing (R4). This repo's own
  `config/workflows/task-pipeline.yaml:56-65` pins deliberately, so pinned is the common case, not an
  edge case — merging them would make a fully-pinned pipeline look like perfect routing.
- Do **not** impute a role for pre-attribution rows (R5). Exclude them and report the window; counting
  them as "unknown" silently dilutes every ratio.
- Do **not** add a table. If the access path needs an index, add the **index** (task 0545 R3 forbids
  the table, not the index).
- Do **not** compute token totals here — that is task 0547, kept separate so this query has no
  history-plane dependency.

#### Cross-task contract

**Assumes from 0545:** every attribution row carries `run_id` and a stable selection-source value, and
escalations are separate records. Without separate escalation records the escalation count is not
computable.

**Leaves for dependents:**

- Task **0547** extends this aggregate with a token dimension and must not re-implement the grouping.
- Task **0552** (feature J7, batch 3) renders this aggregate and adds no query of its own — the shape
  frozen above is the interface it consumes.
### Plan
- [ ] Define the aggregate shape: (role, executor) → run count, escalation count, over a window (R1)
- [ ] Implement it as an indexed query on the existing ledger, adding an index if needed (R2)
- [ ] Expose it through an existing read surface without adding a CLI noun or verb (R3)
- [ ] Report pinned and role-resolved runs separately (R4)
- [ ] Exclude pre-attribution rows from counts and report the covered window (R5)
- [ ] Add tests: known dataset produces expected counts; mixed pinned/resolved separates; pre-attribution rows excluded (R1, R4, R5)
- [ ] Assert the access path is indexed and does not scan unrelated event families (R2)
- [ ] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Upstream dependency:** task 0545 (writes the attribution this reads)
- **Failure mode to avoid (R2):** feature J3 § Goal — exact-`name` + `since` + `limit` only, forcing
  client-side sifting over a fixed 100-row window
- **Read API and correlation columns:** feature J3 deliverables (ingestion, retention, correlation,
  read APIs); `system_events` DAO in `packages/domain`
- **Existing surfaces to ride (R3):** the observability read API; `spur workflow trace` /
  `spur rule trace` enrichment pattern from feature J5
- **Consent boundary (R3):** ADR-051 — CLI noun/verb additions require explicit operator consent
- **Pinning is the common case (R4):** `config/workflows/task-pipeline.yaml:56-65`
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`
### History
