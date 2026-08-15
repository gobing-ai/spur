---
template: feature-impl
schema_version: 1
name: "Measure incremental import and analyze cost on real data with provenance"
description: ""
status: done
type: task
profile: standard
feature_id: E3
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T00:48:40.539Z"
updated_at: "2026-08-15T03:15:30.997Z"
---

## 0548. Measure incremental import and analyze cost on real data with provenance

### Background
Feature E3 rests on an operator premise: *"the conversation data in database is almost align with the
external data files, so the importing and analyzing cost is not too much and acceptable for daily
operation."* That is plausible for incremental import — E1 shipped
`history_import_checkpoint` / `history_import_ledger` verified against real append-only growth — but
it is **unmeasured**, and it decides the whole design of the trigger.

This repo has a specific scar from assuming import behaviour. AGENTS.md records it: the 2026-08-10
backfill ran old code for ~83 s because a stale global `spur` shadowed the monorepo build. That is
why every `spur history import` invocation now prints a provenance header (`binary:` plus the
resolved `@gobing-ai/ts-llm-jsonl-importer` version), and why real-data validation must use a
source-local binary rather than a bare global `spur`.

This task produces the number, with that provenance recorded. It gates tasks 0549 and 0550: a
sub-second refresh may fire liberally; a multi-second one is background-only with a wide coalescing
window.
### Requirements
- [ ] **R1.** Measure elapsed cost of an incremental `spur history import` across the six
      full-fidelity sources (claude, codex, pi, omp, agy, grok) on this machine's real session data,
      in the steady state — i.e. shortly after a previous import, which is the condition the trigger
      will actually run in. Measurable: a recorded wall-clock figure per source and in total.
- [ ] **R2.** Measure elapsed cost of the `analyze` pass that follows it, separately from import, so
      the two can be triggered at different cadences if the numbers differ materially. Measurable: a
      recorded figure for analyze independent of import.
- [ ] **R3.** Record the provenance header for every measured invocation — the resolved binary and
      the `@gobing-ai/ts-llm-jsonl-importer` version — and use a source-local binary
      (`bun run apps/cli/src/index.ts …` or the built `apps/cli/spur.js`), never a bare global `spur`.
      A measurement without provenance is not evidence. Measurable: each recorded figure carries its
      header.
- [ ] **R4.** Measure the cold/backlogged case as a bound, not just the steady state: elapsed cost
      when a meaningful backlog of unimported sessions exists. This is what the first trigger firing
      after an idle period will pay. Measurable: a recorded figure with the backlog size stated.
- [ ] **R5.** Write the measurements to a citeable artifact and state the design consequence
      explicitly: whether the trigger may run per-operation, or must be background-only with a
      coalescing window, and what window size the numbers imply. Measurable: the artifact names a
      recommended cadence and the figures it follows from.
### Acceptance Criteria
Covers feature E3 scenario:

- **R1 — The cost of an incremental refresh is measured before it is wired**

```gherkin
Scenario: R1 — The cost of an incremental refresh is measured before it is wired
  Given this machine's real agent session data
  When an incremental import followed by analyze is run and timed
  Then the elapsed cost is recorded together with the import provenance header
  And the recorded measurement states which binary and importer version produced it
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Which binary?** A source-local one — `bun run apps/cli/src/index.ts …` or built `apps/cli/spur.js`.
  Never a bare global `spur`; AGENTS.md mandates this after the 2026-08-10 incident.
- **Steady state or cold?** Both, reported separately: steady state decides the cadence, the
  backlogged case bounds the first firing after an idle period.
- **Import and analyze together or apart?** Apart (R2) — they may differ by an order of magnitude and
  can then be triggered at different cadences.
- **Does this change product code?** No. Measurement plus a citeable artifact.

**Deferred with owner.**

- **Measuring the five unsupported sources** — owner: operator, blocked by the 2026-08-06
  source-support ruling. They import nothing, so they contribute no cost.
- **Whether write cost differs materially from `--dry-run`** — resolve during measurement; if it does,
  measure a real write and say so in the artifact.
### Design
**This is a measurement task, not an implementation task.** It changes no product code. Its output is
an artifact other tasks cite — the same shape as task 0347's inventory
(`docs/tasks2/0347-inventory.md`).

**Measure the condition the trigger will run in (R1).** A cold full import is the wrong number: the
trigger fires after operations, when the previous import was minutes ago. Measure the steady state
first, then the backlogged case as an upper bound (R4).

**Separate import from analyze (R2).** They may differ by an order of magnitude. If import is cheap
and analyze is expensive, the right design is frequent import with a lazier analyze — a conclusion
unavailable from a single combined number.

**Provenance is not optional (R3).** AGENTS.md mandates it precisely because a stale global `spur`
silently produced an 83-second result that was attributed to the code under test. Use
`bun run apps/cli/src/index.ts history import …` or the built `apps/cli/spur.js`. If the header does
not appear, stop and fix the invocation rather than recording the number.

**Prefer `--dry-run` where it measures the same work.** A dry-run that performs the same scan and
parse without writing gives a comparable figure without mutating the local database. Where write cost
is material to the answer, measure a real write and say so.

**State the consequence (R5).** A table of milliseconds that stops short of "therefore the trigger
should…" leaves the next task to re-derive the judgement. Name the recommended cadence.

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Import command | `spur history import` — `--mode <full\|incremental\|force-file>`, default `incremental` | `apps/cli/src/commands/history.ts:57`, `:77` |
| Daily pipeline | `spur history daily` — import-all fan-out → analyze → artifact | `history.ts:203-217` |
| Invocation (mandated) | `bun run apps/cli/src/index.ts history import …` or built `apps/cli/spur.js` | AGENTS.md § Build & repo commands |
| Provenance header | `binary:` + resolved `@gobing-ai/ts-llm-jsonl-importer@<version>`; `--json` embeds `provenance` | same |
| Full-fidelity sources | `claude` · `codex` · `pi` · `omp` · `agy` · `grok` | feature E1 § In |
| Unsupported sources | `gemini` · `opencode` · `antigravity-ide` · `openclaw` · `hermes` | feature E1 § Out of scope (2026-08-06) |
| Checkpoint tables | `history_import_checkpoint` · `history_import_ledger` | feature E1 |
| Output artifact | a citeable measurement file, precedent `docs/tasks2/0347-inventory.md` | — |

**No product code changes.** This task measures and writes an artifact.

#### Anti-patterns — what not to implement

- Do **not** measure with a bare global `spur`. The 2026-08-10 backfill ran old code for ~83 s exactly
  that way; a figure without a provenance header is not evidence.
- Do **not** report one combined import+analyze number (R2). If import is cheap and analyze is
  expensive, the right design is frequent import with a lazier analyze — a conclusion a single number
  hides.
- Do **not** measure only a cold full import. The trigger fires in the steady state; that is the
  number that decides the cadence (R1), with the backlogged case as an upper bound (R4).
- Do **not** stop at a table of milliseconds (R5). State the cadence the figures imply, or the next
  task re-derives the judgement.
- Do **not** change product code to make measuring easier.

#### Cross-task contract

**Assumes from upstream:** nothing — root of feature E3's chain.

**Leaves for dependents:** tasks **0549** and **0550** take their cadence and coalescing window from
this artifact (0549 R4 requires the window be traceable to a figure here). A missing or vague
recommendation blocks them.
### Plan
- [ ] Confirm a source-local binary is in use and its provenance header prints (R3)
- [ ] Measure steady-state incremental import across the six full-fidelity sources, per source and total (R1)
- [ ] Measure the analyze pass separately from import (R2)
- [ ] Measure the backlogged case with the backlog size recorded (R4)
- [ ] Record every figure with its provenance header (R3)
- [ ] Write the citeable artifact with figures, conditions, and the recommended trigger cadence (R5)
- [ ] Run `bun run autofix && bun run spur-check` (no product code expected to change)
### Solution
Measurement-only task. No product code.

| File | What / why |
| --- | --- |
| `docs/design/0548-measurement.md:1-71` | Citeable cost artifact: provenance, per-source incremental dry-run, separate analyze, cold full dry-run, recommended 60 s background debounce. |
### Testing
**Verify 2026-08-15.** Measurement artifact landed. Coverage: N/A (documentation-only change; no runtime code path added).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Steady-state incremental dry-run table in `docs/design/0548-measurement.md:22-35` (per-source and 10 495 ms total). |
| R2 | MET | Analyze timed separately at 33 150 ms (`docs/design/0548-measurement.md:37-41`). |
| R3 | MET | Provenance table: source-local `apps/cli/src/index.ts` + `@gobing-ai/ts-llm-jsonl-importer@0.4.32` (`docs/design/0548-measurement.md:7-19`). |
| R4 | MET | Cold full dry-run 59 156 ms with file counts (`docs/design/0548-measurement.md:43-57`). |
| R5 | MET | Recommended cadence: background-only, `debounce_ms: 60000` (`docs/design/0548-measurement.md:59-70`). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — The cost of an incremental refresh is measured before it is wired | MET | command | `bun run apps/cli/src/index.ts history import --source claude --mode incremental --dry-run --json` printed `binary:` + `importer: 0.4.32`; figures recorded in `docs/design/0548-measurement.md`. |

**Design conformance:** DONE — measurement artifact, no product-code change.

**SECUA:** P4 — no product-code diff.
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | Measurement-only; no product-code risk. |
### References
- **Provenance mandate:** `AGENTS.md` § *Build & repo commands* — "Real-data history validation must
  use a source-local binary (task 0504 R4)"; every `spur history import` prints `binary:` plus the
  resolved `@gobing-ai/ts-llm-jsonl-importer` version, and `--json` embeds the same `provenance` field
- **The incident this guards against:** the 2026-08-10 backfill ran old code for ~83 s via a stale
  global `spur` (AGENTS.md, same section)
- **Command surface:** `apps/cli/src/commands/history.ts:57` (`--mode full|incremental|force-file`),
  `:77` (default `incremental`), `:203-217` (`daily` = import-all → analyze → artifact)
- **Incremental machinery:** `history_import_checkpoint` / `history_import_ledger` (feature E1,
  verified against real append-only growth)
- **Full-fidelity sources:** claude, codex, pi, omp, agy, grok (feature E1 § In); unsupported —
  gemini, opencode, antigravity-ide, openclaw, hermes (E1 § Out of scope, operator ruling 2026-08-06)
- **Artifact precedent:** `docs/tasks2/0347-inventory.md`
- **Downstream consumers:** tasks 0549 and 0550, whose design depends on this number
### History
- 2026-08-15T00:55:19.552Z todo → wip (system)
- 2026-08-15T00:55:20.122Z wip → testing (system)
- 2026-08-15T00:55:47.903Z testing → done (system)
