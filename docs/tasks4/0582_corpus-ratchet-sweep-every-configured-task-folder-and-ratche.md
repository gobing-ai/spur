---
template: feature-impl
schema_version: 1
name: "Corpus ratchet: sweep every configured task folder and ratchet warning severity"
description: ""
status: wip
type: task
profile: standard
feature_id: F91
parent_wbs: null
priority: P0
tags: ["corpus", "gate"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-17T22:18:51.142Z"
updated_at: "2026-08-17T23:40:28.396Z"
---

## 0582. Corpus ratchet: sweep every configured task folder and ratchet warning severity

### Background
`corpus-check.ts` had two independent holes, both of which let corpus debt grow unobserved. They
share one object — the sweep and its baseline — so they are one task.

**Scope hole.** The per-file sweep was frozen to the *active* task folder. Its own source comment
named the reason and the cost: "Broadening the per-file check to every configured folder … surfaces
the legacy corpora's ratchet drift (404 findings in docs/tasks{2,3} as of 2026-08-10) and would
force a massive config/corpus-baseline.json reconciliation — out of scope for this promotion task."
Measured 2026-08-17: exactly **404 errors across 188 tasks** in `docs/tasks{,2,3}`, none in the
active folder, against a baseline holding **2** entries. 489 of 582 tasks (84%) were ungated.

**Severity hole.** The ratchet filters `if (finding.severity !== 'error') continue` at both the task
and feature loops, so warning-severity findings have never had any reconciliation pressure.
Measured 2026-08-17: **2,291** warnings across 579 tasks, led by `L4.stale-line-anchor` (851 across
213 tasks) and `L4.uncovered-task-scenario` (619 across 57 tasks).

The severity hole is the root cause behind the sibling tasks in this feature: a finding nobody is
ever obliged to act on grows without bound, and that noise then hides the findings that matter. The
precedent for the fix exists twice already — `corpus-baseline.json` for errors (ADR-050) and
`config/transition-shims.json` for shims (ADR-058).
### Requirements
- [x] **R1.** The `--corpus` sweep runs the per-file task check against **every** configured task folder, not only the active one, and the error backlog it exposes is reconciled into `config/corpus-baseline.json` in the same commit (constitution T10).
- [x] **R2.** Baselined entries keep their two-sided identity (`kind:id:code`), so an entry that stops reproducing still fails the gate as stale; the frozen-scope source comment is replaced by one stating the new scope and pointing at ADR-062.
- [ ] **R3.** Warning-severity findings are reconciled two-sided against an accepted baseline: a warning outside it fails the gate, and a baseline entry that no longer reproduces fails it as stale.
- [ ] **R4.** Warnings and errors stay distinguishable in gate output and in the baseline — folding warnings into the error list would make a warning indistinguishable from a structural failure.
- [ ] **R5.** The existing warning population is reconciled into the warning baseline in the same commit, so the gate is green on landing (constitution T10).
- [ ] **R6.** The gate report states observed / baselined / new / stale counts **per severity**, so a reader can tell a growing warning class from a stable one.

**Out of scope / non-goals:** repairing the 404 baselined errors (separate remediation — mixing it
in makes the gate change unreviewable); promoting any warning to error severity (task 0583 owns the
per-rule promotion); the external-evidence form and the `ac_altitude` field (task 0584); any change
to the `--strict-core` `testing → done` gate layers.
### Acceptance Criteria
```gherkin
Scenario: R1 — The corpus sweep covers every configured task folder
  Given a structural error in a task outside the active folder
  When spur task check --corpus runs
  Then the error is observed by the sweep
  And it fails the gate unless it is in the accepted baseline

Scenario: R2 — Warning-severity findings are ratcheted two-sided
  Given a warning baseline reconciled against the corpus
  When a new warning appears outside the baseline
  Then the gate fails naming it
  And a baseline entry that no longer reproduces also fails the gate
```
### Q&A
**Sandbox denial — resolved for R2, expected again for R5 (2026-08-17).**

`config/corpus-baseline.json` and `config/transition-shims.json` are write-denied to the agent
sandbox. That guard is correct and was not worked around: an agent that can silently edit its own
suppression list has no gate at all.

R2 landed by staging the reconciled baseline outside the repo and handing the operator one copy
command. Confirmed green afterwards:

```
corpus-check: swept tasks + features — 406 error(s) observed, 365 baselined, 0 new, 0 stale.
corpus-check OK — no corpus errors outside the accepted baseline.
```

**R5 will hit the same denial** — plan the same handoff: generate, verify the key-set diff shows
0 would-be-new and 0 would-be-stale, then hand over one copy command. Do not attempt an in-place edit.

**No other open questions.** Both feature-level design decisions (external-evidence form, AC-altitude
declaration) belong to task 0584 and are frozen there.
### Design
**R1/R2 are LANDED and verified (2026-08-17).** `structuralSweep` iterates `taskDirs` rather than
`activeTasksDir` (`packages/app/src/services/corpus-check.ts`), the frozen-scope comment is replaced
with the new scope + an ADR-062 pointer, and the 363 unique error keys are baselined. Verified this
run: `spur task check --corpus` → **406 observed, 365 baselined, 0 new, 0 stale**.

**R3–R6 — warning ratchet.** Reuse the existing `CorpusError` identity (`<kind>:<id>:<code>`) and the
reconciliation routine; the only new axis is severity. **Frozen shape:** one baseline file with a
`severity` field on each entry, not a second file — two files drift, and the stale-detection pass has
to read both anyway. The collection filter at both loops
(`if (finding.severity !== 'error') continue`) becomes a severity capture; the gate report gains
per-severity observed / baselined / new / stale counts so a growing warning class is distinguishable
from a stable one.

**Diagnosis authoring — do not repeat the 363-entry mistake.** The baseline `note` demands a real
diagnosis per entry. The error baseline carries its per-code diagnosis **once** in the note, with each
entry holding a one-line reason pointing at it; 363 copies of a paragraph satisfies the letter and
defeats the point. The warning population is ~6× larger, so the same discipline is mandatory.

**Measured population (verified against the current tree, 2026-08-17):** **2,289** warnings, led by
`L4.stale-line-anchor` (847 across 213 tasks), `L4.uncovered-task-scenario` (619 across 57 tasks),
`L2.disallowed-section` (389), `L3.unchecked-checklist` (150), `L4.missing-feature-id` (103).

**Agents cannot install either baseline.** `config/corpus-baseline.json` and
`config/transition-shims.json` are write-denied to the agent sandbox — a deliberate guard, since an
agent that can edit its own suppression list has no gate. Generate the reconciled file to a staging
path and hand the operator a single copy command. Verified 2026-08-17: this is exactly how R2 landed.
Do not work around the denial.

**Anti-patterns — do not implement.** Do not fix the 404 baselined errors here (separate remediation;
mixing it in makes the gate change unreviewable). Do not promote any warning to error here — that is
per-rule work owned by task 0583, and blanket promotion would fail 579 tasks. Do not add a
`--no-warnings` escape hatch, which is one-sided suppression under another name. Do not narrow the
sweep by task status.

**File targets.** `packages/app/src/services/corpus-check.ts` (severity capture, reconciliation,
report), `config/corpus-baseline.json` (operator-installed), `docs/04_DESIGN.md` §7.1 for the gate
report shape.

**Cross-task.** No dependencies. **Leaves for task 0583:** the warning-side baseline is where 0583's
`L4.anchor-subject-mismatch` residue is reconciled before its warning→error promotion; 0583 must not
introduce a parallel baseline.
### Plan
- [x] Snapshot per-folder findings to a reviewable artifact before changing anything (R1)
- [x] Widen the per-file sweep to every configured task folder, reusing existing folder resolution (R1)
- [x] Generate the error baseline with a real per-code diagnosis and reconcile two-sided (R1, R2)
- [x] Replace the frozen-scope source comment with the new scope + ADR-062 pointer (R2)
- [ ] Extend the baseline record and reconciliation to carry severity, keeping warnings distinguishable (R3, R4)
- [ ] Generate and reconcile the warning baseline from the current corpus (R5)
- [ ] Report observed/baselined/new/stale per severity (R6)
- [ ] Confirm both directions fail correctly: a new finding outside the baseline, and a baselined entry that stops reproducing (R3)
### Solution
**R3–R6 — warning ratchet (this pass; R1/R2 landed earlier).**

- `packages/app/src/services/corpus-check.ts` — the per-file sweep now captures **every** severity instead of filtering `severity !== 'error'` at both the task and feature loops (`structuralSweep` returns `findings` with a `severity` field). `BaselineEntry` gains `severity` (legacy entries without the field read as `'error'` via `baselineSeverity`). The reconciliation (`reconcileBaseline`, shared with baseline-generation tooling) treats severity as part of the acceptance contract: an observed finding is covered only by a baseline entry with the same `kind:id:code` **and** the same severity, so a baselined warning does not cover the same finding promoted to error — promotion (task 0583) becomes a reconcile-the-entry event. New findings split into `newErrors` / `newWarnings`; the result carries per-severity `bySeverity` counts (observed / baselined / new / stale) so a growing warning class is distinguishable from a stable one (R4, R6).
- `packages/app/src/index.ts` — exports `baselineSeverity`, `collectObservedFindings`, `reconcileBaseline` alongside `runCorpusCheck`, so the R5 baseline generation shares one code path with the gate.
- `apps/cli/src/commands/task.ts:1008` — `spur task check --corpus` report statements now per severity: `errors N observed, N baselined, N new, N stale; warnings N observed, N baselined, N new, N stale`, NEW lines tagged `[error]`/`[warning]`, FAIL/OK summary mentions warnings.
- `packages/app/tests/services/corpus-check.test.ts` — new tests: a warning outside the baseline fails as a new warning; a baselined warning that stops reproducing fails as stale; severity mismatch (error entry vs warning finding) yields both a new warning and a stale entry. Existing result-contract assertions extended with `newWarnings` + `bySeverity`.
- `apps/cli/tests/commands/task.test.ts` — `--corpus --json` contract now asserts the seven-key result shape incl. per-severity counts.
- `docs/04_DESIGN.md:1373` — §7.1 `spur task check --corpus` row documents the per-severity two-sided reconciliation and the `{observed, baselined, newErrors, newWarnings, staleEntries, bySeverity, ok}` JSON shape.

**R5 — warning population reconciliation (operator handoff, per task Q&A).** `config/corpus-baseline.json` is write-denied to the agent (the gate's self-suppression guard); the reconciled baseline was generated and verified **outside** the repo and staged at `.spur/run/0582-corpus-baseline.staged.json`: 365 existing error entries (severity pinned `'error'`) + 903 unique warning identities (one per `kind:id:code`, severity `'warning'`, per-code one-line reason pointing at the note's `§ W-<code>` diagnosis — no paragraph-per-entry duplication), plus an extended note with one diagnosis per warning code. Verified through the gate's own `reconcileBaseline` + the fog-skip carve-out: **0 would-be-new / 0 would-be-stale** vs 2,947 observed findings (406 error + 2,541 warning).

**Operator install (ONE copy command):**
```bash
cp .spur/run/0582-corpus-baseline.staged.json config/corpus-baseline.json
```
After install, `spur task check --corpus` is green; before install it correctly fails with the 2,541 un-baselined warnings (the ratchet is live).
### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **ADR-062** — Corpus Gates Verify Evidence Content, and Every Severity Is Ratcheted (`docs/00_ADR.md`) — the decision record for this feature.
- **ADR-050** — the two-sided error baseline this work extends.
- **ADR-058** — tracked transition shims: the warning-first-then-tighten precedent and the two-sided manifest shape.
- **ADR-063** — top-level feature-node consent (why this feature lives at F91, not a root letter).
- **Feature F91** — `docs/features/F91_*.md`; parent **F9** owns `checkAcCoverage`, the stable finding codes, and the severity-override map this work builds on.
- **Origin audit** — the 2026-08-17 E5 re-audit (`/sp:dev-verifyall --feature E5 --force --fix all`) that surfaced all four root causes; tasks 0553/0554/0555/0564 carry the repaired citations.
### History
- 2026-08-17T22:26:33.216Z todo → wip (system)
