# Daily API Review Checklist

Use this for a fast pre-merge, pre-release, or refactoring pass.

## Consumer and domain
- [ ] The consumer job is clear in one sentence.
- [ ] The API models domain concepts, not database/service internals.
- [ ] Resource/type ownership and identity are clear.
- [ ] There is one obvious path for the common use case.

## Semantics
- [ ] Operations use protocol-native semantics.
- [ ] No state-changing behavior is hidden behind a safe/read operation.
- [ ] Retry/idempotency behavior is explicit for mutations.
- [ ] Long-running work is modeled asynchronously when needed.

## Schema
- [ ] Names and casing are consistent.
- [ ] Required/optional/nullable/default behavior is explicit.
- [ ] IDs, timestamps, durations, money, enums, and booleans are consistent.
- [ ] Writable fields are explicitly whitelisted.
- [ ] Partial-update semantics are unambiguous.

## Collections
- [ ] Potentially unbounded collections are paginated.
- [ ] Ordering is deterministic.
- [ ] Page size/batch size is bounded.
- [ ] Cursor/page token semantics are opaque and documented.
- [ ] Filtering/sorting is constrained and predictable.

## Errors
- [ ] Protocol status/code matches failure semantics.
- [ ] Machine-readable error identity is stable.
- [ ] Validation errors point to actionable fields/arguments.
- [ ] Retryable vs non-retryable failures are distinguishable.
- [ ] Errors leak no stack traces, secrets, or sensitive internals.

## Compatibility
- [ ] Every public change is classified as additive / risky / breaking.
- [ ] No existing field/operation changed meaning silently.
- [ ] Defaults and ordering did not change accidentally.
- [ ] Deprecation has replacement + migration guidance.
- [ ] Usage telemetry exists before legacy removal.

## Security
- [ ] Object-level authorization is checked for client-controlled IDs.
- [ ] Function/action-level authorization is checked.
- [ ] Property-level read/write authorization is checked.
- [ ] Expensive operations and payloads are bounded.
- [ ] SSRF-capable URL/destination inputs are restricted.
- [ ] Sensitive business flows have abuse controls.

## Reliability and operations
- [ ] Timeouts/deadlines are defined.
- [ ] Retries cannot duplicate side effects unexpectedly.
- [ ] Concurrency/lost-update behavior is intentional.
- [ ] Request/trace IDs are propagated.
- [ ] Rate limit/quota behavior is consistent if applicable.
- [ ] Logs/metrics can identify operation, status, latency, and error type.

## Documentation and tests
- [ ] Contract/spec matches implementation.
- [ ] At least one success example is correct.
- [ ] Important failures are documented.
- [ ] Compatibility/schema diff is checked in CI where possible.
- [ ] Authorization, pagination, retry/idempotency, and error cases are tested.

## Ship decision
- [ ] A new client can use the API without learning backend internals.
- [ ] A transient network failure will not create surprising corruption.
- [ ] Existing consumers have a safe path through the change.
