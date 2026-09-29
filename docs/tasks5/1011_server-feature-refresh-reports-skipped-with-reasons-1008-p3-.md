---
schema_version: 1
name: Server feature refresh reports skipped with reasons (1008 P3-5)
status: backlog
template: feature-impl
created_at: 2026-09-29T18:18:17.810Z
updated_at: "2026-09-29T19:28:48.447Z"
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

- **R1 (server parity)** — extend the oRPC `feature.refresh` contract in `packages/contracts` so the response includes `skipped: Array<{ id: string; reason: string }>`, exactly mirroring CLI R4; pass `r.skipped` through in the handler (`apps/server/src/modules/feature/handlers.ts:70-73`); regenerate OpenAPI so typed clients pick it up. Keep `reason` an open `string` — task 1009 may add a third reason value (`unclosed-code-fence`); do not constrain to an enum (avoids cross-task coupling).

Detail: contract DTO only — no domain types in transport (repo rule; ADR-021 thin transports). The response field is additive and backward-compatible.

### Acceptance Criteria

- [ ] AC1 — Server `feature.refresh` response includes `skipped: [{id, reason}]` with CLI-identical shape; covered by a server-side test (fixture feature missing its Tasks section → one skipped entry) and regenerated OpenAPI committed (req: R1)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Implementation steps:

1. `packages/contracts` — add `skipped` array to the feature.refresh output schema (`{ id: string; reason: string }[]`).
2. `apps/server/src/modules/feature/handlers.ts:70-73` — `const { tasksUpdated, skipped } = await ctx.featureService().refresh(); return { ok: true as const, data: { rebuilt: tasksUpdated, skipped } };`
3. Regenerate OpenAPI (repo build step); web client types flow from the generated client.
4. Server test: seed a feature without a Tasks section plus a task roster; call refresh through the contract handler; assert `skipped` carries `{id, reason}`.
5. Same-commit doc touch: `docs/04_DESIGN.md` refresh response contract — add `skipped`, note it mirrors CLI R4.

Constraints (anti-drift):

- Do NOT modify `FeatureService.refresh()` — it already returns `skipped`.
- Do NOT alias reason values; keep `reason` an open string (task 1009 may extend the vocabulary).
- Additive field only — no breaking change, no BREAKING CHANGE footer.
- `ac_altitude: task-local` is already set — do not remove.

Verify: targeted server test in `apps/server`; `bun run test-cf` if the server gate covers the module; `bun run spur-check` at the quality boundary.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Review answer: `.spur/run/785c3ca9-fa8e-4ea8-b75e-81ccac2db600-review-answer.txt` (P3-5; Dimension 3 note)
- Code anchors: `apps/server/src/modules/feature/handlers.ts:70-73` · `apps/cli/src/commands/feature.ts:386/:392` · task 1008 R4 shape (`skipped: [{id, reason}]`)
- Tasks: 1008 (source), 1009 (reason vocabulary) · Feature: F91

### History
