---
template: issue
schema_version: 1
name: "Sanitize sentinel timestamps out of the time-decomposition span math"
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
created_at: "2026-08-17T19:04:22.166Z"
updated_at: "2026-08-17T19:07:27.345Z"
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

<!-- Clarifications and triage decisions. Keep empty if none. -->

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
- [ ] Record the baseline: `analyze --source omp --json` → `derived.timeDecomposition` (spanMs ≈ 9.96e14) and the 558/917 poisoned-session split (R1)
- [ ] Exclude the epoch-0 sentinel from the `MIN(ts)`/`MAX(ts)` bounds in `sessionSpans` (`forensic-query.ts:402`), keeping the session's real rows (R1)
- [ ] Screen non-ISO `ts` values in the same query so they never reach `new Date(...)` (R2)
- [ ] Replace the `if (ms <= 0) continue` guard at `derived.ts:277` with a finiteness check and count exclusions (R2, R3)
- [ ] Surface the excluded-session count on the derived output alongside the existing unmeasured counters (R3)
- [ ] Confirm `unattributedMs` semantics and the `derived.ts:354-361` finding are unchanged for valid-span sessions (R4)
- [ ] Add the four tests: leading sentinel, all sentinel, epoch-millis string, clean session unchanged (R5)
- [ ] Re-run `analyze --source omp --json` and record spanMs ≈ 2.98e9 ms / 827 h with the excluded count (R1, R2, R3)
- [ ] `bun run lint` clean; domain-analytics and app-history suites green; re-review the diff (R5)
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Source analysis: `docs/design/sqlite-forensics-token-time-per-step.md` § 3 (I1) and § 4 (F1).
- Edit sites: `packages/domain/src/analytics/derived.ts:259-298` (`decompositionMetric`), `:276-277` (the guard), `:301-308` (bottleneck ranking consumer), `:354-361` (the unattributed finding); `packages/domain/src/analytics/forensic-query.ts:402` (`sessionSpans`).
- Upstream half (stop writing the sentinel; normalize pi timestamps): task **0580**, with **0577** for pi's other mapper defects.
- Independent siblings: **0578** (release + re-import), **0581** (per-step artifact sections).
- Derived-variable mechanism decision: task **0490**, task **0554** (in-analyze metric registry).
### History
