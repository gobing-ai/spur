# Workflow execution economy

**Area:** where workflow machine time goes, what the trace must record for that to be knowable,
how an expensive stage fails cheaply, and at what scope a validation gate belongs.
**Status:** proposed (feature D62, 2026-09-16). Decisions: ADR-117 (trace parity), ADR-118 (contract
violation as a stage outcome), ADR-119 (check scope matches change scope), ADR-076 amendment
(measured promotion gate).
**Authority:** derived; decisions live in `00_ADR`, module boundaries in `03_ARCHITECTURE`, the
workflow catalogue's dispositions in [workflow composition contract](workflow-composition-contract.md).

## 1. Measured baseline

All figures from this checkout's `.spur/spur.db` on 2026-09-16 (`action_runs` 2,703 rows; `runs`
~1,400 rows). They mix dogfood, development and abandoned-experiment runs: the best available signal,
not a controlled benchmark.

| Action kind | Actions | Total | Avg | Share of machine time |
| --- | --- | --- | --- | --- |
| `agent.run` | 723 | 4,172.9 min | 357 s | **96%** |
| `shell` | 1,425 | 141.2 min | 6.0 s | 3.3% |

Per-node `agent.run` failure rates: `implement` 46% (83/180, 9.9 min avg, 1,702 min total),
`resolve-scope` 43%, `doc-sync` 35%, `verify` 21%. Gate-shaped shell nodes in `task-pipeline`:
`test` 19.1 s, `test-recheck` 35.3 s, `precheck` 0.5 s — ~55 s per task against `implement`'s 594 s.

**Consequence for the original proposal.** Simplifying `shell` nodes cannot move performance: shell is
3.3% of machine time at 6.0 s average. Guard legibility is still worth doing — `idea-pipeline` carries
27 chained-`test` guards and `task-pipeline` a 455-character guard — but it is a correctness and
reviewability argument, and labelling it a performance win would make the work read as a failure.

## 2. Trace parity (ADR-117)

### 2.1 The gap

1,011 of ~1,400 run rows carry zero `action_runs`. The inline driver — the ADR-047 default for
`/sp:dev-run`, `/sp:dev-idea` and `/sp:dev-plan` — writes a flat text log at `.spur/run/<run-id>.log`
and emits no structured rows. 276 of 443 `agent.invoke.start` events carry a NULL `run_id`, so the
single most expensive thing a run does cannot be attributed to the run that paid for it. The event
vocabulary also double-names one boundary: `workflow.action.start` and `.started` were each emitted
342 times, `.done` and `.finished` each 338.

### 2.2 The correction this forced

A first reading of the same data classified `docs-pipeline`, `feature-dev`, `feature-lifecycle`,
`task-lifecycle` and `basic` as zero-traffic and therefore retirable. Two of those are load-bearing:

| Definition | Runs | Traced | Nature |
| --- | --- | --- | --- |
| `task-lifecycle` | 564 | 0 | externally driven status FSM (`requestTransition` from `spur task`); last run 2026-09-16 |
| `feature-lifecycle` | 136 | 0 | same, from `spur feature`; last run 2026-09-15 |
| `docs-pipeline` | 23 | 0 | 1 `done`, 2026-07-04; the rest a single failed sweep on 2026-09-13 |
| `feature-dev` | 22 | 0 | 0 `done`; same 2026-09-13 sweep |
| `basic` | 31 | 0 | 0 `done`; same 2026-09-13 sweep |

`task-lifecycle` and `feature-lifecycle` are externally driven graphs with no actions to run, so zero
`action_runs` is correct for them and says nothing about their traffic. **The retirement discriminator
is therefore not "zero `action_runs`" but "zero real completions and no live caller",** and the
roster narrows from five definitions to three: `basic`, `feature-dev`, `docs-pipeline`.
`docs-pipeline` is the contested one — ADR-071 shipped its digest-bound proof chain and it holds a
`config/pipeline-budgets.json` entry — so it is evaluated, not assumed.

That a documented reading of the trace produced a wrong retirement list is the argument for ADR-117.

### 2.4 The inline surface cannot close its own run row

`plugins/sp/scripts/inline-run-setup.ts` creates-or-attaches the authoritative run row, and no
supported path marks that row terminal when the inline run completes — the script takes `--run-id`,
`--file`, `--fingerprint` and `--spur-bin`, and `spur workflow` offers `cancel` (wrong verdict for a
successful run) and `clean` (reaps non-terminal rows as stale). A successful inline run therefore
stays `running` until housekeeping reaps it.

This corrupts the failure statistics the catalogue is judged by. Of `task-lifecycle`'s 496 `failed`
rows, **470 carry a `staleReason` from `spur workflow clean`**, as do 87 of `feature-lifecycle`'s 106
— those are unclosed rows, not failures. `task-pipeline` is less affected (27 of 217 reaped), so its
measured completion rate stands roughly as reported, but the catalogue-wide picture does not.

Closing the run row at its declared terminal state is part of the ADR-117 emission obligation: a
surface that can open a run owes the row that ends it.

### 2.3 Required shape

- Every executed action gets an `action_runs` row: node, kind, status, `ok`, `duration_ms`, `run_id`.
- Exactly one start name and one finish name per action boundary; the alias pairs collapse to one.
- `agent.invoke.*` events carry the dispatching run's non-null id.
- Emission is best-effort **at the boundary only**. A failed write is recorded and the run continues
  to its declared terminal state; observation never wedges the thing observed.
- `projectWorkflowProgress` (`packages/app/src/workflow/progress-projection.ts`, 506 lines, no CLI
  consumer today) is exposed read-only as `spur workflow progress <run-id> --json`. The command
  renders; it adds no projection logic. The existing observability modules — `observability.ts`,
  `step-reporter.ts`, `steering.ts`, `escalation-packet.ts`, `tripwire.ts`, `trace-writer.ts` — are
  wired, not rebuilt.

## 3. Stage contracts (ADR-118)

An `agent.run` stage already declares its post-conditions (`answerFile`, `expectFile`, `requireDiff`,
verdict parseability). Today a stage that exits cleanly and misses one is indistinguishable in the
trace from an executor that crashed: both are `ok: false`, and both cost a full re-dispatch of a
stage averaging 357 s.

| Outcome | Signal | Routing |
| --- | --- | --- |
| success | contract satisfied | declared success edge |
| `contract-violation` | clean exit, declared post-condition unmet | dedicated repair edge; first attempt must not re-dispatch the full stage |
| executor failure | non-zero executor exit, transport error | existing retry semantics |

The violation is detected and named **before the stage reports success**, and the run log and trace
record which contract was violated and the observed value. Rejected alternatives and their reasons
are in ADR-118.

## 4. Gate scope (ADR-119)

| Scope | Examples | Owner |
| --- | --- | --- |
| task-local | this diff compiles; its own tests pass; the task carries its required sections | per-task pipeline |
| repo-wide | corpus consistency, traceability, contract baselines, doc sync, catalogue rule sweeps | one feature-scoped verification pass, once per feature |

A per-task pipeline may not host a check that can fail for a reason the current task did not cause.
The direct saving is ~55 s per task (≈9% of per-task wall clock); the load-bearing saving is the
cross-scope model rework those failures trigger (`resolve-scope` 43%, `doc-sync` 35%, `verify` 21%).
The feature-scoped pass is deliberately the slow one, run once against a settled tree, and a feature
is not done until it passes.

## 5. Promotion gate (ADR-076 amendment)

Where a graph change is genuinely needed, the candidate is shadow-run against recorded real-run
inputs and promoted-or-deleted by a date named at creation. The verdict cites `agent.run` count and
duration from run history. No unreferenced parallel definition survives past its named date. This is
what replaces the `task-pipeline2.yaml` pattern ADR-076 deleted: the user-proposed
"add `<name>2.yaml` beside `<name>.yaml`" strategy was already built (tasks 0596, i6), run 9 times,
and retired for reasons that still hold — four attempts over two days of live model quota, never
reaching a verdict, blocking a feature chain.

## 6. Sequence

1. **Retire** `basic` and `feature-dev`; evaluate `docs-pipeline` against §2.2's discriminator. Fewer
   graphs makes the review of the rest tractable.
2. **Wire the trace** (§2) — nothing below is measurable before this lands.
3. **Contract-first stages** (§3), piloted on `wrapup-pipeline`: 99 runs, the best real completion
   rate on record, 9 states, 1 `agent.run` — small enough to iterate, real enough that the lesson
   transfers. This preserves "start easy" while fixing its target; the originally proposed starting
   points were the untraced graphs.
4. **Consolidate gates** (§4).
5. **Shadow-run** any graph change that survives (§5), then guard legibility and state granularity
   where the now-visible data proves a need.

## 7. Obligations on adjacent docs

- [workflow composition contract](workflow-composition-contract.md) owns the catalogue's target
  inventory; its dispositions for the §2.2 roster update when a retirement lands.
- `config/pipeline-budgets.json` holds an entry per shared workflow with a model query (ADR-115);
  retiring a definition removes its entry.

## 8. Recorded defect — idea-pipeline planning-digest ordering

Observed during this feature's own planning run (`E03850FB-…`, 2026-09-16). `ready-prepare`
computes each task's `planningDigest`, and `computePlanningDigest` binds frontmatter
`dependencies`. `handoff-finalize` then applies `spur task deps` from the order sidecar — mutating
exactly that field. Every task carrying a dependency therefore reports *"planning digest stale —
task content changed after preparation"* and the handoff degrades to ready-depth `refineall`, even
though nothing changed but the dependency the preparation stage had already recorded as evidence.

On this run 6 of 9 tasks tripped it; the 3 with no predecessors passed. Any idea-pipeline run whose
decomposition declares an ordering hits it deterministically. The same ordering also makes
`handoff-finalize` non-idempotent: a second pass over an unchanged corpus reports every dependent
task stale, because pass one wrote the dependencies pass two's digest now includes.

Fix is an ordering or scoping choice — apply dependencies before the digest is taken, or exclude
`dependencies` from the planning digest — not a readiness question. Carried as task **0875**
(scenario R15), added to this feature after the original batch was approved.
