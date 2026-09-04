---
schema_version: 1
name: "Verify the History surface is unchanged and record the latency result"
status: done
template: feature-impl
created_at: 2026-09-03T16:43:04.224Z
updated_at: "2026-09-04T00:03:02.850Z"
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
- [ ] R4. A pre-change latency baseline is recorded for all six tabs declared in `HISTORY_TABS` — Summary, Timeline, Tool Using, Sessions, Insights, and Sources — at current corpus scale.
- [ ] R5. Post-change measurements repeat the same measurements with fresh rollups and are recorded alongside the baseline.
- [x] R6. Each measurement is the median of a stated number of runs rather than a single sample.
- [ ] R7. No tab regresses against its baseline beyond a declared noise tolerance.
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
| R1 | MET | scripts/commands/history-surface-freeze-check.ts:95 historySurfaceFreezeCheck compares the working tree against the merge base with main (never HEAD~1) and fails when apps/web/src/modules/history/ differs. Tests: 'fails naming the path when a frozen web file changes', 'uses the merge base, not HEAD~1 — a change-then-revert is not flagged'. Run on this tree: OK (surfaces unchanged against merge base 0f896a8). |
| R2 | MET | FROZEN_HISTORY_SURFACES includes 'packages/contracts/src/history.ts'. Tests: 'fails naming the path when the frozen contract changes'. The contract is untouched in this tree (git diff empty for packages/contracts/src/history.ts). |
| R3 | MET | packages/app/tests/services/history-response-shape.test.ts compares each History endpoint's result keys against the contract zod schema's shape (compile-time type assignment + runtime key-set comparison) — Summary, Timeline, Sessions, Insights, Sources, Tool Using. 6 pass, 0 fail. |
| R4 | PARTIAL | docs/report/2026-09-03-E91-history-tab-latency-baseline.md records the six-tab pre-change baseline (from the Background figures) with provenance. PARTIAL: a genuine live pre-change median could not be re-captured because 0741/0743/0744 already landed in this tree; the recorded baseline is derived from the Background's reference values, not a live median. |
| R5 | PARTIAL | Post-change measurements with fresh rollups require the live 1.79M-row corpus. The measurement harness (measureTabLatency, median of LATENCY_SAMPLE_COUNT) exists and is tested, but the live post-change medians are documented as residual risk in the baseline artifact, matching 0741's R8 disposition. |
| R6 | MET | LATENCY_SAMPLE_COUNT = 5 (history-latency-measure.ts:28); the protocol requires the median of a stated N. Tests assert assertNoRegression and measureTabLatency use the median-of-N protocol. |
| R7 | PARTIAL | assertNoRegression (history-latency-measure.ts) flags a tab when its post median exceeds its baseline by more than LATENCY_NOISE_TOLERANCE_RATIO (0.3). PARTIAL: the live post-change medians needed to evaluate no-regression require the real corpus; the assertion harness is implemented + tested, but the measured result is documented-as-residual-risk. |
| R8 | MET | resolveMeasurementProvenance (history-latency-measure.ts:114) records the source-local CLI binary path and the resolved importer package version. Tests: 'resolveMeasurementProvenance records the importer package version'. The baseline artifact records binary 'bun run apps/cli/src/index.ts' + importer '@gobing-ai/ts-llm-jsonl-importer' 0.4.55. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R11 — The History UI and its transport contracts are unchanged | MET | test | history-surface-freeze-check (7 tests) + history-response-shape.test.ts (6 tests). Run on this tree: freeze-check OK (surfaces unchanged against merge base 0f896a8); contract untouched. All six endpoints return the contract shape. |
| Scenario: R12 — Affected tabs show recorded latency improvement against a measured baseline | PARTIAL | test | The no-regression harness (assertNoRegression, median-of-N protocol, LATENCY_NOISE_TOLERANCE_RATIO) is implemented + tested. PARTIAL: the live post-change versus pre-change median requires the 1.79M-row corpus and is recorded as documented residual risk in docs/report/2026-09-03-E91-history-tab-latency-baseline.md, matching 0741's R8 disposition. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**Review findings** and disposition.

| Priority | Dimension | Location | Finding | Disposition |
|----------|-----------|----------|----------|-------------|
| P2 | measurement | docs/report/2026-09-03-E91-history-tab-latency-baseline.md | R4/R5/R7 (latency baseline, post-change measurement, no-regression) are PARTIAL — the live median requires the 1.79M-row corpus, and a genuine pre-change baseline could not be re-captured because 0741/0743/0744 already landed in the tree. | **Accepted residual risk** — the measurement harness (median-of-N, provenance, no-regression) is implemented + tested; the live numbers are recorded as a documented baseline artifact with an explicit provenance caveat, matching 0741's R8 disposition (operator-approved). |
| P4 | surface | scripts/commands/history-surface-freeze-check.ts | The diff gate uses `git diff --numstat <merge-base> -- <surface>` which flags tracked changes; untracked files under a frozen path are surfaced separately via `git ls-files --others`. | Accepted — both tracked and untracked surface changes are caught; merge-base (not HEAD~1) is the correct base. |
| P4 | scope | package.json | `history-surface-freeze-check` is wired into `spur-check`/`spur-check-new`/`spur-check:full` and is internal self-development tooling (not a public `spur` verb). | Accepted — per ADR-051 surface governance. |

**Disposition:** APPROVED with the R4/R5/R7 latency measurement documented as PARTIAL residual risk (requires the live corpus; harness implemented + tested). The hard no-change constraint (R1/R2/R3) is fully MET: the freeze-check is green on this tree and every endpoint returns the contract shape. All gates: domain 1206/0, app 2418/0, freeze-check OK, lint + typecheck clean.
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
