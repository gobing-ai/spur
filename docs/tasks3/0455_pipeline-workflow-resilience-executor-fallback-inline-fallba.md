---
template: meta
schema_version: 1
name: "Pipeline workflow resilience: executor fallback, inline-fallback, copy sync"
description: ""
status: backlog
type: meta
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-08-06T21:25:24.666Z"
updated_at: "2026-08-06T21:33:05.942Z"
---

## 0455. Pipeline workflow resilience: executor fallback, inline-fallback, copy sync

### Background

Task 0454 (pipeline performance optimization) was implemented via direct session work after the pipeline's `agent.run` implement step failed on all 4 available executors (all out-of-token). The manual implementation revealed a process gap: `apps/cli/config/workflows/task-pipeline.yaml` is a copy of `config/workflows/task-pipeline.yaml` but lives in a gitignored directory (`apps/cli/config`). Changes to the source are not automatically synced, and the copy silently diverges. During 0454, the copy was manually `cp`'d 3 times with no divergence detection.

Total estimated waste: ~2 min per sync + risk of CI divergence. Severity: S2 (nice to fix).

### Requirements

- [ ] **R1. Pipeline workflow copy sync: single source of truth for task-pipeline.yaml.**

  **Issue.** `apps/cli/config/workflows/task-pipeline.yaml` is a copy of `config/workflows/task-pipeline.yaml` but lives in a gitignored directory. Changes to the source are silently stale in the copy. During 0454, the copy was manually synced 3 times with no divergence detection.

  **Acceptance**
  - Either remove the gitignored copy and resolve the path at runtime, or add a sync mechanism that alerts the operator when copies diverge.
  - The `spur workflow run` CLI resolves the pipeline path from the source of truth regardless of `cwd`.
  - No silent divergence possible.

### Acceptance Criteria

```gherkin
Feature: Pipeline workflow copy sync

  @core
  Scenario: R1 — pipeline workflow path resolves from source of truth
    Given the source pipeline at config/workflows/task-pipeline.yaml
    When the CLI resolves task-pipeline.yaml for a workflow run
    Then it uses the canonical path (not a gitignored copy)
    And no operator action is required to keep copies in sync
```

### Q&A

**Q1: Why not just remove the gitignored copy?**  
The copy exists because `spur workflow run` may be invoked from the CLI package's cwd. The fix is to resolve the path relative to the project root, not the CLI's cwd. Once that's done, the copy can be removed.

**Q2: Should `apps/cli/config/` be removed from gitignore?**  
No — the entire `apps/cli/config/` directory is gitignored because it's a build artifact. The fix is to resolve the pipeline path at runtime from the source of truth, not to un-ignore the copy.

**Q3: Is this urgent?**  
No (S2). The copy only diverges when the pipeline YAML changes, which is infrequent. The risk is that a CI run or another operator uses the stale copy. A simple `spur task check`-style divergence check would be sufficient.

### Design

## R1 — Pipeline path resolution from source of truth

**Evidence:** `apps/cli/config/workflows/` is gitignored. Manual sync required 3 times during 0454.

**Fix:** In `spur workflow run` CLI, resolve the pipeline path relative to the project root (not the CLI's cwd). Use `config/workflows/` as the canonical path. Remove the copy from `apps/cli/config/` or add a `spur workflow sync` verb.

**Target location:** `apps/cli/src/commands/workflow.ts` (path resolution).

**Expected impact:** Prevents silent divergence. Saves ~2 min per sync.

### Plan

- [ ] R1: Resolve pipeline path from source of truth; remove or sync gitignored copy.
- [ ] Gate: `spur workflow validate` on task-pipeline (canonical path); `bun test`; `bun run autofix && bun run spur-check`.

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Session: 0454 implementation (this session, 2026-08-06)
- Pipeline runs: dc9a86b1, f121f798, 08006b75, 9e314218
- Partial artifacts: `.spur/run/*-implement-partial.md` (4 files)
- Pipeline source: `config/workflows/task-pipeline.yaml`
- Pipeline copy: `apps/cli/config/workflows/task-pipeline.yaml` (gitignored)
- Executor config: `.spur/config.yaml` → `agent.executors`
- Task 0454: `docs/tasks3/0454_pipeline-performance-optimization-model-latency-task-size-pr.md`
- Commit: `bc452024` (0454 implementation)

### History

### Notes

**Evidence:** `apps/cli/config/workflows/task-pipeline.yaml` is gitignored (`apps/cli/config` in `.gitignore`). Changes to `config/workflows/task-pipeline.yaml` must be manually `cp`'d. During 0454, the copy was synced manually 3 times (R1, R2, final). No check exists to detect divergence.

**Root cause:** The copy exists for `spur workflow run` when invoked from the CLI package's cwd, but the gitignore means CI and other operators never see the updated copy.

**Time cost:** ~2 min overhead per sync + risk of silent divergence. S2.
