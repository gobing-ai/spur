---
kind: design
title: "Workflow catalogue refactor — measured, decision-explicit, check-deduplicated, fleet-optional"
status: implemented
created_at: 2026-09-23
updated_at: 2026-09-25
related: [D64, "0937", "0938", "0939", "0940", "0941", "0942", "0943", "0944", "0945", "0946"]
tags: [system, D64, workflow]
---

# Workflow catalogue refactor — measured, decision-explicit, check-deduplicated, fleet-optional

- **Status:** Implemented · **Date:** 2026-09-23 · **Feature:** D64
- **Depends on:** D63, E7, H53, H1 (no implementation task starts before they are done)
- **Decisions:** ADR-124 (check receipts), ADR-125 (`decide` action), ADR-126 (fleet executor surface)
- **Extends:** [workflow execution economy](workflow-execution-economy.md) (ADR-117/118/119, promotion
  gate §5, feature verification receipt), [fleet declaration](fleet-config-declaration.md) (ADR-116),
  [inter-agent control plane](inter-agent-control-plane.md), ADR-123 (DecisionMaker at the HITL seam)

## 1. Problem

The canonical catalogue works, but three costs dominate and none is visible per run:

1. **Duplicated checking.** The gate runs at `test` and `test-recheck`, and model review stages are
   told to re-run tests on the same tree. `quality-gate.ts` de-duplicates the retry loop but not the
   *re-execution across stages* on an unchanged tree (§4 audit).
2. **Opaque branching.** Fuzzy decisions (is this change low-risk? is this failure retryable?) are
   either hidden inside `agent.run` prompts or encoded as blind retry caps.
3. **No cost truth per workflow.** Runs carry no terminal reason; lifecycle bookkeeping rows and
   metric rollups share tables, so a cost baseline cannot be reproduced.

"More states" alone does not fix these: every extra `agent.run` stage adds a cold model hop
(ADR-121: `agent.run` ≈ 96% of machine time). Extra **deterministic** states are cheap and add
observability; extra model states must earn promotion (ADR-076 §5).

## 2. Principles

| Principle | Consequence |
| --- | --- |
| Measure before reshaping | Phase 0 lands before any graph change; every graph change is a promotion candidate |
| Deterministic before model | A fact a command can establish is never asked of a model or of `decide` |
| Check once per fingerprint | A check result is a receipt bound to the proof-input fingerprint; unchanged input reuses it |
| Surfaces stay equivalent | inline, subprocess and fleet surfaces record the same identity, evidence and terminal reason |
| Opt-in novelty | fleet executor and `decide` default off / degrade deterministically; traditional path unchanged |

Non-goals: new engine, nested workflows, `<name>2.yaml` parallel copies, removing operator taste
pauses, making the fleet default, a new public `spur` noun/verb without separate consent.

## 3. Phase 0 — instrument

- **Terminal-reason taxonomy.** Closed enum recorded on every run at terminal/paused state:
  `done`, `paused-operator`, `failed-check`, `failed-agent`, `failed-timeout`, `failed-guard`,
  `cancelled`, `interrupted`, `retry-exhausted`. Persisted in a `runs.terminal_reason` column
  (migration 0049). The engine (`ts-dual-workflow-engine`) owns `finalizeRun`, so its facade gains an
  optional opaque `reason` and state-machine transitions gain an optional `terminalReason`; Spur owns
  the enum and a classifier over engine built-ins (`no-passing-transition` → `failed-guard`,
  `iteration-bound-exceeded` → `retry-exhausted`, …). `inline-run-setup --close --reason` covers the
  inline surface; validation requires a declared reason on every edge into a `failureStates` member.
  Legacy nulls read `unclassified`.
- **Bookkeeping vs metrics.** Lifecycle runs (`task-lifecycle`, `feature-lifecycle`, which dominate run
  counts) are classified report-side by one `BOOKKEEPING_WORKFLOWS` constant and excluded from cost
  rollups by default — no row-kind column.
- **Baseline report.** Extends the existing `bun scripts/spur-dev.ts real-run-cost` (not a public verb,
  no new command) with a per-state view: visits, `agent.run` count, wall time p50/p90, retry count
  (repeat state visits), terminal-reason mix. Deterministic for the same DB snapshot; output pinned as
  the Phase 2 baseline.

## 4. Phase 1a — `spur-check` (ADR-124)

One check primitive with two tiers, replacing ad-hoc gate invocations across stages.

| Tier | When | Scope | Reuse |
| --- | --- | --- | --- |
| `light` (accumulative) | after each implement/fix edit | changed files: format, lint, typecheck of touched workspaces, related tests | skip any sub-check whose receipt fingerprint matches |
| `full` (comprehensive) | once at the task quality boundary (`test`) | task-local chain = today's `bun run spur-check` | review/verify/record read the receipt; never re-run |

**Receipt.** `.spur/run/<wbs>-check-receipt.json`, schema `check-receipt/v1`:
`{schemaVersion, wbs, runId, tier, inputDigest, checks:[{id, cmd, status, durationMs, logPath}], status, completedAt}`.
`inputDigest` is the shared `ProofInputFingerprint` (task markdown + git tree of tracked sources) —
the same engine as the feature verification receipt; no second fingerprint. The plugin script cannot
value-import it (standalone contract): it takes the digest the pipeline already passes as
`env.proofDigest` (captured by `proof.fingerprint`).

**Reuse rule.** A stage needing a check reads the receipt: `status=PASS` **and** `inputDigest` equals
the current fingerprint → reuse (trace row `check.reused`). Otherwise run `full`. The invariant
"`review` is entered only after a green full gate" (task-pipeline vars comment) is preserved by
construction: only `full` writes the receipt consulted at `review`.

**Composition.** Implementation absorbs `plugins/sp/scripts/quality-gate.ts` (run/recheck, bounded
findings, SQLite-busy retry) rather than adding a parallel script; `<wbs>-test-gate.status` stays as a
derived coarse status for existing guards during migration. Skill `sp:spur-check` documents tiers
and when slash commands (`/sp:dev-fixall`) or skills are composed in. `bun run spur-check` remains
the `full` task-local chain; `spur-check-feature` stays the ADR-119 feature-scoped pass. A public
`spur check` verb is **out of scope** unless separately consented.

**Removal.** `verify`, `record` and `precheck` already never run the gate (audit 2026-09-23).
The real duplicates are (a) model-stage checklists that tell review agents to re-run `bun run test`
(`gate-checklists.md`, `secu-review.md`) — they read the receipt instead — and (b) a `test-recheck`
full gate after a fix pass that changed no tracked source (digest equals the last FAIL receipt),
recorded as `check.skipped-no-progress`. `quality-gate.ts` gains modes `light` and `status`.

## 5. Phase 1b — fleet executor surface (ADR-126)

A third executor surface for `agent.run` beside inline (ADR-087) and subprocess:

- **Selection:** `--agent fleet` on `/sp:dev-*` or workflow var `executor: fleet`; valid only when
  `agent.fleet.enabled` and ≥1 member resolves for the action's `role`. Otherwise fail explicitly
  (no silent downgrade) — or, with `executorFallback: traditional`, record the fallback reason and use
  the traditional surface.
- **Dispatch:** the action posts a work message via the G4 control plane (`spur message` /
  `spur agent`) to the member resolved by role (`strategy` rest|gtd from config), then waits with an
  identity-pinned wait on the durable artifact named by `expectFile` (ADR-057; no terminal scraping).
- **Parity:** the action row records `surface=fleet`, member id, message id, and the same
  `expectFile`, duration, and terminal reason as other surfaces, proven by a trace key-set test
  (`inline-pipeline-parity-check` compares action/guard kinds only and stays unchanged).
- **Launch:** `agent.run` only dispatches to running members; it never launches one (ADR-116).
- **Isolation:** reviewer/verify stages still require a fresh member session per ADR-121 policy.

## 6. Phase 1c — `decide` action (ADR-125)

A first-class, **non-pausing** workflow action for fuzzy classification:

```yaml
- kind: decide
  options:
    id: task-triage
    method: choice            # choice | noul in v1 (ask/score deferred)
    question: "Risk lane for task ${vars.wbs}?"
    choices: [low, standard, high]
    evidence: [.spur/run/${vars.wbs}-diffstat.json]
    default: standard         # used when no backend, error, or confidence < minConfidence
    minConfidence: 0.8
    resultFile: .spur/run/${vars.wbs}-triage.decision
```

- Wraps `ts-ai-runner` DecisionMaker (installed backends: typesafe / laya-local), reusing the ADR-123
  plumbing (`DecisionProvenance`, `redactAndBound`, lazy default maker). Opt-in via
  `workflow.decideDecisionMaker` (default false, sibling of `workflow.hitlDecisionMaker`); when off,
  every `decide` returns its declared default with `degraded: true`.
- Writes `{value, method, backend, confidence, degraded, reason, evidenceDigest, durationMs}` to
  `resultFile`; guards read the file like other status files (no re-evaluation in guards).
- Inline driver parity: `inline-run-setup --decide` runs the same app function; `decide` joins the
  parity check's documented action kinds.
- Distinct from ADR-123: that decorates *pausing* HITL actions; `decide` never pauses and never
  replaces an operator taste pause.

## 7. Phase 2 — measured refactors (promotion candidates)

Each item is a `config/workflow-candidates.json` record with pinned baseline and deadline.

| Candidate | Change | Expected measure |
| --- | --- | --- |
| task-pipeline triage lanes | new deterministic `triage` state (diffstat; sensitive paths force safety), then `decide task-triage`; `low` produces `mode=fast` for the **existing** fast-path edges | fewer `agent.run` per low-risk task |
| task-pipeline failure triage | `decide failure-class` (retryable / fix / stop) before retry; stop class exits `failed-check` | fewer `retry-exhausted` terminals |
| check dedup | review checklists read `check-receipt`; no-progress `test-recheck` skips the gate | wall time of test-recheck and review |
| wrapup doc-sync | deterministic drift probe produces `mode=fast` for the **existing** fast-path edge; skipping doc-sync also skips learnings capture (weighed in the verdict) | fewer doc-sync `agent.run` |
| history-anatomy | measurement only (a cache branch already exists); graph decision in Phase 3 | cache-hit rate, failure mix |
| idea-pipeline guards | legibility: named guard files, terminal reasons on every failure edge | terminal-reason coverage |

## 8. Phase 3 — catalogue reconciliation

Per workflow: keep / fix / retire with evidence from the baseline report. Initial suspects:
`pr-review`, `wayfinder-resolution`, `decision-routing-example`. Retirement deletes the YAML and
reroutes callers (ADR-076 "delete, don't layer"); §10 records the outcome.

## 9. Sequencing and blast radius

```text
[D63,E7,H53,H1] → P0 instrument → { P1a spur-check, P1b fleet, P1c decide } → P2 candidates → P3 retire
```

P1a/P1b/P1c are independent; P2 triage lanes need P1c; check dedup needs P1a. Blast radius is
`config/workflows/*`, `packages/app/src/workflow/*`, `plugins/sp/scripts/*`, `plugins/sp/skills/*`.
The only DB schema change is the terminal-reason column (migration 0049), landed with the
`ts-dual-workflow-engine` 0.5.6 release (facade `reason` + transition `terminalReason`) and its
catalog pin bump.

## 10. Catalogue reconciliation

Recorded by task 0946 (2026-09-25), applying the mechanical rule: `retire` requires zero real
(non-dry, non-bookkeeping) runs in the window **and** (no live caller **or** an example-only role);
fewer than 3 runs with live callers is `keep` plus a follow-up measurement note, never a retirement.
Evidence: `bun scripts/spur-dev.ts real-run-cost --by-state --include-bookkeeping --since 2026-06-01
--json` over the run-record plane (`.spur/spur.db`, 2026-09-25; raw payload
`.spur/run/0946-real-run-cost.json`), plus a non-test caller grep under `plugins/`, `apps/cli/src`,
`packages/app/src`, `scripts/`. Caller counts name non-test reference sites (code caller / command or
skill instruction surface / config entry). Wall figures are seconds. Bookkeeping workflows
(`task-lifecycle`, `feature-lifecycle`, 0937 `BOOKKEEPING_WORKFLOWS`) are judged on correctness only;
their run rows are lifecycle transitions, not metric rollups.

| Workflow | Decision | Evidence (window 2026-06-01 → 2026-09-25) | Live callers | Reason |
| --- | --- | --- | --- | --- |
| `task-pipeline` | **keep** | runs=9 (9 terminal, 0 dry) · agent.run median 0 · wall p50 4789s / p90 7983s · mix `done`×9 | ~30 (driver, services, workflow actions, `/sp:dev-run*`, agents) | The daily development spine; the only catalogue member with real traffic. 0940/0943 candidates own its measured refactors. |
| `task-lifecycle` | **keep** | bookkeeping: 9 runs, all non-terminal transitions · wall n/a · mix {} (0937 separates bookkeeping rows) | 5 (`task.ts`, `pipeline-run-link.ts`, `planning-write-service.ts`, `lifecycle-adapter.ts`, `terminal-reason.ts`) | Correctness-judged (cost-exempt): externally driven TaskStatus FSM; zero terminal rows and zero `action_runs` are its correct shape. |
| `feature-lifecycle` | **keep** | bookkeeping: 0 recorded runs in window (run-record plane) · wall n/a · mix {} | 4 (`lifecycle-adapter.ts`, `terminal-reason.ts`, README, cross-cutting ref) | Correctness-judged (cost-exempt): FeatureStatus FSM driven by `requestTransition`; its `verifying` entry owns the 0880 `feature-verification` wiring. |
| `feature-verification` | **keep** + measurement note | runs=0 · median/p50/p90 n/a · mix {} | 4 (`feature-check.ts`, CLI wiring, receipt module, `feature-verification-steps.ts`) | Live caller is fail-closed (`feature-check.ts` refuses completion without its recorded PASS, 0880); zero recorded runs means the feature boundary has not closed since the run-record plane landed — measure at the next feature close, never retire on this window. |
| `idea-pipeline` | **keep** | runs=0 in window · median/p50/p90 n/a · mix {} | ~15 (`task-service.ts`, idea-handoff modules, `/sp:dev-idea`/`/sp:dev-plan`, coverage/parity scripts, skill refs) | Planning entry surface with dense callers; its guard-legibility fix already shipped (0945 candidate, frozen truth-table parity). Zero recorded runs is a plane-gap, not absence of use. |
| `wrapup-pipeline` | **keep** + measurement note | runs=0 in window · median/p50/p90 n/a · mix {} | 8 (`/sp:dev-wrap`, `/sp:dev-wrapall`, `/sp:dev-runall`, `wrapup-steps.ts`, drift probe, README, 2 skill refs) | Every task close routes here via `/sp:dev-wrap*`; the 0944 drift-probe candidate projects its doc-sync saving. Measurement note: record ≥3 real runs (post-promotion) before any shape change. |
| `history-anatomy` | **keep** + measurement note | 0938/0944: 0 attributable runs in the run-record window; per-state rows absent, cache disposition not in `real-run-cost` (0944 receipt, finding F3) · median/p50/p90 n/a · mix {} | ~10 (history-anatomy skill + 3 refs, dogfood/session-review/spur-doctor/spur-composer skills, cache script, packaging) | Graph decision owned here per 0944 R5: on zero measured runs no graph change is justified — the ADR-079 cache branch stays, no enrichment rework. Measurement note: pre-0925 phase-plane history (7 `done`, last 2026-09-13, composition contract) predates the run-record plane; measure cache hit/miss from new runs. |
| `pr-review` | **keep** + measurement note | runs=0 in window · median/p50/p90 n/a · mix {} (0866 already found zero real completions) | 6 (`/sp:dev-pr-review` spine SSOT, `slash-commands-service.ts`, `pr-reviewing.ts` + skill, roles ref, budget entry) | 0866 retained it because `dev-pr-review` declares it the spine SSOT — the caller half of the retirement test still fails. Measurement note: <3 runs with live callers ⇒ never retire (R4); record usage before any shape decision. |
| `wayfinder-resolution` | **keep** + measurement note | runs=0 in run-record window · median/p50/p90 n/a · mix {} (0866 phase-plane: 1 non-dry `done`, 2026-07-19, 225s, across 6 runs) | 3 (wayfinder skill reference, README catalogue row, budget entry) | 1 real completion (<3) plus a live instruction surface (wayfinder skill) ⇒ keep by the mechanical rule. Measurement note: free-form `spur workflow run` usage is under-observed in the run-record plane; re-measure before any decision. |
| `decision-routing-example` | **retire** | runs=0 in window (0 real, ever, in the run-record plane) · median/p50/p90 n/a · mix {} | 1 catalogue-row doc (README) + budget coverage entry + design/help docs; example-only role | Example-only authoring sample (0911/0921 disposition): no command, skill, agent or service invokes it; the R4 retire rule is met (zero runs AND example-only). YAML deleted, catalogue row and budget entry removed, budget/docs mentions rerouted; the 0911 decision-policy regression coverage moved with the YAML into the workflow-service test fixtures (`packages/app/tests/services/fixtures/decision-routing-example.yaml`). Recorded in `retirements[]` (`0946 (D64)`). |

Post-reconciliation catalogue: 9 definitions. No `fix` decisions — every defect-bearing candidate
surface already carries its measured fix as a D64 promotion candidate (0940/0943/0944/0945), and the
remaining zero-run workflows show no defect evidence, only measurement gaps. `promotion check`
confirms no parallel definition and no unrecorded retirement after the delete.
