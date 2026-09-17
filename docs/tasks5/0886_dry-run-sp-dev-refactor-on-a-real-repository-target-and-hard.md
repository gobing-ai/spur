---
schema_version: 1
name: Dry-run /sp:dev-refactor on a real repository target and harden the contract from the evidence
status: todo
template: feature-impl
created_at: 2026-09-17T17:49:42.540Z
updated_at: "2026-09-17T17:52:35.929Z"
feature_id: H13
priority: P2
tags:
  - sp-plugin
  - dogfood
  - refactoring
  - H13

dependencies: ["0883", "0884", "0885"]
---

## 0886. Dry-run /sp:dev-refactor on a real repository target and harden the contract from the evidence

### Background

Acceptance evidence for feature H13: run the new command against a real path with `--fix none` and `--focus auto`, prove it edits nothing, and prove the artifacts match the contract. Any contract defect surfaced by the run (unclear mapping, missing stop rule, misroute) is fixed in the owning file from the earlier tasks. Suggested target: `apps/cli/src/commands/` (api + architect lenses) or `plugins/sp/scripts/` (architect + tests). Authority: `docs/design/dev-refactor-command.md` §4, §7, §8, §10. Covers feature H13 scenario R9.

### Requirements

- [ ] R1. Run `/sp:dev-refactor --scope <chosen path> --focus auto --fix none` inline; record the reported lens set and confirm it matches `references/focus-detection.md` for the files in scope.
- [ ] R2. After the run `git status --short` shows no source changes (only `.spur/run/` artifacts, which are gitignored) and the run made no edits.
- [ ] R3. `.spur/run/<run-id>-refactor-findings.json` passes the documented structural check; every finding has in-scope `file:line` evidence, a P1–P4 severity, a preservation class, and a fix eligibility consistent with the fix ladder (no `cutting`/`breaking` with `auto`).
- [ ] R4. `.spur/run/<run-id>-refactor-report.md` lists the lens set, findings by severity, and the preservation summary; at least one finding per selected lens or an explicit "no findings" line per lens.
- [ ] R5. A second run with `--fix blockers-first --auto` on the same path either applies only P1/P2 `auto` findings with the check green after each, or reports "nothing eligible"; any cutting/breaking finding is listed as SUGGEST/deferred, never applied; the working tree is reverted afterwards unless the operator keeps the changes.
- [ ] R6. Defects found in the coordinator, lens contracts, or command are fixed in the owning files; `bun run spur-check` passes; the task `## Solution` records the run ids, target path, lens set, finding counts by severity/preservation, and every contract fix.

### Acceptance Criteria

Covers feature H13 scenarios:

- [ ] R9 — Dry run on a real target produces a report without edits

Task-local checks: report and findings artifacts exist for run 1 with a clean tree; run 2 applied only P1/P2 `auto` findings (or none) and deferred every cut/break.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Dogfood is the only acceptance evidence that proves a cheaper executor can follow the contract; it is run inline (no subprocess) so the gate matrix is exercised by the operator. `--fix none` first isolates the analysis contract from the apply loop; the second run exercises the apply loop under the strictest safe policy. Reverting the tree after the second run keeps this task's mutation policy to contract files only — refactoring the target is not this feature's deliverable. Mutation policy: fixes limited to `plugins/sp/skills/code-refactoring/`, the four taste skills' `## Spur contract` sections, `plugins/sp/commands/dev-refactor.md`, and the glossary/docs rows those fixes require.

### Plan

1. Pick the target path; list its files and predict the lens set from the glob table.
2. Run `/sp:dev-refactor --scope <path> --focus auto --fix none`; capture run id, report path.
3. Verify `git status --short`, run the structural check on the findings JSON, review the report.
4. Run `/sp:dev-refactor --scope <path> --focus auto --fix blockers-first --auto`; observe apply/revert behavior and the taste-gate behavior; revert the tree (`git checkout -- <path>`) unless the operator keeps changes.
5. Fix contract defects in their owning files; re-run affected validators and `bun run spur-check`.
6. Record `## Solution` with evidence via `spur task update`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
