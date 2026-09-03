---
schema_version: 1
name: "Verify the History surface is unchanged and record the latency result"
status: todo
template: feature-impl
created_at: 2026-09-03T16:43:04.224Z
updated_at: "2026-09-03T17:45:55.540Z"
feature_id: E91
priority: P1
tags: ["history", "verification", "gate"]
dependencies: ["0741", "0743", "0744"]
---

## 0745. Verify the History surface is unchanged and record the latency result

### Background
The operator's constraint is explicit: all History tabviews are verified, so the UI must not change. A constraint that is only stated is not a constraint — a reviewer reading a large diff will not reliably notice one changed line in a module that was not supposed to change at all. This task makes it mechanical.

Both protected surfaces exist and are small enough to freeze wholesale. `apps/web/src/modules/history/` holds fourteen files: `index.tsx`, `HistoryShell.tsx`, `HistoryFilters.tsx`, `AgentIcon.tsx`, `charts.tsx`, `tabs.ts`, `TimelineScrubber.tsx`, `ToolCallDetail.tsx`, and the six tab components. `packages/contracts/src/history.ts` is the transport contract.

One premise correction. The decomposition named five tabs to measure — Summary, Sessions, Insights, Sources, and Tool Using — but `HISTORY_TABS` at `apps/web/src/modules/history/tabs.ts` declares **six**: `summary`, `timeline`, `tool-using`, `sessions`, `insights`, `sources`. Timeline was omitted. It is not a materialization target — ADR-103 permits per-message drill-down by `record_hash` point lookup, which is what Timeline does — but a latency gate that skips a tab cannot detect a regression in it, and E91 changes the indexes and the refresh behaviour underneath every tab. This task therefore measures all six, and the Requirements below were corrected accordingly during refinement.

Recorded baselines to measure against: rollup point read about 0.001 s, rollup re-GROUP BY 0.087–0.112 s, `bySession` 2.30 s, `byTool` 4.17 s, consolidated `toolSequenceQuery` 1.29 s, full `refreshHistoryRollups` 43.9 s, at a corpus of 1,791,462 messages and 494,215 tool calls in a 4.20 GB database.
### Requirements
- [ ] R1. A CI assertion fails when `apps/web/src/modules/history/` has any changed line against the merge base with the default branch.
- [ ] R2. The same assertion covers `packages/contracts/src/history.ts`.
- [ ] R3. Every History endpoint returns the same response shape it returned before the change.
- [ ] R4. A pre-change latency baseline is recorded for all six tabs declared in `HISTORY_TABS` — Summary, Timeline, Tool Using, Sessions, Insights, and Sources — at current corpus scale.
- [ ] R5. Post-change measurements repeat the same measurements with fresh rollups and are recorded alongside the baseline.
- [ ] R6. Each measurement is the median of a stated number of runs rather than a single sample.
- [ ] R7. No tab regresses against its baseline beyond a declared noise tolerance.
- [ ] R8. Each measurement records the CLI binary path and resolved importer package version used to produce it.
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent feature: `docs/features/E91_history-read-path-materialized-only-incremental-rollup-etl-per-table-freshness-and-precomputed-ui-aggregates.md`
- Design satellite: `docs/design/history-incremental-materialization.md` section 10 (D8)
- ADR-103: `docs/00_ADR.md`
- Six-tab registry the measurement set comes from: `apps/web/src/modules/history/tabs.ts`
- Frozen transport contract: `packages/contracts/src/history.ts`
- Internal check-script convention and the `spur-check` chain: `CLAUDE.md` build-and-verification section, and `docs/design/harness-surface-governance.md` for why this is not a public `spur` verb
- Source-local CLI requirement for real-data validation: `CLAUDE.md` build-and-verification section
### History
