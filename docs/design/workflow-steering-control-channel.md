# Cross-process workflow steering control channel

**Status:** proposed design only; not implemented or approved for runtime use.
**Scope:** future remote/detached steering for workflow actions.
**Boundary:** ADR-035 keeps the observability EventBus read-only.

## Required command record

A durable command must contain:

- globally unique `commandId`;
- `runId` and persisted `actionId`;
- expected workflow/action state plus compare-and-swap version;
- operation (`continue`, `note`, `retry`, or `abort`);
- bounded, pre-persistence redacted payload;
- authenticated actor and authorization decision;
- creation/deadline timestamps and a monotonic channel sequence.

The durable acknowledgement must retain command identity, actor, accepted/rejected status, observed
state/version, reason, processing timestamp, and the redacted effective note when applicable.

## Processing invariants

1. A unique constraint on `commandId` provides exactly-once acknowledgement under retries.
2. One transactional claim compares target state/version, authorizes the actor, and assigns ordered
   processing ownership.
3. A lease with expiry permits crash recovery without concurrent consumers executing one command.
4. State mutation and acknowledgement commit atomically, or an idempotent recovery operation completes
   them from the same command record.
5. Retry is rejected unless the action declares an idempotent retry policy and has no committed-success
   boundary.
6. Abort authority is explicit and cancellation reaches the live process group through its registered
   process identity.
7. Notes are data, never instructions to bypass workflow guards or mutate completed history.
8. Audit retention and access control apply equally to accepted and rejected commands.

## Proposed storage/transport seam

Use a workflow-domain command table or append-only log plus a per-run consumer. Do not use the
in-process EventBus as the transport: it has no authentication, ordering across processes, durable
acknowledgement, or crash recovery. A future implementation requires its own ADR, schema migration,
threat model, and detached-run integration tests before the CLI exposes remote steering.

## Explicit non-goals for task 0365

- no polling a JSONL observability trace for commands;
- no unauthenticated socket/stdin relay to detached children;
- no replaying commands against completed actions;
- no remote retry without an explicit idempotency declaration.
