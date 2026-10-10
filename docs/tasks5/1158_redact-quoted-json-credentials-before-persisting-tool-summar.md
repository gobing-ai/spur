---
schema_version: 1
name: Redact quoted JSON credentials before persisting tool summaries
status: todo
template: feature-impl
created_at: 2026-10-10T07:29:39.093Z
updated_at: "2026-10-10T07:29:43.157Z"
feature_id: H21

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
---

## 1158. Redact quoted JSON credentials before persisting tool summaries

### Background

scrubSecrets misses quoted JSON keys, persisting plaintext password and token values in token-ledger.jsonl Evidence: `plugins/sp/hooks/context-post-tool.ts:93` and `plugins/sp/hooks/context-post-tool.ts:316`. Review a71c confirmed this using buildToolSummary with curl JSON password and token fields, using synthetic credential values only. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

### Requirements

- [ ] R1. Recognize quoted sensitive keys and redact complete quoted values, including escaped quotes, before summary truncation and ledger persistence
- [ ] R2. Existing assignment, provider-token and authorization redaction remains effective and harmless command context remains readable
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Reproducing edge case is safe (req: R1, R3)
  Given a tool command containing JSON password, token and API-key fields with spaces and escaped quotes
  When a tool summary is built and persisted
  Then neither the returned event nor ledger bytes contains the synthetic credential values

Scenario: AC2 — Existing behavior remains supported (req: R2, R3)
  Given existing assignment and provider-prefix secret samples
  When the existing supported operation executes
  Then Existing assignment, provider-token and authorization redaction remains effective and harmless command context remains readable
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Recognize quoted sensitive keys and redact complete quoted values, including escaped quotes, before summary truncation and ledger persistence Chosen direction follows the existing local seams. Reject redacting after truncation or matching only unquoted key assignments. Targets: plugins/sp/hooks/context-post-tool.ts; plugins/sp/tests/hooks/token-estimate.test.ts; affected generated hook adapters if applicable. Out of scope: logging unrelated event families or changing token accounting.

### Plan

1. Add a failing regression for AC1 using buildToolSummary with curl JSON password and token fields, using synthetic credential values only.
2. Implement the chosen direction in plugins/sp/hooks/context-post-tool.ts; plugins/sp/tests/hooks/token-estimate.test.ts; affected generated hook adapters if applicable.
3. Run tests/hooks/token-estimate.test.ts from its workspace and confirm AC1 plus existing happy paths; run the project gate.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`plugins/sp/hooks/context-post-tool.ts:93` and `plugins/sp/hooks/context-post-tool.ts:316`

### History

- 2026-10-10T07:29:43.157Z backlog → todo (system)

