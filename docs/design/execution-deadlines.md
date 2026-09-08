---
feature: A21
status: accepted-design
updated_at: 2026-09-08
derived_from: [ADR-112, 01_PRD]
---

# Execution deadlines and unlimited jobs

This is the accepted target contract. Installed `ts-infra`, `ts-runtime`, and importer version
0.4.57 do not yet implement the complete contract. Public API additions below are design targets,
not callable APIs until the upstream tasks implement and verify them.

## Ownership

| Owner | Responsibility |
| --- | --- |
| `ts-infra` | Shared scheduler/queue execution policy, inherited deadlines, cancellation context, timeout lifecycle and consumer lease renewal. |
| `ts-runtime` | Native process deadline/cancellation, isolated process groups, termination escalation, pipe draining and truthful outcomes. |
| `ts-llm-jsonl-importer` | Observe cancellation at safe boundaries, finish/rollback active transactions and settle checkpoint work. |
| `ts-db` | Durable atomic queue claims, lease renewal/recovery and ownership-conditional terminal mutations. |
| Spur | Application defaults, legacy configuration translation, handler composition, CLI diagnostics and adoption through released packages. |

A scheduler callback that enqueues work has its own short execution scope. Its timeout does not
bound the queue job: carry the job policy with the durable enqueue and enforce it when claimed.
Direct scheduler callbacks and queue handlers reuse one internal execution mechanism. Existing
one-argument queue handlers remain source-compatible when an optional execution context is added.
The context supplies an abort signal, effective deadline and cancellation reason; no second workflow
engine or timeout framework is introduced.

## Timeout values and inheritance

The configuration property is `timeoutMs?: number | null`:

| Input | Meaning |
| --- | --- |
| Missing / `undefined` | Inherit the parent/default policy. |
| Positive finite integer | Millisecond deadline in this scope. |
| Explicit `null` | No deadline imposed by this scope. |
| Zero, negative, fractional, NaN, infinity, unsupported timer range | Reject before execution. |

YAML/JSON use `null`; CLI/environment inputs use `none` and normalize once. Do not use `-1`,
an additional enable flag, or `??` when resolving a nullable override. Native timer limits must be
validated or safely chunked by the owning runtime; no overflow to an immediate timer is allowed.

Resolution order: explicit invocation/job option → handler/consumer default → application default.
Upstream omission preserves existing unlimited execution; Spur retains its ten-minute default.
An unlimited inner scope cannot negate finite ancestor cancellation. The effective finite deadline
is the earlier applicable ancestor/local deadline, not a fresh full budget at every layer.

For history, omitted source limits inherit an explicitly propagated job policy. Therefore an
unlimited history job does not silently restore a ten-minute child/source timer. An explicit
`--source-timeout` still bounds that source; `--source-timeout none` removes its local deadline,
subject to any finite parent. Per-source and whole-chain ceilings remain different scopes.

## Spur compatibility and configuration

Use upstream-validated `bootstrap.scheduler.timeoutMs` as the configured-job default and
`bootstrap.scheduler.jobs[].timeoutMs` for per-job overrides. Queue consumers receive the effective
per-attempt policy through the native enqueue contract. Completion-triggered refresh uses the same
queue policy API and the history handler's application default; no second scheduler is added.

Explicit canonical options, including null, beat legacy environment controls. When canonical
configuration is absent, preserve the existing inputs:

- Configured job: `SPUR_SCHEDULER_TIMEOUT_<NAME>_MS` → `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS` → 600,000 ms.
- Completion refresh: `SPUR_HISTORY_REFRESH_TIMEOUT_MS` → 600,000 ms; the custom-job global does not widen it.
- Source import: explicit CLI value → propagated history job policy → 600,000 ms for standalone calls.
- Termination grace: `SPUR_SCHEDULER_KILL_GRACE_MS` → 5,000 ms, resolved once and passed to actual native termination.

Legacy environment `none` maps to null. Invalid legacy environment values retain their documented
safe fallback; malformed explicit CLI/canonical configuration fails with a usage/configuration
error. Help defaults are rendered from the application constant, not repeated literals. Resolve
the daemon configuration once; injected environment is authoritative. Recovery observes the same
attempt policy/ownership as execution. Persist effective policy with queued work so a restart or
different consumer does not reinterpret an in-flight attempt under changed environment.

## Cancellation and process cleanup

Expiry requests cancellation and records a timeout reason. It does not mean the promise stopped.
Await cooperative handler settlement, or native child termination, before releasing the execution
slot/exclusion key or permitting normal retry. If a handler ignores cancellation, keep it observable
as cancelling and retain ownership while the worker lives; do not report successful cancellation.
The infrastructure cannot hard-kill arbitrary in-process JavaScript. Hard deadlines for blocking
SQLite or uncooperative work require the existing child process boundary.

`ts-runtime` handles normal exit, timeout, external abort, spawn failure and signals distinctly.
On Unix it must signal the owned child group, escalate to SIGKILL after the configured grace, and
await termination/output cleanup. Test leader exit before descendants, inherited pipes, and a
TERM-resistant descendant. Do not cancel escalation merely because the group leader exited while
owned descendants remain. Non-Unix implementations must report their supported containment contract
without pretending negative-PID signaling works there. Process-local timeout and supplied cancellation
must compose under one native termination path; Spur must not arm a competing watchdog.

Importer cancellation checks happen before starting further asynchronous work/writes and between
bounded batches. In-flight transaction work must commit consistently or roll back before cancellation
rejects; only completed checkpoints survive. A cancellation cannot interrupt synchronous SQLite
mid-call, so the parent process watchdog remains the hard fallback. No background writes may occur
after the importer promises cancellation has settled.

## Renewable queue ownership

Execution duration and ownership lifetime are independent. Retain finite visibility/lease expiry
even for unlimited execution. Each atomic claim receives a fresh attempt token and expiry; renewal,
completion, failure and retry mutations compare that token. A lost attempt cannot acknowledge a new
one. Put these operations in `ts-db`; the native consumer owns renewal and expiry-driven recovery.

Renew while execution or cancellation cleanup is active; stop renewal on confirmed settlement or
loss of ownership. Another consumer recovers only expired ownership. Lease loss aborts the old
execution and fences its queue mutations, but cannot make arbitrary external side effects exactly
once. Handlers remain idempotent. Do not classify all processing rows as orphaned at daemon startup
or fail an unlimited row solely by age. Replace Spur's startup/periodic age-only sweep with the
native ownership contract; keep enqueue coalescing and history exclusion behavior.

Choose renewal cadence from the visibility interval with enough headroom for transient delay;
tests inject short intervals and clock control. DB contention may prevent renewal, so lease-loss
handling must be explicit and tested. A finite execution deadline plus cleanup can be shorter than
the lease, but unlimited execution must not be implemented by setting lease expiry to infinity.
Claim/migration changes remain additive; verify existing pending/processing row handling and prevent
mixed old consumers from mutating fenced attempts during rollout. Upgrade/drain old consumers before
enabling the new lease mode; do not claim unfenced old binaries can safely coexist.

## Shutdown and observability

Unlimited removes only automatic execution expiry. Manual cancellation, crashes, and shutdown
remain distinct. Preserve the bounded shutdown default; provide explicit drain-to-completion through
the existing drain policy for operators who choose to wait. While draining, keep lease renewal alive.
On a bounded drain expiry, do not release still-running work as though cleanup completed.

Use existing queue/process events and bounded error details for effective deadline/unlimited status,
elapsed time, cancellation reason and cleanup outcome. Shell subcommand output is never a whole-job
success verdict. Raw commands, environment values and sensitive payloads do not enter new telemetry.

## Verification and delivery

Four deliverables: native process containment; cooperative importer cancellation; reusable
infrastructure deadline/lease execution; Spur adoption. Each owns implementation, focused tests,
docs and its repository's full applicable gates. Runtime and importer work can be reviewed
independently; infrastructure depends on the runtime contract; Spur adoption depends on all three
and a released compatible version. No publishing is included in this planning approval.

Required evidence includes two consumers with one long/unlimited job beyond several lease intervals;
worker disappearance and stale acknowledgement; finite sibling timeout; cancellation before retry;
manual cancellation and drain-to-completion; a nested TERM-resistant child holding temporary SQLite;
lock reacquisition after process cleanup; no post-settlement importer writes; checkpoint resume;
legacy options, strict parsing, explicit null and finite ancestors. Real-data lock incidents remain
unproven unless separately reproduced. Existing 65 passing tests are baseline evidence only.

For cross-repository work, these Spur tasks are the dependency/acceptance tracking records. Execute
upstream edits under the upstream checkout's instructions and harness; attach commit SHA and test
commands/results to the Spur task. Do not create dummy Spur source edits for a diff gate. The source
diff must be verified against the owning upstream repository. No upstream files are changed by this
planning operation.
