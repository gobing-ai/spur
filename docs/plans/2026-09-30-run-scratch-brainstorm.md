---
kind: plan
title: Make completed run scratch disposable
status: approved
created_at: 2026-09-30
updated_at: 2026-09-30
related: [E71, E7, F93]
tags: [brainstorm, workflow, planning]
needs_design: true
run_id: idea-run-scratch-20260930-9f41c7
---

# Make completed run scratch disposable

## 1. Objective and outcome

Make `.spur/run/` genuinely temporary: after all owning processes and consumers finish, removing its completed scratch must not change task/feature acceptance, verification evidence, historical analytics, or retained run inspection. The operator permits omitting per-command/per-workflow terminal cleanup steps. This proposal therefore prioritizes removing lasting dependencies, rather than adding cleanup hooks everywhere.

Planning completed after operator acceptance of the idea and storage design. E71 and tasks 1024–1027 were created through the CLI and checked ready. No production edits, cleanup or behavior verification has occurred. Existing web edits were present at discovery; unrelated concurrent planning changes remain outside this run.

## 2. Premises and dependencies

The premise that `.spur/run/` already contains only temporary data is false in the current implementation. Findings below are HIGH confidence for the cited source inspected on 2026-09-30. Completeness of the classified inventory is MEDIUM: broad lexical searches identify candidates, but computed paths and dependencies in historical records require implementation-stage tracing.

Search receipts under `.spur/run/idea-run-scratch-20260930-9f41c7-*`:

- `run-reference-inventory.txt`: 2,378 matching lines across source, commands, workflows, tests, config and working/design docs. Includes direct paths, split path construction, and `runDir`/`runRoot`/`runLogDir`; these are candidate references, not 2,378 confirmed dependencies. Generated CLI config and bundled library output excluded as derived surfaces.
- `cleanup-candidates.txt`: 153 cleanup candidates, including unrelated temporary directories and test teardown, to be classified rather than blindly removed.
- `affected-tests.txt`: 76 candidate test files; no test execution claimed.

### Lasting dependencies

| Family | Evidence | Required disposition |
| --- | --- | --- |
| Task verdicts and proof | `packages/app/src/services/task-record.ts:74`, `task-check.ts:1836`, `verified-outcome.ts:208`, `done-transition-guard.ts`; CLI `task verdict`/`record` | Preserve authoritative evidence in durable storage, update every producer/consumer, retain fail-closed verification. Analytics currently reads the verdict file after task completion. |
| Feature acceptance and verification receipts | `packages/app/src/services/feature-check.ts:290`, `packages/app/src/workflow/feature-verification-receipt.ts:32`, `plugins/sp/scripts/feature-verification-steps.ts` | Preserve scenario identity, task binding, proof/run identity, latest and run-scoped receipts outside scratch. |
| Corpus checks and suppression | `packages/app/src/services/corpus-check.ts:102`, `corpus-sweep.ts:111`, `feature-sync-suppression.ts:62`, `feature-service.ts:696` | Redirect lasting verdict reads; suppression is derived state and may regenerate if deletion cannot weaken acceptance or cause invalid transitions. |
| Human/machine run records and artifact references | `packages/app/src/services/workflow-service.ts:1630`, `agent-service.ts:2533`, `inline-run-setup.ts:752`, `packages/app/src/observability/workflow-run-log-sink.ts`, `packages/app/src/workflow/actions/run-artifact.ts` | Persist retained records and referenced artifact bytes before disposal; update ledger/reference consumers. Database run rows alone must not be assumed to replace files. |
| Agent session histories | `packages/app/src/services/history-service.ts:481`, `packages/app/src/workflow/actions/agent-run.ts` | Preserve resumable sessions and complete history import before scratch disposal; independent background consumers must finish too. |
| Worktree result persistence and planning handoff | `packages/app/src/services/inline-run-setup.ts`, `plugins/sp/skills/spur-dev/references/execution-batch.md`, `packages/app/src/workflow/idea-handoff.ts` | Keep durable worktree exports and final planning reports outside scratch; do not delete before export or leave lasting links pointing into scratch. |
| Cache and active-run handoffs | `packages/app/src/services/agent-service.ts:2613`, `plugins/sp/scripts/history-anatomy-cache.ts`, `quality-gate.ts:437`, workflow status/proof/question/escalation files | Recomputable caches may disappear between invocations. Handoffs remain temporary but must survive until the owning run and its consumers finish; paused runs remain live. |
| Path confinement contracts | `packages/app/src/workflow/actions/run-path.ts:35`, doctor/command gate/file-read runners | Keep temporary paths confined. Durable evidence needs a separately explicit allowed destination; widening scratch confinement arbitrarily is unacceptable. |

### Existing one-off cleanup and invalidation

| Owner | Current behavior | Disposition |
| --- | --- | --- |
| `config/workflows/idea-pipeline.yaml:224`, `:397` | Remove old AC/decomposition outputs and sentinels before retries | Keep freshness semantics; remove redundant deletions only when run/attempt ownership makes stale reuse impossible. |
| `config/workflows/idea-pipeline.yaml:464`, `:470` | Clear batch result/failure state and temporary JSON around atomic publication | Preserve failure routing and atomic publication. |
| `config/workflows/task-pipeline.yaml:249` | Consume and remove a question after appending the escalation answer | Preserve ordering and prevent old questions re-triggering escalation. |
| `config/workflows/wayfinder-resolution.yaml:99` | Clear verifier answer and WBS verdict before verification | Audit WBS-shared ownership; migrate durable verdict handling without allowing an old PASS to satisfy a new attempt. |
| `packages/app/src/workflow/actions/agent-run.ts:332`, `:814`, `:835` | Delete `expectFile` and escalation signal before dispatch, including fleet path | Required freshness protection, not general terminal housekeeping. Keep or replace with equally strict attempt identity. |
| `packages/app/src/services/quality-gate.ts:593`, `:604` | Fold and delete `.probe`/`.attempt-*` log intermediates | Safe local scratch cleanup; consolidate only if redundant after disposal contract is established. |
| `packages/app/src/services/inline-run-setup.ts:796`, `packages/app/src/observability/workflow-run-log-sink.ts:228`, receipt atomic writer | Clear failed `.tmp` state publication | Preserve atomic writes and failure cleanup; successful rename already consumes temporary source. |
| `packages/app/src/services/feature-service.ts:696` | Clear resolved feature-sync blocked state | Derived-cache invalidation, not a terminal run hook. |
| `packages/app/src/services/workflow-service.ts:932`; CLI `workflow clean` | Age-based legacy `.log` reclamation, presently allowed even for old active logs; excludes `.md` + `.state.json` | Existing policy does not establish safe terminal scratch disposal. Reconcile retained-log ownership and active-run protection before broader cleanup. |

False positives to keep outside this cleanup scope: proof fingerprint alternate Git indexes (`proof-input-fingerprint.ts:260`) and agent-run snapshot indexes use system temporary storage; quality-gate shell output directory uses `tmpdir()`; residual settlement deletes `/tmp/<wbs>-*`; history report publication/retention operates on report targets; checkpoint reclamation operates on `.spur/memory/sessions`; test fixture teardown removes isolated test roots. Installed `.mjs` twins and generated CLI config must be regenerated through their owners when source contracts change.

## 3. Approaches

1. **Recommended: separate lasting evidence from scratch, then prove disposal is harmless.** Reuse existing database evidence facilities and `.spur/memory/` or `.spur/reports/` conventions where their ownership fits. Select exact destinations during system design. Update producers, readers, path confinement, references, and tests together. No per-workflow terminal cleanup is required. Confidence HIGH on need, MEDIUM on exact migration effort until callers and existing stores are traced fully.
2. **Keep mixed storage and add selective deletion.** Smaller initial migration, but every cleaner needs artifact classification and still leaves permanent dependencies inside `.spur/run/`. Fails the operator's requested temporary-only invariant. Confidence HIGH.
3. **Delete all evidence dependencies and trust task Markdown.** Removes files quickly, but loses bound proof, accepted-scenario identity and retained history guarantees. Reject because it weakens existing validation. Confidence HIGH.

## 4. Execution sequence

1. Complete the ownership inventory: each candidate gets producer, all consumers, lifetime (attempt/run/resumable/lasting/recomputable), existing cleanup, final destination/disposition and regression check. Include computed paths and installed surfaces. Use CLI lookup for historical task records; never raw-write corpus.
2. Migrate verdict/proof and feature receipt ownership with all task/feature/corpus/analytics consumers; preserve existing invalid/missing/stale evidence rejection. Migrate existing project evidence before declaring completed scratch disposable; no indefinite legacy read fallback into scratch.
3. Migrate retained run records, artifact references, resumable sessions, import/export and planning handoffs. Keep active/paused/interrupted recoverable ownership intact. Persistence failure leaves scratch intact and prevents successful disposal.
4. Review local invalidation/deletion sites. Remove only cleanup proven redundant; retain freshness guards and atomic-write cleanup. Reconcile existing `workflow clean` behavior without adding a public noun/verb or silently changing its policy.
5. Update affected tests and owning contract docs/plugin sources. Run disposal regression checks after terminal consumers finish, plus focused suites, structural gates and feature verification through the execution pipeline.

## 5. Risks and verification

Decisive regression: capture task/feature acceptance, verified-outcome analytics, retained run inspection and artifact reads; finish all processes/consumers; remove completed scratch in an isolated fixture; repeat and require unchanged results. Repeat removal and allow the next command to recreate an absent run directory. Test terminal success and failure, persistence failure, concurrent unrelated live runs, paused/resumable runs, late history import, worktree export, stale PASS and malformed evidence, and physical path confinement.

Candidate suites include `packages/app/tests/services/{task-check,done-transition-guard,feature-check,verified-outcome,workflow-service,agent-service,feature-sync-suppression,history-service}.test.ts`, workflow action/receipt tests, CLI command tests, plugin workflow/standalone tests and `scripts/commands/eval-pipeline.test.ts`. Resolve actual filenames from the saved test inventory during decomposition; do not invent missing suites.

No production cleanup performed. The audit does not prove existing scratch can be deleted safely. No new public CLI noun/verb, timer, retention framework or per-workflow cleanup hook proposed.

## Design Summary

`.spur/run/` holds only disposable execution scratch, including within-run status, prompts, answers and intermediate outputs. Lasting verification and inspection data lives under its durable owner and is read there after completion. A safe disposal boundary occurs only after all owning processes and consumers have finished and any lasting data is persisted. Active or paused work stays recoverable. The initial implementation may omit automatic terminal deletion entirely: enforce safe disposability through producer/consumer migration and deletion-based regression checks first. Required invalidation and atomic-write cleanup remain where correctness depends on them.

## 6. Follow-up

After idea-evaluation acceptance, feature lookup identified F93's existing `parseTesting` coverage fallback in `feature-check.ts:840`. Reuse this implemented mechanism; do not treat every missing scratch verdict as lost feature coverage. Structured proof/analytics and receipt dependencies still need migration. E71 was created under the existing E7 run-record owner. ADR-131 and `docs/design/disposable-run-storage.md` carry the accepted storage destinations and existing `workflow clean` migration behavior; the operator gave explicit design/public-surface consent.

Spec self-review: no placeholders; temporary-only scope and optional automatic cleanup are consistent; original evidence guarantees retained. `needs_design: true` because this crosses verification, workflow persistence, analytics, plugin and test boundaries. AC inventory coverage and design checks passed. Task schema/order validation and CLI batch creation passed. The deterministic handoff applied dependencies, refreshed the feature roster and reported all four tasks READY against planning digests, seven checklist rows, tree-verified premises and individual task checks. Feature findings are expected unverified-scenario warnings until implementation, not planning failures. This idea pipeline stops at handoff; it does not execute the fixes.

| Task | Outcome | Depends on |
| --- | --- | --- |
| [1024: ownership audit](../tasks5/1024_audit-run-storage-ownership-and-one-off-cleanup.md) | READY | None |
| [1025: durable task/feature evidence](../tasks5/1025_persist-task-and-feature-evidence-outside-run-scratch.md) | READY | 1024 |
| [1026: retained records/sessions/artifacts](../tasks5/1026_retain-run-records-sessions-and-artifacts-outside-scratch.md) | READY | 1025 |
| [1027: disposal and cleanup safeguards](../tasks5/1027_verify-disposable-scratch-and-reconcile-cleanup-safeguards.md) | READY | 1025, 1026 |

The persistent plan and accepted design are sufficient to restart the audit; temporary search receipts are optional and can be regenerated. Task 1024 explicitly carries this boundary to avoid introducing another lasting scratch dependency.

Next command: `/sp:dev-runall --feature E71 --auto`.

Run bookkeeping limitation: terminal closure returned `NO_ACTION_ROWS` because this inline planning run did not emit action trace rows as stages executed. The authoritative run was already marked terminal by the closer, but closure is not a clean PASS. Per the trace contract, rows were not backfilled and no replacement run was fabricated. CLI batch creation, readiness/dependency checks and feature coverage checks passed independently; the tasks are ready, while this run retains its bookkeeping finding.
