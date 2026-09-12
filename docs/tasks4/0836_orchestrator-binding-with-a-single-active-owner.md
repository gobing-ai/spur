---
schema_version: 1
name: Orchestrator binding with a single active owner
status: todo
template: feature-impl
created_at: 2026-09-12T04:53:38.723Z
updated_at: "2026-09-12T04:56:44.691Z"
feature_id: G62
priority: P1
tags:
  - g6-program

dependencies: ["0835"]
---

## 0836. Orchestrator binding with a single active owner

### Background

`orchestrator` is not a legal role: `AGENT_ROLE_NAMES` is the closed set
`['scribe','coder','reviewer','planner']` and config validation rejects anything else
(`packages/config/src/index.ts:153-156`, `:379-382`). The G6 strategy prototype therefore binds a
**planner-role** instance carrying `purpose: "orchestrator"` as a prompt-side convention, with no
schema change (`docs/reports/g6-strategy-prototype.md` §2).

Nothing today plays this part. The Board's Inbox "Supervisor" tab is only a filter for a literal
endpoint string (`apps/web/src/modules/inbox/SupervisorTab.tsx:4`), and `SupervisorService` is process
supervision — it makes no product decisions.

The approved design is explicit that one active orchestrator owner is enforced at the runtime claim
boundary, not by role naming
(`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md` § "Strategy and capacity").

### Requirements

- **R1** — Exactly one explicitly configured orchestrator per project, bound to a real fleet member.
- **R2** — Decide and implement the binding carrier: a persisted `purpose` field versus a config-side
  annotation on a planner-role instance. Adding an `orchestrator` role value is a separate consented
  role-vocabulary change and is not assumed here.
- **R3** — One active orchestrator owner is enforced at the claim boundary; a second claimant is refused.
- **R4** — Orchestrator missing (none bound) and orchestrator offline (bound but unreachable) are
  distinct, readable states.
- **R5** — A project with zero agents or no binding resolves cleanly and reports what is missing rather
  than failing opaquely.

### Acceptance Criteria

```gherkin
Feature: Orchestrator binding with a single active owner

  @core
  Scenario: One member is the project's orchestrator
    Given a project fleet with a bound orchestrator
    When the runtime resolves the project
    Then exactly one member is reported as the orchestrator

  @core
  Scenario: A second owner cannot claim the role
    Given an active orchestrator owner holds the claim
    When another process attempts to act as orchestrator for the same project
    Then the claim is refused

  @core
  Scenario: Missing and offline are different answers
    Given a project with no bound orchestrator and a project whose bound orchestrator is unreachable
    When each is inspected
    Then the first reports missing and the second reports offline

  @core
  Scenario: An empty fleet still resolves
    Given a project with zero declared agents
    When the project is opened
    Then it resolves successfully and names what is missing
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [G62 — Project fleet, orchestrator binding, and rest/GTD strategy runtime](../features/G62_project-fleet-orchestrator-binding-and-rest-gtd-strategy-runtime.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Strategy and capacity"
- Evidence: [G6 strategy prototype](../reports/g6-strategy-prototype.md) §2 reused-vs-simulated contract
- Code: `packages/config/src/index.ts:153-156`, `:379-382` (closed role vocabulary); `apps/web/src/modules/inbox/SupervisorTab.tsx:4`
- Governance: public-surface consent for any role-vocabulary change — `docs/design/harness-surface-governance.md`

### History
