---
template: feature-impl
schema_version: 1
name: "Watermark live sessions and report refresh coverage honestly"
description: ""
status: done
type: task
profile: standard
feature_id: E3
parent_wbs: null
priority: P2
tags: []
dependencies: ["0549"]
ac_numbering: task-local
created_at: "2026-08-14T00:48:40.978Z"
updated_at: "2026-08-15T05:49:58.771Z"
---

## 0550. Watermark live sessions and report refresh coverage honestly

### Background
Triggering a refresh on work completion means importing sessions that are **still being written** —
that is the normal case, not an edge case, because the agent that just completed a task is usually
still running.

E1 verified that incremental import *resumes* correctly against real append-only growth
(`history_import_checkpoint` / `history_import_ledger`). That is a different guarantee from: *does
`analyze` produce correct derived values over a session that is only half present?* Nobody has asked
the second question, and it is the one that matters once the trigger fires mid-session.

The second half of this task is honesty about coverage. Six sources import at full fidelity (claude,
codex, pi, omp, agy, grok); five are unsupported by operator ruling 2026-08-06 (gemini, opencode,
antigravity-ide, openclaw, hermes). A refresh that reports success without saying what it skipped
invites the reader to assume completeness.
### Requirements
- [x] **R1.** Define and implement a watermark policy for still-appending sessions: `analyze` computes
      derived values only up to a defensible boundary (the last complete turn), and a session past
      that boundary is marked in progress rather than final. Measurable: analyzing a session file
      that grows between two refreshes yields values consistent with the completed portion at each
      point, and never values derived from a partial turn.
- [x] **R2.** An in-progress session is distinguishable from a finished one in the analyze output, so
      a consumer can choose to exclude it. Measurable: the result marks each session's completeness
      state, and a consumer filtering on it gets only finished sessions.
- [x] **R3.** A refresh reports which sources it refreshed and which it skipped as unsupported,
      rather than reporting bare success. Measurable: the refresh result enumerates refreshed and
      skipped sources by name.
- [x] **R4.** A refresh states the window it covered, so a consumer can tell current data from stale.
      Measurable: the result carries the covered window, and a consumer reading it can determine
      recency without inspecting the database.
- [x] **R5.** Re-analyzing a session after it completes supersedes the in-progress result rather than
      duplicating it. A session analyzed three times while running and once after must contribute one
      final set of derived values. Measurable: repeated refreshes over a growing session leave one
      final record, not four.
### Acceptance Criteria
Covers feature E3 scenarios:

- **R4 — A still-appending session is not analyzed as complete**
- **R5 — A refresh reports its coverage**

```gherkin
Scenario: R4 — A still-appending session is not analyzed as complete
  Given a session file that is still being written by a running agent
  When a refresh imports and analyzes it
  Then derived values are computed only up to the watermark the policy defines
  And the result marks that session as still in progress rather than final

Scenario: R5 — A refresh reports its coverage
  Given sources at full fidelity and sources with no support
  When a refresh completes
  Then it reports which sources were refreshed and which were skipped as unsupported
  And it states the window covered
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **What is the watermark?** The last complete turn — the unit the importer already models. Where
  "complete" is ambiguous for a source, exclude the trailing turn rather than guess.
- **Is import resumption in scope?** No — feature E1 already verified it against real append-only
  growth. This task addresses *analyze* correctness over a partial session, a different guarantee.
- **Does a growing session leave multiple records?** No (R5). Key by session and supersede; otherwise
  aggregates inflate in proportion to trigger frequency.
- **Are in-progress sessions excluded from analyze?** No — they are *marked* (R2). Consumers choose.

**Deferred with owner.**

- **Adding source support for the five unsupported sources** — owner: operator (2026-08-06 ruling).
- **History-row pruning** — owner: feature E2's retention note; `daily` prunes reports only, and the
  allowlist ruling bounds growth at ~18 KB/session, so pressure is minimal.
### Design
**Import resumption and analyze correctness are different guarantees.** E1 verified the first. This
task addresses the second, and must not assume the first covers it. The failure mode is quiet: a
partial turn yields a derived value that is *plausible* and wrong, and the next refresh silently
replaces it with a different plausible value.

**Last complete turn is the natural watermark (R1).** A turn is the unit the importer already models;
deriving anything from a half-written turn is the fabrication risk. Where "complete" is ambiguous for
a source, prefer excluding the trailing turn over guessing — consistent with the never-fabricate
invariant already established at `packages/domain/src/analytics/run-cost.ts:240`.

**In-progress is a state, not an error (R2).** Most sessions a triggered refresh sees will be live.
The output should let a consumer choose: a dashboard may want everything including partials, while
token attribution (task 0547) may want only finished sessions. Mark it; do not decide for them.

**Supersede, do not accumulate (R5).** A session analyzed on every refresh while it runs must not
leave four partial records that a consumer sums. Key derived values by session and replace, so the
final analysis wins. Getting this wrong inflates every aggregate built on top, and does so in
proportion to how often the trigger fires — meaning the more useful the trigger is, the worse the
corruption.

**Coverage is part of the result (R3/R4).** Report refreshed and skipped sources by name and the
covered window. The five unsupported sources are an operator ruling, not a bug, and saying so is what
keeps a reader from assuming completeness.

**Not in scope:** adding source support (E1 § Out of scope), changing the ETL contract or the analyze
query set, and anything built on the refreshed data (feature E2).

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Watermark unit | last **complete turn** (the unit the importer already models) | — |
| Session state | `sessionState: 'in-progress' \| 'complete'` on analyze output | new, additive |
| Coverage report | `{ refreshed: string[], skipped: string[], window: { since, until } }` | new, on the refresh result |
| Checkpoint tables (unchanged) | `history_import_checkpoint` · `history_import_ledger` | feature E1 |
| Never-fabricate precedent | absent ≠ zero | `packages/domain/src/analytics/run-cost.ts:240-241` |
| Full-fidelity sources | `claude` · `codex` · `pi` · `omp` · `agy` · `grok` | feature E1 § In |
| Unsupported sources | `gemini` · `opencode` · `antigravity-ide` · `openclaw` · `hermes` | feature E1 § Out of scope |

**No schema change.** Session state and coverage are analyze/refresh output, not new columns.

#### Anti-patterns — what not to implement

- Do **not** derive values from a partial turn. A half-written turn yields a *plausible* wrong number
  that the next refresh silently replaces with a different plausible number.
- Do **not** accumulate one record per refresh for a growing session (R5). Key by session and replace;
  otherwise every aggregate inflates **in proportion to how often the trigger fires** — the more
  useful the trigger, the worse the corruption.
- Do **not** decide for consumers whether to include in-progress sessions. Mark the state (R2) and let
  them filter; a dashboard may want partials, token attribution may not.
- Do **not** report bare success without naming skipped sources (R3) — that invites the reader to
  assume completeness.
- Do **not** re-verify import resumption. Feature E1 already verified it against real append-only
  growth; this task is about analyze correctness, a different guarantee.

#### Cross-task contract

**Assumes from 0549:** a refresh that fires on work completion, which is what makes mid-session
analysis routine rather than exceptional.

**Leaves for dependents:** task **0547** (feature J6, batch 2) can filter on `sessionState` to exclude
in-progress sessions from token totals. This task defines the state; 0547 chooses how to use it.
### Plan
- [x] Define the watermark as the last complete turn and document the per-source ambiguity rule (R1)
- [x] Compute derived values only up to the watermark; never from a partial turn (R1)
- [x] Mark each session's completeness state in the analyze output (R2)
- [x] Supersede an in-progress result when the session is re-analyzed after completion (R5)
- [x] Report refreshed and skipped sources by name in the refresh result (R3)
- [x] Report the covered window in the refresh result (R4)
- [x] Add tests: growing-session watermark, in-progress filtering, supersede-not-duplicate, coverage reporting (R1-R5)
- [x] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/history.ts:371` |
| `apps/cli/tests/commands/history.test.ts:561` |
| `apps/cli/tests/commands/history.test.ts:598` |
| `packages/app/src/services/history-refresh-service.ts:175` |
| `packages/app/src/services/history-service.ts:147` |
| `packages/app/src/services/history-service.ts:169` |
| `packages/app/src/services/history-service.ts:18` |
| `packages/app/src/services/history-service.ts:201` |
| `packages/app/src/services/history-service.ts:25` |
| `packages/app/src/services/history-service.ts:298` |
| `packages/app/src/services/history-service.ts:307` |
| `packages/app/src/services/history-service.ts:315` |
| `packages/app/src/services/history-service.ts:347` |
| `packages/app/src/services/history-service.ts:37` |
| `packages/app/src/services/history-service.ts:383` |
| `packages/app/src/services/history-service.ts:42` |
| `packages/app/src/services/history-service.ts:437` |
| `packages/app/src/services/history-service.ts:468` |
| `packages/app/tests/services/history-service.test.ts:1` |
| `packages/app/tests/services/history-service.test.ts:278` |
| `packages/app/tests/services/history-service.test.ts:299` |
| `packages/app/tests/services/history-service.test.ts:51` |
| `packages/app/tests/services/history-service.test.ts:66` |
| `packages/app/tests/services/history-service.test.ts:800` |
| `packages/domain/src/analytics/artifact.ts:102` |
| `packages/domain/src/analytics/artifact.ts:5` |
| `packages/domain/src/analytics/forensic-query.ts:102` |
| `packages/domain/src/analytics/forensic-query.ts:105` |
| `packages/domain/src/analytics/forensic-query.ts:112` |
| `packages/domain/src/analytics/forensic-query.ts:116` |
| `packages/domain/src/analytics/forensic-query.ts:120` |
| `packages/domain/src/analytics/forensic-query.ts:124` |
| `packages/domain/src/analytics/forensic-query.ts:131` |
| `packages/domain/src/analytics/forensic-query.ts:136` |
| `packages/domain/src/analytics/forensic-query.ts:140` |
| `packages/domain/src/analytics/forensic-query.ts:155` |
| `packages/domain/src/analytics/forensic-query.ts:161` |
| `packages/domain/src/analytics/forensic-query.ts:174` |
| `packages/domain/src/analytics/forensic-query.ts:177` |
| `packages/domain/src/analytics/forensic-query.ts:182` |
| `packages/domain/src/analytics/forensic-query.ts:188` |
| `packages/domain/src/analytics/forensic-query.ts:196` |
| `packages/domain/src/analytics/forensic-query.ts:199` |
| `packages/domain/src/analytics/forensic-query.ts:204` |
| `packages/domain/src/analytics/forensic-query.ts:211` |
| `packages/domain/src/analytics/forensic-query.ts:223` |
| `packages/domain/src/analytics/forensic-query.ts:228` |
| `packages/domain/src/analytics/forensic-query.ts:234` |
| `packages/domain/src/analytics/forensic-query.ts:241` |
| `packages/domain/src/analytics/forensic-query.ts:262` |
| `packages/domain/src/analytics/forensic-query.ts:267` |
| `packages/domain/src/analytics/forensic-query.ts:283` |
| `packages/domain/src/analytics/forensic-query.ts:286` |
| `packages/domain/src/analytics/forensic-query.ts:334` |
| `packages/domain/src/analytics/forensic-query.ts:336` |
| `packages/domain/src/analytics/forensic-query.ts:351` |
| `packages/domain/src/analytics/forensic-query.ts:356` |
| `packages/domain/src/analytics/forensic-query.ts:358` |
| `packages/domain/src/analytics/forensic-query.ts:367` |
| `packages/domain/src/analytics/forensic-query.ts:4` |
| `packages/domain/src/analytics/forensic-query.ts:402` |
| `packages/domain/src/analytics/forensic-query.ts:408` |
| `packages/domain/src/analytics/forensic-query.ts:416` |
| `packages/domain/src/analytics/forensic-query.ts:419` |
| `packages/domain/src/analytics/forensic-query.ts:424` |
| `packages/domain/src/analytics/forensic-query.ts:430` |
| `packages/domain/src/analytics/forensic-query.ts:437` |
| `packages/domain/src/analytics/forensic-query.ts:440` |
| `packages/domain/src/analytics/forensic-query.ts:448` |
| `packages/domain/src/analytics/forensic-query.ts:455` |
| `packages/domain/src/analytics/forensic-query.ts:458` |
| `packages/domain/src/analytics/forensic-query.ts:470` |
| `packages/domain/src/analytics/index.ts:88` |
### Testing
**Re-verify 2026-08-15** (`/sp-dev-verifyall --feature E3 --force --fix all`). Status guard bypassed with `--force` (task already `done`). `--next: no-op — task already terminal (done)`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/domain/src/analytics/watermark.ts:145-158` — completeness = last non-meta message is assistant-like with no open tool call (`EXISTS` against `history_tool_call` at `packages/domain/src/analytics/watermark.ts:101`); trailing partial turn excluded via `buildWatermarkFilter` (`packages/domain/src/analytics/watermark.ts:169-178`). Tests this run (16 pass / 0 fail): `packages/domain/tests/analytics/watermark.test.ts:96` (user-final in-progress), `packages/domain/tests/analytics/watermark.test.ts:181` (role=unknown regression), `packages/domain/tests/analytics/watermark.test.ts:267` (growing session totals 30 not 80), `packages/domain/tests/analytics/watermark.test.ts:334` (`sessionSpans` exclude partial turn). `packages/domain/src/analytics/watermark.ts` 100% line/func coverage this run. |
| R2 | MET | `packages/domain/src/analytics/artifact.ts:106` — additive `sessionState?: SessionState` on `SessionStat`; wired at `packages/app/src/services/history-service.ts:383` (absent ⇒ `'complete'` fallback). Tests this run (0 fail): `packages/app/tests/services/history-service.test.ts:327` (in-progress mark + partial excluded), `packages/app/tests/services/history-service.test.ts:370` (complete mark). |
| R3 | MET | `packages/app/src/services/history-service.ts:221-230` — `buildRefreshCoverage` reports `refreshed` (full-fidelity, non-failed) and `skipped` (five unsupported); on `DailyResult.coverage` (`packages/app/src/services/history-service.ts:173`). CLI prints it `apps/cli/src/commands/history.ts:372`. Test this run (0 fail): `packages/app/tests/services/history-service.test.ts:830` (6 refreshed vs 5 skipped by name). |
| R4 | MET | `coverage.window` = MIN/MAX message ts via `dataWindow` (`packages/domain/src/analytics/watermark.ts:196-206`), assembled at `packages/app/src/services/history-service.ts:228-229`. Tests this run (0 fail): `packages/app/tests/services/history-service.test.ts:830` (window asserted), `packages/domain/tests/analytics/watermark.test.ts` dataWindow cases. |
| R5 | MET | One `bySession` record per session rebuilt from DB each analyze; artifact overwrite + `latest.json` pointer at `packages/app/src/services/history-service.ts:779-795`. Test this run (0 fail): `packages/app/tests/services/history-service.test.ts:404` — analyzes while running + one after ⇒ ONE complete record (4 messages), never four partials. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R4 — A still-appending session is not analyzed as complete | MET | test | `packages/domain/tests/analytics/watermark.test.ts` (16 pass / 0 fail this run) + `packages/app/tests/services/history-service.test.ts:327` (in-progress, messages=2, partial excluded) |
| R5 — A refresh reports its coverage | MET | test | `packages/app/tests/services/history-service.test.ts:830` (refreshed 6 / skipped 5 by name + window); CLI render fixture `apps/cli/tests/commands/history.test.ts:561` |

**Design conformance:** DONE — last-complete-turn watermark, `sessionState` additive, supersede-not-accumulate, coverage on the refresh result. Prior Review P2s closed: unknown-role regression test at `packages/domain/tests/analytics/watermark.test.ts:181`; T3 `docs/04_DESIGN.md:559-576` now documents `coverage` + `sessionState` + watermark. `--fix all` this run also corrected `DailyResult.refreshCoverage` → `DailyResult.coverage` at `docs/04_DESIGN.md:576`.

**SECUA:** no P1–P2 remaining. P3 residuals unchanged: failed full-fidelity source drops out of `refreshed` (still in `fanOut`); `dataWindow` includes imported-but-not-analyzed trailing ts. P4: O(N) watermark filter at current session counts.

Coverage: N/A (verdict-based; verify pipeline does not measure code coverage).
### Review
**Review verdict: PASS** — R1–R5 MET. Both prior P2s are closed.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P2 | correctness | `packages/domain/src/analytics/watermark.ts:145-158` | Role-less / `unknown` trailing message treated as complete had no regression test. | CLOSED — `packages/domain/tests/analytics/watermark.test.ts:181` (state `complete`, data counted). |
| P2 | process / T3 | `docs/04_DESIGN.md:559-576` | Surface docs omitted `coverage`, `sessionState`, and the watermark policy. | CLOSED — `DailyResult.coverage`, `sessionState`, and last-complete-turn watermark documented. Debounce default aligned to 600000. |
| P3 | honesty | `packages/app/src/services/history-service.ts:221-230` | Failed full-fidelity source drops out of `refreshed` and is not named in `skipped`. Still in `fanOut` / exit / `history.daily.failed`. | DEFERRED — frozen `{ refreshed, skipped, window }` shape. |
| P3 | correctness | `packages/domain/src/analytics/watermark.ts:196-206` | `dataWindow` MIN/MAX includes imported-but-not-analyzed trailing ts. | NOTE — window = data present; watermark = analysis boundary. |
| P3 | residual risk | `packages/domain/src/analytics/watermark.ts:141-153` | An abandoned role-less prompt can be counted complete. | DOCUMENTED — prefer analyzing role-less claude finals over guessing. |
| P4 | perf | `packages/domain/src/analytics/watermark.ts:169-178` | One OR-disjunct per in-progress session. | NOTE — bounded by live session count. |
| P4 | consistency | `packages/app/src/services/history-refresh-service.ts:175-177` | Coverage is on `history.import.completed`, not the analyze event. | NOTE |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/domain/src/analytics/watermark.ts:145-178`; `packages/domain/tests/analytics/watermark.test.ts` 16 pass / 0 fail |
| R2 | MET | `packages/domain/src/analytics/artifact.ts:106` + `packages/app/src/services/history-service.ts:383`; tests `packages/app/tests/services/history-service.test.ts:327`, `packages/app/tests/services/history-service.test.ts:370` |
| R3 | MET | `packages/app/src/services/history-service.ts:221-230`; test `packages/app/tests/services/history-service.test.ts:830` |
| R4 | MET | `packages/domain/src/analytics/watermark.ts:196-206`; test `packages/app/tests/services/history-service.test.ts:830` |
| R5 | MET | `packages/app/src/services/history-service.ts:779-795`; test `packages/app/tests/services/history-service.test.ts:404` |

**Residual risk.** P3 coverage-shape / window-wording / unknown-role trade-off only. No open P1–P2.
### References
- **Import resumption already verified (do not re-verify):** `history_import_checkpoint` /
  `history_import_ledger`, feature E1 § In — "Incremental correctness … verified against real
  append-only growth"
- **Never-fabricate precedent (R1):** `packages/domain/src/analytics/run-cost.ts:240-241`; task 0474
  R7 removed a 4-chars-per-token estimate for the same reason
- **Analyze surface:** `apps/cli/src/commands/history.ts` (`analyze`, `daily` at `:203-217`)
- **Source coverage (R3):** full fidelity — claude, codex, pi, omp, agy, grok; unsupported — gemini,
  opencode, antigravity-ide, openclaw, hermes (feature E1 § Out of scope, operator ruling 2026-08-06)
- **Consumer that depends on completeness state (R2):** task 0547 (tokens per role)
- **Upstream dependency:** task 0549 (the trigger whose firing makes mid-session analysis routine)
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`
### History
- 2026-08-14T22:59:00.267Z todo → wip (system)
- 2026-08-15T00:00:13.001Z wip → testing (system)
- 2026-08-15T00:00:14.057Z testing → done (system)
