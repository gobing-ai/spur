---
template: issue
schema_version: 1
name: "Mapper fidelity: codex roles, claude usage, tool_name pollution, epoch-0 sentinel"
description: ""
status: todo
type: issue
profile: standard
feature_id: E5
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-17T19:04:22.428Z"
updated_at: "2026-08-17T19:11:58.175Z"
---

## 0580. Mapper fidelity: codex roles, claude usage, tool_name pollution, epoch-0 sentinel

### Background
From the root-cause pass on `docs/design/sqlite-forensics-token-time-per-step.md` (issues **I1**
upstream half, **I5**, **I7**, **I8**, **I9**; fix **F6**), 2026-08-17. Sibling of task **0577**
(pi mapper) — same repo, same release train, same defect family.

The first pass filed these under "source fidelity gaps … forensics for these sources is counts-only",
which reads as an upstream-data limitation. It is not: the JSONL carries the signal and the mappers
drop it. Four distinct defects, measured against `.spur/spur.db`.

#### D1 — codex has zero assistant messages (I5)

253,112 codex rows and **0** with `role = 'assistant'`. The roles are codex **record types**:

| role | rows |
| --- | --- |
| `response_item` | 153,776 |
| `event_msg` | 91,780 |
| `turn_context` | 3,309 |
| `session_meta` | 1,379 |
| `unknown` | 1,039 |
| `function_call` | 429 |

Same shape as pi's defect (0577): `mapRole` (`dist/mappers.js:1173-1182`) returns unrecognized
strings verbatim, so a record type passed to it lands in `role`. Every role-scoped metric — assistant
step counts, LLM time, token attribution, turn-closer detection for the task 0550 watermark — reads
0 for codex. `codexSplit` does resolve `session_id` correctly (`src/mappers.ts:503`), so this is
narrower than pi's: roles and usage, not session identity.

#### D2 — claude usage extraction is broken (I7)

claude's roles **are** canonical (`assistant` 35,766 · `user` 19,845 · `meta` 20,979), so this is a
different defect from D1. But across those 35,766 assistant messages the corpus holds
**100 input tokens, 50 output tokens, 0 cache-read, $0 cost** in total. claude JSONL carries
`message.usage` with `input_tokens` / `output_tokens` / `cache_read_input_tokens`; `claudeSplit` is
not reading it. claude is the highest-volume agent in daily use and contributes nothing to cost or
token analysis.

#### D3 — `tool_name` holds command text (I8)

**7,407** `history_tool_call` rows have `tool_name` longer than 80 characters — observed values
include multi-kilobyte bash heredocs and full `python3 <<'PY'` scripts. Every `GROUP BY tool_name`
is polluted by thousands of unique one-off "tools": per-tool exec time, top-tool ranking, and Q4
repeated-call loop detection — `loops` (`forensic-query.ts:334`) groups by
`(session_id, tool_name, args_digest)`, so a call whose "name" is its own command text can never
reach the `HAVING COUNT(*) >= 3` threshold and no loop involving it is ever reported.

#### D4 — the epoch-0 timestamp sentinel (I1, upstream half)

Every mapper ends timestamp resolution with `?? new Date(0).toISOString()`, writing
`'1970-01-01T00:00:00.000Z'` into **39,783** rows (grok 20,189 · claude 16,743 · codex 2,289 ·
omp 560 · gemini 2). Task **0579** guards the analytics side; this task stops the sentinel being
written. Separately, pi writes raw epoch-millis **strings** (`"1786684271589"`, 16,424 rows) instead
of ISO — normalize at the mapper.

#### D5 — grok is 87 % meta (I9)

662,935 of 758,572 grok rows are `meta`/`meta`; `model` is present on 0.5 % of assistant rows and
`duration_ms` on 15.7 %. Not necessarily a bug — but the "758K messages" headline overstates grok's
analytic value ~8×, and whether the meta ratio is correct or a mis-classification needs a verdict
rather than an assumption.
### Requirements
- **R1 (D1)** — `codexSplit` maps `role` from the record's actual message role rather than passing the codex record type through `mapRole`. Codex assistant turns land as `role = 'assistant'`; codex lifecycle record types (`session_meta`, `turn_context`, and the non-message `event_msg` variants) collapse to `disposition: 'meta'` the way `ompSplit` handles its lifecycle types. No codex record type appears in `role` afterwards.

- **R2 (D1)** — Codex token/usage columns are populated where the JSONL carries them, so codex stops reporting 0 input/output tokens across 253,112 rows.

- **R3 (D2)** — `claudeSplit` reads Claude's `message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) into `input_tokens` / `output_tokens` / `cache_read_tokens` / `cache_write_tokens`, and derives `cost_usd` on the same basis the other mappers do. A source that genuinely reports no usage leaves the columns **NULL**, never 0 — a fabricated zero is indistinguishable from a measured zero downstream.

- **R4 (D3)** — `tool_name` carries a tool identifier, never command text. Where a source's tool-call record has no name field, the mapper records a stable fallback identifier rather than the argument payload. Existing rows are repaired by the re-import in task 0578, not by an in-place UPDATE.

- **R5 (D4)** — Mappers stop writing `new Date(0).toISOString()` as a timestamp. A record with no parseable timestamp leaves `ts` **NULL** so consumers can exclude it explicitly, instead of a sentinel that reads as a real 1970 timestamp. Any schema or consumer that assumes `ts` is non-null is updated in the same change.

- **R6 (D4)** — pi's raw epoch-millis timestamps are normalized to ISO-8601 at the mapper, so `history_message.ts` holds one format across every source and `MIN`/`MAX` text comparison is meaningful.

- **R7 (D5)** — grok's 87 % meta ratio gets a written verdict: either the classification is correct for grok's JSONL (recorded, with the reason, so the headline count is read correctly) or it is a mis-classification and `grokSplit` is corrected. No assumption either way.

- **R8** — Every mapper change is covered by unit tests against real JSONL fixtures for that source, mirroring the existing `ompSplit` tests.

#### Out of scope / non-goals
| Not in this task | Why |
| --- | --- |
| The pi session-id / seq / content defects | Task **0577**, same repo and release train. This task only adds pi's timestamp normalization (R6); do not re-own 0577's scope. |
| Release, `bun update`, and the re-import | Task **0578** owns the delivery path. Coordinate the release train; do not re-import from here. |
| The analytics-side span guard | Task **0579**. R5 removes the sentinel at the source; the guard must still exist for future sources. |
| Backfilling existing rows with SQL | The raw JSONL is the authority. Repair is a re-import (0578), never an in-place UPDATE. |
| Adding new columns to `history_message` / `history_tool_call` | Every column these requirements populate already exists. |
### Acceptance Criteria
- **AC1 (R1)** — After the fix and a full re-import, `SELECT DISTINCT role FROM history_message WHERE source='codex'` contains `assistant` with a non-trivial count (0 today of 253,112 rows) and contains **no** codex record type (`response_item`, `event_msg`, `turn_context`, `session_meta`, `function_call`).

- **AC2 (R1)** — Codex lifecycle records carry `disposition='meta'`; `SELECT COUNT(*) FROM history_message WHERE source='codex' AND disposition='meta'` is > 0, where it is 0 today.

- **AC3 (R2)** — `SELECT SUM(input_tokens) FROM history_message WHERE source='codex'` is > 0 (0 today), or the task records evidence that codex JSONL genuinely carries no usage — in which case the columns stay NULL and R2 is closed as not-applicable with that evidence.

- **AC4 (R3)** — `SELECT SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens) FROM history_message WHERE source='claude'` returns values proportionate to 35,766 assistant messages, replacing today's **100 / 50 / 0**.

- **AC5 (R3)** — A source reporting no usage leaves the columns NULL: a unit test asserts NULL, not 0, for a usage-less fixture record.

- **AC6 (R4)** — `SELECT COUNT(*) FROM history_tool_call WHERE length(tool_name) > 80` is **0** after re-import, down from **7,407**.

- **AC7 (R5)** — `SELECT COUNT(*) FROM history_message WHERE ts = '1970-01-01T00:00:00.000Z'` is **0** after re-import, down from **39,783**; records with no parseable timestamp have `ts IS NULL`.

- **AC8 (R6)** — `SELECT COUNT(*) FROM history_message WHERE source='pi' AND ts NOT LIKE '%-%'` is **0**, down from **16,424**; every pi `ts` parses with `new Date(...)` to a finite time.

- **AC9 (R7)** — The grok meta-ratio verdict is written into this task's Solution with the evidence behind it, and either `grokSplit` changed or the ratio is documented as correct.

- **AC10 (R8)** — Per-source mapper unit tests exist in `ts-llm-jsonl-importer` for each changed mapper, using real JSONL fixtures, and the importer's own suite is green.

- **AC11** — After task 0578 delivers this release, `bun run lint`, `bun run test`, and `bun run build` are green in this monorepo.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
All edits land in `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts`. Nothing in this
monorepo changes except the resolved dependency version, which task **0578** owns.

#### `ompSplit` is the reference implementation

`ompSplit` is the only mapper that has been brought up to the current contract: role from the nested
message (`mapRole(msg?.role ?? raw.type ?? raw.role)`), a meta branch collapsing lifecycle record
types to `disposition: 'meta'`, `extractContentText` for block content, and per-call tool timing
from `details.wallTimeMs`. Read it first and port its shape — do not invent a second pattern. The
same porting job for pi is task 0577.

#### Frozen names (already exist; do not rename)

`mapRole`, `codexSplit`, `claudeSplit`, `grokSplit`, `piSplit`, `SplitEntry`, `TODO_TOOL_ALLOWLIST`,
`argsDigest`, `maybeArgsRaw`, `extractContentText`, `sessionIdFromContext`, and the column names
`role`, `disposition`, `record_type`, `ts`, `input_tokens`, `output_tokens`, `cache_read_tokens`,
`cache_write_tokens`, `cost_usd`, `tool_name`.

#### R5 is the one change with a consumer contract

Replacing the `new Date(0).toISOString()` fallback with NULL changes `history_message.ts` from
always-present to nullable. Before landing it, check every consumer that reads `ts`:
`sessionSpans` (`forensic-query.ts:402`), `dataWindow` (`watermark.ts:249`), `daily` rollups, and the
`ORDER BY m.ts` in `todoToolCalls` (`forensic-query.ts:458`). Most already tolerate NULL via
`MIN`/`MAX` semantics, but confirm rather than assume — a NULL that silently reorders a session is
worse than the sentinel it replaces. Task 0579's guard lands independently and covers the
analytics-side risk either way.

#### Anti-patterns — do not implement

- **Do not write `0` for a missing token count.** R3 — 0 and "not reported" are different facts and
  the forensics report distinguishes them. NULL means unknown.
- **Do not write a timestamp sentinel of any value.** Replacing `new Date(0)` with "now" or with the
  file mtime is worse: it fabricates a plausible number instead of an obvious one.
- **Do not repair existing rows with SQL.** The raw JSONL is the authority and a re-import (0578) is
  the mechanism.
- **Do not widen `mapRole` to accept record types.** The fix is to stop passing record types to it,
  as `ompSplit` does. Making `mapRole` tolerant would spread the confusion to every source.
- **Do not fold pi's session-id / seq / content work in here.** That is 0577; two agents editing
  `piSplit` in one release is a merge conflict by construction. This task touches pi only for R6.
- **Do not truncate long `tool_name` values.** R4 — a truncated heredoc is still not a tool name.
  Find why command text reaches the field and stop it at the source.

#### Cross-task contract

- **Depends on nothing**, but is only *observable* through task **0578**'s release + re-import. Land
  the code, then hand 0578 the version to adopt; do not claim an AC until the data-plane query runs.
- **Shares the release train with 0577.** Coordinate a single ts-libs release carrying 0577 + this
  task + 0578's allowlist reconcile, so one `--mode full` re-import serves all three. Say in Solution
  which release number carries what.
- **0579** guards the analytics side of D4 and must not be treated as a substitute for R5, or vice
  versa: one stops bad data being written, the other stops bad data being consumed.
### Plan
- [ ] Capture the pre-fix baseline queries for D1–D5 so every AC has a before number (R1–R7)
- [ ] Read `ompSplit` end to end as the reference contract before editing any other mapper (R1, R3)
- [ ] Fix `codexSplit` roles + meta collapsing against a real codex JSONL fixture (R1)
- [ ] Populate codex usage columns, or record the evidence that codex JSONL carries none (R2)
- [ ] Fix `claudeSplit` to read `message.usage` into the four token columns + `cost_usd`, NULL when absent (R3)
- [ ] Trace why command text reaches `tool_name` and stop it at the extraction site (R4)
- [ ] Replace the `new Date(0).toISOString()` fallbacks with NULL, and audit every `ts` consumer listed in Design before landing it (R5)
- [ ] Normalize pi's epoch-millis timestamps to ISO in `piSplit` — timestamp only, no other pi field (R6)
- [ ] Reach a written verdict on grok's 87 % meta ratio; change `grokSplit` or document the ratio as correct (R7)
- [ ] Add per-source mapper unit tests against real JSONL fixtures, mirroring the `ompSplit` tests (R8)
- [ ] Release from ts-libs, coordinating one release with tasks 0577 and 0578; record the version in Solution (R1–R8)
- [ ] After 0578 re-imports, run every AC query and record before/after; only then claim the ACs (R1–R7)
### Root Cause
Verified 2026-08-17 against `.spur/spur.db` and
`node_modules/@gobing-ai/ts-llm-jsonl-importer@0.4.33/dist/mappers.js` (source of record:
`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts`, currently 0.4.35).

| # | Mechanism | Evidence |
| --- | --- | --- |
| **D1** | `codexSplit` derives `role` from the codex record type, and `mapRole` (`dist/mappers.js:1173-1182`) returns unrecognized strings verbatim (`return t \|\| 'unknown'`). Codex record types therefore land in `role`. No meta branch collapses lifecycle types. | 0 of 253,112 codex rows have `role='assistant'`; roles are `response_item` / `event_msg` / `turn_context` / `session_meta` / `function_call` |
| **D2** | `claudeSplit` does not read `message.usage`; the token columns are populated from a path Claude's JSONL does not use. Roles are correct, so this is isolated to usage extraction. | 35,766 claude assistant messages ⇒ 100 input / 50 output / 0 cache-read / $0 total |
| **D3** | The tool-call branch writes `tool_name: String(call.name ?? '')`; for records whose call block has no `name`, the argument or command payload reaches the field instead. | 7,407 rows with `length(tool_name) > 80`, containing bash heredocs and `python3 <<'PY'` scripts |
| **D4** | Every mapper's timestamp resolution ends `?? new Date(0).toISOString()` (claude `dist/mappers.js:124`, pi `:232`, omp `:309`; generic `defaultCreatedAt` at `sources.js:22-24`). pi additionally passes `r.ts` through unchanged, so raw epoch-millis strings are stored. | 39,783 rows at `'1970-01-01T00:00:00.000Z'`; 16,424 pi rows matching `ts NOT LIKE '%-%'` |
| **D5** | `grokSplit`'s disposition assignment classifies the overwhelming majority of grok records as meta. Whether that is faithful to grok's JSONL is unverified. | 662,935 of 758,572 grok rows are `meta`/`meta`; model on 0.5 % and duration on 15.7 % of assistant rows |

D1 is the same defect class as pi's (task 0577) and codex is the second-largest source by row count,
so the two together account for 462,505 rows — 28 % of the corpus — carrying record types where
roles belong. D4 is the upstream half of the span-math failure task 0579 guards.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Source analysis: `docs/design/sqlite-forensics-token-time-per-step.md` § 3 (I1 upstream half, I5, I7, I8, I9) and § 4 (F6).
- Sibling in the same repo and release train: task **0577** (pi session id / seq / role / meta / content / tool calls). This task touches `piSplit` only for R6.
- Delivery path — release, `bun update`, `--mode full` re-import, and the data-plane-evidence rule: task **0578**. No AC here is claimable before it runs.
- Analytics-side guard for D4: task **0579**.
- Coverage matrix this corrects a second time: task **0489** (already corrected for pi under 0577 R8; codex/claude cells need the same treatment).
- Upstream: `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts` — `ompSplit` (reference), `codexSplit:499`, `claudeSplit`, `grokSplit`, `piSplit:244`, `mapRole`.
- `ts` consumers to audit for R5: `packages/domain/src/analytics/forensic-query.ts:402` (`sessionSpans`), `:458` (`todoToolCalls` `ORDER BY m.ts`), `packages/domain/src/analytics/watermark.ts:249` (`dataWindow`).
### History
