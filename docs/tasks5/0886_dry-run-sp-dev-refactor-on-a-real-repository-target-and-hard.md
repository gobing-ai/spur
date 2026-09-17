---
schema_version: 1
name: Dry-run /sp:dev-refactor on a real repository target and harden the contract from the evidence
status: done
template: feature-impl
created_at: 2026-09-17T17:49:42.540Z
updated_at: "2026-09-17T22:55:44.340Z"
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

- [x] R1. Run `/sp:dev-refactor --scope <chosen path> --focus auto --fix none` inline; record the reported lens set and confirm it matches `references/focus-detection.md` for the files in scope.
- [x] R2. After the run `git status --short` shows no source changes (only `.spur/run/` artifacts, which are gitignored) and the run made no edits.
- [x] R3. `.spur/run/<run-id>-refactor-findings.json` passes the documented structural check; every finding has in-scope `file:line` evidence, a P1–P4 severity, a preservation class, and a fix eligibility consistent with the fix ladder (no `cutting`/`breaking` with `auto`).
- [x] R4. `.spur/run/<run-id>-refactor-report.md` lists the lens set, findings by severity, and the preservation summary; at least one finding per selected lens or an explicit "no findings" line per lens.
- [x] R5. A second run with `--fix blockers-first --auto` on the same path either applies only P1/P2 `auto` findings with the check green after each, or reports "nothing eligible"; any cutting/breaking finding is listed as SUGGEST/deferred, never applied; the working tree is reverted afterwards unless the operator keeps the changes.
- [x] R6. Defects found in the coordinator, lens contracts, or command are fixed in the owning files; `bun run spur-check` passes; the task `## Solution` records the run ids, target path, lens set, finding counts by severity/preservation, and every contract fix.

### Acceptance Criteria

Covers feature H13 scenarios:

- [x] R9 — Dry run on a real target produces a report without edits

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

Inline dogfood of `/sp:dev-refactor` per the coordinator contract (design §4/§7/§8/§10). Target `plugins/sp/scripts/` (29 files); run id `c7581e1b-00fe-4b90-925e-ce0ee3c1b590` (enclosing pipeline run).

- **Run 1** `--fix none --focus auto`: focus detection resolved `focus=auto → lenses: architect (29 files)` — zero scope files matched tests/ui/api globs, so all resolved via the row-4 fallback (the task's suggested "architect + tests" pairing does not arise from deterministic detection; recorded as evidence). Baseline green (0885 gate PASS, tree unchanged). Findings artifact `.spur/run/c7581e1b-…-refactor-findings.json` (4 findings: P3×2, P4×2; all preserving/suggest) passed the documented structural check (VALID, exit 0); rejection probes `severity:"P0"` and `cutting+auto` both exited 1 as required. Report `.spur/run/c7581e1b-…-refactor-report.md`. No edit landed (`git status` clean of scope files) — R2 satisfied.
- **Run 2** `--fix blockers-first --auto`: eligible batch = P1/P2 ∩ auto = ∅ → reported **"nothing eligible"**; no target edits, no revert needed. R5 satisfied via the nothing-eligible branch.
- **Contract fixes (R6):** (1) fix-ladder.md:41-43 revert rule was unsatisfiable when findings share evidence files — file-level `git checkout --` would revert an earlier applied finding's work; replaced with reverse-apply-the-finding's-own-hunks rule (carry-over of the 0883 review P2, dispositioned here). (2) SKILL.md Phase 4 wording aligned to the same rule.
- **Gates:** `bun run spur-check` PASS post-fixes (`.spur/run/0886-test-gate.status`).
- Finding counts by severity: P1=0, P2=0, P3=2, P4=2 (total 4). By preservation: preserving=4, cutting=0, breaking=0.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Re-run 2026-09-17 (`reverify-0886-20260917`): lens set reported before analysis = architect (27 files); deterministic re-derivation against `plugins/sp/skills/code-refactoring/references/focus-detection.md:12-15` globs — zero tests/ui/api matches in `plugins/sp/scripts`, row-4 fallback classifies all 27 |
| R2 | MET | `git status --short -- plugins/sp/scripts/ plugins/sp/skills/ plugins/sp/commands/ config/` → empty post-run (re-run 2026-09-17); `--fix none` policy structurally cannot edit |
| R3 | MET | `.spur/run/reverify-0886-20260917-refactor-findings.json` — documented `bun -e` structural check (`finding-schema.md:41-69`) exit 0, "2 finding(s) structurally valid", re-run 2026-09-17; both findings carry in-scope `file:line` evidence, P4 severity, `preserving` class, `suggest` eligibility (no cutting/breaking+auto) |
| R4 | MET | `.spur/run/reverify-0886-20260917-refactor-report.md` — lens set line, P1–P4 findings table with `file:line`, preservation summary (preserving 2 / cutting 0 / breaking 0), applied/reverted/deferred lists; architect lens has 2 findings (≥1 required) |
| R5 | MET | Run 2 `--fix blockers-first --auto` on same scope: eligible batch P1/P2 ∩ auto = ∅ → "nothing eligible" branch (report § Run 2); no cutting/breaking findings to defer; no target edits to revert — matches original dogfood outcome |
| R6 | MET | Contract fixes re-verified live: `plugins/sp/skills/code-refactoring/references/fix-ladder.md:41-46` reverse-apply-the-finding's-own-hunks rule (explicit "Never `git checkout -- <file>`" on shared evidence files); aligned apply-loop wording `plugins/sp/skills/code-refactoring/SKILL.md:123-127`; plugin structure tests 84 pass / 0 fail re-run 2026-09-17 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R9 — Dry run on a real target produces a report without edits | MET | command | Live re-run 2026-09-17 on `plugins/sp/scripts` (27 files): findings JSON structural check exit 0; report written; `git status --short` empty of scope edits; run-2 nothing-eligible branch. Original 2026-09-17 run artifacts (`c7581e1b-…`) were gitignored and no longer on disk — evidence regenerated this run rather than trusted |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T21:03:34.833Z todo → done (system)

