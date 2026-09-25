---
kind: design
title: "Workflow execution economy"
status: accepted
created_at: 2026-09-16
updated_at: 2026-09-24
related: [D62, "0867", "0868", "0872", "0873", "0876", "0877"]
tags: [system, D62, workflow]
---

# Workflow execution economy

**Area:** where workflow machine time goes, what the trace must record for that to be knowable,
how an expensive stage fails cheaply, and at what scope a validation gate belongs.
**Status:** feature D62 in flight (2026-09-16): ADR-117/118/119 accepted; §2 trace parity, §3
contract-violation routing, and §4 gate scope shipped (tasks 0870–0872, pilot on `wrapup-pipeline`);
the §5 promotion gate awaits the real-run evidence accruing under tasks 0873/0876. Decisions: ADR-117
(trace parity), ADR-118 (contract
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

### 2.4 Inline run identity, closure and installed execution

`plugins/sp/scripts/inline-run-setup.ts` creates-or-attaches the authoritative run row.
Its existing `--action` and `--close` modes (0868/0879) record action outcomes and terminal
closure through the shared application writer. Action observation failure is best-effort;
identity setup and terminal bookkeeping fail nonzero. The previous absence of closure described
below is historical, not the current runtime contract.

In the 2026-09-16 baseline, missing closure corrupted the catalogue statistics. Of `task-lifecycle`'s 496 `failed`
rows, **470 carry a `staleReason` from `spur workflow clean`**, as do 87 of `feature-lifecycle`'s 106
— those are unclosed rows, not failures. `task-pipeline` is less affected (27 of 217 reaped), so its
measured completion rate stands roughly as reported, but the catalogue-wide picture does not.

Closing the run row at its declared terminal state is part of the ADR-117 emission obligation: a
surface that can open a run owes the row that ends it.

Task 0914 makes the same boundary usable from a bundle-only plugin install. The build generates
`plugins/sp/lib/inline-run.generated.mjs` from the existing app setup, fingerprint and trace functions
plus the existing embedded schema assets; it contains no second SQL writer or digest algorithm.
The standard `inline-run-setup.mjs` twin uses Bun for the existing SQLite runtime, without requiring
workspace packages or repository source files on the installed target.

For source and installed setup, the selected Spur CLI's existing `workflow show --format todo --json`
projection owns project/registered/shared resolution. The application service validates the
projection and re-loads its selected definition under schema validation, checks name and digest,
and only then persists that source identity. Changed definitions, invalid projection/source and
incompatible existing rows fail closed. Configuration stays owned by the CLI composition root;
direct application callers pass already-resolved registered paths. Fingerprint/action/close calls use the same application functions
without starting a model or another workflow. This adds no public CLI noun or verb and does not
extend inline engine-resume, artifact-ledger or DecisionMaker capabilities.

### 2.3 Required shape

- Every executed action gets an `action_runs` row: node, kind, status, `ok`, `duration_ms`, `run_id`.
- Exactly one start name and one finish name per action boundary; the alias pairs collapse to one.
- `agent.invoke.*` events carry the dispatching run's non-null id.
- Emission is best-effort **at the boundary only**. A failed write is recorded and the run continues
  to its declared terminal state; observation never wedges the thing observed.
- `projectWorkflowProgress` (`packages/app/src/workflow/progress-projection.ts`, 506 lines, which had
  no CLI consumer) is exposed read-only as `spur workflow progress <run-id> --json`. The command
  renders; it adds no projection logic. The existing observability modules — `observability.ts`,
  `step-reporter.ts`, `steering.ts`, `escalation-packet.ts`, `tripwire.ts`, `trace-writer.ts` — are
  wired, not rebuilt.

## 3. Stage contracts (ADR-118)

An `agent.run` stage already declares its post-conditions (`answerFile`, `expectFile`, `requireDiff`,
`escalationFile`, verdict parseability). Before tasks 0870/0871 a stage that exited cleanly and missed one was
indistinguishable in the trace from an executor that crashed: both were `ok: false`, and both cost a
full re-dispatch of a stage averaging 357 s.

| Outcome | Signal | Routing |
| --- | --- | --- |
| success | contract satisfied | declared success edge |
| `contract-violation` | clean exit, declared post-condition unmet | dedicated repair edge; first attempt must not re-dispatch the full stage |
| escalated (paused) | clean exit, non-empty `escalationFile` | pipeline `escalate` gate; the run stays `paused` until an operator answer (0933) |
| executor failure | non-zero executor exit, transport error | existing retry semantics |

`escalationFile` is the one post-exit contract that is a **question signal**, not an assertion: a
non-empty file means the agent paused instead of finishing, so the attempt reports success with
`data.escalated = true` and `requireDiff` is skipped for that attempt only. It is not a
`contract-violation` — nothing was violated — and the pause is bounded by the pipeline's
`maxEscalations`.

Shipped (tasks 0870/0871): the violation is detected and named **before the stage reports success**
— the run log carries the `workflow.agent.contract-violation` line and the action trace records
`outcome`/`contract`/`observed`. A definition opts in by setting `onError: continue` on the hop and
authoring a `contract-violation`-guarded edge (the guard passes iff the prior action's
`data.outcome === 'contract-violation'`), routing to a repair path that does not re-dispatch the full
stage on its first attempt. The pilot lives on `wrapup-pipeline`; its first real-run routing decision
is recorded under task 0876. Definitions without the edge are unchanged. Rejected alternatives and
their reasons are in ADR-118.

## 4. Gate scope (ADR-119)

| Scope | Examples | Owner |
| --- | --- | --- |
| task-local | this diff compiles; its own tests pass; the task carries its required sections | per-task pipeline |
| repo-wide | corpus consistency, traceability, contract baselines, doc sync, catalogue rule sweeps | one feature-scoped verification pass, once per feature |

A per-task pipeline may not host a check that can fail for a reason the current task did not cause.
The direct saving is ~55 s per task (≈9% of per-task wall clock); the load-bearing saving is the
cross-scope model rework those failures trigger (`resolve-scope` 43%, `doc-sync` 35%, `verify` 21%).
The feature-scoped pass is deliberately the slow one, run once per feature (invoked at
`verifying` entry), and a feature is not done until it passes.

### 4.1 Per-check classification (task 0872)

The per-task pipeline's quality gate is `bun run spur-check` (task-pipeline `qualityGateCmd`). Task
0872 relocates its repo-wide components into `bun run spur-check-feature`, run by the
`feature-verification` workflow, leaving `spur-check` task-local. The pipeline's own precheck shells
(`task-size-precheck`, `task-evidence-precheck`, `spur task check`) are task-local by construction.

| Check | Invariant it protects | Scope |
| --- | --- | --- |
| `link-check` | no `bun link`-ed `@gobing-ai/*` package serves a `dist/` older than its `src/` | repo-wide (developer-environment invariant, not caused by any task diff) |
| `transition-shim-check` | every `@transition-shim(<id>)` marker ↔ `config/transition-shims.json` entry (two-sided) | repo-wide (whole-repo manifest/marker consistency) |
| `script-contract-check` | every `plugins/sp/scripts/` entry ↔ `config/plugin-scripts.json` and its `.mjs` twin (two-sided) | repo-wide (whole-repo script-contract consistency) |
| `inline-pipeline-parity-check` | the inline driver's documented action/guard set ≡ the resolved sets across all `config/workflows/*.yaml` | repo-wide (driver↔catalogue parity) |
| `dependency-drift-check` | `bun.lock` ↔ installed `@gobing-ai/ts-*` versions | repo-wide (environment invariant) |
| `importer-schema-check` | the SQLite DB's recorded importer schema version ≡ the installed importer package | repo-wide (shared-DB invariant) |
| `history-surface-freeze-check` | the frozen History UI + transport contract are unchanged vs the merge base (E91) | repo-wide (whole-branch frozen-surface invariant) |
| `lint` (biome + typecheck) | the tree compiles and is formatted | task-local (violated by the diff that breaks it) |
| `test-pre-check` (rule preset) | source respects the typescript/structure/boundary/surface/ui/strict rules | task-local (violated by the diff that introduces the pattern) |
| `test` (`bun test`) | each package's tests pass | task-local, **except** repo-wide test files relocated to `repo-wide-tests/` (e.g. `adr-supersession.test.ts`, which diffs `docs/00_ADR.md` against HEAD and fires on a sibling's uncommitted ADR addition) |
| `test-post-check` (`tsdoc-exports` + `coverage-gate`) | exported symbols are documented; per-file line coverage ≥ 90% | task-local for `tsdoc-exports`; the `coverage-gate` is repo-wide in principle but inert in the per-task gate (no lcov unless `test:coverage` ran) and only fires in the deliberate `:full`/`check` chain, which is not the per-task pipeline |

No check is authored by the split — the repo-wide set is relocated into `spur-check-feature`, and the
repo-wide test file moves to `repo-wide-tests/` unchanged except its repo-root anchor.

## 5. Promotion gate (ADR-076 amendment)

Where a graph change is genuinely needed, the candidate is shadow-run against recorded real-run
inputs and promoted-or-deleted by a date named at creation. The verdict cites `agent.run` count and
duration from run history. No unreferenced parallel definition survives past its named date. This is
what replaces the `task-pipeline2.yaml` pattern ADR-076 deleted: the user-proposed
"add `<name>2.yaml` beside `<name>.yaml`" strategy was already built (tasks 0596, i6), run 9 times,
and retired for reasons that still hold — four attempts over two days of live model quota, never
reaching a verdict, blocking a feature chain.

The gate is operational (task 0873) as the repo-internal `bun scripts/spur-dev.ts promotion`
command and a candidate record at `config/workflow-candidates.json`.

### 5.1 Candidate record

A candidate is a **record**, never a standing parallel YAML: its canonical target, a deadline named
at creation, the recorded real-run inputs to replay, and the projected `agent.run` count. `verdict`
is `null` while pending and is filled by `promotion evaluate`.

| Field | Meaning |
| --- | --- |
| `canonical` | the workflow definition the candidate changes (basename sans `.yaml`) |
| `deadline` | the date (YYYY-MM-DD) by which it is promoted or deleted — named at creation |
| `measurement.workflow` / `runIds` | the recorded real-run inputs the shadow-run replays |
| `delta.agentRunCount` | the candidate's projected `agent.run` action count per run, in the gate's declared-count vocabulary |
| `delta.baselineAgentRunCount` | optional (0921): the incumbent's declared count at registration, pinning what the candidate replaces — the ADR-076 bar compares the projection against this baseline, so an already-applied change still evaluates against its origin; absent, the live canonical count is the comparator |
| `verdict` | `null` pending; the shadow-run decision once evaluated |

Registration policy (0935): new candidate registrations **pin `delta.baselineAgentRunCount`** to
the incumbent's declared `agent.run` count at registration time. This is a documented convention,
not a registry validator rule — `validateCandidate` still accepts absence so legacy records stay
loadable, and absent a pin the live canonical count remains the comparator (§5.2). The pin is what
lets an already-applied change keep evaluating against its origin instead of silently comparing the
projection to itself.

### 5.2 Shadow-run comparison

The shadow run replays the recorded `action_runs`/`runs` history of the canonical workflow — the
per-run `agent.run` action count and summed duration over terminal, non-dry runs — rather than
paying live model quota against a fixture. The verdict (R2) cites both measured quantities, and its
promote/delete decision is the ADR-076 bar: a candidate is promoted only when it projects strictly
fewer `agent.run` actions than the incumbent baseline (`delta.baselineAgentRunCount` when
registered, 0921; otherwise the canonical definition's live declared count) declares; otherwise it
is deleted. `promotion evaluate` additionally refuses (0921) when a registered baseline matches
neither the live count (change not yet applied) nor the projection (change already applied) —
registry/live drift must be re-registered, never evaluated. Duration is cited as measured context,
never the decision — a candidate's duration is only knowable by running it, which the shadow run
deliberately does not.

### 5.3 Deadline enforcement

`promotion resolve --decision promote|delete` resolves a candidate: delete removes it; promote first
verifies the canonical definition now declares the candidate's projected `agent.run` count and then
removes it, refusing (exit 1) until the canonical change has actually landed. `promotion check` —
wired into `spur-check-feature` as the repo-wide catalogue check — fails (R3/R4) on any candidate
still present past its named deadline, on any unreferenced `<name>2.yaml`-style parallel
definition in `config/workflows/`, and (0877 R8, 0866 review finding 6) on any definition retired
with real non-dry terminal runs but no recorded retirement decision in the candidate record's
`retirements[]` (scoped to names ever tracked in git history; dry-only history does not block).

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
(scenario R15), added to this feature after the original batch was approved. Resolved by **unbinding
`dependencies` from the planning digest** (`packages/app/src/services/task-readiness.ts`,
`computePlanningDigest`) — the smaller of the two options: it needs no new ordering state, keeps the
ready-checklist `dependencies` row as the drift check, and makes `handoff-finalize` idempotent as a
consequence rather than a second fix.

## Feature verification receipt — v1 service contract (D63 task 0915)

The feature-scoped verification pass (above) recorded evidence as a bare
`.spur/run/<fid>-feature-verification.status` string — identity-blind, input-blind,
writer-blind. Task 0915 replaces it with a bound receipt service; the status file
remains as coarse routing evidence for the `feature-verification` workflow's internal
`verify→done` transition, but it no longer satisfies completion by itself.

**Writer.** The `feature-verification` workflow's `onEnter` script
(`plugins/sp/scripts/feature-verification-steps.ts`) is the single writer: it resolves
the workflow definition, captures the before digest, records a RUNNING receipt, shells
the configured command via `splitLaunchCommand` (log appended to
`.spur/run/<runId>-feature-verification.log`, 4h timeout), captures the after digest and
completes the receipt atomically (tmp+rename). The CLI `feature verify` verb is removed.

**Artifacts** (written by the receipt service in `packages/app/src/workflow/feature-verification-receipt.ts`,
schema `feature-verification-receipt/v1`):

| Copy | Path | Role |
| --- | --- | --- |
| Run-scoped | `.spur/run/<runId>-feature-verification.json` | evidence bound to the engine run; registered as a run artifact |
| Feature-latest | `.spur/run/<featureId>-feature-verification.json` | latest pass per feature; superseded by the next `start` |
| Coarse status | `.spur/run/<runId>-feature-verification.status` | `PASS`/`FAIL` string for the workflow guard |

Receipt fields: `schemaVersion`, `featureId`, `runId`, `workdir` (diagnostic; the
digest is path-relative), `verifier` (`name`, `sourcePath`, `layer`, `definitionDigest`),
`verificationCmd`, `status` (`PASS`/`FAIL`/`RUNNING`), `startedAt`, `completedAt`
(null while `RUNNING`) and `inputDigest` — the proof-input fingerprint (feature
markdown + git tree of tracked sources, shared `ProofInputFingerprint` engine)
captured at completion, i.e. the tree *after* the pass; completion re-checks it
against current inputs. The script additionally captures a before digest around
the pass and fails it when they disagree, but only the after-side digest is bound
into the receipt.

**Completion boundary.** `FeatureCheckService.check` validates the feature-latest copy
when the transition target is `--as done` (plain on-disk `done` reads stay advisory —
no backfill burden on pre-receipt features). Eight unsuppressible `L4.feature-receipt-*`
error reasons, checked in order: `missing`, `malformed`, `cross-feature`, `divergent`
(the two copies disagree), `failed`, `run` (run-store binding broken: run row absent,
not done, verifier digest mismatch, or receipt not registered as a run artifact —
skipped when no run port is supplied), `contract-mismatch` (recorded verifier name/
layer/digest or `verificationCmd` differs from the currently resolved `feature-verification`
definition — `--cmd` overrides cannot forge a contract), and `stale` (digest drift: the recorded `inputDigest` no longer matches the current tree). Git failure during digest capture is
fail-closed (0751 R1). All completion paths enforce: `feature advance`'s done hop and
the engine `verifying→done` guard (`feature check --strict --as done`).

**Ordering and replay.** Re-running the pass overwrites both copies (start supersedes
the feature-latest copy first; complete writes both + the coarse status). Wrapup
mutations that land after the pass change the tree digest and make the receipt stale,
forcing re-verification — record/learning writes must complete before the final pass,
and the digest chain (not call order) enforces it. Unchanged valid evidence is reused
without re-running the repo-wide pass. The wrapup pipeline gained a `feature-verify`
state that re-runs the feature check gate (`featureGateCmd`; receipt-enforcing
under the done-boundary variant) before `done`.
