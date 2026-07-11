---
template: standard
schema_version: 1
name: "Address remaining dev-review findings in packages (minors + architecture)"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-11T22:56:19.099Z"
updated_at: "2026-07-11T22:58:21.926Z"
---

## 0240. Address remaining dev-review findings in packages (minors + architecture)

### Background
A full `/sp:dev-review packages --focus all` (2026-07-11) swept `packages/{app,config,contracts,domain}` across SECUA + architecture dimensions. Five major findings were fixed in that pass (lock O_EXCL mutual exclusion, feature `--field status` lifecycle-bypass guard, http header validation on resolved values, atomic `assignTask` write, `$`-pattern-safe template replacement). This task carries the **remaining findings** — ten minor SECUA items and four architecture candidates — that were reported but deliberately not fixed inline (minor severity, or a refactor too large for a review fix pass).

**Grouping guidance:** R1–R10 are independent, small, low-risk fixes (each ≤ ~20 lines + a test). R11–R14 are structural refactors; R11 is the load-bearing one (single-mutation-path consolidation) and should be designed before implementation. Decomposing this task into a "minors sweep" sub-task and one sub-task per architecture candidate is a reasonable split.
### Requirements
**Minor SECUA findings (independent, small fixes — each with a regression test)**

- R1. `packages/app/src/workflow/actions/http-request.ts:232` — the private-host gate is unreachable: the allowlist gate at line ~224 already returned unless host/origin is allowlisted, so the condition `!allowlist.has(...)` is always false past it. Remove the dead gate or restructure the gate order so the private-host check carries real weight; keep the documented security property ("private hosts blocked unless explicitly allowlisted") true either way.
- R2. `packages/app/src/services/task-service.ts:43` (`patchFrontmatterField`) — when the key is absent from frontmatter, the multiline regex can match a `key:`-shaped line in the rendered body and patch the wrong line. Constrain matching to the frontmatter block (between the `---` fences). Also fix the stale comment: it says "append before the closing `---` fence" but the code inserts after the opening fence.
- R3. `packages/domain/src/planning/markdown-document.ts:503` (`yamlSafeValue`) and `packages/app/src/services/task-service.ts:63` (`formatYamlValue`) — both wrap values in double quotes without escaping embedded `"` or `\`, producing invalid YAML for such values, and they are near-duplicate implementations. Escape properly and consolidate into one domain-owned helper both callers import.
- R4. `packages/app/src/services/agent-service.ts:742` (`numberFlag`) — a non-numeric `--timeout` becomes `NaN` and is forwarded to the runner instead of failing with a clear message. Reject `NaN` with an exit-2 validation error (mirror the `--mode` validation style). The `typeof value === 'number'` branch is dead (flags are `string | boolean`) — remove it.
- R5. `packages/app/src/services/planning-write-service.ts:66` (`SchemaLifecyclePort` docstring) — claims it "validates that the target status is in the canonical vocabulary" but the code only rejects same-status transitions (Zod at step 4 does the vocabulary check). Fix the docstring to match the code.
- R6. `packages/app/src/services/workflow-service.ts:742` (`scanWorkflowFiles`) — `stat()` follows symlinks, so `rootStat.isSymbolicLink()` is never true and the `realpath` branch is dead. Use `lstat` if symlink handling is intended, or delete the branch.
- R7. `packages/app/src/services/supervisor-service.ts:263` (`pipeStream`) — the `reader.read()` promise chain has no rejection handler; a stream error surfaces as an unhandled rejection. Add a `.catch` that stops the pump (optionally recording a final stderr frame).
- R8. `packages/domain/src/migrations.ts:165` — migration `0005_spur_cli_run_pid` (`ALTER TABLE runs ADD COLUMN pid`) lacks the `addColumnIfMissing` guard that `0007` got; if the ALTER succeeds but the journal insert fails, the migration wedges on retry (duplicate column). Add `addColumnIfMissing: { table: 'runs', column: 'pid' }` and fold the `builtInAddColumnGuard` special case away.
- R9. `packages/config/src/loader.ts:102` (`spurConfigCache`) — the module-level cache never invalidates, so a long-lived server never sees `.spur/config.yaml` edits. Either export an invalidation hook the server can call, key the cache on file mtime, or document the restart requirement where the server consumes the loader.
- R10. `packages/app/src/services/task-record.ts:188` (`renderTesting`) — evidence cells are newline-flattened but `|` is not escaped, so a pipe in evidence text breaks the markdown table. Escape pipes the way `renderTasksTable`/`renderRosterTable` already do (shared helper preferred).

**Architecture candidates (structural; design before implementing)**

- R11. Single-mutation-path consolidation (review candidate C1, major): `PlanningWriteService` declares itself the single mutation path (planning-write-service.ts:2) and `locks.ts:5` says the lock module is reachable only through it, yet `FeatureService.refresh`/`applyMove` (feature-service.ts:225, 395 — atomic writes without entity locks; direct `acquireCreateLock` import) and `TaskService.refreshRoster` (task-service.ts:878) write corpus files around it, skipping Zod validation, event emission, and per-entity locking. Add the missing verbs to `PlanningWriteService` (a marker-region/roster regeneration verb that deliberately skips `updated_at`/events if that behavior is wanted, and a create-lock-scoped batch/cascade verb for `move`), route the three call sites through them, and make the lock module import-private to the write service again.
- R12. Collapse `TaskService.create` / `createBatchItem` duplication (C2): task-service.ts:331 vs :712 are ~80-line near-duplicates of the same template-render → frontmatter-patch → legacy-skeleton-fallback flow. Extract a shared pure `renderTaskContent(params)` used by both; unit-test it directly.
- R13. Deduplicate the EventBus bridge (C3): `rule-service.ts:195`, `workflow-service.ts:704`, and `agent-service.ts:128` each hand-roll the same unsafe-cast on/off/emit bridge. Extract one shared `bridgeBus<T>()` helper (app-layer utility) and use it in all three.
- R14. Unify task-resolution semantics (C4): `TaskService.resolveTaskFile` searches only the active folder while `TaskService.resolve` and `TeamService.resolveTaskFile` search all registered folders — so `spur task show <wbs>` can fail for a task that `spur task resolve` finds. Decide the intended semantics (all-folders recommended), implement one shared resolver, and use it from all three sites.
### Acceptance Criteria
- [ ] Each of R1–R10 is fixed with a regression test that fails on the pre-fix code (or, for doc-only items R5, the docstring matches observed behavior).
- [ ] R11: `rg "acquireCreateLock|acquireEntityLock|atomicWriteAsync" packages/app/src` shows no call sites outside `planning-write-service.ts`; feature refresh/move and task refresh-roster behavior is unchanged (existing tests green).
- [ ] R12: `TaskService.create` and `createBatchItem` share one content-rendering function; no behavior change (existing create/batch tests green).
- [ ] R13: exactly one EventBus bridge implementation remains in `packages/app`.
- [ ] R14: `spur task show <wbs>` resolves any task that `spur task resolve` finds, across all registered folders (test with a two-folder corpus).
- [ ] Gates: `bun run lint`, `bun run test`, `bun run build` all pass; no new suppressions.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
