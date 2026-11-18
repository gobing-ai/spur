---
schema_version: 1
name: Extract one shared bearer guard for the MCP and A2A surfaces
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:15.944Z
updated_at: "2026-11-18T05:36:39.120Z"
feature_id: J94
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 3

---

## 1375. Extract one shared bearer guard for the MCP and A2A surfaces

### Background

The bearer-auth code is duplicated verbatim across the two agent-facing protocol modules: `requiredToken`, `sameToken` and an `authorize` closure live in both `apps/server/src/modules/a2a/index.ts:55-72,205-223` and `apps/server/src/modules/mcp/index.ts:232-249,280-296`. They differ only in realm (`spur-a2a` / `spur-mcp`) and error envelope (A2A `a2aError` google.rpc shape vs MCP `{ error: { code, message } }`). One guard removes the copy and gives task 1376 a single seam to emit `auth.denied`, and K41 (1382) reuses it for the gateway-root `/mcp`.

**Refine corrections (2026-11-17)**
- "the two differ on when the token is read" → both read the token once at mount (`a2a/index.ts:194`, `mcp/index.ts:266`); they do not differ → claim removed.
- "read the token at request time" (old R2) → no value: the process environment does not change after boot, and tests already inject `ctx.env` before mount → requirement dropped, mount-time read kept. Feature J94 R1 Then-clause amended to match.
- Plan step "request-time token rotation" → dropped with old R2. Old R2 number left as a gap.

### Requirements

- [ ] R1. Add `apps/server/src/middleware/bearer-guard.ts` exporting `bearerGuard(options)` that returns an `authorize(c)` check (`Response | null`) plus `configured: boolean`.
- [ ] R3. Replace the module-local `requiredToken`/`sameToken`/`authorize` copies in the a2a and mcp modules with `bearerGuard`; the mount-time "token variable is unset" `logger.warn` stays in each module.
- [ ] R4. Preserve existing behavior byte-for-byte: status codes (401 / 500), `WWW-Authenticate: Bearer realm="<realm>"` on 401, each surface's error bodies, and the length-independent byte comparison.
- [ ] R5. The guard reports each refusal through an optional `onDenied({ reason })` callback with `reason` ∈ `missing | mismatch | unset`, and never passes token material to it.

Out of scope: emitting any event (1376 wires `onDenied`), request-time token reads, gateway auth (1382).

### Acceptance Criteria

- [ ] AC1 — One bearer guard serves both protocol surfaces (req: R1, R3, R4, R5)

Verified by the existing 401/500/realm assertions in `apps/server/tests/mcp-e2e.test.ts` and `apps/server/tests/modules/a2a/routes.test.ts`, plus the new MCP unset-variable case. Both run a real `createServerContext` app with no module mocks.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:36:39.119Z

- **Request-time token read?** Closed: no. The env is fixed after boot and tests inject `ctx.env` before mount. The feature J94 R1 text was amended.
- **Middleware registration vs per-route call?** Closed: keep the per-route call. Both modules already call `authorize(c)` per route, and the A2A card route has its own placement.

### Design

**WHAT.** One pure function, no class, no Hono middleware registration (the modules call it per route, as today):

```ts
export type BearerDenyReason = 'missing' | 'mismatch' | 'unset';
export interface BearerGuardOptions {
    realm: string;                                   // 'spur-a2a' | 'spur-mcp'
    authEnv: string | null;                          // the variable NAME, never the value
    env: Record<string, string | undefined>;         // ctx.env ?? getEnvVars()
    unauthenticated: () => unknown;                  // 401 body builder
    unconfigured: () => unknown;                     // 500 body builder
    onDenied?: (denial: { reason: BearerDenyReason }) => void;
}
export function bearerGuard(o: BearerGuardOptions): {
    configured: boolean;
    authorize: (c: { req: { header(name: string): string | undefined } }) => Response | null;
};
```

Reason mapping: token unset → `unset` (500); no `Bearer ` header → `missing` (401); comparison fails → `mismatch` (401).

**WHY.** The duplication is exact, so a shared function is the smallest step. The body builders keep each surface's envelope without the guard knowing A2A or MCP shapes. `onDenied` is the seam 1376 uses for `auth.denied`, so the guard has no `ServerContext` dependency and stays unit-free to reason about.

**WHERE.** New `apps/server/src/middleware/bearer-guard.ts`; edits in `apps/server/src/modules/a2a/index.ts` and `apps/server/src/modules/mcp/index.ts`. `envOver(ctx)` is duplicated in both modules too. Move it into the guard file as `bearerEnv(ctx)` and reuse it.

**Anti-patterns.** No request-time env read. No token in logs, the callback or error bodies. No early-exit string compare. Don't change the A2A Agent Card route's auth placement.

**Handoff.** 1376 passes `onDenied` on both surfaces. 1382 (K41) calls `bearerGuard` with realm `spur-gateway-mcp`.

### Plan

- [ ] Step 1 (R4, test first): add an MCP unset-variable 500 case to `apps/server/tests/mcp-e2e.test.ts` (A2A already has one at `apps/server/tests/modules/a2a/routes.test.ts:200`). Run it green on current code as the byte-compat baseline.
- [ ] Step 2 (R1/R5): write `bearer-guard.ts` with `bearerGuard` and `bearerEnv`.
- [ ] Step 3 (R3): swap both modules onto it and delete the local copies.
- [ ] Step 4 (R4): run `(cd apps/server && bun test tests/mcp-e2e.test.ts tests/modules/a2a/routes.test.ts)`. The existing 401/500/realm assertions must pass unchanged.
- [ ] Step 5: run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
