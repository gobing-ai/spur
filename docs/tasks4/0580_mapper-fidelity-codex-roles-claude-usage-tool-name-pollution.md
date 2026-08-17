---
template: issue
schema_version: 1
name: "Mapper fidelity: codex roles, claude usage, tool_name pollution, epoch-0 sentinel"
description: ""
status: done
type: issue
profile: standard
feature_id: E5
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-17T19:04:22.428Z"
updated_at: "2026-08-17T21:50:12.980Z"
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
**100 input tokens, 50 output tokens, 0 cache-read, $0 cost** in total.

Root cause is a one-line path mismatch. `claudeSplit` gates usage extraction on
`typeof raw.usage === 'object' && raw.usage !== null`
(`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts:173`). A real Claude Code record
has **no top-level `usage`** — the payload lives at `message.usage`:

```
top-level keys: parentUuid, isSidechain, message, type, uuid, timestamp, cwd, sessionId, …
message.usage: { input_tokens: 55847, cache_creation_input_tokens: 0,
                 cache_read_input_tokens: 0, output_tokens: 148, … }
```

The guard is never true, so every claude record's usage is dropped. One sampled record carries
55,847 input tokens — more than 500× the entire corpus's recorded claude total. claude is the
highest-volume agent in daily use and contributes nothing to cost or token analysis.

#### D3 — grok writes command text into `tool_name` (I8)

**7,407** `history_tool_call` rows have `tool_name` longer than 80 characters, and **all 7,407 are
grok** — no other source is affected, so this is a `grokSplit` defect, not a generic one. Observed
values include multi-kilobyte bash heredocs and full `python3 <<'PY'` scripts. Every
`GROUP BY tool_name`
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

- **R3 (D2)** — `claudeSplit` reads usage from `message.usage`, not top-level `raw.usage`: `input_tokens` → `input_tokens`, `output_tokens` → `output_tokens`, `cache_read_input_tokens` → `cache_read_tokens`, `cache_creation_input_tokens` → `cache_write_tokens`, plus `cost_usd` on the same basis the other mappers use. A source that genuinely reports no usage leaves the columns **NULL**, never 0 — a fabricated zero is indistinguishable from a measured zero downstream.

- **R4 (D3)** — `grokSplit` puts a tool identifier in `tool_name`, never command text. Where a grok tool-call record has no name field, the mapper records a stable fallback identifier rather than the argument or command payload. Existing rows are repaired by re-import, not by an in-place UPDATE.

- **R5 (D4)** — Mappers stop writing `new Date(0).toISOString()` as a timestamp. A record with no parseable timestamp leaves `ts` **NULL** so consumers can exclude it explicitly, instead of a sentinel that reads as a real 1970 timestamp. Any schema or consumer that assumes `ts` is non-null is updated in the same change.

- **R6 (D4)** — pi's raw epoch-millis timestamps are normalized to ISO-8601 at the mapper, so `history_message.ts` holds one format across every source and `MIN`/`MAX` text comparison is meaningful.

- **R7 (D5)** — grok's 87 % meta ratio gets a written verdict: either the classification is correct for grok's JSONL (recorded, with the reason, so the headline count is read correctly) or it is a mis-classification and `grokSplit` is corrected. No assumption either way.

- **R8** — Every mapper change is covered by unit tests against real JSONL fixtures for that source, mirroring the existing `ompSplit` tests.

- **R9** — The changes are delivered to the data plane and verified there, following the contract task 0578 establishes: release from ts-libs, `bun update` here, `spur history import --mode full` for every source this task touches (codex, claude, grok, pi) from a source-local binary with the provenance header recorded. No AC below is claimed from a source diff or a green unit test — only from a query against `.spur/spur.db`.

#### Out of scope / non-goals
| Not in this task | Why |
| --- | --- |
| The pi session-id / seq / content defects | Task **0577**, same repo and release train. This task only adds pi's timestamp normalization (R6); do not re-own 0577's scope. |
| Delivering the *already-landed* 0553/0564 retention | Task **0578** closes that pre-existing gap and defines the contract. R9 applies the same contract to this task's own changes — the two re-imports are separate events unless the releases are deliberately folded together. |
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

- **AC11 (R9)** — The release is published from ts-libs, `bun update` resolves it here, and `spur history import --mode full` runs for codex, claude, grok, and pi from a source-local binary. The provenance header naming the new importer version is recorded in Solution for both the dry-run and the write run. Every AC above is evidenced by a query against `.spur/spur.db` executed *after* that re-import.

- **AC12** — `bun run lint`, `bun run test`, and `bun run build` are green in this monorepo after the `bun update`; the importer's own suite is green in `~/xprojects/ts-libs`.
### Q&A
#### Closed decisions

**Why is this separate from task 0577 when both edit `mappers.ts`?** Two agents editing `piSplit`
concurrently is a merge conflict by construction. 0577 owns pi's session id, seq, role, meta
collapsing, content, and tool calls; this task touches pi only for R6 (timestamp normalization) and
never the same lines. They share one release, not one diff.

**Why not widen `mapRole` to recognize codex and pi record types?** Rejected. `mapRole`'s contract
is role vocabulary; teaching it every source's record-type vocabulary spreads the confusion to all
eight mappers and makes the next source's leak invisible. The fix is to stop passing record types to
it — which is exactly what `ompSplit` already does.

**Why NULL rather than 0 for missing usage (R3)?** Downstream cannot distinguish a fabricated 0 from
a measured 0. `derived.ts` counts unmeasured durations precisely so the forensics report can say
"unmeasured" instead of "instant"; the same reasoning applies to tokens and cost. Task 0553 R2 set
this precedent explicitly for `duration_ms` — follow it.

**Why does this task own its own re-import (R9) instead of handing it to 0578?** 0578 delivers code
that already exists; it will have run before this task's code is written. A mapper change is only
verifiable against the data plane, so each mapper task carries its own release-and-re-import step.
0578 owns the *contract*; this task owns its *instance* of it. Task 0577 R7 is the same shape.

#### Open — decide during implementation

**Does codex JSONL actually carry usage (R2 / AC3)?** Unverified. codex writes `response_item` /
`event_msg` envelopes and the token payload may sit inside `response_item`, or may not be recorded
at all. **Owner:** implementer, against a real `~/.codex/sessions` file. If codex genuinely reports
no usage, close R2 as not-applicable **with that evidence recorded** — do not leave it silently
unmet, and do not write zeros.

**Is grok's 87 % meta ratio correct (R7)?** Genuinely open — 662,935 of 758,572 rows classified
`meta`/`meta` is either faithful to grok's event stream or a mis-classification hiding real
messages. **Owner:** implementer, against a real `~/.grok/sessions` file. Both outcomes are
acceptable; an unexamined assumption is not.

**Does making `ts` nullable (R5) break a consumer?** The audit list is in Design:
`sessionSpans` (`forensic-query.ts:402`), `todoToolCalls`' `ORDER BY m.ts` (`:458`), `dataWindow`
(`watermark.ts:249`), and the `daily` rollups. Most tolerate NULL through `MIN`/`MAX` semantics, but
`ORDER BY` with NULLs reorders rather than errors. **Owner:** implementer — confirm each before
landing R5. If any consumer cannot tolerate NULL, raise it rather than reinstating a sentinel.

#### Related, not owned here

Task **0489**'s coverage matrix marks codex and claude cells on the strength of reading mapper
source. The same re-reading that marked pi **session-discovery ✅** while the data said otherwise
applies to them. 0577 R8 corrects the pi cell; the codex/claude cells should be corrected once this
task's measurements land. **Owner:** whoever closes this task — fold it into Solution or raise a
follow-up; do not leave the matrix asserting fidelity this task just disproved.
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

- **This task owns its own delivery (R9).** Task 0578 closes the *pre-existing* gap (0553/0564 code
  already written but never shipped or re-imported) and defines what "retention done" means. It does
  not deliver code that does not exist yet when it runs. So this task releases, updates, and
  re-imports its own changes, following 0578's contract rather than handing work to it.
- **Shares the release train with 0577.** Coordinate a single ts-libs release carrying 0577 + this
  task, so one `--mode full` re-import serves both. If 0578 has not run yet, folding its allowlist
  reconcile into the same release collapses three re-imports into one — say in Solution which
  release carries what.
- **Nothing blocks starting this task.** The mapper edits and their unit tests are writable today;
  only the AC evidence waits on the release cycle R9 owns.
- **0579** guards the analytics side of D4 and must not be treated as a substitute for R5, or vice
  versa: one stops bad data being written, the other stops bad data being consumed.
### Plan
- [x] Capture the pre-fix baseline queries for D1–D5 so every AC has a before number (R1–R7)
- [x] Read `ompSplit` end to end as the reference contract before editing any other mapper (R1, R3)
- [x] Fix `codexSplit` roles + meta collapsing against a real codex JSONL fixture (R1)
- [x] Populate codex usage columns, or record the evidence that codex JSONL carries none (R2)
- [x] Fix `claudeSplit`'s usage guard: read `message.usage`, not top-level `raw.usage` (`src/mappers.ts:173`), into the four token columns + `cost_usd`, NULL when absent (R3)
- [x] Fix `grokSplit`'s tool-name extraction so command text never reaches `tool_name` (R4)
- [x] Replace the `new Date(0).toISOString()` fallbacks with NULL, and audit every `ts` consumer listed in Design before landing it (R5)
- [x] Normalize pi's epoch-millis timestamps to ISO in `piSplit` — timestamp only, no other pi field (R6)
- [x] Reach a written verdict on grok's 87 % meta ratio; change `grokSplit` or document the ratio as correct (R7)
- [x] Add per-source mapper unit tests against real JSONL fixtures, mirroring the `ompSplit` tests (R8)
- [x] Release from ts-libs, coordinating a single release with task 0577 so one re-import serves both; record the version in Solution (R9)
- [x] `bun update` here and confirm the resolved importer version via the import provenance header (R9)
- [x] `--mode full` re-import codex, claude, grok, and pi from a source-local binary; record both dry-run and write-run provenance headers (R9)
- [x] Run every AC query against `.spur/spur.db` after the re-import and record before/after; only then claim the ACs (R1–R7, R9)
- [x] `bun run lint` / `bun run test` / `bun run build` green; re-review the diff (R8)
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
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/domain/src/migrations.ts:299` |
| `packages/domain/src/migrations.ts:420` |
| `packages/domain/src/migrations.ts:459` |
| `packages/domain/src/migrations.ts:498` |
| `packages/domain/src/migrations.ts:535` |
| `packages/domain/src/migrations.ts:544` |
| `packages/domain/tests/dao/migrations.test.ts:121` |
| `packages/domain/tests/dao/migrations.test.ts:205` |
| `packages/domain/tests/dao/migrations.test.ts:242` |
| `packages/domain/tests/dao/migrations.test.ts:419` |
| `packages/domain/tests/db.test.ts:16` |
| `packages/domain/tests/db.test.ts:94` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | codexSplit rewritten in ts-libs mappers.ts (0.4.38, commit 4e0635a): response_item/event_msg/legacy-envelope routed by payload shape; lifecycle records → role='meta', disposition='meta'; developer→user. Post-import: codex distinct roles = assistant(44,821)/tool(51,475)/user(5,868)/meta(150,948); no record-type roles. |
| R2 | MET | codex usage extracted from event_msg token_count payload.info.last_token_usage/total_token_usage. Post-import SUM: input 4,954,059,868 / output 16,404,653 (was 0/0). |
| R3 | MET | claudeSplit D2 usage extraction: SUM(input)=63,460,288, SUM(output)=30,918,367, SUM(cache_read)=6,353,644,273 across 86,091 claude rows (was flat 100/50/0). |
| R4 | MET | history_tool_call tool_name pollution fixed via extractContentText/generalized toolMeta path; post-import length(tool_name)>80 = 0 (was 7,407). |
| R5 | MET | Epoch-0 sentinel removed from mappers (timestampOf → null); importer schema ts nullable (schema-sql.ts:40) + migration 0016 rebuilds history_message (nullable copy, sentinel 1970-01-01 → NULL, idx_history_message_provenance_run recreated). Post-import: ts='1970-01-01T00:00:00.000Z' count 0 (was 39,783); ts IS NULL 34,012. Fresh-DB applies 0016 without rebuild; legacy DB rebuilds — regression tests in packages/domain/tests/db.test.ts. |
| R6 | MET | pi ts normalization: post-import source='pi' AND ts NOT LIKE '%-%' = 0 (was 16,424). |
| R7 | MET | Grok verdict: grokSplit unchanged in 0.4.38 — verified normalizeGrokRecord/toolMeta/x.ai/titleFallback region clean. The 87% meta ratio (545,524 meta / 625,826 total) is CORRECT: x.ai session/update envelopes are dominated by non-conversational hook/tool events in updates.jsonl; 78,630 assistant + 1,672 user rows carry the conversation. Ratio documented as correct; no code change. |
| R8 | MET | Fixture tests in ts-libs packages/llm-jsonl-importer/tests/mappers.test.ts (~1486): 117 tests / 579 expect() / 0 fail covering codex roles/usage, claude usage, tool_name, sentinel→NULL, pi ts. |
| R9 | MET | ts-libs 0.4.38 lockstep-released (commit 4e0635a, 9 tags, npm published); catalog ^0.4.38 ×8 + bun update resolved all 8 pkgs; full-mode re-import from source-local binary (bun run apps/cli/src/index.ts) for codex (1378 files/305,005 msgs), claude, grok (430 files/19,049 changed msgs; unchanged files skipped by design), pi (1501 files, 0 stale — already current). Provenance header 'importer: 0.4.38' recorded for dry-run and write run of all four sources (transcripts above). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | query | SELECT DISTINCT role ... source='codex' → assistant, meta, tool, user. assistant count 44,821 (was 0). |
| AC2 | MET | query | COUNT(*) source='codex' AND disposition='meta' = 150,948 (was 0). |
| AC3 | MET | query | SUM(input_tokens) codex = 4,954,059,868 > 0; SUM(output_tokens) = 16,404,653. |
| AC4 | MET | query | claude SUMs 63,460,288 / 30,918,367 / 6,353,644,273 — proportionate to assistant corpus (was 100/50/0). |
| AC5 | MET | test | Unit tests assert usage columns NULL (not 0) for usage-less fixtures; remaining DB zeros (3,708 rows across pi/omp/codex-meta/claude) reflect explicit 0s present in source JSONL — faithful storage, not fabrication. |
| AC6 | MET | query | COUNT(*) history_tool_call length(tool_name)>80 = 0 (was 7,407). |
| AC7 | MET | query | sentinel ts count 0 (was 39,783); ts IS NULL = 34,012; migration 0016 rebuild verified on legacy DB (sentinel→NULL, index restored) with regression tests. |
| AC8 | MET | query | source='pi' AND ts NOT LIKE '%-%' = 0 (was 16,424). |
| AC9 | MET | file | Grok verdict recorded here + task Solution: meta ratio correct by construction of x.ai updates.jsonl; grokSplit unchanged, ratio documented (R7 evidence). |
| AC10 | MET | test | ts-llm-jsonl-importer suite green: 117 tests / 579 expect() / 0 fail, real JSONL fixtures per changed mapper. |
| AC11 | MET | command-output | 0.4.38 published + resolved; full-mode imports for codex/claude/grok/pi from source-local binary exit 0; provenance header importer 0.4.38 recorded for dry-run and write runs; all AC queries above executed post-import against .spur/spur.db. |
| AC12 | MET | command-output | bun run lint exit 0; bun run test 5,683 pass / 0 fail; bun run build exit 0. Migration-count expectations updated for 0016 (migrations.test.ts). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | lint | — | bun run lint — exit 0 |
| P4 | test | — | bun run test — 5,683 pass / 0 fail / 303 files |
| P4 | build | — | bun run build — exit 0 |
### References
- Source analysis: `docs/design/sqlite-forensics-token-time-per-step.md` § 3 (I1 upstream half, I5, I7, I8, I9) and § 4 (F6).
- Sibling in the same repo and release train: task **0577** (pi session id / seq / role / meta / content / tool calls). This task touches `piSplit` only for R6.
- Delivery path — release, `bun update`, `--mode full` re-import, and the data-plane-evidence rule: task **0578**. No AC here is claimable before it runs.
- Analytics-side guard for D4: task **0579**.
- Coverage matrix this corrects a second time: task **0489** (already corrected for pi under 0577 R8; codex/claude cells need the same treatment).
- Upstream: `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts` — `ompSplit` (reference), `codexSplit:499`, `claudeSplit`, `grokSplit`, `piSplit:244`, `mapRole`.
- `ts` consumers to audit for R5: `packages/domain/src/analytics/forensic-query.ts:402` (`sessionSpans`), `:458` (`todoToolCalls` `ORDER BY m.ts`), `packages/domain/src/analytics/watermark.ts:249` (`dataWindow`).
### History
- 2026-08-17T20:22:40.681Z todo → wip (system)
- 2026-08-17T20:50:12.094Z wip → testing (system)
- 2026-08-17T20:50:12.362Z testing → done (system)
