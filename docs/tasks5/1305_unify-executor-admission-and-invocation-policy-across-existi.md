---
schema_version: 1
name: Unify executor admission and invocation policy across existing dispatch surfaces
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.917Z
updated_at: "2026-11-07T06:52:00.144Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: D65
priority: P2
tags:
  - simplification-2026-11
  - w5
  - approved
estimate_hours: 8

dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1305-verdict.json
---

## 1305. Unify executor admission and invocation policy across existing dispatch surfaces

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W5; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature D65: Executor surfaces apply the same declared admission contract.

Owned surfaces/callers/fixtures/config/docs: packages/app/src/workflow/actions/agent-run.ts; existing host-executor/fleet-dispatch helpers; capability, independence and agent-budget helpers; receipt and agent-run fixture tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C1 R2 = 14. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Current dispatch branches have intentionally different observable guarantees: host returns a work item before subprocess-only capability/budget checks. Do not pretend every old policy already applies identically. Remove unrelated Board/search prerequisites and freeze a behavior-preserving extraction first.
- Verified source seams: `packages/app/src/workflow/actions/agent-run.ts:633`; `packages/app/src/workflow/actions/agent-run.ts:905`; `packages/app/src/workflow/actions/agent-run.ts:311`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Executor surfaces apply the same declared admission contract; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Unify executor admission and invocation policy across existing dispatch surfaces

  Scenario: AC1 — Executor surfaces apply the same declared admission contract (req: R1)
    Given equivalent host, fleet and subprocess work items including unsupported capability, stale artifact, reviewer identity and exhausted-budget fixtures
    When each existing surface evaluates admission
    Then common declared policy produces equivalent justified decisions while surface-specific identity and host-pause semantics remain explicit
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:38:01.150Z

Closed: preserve observable behavior; unify only shared semantics. A stronger enforcement guarantee would require a separately designed change, not this refactor.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Private internal NormalizedAgentInvocation holds validated input/role/cwd/session option, declared file contracts, selected surface and existing flags; normalize pure option shape once. Retain current routing order/pinning/fleet fallback and host pause point. Extract common artifact-freshness and declared-shape validation only where existing branch behavior matches; model native capability/usage checks as surface capabilities rather than asserting a host session offers subprocess enforcement. Preserve existing unsupported outcomes and distinct-executor checks. No public ActionRunner/API changes, no new requirements on the host, no executor registry. Add a matrix documenting equal common-contract decisions and intentional surface-specific differences before deleting duplicated blocks.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1306 consumes private normalized invocation and behavior matrix; it owns completion, not admission policy.

#### Boundaries and verification

(cd packages/app && bun test tests/workflow/actions/agent-run.test.ts tests/workflow/actions/agent-run-receipt.test.ts tests/workflow/host-executor.test.ts tests/workflow/agent-run-fleet.test.ts tests/workflow/fleet-dispatch.test.ts). Save admission matrix with intentional surface differences.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.

### Plan

- [x] 1. Write admission matrix covering actual host/fleet/subprocess branches, pinning, stale artifacts and negative capability/independence cases.
- [x] 2. Introduce private normalization and extract proven common checks while retaining surface-specific order and effects.
- [x] 3. Delete replaced duplicated blocks and prove no subprocess spawns on host pause or new host-control guarantee is claimed.
- [x] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

- `packages/app/src/workflow/actions/agent-run.ts:71-149` — Introduced private `ExecutorDispatchSurface`, `ExecutorSurfaceCapabilities`, `EXECUTOR_SURFACE_CAPABILITIES`, and `NormalizedAgentInvocation` with the surface admission behavior matrix (for R1 / AC1 and task 1306 handoff), modeling native capability, timeout, prompt, and usage-budget checks as surface capabilities without claiming subprocess enforcement on a host work-item pause.
- `packages/app/src/workflow/actions/agent-run.ts:391-454` — Updated `executeFleetSurface` to consume `NormalizedAgentInvocation` and shared admission helpers (`workItemPromptError`, `invocationTimeoutError`, `removeStaleArtifacts`) while retaining fleet member identity rules, envelope delegation, and fallback behavior.
- `packages/app/src/workflow/actions/agent-run.ts:583-616` — Updated `executeHostSurface` to consume `NormalizedAgentInvocation`, `workItemPromptError`, and `removeStaleArtifacts` across `expectFiles`, replacing duplicated prompt and stale-artifact deletion loops while preserving the host work-item pause boundary.
- `packages/app/src/workflow/actions/agent-run.ts:689-1096` — Normalized stage options once at `dispatch()` entry via `normalizeAgentInvocation`, routed shared declared-shape checks through `validateDeclaredSessionOption`, `isDeclaredRoleValid`, and `validateDeclaredRole`, and unified pre-dispatch `escalationFile`/`expectFile` removal through `removeStaleArtifacts` while preserving executor pinning, mid-run re-resolution, native capability attestation, P1 reviewer independence, and post-dispatch budget evaluation.
- `packages/app/src/workflow/actions/agent-run.ts:1770-1858` — Added private helpers `normalizeAgentInvocation`, `validateDeclaredSessionOption`, `isDeclaredRoleValid`, `validateDeclaredRole`, `workItemPromptError`, `invocationTimeoutError`, and `removeStaleArtifacts`.
- `packages/app/tests/workflow/actions/agent-run-admission.test.ts:15-247` — Added the 48-case `host` × `fleet` × `subprocess` admission matrix suite verifying shared session/role/input guards, blank-prompt handling, timeout validation after the host pause boundary, singular and plural stale-artifact freshness and removal-failure handling, capability/budget/P1-reviewer-independence boundaries, and pinned vs fleet-member executor identities.
- `probe: not-applicable (no public surface changed)`

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/actions/agent-run.ts:78` declared admission capabilities per surface; `packages/app/src/workflow/actions/agent-run.ts:1801-1802` `normalizeAgentInvocation` parses options once; `packages/app/src/workflow/actions/agent-run.ts:596` and `packages/app/src/workflow/actions/agent-run.ts:715` both surfaces admit through it; packages/app 268 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Executor surfaces apply the same declared admission contract (req: R1) | MET | test | `packages/app/tests/workflow/actions/agent-run-admission.test.ts:130` admission matrix across every executor surface — pass this session. |
| R17 — Executor surfaces apply the same declared admission contract | MET | test | `packages/app/tests/workflow/actions/agent-run-admission.test.ts:130` — same matrix; 268 pass / 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1305
**Scope:** working tree diff (`packages/app/src/workflow/actions/agent-run.ts`, `packages/app/tests/workflow/actions/agent-run-admission.test.ts`; no `(1305)` tagged commit yet)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence:** MEDIUM
##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | architecture | No P1–P3 findings: `NormalizedAgentInvocation` and `EXECUTOR_SURFACE_CAPABILITIES` unify option normalization, session/role guards, prompt/timeout checks, and stale-artifact cleanup across host, fleet, and subprocess surfaces while preserving the host work-item pause boundary and 1306 handoff | `packages/app/src/workflow/actions/agent-run.ts:71-149` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/workflow/actions/agent-run.ts:71-149`, `packages/app/src/workflow/actions/agent-run.ts:391-454`, `packages/app/src/workflow/actions/agent-run.ts:583-616`, `packages/app/src/workflow/actions/agent-run.ts:689-1096`, `packages/app/src/workflow/actions/agent-run.ts:1770-1858`, `packages/app/tests/workflow/actions/agent-run-admission.test.ts:15-248` |

**Next:** Proceed to task verdict certification and completion close.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-06T04:54:49.870Z todo → wip (system)
- 2026-11-06T05:01:23.716Z wip → testing (system)
- 2026-11-06T05:01:25.773Z testing → done (system)

