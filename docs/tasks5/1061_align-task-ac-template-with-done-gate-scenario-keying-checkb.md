---
schema_version: 1
name: Align task AC template with done-gate scenario keying (checkbox ACs key L4.uncovered-task-scenario)
status: done
template: feature-impl
created_at: 2026-10-02T23:30:56.374Z
updated_at: "2026-10-03T03:18:31.606Z"
feature_id: F96

priority: P3
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-dev-run-1061-d36a/.spur/memory/evidence/1061-verdict.json
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

- [x] R1. Align all six task template AC guidance comments and ac-style-guide.md around the existing distinction: ac_altitude controls feature subset; ac_numbering controls task requirement bindings. Recommend Scenario: ACn titles with explicit req bindings for task-local regression work; retain parsed checkbox ACs as a supported form without claiming equivalent requirement-binding enforcement.
- [x] R2. Correct contradictory authoring guidance in ac-style-guide.md, including plain/bold form and outdated Requirements formatting advice. Explain raw freeform AC bullets as legacy unparsed content, not a sanctioned way to avoid traceability; do not change checker behavior or migrate completed tasks.
- [x] R3. Provide repeatable isolated checks for graduating title mismatch, task-local Scenario binding, missing req coverage, checkbox completion and legacy raw bullets, plus unchanged checks for 1053–1056. Assert expected finding codes/severities rather than claiming whole checks pass despite unrelated unresolved findings.

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

Guidance-only alignment of task AC authoring with done-gate scenario keying (R1–R3); no checker,
schema, default-altitude, or completed-corpus changes.

Change map:

- plugins/sp/skills/spur-dev/references/ac-style-guide.md:30 — rewrote "Task-side numbering (`AC<n>`)"
  around the two-control distinction: `ac_altitude` owns the feature subset (DD-09), `ac_numbering:
  task-local` owns requirement bindings via the Scenario-only `(req: R<n>)` loop; preferred
  task-local form `Scenario: AC1 — <concrete outcome> (req: R1)` with both fields declared; checkbox
  rows documented as parsed-but-not-binding; raw `- AC1` bullets documented as legacy unparsed
  records, not a traceability bypass (R1, R2).
- plugins/sp/skills/spur-dev/references/ac-style-guide.md:300 — added the "Choosing an AC form"
  decision table (graduating / task-local / checkbox / legacy rows) and the limit that task-local
  altitude skips only the subset check — never unchecked-box, required sections, verdict, or anchor
  checks (R1, AC1).
- plugins/sp/skills/spur-dev/references/ac-style-guide.md:163-170 — corrected the verdict-bold-head
  advice: requirement ids belong in the template form `- [ ] R1. <text>` (bold `**R1**` passes the
  `L3.requirements-format` ratio but binds nothing in the coverage loop); bold AC heads scoped as a
  verdict-table id form, not the authoring form (R2).
- config/templates/task/{standard,feature-impl,issue,brainstorm,review,meta}.md:30 — synchronized AC
  guidance comments to the same distinction, preferred task-local Scenario form, checkbox limit,
  legacy-bullet caveat, and `- [ ] R1. <text>` Requirements form; per-template tails and all
  frontmatter defaults unchanged (R1).
- apps/cli/tests/commands/task.test.ts:3695 — updated the `AC_PLACEHOLDER` sed pattern of the 0788
  ready-by-default contract test to the new standard.md comment (R1).
- packages/app/tests/services/task-check.test.ts:2040 — added the "1061 canaries" describe: six
  isolated checks asserting exact finding codes/severities per AC form (graduating drift →
  L4.uncovered-task-scenario warning; task-local binding with unbound R2 → L3.ac-requirement-coverage
  warning; complete binding silent; checkbox-only AC silent on the Scenario-only loop; done + open
  boxes → L3.unchecked-checklist warning; legacy raw bullets silent) (R3).

Rationale: refinement corrected the historical framing — altitude bypasses the feature subset only,
numbering opts Scenario titles into requirement coverage, and the templates/style guide taught a
conflated form. The checker semantics were already correct (packages/app/src/services/task-check.ts:800,
:960, :1776, :1812); this pass fixes discoverability and contradictory guidance and pins the
semantics with repeatable checks. Runtime proof: .spur/run/1061-ac-proof/ — fixture canaries
(9001–9006) and 1053–1056 corpus outputs byte-identical before/after the guidance edits, including
their pre-existing L3.requirements-format warnings.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/templates/task/standard.md:30` comment teaches the two-control distinction (altitude skips only the feature-subset check; `(req: R<n>)` numbering binds; checkbox rows never bind; raw bullets legacy); all template copies pinned synchronized by `apps/cli/tests/templates/ac-guidance-consistency.test.ts` (4 pass / 0 fail fresh this turn); style guide split at `plugins/sp/skills/spur-dev/references/ac-style-guide.md:36-45`, preferred task-local form :44-45, decision table :300-311. Re-read this run. |
| R2 | MET | `plugins/sp/skills/spur-dev/references/ac-style-guide.md:166-170` — template form `- [ ] R1. <text>`, bold `**R1**` 'passes the ratio but binds nothing'; :51-54 raw freeform bullets as legacy unparsed records, 'don't reach for them to dodge traceability'. No checker change / no corpus migration re-proven live this run: `spur task check` on 1053/1054/1055/1056 each reports exactly one pre-existing `L3.requirements-format` warning, unchanged. |
| R3 | MET | Isolated canaries asserting exact codes/severities in `packages/app/tests/services/task-check.test.ts:2040` describe '1061 canaries' (graduating drift → L4.uncovered-task-scenario; unbound R2 → L3.ac-requirement-coverage; complete binding silent; checkbox-only silent on the Scenario loop; open boxes → L3.unchecked-checklist; legacy bullets silent). Fresh run this turn: bun test tests/services/task-check.test.ts (packages/app) → 198 pass, 0 fail, 330 expect() calls. Record-time fixture artifacts (.spur/run/1061-ac-proof/) are ephemeral and gone; their durable equivalent — the canaries plus today's live 1053-1056 warning check — re-executed green. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Guidance distinguishes altitude and numbering (req: R1) | MET | test | Decision table :300-311 teaches subset skip, graduating L4 on drifted titles, Scenario-only binding, checkbox limits, and 'never makes a task done' closing limits — re-read this run; template comment `config/templates/task/standard.md:30` re-read; consistency suite 4/0 fresh; canary fixture for L4 drift passing in the 198/0 run. |
| Scenario: AC2 — Legacy forms retain their actual semantics (req: R2) | MET | test | :51-54 legacy-unparsed guidance + :166-170 bold-binds-nothing re-read; legacy-bullets-silent canary passes in the fresh 198/0 run; no runtime source touched per scope (checker behavior unchanged, proven by unchanged 1053-1056 warnings today). |
| Scenario: AC3 — Isolated canaries preserve completion checks (req: R3) | MET | test | Fresh runs this turn: packages/app task-check.test.ts 198 pass / 0 fail (includes the 6 canaries); apps/cli task.test.ts -t 'ready-by-default' 7 pass / 0 fail (updated AC_PLACEHOLDER pattern); ac-guidance-consistency.test.ts 4 pass / 0 fail; 1053-1056 corpus checks unchanged (1 pre-existing warning each, live today). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1061

**Scope:** uncommitted working diff on sp/run-1061-d36a (10 files: 6 template AC comments `config/templates/task/{standard,feature-impl,issue,brainstorm,review,meta}.md:30`, `plugins/sp/skills/spur-dev/references/ac-style-guide.md`, `apps/cli/tests/commands/task.test.ts:3695`, `packages/app/tests/services/task-check.test.ts:2035-2183`, task file Solution/History); reviewed against docs/tasks5/1061_align-task-ac-template-with-done-gate-scenario-keying-checkb.md. Task file's own status/wip hunks excluded as pipeline bookkeeping.
**Dimensions:** functional traceability (R1–R3 ↔ AC1–AC3), SECUA quality (security/efficiency/correctness/usability), architecture depth.
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Disposition | Location |
|---|----------|-----------|---------|--------------|----------|
| 1 | P3 (minor) | architecture | AC-guidance comment now exists in 7 near-identical copies (6 templates + condensed style-guide form) plus a sed-escaped 8th copy in the 0788 test; only standard.md's copy is contract-pinned, so the other five templates can drift silently — this task's own diff (8 coordinated lockstep edits for one wording change) demonstrates the coupling cost. Follow-up candidate: a cross-template AC-comment consistency check (or generator); full dedup is wrong since templates must stay self-contained for `spur task create` without the plugin. | Resolved (F96 1063) — the follow-up hardening shipped as task 1063: `apps/cli/tests/templates/ac-guidance-consistency.test.ts` pins all 8 synchronized copies (template bodies + tails, the sed-escaped 0788 copy, the condensed style-guide clauses) and names drifted files on perturbation; 4 pass / 0 fail re-run during the F96 verifyall audit (2026-10-02). Supersedes the original DEFER rationale (own-task scope; the consistency check now has its own task). | `config/templates/task/standard.md:30`, `apps/cli/tests/commands/task.test.ts:3696` |
| 2 | P4 (advisory) | usability | The new "task-local skips only the subset" limit paragraphs (style guide + templates) say the unchecked-box check still applies but omit that the severity escalates warning → error when `--as done` names the transition target (proof canary 9006 shows the error). One clause would preempt close-time surprises for task-local tasks. | DEFER — advisory wording addition; guidance already states the unchecked-box check applies, the escalation nuance is a follow-up doc polish. | `plugins/sp/skills/spur-dev/references/ac-style-guide.md:307-310` |
| 3 | P4 (advisory) | correctness | Positive confirmation, not a defect: every factual claim in the new guidance was re-verified against checker source this run — altitude skips only the subset (`task-check.ts:1790`, `coverage.ts:126`); the coverage loop reads `Scenario:` titles only for `(req: R<n>)` (`task-check.ts:802-858`); checkbox rows join checklist parsing and the subset match but never bind (`checklist.ts:41`, `coverage.ts:130-136`); bold `**R1**` passes the format ratio (`task-check.ts:760` allows `[*_]{0,2}`) but binds nothing (`task-check.ts:815` binding regex has no emphasis wrapper). | None — positive confirmation, no action. | `packages/app/src/services/task-check.ts:1790` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Six templates synchronized to the two-control distinction (altitude=subset DD-09, numbering=requirement bindings): `config/templates/task/standard.md:30` and the five siblings verified identical via "Preferred: `Scenario: AC1" grep (6/6). Style guide rewritten: `plugins/sp/skills/spur-dev/references/ac-style-guide.md:30-52` ("**`ac_altitude`** owns the **feature subset** … **`ac_numbering: task-local`** owns **task requirement bindings** … reads **`Scenario:` titles only**"); preferred task-local form + both fields declared at :43-44; checkbox rows "supported but never bind" at :46-47. |
| R2 | MET | Contradictory bold/plain advice corrected: `ac-style-guide.md:163-170` — requirement ids in template form `- [ ] R1. <text>`, bold `**R1**` "passes the `L3.requirements-format` ratio but binds nothing" (verified against source: R_ITEM_RE `task-check.ts:760` vs binding regex `task-check.ts:815`). Raw bullets as legacy unparsed, not a bypass: `ac-style-guide.md:48-51`. No checker behavior change: diff touches no file under `packages/app/src` or `packages/domain/src` (git diff --stat: 10 files, guidance+tests only). No corpus migration: 1053–1056 untouched; `diff -r baseline-corpus after-corpus` → byte-identical. |
| R3 | MET | Repeatable isolated canaries: `packages/app/tests/services/task-check.test.ts:2040` describe "1061 canaries" — graduating drift `L4.uncovered-task-scenario` warning (:2086), task-local unbound-R2 `L3.ac-requirement-coverage` warning (:2099), complete binding silent (:2115), checkbox-rows-never-bind silent (:2138), done+open boxes `L3.unchecked-checklist` warning (:2155), legacy raw bullets silent (:2168); all assert code+severity filters, never whole-check pass. Unchanged 1053–1056 checks: `.spur/run/1061-ac-proof/{baseline,after}-corpus/` (1053–1056, each exactly its pre-existing `L3.requirements-format` warning) diffed byte-identical this run. Repeatable JSON evidence: `.spur/run/1061-ac-proof/README.md` re-run recipe; fixtures 9001–9006 `baseline` vs `after` diffed byte-identical this run. |

##### Acceptance Criteria Verification

| AC | Status | Evidence |
|----|--------|----------|
| Scenario: AC1 — Guidance distinguishes altitude and numbering (req: R1) | MET | Decision table teaches all three required elements: `ac-style-guide.md:300-310` — Scenario req binding + subset skip (task-local row), graduating subset/DD-09 enforcement (`L4.uncovered-task-scenario` on drifted titles), checkbox enforcement limits ("no requirement binding (`Scenario:`-only)"); the table closes with the "skips only the feature-subset check … never makes a task done" limit. All six templates carry the same distinction (standard.md:30 et al.). |
| Scenario: AC2 — Legacy forms retain their actual semantics (req: R2) | MET | Raw bullets identified as legacy unparsed with real parsing semantics: `ac-style-guide.md:48-51` ("parse as nothing — no subset match, no requirement binding, no box counting"), canary :2168 + fixture 9005 prove silence. Requirements examples use canonical `- [ ] R1. <text>` (:166, all six templates). No checker changes in diff (verified via git diff --stat). |
| Scenario: AC3 — Isolated canaries preserve completion checks (req: R3) | MET | Fresh test runs this turn: `bun test tests/services/task-check.test.ts` (packages/app) → 198 pass / 0 fail (192 baseline + 6 canaries); `bun test tests/commands/task.test.ts -t 'ready-by-default'` (apps/cli) → 7 pass / 0 fail. Corpus non-regression: `diff -r .spur/run/1061-ac-proof/baseline-corpus .spur/run/1061-ac-proof/after-corpus` → no output (byte-identical); `diff -r baseline after` → no output. |

##### SECUA Quality (correctness / security / efficiency / usability)

- **Security:** n/a — guidance comments and tests only; no runtime input handling, secrets, or injection surface touched.
- **Correctness:** all eight distinct semantic claims embedded in the new guidance verified against checker source (see finding #3 anchors). Proof artifacts match source behavior including the `--as done` error escalation (`task-check.ts:976-979`, fixture 9006). No P1/P2.
- **Efficiency:** canaries run in-process against the real `TaskCheckService` (198 tests in 228 ms) — no CLI subprocess per assertion; README's CLI re-run recipe is for human reproducibility only.
- **Usability:** decision table resolves the three-convention confusion the task was filed for; finding #2 records the one omitted nuance (transition-target severity escalation).

##### Architecture Depth (sp-code-improvement)

- No new modules or seams introduced (docs + tests); nothing shallow added.
- The canaries deepen the test surface: they pin checker semantics (code+severity) using the real service, so future guidance edits cannot drift semantics silently — the exact failure mode this task fixes.
- Finding #1 (P3): weak locality/coupling across the six template comments + test-side copy; deepening proposal = cross-template consistency check. Challenge: generators would couple templates to build tooling and break standalone `spur task create`. Defense: a consistency assertion (not a generator) answers it — hence P3 follow-up candidate, not a defect of this diff (the diff correctly synchronized all copies).

##### Verification evidence (pasted, run this turn)

```
$ cd packages/app && bun test tests/services/task-check.test.ts
 198 pass
 0 fail
 330 expect() calls
Ran 198 tests across 1 file. [228.00ms]

$ cd apps/cli && bun test tests/commands/task.test.ts -t 'ready-by-default'
 7 pass
 191 filtered out
 0 fail
Ran 7 tests across 1 file. [814.00ms]

$ diff -r .spur/run/1061-ac-proof/baseline-corpus .spur/run/1061-ac-proof/after-corpus
(no output → byte-identical; CORPUS-IDENTICAL)

$ diff -r .spur/run/1061-ac-proof/baseline .spur/run/1061-ac-proof/after
(no output → byte-identical; FIXTURES-IDENTICAL)
```

Fixture canary findings re-inspected from `.spur/run/1061-ac-proof/after/*.json`: 9001 `L4.uncovered-task-scenario` warning; 9002 `L3.ac-requirement-coverage` warning naming R2 (no L4); 9003 silent on L3/L4; 9004 `L3.unchecked-checklist` warning; 9005 silent on L3/L4; 9006 `L3.unchecked-checklist` **error** on the `--as done` transition — all matching the README expectation table and source (`task-check.ts:976-979` `severity: isTransitionTarget ? 'error' : 'warning'`).

**Residual risks:** P3 finding #1 (guidance-copy drift risk) left as a follow-up candidate per report-only review scope; task status remains `wip` with R-checkboxes open — expected at this pipeline stage, not a review defect.

**Next:** proceed to testing/verify gate; disposition finding #1 (accept or file a follow-up consistency-check task) and optionally fold finding #2's one-clause addition into a later guidance pass.

Functional Verdict: PASS
Review Verdict: PASS (0 blocker/major; 1 minor, 2 advisory)

### References

packages/app/src/services/task-check.ts:800; packages/app/src/services/task-check.ts:960; packages/app/src/services/task-check.ts:1776; packages/app/tests/services/task-check.test.ts:1972; packages/app/tests/services/task-check.test.ts:2726; config/templates/task/issue.md:30; plugins/sp/skills/spur-dev/references/ac-style-guide.md AC altitude / task-side numbering. Current task-check suite: 192 tests passed during audit.

Audit: HEAD 8467f6f6d; only the main worktree was registered; `task list --status wip --json` returned []; active todo titles reviewed for duplicate ownership. Recheck before delegation. No implementation dependencies. 1058 and 1059 share execution-batch.md: serialize their writes or use isolated worktrees and review integration.

### History

- 2026-10-02T23:41:49.875Z backlog → todo (system)
- 2026-10-03T00:58:14.478Z todo → wip (system)
- 2026-10-03T01:24:58.733Z wip → testing (system)
- 2026-10-03T01:30:02.823Z testing → done (system)

