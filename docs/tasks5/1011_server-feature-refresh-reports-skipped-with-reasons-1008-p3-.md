---
schema_version: 1
name: Server feature refresh reports skipped with reasons (1008 P3-5)
status: backlog
template: feature-impl
created_at: 2026-09-29T18:18:17.810Z
updated_at: "2026-09-29T19:53:33.539Z"
feature_id: F91

ac_altitude: task-local
---

## 1011. Server feature refresh reports skipped with reasons (1008 P3-5)

### Background

Origin: task 1008 review finding P3-5 (verbatim): "Server surface (`apps/server/src/modules/feature/handlers.ts:70`) still drops `skipped` silently — out of R4's stated CLI scope; noting so it is a conscious deferral, not an oversight." Dimension 3 adds: "the silent-skip phenomenon persists on that surface until the contract adds the field."

Current handler (verified, `apps/server/src/modules/feature/handlers.ts:70-73`):

```ts
refresh: os.feature.refresh.handler(async () => {
    const { tasksUpdated } = await ctx.featureService().refresh();
    return { ok: true as const, data: { rebuilt: tasksUpdated } };
}),
```

Key fact: `FeatureService.refresh()` ALREADY returns `skipped` — the CLI consumes it today (`apps/cli/src/commands/feature.ts:386` passes `skipped: result.skipped` into JSON output; `:392` prints human lines). Task 1008 R4 froze the shape: `skipped: [{id, reason}]`. So this task is a transport-contract field plus a one-line handler passthrough — no service change.

### Requirements

- **R1 (server parity)** — extend the `feature.refresh` output schema in `packages/contracts/src/feature.ts:219-230` with `skipped: z.array(z.object({ id: z.string(), reason: z.string() }))`, mirroring CLI 1008 R4; pass `skipped` through in `apps/server/src/modules/feature/handlers.ts:70-73`. `reason` stays an open string (1009 extends the vocabulary to four values).

Detail: transport DTO only (ADR-021). Additive, backward-compatible. OpenAPI is generated at runtime (`generateOpenApiSpec`, served at `/openapi.json` by `apps/server/src/bootstrap.ts:32` / `worker-app.ts:56`) — there is no committed spec to regenerate. No `apps/web` consumer of `feature.refresh` exists (verified), so no client change.

### Acceptance Criteria

- [ ] AC1 — `apps/server/tests/modules/feature/handlers.test.ts` refresh test: the `makeCtx` stub returns `skipped: [{ id: 'A', reason: 'missing-tasks-section' }]` and the handler result carries `data.skipped` equal to it alongside `rebuilt`; the contract output schema accepts the shape (req: R1)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-29T19:53:33.003Z

- **Q: Seed a real corpus in the server test?** Closed: no. Skip classification is `FeatureService` behavior already covered in `packages/app/tests/services/feature-service.test.ts` (1008 R4, 1009); the server's job is passthrough, which the existing stubbed-service handler test pattern proves.
- **Q: Regenerate/commit OpenAPI?** Closed: not applicable — spec is generated per request from the contract.
- **Q: Design doc?** Closed: the contract file is the SSOT for this transport shape; add a JSDoc line on the schema. `docs/04_DESIGN.md` has no refresh entry.
- **Q: Order vs 1009?** Closed: independent (open `reason` string).

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

1. `packages/contracts/src/feature.ts:219-230` — add `skipped` to the refresh output `z.object`, with a JSDoc line: features skipped during the Tasks-region pass, `{id, reason}`, mirrors CLI `feature refresh --json`.
2. `apps/server/src/modules/feature/handlers.ts:70-73` — `const { tasksUpdated, skipped } = await ctx.featureService().refresh(); return { ok: true as const, data: { rebuilt: tasksUpdated, skipped } };`
3. `apps/server/tests/modules/feature/handlers.test.ts` — stub at :36 returns `skipped`; extend the `refresh handler returns rebuilt count` test (:133) to assert `data.skipped`.

Constraints (anti-drift):

- Do NOT modify `FeatureService.refresh()`.
- Keep `reason` an open string; no enum.
- Additive only; no BREAKING CHANGE footer. Out of scope: the server refresh is unscoped (no `featureId`/`--all` gate like CLI 0625) — note only.
- `ac_altitude: task-local` stays.

Verify: `(cd apps/server && bun test tests/modules/feature/handlers.test.ts tests/openapi.test.ts)`; `bun run test-cf`; `bun run spur-check`.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Review answer: `.spur/run/785c3ca9-fa8e-4ea8-b75e-81ccac2db600-review-answer.txt` (P3-5)
- Code: `packages/contracts/src/feature.ts:219-230` · `apps/server/src/modules/feature/handlers.ts:70-73` · `apps/server/tests/modules/feature/handlers.test.ts:36,133` · `apps/server/src/openapi.ts` (runtime spec) · `apps/cli/src/commands/feature.ts:378-400`
- Tasks: 1008 (R4 shape), 1009 (reason vocabulary) · Feature: F91

### History
