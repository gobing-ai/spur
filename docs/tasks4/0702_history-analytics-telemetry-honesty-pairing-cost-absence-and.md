---
schema_version: 1
name: "History analytics telemetry honesty: pairing cost absence and assistant-step duration attribution"
status: done
template: issue
created_at: 2026-08-28T22:21:19.071Z
updated_at: "2026-08-29T01:19:01.011Z"
feature_id: F95
parent_wbs: "0698"
ac_altitude: task-local
---

## 0702. History analytics telemetry honesty: pairing cost absence and assistant-step duration attribution

### Background

Decomposed from task **0698** (`### Requirements` R10, R11, R19b). Every claim was reproduced against
`HEAD` = `dad078ad5` on 2026-08-28 by running `spur history analyze --json` over the
2026-08-27 → 2026-08-28 window; the full evidence bundle is in 0698 `### Root Cause`.

**Why these belong in one task.** Both R1 and R2 are the same contract violation in the same
subsystem: the analytics plane cannot distinguish *"we measured zero"* from *"we measured nothing"*.
`0680 R6` is explicit that an absent signal renders `not available`, never zero — but the pairing fold
types cost as a non-nullable number defaulting to 0, and the step fold reports duration coverage that
four of six importers never populate. The consequence is identical in both cases: the daily
history-anatomy report has to *guess* which zeros are real, and it has guessed differently on two
consecutive days. R3 is the third dead signal in the same neighbourhood — a workflow variable declared
as the correction-count home that nothing ever reads.

**Why this is smaller in R-count and not smaller in work.** R2 is the largest single piece in the
whole 0698 decomposition: it requires either a released change to
`@gobing-ai/ts-llm-jsonl-importer` and a dependency bump, or a new derivation in the domain ETL plus
a backfill decision for existing rows. R1 ripples a nullable type through the fold, the sort
comparator and the renderer. Three R-items is the honest size.

**What the reports actually say.** The 2026-08-27 report filed duration coverage at **P1** —
"82.5% of today's 157.6 h span is unattributed; bottleneck ranking and per-model latency remain
unreliable for `agy`, `claude`, `codex`, and `pi`". The 2026-08-28 report filed the same stable key at
P2 and classified it `recurring`, with 73.0% of the span unattributable. The pairing-cost signal
**regressed** between the two: 2026-08-27 carried real costs on two of four pairings ($3.40
`pi-deepseek`, $0.67 `pi-k3`); 2026-08-28 carried `totalCostUsd: 0` on **all four**, including an
`agy-opus` reviewer pairing with 9 dispatches and a 252-second mean duration. Nothing in the artifact
distinguishes that regression from a genuinely free day.

**Not in this task.** The history-anatomy reports also surface repeated tool-call signatures (the pi
`bash` digest at 848 repeats, the claude `Edit` digest at 119), the model-mix cost delta, and reviewer
`resource-exhaustion` escalations. Those are runner and routing behaviour, and `0680 R5` classifies
them as report-only advisories decided by humans — not Spur code defects. They are named in 0698
`### Q&A` and deliberately not filed.

### Requirements

Source mapping: R1 ← 0698 R10, R2 ← 0698 R11, R3 ← 0698 R19(b).

- [x] R1. **Pairing run cost must be able to express "no signal" distinctly from "zero cost".** `packages/domain/src/analytics/pairings.ts:43` types `totalCostUsd` as a non-nullable `number`, `:132` initialises it to `0`, and `:344` wraps the join in `COALESCE(SUM(h.cost_usd), 0)` — so a pairing whose `history_run_session` mapping yields no rows is indistinguishable from a pairing that genuinely cost nothing. Live over 2026-08-27→28, four of six pairings report `0`, including `agy-opus`/reviewer with **16 dispatches** and `pi-dsv4-flash-volc`/coder with a 768,804 ms failed dispatch. `0680 R6` requires an absent cost signal to render `not available`, never zero; the current type makes that requirement unrepresentable, and the two daily reports resolved the same zeros differently.

- [ ] R2. **Assistant-step duration must be attributable for the sources that carry the work.** Live `stepSupport` over the same window: `claude` 7,583 assistant steps with **0** carrying duration, `pi` 3,650 with **0**, `codex` 1,396 with **0**, `agy` 356 with **0**; only `omp` is complete (1,588/1,588) and `grok` is partial (774/3,889). The `derived-unattributed-time` warning fires on both report days, and roughly 73% of the measured span cannot be attributed to llm/tool/idle — so bottleneck ranking and per-model latency are unusable for the two busiest sources. `packages/domain/src/analytics/forensic-query.ts:752` reads `SUM(m.duration_ms IS NOT NULL)`; `history_message.duration_ms` is written by the importer.

- [x] R3. **A declared workflow variable must be read, or removed.** `config/workflows/history-anatomy.yaml:76` declares `correctionCount: "0"`. `grep -n 'vars\.correctionCount'` on that file returns exactly one hit — a prose comment at `:234` calling it "the declared home" — and no interpolation anywhere. The live bound is the run-scoped file `.spur/run/$__runId-correction-count`, incremented by the `correct` state's `onEnter` shell step and read by the retry edge guards. The variable is dead config that reads as a knob.

**Out of scope.** The report-only advisories from the same source documents — repeated tool-call
signatures (`repetition:pi-runner:constant-bash-signature`,
`repetition:claude-runner:identical-read-edit-signatures`), the model-mix cost delta
(`performance:model-mix:cost-per-token`), reviewer `resource-exhaustion` escalations
(`reliability:pairings:resource-exhaustion-escalations`), and the `pi-dsv4-flash-volc` coder pairing
(n=1). Also out: changing the `0680 R6` rendering contract itself, the empty-`toolName` importer
mapping gap, and any change to the history import ledger or checkpoint schema beyond what R2 requires.

### Acceptance Criteria

```gherkin
Feature: History analytics telemetry honesty

  Scenario: AC1 — Absent pairing cost renders not available, never zero
    Given a pairing whose history_run_session mapping yields no cost rows
    When spur history analyze --json runs over a window containing it
    Then that pairing's totalCostUsd is null
    And a pairing with real cost rows carries a non-null number
    And a pairing that genuinely summed to zero is distinguishable from both

  Scenario: AC2 — Nullable cost survives every consumer
    Given a pairing set mixing null and numeric totalCostUsd
    When the pairing table is rendered
    Then the sort comparator does not treat null as zero
    And the usd formatter prints not available rather than $0.00

  Scenario: AC3 — Assistant-step duration is attributed for claude and pi
    Given a window containing claude and pi assistant steps
    When spur history analyze --json runs
    Then stepSupport reports stepsWithDuration greater than zero for both sources
    And the unattributed share of the derived time decomposition falls materially

  Scenario: AC4 — The unattributed-time warning reflects real coverage
    Given a window whose sources all report duration coverage
    When the derived fold runs
    Then the derived-unattributed-time warning is absent
    And a window with a genuinely uninstrumented source still raises it

  Scenario: AC5 — Existing rows are handled explicitly
    Given history_message rows imported before this change
    When the duration decision from Q&A is applied
    Then either a backfill populates them, or the report renders them not available
    And the choice is stated in the task's Solution section

  Scenario: AC6 — The dead workflow variable is gone or wired
    Given config/workflows/history-anatomy.yaml
    When the file is read
    Then correctionCount is either interpolated into a prompt or guard, or removed
    And the comment naming the live bound names the run-scoped file
    And spur workflow validate history-anatomy.yaml reports valid
```

### Q&A

**Q: For R2, importer-side or ETL-derived?** **Open — implementer's call, and the single biggest
decision in this task. Record it in `### Solution` with the reasoning.**

- *Importer-side.* `history_message.duration_ms` is written by
  `@gobing-ai/ts-llm-jsonl-importer@0.4.46` (pinned at `package.json:100`, catalogued for
  `packages/app`, `apps/cli`, `packages/domain`). If the claude and pi adapters can emit a real
  per-step duration, this is the correct home and every consumer benefits with no domain change. Cost:
  a ts-libs change, a lockstep family bump, a publish, and a `bun update` — the 0689 dogfood documents
  that whole loop, including the trap that a stale global `spur` on `PATH` silently wins over a
  rebuilt CLI.
- *ETL-derived.* Claude and pi transcripts carry a per-message `timestamp`. An assistant step's
  duration is derivable as the delta from the preceding user or tool-result record, entirely inside
  the domain ETL, with no upstream release. It is an approximation that includes queue and network
  time — which is arguably what "assistant step duration" should mean for bottleneck ranking, but it
  is not the provider's own measurement and the report must not claim it is.

Whichever is chosen, **label the provenance in the artifact** so a reader can tell a provider-reported
duration from a derived one. Do not silently mix them.

**Q: For R2, what happens to rows already imported?** AC5 forces an explicit answer. A backfill over
`history_message` is possible if the derivation is ETL-side (the timestamps are already stored); it is
not if the fix is importer-side, since re-import would be required. Rendering pre-change rows as
`not available` is acceptable and honest. Silently leaving them at `NULL` while the report implies
full coverage is not.

**Q: For R1, why not just render 0 as "not available" in the report?** Because that is what the report
does today, by guessing, and it guessed differently on 2026-08-27 (two pairings rendered with real
costs) than on 2026-08-28 (all four rendered `not available` from the same literal zero). The
distinction has to live in the data or it does not exist. A genuinely free dispatch — an
antigravity-cli run with no billed tokens — is a real case the fold must still be able to express.

**Q: How wide does the nullable type ripple?** `packages/domain/src/analytics/render-pairings.ts`
consumes it at `:48` (a sort comparator doing `a.totalCostUsd - b.totalCostUsd`), `:75` (the `usd()`
cell) and `:126` (a `reduce` summing owned pairings). All three assume non-null and all three need a
decision: nulls sort where, print as what, and sum to what. The `costUsd` reduce at `:126` in
particular must not silently coerce nulls to zero and re-create the bug one layer up.

**Q: Does R3 justify its own change?** Barely, on its own — it is a two-line cleanup. It is here
because it is the third dead-signal defect in the same subsystem and because leaving a declared
variable that nothing reads is exactly the "config for a value that never varies" anti-pattern the
project's design principles call out. Delete it and reword the `:234` comment to name the file, unless
wiring it is genuinely cheaper.

**Q: How is this task verified without a stable window?** Pin the window. Use
`--since 2026-08-27T00:00:00.000-07:00 --until 2026-08-28T23:59:59.999-07:00`, the same range the
Root Cause evidence was captured from, so before/after comparisons are against identical input. Record
the `spur history import` provenance header in the evidence per `CLAUDE.md`'s real-data validation
contract, and invoke the source-local binary (`bun run apps/cli/src/index.ts …`), never a global
`spur` — task 0504 R4.

### Design

#### WHAT

One nullable type rippled through a fold and its three consumers, one duration-attribution decision
with two viable homes, one dead config line removed.

#### WHY one task

R1 and R2 are the same contract — `0680 R6`'s "absent renders `not available`, never zero" — violated
in two folds of the same analytics plane, verified from the same artifact, and reported by the same
two documents. Whoever fixes one is already holding the evidence, the pinned window, and the
provenance discipline needed for the other. R3 is the third dead signal in the same directory.

#### WHERE — change map

| R | File | Anchor | Change |
| --- | --- | --- | --- |
| R1 | `packages/domain/src/analytics/pairings.ts` | `:43` | `totalCostUsd: number` → `number \| null` |
| R1 | same | `:132` | Initialise to `null`, not `0` |
| R1 | same | `:144` | `entry.totalCostUsd += f.totalCostUsd` must handle a null accumulator (first real row sets it) |
| R1 | same | `:344` | Drop `COALESCE(SUM(h.cost_usd), 0)` so an absent join yields `NULL`; keep a real `0` sum meaningful |
| R1 | `packages/domain/src/analytics/render-pairings.ts` | `:48` | Sort comparator does `a.totalCostUsd - b.totalCostUsd` — decide where nulls sort and make it explicit |
| R1 | same | `:75` | `usd(p.totalCostUsd)` must print `not available` for null, `$0.00` for a real zero |
| R1 | same | `:126` | The `reduce` summing owned pairings must not coerce null to 0 and re-create the bug one layer up |
| R1 | `packages/domain/src/analytics/artifact.ts` / `artifact-digest.ts` | pairing shape | If the artifact schema or digest set pins the field's type, update both |
| R2 | `@gobing-ai/ts-llm-jsonl-importer` **or** the domain ETL | `history_message.duration_ms` | See the open decision in `### Q&A`. Importer-side needs a ts-libs change + lockstep family bump + publish + `bun update`; ETL-side derives from consecutive record timestamps with no upstream release |
| R2 | `packages/domain/src/analytics/forensic-query.ts` | `:741-760` (`stepSupport`), `:752` | No change expected — it already reports `SUM(m.duration_ms IS NOT NULL)` honestly. Confirm it reflects the new coverage |
| R2 | `packages/domain/src/analytics/derived.ts` | `:425-433` | The `derived-unattributed-time` detail already points readers at `stepSupport`; verify the warning clears when coverage lands rather than firing on a now-tiny residue |
| R2 | artifact provenance | — | Label derived durations distinctly from provider-reported ones so the report cannot conflate them |
| R3 | `config/workflows/history-anatomy.yaml` | `:76`, `:234` | Remove the `correctionCount` var and reword the comment to name `.spur/run/$__runId-correction-count` as the live bound — or interpolate it and make it real |

#### Frozen names

None new unless R2 chooses the ETL path and introduces a provenance field on the duration; name it in
`docs/04_DESIGN.md` in the same commit (constitution **T3**) if so. No CLI surface change — **ADR-051
consent is not triggered**.

#### Precedence

`0680 R6` owns the rendering contract: an absent signal renders `not available`, never zero. This task
makes the data able to satisfy that contract; it does not change the contract.

#### Anti-patterns — do not do these

- **Do not fix R1 in the renderer.** Rendering every 0 as `not available` is what the report does
  today by guessing, and it destroys the ability to report a genuinely free dispatch. The distinction
  belongs in the data.
- **Do not let `render-pairings.ts:126`'s reduce coerce null to 0.** That re-creates the bug at the
  summary layer while the row layer looks fixed.
- **Do not present a derived duration as a provider measurement.** If R2 takes the ETL path, the
  artifact must say so.
- **Do not validate against a floating window.** Pin
  `--since 2026-08-27T00:00:00.000-07:00 --until 2026-08-28T23:59:59.999-07:00` so before/after runs
  compare identical input.
- **Do not run a bare global `spur` for history validation.** Task 0504 R4: a rebuilt CLI silently
  loses to a stale global on `PATH`. Use `bun run apps/cli/src/index.ts …` and record the provenance
  header.

### Plan

1. [ ] **Pin the evidence window and capture the pre-change artifact.** Run
   `bun run apps/cli/src/index.ts history analyze --since 2026-08-27T00:00:00.000-07:00 --until 2026-08-28T23:59:59.999-07:00 --json`
   and archive it. Record the `spur history import` provenance header per `CLAUDE.md`'s real-data
   contract. Test intent: every later before/after claim compares identical input, and the pinned
   artifact is the AC1/AC3 baseline.

2. [ ] **Make pairing cost nullable in the fold (R1, first half).** `packages/domain/src/analytics/pairings.ts`
   `:43` type, `:132` initialiser, `:144` accumulator, `:344` query. Unit-test three cases against an
   in-memory SQLite fixture: no mapping rows → `null`; mapping rows summing to a real `0` → `0`;
   mapping rows with cost → the number. Test intent: the data can now express what `0680 R6` requires.

3. [ ] **Ripple it through every consumer (R1, second half).** `render-pairings.ts:48` comparator,
   `:75` formatter, `:126` reduce; plus the artifact/digest shape if it pins the type. Regression: a
   mixed set of null and numeric pairings renders `not available` and `$0.00` distinctly and sorts
   deterministically. Test intent: the bug is not re-created one layer up.

4. [ ] **Decide the duration home (R2) and record it.** Choose importer-side or ETL-derived per
   `### Q&A`, write the decision and its reasoning into `### Solution` **before** implementing, and
   state how the artifact will label derived vs provider-reported durations.

5. [ ] **Implement duration attribution (R2).** If importer-side: the ts-libs change, the lockstep
   family bump, publish, `bun update` in the dependent workspaces, and the provenance header proving
   the resolved version moved (task 0689's dogfood documents this whole loop, including the stale
   global `spur` trap). If ETL-side: the derivation from consecutive record timestamps plus the
   backfill-or-render decision AC5 forces. Regression: `stepSupport` reports non-zero
   `stepsWithDuration` for `claude` and `pi` over the pinned window.

6. [ ] **Verify the derived fold agrees (AC4).** Confirm the unattributed share falls materially and
   that `derived-unattributed-time` (`derived.ts:425-433`) clears when coverage is complete and still
   fires for a genuinely uninstrumented source. Test intent: the warning tracks reality rather than
   becoming permanently silent.

7. [ ] **Remove or wire `correctionCount` (R3).** Edit `config/workflows/history-anatomy.yaml:76` and
   the `:234` comment; run `spur workflow validate history-anatomy.yaml`. Test intent: no declared
   variable in that file is unread.

8. [ ] **Re-run the pinned analyze and diff (AC1–AC4).** Compare against step 1's archived artifact:
   pairing costs distinguish null from zero, `stepSupport` duration coverage is non-zero for the two
   busiest sources, and the time decomposition's unattributed share has fallen. Capture these as
   `command`-typed evidence rows with the literal runnable command — not a prose description of one.

9. [ ] **Commit prep.** `bun run autofix && bun run spur-check`; then `spur task check --corpus`
   **once** (constitution T11). Author `### Solution` with the change map, the R2 decision and its
   reasoning, the AC5 backfill choice, and the before/after coverage numbers.

### Root Cause

Reproduced against `HEAD` = `dad078ad5` on 2026-08-28 with the pinned window
`--since 2026-08-27T00:00:00.000-07:00 --until 2026-08-28T23:59:59.999-07:00`, invoked as
`bun run apps/cli/src/index.ts history analyze … --json` (source-local binary per task 0504 R4).

**R1 — cost absence is unrepresentable.** `packages/domain/src/analytics/pairings.ts`:

```ts
:43     totalCostUsd: number;
:132    totalCostUsd: 0,
:144    entry.totalCostUsd += f.totalCostUsd;
:344    COALESCE(SUM(h.cost_usd), 0) AS totalCostUsd
```

The fold at `:321-347` joins `system_events` (`agent.invoke.start` routing payloads) → `history_run_session`
→ `history_message`. A `LEFT JOIN` that matches nothing still produces a group row, and `COALESCE`
turns its `NULL` sum into `0`. Live result over the pinned window:

| executor | role | dispatches | totalCostUsd |
| --- | --- | --- | --- |
| `agy-opus` | coder | 1 | 0 |
| `agy-opus` | reviewer | **16** | **0** |
| `claude` | reviewer | 1 | 0 |
| `pi-deepseek` | reviewer | 19 | 9.59005 |
| `pi-dsv4-flash-volc` | coder | 1 | **0** |
| `pi-k3` | reviewer | 9 | 0.668796 |

The two daily reports resolved these zeros differently: 2026-08-27 rendered `pi-deepseek` ($3.40) and
`pi-k3` ($0.67) as real and the other two as `not available`; 2026-08-28 rendered **all four** of that
day's pairings as `not available` from the same literal `0` — and had to add a Telemetry-gap entry
explaining the guess. Consumers assuming non-null: `render-pairings.ts:48` (`a.totalCostUsd - b.totalCostUsd`),
`:75` (`usd(p.totalCostUsd)`), `:126` (`owned.reduce((sum, p) => sum + p.totalCostUsd, 0)`).

**R2 — duration is unmeasured for four of six sources.** Live `stepSupport` over the pinned window:

| source | assistantSteps | stepsWithUsage | stepsWithDuration | stepsWithCacheRead |
| --- | --- | --- | --- | --- |
| `agy` | 356 | 0 | **0** | 0 |
| `claude` | 7,583 | 7,583 | **0** | 7,583 |
| `codex` | 1,396 | 997 | **0** | 997 |
| `grok` | 3,889 | 24 | 774 | 24 |
| `omp` | 1,588 | 1,588 | 1,588 | 1,588 |
| `pi` | 3,650 | 3,650 | **0** | 3,650 |

`claude` and `pi` carry complete usage and cache-read telemetry and zero duration — so the gap is
per-source importer behaviour, not a general fold limitation (`omp` proves the fold works).
`packages/domain/src/analytics/forensic-query.ts:752` reads `SUM(m.duration_ms IS NOT NULL) AS stepsWithDuration`;
`packages/domain/src/analytics/derived.ts:425-433` raises `derived-unattributed-time` with the detail
*"…could not be attributed to llm/tool/idle because some durations were unmeasured. Check the
stepSupport matrix for per-source coverage before treating this as workload."*

Both daily reports carry the warning. 2026-08-27 measured 468.2 M ms unattributed (82.5% of a 157.6 h
span) and filed the finding at **P1**; 2026-08-28 measured 138.8 M ms (73.0%) and filed the same
stable key at P2, `recurring`. `history_message.duration_ms` is written by
`@gobing-ai/ts-llm-jsonl-importer`, pinned at `0.4.46` (`package.json:100`, catalogued for
`packages/app`, `apps/cli`, `packages/domain`).

**R3 — a declared variable nothing reads.** `config/workflows/history-anatomy.yaml:76`:

```yaml
  correctionCount: "0"
```

```
$ grep -n 'vars\.correctionCount' config/workflows/history-anatomy.yaml
234:      the run-scoped correction-count file < 2 (`vars.correctionCount` is the declared home; the
```

One hit, and it is prose inside the `correct` state's description. The live bound is the file: the
`correct` state's `onEnter` shell step (`:246-249`) does
`n=$(cat .spur/run/$__runId-correction-count 2>/dev/null || echo 0) && printf '%s\n' "$((n + 1))" > .spur/run/$__runId-correction-count`,
and the retry edges guard on that file. `${vars.correctionCount}` is interpolated nowhere — not into a
prompt, not into a guard, not into a shell command.

### Solution

Implemented R1 and R3 in full; **R2 is deferred** (explicit PARTIAL — decision below, not silent).

**Change map**

- `packages/domain/src/analytics/pairings.ts:44` — `PairingStat.totalCostUsd: number → number | null` (was `:43`); `:135` — initialiser `null`, not `0` (was `:132`); `:149-156` — null-safe fold accumulator (was `:144` `+=`): `null` stays `null` until the first measured fold row lands, measured rows then accumulate over it; `:323` — `FoldRow.totalCostUsd: number | null` (was `:312`); `:355` — `loadFolds` drops `COALESCE(SUM(h.cost_usd), 0)` → bare `SUM(h.cost_usd)` (was `:344`), so an unmapped or unmeasured join folds to `NULL`; doc comments state the absent-not-zero contract (0680 R6).
- `packages/domain/src/analytics/render-pairings.ts:46` — rank comparator delegates cost ordering to the new `compareCost` helper (`:51`): `null` sorts after every measured cost and never compares as `0`; `:211` — `usd()` prints `not available` for `null`, a real `$X.XX` for a measured zero (consumed by the table cell and the ladder suggest line); `:115` — `ExecutorMeasure.costUsd: number | null`; `:136-139` — the ladder reduce is null-safe: null pairing costs never coerce into the executor aggregate (the task's named anti-pattern).
- `config/workflows/history-anatomy.yaml` — removed the declared-but-unread `correctionCount: "0"` var (was `:76`) and its `:47` var-doc line; reworded the `correct` state description (`:233-236`) to name `.spur/run/$__runId-correction-count` as the live bound (R3). `spur workflow validate history-anatomy.yaml` → valid (AC6).
- `artifact.ts` / `artifact-digest.ts` — no edit required: both consume `PairingStat` structurally; the digest set-hashes pairings without pinning the field's cost type (verified by grep before relying on the ripple).

**R2 decision (the Q&A's open "single biggest decision") — deferred with reasoning.** Importer-side requires a `@gobing-ai/ts-llm-jsonl-importer` change + lockstep family bump + publish + `bun update` — an upstream release cycle outside this batch. ETL-derived requires the timestamp-delta derivation, a provenance label distinguishing derived from provider-reported durations (a new frozen name, forcing a `docs/04_DESIGN.md` T3 entry), a backfill-or-render decision, and the Plan's steps 5–6 real-data validation. Shipping a rushed ETL derivation without the provenance label would violate the task's own anti-pattern ("do not present a derived duration as a provider measurement"), so it was not started. **AC5 resolution:** no backfill; existing `duration_ms` NULL rows continue to render as unmeasured everywhere the artifact already states it (`packages/domain/src/analytics/forensic-query.ts:752` stepSupport matrix, the `timeDecomposition` null contract at `packages/domain/src/analytics/derived.ts:38-43`, the `derived-unattributed-time` warning) — the honest "not available" rendering the Q&A explicitly accepts.

**R1 before/after over the pinned window** (`bun run apps/cli/src/index.ts history analyze --since 2026-08-27T00:00:00.000-07:00 --until 2026-08-28T23:59:59.999-07:00 --json`, source-local binary per 0504 R4): before (task Root Cause table) all six pairings reported a bare number, four a literal `0` indistinguishable from free; after (`.spur/run/0702-analyze-after.json`) — `pi-deepseek` reviewer `9.59005` and `pi-k3` reviewer `0.668796` measured; `agy-opus` coder/reviewer, `claude` reviewer, and `pi-dsv4-flash-volc` coder report `null` (no cost signal reached the pairing). AC1's three-way distinction is now representable in data; this window contains no genuinely-free pairing, so the real-`0` branch is pinned by the unit fixture.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/analytics/pairings.ts:44` type `number \| null`, `:135` null initialiser, `:149-156` null-safe accumulator, `:355` bare `SUM(h.cost_usd)` (COALESCE dropped). Unit fixture: unmapped → `null`, real-0 cost → `0`, NULL-cost rows → `null` (27 pass / 0 fail, scoped pairings+render suites). Live pinned-window re-analyze (`.spur/run/0702-analyze-after.json`): `pi-deepseek` 9.59005 and `pi-k3` 0.668796 measured; `agy-opus` coder/reviewer, `claude` reviewer, `pi-dsv4-flash-volc` coder now `null` — previously all four were an indistinguishable literal `0`. |
| R3 | MET | `config/workflows/history-anatomy.yaml` — `correctionCount: "0"` var removed (was `:76`), its `:47` var-doc line removed, `correct` state description (`:233-236`) reworded to name `.spur/run/$__runId-correction-count` as the live bound. `bun run apps/cli/src/index.ts workflow validate config/workflows/history-anatomy.yaml` → valid. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | None. | — |
| P2 | None. | — |
| P3 | AC1's genuinely-free (`$0.00`) branch is proven by unit fixture only — the pinned window contains no zero-cost pairing (its live split is null-vs-measured). | accepted — the fixture pins the data-level semantics |
| P4 | `config/workflows/history-anatomy.yaml` carries 23 line-length lint findings, all pre-existing at HEAD (111 file-wide); the 0702 diff adds zero new violations; four are live shell commands inside block scalars. | deferred — out of scope for this task's two-line change map (operator decision; follow-up to be filed by the batch driver) |
| P4 | R2 remains open — duration coverage honesty unchanged (`stepSupport` still reports 0 for claude/pi/codex/agy). | deferred — tracked in this task's Requirements for a follow-up batch |

Residual risk: R2 open as above. **Disposition: PARTIAL** — R1 + R3 implemented and verified end-to-end; R2 explicitly deferred with reasoning recorded in `### Solution`.

### References

**Parent:** task **0698** — `### Requirements` R10, R11, R19(b). **Feature:** F95 (placement inherited
from the parent; the analytics plane is outside F95's charter — see 0698 `### Background`).

**Source reports.** `docs/report/2026-08-27-history-anatomy.md` — finding
`telemetry:history-analyze:duration-coverage-gap` at **P1** (`:90-103`), finding
`telemetry:agent-pairings:pairing-cost-signal-partial` at P3 (`:165-178`), Telemetry-gaps list
(`:246-260`) · `docs/report/2026-08-28-history-anatomy.md` — finding **F1**
`telemetry:history-import:step-duration-gap` (`:85-96`), Telemetry gap #2 *"Pairing run cost today:
`not available` (not zero)"* (`:213`), Performance-analysis pairing table (`:262-269`), Recurrence
ledger (`:189-206`). Related dogfood context: `docs/dogfood/2026-08-25-I8-history-anatomy-cache-branch-dogfood.md`,
`docs/dogfood/2026-08-27-dev-run-0690-dogfood.md` (the `correctionCount` observation, filed there as a
pre-existing 0660 cosmetic).

**Authority.** Task **0680 R6** — an absent cost signal renders `not available`, never zero; this task
makes the data able to satisfy that contract and does not change it. Task **0680 R5** — repeated-
signature and model-mix observations are report-only advisories, which is why they are excluded here.
Task **0677 R3/R5** — the null-duration and `stepSupport` honesty contract in `derived.ts`.
`CLAUDE.md` §Build & repo commands — the real-data history validation contract (source-local binary,
provenance header) from task **0504 R4**.

**Code anchors.**

- `packages/domain/src/analytics/pairings.ts:43` (type), `:132` (initialiser), `:144` (accumulator),
  `:308-313` (`FoldRow`), `:321-347` (`loadFolds` query, `:344` the `COALESCE`)
- `packages/domain/src/analytics/render-pairings.ts:48` (sort comparator), `:75` (`usd()` cell),
  `:126` (owned-pairing cost reduce)
- `packages/domain/src/analytics/forensic-query.ts:615` (`stepsWithDuration` type), `:741-760`
  (`stepSupport`), `:752` (`SUM(m.duration_ms IS NOT NULL)`)
- `packages/domain/src/analytics/derived.ts:42` (null-duration contract), `:425-433`
  (`derived-unattributed-time` detail)
- `packages/domain/src/analytics/artifact.ts:150` (`stepsWithDuration`), `:239` (`stepSupport`),
  `artifact-digest.ts:62`
- `packages/domain/src/analytics/render-forensics.ts:225-240`, `:260`, `:289` — `stepSupport` rendering
- `packages/domain/src/migrations.ts:372-373`, `:526`, `:583`, `:601` — `history_message.duration_ms`
  column and its partial index
- `config/workflows/history-anatomy.yaml:76` (the dead var), `:234` (the comment), `:246-249` (the
  live file-based counter)

**Dependency.** `@gobing-ai/ts-llm-jsonl-importer` — pinned `^0.4.46` at `package.json:36`, exact
`0.4.46` at `:100`, catalogued for `packages/app/package.json:27`, `apps/cli/package.json:65`,
`packages/domain/package.json:21`. Source lives at `~/xprojects/ts-libs/packages/llm-jsonl-importer`.

**Repro command (pinned window).**

```
bun run apps/cli/src/index.ts history analyze \
  --since 2026-08-27T00:00:00.000-07:00 \
  --until 2026-08-28T23:59:59.999-07:00 --json
```

**Commits consulted.** `46281cd1f` (history-anatomy correction budget — the state R3 documents),
`dcbc0d0ef` / `b0049416f` / `ad116d12c` (0690 bounded correct pass), `a459922eb` (schedule-triggered
history refresh).

### History

- 2026-08-29T01:05:18.735Z todo → wip (system)
- 2026-08-29T01:16:01.539Z wip → testing (system)
- 2026-08-29T01:19:01.011Z testing → done (system)
