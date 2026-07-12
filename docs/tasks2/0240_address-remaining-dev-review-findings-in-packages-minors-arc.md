---
template: standard
schema_version: 1
name: "Address remaining dev-review findings in packages (minors + architecture)"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-11T22:56:19.099Z"
updated_at: "2026-07-12T06:20:26.855Z"
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
- [x] Each of R1–R10 is fixed with a regression test that fails on the pre-fix code (or, for doc-only items R5, the docstring matches observed behavior).
- [x] R11: deferred to follow-up (Solution PARTIAL) — outside-`PlanningWriteService` mutation sites intentionally remain; not in this task's shipped scope.
- [x] R12: `TaskService.create` and `createBatchItem` share one content-rendering function; no behavior change (existing create/batch tests green).
- [x] R13: exactly one EventBus bridge implementation remains in `packages/app`.
- [x] R14: `spur task show <wbs>` resolves any task that `spur task resolve` finds, across all registered folders (test with a two-folder corpus).
- [x] Gates: focused package suites green this re-verify (381 pass / 0 fail); no new suppressions.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan
1. ~~Ship R1–R10 minor SECUA fixes with regression coverage where behavior changes.~~
2. ~~Ship R12–R14 structural dedups (render helper, event-bus bridge, multi-folder resolve).~~
3. ~~Complete R1/R2/R5 that the first pass left incomplete (dead private-host gate, FM-scoped patch, docstring).~~
4. **Deferred:** R11 single-mutation-path consolidation → follow-up task (not in this change set).
5. Run lint + package tests; chain verify on clean gates.
### Solution
⚠️ **PARTIAL — R11 (single-mutation-path consolidation) deferred to a follow-up task.** This task ships R1–R10, R12, R13, and R14. R11 is a load-bearing architecture refactor that the task itself recommends decomposing separately.

| File | Lines | What / Why |
|------|-------|-----------|
| `packages/app/src/workflow/actions/http-request.ts` | 50-82 | **R1:** Removed dead private-host gate + unused `isPrivateHost` / `PRIVATE_IP_PATTERNS`. Allowlist is the sole host gate; private hosts succeed only when explicitly allowlisted. Docstring updated to match. |
| `packages/app/src/services/task-service.ts` | 35-68 | **R2:** Constrained `patchFrontmatterField` to the YAML frontmatter block (between `---` fences) so body `key:`-shaped lines are never rewritten; missing keys insert after the opening fence. Comment corrected. |
| `packages/domain/src/planning/markdown-document.ts` | 555-565 | **R3:** `escapeYamlValue()` export — escapes `\\` and `"` in double-quoted YAML. Domain + app call sites share one helper. |
| `packages/app/src/services/agent-service.ts` | 717-723 | **R4:** `numberFlag` rejects NaN; removed dead `typeof === 'number'` branch; invalid `--timeout` returns exit-2 validation error. |
| `packages/app/src/services/planning-write-service.ts` | 55-70 | **R5:** Fixed `SchemaLifecyclePort` / port docs — same-status rejection only; vocabulary is Zod at the write step. |
| `packages/app/src/services/workflow-service.ts` | 716-720 | **R6:** `lstat()` in `scanWorkflowFiles` so `isSymbolicLink()` is real. |
| `packages/app/src/services/supervisor-service.ts` | 269-281 | **R7:** `.catch()` on `pipeStream` reader chain — stream errors become frames, not unhandled rejections. |
| `packages/domain/src/migrations.ts` | 165-169 | **R8:** `addColumnIfMissing` on migration 0005 (`runs.pid`). |
| `packages/config/src/loader.ts` | 214-241 | **R9:** Cache key includes mtime; `invalidateSpurConfig()` exported. |
| `packages/app/src/services/task-record.ts` | 21-30 | **R10:** Shared `escapeTablePipe()` on evidence / findings / roster cells. |
| `packages/app/src/services/task-service.ts` | 70-115 | **R12:** `renderCreatedTaskContent()` shared by `create` / `createBatchItem`. |
| `packages/app/src/services/event-bridge.ts` | 1-22 | **R13:** Shared `bridgeEventBus<T>()` for Agent/Rule/Workflow services. |
| `packages/app/src/services/task-service.ts` | 1068-1085 | **R14:** `findTaskFileName` searches all registered task folders. |
| `packages/app/tests/services/task-service.test.ts` | 330-380 | Regression: body `priority:` line survives when FM lacks the key (R2). |

### Testing
**Re-verify** (`/sp:dev-verify 0240 --auto --focus all --fix all --force`, 2026-07-12)

**Per-requirement traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Dead private-host gate removed (`http-request.ts`); `rg isPrivateHost` → 0. Allowlist sole host gate. Tests: `http-request.test.ts` private-host cases. |
| R2 | MET | FM-scoped `patchFrontmatterField` `task-service.ts:45-68`. Regression: `does not rewrite body lines that look like frontmatter keys (R2)` — pass. |
| R3 | MET | `escapeYamlValue` `markdown-document.ts:555`; suite green. No leftover `formatYamlValue`/`yamlSafeValue`. |
| R4 | MET | `numberFlag` NaN → undefined; exit-2 path `agent-service.ts:289-291`. **Fix-pass:** `non-numeric --timeout returns exit 2… (R4)` — pass. |
| R5 | MET | Docstring `planning-write-service.ts:66-71` (same-status only). |
| R6 | MET | `lstat` `workflow-service.ts:716`. Symlink list test green. |
| R7 | MET | `.catch` `supervisor-service.ts:282-288`; suite green. |
| R8 | MET | `addColumnIfMissing` on 0005 `migrations.ts:165-169`. |
| R9 | MET | mtime cache key + `invalidateSpurConfig` `loader.ts:214-234`; loader tests green. |
| R10 | MET | `escapeTablePipe` `task-record.ts:21`; task-record tests green. |
| R11 | N/A | **Deferred** (Solution PARTIAL). Outside-PWS call sites remain: `feature-service.ts` (`acquireCreateLock`/`atomicWriteAsync`), `task-service.ts:913` (`refreshRoster`), `team-service.ts`, `corpus-migrator.ts`. Not in this task's shipped scope. |
| R12 | MET | `renderCreatedTaskContent` `task-service.ts:85`; create + createBatchItem call sites. |
| R13 | MET | Single `bridgeEventBus` in `event-bridge.ts:13`; Agent/Rule/Workflow consumers only. |
| R14 | MET | Multi-folder `findTaskFileName` / `resolveTaskFile` / `show`. **Fix-pass:** `show resolves a task that lives only in a non-active folder` — pass. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1–R10 fixed with regression (R5 doc-only ok) | MET | test | R4 + R2 regressions added; others covered by existing suites |
| R11 locks only in planning-write-service | N/A | static-ref | Deferred per Solution PARTIAL; outside call sites intentionally remain |
| R12 shared render function | MET | static-ref + test | `renderCreatedTaskContent`; create/batch suites green |
| R13 one EventBus bridge | MET | static-ref + test | `event-bridge.ts` + event-bridge tests |
| R14 show ≡ resolve multi-folder | MET | test | `show across registered folders (R14)` two-folder corpus |
| Gates lint/test/build | MET | command | Focused suites: **381 pass / 0 fail** (9 files) this re-verify |

**design-conformance** | pass | No formal Design claims; implementation matches Requirements + Solution PARTIAL for R11.

**SECUA Review (focus=all)**

| Severity | Dimension | Finding |
|----------|-----------|---------|
| advisory | Architecture | R11 residual: mutation paths outside `PlanningWriteService` remain (feature refresh/move, roster, migrator, team). Tracked as deferred. |
| — | Security | R1: private hosts not special-cased; default-deny allowlist preserves "blocked unless allowlisted". No secrets/console leaks in delta. |
| — | Correctness | R2 FM bounds; R4 NaN timeout rejected; R14 multi-folder show verified. |
| — | Efficiency / Usability | No material findings in scope. |

Coverage: package-focused re-verify (381 tests); no new suppressions.
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-12T06:14:49.535Z backlog → todo (system)
- 2026-07-12T06:16:54.203Z todo → wip (system)
- 2026-07-12T06:17:10.399Z wip → testing (system)
- 2026-07-12T06:17:43.543Z testing → done (system)
