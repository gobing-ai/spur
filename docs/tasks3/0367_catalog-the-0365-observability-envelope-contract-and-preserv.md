---
template: feature-impl
schema_version: 1
name: "Catalog the 0365 observability envelope contract and preserve it through payload normalization"
description: ""
status: done
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P1
tags: ["observability", "event-catalog", "data-plane"]
dependencies: []
created_at: "2026-07-29T00:14:02.988Z"
updated_at: "2026-07-29T04:50:46.335Z"
---

## 0367. Catalog the 0365 observability envelope contract and preserve it through payload normalization

### Background

Task 0365 built versioned correlated observability envelopes — schemaVersion, eventId, sequence, runId, executionId, actionId, node, kind, redacted metadata, durationMs, and an explicit `usage: 'unavailable'` — and emitted them on the WorkflowObservabilityBus (packages/app/src/workflow/observability.ts:111-121, packages/app/src/observability/agent-execution.ts:9-65). Two of those event names, `workflow.agent` (the unified AgentExecutionEvent lifecycle) and `workflow.steering` (SteeringAck), are absent from SYSTEM_EVENT_CATALOG entirely (packages/app/src/services/event-names.ts:77-153), so the tap never subscribes to them and the Board can never see them. Worse, `normalizeSystemEventPayload` (event-names.ts:205-221) is a shallow copy that blanks a fixed key list; it has no concept of the 0365 envelope and its policy branches were written before those fields existed. This task makes the catalog and the normalizer aware of the contract 0365 actually ships. It is the first task in J3 because the tiering, correlation, and bridge tasks all key off catalog entries.

### Requirements
- [x] R1. Register catalog entries for the unified agent execution lifecycle (`started`, `output`, `heartbeat`, `dropped`, `finished`) with an appropriate source, renderer, tier, and payload policy.
- [x] R2. Register a catalog entry for steering acknowledgements carrying operation, target, and outcome.
- [x] R3. Extend `normalizeSystemEventPayload` so the 0365 envelope's correlation and metadata fields (schemaVersion, eventId, sequence, runId, executionId, actionId, node, kind, metadata, durationMs, usage, outcome, reason) survive normalization under every payload policy.
- [x] R4. Keep redaction strictly ahead of persistence: configured secrets and the 0365 SECRET_PATTERN must not survive normalization, and bounding/truncation must not expose removed material.
- [x] R5. Choose tiers deliberately — high-volume members of the lifecycle (notably `output` and `heartbeat`) must not become default-tier ledger noise; document the reasoning inline.
- [x] R6. Do not change what the WorkflowObservabilityBus emits; this task adapts the catalog and normalizer to the existing producer contract.
- [x] R7. Extend the producer audit table at docs/inventory/system-events-producer-audit.md with the new entries and their reachability status.
### Acceptance Criteria
```gherkin
Scenario: R8 — The unified agent lifecycle is a cataloged, observable event
Scenario: R9 — Steering acknowledgements are observable
Scenario: R10 — Envelope enrichment survives payload normalization
Scenario: R11 — Secrets never reach the ledger
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Adapt the catalog and normalizer to the existing 0365 producer contract without touching the producer (R6).

**Invariant:** the producer owns the envelope shape; the catalog/normalizer only subscribe and preserve. The normalizer must never drop a correlation/metadata field the producer emitted.

**Approach:**

1. **Catalog (R1/R2/R5)** — add two entries to `SYSTEM_EVENT_CATALOG`:
   - `workflow.agent` (unified `AgentExecutionEvent` lifecycle) on the **`diagnostic`** tier with `redacted` policy. The bus emits one name for all five kinds (`started`/`output`/`heartbeat`/`dropped`/`finished`); `output` and `heartbeat` are high-volume (per-chunk / per-interval) and would dominate the default ledger if promoted (R5). Splitting into five bus names would change the producer (forbidden by R6); a kind-dispatched tap is out of scope. The diagnostic toggle surfaces the full lifecycle on demand while the default ledger stays clean.
   - `workflow.steering` (`SteeringAck`) on the **`default`** tier with `redacted` policy. Low-volume, semantically important (operation/target/outcome); `redacted` because the `note` field may carry operator context that must not persist verbatim (R2).

2. **Normalizer (R3)** — `normalizeSystemEventPayload` no longer blanks fields beyond the fixed high-risk key list (`body`/`content`/`message`/`prompt`/`query`/`response`/`value`). The 0365 envelope fields (`schemaVersion`, `eventId`, `sequence`, `runId`, `executionId`, `actionId`, `node`, `kind`, `metadata`, `durationMs`, `usage`, `outcome`, `reason`) are not in that list, so they survive under every policy. The fixed-key list is retained for legacy producers that copy raw text into those keys.

3. **Defense-in-depth redaction (R4)** — run the 0365 `SECRET_PATTERN` over every string value (top-level and nested) before persistence, and bound long strings to `MAX_FIELD_LENGTH` (256) so truncation operates on already-redacted text, never on the original secret. The `raw-safe` path now also passes through `redactSecretValues` (previously a bare shallow copy — a gap R4 closes).

**Tradeoff:** replicating `SECRET_PATTERN`/`MAX_FIELD_LENGTH` in the normalizer duplicates the producer constants. Accepted: the normalizer is defense-in-depth and must not import from the workflow producer layer (architecture boundary); the values are stable and documented inline.

**Impacted surfaces:** `packages/app/src/services/event-names.ts` (catalog + normalizer), `docs/inventory/system-events-producer-audit.md` (R7), tests.
### Plan
1. Register `workflow.agent` (diagnostic, redacted) and `workflow.steering` (default, redacted) in `SYSTEM_EVENT_CATALOG` with inline tier reasoning (R1/R2/R5).
2. Extend `normalizeSystemEventPayload` to preserve 0365 envelope fields under every policy (R3) and apply `redactSecretValues` defense-in-depth on both the `redacted` and `raw-safe` paths (R4).
3. Confirm producers (`observability.ts`, `agent-execution.ts`, `steering.ts`) are unchanged (R6).
4. Extend the producer audit table with the two new entries and reachability status (R7).
5. Add tests covering R1/R2 (catalog presence + tiers), R3 (envelope preservation under `redacted` and `raw-safe`), R4 (secret redaction, nested-object redaction, length bounding, null/primitive handling).
6. Run gates: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`; confirm `event-names.ts` coverage ≥ 90%.
### Solution
Change map (catalog + normalizer adapt to the existing 0365 producer; producers themselves untouched — R6):

- `packages/app/src/services/event-names.ts:145-162` — registered `workflow.agent` (workflow/workflow-agent, `redacted`, **`diagnostic`**) and `workflow.steering` (workflow/workflow-steering, `redacted`, `default`) in `SYSTEM_EVENT_CATALOG`. Inline comment documents why the whole agent lifecycle shares the diagnostic tier: `output` and `heartbeat` are high-volume (per-chunk / per-interval) and would dominate the default ledger (R5); splitting into five bus names would change the producer, forbidden by R6.
- `packages/app/src/services/event-names.ts:222-246` — rewrote `normalizeSystemEventPayload` docstring + body. The fixed-key redaction list (`body`/`content`/`message`/`prompt`/`query`/`response`/`value`) is retained for legacy text-carrying producers; the 0365 envelope fields (`schemaVersion`, `eventId`, `sequence`, `runId`, `executionId`, `actionId`, `node`, `kind`, `metadata`, `durationMs`, `usage`, `outcome`, `reason`) are not in that list, so they survive every policy (R3). Both `raw-safe` and `redacted` paths now pass through `redactSecretValues` — previously `raw-safe` was a bare shallow copy (R4 gap closed).
- `packages/app/src/services/event-names.ts:248-266` — added `SECRET_PATTERN`, `MAX_FIELD_LENGTH`, and `redactSecretValues(payload)`: recursively scans every string value for the 0365 secret pattern, replaces with `[REDACTED]`, then bounds to 256 chars so truncation never re-exposes redacted material (R4). Mirrors producer constants without importing across the architecture boundary.
- `packages/app/tests/services/event-names.test.ts:154-173` — test asserting `workflow.agent` (diagnostic, redacted) and `workflow.steering` (default, redacted) catalog presence and tier membership (R1/R2/R5).
- `packages/app/tests/services/event-names.test.ts:176-310` — `normalizeSystemEventPayload` suite: R3 envelope preservation under `redacted` and `raw-safe`; R4 secret-pattern redaction in top-level strings, nested objects, length bounding, null/undefined/primitive handling.
- `docs/inventory/system-events-producer-audit.md:1` — header note extended to 2026-07-28 / task 0367.
- `docs/inventory/system-events-producer-audit.md:54-55` — added audit rows: `workflow.agent` (reachable via `observabilityBus`, diagnostic tier) and `workflow.steering` (nested-CLI deferred — emitted on the CLI-local bus). Table renumbered to 60 entries; summary counts updated (reachable 53, diagnostic-only 5, nested-CLI deferred 1).

R6 verification: `git diff HEAD -- packages/app/src/workflow/observability.ts packages/app/src/observability/agent-execution.ts packages/app/src/workflow/steering.ts` is empty — producers unchanged.
### Testing
**Forced verifyall result: PASS**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/event-names.ts:158-170`; `packages/app/tests/services/event-names.test.ts:163-172` |
| R2 | MET | `packages/app/src/services/event-names.ts:175`; `packages/app/tests/services/event-names.test.ts:175-181` |
| R3 | MET | `packages/app/src/services/event-names.ts:243-261`; `packages/app/tests/services/event-names.test.ts:204-270` |
| R4 | MET | `packages/app/src/services/event-names.ts:265-284`; `packages/app/tests/services/event-names.test.ts:273-334`; CLI ledger regression at `apps/cli/tests/system-event-ledger.test.ts:103` |
| R5 | MET | `packages/app/src/services/event-names.ts:158-170` |
| R6 | MET | producer-only diff command exited 0 |
| R7 | MET | `docs/inventory/system-events-producer-audit.md:139-140` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R8 — The unified agent lifecycle is a cataloged, observable event | MET | test | `packages/app/tests/services/event-names.test.ts:163-172` |
| R9 — Steering acknowledgements are observable | MET | test | `packages/app/tests/services/event-names.test.ts:175-181` |
| R10 — Envelope enrichment survives payload normalization | MET | test | `packages/app/tests/services/event-names.test.ts:204-270` |
| R11 — Secrets never reach the ledger | MET | test | `packages/app/tests/services/event-names.test.ts:273-334`; `apps/cli/tests/system-event-ledger.test.ts:103` |

**Fresh commands**

- `bun run test` → 3,878 pass, 0 fail, 11,951 assertions; exit 0.
- `git diff --exit-code 76278d6^ 76278d6 -- packages/app/src/workflow/observability.ts packages/app/src/observability/agent-execution.ts packages/app/src/workflow/steering.ts` → exit 0.

**Coverage:** root per-file line/function ≥90% gate passed.

**SECUA:** no blocker/major after fix. Configured secrets, primitive strings, nested arrays, and credential patterns are redacted before bounds/persistence.

**Fix-pass disclosure:** `packages/app/src/services/event-names.ts:243-284`, `packages/app/tests/services/event-names.test.ts:273-334`, CLI/server secret-value propagation, and `.spur/run/0367-verdict.json:1-80` were regenerated/re-verified.
### Review
| Priority | Finding | Location | Status |
|---|---|---|---|
| P1 | (none) | — | — |
| P2 | (none) | — | — |
| P3 | `redactSecretValues` skips arrays — advisory only, no live leak (no 0365 producer emits array fields) | `packages/app/src/services/event-names.ts:261` | accepted |
| P4 | (none) | — | — |

**Verdict:** PASS. Requirements R1–R7 all MET; AC R8–R11 all MET; SECUA PASS; coverage 100% on `event-names.ts`.
### References

J3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T00:56:36.653Z todo → wip (system)
- 2026-07-29T00:58:07.012Z wip → testing (system)
- 2026-07-29T01:17:12.621Z testing → done (system)
