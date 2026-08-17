---
template: issue
schema_version: 1
name: "Close the release + re-import gap so landed mapper fixes reach the data plane"
description: ""
status: todo
type: issue
profile: standard
feature_id: E5
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-17T19:04:21.856Z"
updated_at: "2026-08-17T19:07:25.554Z"
---

## 0578. Close the release + re-import gap so landed mapper fixes reach the data plane

### Background
From the root-cause pass on `docs/design/sqlite-forensics-token-time-per-step.md` (issue **I0**,
fix **F0**), 2026-08-17.

Two E5 tasks are marked `done` with correct upstream code and essentially zero effect on the
imported corpus. Nothing is wrong with what they wrote — the fixes never travelled from ts-libs
source to `.spur/spur.db`.

#### Two independent gaps

**Gap 1 — the release never arrived.** `~/xprojects/ts-libs/packages/llm-jsonl-importer` is at
**0.4.35** and already contains task 0564 R1: `call_id` on `history_tool_call`, and omp tool timing
from `details.wallTimeMs` (`packages/llm-jsonl-importer/src/mappers.ts:418,489-491`). Spur has
**0.4.33** installed, whose `ompSplit` still hard-codes
`started_at: undefined, completed_at: undefined, duration_ms: undefined`
(`node_modules/@gobing-ai/ts-llm-jsonl-importer/dist/mappers.js:388-391`).

**Gap 2 — `import` never revisits old rows.** `spur history import` is checkpoint-resumed and
additive, so a mapper improvement only affects records imported *after* it ships. Task 0553 (`done`)
allowlists omp `todo` args (`TODO_TOOL_ALLOWLIST.omp = ['TodoWrite','todo']`, `mappers.js:93-101`).
The corpus holds **3,237 omp `todo` tool calls** — every one of them allowlist-eligible — and
**6** carry `args_raw`. The other 3,231 predate the 0553 release and will never be re-read.

#### Measured state (`.spur/spur.db`, 2026-08-17)

| Signal | Expected after 0553 / 0564 | Actual | Cause |
| --- | --- | --- | --- |
| `history_tool_call.args_raw` non-null | ~4,572 todo calls | **6 of 232,429** | Gap 2 |
| omp `history_tool_call.duration_ms` non-null | 101,785 | **0** | Gap 1 + Gap 2 |
| omp `started_at` / `completed_at` | 101,785 | **0 / 0** | Gap 1 + Gap 2 |
| `history_tool_call.call_id` column | present | absent from 0.4.33 | Gap 1 |

Downstream, this is the sole cause of design-doc issues **I2** (Per-Tool exec time empty for the
richest source) and **I3** (`phaseSupport: 'unsupported'`, because `todoToolCalls` filters on
`tc.args_raw IS NOT NULL` at `forensic-query.ts:458`). Both were filed as unwritten code; both are
already written.

The same gap will silently swallow task **0577** (pi mapper) and task **0580** (codex/claude/agy
mappers) unless the delivery path is closed first.
### Requirements
- **R1** — Spur consumes `@gobing-ai/ts-llm-jsonl-importer@0.4.35` (or later): bump the dependency, `bun update` the workspaces that resolve it, and confirm the resolved version through the import provenance header rather than the lockfile alone.

- **R2** — The existing corpus is re-imported so already-landed retention takes effect: `spur history import --mode full` for every source whose mapper changed between 0.4.33 and the adopted version, invoked from a **source-local binary** per the CLAUDE.md § "Build & repo commands" contract (task 0504 R4), with the provenance header recorded in the task before and after.

- **R3** — The todo allowlist covers the tool names the corpus actually contains. Observed today: `todo` (3,237), `todo_write` (954), `todowrite` (379), `todoread` (2). `TODO_TOOL_ALLOWLIST` currently lists `claude: ['TodoWrite']`, `pi: ['todo']`, `omp: ['TodoWrite','todo']`, `codex: ['update_plan']`, `grok: ['todo_write']`, `agy: []`, `gemini: []` — reconcile it against the measured names before the re-import, so one pass populates everything.

- **R4** — Re-import is safe and observable: it does not duplicate rows (record-hash identity holds), does not lose sources on partial failure, and reports per-source before/after counts. A dry-run precedes the write run.

- **R5** — "Retention work is done" is redefined to require **data-plane evidence**. A task claiming an import-side retention fix cites a query against `.spur/spur.db` showing the populated column, not a source diff or a passing unit test. Record this where the next agent will read it — the E5 feature notes and `docs/design/sqlite-forensics-token-time-per-step.md` § 5 — and re-open or annotate tasks 0553 and 0564 with the measured result of this task rather than leaving them silently overstated.

#### Out of scope / non-goals
| Not in this task | Why |
| --- | --- |
| Writing new mapper logic | 0564's omp timing is already written upstream. New mapper work is tasks **0577** (pi) and **0580** (codex/claude/agy/tool_name/epoch-0). This task delivers what exists. |
| The span-math bug | Sentinel timestamps poisoning `timeDecomposition` are task **0579**, independent of delivery. |
| Per-step artifact sections | Task **0581**. |
| Changing the checkpoint/resume design | Incremental import staying incremental is correct. The gap is that no *backfill* path exists; adding an explicit full re-import step is the fix, not removing resume. |
### Acceptance Criteria
- **AC1 (R1)** — `bun pm ls | grep ts-llm-jsonl-importer` (or the workspace equivalent) resolves ≥ `0.4.35`, **and** `bun run apps/cli/src/index.ts history import --dry-run` prints a provenance header naming that same version. Both are recorded; the lockfile alone is not evidence.

- **AC2 (R1)** — `history_tool_call` has a `call_id` column after migration (`PRAGMA table_info(history_tool_call)` includes it), confirming 0564's schema increment applied.

- **AC3 (R2)** — Given the corpus before this task, when `--mode full` re-import completes, then `SELECT COUNT(*) FROM history_tool_call tc JOIN history_message m ON m.record_hash=tc.message_hash WHERE m.source='omp' AND tc.duration_ms IS NOT NULL` is **> 0** where it is **0** today (of 101,785 omp tool calls). `started_at` / `completed_at` likewise.

- **AC4 (R2, R3)** — `SELECT COUNT(*) FROM history_tool_call WHERE args_raw IS NOT NULL` rises from **6** to the same order as the todo-call population (~4,572 across sources; ~3,237 for omp alone).

- **AC5 (R3, R2)** — `spur history analyze --source omp --json` reports `derived.phases.phaseSupport === 'supported'` with a non-empty `phases` array, where it reports `'unsupported'` today. This is the end-to-end proof that I2 and I3 were delivery failures, not missing code.

- **AC6 (R4)** — Row counts per source after re-import match the pre-import counts within the expected delta (new sessions only) — no duplication. Recorded as a before/after table: omp 267,969 · grok 758,572 · codex 253,112 · pi 209,393 · claude 95,050 · agy 58,670 · opencode 11,609 · gemini 1,830.

- **AC7 (R4)** — A `--dry-run` import is run and its output recorded before the write run.

- **AC8 (R5)** — The data-plane-evidence rule is written into the E5 feature notes and `docs/design/sqlite-forensics-token-time-per-step.md` § 5, and tasks 0553 and 0564 carry a dated note stating the measured post-re-import result.

- **AC9** — `bun run lint`, `bun run test`, and `bun run build` green after the dependency bump.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
**No new API.** No new CLI noun, verb, or flag — `spur history import --mode full` already exists and
is the delivery mechanism. The work is a dependency bump, an allowlist reconcile, one re-import, and
a documented contract.

#### Order matters

Reconcile the allowlist (R3) **before** the re-import (R2). The re-import is the expensive step
(209k pi rows, 268k omp rows, ~1.6M rows total); running it against a stale allowlist means running
it twice. If the allowlist reconcile turns out to need an upstream release of its own, land that
release first and re-import once.

#### Where the allowlist lives

`TODO_TOOL_ALLOWLIST` is in the importer, not in Spur
(`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts`, compiled to
`dist/mappers.js:93-101`). Reconciling it is an upstream edit + release, sharing the release train
with tasks 0577 and 0580. Coordinate: one ts-libs release carrying pi (0577), allowlist (this task),
and the 0580 mapper fixes is one re-import instead of three.

#### Anti-patterns — do not implement

- **Do not remove or weaken checkpoint-resume.** Incremental import is correct for steady-state.
  The defect is the absence of a *backfill* path, not the presence of resume.
- **Do not hand-write a SQL backfill** that patches `args_raw` / `duration_ms` in place. The raw
  JSONL is the authority; a re-import is the mechanism that already exists and stays correct as
  mappers evolve.
- **Do not use a global `spur` binary** for the validation runs. CLAUDE.md § "Build & repo commands"
  records the 2026-08-10 incident where a stale global binary ran old code for ~83 s and certified
  the wrong result. Invoke `bun run apps/cli/src/index.ts …` or the built `apps/cli/spur.js`.
- **Do not mark this done on a source diff or a green unit test.** R5 exists because that is exactly
  how 0553 and 0564 reached `done` while the corpus stayed empty.

#### Blast radius

A `--mode full` re-import rewrites `history_message` / `history_tool_call` rows for every re-read
source. Task 0576 is `wip` in the same tree and reads those tables; its AC3 quotes pi baselines
(209,393 / 16,424 / 1 session) that this re-import will move. Sequence around it, or re-measure
0576's baseline afterwards — do not let both land unmeasured on the same day.

#### Handoff

- **0577** (pi mapper) and **0580** (codex/claude/agy) both need the delivery path this task opens.
  If they land in the same ts-libs release, this task's re-import serves all three; state in
  Solution which releases were folded in.
- **0579** and **0581** are independent — do not block them on this.
### Plan
- [ ] Record the before-state: per-source row counts, `args_raw` non-null (6), omp `duration_ms` non-null (0), `phaseSupport` for omp, installed importer version (R2, R4)
- [ ] Reconcile `TODO_TOOL_ALLOWLIST` against the measured tool names (`todo`, `todo_write`, `todowrite`, `todoread`) in ts-libs; release if it changes (R3)
- [ ] Coordinate the ts-libs release train with tasks 0577 and 0580 so one re-import serves all three; note which releases folded in (R1, R3)
- [ ] Bump and `bun update` the importer to ≥ 0.4.35 in the dependent workspaces (R1)
- [ ] Confirm the resolved version via the import provenance header, not the lockfile (R1)
- [ ] Confirm the `call_id` column exists after migration (R1)
- [ ] `spur history import --mode full --dry-run` from a source-local binary; record the output (R4)
- [ ] `spur history import --mode full` write run from the same binary; record the provenance header (R2)
- [ ] Re-run the before-state queries and diff them into a before/after table (R2, R4)
- [ ] Confirm `analyze --source omp --json` reports `phaseSupport: 'supported'` (R3)
- [ ] Write the data-plane-evidence rule into E5 notes + design doc § 5; annotate 0553 and 0564 with the measured result (R5)
- [ ] `bun run lint` / `bun run test` / `bun run build` green; re-review the diff (R1)
### Root Cause
Two independent breaks in one delivery path, both verified 2026-08-17.

**1. Version skew.** ts-libs `packages/llm-jsonl-importer/package.json` → `0.4.35`, containing 0564's
`call_id` (`src/mappers.ts:418`) and `details.wallTimeMs` extraction (`:489-491`). Spur's
`node_modules/@gobing-ai/ts-llm-jsonl-importer/package.json` → `0.4.33`, whose `ompSplit` writes
`duration_ms: undefined` unconditionally (`dist/mappers.js:388-391`). The task was completed in one
repo and never pulled into the other.

**2. Additive import.** `spur history import` resumes from `history_import_checkpoint` and appends to
`history_import_ledger`; a record already in the ledger is never re-read. So a mapper improvement is
retroactive to nothing. Proof, isolating this from gap 1: 0553's allowlist path exists in the
**installed** 0.4.33 (`dist/mappers.js:93-115`), `omp`+`todo` is allowlisted, the corpus has 3,237
matching calls — and 6 have `args_raw`. The 6 are the ones imported after 0553 shipped.

Neither gap is visible from inside either repo. ts-libs sees green tests; Spur sees a passing
`spur-check`; only a query against `.spur/spur.db` shows the retention is absent — which is why R5
changes what "done" means for this class of work.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Source analysis: `docs/design/sqlite-forensics-token-time-per-step.md` § 3 (I0, I2, I3) and § 4 (F0).
- Tasks whose effect this delivers: **0553** (todo-arg allowlist + per-call latency, `done`), **0564** (omp tool-call durations, `done`).
- Tasks sharing the ts-libs release train: **0577** (pi mapper), **0580** (codex/claude/agy mappers).
- Independent siblings: **0579** (span sanitization), **0581** (per-step artifact sections).
- Concurrent reader of the same tables: **0576** (`wip`) — its AC3 pi baselines move when this re-imports.
- Re-import contract (source-local binary + provenance header): `CLAUDE.md` § "Build & repo commands", task 0504 R4.
- Upstream: `~/xprojects/ts-libs/packages/llm-jsonl-importer` — `src/mappers.ts:93-101` (allowlist), `:418` (`call_id`), `:489-491` (`wallTimeMs`).
- Consumer that the empty `args_raw` disables: `packages/domain/src/analytics/forensic-query.ts:458` (`todoToolCalls`), `packages/domain/src/analytics/derived.ts:250` (`phaseSupport`).
### History
