# Task pipeline — rewritten pipeline vs the 32-run baseline (task 1240)

**Current status: three real D65 task pipelines completed with full gates and recorded PASS.** These are certification-only runs of existing implementations; they demonstrate pipeline completion, not implementation speedup. Section 7 is the current result. Sections 1–6 preserve the earlier unsuccessful measurements and the unchanged historical baseline.

Measurement record for feature D65 P2 exit. Read with
[workflow-execution-foundation](../../docs/design/workflow-execution-foundation.md) §1 (the issue
this measures) and ADR-140 (the rewrite whose benefit is being checked).

- **Historical status (2026-10-17): partial — 0 of 3 runs completed.** The baseline is complete and reproducible. Three more
  rewritten-pipeline runs were launched in this session (M1–M3, §4.8–§4.10) against `7b0298dda`, the commit
  that was supposed to unblock certification. **None reached `done`, and the two blockers are not the two
  that were fixed:**
  1. **The review answer contract is still unmatched (§4.8, finding 13).** `7b0298dda` widened the accepted
     *table header* vocabulary, but the live `/sp:dev-review --auto` answer carries neither a bare
     `Verdict: PASS` line (it writes `**Verdict: PASS** — 0 P1, 0 P2, …`) nor a per-requirement table (it
     writes a run-level `| WBS | Verdict | P1 | P2 |` table). `spur task verdict --from-answer` on the
     captured answer exits 1 with `verdict-missing` plus `req-missing` for R1/R2/R3 and writes no
     `1243-verdict.json`. This is measured on the engine's own captured answer this time, not on a
     reconstruction.
  2. **The `claude` account hit its session limit mid-session (§4.9, §4.10).** M1's second repair hop died
     with exit code 3 (`You've hit your session limit · resets 8pm (America/Los_Angeles)`), and M2 and M3 —
     fresh probes, one launch each — died the same way inside `implement` after 4.6 s and 5.8 s. No further
     agent work was possible in this session with the approved executor.
- **What is missing:** runs that reach `done` (§5), and with them any per-stage mean for the rewrite. What
  the data does support: gate cost and receipt reuse (seven gate visits across the sessions, five of them
  full runs, one of those a full re-run after a repair hop), the repair hop's real cost, and the fact that
  the review certification blocks `done` for a second, differently-shaped reason than the one that was
  fixed.
- **Cutoff:** 2026-10-17T23:37:04.738Z — M3's `implement` failure (the last agent dispatch this session
  could make). Every figure carries its own instant in §4.
- **Trees:** `/tmp/d65-measure-a7c2` (attempts A–C) and `/tmp/d65-measure-c3f1` (attempt D), both
  `git clone --local` of the D65 worktree at commit `60faec03e`
  (`refactor(workflow)!: rewrite task-pipeline as seven states without the proof chain (1239)`);
  `/tmp/d65-m2` (run R1), a `git clone --local` at `2fb9fd960`
  (`fix(app): split a multi-token spurBin before spawning the admission check (1240)`); and `/tmp/d65-m3`
  (runs M1–M3), a `git clone --local` at `7b0298dda` (`fix(verdict): accept the review report's
  Item/State/Evidence table (1240)`).
  Nothing in this report was produced inside the D65 worktree's own corpus.

Every figure below names how it was produced. A figure that could not be obtained is `n/a` with the
reason — none are interpolated.

## 1. Method

### 1.1 Baseline (old inline-driven `task-pipeline`)

Source of truth: the close-written run summaries the engine wrote for each historical run,
`/Users/robin/xprojects/spur-new/.spur/run/*-summary.json` (44 files; gitignored, so they live only
in the main checkout). Each file is the `RunSummary` object
([run-summary.ts](../../packages/app/src/workflow/run-summary.ts)) plus `runId`, `startedAt`,
`completedAt`; `rows[]` carry per-stage `workMs`, `total` carries the run total.

Selection and aggregation were done by `/tmp/d65-baseline.ts` (reproduced in §6.1), run as:

```bash
cd /Users/robin/xprojects/spur-new
/Users/robin/.bun/bin/bun /tmp/d65-baseline.ts .spur/run
```

A file was included when it had `startedAt`, `completedAt` and a non-empty `rows[]`, contained an
`implement` row, and was not a wrapup (`doc-sync`/`feature-verify`) shape. 33 files qualified.
Stage names are normalized by dropping the ` (visit N)` suffix, so `test (visit 2)` adds to `test`.
Driver overhead is the summary's own `driver overhead` row
([run-summary.ts:591](../../packages/app/src/workflow/run-summary.ts#L591)), summed across runs that
emitted one.

The batch-level view the baseline document used is the same input set through the CLI roll-up:

```bash
/Users/robin/.bun/bin/bun run apps/cli/src/index.ts workflow summary \
  --rollup .spur/run/<runId>-summary.json …   # one --rollup flag per file
```

That path was not needed for the stage table (the JSON already carries `rows`); it renders only the
per-run totals.

### 1.2 Cross-agent figures

```bash
cd /Users/robin/xprojects/spur-new
/Users/robin/.bun/bin/bun run apps/cli/src/index.ts history analyze \
  --since 2026-10-10 --until 2026-10-18 --out /tmp/d65-analyze.json --json
```

17 s, exit 0. The artifact's `bySource` block is the cross-agent view (§3). `spur history analyze`
has **no stage dimension** — it aggregates imported agent transcripts by source/model/session/tool,
not by pipeline state — so it cannot substitute for the per-stage table. That is a limitation of the
figure, not a missing command (the task's refine note asserted the flags were sufficient; they are
sufficient for cross-agent *aggregates*, not for per-stage attribution).

### 1.3 Rewritten pipeline runs

Scratch clone, real subprocess executor: the run's own action attempts are the timing source (not
`--trace-file`, which the diff-scope guard rejects — finding 5):

```bash
git clone --local /Users/robin/xprojects/spur-new-runall-d65-73c2 /tmp/d65-measure-a7c2
cd /tmp/d65-measure-a7c2
/Users/robin/.bun/bin/bun install --frozen-lockfile --ignore-scripts   # 2354 packages, 1.4 s (warm cache)
/Users/robin/.bun/bin/bun run bundle:config                            # apps/cli/config, exit 0
/Users/robin/.bun/bin/bun run apps/cli/src/index.ts workflow run \
  config/workflows/task-pipeline.yaml \
  --vars '{"wbs":"1243","agent":"claude","profile":"auto"}' \
  --async --json
```

Run R1 (§4.6) used the same sequence against `2fb9fd960` in `/tmp/d65-m2`.

Per-stage time comes from the engine's own projection, which is the measurement ADR-140 item 1
claims:

```bash
spur workflow progress <runId> --json     # states[].actions[].attempts[].{startedAt,completedAt,durationMs}
```

Read the **attempts**, not the state rows: the state row repeats the sum over every visit (§6.10).

That is engine-measured action time — no host transcript, no driver bookkeeping. The host-session
`spur workflow summary --progress <file> --markdown` render (which since 1237 also prints gate time)
needs a `spur workflow progress <runId> --json` file as input; for a subprocess-executor run there is
no host transcript whose overhead row could be computed, so the **driver-overhead row is `n/a` by
construction for these runs** and engine action time is the comparable quantity.

Probe task for attempts B–D: `1243` — "D65 measurement probe: one-line architecture doc note", created
inside the clone only (`spur task create … --skip-ready`, then Requirements/AC via
`spur task update 1243 --section`, then `spur task update 1243 todo`). Two requirements, one AC, one
file (`docs/03_ARCHITECTURE.md`). It exists only in the scratch clones' `docs/tasks5/`; the D65 corpus is
touched only by this report.

Probe task for run R1 (§4.6): `1243` again, recreated in `/tmp/d65-m2` as a **code** edit — one exported
helper `nonEmptyLines` in `packages/app/src/workflow/utils.ts` (+7) with its test
(`packages/app/tests/workflow/utils.test.ts`, +16/−1). A docs-only probe (the earlier session's) exercises
the empty-implement admission, not the implement path; this one does not. Tasks `1244` and `1245` of the
same shape are pending in that clone for runs 2 and 3.

This session (runs M1–M3) used a **fresh** clone at `7b0298dda` — `/tmp/d65-m3`, `git clone --local`,
`bun install --frozen-lockfile --ignore-scripts` (2354 packages, 1.6 s) and `bun run bundle:config` (exit 0)
— and three **code** probes, each created inside that clone only, one launch per probe, sequential:

| Probe | WBS | Edit | Test |
| --- | --- | --- | --- |
| M1 | `1243` | `nonEmptyLines` exported from `packages/app/src/workflow/utils.ts` (+7) | `packages/app/tests/workflow/utils.test.ts` (+16/−1) |
| M2 | `1244` | `isRfc3339DateOnly` exported from `packages/config/src/rfc3339.ts` | `packages/config/tests/rfc3339-date-only.test.ts` (new) |
| M3 | `1245` | `pluralizeCount` in a new `packages/app/src/workflow/pluralize.ts` | `packages/app/tests/workflow/pluralize.test.ts` (new) |

Each was created with `spur task create … --skip-ready`, given Requirements/AC/Design/Plan through
`spur task update <wbs> --section`, and moved to `todo` with `spur task update <wbs> todo --no-lifecycle`.
They exist only in `/tmp/d65-m3/docs/tasks5/`. No `--trace-file` was passed to any launch (finding 5).

## 2. Baseline per-stage totals (33 run summaries)

`bun /tmp/d65-baseline.ts .spur/run` — every number is a sum of `rows[].workMs` from the run
summaries, in minutes (rounded).

| Stage | Sum (min) | Runs with the stage | Mean per run (min) |
| --- | --- | --- | --- |
| implement | 404 | 40 visits over 33 runs | 10.1 |
| test-recheck | 310 | 30 | 10.3 |
| review | 216 | 41 | 5.3 |
| test-fix | 147 | 31 | 4.7 |
| verify | 106 | 33 | 3.2 |
| test | 37 | 40 | 0.9 |
| triage | 16 | 36 | 0.4 |
| precheck | 14 | 32 | 0.4 |
| record | 10 | 29 | 0.3 |
| done | 2 | 29 | 0.1 |
| review-fail-triage | 1 | 8 | 0.1 |
| approve | 1 | 1 | 0.6 |
| test-fail-triage | <1 | 27 | <0.1 |
| failed | <1 | 7 | <0.1 |
| escalate | <1 | 1 | <0.1 |
| **agent stages, summed** | **1264** | | |
| **driver overhead** (its own row) | **692** (27.1 % of total) | runs that emitted one | |
| **run totals** (sum of each `total.workMs`) | **2551** | 33 | 77.3 |
| operator/ask wait (sum of `waitMs`) | 25 | | |
| wall span (sum of `completedAt − startedAt`) | 2616 | 33 | |

Unattributed remainder: `2551 − 1264 − 692 = 595 min`. The summary suppresses the `driver overhead`
row when a run's stage windows overlap (parallel runs — [run-summary.ts:581](../../packages/app/src/workflow/run-summary.ts#L581)),
so that residual sits inside runs that have no overhead row; it is not a gap in the extraction.

### 2.1 Reconciliation with the figures quoted in ADR-140 / task 1240

The recorded baseline is "32 runs, 2550 min, driver overhead 815 min (32 %), remediation ~450 min vs
implement 356 min".

| Figure | Recorded | Reproduced here | Reading |
| --- | --- | --- | --- |
| run count | 32 | 33 files qualify | one extra summary file has been written since the baseline snapshot (`c597173a…-summary.json`, started 2026-10-16T22:58Z); excluding it the totals are 2496 min |
| total work | 2550 min | 2551 min | matches to rounding |
| remediation (test-fix + test-recheck) | ~450 min | 457 min | matches |
| implement | 356 min | 404 min | **48 min higher** |
| driver overhead | 815 min (32 %) | 692 min (27.1 %) | **123 min lower** |

The implement and overhead deltas are **not reconciled**: the baseline record keeps only the
aggregate (ADR-140 Why, design §1) and not the run ids or the per-run rows it was computed from, so
which runs or which definition produced 356 / 815 cannot be re-derived. Both figures are labelled by
their producer here rather than averaged or silently floored. Anyone re-baselining should publish
the qualifying file list.

## 3. Cross-agent figures (`spur history analyze`, window 2026-10-10 → 2026-10-17)

From `/tmp/d65-analyze.json` `bySource`. These are imported-transcript aggregates, not pipeline
stage time.

| Source | Records | Tool calls | Input tokens | Cache read | Cost (USD) | Assistant duration (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| pi | 228639 | 80481 | 11,589,007,844 | 11,407,402,562 | 468.32 | 8,153,381,568 |
| grok | 65310 | 6978 | 168,014,534 | 81,491,072 | 0 | 15,139,095 |
| codex | 30491 | 3803 | 1,087,580,391 | 538,397,312 | 679.54 | 12,508 |
| claude | 28789 | 5370 | 727,116,168 | 701,520,379 | 54.51 | 18,331,039 |
| agy | 14952 | 7181 | 0 | 0 | 0 | 970,000 |

Totals: 368,181 records, 103,813 tool calls, 1,202.36 USD, `durationUnmeasured` 21,944 rows.
`codex` and `agy` carry `durationMs: 0` with `durationUnmeasured` equal to their tool-call count, so
their wall-time columns are unusable and are not read as evidence of speed.

## 4. Rewritten-pipeline runs

Eight launches were made across three sessions. Four (A–D) are the first session's, recorded in §4.1–§4.5
because findings 5–7 depend on them. The fifth (R1, §4.6) is the second session's, run against the fixed
tree `2fb9fd960` and the only one there measured far enough to compare a revisited gate. The last three
(M1–M3, §4.8–§4.10) are this session's, run against `7b0298dda` — the commit meant to unblock certification —
with a real code probe each and no `--trace-file`. **None reached `done`,** and the two reasons are not the
two the fixes addressed: the review answer contract is still unmatched, in a different way (§4.8, finding
13), and the `claude` account ran out of session quota (§4.9–§4.10).

### 4.1 Attempt A — `agent: codex` (discarded, no timing)

Failed in 168 ms, before any agent work:

```
agent.run 'implement' (codex) dispatch failed: agent dispatch blocked by capability attestation
(0706 R5): executor/spec 'codex' cannot satisfy required capabilities — fsWrite: required=available
actual=unknown provenance=unattested; processSpawn: required=available actual=unknown
provenance=unattested.
```

Run `215fb6ec-3508-4bdc-acd0-a410c48235cb`. Only executors whose `executionCapabilities` block is
declared can run `implement`; in the global config those are `pi-k3`, `pi-sol`, `codex-sol`,
`claude`, `agy-opus-5.5`, `agy-sonnet-5.5` — the bare `codex`/`grok` profiles are not attested. The
next launch used `claude`.

### 4.2 Attempt B — `agent: claude` **with `--trace-file`** (measured: failed at `implement`)

```bash
/Users/robin/.bun/bin/bun run apps/cli/src/index.ts workflow run \
  config/workflows/task-pipeline.yaml \
  --vars '{"wbs":"1243","agent":"claude","profile":"auto"}' --async --trace-file --json
```

Run `cdf9e001-dc66-4e38-b733-dedb3e7de404`, definition v9, digest `sha256:21ccf260…540618`,
executor `claude` — a real subprocess dispatch (`agent=claude command=claude mode=text
model=claude-opus-5 timeoutMs=2700000`), not a stub.

| Stage | Engine-measured time | Outcome |
| --- | --- | --- |
| precheck (visit 1) | 306 ms window, 53 ms of executed actions | passed |
| implement (visit 1) | **138 530 ms** (22:09:48.830Z → 22:12:07.361Z) of which the `agent.run` hop is 138 530 ms; agent exit code 0 | **failed** |
| escalate / gate / remediate / review / done | `n/a` — never entered | — |
| driver overhead | `n/a` — no host transcript for a subprocess run (§1.3) | — |
| gate time | `n/a` — never reached `gate` | — |
| run wall clock | 139 737 ms | failed |

Failure message (run log, `spur workflow trace`):

```
agent.run 'implement' (claude) changed files outside task 1243's declared surfaces:
.spur/workflow/cdf9e001-dc66-4e38-b733-dedb3e7de404.jsonl. Implement only the target WBS; revert
the out-of-scope changes (or name those paths in the task body). Set the run var
implementScopeGuard: "off" to bypass.
```

The agent itself did its job — `git status` in the clone shows `M docs/03_ARCHITECTURE.md` beside the
new task file — but the engine's **own** `--trace-file` output landed in the work tree during the
implement window and the diff-scope guard charged it to the agent. See finding 5.

### 4.3 Attempt C — `agent: claude`, same clone, no `--trace-file` (measured: failed at `implement`)

Run `fc2df1af-60e7-449a-9abc-6bf07773d79c`.

| Stage | Engine-measured time | Outcome |
| --- | --- | --- |
| precheck (visit 1) | 302 ms window, 55 ms of executed actions | passed (with the warning "working tree has uncommitted non-corpus changes — commit or stash before starting a new task") |
| implement (visit 1) | **104 144 ms** (22:13:52.376Z → 22:15:36.524Z), agent exit 0 | **failed** |
| later stages | `n/a` — never entered | — |

Run log: `agent.run 'implement' (claude) exited 0 but produced zero non-corpus file changes, and the
verification-only admission failed — \`/Users/robin/.bun/bin/bun /private/tmp/d65-measure-a7c2/apps/cli/src/index.ts
task check 1243\` exit null: (no output)`.

Two causes stacked here, and **neither is "`docs/**` is corpus"** — checked against the code:

1. **The change count is hop-scoped, not tree-scoped.** The empty-implement guard diffs against a
   working-tree snapshot taken **at hop entry**
   ([agent-run.ts:1054](../../packages/app/src/workflow/actions/agent-run.ts#L1054)) and compares with
   `gitChangesSinceSnapshot` ([agent-run.ts:1334](../../packages/app/src/workflow/actions/agent-run.ts#L1334)),
   so the `M docs/03_ARCHITECTURE.md` attempt B left behind was invisible to attempt C's hop. The
   corpus exclusion is not the cause: `excludeGlobs` is built from the registered task folders plus the
   features dir only ([workflow-engine-factory.ts:85-89](../../packages/app/src/services/workflow-engine-factory.ts#L85)) —
   `docs/03_ARCHITECTURE.md` is a non-corpus file, which is exactly why attempt B's scope guard approved it
   and why attempt C's precheck warned about it.
2. **The verification-only admission could not spawn its own check** — the defect fixed in `2fb9fd960`
   (finding 7). `taskCheckClean` passed `vars.spurBin` as a process `command`, and a multi-word
   `spurBin` (`bun <abs>/apps/cli/src/index.ts`) spawned as `exit null`. The same `task check 1243 --json`
   run by hand in that clone exits **0** with `"pass": true`.

### 4.4 Attempt D — `agent: claude`, fresh clone, clean tree (previous session)

A second scratch clone (`/tmp/d65-measure-c3f1`, same commit, probe 1243 recreated) guaranteed a clean
tree without any reset in the first clone. Run `492a9ea5-656c-40cd-8a58-68794ee5b97b`.

| Stage | Engine-measured time | Outcome |
| --- | --- | --- |
| precheck (visit 1) | 311 ms window, 59 ms of executed actions | passed |
| implement (visit 1) | **129 477 ms** (22:17:03.841Z → 22:19:13.319Z) — real `claude` subprocess hop | passed |
| gate (visit 1) | **252 494 ms** (receipt `durationMs`; `gateRuntimeMs` 252 289, `queueWaitMs` 0) | **FAIL** (`.spur/run/1243-gate.status` = `FAIL`) |
| remediate (both visits) | **88 015 ms summed over the two visits** by the projection; the per-visit split is not recoverable from the state rows (§4.7) | passed (both) |
| gate (visit 2) | **226 477 ms** (receipt `durationMs`; `gateRuntimeMs` 208 471, `queueWaitMs` 0) | **PASS** |
| review (visit 1) | **189 603 ms** — real `claude` review hop | passed as a hop, routed into `remediate` |
| done | `n/a` — not reached | — |
| run wall clock at final observation (22:34:30Z) | 17.6 min, still `running` in `remediate` visit 2 | — |

The gate failure was not the probe's change: the project gate ran 11 510 tests in 231.55 s with
`1 fail` — `(fail) invocation execution context (1215) > the default runner keeps process cwd/env
when the context is omitted` (`.spur/run/1243-test-gate.log:49`). That test is environment-sensitive
(cwd/env of the runner) and this clone ran from `/tmp`; attribution to the clone environment is an
**inference**, not a measurement. Finding: the same test **passes** in this session's clone when the
engine runs from the physical path (§4.6), which is why R1's first gate visit was green.

The `failure-class` decision that routed the FAIL into `remediate` recorded `value: "fix"`,
`confidence: 0.02`, `confidenceLevel: "LOW"`, `degraded: true`, `source: "default"` — the
deterministic classifier degraded to its default and the pipeline spent a full fix hop on a test the
probe could not have broken.

### 4.5 Attempt D — final observation (2026-10-17T22:34:30Z)

| Stage | Time |
| --- | --- |
| precheck | 59 ms |
| implement | 129.5 s |
| gate visit 1 (FAIL) | 252.5 s |
| remediate (both visits) | 88.0 s summed |
| gate visit 2 (PASS) | 226.5 s |
| review visit 1 | 189.6 s |

Sum of the completed stages: 886 s ≈ **14.8 min** of engine/agent work inside a 17.6 min run wall
clock at the cutoff; the remainder is idle gap plus the unstarted tail. The run was still `running`
when the earlier session ended.

### 4.6 Run R1 — `agent: claude`, fresh clone at `2fb9fd960` (second session)

```bash
git clone --local /Users/robin/xprojects/spur-new-runall-d65-73c2 /tmp/d65-m2       # HEAD 2fb9fd960
cd /tmp/d65-m2                                                                       # physical /private/tmp path
/Users/robin/.bun/bin/bun install --frozen-lockfile --ignore-scripts                # 2354 packages, 1.7 s
/Users/robin/.bun/bin/bun run bundle:config                                         # exit 0
/Users/robin/.bun/bin/bun run apps/cli/src/index.ts workflow run \
  config/workflows/task-pipeline.yaml \
  --vars '{"wbs":"1243","agent":"claude","profile":"auto"}' --async --json          # no --trace-file
```

Run `8bf24b93-9c78-4673-9ba5-078706d5f849`, definition v9, digest `sha256:21ccf260…540618`, executor
`claude` as a real subprocess. Probe: **code** edit, not a docs note —
`packages/app/src/workflow/utils.ts` +7 (one exported helper `nonEmptyLines`) and
`packages/app/tests/workflow/utils.test.ts` +16/−1 (its test). That is the smallest real-change probe
that exercises the `implement` path; the earlier session's docs-only probe exercised the
empty-implement admission instead.

| Stage (visit) | Engine-measured action ms | Window (UTC) | Outcome |
| --- | --- | --- | --- |
| precheck (1) | 204 ms | 22:53:40.960 → 22:53:42.051 | passed |
| implement (1) | **159 069 ms** | 22:53:42.952 → 22:56:22.024 | passed (agent exit 0, 2 files) |
| gate (1) | **236 305 ms** | 22:56:24.746 → 23:00:21.051 | **PASS** — receipt `tier: full`, `gateRuntimeMs` 235 868, `queueWaitMs` 0, check 236 065 ms, 11 514 tests / 724 files in 215.81 s |
| review (1) | **116 758 ms** (hop 110 163 + verdict 348 + decide 6 245 + fold 2) | 23:00:21.321 → 23:02:18.092 | hop passed; **certification FAIL** (`1243-review.status` = `FAIL`) |
| remediate (1) | **53 160 ms** | 23:02:18.628 → 23:03:11.789 | passed |
| gate (2) | **516 ms** | 23:03:12.883 → 23:03:13.399 | **PASS by receipt reuse** — tree hash unchanged, no second gate run |
| review (2) | **105 129 ms** (hop 99 283 + verdict 244 + decide 5 602 + fold 0) | 23:03:13.509 → 23:04:58.651 | hop passed; **certification FAIL** again |
| remediate (2) | **115 441 ms** | 23:04:59.048 → 23:06:54.490 | passed |
| gate (3) | **1 959 ms** | 23:06:56.888 → 23:06:58.847 | **PASS by receipt reuse** |
| review (3) | started 23:06:58.961, killed at 23:07:44 | — | `n/a` (operator cancel) |
| done | `n/a` — never reached | — | — |
| driver overhead | `n/a` — subprocess executor, no host transcript (§6.3) | — | — |
| run wall clock | **844 s = 14.1 min**, terminal status `failed` (cancelled, `killed: true`) | 22:53:40 → 23:07:44 | never reached `done` |

Sum of measured actions across the whole run: 204 + 159 069 + 238 780 + 221 887 + 168 600 =
**788 540 ms ≈ 13.1 min** inside a 14.1 min wall clock; the ~0.9 min remainder is transition/idle gap.

Three observations worth keeping, each with its producer:

1. **The gate receipt is reused when the tree hash holds.** Gate visit 2 cost 516 ms and visit 3 cost
   1 959 ms against 236 305 ms for visit 1 — no re-run happened (`.spur/run/1243-gate-visits` = 3,
   receipt unchanged at `completedAt` 23:00:21.035Z, `inputDigest` `93d27fa…`). This is ADR-140 item
   R11 working, and it is the one place where the rewrite is unambiguous rather than inferred: the
   baseline charged every recheck as a full re-run.
2. **The run cost more than the implementation it measured.** implement 159 s against three gate
   visits + two remediate hops; but the second and third gate visits were free, so the extra cost is
   the review→remediate loop (finding 12), not the gate.
3. **The review hop and its certification are separate outcomes, and only the hop passed.** Both
   review visits produced a `Verdict: PASS` review with no P1–P3 findings
   (`.spur/run/1243-review-section.md`) and still folded to `FAIL` at
   `.spur/run/1243-review.status`, because `spur task verdict --from-answer` exited 1
   (`.spur/run/<runId>-review-verdict.status` = `FAIL`) and wrote no `1243-verdict.json`.

The run was cancelled at 14.1 min: with the review verdict failing deterministically, the graph could
only cycle `review → remediate → gate → review` (bounded by `iterationBound: 20` and the fix-attempt
counter) and every cycle costs ~6 min. Runs 2 and 3 were not launched — the same wall, at the same
cost, with 15 min of session budget left. Their probe tasks (`1244` `isRfc3339DateOnly` in
`packages/config/src/rfc3339.ts`, `1245` `pluralizeCount` in a new `packages/app/src/workflow/pluralize.ts`)
exist in `/tmp/d65-m2` and are `todo`, ready for the next session.

### 4.7 Why R1's per-visit numbers are honest and attempt D's were not

`spur workflow progress <runId> --json` reports one row per state with a `visit` field, but that row's
`s.visit` does not index the attempts: the state row repeats **the sum over every visit** and the
first visit's start. The per-visit truth is in `states[].actions[].attempts[]`, where each attempt
carries its own `startedAt`/`completedAt`/`durationMs`. For R1 the gate state row reads 238 780 ms
(236 305 + 516 + 1 959) and the review row 221 887 ms across three visits; summing the state rows
without de-duplicating would triple-count them. The table in §4.6 is built from the attempts, which is
why it can split gate visit 1 from visits 2 and 3 at all. The earlier session's §4.5 could not, because
it read the state rows.

### 4.8 Run M1 — `agent: claude`, fresh clone at `7b0298dda` (probe 1243, code)

```bash
git clone --local /Users/robin/xprojects/spur-new-runall-d65-73c2 /tmp/d65-m3   # HEAD 7b0298dda
cd /tmp/d65-m3
/Users/robin/.bun/bin/bun install --frozen-lockfile --ignore-scripts           # 2354 packages, 1.63 s
/Users/robin/.bun/bin/bun run bundle:config                                    # exit 0
/Users/robin/.bun/bin/bun run apps/cli/src/index.ts workflow run \
  config/workflows/task-pipeline.yaml \
  --vars '{"wbs":"1243","agent":"claude","profile":"auto"}' --async --json     # no --trace-file
```

Run `82008861-9f35-4b58-8673-637430fe7e1f`, definition v9, digest `sha256:21ccf260…540618`, executor
`claude` as a real subprocess. Probe: the `nonEmptyLines` code edit (§1.3).

| Stage (visit) | Engine-measured action ms | Window (UTC) | Outcome |
| --- | --- | --- | --- |
| precheck (1) | 223 | 23:19:03.434 → 23:19:04.486 | passed |
| implement (1) | **123 597** (projection; 126 720 from the trace — §4.8.4) | 23:19:05.578 → 23:21:09.176 | passed (agent exit 0, 2 files) |
| gate (1) | **243 820** | 23:21:14.057 → 23:25:17.877 | **FAIL** — receipt `tier: full`, `gateRuntimeMs` 243 210, `queueWaitMs` 2, check `test` FAIL 243 468 ms, `inputDigest` `bfa00693…` |
| remediate (1) | **99 587** (agent hop 99 586) | 23:25:18.460 → 23:26:58.046 | passed; edited `packages/app/tests/services/pr-review/pr-review.test.ts` (7 lines) |
| gate (2) | **249 315** | 23:26:59.128 → 23:31:08.443 | **PASS** — receipt `gateRuntimeMs` 233 877, `queueWaitMs` 0, check `test` PASS 249 076 ms, `inputDigest` `a94e8e67…`, 11 520 pass / 0 fail |
| review (1) | **212 549** (hop 206 059 + verdict gate 416 + decide 6 057 + 17) | 23:31:08.692 → 23:34:41.246 | hop passed; **certification FAIL** (`1243-review.status` = `FAIL`) |
| remediate (2) | **11 099** (agent hop 11 098) | 23:34:41.581 → 23:34:52.680 | **failed** — agent exit code 3, `You've hit your session limit · resets 8pm (America/Los_Angeles)` |
| done | `n/a` — never reached | — | — |
| driver overhead | `n/a` — subprocess executor, no host transcript (§6.3) | — | — |
| run wall clock | **949.2 s = 15.8 min**, terminal status `failed` | 23:19:03.434 → 23:34:52.683 | never reached `done` |

Summed action time **940 190 ms ≈ 15.7 min** inside that 15.8 min wall clock: 223 + 123 597 + 243 820 +
249 315 + 99 587 + 212 549 + 11 099. Every stage figure is `states[].actions[].attempts[].durationMs` from
`workflow progress <runId> --json`; the gate receipts (and their `gateRuntimeMs`, `queueWaitMs`, `tier`)
come from `.spur/run/1243-check-receipt.json`. The run was wall-to-wall hops — no idle gap worth splitting
out.

#### 4.8.1 Gate visit 1 failed on the same environment-sensitive test as attempt D

The failing test name is recoverable from the repair hop, not the log: `.spur/run/1243-test-gate.log` is one
path shared by every visit and visit 2 overwrote it (65 765 bytes, ending `11 520 pass / 0 fail`), so the
FAIL detail is gone. The hop that followed changed exactly this:

```diff
     test('the default runner keeps process cwd/env when the context is omitted', () => {
         const runner = createSpawnRunner();
-        expect(runner(['/bin/sh', '-c', 'pwd']).stdout.trim()).toBe(realpathSync(process.cwd()));
+        expect(runner(['/bin/sh', '-c', 'pwd -P']).stdout.trim()).toBe(realpathSync(process.cwd()));
```

That is `invocation execution context (1215) > the default runner keeps process cwd/env when the context is
omitted` — the test that failed attempt D's gate (§4.4) in a different `/tmp` clone. Two of two gates run
from a `/tmp` clone have failed on it: the `/tmp → /private/tmp` symlink makes the shell builtin `pwd` echo
the logical `$PWD` while the assertion compares a `realpath`. **Attribution to the clone environment remains
an inference**, but it is now reproducible, and it costs a full 4 min gate re-run plus a ~100 s repair hop
on every `/tmp`-hosted run.

Two consequences worth naming:

- **The repair hop edited a pre-existing project test, not the probe.** The probe's own files were green;
  the hop's only change is the `pwd -P` pair above, outside probe 1243's declared surfaces (`utils.ts`,
  `utils.test.ts`). The review flagged exactly that as a P3 ("R3 deviation undocumented"). A measurement
  run cannot assume the repair hop is free of collateral edits.
- **A changed tree costs a full gate.** Visit 2 ran 249 315 ms against visit 1's 243 820 ms — no receipt
  reuse, because the hop changed `inputDigest` from `bfa00693…` to `a94e8e67…`. Receipt reuse (§4.6) holds
  only while the tree hash does.

#### 4.8.2 The review certification still fails — measured on the engine's own captured answer

Unlike the second session's run (§4.6, whose `-review-answer.txt` was gone), this run's answer was still on
disk. `.spur/run/82008861-9f35-4b58-8673-637430fe7e1f-review-answer.txt` begins:

```text
**Verdict: PASS** — 0 P1, 0 P2, 2 P3, 3 P4.

| WBS | Verdict | P1 | P2 |
| --- | --- | --- | --- |
| 1243 | PASS | 0 | 0 |
```

`spur task verdict 1243 --from-answer` on that file, run by hand after the fact on the same tree:

```json
{
  "wbs": "1243",
  "lintFindings": [
    { "line": 0, "rule": "verdict-missing", "message": "no `Verdict:` line (expected exactly one `Verdict: PASS|PARTIAL|FAIL` line)" },
    { "line": 0, "rule": "req-missing", "message": "missing requirement row for \"R1\"" },
    { "line": 0, "rule": "req-missing", "message": "missing requirement row for \"R2\"" },
    { "line": 0, "rule": "req-missing", "message": "missing requirement row for \"R3\"" }
  ]
}
```

exit **1**, no `.spur/run/1243-verdict.json` written. Two distinct mismatches, both visible in the captured
answer:

1. **`verdict-missing`** — the parser matches exactly `/^\s*Verdict:\s*(\S+)\s*$/gim`
   ([verify-answer-lint.ts:405](../../packages/app/src/services/verify-answer-lint.ts#L405)). The reviewer
   writes the verdict **bolded and with a trailing summary** (`**Verdict: PASS** — 0 P1, 0 P2, 2 P3,
   3 P4.`), which satisfies neither the anchors nor the leading `**`.
2. **`req-missing` R1/R2/R3** — its table is a run-level `| WBS | Verdict | P1 | P2 |` table, not a
   per-requirement traceability table. `7b0298dda` taught the parser that `Item | State` is a spelling of
   `Req | Status`, but `wbs` is not an id-like first cell and the table has no per-requirement row and no
   `Evidence` column, so no header vocabulary rescues it: **the answer the `--auto` review hop produces
   contains no requirement rows to certify.** Widening the header vocabulary (`7b0298dda`) fixed the shape
   the second session saw; it does not cover the shape a `--auto` review writes.

#### 4.8.3 What the run measured, per stage

| Quantity | Value | Producer |
| --- | --- | --- |
| full gate, visit 1 (FAIL) | 243.8 s action / 243.2 s `gateRuntimeMs` | `workflow progress` attempts + the FAIL `1243-check-receipt.json` (read before visit 2 overwrote it) |
| full gate, visit 2 (PASS) | 249.3 s action / 233.9 s `gateRuntimeMs` / 249.1 s check | same, final receipt |
| repair hop, visit 1 | 99.6 s | `workflow progress` attempts |
| review hop | 206.1 s | `workflow progress` attempts |
| review certification | 0.4 s — the lint itself is cheap; its FAIL is what costs the loop | `workflow progress` attempts |
| implement | 123.6 s (projection) / 126.7 s (trace) | `workflow progress` attempts / `workflow trace` |
| loop cost for a 2-file probe | 2 gate visits + 1 repair hop + 1 review visit = **805 s** | summed from the rows above |

#### 4.8.4 One projection gap, stated with its evidence

`workflow progress --json` records **three** `implement` attempts (4 ms + 123 227 ms + 366 ms = 123 597 ms);
`workflow trace` records **five** `implement` actions, the last two `done 2739ms` and `done 384ms`. In the
projection those two actions are `status: ambiguous` with `attempts: []` (the same shape `precheck` shows
for its two unrecorded shells), so the projection under-reports `implement` by 3 123 ms (2.5 %). Read as:
attempts are authoritative for what they contain, not exhaustive. Stage sums here name their producer for
that reason.

### 4.9 Run M2 — `agent: claude`, probe 1244 (failed at `implement`, agent quota)

Run `8d0ac3ff-7aab-4d5c-b420-9b64ad073238`, launched 23:36:30.130Z on probe `1244` (`isRfc3339DateOnly` in
`packages/config/src/rfc3339.ts` plus a new test).

| Stage (visit) | Engine-measured action ms | Window (UTC) | Outcome |
| --- | --- | --- | --- |
| precheck (1) | 71 | 23:36:30.130 → 23:36:31.196 | passed |
| implement (1) | 4 567 | 23:36:32.192 → 23:36:36.759 | **failed** — agent exit code 3 after 4 239 ms (`.spur/run/8d0ac3ff-…-implement-partial.md`) |
| gate / review / done | `n/a` — never entered | — | — |
| run wall clock | **6.6 s**, terminal status `failed` | 23:36:30.130 → 23:36:36.759 | — |

Terminal reason, verbatim from the partial-work handoff:

```text
You've hit your session limit · resets 8pm (America/Los_Angeles)
```

The executor's stderr also reports `Ignoring 53 permissions.allow entries from .claude/settings.local.json:
this workspace has not been trusted.` — a warning that did not decide the outcome (exit 3 is the quota path)
and is recorded only so it is not mistaken for a pipeline defect.

### 4.10 Run M3 — `agent: claude`, probe 1245 (failed at `implement`, agent quota)

Run `b252fc11-86ae-4ebc-8dd7-2e55c6b48be8`, launched 23:36:58.970Z on probe `1245` (`pluralizeCount` in a
new `packages/app/src/workflow/pluralize.ts` plus a new test).

| Stage (visit) | Engine-measured action ms | Window (UTC) | Outcome |
| --- | --- | --- | --- |
| precheck (1) | 112 | 23:36:58.970 → 23:36:59.801 | passed |
| implement (1) | 4 005 | 23:37:00.732 → 23:37:04.738 | **failed** — agent exit code 3 after 3 846 ms |
| gate / review / done | `n/a` — never entered | — | — |
| run wall clock | **5.8 s**, terminal status `failed` | 23:36:58.970 → 23:37:04.738 | — |

Same terminal text as M2. M2 and M3 are therefore **not time measurements of the pipeline** — one dispatch
each, measuring `precheck` (71 ms, 112 ms) plus the engine's own failure handling. They were launched because
the instruction was one launch per probe and a quota failure is indistinguishable from a workflow failure
until it is dispatched; M3 was the last launch, since two identical exit-3 dispatches establish an account
limit rather than a task-specific cause.

## 5. The rewrite beside the baseline, and what still blocks three completed runs

The comparison the task asks for — three completed runs beside the 33-run baseline — **cannot be
stated**: zero runs reached `done` in any of the three sessions. What is measurable is stated below with its
producer; everything else is `n/a` with the reason.

| Quantity | Baseline (33 summaries, §2) | Rewrite, attempt D + R1 (earlier sessions) | Rewrite, M1 (this session, `7b0298dda`) |
| --- | --- | --- | --- |
| runs that reached `done` | 29 of 33 summaries carry a `done` row | 0 | 0 (stopped at `review` certification, then agent quota) |
| precheck | 0.4 min mean | 59 ms / 204 ms | 223 ms |
| implement | 10.1 min mean (404 min over 40 visits) | 129.5 s / 159.1 s | 123.6 s (projection) / 126.7 s (trace) |
| test / test-recheck (removed) | 37 min / 310 min | `n/a` — states do not exist | `n/a` — states do not exist |
| gate visits | `n/a` — the baseline's gates are `test` + `test-recheck` runs, no visit dimension | 1 FAIL 252.5 s + 1 PASS 226.5 s (D); 1 PASS 236.3 s + 2 receipt reuses 0.5 s / 2.0 s (R1) | 1 FAIL 243.8 s + 1 PASS 249.3 s (both full runs; no reuse — the tree changed between them) |
| remediate | `n/a` — baseline "remediation" is `test-fix` 147 min + `test-recheck` 310 min = 457 min | 88.0 s summed (D); 53.2 s + 115.4 s (R1) | 99.6 s (repair hop that turned the gate green) + an 11.1 s hop killed by the agent quota |
| review | 216 min total, 5.3 min mean (41 visits) | 189.6 s (D); 116.8 s + 105.1 s (R1, both certification FAIL) | 206.1 s hop + 6.5 s certification apparatus, certification **FAIL** |
| verify / triage / record / approve | 106 + 16 + 10 + 1 min | `n/a` — states removed, `review`/`done` own them | `n/a` — same |
| done | 2 min / 29 runs | `n/a` — not reached | `n/a` — not reached |
| driver overhead | 692 min (27.1 %) | `n/a` — subprocess executor, no host transcript (§6.3) | `n/a` — same reason |
| run wall clock | 77.3 min mean | 17.6 min (D, incomplete) / 14.1 min (R1, cancelled) | 15.8 min, failed |

M2 (probe `1244`) and M3 (probe `1245`) contribute no row: each spent 71 ms and 112 ms in `precheck` and
died in `implement` after 4.6 s and 5.8 s on the account quota (§4.9, §4.10).

Three things are genuinely comparable, and each is a single receipt or a single number:

- **Full-gate time.** Two independent PASS receipts on this tree: 233.9 s `gateRuntimeMs` (M1 visit 2,
  249.1 s of checks, 11 520 pass / 0 fail) and 235.9 s `gateRuntimeMs` (R1, 236 065 ms of checks,
  11 514 tests). The baseline has no like-for-like figure: its `test` rows measured the inline driver's own
  gate invocation, not `spur task gate`.
- **Receipt reuse — and its limit.** Where the tree hash holds, a revisit costs 516 ms / 1 959 ms (R1) and
  the gate is not re-run; where a repair hop changes the tree, the revisit costs a **full** 249.3 s (M1).
  The baseline charged every `test-recheck` (310 min over 30 runs) as a fresh run.
- **The repair loop is not free.** M1 spent 243.8 s (failed gate) + 99.6 s (repair hop) + 249.3 s (second
  gate) + 206.1 s (review) = 799 s of pipeline work around a 123.6 s two-file implementation. The repair
  loop, not the gate's first run, is where the run's time went.

What would have produced the three completed runs is one fix outside this task's editable scope: the review
answer the `--auto` review hop writes must be the answer `spur task verdict --from-answer` lints (finding
13). No run in any session reached `done`, and the one that got furthest stopped at that single
certification step; until it passes, no task can complete, so the time comparison this report exists to
make cannot be finished. Recorded honestly: **the two commits this session was sent to verify did not
produce a completed run** — `2fb9fd960` removed one failure mode that no later run re-entered (the
admission's `exit null`), and `7b0298dda` widened a header vocabulary the live answer does not use.

## 6. Findings

1. **The baseline's own headline numbers do not reproduce from its inputs.** Total (2551 min) and
   remediation (457 min) match; implement (404 vs 356) and driver overhead (692 vs 815) do not
   (§2.1). Cause: the baseline published aggregates without the qualifying run-id list. Anyone
   quoting "815 min / 32 %" after the rewrite must re-derive it or accept an unreconciled reference.
2. **`spur history analyze` cannot support a per-stage comparison.** It has no stage dimension
   (§1.2). The task's premise that it is sufficient for "cross-agent per-stage figures" is wrong;
   per-stage time comes from run summaries and, for the rewrite, from `workflow progress --json`.
   Cross-agent data is aggregate only (§3).
3. **Driver overhead is structurally unmeasurable for subprocess-executor runs.** It is computed
   from the host transcript ([run-summary.ts:583](../../packages/app/src/workflow/run-summary.ts#L583)).
   A pipeline run driven by `spur workflow run … --agent claude` has no host driver to charge, so a
   like-for-like overhead comparison needs a *host-executor* run (the `host` executor work item plus
   `spur workflow continue`), not a subprocess one. This report's `n/a` is the design working, but
   the task's "driver overhead beside the baseline" column is only obtainable from host runs.
4. **Executor attestation restricts the cross-agent sample** (§4.1): `codex` without an
   `executionCapabilities` block cannot implement. A cross-agent comparison must either attest the
   executor first or restrict itself to the attested set.
5. **`--trace-file` fails the implement hop on its own trace.** The engine's trace file
   (`.spur/workflow/<runId>.jsonl`) is written into the work tree while `implement` runs, and the
   diff-scope guard (`implementScopeGuard`, R1 of task 0487) counts it as an out-of-scope change:
   run `cdf9e001…` died with exit code 0 from the agent and a scope-guard failure from the engine
   (§4.2). Two ways out — drop `--trace-file` (what §4.4 does) or list `.spur/workflow/` in the task
   body — but a measurement run that wants engine traces cannot currently also pass the guard. Any
   future timing exercise that keeps traces must use `implementScopeGuard: "off"` and say so.
6. **A pre-existing non-corpus edit is invisible to the next implement hop, and the run then fails on
   a warning.** The empty-implement guard counts changes *since the hop's own snapshot*
   ([agent-run.ts:1054](../../packages/app/src/workflow/actions/agent-run.ts#L1054), compared at
   [:1334](../../packages/app/src/workflow/actions/agent-run.ts#L1334)), so `M docs/03_ARCHITECTURE.md`
   left by a previous run made attempt C read as "zero non-corpus file changes" although the tree did
   have one (§4.3). `precheck` had warned about exactly that tree ("uncommitted non-corpus changes —
   commit or stash") without blocking. Re-running a task pipeline therefore needs an externally clean
   tree; the engine reports the hazard and proceeds.
   **Not** the cause, and worth stating because it was the plausible hypothesis: `docs/**` is not
   treated as corpus. The exclusion list is every registered task folder plus the features dir
   ([workflow-engine-factory.ts:85-89](../../packages/app/src/services/workflow-engine-factory.ts#L85)),
   so a docs-only task's edit *is* a counted non-corpus change — `docs/03_ARCHITECTURE.md` got attempt
   B past the same guard.
7. **The verification-only admission cannot spawn its own `task check` — fixed at `2fb9fd960`, verified
   by R1.** `taskCheckClean` ([agent-run.ts:1909](../../packages/app/src/workflow/actions/agent-run.ts#L1909))
   used to call `NodeProcessExecutor.run({ command: spurBin, args: [...] })`, and where `vars.spurBin` is
   a two-word command (`/Users/robin/.bun/bin/bun <abs>/apps/cli/src/index.ts`) the spawn produced
   `exit null` with no stdout, turning a passing admission into a rejection whose text ("produced zero
   non-corpus file changes") named the wrong cause. `2fb9fd960` splits `spurBin` through
   `splitLaunchCommand` before the spawn. Run R1 was launched from the unlinked source CLI
   (`bun <abs>/apps/cli/src/index.ts`) in a tree where that admission would have been reachable, and
   never produced the `exit null` detail: its implement hop passed on its own diff. The regression is
   therefore exercised, not merely avoided — but the *failure* path (an empty implement that needs the
   admission) was not re-run, so the fix is verified only to the extent that the hop ran without it.
8. **No regression can be asserted from stage time yet.** No run reached `done`. `implement` measured
   159.1 s (R1, one-file code probe) and 129.5 s (D) / 138.5 s (B) / 104 s (C) on the docs probe, against
   a baseline implement mean of 10.1 min per run that includes multi-file code tasks — not comparable, and
   not compared. Two quantities are comparable and are stated in §5: full-gate time (236.3 s, from the
   check receipt) and receipt reuse (516 ms and 1 959 ms for gate visits 2 and 3).
9. **The rewrite's structural claim is visible, its time claim is not.** The definition is v9 with 8
   states (`config/workflows/task-pipeline.yaml:25-33`); no `test`/`test-recheck`/`triage`/`verify`/
   `record` rows exist to charge. R1 spent 236.3 s in gate visit 1, 159.1 s in implement, 221.9 s in two
   review visits and 168.6 s in two remediate hops — the gate dominated only until its receipt was reused,
   after which visits 2 and 3 cost 2.5 s combined. Whether the loop those remediate hops belong to can be
   removed is finding 12, not a timing question.
10. **`workflow progress` state rows are not per-visit — the attempts are.** Each `states[]` row carries a
    `visit` field that does not index anything: the row repeats the **sum over every visit** of that state
    and the *first* visit's window. In R1 the `gate` row reads 238 780 ms (= 236 305 + 516 + 1 959) and the
    `review` row 221 887 ms across three visits, while `states[].actions[].attempts[]` holds one attempt per
    visit with its own `startedAt`/`completedAt`/`durationMs` (gate: `23:12.883→23:03:13.399`, 516 ms). The
    earlier session's §4.5 read the state rows and consequently could not split attempt D's two gate visits;
    §4.6 reads the attempts. Any stage table built from the state rows will triple-count a revisited state —
    an observability defect in the measurement surface the rewrite is supposed to provide.
11. **Review → remediate is a real edge, and it looped.** In R1 two review visits each produced a
    `Verdict: PASS` review with no P1–P3 findings and still folded to `FAIL`, spending 53.2 s and 115.4 s
    in remediate hops. The baseline charged the same certify-then-fix loop as `test-fix`/`test-recheck`
    (457 min). The rewrite renames the loop; it does not remove it — and here it could not terminate
    (finding 12).
12. **The review answer the review hop produces cannot pass the review certification. This is what blocks
    `done`.**
    - **Observed, three times.** R1's `.spur/run/1243-review.status` = `FAIL` after review visits 1 and 2,
      with `.spur/run/<runId>-review-verdict.status` = `FAIL` and **no** `.spur/run/1243-verdict.json`
      written. Attempt D routed `review → remediate` the same way (§4.4). The review section the hop wrote
      (`.spur/run/1243-review-section.md`) says `Verdict: PASS — no P1–P3 findings`, and the review-gate
      residual check is clean (`spur task residual 1243 review-gate` → `blocking=0`, exit 0, run by hand
      after the fact).
    - **Mechanism, from the code.** The fold that writes the token
      (`config/workflows/task-pipeline.yaml:662-670`) requires the typed verdict token PASS, the
      verdict artifact's own `verdict: PASS`, and a clean residual gate. The verdict comes from
      `spur task verdict --from-answer`, which lints the reviewer's answer
      ([verify-answer-lint.ts](../../packages/app/src/services/verify-answer-lint.ts)). Its requirement
      table is recognized only when the header is `| Req | Status | Evidence |` — "id-like first cell +
      status column" ([verify-answer-lint.ts:354](../../packages/app/src/services/verify-answer-lint.ts#L354)) —
      and its `Verdict:` line must be exactly one `Verdict: PASS|PARTIAL|FAIL` line
      ([:56](../../packages/app/src/services/verify-answer-lint.ts#L56)). The reviewer emits
      `| Item | State | Evidence |` rows (`| R1 — exported … | MET | packages/app/src/…:5-10 |`), which the
      parser does not read as requirement rows. Re-running the lint by hand on the answer **reconstructed
      from the recorded review section** reproduces exactly that, as four findings: no `Verdict:` line and
      `missing requirement row for "R1" / "R2" / "R3"`, exit 1, no artifact.
    - **Labelled honestly.** The engine's own lint output for the live answer is not recoverable — R1's
      `-review-answer.txt` is gone from `.spur/run/` after the hop (the review receipt lists it as a written
      file at 23:04:52Z). The header-shape mismatch is a reproduction on a reconstruction, not a capture of
      the original; the bold `**Verdict: PASS**` in the recorded section is a second candidate for the
      `verdict-missing` finding. Both point at the same defect: the review answer contract that
      `/sp:dev-review` writes and the one `spur task verdict --from-answer` lints are not the same contract.
    - **Consequence.** Every pipeline run on every task must pass `review` to reach `done`. Until the two
      contracts agree — one edit in either `/sp:dev-review`'s answer shape or the lint's accepted tables —
      the rewrite cannot complete a task, and no amount of pipeline measurement produces a run that
      reaches `done`. This is the blocker for R1's "three completed runs"; it is outside this task's
      editable scope (`config/workflows/**`, `plugins/sp/**`) and is reported, not fixed.
      **Correction (this session, §4.8.2):** `7b0298dda` did land and does accept an `Item | State`
      per-requirement table, but the live `--auto` review answer carries neither a bare `Verdict:` line nor
      per-requirement rows, so this finding — and the block it describes — stands. See finding 13 for what
      the answer actually contains and where the remaining edit belongs.

13. **The review answer contract is still unmatched after `7b0298dda`, for two reasons the fix does not
    reach.** Measured on the engine's own captured answer this time
    (`.spur/run/82008861-…-review-answer.txt`, §4.8.2), not on a reconstruction: `spur task verdict 1243
    --from-answer` exits **1** with `verdict-missing` plus `req-missing` for R1, R2 and R3, and writes no
    `1243-verdict.json`, so `.spur/run/1243-review.status` folds to `FAIL` and `gate → remediate → gate →
    review` repeats.
    - **The verdict line is formatted, not bare.** `7b0298dda` left the parser's verdict matcher as
      `/^\s*Verdict:\s*(\S+)\s*$/gim`
      ([verify-answer-lint.ts:405](../../packages/app/src/services/verify-answer-lint.ts#L405)). The reviewer
      writes `**Verdict: PASS** — 0 P1, 0 P2, 2 P3, 3 P4.` — bolded, with a trailing summary — which the
      anchors reject. Widening the header table vocabulary could not help a line the parser never reaches.
    - **The table is run-level, not requirement-level.** The answer's table is
      `| WBS | Verdict | P1 | P2 |`. Its second cell `Verdict` *would* satisfy the header's status column
      (`h1 === 'verdict'` is accepted, [verify-answer-lint.ts:358](../../packages/app/src/services/verify-answer-lint.ts#L358)),
      but the first cell `wbs` fails the `idLike` test — it must be `req`/`requirement`/`r#`/`r`/`item` or
      `r<digits>`. And even a header the parser accepted would yield no usable rows: each row's `cells[2]`
      (`P1`) would be read as its evidence, and the row ids (`1243`) match no declared requirement. This is
      therefore not a header-vocabulary problem at all, and the `Item | State` acceptance cannot fix it.
    - **Where the fix belongs.** Either the `--auto` review answer must be written in the contract the lint
      reads (a bare `Verdict: PASS` line plus a per-requirement `| Req | Status | Evidence |` table), which
      is a `plugins/sp/**` change, or the lint must derive a verdict from the run-level table it actually
      receives, which is a `packages/app/**` change. Both are outside the reach of a measurement run, and
      both are one edit — but they are *different* edits than `7b0298dda`, which fixed a third shape (a
      per-requirement table spelled `Item | State`).
    - **The 2fb9fd960 fix was not re-exercised.** M1's `implement` hop passed on its own diff (2 files), so
      the verification-only admission that `2fb9fd960` repaired was never entered — the same situation as
      R1 (finding 7). It remains verified as "the hop runs without the defect", not as "the failure path is
      fixed".
14. **`workflow progress` under-reports a state whose actions ran.** In M1 the projection lists three
    `implement` attempts (123 597 ms) while `workflow trace` lists five actions for the same state, the last
    two `done 2739ms` and `done 384ms`; the projection shows those two as `status: ambiguous,
    attempts: []` (as it does for two `precheck` shells). Any stage sum read from the projection alone is a
    floor, not a total — 2.5 % low on M1's `implement`. This is the same observability class as finding 10
    (state rows repeat the sum over visits) and compounds it: the projection is neither per-visit at the
    state level nor complete at the attempt level.
15. **A `/tmp` clone makes the project gate fail on an environment-sensitive test, and the repair hop edits
    the test.** M1's gate visit 1 FAILed on `invocation execution context (1215) > the default runner keeps
    process cwd/env when the context is omitted` — the same test that failed attempt D (§4.4) — and the
    repair hop made it green by changing the test's `pwd` to `pwd -P`
    (`packages/app/tests/services/pr-review/pr-review.test.ts`, §4.8.1), i.e. by editing a pre-existing
    project test outside the probe's declared surfaces. Two implications for any future measurement:
    scratch clones under `/tmp` (a symlink to `/private/tmp` on macOS) charge a failed 4 min gate plus a
    ~100 s repair hop that writes code no task asked for; and the FAIL detail is lost because every gate
    visit writes the same `.spur/run/<wbs>-test-gate.log` path, so a second visit overwrites the first
    visit's failure. A clone created under the physical path (or a `realpath`-stable cwd) avoids the first
    problem; nothing currently preserves a per-visit gate log.

## 7. Evidence gaps (named, not scored)

- Rewritten-pipeline runs completed: **0**. Attempt A died on executor attestation (168 ms), B on the
  diff-scope guard after a real 138.5 s implement, C on the empty-implement admission after 104 s, D ran
  `precheck` + `implement` + two gates + `review` and was inside `remediate` visit 2 at its session's
  cutoff, R1 ran `precheck` + `implement` + three gate visits + two review visits + two remediate hops
  before it was cancelled inside the same loop (14.1 min), and this session's M1 ran `precheck` +
  `implement` + two **full** gates + `review` + one repair hop before its second repair hop died on the
  agent account's session limit (15.8 min, §4.8). M2 and M3 died in `implement` on the same limit after
  4.6 s and 5.8 s (§4.9, §4.10). The required three completed runs are **not** delivered; the causes are
  findings 13 (contract) and 15/§4.9 (environment + quota), not budget alone.
- Gate time: **measured** four times — 252.5 s FAIL + 226.5 s PASS (attempt D), 236.3 s PASS (R1), and
  243.8 s FAIL + 249.3 s PASS (M1, §4.8), all from `.spur/run/<wbs>-check-receipt.json`; plus two
  receipt-reuse visits at 516 ms and 1 959 ms (R1) and two **full** revisit runs spaced by a repair hop
  (M1, no reuse). `n/a` for A, B, C, M2, M3.
- Gate failure detail: **not recoverable** for M1's visit 1 — every visit writes the same
  `.spur/run/<wbs>-test-gate.log`, and visit 2 overwrote it; the failing test is identified from the repair
  hop's diff instead (finding 15), which is weaker evidence than a log line.
- Review time: **measured** three times — 189.6 s (D), 116.8 s / 105.1 s (R1), 206.1 s hop + 6.5 s
  apparatus (M1).
- Review certification: **FAIL on all four observed review visits**, artifact absent in every case. The
  second session's lint text was a reconstruction (finding 12); this session's is a live capture of the
  engine's own answer file (§4.8.2, finding 13). Numbers beyond that (which agent turns produced the
  answer) are `n/a` — no per-hop transcript was harvested.
- Driver overhead: **n/a** for every run — a subprocess-executor run has no host transcript (§6.3).
- Baseline reconciliation for implement/driver overhead: **unobtainable** — the baseline's run list
  was not published (§2.1).
- Per-stage cross-agent attribution: **unobtainable from `spur history`** — no stage dimension (§3).
- Per-stage means for the rewrite: **n/a** — no completed run exists to average.
- Probes 2 and 3 as time measurements: **not obtained**. M2 and M3 each spent one agent dispatch and were
  killed by the account quota (`You've hit your session limit · resets 8pm (America/Los_Angeles)`), so they
  measured `precheck` (71 ms, 112 ms) and the engine's failure handling — nothing about `implement`,
  `gate`, or `review`. A rerun after the quota resets is the only way to obtain those rows.

## 7.1 Timeline of what the sessions actually did

Earlier session (attempts A–D):

| Instant (UTC) | Event |
| --- | --- |
| 22:08:2x | scratch clone + `bun install` (1.4 s) + `bundle:config` |
| 22:08:46 | probe task 1243 created in the clone |
| 22:09:01 | attempt A (`codex`) — failed in 168 ms |
| 22:09:47 | attempt B (`claude`, `--trace-file`) started |
| 22:12:07 | attempt B failed at `implement` (diff-scope guard) |
| 22:13:5x | attempt C (`claude`, no trace file, dirty tree) started |
| 22:15:36 | attempt C failed: zero non-corpus changes (attempt B's edit was still in the tree) |
| 22:16:5x | second clone `/tmp/d65-measure-c3f1`, install + bundle + probe task |
| 22:17:02 | attempt D started on a clean tree |
| 22:19:13 | attempt D `implement` passed (129.5 s) |
| 22:19:16 | attempt D `gate` entered |

Second session (run R1, at `2fb9fd960`):

| Instant (UTC) | Event |
| --- | --- |
| 22:52:5x | `git clone --local` → `/tmp/d65-m2` at `2fb9fd960`; `bun install` 1.7 s; `bundle:config` |
| 22:53:33 | code probe task 1243 created, sections written, moved to `todo`; 1244/1245 created as spares |
| 22:53:40 | R1 started (`claude`, `--async`, no `--trace-file`) |
| 22:55:15 | light gate receipt written FAIL (`rules:post` → `coverage-provenance-check`, transient: 1244/1245 landed mid-run) |
| 22:56:22 | `implement` passed (159.1 s, 2 files) |
| 23:00:21 | `gate` visit 1 PASS (236.3 s; 11 514 tests, 215.81 s) |
| 23:02:18 | `review` visit 1 hop passed, certification FAIL → `remediate` |
| 23:03:13 | `gate` visit 2 PASS by receipt reuse (516 ms) |
| 23:04:58 | `review` visit 2 certification FAIL again |
| 23:06:58 | `gate` visit 3 PASS by receipt reuse (1 959 ms) |
| 23:07:44 | run cancelled (`spur workflow cancel`), terminal status `failed`, 14.1 min wall |

Third session (runs M1–M3, at `7b0298dda`):

| Instant (UTC) | Event |
| --- | --- |
| 23:18:35 | `git clone --local` → `/tmp/d65-m3` at `7b0298dda` |
| 23:18:38 | `bun install --frozen-lockfile --ignore-scripts` 1.63 s; `bundle:config` exit 0 |
| 23:19:00 | code probe task 1243 created via the CLI (sections written, moved to `todo`) |
| 23:19:03 | M1 started (`claude`, `--async`, no `--trace-file`) |
| 23:21:09 | `implement` passed (123.6 s, 2 files) |
| 23:25:17 | `gate` visit 1 **FAIL** (243.8 s; `invocation execution context (1215)` — finding 15) |
| 23:26:58 | repair hop 1 passed (99.6 s) — edited `pr-review.test.ts` `pwd` → `pwd -P` |
| 23:31:08 | `gate` visit 2 **PASS** (249.3 s, full re-run; 11 520 pass / 0 fail) |
| 23:34:41 | `review` hop passed (206.1 s); certification **FAIL** (verdict lint: `verdict-missing`, `req-missing` ×3) |
| 23:34:52 | repair hop 2 failed — agent exit 3, `You've hit your session limit · resets 8pm (America/Los_Angeles)`; run terminal `failed`, 15.8 min wall |
| 23:36:26 | code probe task 1244 created, sections written, moved to `todo` |
| 23:36:30 | M2 started |
| 23:36:36 | M2 failed in `implement` (4.6 s, agent exit 3, same quota text) |
| 23:36:56 | code probe task 1245 created, sections written, moved to `todo` |
| 23:36:58 | M3 started |
| 23:37:04 | M3 failed in `implement` (5.8 s, agent exit 3, same quota text) — last dispatch of the session |

## 8. Reproduce

### 8.1 `/tmp/d65-baseline.ts`

```ts
// Roll up .spur/run/*-summary.json into per-stage baseline figures.
import { readdirSync, readFileSync } from 'node:fs';

const dir = process.argv[2] ?? '.spur/run';
const norm = (s: string) => s.replace(/ \(visit \d+\)$/, '');
const runs: { j: any; wallMs: number }[] = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith('-summary.json'))) {
    let j: any;
    try { j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')); } catch { continue; }
    if (!j.startedAt || !j.completedAt || !j.rows?.length) continue;
    const stages = new Set<string>(j.rows.map((r: any) => norm(r.stage)));
    if (!stages.has('implement') || stages.has('feature-verify') || stages.has('doc-sync')) continue;
    runs.push({ j, wallMs: Date.parse(j.completedAt) - Date.parse(j.startedAt) });
}
const stageMs = new Map<string, number>(), stageCount = new Map<string, number>();
let overheadMs = 0, totalMs = 0, wallMs = 0, waits = 0;
for (const { j, wallMs: w } of runs) {
    wallMs += w; totalMs += j.total?.workMs ?? 0;
    for (const r of j.rows) {
        const s = norm(r.stage);
        if (s === 'driver overhead') { overheadMs += r.workMs ?? 0; continue; }
        stageMs.set(s, (stageMs.get(s) ?? 0) + (r.workMs ?? 0));
        stageCount.set(s, (stageCount.get(s) ?? 0) + 1);
        waits += r.waitMs ?? 0;
    }
}
```

### 8.2 Run-summary and progress inputs

- Baseline summaries: `/Users/robin/xprojects/spur-new/.spur/run/*-summary.json` (44 files, main
  checkout, gitignored — not in this worktree, `.spur/run/` here holds verdicts only).
- Attempt D progress: `/tmp/d65-run1-progress.json` (captured at that session's cutoff).
- Run R1 progress: `/tmp/d65-r1-progress.json` (during the run) and
  `/tmp/d65-r1-progress-final.json` (state before the cancel) — the latter is the source of every R1
  number in §4.6, read through `/tmp/d65-harvest.ts`, which sums `states[].actions[].attempts[].durationMs`
  rather than the state rows (§6.10).
- R1 launch output: `/tmp/d65-r1-launch.json`. R1 gate receipts: `.spur/run/1243-check-receipt.json`
  (full, PASS, `inputDigest` `93d27fa…`), `.spur/run/1243-test-gate.log`, `.spur/run/1243-gate-visits` (= 3),
  `.spur/run/1243-review-section.md`, `.spur/run/1243-review.status`, `.spur/run/8bf24b93-…-review-verdict.status`
  and `.spur/run/8bf24b93-9c78-4673-9ba5-078706d5f849/receipts/review.json`.
- History artifact: `/tmp/d65-analyze.json`.
- Launch output (earlier session): `/tmp/d65-run1-launch.json`, `/tmp/d65-run2-launch.json`,
  `/tmp/d65-run4-launch.json`, `/tmp/d65-install{2}.log`, `/tmp/d65-bundle{2}.log`.
- Four scratch clones: `/tmp/d65-measure-a7c2` (attempts A–C; dirty tree), `/tmp/d65-measure-c3f1`
  (attempt D; left mid-run), `/tmp/d65-m2` (run R1 at `2fb9fd960`; probe tasks 1243–1245) and
  `/tmp/d65-m3` (runs M1–M3 at `7b0298dda`; probe tasks 1243–1245, dirty tree carrying M1's two probe
  files plus the repair hop's `pr-review.test.ts` edit). All are throwaway.
- M1 progress: `/tmp/d65-m3-r1-progress.json` (mid-run) and `/tmp/d65-m3-r1-progress-final.json` (terminal) —
  the source of every M1 figure in §4.8, read from `states[].actions[].attempts[].durationMs`. Trace text:
  `/tmp/d65-m3-r1-trace.txt` (captured mid-run at 23:29Z, so it stops inside gate visit 2).
- M2 / M3 progress: `/tmp/d65-m3-r2-progress.json`, `/tmp/d65-m3-r3-progress.json`.
- M1 answer and lint: `.spur/run/82008861-9f35-4b58-8673-637430fe7e1f-review-answer.txt`,
  `.spur/run/82008861-…-review-verdict.status` (= `FAIL`), `.spur/run/1243-review.status` (= `FAIL`),
  `/tmp/d65-m3-verdict-lint.json` (the by-hand `spur task verdict 1243 --from-answer` run, exit 1).
- M1 gate receipts: `.spur/run/1243-check-receipt.json` (final: PASS, `tier: full`, `inputDigest`
  `a94e8e67…`). The FAIL receipt (`bfa00693…`, 23:25:17.870Z) was captured into this report's §4.8 table
  before visit 2 overwrote the file; `.spur/run/1243-test-gate.log` now holds visit 2's `11 520 pass /
  0 fail` plus the reviewer's appended section.
- M1 / M2 / M3 failure handoffs: `.spur/run/82008861-…-remediate-partial.md`,
  `.spur/run/8d0ac3ff-…-implement-partial.md`, `.spur/run/b252fc11-…-implement-partial.md` — each carries
  the verbatim terminal text and the resolved invocation.

## 7. Completed D65 certification runs

The repeatable result is [d65-real-task-pipeline-receipt.json](./d65-real-task-pipeline-receipt.json). Current host work used no model stub. Every task ran the original full gate; no reduced command, assertion suppression, baseline change or forced done transition was used. The retained scratch worktree is `/tmp/spur-d65-proof-20261018`. Engine trace action durations are summed once by action id; ambiguous positional progress mappings are counted in the receipt and are not used to infer missing action durations.

| Task / run | Precheck ms | Implement ms | Gate ms | Remediate ms | Review ms | Done ms | Action total ms | Run wall ms | Gate receipt ms | Driver overhead |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1232 / `075683d4-0235-4e3f-832d-f30de89eac6e` | 842 | 1964 | 202489 | 0 | 6352 | 1792 | 213439 | 215208 | 200570 | n/a |
| 1237 / `0123eef5-e310-4322-a5d6-0e6b023a806e` | 875 | 1991 | 197970 | 0 | 5848 | 1773 | 208457 | 210257 | 196120 | n/a |
| 1238 / `0e9239ff-d131-40d7-aa97-e58fc41cae11` | 2277 | 1877 | 195434 | 0 | 5829 | 1766 | 207183 | 208940 | 193390 | n/a |

Baseline remains 32 runs / 2550 min / 815 min driver overhead as originally recorded; its read-only reproduction remains 33 qualifying summaries / 2551 min / 692 min driver-overhead rows. Neither set was retuned. Per-stage baseline aggregates remain in section 2. The certification sample carries no implementation workload comparable to those runs, so a percentage speedup or comparable driver-overhead delta would be unsupported. Unattributed host intervals are not relabeled model time or driver overhead.

### 7.1 Fresh cross-agent aggregate

`bun run apps/cli/src/index.ts history analyze --since 2026-10-10 --until 2026-10-18 --out .spur/run/d65-verifyall/history-analysis-final.json --json` exited 0. This reads already-imported history, does not import new sessions, and supplies cross-agent aggregates rather than stage timing.

| Source | Records | Records with usage | Tool calls | Input tokens | Output tokens | Reported cost USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| agy | 14952 | 0 | 7181 | 0 | 0 | 0 |
| claude | 31450 | 6296 | 5759 | 758547968 | 3459848 | 57.524559999999994 |
| codex | 30491 | 3227 | 3803 | 1087580391 | 1481428 | 679.5353520000001 |
| grok | 65310 | 30 | 6978 | 168014534 | 726451 | 0 |
| pi | 232782 | 70333 | 81909 | 11795040443 | 57986416 | 472.549161 |

Zero usage/cost fields in imported history are source-reported aggregates, not proof of zero cost; `recordsWithUsage` shows coverage.

### 7.2 Findings and retained failed attempt

- The preceding attempt `5162fc56-ac17-4485-b3d1-f3951a28d319` failed after its bounded repair budget: wall 1080190 ms; gate action exit codes `[1, 1, 1]`. Fixture environment inheritance, an intermediate fleet collaborator typing mismatch, and missing TSDoc were corrected. The subsequent attempt `0be9cca6-0ad4-4ab7-8b3b-4b6dc2e8ab28` also failed its bounded repair budget (803115 ms wall); its costs are retained separately. The final fresh attempt completed; the failed cost is retained in the JSON receipt rather than blended out.
- Full gates dominate these certification runs. Their passing costs are measured above; no runtime improvement is inferred from a workload that does not implement new code.
- Positional `workflow progress` mapping can be ambiguous for repeated action kinds. Raw trace action ids provide the stage aggregates above; diagnostics remain disclosed.
- Driver overhead and token/cost comparison remain unavailable without a compatible host transcript. The summary now retains engine timing and gate time and prints unavailable usage as `n/a`, including batch rollups.
- The separate real-task executor matrix uses stubbed models only for subprocess/fleet transport parity. Those runs are excluded from the performance sample.

The later real-task fleet parity run exposed a matching role selector (`agent: coder`) being mistaken for a binary pin. The fleet-only fix and its red/green regression followed the three host measurements above; those host timings are retained as measured, and the final repository gate certifies the later source. The parity receipt records both the fixture environment failure and selector failure before their successful retries.
