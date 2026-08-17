---
template: feature-impl
schema_version: 1
name: "Per-step token/time and cache-efficiency sections in the analyze artifact"
description: ""
status: done
type: task
profile: standard
feature_id: E5
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-17T19:04:22.674Z"
updated_at: "2026-08-17T21:50:13.195Z"
---

## 0581. Per-step token/time and cache-efficiency sections in the analyze artifact

### Background
From `docs/design/sqlite-forensics-token-time-per-step.md` (fixes **F4** and **F5**, issue **I4**),
2026-08-17. This is the deliverable the design doc was written to justify: *token and time per step*,
read from SQLite instead of parsed out of raw JSONL.

#### The gap

`history_message` already stores `input_tokens`, `output_tokens`, `cache_read_tokens`,
`cache_write_tokens`, `cost_usd`, `duration_ms`, and `model` **per message** — i.e. per step. The
analyze artifact aggregates every one of them away: `ForensicTotals` (whole selector), `bySource`,
`byModel`, `daily`, `SessionStat` (per session), `ToolStat` (per tool). There is no per-step view, so
the questions the design doc answers with ad-hoc SQL cannot be answered from the artifact:

- which individual steps are the most expensive, and on which model
- which steps are the slowest
- which steps re-send context instead of reusing cache

#### What per-step analysis found (omp, measured)

- **Context re-fill ceiling** — top steps run ~590K tokens each against a ~640K context ceiling, of
  which 589–591K is cache-read. 8+ steps sit at 588–592K: near-full context re-fed every turn.
- **Latency outliers** — up to **1,412 s (23.5 min)** on `glm-5.1`; 550–682 s on `glm-5.2`/`5.3`.
  The longest steps report `in 0 / out 0`, so cost attribution for the slowest work is blind.
  Slowest mean per step: `deepseek-v4-flash-ga-260731` 38.1 s, `k3` 22.0 s, `glm-5.2` 14.6 s.
- **Cache re-send waste (I4)** — **2,478 omp steps** send >100K fresh input with <10 % cache reuse:
  **354,130,045 fresh tokens** re-sent. Exact, re-verified.
- **Cost concentration** — top single step $0.52 (522K fresh input, only 38K cached). The heaviest
  steps are also the least cache-efficient.

Per-source cache-hit ratio, assistant steps only:

| source | cache hit |
| --- | --- |
| pi | 95.8 % |
| omp | 93.5 % |
| grok | 49.0 % |
| opencode | 48.9 % |
| gemini | 45.7 % |

#### Why this task is unblocked today

It needs no mapper fix and no re-import. `omp` (89,662 assistant steps, 99.6 % with duration, 100 %
with model) and `opencode` (11,034 steps, ~100 % both) already carry everything required. Sources
with poor fidelity are handled by honest per-source reporting (R5); the mapper and re-import tasks
under E5 run on their own schedule and this task does not sit behind them.
### Requirements
- **R1** — The analyze artifact gains a per-step section: top-N assistant steps ranked by total tokens, each carrying session, source, model, timestamp, fresh input, cache-read, output, cost, and duration. N is bounded and configurable at the call site, following the `LIMIT ?` discipline the other forensic queries already use (`forensic-query.ts` R2 invariant — no unbounded corpus materialization).

- **R2** — The artifact gains a top-N-by-duration ranking over the same step rows, so latency outliers (the 1,412 s step) surface without a second query. Steps whose duration is unmeasured are excluded from the ranking rather than sorted as 0.

- **R3** — The artifact gains a per-step cache-efficiency ranking that surfaces I4's pattern directly: steps with high fresh input and low cache reuse, ordered by fresh tokens, with the aggregate fresh-token total for the selector. A reader must be able to see "2,478 steps, 354M fresh tokens re-sent" without writing SQL.

- **R4** — The forensics renderer emits the new sections, so `spur history report --mode forensics` shows them alongside the existing eight. Section registration follows the task 0555 report-mode registry rather than a bespoke render path.

- **R5** — Per-source fidelity is stated in the report, not implied. A source that cannot support a section (no duration, no model, no usage) is named as unsupported for that section rather than rendering an empty or zero-filled table — the honesty tier the design doc § 5 note 2 calls for. Today that means omp/opencode support every section; pi/gemini support tokens but not time; claude/agy/codex support neither.

- **R6** — The new queries hold the existing structural invariants: bounded by `LIMIT ?`, selector-scoped (`since`/`until`/`source`/`session`/`run`/`task`), and watermark-aware via the same `WatermarkQueryOptions` path every other message query uses.

- **R7** — Tests cover ranking correctness, the bound, selector narrowing, exclusion of unmeasured durations from the duration ranking, and the unsupported-source path rendering as unsupported rather than empty.

#### Out of scope / non-goals
| Not in this task | Why |
| --- | --- |
| Fixing any mapper | Tasks **0577** / **0580**. This task reports what the data plane holds, honestly, including its gaps. |
| Re-import | Task **0578**. Nothing here needs it. |
| The span-math bug | Task **0579**. These sections read per-message columns directly, not `timeDecomposition`. |
| Acting on the 354M-token finding | Surfacing the waste is this task. Changing agent context management is a separate decision with its own evidence. |
| A new CLI noun or subcommand | The design doc floated "a new `spur history` subcommand" for F5. Rejected — `analyze` already produces the artifact and `report --mode forensics` already renders it. ADR-051 § noun discipline: a new noun needs a justification no existing noun can host. |
### Acceptance Criteria
- **AC1 (R1)** — Given `history analyze --source omp --json`, when the artifact is read, then it contains a top-steps-by-tokens array whose entries each carry session, source, model, timestamp, fresh input, cache-read, output, cost, and duration. The top entry for omp matches the measured baseline: model `deepseek-v4-flash`, cache-read **591,744**, fresh input **152**, output 1,775, cost **$0.009**, duration ~21.6 s. Fresh input and cache-read are reported as distinct fields — a step that is heavy in cache-read is not expensive in dollars, and collapsing them into one "tokens" number inverts the ranking's meaning.

- **AC2 (R1, R6)** — The step query is `LIMIT ?`-bounded and honors the selector: `--source omp --since <d> --until <d>` returns only steps inside that window, and a narrow window returns fewer rows than a wide one. The artifact size does not grow with corpus size.

- **AC3 (R2)** — The top-steps-by-duration ranking's leading entry for omp is the `glm-5.1` step at **1,412,287 ms** (23.5 min), which reports input 0 / output 0 — so the ranking must not require usage to be present. Steps with `duration_ms IS NULL` do not appear in this ranking at all: a test asserts they are excluded, not sorted as 0.

- **AC4 (R3)** — For omp with no time narrowing, the cache-efficiency section reports **2,478** steps matching >100K fresh input with <10 % cache reuse and an aggregate of **354,130,045** fresh tokens. These exact numbers are the acceptance evidence.

- **AC5 (R4)** — `spur history report --mode forensics` renders the new sections through the task 0555 report-mode registry; the rendered output names them and shows the ranked rows.

- **AC6 (R5)** — Given `--source claude` (no duration, no usage), when the report renders, then the time and cache sections read as **unsupported for this source** with the reason, not as an empty table or a table of zeros. Given `--source pi`, the token sections render and the time sections read unsupported.

- **AC7 (R6)** — The new queries pass the repository's structural invariant scan (bounded + selector-scoped) the same way the existing forensic queries do, and accept `WatermarkQueryOptions` so watermark exclusion applies to them identically.

- **AC8 (R7)** — `packages/domain/tests/analytics/` covers ranking order, the `LIMIT` bound, selector narrowing, unmeasured-duration exclusion, and the unsupported-source render path.

- **AC9** — `bun run lint` clean; `bun run test` green with no skipped tests; `docs/04_DESIGN.md` updated in the same commit for the artifact-shape change (constitution T3).
### Q&A
#### Closed decisions

**Why not a new `spur history` subcommand, as design-doc F5 suggested?** Rejected under ADR-051
§ noun discipline: a new CLI surface needs a justification no existing noun can host, and
`analyze` already produces the artifact while `report --mode forensics` already renders it. Adding a
subcommand would also split the per-step data away from the selector and watermark plumbing every
other section shares.

**Why three queries instead of one query sorted three ways in JS?** The `LIMIT ?` bound is only
meaningful if the database does the ordering. Materializing 89,662 omp assistant steps into JS to
sort them defeats the R2 structural invariant and the memory bound that motivates it. Three narrow
indexed queries are cheaper and each stays independently bounded.

**Why derive per-source support instead of using the design doc's fidelity tiers?** A hard-coded
tier list is wrong the day tasks 0577/0580 land. `FULL_FIDELITY_SOURCES`
(`history-service.ts:218`) is the standing example — it still lists `pi` as full-fidelity while pi
carries zero tool calls and 3.7 % content. Derivation is self-correcting; a list is a second thing
to remember to update.

**Why exclude unmeasured durations from the duration ranking rather than sorting them last?** A step
with no duration is unknown, not fast and not slow — placing it anywhere in an ordered ranking
asserts something false. Excluding it and reporting the excluded count is the same treatment
`assistantDurationUnmeasured` already gives the aggregate.

#### Open — decide during implementation

**What is N, and is it caller-configurable?** `bySession` threads a `top` parameter from
`HistoryService.analyze`; follow that. Whether the three rankings share one `top` or take separate
bounds is open. **Owner:** implementer. Constraint: the artifact must not grow with corpus size
(AC2), and the default must be large enough that the I4 pattern is visible — 2,478 omp steps match
the cache-waste filter, so a top-10 would hide the shape while reporting the aggregate correctly.

**Where does the cache-efficiency threshold live?** AC4 pins the acceptance evidence to the design
doc's filter (>100K fresh input, <10 % cache reuse → 2,478 steps / 354,130,045 tokens). Whether
those constants are literals in the query or named constants is open. **Owner:** implementer —
prefer named constants with the measured rationale in a comment; avoid a config knob for values that
have never needed to vary.

**Does the report render per-step rows or only the aggregate?** R4 requires the sections render;
how much per-row detail survives into markdown (versus staying in the JSON artifact) is a rendering
judgment. **Owner:** implementer, following the task 0555 registry's existing section conventions.

#### Verified baselines for the ACs

Measured 2026-08-17 so the implementer does not re-derive them:

| AC | Measured |
| --- | --- |
| AC1 top step by tokens (omp) | `deepseek-v4-flash` — cache-read **591,744**, fresh input **152**, output 1,775, cost **$0.009**, duration 21.6 s |
| AC3 top step by duration (omp) | `glm-5.1` — **1,412,287 ms** (23.5 min), input 0, output 0 |
| AC4 cache-waste filter (omp) | **2,478** steps, **354,130,045** fresh tokens |

Note AC1's shape: the heaviest step is heavy in *cache-read*, not fresh input — the cost is latency
and input-batch size, not dollars. The report must not conflate the two, or the "most expensive
step" ranking will be dominated by cheap cached turns.
### Design
Three new bounded queries in `packages/domain/src/analytics/forensic-query.ts`, three new artifact
fields in `packages/domain/src/analytics/artifact.ts`, wiring in
`packages/app/src/services/history-service.ts`, and section registration in the task 0555 renderer.

#### Follow the existing shapes, do not invent

`SessionStat` / `ToolStat` in `artifact.ts` are the precedent for a ranked row type; `bySession`
(`forensic-query.ts:234`) is the precedent for a `LIMIT ?`-bounded, selector-scoped, watermark-aware
ranking query — including the `applyWatermarkToWhere` call and the `top` parameter threading from
`HistoryService.analyze`. Copy that structure. A `StepStat` row type alongside `SessionStat` and a
`topSteps*` field alongside `bySession` is the whole surface.

#### One query or three

The three rankings (tokens, duration, cache-efficiency) read the same rows with different `ORDER BY`
and one different `WHERE`. Prefer one row-shape and three narrow queries over one query plus JS
sorting: the `LIMIT ?` bound only means anything if the database does the ordering. Three queries
against an indexed table are cheaper than materializing 89,662 omp steps into JS to sort them.

#### R5 — where "unsupported" is decided

The per-source fidelity verdict is derivable from data already in the artifact: a source with zero
`duration_ms` on assistant rows cannot support the time sections; a source with zero usage cannot
support the token sections. Derive it, do not hard-code a source list — a hard-coded list is wrong
the day tasks 0577 / 0580 land. This is the same lesson as `FULL_FIDELITY_SOURCES`
(`history-service.ts:218`), which currently lists `pi` as full-fidelity while pi carries no tool
calls and 3.7 % content.

#### Anti-patterns — do not implement

- **Do not add a CLI noun or subcommand.** ADR-051 § noun discipline; `analyze` + `report --mode
  forensics` already own this surface. The design doc's F5 suggestion of a new subcommand is
  explicitly rejected in Requirements.
- **Do not emit an unbounded per-step array.** 89,662 omp assistant steps would bloat the artifact
  past usefulness and violate the R2 structural invariant. Top-N only.
- **Do not sort unmeasured durations as 0.** AC3 — a step with no duration is unknown, not fast.
  Exclude it from the duration ranking and say how many were excluded.
- **Do not zero-fill unsupported sources.** AC6 — a table of zeros for claude reads as "claude is
  free and instant", which is how the design doc's first pass nearly mis-ranked the sources.
- **Do not hard-code the fidelity tiers** from the design doc's § 1 table. Derive them; the table is
  a snapshot of a corpus that tasks 0577 / 0578 / 0580 are about to change.
- **Do not bypass the watermark.** R6 — these are message queries and must take
  `WatermarkQueryOptions` like every other one, or they will report rows the rest of the artifact
  excludes.

#### Boundary with sibling tasks

Independent of **0577** / **0578** / **0579** / **0580** — do not sequence behind any of them. Those
tasks change *what the data says*; this task changes *what the artifact reports*, and R5 makes it
correct before and after. When 0580 lands, the derived fidelity verdicts change on their own with no
edit here — that is the test of whether R5 was implemented as derivation or as a hard-coded list.
### Plan
- [x] Read `bySession` (`forensic-query.ts:234`) and `SessionStat`/`ToolStat` (`artifact.ts`) as the shape precedent before writing anything (R1)
- [x] Add the step row type to `artifact.ts` alongside `SessionStat` (R1)
- [x] Add the top-by-tokens query: bounded by `LIMIT ?`, selector-scoped, watermark-aware (R1, R6)
- [x] Add the top-by-duration query, excluding `duration_ms IS NULL` rather than sorting it as 0 (R2, R6)
- [x] Add the cache-efficiency query plus the aggregate fresh-token total for the selector (R3, R6)
- [x] Thread the three results through `HistoryService.analyze` with the `top` bound (R1, R6)
- [x] Derive per-source section support from the data — never a hard-coded source list (R5)
- [x] Register the new sections in the task 0555 report-mode renderer (R4, R5)
- [x] Verify against the real corpus: omp top step ~590K tokens, top duration ~1,412 s, cache section 2,478 steps / 354,130,045 fresh tokens (R1, R2, R3)
- [x] Verify `--source claude` and `--source pi` render unsupported sections rather than zeros (R5)
- [x] Add the tests from R7 (R7)
- [x] Update `docs/04_DESIGN.md` for the artifact shape in the same commit (T3); `bun run lint` / `bun run test` green; re-review the diff (R1–R7)
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/services/history-service.ts:23` |
| `packages/app/src/services/history-service.ts:327` |
| `packages/app/src/services/history-service.ts:340` |
| `packages/app/src/services/history-service.ts:352` |
| `packages/app/src/services/history-service.ts:360` |
| `packages/app/src/services/history-service.ts:448` |
| `packages/app/src/services/history-service.ts:50` |
| `packages/app/src/services/history-service.ts:54` |
| `packages/domain/src/analytics/artifact.ts:120` |
| `packages/domain/src/analytics/artifact.ts:207` |
| `packages/domain/src/analytics/forensic-query.ts:397` |
| `packages/domain/src/analytics/index.ts:12` |
| `packages/domain/src/analytics/index.ts:4` |
| `packages/domain/src/analytics/index.ts:41` |
| `packages/domain/src/analytics/index.ts:52` |
| `packages/domain/src/analytics/index.ts:56` |
| `packages/domain/src/analytics/index.ts:61` |
| `packages/domain/src/analytics/render-forensics.ts:1` |
| `packages/domain/src/analytics/render-forensics.ts:200` |
| `packages/domain/src/analytics/render-forensics.ts:35` |
| `packages/domain/src/analytics/render-forensics.ts:372` |
| `packages/domain/src/analytics/render-forensics.ts:430` |
| `packages/domain/src/analytics/render-forensics.ts:7` |
| `packages/domain/tests/analytics/derived.test.ts:12` |
| `packages/domain/tests/analytics/derived.test.ts:426` |
| `packages/domain/tests/analytics/derived.test.ts:430` |
| `packages/domain/tests/analytics/derived.test.ts:441` |
| `packages/domain/tests/analytics/forensic-query.test.ts:11` |
| `packages/domain/tests/analytics/forensic-query.test.ts:16` |
| `packages/domain/tests/analytics/forensic-query.test.ts:18` |
| `packages/domain/tests/analytics/forensic-query.test.ts:533` |
| `packages/domain/tests/analytics/forensic-query.test.ts:69` |
| `packages/domain/tests/analytics/forensic-query.test.ts:81` |
| `packages/domain/tests/analytics/forensic-query.test.ts:84` |
| `packages/domain/tests/analytics/forensic-query.test.ts:97` |
| `packages/domain/tests/analytics/render-forensics.test.ts:265` |
| `packages/domain/tests/analytics/render-forensics.test.ts:39` |
| `packages/domain/tests/analytics/report-modes.test.ts:47` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Artifact gains additive topStepsByTokens/topStepsByDuration StepStat[] via topStepsByTokens (Q11) and topStepsByDuration (Q12): role=assistant + usage-present/duration-present filters, ORDER BY total-tokens/duration DESC, LIMIT ?. Raw columns preserved incl. costUsd; input is raw input_tokens (fresh for omp convention). Fields optional in HistoryArtifact; schemaVersion stays 1. |
| R2 | MET | All five new queries are LIMIT ?-bounded (cacheWasteAggregate LIMIT 1) and accept WatermarkQueryOptions identically to Q1-Q10; the R2 structural invariant test passes with the new queries in the scanned set. |
| R3 | MET | Renderer prints tokens only: StepStat.costUsd unread, no $/USD/'cost' substring anywhere (asserted in existing + new tests). Cache reuse % = cacheRead/input; aggregate line reports fresh input tokens. |
| R4 | MET | renderPerStep inserted into renderForensics between Per-Tool and Bottleneck sections; reached through the REPORT_MODES registry (forensics) unchanged - smoke report renders all sections. |
| R5 | MET | Pre-0581 artifacts render '> not available - artifact predates the per-step sections'; null tokens/durations render n/a; empty sections render explicit markers; measurement-less sources render no/no/no support cells. Never zeros (tests). |
| R6 | MET | LIMIT ? bound + selector narrowing tested (top=2 returns 2 rows; role filter excludes user rows; ALL returns 3). Cache waste filter uses raw cache_read_tokens < input_tokens * 0.1 (NULL never compares true). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET |  | omp artifact topStepsByTokens[0] = deepseek-v4-flash, input 152, cacheRead 591,744, output 1,775, cost 0.009027, duration 21605.86ms - exact baseline match |
| AC2 | MET |  | LIMIT ?-bounded queries; selector honored via buildMessageWhere; window narrowing unit-verified |
| AC3 | MET |  | omp topStepsByDuration[0] = glm-5.1 at 1,412,287ms with input 0/output 0 (no usage requirement); NULL-duration steps excluded by predicate, asserted in tests |
| AC4 | MET |  | Raw sqlite3 query reproduces 2,478 / 354,130,045 exactly. Analyze path renders 2,475 / 353,571,147 because watermark excludes 3 in-progress trailing steps (AC7 watermark contract); AC4 baseline was raw |
| AC5 | MET |  | history report --mode forensics renders ## Per-Step Analysis via registry (smoke: real omp artifact, 1952-line report with ranked tables) |
| AC6 | MET |  | Measurement-less source: support cells no/no/no plus empty markers; dedicated renderer test |
| AC7 | MET |  | R2 structural scan green for all 5 queries; all accept WatermarkQueryOptions; watermark applied in analyze batch |
| AC8 | MET |  | 13 new tests: forensic-query.test.ts (8: order, top bound, role filter, NULL usage/duration/cache exclusion, per-source support) + render-forensics.test.ts (5: not-available, tables+aggregate, no currency, empty markers, unsupported source) |
| AC9 | MET |  | bun run lint PASS, bun run test PASS (962 domain / 1716 app / 0 fail, full suite), bun run build PASS, corpus-check PASS; docs/04_DESIGN.md updated same commit |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |
### References
- Source analysis: `docs/design/sqlite-forensics-token-time-per-step.md` § 2 (the per-step findings), § 3 (I4), § 4 (F4, F5), § 5 note 1–2.
- Shape precedent: `packages/domain/src/analytics/forensic-query.ts:234` (`bySession` — bounded, selector-scoped, watermark-aware), `packages/domain/src/analytics/artifact.ts` (`SessionStat`, `ToolStat`).
- Wiring site: `packages/app/src/services/history-service.ts:313-350` (the analyze query batch).
- Report-mode registry to register with: task **0555** (`done`) — "Add the report mode registry and the forensics renderer".
- Command that renders this: task **0556** (`done`) — `/sp:dev-find-issue` is already report-first over the data plane, which is why design-doc F7 needs no task.
- Structural invariant these queries must hold: `forensic-query.ts` R2 — no unbounded corpus materialization (`LIMIT ?`).
- Stale fidelity list to avoid copying: `packages/app/src/services/history-service.ts:218` (`FULL_FIDELITY_SOURCES` still lists `pi`).
- Independent siblings: **0577**, **0578**, **0579**, **0580** — none blocks this task.
- Surface-doc obligation: `docs/04_DESIGN.md` same commit (constitution T3).
### History
- 2026-08-17T21:38:30.573Z todo → wip (system)
- 2026-08-17T21:38:30.864Z wip → testing (system)
- 2026-08-17T21:39:00.104Z testing → done (system)
