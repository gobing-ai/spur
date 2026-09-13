# API Refactoring — Operational Playbook

This playbook is a practical synthesis of established API standards and widely used design guidance. It is not tied to one vendor or architectural style.

## 1. Start from the consumer job

Before naming endpoints, write the job a caller is trying to complete. Good APIs optimize the caller’s mental model, not the server’s package structure.

Questions:
- What must the caller know before invoking this operation?
- What is the smallest successful outcome?
- What failures can the caller actually recover from?
- What parts of the workflow are synchronous vs asynchronous?
- Which data belongs in one consistency boundary?

## 2. Model stable domain concepts

Prefer stable nouns/types with durable identifiers. Do not expose internal database tables, ORM entities, queue names, deployment topology, or microservice ownership unless those are themselves the public domain.

Refactoring signal: if a database rename forces an API rename, the contract is too coupled to storage.

## 3. Prefer protocol-native semantics

### HTTP
Use method semantics and status codes as intended. RFC 9110 defines safe methods and idempotent methods; the retry characteristics of operations should align with those semantics.

### RPC / gRPC
Use explicit request/response messages, canonical status codes, deadlines, and predictable method naming. Treat semantic compatibility separately from wire compatibility.

### GraphQL
Use the schema/type system as the contract. Field names, nullability, input types, pagination, and deprecation are all compatibility decisions.

### Events/webhooks
Treat event type, envelope, delivery guarantees, ordering, retries, and deduplication as the contract.

## 4. Resource-oriented by default, actions when necessary

For resource APIs, model collections and resources first. Standard operations should handle the majority of use cases. Use custom actions when intent does not fit create/get/list/update/delete semantics cleanly.

Example:
- Prefer `POST /orders` over `POST /createOrder`.
- Prefer `POST /orders/{id}:cancel` or a cancellation subresource over inventing an unsafe `GET /cancelOrder?id=...`.

Custom actions are not inherently bad; arbitrary inconsistency is.

## 5. Make schemas explicit

Define:
- required vs optional;
- nullable vs absent;
- default behavior;
- value constraints;
- enum semantics and unknown-value strategy;
- identifiers and formats;
- timestamps/time zones;
- money/decimal representation;
- read-only vs write-only/server-generated fields.

Avoid generic maps/JSON blobs unless open-ended data is truly part of the domain.

## 6. Design partial update deliberately

A partial update needs an explicit model for:
- omitted field = unchanged?
- null = clear value, invalid, or unchanged?
- empty collection = clear all or no change?
- nested object = merge or replace?

For HTTP, choose and document a patch format rather than relying on framework deserialization quirks.

## 7. Collections need contracts too

For any collection that can grow:
- paginate from day one;
- define deterministic ordering;
- bound page size;
- prefer opaque cursors/tokens when traversal must remain stable and implementation-flexible;
- document filter and sort grammar;
- decide whether total counts are exact, estimated, expensive, or omitted;
- define what happens if items are inserted/deleted between pages.

Adding pagination later can be behaviorally breaking because existing clients may assume a full collection response.

## 8. Errors should be actionable

An error contract should answer:
- What category of failure occurred?
- Is the request malformed, unauthenticated, unauthorized, conflicting, rate limited, temporarily unavailable, or permanently invalid?
- Which field/value is wrong?
- Can the caller retry? When?
- What stable code/type can software branch on?

For new HTTP APIs, RFC 9457 Problem Details is a strong standard envelope when it fits the ecosystem.

Do not expose stack traces, SQL messages, internal hostnames, secrets, or raw downstream errors.

## 9. Design for retries

Network ambiguity means the client may not know whether a mutation succeeded.

Use one or more of:
- naturally idempotent methods/operations;
- client-chosen resource IDs;
- idempotency keys for retry-safe creation/action requests;
- deduplication records keyed by caller + idempotency key + request fingerprint;
- operation resources for asynchronous work.

If using an `Idempotency-Key` header, note that the IETF specification is still an Internet-Draft as of this skill’s research date, so treat the exact standardization status accordingly.

## 10. Handle concurrent writes explicitly

When lost updates matter, use optimistic concurrency:
- HTTP ETag + `If-Match`;
- resource revision/version fields;
- compare-and-set preconditions.

A failed precondition should be distinguishable from malformed input.

## 11. Long-running work should look long-running

If work can exceed normal request latency or has meaningful progress/cancellation:
- return an accepted/operation response quickly;
- expose operation status;
- make polling bounded and cache-friendly where possible;
- support cancellation if useful;
- define terminal success/failure shape;
- separate operation identity from resulting resource identity.

## 12. Evolve additively

Prefer:
- add optional request fields;
- add response fields that tolerant clients ignore;
- add new operations;
- add a new version only for true contract breaks.

Be cautious with:
- enum expansion for generated/exhaustive clients;
- changing defaults;
- narrowing validation;
- changing sort order;
- changing error identities;
- changing nullability;
- switching sync operations to async without migration.

## 13. Deprecate with evidence

A deprecation needs:
- replacement behavior;
- deprecation date;
- target removal date or policy;
- usage telemetry;
- owner/contact path;
- migration examples;
- client communication.

Do not keep every version forever, but do not remove based on guesses.

## 14. Security is deeper than authentication

Use OWASP API Security Top 10 as a recurring review lens.

Core checks:
- authorize the specific object referenced by every client-controlled ID;
- authorize individual properties on read/write when sensitivity differs;
- avoid mass assignment by whitelisting writable fields;
- bound expensive operations and collection sizes;
- guard business-critical flows against automation/abuse;
- validate outbound fetch URLs and network destinations to reduce SSRF risk;
- inventory old hosts/versions/shadow APIs;
- treat downstream APIs as untrusted inputs and validate their data too.

## 15. Observability is a client feature

A diagnosable API should provide or propagate request/trace identity and make server telemetry correlate with client-visible failures.

Useful operational dimensions:
- operation/route/method;
- status/error type;
- latency;
- request/response size;
- client/application identity where allowed;
- retries/timeouts;
- throttling/quota events;
- downstream dependency failures.

Never put secrets or sensitive payloads in logs by default.

## 16. Documentation should be testable

For contract-first or contract-documented APIs:
- validate OpenAPI/GraphQL/protobuf/AsyncAPI-like definitions in CI;
- lint naming and requiredness;
- validate examples;
- generate compatibility diffs;
- run consumer/contract tests;
- fail builds on undocumented public endpoints if the organization requires spec completeness.

The OpenAPI Initiative currently publishes OAS 3.2.0 and 3.1.x. Choose a version your tooling supports; do not upgrade a spec version only for fashion.

## 17. Protocol-specific notes

### REST/HTTP quick rules
- nouns/resources in paths by default;
- no state change on `GET`;
- precise status codes;
- `Location` for newly created resources when useful;
- conditional requests for concurrency/cache validation;
- clear content types;
- RFC 9457-style errors when appropriate.

### gRPC quick rules
- explicit request/response messages;
- deadlines propagated;
- canonical status codes;
- idempotency/retry documented;
- streaming only when interaction needs it;
- reserve removed protobuf field numbers/names;
- do not reinterpret existing fields silently.

### GraphQL quick rules
- product/domain schema, not service topology;
- strong types over JSON blobs;
- nullability is a guarantee;
- input objects for evolvability;
- cursors/connections for large lists;
- deprecate before removal;
- query complexity and authorization at resolver/field boundaries.

### Event/webhook quick rules
- stable event IDs and types;
- versioning strategy;
- explicit at-least-once/ordering semantics;
- dedup guidance;
- signatures + replay protection;
- additive payload evolution.

## 18. Daily refactoring sequence

When reviewing an API every day, use this order:
1. consumer job;
2. domain model;
3. semantics;
4. naming/schema;
5. collections;
6. errors;
7. retries/concurrency;
8. compatibility;
9. security;
10. observability/performance;
11. docs/tests.

Fix the earliest broken layer first. Cosmetic naming polish should not distract from a confused domain model or unsafe mutation semantics.
