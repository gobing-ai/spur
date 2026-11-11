---
schema_version: 1
name: Residuals from 1322
status: done
template: standard
created_at: 2026-11-10T19:52:54.958Z
updated_at: "2026-11-11T17:51:01.841Z"

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1326-verdict.json
---

## 1326. Residuals from 1322

### Background

Source task: 1322 (feature H16) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:2de0e234 — packages/app/src/services/quality-gate.ts:580: `readWorkspaceGraph` expands only `dir/*`-suffixed globs and literal dirs; a `workspaces: ["packages/**"]` declaration (yarn-classic shape) silently yields an empty graph, so `lightScope`'s shared-package refusal never fires for that repo shape — the R3 full-suite fallback is silently unavailable there (a shared-package change would be scoped to its own workspace's tests, missing dependents). The pipeline's once-per-task full gate at the quality boundary still certifies every PASS (recheck green/fallback falls through), and this repo's root declares the supported `apps/*`/`packages/*` shape, so 1322's own runs are unaffected; the supported-shape contract is documented at the reader. Hardening candidate: an unsupported glob shape should refuse the tier (fallback) instead of classifying nothing.

### Requirements

- [x] R1. `readWorkspaceGraph` marks a `workspaces` glob shape it cannot expand (any `*` pattern that is not `dir/*`, e.g. yarn-classic `packages/**`) as `unsupported` on `WorkspaceGraph`, and `lightScope` refuses the light tier with a fallback rationale for such a graph instead of classifying nothing.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

1. Add `unsupported?: string` to `WorkspaceGraph`; detect unsupported shapes in `readWorkspaceGraph` (packages/app/src/services/quality-gate.ts) and return the rationale.
2. In `lightScope`, set `fallback` from `graph.unsupported` before the per-file shared-package scan.
3. Regression tests in packages/app/tests/services/quality-gate-affected-scope.test.ts (unsupported shape alone + mixed list); fail-proof by stashing the src fix.

### Solution

- packages/app/src/services/quality-gate.ts:530 — `WorkspaceGraph.unsupported?: string` carries the rationale for a `workspaces` shape the reader cannot expand.
- packages/app/src/services/quality-gate.ts:602-608 — `readWorkspaceGraph` detects the unsupported shape (any `*` pattern that is not `dir/*`, including the degenerate `/*`) and returns the empty graph with the rationale instead of silently expanding nothing.
- packages/app/src/services/quality-gate.ts:724-728 — `lightScope` refuses the tier from `graph.unsupported` before the per-file shared-package scan, so the fallback names the real cause.
- packages/app/tests/services/quality-gate-affected-scope.test.ts:143,170 — regression tests for the unsupported shape alone and in a mixed list.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/tests/services/quality-gate-affected-scope.test.ts:143 — yarn-classic `packages/**` marks the graph `unsupported` and lightScope returns the full-suite fallback instead of classifying nothing; bun test in packages/app: 17 pass / 0 fail, and both new tests fail with the src fix stashed |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Disposition |
| --- | --- | --- |
| P3 | WBS collision discovered during closure: `docs/tasks5/` held two `1326_*` files (this residual and a done history-anatomy task), and the locator's first-prefix-match sent every `spur task … 1326` write to the unrelated done task. `spur task residual settle` allocated ids without a collision check. | Worked around for this closure by temporarily hiding the colliding file (name-only move, restored byte-identical). Root cause — settle's id allocation — is a new finding, not fixed here. |
| P4 | No findings in the fix itself; the unsupported-shape predicate is a pure prefix/`endsWith` check with tests for the standalone and mixed-list cases. | Accepted. |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-11T17:50:31.853Z backlog → todo (system)
- 2026-11-11T17:50:32.179Z todo → wip (system)
- 2026-11-11T17:51:01.795Z wip → done (system)

