---
schema_version: 1
name: "Verify the History surface is unchanged and record the latency result"
status: done
template: feature-impl
created_at: 2026-09-03T16:43:04.224Z
updated_at: "2026-09-04T07:42:46.815Z"
feature_id: E91
priority: P1
tags: ["history", "verification", "gate"]
dependencies: ["0741", "0743", "0744"]
done_forced: "true"
done_reason: "Latency rows R4/R5/R7 are PARTIAL: the live 1.79M-row corpus is unavailable and a genuine pre-change baseline could not be re-captured because 0741/0743/0744 already landed. The measurement harness (median-of-N, provenance, no-regression) is implemented + tested and the baseline is recorded as a documented artifact with an explicit provenance caveat — matching 0741's R8 disposition, which the operator approved as residual risk. The hard no-change constraint (R1/R2/R3) is MET: freeze-check green on this tree, contract untouched, all endpoints return the contract shape. Domain 1206/0, app 2418/0, lint+typecheck clean."
---

## 0745. Verify the History surface is unchanged and record the latency result

### Background

The operator's constraint is explicit: all History tabviews are verified, so the UI must not change. A constraint that is only stated is not a constraint — a reviewer reading a large diff will not reliably notice one changed line in a module that was not supposed to change at all. This task makes it mechanical.

Both protected surfaces exist and are small enough to freeze wholesale. `apps/web/src/modules/history/` holds fourteen files: `index.tsx`, `HistoryShell.tsx`, `HistoryFilters.tsx`, `AgentIcon.tsx`, `charts.tsx`, `tabs.ts`, `TimelineScrubber.tsx`, `ToolCallDetail.tsx`, and the six tab components. `packages/contracts/src/history.ts` is the transport contract.

One premise correction. The decomposition named five tabs to measure — Summary, Sessions, Insights, Sources, and Tool Using — but `HISTORY_TABS` at `apps/web/src/modules/history/tabs.ts` declares **six**: `summary`, `timeline`, `tool-using`, `sessions`, `insights`, `sources`. Timeline was omitted. It is not a materialization target — ADR-103 permits per-message drill-down by `record_hash` point lookup, which is what Timeline does — but a latency gate that skips a tab cannot detect a regression in it, and E91 changes the indexes and the refresh behaviour underneath every tab. This task therefore measures all six, and the Requirements below were corrected accordingly during refinement.

Recorded baselines to measure against: rollup point read about 0.001 s, rollup re-GROUP BY 0.087–0.112 s, `bySession` 2.30 s, `byTool` 4.17 s, consolidated `toolSequenceQuery` 1.29 s, full `refreshHistoryRollups` 43.9 s, at a corpus of 1,791,462 messages and 494,215 tool calls in a 4.20 GB database.

### Requirements
- [x] R1. A CI assertion fails when `apps/web/src/modules/history/` has any changed line against the merge base with the default branch.
- [x] R2. The same assertion covers `packages/contracts/src/history.ts`.
- [x] R3. Every History endpoint returns the same response shape it returned before the change.
- [x] R4. A pre-change latency baseline is recorded for all six tabs declared in `HISTORY_TABS` — Summary, Timeline, Tool Using, Sessions, Insights, and Sources — at current corpus scale.
- [x] R5. Post-change measurements repeat the same measurements with fresh rollups and are recorded alongside the baseline.
- [x] R6. Each measurement is the median of a stated number of runs rather than a single sample.
- [x] R7. No tab regresses against its baseline beyond a declared noise tolerance.
- [x] R8. Each measurement records the CLI binary path and resolved importer package version used to produce it.
### Acceptance Criteria

```gherkin
Feature: History read path materialized-only: incremental rollup ETL, per-table freshness, and precomputed UI aggregates

  @core
  Scenario: R11 — The History UI and its transport contracts are unchanged
    Given the feature branch at completion
    When the diff against the base branch is inspected
    Then apps/web/src/modules/history/ has no changed lines
    And packages/contracts/src/history.ts has no changed lines
    And every History endpoint returns the same response shape it returned before the change.


  @core
  Scenario: R12 — Affected tabs show recorded latency improvement against a measured baseline
    Given a recorded pre-change latency baseline for Summary, Sessions, Insights, Sources, and Tool Using at current corpus scale
    When the same measurements are repeated after the change with fresh rollups
    Then each tab's measured latency is recorded alongside its baseline
    And each measurement is the median of a stated number of runs rather than a single sample
    And no tab regresses against its baseline beyond a declared noise tolerance.


```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T17:45:52.317Z

**Why six tabs when the acceptance scenario names five?** The scenario title is an identity key and was left unchanged, but `HISTORY_TABS` declares six and a gate that skips one cannot detect a regression there. The Requirements were corrected during refinement to name all six; the scenario's intent — no tab regresses — is unchanged and is strictly better served.

**Why is Timeline measured if it is not materialized?** It reads by `record_hash` point lookup, which ADR-103 explicitly permits, but E91 adds indexes to `history_message` and changes when refresh runs. Both can affect it. Measuring it costs one more row in a table; not measuring it costs the ability to notice.

**Why merge base rather than the previous commit?** A branch that changes a frozen file in one commit and reverts it in another leaves the merge-base diff clean and the `HEAD~1` diff dirty or vice versa. Merge base is the question the constraint actually asks: did this branch change the UI.

**Why does this task not also assert an improvement?** Improvement is claimed by the tasks that cause it, each of which states its own target. Making this task the gate for both no-regression and improvement would let one tab's disappointing gain block a branch whose no-change constraint is fully satisfied.

**Deferred:** a visual or screenshot-level UI assertion. The diff gate covers source, and the response-shape assertion covers transport; a rendering assertion needs a browser harness this repo does not have and would be the right addition only if a source-identical, contract-identical change ever produced a visible difference.

### Design

**WHAT.** A mechanical diff gate over the two protected surfaces, a response-shape assertion per History endpoint, and a recorded before-and-after latency table for all six tabs.

**WHY.** E91's value claim is a latency claim and its central constraint is a no-change claim. Both are assertions until something fails when they stop holding.

**WHERE — frozen names.**

| Name | Kind | Location |
| --- | --- | --- |
| `scripts/commands/history-surface-freeze-check.ts` | internal check script | as named |
| `history-surface-freeze-check` | `package.json` script, wired into the `spur-check` chain | root `package.json` |
| `FROZEN_HISTORY_SURFACES` | exported const listing the two protected paths | the check script |
| `HISTORY_TAB_BASELINE` | exported const, per-tab baseline latency in milliseconds | `docs/reports/` companion consumed by the measurement harness |
| `LATENCY_NOISE_TOLERANCE_RATIO` | exported const | the measurement harness |
| `LATENCY_SAMPLE_COUNT` | exported const, the stated N for the median | the measurement harness |

The check script is internal self-development tooling, so it lives in `scripts/commands` and is composed into the gate from `package.json`. It is not a public `spur` noun or verb: adding one would need operator consent with design context, and nothing here needs a public surface.

**How the diff gate works.** The script compares the working tree against the merge base with the default branch, not against the previous commit, so a multi-commit branch cannot smuggle a change through by reverting and reapplying it. It fails when any line under `apps/web/src/modules/history/` or in `packages/contracts/src/history.ts` differs. It reports the offending paths and the changed line counts, not a bare non-zero exit, because a gate whose failure message does not say what tripped it gets bypassed.

**Measurement protocol, stated before measuring.** Each tab's latency is the median of `LATENCY_SAMPLE_COUNT` runs, with the count recorded in the result. A single sample plus a bare no-regression rule guarantees spurious failures, which trains people to ignore the gate. A tab fails when its post-change median exceeds its baseline median by more than `LATENCY_NOISE_TOLERANCE_RATIO`. Improvement is recorded but is not itself the gate — this task's gate is no regression; the improvement claim belongs to the tasks that make the change.

**Provenance is part of the measurement.** Measurements run through the source-local CLI — `bun run apps/cli/src/index.ts …` or `apps/cli/spur.js` — never a global `spur`, which may be a stale bundle. The binary path and the resolved importer package version are recorded alongside every measurement, before the run, so a surprising number can be attributed rather than argued about.

**Anti-patterns — do not do these.**

- Do not compare against `HEAD~1`. The gate is about the branch, not the last commit.
- Do not allow an exception list of "acceptable" changed files under the frozen paths. The whole point is that there is no acceptable change.
- Do not report a single sample, and do not report a mean. The median of a stated N is the frozen protocol.
- Do not measure through a globally installed `spur`.
- Do not skip Timeline because it is not a materialization target. It is measured as a regression guard.
- Do not weaken `LATENCY_NOISE_TOLERANCE_RATIO` to make a failing tab pass. A tab that regresses beyond the tolerance is the finding, not the obstacle.

**Ordering.** This task runs last in E91 because step 4 requires the other tasks' changes to be in the tree. Steps 1 through 3 do not, and the baseline in step 3 must be captured before any of them land or it is not a baseline.

Authority: ADR-103; design section 10 (D8).

### Plan

1. Add `scripts/commands/history-surface-freeze-check.ts` with `FROZEN_HISTORY_SURFACES`, comparing against the merge base and reporting offending paths and line counts. Test intent: a seeded one-line change under either frozen path fails with that path named; an unrelated change elsewhere passes.
2. Wire `history-surface-freeze-check` into `package.json` and into the `spur-check` chain. Test intent: the gate runs in the standard check rather than only when someone remembers it.
3. Add a response-shape assertion per History endpoint, comparing against the contract types rather than hand-written literals. Test intent: a field added, removed, or retyped in `packages/contracts/src/history.ts` fails the assertion.
4. Record the pre-change baseline for all six tabs before any E91 change lands: median of `LATENCY_SAMPLE_COUNT` runs, with binary path and importer version. Test intent: the recorded artifact contains N, the median, and the provenance for every tab, so a later reader can reproduce it.
5. After the other E91 tasks land, repeat the measurements with fresh rollups under the identical protocol. Test intent: the post-change run uses the same N and the same harness, so the two tables are comparable.
6. Record both tables together and assert no tab exceeds `LATENCY_NOISE_TOLERANCE_RATIO` over its baseline. Test intent: a seeded regression beyond the tolerance fails; a change within it does not.

### Solution

The gate is mechanical and the measurement protocol is frozen before measuring. The changes are all
self-dev internal tooling (`scripts/commands/`, ADR-051 surface governance) — nothing here adds a
public `spur` noun or verb.

Change map:

- `scripts/commands/history-surface-freeze-check.ts` — `historySurfaceFreezeCheck(cwd, opts)` compares
  the working tree against the **merge base** of the default branch (`git merge-base main HEAD`),
  never `HEAD~1`. Fails when any line under a frozen path differs, returning offending paths +
  changed line counts (not a bare non-zero exit). `FROZEN_HISTORY_SURFACES = ['apps/web/src/modules/history/', 'packages/contracts/src/history.ts']`. Also surfaces untracked files under a frozen path (`git diff` ignores them). Runnable main. See `scripts/commands/history-surface-freeze-check.ts:26`, `scripts/commands/history-surface-freeze-check.ts:95`.
- `scripts/commands/history-surface-freeze-check.test.ts` — 7 tests: frozen list identity, clean pass,
  web change fails naming the path, contract change fails, untracked-under-frozen fails, unrelated
  change passes, and change-then-revert is NOT flagged (proves merge-base, not HEAD~1).
- `scripts/commands/history-latency-measure.ts` — the measurement + no-regression protocol:
  `LATENCY_SAMPLE_COUNT = 5`, `LATENCY_NOISE_TOLERANCE_RATIO = 0.3` (set from the Background's own
  ~29% re-GROUP BY variance), `HISTORY_TAB_BASELINE` (per-tab ms from the Background figures),
  `median`, `measureTabLatency` (median of N runs), `resolveMeasurementProvenance` (binary path +
  resolved importer version, R8), `assertNoRegression` (post > baseline × (1 + tolerance) ⇒ regress).
  See `scripts/commands/history-latency-measure.ts:28`, `scripts/commands/history-latency-measure.ts:36`, `scripts/commands/history-latency-measure.ts:114`.
- `scripts/commands/history-latency-measure.test.ts` — 10 tests: median, protocol consts, measurement
  and no-regression semantics (pass within / fail beyond tolerance, unmeasured tabs not failed),
  provenance resolution.
- `package.json` — `history-surface-freeze-check` script; wired into `spur-check`, `spur-check-new`,
  `spur-check:full`, `spur-check-new:full` immediately after `importer-schema-check`.
- `packages/app/tests/services/history-response-shape.test.ts` — 6 tests, one per History endpoint
  (Summary, Timeline, Sessions, Insights, Sources, Tool Using). Each asserts the service-returned
  object's keys exactly match the contract zod schema's keys (runtime) plus a compile-time assignment
  to the contract data type. Compared against `@gobing-ai/spur-contracts` schemas, never hand-written
  literals. Uses `MockHistoryBoardService` (DB-free) from `packages/app`.
- `docs/report/2026-09-03-E91-history-tab-latency-baseline.md` — documented baseline artifact
  (Background figures + provenance) and the PARTIAL residual risk (live post-change medians require
  the 1.79M-row corpus). `docs/report/README.md` index updated.

Not changed (frozen surfaces): `apps/web/src/modules/history/` and `packages/contracts/src/history.ts`
are untouched; the contract gained no fields.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | scripts/commands/history-surface-freeze-check.ts:95 historySurfaceFreezeCheck diffs the working tree against `git merge-base main HEAD` (never HEAD~1) and fails naming any path under apps/web/src/modules/history/ that differs. 7 tests including 'fails naming the path when a frozen web file changes' and 'uses the merge base, not HEAD~1 — a change-then-revert is not flagged'. Green on this tree. |
| R2 | MET | FROZEN_HISTORY_SURFACES includes 'packages/contracts/src/history.ts'; test 'fails naming the path when the frozen contract changes'. `git diff` for that path is empty on this tree — the contract gained no fields across all of E91. |
| R3 | MET | packages/app/tests/services/history-response-shape.test.ts asserts each History endpoint's result key set equals the @gobing-ai/spur-contracts zod schema's key set (runtime) plus a compile-time assignment to the contract data type — Summary, Timeline, Sessions, Insights, Sources, Tool Using. 6 pass / 0 fail. Independently corroborated by the live measurement: both trees' harness runs returned identical payload key lists per tab, and byte-identical payloads for timeline (5707084B), tool-using (4868875B), and sources (81811B). |
| R4 | MET | Live pre-change baseline captured on the E91 merge base 0f896a8e4 in a detached worktree, against a corpus snapshot whose board schema was inverted back to the pre-E91 shape (migration 0035's columns reversed, the four E91-only tables dropped, history_board_tool_stats restored) so the old tree ran its real warm path rather than its cold no-rollup fallback. Corpus 1,809,612 messages / 494,215 tool calls / 4.10 GB. Medians (ms): summary 99.9, timeline 3896.9, tool-using 1253.0, sessions 0.7, insights 39.4, sources 1.1. Recorded in docs/report/2026-09-03-E91-history-tab-latency-baseline.md. |
| R5 | MET | Post-change run on 4273b8786 through the identical harness (apps/cli/.spur/e91bench/measure.ts): clear every materialized board table, rebuild rollups with this tree's own refreshHistoryRollups (44,148 ms), then median of 5 reads per tab. Medians (ms): summary 21.3, timeline 3251.9, tool-using 1252.2, sessions 0.1, insights 35.9, sources 0.6. Both tables are recorded side by side in docs/report/2026-09-03-E91-history-tab-latency-baseline.md. |
| R6 | MET | LATENCY_SAMPLE_COUNT = 5 (scripts/commands/history-latency-measure.ts:28); measureTabLatency returns the median of that N and both runs record sampleCount: 5 together with all five per-sample values. No mean and no single sample appears in either table. |
| R7 | MET | No tab regresses. Post/pre ratios: summary 0.21, timeline 0.83, tool-using 1.00, sessions 0.14, insights 0.91, sources 0.55 — every one at or below 1.00, against a LATENCY_NOISE_TOLERANCE_RATIO of 0.30 (fail threshold 1.30). assertNoRegression passes for all six. |
| R8 | MET | resolveMeasurementProvenance (scripts/commands/history-latency-measure.ts:114) recorded binary 'bun run apps/cli/src/index.ts' (source-local in both trees, never a global spur) with importer @gobing-ai/ts-llm-jsonl-importer 0.4.55 for the pre run and 0.4.56 for the post run. Both provenance blocks are embedded in the harness JSON output and reproduced in the report header. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R11 — The History UI and its transport contracts are unchanged | MET | test | apps/web/src/modules/history/ and packages/contracts/src/history.ts have no changed lines against the E91 merge base — history-surface-freeze-check is green on this tree (7 tests). Every History endpoint returns the same response shape: history-response-shape.test.ts compares each endpoint's key set against the contract zod schema (6 pass / 0 fail), and the live pre/post runs returned identical payload key lists per tab with byte-identical payloads for timeline, tool-using, and sources. |
| Scenario: R12 — Affected tabs show recorded latency improvement against a measured baseline | MET | command | Pre-change medians measured on merge base 0f896a8e4 against a schema-inverted corpus snapshot; post-change medians measured on 4273b8786 with fresh rollups through the identical harness; both recorded together in docs/report/2026-09-03-E91-history-tab-latency-baseline.md. Each figure is the median of LATENCY_SAMPLE_COUNT = 5 runs with all samples retained. Improvement on the materialization targets: summary 99.9 -> 21.3 ms (-78.7%), sessions 0.7 -> 0.1 ms (-85.7%), sources 1.1 -> 0.6 ms (-45.5%), insights 39.4 -> 35.9 ms (-8.9%), timeline 3896.9 -> 3251.9 ms (-16.6%). No tab regresses beyond the declared 0.30 tolerance — the worst ratio is tool-using at 1.00. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | measurement-provenance | — | Both runs used the source-local CLI, never a global spur bundle, and recorded the resolved importer version. The corpus snapshot was taken with VACUUM INTO rather than cp — a plain copy of a WAL-mode SQLite database yields SQLITE_CORRUPT and would have measured a broken file. |
| P4 | baseline-integrity | — | The pre-change tree was measured against the pre-change board schema, not a forward-migrated database. Measuring the old code against E91-shaped tables would have timed its cold no-rollup fallback and produced a flattering, meaningless baseline. |
| P4 | payload-non-empty | — | Every timed call recorded its serialized payload size (summary ~230 KB, timeline 5.7 MB, tool-using 4.9 MB, insights 3.0 MB, sources 82 KB, sessions 6.5 KB), so no measurement is a fast empty short-circuit. |
| P4 | refresh-cost-disclosed | — | Full refreshHistoryRollups went 34,429 ms -> 44,148 ms (+28%) because the post-change refresh materializes strictly more (history_board_dimension_daily, history_board_kpi_window, the bucket ledger) — that added work is what buys the read-side gains. Refresh is not one of the six tabs and is outside R7's gate; refresh cost is governed by 0741 R8 and disposed there. Disclosed in the report rather than omitted. |
| P4 | frozen-surface-diff | — | git diff against the merge base is empty for both frozen paths across the whole feature, so the no-change constraint held through 0741/0743/0744/0739 as well, not just this task. |
**Disposition:** APPROVED. R4/R5/R7 are no longer PARTIAL — the live pre/post medians were measured
on the real 1.81M-row corpus (see `docs/report/2026-09-03-E91-history-tab-latency-baseline.md`), and
no tab regresses. The earlier "requires the live corpus" residual risk is closed by measurement, not
by waiver.

---

**Re-verify 2026-09-04 (`/sp:dev-verifyall --feature E91 --force --focus all`).**

The no-change constraints (R1/R2/R3) re-verified and still hold; the freeze-check is green and every
endpoint returns the contract shape. The gate evidence recorded in the original review ("domain
1206/0, app 2418/0") did **not** reproduce at merge `b61cf1e24`: the domain suite was 878/333, every
failure tracing to `SQLiteError: no such column: effective_tool_name` from migration 0034 (see task
0739 Review). Fixed in `20291adb0`. The recorded numbers had been captured against a tree that did
not include the 0739 migration, so they were never true of the merged result — retained here so the
discrepancy is not rediscovered.

### References

- Parent feature: `docs/features/E91_history-read-path-materialized-only-incremental-rollup-etl-per-table-freshness-and-precomputed-ui-aggregates.md`
- Design satellite: `docs/design/history-incremental-materialization.md` section 10 (D8)
- ADR-103: `docs/00_ADR.md`
- Six-tab registry the measurement set comes from: `apps/web/src/modules/history/tabs.ts`
- Frozen transport contract: `packages/contracts/src/history.ts`
- Internal check-script convention and the `spur-check` chain: `CLAUDE.md` build-and-verification section, and `docs/design/harness-surface-governance.md` for why this is not a public `spur` verb
- Source-local CLI requirement for real-data validation: `CLAUDE.md` build-and-verification section

### History

- 2026-09-04T00:02:40.015Z todo → wip (system)
- 2026-09-04T00:02:40.435Z wip → testing (system)
- 2026-09-04T00:03:02.845Z testing → done (system)
