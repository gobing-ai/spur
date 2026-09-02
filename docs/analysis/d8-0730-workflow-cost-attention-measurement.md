# D8 Workflow Cost, Human Attention, and Bypass Pressure — Measurement Baseline

- **Task**: 0730 (`measure-workflow-cost-human-attention-and-bypass-pressure`), feature D8.
- **Provenance**: measured on commit `86fd36978` (worktree `spur-new-runall-d8-6869`), 2026-09-02, source-local CLI only (`bun run apps/cli/src/index.ts`, `bun run scripts/spur-dev.ts`). Evidence planes: `.spur/spur.db` (runs / transition_runs / task_run_links / history_*), `.spur/run/*` logs, escalation packets, verdict artifacts, `config/workflows/`. No global `spur` binary.
- **Method**: freeze the cohort → validate the three measurement helpers with live output before using any number → repair only provable correctness defects in `real-run-cost.ts` (focused tests) → aggregate with every null and denominator reported → declare the sufficiency rule and apply it honestly.

---

## A. Cohort freeze (R1) — 11 repository workflows

Independently enumerated from `ls config/workflows/` (11 definitions) and `bun run apps/cli/src/index.ts workflow list` (11 resolved). Per-workflow provenance:

| # | Workflow | Repo definition (project-local) | Resolved by CLI `workflow list` | Run-recorded `definitionDigest` | Dry / real runs observed |
| --- | ---------- | -------------------------------- | -------------------------------- | --------------------------------- | -------------------------- |
| 1 | basic | `config/workflows/basic.yaml` | `[project layer]` via `/Users/robin/node_modules/@gobing-ai/spur/config/workflows` (installed copy **byte-identical**, `diff -q` verified) | `sha256:9d7723a9…` | 6 dry / 0 real |
| 2 | docs-pipeline | `config/workflows/docs-pipeline.yaml` | same installed surface | `sha256:ee5c8858…` | 6 dry / 0 real |
| 3 | feature-dev | `config/workflows/feature-dev.yaml` | same | `sha256:6d4b7535…` | 6 dry / 0 real |
| 4 | feature-lifecycle | `config/workflows/feature-lifecycle.yaml` | same | `sha256:9f119639…` | 6 dry / 1 non-terminal |
| 5 | history-anatomy | `config/workflows/history-anatomy.yaml` | same | `sha256:a898d445…` | 6 dry / 0 real |
| 6 | idea-pipeline | `config/workflows/idea-pipeline.yaml` | same | `sha256:d33fb1a6…` | 6 dry / 0 real |
| 7 | pr-review | `config/workflows/pr-review.yaml` | same | `sha256:eb3f5187…` | 6 dry / 0 real |
| 8 | task-lifecycle | `config/workflows/task-lifecycle.yaml` | same | `sha256:fb5b8639…` | 6 dry / 1 non-terminal |
| 9 | task-pipeline | `config/workflows/task-pipeline.yaml` | same | `sha256:b3b82966…` | 6 dry (incl. probe `a84c72a3`) / 0 real |
| 10 | wayfinder-resolution | `config/workflows/wayfinder-resolution.yaml` | same | `sha256:1b1ba738…` | 5 dry / 0 real |
| 11 | wrapup-pipeline | `config/workflows/wrapup-pipeline.yaml` | same | `sha256:3d8e8964…` | 6 dry / 0 real |

Provenance facts every row inherits:

- **Bundled vs installed vs project-local**: the repo worktree carries the only authored definitions (`config/workflows/`, 11 files). The CLI's project layer resolves to the **installed** package copy in `/Users/robin/node_modules/@gobing-ai/spur/config/workflows`; sampled copies are byte-identical to the repo files (`diff -q SAME` for task-pipeline and basic). No separately bundled third surface participates.
- **Definition-digest state**: the inert `digest` fields in `config/workflow-composition-baseline.json` (e.g. task-pipeline `sha256:455fcf48…`) are **stale** — no run matches them; the live identity is the per-run `metadata_json.definitionDigest` values in the table (task-pipeline `b3b82966…`). Baseline digests are dead weight (0729 §C) and must not be used as cohort identity.
- **Run IDs**: all 67 `runs` rows are reproducible by `SELECT id, workflow_name, status, started_at FROM runs` in `.spur/spur.db`; the two inline-driver runs (`d8-0729-6nqppc`, `d8-0730-kfsou1`) are **not** engine runs — they have no `runs` row and live only as `.spur/run/d8-*.log` (engine/inline cohort separation below).
- **Cohorts**: *engine* = the 67 state-machine runs (all dry-run probes or abandoned lifecycle rows, `mode=state-machine`); *inline-host* = the two runall driver runs (0729 complete, 0730 in flight); *inline-native-subagent* = the agent dispatches inside those driver runs (host sessions, no DB row); *direct-chat-unknown* = any work with no explicit workflow record (see §F).
- **Premium classification**: **not made.** No recorded `tier` column exists anywhere; `runs.agent` is empty on all 67 rows; history `model` is populated on only 274,092 of 1,757,807 rows (15.6%) with no tier mapping. Per R1 (never price inference), premium use is reported as **unknown**, not classified.

## B. Measurement-helper validation and repairs (R2)

**`real-run-cost` — 6 blockers reproduced live, fixed in `scripts/commands/real-run-cost.ts`, each with a focused test (`scripts/commands/real-run-cost.test.ts`, 10 passing):**

| Blocker | Live evidence before fix | Repair | Test |
| --- | --- | --- | --- |
| Dry-run inclusion | `real-run-cost --json` reported wall stats over **65 dry-run probes** (`basic: median 0ms`) — `metadata_json.dryRun:true` ignored | Exclude `json_extract(metadata_json,'$.dryRun')=1` rows from stats; count them as `dryRuns` (exclusion visible, never silent) | `dry-run and non-terminal rows never enter real-work stats` |
| Partial workflow scope | `inScopeWorkflows` returned **8 baseline keys**; feature-lifecycle, history-anatomy, task-lifecycle (3 of 11) invisible | Union of baseline keys ∪ `config/workflows/*.yaml`; sorted, deduped | `unions baseline keys with config/workflows definitions` |
| Blanket long-run exclusion | 24h ceiling silently dropped >24h walls while `runs` still counted them (denominator lie; a legit paused-then-done run vanishes) | Ceiling removed; terminal-status filter (`done/failed/cancelled`) is the abandonment guard; outliers stay visible in `max` | `no blanket long-run ceiling` |
| Token rows with null USD | `tokens` was gated on `tokenCostUsd !== null` — a mapped run whose messages carry tokens but null USD lost **both** values | Cost and tokens fold **independently**; row coverage (`historyRows`, `usdRows`) reported | `tokens fold independently of USD` |
| Active vs paused duration | wall-clock = `completed − started` counts paused/idle time as execution | Added `activeMs` (first→last `transition_runs` hop, ≥2 hops) as a **lower-bound** activity stat beside wall; null with `activeRuns` when hop evidence is absent. Transitions do not record pause intervals — a pause inside the first→last span is **not separable**; reported as a gap (§G), not hidden | `active time bounds from ≥2 transition hops` |
| Unknown-as-zero | Text output printed `(tokens ?? 0)` → unmeasured printed as `0 tokens` | `n/a` for unmeasured tokens; per-workflow `mappedRuns`/`historyRows`/`usdRows` expose exactly how many rows folded in as zero | covered by fold tests + live JSON |

**`pipeline-budgets` — validated, NOT repaired beyond its cascade:** the gate is live and **RED**: `bun run scripts/spur-dev.ts check-pipeline-budgets` → exit 1, `BUDGET EXCEEDED: pipeline=docs-pipeline modelQueries: budget=1 measured=2` (reproduced 2026-09-02 pre- and post-fix). `measured=2` is the **static** baseline list `['draft','verify']` — the 0704 docs-pipeline restructure added the verify query after the 0607 budget was written; the budget contradicts its own declared SSOT. Its `measuredFromWorkflows` also maps an unknown workflow to `modelQueries: 0` (unknown-as-zero) — recorded as a finding; no budget currently hits that path (all 5 budgeted pipelines are in the baseline).

**Decision (0729 inventory Decision 11, owned here): the docs-pipeline failure is a FIX, not a raise.** The budget number is stale bookkeeping against the SSOT: set `docs-pipeline.modelQueries: 2` with a recorded decision `{date: "2026-09-02", wbs: "0730", note: "align to baseline SSOT ['draft','verify'] added by task 0704; not a measured-cost raise — no real docs-pipeline run exists yet"}`. This edit is **deferred**: `config/pipeline-budgets.json` is outside this run's declared diff scope; the one-line change + decision record above is ready to apply verbatim. Until applied the gate stays RED, which is the correct honest state.

**Verified-outcome correlation — validated, blockers confirmed, numbers NOT used.** Two structural defects make every verified-PASS attribution unreliable today; per R2 these are recorded, not repaired here (fix surface owned by the engine layer, consumers 0731/0732):

1. **`.proof.digest` shape mismatch**: the task-pipeline verify hop stamps `proof: {digest, capturePoint, stages}` into the verdict (`config/workflows/task-pipeline.yaml:601`), but the fold reads a **flat top-level** `verdict.proofDigest` (`packages/app/src/services/verified-outcome.ts:198-201`). A pipeline-shaped verdict always yields `proofDigestPresent=false` → excluded from verified results. The live PASS artifact is worse: `.spur/run/0729-verdict.json` carries **neither** `proof` nor `proofDigest` (keys: `wbs, verdict, requirements, acceptanceCriteria, checks, source`) — the inline-driver path produced a PASS verdict with **no proof block at all**, despite the run log asserting "proof bracket: digest 02b41537 … re-verified unchanged at verdict entry". The digest exists only in prose logs, not in the machine-checkable artifact.
2. **Exact certifying-run/verdict binding absent**: the fold accepts **any** linked run with status `done|completed` as `certifyingRunCompleted` and reads the **WBS-scoped** artifact `.spur/run/<wbs>-verdict.json` — no run id inside the verdict, no digest re-check at read time, no freshness bound. `task_run_links` live rows prove the hazard: `0729 → a84c72a3…` (a **dry-run probe**, failed), `0729 → d8-0729-6nqppc` (a driver label with **no runs row**), `0539 → 5 dry-run sweep runs`. Per R3, verified-PASS attribution is therefore **excluded from this study** unless exact binding is proven; none is.

## C. Evidence joins (R3) — what can and cannot be joined today

| Join | Rows | Usable? |
| --- | --- | --- |
| `runs` ⨝ `metadata_json.definitionDigest` → definition identity | 67/67 | yes (cohort identity, §A) |
| `runs` ⨝ `transition_runs` (stage timeline) | 67 runs with hops (847 hops total; 33 runs have ≥2 hops) | partial — no real-run hop data |
| `runs` ⨝ `history_run_session` ⨝ `history_message` (cost) | **0** mapped sessions | **no** — cost attribution impossible |
| `history_message` standalone (1,757,807 rows, 8 sources: grok 580k, codex 324k, omp 305k, pi 267k, agy 150k, claude 118k, opencode 11.6k, gemini 1.8k) | 0 rows carry `run_id` or `task_wbs` | **no** run attribution; usable only as plane-existence evidence |
| `task_run_links` ⨝ `runs` | 9 links; ≥6 point at dry probes or driver labels absent from `runs` | degraded — binding not exact |
| verdict artifact ⨝ run | no run id in artifact; no proof digest in live artifact | **no** (see §B) |
| whole-worktree Solution attribution (`task-record.ts:609` `gitDiffU0`) | — | excluded per R3 (multi-task tree); 0729's Solution was backfilled this way and is **not** counted as measured work here |

## D. Cost / duration / outcome attribution (R4) — honest table

Per-workflow numbers come from the repaired `real-run-cost --json` (every value below reproduced live 2026-09-02; `n/a` = null with coverage shown):

| Workflow | Real terminal runs (n) | Wall p50/max | Active bound | USD | Tokens | Row coverage (USD rows/history rows) |
|---|---|---|---|---|---|---|
| basic … wrapup-pipeline (all 11) | **0** | n/a | n/a | n/a | n/a | 0/0 |

- **Denominator**: 67 runs with bounds = 65 dry + 2 non-terminal ('running' with stale `completed_at`, e.g. `run_ea369461` 16:04:54→16:05:07 — the abandoned 0729 lifecycle row). **Zero real terminal workflow runs exist in this worktree's evidence window.**
- **Cost**: `history_run_session` is empty → 0 exact run→session mappings → per-run and per-workflow USD is null for every workflow, with coverage 0/0 reported rather than 0. The 1.76M-row history plane has USD on 318,041 rows (18.1%) and tokens on 310,849 (17.7%) — measured spend exists but is **run-unattributable**; the importer has never been given run-scoped sessions in this worktree.
- **Outcome**: 59 dry probes failed (guard shells fail fast under `--dry-run`, consistent with 0729 defect 14), 6 dry probes reached `done` (wrapup-pipeline et al.), 2 rows non-terminal. **No measured failure rate of real work is derivable.**
- **Model/executor/tier**: `runs.agent` empty on 67/67; history `model` present on 15.6% of unmapped rows (top: deepseek-v4-pro 54.7k, glm-5.2 34.5k, claude-opus-5 28.2k…). Tier: unknown everywhere. Reported separately from the **static** query counts (§H).

## E. Mechanism effectiveness (R5) — configured vs measured

| Mechanism | Configured (static) | Measured (live evidence) |
| --- | --- | --- |
| Configured defaults applied | `agent.default` documented as app-config-driven (`workflow-service.ts:433,668`) | **Not applied on CLI** — `spurConfig` never threaded through `makeSvc` (0729 S1-3); no run shows a resolved default agent (`runs.agent` empty 67/67) |
| Timeouts enforced | feature-dev `command.gate` `timeoutMs: 1800000` | **Dead** — forwarded under wrong key (0729 S1-1); no timeout event recorded in any of the 847 transition hops |
| Task proof present | verify→record guard requires `.proof.digest` (task-pipeline.yaml:778+) | **Live PASS artifact carries no proof block** (§B-1); digest exists only in run-log prose |
| Verifier output fresh | `.spur/run/<wbs>-verify-answer.txt` asserted post-exit | Files exist and are same-day (0729 run); the stale-expectFile hole (0729 S2-8: nothing deletes a prior run's file) is structurally open — freshness is unprovable from artifacts alone |
| Resume output observable | checkpoint written at done (0711); `continuePaused` never reads it (0729 §A-099) | No paused runs in window → **n/a** (no evidence either way) |
| Cost caps declared/used | `maxTokens`/`maxCostUsd` parse + fail closed (0707, agent-run.ts:100,323) | **0 of 11 shipped workflows declare either cap** — adoption is zero; no tripwire fired (no budget-verifiable dispatch exists) |
| Final proof bound | verify→record→done guards re-assert digest (0703) | Guards exist in the task-pipeline definition; the inline driver path bypassed them — the one real PASS (0729) is unbound (§B) |

## F. Human attention and bypass pressure (R6) — observation / inference / confidence / alternative

**Observations (reproducible):**

- 59 escalation packets (`*.spur/run/*-escalation.json`, all `trigger: terminal-failure`, `decision.kind: inspect_failure`) were emitted for the 65-run dry sweep waves — the escalation mechanism (ADR-098) fired and rendered, but every packet asked a human to inspect a deterministic dry-run guard failure.
- Reruns: five full-cohort dry sweeps at 14:48, 15:11, 15:34, 15:39 and 15:49 (11 workflows each) plus the 15:22 probe — all deterministic audit actions, zero human recovery between them. Idle paused time: **zero** (no run ever entered `paused`) — no paused minutes are counted as labor anywhere in this study.
- Explicit approvals: 1 recorded HITL auto-approval in the 0729 driver log (`stage approve: SKIPPED (profile=auto, HITL gate auto-approved)`). Corrections: 1 `test-fix` hop inside the dry probe `a84c72a3`. Active recovery: 0729's run log records 1 review repair cycle + 1 verify repair cycle (driver-run, inline cohort).
- Bypass signal: the D8 wave's real work (0729 done, 0730 in flight) ran entirely in the **inline-driver + host-session cohort**; the task-pipeline engine recorded **zero real runs** in the window. Direct-chat work has no workflow record at all — unknowable from any plane read here.

**Inference (conservative, per R6):** the dominant real-work execution cohort is currently the inline driver, and the engine pipeline is exercised only by dry probes. Stated confidence: **high** that engine-run coverage of real work is zero in this window; **low** on any intent claim.

**Alternative explanations (required):** (a) the engine path may be reserved for non-D8 waves by design (the runall mode choice is driver-owned, not operator evasion); (b) the dry sweeps are audit artifacts of 0729 itself, not operational traffic; (c) direct-chat volume is invisible to every plane read here — absence of workflow records is **not** evidence of bypass, only absence of records.

## G. Sufficiency rule (R7) — predeclared before aggregation

| Budget type | Minimum evidence declared | Status |
| --- | --- | --- |
| p50/p95 wall per workflow | ≥ 20 real terminal runs per workflow in window | **NOT MET — 0 real terminal runs** (collection gap: every recorded run is a dry probe or abandoned row; no real pipeline execution was recorded) |
| Weak median (p50 only) | ≥ 5 real terminal runs | NOT MET (0) |
| USD per verified PASS | ≥ 5 verified results with exact run→session cost mapping at ≥ 80% row coverage | NOT MET (0 exact mappings; verified-outcome binding defective, §B) |
| Attention per verified PASS | ≥ 5 results with recorded approvals/recovery inside run evidence | NOT MET (1 result, inline cohort, partially recorded) |

**No budget is established.** The exact collection gap: (1) no real non-dry engine runs recorded; (2) the history importer has never emitted run-scoped sessions (`history_run_session` empty, 0/1,757,807 messages carry `run_id`), so even a real run would measure cost as null today; (3) verdict artifacts lack proof/run binding, so per-verified-PASS denominators cannot be formed. These three, in that order, are the collection work 0731/0733 must fund before any ceiling number is written.

## H. Ranked findings and budget classes (R8)

**Immutable safety floors** (not cost targets): proof-bracket guards (verify→record→done digest assertions), budget-unverifiable fail-closed dispatch (0707), reviewer independence (0710), run-id confinement. None may be traded for cost.

**Measured optimization targets** (ranked, all evidence-backed):

1. **Run-scoped cost attribution is absent end-to-end** — 1.76M history rows, 0% run-attributable (§C/§D). Highest-leverage fix: make the importer stamp `run_id`/exact mappings. Without it, every cost question stays n/a.
2. **Verified-PASS binding is decorative** (§B) — fix `.proof.digest` shape (flat vs nested) + write `runId` into the verdict + re-check digest at read time.
3. **Dry probes masquerade as traffic** — 97% of recorded runs are dry; the repaired `real-run-cost` now separates them, but any consumer of the OLD output (including the 0607-era budgets) was reading probe noise.
4. **Zero adoption of declared cost caps** (§E) — the mechanism is built and unexercised; wiring `maxTokens` onto the 4-query task-pipeline agents is the cheapest measured-safety lever once real runs exist.

**Static graph counts** (reported separately from measured work, per AC): baseline `modelQueries` lists — task-pipeline 4, idea-pipeline 5, docs-pipeline 2, feature-dev 4, wayfinder-resolution 2, wrapup-pipeline 1, basic 1, pr-review 0; feature-lifecycle / history-anatomy / task-lifecycle **absent from the baseline** (the regen + baseline migration of 0729 Decision 8 covers them). Declared `maxTokens`/`maxCostUsd`: 0 workflows.

**Speculative opportunities** (named, not funded): collapsing task-pipeline's 4 static query slots; docs-pipeline draft+verify merge. No measurement exists to rank these — first real runs first.

## Unknowns (honest gaps)

- Executor/model/tier per run: unknown (no recorded tier anywhere; `runs.agent` empty).
- Direct-chat bypass volume: unmeasurable from existing planes (no record exists); intent never inferred (§F).
- Whether a pause, once it happens, would be separable in wall-clock: **no** — `transition_runs` records state entries, not pause intervals; `activeMs` is a lower bound only.
- Whether superskill stages `pr-reviewing.ts` (0729 §G-4 unknown) — unchanged, not re-tested here.
- The `0539` task referenced in `task_run_links` — its verdict/proof state was not audited in this pass; its links to dry sweeps are recorded as binding hazards regardless of 0539's own state.
