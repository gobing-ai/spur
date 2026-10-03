---
schema_version: 1
name: Align task AC template with done-gate scenario keying (checkbox ACs key L4.uncovered-task-scenario)
status: todo
template: feature-impl
created_at: 2026-10-02T23:30:56.374Z
updated_at: "2026-10-02T23:58:11.239Z"
feature_id: F96

priority: P3
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 3
---

## 1061. Align task AC template with done-gate scenario keying (checkbox ACs key L4.uncovered-task-scenario)

### Background

**Origin:** D62 runall session (2026-10-02), dogfood finding F3-adjacent; task 1056's first done attempt was blocked by `L3.unchecked-checklist` + `L4.uncovered-task-scenario` (plus 2 bare anchors, separately fixed). 1053-1056 all had to convert their AC sections to freeform `- ACn:` rows mid-flight to pass the done gate; 1056's Review records the template mismatch as P3.

**Verified mechanics:**

- **Templates teach scenario-keyed checkbox ACs.** Every task template ships the same AC guidance — `config/templates/task/issue.md:30`, `feature-impl.md:30`, `brainstorm.md:30` (also `standard.md`, `review.md`, `meta.md`): "`- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`."
- **The checker keys on that shape.** `packages/app/src/services/task-check.ts` — `:842` uncovered = requirement ids with no matching AC (`reqIds` vs `acIds`), `:850` message "Requirements with no Acceptance Criteria scenario", `:960` terminal-status open-checkbox check (`L3.unchecked-checklist`, 0182 R7), `:1812` uncovered-scenario loop. Finding codes in `packages/config/src/finding-codes.ts:60,151` (`L4.uncovered-task-scenario`).
- **1056's bind:** the owning feature (D62) was planned with gherkin ACs R1-R15 at feature time; refinement task 1056's work (persist-out subpath citation classification) corresponds to NO feature scenario, so scenario-titled ACs were impossible to write honestly. The template's escape hatches (`task-only checks in prose`, `ac_altitude: task-local`) exist in the comment but were either unknown or not obviously applicable at run time; the working corpus precedent became freeform `- ACn:` rows (apparently unkeyed → gate passes), which is undocumented as a sanctioned form.

**So the defect is not "template vs checker disagree" but:** three overlapping AC conventions — (a) scenario-titled checkbox rows (template-taught, checker-keyed, fail-closed), (b) freeform `- ACn:` rows (undocumented, what 1053-1056 actually shipped, gate-passing), (c) `ac_altitude: task-local` (template-documented escape, unused, semantics unpinned vs (b)) — with no decision table for which applies when, and refinement-batch tasks (the common runall case) structurally unable to satisfy (a).

**Excluded:** the L3 unchecked-checkbox gate itself (correct: check your boxes before done); the bare-anchor rule (fixed by 1055); the D62 corpus (already converted and done — do not touch).

**Refine corrections (2026-10-02)**

Plain - ACn rows were proposed as a sanctioned escape → they bypass scenario extraction and are not a safe authoring convention → teach explicit task-local altitude with parsed AC forms. L4 uncovered-task-scenario was described as a hard gate → current source emits warning; independent unchecked-box and other errors can block done → separate findings. Altitude was conflated with numbering → altitude bypasses feature subset only; numbering opts Scenario: requirement coverage into L3. Templates already mention task-local and the style guide already defines it → fix discoverability/contradictory guidance, not add a new checker or reinvent the convention.

The corrected Requirements, Design and Plan below supersede the historical proposals above; incident narrative is preserved for provenance.

### Requirements

- [ ] R1. Align all six task template AC guidance comments and ac-style-guide.md around the existing distinction: ac_altitude controls feature subset; ac_numbering controls task requirement bindings. Recommend Scenario: ACn titles with explicit req bindings for task-local regression work; retain parsed checkbox ACs as a supported form without claiming equivalent requirement-binding enforcement.
- [ ] R2. Correct contradictory authoring guidance in ac-style-guide.md, including plain/bold form and outdated Requirements formatting advice. Explain raw freeform AC bullets as legacy unparsed content, not a sanctioned way to avoid traceability; do not change checker behavior or migrate completed tasks.
- [ ] R3. Provide repeatable isolated checks for graduating title mismatch, task-local Scenario binding, missing req coverage, checkbox completion and legacy raw bullets, plus unchanged checks for 1053–1056. Assert expected finding codes/severities rather than claiming whole checks pass despite unrelated unresolved findings.

Out of scope: runtime engine changes, new public APIs, unrelated fixes from 1053–1056, production operations or external publication.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Guidance distinguishes altitude and numbering (req: R1)
  Given all six templates and the existing altitude section
  When the guidance changes are checked
  Then one decision table teaches Scenario req binding, graduating subset checks and checkbox enforcement limits

Scenario: AC2 — Legacy forms retain their actual semantics (req: R2)
  Given checkbox and raw-bullet examples plus current style-guide advice
  When the authoring examples are reviewed against real parsing
  Then raw bullets are identified as legacy unparsed and Requirements examples use the canonical Rn dot form without checker changes

Scenario: AC3 — Isolated canaries preserve completion checks (req: R3)
  Given scratch valid tasks for each AC form and baseline outputs for 1053–1056
  When real task checks run before and after guidance edits
  Then expected subset, requirement and checkbox findings retain their severities and existing corpus outputs do not regress with repeatable JSON evidence
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-02T23:58:10.310Z

Closed: documentation/templates only; no checker extension. Closed: task-local uses explicit altitude plus Scenario req bindings, not unparsed AC bullets. Closed: keep existing checkbox and legacy freeform semantics unchanged, naming their enforcement limits. Closed: F96 remains active and owns completion authoring guidance; criteria are task-local, not invented F96 ship scenarios. Closed: do not migrate 1053–1056 or fix their separately reported implementation residuals.

### Design

No new API, checker policy, schema or default altitude. Owners: config/templates/task/{standard,feature-impl,issue,brainstorm,review,meta}.md AC comments and plugins/sp/skills/spur-dev/references/ac-style-guide.md; touch existing template/contract tests only as needed to verify guidance and canaries. The source authority is packages/app/src/services/task-check.ts:800 (Scenario-only requirement bindings when ac_numbering=task-local), :960 (unchecked boxes at terminal state), :1776 (feature subset skipped solely by explicit ac_altitude=task-local), :1812 (uncovered warning). Preferred task-local example: Scenario: AC1 — concrete outcome (req: R1), followed by Given/When/Then; set both ac_altitude: task-local and ac_numbering: task-local explicitly. Graduating/absent altitude keeps normalized-title matching against feature scenarios. Checkbox ACs participate in checklist/subset parsing but do not enter the Scenario-only L3 requirement-binding loop: document this limit rather than invent coverage. Raw - AC1 bullets do not create parsed scenarios; preserve legacy records without advertising a bypass. Requirements use - [ ] R1. text, checked at close. Task-local altitude does not waive unchecked-box, required sections, proof-bound verdict, anchor or any other done checks. Do not promise task-local done merely from AC syntax. Existing style-guide AC-altitude section owns semantics; extend it with one concise decision table and correct competing examples, without duplicating a second policy in dev-operations.md.

### Plan

1. Build isolated task/feature fixtures using the existing task-check test setup before any guidance change; run current source canaries and record exact codes/severities for each form in .spur/run/1061-ac-proof/. Use the real checker/CLI and valid full task fixtures for any overall done-pass assertion.
2. Update ac-style-guide.md decision table and correct Requirements/AC examples against current source (R1/R2).
3. Synchronize the six template comments without changing defaults or completed corpus files (R1).
4. Run task-check.test.ts inside packages/app and relevant template/contract checks; source CLI checks for 1053–1056 must preserve baseline findings, including pre-existing Requirements warnings. Run affected-input corpus checks and applicable task-local gates; no unsuppressed whole-corpus cleanup or gratuitous Superskill adapter installation (R3).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

Planning-stage validation only: 2026-10-02 source audit and existing regression suites. Implementation proof remains pending; execute the isolated artifacts and focused checks specified in Plan. Do not treat this readiness audit as runtime verification PASS.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

packages/app/src/services/task-check.ts:800; packages/app/src/services/task-check.ts:960; packages/app/src/services/task-check.ts:1776; packages/app/tests/services/task-check.test.ts:1972; packages/app/tests/services/task-check.test.ts:2726; config/templates/task/issue.md:30; plugins/sp/skills/spur-dev/references/ac-style-guide.md AC altitude / task-side numbering. Current task-check suite: 192 tests passed during audit.

Audit: HEAD 8467f6f6d; only the main worktree was registered; `task list --status wip --json` returned []; active todo titles reviewed for duplicate ownership. Recheck before delegation. No implementation dependencies. 1058 and 1059 share execution-batch.md: serialize their writes or use isolated worktrees and review integration.

### History

- 2026-10-02T23:41:49.875Z backlog → todo (system)

