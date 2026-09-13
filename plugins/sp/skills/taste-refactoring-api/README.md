# taste-refactoring-api

A reusable agent skill for designing, reviewing, and safely refactoring production APIs.

## What it covers

- REST/HTTP
- RPC/gRPC
- GraphQL
- events/webhooks
- domain/resource modeling
- naming and schemas
- errors
- pagination/filtering/sorting
- idempotency and retries
- concurrency
- versioning/deprecation/migration
- API security
- observability
- reliability/performance
- contract testing and documentation

## Suggested installation

Install/copy this directory as an agent skill named `taste-refactoring-api` and load `SKILL.md` as the skill instructions. Keep the `references`, `checklists`, and `examples` directories available for deeper reviews.

## Daily usage examples

- “Use taste-refactoring-api to review this OpenAPI spec.”
- “Refactor these Express routes without breaking current clients.”
- “Review this GraphQL schema for compatibility and developer experience.”
- “Design a safe pagination and filtering contract for this endpoint.”
- “Create a migration plan from v1 to v2 with no abrupt client breakage.”
- “Run the daily API quality checklist on this PR.”

## Files

- `SKILL.md` — main agent operating instructions
- `references/api-refactoring-playbook.md` — deeper operational guidance
- `references/research-basis.md` — standards and sources used to build the skill
- `checklists/daily-api-review.md` — fast daily checklist
- `examples/review-template.md` — reusable review format
- `examples/refactor-example.md` — worked refactoring example
