---
schema_version: 1
name: Respect executor disabled state in routing and doctor
status: todo
template: feature-impl
created_at: 2026-09-07T17:12:18.719Z
updated_at: "2026-09-07T17:12:18.732Z"
feature_id: B5
priority: P2
tags:
  - executor-availability

---

## 0796. Respect executor disabled state in routing and doctor

### Background

Executor profiles currently lack disabled state; role selection, explicit pins, team materialization, fallback filters and doctor caching can each select the same profile. This deliverable makes a manually disabled profile visible but unlaunchable without changing the current event infrastructure.

Implements:
- R1 — Legacy configuration and layered overrides preserve availability
- R2 — Executor disabled values are strictly boolean
- R3 — Automatic routing excludes disabled executors
- R4 — Explicit disabled executor references fail before spawn
- R5 — Doctor displays exclusions without electing or probing them
- R6 — Doctor exit status distinguishes inventory and explicit checks

Approved design: docs/design/executor-availability.md; ADR-111. Planning run: bd360df4-561f-40f5-94a7-ae7132c55984.
Rubric: E6 D1 L3 C1 R1 = 12; estimated 6h. Retain this cohesive deliverable; tests and doc sync are included rather than split into phase tasks.

### Requirements

- [ ] R1. Accept only omitted or boolean agent.executors[].disabled in Zod and the shipped JSON Schema; apply false after global/project raw merge so global true survives project omission and explicit project false overrides it.
- [ ] R2. Preserve legacy config inputs and reject string, null and numeric disabled values consistently across runtime and shipped schema validation.
- [ ] R3. Exclude disabled profiles from role/default/stage/workflow/escalation and role-based team selection while retaining their config/reference identity; no enabled candidate must produce an actionable nonzero resolution failure.
- [ ] R4. Reject explicit disabled profile pins before spawn, including team/workflow references and a profile name colliding with a canonical binary; never silently substitute a profile or binary, and leave already-running invocations intact.
- [ ] R5. Show disabled entries in doctor inventory and matching role ladders with disabled true, usable false, no probes and no election; preserve the elected enabled row at agents[0] and invalidate cached eligibility when the flag changes.
- [ ] R6. Make doctor inventory ignore intentional disables for health failure aggregation; targeted disabled checks and all-disabled role checks fail while a healthy enabled fleet succeeds.

### Acceptance Criteria

```gherkin
Feature: Respect executor disabled state in routing and doctor

  @core
  Scenario: R1 — Legacy configuration and layered overrides preserve availability
    Given global and project executor entries omit disabled
    When the merged configuration is loaded
    Then effective disabled is false; a global true survives project omission and an explicit project false overrides it

  @core
  Scenario: R2 — Executor disabled values are strictly boolean
    Given an executor declares disabled as a string, null, or number
    When Zod and the shipped JSON Schema validate the configuration
    Then both reject it while accepting omitted, true, and false values

  @core
  Scenario: R3 — Automatic routing excludes disabled executors
    Given the cheapest eligible executor is disabled and another enabled candidate exists
    When role, default, workflow, escalation, or role-based team selection runs
    Then only enabled candidates may launch and an all-disabled candidate set fails with a nonzero resolution error

  @core
  Scenario: R4 — Explicit disabled executor references fail before spawn
    Given a disabled executor is explicitly pinned by agent run, a workflow, or a team member
    When execution resolves the reference
    Then it returns a disabled-executor error before spawning and never substitutes a binary or another executor

  @core
  Scenario: R5 — Doctor displays exclusions without electing or probing them
    Given the inventory contains disabled and enabled usable executors
    When doctor renders the inventory or a role ladder in text and JSON
    Then disabled entries remain visible with disabled true and usable false, receive no health probe or election, and successful role JSON places its enabled elected entry first

  @core
  Scenario: R6 — Doctor exit status distinguishes inventory and explicit checks
    Given an enabled healthy executor and a disabled executor are configured
    When full-inventory, explicit-disabled, and all-disabled-role doctor checks run
    Then the healthy inventory succeeds, the explicit-disabled check fails, and the all-disabled role fails
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Use the existing executor schema and eligibility funnels; do not filter entries out of merged configuration. Final launch guards preserve explicit-pin semantics and cover previously materialized team/spec references. The default is effective disabled === true for exclusion, so existing typed callers that omit the optional input continue to work; update fixtures where inferred parsed types now require the defaulted field.

Owned surfaces: packages/config/src/index.ts; apps/cli/schemas/spur-config.schema.json; packages/app/src/services/agent-service.ts and team-service.ts; workflow/spec launch callers discovered from those funnels; config/config.example.yaml. Inspect all callers of resolveExecutor and cheapestEligibleExecutors before editing, plus independent stage/escalation filters. Add/update tests in packages/config/tests/config.test.ts, loader-layers.test.ts, config-schemas.test.ts and packages/app/tests/services/agent-service.test.ts, team-service.test.ts. Extend CLI doctor output tests where the transport shape is asserted.

Decisions: profile-specific exclusion; explicit pins fail; automatic paths may fall through; canonical binaries without profile attribution are not account-wide disabled. Keep disabled rows inspectable and health probing read-only. Refresh only availability needed at launch, preserving composition-root config ownership; full event-triggered refresh integration belongs to the final server task.

Dependencies: none. Premises verified against current source: raw layers merge by name before validation; role/team share an eligibility helper while explicit paths remain separate; doctor probes have a fingerprint cache. The schema remains additive and no public noun/verb or new flag is introduced.

Anti-patterns: defaulting input layers before merge; removing disabled entries from config; masking explicit pins with fallback; trusting a stale materialized agent/model pair; reusing doctor usable values without applying current disabled state.

Preserve unrelated/concurrent edits. Start implementation in a clean isolated working tree; one writer and one conventional commit per task. No .env, workflow, IAM or deployment changes are needed.

### Plan

1. [ ] Add failing schema/merge and disabled-routing regression cases using temporary configs and fake runners; avoid live model probes.
2. [ ] Add the boolean schema/default and shipped JSON Schema/example change; preserve merge precedence and input compatibility.
3. [ ] Trace shared and independent selection callers, filter automatic candidates, and add final launch guards for named pins and materialized team references.
4. [ ] Render disabled doctor entries and implement inventory/targeted exit behavior; update cache fingerprint and election logic.
5. [ ] Run focused config/app/CLI checks from their workspaces, then required project lint/type/test/build/spur gates for this task's final diff.
6. [ ] Synchronize docs/04_DESIGN.md and the accepted executor-availability satellite, and the affected 03 selection mechanism; record verify PASS through the task pipeline and commit only this task.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
