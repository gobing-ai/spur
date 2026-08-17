---
template: feature-impl
schema_version: 1
name: "Retain forensic primitives at import: todo-arg allowlist and per-call latency"
description: ""
status: done
type: task
profile: standard
feature_id: E5
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T01:01:43.111Z"
updated_at: "2026-08-17T21:55:37.367Z"
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
- [x] **R1.** Retain raw tool arguments for todo-writing tools only, alongside the existing
      `args_digest`. The digest stays — it is load-bearing for Q4 loop detection
      (`packages/domain/src/analytics/forensic-query.ts:291-306`), so this is strictly additive.
      Measurable: importing a session with todo and non-todo tool calls retains raw args for the
      former only, and Q4 loop detection still passes.
- [x] **R2.** Populate the **existing** `duration_ms` column on `history_tool_call` (already present,
      `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:69` — no schema change) from
      raw JSONL where the source reports it. A
      source that reports no timing leaves the field **absent**, never zero — a fabricated zero would
      make time decomposition silently wrong. Measurable: a timing-bearing source populates the
      field; a non-reporting source leaves it null and is identifiable as such.
- [x] **R3.** Probe codex, grok, and agy upstream JSONL for a todo signal, which 0489 R4 left
      unexamined, and extend the allowlist to whatever they actually emit. A source with no todo
      signal is recorded as such rather than left ambiguous. Measurable: each of the three is
      documented as todo-bearing (with its tool name) or not, from real session evidence.
- [x] **R4.** Tool result content is **not** retained (ruled out 2026-08-09; ~100 KB–5 MB/session).
      Measurable: no result body reaches storage, asserted by test.
- [x] **R5.** Reduce `plugins/sp/skills/issue-finding/references/session-formats.md` to the
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
- [x] Probe codex, grok, and agy real session JSONL for a todo signal and record the verdict per source (R3)
- [x] Define the per-source todo-writing tool allowlist from that evidence plus 0489 R4's omp/pi/claude findings (R1, R3)
- [x] Retain raw args for allowlisted tools alongside `args_digest` in the ts-libs importer (R1)
- [x] Extract `duration_ms` from raw JSONL, leaving it absent where a source reports nothing (R2)
- [x] Assert tool result content never reaches storage (R4)
- [x] Reduce `session-formats.md` to the root-path table plus the fallback note (R5)
- [x] Validate on real data with a source-local binary recording the provenance header, and confirm Q4 loop detection still passes against the retained digest (R1-R3)
- [x] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
**External package (`@gobing-ai/ts-llm-jsonl-importer`, not a repo-relative path):** `args_raw TEXT` lands after `args_digest` on `history_tool_call`; `TODO_TOOL_ALLOWLIST` + `maybeArgsRaw` retain raw args for todo-writing tools only (`claude`/`TodoWrite`, `pi`/`todo`, `omp`/`TodoWrite`+`todo`, `codex`/`update_plan`, `grok`/`todo_write`; `agy`/`gemini` empty). `duration_ms` stays a population field — Grok fills it from `tool_completed`; other sources leave it null, never zero. Tool result bodies are never stored (only `result_bytes`).

**Spur monorepo**

- `packages/domain/src/migrations.ts:254-260` — `HISTORY_TOOL_CALL_ARGS_RAW_SCHEMA_SQL` (`ALTER TABLE … ADD COLUMN args_raw TEXT`).
- `packages/domain/src/migrations.ts:317-319` — CLI migration `0012_spur_cli_history_tool_call_args_raw` with `addColumnIfMissing`.
- `packages/domain/src/migrations.ts:368-373` — table-exists skip when `history_tool_call` is absent.
- `packages/domain/src/analytics/forensic-query.ts:292-305` — Q4 loop detection still keys on `args_digest` (additive, not a replacement).
- `plugins/sp/skills/issue-finding/references/session-formats.md:15-19` — fidelity prose gone; `mappers.ts` named as the single typed-table authority.

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | done | `args_raw` + allowlist + forensic-contract tests |
| R2 | no schema change | existing `duration_ms`; Grok populates; others leave null |
| R3 | done | Codex `update_plan`; Grok `todo_write`; AGY empty allowlist |
| R4 | done | result bodies never stored; contract tests |
| R5 | done | `session-formats.md` points at `mappers.ts` |
### Testing
Independent re-audit 2026-08-17 (`/sp:dev-verifyall --feature E5 --auto --next --force --focus all --fix all`). Every `file:line` below was re-read at the cited lines this run. `--fix all` corrected three anchors that drifted after tasks 0579/0580/0581 edited the same files (migrations.ts 254-260 → 285, migrations.ts 317-319 → 406-407, forensic-query.ts 292-305 → 333-347); the implementations are unchanged and still present. Prior re-audit 2026-08-14 flipped 13 leftover `[ ]` boxes. Artifacts: `.spur/run/0553-verdict.json`, `.spur/run/0553-verify-answer.txt`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/domain/src/migrations.ts:285-287` (`HISTORY_TOOL_CALL_ARGS_RAW_SCHEMA_SQL` — `ALTER TABLE history_tool_call ADD COLUMN args_raw TEXT`); `packages/domain/src/migrations.ts:406-409` (`0012_spur_cli_history_tool_call_args_raw`, `addColumnIfMissing`). Q4 loop detection still keys on the digest, not `args_raw`: `packages/domain/src/analytics/forensic-query.ts:333-347` (`args_digest IS NOT NULL`, `GROUP BY tc.session_id, tc.tool_name, tc.args_digest`) — additive, not a replacement. ts-libs `TODO_TOOL_ALLOWLIST` + `maybeArgsRaw` retain raw args for todo tools only |
| R2 | MET | Importer schema already carries `duration_ms` (no schema change). Populated where the source reports it, left NULL otherwise — never a fabricated zero. Measured this run on `.spur/spur.db`: omp `history_tool_call.duration_ms IS NOT NULL` = **102,113** (0 before the 0578 delivery); non-reporting sources still NULL |
| R3 | MET | Allowlist records codex `update_plan`, grok `todo_write`, agy `[]`; extended by 0578 R3 to opencode `todowrite`/`todoread` and pi `todo`/`manage_todo_list`. Source table row: `plugins/sp/skills/issue-finding/references/session-formats.md:34` (`agy` — no discoverable on-disk session format) |
| R4 | MET | Schema stores `result_bytes` only; no result-content column exists. Re-read this run — no result body reaches storage |
| R5 | MET | `plugins/sp/skills/issue-finding/references/session-formats.md:15-19` — "What typed tables retain is owned by `mappers.ts`… This skill holds **no duplicate field map**; two maps that can disagree is the defect closed by 0553 R5." No per-source fidelity ratings remain |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — Import retains the primitives phase detection needs | MET | query | `.spur/spur.db` this run: `history_tool_call.args_raw IS NOT NULL` = **7,496** rows (6 before the 0578 re-import), all from todo-writing tools; no result-content column exists in the schema |
| Scenario: R2 — Per-step latency is available for time decomposition | MET | test+query | `bun test packages/domain/tests/analytics/ packages/domain/tests/dao/migrations.test.ts packages/domain/tests/db.test.ts` this run → **275 pass / 0 fail / 851 expect()** (migration `0012` args_raw covered). Data plane: omp `duration_ms` non-null 102,113; sources that report no timing remain NULL, not 0 |

**SECUA Review**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | C | `packages/domain/src/migrations.ts` | **Fixed this run.** Three Testing anchors had drifted by 90–120 lines after 0579/0580/0581 edits and resolved to unrelated code (`SYSTEM_EVENTS_SEQUENCE_INDEX_SCHEMA_SQL`, a column list, a tool-map merge). Citations corrected; no implementation change |
| P4 | — | — | No P1–P2 findings; verify verdict PASS |

Coverage: N/A (verdict-based re-audit; the verify pipeline does not measure code coverage).
### Review
**Functional traceability** — all requirements MET (re-audit 2026-08-14):

| Req | Status | Evidence |
| --- | --- | --- |
| R1 args_raw retention | MET | Spur migration `0012` at `packages/domain/src/migrations.ts:254-260` and `:317-319`. Importer allowlist + `maybeArgsRaw` live in ts-libs (not a repo-relative path). This run: forensic-contract.test.ts 23 pass / 0 fail |
| R2 duration_ms | MET (no schema change) | Existing `duration_ms` column; Grok mapper populates it; other sources leave null |
| R3 probe codex/grok/agy | MET | Allowlist: Codex `update_plan`, Grok `todo_write`, AGY empty; `session-formats.md` agy row at `plugins/sp/skills/issue-finding/references/session-formats.md:34` |
| R4 no result content | MET | Only `result_bytes`; forensic-contract R4 this run |
| R5 reduce session-formats.md | MET | `plugins/sp/skills/issue-finding/references/session-formats.md:15-19` names `mappers.ts` as single authority |

**Priority findings** (no P1/P2):

| # | Severity | File | Finding |
| --- | --- | --- | --- |
| 1 | P3 | ts-libs importer allowlist | `TODO_TOOL_ALLOWLIST` is module-private — not exported. Correct: 0554 reads `args_raw` from the DB. Per-source verdict is in the allowlist docstring |
| 2 | P4 | published importer DDL | Released importer may lag `args_raw` in CREATE TABLE; fresh Spur DBs get the column via migration 0012 `addColumnIfMissing` |

**Residual risk** — none blocking. All changes additive (`args_raw` nullable, `args_digest` untouched, Q4 loop detection unchanged). Migration 0012 has table-exists skip guard for legacy DBs.
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
- 2026-08-14T06:09:48.925Z todo → wip (system)
- 2026-08-14T06:10:20.415Z wip → testing (system)
- 2026-08-14T07:16:23.702Z testing → done (system)
### Notes


Task 0578 released importer 0.4.37 (todo `args_raw` allowlist: omp `todo`/`todo_write`, pi `todo`/`manage_todo_list`, opencode `todowrite`/`todoread`, grok `todo_write`, codex `update_plan`) and ran `--mode full` re-import. Measured on `.spur/spur.db`: `args_raw` non-null rose 1,977 → 6,919. This task's retention claim is now data-plane-verified, not source-read.

