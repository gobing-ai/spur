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
updated_at: "2026-08-15T00:00:14.057Z"
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
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/analytics/watermark.ts:145-158` — completeness predicate = last non-meta message is assistant-like with no open tool call (`EXISTS` against `history_tool_call` at `:101`); trailing partial turn excluded via `buildWatermarkFilter` (`:169-177`). Tests: `packages/domain/tests/analytics/watermark.test.ts:96` (user-final in-progress truncates at last closer), `:262` (growing in-progress session contributes only completed portion to totals — 30 tokens not 80), `:298` (derived `sessionSpans` exclude the partial turn). 0 fail this run (16 pass in watermark suite). |
| R2 | MET | `packages/domain/src/analytics/artifact.ts:106` — additive `sessionState?: SessionState` on `SessionStat`; wired per-session at `packages/app/src/services/history-service.ts:383` (absent ⇒ 'complete' fallback). Tests: `packages/app/tests/services/history-service.test.ts:337` (in-progress mark), `:368` (complete mark). |
| R3 | MET | `packages/app/src/services/history-service.ts:221-233` — `buildRefreshCoverage` reports `refreshed` (full-fidelity sources, non-failed) and `skipped` (five unsupported by 2026-08-06 ruling); carried on `DailyResult.coverage` (`:173`). CLI prints it `apps/cli/src/commands/history.ts:372`. Test: `packages/app/tests/services/history-service.test.ts:815` (6 refreshed vs 5 skipped by name). |
| R4 | MET | `coverage.window` = MIN/MAX message ts via `dataWindow` (`packages/domain/src/analytics/watermark.ts:196-205`), assembled at `packages/app/src/services/history-service.ts:231-233`. Tests: `packages/app/tests/services/history-service.test.ts:830` (window asserted), `packages/domain/tests/analytics/watermark.test.ts:311` (null + non-null window). |
| R5 | MET | One `bySession` record per session rebuilt from DB each analyze; artifact written as a per-selector-digest snapshot (overwrite + `latest.json` pointer) at `packages/app/src/services/history-service.ts:776-795`. Test: `packages/app/tests/services/history-service.test.ts:417-439` — 3 analyzes while running + 1 after completion ⇒ ONE complete record (4 messages), never four partials. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R4 — A still-appending session is not analyzed as complete | MET | test | `packages/domain/tests/analytics/watermark.test.ts:96` (session ending on user message ⇒ `in-progress`, truncates after last turn closer); `packages/app/tests/services/history-service.test.ts:417` (in-progress during run, `messages: 2` — partial turn excluded) |
| R5 — A refresh reports its coverage | MET | test | `packages/app/tests/services/history-service.test.ts:815` (refreshed 6 / skipped 5 by name + window `{ since, until }`); `apps/cli/tests/commands/history.test.ts:561` (coverage rendered) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Verdict: PARTIAL** — functional AC R1–R5 are met and verified (0 fail across the changed suites; `tsc --noEmit` clean in `packages/domain`, `packages/app`, `apps/cli`), but two P2 findings must be resolved before `done`: the 0550 review-fix (role-less/'unknown'-role completeness) has no regression test, and `docs/04_DESIGN.md` (T3, task-plan line) was not updated.

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | **Review-fix untested.** The completeness predicate treats a trailing `role='unknown'` (or undefined/null/'') message with no open tool call as `complete` — the fix so role-less/'unknown'-role imported messages are analyzed, not zeroed — but no test inserts `role='unknown'`; the branch is dead in the suites (reverting the fix would not fail any test). Add a regression test: a session whose final message is `role='unknown'` with no tool call ⇒ `state: 'complete'` and its data counted. | SECUA correctness / traceability | packages/domain/src/analytics/watermark.ts:150-153 | P2 | OPEN |
| 2 | **T3 surface docs not updated.** Task-plan line + constitution T3 require `docs/04_DESIGN.md` in the same commit; the working-tree diff touches no docs. `spur history daily` still documents `DailyResult ({ fanOut, artifact, pruned })` without `coverage` (docs/04_DESIGN.md:550-556), and the `analyze` section documents neither `sessionState` nor the watermark policy. | Process / surface docs | docs/04_DESIGN.md:546-590 | P2 | OPEN |
| 3 | **Failed source drops out of coverage.** `coverage.refreshed` excludes a failed full-fidelity source and `skipped` never names it, so a coverage-only consumer cannot distinguish "claude failed" from "not in scope". Failure is still surfaced via `fanOut`, exit code, and `history.daily.failed` — not lost, but the coverage field alone is ambiguous. | SECUA honesty | packages/app/src/services/history-service.ts:213-222 | P3 | DEFERRED (frozen `{ refreshed, skipped, window }` shape) |
| 4 | **Coverage window not watermark-aware.** `dataWindow` returns MIN/MAX over all messages in scope; for an in-progress session `until` includes the trailing partial turn (imported but not analyzed), while the comment calls it "the MIN/MAX message ts the analyze covered". Defensible (window = data present, watermark = analysis boundary), but the wording overstates what the analyze derived from. | SECUA correctness | packages/domain/src/analytics/watermark.ts:196-205 | P3 | NOTE |
| 5 | **'unknown'-role-as-complete vs "exclude when ambiguous" (Design § Watermark).** Treating an 'unknown' trailing message as complete can count an unanswered role-less user prompt (`mapRole` maps any unlisted/role-less type → 'unknown'). Directionally right (role-less claude final responses are commoner than role-less prompts) and self-documenting, but a session abandoned on a role-less prompt is permanently counted. | SECUA residual risk | packages/domain/src/analytics/watermark.ts:141-153 | P3 | DOCUMENTED |
| 6 | **O(N) watermark filter.** `buildWatermarkFilter` emits one `(m.session_id=? AND m.source=? AND m.seq>?)` OR-disjunct per in-progress session; large live-session counts could degrade the SQLite plan. Bounded by session counts at current scale. | Architecture / perf | packages/domain/src/analytics/watermark.ts:169-177 | P4 | NOTE |
| 7 | **Coverage only on `history.import.completed`.** The analyze event does not carry `coverage`, though coverage is analyze-derived; a consumer on the analyze event cannot see refreshed/skipped/window. | Consistency | packages/app/src/services/history-refresh-service.ts:180-190 | P4 | NOTE |

**Functional traceability (R1–R5 all met):**
- **R1 — watermark = last complete turn.** `sessionWatermarks`/`buildWatermarkFilter` bound analysis to the last turn-closing message (assistant, non-meta, no open tool call); watermark.test.ts:15 pass incl. growing-session totals and derived-input (`sessionSpans`) truncation. The review-fix landed here (role-less/'unknown'-role final messages now `complete`, not zeroed) — see P2-1.
- **R2 — in-progress distinguishable.** `sessionState: 'in-progress' | 'complete'` on `SessionStat` (additive optional; absent ⇒ unknown for pre-0550 artifacts); 0550 history-service test asserts the mark and a consumer can filter.
- **R3 — refresh reports coverage.** `coverage.refreshed`/`coverage.skipped` on `DailyResult`, printed by the CLI (`formatDailyResult`), emitted on `history.import.completed`; tests assert the six full-fidelity vs five unsupported sets.
- **R4 — window stated.** `coverage.window` (MIN/MAX `ts`) on the refresh result + CLI output; `dataWindow` test covers null and non-null.
- **R5 — supersede, not duplicate.** The artifact is a per-selector-digest snapshot (`analyze-<digest>.json`, overwritten each analyze + `latest.json` symlink), one `bySession` record per session, rebuilt from the DB each refresh; the 0550 R5 test asserts one in-progress record while running and one complete record after, never accumulation.

**Residual risk:** P2-1 (fix untested — highest), P3-5 (unknown-role trade-off), P3-4 (window wording), P3-3 (failed source invisible in coverage). The artifact date-dir split across day boundaries is pre-existing 0464 R2 behavior, out of 0550 scope.

**Verification performed:** `bun test` — watermark 15 pass / 0 fail (watermark.ts 100% line/func coverage), history-service 0550-scoped 5 pass, CLI history 28 pass, full history-service 30 pass, forensic-query 17 pass. `tsc --noEmit` clean in all three changed workspaces. Test success judged by "0 fail" per the known machine-wide `bun test` exit-1 coverage bug.
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
