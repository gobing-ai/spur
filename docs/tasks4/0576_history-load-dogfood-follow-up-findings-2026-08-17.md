---
template: review
schema_version: 1
name: "history-load dogfood follow-up findings (2026-08-17)"
description: ""
status: done
type: review
profile: standard
feature_id: E5
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-17T18:20:25.305Z"
updated_at: "2026-08-17T19:08:26.040Z"
---

## 0576. history-load dogfood follow-up findings (2026-08-17)

### Background
#### Review Findings

Findings from dogfood run `20260817-historyload-103307`
(`docs/dogfood/2026-08-17-sp-dev-history-load-dogfood.md`) on `/skill:sp-dev-history-load`.

The report's P1 was root-caused and fixed in the same session. Its P2 was **re-investigated on
2026-08-17 and the original diagnosis was wrong** — see Q&A for the corrections and the measured
evidence. This task now owns exactly one open defect: the watermark degrade rule fails **closed**.
The upstream pi mapper defect that exposed it is split out to task **0577**. The report's P3 is
rejected (Q&A).

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1 | `packages/domain/src/analytics/watermark.ts` | `spur history analyze` crashed with `Expression tree is too large (maximum depth 1000)` on the `pi` source: `buildWatermarkFilter` built a per-session `NOT (A OR B OR …)` chain (SQLite parses left-deep → depth ~1/session) and pi has ~176k in-progress sessions, past `SQLITE_MAX_EXPRESSION_DEPTH` (1000). Also produced a 9.3 MB SQL string with 529,848 bound params. **RESOLVED in-session 2026-08-17**, currently uncommitted in the working tree. | Keep the `NOT EXISTS` anti-join against the indexed temp table (`materializeWatermarkExclude`). Lands with this task; its regression test stays green. |
| P2 | `packages/domain/src/analytics/watermark.ts:153` (task 0550 degrade rule) | **The degrade rule fails closed.** `watermarkSeq = complete ? row.maxSeq : (closerByKey.get(key) ?? -1)` — a session with no identifiable turn closer gets watermark `-1`, and the exclusion filter (`m.seq > watermark_seq`) then drops **every message of that session** from every analytics query. This is a class defect for any source whose turn structure the rule cannot read, not a pi quirk. | Fail open: with no turn closer there is no evidence of where a trailing partial turn begins, so exclude nothing. Keep `state: 'in-progress'` (the consumer-visible signal, surfaced as `sessionState`) and set the watermark to the session's max seq. Two existing tests encode the old `-1` semantics and change with it. |
| P3 | `plugins/sp/scripts/history-load.ts` | Dogfood aggregate cache hit rate 21% (< 50% floor). | **Rejected** — measurement artifact, not a defect. See Q&A. |

#### Measured blast radius (baseline, 2026-08-17)

`bun run apps/cli/src/index.ts history analyze --source pi --json` against `.spur/spur.db`:

| Measure | Today | Why |
| --- | --- | --- |
| `coverage[pi].messages` (import-faithful, not watermarked) | 209,393 | what the importer landed |
| `totals.messages` (post-watermark) | **16,424 (7.8%)** | 192,969 messages silently dropped |
| `bySession` entries | **1** (`unknown`) | the only pi session holding an assistant non-meta row |
| `bySource.pi.inputTokens` | 9,844,774 | vs **317,527,179** present in `history_message` |
| pi sessions with a turn closer | **1 of 176,792** | every other session gets watermark `-1` |

The single surviving session is exactly the one the rule could read. Every other pi session
disappears — no error, no warning, no coverage discrepancy surfaced to the operator.
### Requirements
- **R1 (P2)** — The task 0550 watermark must never exclude an entire session. When `sessionWatermarks` finds no turn closer for a session, it has no evidence of where a trailing partial turn begins, so it excludes nothing: the session keeps `state: 'in-progress'` and its `watermarkSeq` becomes the session's max seq. Sessions that *do* have a closer keep trimming at it — behavior unchanged.

- **R2 (P2)** — The fail-open invariant is stated in `watermark.ts`'s policy docblock next to the degrade rule it corrects, naming why: 0550's purpose is to shave a trailing partial turn, never to drop a source from analytics.

- **R3 (P2)** — The two existing tests that encode the old fail-closed semantics are updated to assert the new invariant, and a test covers the tool-call-less source shape directly (a source with zero `history_tool_call` rows whose sessions end on a non-assistant role — the pi shape) asserting its messages survive the watermark filter.

- **R4 (P1)** — The shipped anti-join fix lands with this task: `buildWatermarkFilter` emits `NOT EXISTS` against the `spur_wm_exclude` temp table materialized by `materializeWatermarkExclude`, `HistoryService.analyze` materializes before the query batch and drops after, and the `>1000 in-progress sessions` regression test stays green.

#### Out of scope / non-goals
| Not in this task | Why |
| --- | --- |
| The pi mapper (`piSplit` in `@gobing-ai/ts-llm-jsonl-importer`) | The reason pi has no tool-call rows and no real session ids. Owned by task **0577**; needs a ts-libs release plus a full pi re-import. Do not touch `node_modules/@gobing-ai/*` or `~/xprojects/ts-libs` here. |
| Any re-import | This task changes only how already-imported rows are filtered at analyze time. `spur history import` is untouched and `coverage[*]` stays import-faithful. |
| The `SessionState` vocabulary | `'in-progress'` / `'complete'` and the artifact's `sessionState` field keep their current meaning and shape. No new state, no consumer-visible schema change. |
| P3 / wrapper output shaping | Rejected as a measurement artifact (Q&A). No change to `plugins/sp/scripts/history-load.ts`. |
| Pruning the watermark exclusion set | After the fix, no-closer sessions still occupy `spur_wm_exclude` rows that can never match. Accepted; see Design. |
### Acceptance Criteria
- **AC1 (R1)** — Given a session whose messages contain no turn closer (no non-meta assistant message without an open tool call), when `sessionWatermarks` runs, then the returned row is `state: 'in-progress'` with `watermarkSeq` equal to that session's max `seq` — never `-1` — and the anti-join excludes none of its messages.
- **AC2 (R1)** — Given a session that *does* have a turn closer followed by trailing messages, when the watermark runs, then `watermarkSeq` is still the closer's `seq` and the trailing messages are still excluded. The fix narrows only the no-evidence case.
- **AC3 (R1, R3)** — Given the pi shape (a source with zero `history_tool_call` rows whose sessions end on a non-assistant role), when analyze runs over it, then its messages survive the watermark. Measured against `.spur/spur.db`: `history analyze --source pi --json` today reports `totals.messages` **16,424** against `coverage[pi].messages` **209,393** and exactly **1** `bySession` entry; after the fix `totals.messages` approaches 209,393 and `bySession` returns more than one session. `coverage[pi].messages` is import-faithful and must stay 209,393 either way.
- **AC4 (R2)** — `packages/domain/src/analytics/watermark.ts` documents the fail-open invariant at the degrade rule, and the `-1` sentinel is gone from the production path.
- **AC5 (R3)** — In `packages/domain/tests/analytics/watermark.test.ts`, the test at line 167 (`a session with no assistant message at all (only a user prompt) is in-progress with watermark -1`) and the regression test at line 358 (`more than 1000 in-progress sessions prepare and run via the anti-join (depth regression)`) are both updated to the new invariant and pass; a new test covers the tool-call-less-source shape.
- **AC6 (R4)** — `bun run apps/cli/src/index.ts history analyze --source pi --json` exits 0 with no `Expression tree is too large` error, and the line-358 regression test passes.
- **AC7 (R1–R4)** — `bun run lint` clean (biome + all-workspace typecheck, exit 0); `packages/domain/tests/analytics/` and `packages/app/tests/services/history-service.test.ts` green with no skipped tests.
### Q&A
#### Corrections to the original P2 diagnosis (2026-08-17)

The P2 written from the dogfood run was wrong on both its premise and its cause. Measured against
`.spur/spur.db`:

| Original claim | Measured reality |
| --- | --- |
| "pi imports land under a single `session_id='unknown'` bucket" | pi has **176,792 distinct `session_id`s**; the `unknown` bucket holds 16,424 of 209,393 messages. The single-`unknown`-bucket source is **agy** (1 session, 58,670 messages) — wrong source. |
| "sessions end on user messages" | pi's last-message roles are `message`, `toolresult`, `custom_message` — pi **record types**, never `user`. |
| "the 0550 degrade rule over-marks sources with no tool-call rows" | True but not the cause. pi has 0 tool-call rows because its mapper never emits any; the degrade rule is the surface where the upstream defect becomes data loss. |
| Proposed fix (a) "treat `unknown` sessions as complete" | Would repair 16,424 of 209,393 rows (8%) and hard-code a sentinel. Rejected. |
| Proposed fix (c) "scope the watermark to sessions that actually have turn-closers" | Is what the rule already does — and is precisely the branch that drops everything. Rejected as stated. |

#### Scope decision (operator, 2026-08-17)

The real pi defect is upstream: `piSplit` in `@gobing-ai/ts-llm-jsonl-importer` never received the
event-envelope fix `ompSplit` got, so pi rows carry per-event session ids, `seq = 0`, record types
in `role`, no meta collapsing, null content on 96% of rows, and zero tool calls. That fix needs a
ts-libs release and a full pi re-import, so it is **split out to task 0577**.

This task stays Spur-side and fixes the defect that is Spur's own: a degrade rule that responds to
missing evidence by deleting data. The two are independent — 0576's guard is correct even after
0577 lands, and is what keeps the *next* unmapped source from silently vanishing.

#### P3 rejected — measurement artifact

The dogfood "aggregate cache hit rate 21% (< 50% floor)" is a `chars/4` heuristic the report itself
tags `[~estimate]`, confidence **LOW**, and `[unverifiable]`. It measures the dogfood harness's own
context reuse across five steps, not anything `history-load.ts` controls, and there is no baseline
to improve against. The original AC also allowed itself to pass by "explicitly deferring the P3",
which is an escape hatch rather than an acceptance criterion. Requirement and AC dropped; no
evidence of a defect in the wrapper.

#### Accepted constraint — `spur_wm_exclude` is a TEMP table

TEMP tables are per-connection in SQLite. This is safe because `BunSqliteAdapter` holds one
`Database` instance (`ts-db/dist/adapters/bun-sqlite.js:40`) and `analyze` is CLI-only
(`apps/cli/src/commands/history.ts:153`) — no Worker/D1 path reaches it. If analyze is ever exposed
through `apps/server`, the D1 adapter will need a real table or a bounded `IN` list instead.
### Design
**No new API.** No new exported type, function, flag, config key, or file. The production change is
one operand at `packages/domain/src/analytics/watermark.ts:153`:

```ts
// before — no closer means "exclude everything"
const watermarkSeq = complete ? row.maxSeq : (closerByKey.get(key) ?? -1);
// after  — no closer means "no evidence, exclude nothing"
const watermarkSeq = complete ? row.maxSeq : (closerByKey.get(key) ?? row.maxSeq);
```

**Frozen names** (already exist; do not rename): `SessionWatermark`, `SessionState`, `watermarkSeq`,
`sessionWatermarks`, `buildWatermarkFilter`, `materializeWatermarkExclude`, `spur_wm_exclude`,
`applyWatermarkToWhere`, and the artifact field `sessionState`.

#### Why here and not at the filter

`?? -1` is the single point where "we could not read this session's turn structure" becomes "drop
the session". Guarding in `buildWatermarkFilter` or in `HistoryService.analyze` would leave the
sentinel in the data and every other consumer of `SessionWatermark` still exposed. One operand, all
callers.

#### Why `state` stays `in-progress`

The state label and the exclusion boundary answer different questions. `state` is surfaced to
consumers as `sessionState` (`packages/domain/src/analytics/artifact.ts:107`) and means "this session
was still appending at import". The watermark means "trim here". A session with no closer is honestly
in-progress *and* has nothing safely trimmable — flipping it to `complete` would throw away a real
signal to fix an unrelated bug.

#### Anti-patterns — do not implement

- **Do not special-case `source = 'pi'`** or the `session_id = 'unknown'` sentinel. The defect is
  the no-evidence branch, not a source.
- **Do not add a "does this source have tool-call rows" query** to scope the guard. It costs an extra
  query and a second concept, and still fails closed for a source that emits some tool calls but no
  readable closers. The no-closer case *is* the no-evidence case.
- **Do not flip `state` to `'complete'`** to make the exclusion no-op. That destroys the
  `sessionState` signal consumers read.
- **Do not touch `coverage[*]`** — it is import-faithful by design (`history-service.ts:343`) and
  must keep reporting 209,393 for pi before and after.
- **Do not redesign the P1 anti-join.** It is implemented and verified; R4 only requires it lands
  intact.

#### Blast radius

Only sessions with zero turn closers change. A session that has a closer trims at it exactly as
before (AC2 pins this). The change can only ever *add* rows to an artifact, never remove them.
`bySession` is `LIMIT ?`-bounded (`forensic-query.ts:265`), so restoring 176k pi sessions does not
grow the artifact — it changes which top-N sessions appear and raises `totals` / `bySource` /
`daily` / `byModel` counts.

#### Accepted inefficiency

After the fix, no-closer sessions still get inserted into `spur_wm_exclude` (they are still
`state: 'in-progress'`) and are still probed per message, but `m.seq > watermark_seq` can never be
true for them. That is one index seek per message against dead rows. Measured cost of the same shape
before the fix: 4.2 s for the whole pi analyze. Pruning them would need `maxSeq` added to the
`SessionWatermark` interface — more surface than the win, and task 0577 collapses pi to ~1,500
sessions anyway. Leave it.

#### Boundary with task 0577

0576 and 0577 are independent; neither blocks the other and `dependencies[]` stays empty. 0576
assumes nothing from 0577 and must not anticipate it: this guard is correct both before and after
the mapper is fixed, and it is what keeps the *next* unmapped source from silently vanishing. 0577
owns everything upstream of `history_message` — mapper, session ids, roles, re-import. If 0577 lands
first, AC3's before-numbers will have moved; re-measure rather than assume them.

The P1 anti-join (R4) is already implemented in the working tree and is not redesigned here.
### Plan
- [ ] Re-measure the baseline before touching code — `history analyze --source pi --json`, recording `coverage[pi].messages`, `totals.messages`, and the `bySession` entry count (Background lists 209,393 / 16,424 / 1 as of 2026-08-17) (R1)
- [ ] Replace the `?? -1` fail-closed operand with `row.maxSeq` in `sessionWatermarks` (`watermark.ts:153`) (R1)
- [ ] Document the fail-open invariant in the `watermark.ts` policy docblock next to the degrade rule (R2)
- [ ] Update the line-167 `-1` test and the line-358 anti-join regression test to the new invariant (R3)
- [ ] Add a test for the tool-call-less source shape: zero `history_tool_call` rows, sessions ending on a non-assistant role, messages survive the filter (R3)
- [ ] Re-run `history analyze --source pi --json` and confirm `totals.messages` approaches `coverage[pi].messages` and `bySession` returns more than one session (R1)
- [ ] Confirm the anti-join, `materializeWatermarkExclude`, and the `analyze` materialize/drop pairing are intact and green (R4)
- [ ] `bun run lint` clean; `packages/domain/tests/analytics/` and `packages/app/tests/services/history-service.test.ts` green; re-review the diff (R1, R2, R3, R4)
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/services/history-service.ts:316` |
| `packages/app/src/services/history-service.ts:35` |
| `packages/app/src/services/history-service.ts:352` |
| `packages/domain/src/analytics/index.ts:108` |
| `packages/domain/src/analytics/watermark.ts:1` |
| `packages/domain/src/analytics/watermark.ts:160` |
| `packages/domain/src/analytics/watermark.ts:178` |
| `packages/domain/src/analytics/watermark.ts:190` |
| `packages/domain/src/analytics/watermark.ts:20` |
| `packages/domain/src/analytics/watermark.ts:238` |
| `packages/domain/src/analytics/watermark.ts:40` |
| `packages/domain/tests/analytics/watermark.test.ts:10` |
| `packages/domain/tests/analytics/watermark.test.ts:167` |
| `packages/domain/tests/analytics/watermark.test.ts:178` |
| `packages/domain/tests/analytics/watermark.test.ts:242` |
| `packages/domain/tests/analytics/watermark.test.ts:247` |
| `packages/domain/tests/analytics/watermark.test.ts:252` |
| `packages/domain/tests/analytics/watermark.test.ts:254` |
| `packages/domain/tests/analytics/watermark.test.ts:312` |
| `packages/domain/tests/analytics/watermark.test.ts:323` |
| `packages/domain/tests/analytics/watermark.test.ts:332` |
| `packages/domain/tests/analytics/watermark.test.ts:335` |
| `packages/domain/tests/analytics/watermark.test.ts:352` |
| `packages/domain/tests/analytics/watermark.test.ts:355` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — watermark never excludes an entire session; no-closer ⇒ in-progress + watermark = maxSeq; closer sessions unchanged | MET | `packages/domain/src/analytics/watermark.ts:157-160` operand `closerByKey.get(key) ?? row.maxSeq`; fail-open asserted at `packages/domain/tests/analytics/watermark.test.ts:167-187` (sess-d watermarkSeq 1, message survives) and `:398-435` (pi shape, all 4 messages survive); closer semantics untouched-green at `:125`, `:280`, `:339`. |
| R2 — fail-open invariant documented in policy docblock naming why | MET | `packages/domain/src/analytics/watermark.ts:20-25` "**Fail-open invariant (task 0576):**" paragraph; `SessionWatermark.watermarkSeq` field doc (`:30-37` region) rewritten; `grep '\-1' watermark.ts` returns nothing. |
| R3 — two legacy tests updated + new tool-call-less shape test | MET | `packages/domain/tests/analytics/watermark.test.ts:167` renamed to "(fail-open, 0576)"; depth-regression at `:365-392` updated (expected total 1202, fail-open comment); new pi-shape test at `:398-435`. All pass. |
| R4 — anti-join lands with this task; materialize/drop pairing green | MET | `buildWatermarkFilter` emits `NOT EXISTS` vs `spur_wm_exclude` (watermark.ts ~:188); `materializeWatermarkExclude` chunked INSERT + self-heal; `packages/app/src/services/history-service.ts:322` materialize → `:352` drop; depth-regression test (1200+ in-progress sessions) green; `history analyze --source pi` 7.6 s exit 0. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/domain/tests/analytics/watermark.test.ts:167-187`, `:398-435` — state in-progress, watermarkSeq = maxSeq, anti-join excludes nothing. |
| AC2 | MET | test | `packages/domain/tests/analytics/watermark.test.ts:125-141`, `:280-326`, `:339-364` — closer seq honored, trailing messages excluded; untouched and green. |
| AC3 | MET | command | `history analyze --source pi --json`: totals.messages **209,393** == coverage[pi].messages **209,393** (baseline 16,424); bySession **20** entries (baseline 1); exit 0. |
| AC4 | MET | command | `grep -n 'Fail-open invariant (task 0576)' packages/domain/src/analytics/watermark.ts` → line 20 (docblock present); `grep -n '\-1' packages/domain/src/analytics/watermark.ts` → exit 1, no matches (sentinel gone). Both run 2026-08-17. |
| AC5 | MET | test | Line-167 and depth-regression tests updated and passing (18/18 file-green); new pi-shape test added. |
| AC6 | MET | command | Analyze exit 0, no `Expression tree is too large` (7.56 s); depth-regression test green. |
| AC7 | MET | command | `bun run lint` exit 0 (biome 696 files + 7 typechecks); domain analytics 192/192; app history-service 31/31; full spur-check 5678/5678 incl. rules + shims + corpus. No skips. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Review (2026-08-17, pipeline review hop — three-dimensional, --auto) — Verdict: PASS, no findings.**


**Findings (P1–P4):**

| Priority | Finding | Status |
| --- | --- | --- |
| P1 | none | — |
| P2 | none | — |
| P3 | none | — |
| P4 | none | — |

**Functional traceability (all ACs evidenced):**
- AC1 — `packages/domain/src/analytics/watermark.ts:160` fail-open operand `closerByKey.get(key) ?? row.maxSeq`; tests at `packages/domain/tests/analytics/watermark.test.ts:167` (sess-d: state in-progress, watermarkSeq 1) and `:398` (pi shape: 2 sessions in-progress watermark 1, all 4 messages survive) prove no-message-exclusion.
- AC2 — narrowing only: closer-path tests at `:125`, `:280`, `:339` untouched and green (trailing partial turns still truncated after the closer).
- AC3 — measured after fix: `history analyze --source pi --json` → `totals.messages` **209,393** == `coverage[pi].messages` **209,393** (was 16,424); `bySession` **20** entries (was 1); exit 0, 7.6 s.
- AC4 — policy docblock fail-open invariant (`packages/domain/src/analytics/watermark.ts:20-25`) + `SessionWatermark.watermarkSeq` field doc rewritten; `grep '\-1' watermark.ts` → zero matches (sentinel gone from production path).
- AC5 — line-167 test renamed+reasserted; line-365 depth-regression updated (total 1202, fail-open comment); new pi-shape test at `:398`.
- AC6 — analyze exit 0, no `Expression tree is too large`; depth-regression test passes.
- AC7 — `bun run lint` (biome 696 files + 7 workspace typechecks) exit 0; domain analytics 192/192, app history-service 31/31, full suite 5678/5678 via spur-check; no skips.

**SECUA:**
- Security — no new input surface; `qualityGateCmd` untouched; temp table session-local, dropped after the batch (`packages/app/src/services/history-service.ts:322/352`).
- Efficiency — anti-join keeps constant expression depth and 0 bound params (P1, rides along); fail-open adds no-closer rows to `spur_wm_exclude` that can never match — accepted in task Design ("Accepted inefficiency"); pi analyze 7.6 s for 176k sessions.
- Correctness — invariant matches evidence semantics: no closer = no evidence of a trailing partial turn boundary; complete sessions byte-untouched.
- Usability — operator-visible `sessionState` still marks in-progress (consumer signal preserved); docs state the invariant at both policy and field level.
- Architecture — change localized to `sessionWatermarks` operand + docs; single materialize/drop call site; crash self-heal (CREATE IF NOT EXISTS + DELETE) unchanged.

**Architecture depth:** no new abstraction introduced; `materializeWatermarkExclude` export was pre-existing (P1). Diff is surgical: 1 operand, 2 doc blocks, 3 test edits.
### References
- Dogfood run: `docs/dogfood/2026-08-17-sp-dev-history-load-dogfood.md` (`20260817-historyload-103307`) — the source of P1/P2/P3.
- Testee: `plugins/sp/commands/dev-history-load.md` + `plugins/sp/scripts/history-load.ts`.
- Split-out upstream defect: **task 0577** — `piSplit` event-envelope fix in `@gobing-ai/ts-llm-jsonl-importer` + full pi re-import.
- Watermark policy this task amends: task 0550, `packages/domain/src/analytics/watermark.ts`.
- Coverage matrix contradicted by the measured pi data: task 0489 (corrected under 0577 R8).
- Consumer of `state`: `packages/domain/src/analytics/artifact.ts:107` (`sessionState`).
### History
- 2026-08-17T18:41:24.847Z backlog → todo (system)
- 2026-08-17T18:59:00.750Z todo → wip (system)
- 2026-08-17T19:05:11.210Z wip → testing (system)
- 2026-08-17T19:08:26.040Z testing → done (system)
