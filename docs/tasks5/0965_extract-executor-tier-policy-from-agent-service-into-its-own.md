---
schema_version: 1
name: Extract executor-tier policy from agent-service into its own module
status: todo
template: standard
created_at: 2026-09-26T04:38:48.882Z
updated_at: "2026-09-26T04:40:25.361Z"

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

- [ ] R1. `getExecutorTier`, `cheapestEligibleExecutors` and `executorDisabled` live in `packages/app/src/services/executor-tier.ts`, which does not import `agent-service.ts`.
- [ ] R2. `fleet-service.ts` and `history-service.ts` import tier policy from `executor-tier.ts`, not from `agent-service.ts`.
- [ ] R3. `agent-service.ts` imports the policy from the new module; any symbol previously exported from the `@gobing-ai/spur-app` barrel stays exported under the same name.
- [ ] R4. The new module has a direct unit test covering declared-tier precedence, legacy `capable` → `capable-1`, each inference branch, disabled filtering, and ascending-tier sort.
- [ ] R5. The `packages/config/src/index.ts:659` comment points at the new location.

### Acceptance Criteria

- [ ] AC1 — `rg "from './agent-service'" packages/app/src/services/fleet-service.ts packages/app/src/services/history-service.ts` shows no tier-policy symbols (req: R2)
- [ ] AC2 — `rg "agent-service" packages/app/src/services/executor-tier.ts` returns nothing (req: R1)
- [ ] AC3 — `packages/app/tests/services/executor-tier.test.ts` exists, passes, and the module reports ≥ 90% line + function coverage (req: R4)
- [ ] AC4 — `bun run spur-check` green; no existing test assertion edited (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Move-only extraction into `services/executor-tier.ts` (sibling of its consumers; `services/` not `workflow/` because fleet/history/agent services are the callers). Keep the regex inference and the "never infer capable-2/3" invariant (0343) byte-identical — this task changes location, not policy. `executorDisabled` moves because the funnel needs it; `agent-service.ts` re-imports it where it uses it internally.

**Rejected:** moving the policy into `packages/domain/src/stage-registry/` next to `TIER_RANK`. `AgentExecutorConfig` is a config/app type; pushing it into domain widens the domain's dependency on config shapes for no caller benefit.

**Grilling:** *Challenge:* three functions don't justify a new file. *Defense:* the cost being removed is not size — it is two services taking a compile-time dependency on the 3.4K-line agent module (and its import graph) to read a pure policy; a leaf module breaks that edge and gives the policy a direct test surface.

### Plan

- [ ] Create `services/executor-tier.ts` with the three functions (move, don't rewrite).
- [ ] Re-point imports in `agent-service.ts`, `fleet-service.ts`, `history-service.ts`; keep barrel exports stable.
- [ ] Add `tests/services/executor-tier.test.ts`.
- [ ] Update `packages/config/src/index.ts:659` comment.
- [ ] `(cd packages/app && bun test tests/services/executor-tier.test.ts tests/services/fleet-service.test.ts tests/services/agent-service.test.ts)`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-26T04:40:25.361Z backlog → todo (system)

