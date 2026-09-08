---
schema_version: 1
name: Respect executor disabled state in routing and doctor
status: done
template: feature-impl
created_at: 2026-09-07T17:12:18.719Z
updated_at: "2026-09-07T22:15:55.757Z"
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

- [x] R1. Accept only omitted or boolean agent.executors[].disabled in Zod and the shipped JSON Schema; apply false after global/project raw merge so global true survives project omission and explicit project false overrides it.
- [x] R2. Preserve legacy config inputs and reject string, null and numeric disabled values consistently across runtime and shipped schema validation.
- [x] R3. Exclude disabled profiles from role/default/stage/workflow/escalation and role-based team selection while retaining their config/reference identity; no enabled candidate must produce an actionable nonzero resolution failure.
- [x] R4. Reject explicit disabled profile pins before spawn, including team/workflow references and a profile name colliding with a canonical binary; never silently substitute a profile or binary, and leave already-running invocations intact.
- [x] R5. Show disabled entries in doctor inventory and matching role ladders with disabled true, usable false, no probes and no election; preserve the elected enabled row at agents[0] and invalidate cached eligibility when the flag changes.
- [x] R6. Make doctor inventory ignore intentional disables for health failure aggregation; targeted disabled checks and all-disabled role checks fail while a healthy enabled fleet succeeds.

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
| ---------------------- |
| `apps/cli/src/commands/agent.ts:14` |
| `apps/cli/src/commands/agent.ts:582` |
| `apps/cli/tests/commands/agent.test.ts:708` |
| `packages/app/src/services/agent-service.ts:103` |
| `packages/app/src/services/agent-service.ts:1843` |
| `packages/app/src/services/agent-service.ts:1939` |
| `packages/app/src/services/agent-service.ts:2106` |
| `packages/app/src/services/agent-service.ts:2330` |
| `packages/app/src/services/agent-service.ts:2332` |
| `packages/app/src/services/agent-service.ts:2338` |
| `packages/app/src/services/agent-service.ts:2555` |
| `packages/app/src/services/agent-service.ts:2574` |
| `packages/app/src/services/agent-service.ts:2599` |
| `packages/app/src/services/agent-service.ts:2614` |
| `packages/app/src/services/agent-service.ts:2667` |
| `packages/app/src/services/agent-service.ts:2700` |
| `packages/app/src/services/agent-service.ts:2710` |
| `packages/app/src/services/agent-service.ts:2735` |
| `packages/app/src/services/agent-service.ts:2737` |
| `packages/app/src/services/agent-service.ts:2747` |
| `packages/app/src/services/agent-service.ts:2764` |
| `packages/app/src/services/agent-service.ts:2845` |
| `packages/app/src/services/agent-service.ts:491` |
| `packages/app/src/services/agent-service.ts:524` |
| `packages/app/src/services/agent-service.ts:548` |
| `packages/app/src/services/agent-service.ts:553` |
| `packages/app/src/services/agent-service.ts:556` |
| `packages/app/src/services/agent-service.ts:560` |
| `packages/app/src/services/agent-service.ts:606` |
| `packages/app/src/services/agent-service.ts:623` |
| `packages/app/src/services/agent-service.ts:693` |
| `packages/app/src/services/team-service.ts:16` |
| `packages/app/src/services/team-service.ts:3` |
| `packages/app/src/services/team-service.ts:32` |
| `packages/app/src/services/team-service.ts:722` |
| `packages/app/src/services/team-service.ts:754` |
| `packages/app/tests/services/agent-service.test.ts:1561` |
| `packages/app/tests/services/agent-service.test.ts:1965` |
| `packages/app/tests/services/agent-service.test.ts:2090` |
| `packages/app/tests/services/agent-service.test.ts:2106` |
| `packages/app/tests/services/agent-service.test.ts:2206` |
| `packages/app/tests/services/agent-service.test.ts:2266` |
| `packages/app/tests/services/agent-service.test.ts:2398` |
| `packages/app/tests/services/agent-service.test.ts:243` |
| `packages/app/tests/services/agent-service.test.ts:2539` |
| `packages/app/tests/services/agent-service.test.ts:2636` |
| `packages/app/tests/services/agent-service.test.ts:2648` |
| `packages/app/tests/services/agent-service.test.ts:2658` |
| `packages/app/tests/services/agent-service.test.ts:2678` |
| `packages/app/tests/services/agent-service.test.ts:2694` |
| `packages/app/tests/services/agent-service.test.ts:2731` |
| `packages/app/tests/services/agent-service.test.ts:2751` |
| `packages/app/tests/services/agent-service.test.ts:2900` |
| `packages/app/tests/services/agent-service.test.ts:2965` |
| `packages/app/tests/services/agent-service.test.ts:3055` |
| `packages/app/tests/services/agent-service.test.ts:3057` |
| `packages/app/tests/services/agent-service.test.ts:3338` |
| `packages/app/tests/services/agent-service.test.ts:3563` |
| `packages/app/tests/services/agent-service.test.ts:3639` |
| `packages/app/tests/services/agent-service.test.ts:3667` |
| `packages/app/tests/services/agent-service.test.ts:3738` |
| `packages/app/tests/services/agent-service.test.ts:3742` |
| `packages/app/tests/services/agent-service.test.ts:3745` |
| `packages/app/tests/services/agent-service.test.ts:3872` |
| `packages/app/tests/services/agent-service.test.ts:3911` |
| `packages/app/tests/services/agent-service.test.ts:3956` |
| `packages/app/tests/services/agent-service.test.ts:3974` |
| `packages/app/tests/services/agent-service.test.ts:3991` |
| `packages/app/tests/services/agent-service.test.ts:4001` |
| `packages/app/tests/services/agent-service.test.ts:4013` |
| `packages/app/tests/services/agent-service.test.ts:492` |
| `packages/app/tests/services/agent-service.test.ts:512` |
| `packages/app/tests/services/agent-service.test.ts:541` |
| `packages/app/tests/services/agent-service.test.ts:564` |
| `packages/app/tests/services/agent-service.test.ts:588` |
| `packages/app/tests/services/agent-service.test.ts:611` |
| `packages/app/tests/services/agent-service.test.ts:636` |
| `packages/app/tests/services/agent-service.test.ts:664` |
| `packages/app/tests/services/agent-service.test.ts:698` |
| `packages/app/tests/services/team-service.test.ts:1659` |
| `packages/config/src/index.ts:301` |
| `packages/config/src/index.ts:314` |
| `packages/config/src/index.ts:317` |
| `packages/config/src/index.ts:534` |
| `packages/config/tests/config-schemas.test.ts:144` |
| `packages/config/tests/config-schemas.test.ts:3` |
| `packages/config/tests/loader-layers.test.ts:434` |
| `packages/config/tests/loader.test.ts:862` |
| `packages/config/tests/team-config.test.ts:336` |
| `packages/config/tests/team-config.test.ts:361` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | packages/config/tests/loader-layers.test.ts "disabled flag layering (0796)" (global true survives project omission; project false overrides); config-schemas.test.ts "AgentExecutorConfigSchema disabled (0796)" omitted→false |
| R2 | MET | config-schemas.test.ts rejects 'yes'/'true'/null/1/{}; loader.test.ts "disabled JSON schema round-trip (0796)" rejects disabled: "yes" via loadSpurConfig with validateJsonSchema true and false |
| R3 | MET | agent-service.test.ts "disabled executors (0796)": stage-walk skip keeps resolving to enabled 'omp'; resolveRole all-tier-eligible-disabled names tried "disabled: cap-exec"; resolveStageModelPolicy filters e.disabled === true |
| R4 | MET | agent-service.test.ts explicit pin → exit 2 + "agent.executors.<name>.disabled: true — enable it or select another executor", no spawn; team-service.test.ts materializeTeam pins disabled executor; apps/cli agent.test.ts --drain fails loud on pinned disabled executor |
| R5 | MET | agent-service.test.ts doctor synthesizes non-probed disabled rows (tier 2, usable false, "disabled by config"); fingerprint toggle invalidates cache; elected enabled row stays agents[0] |
| R6 | MET | agent-service.test.ts all-disabled fleet exits 0; named disabled executor exits 1 with its row; team resolveRole fails when every eligible executor is disabled |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R1 — Legacy configuration and layered overrides preserve availability | MET | test | packages/config/tests/loader-layers.test.ts "disabled flag layering (0796)" |
| R2 — Executor disabled values are strictly boolean | MET | test | packages/config/tests/config-schemas.test.ts + loader.test.ts schema round-trip rejections |
| R3 — Automatic routing excludes disabled executors | MET | test | packages/app/tests/services/agent-service.test.ts stage-walk/role-ladder exclusion |
| R4 — Explicit disabled executor references fail before spawn | MET | test | agent pin exit 2 + team-service materializeTeam + CLI drain tests |
| R5 — Doctor displays exclusions without electing or probing them | MET | test | agent-service doctor synthetic rows + fingerprint toggle tests |
| R6 — Doctor exit status distinguishes inventory and explicit checks | MET | test | agent-service all-disabled exit 0 / named disabled exit 1 tests |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-07T22:15:55.757Z todo → done (system)
