---
schema_version: 1
name: Feed repeated tool failures to rule-scan as candidates
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:36.439Z
updated_at: "2026-11-18T06:09:03.207Z"
feature_id: I61
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 2

dependencies: ["1398"]
---

## 1400. Feed repeated tool failures to rule-scan as candidates

### Background

`rule-scan` is an agent procedure, not a CLI verb, and it surveys code for recurring patterns (`plugins/sp/skills/spur-cli/references/rules/operations.md` § scan). Its output contract is `{ concern, evidence, evaluator, route: add|extend|covered }`. The doctor's reflection map already sends automatable findings to "rule candidate" (`spur-doctor/SKILL.md:171`).

**Refine corrections (2026-11-17)**
- "Detect repeated tool/error-code pairs" → 1376's payload carries `tool` and `errorCode` on `mcp.tool.failed`, and `system_events.id` provides citable ids. → Add `failureClusters[]` to 1398's `protocolUsage`, so there is no second query path.
- "Emit rule-scan candidates" → scan has no input channel besides code. Spur rules evaluate the working tree, so many tool-failure clusters are not file rules at all (they are guidance or input-validation fixes). → Scan gains an event-evidence hunt source that reads the artifact. Each cluster is routed through the existing placement rule, and adds a `not-a-rule` route that hands off as a task with the finding key.
- "Never activate rules automatically" → already guaranteed, because scan is propose-only and `add` needs confirmation. → Kept as an assertion in the doc, not new code.

### Requirements

- [ ] R1. `protocolUsage.failureClusters[]`: `{ tool, errorCode, count, firstAt, lastAt, sampleEventIds (max 5) }` for `(tool, errorCode)` pairs with `count >= 3` in the window, sorted by count descending.
- [ ] R2. Anatomy finding key `repetition:mcp-tool:<tool>:<errorCode>` per cluster, citing `sampleEventIds` as its evidence anchor.
- [ ] R3. The rule-scan procedure adds an event-evidence source. It reads `spur history analyze --since <30d> --json` → `protocolUsage.failureClusters`, and maps each cluster to a candidate with `evidence: count + sample event ids`. The route list gains `not-a-rule` (→ task carrying the finding key).
- [ ] R4. The scan doc restates that candidates are proposals and rules are written only by `add` on confirmation.

### Acceptance Criteria

- [ ] AC1 — Repeated tool failures become rule candidates (req: R1, R2, R3, R4)

Test layer: domain analytics test on in-memory SQLite, plus the scan procedure documentation (the agent procedure has no executable surface).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T06:09:02.230Z

- **New `spur rule scan` verb?** No. That would be a public-surface change; scan stays an agent procedure reading the artifact.
- **Cluster threshold?** A constant of 3 (the feature says "repeatedly"), the same constant style as 1399.

### Design

**WHAT.** One more fold in 1398's module, one finding key, and a documentation step in the scan procedure. No new verb or table.

**WHY.** It reuses the evidence plane and the propose-only contract already in place. `not-a-rule` stops the scan from forcing a file rule onto a runtime failure.

**WHERE.**
- `packages/domain/src/analytics/protocol-usage.ts`
- `plugins/sp/skills/history-anatomy/references/report-contract.md`
- `plugins/sp/skills/spur-cli/references/rules/operations.md` § scan

**Anti-patterns.**
- No error-message text in clusters (`errorCode` only; `error` is redacted).
- No automatic `add`.
- Don't cluster on argument values.

### Plan

- [ ] Step 1 (test first, R1): extend the 1398 domain test with 3× the same `(tool, errorCode)`, 2× another pair (not clustered) and the window boundary.
- [ ] Step 2: implement the fold.
- [ ] Step 3 (R2-R4): contract key and scan procedure step.
- [ ] Step 4: `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
