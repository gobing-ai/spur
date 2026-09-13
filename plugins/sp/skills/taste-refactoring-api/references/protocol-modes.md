# Protocol-specific API review

## REST/HTTP mode

### Resource design
- Prefer noun-based resource paths for domain entities and collections.
- Use nesting when it communicates true ownership or scope; avoid deep path trees that mirror storage.
- Keep canonical IDs stable even if names or hierarchy labels change.
- Use custom action endpoints only when standard resource operations cannot express the intent cleanly.

### HTTP methods
- `GET` and `HEAD` are read-oriented and safe; do not hide state-changing behavior behind them.
- `PUT` should represent full replacement/upsert semantics where the client addresses the target and repeated identical requests have the same intended effect.
- `PATCH` should define a clear patch model; do not leave null/omitted/reset semantics ambiguous.
- `DELETE` should be idempotent in intended effect; define repeated-delete behavior consistently.
- `POST` is appropriate for creation under a collection and non-idempotent/custom actions; add idempotency support when safe retries are required.

### Status codes
Use status codes as protocol semantics, not decorative metadata. Favor the narrowest standard code that tells generic clients what happened. Common distinctions include:
- `200` successful response with content;
- `201` resource created, normally with a discoverable resource location;
- `202` accepted for asynchronous processing;
- `204` successful response without representation;
- `304` conditional request not modified;
- `400` malformed/invalid request when no more specific code applies;
- `401` missing/invalid authentication;
- `403` authenticated but not permitted;
- `404` target not found, including intentionally concealed unauthorized resources where appropriate;
- `409` state conflict;
- `412` failed precondition for conditional mutation;
- `413` request content too large;
- `415` unsupported media type;
- `422` syntactically valid content that cannot be processed under the API’s validation semantics, when this distinction is useful;
- `429` rate limited;
- `5xx` server-side inability to fulfill an otherwise valid request.

Do not create application-defined pseudo-status codes outside the HTTP status space.

### Error representation
For HTTP APIs, prefer a consistent machine-readable error envelope. RFC 9457 Problem Details is a strong default for new APIs when it fits the ecosystem. Keep problem `type`/application error identity stable, include actionable detail, and attach structured extensions only when clients need them.

### Conditional requests and concurrency
For mutation races, prefer explicit optimistic concurrency such as ETags / `If-Match`, version fields, or revision tokens. Do not silently implement last-write-wins when lost updates would matter.

## RPC / gRPC mode

- Prefer a small predictable set of standard methods for resource-oriented services before custom RPCs.
- Keep request/response messages explicit even when they currently contain one field; this preserves room to evolve.
- Use canonical status codes consistently; do not tunnel all errors through `UNKNOWN`/`INTERNAL`.
- Propagate deadlines. A server should know when a caller no longer cares about work.
- Define retry behavior only for operations that are safe to retry; coordinate with service config/client retry policies.
- Use streaming when it matches interaction semantics, not merely to avoid pagination.
- Avoid reusing a protobuf field number after removal; reserve removed numbers/names where appropriate.
- Prefer additive field evolution and treat semantic reinterpretation as a breaking change even when wire compatibility remains.

## GraphQL mode

- Design the schema around consumer-facing domain concepts and product workflows, not backend services.
- Prefer clear field names and strong types over generic `JSON` blobs.
- Treat nullability as a compatibility contract; tightening nullability can break clients and loosening it changes guarantees.
- Use input object types for evolving argument sets.
- Prefer connection/cursor pagination for unbounded collections when clients need stable traversal.
- Put side effects in mutations and name mutations by domain intent.
- Deprecate fields/arguments/input fields/enum values with reasons before removal; measure usage where possible.
- Prevent abusive query cost with depth/complexity/breadth controls, pagination limits, timeouts, and resolver-level authorization.
- Avoid N+1 resolver behavior with batching/data-loader patterns or equivalent backend aggregation.
- Remember that GraphQL errors can coexist with partial data; define which errors are expected domain outcomes versus exceptional execution failures.

## Event / webhook mode

- Define a stable event type and versioning strategy independent of internal producer class names.
- Use a consistent envelope with event ID, source, type, timestamp, subject/resource identity, and payload.
- Assume at-least-once delivery unless stronger guarantees truly exist; consumers need deduplication by event ID or domain key.
- Define ordering scope explicitly; never imply global ordering unless guaranteed.
- Document retry schedule, maximum attempts, dead-letter behavior, and retention.
- Sign webhooks, include replay protection, and rotate secrets safely.
- Make consumers tolerant of additive fields.
- Do not use events as disguised synchronous RPC responses when the caller needs an immediate result.

