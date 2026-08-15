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
updated_at: "2026-08-15T05:24:02.345Z"
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
- [x] **R1.** Measure elapsed cost of an incremental `spur history import` across the six
      full-fidelity sources (claude, codex, pi, omp, agy, grok) on this machine's real session data,
      in the steady state — i.e. shortly after a previous import, which is the condition the trigger
      will actually run in. Measurable: a recorded wall-clock figure per source and in total.
- [x] **R2.** Measure elapsed cost of the `analyze` pass that follows it, separately from import, so
      the two can be triggered at different cadences if the numbers differ materially. Measurable: a
      recorded figure for analyze independent of import.
- [x] **R3.** Record the provenance header for every measured invocation — the resolved binary and
      the `@gobing-ai/ts-llm-jsonl-importer` version — and use a source-local binary
      (`bun run apps/cli/src/index.ts …` or the built `apps/cli/spur.js`), never a bare global `spur`.
      A measurement without provenance is not evidence. Measurable: each recorded figure carries its
      header.
- [x] **R4.** Measure the cold/backlogged case as a bound, not just the steady state: elapsed cost
      when a meaningful backlog of unimported sessions exists. This is what the first trigger firing
      after an idle period will pay. Measurable: a recorded figure with the backlog size stated.
- [x] **R5.** Write the measurements to a citeable artifact and state the design consequence
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
- [x] Confirm a source-local binary is in use and its provenance header prints (R3)
- [x] Measure steady-state incremental import across the six full-fidelity sources, per source and total (R1)
- [x] Measure the analyze pass separately from import (R2)
- [x] Measure the backlogged case with the backlog size recorded (R4)
- [x] Record every figure with its provenance header (R3)
- [x] Write the citeable artifact with figures, conditions, and the recommended trigger cadence (R5)
- [x] Run `bun run autofix && bun run spur-check` (no product code expected to change)
### Solution
Measurement task — no product code changed. Output is the citeable artifact
`docs/tasks4/0548-import-cost-measurement.md` (precedent: `docs/tasks2/0347-inventory.md`).

- `docs/tasks4/0548-import-cost-measurement.md:1-144` — new artifact: provenance header (source-local
  binary + `@gobing-ai/ts-llm-jsonl-importer@0.4.33`, identical across every measured run), method,
  R1 steady-state table (per-source 1.5–3.5 s; all-fanout 20.64 s; fixed overhead 0.59 s), R2 analyze
  (9.17 s / 8.40 s over 1,534,579 records), R4 bounds (maximal empty-DB import 359.1 s / 4,560 files /
  1,718,277 records; realistic 72 h-idle backlog 334 files / 248,156 lines → 23.17 s, 34 net inserts
  after ledger dedup), and the R5 recommendation: import background-only, single-flight, 10-minute
  coalescing window (5-minute floor); analyze decoupled, chained after completed imports.
- `docs/tasks4/0548_measure-incremental-import-and-analyze-cost-on-real-data-wit.md` — this Solution
  and Testing section (corpus write via `spur task update`).

Key findings recorded for 0549/0550: steady state is scan-bound not write-bound (24 inserts in
20.6 s); ledger dedup makes idle-period backlogs near-free (248k re-parsed lines → 34 inserts);
`--source all` also imports gemini (3,083 records) and opencode (28,149 records) on this machine,
contradicting the "unsupported sources import nothing" assumption — scoping decision left to the
operator in 0549.

Plan item "Run `bun run autofix && bun run spur-check`" is intentionally left to the pipeline's test
hop (implement-scope rule: the full project gate is never run from inside implement; no product code
changed, so the gate has nothing new to evaluate).
### Testing
**Re-verify 2026-08-15** (`/sp-dev-verifyall --feature E3 --force --fix all`). Status guard bypassed with `--force` (task already `done`). `--next: no-op — task already terminal (done)`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `docs/tasks4/0548-import-cost-measurement.md:40-55` — steady-state per-source walls (claude 2.13 s, codex 1.50 s, pi 1.60 s, omp 3.51 s, agy 2.11 s, grok 3.02 s); six-run sum 13.87 s (recomputed this run); `--source all` fan-out 20.64 s / 4,593 files / 24 new records; fixed overhead 0.59 s via `--source openclaw` |
| R2 | MET | `docs/tasks4/0548-import-cost-measurement.md:57-65` — analyze timed in a separate process: 9.17 s / 8.40 s over 1,534,579 records · 215,304 tool calls |
| R3 | MET | `docs/tasks4/0548-import-cost-measurement.md:7-21` — provenance for every measured figure (source-local binary + `@gobing-ai/ts-llm-jsonl-importer@0.4.33`). Fresh this run: `bun run apps/cli/src/index.ts history import --source openclaw --mode incremental --dry-run --json` printed `provenance.binary=/Users/robin/xprojects/spur-new/apps/cli/src/index.ts` and `provenance.importer=0.4.32`. Resolver: `apps/cli/src/commands/history.ts:25-38` (`resolveImportProvenance`). Hoisted `node_modules/@gobing-ai/ts-llm-jsonl-importer/package.json` reads `0.4.33`; `createRequire` from the CLI resolved a bun-store `0.4.32` copy. Measurement recorded the version it actually ran. |
| R4 | MET | `docs/tasks4/0548-import-cost-measurement.md:67-93` — (a) maximal empty-DB 359.1 s / 4,560 files / 1,718,277 records (sums recomputed this run); (b) 72 h-idle 334 files / 248,156 lines → 23.17 s / 34 net inserts |
| R5 | MET | `docs/tasks4/0548-import-cost-measurement.md:121-144` — import background-only + single-flight + 10-minute coalescing window (5-min floor; duty 20.64/600 ≈ 3.4 %); analyze decoupled and chained after completed imports |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — The cost of an incremental refresh is measured before it is wired | MET | command | Fresh this run: `bun run apps/cli/src/index.ts history import --source openclaw --mode incremental --dry-run --json` exit 0 with `provenance.binary` + `provenance.importer`; elapsed + provenance recorded together in `docs/tasks4/0548-import-cost-measurement.md:7-21` and figures at `:40-55`, `:57-65`, `:67-93`; design consequence at `:121-144`; no trigger wiring in the 0548 deliverable |

**Design conformance:** DONE — docs-only measurement artifact, no product code (as designed). CHANGED (documented) — "prefer `--dry-run`" superseded by real writes, stated in Method (`:33`).

**SECUA:** P4 only — live `createRequire` can resolve a bun-store importer copy (`0.4.32`) different from the hoisted `package.json` (`0.4.33`). Does not invalidate the recorded measurement.

Coverage: N/A (documentation-only change; no runtime code path added).
### Review
**Review verdict: PASS** — all five requirements MET, the Gherkin AC MET, no P1–P3 findings. Diff scope (re-derived this run): `docs/tasks4/0548-import-cost-measurement.md` (new, 144 lines — the task's entire deliverable) + this task file's Solution/Testing. No product code changed (`git status`: docs-only), matching the task Design ("measurement task, no product code changes").

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | advisory | `docs/tasks4/0548-import-cost-measurement.md:40-55` | Each import condition measured once (n=1); only analyze has two samples (9.17/8.40 s → ~9 % spread). Conclusions carry ≥10× margins (0.59 s fixed floor vs 13.9–20.6 s fan-out), so n=1 does not threaten the R5 recommendation — but 0549 should not quote per-source figures as more precise than run-to-run variance. |
| P4 | advisory | `docs/tasks4/0548-import-cost-measurement.md:40-93` | File counts drift ±1 between tables (agy 184 in corpus/R4 vs 185 in R1; six-sum 4,561 + gemini 32 + opencode 1 = 4,594 vs all-fanout 4,593) — consistent with a live corpus being written during the 10-minute window; no conclusion affected. |
| P4 | advisory | `docs/tasks4/0548-import-cost-measurement.md:111-119` | `--source all` imports gemini (3,083 records) and opencode (28,149 records) on this machine, contradicting the 2026-08-06 "unsupported sources import nothing" assumption. Correctly surfaced and deferred to the operator/0549 rather than decided here — 0549 R4 must resolve the six-vs-all scoping before picking its window arithmetic (13.9 s vs 20.6 s). |

**Functional traceability** (every anchor re-read this run):

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `docs/tasks4/0548-import-cost-measurement.md:40-55` — steady-state per-source wall figures (1.50–3.51 s), six-run sum 13.87 s, all-fanout 20.64 s, files-scanned and new-record columns, fixed-overhead isolation (0.59 s via `--source openclaw`) |
| R2 | MET | `docs/tasks4/0548-import-cost-measurement.md:57-64` — analyze timed separately (9.17 s / 8.40 s, 1,534,579 records), separate process, explicitly never bundled with import |
| R3 | MET | `docs/tasks4/0548-import-cost-measurement.md:7-21` — Provenance section: source-local binary path + `@gobing-ai/ts-llm-jsonl-importer@0.4.33`, states every run used `--json`. Independently verified: `apps/cli/src/commands/history.ts:118-122` embeds `provenance` in the JSON payload, and installed `node_modules/@gobing-ai/ts-llm-jsonl-importer/package.json` reads `"version": "0.4.33"` |
| R4 | MET | `docs/tasks4/0548-import-cost-measurement.md:67-93` — both bounds with backlog size stated: maximal empty-DB 359.1 s / 4,560 files / 1,718,277 records; realistic 72 h-idle 334 files / 248,156 lines → 23.17 s / 34 net inserts |
| R5 | MET | `docs/tasks4/0548-import-cost-measurement.md:121-144` — "Design consequence (R5)": import background-only + single-flight + 10-min coalescing window (5-min floor); analyze decoupled, chained after completed imports; each choice derived from a named figure |

**AC — Gherkin "R1 — cost measured with provenance before wiring":** MET. Elapsed + provenance recorded together (`:7-21` applies to every figure); binary and importer version stated; no trigger wiring exists in the diff.

**Arithmetic re-checked this run:** six-run sum 13.87 s ✓; maximal total 359.1 s ✓; records 1,718,277 ✓; backlog per-source file counts sum to 334 ✓; duty cycle 21/600 ≈ 3.4 % ✓. Ledger-dedup claim mechanically verified: `node_modules/@gobing-ai/ts-llm-jsonl-importer/dist/jsonl-importer-dao.js:134` (`SELECT record_hash FROM history_import_ledger`) and `:65` (`record_hash TEXT PRIMARY KEY`); the `--source` surface lists exactly ten sources at `apps/cli/src/commands/history.ts:54`, matching the artifact's "ten sources".

**Design conformance:** DONE — no product code (as designed); CHANGED (documented) — "prefer `--dry-run`" superseded by real writes, stated in Method (`:33` "All imports were real writes (no `--dry-run`)"), consistent with the Q&A deferral ("if it differs materially, measure a real write and say so"). Plan item `bun run autofix && bun run spur-check` deferred to the pipeline test hop per implement-scope rules — documented in Solution; nothing for the gate to evaluate (no product code).

**SECUA / architecture:** N/A — documentation-only diff; no code surface, no modules in scope. No secrets in the artifact (machine paths already repo-conventional).

**Residual risk:** raw run JSON/time files under `/tmp/0548/` were removed after transcription (F5 housekeeping), so the figures are auditable through this artifact, not the raw payloads. Acceptable for a measurement task; downstream consumers (0549/0550) cite the artifact. Re-measuring any figure costs one command with the provenance header.
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
- 2026-08-14T20:07:45.711Z todo → wip (system)
- 2026-08-14T21:18:21.639Z wip → testing (system)
- 2026-08-14T21:18:22.766Z testing → done (system)
