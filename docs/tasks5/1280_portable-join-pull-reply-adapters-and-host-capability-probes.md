---
schema_version: 1
name: Portable join/pull/reply adapters and host capability probes
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:38.144Z
updated_at: "2026-10-22T07:02:19.953Z"
feature_id: G75
priority: P1
tags:
  - fleet
  - performance

dependencies: ["1279"]
---

## 1280. Portable join/pull/reply adapters and host capability probes

### Background

Implements: R2 — Codex Claude Code and Pi participate through portable inbox adapters.
Work packages B0 + B2. Generated per-platform adapters are installed through Superskill, never hand-maintained. Runs after the lease renewal task.
Rubric: E6 D1 L2 C1 R1 = 11 → own task (plugin surface, distinct review).

### Requirements

- [ ] R1. Record exact host binary and mode provenance and a supported/unsupported native wake capability per Codex, Claude Code and Pi.
- [ ] R2. Each host joins, waits for a bounded inbox request, performs the work and replies with hooks absent, through the durable inbox.
- [ ] R3. An unsupported native wake channel is reported as an explicit pull-only capability.

### Acceptance Criteria

- [ ] AC1 — Codex Claude Code and Pi participate through portable inbox adapters

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: harden the existing sp:fleet-join skill flow (join → bounded wait → reply → leave) and probe hosts per mode.
Rejected: polling via repeated model turns or terminal commands; new messaging transport.
Invariants: hooks are acceleration only; generated adapters via superskill install.

### Plan

1. Capability probe per host/mode.
2. Skill flow hardening.
3. E2E per host with hooks absent (opt-in real hosts, fixture otherwise).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
