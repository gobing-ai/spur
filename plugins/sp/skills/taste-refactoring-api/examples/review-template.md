# API Review Template

## Diagnosis

**Consumer job:**

**Main contract problem:**

**Impact:**

**Target direction:**

## Highest-impact refactors

| Priority | Refactor | Why it matters | Compatibility |
|---|---|---|---|
| P0 |  |  | additive / risky / breaking |
| P1 |  |  |  |
| P2 |  |  |  |

## Proposed contract

### Before

```http
# or OpenAPI / proto / GraphQL SDL / event JSON
```

### After

```http
# proposed contract
```

## Error model

```json
{
  "type": "https://api.example.com/problems/example",
  "title": "Example problem",
  "status": 409,
  "detail": "...",
  "instance": "urn:request:..."
}
```

## Collection behavior

- Pagination:
- Ordering:
- Filtering:
- Sorting:
- Limits:
- Consistency between pages:

## Retry / concurrency behavior

- Idempotent by protocol semantics:
- Idempotency key/deduplication:
- Timeout/deadline:
- Retryable failures:
- Optimistic concurrency/preconditions:

## Security review

- Authentication:
- Object authorization:
- Function authorization:
- Property authorization:
- Resource-consumption limits:
- SSRF/third-party API considerations:

## Migration plan

1. Add:
2. Dual-support/adapter:
3. Instrument legacy usage:
4. Migrate owned consumers:
5. Deprecate:
6. Remove after exit criteria:

## Verification

- [ ] Schema/spec lint
- [ ] Compatibility diff
- [ ] Contract tests
- [ ] Authorization tests
- [ ] Error-shape tests
- [ ] Pagination boundary tests
- [ ] Retry/idempotency tests
- [ ] Concurrency tests
- [ ] Rate-limit/load tests
- [ ] Trace/log correlation test
