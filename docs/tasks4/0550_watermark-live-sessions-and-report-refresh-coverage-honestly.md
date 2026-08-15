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
updated_at: "2026-08-15T00:55:48.958Z"
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
- [ ] **R1.** Define and implement a watermark policy for still-appending sessions: `analyze` computes
      derived values only up to a defensible boundary (the last complete turn), and a session past
      that boundary is marked in progress rather than final. Measurable: analyzing a session file
      that grows between two refreshes yields values consistent with the completed portion at each
      point, and never values derived from a partial turn.
- [ ] **R2.** An in-progress session is distinguishable from a finished one in the analyze output, so
      a consumer can choose to exclude it. Measurable: the result marks each session's completeness
      state, and a consumer filtering on it gets only finished sessions.
- [ ] **R3.** A refresh reports which sources it refreshed and which it skipped as unsupported,
      rather than reporting bare success. Measurable: the refresh result enumerates refreshed and
      skipped sources by name.
- [ ] **R4.** A refresh states the window it covered, so a consumer can tell current data from stale.
      Measurable: the result carries the covered window, and a consumer reading it can determine
      recency without inspecting the database.
- [ ] **R5.** Re-analyzing a session after it completes supersedes the in-progress result rather than
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
- [ ] Define the watermark as the last complete turn and document the per-source ambiguity rule (R1)
- [ ] Compute derived values only up to the watermark; never from a partial turn (R1)
- [ ] Mark each session's completeness state in the analyze output (R2)
- [ ] Supersede an in-progress result when the session is re-analyzed after completion (R5)
- [ ] Report refreshed and skipped sources by name in the refresh result (R3)
- [ ] Report the covered window in the refresh result (R4)
- [ ] Add tests: growing-session watermark, in-progress filtering, supersede-not-duplicate, coverage reporting (R1-R5)
- [ ] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
Last-complete-turn watermark + honest coverage on the refresh result. No schema change.

| File | What / why |
| --- | --- |
| `packages/domain/src/analytics/forensic-query.ts:97-102` | Clip aggregates to last assistant `seq`. |
| `packages/domain/src/analytics/forensic-query.ts:174-187` | Unclipped `sessionCompleteness`. |
| `packages/domain/src/analytics/artifact.ts:106` | Additive `sessionState` on `SessionStat`. |
| `packages/app/src/services/history-service.ts:154-171` | `RefreshCoverage` on `DailyResult`. |
| `packages/app/src/services/history-service.ts:367` | Stamp `sessionState` onto `bySession`. |
| `packages/app/src/services/history-refresh-service.ts:125` | Triggered `daily` reports skipped unsupported sources + burst window. |
| `docs/04_DESIGN.md:568-570` | T3 surface. |
| `packages/domain/tests/analytics/forensic-query.test.ts:481` | Growing-session clip + complete-state. |
| `packages/app/tests/services/history-service.test.ts:236` | In-progress + re-analyze still one row. |
### Testing
**Verify 2026-08-15.**

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Trailing user tokens excluded from `messageRollup` (`packages/domain/tests/analytics/forensic-query.test.ts` watermark describe). |
| R2 | MET | `bySession[].sessionState` is `in-progress` vs `complete` (`packages/app/tests/services/history-service.test.ts`). |
| R3 | MET | `refreshCoverage.skipped` lists gemini/opencode/antigravity-ide/openclaw/hermes. |
| R4 | MET | `refreshCoverage.window` is the burst `{ since, until }`. |
| R5 | MET | Re-analyze of a growing session still has one `bySession` row. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R4 — A still-appending session is not analyzed as complete | MET | test | `sessionCompleteness` + analyze tests: trailing user → `in-progress`, tokens clipped to last assistant turn. |
| R5 — A refresh reports its coverage | MET | test | `HistoryRefreshService.run` asserts `refreshed` / `skipped` / `window`. |

**Design conformance:** DONE — last complete turn, `sessionState`, coverage object, no schema change.

**SECUA:** P4 — clip is conservative (exclude trailing incomplete turn).

Targeted: `bun test packages/domain/tests/analytics/forensic-query.test.ts packages/app/tests/services/history-service.test.ts packages/app/tests/services/history-refresh-service.test.ts` — pass.
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Correctness | `packages/domain/src/analytics/forensic-query.ts:97` | Watermark excludes the trailing incomplete turn rather than guessing its contents. |
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
- 2026-08-15T00:55:21.048Z todo → wip (system)
- 2026-08-15T00:55:21.549Z wip → testing (system)
- 2026-08-15T00:55:48.958Z testing → done (system)
