# D8 Workflow Fit Classification — Deployment Roles, Dispositions, and Surrounding Pilot Selection

- **Task**: 0731 (`classify-shipped-workflows-by-fit-and-select-surrounding-pil`), feature D8.
- **Provenance**: classification run on commit `86fd36978` (worktree `spur-new-runall-d8-6869`), 2026-09-02, source-local CLI only (`bun run apps/cli/src/index.ts`, `bun run scripts/spur-dev.ts`). Authority consumed: `docs/inventory/d8-0729-workflow-contract-inventory.md` (ADR/gate/baseline audit) and `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` (cohort freeze + measurement). Evidence planes: `config/workflows/*.yaml`, `.spur/spur.db` (`runs`, `transition_runs`, `task_run_links`, `queue_jobs`), `.spur/run/*.log`, CLI `workflow list|validate|show|trace|run --dry-run`, `apps/cli/schemas/`, `packages/app/src/workflow/composition-baseline.ts`, plugin command/skill docs (caller evidence). Probe fixtures under `/tmp` removed; DB mutation from the one live dry-run probe was deleted (runs/transition rows reverted; 68-row cohort restored).
- **Method**: freeze the 11 definitions + shadowing surfaces (R1) → per-workflow validation + graph read (R3) → caller/deployment-role trace across code, commands, skills, git history, and `task_run_links` (R2) → fit-gate disposition (R4) → prerequisite table against 0729 §F defect register (R5) → pilot ranking among real-caller surrounding workflows (R6) → version classification + both-forms exercise (R7) → compact matrix + recommendation (R8/R9). Unknowns stay unknown; no production definition or public CLI surface changed.

---

## 1. R1 — Definition freeze (11 repository workflows + shadowing check)

**Source-local binary/importer**: the CLI binary is `bun run apps/cli/src/index.ts` (source-local); it imports workflow definitions through the installed package's loader (project layer) plus the repo-authored `config/workflows/`. There is **no separate bundled surface**: `apps/cli/config/workflows/` does not exist, and `.spur/workflows/` does not exist. The CLI's single resolved layer is `project` → `/Users/robin/node_modules/@gobing-ai/spur/config/workflows` (installed copy). All 11 installed copies are **byte-identical** to the repo `config/workflows/` files (`diff -q SAME` re-verified for all 11 this pass), so authored surface = repo, resolved surface = installed copy (same content). No shadowing definition participates.

| # | Workflow | Repo def | Resolved path/layer | Run-recorded `definitionDigest` (live, 0730-verified) | Version | Validate | Composition advisories |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | basic | `config/workflows/basic.yaml` | `project` → installed `.../config/workflows/basic.yaml` (byte-identical) | `sha256:9d7723a9…` | **unversioned** | valid | 1 |
| 2 | docs-pipeline | `config/workflows/docs-pipeline.yaml` | same | `sha256:ee5c8858…` | **unversioned** | valid | 1 |
| 3 | feature-dev | `config/workflows/feature-dev.yaml` | same | `sha256:6d4b7535…` | **unversioned** | valid | 1 |
| 4 | feature-lifecycle | `config/workflows/feature-lifecycle.yaml` | same | `sha256:9f119639…` | **unversioned** | valid | 0 |
| 5 | history-anatomy | `config/workflows/history-anatomy.yaml` | same | `sha256:a898d445…` | **unversioned** | valid | 4 |
| 6 | idea-pipeline | `config/workflows/idea-pipeline.yaml` | same | `sha256:d33fb1a6…` | **unversioned** | valid | 9 |
| 7 | pr-review | `config/workflows/pr-review.yaml` | same | `sha256:eb3f5187…` | **unversioned** | valid | 5 |
| 8 | task-lifecycle | `config/workflows/task-lifecycle.yaml` | same | `sha256:fb5b8639…` | **unversioned** | valid | 0 |
| 9 | task-pipeline | `config/workflows/task-pipeline.yaml` | same | `sha256:b3b82966…` | **unversioned** | valid | 14 |
| 10 | wayfinder-resolution | `config/workflows/wayfinder-resolution.yaml` | same | `sha256:1b1ba738…` | **unversioned** | valid | 3 |
| 11 | wrapup-pipeline | `config/workflows/wrapup-pipeline.yaml` | same | `sha256:3d8e8964…` | **unversioned** | valid | 4 |

- **Baseline membership ≠ validity**: all 11 pass `workflow validate` (exit 0) regardless of baseline membership. The composition baseline `config/workflow-composition-baseline.json` holds only **8** workflows (missing feature-lifecycle, history-anatomy, task-lifecycle — matches 0730 §H); its per-workflow `digest` fields are all **stale** (e.g. task-pipeline baseline `sha256:455fcf48…` vs live `b3b82966…`, confirmed by 0730 §A and this pass) — consistent with 0729 §C "inert digest fields". `list.valid: yes` is schema-level; it does not prove run-readiness (0729 §F-14).
- **Version state**: all 11 omit `version` → all classified **unversioned** (R7 contract). The schema (`apps/cli/schemas/state-machine-workflow.schema.json`) `required: ['name','initialState','states','transitions']`; `version: {type:string}` optional, no minLength; `kind` is `const: state-machine` (optional-but-constrained). Live probes: explicit `version: "1.2.3"` and empty `version: ""` both validate (exit 0). **Zero consumers** of the workflow `version` field (steering.ts / tripwire.ts `version` are unrelated state/policy counters); version is only folded into `computeDefinitionDigest` (`composition-baseline.ts:110-116`, whole-def canonical JSON) — an empirically verified version-only edit changes the digest (`sha256:3d05d63d…` → `sha256:fc4bd91f…`).
- **Dry/real-run cohort** (0730 §D, re-confirmed): 68 `runs` rows = 65 dry probes + 3 non-terminal lifecycle bookkeeping rows (`run_618bd87b` feature-lifecycle, `run_ea369461` + `run_cdae9c31` task-lifecycle; all `metadata_json = {}`, no digest). **Zero real terminal engine runs** for any of the 11 (re-verified this pass: query for `status IN (done,failed,cancelled) AND dryRun IS NULL/0` returns empty). `real-run-cost` reports `wall=n/a cost=n/a [excluded N dry, M non-terminal]` for all 11.

---

## 2. R2 — Caller / deployment-role matrix

Deployment roles: **canonical engine pipeline** (phase-owner), **lifecycle** (entity status FSM), **orchestrator** (delegating pipeline), **example/fixture**, **unused**, **reference-SSOT**. Evidence: code wiring (`task.ts`, `feature.ts`, `make-lifecycle-adapter.ts`, `lifecycle-adapter.ts`), plugin command/skill docs, `task_run_links` rows, git history, `queue_jobs`.

| Workflow | Deployment role | Proven real caller | Evidence |
| --- | --- | --- | --- |
| task-lifecycle | **lifecycle** (entity status FSM) | **YES** — `spur task update/record` → `makeLifecycleAdapter(TASK_LIFECYCLE_PROFILE)` → engine `requestTransition` | `apps/cli/src/commands/task.ts:439,1528`; `packages/app/src/workflow/lifecycle-adapter.ts:47`; `apps/cli/src/workflow/make-lifecycle-adapter.ts` |
| feature-lifecycle | **lifecycle** (entity status FSM) | **YES** — `spur feature update/sync` → `makeLifecycleAdapter(FEATURE_LIFECYCLE_PROFILE)` → engine `requestTransition` | `apps/cli/src/commands/feature.ts:556`; `lifecycle-adapter.ts:55` |
| wrapup-pipeline | **orchestrator** (post-execution wrap-up) | **YES** — `/sp:dev-wrap`, `/sp:dev-wrapall` → `spur workflow run wrapup-pipeline.yaml` ("only implementation") | `plugins/sp/commands/dev-wrap.md:31,45`; `dev-wrapall.md:33,47` |
| idea-pipeline | **orchestrator** (ideation→planning→handoff) | **YES** — `/sp:dev-idea`, `/sp:dev-plan`; `--auto`/name → `spur workflow run idea-pipeline.yaml --async`; omitted/inline → inline driver | `dev-idea.md:45-46`; `dev-plan.md:46-47` |
| task-pipeline | **canonical engine pipeline** (single-task execution) | **YES** — `/sp:dev-run`, `/sp:dev-runall`; headless `spur workflow run task-pipeline.yaml` or inline driver | `dev-run.md:66-67`; `dev-runall.md:52,69`; `spur-dev/SKILL.md:87-88`; **excluded from pilot per R6** |
| docs-pipeline | canonical engine pipeline (docs-sibling) | **NO proven `workflow run` caller** — README declares `/sp:dev-run --mode implement`, but that mode is the single implement competency, not `docs-pipeline`; no `workflow run docs-pipeline` in any code/command | `plugins/sp/README.md:604` (declared); `dev-run.md` (no docs-pipeline ref) |
| history-anatomy | engine-driven diagnostic pipeline | **NO proven `workflow run` caller in this worktree** — dev-find-issue says "engine-driven (headless)", no inline driver; the `sp:history-anatomy` skill "never launches a workflow" (`SKILL.md:31,44-45,59,67`); README:336 is adoption-evidence aspiration | `dev-find-issue.md:31`; `skills/history-anatomy/SKILL.md:31,44-45` |
| feature-dev | umbrella orchestrator | **Intended** (`/sp:dev-runall --feature`) but **structurally blocked** by nested-review defect (0729 §F-2) | `cross-cutting.md:539` (entry command); `feature-dev.yaml:156-169` nested pr-review |
| pr-review | **reference-SSOT / fixture** (skill spine) | **NO `workflow run` caller** — `dev-pr-review` delegates to `sp:pr-reviewing` + staged `pr-reviewing.ts`; YAML is SSOT for state order/guards; feature-dev's nested call is blocked | `dev-pr-review.md:33-35`; `skills/pr-reviewing/SKILL.md:42,282` |
| basic | **example/fixture** (generic loop) | **NO caller** — declared "direct `spur workflow run`", no slash command/code invokes it | `README.md:603`; `cross-cutting.md:541` |
| wayfinder-resolution | **unused** (declared free-form) | **NO caller** — declared "spur workflow run (free-form)"; no slash command/code; `sp:wayfinder` skill only does "charting" | `README.md:611`; `dev-brainstorm.md:36` (chart only) |

**`task_run_links` live rows (10)**: 0539 → 5 task-pipeline **dry** probes (`5460643c`, `e62a290e`, `7d855950`, `86e84e88`, `b35417b5`; all `failed`, dry=1) — binding-hazard evidence, **not** real-caller proof for task-pipeline; 0729 → `d8-0729-6nqppc` (driver label, no runs row), `a84c72a3` (dry probe), `run_ea369461` (task-lifecycle lifecycle row); D8 → `run_618bd87b` (feature-lifecycle lifecycle row); 0730 → `run_cdae9c31` (task-lifecycle lifecycle row). All lifecycle-link rows are `running`/non-terminal bookkeeping from the runall driver (backlog→active / wip→testing reseeds), **not** engine pipeline executions.

**`queue_jobs`**: only scheduler infra jobs (`system-events-prune`, `smoke`, `history.refresh`) — no workflow-triggered jobs. Scheduler is not a workflow caller in this worktree.

---

## 3. R3 — Graph facts matrix

Unknowns stay unknown (marked `?`); values from direct YAML read + `workflow validate` + live trace probes.

| Workflow | States | Agent.run hops | Shell/other actions | Branches/loops | Pauses | Failure terminals | Artifacts | Composition | Dry-run behavior | Real-run frequency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| task-lifecycle | 7 (backlog→todo→wip→testing→blocked→done→cancelled) | 0 | 2 shell guards | blocked↔(todo/wip/testing) loops; done→wip reopen; cancel edges | 0 | cancelled (sole terminal; done re-enterable) | — (pure status FSM) | none (entity FSM; guards `spur task check --as <target>`) | runs real guards (dry probe cycled todo↔blocked, failed on dummy task) | lifecycle rows only (3 non-terminal); 0 terminal |
| feature-lifecycle | 6 (backlog→active→verifying→blocked→done→cancelled) | 0 | 2 shell guards | verifying→active rework; done→active reopen; blocked↔active; cancel edges | 0 | cancelled | — | none | ? (not probed this pass) | lifecycle rows only (1 non-terminal); 0 terminal |
| wrapup-pipeline | 8 (start→task-resolve→doc-sync→metrics-record→[feature-transition | branch-cleanup]→done/skipped) | 1 | 12 shell + 1 hitl.confirm + 3 note | task-resolve→skipped (empty); metrics-record 3-way (feature/merge/done); feature-transition→branch-cleanup/done; branch-cleanup→done | 1 (branch-cleanup, always pauses) | done, skipped | wrapup-learnings.md, wrapup-metrics.jsonl, checkpoint | feature-transition → feature-sync-bounded / `spur feature sync` (→ feature-lifecycle guards); doc-sync → `sp:doc-evolve` | **6 dry `done`** (only workflow to reach done in dry) | 0 real terminal |
| idea-pipeline | 15 (start→discovery→idea-eval→feature-create→ac-generate→feature-check→system-design→design-approval→decompose→batch-create→batch-create-run→handoff-finalize→handoff/cancelled/failed) | 5 | 40 shell + 4 hitl.confirm + 2 note + 9 expectFile | design-approval/idea-eval HITL loops; decompose→batch retry; correction loops | 4 | handoff, cancelled, failed | idea-eval-report, idea-task-batch, idea-handoff, per-task check results | feature create, task batch-create, `spur task deps`, feature refresh | ? (dry failed) | 0 real terminal |
| task-pipeline | 12 (precheck→implement→test→[test-fix→test-recheck]→review→[approve]→verify→record→done/failed/cancelled) | 4 | 30 shell + 1 hitl.confirm + 2 note + 1 expectFile | test→test-fix→test-recheck bounded loop (qualityGateMaxFixAttempts); verify→test-fix remediation; approve HITL routing | 1 (approve, auto skips) | done, failed, cancelled | verdict.json (proof block), test-gate.status/log, verify-answer.txt, checkpoint | `spur task record`, `feature-sync-bounded`/feature sync (record); `/sp:dev-run --mode implement` (implement); `/sp:dev-review`, `/sp:dev-verify` | dry probe `a84c72a3` ran real guards (precheck→implement→test→test-fix→test-recheck→failed, 463ms) — smoke only | 0 real terminal |
| docs-pipeline | 8 (precheck→draft→[docs-review]→record→verify→done/failed/cancelled) | 2 | 13 shell + 2 command.gate + 1 hitl.confirm + 2 note | precheck→failed; draft→docs-review/record (auto); docs-review HITL; verify→done/failed proof-bracket | 1 (docs-review, auto skips) | done, failed, cancelled | docs-precheck status, verdict.json (proof block), verify-answer.txt | `/sp:dev-run --mode implement` (draft), `spur task record`, `/sp:dev-verify`; proof.fingerprint bracket (verify→done compares digest) | dry failed | 0 real terminal |
| feature-dev | 9 (precheck→brainstorm→plan→[execute-tasks-auto | execute-tasks]→feature-verify→[integration-review]→done/failed) | 4 | 7 shell + 1 command.gate + 2 note | plan→execute-tasks(auto/interactive); feature-verify→integration-review/failed | 0 | done, failed | feature-checkpoint, integration-review.status | **nested `spur workflow run .spur/workflows/pr-review.yaml`** (blocked by SPUR_WORKFLOW_RUN_ACTIVE, 0729 §F-2); `/sp:dev-runall --feature` (→ task-pipeline) | dry failed | 0 real terminal |
| history-anatomy | 15 (start→resolve-scope→resolve-paths→analyze→cache-probe→[refresh-provenance | render→enrich→structure-gate→[validate | correct]→stamp]→publish→published/failed) | 4 | 22 shell + 4 expectFile | cache hit/miss branch (daily-only hit); structure-gate/validate FAIL → correct (2-pass cap) → re-gate; ad-hoc always miss | 0 | published, failed | history-anatomy-current/baseline.json+md, candidate.md, publishable.md, provenance.json | `sp:history-anatomy` enrich/validate operations (model), `history-anatomy-cache.mjs` helper (deterministic), atomic publish | dry failed | 0 real terminal |
| pr-review | 11 (preflight→hygiene→precheck→push→ensure-pr→request→wait→collect→done/pending/failed) | 0 (all shell to `pr-reviewing.ts`) | 20 shell | request→collect (ALREADY_REVIEWED)/pending(noWait | submit)/wait/failed; wait→collect/pending/failed; collect→done/pending/failed | 0 | done, pending, failed | pr-context/hygiene/precheck/push/pr/request/wait/findings/status .json | all model work in `sp:pr-reviewing` skill + staged `pr-reviewing.ts` (Codex on GitHub PR); YAML is the spine SSOT | dry failed | 0 real terminal |
| basic | 5 (implement→check→fix→done/failed) | 1 | 7 shell + 1 note | check→done (PASS) / fix (FAIL, <max) / failed (≥max); fix→check loop; missing-status defense | 0 | done, failed | gate-status, fix-attempt-counter | `/sp:dev-fixall` (fix hop); `qualityGateCmd` | dry failed | 0 real terminal |
| wayfinder-resolution | 9 (precheck→collect→investigate→verify→approve→record→done/failed/cancelled) | 2 | 18 shell + 1 hitl.confirm + 2 note + 2 expectFile | precheck→collect/failed; investigate→verify/failed (evidence floor); verify→record(auto PASS)/approve; approve→record/cancelled/failed; record→done/failed | 1 (approve) | done, failed, cancelled | wayfinder input.json, precheck.status, resolution-verdict.txt | `spur task show/check/update`; agent.run investigate/verify (free-form research, no pure-slash surface) | dry failed | 0 real terminal |

**Iteration bounds** (overlarge-bounds check, R4): task-pipeline 20, idea-pipeline 25, feature-dev 20, history-anatomy 20, wayfinder 20, pr-review 16, docs-pipeline 12, wrapup 10, basic 8. No measured utilization exists (0 real runs), so bounds cannot be justified or condemned — they are declared ceilings, not observed counts.

**Dry-run semantics (0729 §F-14, re-verified)**: `workflow run <yaml> --dry-run` validates schema + reachability and **executes real guard shells**. The task-lifecycle dry probe (this pass) executed real `spur task check` guards and cycled the blocked↔todo loop before failing on the absent dummy task; the task-pipeline probe (`a84c72a3`) executed real precheck→implement→test→test-fix→test-recheck→failed. Dry `done` for wrapup-pipeline proves only that the graph is dry-reachable with its guard surface; it is **not** run-readiness evidence (the real guards were the ones that failed elsewhere). Treat dry-run as a smoke check only.

---

## 4. R4 — Fit gate and dispositions

Fit gate = **replay + machine branch + durable record** (the existing gate, per 0731 R4/AC): a workflow fits when it can replay deterministically, branch on machine-checkable state, and record durable outcomes. Applied with disposition categories **keep / simplify-optimize / demote-to-procedure-or-fixture / retire**.

| Workflow | Replay | Machine branch | Durable record | Fit | Disposition | Rationale / identify-first |
| --- | --- | --- | --- | --- | --- | --- |
| task-lifecycle | ✓ (requestTransition replay) | ✓ (shell guards + file-wins reseed) | ✓ (runs + task_run_links kind=lifecycle) | **keep** | keep | Minimal pure status FSM; 0 advisories; real caller; no duplication, no unconditional stages beyond the `always` guards that are the designed external-drive mechanism. |
| feature-lifecycle | ✓ | ✓ | ✓ (runs + task_run_links kind=feature-lifecycle) | **keep** | keep | Same as task-lifecycle. |
| wrapup-pipeline | ✓ (workflow run replay) | ✓ (conditional feature/merge/empty-task guards) | ✓ (learnings.md, metrics.jsonl, checkpoint) | **keep** | keep | Real caller, dry `done`, moderate conditional graph. 4 advisories → **simplify-optimize**: doc-sync 489-char prompt + 7-line shell, metrics-record 22-line shell, feature-transition 30-line shell — extract to a script or record dispositions (ADR-069). Duplication: metrics-record and feature-transition each embed a `feature-sync-bounded` fallback chain. |
| task-pipeline | ✓ | ✓ | ✓ (verdict.json proof block, test-gate artifacts, checkpoint) | **keep** | simplify-optimize | Canonical pipeline; 14 advisories (worst set). Redundant probes: test→test-fix→test-recheck re-runs the same qualityGateCmd (by design for bounded fix, but the green path is fine); overlarge `iterationBound: 20`. Ownership: record→feature-sync-bounded crosses into feature-lifecycle (legal phase boundary). Inline-engine parity cost: `dev-run` inline driver must stay in parity with this YAML's actions/guards (documented cost). |
| idea-pipeline | ✓ | ✓ | ✓ (task batch, handoff report) | **keep** | simplify-optimize | 9 advisories incl. `handoff-finalize` 56-line shell + `batch-create-run` 12-line shell; 4 HITL pauses; `iterationBound: 25`. Real caller. |
| pr-review | ✓ (spine SSOT) | ✓ | ✓ (pr-findings.json/status) | SSOT fits; workflow-run surface **unused** | **demote-to-fixture** | The YAML is the skill's spine SSOT (real role), but the `workflow run pr-review.yaml` surface has no proven caller — it is a fixture the skill references. Keep the SSOT; do not promote it to a pilot. 5 advisories (preflight/precheck/request/wait/collect shell lines). |
| docs-pipeline | ✓ | ✓ | ✓ (verdict proof block) | fits, but no proven caller | **demote-to-procedure-or-fixture** | Docs-only procedure is real (`/sp:dev-run --mode implement` + `spur task record`); the `workflow run docs-pipeline.yaml` surface is unproven. Keep as the docs-sibling fixture; not a pilot (R6 no-caller). |
| history-anatomy | ✓ (deterministic half + cache) | ✓ (cache hit/miss, structure-gate, validate) | ✓ (published report, provenance.json) | fits (engine-driven role) | keep (caller unproven) | Engine-driven role is real and the graph is the most sophisticated (cache branch, 2-pass correction, atomic publish); but **no proven `workflow run` caller in this worktree** (skill never launches). 4 advisories (free-form enrich/validate/correct prompts — no pure-slash surface yet). |
| feature-dev | ✓ | ✓ | ✓ (feature-checkpoint) | fits | keep-with-defect | Nested-review ownership breach (0729 §F-2) makes it non-executable as a pilot; otherwise real umbrella role. 1 advisory (10-line precheck shell). |
| basic | ✓ | ✓ | ✓ | fits (example role) | **keep-as-example/fixture** | Generic example; no caller; not a pilot (R6). 1 advisory (8-line check shell). |
| wayfinder-resolution | ✓ | ✓ | ✓ | fits | **demote-to-procedure-or-fixture** | No caller, free-form research surface (no pure-slash), 3 advisories incl. 1469-char investigate prompt. **Retire-or-demote decision deferred**: no evidence it is used; deleting it (072 ADR-072 precedent) or keeping as a research fixture is a 0732/0733 synthesis call, not a silent choice here. |

**Retire candidates evaluated before optimization/new infrastructure (AC)**: no definition is proven redundant with a real caller — the closest are wayfinder-resolution (no caller) and basic (example only). Both are **demoted, not retired**, because removing a shipped definition is a deployment-surface change outside this ticket's "no production change" constraint (R8/AC: no production workflow change). Retirement is explicitly deferred to the strategy synthesis (0732/0733).

**Duplicated orchestration / unconditional stages / redundant probes / overlarge bounds / ownership breaches / inline-engine parity cost** (R4 checklist):

- Duplicated orchestration: task-pipeline ⇄ docs-pipeline share the precheck→implement→record→verify→done shape (docs is the sibling, acceptable); feature-dev delegates to task-pipeline via `/sp:dev-runall` (phase boundary, allowed per cross-cutting no-nesting); basic ⇄ task-pipeline share implement→check→fix (basic is the minimal example, acceptable).
- Unconditional stages: the `always` guards in task-lifecycle/feature-lifecycle are the designed external-drive mechanism (not accidental); wrapup's `branch-cleanup→done` unconditional defense edge and `task-resolve→skipped` defense are belt-and-braces, acceptable.
- Redundant probes: task-pipeline test/test-recheck re-run the same gate (bounded-fix design, green path is single-run); basic check re-runs qualityGateCmd per fix hop.
- Overlarge bounds: idea-pipeline 25 / task-pipeline 20 / feature-dev 20 / history-anatomy 20 / wayfinder 20 — no measured utilization to justify or trim (0 real runs); flagged for 0732/0733 when real runs exist.
- Ownership breaches: **feature-dev nested pr-review** (0729 §F-2) is the one structural breach — a workflow spawning a nested `workflow run` that the nested-run guard refuses, made advisory by `softFail: true`. Wrapup's feature-transition crosses into feature-lifecycle **through the CLI verb** (legal per cross-cutting lifecycle-guard-respect), not a nested run.
- Inline-engine parity cost: `dev-run` (task-pipeline) and `dev-idea`/`dev-plan` (idea-pipeline) have inline drivers that must stay in parity with their YAMLs; wrapup/dev-wrap is explicitly "workflow-backed" (no inline driver, dev-wrap.md:31) so no parity cost there; history-anatomy and pr-review have no inline driver either.

---

## 5. R5 — Prerequisite table (closed per candidate)

Defect register from 0729 §F (severity-ranked): F1 timeout key, F2 nested-run, F3 spurConfig, F4 continue-drift, F5 fail-open proof, F6 run-id confinement, F7 suppressed task lookup, F8 stale expectFile, F9 run.artifact proof decorative, F10 whole-tree attribution, F11 pipeline-budgets no-op, F12 baseline rot, F13 surface inventory, F14 dry-run smoke. A workflow **cannot be an executable pilot** while it relies on an unrepaired timeout, confinement, proof/freshness, nested-run, validation/resolution, or continue defect.

| Candidate | Relies on unrepaired defect? | Closed? | Notes |
| --- | --- | --- | --- |
| **wrapup-pipeline** | No | **READY** | No command.gate timeout (F1 not applicable — uses agent.run `stepTimeoutMs`); no nested run (feature-transition is a CLI verb, F2 n/a); no proof-fingerprint/fail-open path (F5 n/a — no proof.fingerprint); no verify expectFile (F8 n/a — doc-sync expectFile gates non-empty capture, soft append is by design); run-id confinement (F6) only if `--run-id` passed (dev-wrap doesn't); continue-drift (F4) **only if the branch-cleanup pause is exercised and resumed** — the pilot can run `profile=auto, merge=false` to avoid the pause path. **Pilot-ready** for the non-pause path; the pause/resume path stays unsafe until F4 is fixed. |
| **task-lifecycle** | No | **READY** | Pure requestTransition FSM; no timeout/nested/proof/expectFile; guards (`spur task check --as`) are the same working verb as the CLI. Done transition requires the P2 provenance gate (lifecycle-adapter.ts:100-130): a `kind=pipeline` run link or `SPUR_PROVENANCE_OVERRIDE=1` (recorded bypass). Pilot can exercise the status graph without hitting `done` (or use the recorded bypass). **Pilot-ready** for FSM/version exercise. |
| feature-lifecycle | No | READY | Same shape as task-lifecycle; `done` requires feature verify guards. |
| docs-pipeline | No | ready-but-no-caller | No dependency on F1-F14 in its non-pause path; but **no proven caller** → not pilot-eligible (R6). |
| idea-pipeline | Partial (F4 if paused) | not-selected | 4 pauses → any pause+resume hits F4; 5 agent.run with `stepTimeoutMs` (no F1). Complex (15 states) and high blast radius (creates features/tasks). Not selected. |
| history-anatomy | Unknown | not-selected | Depends on `superskill script path sp history-anatomy-cache.mjs` staging (0729 §G-4 unknown) + free-form model ops; no proven caller. Not selected. |
| pr-review | **Yes (F1/F2-linked + superskill unknown)** | NOT READY | `command.gate timeoutMs` dead key (F1) does not affect it (no command.gate), but feature-dev's nested call to it is blocked (F2); `superskill script path sp pr-reviewing.ts` staging behavior unknown (0729 §G-4). Not selected. |
| feature-dev | **Yes (F2 nested review)** | **INELIGIBLE** | Nested `spur workflow run pr-review.yaml` always refused under SPUR_WORKFLOW_RUN_ACTIVE (0729 §F-2); `softFail:true` masks it → **feature-dev remains ineligible while nested review is impossible** (AC, R5). |
| task-pipeline | Partial (F7 suppressed task lookup weakens proof; F8 stale expectFile; F5 fail-open proof) | excluded (R6) | Canonical pipeline; excluded from pilot selection by R6 regardless. |
| basic | No | no-caller | No caller → not pilot-eligible (R6). |
| wayfinder-resolution | No | no-caller | No caller → not pilot-eligible (R6). |

---

## 6. R6 — Pilot ranking (real-caller surrounding workflows)

Excluded per R6: `task-pipeline` (canonical, explicitly not the pilot) and all no-proven-caller definitions (docs-pipeline, history-anatomy, pr-review, basic, wayfinder-resolution). Eligible real-caller surrounding workflows: **task-lifecycle, feature-lifecycle, wrapup-pipeline, idea-pipeline** (+ feature-dev but structurally ineligible per R5). Ranked on representativeness / reversibility / trace coverage / prerequisite-readiness / blast radius.

| Candidate | Representativeness | Reversibility | Trace coverage | Prereq-ready | Blast radius | Rank |
| --- | --- | --- | --- | --- | --- | --- |
| **wrapup-pipeline** | **High** — conditional branches (feature/merge/empty), HITL pause, composition (feature sync), model+deterministic mix; real operator surface (dev-wrap) | **High** — append-only learnings/metrics; feature sync is lifecycle-guarded; no destructive op unless merge=true (and branch-cleanup has no git op wired yet) | **High** — run log, metrics.jsonl, checkpoint, trace (dry `done` proven) | **READY** (non-pause path; avoid F4 by not pausing) | **Low** — writes markdown/metrics/checkpoint only; task status untouched | **1 — PRIMARY** |
| **task-lifecycle** | **Medium-High** — canonical entity-status FSM, externally driven (requestTransition), the guard surface every pipeline respects | **High** — done re-enterable, blocked↔todo loops, cancelled terminal | **High** — runs + task_run_links kind=lifecycle + guard denials | **READY** (avoid `done` or use recorded bypass) | **Low** — per-task status transitions, guarded | **2 — SECONDARY** |
| feature-lifecycle | Medium (same FSM class as task-lifecycle) | High | High | READY | Low | 3 |
| idea-pipeline | High (5 model hops, HITL gates, delegation) | Medium (creates features/tasks) | Medium | **Partial (F4 on pause)** | **High** (writes features + task batches) | 4 (not selected) |

### Recommendation

**Primary surrounding pilot: `wrapup-pipeline`** — the only eligible real-caller workflow that is (a) `spur workflow run`-executable, (b) proven dry `done` (the graph reaches a terminal in dry mode), (c) moderate-size and representative (conditional routing, HITL, composition, model+shell mix), (d) reversible with low blast radius (append-only artifacts; task status never mutated). Its one caveat — the `branch-cleanup` pause+resume path is unsafe under F4 until the continue-drift defect is fixed — is avoided by running `profile=auto` + `merge=false` (no pause), which is also the common real invocation.

**Secondary surrounding pilot: `task-lifecycle`** — minimal real-caller FSM that is the cleanest vehicle for R7's both-version-forms exercise and for observing `definitionDigest`/`workflow show` behavior with zero model cost. Both pilots are **unversioned today**; task-lifecycle is the recommended both-forms exercise because a version-only edit on the 7-state FSM yields an observable digest change (composition-baseline.ts:110) with no behavior impact, visible via `workflow show` + a lifecycle transition, while wrapup-pipeline would also work but carries the agent.run/doc-sync surface.

**No known-broken primitive is treated as safety/observability evidence** (AC): wrapup's feature-transition corpus-gate (soft) and task-lifecycle's guards are exercised on the working `spur` verb surface, not on F1/F5/F8 broken paths. The pause/resume path is explicitly not part of the pilot's initial scope until F4 is repaired.

---

## 7. R7 — Version classification

- All 11 shipped workflows omit `version` → classified **`unversioned`** (absent optional string is valid and reported as unversioned; AC).
- `explicit(<literal>)` applies only to a non-empty quoted literal; the schema accepts any string (no registry, no minLength), and zero consumers exist. Both `explicit("1.2.3")` and empty-string versions validate (probe-verified this pass). **Do not invent unsupported-version semantics or a registry** — the field is behavior-neutral today (0729 §H).
- **Source/digest/resume implications**: `version` is folded into `computeDefinitionDigest` (composition-baseline.ts:110-116, whole-def canonical JSON) — a version-only edit changes run digests with zero behavior change (empirically verified: `sha256:3d05d63d…` vs `sha256:fc4bd91f…`). On `workflow run`, the digest is stamped best-effort at run start; on `continue`, **no digest comparison happens** (0729 §F-4/S2, continuePaused re-resolves by name) — so a version edit between run and resume is invisible to the engine (only a `definition-drift` progress diagnostic). Fixing the digest comparison at `continuePaused` (0729 Decision 4) subsumes any version-based drift concern; version alone adds no new risk.
- **Both-forms exercise**: `task-lifecycle` (secondary pilot) is the recommended vehicle — absent→`unversioned` and `explicit(<literal>)` both validate, and the digest change is observable with a lifecycle transition + `workflow show`. `wrapup-pipeline` can also exercise both forms (its digest also shifts on a version-only edit) but carries the agent.run surface. No other workflow is a better vehicle (all real-caller candidates are unversioned; the exercise is definition-level, not workflow-specific).

---

## 8. R8/R9 — Compact matrix, dispositions, and deliverable

See the matrices in §1–§7. Summary dispositions: **keep** = task-lifecycle, feature-lifecycle, wrapup-pipeline, history-anatomy (caller unproven but role real); **simplify-optimize** = task-pipeline, idea-pipeline; **keep-as-example/fixture** = basic; **demote-to-procedure-or-fixture** = pr-review, docs-pipeline, wayfinder-resolution; **keep-with-defect / ineligible-pilot** = feature-dev; **retire** = none this pass (wayfinder/basic retirement deferred to 0732/0733 synthesis; no production change made). **No production workflow or public CLI surface changed** (AC). This artifact is the reviewable deliverable; the task Solution links it with line anchors.

### Evidence commands (this pass)

- `bun run apps/cli/src/index.ts workflow list` / `--json` — 11 resolved, single project layer.
- `bun run apps/cli/src/index.ts workflow validate config/workflows/<each>.yaml` — all valid, 42 composition advisories total (per-workflow counts in §1; matches 0729 §A).
- `bun run apps/cli/src/index.ts workflow show config/workflows/task-lifecycle.yaml` — mermaid graph, no version rendered.
- `bun run apps/cli/src/index.ts workflow validate /tmp/pi-0731-version-probe.yaml` (explicit `1.2.3`) and `-empty.yaml` (`""`) — both valid (fixtures removed).
- `bun run apps/cli/src/index.ts workflow trace a84c72a3-…` — dry probe real-guard trace (precheck→implement→test→test-fix→test-recheck→failed).
- `bun run apps/cli/src/index.ts workflow run config/workflows/task-lifecycle.yaml --dry-run` — real-guard dry run (cycled blocked↔todo); probe run + 51 transition rows **deleted** post-probe (DB restored to 68-row cohort).
- `bun run scripts/spur-dev.ts real-run-cost` — all 11 `wall=n/a cost=n/a [excluded N dry, M non-terminal]`.
- `sqlite3 .spur/spur.db` — runs/transition_runs/task_run_links/queue_jobs queries (all rows reproduced in §1–§2); `diff -q` for installed-vs-repo byte-identity; `bun -e computeDefinitionDigest` version-in-digest check.
- Caller evidence: `grep` across `plugins/sp/commands/*.md`, `skills/*/SKILL.md`, `apps/cli/src/commands/task.ts|feature.ts`, `make-lifecycle-adapter.ts`, `lifecycle-adapter.ts`, `cross-cutting.md`, `README.md`.

### Unknowns (honest)

- Real-run frequency for all 11: **0 terminal runs in this worktree's evidence window** — no measured cost/outcome/attention basis for any bound or budget (0730 §G sufficiency not met).
- `history-anatomy` and `pr-review` caller state: no proven `workflow run` caller in this worktree; adoption intent is documented but unobserved. `superskill script path sp pr-reviewing.ts` / `history-anatomy-cache.mjs` staging behavior (0729 §G-4) still unverified on a real machine.
- Pause-resume safety for wrapup-pipeline / idea-pipeline / docs-pipeline under F4 (continue-drift) — unsafe until the digest-comparison fix lands.
- Whether wayfinder-resolution/basic are actually used via direct `spur workflow run` outside this worktree — unobservable from this plane.
- feature-dev nested-review remediation path (fix F2 vs. replace with non-spawning check) is 0729 Decision 2, not decided here.
