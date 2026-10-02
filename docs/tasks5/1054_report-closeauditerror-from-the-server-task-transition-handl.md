---
schema_version: 1
name: Report closeAuditError from the server task transition handler
status: todo
template: issue
created_at: 2026-10-02T20:15:07.141Z
updated_at: "2026-10-02T20:45:36.274Z"
feature_id: D62

---

## 1054. Report closeAuditError from the server task transition handler

### Background

Review finding F5 from task 1051 (1051 ## Review, 2026-10-02): the CLI reports `closeAuditError` (`apps/cli/src/commands/task.ts:680,1258`) but the server transition handler drops it (`packages/app/src/services/task-transition.ts:99-101`). The asymmetry means server-driven transitions lose the same close-audit failure signal AC3 of 1051 deliberately surfaced for inline closes (handler reports bookkeepingError with replay guidance at `apps/server/src/modules/task/handlers.ts:101-115`). Pre-existing, out of 1051 scope; natural symmetry follow-up.

### Requirements

- R1: Server-driven task transitions surface `closeAuditError` with task identity (wbs, target status, error) and the same replay guidance pattern the CLI uses, symmetric with 1051 AC3's handler treatment of bookkeepingError.
- R2: The transport DTO stays unchanged (log-and-continue pattern per 1051 AC3) unless the oRPC contract owner decides otherwise.

### Acceptance Criteria

- AC1: A handler-level test injects a close-audit failure and asserts the server log/error path carries wbs, target status, error, and replay guidance; the transition outcome itself is unchanged.
- AC2: Existing `apps/server/tests/modules/task/handlers.test.ts` suite stays green (27 pass at 1051 review re-run).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Approach — mirror the 1051 R3 bookkeepingError handler block verbatim** (`apps/server/src/modules/task/handlers.ts:112-118`):

```ts
if (guarded.kind === 'transitioned' && guarded.result.closeAuditError !== undefined) {
    ctx.logger.error(
        `task ${input.wbs}: failed to record done close audit fields after transition to ${input.toStatus}: ${guarded.result.closeAuditError} ` +
            `(task file is committed; replay the same terminal transition, e.g. \`spur task record ${input.wbs} --transition ${input.toStatus}\`, to repair)`,
        { wbs: input.wbs, toStatus: input.toStatus },
    );
}
```

Access is `guarded.result.closeAuditError` — same object as `bookkeepingError` (`TransitionOutcome`, `task-transition.ts:297`); only the field name differs. The 1051 R3 comment block above the existing `if` should be extended by one sentence rather than duplicated: both post-commit audit signals now report through the same logger.

**Non-goals (drift guards):**
- Transport DTO unchanged (`{ok, data:{wbs, status}}`) — same contract as 1051 R3; the signal is log-only.
- Never throw, never alter the transition outcome; the status write stands.
- CLI behavior untouched (`task.ts:680,:1258` already report this field).
- One handler edit only; do not touch `task-transition.ts` (the producer is correct — verified: it sets the field at `:297` for unforced closes).

### Plan

1. Add a handler test in `apps/server/tests/modules/task/handlers.test.ts`: mock `ctx.transitionTask` to resolve `{ kind: 'transitioned', result: { ..., closeAuditError: '<detail>' } }`, spy `ctx.logger.error`, assert the message carries wbs, target status, the detail, and replay guidance, and the returned data shape is unchanged.
2. Extend the 1051 R3 comment sentence as described in Design.
3. Focused: `(cd apps/server && bun test tests/modules/task/handlers.test.ts)` (existing suite = 27 pass baseline) → full `bun run spur-check`.

### Root Cause

Verified HIGH 2026-10-02: producer sets the field (`task-transition.ts:281-297`, unforced close reconciliation), CLI consumes it (`apps/cli/src/commands/task.ts:680,:1258`), and `grep closeAuditError apps/server/src/modules/task/handlers.ts` returns zero references — the oRPC handler drops it by omission. The parallel 1051 R3 treatment of `bookkeepingError` (`handlers.ts:112-118`) proves the intended pattern; the field was simply missed when that pattern landed.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Pattern to mirror: 1051 R3 handler block, `apps/server/src/modules/task/handlers.ts:103-118` (bookkeepingError → logger.error with replay guidance).
- Producer: `packages/app/src/services/task-transition.ts:281-297` (`reconcileDoneCloseAudit` → `closeAuditError` on unforced close).
- CLI consumer (reference behavior): `apps/cli/src/commands/task.ts:680,:1258`.
- Baseline suite: `apps/server/tests/modules/task/handlers.test.ts` (27 pass at 1051 review re-run).
- Origin: 1051 review finding F5 (P4); session verification pass 2026-10-02 (HIGH confidence).

### History
