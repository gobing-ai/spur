---
schema_version: 1
name: "Attest executor capabilities before constrained agent stages"
status: todo
template: issue
created_at: 2026-08-28T23:03:05.633Z
updated_at: "2026-08-28T23:09:18.114Z"
priority: P1
tags: ["harness", "agent", "capability", "security"]
feature_id: A6
ac_altitude: task-local
---

## 0706. Attest executor capabilities before constrained agent stages

### Background

Spur resolves agents by configured executor, model tier, role, and session affinity, but it does not model whether the selected native executor actually enforces filesystem, network, process, or external-mutation constraints required by a workflow stage. Current `tier` values describe model quality/cost, not execution permission. The product correctly delegates sandbox implementation to each native agent/platform; the missing layer is a truthful contract at dispatch time.

Without that contract, an unattended stage can be routed to an executor whose controls are unknown while the workflow behaves as if the requested boundary existed. This task adds attestation and comparison at the existing config and `agent.run` seams. It does not build a sandbox.

### Requirements

- [ ] R1. Define a closed, versioned executor-capability vocabulary covering filesystem read/write, network egress, process spawning, and external mutation/approval.
- [ ] R2. Each capability records `enforced`, `available`, `unavailable`, or `unknown` plus provenance; missing data resolves to `unknown`, never a permissive default.
- [ ] R3. Extend executor config and native adapter resolution without changing the meaning of the existing model `tier`.
- [ ] R4. Allow an `agent.run` action to declare the minimum capability/enforcement requirements for that stage. Actions without requirements remain backward compatible.
- [ ] R5. Resolve the executor first, compare requirements before spawning a child process, and fail closed with an axis-by-axis diagnostic when any required capability is unavailable or unknown.
- [ ] R6. Unattended high-risk built-in stages must declare their requirements. A supervised override, if retained, must be explicit, bounded to one dispatch, and recorded in the run event; no silent fallback is allowed.
- [ ] R7. Emit bounded, redacted routing/attestation evidence containing executor/spec/model identifiers, requirement results, provenance, and override state.
- [ ] R8. Validate config and workflow shapes with existing Zod/action validation and composition-baseline tests.

Non-goals: implementing OS/container sandboxing, credential brokering, a generic policy DSL, probing secrets, or adding a public CLI noun.

### Acceptance Criteria

```gherkin
Feature: Executor capability attestation

  Scenario: Sufficient enforced capability dispatches
    Given an agent.run stage requires filesystem read and no network egress
    And the resolved executor attests both controls as enforced
    When the action starts
    Then dispatch proceeds and the execution event records the bounded attestation result

  Scenario: Unknown capability fails before spawn
    Given an unattended stage requires enforced external-mutation approval
    And the resolved executor reports that capability as unknown
    When the action starts
    Then it fails before creating a subprocess
    And the diagnostic names the executor, capability, required state, actual state, and provenance

  Scenario: Existing unconstrained action remains compatible
    Given an existing agent.run action declares no capability requirements
    When it resolves an executor with no attestation block
    Then its dispatch behavior is unchanged

  Scenario: Model tier remains independent
    Given two executors share a model tier but have different capability attestations
    When role routing selects one
    Then capability evaluation uses the selected executor's attestation and never infers permissions from tier
```

### Q&A

**Q: Is model tier a capability signal?** No. Keep the axes separate. A premium model can run with weak permissions, and
a cheaper model can run inside a strongly enforced sandbox.

**Q: Can Spur automatically prove every native control?** No. Native-known adapter facts and explicit operator
attestation are acceptable provenance; unsupported facts remain unknown. Unknown cannot satisfy an enforcement
requirement.

**Q: What happens to existing workflows/configs?** Actions with no declared requirements keep current behavior. Built-in
unattended high-risk stages are migrated explicitly, which makes the rollout bounded and reviewable.

**Q: Is a supervised override allowed?** Only if the implementation can tie it to an existing explicit approval event,
one dispatch, and a persisted audit record. Otherwise omit the override and fail closed; do not add a permissive flag.

### Design

Add a fixed `executionCapabilities` object to executor configuration and a matching `requiresCapabilities` object to `agent.run` options. Use one shared comparison function in the application layer after routing and before `runTraced`. Native adapters may contribute known attestations; operator configuration may fill platform-specific facts. Provenance must distinguish native-known, operator-configured, and unknown.

The comparison is monotonic: `enforced` satisfies a requirement for enforcement; `available` does not. `unknown` is preserved as a first-class result. Requirements are opt-in per action to preserve existing configs while built-in unattended risk-bearing stages are migrated deliberately.

Record only bounded identifiers and capability states. Never include tokens, raw config blobs, prompts, or environment values.

### Plan

1. Inventory executor config, role routing, `AgentRunActionRunner`, and system-event projection call paths.
2. Add the closed capability/provenance schemas and shared comparison function with table-driven tests.
3. Extend executor resolution to return attestation without changing model-tier selection.
4. Parse and validate `requiresCapabilities` in `agent.run`.
5. Gate dispatch before process creation and produce actionable structured errors.
6. Add redacted attestation fields to execution routing/start events.
7. Declare requirements on the selected unattended built-in workflow stages and update the composition baseline.
8. Add config compatibility, unknown, insufficient, sufficient, override, and no-spawn regression tests.
9. Synchronize config/workflow surface documentation and accepted architecture records.
10. Run targeted config/action tests, `bun run spur-check`, and worker tests as applicable.

### Root Cause

`packages/config/src/index.ts` models executor name, native agent, model, and tier. The tier is a routing/cost-quality
signal. Neither executor configuration nor `agent.run` action options represent what the native platform enforces for
filesystem, network, process, or external mutation. `packages/app/src/workflow/actions/agent-run.ts` resolves routing and
immediately calls `AgentService.runTraced`; it has no pre-dispatch capability comparison.

Spur intentionally leaves sandbox implementation to native platforms (`docs/01_PRD.md`). That boundary is correct, but
without an attestation contract the workflow cannot tell enforced from merely available or unknown. The defect is not
absence of an in-house sandbox; it is treating an unmeasured enforcement property as implicitly sufficient.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md` — M4 and Wave 2.
- `docs/01_PRD.md` — native-agent sandbox boundary.
- `packages/config/src/index.ts` — `AgentExecutorConfigSchema` and `AgentConfigSchema`.
- `packages/app/src/workflow/actions/agent-run.ts`
- `packages/app/src/services/agent-service.ts`
- `packages/app/src/observability/agent-execution.ts`
- `packages/app/tests/workflow/actions/agent-run.test.ts`
- `config/workflow-composition-baseline.json`
### History
- 2026-08-28 — created from the approved harness comparison implementation lane; researched, decomposed, linked to A6, and passed the task-local readiness gate.
