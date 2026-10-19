---
kind: design
title: "Workflow consolidation — one owner per lifecycle, D65 primitives everywhere"
status: implemented
created_at: 2026-10-17
updated_at: 2026-10-18
related: [D66, D64, D65, A92]
tags: [system, D66, workflow]
---

# Workflow consolidation — one owner per lifecycle, D65 primitives everywhere

- **Status:** Proposed · **Date:** 2026-10-17 · **Feature:** D66
- **Decisions:** ADR-142 (feature-lifecycle owns feature state and verification); amends the
  ADR-119 consequence. Builds on ADR-125 (`decide`), ADR-126 (fleet executor), ADR-140 (one
  interpreter, work-item dispatch).
- **Extends:** [workflow execution foundation](workflow-execution-foundation.md),
  [workflow catalogue refactor](workflow-catalogue-refactor.md),
  [decision catalog](decision-catalog.md)

## 1. Issue and scope

D65 moved `task-pipeline` and `task-lifecycle` onto the host/fleet executor, `command.gate` and
catalog `decide` calls. The other seven bundled workflows were not moved. Their run history since
2026-09 shows the cost:

| Workflow | Runs (pass) | Dominant failure edge |
| --- | --- | --- |
| feature-verification | 162 (136) | `verify→failed` — real check failures; the file is a one-state wrapper over `spur feature verify` |
| wrapup-pipeline | 160 (101) | `task-resolve→failed` (25), `feature-transition→failed` (11) |
| feature-lifecycle | 72 (33) | nested `workflow run` from `verifying` onEnter |
| idea-pipeline | 43 (13) | `start→failed` (19) — doctor / agent-resolution shell |
| pr-review | 20 (0) | `preflight→failed`; no run of the current definition exists |
| wayfinder-resolution | 18 (0) | `precheck→failed` |

Feature state also has three writers today: `feature-lifecycle` (requestTransition),
`wrapup-pipeline` (`feature-transition`, `feature-verify` states) and `idea-pipeline` handoff
(through `spur feature update`).

Scope (operator decisions 2026-10-17): delete `feature-verification`, `pr-review` and
`wayfinder-resolution`; `wrapup-pipeline` stops changing feature status; the CLI surfaces and sp
skills, commands and agents that name these workflows move with them. Out of scope: wildcard
`from` transitions (the state-machine schema's `transition.from` is a plain string; adding a
wildcard is a released `@gobing-ai/ts-dual-workflow-engine` change), `history-anatomy`, and the
task workflows.

## 2. Context and constraints

- `spur feature verify` (`apps/cli/src/commands/feature/verify.ts` →
  `packages/app/src/workflow/feature-verification-run.ts`) owns the whole pass: it resolves the
  verifier definition, writes RUNNING then PASS/FAIL receipts (run-scoped and feature-latest under
  `.spur/memory/evidence/`), and launches `spur self exec check-feature`. The workflow adds only the
  run id.
- The receipt's verifier identity is the **resolved `feature-verification` definition** (name,
  source path, layer, digest): `feature-verification-run.ts:213`, `feature-check.ts:561`. Deleting
  the file without rebinding fails every `verifying→done` check closed.
- `feature-lifecycle` is externally driven (`requestTransition`): one transition per `(from, to)`
  pair, guards fail closed. `verifying` onEnter currently runs
  `env -u SPUR_WORKFLOW_RUN_ACTIVE spur workflow run feature-verification.yaml …` (1147 R4 workaround
  for the nested-run refusal, 0610 R4).
- `task-pipeline`'s `done` state already performs `task record`, the residual sweep/fold/settle,
  the done transition and a best-effort `feature sync`. `wrapup-pipeline` re-resolves and re-checks
  the same tasks.
- `config/decisions/idea-pipeline.yaml` ships `idea-recommendation` and `needs-design` as
  rescue-only decisions; the workflow declares no `decide` action and keeps four `hitl.confirm`
  gates, two of them objective (`feature-check`, `batch-create`).
- Observed in planning this feature (run `44f98e49`): with `executor=host` and `--json`,
  `idea-eval`'s `hitl.confirm` returned an empty answer, the shell step defaulted it to `no`, and the
  run ended `cancelled` without pausing.

## 3. Solution

### 3.1 Workflow set after the change

| Kept | Owns | Change |
| --- | --- | --- |
| task-lifecycle, task-pipeline | task state / task execution | unchanged |
| feature-lifecycle | **all** feature state and feature verification | verification folded in (§3.2) |
| idea-pipeline | idea → feature + AC + task batch | D65 alignment (§3.4) |
| wrapup-pipeline | post-task docs, learnings, metrics, branch cleanup | shrunk, no feature writes (§3.3) |
| history-anatomy | history anatomy report | unchanged |

Deleted: `feature-verification.yaml`, `pr-review.yaml`, `wayfinder-resolution.yaml`.
`/sp:dev-pr-review` and `sp:pr-reviewing` call `spur builder pr-status | pr-check | pr-open |
pr-review` directly — the verbs already own the sequencing (`runPrVerb`). `sp:wayfinder` keeps its
investigate guidance as a skill procedure; `references/pipeline-resolution.md` is removed or
rewritten as a non-workflow procedure. `done-transition-guard.ts` only names the workflow in a
comment.

### 3.2 feature-lifecycle owns verification

```yaml
- id: verifying
  onEnter:
    - kind: shell
      options:
        command: '$spurBin feature verify $featureId --no-logo'
```

- The lifecycle caller runs only `kind: shell` onEnter actions (`lifecycle-adapter.ts:347`), so the
  entry stays a shell — now a direct verb call, with no nested run.
- `spur feature verify` without `--run-id` opens its own run row (workflow `feature-lifecycle`,
  resolved definition digest) and finalizes it `done` when the pass completes. Binding the receipt to
  the lifecycle run would fail closed: the receipt gate requires a terminal `done` recording run
  (`feature-verification-receipt.ts:417`), and the lifecycle run is `running` at `verifying→done`.
- A FAIL pass is recorded and the feature enters `verifying`; the `verifying→done` guard denies it
  and `verifying→active` is the rework edge. Only a pass that cannot run denies entry.
- The verifier identity becomes the resolved **`feature-lifecycle`** definition. Both resolution
  sites (`feature-verification-run.ts`, `feature-check.ts`) take the name from one exported constant
  (`FEATURE_VERIFIER_DEFINITION`) so they cannot drift.
- `verificationCmd` moves from a workflow var to the configured `spur self exec check-feature`
  action that `spur feature verify` already resolves; the var is dropped.
- Receipt file names (`<runId>-feature-verification.json`, `<featureId>-feature-verification.json`)
  and `persist-check` / `run-storage` families stay — they name the *pass*, not the workflow.
- Compatibility: a feature-latest receipt whose verifier name is `feature-verification` is reported
  by `feature check --strict` as stale with the re-verify command (`spur feature verify <id>`); it is
  never silently accepted, because its digest binds a definition that no longer exists.
- Auto-advance (R4): `feature sync` requests `active→verifying` when every linked task is terminal.
  The existing guard `feature check <id> --as verifying` stays the authority; sync only requests.

### 3.3 wrapup-pipeline

Shape after: `start → task-resolve → doc-sync → learnings-validate → learnings-append|repair →
doc-tripwire → metrics-record → branch-cleanup? → done | skipped | failed`.

- `feature-transition`, `feature-verify` and the `feature` var are removed. A wrap-up never writes
  feature state; `/sp:dev-wrap --feature` routes the operator to `spur feature update` /
  feature-lifecycle instead.
- `task-resolve` becomes one `command.gate` over a typed resolver in
  `packages/app/src/workflow/wrapup/` (`resolveTasks` already exists in `steps.ts`), writing a
  normalized run-scoped list consumed by later states. Statuses: `PASS`, `EMPTY` (→ `skipped`),
  `FAIL: <wbs>: <reason>` (→ `failed`).
- Doc-sync stays the one `agent.run` stage, dispatched through the run's executor.
- Size budget: ≤250 lines including comments (R7).

### 3.4 idea-pipeline

- `start`: one entry verdict, the idea text check and executor readiness writing one status file
  with a named reason. `doctor.probe` becomes executor-aware: under `executor=host` readiness is
  the host session and is not probed; under `executor=fleet` it is the wired fleet dispatch;
  otherwise the existing doctor probe runs once.
- `feature-check` and `batch-create`: the interactive `hitl.confirm` states are deleted. Their
  recorded results are deterministic PASS/FAIL, which `profile=auto` already routes on directly;
  every profile now takes those edges. A `decide` there would have nothing to rescue.
- The discovery rescues (`idea-recommendation`, `needs-design`) move from `spur decision run`
  shells to `kind: decide` actions; the two existing catalog ids fit, and no entry is added.
- `idea-eval` and `design-approval` remain operator pauses (taste).
- Operator pauses on a host run (R10): an unanswered `hitl.confirm` pauses the run with its
  question. The empty-answer-means-`no` shell default is removed; only an explicit `no`/`cancel`
  cancels. The fix belongs in the responder seam (`decision-hitl-responder` /
  `workflow-resume-ops`), so every workflow gets it, not only idea-pipeline.
- Size budget: ≤600 lines including comments (R9); stale `feature-dev.yaml` reference removed.

## 4. Contract and compatibility

- **Breaking:** projects that override or invoke `feature-verification.yaml`, `pr-review.yaml` or
  `wayfinder-resolution.yaml` by name. `spur init` copies bundled config into `~/.config/spur/` and
  never deletes (`apps/cli/src/commands/init.ts:179`), so an existing install keeps a stale seeded
  copy that `spur workflow run <deleted>.yaml` still resolves; a fresh install fails with
  definition-not-found. CHANGELOG `BREAKING CHANGE` note: migrate verification overrides to
  feature-lifecycle `verifying`; call `spur builder pr-*` directly; delete the three seeded copies
  from `~/.config/spur/workflows/`.
- **Unchanged public verbs:** `spur feature verify`, `spur feature check`, `spur feature sync`,
  `spur builder pr-*`, `spur task wrapup`. The hidden deprecated `spur builder pr` alias stays
  (operator decision 2026-10-17) but no workflow, skill, command or agent invokes it; they call the
  `spur builder pr-*` verbs.
- **Receipts:** existing feature-latest receipts recorded under the old verifier name read as stale
  with a re-verify command; no data migration.
- **Vars:** `wrapup-pipeline` drops `feature`; `feature-lifecycle` drops nothing (its `verifying`
  entry gains no var).

## 5. Tradeoffs and open questions

- Folding verification into the lifecycle makes `verifying` entry slow (the repo-wide pass). That is
  the ADR-119 intent; the alternative — a separate workflow — is what produced the nested-run
  workaround.
- Stale-receipt reporting forces one re-verify per in-flight feature after upgrade; accepted over a
  compatibility read that would trust a digest of a deleted definition.
- Decided: keep the hidden `spur builder pr` alias; callers use `spur builder pr-*` only.
- Deferred: wildcard `from` in the engine would remove the 10 `to: cancelled|deprecated` fan-in edges in feature-lifecycle and
  the 12 in task-lifecycle; recorded as task 1253 under D66 (cancelled on close — deferred until the engine
  ships, not implemented here).

## 6. Verification

| Surface | Proof |
| --- | --- |
| feature-lifecycle `verifying` entry (1246/1247) | `packages/app/tests/workflow/feature-lifecycle-verifying-entry.test.ts` — fixture project, real CLI: receipt, own `feature-lifecycle` run row, verifier identity |
| wrapup-pipeline (1249) | `packages/app/tests/workflow/wrapup-pipeline-e2e.test.ts` — fixture project, real CLI: run row, terminal state, resolve/metrics status files, persisted task list; no feature-status write on any path |
| idea-pipeline (1250) | `packages/app/tests/workflow/idea-pipeline-routing.test.ts` — live YAML guards driven against fixture fact files: profile-independent routes, typed entry status file, decide rescues |
| Repo-wide absence of the three retired definitions (1252) | `repo-wide-tests/workflow-consolidation-absence.test.ts` — runs inside `spur-check-feature` |
