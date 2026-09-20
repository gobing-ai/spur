---
schema_version: 1
name: Fix wayfinder tagging and detect semantic section-operand drift
status: todo
template: feature-impl
created_at: 2026-09-20T15:48:46.076Z
updated_at: "2026-09-20T15:49:19.085Z"
feature_id: I7
priority: P2
tags:
  - i31-next-batch
estimate_hours: 3

ac_numbering: task-local
ac_altitude: task-local
---

## 0906. Fix wayfinder tagging and detect semantic section-operand drift

### Background

I31/0903 reconfirmed the I6/0594 wrong-operand defect. Feature I7 already owns both the recipe and enforcement. Keep these together because the corrected recipe is the positive fixture for the scanner.

### Requirements

- [ ] R1. Correct the source wayfinder tagging recipe to `spur feature update <id> --field tags --value wayfinder-map`; remove executable wrong tagging examples from shipped plugin prose.
- [ ] R2. Extend the existing surface-drift inventory to report literal task/feature update invocations that use --section for a metadata-only operand, while accepting genuine body sections. Preserve existing noun/verb/flag checks.
- [ ] R3. Keep the same recipe available to CLI-only skill consumers and verify the source fallback without hand-editing installed/generated adapters.

### Acceptance Criteria

- [ ] AC1 — wayfinder tags a map through --field, not --section (req: R1)
- [ ] AC2 — the parity harness flags --section on a frontmatter key (req: R2)
- [ ] AC3 — a platform without slash commands still sees the correct recipe (req: R3)

### Q&A

Ready freeze — 2026-09-20, inline planning owner.

- Q: Implement now or prepare delegation? A: Prepare a reviewable implementation-ready task; production implementation belongs to the delegated coding agent.
- Q: Is I31 evidence sufficient? A: The reports identify candidate defects; current source anchors substantiate the bounded fixes. The implementation starts with executable regression evidence. Sparse 0905 runs do not authorize trace/cost redesign.
- Q: Dependencies and execution order? A: No unfinished semantic upstream dependency. I31 tasks 0903/0904/0905 are done. Recommended serial order: 0906 → 0907 → 0908 → 0909. Parallel work requires isolated worktrees and serial integration; 0907/0908 share a design satellite.
- Q: Which scope choices remain open? A: None required for this task. Requirements and Design freeze the implementation behavior; freshness policy, installed role propagation, fleet receipts and cost attribution are separate follow-ups.
- Q: Feature traceability? A: I7 R1-R3 ↔ AC1-AC3 respectively. Task-local AC describe the implementation checks without redefining feature shipment criteria.
- Q: How is this checked? A: Focused tests listed in Plan, then `bun run spur-check`, task verify PASS and a separate task commit. Run `bun run spur-check-feature` once per completed feature (after both tasks for B61). CLI source changes additionally require `bun link` inside apps/cli and `bun run --filter @gobing-ai/spur build:bundle` from the root. New feature completion must satisfy its real dogfood gate; historical parent evidence is not fabricated.

### Design

Freeze: reuse parseInvocation/lineInvocationSpans/checkNounVerbFlags and existing Row mismatch evidence in plugins/sp/scripts/surface-drift-inventory.ts; no parser framework or new public command. Check only extracted literal invocations, not arbitrary prose mentioning a bad command. Handle quoted operands and --section=value alongside spaced form using the current tokenizer. Case-normalize comparison, but keep original location/text evidence.

Operand audit boundary: I6 swept tags, priority, status, phase, id, parent, name, owner, scope. Validate each against the current noun section set before classifying: legitimate feature Scope is allowed even though scope appeared in the historical sweep. Use metadata-only keys for that noun, not a blind denylist or a new CLI section matrix. Dynamic operands remain unverified under the existing scanner convention; do not pretend they are statically validated. Synthetic negative fixtures may contain wrong examples; shipped user instructions may not.

Tests: extend existing surface-drift-inventory tests with literal wrong operands, quoted/equal forms, real body headings, dynamic operands and prose-only mentions; retain existing CLI parity. Use a temporary feature folder or pure fixture to exercise the correct recipe without altering live features. Update docs/design/dev-spine-cost-and-drift.md only where its recorded discrepancy becomes resolved; retain historical findings.

No upstream implementation dependency. Own wayfinder/SKILL.md, surface-drift-inventory.ts, its focused tests and that design satellite. Keep cross-cutting.md and agent.ts for the separate guidance task.

Source anchors:
- `plugins/sp/skills/wayfinder/SKILL.md`
- `plugins/sp/scripts/surface-drift-inventory.ts`
- `plugins/sp/tests/surface-drift-inventory.test.ts`
- `plugins/sp/tests/cli-surface-parity.test.ts`
- `docs/design/dev-spine-cost-and-drift.md`
- `docs/reports/i31/0903-contract-adoption.md`

### Plan

- [ ] 1. Read I7 and the source anchors; enumerate actual body sections and add the smallest failing wrong-operand regressions (R2/AC2).
- [ ] 2. Fix the recipe and extend the existing invocation check, preserving true headings and uncertainty handling (R1-R2/AC1-AC2).
- [ ] 3. Exercise the CLI-only source route and corrected recipe in isolation; run focused scanner and parity tests inside plugins/sp (R3/AC3).
- [ ] 4. Update the owning design status, run task-local gates and verify all three AC; run the feature gate once for I7 and wrap with one task commit.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
