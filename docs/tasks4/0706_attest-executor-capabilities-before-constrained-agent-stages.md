---
schema_version: 1
name: "Attest executor capabilities before constrained agent stages"
status: done
template: issue
created_at: 2026-08-28T23:03:05.633Z
updated_at: "2026-08-29T21:50:05.325Z"
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

- [x] R1. Define a closed, versioned executor-capability vocabulary covering filesystem read/write, network egress, process spawning, and external mutation/approval.
- [x] R2. Each capability records `enforced`, `available`, `unavailable`, or `unknown` plus provenance; missing data resolves to `unknown`, never a permissive default.
- [x] R3. Extend executor config and native adapter resolution without changing the meaning of the existing model `tier`.
- [x] R4. Allow an `agent.run` action to declare the minimum capability/enforcement requirements for that stage. Actions without requirements remain backward compatible.
- [x] R5. Resolve the executor first, compare requirements before spawning a child process, and fail closed with an axis-by-axis diagnostic when any required capability is unavailable or unknown.
- [x] R6. Unattended high-risk built-in stages must declare their requirements. A supervised override, if retained, must be explicit, bounded to one dispatch, and recorded in the run event; no silent fallback is allowed.
- [x] R7. Emit bounded, redacted routing/attestation evidence containing executor/spec/model identifiers, requirement results, provenance, and override state.
- [x] R8. Validate config and workflow shapes with existing Zod/action validation and composition-baseline tests.

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

Implemented executor-capability attestation gating for constrained `agent.run` stages (ADR-102).

**Contract (`packages/config/src/index.ts`):** closed axis vocabulary `EXECUTION_CAPABILITY_AXES`
(`fsRead|fsWrite|networkEgress|processSpawn|externalMutationApproval`), states
`EXECUTION_CAPABILITY_STATES` (`enforced|available|unavailable|unknown`), provenances
`EXECUTION_CAPABILITY_PROVENANCES` (`native-known|operator-configured|unattested`),
`ExecutionCapabilitiesSchema` (executor attestation: `version: 1`, partial axes via
`z.partialRecord`), `RequiresCapabilitiesSchema` (`agent.run` option), optional
`executionCapabilities` field on `AgentExecutorConfigSchema`.

**Shared comparison (`packages/app/src/services/capability-attestation.ts`):** `satisfiesRequirement`
monotonic rule (`enforced` ⊇ `available`), `executorAttestation` (absent/partial declarations fill
undeclared axes with unknown/unattested — missing data never permissive), `evaluateCapabilities`
(closed-axis ordered entries), `capabilityDiagnostic` (axis-by-axis required/actual/provenance),
`capabilityEvidence` (bounded redacted payload), `parseRequiresCapabilities` (closed-vocabulary
validation).

**Dispatch gate (`packages/app/src/services/agent-service.ts:1096`):** `requiresCapabilities` flag parsed
in `executeRun` (invalid JSON/shape → exit 2 before resolution); per-dispatch gate at the top of the
loop compares against the executor resolved for the CURRENT attempt (escalation hops re-check — R5);
fail → exit 2 with diagnostic, no spawn; pass → bounded `routing.capabilities` evidence stamped on
the started event (`packages/app/src/observability/agent-execution.ts`).

**Action boundary (`packages/app/src/workflow/actions/agent-run.ts`):** `requiresCapabilities`
option validated at the action boundary; valid maps serialize into dispatch flags.

**Workflow:** `task-pipeline.yaml` `implement` + `test-fix` agent.run stages declare
`requiresCapabilities: {fsWrite: available, processSpawn: available}` (R6 — the two unattended,
tree-mutating stages under the auto profile). Observe-only stages stay undeclared. No executor
attestations were fabricated in config — operators attest their own executors (provenance
integrity).

**Tests:** `packages/app/tests/services/capability-attestation.test.ts` (monotonic matrix,
missing-data, closed vocabulary, diagnostic, evidence redaction, parse), capability-gate describe in
`agent-service.test.ts` (fail-closed-before-spawn, satisfied dispatch + evidence, escalation
re-check, backward compat, invalid option, tier-is-not-signal), `capability-requirements.test.ts`
(declared stages pin + observe-only stages pin), `requiresCapabilities validation` describe in
`agent-run.test.ts` (action-boundary fail-before-dispatch + flag serialization).

**Docs:** ADR-102; `04_DESIGN.md` agent.run capability attestation surface.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | `packages/config/src/index.ts:216-242` — closed vocabularies `EXECUTION_CAPABILITY_AXES` (fsRead/fsWrite/networkEgress/processSpawn/externalMutationApproval), `EXECUTION_CAPABILITY_STATES` (enforced/available/unavailable/unknown), `EXECUTION_CAPABILITY_PROVENANCES` (native-known/operator-configured/unattested); versioned attestation `packages/config/src/index.ts:258-267` (`version: 1`) |
| R2 | MET | `packages/config/src/index.ts:246-247` (state+provenance per axis) + `packages/app/src/services/capability-attestation.ts:29-30` (`UNATTESTED_CAPABILITY` = unknown/unattested) and `:50-62` (`executorAttestation` fills undeclared axes); test `packages/app/tests/services/capability-attestation.test.ts:35` (absent entry → unknown/unattested) and `:41` (partial declaration fills only undeclared axes) — 19/19 pass this run |
| R3 | MET | `packages/config/src/index.ts:299-307` — optional `executionCapabilities` on `AgentExecutorConfigSchema` with explicit orthogonality-to-tier comment; `tier` field and its routing semantics untouched (diff shows no tier changes); test `packages/app/tests/services/capability-attestation.test.ts:70` (enforced satisfies both levels) |
| R4 | MET | `packages/app/src/workflow/actions/agent-run.ts:82` (option doc) and `:243-248` (parse + flag serialization); backward compat test `packages/app/tests/services/agent-service.test.ts:3964` (`actions without requirements keep dispatching unchanged`) — 2/2 requiresCapabilities describe tests pass this run |
| R5 | MET | `packages/app/src/services/agent-service.ts:1085-1104` — gate inside the dispatch loop (per-attempt, escalation re-check per comment `:1085-1090`), `evaluateCapabilities` → `capabilityDiagnostic` → `return { ok: false, exitCode: 2 }` BEFORE any spawn; tests `packages/app/tests/services/agent-service.test.ts:3903` (fail-closed before spawn + axis-by-axis diagnostic) and `:3943` (escalation hop re-check) — 8/8 capability-gate describe tests pass this run |
| R6 | MET | `config/workflows/task-pipeline.yaml:267-271` (implement) and `:409-412` (test-fix) declare `requiresCapabilities: {fsWrite: available, processSpawn: available}`; override deliberately omitted per task Q&A — `packages/app/src/services/agent-service.ts:1086-1090` ("no supervised override exists"); pin test `packages/app/tests/workflow/capability-requirements.test.ts:29-46` — 3/3 pass this run |
| R7 | MET | `packages/app/src/services/capability-attestation.ts:146-155` (`capabilityEvidence` bounded projection) + `packages/app/src/observability/agent-execution.ts:55-60` (`routing.capabilities` on started/invoke events, "Bounded identifiers/states only"); redaction test `packages/app/tests/services/capability-attestation.test.ts:125` (carries identifiers/states only — no config blobs); evidence stamping exercised in `packages/app/tests/services/agent-service.test.ts:3918` |
| R8 | MET | `packages/config/src/index.ts:280-284` (`RequiresCapabilitiesSchema` Zod) + `packages/app/src/services/capability-attestation.ts:143-156` (`parseRequiresCapabilities` closed-vocabulary errors); tests `packages/app/tests/services/capability-attestation.test.ts:155,166,172` (undefined → empty; unknown axis rejected by name; invalid level rejected) + invalid-shape-fails-closed `packages/app/tests/services/agent-service.test.ts:3972`; workflow shape pinned by `capability-requirements.test.ts`; full suite green in this session's quality gate (0706 test hop PASS, 1m39s) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| Scenario: Sufficient enforced capability dispatches | MET | test | `packages/app/tests/services/agent-service.test.ts:3918` — "sufficient enforced attestation dispatches and records bounded evidence (R1/S1/R7)"; passed this run (8/8 describe green) |
| Scenario: Unknown capability fails before spawn | MET | test | `packages/app/tests/services/agent-service.test.ts:3903` — "unknown attestation fails closed BEFORE spawn with an axis-by-axis diagnostic (R5/S2)" asserting no-spawn + executor/capability/required/actual/provenance in the diagnostic; passed this run |
| Scenario: Existing unconstrained action remains compatible | MET | test | `packages/app/tests/services/agent-service.test.ts:3964` — "actions without requirements keep dispatching unchanged (R4/S3 backward compat)"; passed this run; also full 6752-test suite green at the 0706 quality gate (existing suites unaffected) |
| Scenario: Model tier remains independent | MET | test | `packages/app/tests/services/agent-service.test.ts:3988` — "model tier is never a capability signal (R8/S4): tiered executor without attestation still fails"; passed this run |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
| ---------- | ----------- | ---------- | ---------- |
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:279f3b2c235a09a430feafa7d515c8f02b479584aee3961f85f0101e8a1828ec |

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
- 2026-08-29T21:12:52.029Z todo → wip (system)
- 2026-08-29T21:50:05.003Z wip → testing (system)
- 2026-08-29T21:50:05.325Z testing → done (system)
