---
schema_version: 1
name: "Govern checkpoint and indexed-context freshness and retention"
status: todo
template: issue
created_at: 2026-08-28T23:03:05.726Z
updated_at: "2026-08-28T23:09:19.386Z"
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

- [ ] R1. Define a versioned checkpoint metadata contract containing session/run id, workflow, task/feature id, phase/status, proof or source digest when available, source commit, generated/updated time, next action, and referenced artifacts.
- [ ] R2. Replace the task-pipeline's one-line terminal checkpoint with the canonical contract and align actual writers/readers with the existing Session Checkpoint Convention.
- [ ] R3. Before resume or next-router use, validate schema, owner identity, terminal/current status, source commit/digest freshness, and referenced artifact existence; stale/invalid checkpoints are reported and ignored, never silently trusted.
- [ ] R4. Add equivalent generation metadata to indexed-context outputs sufficient to detect source-commit/time staleness without embedding repository content in a second store.
- [ ] R5. Extend existing workflow cleanup ownership to delete expired terminal checkpoints only when no active run references them and the resolved path is confined to `.spur/memory/sessions`.
- [ ] R6. Never delete authoritative task/feature files, active-run artifacts, or cumulative context learnings automatically. Context cleanup removes only regenerable indexes/ledgers covered by the contract.
- [ ] R7. Reuse `workflow.logRetentionDays` for workflow-owned checkpoint retention unless evidence requires a separate value; do not add speculative configuration.
- [ ] R8. Cleanup supports dry-run/reporting through the existing `workflow clean` surface and is idempotent.
- [ ] R9. Tests cover traversal/path confinement, active references, boundary age, malformed metadata, commit drift, and regeneration.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
