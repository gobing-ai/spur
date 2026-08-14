---
template: feature-impl
schema_version: 1
name: "Retain forensic primitives at import: todo-arg allowlist and per-call latency"
description: ""
status: todo
type: task
profile: standard
feature_id: E5
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T01:01:43.111Z"
updated_at: "2026-08-14T01:23:25.743Z"
---

## 0553. Retain forensic primitives at import: todo-arg allowlist and per-call latency

### Background
Phase detection is the most distinctive primitive in omp's forensics report, and it cannot be
computed today. `history_tool_call` stores `args_digest` — a hash — not the arguments
(`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:65`), and omp's phase detection
reads **todo-event contents** to name phases. Time decomposition has a parallel gap: the columns
exist, but per-source `duration_ms` population is unverified.

Feature E2 settled what to do about both (operator ruling, 2026-08-09): retain raw args for
**todo-writing tools only**, alongside the existing digest (~1–16 KB/session extrapolated), and
extract `duration_ms` from raw JSONL (~2.4 KB/session measured). Tool **result** content is not
retained — issue categorization stays on the raw-JSONL fallback.

Ticket 0489 R4 confirmed the todo signal for omp, pi, and claude, and left codex, grok, and agy
unprobed. Probing them is part of this task: the allowlist cannot be written for a source whose todo
signal nobody has looked at.
### Requirements
- [ ] **R1.** Retain raw tool arguments for todo-writing tools only, alongside the existing
      `args_digest`. The digest stays — it is load-bearing for Q4 loop detection
      (`packages/domain/src/analytics/forensic-query.ts:291-306`), so this is strictly additive.
      Measurable: importing a session with todo and non-todo tool calls retains raw args for the
      former only, and Q4 loop detection still passes.
- [ ] **R2.** Populate the **existing** `duration_ms` column on `history_tool_call` (already present,
      `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:69` — no schema change) from
      raw JSONL where the source reports it. A
      source that reports no timing leaves the field **absent**, never zero — a fabricated zero would
      make time decomposition silently wrong. Measurable: a timing-bearing source populates the
      field; a non-reporting source leaves it null and is identifiable as such.
- [ ] **R3.** Probe codex, grok, and agy upstream JSONL for a todo signal, which 0489 R4 left
      unexamined, and extend the allowlist to whatever they actually emit. A source with no todo
      signal is recorded as such rather than left ambiguous. Measurable: each of the three is
      documented as todo-bearing (with its tool name) or not, from real session evidence.
- [ ] **R4.** Tool result content is **not** retained (ruled out 2026-08-09; ~100 KB–5 MB/session).
      Measurable: no result body reaches storage, asserted by test.
- [ ] **R5.** Reduce `plugins/sp/skills/issue-finding/references/session-formats.md` to the
      source→root-path table plus the fallback-bridge note, deleting its per-source fidelity ratings.
      The importer `mappers.ts` is the single code authority for what the typed tables retain (0489);
      two field maps that can disagree is the defect being closed. Measurable: the prose fidelity
      ratings are gone and the file points at the mappers.
### Acceptance Criteria
Covers feature E4 scenarios:

- **R1 — Import retains the primitives phase detection needs**
- **R2 — Per-step latency is available for time decomposition**

```gherkin
Scenario: R1 — Import retains the primitives phase detection needs
  Given a session containing todo-writing tool calls
  When it is imported
  Then the raw arguments of todo-writing tools are retained alongside the existing args_digest
  And no other tool's raw arguments are retained
  And tool result content is not retained

Scenario: R2 — Per-step latency is available for time decomposition
  Given source JSONL carrying per-call timing
  When it is imported
  Then duration_ms is populated for tool calls
  And a source that reports no timing leaves it absent rather than zero
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Does `duration_ms` need a schema change?** No — resolved by reading
  `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:56-73`. The column already
  exists on `history_tool_call`. R2 is a **population** requirement; the charting-era phrasing
  ("extract `duration_ms`") wrongly implied schema work.
- **What is the new column called?** `args_raw TEXT`, nullable, beside `args_digest`. Frozen above.
- **Does retention need a new index?** No. Retrieval is by session/tool, both already indexed; a
  large nullable text column gains nothing from one.

**Deferred with owner.**

- **Custom mappers for gemini / opencode / antigravity / openclaw** — owner: operator. Blocked by
  the 2026-08-06 source-support ruling (feature E1 § Out of scope), not by anything in this task.
- **Whether a source with no todo signal should get a synthetic phase fallback** — owner: task 0554.
  This task records the per-source verdict; how the absence is presented is 0554's call (its R2).
### Design
**Additive only.** `args_digest` is not being replaced. Q4 loop detection reads it
(`packages/domain/src/analytics/forensic-query.ts:291-306`), so removing or repurposing it breaks a shipped query. Raw args land
*alongside* it, for an allowlisted set of tools.

**The allowlist is the cost control.** Retaining every tool's arguments is what makes retention
expensive; retaining only todo-writing tools is what makes phase detection possible at ~1–16 KB per
session. Write the allowlist explicitly, per source, from the evidence R3 gathers — not from a
pattern match on tool names.

**Probe before allowlisting (R3).** 0489 R4 confirmed omp/pi/claude and left codex/grok/agy
unprobed. Guessing their todo tool names would produce an allowlist that silently retains nothing for
three sources, and phase detection would then be quietly unavailable for them with no error.

**Absent is not zero (R2).** A source that does not report timing must leave `duration_ms` null.
Writing zero would make time decomposition report those calls as instantaneous — the same
never-fabricate failure the analytics layer already guards against at
`packages/domain/src/analytics/run-cost.ts:240`.

**External package boundary.** Schema and mapper work lives in
`~/xprojects/ts-libs/packages/llm-jsonl-importer/` (`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:65`, `mappers.ts`). Per
AGENTS.md: fix the ts-libs facade rather than working around it Spur-side, release by semver, and use
`bun link` only while validating. After rebuilding, republish and `bun update` the dependent
workspaces so the provenance header reflects the rebuild.

**Validate against real data with a source-local binary.** AGENTS.md mandates it: record the
provenance header (`binary:` + resolved importer version) for each import run. The 2026-08-10 backfill
ran old code for ~83 s because a stale global `spur` shadowed the build.

**Not in scope:** custom mappers for gemini/opencode/antigravity/openclaw (source support deferred by
the 2026-08-06 ruling), and tool result retention (R4).


Verified against the current tree 2026-08-13. `history_tool_call`
(`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:56-73`) already has these columns:

```
record_hash · message_hash · source · source_file · source_line · session_id · seq
tool_name · args_digest · status · started_at · completed_at · duration_ms
result_bytes · error_text · imported_at
```

| Frozen | Value | Note |
| --- | --- | --- |
| New column | `args_raw TEXT` (nullable) | sits beside `args_digest`; NULL for non-allowlisted tools |
| Existing column, **do not add** | `duration_ms INTEGER` | already present — this task **populates** it, it does not create it |
| Table | `history_tool_call` | no new table |
| Indexes | `idx_history_tool_call_session` / `_tool_name` / `_message_hash` | unchanged; `args_raw` gets none |
| Allowlist constant | `TODO_TOOL_ALLOWLIST: Readonly<Record<string, readonly string[]>>` | keyed by source id → tool names |
| Mapper module | `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts` | per-source field maps |

**No new API beyond the above.** `args_digest` keeps its name, type, and meaning. No column is
renamed, dropped, or repurposed.


- Do **not** replace `args_digest` with `args_raw`, or derive the digest from the raw value at read
  time. Q4 (`packages/domain/src/analytics/forensic-query.ts:291-306`) groups on the stored digest.
- Do **not** add a `duration_ms` column. It exists; a second one silently splits the data.
- Do **not** retain args for a tool merely because its name matches `/todo/i`. The allowlist is
  explicit and per source, derived from R3's evidence.
- Do **not** write `0` into `duration_ms` for a source that reports no timing (R2).
- Do **not** add a custom mapper for gemini/opencode/antigravity/openclaw — deferred by the
  2026-08-06 source-support ruling.


**Assumes from upstream:** nothing — this task is the root of feature E5's chain.

**Leaves for dependents:**

- Task **0554** consumes `args_raw` for allowlisted todo tools to compute phases, and `duration_ms`
  for time decomposition. This task owns *retention*; 0554 owns *interpretation* and must not
  re-parse raw JSONL for either.
- 0554 also needs R3's per-source verdict — which sources are todo-bearing — to render "this source
  cannot produce phases" distinctly from "this session had no phases" (0554 R2). Record that verdict
  where 0554 can read it, not only in this task's prose.

#### Frozen names

Verified against the current tree 2026-08-13. `history_tool_call`
(`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:56-73`) already has these columns:

```
record_hash · message_hash · source · source_file · source_line · session_id · seq
tool_name · args_digest · status · started_at · completed_at · duration_ms
result_bytes · error_text · imported_at
```

| Frozen | Value | Note |
| --- | --- | --- |
| New column | `args_raw TEXT` (nullable) | sits beside `args_digest`; NULL for non-allowlisted tools |
| Existing column, **do not add** | `duration_ms INTEGER` | already present — this task **populates** it, it does not create it |
| Table | `history_tool_call` | no new table |
| Indexes | `idx_history_tool_call_session` / `_tool_name` / `_message_hash` | unchanged; `args_raw` gets none |
| Allowlist constant | `TODO_TOOL_ALLOWLIST: Readonly<Record<string, readonly string[]>>` | keyed by source id → tool names |
| Mapper module | `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts` | per-source field maps |

**No new API beyond the above.** `args_digest` keeps its name, type, and meaning. No column is
renamed, dropped, or repurposed.

#### Anti-patterns — what not to implement

- Do **not** replace `args_digest` with `args_raw`, or derive the digest from the raw value at read
  time. Q4 (`packages/domain/src/analytics/forensic-query.ts:291-306`) groups on the stored digest.
- Do **not** add a `duration_ms` column. It exists; a second one silently splits the data.
- Do **not** retain args for a tool merely because its name matches `/todo/i`. The allowlist is
  explicit and per source, derived from R3's evidence.
- Do **not** write `0` into `duration_ms` for a source that reports no timing (R2).
- Do **not** add a custom mapper for gemini/opencode/antigravity/openclaw — deferred by the
  2026-08-06 source-support ruling.

#### Cross-task contract

**Assumes from upstream:** nothing — this task is the root of feature E5's chain.

**Leaves for dependents:**

- Task **0554** consumes `args_raw` for allowlisted todo tools to compute phases, and `duration_ms`
  for time decomposition. This task owns *retention*; 0554 owns *interpretation* and must not
  re-parse raw JSONL for either.
- 0554 also needs R3's per-source verdict — which sources are todo-bearing — to render "this source
  cannot produce phases" distinctly from "this session had no phases" (0554 R2). Record that verdict
  where 0554 can read it, not only in this task's prose.
### Plan
- [ ] Probe codex, grok, and agy real session JSONL for a todo signal and record the verdict per source (R3)
- [ ] Define the per-source todo-writing tool allowlist from that evidence plus 0489 R4's omp/pi/claude findings (R1, R3)
- [ ] Retain raw args for allowlisted tools alongside `args_digest` in the ts-libs importer (R1)
- [ ] Extract `duration_ms` from raw JSONL, leaving it absent where a source reports nothing (R2)
- [ ] Assert tool result content never reaches storage (R4)
- [ ] Reduce `session-formats.md` to the root-path table plus the fallback note (R5)
- [ ] Validate on real data with a source-local binary recording the provenance header, and confirm Q4 loop detection still passes against the retained digest (R1-R3)
- [ ] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Specification:** feature E2 § *Decisions so far* — "Import retention: digest + per-tool allowlist
  + latency" (operator ruling 2026-08-09); 0489 (coverage matrix, `mappers.ts` as single authority)
- **External package (additive changes only):**
  `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:65` (`args_digest`),
  `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts` (per-source field maps)
- **Digest is load-bearing (R1):** `packages/domain/src/analytics/forensic-query.ts:291-306` (Q4 loop
  detection)
- **Never-fabricate precedent (R2):** `packages/domain/src/analytics/run-cost.ts:240-241`
- **R5 target:** `plugins/sp/skills/issue-finding/references/session-formats.md` (121 lines)
- **Unprobed sources (R3):** codex, grok, agy — 0489 R4 confirmed omp/pi/claude only
- **Real-data validation contract:** AGENTS.md § *Build & repo commands* — source-local binary,
  provenance header per invocation, the 2026-08-10 ~83 s stale-binary incident
- **Downstream consumer:** task 0554 (derived variables; phases depend on the retained todo args)
### History
