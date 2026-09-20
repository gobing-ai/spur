---
schema_version: 1
name: Validate usage-to-availability decisions with sanitized fixtures and dry-run evidence
status: todo
template: brainstorm
created_at: 2026-09-20T00:51:03.294Z
updated_at: "2026-09-20T00:54:24.426Z"
feature_id: I31

priority: P1
ac_altitude: task-local
---

## 0904. Validate usage-to-availability decisions with sanitized fixtures and dry-run evidence

### Background

Type: `wayfinder:research`. This is the second independent investigation on map I31. It validates the existing usage-to-availability producer and consumer with sanitized fixtures and read-only dry-run evidence. The observed operator-owned `codex-astra` preview mismatch is a confirmed observation to explain; no-usage recovery, provider mapping, stale data, and latency/timeout behavior remain validation targets until reproduced. No quota producer or config write is proposed.

### Requirements

- [ ] R1. Define sanitized fixtures for provider/model mapping, healthy usage, no-usage, provider errors, stale snapshots, operator-owned disabled/enabled records, and project/global configuration precedence; redact auth diagnostic bodies.
- [ ] R2. Run the source-local usage dry-run and compare proposed changes with the consumer's operator-owned protection, including the observed `codex-astra` would-apply versus blocked-update discrepancy at `packages/app/src/services/agent-quota-updates.ts:297-315`.
- [ ] R3. Reproduce or rule out the no-usage selection and all-healthy mapping hypotheses in the usage producer loop (around the cited lines 317-354), and document agent equality/model-prefix mapping behavior with raw snapshots kept sanitized.
- [ ] R4. Verify applied-versus-proposed reporting and project/global write boundaries without persisting changes; show which rows are eligible, protected, unchanged, or unresolved.
- [ ] R5. Measure total and per-provider elapsed time, error/staleness timing, and timeout behavior for an all-provider run. Identify the current timeout owner or record it as unknown; do not add a timeout in this ticket.
- [ ] R6. Deliver a sanitized fixture table, dry-run transcript, decision matrix, latency/timeout observations, and ranked follow-up recommendations in this task's Solution or linked run artifact. Keep unknown outcomes unknown and do not claim implementation.

### Acceptance Criteria

- [ ] AC1 — Sanitized fixtures exercise provider mapping, no-usage, errors, staleness, operator ownership, and project/global precedence.
- [ ] AC2 — The artifact explains the observed operator-owned preview mismatch and separates confirmed observation from hypotheses that did not reproduce.
- [ ] AC3 — Applied-versus-proposed rows and write boundaries are evidenced without changing project or global configuration.
- [ ] AC4 — Latency and timeout ownership are reported with provenance, including an explicit unknown when the underlying timeout cannot be established.

### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

Reuse the existing usage producer, consumer, raw snapshot shape, and dry-run report. Construct minimal sanitized fixtures around the trust and ownership boundaries; compare the preview to the actual update guard instead of adding another classifier. Treat provider mapping as an evidence question, preserve operator-owned records, and keep external scheduling outside this ticket.

### Plan

- [ ] Freeze the fixture schema and redaction rules before reading provider output.
- [ ] Capture a source-local dry-run with elapsed-time provenance and no write mode.
- [ ] Exercise each fixture through proposed/apply classification and owner precedence.
- [ ] Reproduce mapping/no-usage/staleness hypotheses and classify failures or unknowns.
- [ ] Publish the sanitized decision matrix and quota correctness follow-up order.

### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

Not run during charting. The eventual investigation must use sanitized fixtures, read-only or dry-run mode, source-local exit status, and bounded evidence capture; no config mutation or provider-auth diagnostic dump is part of the ticket.

### Review

Open until the investigation runs. Review must verify operator-owned protection, project/global write isolation, redaction, applied-versus-proposed honesty, and that latency/timeout claims are tied to captured timestamps rather than assumptions.

### References

- Map: `docs/features/I31_post-delivery-spur-dev-improvement-roadmap-after-b6-b7-b8-and-g66.md`
- Producer/consumer evidence: B6 usage producer and `packages/app/src/services/agent-quota-updates.ts:297-315`; source-local `agent usage --dry-run --json`
- Related owner: `docs/features/B6_executor-availability-lifecycle-disable-ownership-recovery-global-config-persistence-and-an-explicit-usage-producer.md`
- Configuration boundary: `.spur/config.yaml`, `~/.config/spur/config.yaml`, and the existing project/global loader contract (read-only during this ticket)

### History
