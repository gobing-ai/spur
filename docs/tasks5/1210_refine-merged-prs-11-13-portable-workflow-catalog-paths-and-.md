---
schema_version: 1
name: "Refine merged PRs 11-13: portable workflow catalog paths and source references"
status: done
template: issue
created_at: 2026-10-15T05:31:07.220Z
updated_at: "2026-10-15T05:47:13.953Z"

ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close
---

## 1210. Refine merged PRs 11-13: portable workflow catalog paths and source references

### Background

The operator requested merge #12, #11, retarget #13 to main, merge #13, then comprehensive review and refinement. All three merged. The merged local gate exposed absolute workflow display paths under symlinked catalog roots; current documentation also describes the pre-extraction service layout. Scope is this review repair only.

### Requirements

- [x] R1. Workflow catalog entries retain root-relative paths for direct and symlinked catalog roots.
- [x] R2. Update the architecture owner to describe the extracted service collaborators and repair current source references affected by the split.
- [x] R3. Record the combined review and fresh verification evidence without changing public APIs or discarding the unpublished local main commit.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Catalog paths remain relative through symlinks (req: R1)
Given a workflow catalog reached through a directory symlink
When the catalog is scanned
Then nested workflow paths are root-relative and metadata is preserved

Scenario: AC2 — Current source references reflect the extraction [docs-only] (req: R2)
Given the merged service and CLI module layout
When the architecture and affected current contracts are read
Then they name the extracted collaborators and existing implementation anchors

Scenario: AC3 — Combined review has fresh verification evidence (req: R3)
Given all three merged PRs and the review repair
When the final local gate and contract checks complete
Then the review report records their outcomes and each finding disposition
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Keep public services and transports unchanged. In `packages/app/src/services/workflow-catalog-scan.ts`, compute display paths relative to the already-canonical scan root with the path standard library. Extend `packages/app/tests/services/workflow-catalog-scan.test.ts` with a symlink-root case. Repair current descriptions and references in `docs/03_ARCHITECTURE.md`, `docs/design/` and the receipt source reference in `scripts/commands/fleet-e2e.ts`. Preserve historical baseline descriptions. Store the review in `docs/reports/2026-10-15-pr-11-12-13-review.md`.

### Plan

- [x] Fix canonical catalog-relative paths and prove direct/symlink behavior.
- [x] Repair architecture and current source references.
- [x] Run the project gate, review the repair, and record verification.

### Root Cause

The scan resolves the root through realPath, but computes display paths against the original rootPath. A symlink changes the prefix, so startsWith fails and the absolute canonical path escapes into the display DTO. The refactor moved this implementation unchanged and added a test that exposes it on macOS.

### Solution

`packages/app/src/services/workflow-catalog-scan.ts:60` now computes display paths with `relative(realPath, fullPath)`, preserving catalog-relative names when the input root is a symlink. `packages/app/tests/services/workflow-catalog-scan.test.ts:56` adds an explicit directory-symlink regression, independent of the host temp directory spelling.

`docs/03_ARCHITECTURE.md:186` describes private operation collaborators and host callbacks. Current references in `docs/design/task-deprecated-status.md:43`, `docs/design/feature-deprecated-status.md:52`, `docs/design/planning-record-contracts.md:51`, `docs/design/decision-observability-and-adoption.md:172` and `scripts/commands/fleet-e2e.ts:572` point at the extracted implementations. Historical baseline statements remain historical.

`docs/reports/2026-10-15-pr-11-12-13-review.md:12` records merge receipts and the combined review. The three service facades retain identical public signatures. No public noun, verb, option, storage format, dependency or accepted lifecycle rule changed. The unpublished local main commit remains on main.

probe: `bun /tmp/spur-catalog-cli-probe.ts` invokes the source-local CLI main with a throwaway project, in-memory DB and symlinked catalog. Observed exit 0, valid=true, source=project and path=nested/probe.yaml. The existing CLI workflow-list suite also passed 7/7 as a consumer check.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/workflow-catalog-scan.ts:60` computes canonical-root-relative paths; catalog tests pass 7/7 and source-local CLI symlink probe returns exit 0, valid=true, path=nested/probe.yaml. |
| R2 | MET | `docs/03_ARCHITECTURE.md:190` describes private collaborators; current lifecycle, verdict, doctor and fleet receipt references resolve to the extracted implementation. |
| R3 | MET | `docs/reports/2026-10-15-pr-11-12-13-review.md:12` records merge receipts and review dispositions. Public facade signatures match baseline; git log main preserves 49c724c5b. Full isolated suite and post-check pass; feature gate passes. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Catalog paths remain relative through symlinks (req: R1) | MET | test | `packages/app/tests/services/workflow-catalog-scan.test.ts:56` explicit directory-symlink regression passes; 7 catalog tests and 7 CLI list tests pass. CLI main probe in a throwaway project confirms valid metadata and nested/probe.yaml. |
| Scenario: AC2 — Current source references reflect the extraction [docs-only] (req: R2) | MET | static-ref | `docs/03_ARCHITECTURE.md:190` describes the collaborators; `docs/design/task-deprecated-status.md:77` names the new section-write owner, and source anchors were re-read. |
| Scenario: AC3 — Combined review has fresh verification evidence (req: R3) | MET | command | bun run test followed by bun run test-post-check exits 0 with 10,990 tests passing, canonical coverage certified and post-check rules passing; bun run spur-check-feature exits 0 with 10 repository tests and 28 heavy tests. Durable receipts: .spur/memory/evidence/1210-verification.log and .spur/memory/evidence/1210-feature-verification.log. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — task 1210 and merged PRs 12, 11, 13
Scope: merged range e8a0f83a4..a4cc1b3b5 and the task 1210 repair. All six review dimensions covered; full report at `docs/reports/2026-10-15-pr-11-12-13-review.md:12`.

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P2 (major) | correctness | Canonical traversal was compared to a noncanonical catalog root, producing absolute display paths on symlink roots. Relative paths now use the canonical traversal root; direct and explicit symlink-root tests pass 7/7. | `packages/app/src/services/workflow-catalog-scan.ts:60` | RESOLVED |
| 2 | P3 (minor) | architecture | Current architecture and selected contract/receipt anchors described pre-extraction service ownership. Updated to the extracted collaborators and verified source locations. Historical baseline descriptions preserved. | `docs/03_ARCHITECTURE.md:186` | RESOLVED |

Public facade signatures are identical to baseline (TaskService 19, WorkflowAppService 18, AgentService 11). The one-line path repair retains metadata and layer tagging; its symlink regression uses a directory junction on Windows to avoid a symlink-privilege dependency. No unrelated refactor or dependency change.

Verdict: PASS

### References

- Operator request in this session: merge #12, then #11, retarget #13 to main and merge, then review and refine the combined result.
- https://github.com/gobing-ai/spur/pull/12
- https://github.com/gobing-ai/spur/pull/11
- https://github.com/gobing-ai/spur/pull/13
- `docs/reports/2026-10-15-pr-11-12-13-review.md:12` — merge receipts, review scope and findings.

### History

- 2026-10-15T05:31:52.239Z todo → wip (system)
- 2026-10-15T05:47:13.313Z wip → testing (system)
- 2026-10-15T05:47:13.839Z testing → done (system)

### Notes

This is an operator-requested, standalone post-merge review repair, not a new feature. No feature_id was invented or top-level feature created. The structural check reports the existing L4.missing-feature-id advisory; it does not fail task readiness. The unrelated unpublished scheduler commit 49c724c5b stays on local main.

