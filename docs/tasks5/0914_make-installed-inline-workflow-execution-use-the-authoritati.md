---
schema_version: 1
name: Make installed inline workflow execution use the authoritative application boundary
status: todo
template: standard
created_at: 2026-09-22T02:56:46.296Z
updated_at: "2026-09-22T02:57:57.012Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w01
estimate_hours: 8

ac_altitude: task-local
---

## 0914. Make installed inline workflow execution use the authoritative application boundary

### Background

The inline-run-setup helper explicitly requires a repository checkout, although interactive commands are intended to work through an installed plugin. Existing setup, fingerprint, action and close operations already own the necessary semantics. Reuse them; do not add a second journal. Covers proposed feature R1.

Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registered under accepted feature D63; W01 is the planning cross-reference. Refine against concurrent changes before implementation.

Rubric: E8 D1 L2 C1 R1 = 13. One vertical deliverable and rollback boundary; keep its coupled implementation and verification together. Split further only if refinement reveals a separate outcome or exceeds the size limit.

### Requirements

- [ ] R1. Make supported inline setup, fingerprint, action recording and terminal closure work from a bundle-only installation with no repository source imports.
- [ ] R2. Use the existing application resolver, run identity, persistence and fingerprint owners; preserve source-layer precedence and refusal of incompatible attachments.
- [ ] R3. Keep action-observation failure distinct from mandatory identity/terminal bookkeeping failure; document unsupported inline capabilities explicitly.
- [ ] R4. Update the inline driver, affected command consumers and generated plugin artifacts together without adding an unreviewed public CLI surface.

### Acceptance Criteria

- [ ] AC1 — An isolated installed-plugin fixture with no checkout performs authoritative setup and closure and exposes the same definition identity as the application resolver. (req: R1)
- [ ] AC2 — Project override, registered config and shared fallback fixtures use the application precedence and reject incompatible run attachments. (req: R2)
- [ ] AC3 — A failed action observation remains reported without fabricating success for failed identity setup or terminal closure, and unsupported capabilities are named. (req: R3)
- [ ] AC4 — Affected callers and generated artifacts pass installation/script-contract checks with no duplicate persistence policy or undeclared public verb. (req: R4)
- [ ] AC5 — Installed and source execution preserve authoritative identity (req: R1)

Feature-level traceability: this task delivers D63 scenario R1; AC1–AC4 give its task-local regression evidence.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

First test a narrow generated plugin bundle of the existing application boundary using scripts/commands/bundle-plugin-lib.ts. Keep persistence and proof policy in packages/app. Inspect transitive runtime/native dependencies and binary compatibility before choosing this packaging path. If it cannot be shipped safely, stop that design branch and present the minimum existing-noun API alternative for operator decision. Do not bundle the entire CLI or duplicate SQL. Inline run.artifact currently uses a documented registration-equivalent convention; do not claim a ledger write or engine-resume parity that does not exist.

### Plan

- [ ] 1. Trace all setup/fingerprint/action/close callers and classify their runtime dependencies and installed-path resolution.
- [ ] 2. Implement the smallest viable portable bridge and wire the existing consumers through it.
- [ ] 3. Update source-layer documentation to the actual resolver and generate portable artifacts through the existing toolchain.
- [ ] 4. Exercise source and isolated bundle-only fixtures, wrong digest/run/workdir attachment, trace failure and terminal-close failure; run plugin and relevant source gates.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
