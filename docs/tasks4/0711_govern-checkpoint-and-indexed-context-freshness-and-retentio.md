---
schema_version: 1
name: "Govern checkpoint and indexed-context freshness and retention"
status: done
template: issue
created_at: 2026-08-28T23:03:05.726Z
updated_at: "2026-08-30T00:15:57.753Z"
priority: P2
tags: ["harness", "memory", "checkpoint", "retention"]
feature_id: A6
ac_altitude: task-local
---

## 0711. Govern checkpoint and indexed-context freshness and retention

### Background

Spur has several memory forms with different owners: authoritative task/feature Markdown, workflow state/logs, `.spur/memory/sessions` checkpoints, and `.spur/context` indexes. Workflow log retention is configured, but the default task pipeline writes a one-line terminal checkpoint without the documented resumability metadata, and checkpoint/context freshness or cleanup is not equivalently governed. Stale files can look current and influence routing or resumption.

This task adds metadata, validation, and bounded cleanup to the current file owners. It deliberately avoids a vector database or a new memory service.

### Requirements

- [x] R1. Define a versioned checkpoint metadata contract containing session/run id, workflow, task/feature id, phase/status, proof or source digest when available, source commit, generated/updated time, next action, and referenced artifacts.
- [x] R2. Replace the task-pipeline's one-line terminal checkpoint with the canonical contract and align actual writers/readers with the existing Session Checkpoint Convention.
- [x] R3. Before resume or next-router use, validate schema, owner identity, terminal/current status, source commit/digest freshness, and referenced artifact existence; stale/invalid checkpoints are reported and ignored, never silently trusted.
- [x] R4. Add equivalent generation metadata to indexed-context outputs sufficient to detect source-commit/time staleness without embedding repository content in a second store.
- [x] R5. Extend existing workflow cleanup ownership to delete expired terminal checkpoints only when no active run references them and the resolved path is confined to `.spur/memory/sessions`.
- [x] R6. Never delete authoritative task/feature files, active-run artifacts, or cumulative context learnings automatically. Context cleanup removes only regenerable indexes/ledgers covered by the contract.
- [x] R7. Reuse `workflow.logRetentionDays` for workflow-owned checkpoint retention unless evidence requires a separate value; do not add speculative configuration.
- [x] R8. Cleanup supports dry-run/reporting through the existing `workflow clean` surface and is idempotent.
- [x] R9. Tests cover traversal/path confinement, active references, boundary age, malformed metadata, commit drift, and regeneration.

Non-goals: embeddings/vector search, cross-device sync, automatic deletion of operator-authored learnings, or a new public noun.

### Acceptance Criteria

```gherkin
Feature: Bounded trustworthy harness memory

  Scenario: Fresh checkpoint resumes
    Given a canonical checkpoint whose task, run, source commit, and referenced artifacts still match
    When `/sp:dev-run --continue` or next routing inspects it
    Then the recorded next action is eligible for resume

  Scenario: Stale checkpoint is ignored safely
    Given a checkpoint whose source commit or task status no longer matches
    When routing inspects it
    Then it reports the stale reason and falls through to the non-checkpoint route
    And it never resumes from stale state

  Scenario: Cleanup removes only expired terminal memory
    Given an expired terminal checkpoint, a recent checkpoint, and a checkpoint referenced by an active run
    When workflow clean applies the configured retention
    Then only the expired unreferenced checkpoint is deleted
    And dry-run reports the same candidate without deleting it

  Scenario: Indexed context declares freshness
    Given a generated context index
    When the repository source commit changes
    Then the freshness check marks the index stale until its existing producer regenerates it
```

### Q&A

**Q: Are checkpoints authoritative?** No. Task/feature files and persisted workflow state win. A checkpoint is an
advisory resume projection and must be rejected when it disagrees.

**Q: Should completed tasks keep a checkpoint?** Only if a consumer needs it. A decorative terminal line should be
removed rather than expanded. Canonical metadata is required for actual resumability checkpoints.

**Q: What can cleanup delete?** Expired, terminal, unreferenced, regenerable files under confined paths. It must never
delete task/feature authority, active artifacts, or operator-authored learnings.

**Q: Why reuse logRetentionDays?** Both are workflow-owned operational artifacts and there is no demonstrated need for
separate retention. One existing knob is the smallest coherent policy.

### Design

Use frontmatter on checkpoint Markdown so human-readable bodies and machine metadata stay together. Implement parsing/validation in the existing checkpoint/router owner and call it from resume/next routing. A checkpoint is advisory resumability state; task/feature files and persisted workflow state remain authoritative.

Add a small freshness header/sidecar through the existing indexed-context producer, keyed by source commit and generation time. Do not rewrite content ownership. Cleanup extends the existing `workflow clean` command/service with a checkpoint projection, uses the current retention days, checks active run references, and confines every candidate path before deletion.

Terminal done checkpoints may be omitted entirely if they have no resume consumer; prefer deletion/absence over preserving decorative one-line files.

### Plan

1. Inventory every checkpoint/context writer and reader and reconcile them with the documented convention.
2. Define the minimal versioned metadata schema and parser with invalid/stale reasons.
3. Update workflow/skill checkpoint writers to emit the contract or remove non-resumable decorative checkpoints.
4. Gate resume and next-router decisions through freshness validation.
5. Add source commit/time metadata to regenerable indexed-context outputs.
6. Extend existing workflow cleanup dry-run/apply logic for expired terminal checkpoints with active-reference and path-confinement guards.
7. Add focused tests for freshness, malformed data, active runs, retention boundary, traversal, idempotence, and regeneration.
8. Update checkpoint/context/run-log documentation and config comments.
9. Run targeted router/workflow tests, `bun run spur-check`, and CLI cleanup tests.

### Root Cause

Memory contracts have diverged by producer. `packages/config/src/index.ts` gives workflow logs a default 30-day
retention, while `config/workflows/task-pipeline.yaml` writes a one-line done checkpoint with no session/run id, phase,
next action, proof/source digest, commit, or freshness metadata. The Spur-dev references describe a richer YAML-frontmatter
Session Checkpoint Convention, but current writers/readers and cleanup do not enforce it consistently. `.spur/context`
indexes likewise have no uniform source-commit/time freshness contract.

Routing can therefore treat a file's presence as evidence that it is resumable/current. Cleanup can govern logs while
leaving checkpoint/index files indefinitely. The root cause is missing validation and lifecycle ownership at existing
file seams, not insufficient storage technology.

### Solution

Host-fallback reconciliation after the implement child timed out mid-verification (8 failing tests across 3 suites). One implementation defect: `cleanCheckpoints` confinement used `resolve()`, which never follows symlinks, so a symlink escaping `.spur/memory/sessions` would have been deleted through the link (R5); it now `realpath`s both the candidate and the sessions dir with a resolve fallback for missing paths (`packages/app/src/services/workflow-service.ts:873-895`). The remaining seven failures were test fixtures/wiring, fixed without weakening assertions: the canonical-terminal fixture now carries `status: done` as its title and terminal-checkpoint semantics require (`packages/app/tests/workflow/checkpoint-contract.test.ts:32-33`); the R6 active-run test shares ONE migrated in-memory db between the `RunDao.open` run and the service's `getDb` — previously the run existed only in a throwaway db the service could never see (`packages/app/tests/services/checkpoint-cleanup.test.ts:44-58,90-98`); the adapter-mirror test imports `rm` at module scope instead of the dead closure destructure, writes the owner-mismatch fixture under the queried WBS's checkpoint name so the owner guard (not absence) is what fires, and probes both inline-comma artifacts so the parity assertion proves both spellings parsed (`plugins/sp/tests/routing-checkpoint.test.ts:2,56,68-70,124-131`). Post-fix: checkpoint-contract + checkpoint-cleanup 24/24, routing-checkpoint 8/8, `bun run format` clean, `@gobing-ai/spur-app` typecheck exit 0.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `bun test packages/app/tests/workflow/checkpoint-contract.test.ts` → **16 pass / 0 fail** (parses canonical frontmatter: schema_version=1, session/run id, workflow, task/feature id, phase/status, digest, source_commit, generated/updated_at, next_action, artifacts; `packages/app/src/workflow/checkpoint-contract.ts`). |
| R2 | MET | `grep -n "schema_version" config/workflows/task-pipeline.yaml` → L658 single-line printf emits full canonical frontmatter (schema_version/session_id/run_id/task_wbs/phase/status/last_gate/source_commit/digest/generated_at/updated_at/next_action/artifacts); composition baseline re-emitted (composition-baseline.test.ts 19/19 within full gate). Legacy one-line writer replaced; decorative done line removed per Q&A. |
| R3 | MET | `bun test plugins/sp/tests/routing-checkpoint.test.ts` → **8 pass / 0 fail** ("owner mismatch is reported and ignored", "terminal status falls through to the non-checkpoint route", "commit drift … is stale", "missing referenced artifact is reported and ignored", "malformed frontmatter is never trusted"); live: `bun apps/cli/src/index.ts workflow clean --dry-run --json` → all 6 legacy checkpoints skipped `"malformed: not canonical checkpoint metadata (0711 R3/R6)"`. |
| R4 | MET | `bun test plugins/sp/hooks/context-hooks.test.ts` → **43 pass / 0 fail** incl. "stamp + read roundtrip", "checkContextFreshness classifies all staleness reasons" (`never stamped` / malformed / schema_version / missing source_commit / source commit changed / fresh), "a Write landing on a context index refreshes .freshness.json". Sidecar `.spur/context/.freshness.json` keyed by source_commit + generated_at; no second content store. |
| R5 | MET | `bun test packages/app/tests/services/checkpoint-cleanup.test.ts` → **9 pass / 0 fail** incl. "entries resolving outside the sessions dir are kept (R5 path confinement)" (symlink escape → realpath guard, `packages/app/src/services/workflow-service.ts:873-895`). |
| R6 | MET | Same suite: "checkpoints referencing an active run are kept (R6)", "malformed and non-terminal checkpoints are kept and reported, never deleted (R6)"; live CLI dry-run above shows 6 malformed legacy checkpoints kept+reported, 0 reclaimed. |
| R7 | MET | `grep -n logRetentionDays packages/config/src/index.ts` → L735 `default(30)`; workflow-service `cleanCheckpoints` doc L853 "same `workflow.logRetentionDays` knob", default 30; live CLI output `"checkpoints": { "retentionDays": 30, ... }`. No new config. |
| R8 | MET | Live: `bun apps/cli/src/index.ts workflow clean --dry-run --json` → `{ "checkpoints": { "retentionDays": 30, "dryRun": true, "reclaimed": [], "skipped": [6 × malformed], "failures": [] } }`; tests: "dry-run lists candidates without deleting (R7)", "re-running an exhausted cleanup is a no-op (R8 idempotence)". |
| R9 | MET | Suite names: confinement ("entries resolving outside the sessions dir"), active refs ("checkpoints referencing an active run are kept"), boundary ("boundary age is kept: strictly past the retention cutoff", "falls back to file mtime when updated_at is absent"), malformed (cleanup + routing + contract), commit drift (routing-checkpoint "commit drift"), regeneration (context-hooks producer-moment refresh). Totals: 16+9+8+43 = **76 targeted tests, 0 fail**. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
### References

- `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md` — I6 and Wave 4.
- `config/workflows/task-pipeline.yaml` — current one-line checkpoint writer.
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` — Session Checkpoint Convention.
- `plugins/sp/skills/spur-dev/references/execution-workflow.md`
- `plugins/sp/skills/spur-dev/references/execution-batch.md`
- `plugins/sp/scripts/stage-registry-adapter.ts` — checkpoint-aware next routing.
- `packages/config/src/index.ts` — `workflow.logRetentionDays`.
- `apps/cli/src/commands/workflow.ts` — existing clean surface.
- `packages/app/src/services/workflow-service.ts`
- `plugins/sp/hooks/context-session-start.ts`
- `plugins/sp/hooks/context-post-tool.ts`

### History

- 2026-08-28 — created from the approved harness comparison implementation lane; researched, decomposed, linked to A6, and passed the task-local readiness gate.
- 2026-08-29T21:50:28.081Z todo → wip (system)
- 2026-08-30T00:15:57.499Z wip → testing (system)
- 2026-08-30T00:15:57.753Z testing → done (system)
