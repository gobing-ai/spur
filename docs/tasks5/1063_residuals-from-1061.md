---
schema_version: 1
name: Residuals from 1061
status: done
template: feature-impl
created_at: 2026-10-03T01:53:33.466Z
updated_at: "2026-10-03T02:52:17.418Z"
feature_id: F96

priority: P3
ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new/.spur/memory/evidence/1063-verdict.json
---

## 1063. Residuals from 1061

### Background

Source task: 1061 (feature F96) — deferred residuals filed by residual-scan settle.

- review-finding:fc5ed7cf — config/templates/task/standard.md:30, apps/cli/tests/commands/task.test.ts:3696: AC-guidance comment now exists in 7 near-identical copies (6 templates + condensed style-guide form) plus a sed-escaped 8th copy in the 0788 test; only standard.md's copy is contract-pinned, so the other five templates can drift silently — this task's own diff (8 coordinated lockstep edits for one wording change) demonstrates the coupling cost. Follow-up candidate: a cross-template AC-comment consistency check (or generator); full dedup is wrong since templates must stay self-contained for `spur task create` without the plugin.

### Requirements

- [x] R1. A repo test (bun) detects drift of the AC-guidance comment across the 8 synchronized copies (6 config/templates/task/*.md templates, the condensed form in plugins/sp/skills/spur-dev/references/ac-style-guide.md, the sed-escaped copy in apps/cli/tests/commands/task.test.ts): a perturbed copy fails with the drifted file named; the committed tree passes.
- [x] R2. Templates stay self-contained — the check reads existing repo files only, adds no dependencies, and changes no template content beyond fixing actual drift found.

### Acceptance Criteria

```gherkin
Scenario: AC1 — perturbed copy fails with drifted file named (req: R1)
  Given the committed template copies in a temp fixture
  When one copy's guidance comment gains a stray sentence
  Then the consistency test fails and names that file

Scenario: AC2 — committed tree passes (req: R1)
  Given the current repository
  When the consistency test runs via bun test
  Then it passes with zero source edits

Scenario: AC3 — self-contained, dependency-free check (req: R2)
  Given the implementation
  When manifests and template contents are reviewed
  Then no dependencies were added and all 8 copies remain inline and self-contained
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

- [x] P1. Extract the AC-guidance comment from each of the 8 copies (normalize the sed-escaped test copy) and compare.
- [x] P2. Add the consistency test under apps/cli/tests/ with the AC1 perturbation fixture.
- [x] P3. Run the focused test, then `bun run spur-check`; record results in Testing/Review.

### Solution

- apps/cli/tests/templates/ac-guidance-consistency.test.ts:37 — extracts the AC-guidance comment from all 6 config/templates/task/*.md copies; asserts the shared body (through the `checked at close.` anchor) is byte-identical to standard.md with each template's closing tail pinned via EXPECTED_TAILS (apps/cli/tests/templates/ac-guidance-consistency.test.ts:54).
- apps/cli/tests/templates/ac-guidance-consistency.test.ts:86 — AC_PLACEHOLDER in apps/cli/tests/commands/task.test.ts:3696 asserted equal to the templates (backslash-stripped, escaping-insensitive).
- apps/cli/tests/templates/ac-guidance-consistency.test.ts:100 — condensed style-guide clauses pinned; AC1 perturbation canary names the drifted file.
- No template or source changes: drift alarm is enforcement-only, templates stay self-contained (R2).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | All 8 copies pinned: 6 template bodies byte-identical to standard.md + per-template tails pinned via EXPECTED_TAILS (ac-guidance-consistency.test.ts:61-75, :43-50); escaped copy vs task.test.ts:3695-3696 (:77-84); condensed clauses at ac-style-guide.md:36,39,45 (:86-96). Perturbed copy names drifted file (:97-101); committed tree passes (4/4 fresh run). |
| R2 | MET | Imports only bun:test/node:fs/node:path (:1-3); git status shows zero changes to templates, package.json, lockfiles — only the new test dir + task doc. All copies remain inline/self-contained. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Fresh-context reviewer (sp-super-reviewer, run fa9c1d11) — functional traceability + SECUA + architecture; final verdict PASS, R1/R2 MET, AC1–AC3 MET.

| # | Priority | Finding | Location | Disposition |
|---|----------|---------|----------|-------------|
| 1 | P4 | AC1 canary proves naming at unit level; genuine repo drift names basename only — acceptable within templates dir | ac-guidance-consistency.test.ts:97-101 | None |
| 2 | P4 | Backslash-strip comparison would mask a literal backslash in comment text; none exist in any copy (verified) | ac-guidance-consistency.test.ts:81-84 | None |
| 3 | P4 | Style-guide pin checks 3 load-bearing clauses, not phrase parity — inherent to condensed form, matches R1 wording | ac-guidance-consistency.test.ts:86-96 | None |
| 4 | P4 | Missing-comment path throws Error naming the file instead of clean expect failure — diagnosability preserved | ac-guidance-consistency.test.ts:18-21 | None |
| 5 | P4 | Mixed resolution roots (reference vs comparands) — RESOLVED during review: reference now reads via bundledConfigRoot() (readTemplate) | ac-guidance-consistency.test.ts:67 | FIXED |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-03T02:34:05.532Z backlog → wip (system)
- 2026-10-03T02:51:54.605Z wip → testing (system)
- 2026-10-03T02:52:17.322Z testing → done (system)

