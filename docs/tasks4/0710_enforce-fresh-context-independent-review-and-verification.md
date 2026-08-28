---
schema_version: 1
name: "Enforce fresh-context independent review and verification"
status: todo
template: issue
created_at: 2026-08-28T23:03:05.708Z
updated_at: "2026-08-28T23:09:19.130Z"
priority: P1
tags: ["harness", "agent", "review", "verification"]
dependencies: ["0706"]
feature_id: A6
ac_altitude: task-local
---

## 0710. Enforce fresh-context independent review and verification

### Background

The task pipeline declares reviewer roles for review and verification but also pins both stages to `${vars.agent}`. `AgentRunActionRunner` carries workflow session affinity through `__agentSession` and a target-agent session directory, so a reviewer can resume the implementer's conversational context when the resolved target is the same. A new execution id alone does not guarantee an independent context or executor.

This task makes independence an enforced routing/session property. It reuses the existing role/executor model and adds only the action-level controls required to prove fresh context and, for material risk, a distinct executor.

### Requirements

- [ ] R1. Add an `agent.run` fresh-session option that bypasses inherited workflow session id and session directory for that action without disturbing unrelated session-affinity behavior.
- [ ] R2. Configure built-in review and final verification stages to always use fresh context; implementation context may be summarized only through persisted task/diff/artifact inputs.
- [ ] R3. Record resolved executor/spec/model/session provenance for implement, review, and verify in bounded run evidence.
- [ ] R4. Add a risk policy using existing task priority: P0/P1 work requires review/verify to resolve a different executor spec from implementation; lower priorities require fresh context but may reuse the executor when no alternative exists.
- [ ] R5. Evaluate distinctness after routing and before dispatch. A required-distinct stage with no eligible executor fails closed and names the missing role/capability configuration.
- [ ] R6. Review and verification remain separate executions; neither may inherit the other's session.
- [ ] R7. Reuse the existing reviewer role, executor registry, and routing attribution. Do not create a second agent framework or new role vocabulary.
- [ ] R8. Extend composition tests so pinning review/verify to the implementation session or omitting fresh-session enforcement fails.

Non-goals: consensus voting, multiple reviewers by default, remote identity proof, or forcing distinct providers for low-risk tasks.

### Acceptance Criteria

```gherkin
Feature: Independent review and verification

  Scenario: Reviewer starts without implementation context
    Given implementation completed with a resumable agent session
    When task-pipeline enters review
    Then review dispatch receives no inherited implementation session id or session directory
    And it reads only persisted task, diff, and artifact inputs

  Scenario: Material task requires a distinct executor
    Given a P1 task was implemented by executor spec A
    And reviewer role can resolve executor spec B
    When review and verification dispatch
    Then each uses fresh context and neither resolves to A
    And bounded routing evidence identifies the separation

  Scenario: Missing independent reviewer fails closed
    Given a P0 task and only the implementation executor is eligible for reviewer role
    When review routing is evaluated
    Then no review subprocess starts
    And the failure names the distinct-executor requirement and configuration remedy

  Scenario: Low-risk task still gets fresh context
    Given a P3 task and one eligible executor
    When review runs
    Then the executor may be reused but the implementation session is not
```

### Q&A

**Q: Must every task use a different provider/model?** No. Fresh context is universal. A distinct configured executor
spec is required only for P0/P1 material work; provider diversity is not itself the invariant.

**Q: Can a summary of implementation context be passed?** Only through persisted task, diff, verdict, or bounded artifact
inputs visible to any reviewer. Hidden conversational state is what must not cross the boundary.

**Q: Why use priority as risk?** Task priority already exists and avoids adding a second risk taxonomy for this first
policy. If evidence later shows priority is insufficient, evolve it in a separate task.

**Q: What if only one executor is configured?** P0/P1 fails before review with a precise configuration requirement.
P2-P4 may reuse the executor but still start a fresh session.

### Design

Extend `agent.run` with `freshSession: true` and a small independence requirement referencing a prior action's recorded routing identity. The runner already creates execution ids and records routing attribution; persist only the minimum prior-action identity needed for comparison.

Task-pipeline review and verify remove inherited session reuse and resolve through the existing reviewer role. For P0/P1, compare the selected executor spec against implementation and fail before spawn if equal or absent. For P2-P4, fresh context is mandatory while executor reuse is allowed. Review and verify each start fresh; they may consume the same immutable proof inputs and bounded evidence artifacts.

Do not add a public CLI flag unless an existing surface cannot express workflow vars; prefer internal workflow/action options and current config roles.

### Plan

1. Add failing tests demonstrating session id/directory reuse across implement, review, and verify.
2. Implement `freshSession` at the shared action-runner session-resolution seam.
3. Persist bounded action routing identity for later independence checks.
4. Add a pure priority-to-independence policy and distinct-executor comparison.
5. Update task-pipeline review/verify actions to resolve reviewer role with fresh sessions.
6. Gate P0/P1 dispatch on distinct executor availability; preserve lower-priority fallback.
7. Include routing/session provenance in review/verdict evidence without leaking prompts.
8. Extend composition-baseline and action/service tests.
9. Synchronize workflow, agent-routing, and verification design docs.
10. Run targeted tests, `bun run spur-check`, and task-pipeline definition checks.

### Root Cause

`config/workflows/task-pipeline.yaml` pins implementation, review, and verify to `${vars.agent}` while only annotating the
latter two with `role: reviewer`. In `packages/app/src/workflow/actions/agent-run.ts`, successful dispatch stores a
workflow-scoped `__agentSession` and selects a session directory by target agent. A later action resolving the same target
can continue that session. The separately generated execution id proves a new process invocation, not fresh context or
independent routing.

The defect is therefore stronger than a role-label mismatch: session affinity and explicit agent pinning override the
intended reviewer separation. No policy compares resolved implementation and reviewer executor identities before spawn.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md` — I1 and Wave 4.
- `config/workflows/task-pipeline.yaml` — implement/review/verify agent actions.
- `packages/app/src/workflow/actions/agent-run.ts` — session latch and routing.
- `packages/app/src/services/agent-service.ts`
- `packages/app/src/observability/agent-execution.ts`
- `packages/config/src/index.ts` — role/executor configuration.
- `packages/app/tests/workflow/actions/agent-run.test.ts`
### History
- 2026-08-28 — created from the approved harness comparison implementation lane; researched, decomposed, linked to A6, and passed the task-local readiness gate.
