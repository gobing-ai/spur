---
schema_version: 1
name: "spur decision noun: list, show, run, status"
status: todo
template: feature-impl
created_at: 2026-10-06T17:55:55.425Z
updated_at: "2026-10-06T18:16:30.071Z"
feature_id: P
priority: P1
tags:
  - decision
  - cli

dependencies: ["1092"]
---

## 1093. spur decision noun: list, show, run, status

### Background

Feature P (docs/design/decision-catalog.md §3.4). Thin commander transport over DecisionService, mirroring apps/cli/src/commands/agent.ts. Covers scenarios R1–R5.

### Requirements

- [ ] R1. `spur decision list [--layer] --json` lists id, type, description, catalog file and layer for every resolvable decision.
- [ ] R2. `spur decision show <id> --json` prints the full entry plus the effective maker and its selecting source without constructing a maker; unknown id exits 1.
- [ ] R3. `spur decision run <id> [--param k=v]... [--evidence <file>]... [--maker <name>] --json` uses the effective maker, exits 0 for every backend outcome and always returns a value from the closed vocabulary; evidence is redacted and bounded; it never writes a workflow result file.
- [ ] R4. `run` rejects unknown id, missing/invalid params, unknown or unregistered maker (flag or config) and unreadable evidence with exit 1 before any backend call.
- [ ] R5. `spur decision status --json` reports the configured default maker, per-decision effective makers with source, registered makers, per-layer catalog counts, load errors and duplicate ids; exits 1 on any catalog or maker-config error.
- [ ] R6. `plugins/sp/skills/spur-cli/references/decision.md` lands in the same change (CLI parity rule), including the `decisions` config keys.

### Acceptance Criteria

- [ ] AC1 — Decision list shows every resolvable decision with its layer and catalog
- [ ] AC2 — Decision show describes one decision without calling a model
- [ ] AC3 — Decision run always returns a concrete answer from the closed vocabulary
- [ ] AC4 — Decision run rejects caller mistakes before any backend call
- [ ] AC5 — Decision status reports readiness and catalog problems per layer
- [ ] AC6 — Global config selects the default DecisionMaker for each decision point

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-06T17:56:36.341Z

- Exit codes: backend outcomes (accepted, low-confidence, no-backend, timeout, error) exit 0; caller mistakes exit 1 before any backend call (design §3.4).
- `status` is readiness only (switch, makers, catalog errors); history deferred.
- No server/oRPC/Board surface in this feature.

### Design

Command file is transport only; all logic stays in DecisionService (ADR-021). Reuse the standard output envelope and redactAndBound from the decide path rather than a second redaction helper. Backend outcomes are data, not errors, so exit 0 keeps scripts able to branch on `reason`; caller mistakes are exit 1.

### Plan

1. E2E CLI tests against a temp project with a fixture catalog (no backend).
2. Implement decision.ts and register the noun.
3. spur-cli reference.
4. `bun link`, `build:bundle`, `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
