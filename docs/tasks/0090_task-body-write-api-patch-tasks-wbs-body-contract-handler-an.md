---
schema_version: 1
name: "Task body write API: PATCH /tasks/{wbs}/body contract, handler, and service"
status: todo
template: standard
created_at: 2026-06-20T05:06:46.365Z
updated_at: 2026-06-20T06:58:04.984Z
feature_id: F7
priority: P1
tags: ["task-kanban", "wave-1", "api", "orpc", "contract"]
---

## 0090. Task body write API: PATCH /tasks/{wbs}/body contract, handler, and service

### Background

Implements gap-analysis §4.1 (unmapped routes) + Wave 1. Effort: ~6h. The oRPC task contract exposes only list/show/create/transition (4 of the legacy 17 endpoints). There is no way to write a task's markdown body from the web UI, which blocks inline editing (0091). This task adds the body-write seam end to end: a Zod schema + contract route (PATCH /tasks/{wbs}/body), the server handler binding it via implement(contract), and a TaskService method that routes the write through the shared PlanningWriteService lock domain (so CLI and server writes stay serialized). Transport-only mapping in the handler per ADR-021; all behavior lives in packages/app. This is the backend prerequisite for 0091. No UI in this task.

### Requirements
- [ ] R1. Add taskBodyUpdateInput/Response Zod schemas to packages/contracts/src/task.ts (transport DTOs only — no domain types) and a `body` route: PATCH /tasks/{wbs}/body taking the new markdown body.
- [ ] R2. Implement the handler in apps/server task module via implement(contract) so contract↔handler drift is a compile error; the handler does field projection only and delegates to the service (ADR-021).
- [ ] R3. Add a TaskService.updateBody(wbs, body, actor?) method in packages/app that writes the body through PlanningWriteService's lock domain (atomic, file-wins), forwarding the actor to the History line (mirror the feature-transition actor fix).
- [ ] R4. The write must not corrupt frontmatter or non-body sections — only the task's markdown body region is replaced; verified by a round-trip test.
- [ ] R5. Tests: contract type-check binding, a handler test asserting delegation + actor forwarding, and a service test asserting the body is replaced and other sections are byte-preserved. `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build` all green.
### Acceptance Criteria
Core scenarios (must pass):

```gherkin
Scenario: R1 — the body-write route exists in the contract
  Given the task oRPC contract
  When I inspect packages/contracts/src/task.ts
  Then a PATCH /tasks/{wbs}/body route is defined with a Zod input carrying the new markdown body
  And a typed response schema for the write result

Scenario: R2 — the handler binds the contract and only maps transport
  Given the server task module
  When the body route is implemented via implement(contract)
  Then contract↔handler drift is a compile error
  And the handler does field projection only, delegating to the service (ADR-021)

Scenario: R3 — the service writes through the shared lock domain with actor attribution
  Given TaskService.updateBody(wbs, body, actor?)
  When it writes a new body
  Then the write goes through PlanningWriteService (atomic, file-wins, lock-serialized)
  And the History line is attributed to the supplied actor, falling back to ctx.actor then 'system'

Scenario: R4 — a body write preserves frontmatter and other sections
  Given a task file with frontmatter and multiple sections
  When updateBody replaces the body
  Then the frontmatter and non-body sections are byte-preserved
  And only the body region changes
```

Edge cases (advisory):

```gherkin
Scenario: R5 — concurrent CLI and server body writes do not corrupt the file
  Given a CLI write and a server body write target the same task
  When they race
  Then the lock domain serializes them and neither write is lost or partial
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Decision — add a dedicated `body` write verb to the task contract + a `TaskService.updateBody` method; route through the existing lock domain.**

The contract today exposes only list/show/create/transition (`packages/contracts/src/task.ts`). `taskShowResponseSchema` already returns `content` (the full markdown body) and `frontmatter`, so reads are covered — the gap is the *write* path that 0091 (inline editor) needs.

**Contract surface (transport DTOs only):**
```ts
taskBodyUpdateInput  = z.object({ wbs: z.string().regex(/^\d{4}$/), body: z.string(), actor: z.string().optional() })
taskBodyUpdateResponse = apiSuccessSchema(z.object({ wbs: z.string(), filePath: z.string() }))
// route: PATCH /tasks/{wbs}/body
```
Rejected: overloading the existing `transition` or a generic `update` route — a body write is a distinct verb with distinct semantics (no status change); a clear route keeps the OpenAPI surface honest.

**Service:** `TaskService.updateBody(wbs, body, actor?)` resolves the task file, then writes via `PlanningWriteService` so the write is atomic, file-wins, and lock-serialized — the same domain that already guarantees CLI/server integrity. Actor precedence `actor ?? this.ctx.actor ?? 'system'` mirrors the feature-transition actor fix (bug-250) so the History line attributes the API caller.

**Body-replace mechanism.** The write must touch only the markdown body, not frontmatter or named sections. Reuse the `MarkdownDocument` body-region replace that `--section` edits already rely on (the same crash-safe primitive); confirm via a round-trip test that frontmatter + sections are byte-identical (R4).

**Handler (ADR-021):** `implement(contract)` binding, field projection only, delegates to `ctx.taskService().updateBody(...)`. No business logic in the transport layer. Worker-compat: the route is pure oRPC, so `test-cf` must stay green.

**Invariant.** This task is backend-only — no web changes; 0091 consumes it. The lock domain remains the single write authority for the task corpus.
### Plan
1. Add `taskBodyUpdateInput` / `taskBodyUpdateResponse` Zod schemas and the `body` PATCH route to `packages/contracts/src/task.ts`.
2. Add `TaskService.updateBody(wbs, body, actor?)` in `packages/app` — resolve the file, write the body via `PlanningWriteService` with actor precedence `actor ?? ctx.actor ?? 'system'`; reuse the body-region replace primitive so frontmatter/sections are untouched.
3. Implement the handler in the server task module via `implement(contract)` — projection only, delegate to the service (ADR-021).
4. Tests: contract↔handler binding compiles; a handler test asserts delegation + actor forwarding; a service round-trip test asserts the body is replaced and frontmatter + other sections are byte-preserved.
5. Run the full gate including `test-cf` (the new route must not break the Worker build) and `build`.
### History
