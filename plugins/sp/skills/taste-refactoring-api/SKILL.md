---
name: taste-refactoring-api
description: Design, review, and refactor REST/HTTP, RPC/gRPC, GraphQL, and event APIs. Use for resource models, schemas, errors, pagination, idempotency, compatibility, security, performance, documentation, and migration safety.
---

# taste-refactoring-api

## Purpose

Act as a senior API designer, reviewer, and refactoring partner. Improve API surfaces without confusing “cleaner implementation” with “better contract.” The public contract is the product.

Use this skill when the user asks to:
- design a new API or endpoint;
- refactor an existing REST/HTTP, RPC/gRPC, GraphQL, webhook, or event API;
- review an OpenAPI, protobuf, GraphQL SDL, AsyncAPI-like contract, routes, controllers, handlers, SDK shape, or API docs;
- fix naming, resource modeling, request/response schemas, status codes, errors, pagination, filtering, sorting, idempotency, concurrency, versioning, or deprecation;
- reduce breaking changes and create a migration plan;
- make an API easier to understand, safer to retry, more secure, more observable, or cheaper to operate;
- run a pre-ship API quality pass.

This skill is practical. Prefer concrete contract changes, compatibility analysis, examples, and migration steps over abstract API philosophy.

## Core operating principles

1. **Start from consumer jobs, not routes.** Understand what clients need to accomplish before choosing paths, methods, messages, or transport details.
2. **Model the domain, not the database.** API resources/types should represent stable business concepts, not tables, ORM models, queues, or internal service boundaries.
3. **Prefer boring semantics.** Standard protocol behavior is a feature. Use conventional HTTP methods/status codes, well-known RPC patterns, GraphQL type-system semantics, and standard event envelopes before inventing custom rules.
4. **Make illegal states hard to express.** Use strong schemas, enums, validation, explicit requiredness, bounded values, and mutually exclusive shapes where the protocol supports them.
5. **Design for retries and partial failure.** Distributed systems fail. Make idempotency, timeouts, cancellation, deduplication, and recovery behavior explicit.
6. **Compatibility is part of correctness.** A locally cleaner contract can still be a bad refactor if it breaks consumers. Prefer additive evolution and staged migrations.
7. **Errors are part of the API.** Errors need stable machine-readable identity, useful human context, appropriate protocol status, and enough detail to act without exposing secrets.
8. **Collections are first-class.** Pagination, filtering, sorting, consistency, and ordering must be designed deliberately from the beginning.
9. **Security is object- and field-level.** Authentication alone is not authorization. Check access on every resource, action, and sensitive property.
10. **Operational behavior is part of the contract.** Rate limits, quotas, latency expectations, long-running operations, traceability, and request identity affect client correctness.
11. **Documentation should be executable where possible.** Keep contract definitions close to reality and validate examples, schemas, and compatibility in CI.
12. **Refactor in safe slices.** Improve the highest-leverage inconsistency first, preserve client behavior, instrument migration, then remove legacy only after evidence says it is safe.

## First classify the API

Before proposing changes, identify the dominant interface style:

- **REST/HTTP** — resources, URIs, methods, headers, status codes, representations.
- **RPC/gRPC** — services, methods, request/response messages, deadlines, streaming, status codes.
- **GraphQL** — schema, fields, arguments, nullability, mutations, connections, deprecation.
- **Event/webhook** — event type, envelope, delivery semantics, ordering, retries, deduplication, signatures.
- **Hybrid** — apply shared principles but avoid forcing one protocol’s idioms onto another.

If the user has an established style guide or public compatibility promise, treat that as a constraint unless explicitly asked to redesign it.

## Default workflow

### 1. Frame the consumer contract

Identify:
- primary consumers and their jobs;
- whether this is public, partner, internal, or service-to-service;
- read/write patterns and expected scale;
- consistency and latency requirements;
- failure/retry expectations;
- existing clients that must remain compatible;
- security and data-sensitivity boundaries;
- protocol and tooling constraints.

Do not begin with route cleanup or naming cosmetics when the domain model is unclear.

### 2. Audit in passes

Use this order unless the user requests a narrower review.

**Pass A — Domain and resource model**
- Does the API expose stable domain concepts rather than implementation details?
- Are ownership and parent/child relationships clear?
- Are resource identities stable and canonical?
- Are custom action endpoints actually resources or state transitions in disguise?
- Is there one obvious way to perform each common job?

**Pass B — Semantics and operations**
- Do methods/operations express intent consistently?
- For HTTP, are safe/idempotent method semantics respected?
- Are creates, replacements, partial updates, deletes, and actions distinguished clearly?
- Can clients retry mutations safely, or is an explicit idempotency mechanism needed?
- Are long-running operations modeled instead of holding connections indefinitely?

**Pass C — Naming and shape**
- Are path segments, operation names, fields, enums, and error codes predictable?
- Is casing consistent within the ecosystem?
- Are booleans affirmative and unambiguous?
- Are timestamps, durations, money, quantities, IDs, URLs, and enums represented consistently?
- Are server-generated and client-writable fields clearly separated?

**Pass D — Requests and responses**
- Is requiredness intentional?
- Are defaults observable and documented?
- Are request and response shapes minimal but sufficient?
- Is over-posting / mass assignment prevented?
- Can schemas evolve additively?
- Are partial-update semantics explicit rather than accidental?

**Pass E — Collections**
- Is pagination present from the start for potentially unbounded collections?
- Is ordering deterministic?
- Are page/cursor tokens opaque and bound to the relevant query context?
- Are filtering and sorting fields explicit and bounded?
- Is total count omitted, estimated, or exact by deliberate choice?
- Is collection consistency acceptable when data changes between pages?

**Pass F — Errors and edge cases**
- Does each failure map to an appropriate protocol-level status?
- Is there a stable machine-readable error type/code?
- Can a caller tell whether to fix input, authenticate, request permission, retry, wait, or contact support?
- Are validation errors field-addressable?
- Are conflict, precondition, quota, throttling, and dependency failures distinguished?
- Do errors avoid leaking internals, secrets, or existence of unauthorized resources?

**Pass G — Compatibility and evolution**
- Classify every proposed change as additive, behaviorally risky, or breaking.
- Prefer adding fields/operations over renaming/removing existing ones.
- Avoid changing meaning while preserving the same name.
- Define deprecation metadata and a migration path.
- Keep old and new behavior simultaneously only as long as needed, with observability.

**Pass H — Security and abuse resistance**
- Verify object-level authorization for every identifier received from the client.
- Verify property-level authorization for readable/writable sensitive fields.
- Prevent unrestricted resource consumption with bounded page sizes, payload sizes, batch sizes, and concurrency.
- Treat SSRF-capable URLs, webhook destinations, file fetches, and proxy-like parameters as high risk.
- Protect sensitive business flows from automation/abuse, not just authentication failures.
- Maintain an inventory of exposed versions, hosts, operations, and shadow/deprecated APIs.

**Pass I — Reliability and performance**
- Define timeouts/deadlines and retry guidance.
- Use idempotency or deduplication for retryable non-idempotent operations where necessary.
- Avoid chatty N+1 client workflows when a bounded aggregate/batch operation is clearer.
- Avoid huge payloads and unbounded lists.
- Design caching/conditional requests where freshness semantics support them.
- Model asynchronous work explicitly when latency is unpredictable or long.

**Pass J — Observability and operations**
- Propagate or generate request/trace identifiers.
- Make logs/metrics distinguish operation, client, status class, latency, and error type without logging secrets.
- Expose rate-limit/quota behavior consistently if clients need to react.
- Define SLO-relevant behavior for latency, availability, and freshness where appropriate.
- Make migration adoption measurable before removing legacy behavior.

**Pass K — Documentation and developer experience**
- Can a new consumer succeed from the contract and examples alone?
- Are common flows shown end-to-end?
- Do examples cover success plus important failures?
- Does the machine-readable spec match the implementation?
- Are deprecations, defaults, pagination, retries, rate limits, and compatibility expectations discoverable?

### 3. Systematize the contract

Whenever a decision repeats, turn it into an API rule, reusable schema, lint rule, middleware behavior, or CI check.

At minimum, look for shared standards covering:
- resource and operation naming;
- identifiers;
- timestamps and durations;
- money and decimal values;
- pagination;
- filtering and sorting;
- errors;
- idempotency;
- optimistic concurrency;
- authentication and authorization metadata;
- request/trace IDs;
- long-running operations;
- webhooks/events;
- versioning and deprecation;
- rate limits and quotas.

The goal is to eliminate repeated low-level API decisions, not to create bureaucracy.

## Protocol-specific review

After classifying the API, read the matching REST/HTTP, RPC/gRPC, GraphQL, or event/webhook section in [references/protocol-modes.md](references/protocol-modes.md). Apply that checklist before continuing with the refactoring strategy.

## Refactoring strategy

### Preserve behavior before improving shape

When refactoring an existing API:
1. Inventory current operations, schemas, consumers, traffic, and known quirks.
2. Identify the consumer pain, not just aesthetic inconsistency.
3. Mark hard compatibility constraints.
4. Design the target contract.
5. Produce an explicit old → new mapping.
6. Add adapters/aliases/new fields/new endpoints before removing old behavior where feasible.
7. Add telemetry for legacy usage.
8. Migrate first-party consumers first.
9. Publish deprecation and migration guidance.
10. Remove legacy only after the agreed support window and evidence of low/zero use.

### Compatibility classification

Treat these as **usually breaking or behaviorally dangerous**:
- removing or renaming a field/operation/path;
- changing a field’s type, units, interpretation, or enum meaning;
- making an optional request field required;
- making a nullable GraphQL field non-null without proving all clients/data satisfy it;
- changing default sort order;
- adding pagination to an endpoint that previously returned the full collection;
- reducing accepted input ranges or max sizes without transition;
- changing authentication/authorization behavior;
- changing retry/idempotency behavior;
- changing error codes/statuses that clients branch on;
- reusing deleted protobuf field numbers;
- changing event delivery/order guarantees.

Treat these as **often additive but still review behaviorally**:
- adding response fields;
- adding optional request fields with backward-safe defaults;
- adding new operations;
- adding enum values when consumers are required/known to handle unknown values;
- adding optional event payload fields;
- adding GraphQL fields/types while preserving existing semantics.

## Security review baseline

Use OWASP API Security Top 10 thinking as a minimum threat-model prompt, especially:
- broken object-level authorization;
- broken authentication;
- broken object-property-level authorization / mass assignment / excess exposure;
- unrestricted resource consumption;
- broken function-level authorization;
- unrestricted access to sensitive business flows;
- server-side request forgery;
- security misconfiguration;
- improper inventory management;
- unsafe consumption of third-party APIs.

For every API refactor, ask: **what new authority, data exposure, amplification, or request-forgery capability does this surface create?**

## Anti-patterns to call out

- endpoint names that encode implementation verbs (`/runSql`, `/callService`, `/getCustomerById`);
- APIs that mirror database tables one-to-one;
- `200 OK` for every outcome with custom error flags;
- state-changing `GET` requests;
- inconsistent IDs (`id`, `userId`, `user_id`, UUID sometimes, integer elsewhere) without a deliberate boundary;
- nullable/optional fields whose absence, null, empty string, and zero all mean different undocumented things;
- giant “update everything” payloads that enable mass assignment;
- page-number pagination over fast-changing large datasets where cursor traversal is required;
- non-deterministic list ordering;
- retries on non-idempotent writes without deduplication;
- synchronous requests for jobs that routinely exceed normal request latency;
- leaking stack traces or backend exception names;
- client-visible internal microservice names;
- version bumps for implementation-only changes;
- permanent support for every historical version;
- undocumented breaking behavior hidden behind a nonbreaking schema diff;
- GraphQL schemas full of generic JSON blobs;
- gRPC methods with one-off naming and status conventions;
- webhook delivery without signatures, replay protection, or deduplication guidance.

## Code / specification refactor mode

When OpenAPI, protobuf, GraphQL SDL, route code, or handlers are provided:
- read the contract before the implementation;
- infer existing conventions and preserve good ones;
- identify contract vs implementation-only changes;
- generate working edits where possible;
- keep schema validation and runtime validation aligned;
- add examples for changed operations;
- add compatibility tests or contract tests for risky changes;
- update generated-client-sensitive names deliberately;
- avoid broad renames that create SDK churn without consumer benefit.

When code is provided, explain only the design decisions that materially affect consumers or operations. Deliver usable patches/spec updates, not a lecture.

## API review mode

Inspect in this sequence:
1. What job is the consumer trying to complete?
2. Is the domain/resource model obvious?
3. Is there one conventional operation for that job?
4. Are names and shapes predictable?
5. Can the request be validated unambiguously?
6. Can the caller understand and recover from failures?
7. Can collection reads scale safely?
8. Can writes be retried safely?
9. Are authorization checks at object/action/property level?
10. Can the contract evolve without breaking existing consumers?
11. Can operators trace and debug a request?
12. Is the documentation/spec sufficient to use the API correctly?

Return the smallest set of high-leverage contract improvements first.

## New API design mode

1. State the consumer job in one sentence.
2. List stable domain resources/types and ownership.
3. Choose the interaction style (HTTP resources, RPC, GraphQL, event) based on the job.
4. Define the smallest coherent operations.
5. Define request/response schemas and requiredness.
6. Define errors and validation.
7. Define pagination/filtering/sorting for collections.
8. Define idempotency/concurrency/retry behavior.
9. Define authn/authz and abuse limits.
10. Define observability and operational limits.
11. Define compatibility/deprecation rules.
12. Produce contract examples and tests.

## Output contract

Unless the user requests another format, answer with:

### Diagnosis
One concise statement of the main API design problem, consumer impact, and target direction.

### Highest-impact refactors
A prioritized set of concrete contract changes, usually 3–8 items.

### Proposed contract
Show the recommended paths/methods/messages/schema snippets/examples needed to make the design concrete.

### Compatibility impact
For every externally visible change, label it:
- additive;
- behaviorally risky;
- breaking.

Include a migration strategy for risky/breaking changes.

### System rules
List reusable conventions/tokens/lint rules that should become organization-wide defaults.

### Verification
Specify the tests/checks needed: contract tests, schema validation, compatibility diff, authorization tests, retry/idempotency tests, pagination tests, performance limits, and observability checks as relevant.

## Decision rule

A “better” API is not the one with the prettiest route names. It is the one that makes common client code obvious, predictable, safe under failure, compatible over time, secure by default, and operable in production.
