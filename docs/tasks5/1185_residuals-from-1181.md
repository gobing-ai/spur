---
schema_version: 1
name: Residuals from 1181
status: backlog
template: standard
created_at: 2026-10-12T16:40:57.452Z
updated_at: "2026-10-12T16:40:58.424Z"

---

## 1185. Residuals from 1181

### Background

Source task: 1181 (feature F42) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:a16e6e60 — apps/server/src/bootstrap.ts:54; apps/web/src/lib/rpc-client.ts:91: The new oRPC error envelope is **not decodable by the repo's own typed client**. `bootstrap.ts` re-shapes the three domain errors to `{ ok:false, error:{ code, message, details } }`, but `apps/web/src/lib/rpc-client.ts`'s `OpenAPILink` has no `customErrorResponseBodyDecoder`, so `isORPCErrorJson` fails and the client throws a synthesised `ORPCError('CONFLICT', status:409, message:'Conflict')` (503 error → `SERVICE_UNAVAILABLE`) — losing `code:'GUARD_DENIED'` and the guard reason. Demonstrated against the installed `@orpc/openapi-client` 1.14.4: `NEW-envelope(409) -> {code:'CONFLICT',status:409,message:'Conflict'}` vs `OLD-toJSON(409) -> {code:'GUARD_DENIED',status:409,message:'undeclared edge…'}`. Non-regressive (before the fix this path emitted 500 `INTERNAL_SERVER_ERROR`, so the reason was already unavailable) and it does not touch 1181's Board path (which uses raw `fetch` in `feature-client.ts`), so it is not blocking for R4 — but the shipped typed client (`api.task.transition`, `KanbanBoard.tsx:196`) can no longer read the documented envelope for these codes. Fix: add a matching `customErrorResponseBodyDecoder` to `OpenAPILink`, or express the mapping via oRPC's native `errorMap`/`oc.errors` so both decode paths agree.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
