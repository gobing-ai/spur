---
schema_version: 1
name: "A2A inspection: agent card JSON, a2a snippets, outbound auth state and trace links"
status: todo
template: issue
created_at: 2026-11-23T00:55:57.547Z
updated_at: "2026-11-23T00:55:57.648Z"
feature_id: A82

---

## 1440. A2A inspection: agent card JSON, a2a snippets, outbound auth state and trace links

### Background

Captured from the creation title: "A2A inspection: agent card JSON, a2a snippets, outbound auth state and trace links".

### Requirements

- [ ] R1. Add inline Agent Card JSON and the `a2a card get` / `a2a send` CLI snippets to `apps/web/src/modules/integrations/A2aTab.tsx`.
- [ ] R2. Add `authEnv` / `tokenPresent` and the remote task/context/branch refs to `integrationsOutboundMemberSchema` (`packages/contracts/src/integrations.ts`) and render them.
- [ ] R3. Link an A2A row to its trace and warn when `a2a.enabled && inbound.length === 0` (no fleet member would answer) — A82 design gap G3.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. Extend the outbound member contract and its server projection (R2).
2. Render the card JSON, the snippets, the outbound auth state and the trace deep link in `A2aTab` (R1, R3).
3. Add the empty-fleet warning to the A2A tab (R3).
4. Component tests for each rendered block and the warning.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
