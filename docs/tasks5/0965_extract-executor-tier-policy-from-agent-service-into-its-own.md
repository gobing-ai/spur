---
schema_version: 1
name: Extract executor-tier policy from agent-service into its own module
status: todo
template: standard
created_at: 2026-09-26T04:38:48.882Z
updated_at: "2026-09-26T04:56:02.141Z"

feature_id: B21
ac_numbering: task-local
---

## 0965. Extract executor-tier policy from agent-service into its own module

### Background

Source: `/sp:dev-review packages --focus all` (2026-09-25), architecture candidate **C3 (tight coupling / weak locality)**, rescoped from cancelled task 0963. Commit base `959f84bd6`.

The capability-tier **policy** — a small pure function set — lives inside the 3,370-line `packages/app/src/services/agent-service.ts`, so two unrelated services depend on the agent god-module just to read it:

- `agent-service.ts:3302` — `export function getExecutorTier(executor)` (declared tier wins; else regex inference → `cheap` / `capable-1` / `standard`).
- `agent-service.ts:3322` — `export function cheapestEligibleExecutors(executors, minTier)` (the single role→executor funnel, 0543 R1).
- `agent-service.ts:2680` — private `executorDisabled(executor)` used by the funnel.
- Uses `TIER_RANK` / `isTierEligible` from `packages/domain/src/stage-registry/schema.ts:426,435`.

Consumers importing policy through the god-module (rg, 2026-09-25):
- `packages/app/src/services/fleet-service.ts:32` — `cheapestEligibleExecutors`, `getExecutorTier` (:245).
- `packages/app/src/services/history-service.ts:84` — `getExecutorTier` (:1423).
- `packages/config/src/index.ts:659` — doc comment reference only (must stay accurate).

Out of scope (deliberately): the warn-once transition-shim state at `agent-service.ts:2873-2912` — see 0963 for why. Advisory severity; no behavior change.

### Requirements

- [ ] R1. `getExecutorTier`, `cheapestEligibleExecutors`, `executorDisabled` and the `AgentExecutorConfig` interface live in `packages/app/src/services/executor-tier.ts`, which imports nothing from `agent-service.ts` (only `@gobing-ai/spur-config` / `@gobing-ai/spur-domain` symbols they already use: `normalizeExecutorAvailability`, `ExecutorDisabledValue`, `CapabilityTier`, `isTierEligible`, `TIER_RANK`).
- [ ] R2. `fleet-service.ts:32` and `history-service.ts:84` import tier policy from `./executor-tier`, not `./agent-service`.
- [ ] R3. `agent-service.ts` imports the policy from `./executor-tier` and re-exports `type AgentExecutorConfig` so every existing importer (`agent-usage-producer.ts`, `capability-attestation.ts`, `src/index.ts:90`, tests) compiles unchanged. The tier functions are not in the barrel today and are not added.
- [ ] R4. `packages/app/tests/services/executor-tier.test.ts` directly covers: declared tier wins over inference; legacy bare `capable` → `capable-1`; each inference branch (`cheap` keywords, `capable-1` keywords, `standard` fallback); inference never yields `capable-2`/`capable-3`; `executorDisabled` for boolean and object (`{owner,since,reason}`) forms and `undefined`; `cheapestEligibleExecutors` filters disabled, filters below `minTier`, sorts ascending by tier rank.
- [ ] R5. Policy text is moved byte-identically (doc comments included). The vocabulary comment at `packages/config/src/index.ts:655-662` names symbols, not files — no edit.

### Acceptance Criteria

Graduates all four of feature B21's scenarios (exact titles below); the numbered rows are the verify lens.

- [ ] AC1 — R1 — Tier policy lives in a leaf module (req: R1, R5)
- [ ] AC2 — R2 — Fleet and history read tier policy without the agent module (req: R2)
- [ ] AC3 — R3 — Tier policy has a direct test surface (req: R4)
- [ ] AC4 — R4 — Policy behavior and existing imports are unchanged (req: R3)

**Verify lens**

- **AC1** — `rg -n "agent-service" packages/app/src/services/executor-tier.ts` returns nothing; `rg -n "^export function (getExecutorTier|cheapestEligibleExecutors)|^function executorDisabled|^export interface AgentExecutorConfig" packages/app/src/services/agent-service.ts` returns nothing.
- **AC2** — `rg -n "from './agent-service'" packages/app/src/services/fleet-service.ts packages/app/src/services/history-service.ts` shows no `getExecutorTier` / `cheapestEligibleExecutors` (fleet may still import `AgentRoleDefinition` from agent-service).
- **AC3** — `(cd packages/app && bun test --coverage tests/services/executor-tier.test.ts)` passes and reports `src/services/executor-tier.ts` at 100% functions and ≥ 95% lines.
- **AC4** — `git diff <base> --stat -- packages/app/src/services/agent-usage-producer.ts packages/app/src/services/capability-attestation.ts apps/` is empty; `git diff <base> -- 'packages/app/tests/**'` touches only the new test file; `bun run typecheck` and `bun run spur-check` green.

### Q&A

- **Q:** `AgentExecutorConfig` is declared in `agent-service.ts:113` — the leaf module needs it. Import it back (a type-only back-edge) or move it? **A:** Move it into `executor-tier.ts`; `agent-service.ts` re-exports it as a type so its six existing importers stay untouched. A type-only import would still fail AC1 and keep the conceptual dependency. Decided 2026-09-25 (refinement).
- **Q:** Are `getExecutorTier` / `cheapestEligibleExecutors` exported from the `@gobing-ai/spur-app` barrel? **A:** No (checked `src/index.ts`, 2026-09-25). Only in-package consumers exist; nothing to preserve at the barrel beyond `AgentExecutorConfig`.
- **Q:** `executorFingerprint` (`agent-service.ts:2689`) uses `executorDisabled` — move it too? **A:** No. It is doctor-cache logic owned by agent-service; it imports `executorDisabled` from the new module (exported from there, not from the barrel).
- **Q:** Does anything test these functions today? **A:** Not directly — `rg` finds no test importing them; they are exercised via `AgentService` / `FleetService` suites. Hence R4.
- **Q:** Why not also move the transition-shim warn-once state? **A:** Dropped with 0963: those shims are scheduled for removal; relocating them is wasted work.

### Design

Move-only extraction; policy text byte-identical.

```text
packages/app/src/services/executor-tier.ts   (new, leaf)
  export interface AgentExecutorConfig          ← agent-service.ts:100-120 (with its doc comment)
  export function executorDisabled(...)         ← agent-service.ts:2674-2682 (was private; now exported for agent-service + fleet)
  export function getExecutorTier(...)          ← agent-service.ts:3294-3313
  export function cheapestEligibleExecutors(...)← agent-service.ts:3315-3330
  imports: normalizeExecutorAvailability, type ExecutorDisabledValue (spur-config);
           type CapabilityTier, isTierEligible, TIER_RANK (spur-domain) — same specifiers agent-service uses today
```

`agent-service.ts`:
- `import { type AgentExecutorConfig, cheapestEligibleExecutors, executorDisabled, getExecutorTier } from './executor-tier';`
- `export type { AgentExecutorConfig } from './executor-tier';` (keeps `src/index.ts:90` and other importers valid)
- Drop now-unused imports (`normalizeExecutorAvailability` etc.) only if Biome/tsc flags them unused.

`fleet-service.ts:32` → `import type { AgentRoleDefinition } from './agent-service'; import { cheapestEligibleExecutors, getExecutorTier } from './executor-tier';` (keep `AgentRoleDefinition` wherever it lives today).
`history-service.ts:84` → `import { getExecutorTier } from './executor-tier';`

**Invariant (0343):** inference yields only `cheap` / `standard` / `capable-1`; the regexes are copied verbatim.
**Invariant (0543 R1):** one role→executor funnel — `cheapestEligibleExecutors` moves, no second selector appears.

**Rejected:** moving the policy into `packages/domain/src/stage-registry/` next to `TIER_RANK` — `AgentExecutorConfig` carries a config-layer field (`disabled: ExecutorDisabledValue`), and pulling config shapes into domain widens domain's dependency for no caller benefit.

**Grilling:** *Challenge:* three functions don't justify a file. *Defense:* the cost removed is two services' compile-time edge into a 3.4K-line module and its import graph; the leaf gives the policy a direct test surface.

### Plan

- [ ] Create `services/executor-tier.ts` by cutting the four declarations from `agent-service.ts` (Design map); keep doc comments.
- [ ] In `agent-service.ts`: add the import + `export type { AgentExecutorConfig }` re-export; remove the moved bodies.
- [ ] Re-point `fleet-service.ts:32` and `history-service.ts:84`.
- [ ] Write `tests/services/executor-tier.test.ts` covering every R4 bullet (table-driven `test.each` for inference branches).
- [ ] Focused: `(cd packages/app && bun test --coverage tests/services/executor-tier.test.ts tests/services/fleet-service.test.ts tests/services/agent-service.test.ts)`.
- [ ] Gates: `bun run spur-check`; AC1–AC4 probes pasted into Testing.
- [ ] One commit: `refactor(app): extract executor tier policy into a leaf module (0965)`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: B21 (parent B2 — invocation-agnostic executor selection).
- Review source: `/sp:dev-review packages --focus all`, 2026-09-25, candidate C3; base commit `959f84bd6`. Supersedes cancelled 0963.
- Task 0343 (tier inference invariant), 0543 R1 (single funnel), 0890 (availability object form).

### History

- 2026-09-26T04:40:25.361Z backlog → todo (system)

