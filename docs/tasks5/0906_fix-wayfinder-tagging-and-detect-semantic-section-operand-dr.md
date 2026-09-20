---
schema_version: 1
name: Fix wayfinder tagging and detect semantic section-operand drift
status: done
template: feature-impl
created_at: 2026-09-20T15:48:46.076Z
updated_at: "2026-09-20T18:02:44.769Z"
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

- [x] R1. Correct the source wayfinder tagging recipe to `spur feature update <id> --field tags --value wayfinder-map`; remove executable wrong tagging examples from shipped plugin prose.
- [x] R2. Extend the existing surface-drift inventory to report literal task/feature update invocations that use --section for a metadata-only operand, while accepting genuine body sections. Preserve existing noun/verb/flag checks.
- [x] R3. Keep the same recipe available to CLI-only skill consumers and verify the source fallback without hand-editing installed/generated adapters.

### Acceptance Criteria

- [x] AC1 — wayfinder tags a map through --field, not --section (req: R1)
- [x] AC2 — the parity harness flags --section on a frontmatter key (req: R2)
- [x] AC3 — a platform without slash commands still sees the correct recipe (req: R3)

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

- [x] 1. Read I7 and the source anchors; enumerate actual body sections and add the smallest failing wrong-operand regressions (R2/AC2).
- [x] 2. Fix the recipe and extend the existing invocation check, preserving true headings and uncertainty handling (R1-R2/AC1-AC2).
- [x] 3. Exercise the CLI-only source route and corrected recipe in isolation; run focused scanner and parity tests inside plugins/sp (R3/AC3).
- [x] 4. Update the owning design status, run task-local gates and verify all three AC; run the feature gate once for I7 and wrap with one task commit.

### Solution

- `plugins/sp/skills/wayfinder/SKILL.md:123` — R1/AC1: tagging recipe corrected to `spur feature update <id> --field tags --value wayfinder-map` (`tags` is frontmatter; the recipe routes through the array write path, task 0473 R6). Also drops the bash-only `<(...)` form, so CLI-only consumers get a POSIX-sh recipe → R3/AC3. The live probe on a scratch `--folder` fixture round-trips `tags: ["wayfinder-map"]`.
- `plugins/sp/scripts/surface-drift-inventory.ts` — R2/AC2: new semantic layer `checkSectionOperand` — audit boundary is the I6-swept metadata keys minus per-noun genuine body headings (feature `Scope` stays legal); comparison case-normalized with original operand text kept in row evidence; quoted / `--section=value` / spaced forms all handled; dynamic (placeholder) operands stay unverified per scanner convention; wired into `sweepPluginTrees` (prose spans + fenced code) and `sweepWorkflows` YAML scan. Existing noun/verb/flag existence checks untouched.
- `plugins/sp/tests/surface-drift-inventory.test.ts` — six hermetic regressions: the exact shipped defect span flagged with the corrected recipe named; task-noun siblings incl. quoted/`=` forms; genuine body headings accepted (`"Acceptance Criteria"`, feature `Scope`, task `Plan`); case-normalized match with original-text evidence; dynamic operands produce no row; non-update verbs / other nouns / prose-only mentions produce no row.
- `plugins/sp/tests/skill-structure.test.ts` (R51 wayfinder anatomy) — AC1/AC3 pins: the `--field tags --value` recipe present, `--section tags` absent from the shipped skill text.
- `docs/design/dev-spine-cost-and-drift.md` — D1 marked RESOLVED, F1/F2 marked DONE (dated 2026-09-20, task 0906); historical findings retained.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/sp/skills/wayfinder/SKILL.md:123 (recipe `spur feature update <id> --field tags --value wayfinder-map`; old executable `--section tags --from-file <(...)` example removed; rg sweep of shipped plugin prose: zero remaining `--section (tags\|priority\|status)` hits) |
| R2 | MET | plugins/sp/scripts/surface-drift-inventory.ts:382-409 (checkSectionOperand: literal operands only, quoted/spaced/= forms, case-normalized, per-noun body-section set wins, audit boundary = I6 metadata keys); wired at :461/:496/:834 into plugin-tree and workflow sweeps; plugins/sp/tests/surface-drift-inventory.test.ts:541-590 (6 tests: defect span, task-noun quoted/= forms, genuine sections incl. feature Scope, case normalization w/ original text preserved, dynamic unverified, non-update/other-noun/prose silent) |
| R3 | MET | Recipe is POSIX-sh safe (`--field tags --value wayfinder-map`, no process substitution — the old bashism `<(printf ...)` is gone); CLI surface real: apps/cli/src/commands/feature.ts:92 (--value), :135/:146 (paired-flag validation), :160; plugins/sp/tests/skill-structure.test.ts:1512-1515 asserts the source SKILL.md directly (CLI-only consumers, no installed-adapter dependency) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET |  | plugins/sp/skills/wayfinder/SKILL.md:123 tags via --field; plugins/sp/tests/skill-structure.test.ts:1512-1515 (toContain corrected recipe + not.toContain '--section tags') — executable regression |
| AC2 | MET |  | checkSectionOperand flags `feature update --section tags` (the shipped defect span, corrected recipe named in row) and task-noun `--section 'priority'` / `--section=status`; accepts genuine body headings `--section Scope` (per-noun override), `Acceptance Criteria`, task `Plan`; plugins/sp/tests/surface-drift-inventory.test.ts:541-590, focused run 184 pass / 0 fail |
| AC3 | MET |  | POSIX-sh-safe recipe (no bash process substitution) asserted in skill-structure.test.ts:1512-1515; verified against live CLI source (apps/cli/src/commands/feature.ts:92,135,146,160) without touching installed/generated adapters; cli-surface-parity.test.ts unchanged and green (existing parity retained) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict PASS |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-20T17:26:45.265Z todo → wip (system)
- 2026-09-20T18:00:05.259Z wip → testing (system)
- 2026-09-20T18:02:28.367Z testing → done (system)

- 2026-09-20 — pipeline run 51a0f9b6 (task-pipeline, profile=auto, worktree sp/run-0906-51a0f9): test gate PASS, review approve (P3 folded), verify PASS, spur-check-feature green; done.

