# Research Basis and Standards References

This skill intentionally synthesizes standards and public guidance instead of depending on a single book.

Research checked in September 2026.

## HTTP semantics

- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
  - Defines request method semantics, safe methods, idempotency, status codes, conditional requests, and HTTP representation behavior.

## HTTP API errors

- RFC 9457 — Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457.html
  - Standard machine-readable problem detail model; obsoletes RFC 7807.

## OpenAPI

- OpenAPI Specification: https://spec.openapis.org/oas/
  - Current published version list includes OpenAPI 3.2.0 and 3.1.x.

## Resource-oriented design

- Google AIP-121 — Resource-oriented design: https://google.aip.dev/121
- Google AIP-130 — Methods: https://google.aip.dev/130
- Google AIP-132 — Standard methods: List: https://google.aip.dev/132
- Google AIP-136 — Custom methods: https://google.aip.dev/136
- Google AIP-158 — Pagination: https://google.aip.dev/158

These are vendor-specific guidelines, but they capture broadly useful patterns: stable resources, standard operations, custom actions only when necessary, and pagination designed from the start.

## API security

- OWASP API Security Top 10 — 2023: https://api-security.owasp.org/editions/2023/en/0x11-t10/
  - Used as the baseline threat-model checklist for object-level authorization, authentication, property-level authorization, resource consumption, function-level authorization, sensitive business flows, SSRF, misconfiguration, inventory, and unsafe downstream API consumption.

## GraphQL

- GraphQL Specification — September 2025: https://spec.graphql.org/September2025/
  - Used for schema/type-system, deprecation, nullability, input/output, and execution semantics.

## Events

- CloudEvents: https://cloudevents.io/
  - Useful reference for stable event envelope concepts and interoperability.

## Idempotency keys

- IETF HTTPAPI draft — Idempotency-Key HTTP Header Field: https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
  - As of the research date this remains an Internet-Draft, not a final RFC. The skill therefore treats the design pattern as useful while avoiding claims that the header is a finalized HTTP standard.

## Additional architectural guidance

- Microsoft Azure Architecture Center — API design / RESTful web API design:
  - https://learn.microsoft.com/en-us/azure/architecture/microservices/design/api-design
  - https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design

This material reinforces loose coupling, domain-oriented contracts, compatibility/versioning, pagination/filtering, idempotency, and operational concerns.
