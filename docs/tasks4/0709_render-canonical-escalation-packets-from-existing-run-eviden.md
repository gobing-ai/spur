---
schema_version: 1
name: "Render canonical escalation packets from existing run evidence"
status: todo
template: issue
created_at: 2026-08-28T23:03:05.689Z
updated_at: "2026-08-28T23:09:18.872Z"
priority: P1
tags: ["harness", "workflow", "escalation", "observability"]
dependencies: ["0708"]
feature_id: A6
ac_altitude: task-local
---

## 0709. Render canonical escalation packets from existing run evidence

### Background

When a run fails, Spur can already preserve workflow logs, task reports, verdicts, artifacts, system events, retry counts, and messages. The evidence is fragmented across files and stores, so an operator or successor agent must reconstruct the incident before deciding whether to retry, change scope, or intervene.

This task composes existing references into one bounded, redacted escalation packet. The packet is a projection, not a new source of truth, and is emitted when an operational trip wire or terminal workflow failure requires a decision.

### Requirements

- [ ] R1. Define a versioned escalation packet with goal/task/feature identity, workflow/run/action/execution ids, current lifecycle state, proof digest when available, attempt/budget/capability summary, last failed gate, artifact/event references, and one explicit unresolved operator decision.
- [ ] R2. Build the packet from existing run/task/artifact/event references; do not copy complete logs, prompts, stdout, stderr, or task bodies into it.
- [ ] R3. Apply the existing recursive secret redaction and payload bounds before persistence or event projection.
- [ ] R4. Persist a canonical JSON artifact under the existing run artifact ownership and optionally render Markdown from that JSON for humans. JSON remains the projection source.
- [ ] R5. Packet generation must be idempotent for the same run/failure fingerprint and must not create duplicate messages on retry.
- [ ] R6. Emit a bounded `workflow.escalation.created` event that references the artifact rather than embedding it.
- [ ] R7. Generation failure must not erase or replace the original run failure; record a secondary diagnostic and preserve all source artifacts.
- [ ] R8. Reuse current workflow artifact, event, and message mechanisms; add no database table, event bus, or public CLI noun.

Non-goals: automatic remediation, automatic operator messaging outside Spur, a ticketing integration, or summarization by an additional model call.

### Acceptance Criteria

```gherkin
Feature: Canonical escalation packet

  Scenario: Trip wire creates one actionable packet
    Given a run fails because its hard budget trip wire fired
    When the failure path records escalation
    Then one versioned JSON artifact identifies the task, run, action, observed budget, evidence references, and required operator decision
    And the system event references that artifact

  Scenario: Sensitive and unbounded content stays out
    Given source logs contain a secret-shaped field and large stdout
    When the packet is projected
    Then the secret is redacted
    And stdout is represented only by its bounded artifact reference

  Scenario: Retry is idempotent
    Given the same run failure is processed twice
    When escalation projection runs again
    Then no duplicate packet or duplicate external message is created

  Scenario: Projection failure preserves the incident
    Given packet persistence fails
    When the workflow records failure
    Then the original failure and source artifacts remain intact and a secondary diagnostic is emitted
```

### Q&A

**Q: Why JSON first?** It provides a versioned machine contract and supports deterministic Markdown rendering. Markdown
alone would force later consumers to parse prose.

**Q: Should the packet include logs?** No. Include bounded artifact references and a short normalized failure reason.
Copying logs multiplies sensitive/unbounded content and creates freshness ambiguity.

**Q: Should an LLM summarize the incident?** No. The required fields are already structured, and escalation must still
work when the agent/provider is unavailable or exhausted.

**Q: Where is it stored?** Under existing run-artifact ownership and registered with the current artifact mechanism. No
new table or external messaging integration is required.

### Design

Add a deterministic escalation projector in `packages/app` that accepts bounded identifiers/outcomes and resolves references through existing stores. Persist `<runId>-escalation.json` as a run artifact; a minimal Markdown renderer may produce `<runId>-escalation.md` from the JSON for local handoff.

Use a stable failure fingerprint from run id, action id, policy/gate id, and evidence digest to make writes idempotent. The unresolved decision is selected from a closed vocabulary such as retry, revise requirements, grant capability, raise budget, or inspect failure; include concise reason/context, not free-form hidden inference.

Wire the projector to the trip-wire and terminal failure path. Keep source authorities unchanged.

### Plan

1. Inventory existing run report, artifact, system-event, verdict, budget, and routing references.
2. Define the minimal versioned packet schema and closed decision vocabulary.
3. Implement a pure bounded/redacted projection with failure fingerprint.
4. Persist the JSON through existing run-artifact ownership; add Markdown rendering only if an existing handoff consumer needs it.
5. Invoke projection on trip-wire and eligible terminal failure paths.
6. Emit the reference-only system event and prevent duplicate emission.
7. Add tests for complete, partially unavailable, redacted, oversized, duplicate, and projector-failure cases.
8. Update run-record/actionable-observability design docs.
9. Run targeted service/event tests, `bun run spur-check`, and `bun run test-cf` if transport projections change.

### Root Cause

Run failures are represented across multiple existing projections: workflow state/logs, `.spur/run` reports and
artifacts, task verdicts, system events, agent routing records, and messages. Each source is useful, but no bounded
artifact resolves the references and states the exact operator decision needed. Handover therefore requires a reader to
reconstruct correlation, latest gate, attempts, proof state, and artifact paths manually.

The root cause is projection fragmentation. Persisting another authoritative incident record would worsen it; the correct
fix is a deterministic, idempotent projection over the current authorities.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md` — I5 and Wave 3.
- `docs/design/run-record-contract.md`
- `docs/design/workflow-run-log.md`
- `docs/design/actionable-observability-context.md`
- `packages/app/src/services/system-event-emitter.ts`
- `packages/app/src/services/system-event-envelope.ts`
- `packages/app/src/services/workflow-service.ts`
- `packages/app/src/workflow/observability.ts`
### History
- 2026-08-28 — created from the approved harness comparison implementation lane; researched, decomposed, linked to A6, and passed the task-local readiness gate.
