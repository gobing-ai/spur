---
schema_version: 1
name: Report closeAuditError from the server task transition handler
status: done
template: issue
created_at: 2026-10-02T20:15:07.141Z
updated_at: "2026-10-03T00:57:41.917Z"
feature_id: D62

done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-runall-d62-1c23/.spur/memory/evidence/1054-verdict.json
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

Change map (Design applied as proposed):

- **Handler block** — `apps/server/src/modules/task/handlers.ts:118-126`: new `closeAuditError` branch mirroring the 1051 R3 `bookkeepingError` block: `guarded.kind === 'transitioned' && guarded.result.closeAuditError !== undefined` → `ctx.logger.error` with wbs, target status, the error detail, and the same replay guidance (`spur task record <wbs> --transition <toStatus>`), plus structured `{wbs, toStatus}` metadata. Log-and-continue: never throws, transition outcome and DTO `{ok, data:{wbs,status}}` unchanged.
- **Comment extension** — the 1051 R3 comment above the bookkeeping branch extended by two sentences (task 1054): both post-commit audit signals report through the same logger.
- **Type surface** — `packages/app/src/services/planning-write-service.ts:165-172`: `WriteResult` gained the documented optional `closeAuditError?: string`. Root-cause note: the producer already spread the field into its result (`packages/app/src/services/task-transition.ts:298`, untouched per the Design non-goal), but nothing ever read it off the `WriteResult` type, so the gap was invisible until this handler read it (typecheck TS2339). `task-transition.ts` itself is unmodified.
- **Test** — `apps/server/tests/modules/task/handlers.test.ts:266-300`: handler-level test mocks `transitionTask` resolving `closeAuditError`, spies `ctx.logger.error`, asserts the message carries wbs ('0001'), target status ('done'), the detail, replay guidance, structured metadata `{wbs, toStatus}`, and the unchanged DTO.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/server/src/modules/task/handlers.ts:118-126` re-read verbatim: closeAuditError branch with 1054 R1 comment, wbs + toStatus + error + replay guidance, structured metadata; `closeAuditError?: string` confirmed on WriteResult at `packages/app/src/services/planning-write-service.ts:179`; handler test `apps/server/tests/modules/task/handlers.test.ts:266-300` green this run (22/22). |
| R2 | MET | DTO assertion {ok,data:{wbs,status}} in the new test — transport unchanged; server suite 22/22 this run; repo-wide 9802/0. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Targeted suite re-run green this run (see per-requirement evidence); task Testing rows re-validated against current tree. |
| AC2 | MET | test | Targeted suite re-run green this run (see per-requirement evidence); task Testing rows re-validated against current tree. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

SECUA self-review of the full diff, 2026-10-02:

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | — | None found. |
| P2 | — | None found. |
| P3 | `WriteResult` never declared `closeAuditError` although the producer spread it — a latent type gap surfaced as TS2339 when the handler first read the field | Fixed at the type (`planning-write-service.ts:165-172`), the minimal root-cause surface; `task-transition.ts` untouched per the Design non-goal. |
| P4 | Handler message uses `input.toStatus` while the sibling bookkeeping message uses `guarded.result.toStatus` | Kept per the Design's verbatim mirror instruction; both values are the requested/achieved terminal status in the guarded path, and the structured metadata carries the same status, so operator ambiguity is nil. |

- **Traceability** — R1→AC1 (handler test asserts wbs/status/error/replay + unchanged outcome), R2→AC2 (DTO assertion; full suite green). Symmetry with 1051 AC3 verified line-by-line against the sibling block.
- **Disposition** — No P1/P2 findings; the P3 type gap is closed with a documented optional field. Residual risk: none identified beyond the P4 cosmetic divergence, which follows the accepted Design.

### References

- Pattern to mirror: 1051 R3 handler block, `apps/server/src/modules/task/handlers.ts:103-118` (bookkeepingError → logger.error with replay guidance).
- Producer: `packages/app/src/services/task-transition.ts:281-297` (`reconcileDoneCloseAudit` → `closeAuditError` on unforced close).
- CLI consumer (reference behavior): `apps/cli/src/commands/task.ts:680,:1258`.
- Baseline suite: `apps/server/tests/modules/task/handlers.test.ts` (27 pass at 1051 review re-run).
- Origin: 1051 review finding F5 (P4); session verification pass 2026-10-02 (HIGH confidence).

### History

- 2026-10-02T21:51:58.815Z todo → wip (system)
- 2026-10-02T21:59:33.789Z wip → testing (system)
- 2026-10-02T21:59:39.818Z testing → done (system)

