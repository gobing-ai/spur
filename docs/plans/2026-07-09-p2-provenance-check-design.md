# P2 Design Options: Provenance Check for Task `done` Transition

## Problem

Tasks can be marked `done` without ever passing through `task-pipeline.yaml`. The dogfood bypass (2026-07-09) exploited this: 6 tasks were implemented directly and marked `done` via CLI status updates, with Solution/Testing/Review sections filled post-hoc. No `task-pipeline.yaml` run exists for any of them.

## Existing Infrastructure (verified)

- **`task_run_links` table** (`packages/domain/src/dao/task-run-link-dao.ts`): records WBS → run_id links with a `kind` field.
- **`kind='pipeline'` rows**: inserted by `WorkflowService.maybeLinkPipelineRun()` (`workflow-service.ts:384`) when a `task-pipeline.yaml` run carries `vars.wbs`. Idempotent per runId.
- **`kind='lifecycle'` rows**: inserted by `LifecycleAdapter` (`lifecycle-adapter.ts:122`) on status transitions via the lifecycle workflow.
- **`TaskRunLinkDao.listByWbs(wbs, limit)`**: returns all links for a WBS, newest first.
- **`task-check.ts` L4**: already does traceability checks (feature_id edges, parent_wbs, dependencies, AC coverage, rollup, readiness). Adding a provenance check here is natural.

The data exists. The question is where to enforce and how hard to gate.

## Design Options

### Option A: L4 Warning in `spur task check` (soft gate)

Add an L4 check in `task-check.ts`: when `status === 'done'`, query `TaskRunLinkDao.listByWbs(wbs, 10)` for a `kind='pipeline'` row. If none exists, emit a warning:

> "Task is `done` but no `task-pipeline.yaml` run is recorded in `task_run_links` (kind='pipeline'). The task may have been implemented outside the execution workflow."

**Enforcement:** Warning only. `spur task check` passes with warnings unless `--strict`. `spur task update 0239 done` still succeeds (the transition goes through the lifecycle adapter, which calls `spur task check` but doesn't hard-block on warnings).

**Pros:**
- Zero friction for legitimate edge cases (hotfixes, doc-only tasks, operator override).
- Surfaces the gap visibly without blocking.
- Trivial to implement (~15 lines in `runL4` + a DAO call).

**Cons:**
- Easy to ignore — the prior bypass would still succeed, just with a warning.
- `--strict` mode would catch it, but operators rarely use `--strict` for routine transitions.

### Option B: Hard Gate in `spur task record` (block `done`)

Add a provenance check in `TaskService.record()` (`task-service.ts:536`): before transitioning to `done`, query `task_run_links` for a `kind='pipeline'` row. If none exists, refuse the transition with an error:

> "Cannot transition 0239 to `done`: no `task-pipeline.yaml` run recorded. To override, use `spur task update 0239 done --no-lifecycle` (bypasses the record service) or run the pipeline first."

**Enforcement:** Hard block on the `record → done` path. The `--no-lifecycle` escape hatch exists but is explicit and visible in git history.

**Pros:**
- Actually prevents the bypass — the prior incident could not have happened.
- The escape hatch (`--no-lifecycle`) is auditable: it skips the lifecycle adapter entirely, so no `kind='lifecycle'` row is written either, making the bypass visible in `task_run_links` (absence of both kinds).

**Cons:**
- Breaks the workflow for legitimate direct-implementation tasks (doc-only, trivial fixes, operator-directed bypasses).
- `record()` is the pipeline's own transition path — blocking it there could trap the pipeline itself if the link insertion failed (idempotency bug, DB error). Need a fallback.
- Doesn't catch `spur task update 0239 done --no-lifecycle` (which bypasses `record()` entirely).

### Option C: Hard Gate in Lifecycle Adapter + Escape Hatch with Audit (recommended)

Add the provenance check in the **lifecycle adapter** (`lifecycle-adapter.ts`), which is the single choke point for ALL status transitions (both `record()` and `update` go through it unless `--no-lifecycle`). When transitioning to `done`:
1. Query `task_run_links` for a `kind='pipeline'` row for this WBS.
2. If found → allow.
3. If not found → check for a `PROVENANCE_OVERRIDE` env var or a `--bypass-provenance` flag.
4. If override present → allow, but insert a `kind='provenance_bypass'` row into `task_run_links` with `run_id: 'manual'`, making the bypass auditable.
5. If no override → deny with error: "No pipeline run recorded for 0239. Run `spur workflow run .spur/workflows/task-pipeline.yaml --vars '{\"wbs\":\"0239\"}'` first, or set `SPUR_PROVENANCE_OVERRIDE=1` to bypass (recorded)."

**Enforcement:** Hard gate at the single choke point. Bypass is possible but always auditable (the `kind='provenance_bypass'` row is a permanent record).

**Pros:**
- Catches both `record()` and `update` paths (unless `--no-lifecycle`, which is already an explicit escape).
- The bypass is auditable — `spur task check` and `spur feature check` can surface `kind='provenance_bypass'` rows.
- The error message tells the operator exactly how to do it right (run the pipeline) or bypass explicitly (with audit).
- Doesn't trap the pipeline itself: the pipeline's `record` step inserts the `kind='pipeline'` row BEFORE transitioning to `done`, so the check passes.

**Cons:**
- More complex implementation (~40 lines in lifecycle adapter + new link kind + env var check).
- The `SPUR_PROVENANCE_OVERRIDE` env var is a global bypass — could be set in `.envrc` and forgotten. Consider a per-task flag instead.
- `--no-lifecycle` still bypasses everything. But `--no-lifecycle` is already a loud escape hatch (no lifecycle row written), so it's auditable by absence.

### Option D: `spur feature check` Gate (feature-level, not task-level)

Instead of gating individual task transitions, gate the **feature** `done` transition. In `feature-check.ts`, add an L4 check: when any task linked to the feature has `status=done` but no `kind='pipeline'` row in `task_run_links`, emit an error finding. The feature cannot be marked `done` until all tasks have provenance.

**Enforcement:** Feature-level. Individual tasks can still be marked `done` directly, but the feature can't close until provenance is verified.

**Pros:**
- Doesn't interfere with task-level workflow flexibility.
- Catches the problem at the feature gate, which is the natural review point.
- Aligns with the dogfood P3 proposal (feature-level dogfood requirement).

**Cons:**
- Allows the bypass to happen at the task level — the feature check catches it later, but the tasks are already `done` in the file system.
- Doesn't help for features with a single task (the task IS the feature).
- Requires querying all tasks for a feature and checking each one's provenance — more expensive.

## Recommendation

**Option C** (lifecycle adapter hard gate + auditable bypass). It's the only option that catches the bypass at the right level (before `done` is written) while preserving an explicit, auditable escape hatch. The `kind='provenance_bypass'` row makes manual transitions visible in the same table that records pipeline runs — `spur task check` and `spur feature check` can surface these as warnings.

**Fallback if operator prefers minimal complexity:** Option A (L4 warning) + make `--strict` the default for `spur task check` when called from the lifecycle adapter's `done` transition. This gives a hard gate without new link kinds or env vars.

## Implementation Sketch (Option C)

```typescript
// lifecycle-adapter.ts, in the transition guard for → done
const links = await taskRunLinkDao.listByWbs(ref.id, 20);
const hasPipelineRun = links.some(l => l.kind === 'pipeline');
const hasBypassOverride = process.env.SPUR_PROVENANCE_OVERRIDE === '1';

if (!hasPipelineRun && !hasBypassOverride) {
    return { ok: false, reason: `No pipeline run recorded for ${ref.id}. Run the pipeline first, or set SPUR_PROVENANCE_OVERRIDE=1 to bypass (recorded).` };
}

if (!hasPipelineRun && hasBypassOverride) {
    await taskRunLinkDao.insert({
        id: createId('trl'),
        wbs: ref.id,
        run_id: 'manual',
        kind: 'provenance_bypass',
        created_at: new Date().toISOString(),
    });
}
```

## Open Questions for Operator

1. Should the gate be hard (Option C) or soft (Option A)?
2. Should the bypass be env var (`SPUR_PROVENANCE_OVERRIDE=1`) or per-command flag (`--bypass-provenance`)?
3. Should `spur task check` surface `kind='provenance_bypass'` rows as warnings or errors?
4. Should this apply to ALL task templates, or only `feature-impl` (excluding `brainstorm`, `design`, etc.)?
