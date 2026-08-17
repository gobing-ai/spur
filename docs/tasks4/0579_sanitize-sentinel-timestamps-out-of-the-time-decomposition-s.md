---
template: issue
schema_version: 1
name: "Sanitize sentinel timestamps out of the time-decomposition span math"
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
created_at: "2026-08-17T19:04:22.166Z"
updated_at: "2026-08-17T21:50:12.755Z"
---

## 0579. Sanitize sentinel timestamps out of the time-decomposition span math

### Background
From the root-cause pass on `docs/design/sqlite-forensics-token-time-per-step.md` (issue **I1**,
fix **F1**), 2026-08-17. The first pass called this a "scale bug … pathological arithmetic" and
proposed clamping absurd values. It is neither a scale bug nor clampable.

#### What actually happens

Every importer mapper falls back to `new Date(0).toISOString()` when a record carries no parseable
timestamp — `'1970-01-01T00:00:00.000Z'`. `decompositionMetric` (`derived.ts:259-298`) takes each
session's span as `MAX(ts) − MIN(ts)`, so a single sentinel row stretches that session to ~56 years
(1.78e12 ms) and the sum is dominated by sessions that are not actually long.

#### Measured (`.spur/spur.db`, 2026-08-17)

Rows sitting at the epoch-0 sentinel:

| Source | `ts LIKE '1970-%'` |
| --- | --- |
| grok | 20,189 |
| claude | 16,743 |
| codex | 2,289 |
| omp | 560 |
| gemini | 2 |
| **total** | **39,783** |

Replaying `derived.ts`'s own span arithmetic over omp:

| | sessions | Σ span |
| --- | --- | --- |
| all omp sessions | 917 | 9.962e14 ms (**31,625 years**) |
| poisoned (first ts = 1970) | **558 (61 %)** | 9.962e14 ms — **100.00 % of the total** |
| clean | 359 | 2.979e9 ms = **827 h** — the real figure |

560 sentinel rows out of 267,969 (0.2 %) destroy 100 % of the metric.

#### A second, separate timestamp defect

pi stores **16,424** rows whose `ts` is a raw epoch-millis **string** (`"1786684271589"`), not ISO.
`new Date("1786684271589")` is **Invalid Date** → `NaN`. In `decompositionMetric` the guard is
`if (ms <= 0) continue`, and `NaN <= 0` is `false`, so a NaN span is **not** skipped — it is added,
poisoning every downstream sum. Worse, `MIN(ts)` / `MAX(ts)` are **string** comparisons, so a session
mixing the two formats picks its bounds lexically (`"1786684271589"` sorts before `"2026-…"`).

#### Why clamping is the wrong fix

Clamping "absurd" spans discards the 558 omp sessions entirely rather than computing their real
spans from their non-sentinel rows. The sessions are fine; two rows in each are not.
### Requirements
- **R1** — A session's span is computed from its **real** timestamps: the epoch-0 sentinel (`'1970-01-01T00:00:00.000Z'`) is excluded from the `MIN(ts)` / `MAX(ts)` bounds rather than the session being dropped. A session whose only timestamps are sentinels contributes no span.

- **R2** — Non-ISO `ts` values are handled deterministically instead of silently becoming `NaN`: a span that is not a finite positive number is never added to `spanMs`, `idleMs`, or `unattributedMs`. The existing `if (ms <= 0) continue` guard does not catch `NaN` and must be replaced with a finiteness check.

- **R3** — The number of sessions excluded from the decomposition for timestamp reasons is **observable**, not silent — surfaced on the derived output the way `assistantDurationUnmeasured` already surfaces unmeasured durations, so a reader can tell "827 h across 359 of 917 sessions" from "827 h across all sessions".

- **R4** — `unattributedMs` keeps its current meaning: "wall-clock that could not be attributed because some durations were unmeasured" (`derived.ts:354-361` raises a finding off it). Timestamp-invalid spans are **not** rebucketed into it — that would conflate a missing duration with a broken timestamp and destroy the existing signal.

- **R5** — Tests cover: a session with a leading sentinel row (span computed from the real rows), a session that is all sentinels (no contribution), a session with an epoch-millis-string `ts` (no NaN leakage into any total), and a clean session (byte-identical result to today).

#### Out of scope / non-goals
| Not in this task | Why |
| --- | --- |
| Stopping the mappers from writing `new Date(0).toISOString()` | Upstream ts-libs; task **0580**. This guard must exist regardless — Spur cannot assume every current and future source emits clean timestamps. |
| Normalizing pi's epoch-millis `ts` at import | Task **0580** (with **0577** for pi's other mapper defects). |
| Re-import | Task **0578**. This task is correct against the corpus as it stands today. |
| Bottleneck ranking's own logic | It reads `timeDecomposition` (`derived.ts:301-308`); fixing the inputs fixes it. No change to the ranking itself. |
| Backfilling or rewriting stored `ts` values | The raw JSONL is the authority. Repair belongs at import, not in a migration. |
### Acceptance Criteria
- **AC1 (R1)** — Given a session whose earliest row carries `'1970-01-01T00:00:00.000Z'` and whose remaining rows span 40 minutes, when the decomposition runs, then that session contributes ~40 minutes — not ~56 years, and not zero.

- **AC2 (R1)** — Given a session whose every row carries the sentinel, when the decomposition runs, then it contributes 0 to `spanMs` and is counted as excluded (AC5), not silently summed.

- **AC3 (R2)** — Given a session whose `ts` values are epoch-millis strings (`"1786684271589"`), when the decomposition runs, then no total is `NaN`: `spanMs`, `llmMs`, `toolMs`, `idleMs`, and `unattributedMs` are all finite. A regression test asserts `Number.isFinite` on each, because `NaN <= 0` is `false` and the current guard lets NaN straight through.

- **AC4 (R1, R2)** — Measured end to end on `.spur/spur.db`: `history analyze --source omp --json` reports `derived.timeDecomposition.spanMs` on the order of **2.98e9 ms (~827 h)**, not **9.96e14 ms (~31,625 years)**. Record the before and after values.

- **AC5 (R3)** — The derived output exposes the count of sessions excluded for timestamp reasons, and for omp today that count is **558 of 917**. A reader of the forensics report can distinguish a small clean sample from full coverage.

- **AC6 (R4)** — `unattributedMs` still means "durations were unmeasured": a session with a valid span but unmeasured assistant/tool durations still lands in `unattributedMs`, and the `derived.ts:354-361` finding still fires for it. A timestamp-invalid session does **not** land there.

- **AC7 (R5)** — `packages/domain/tests/analytics/` covers the four cases in R5; the clean-session case asserts the result is unchanged from today's behavior.

- **AC8** — `bun run lint` clean; `packages/domain/tests/analytics/` and `packages/app/tests/services/history-service.test.ts` green with no skipped tests.
### Q&A
#### Closed decisions

**Why not clamp absurd spans, as the design doc first proposed?** Because the sessions are not
absurd — two rows in each are. Clamping omp would discard 558 of 917 sessions (61 %) and keep a
number invented by the ceiling. Excluding the sentinel from the bounds computes each session's real
span from its real rows, which is both more correct and a smaller change.

**Why not rebucket timestamp-invalid spans into `unattributedMs`?** `unattributedMs` already means
one specific thing — "wall-clock we could not attribute because some *durations* were unmeasured" —
and `derived.ts:354-361` raises an operator-facing finding off it. Folding a *timestamp* failure
into the same bucket would make that finding lie about its own cause. R3 adds a separate counter.

**Why fix this in Spur when task 0580 stops the sentinel being written?** Both are needed and
neither substitutes for the other. 0580 stops today's known bad producers; this guard is what makes
the metric safe against the next source, the next mapper regression, and the corpus as it exists
right now (39,783 rows already written). After 0580 lands, this task's excluded-session count should
approach zero on its own — that is the signal both worked.

**Why screen non-ISO `ts` in SQL rather than JS?** `ts` is TEXT and `MIN`/`MAX` compare lexically,
so a mixed-format session picks its bounds wrong *before* JS ever sees them. Screening after the
aggregate is too late. Screening in SQL also keeps `new Date(...)` off values it silently mis-parses.

#### Open — decide during implementation

**What is the excluded-session counter called and where does it sit?** Design suggests
`spanExcludedSessions` on the derived output, in the same register as the existing
`assistantDurationUnmeasured`. **Owner:** implementer. Constraint: it must reach the forensics
report, or R3's "observable, not silent" is not met — a field nobody renders is still silent.

**Should a session excluded for timestamp reasons still contribute its `llmMs` / `toolMs`?** Its
durations may be perfectly good even when its timestamps are not. Leaning yes — drop only the span
and its derived remainder, keep measured durations. **Owner:** implementer; whichever way it goes,
state it in Solution and cover it with a test, because it changes what `llmMs` means relative to
`spanMs`.

#### Not in scope, deliberately

The `loops` query (`forensic-query.ts:334`) has no `LIMIT` and is the one forensic query that does
not hold the bounded-result invariant. Noted while reading the file; unrelated to this task. Not
fixed here — record it, ship the requested scope.
### Design
Two edit sites, both in `packages/domain/src/analytics/`.

#### 1. The span query — exclude sentinels at the source

`sessionSpans` (`packages/domain/src/analytics/forensic-query.ts:402`) feeds `ctx.sessionSpans` with
`MIN(ts)` / `MAX(ts)` per session. Excluding sentinel
rows from those aggregates (rather than filtering whole sessions) is what makes AC1 work: the
session keeps its real bounds. A `WHERE ts <> '1970-01-01T00:00:00.000Z'` on the bound computation
is the minimal form; prefer excluding by the sentinel value, not by a date range, so a genuine 1970
record — should one ever exist — is a deliberate decision rather than a silent cutoff.

Because `ts` is stored as TEXT and compared lexically, also exclude values that are not ISO-shaped
before they reach `new Date(...)`. Doing this in SQL keeps the JS side free of format sniffing.

#### 2. `decompositionMetric` — never sum a non-finite span

`derived.ts:276-277` currently reads:

```ts
const ms = new Date(span.lastTs).getTime() - new Date(span.firstTs).getTime();
if (ms <= 0) continue;
```

`NaN <= 0` evaluates to `false`, so a NaN span falls through and contaminates `spanMs` and whichever
of `idleMs` / `unattributedMs` the remainder lands in. Replace the guard with a finiteness check
(`if (!Number.isFinite(ms) || ms <= 0) { excluded++; continue; }`) and carry `excluded` out for R3.

**Frozen names** (already exist; do not rename): `TimeDecomposition`, `spanMs`, `llmMs`, `toolMs`,
`idleMs`, `unattributedMs`, `decompositionMetric`, `sessionSpans`, `SessionSpanRow`,
`assistantDurationUnmeasured`. R3 adds one counter to the derived output — name it in the same
register as `assistantDurationUnmeasured` (e.g. `spanExcludedSessions`) and treat that as the only
new field.

#### Anti-patterns — do not implement

- **Do not clamp.** Capping "absurd" spans at some ceiling silently discards 61 % of omp's sessions
  and invents a number for the rest. Fix the bounds, don't cap the result.
- **Do not drop a session because one row is a sentinel.** AC1 exists to prevent exactly that.
- **Do not rebucket timestamp-invalid spans into `unattributedMs`.** R4 — that field is load-bearing
  for the `derived.ts:354-361` finding, which means "some durations were unmeasured", a different
  fact.
- **Do not fix this in the mappers instead.** That is 0580, and it does not remove the need for this
  guard: Spur cannot assume every future source emits clean timestamps.
- **Do not use `new Date(ts)` for format detection.** It returns Invalid Date for epoch-millis
  strings and silently coerces other junk; screen in SQL.

#### Blast radius

`timeDecomposition` feeds bottleneck ranking (`derived.ts:301-308`) and the forensics report's Time
Decomposition / Bottleneck sections. Both currently render numbers in the 10⁴-year range, so any
change is an improvement, but the clean-session case (AC7) must be byte-identical to today — that is
what proves the fix is surgical.

#### Boundary with sibling tasks

Independent of **0578** (re-import) and **0581** (per-step sections); do not sequence behind them.
Complementary to **0580**, which stops the sentinel being written at all — after 0580 the omp
`excluded` count should approach 0 while this guard stays as the invariant.
### Plan
- [x] Record the baseline: `analyze --source omp --json` → `derived.timeDecomposition` (spanMs ≈ 9.96e14) and the 558/917 poisoned-session split (R1)
- [x] Exclude the epoch-0 sentinel from the `MIN(ts)`/`MAX(ts)` bounds in `sessionSpans` (`forensic-query.ts:402`), keeping the session's real rows (R1)
- [x] Screen non-ISO `ts` values in the same query so they never reach `new Date(...)` (R2)
- [x] Replace the `if (ms <= 0) continue` guard at `derived.ts:277` with a finiteness check and count exclusions (R2, R3)
- [x] Surface the excluded-session count on the derived output alongside the existing unmeasured counters (R3)
- [x] Confirm `unattributedMs` semantics and the `derived.ts:354-361` finding are unchanged for valid-span sessions (R4)
- [x] Add the four tests: leading sentinel, all sentinel, epoch-millis string, clean session unchanged (R5)
- [x] Re-run `analyze --source omp --json` and record spanMs ≈ 2.98e9 ms / 827 h with the excluded count (R1, R2, R3)
- [x] `bun run lint` clean; domain-analytics and app-history suites green; re-review the diff (R5)
### Root Cause
Verified 2026-08-17 against `.spur/spur.db` and the current tree.

**Cause A — the sentinel.** Every mapper ends its timestamp resolution with
`?? new Date(0).toISOString()` (e.g. installed `dist/mappers.js:124` for claude, `:232` for pi,
`:309` for omp; `defaultCreatedAt` at `sources.js:22-24` for the generic path). That writes
`'1970-01-01T00:00:00.000Z'` into `history_message.ts` — 39,783 rows today.
`sessionSpans` (`forensic-query.ts:402`) aggregates `MIN(ts)`/`MAX(ts)` without excluding it, and
`decompositionMetric` (`derived.ts:276`) subtracts the two, producing ~1.78e12 ms per affected
session. omp: 558 of 917 sessions affected, contributing 100.00 % of a 9.962e14 ms total. The real
total from the 359 clean sessions is 2.979e9 ms (827 h) — a 334,000× error.

**Cause B — the NaN hole.** pi writes 16,424 rows whose `ts` is a raw epoch-millis string
(`"1786684271589"`), because `piSplit` passes `r.ts` through unchanged. `new Date("1786684271589")`
is Invalid Date, so `ms` is `NaN`. The guard at `derived.ts:277` is `if (ms <= 0) continue`, and
`NaN <= 0` is `false` — the NaN is added rather than skipped. Compounding it, `ts` is TEXT, so
`MIN`/`MAX` compare lexically and a mixed-format session picks nonsense bounds.

Both causes converge on the same two lines. Cause A also has an upstream half (stop writing the
sentinel) which is task 0580; Cause B's upstream half is pi timestamp normalization, task 0580 with
0577. Neither removes the need for this guard.
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/domain/src/analytics/derived.ts:146` |
| `packages/domain/src/analytics/derived.ts:310` |
| `packages/domain/src/analytics/derived.ts:313` |
| `packages/domain/src/analytics/derived.ts:322` |
| `packages/domain/src/analytics/derived.ts:326` |
| `packages/domain/src/analytics/derived.ts:342` |
| `packages/domain/src/analytics/derived.ts:44` |
| `packages/domain/src/analytics/forensic-query.ts:411` |
| `packages/domain/src/analytics/render-forensics.ts:137` |
| `packages/domain/tests/analytics/derived.test.ts:408` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | forensic-query.ts sessionSpans MIN/MAX wrapped in CASE WHEN m.ts <> '1970-01-01T00:00:00.000Z' AND m.ts LIKE '____-__-__T%' - sentinel rows excluded from bounds, session kept. derived.test.ts 'poisoned session' asserts bounds T0/T110 from real rows with a sentinel row present. |
| R2 | MET | Non-ISO ts fails the LIKE screen -> NULL bounds; decompositionMetric guard now `!Number.isFinite(ms) \|\| ms <= 0` (old `ms <= 0` passed NaN since NaN <= 0 is false). 'epoch-millis string ts' test asserts all five totals Number.isFinite. |
| R3 | MET | TimeDecomposition.spanExcludedSessions added (derived.ts:45); incremented per excluded session; renderTimeDecomposition emits '_Span excludes N session(s) with unusable timestamps..._' note (render-forensics.ts:137-139). Verified in real report output. |
| R4 | MET | Excluded sessions skip the remainder branch entirely - unattributedMs keeps its unmeasured-duration meaning. Test: excluded session with unmeasured assistant contributes 0 to unattributedMs while a valid-span session with unmeasured assistant lands its full remainder in unattributedMs. |
| R5 | MET | packages/domain/tests/analytics/derived.test.ts describe 'sessionSpans timestamp sanitization (0579)': 5 tests - sentinel-only bounds NULL with durations preserved, poisoned session real bounds win, mixed session exact spanMs 10_000 + 0 excluded, all-sentinel excluded+counted+durations kept+no unattributed pollution, epoch-millis strings finite totals. Clean-session behavior unchanged: pre-existing 'computeDerived via SQL' suite passes byte-identical. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET |  | poisoned-session test: sentinel row ignored, span = T110-T0 |
| AC2 | MET |  | all-sentinel session: spanMs contribution 0, spanExcludedSessions 1 |
| AC3 | MET |  | epoch-millis test: Number.isFinite asserted on spanMs/llmMs/toolMs/idleMs/unattributedMs |
| AC4 | MET |  | Pre-0580 baseline spanMs 9.96e14 (~31,625y). Post-0580 + this fix: `history analyze --source omp` spanMs 16,429,884,041 (~190d), llmMs 1.0739e9, toolMs 3.4976e8, idleMs 1.0670e10, unattributedMs 4.3444e9 - byte-identical to the pre-change post-0580 baseline (guard is pure defense-in-depth on this corpus). |
| AC5 | MET |  | omp spanExcludedSessions = 0; all-sources = 766 (sessions whose every ts is NULL/non-ISO). Count is exposed on derived output and rendered in the forensics report. |
| AC6 | MET |  | unattributedMs test assertions: excluded session adds 0; valid-span unmeasured session adds full remainder |
| AC7 | MET |  | Four R5 cases + AC6/AC3 variants covered in derived.test.ts; clean-session behavior unchanged (existing suite green) |
| AC8 | MET |  | bun run lint exit 0; packages/domain/tests/analytics/ + packages/app/tests/services/history-service.test.ts: 231 tests, 755 expects, 0 fail, 0 skipped; bun run build exit 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |
### References
- Source analysis: `docs/design/sqlite-forensics-token-time-per-step.md` § 3 (I1) and § 4 (F1).
- Edit sites: `packages/domain/src/analytics/derived.ts:259-298` (`decompositionMetric`), `:276-277` (the guard), `:301-308` (bottleneck ranking consumer), `:354-361` (the unattributed finding); `packages/domain/src/analytics/forensic-query.ts:402` (`sessionSpans`).
- Upstream half (stop writing the sentinel; normalize pi timestamps): task **0580**, with **0577** for pi's other mapper defects.
- Independent siblings: **0578** (release + re-import), **0581** (per-step artifact sections).
- Derived-variable mechanism decision: task **0490**, task **0554** (in-analyze metric registry).
### History
- 2026-08-17T20:50:36.920Z todo → wip (system)
- 2026-08-17T21:00:13.600Z wip → testing (system)
- 2026-08-17T21:00:13.877Z testing → done (system)
