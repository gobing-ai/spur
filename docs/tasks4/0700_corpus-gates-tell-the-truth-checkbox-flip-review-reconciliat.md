---
schema_version: 1
name: "Corpus gates tell the truth: checkbox flip, Review reconciliation, scenario coverage, and three misfiring signals"
status: todo
template: issue
created_at: 2026-08-28T22:21:18.557Z
updated_at: "2026-08-28T22:49:25.302Z"
feature_id: F95
parent_wbs: "0698"
ac_altitude: task-local
---

## 0700. Corpus gates tell the truth: checkbox flip, Review reconciliation, scenario coverage, and three misfiring signals

### Background
Decomposed from task **0698** (`### Requirements` R7, R8, R9, R12, R17, R18, R19a). Every claim was
reproduced against `HEAD` = `dad078ad5` on 2026-08-28; the full evidence bundle is in 0698
`### Root Cause`.

**Why these seven belong in one task.** They are all L3/L4 gate logic reachable from four adjacent
files — `packages/app/src/services/{task-check,feature-check,structural-repair,task-service}.ts` plus
the shared parser in `packages/domain/src/bdd/checklist.ts`. More decisively, they share one
consequence: **each change moves corpus-sweep counts**, and constitution **T10** obliges the author
who tightens or adds a finding code to reconcile the fallout in the same commit. Splitting them means
paying that reconciliation four separate times against a baseline that shifts underneath each pass.
Landed together, it is one reconciliation and one `spur task check --corpus` run.

**What the source runs actually cost.** The `dev-verify-0693` run manually flipped eight checkboxes
that `task record` should have flipped and `task check --fix` claimed it would repair. Three separate
runs "fixed" `L4.uncovered-feature-scenario` by re-authoring task acceptance criteria to copy their
feature's scenario titles verbatim — a workaround that scales to every task in the corpus and teaches
authors to write AC for the matcher rather than for the reader. The `sp-dev-verify-0687` run replaced
a stale `PARTIAL — request-changes` Review by hand because no gate compares it to the Testing verdict.
The `dev-refine-0693` run tripped `L3.requirements-format` by adding exactly the non-goals block the
implement-ready checklist demands. The `sp-dev-refineall-f94` run was warned to model a gate as a
frontmatter dependency on a task that already had one.

**The scale of the unrepaired backlog.** `config/corpus-baseline.json` currently accepts **158**
`L3.unchecked-checklist` entries and **267** `L3.requirements-checkbox` entries. Those are not
stylistic — they are the accumulated residue of a flip that never fires and a repair that never runs.
Expect this task to move those numbers; that is the point, and reconciling the movement is part of
the work, not a follow-up.

**A live self-demonstration.** Task 0698 itself emits 17 × `L4.uncovered-task-scenario` and
3 × `L4.gate-language` on `spur task check` — every one an instance of a defect filed in this task
(R3 and R6). They are the regression fixture: when R3 and R6 land, 0698's warning count should drop
to zero without a single word of 0698 changing.
### Requirements
Source mapping (parent → this task): 0698 R7 → R1, 0698 R8 → R2, 0698 R9 → R3, 0698 R12 → R4,
0698 R17 → R5, 0698 R18 → R6, 0698 R19(a) → R7.

- [ ] R1. **A verdict that marks an acceptance criterion MET must flip that criterion's checkbox, and `spur task check --fix` must repair what it reports or stop claiming it can.** `parseChecklist` (`packages/domain/src/bdd/checklist.ts:49`) extracts only a bare `^(R\d+)` id, so `- [ ] AC1. …` boxes carry `requirementId: undefined` and `flipVerifiedCheckboxes` (`packages/app/src/services/task-record.ts:212`) skips them unconditionally — **no AC checkbox has ever flipped**. Bold `- [ ] **R1.** …` is invisible for the same reason even though `task-check.ts:667`'s format gate explicitly accepts that spelling. Separately, `structural-repair.ts:22` declares four repair kinds of which the checkbox one only *adds* a `[ ]` marker (`:298`), while `apps/cli/src/commands/task.ts:1122` advertises `--fix` as repairing "R-item checkboxes".

- [ ] R2. **A `done` or `cancelled` task must not be able to carry a `PARTIAL`/`FAIL`/`request-changes` Review verdict beside a PASS Testing verdict with no gate.** `grep -rn "request-changes" packages/app/src packages/config/src` returns nothing. `task record` backfills `### Review` only when the section is bare (`task-service.ts:1147`), and `sp:code-verification` Step 10 forbids the verify pass from writing `## Review` at all, so nothing in the system can reconcile a stale one. Task 0693 demonstrates the end state: `**Verdict: PARTIAL — request-changes**` at `:272` and `**Verdict: PASS**` at `:315`, both live on a `done` task.

- [ ] R3. **Feature-scenario coverage must be satisfiable without a task copying its feature's scenario titles.** DD-09 links a feature scenario to a task by normalized *title* (`feature-check.ts:446`, `:519`, `:627-650`). Feature F95's scenarios are titled `R1 —`/`R2 —`/`R3 —`; task 0693's acceptance criteria are `AC1`–`AC4`; nothing matches, so a `done`, linked, correctly-implemented task leaves its feature reporting `L4.uncovered-feature-scenario` forever, and `apps/cli/src/commands/task.ts:1013-1020` re-emits the same complaint on every `task verdict` derivation. The inverse rule (`L4.uncovered-task-scenario`, the DD-09 subset check) fires 17 times on task 0698 for legitimate work outside its parent feature's scenario list.

- [ ] R4. **The `L4.dogfood-missing` gate must not decide a feature's fate from gitignored files.** `.gitignore:184` ignores `/docs/dogfood/*` with five tracked exceptions; 84 reports exist on disk. `feature-check.ts:575-585` scans that directory for a filename segment matching the feature id, so **41** features currently pass the gate on evidence that is not in the repository — a fresh clone or a CI run flips roughly 36 of them to failing with no code change.

- [ ] R5. **`L3.requirements-format` must not penalize the shape `--depth ready` mandates.** `task-check.ts:656-671` splits the section on `/\n\s*\n/` and warns when fewer than half the blocks start with an R-number. Four contiguous R-item lines are one block, so adding the two non-goals prose blocks the implement-ready checklist requires scores 1 numbered of 3 and warns. The scaffolded template passes only because it contains nothing but R-items. The line-count tolerance that this heuristic exists to provide (the 0174 bug) must survive the fix.

- [ ] R6. **The `L4` gate-language advisory must not fire on a task that already models its gate.** `task-check.ts:1266` emits `"<section> contains gate language; model the gate as a frontmatter dependency or verify it before treating the task as ready"` without ever reading `frontmatter.dependencies`. Task 0694 carries `dependencies: [0691]` and is warned on both Design and Plan; task 0698 is warned three times. The advisory is pure noise on exactly the well-formed case.

- [ ] R7. **Feature B's task roster must match the corpus.** `docs/features/B_agent-execution.md:25-27` reads `_No linked tasks._` while tasks 0687, 0689 and 0690 all carry `feature_id: B`. A sweep of all 117 features carrying an `AUTO-GENERATED` block found this is the **only** stale roster, so the fix is a resync, not a mechanism change — but confirm why it drifted before closing, since a one-off that nobody noticed for a day is a signal about when the block is regenerated.

**Out of scope.** Re-tightening the `L4.stale-line-anchor` drift detector (474 baselined entries
after the ADR-090 acceptance) — that is a separate decision recorded in 0698. Also out: un-ignoring
`docs/dogfood/` purely as a delivery-contract change independent of R4's gate correctness; any change
to the ADR-090 single-sided baseline mechanism itself; and silencing any finding this task moves by
regenerating `config/corpus-baseline.json` instead of reconciling it (constitution **T10**).
### Acceptance Criteria
```gherkin
Feature: Corpus gates tell the truth

  Scenario: AC1 — A MET acceptance criterion flips its own checkbox
    Given a task whose Requirements carry "- [ ] **R1.** ..." and AC carry "- [ ] AC1. ..."
    And a verdict artifact marking both R1 and AC1 as MET
    When spur task record runs against that verdict
    Then both boxes read [x]
    And a box the verdict does not mention is left untouched

  Scenario: AC2 — task check --fix repairs or stops advertising the repair
    Given a done task carrying unchecked boxes the verdict proves MET
    When spur task check <wbs> --fix --json runs
    Then repairs[] names the flipped boxes and the finding clears
    Or the --fix help text no longer claims to repair R-item checkboxes

  Scenario: AC3 — A done task cannot hide a request-changes Review
    Given a done task whose Review verdict line reads PARTIAL - request-changes
    And whose Testing section records PASS
    When spur task check runs on it
    Then a finding names the contradiction and routes the repair to /sp:dev-review
    And a done task whose Review and Testing agree emits no such finding

  Scenario: AC4 — Feature scenario coverage is satisfiable without title mimicry
    Given feature F95 and its linked done task 0693 whose AC are numbered AC1-AC4
    When spur feature check F95 --strict runs
    Then no scenario reports L4.uncovered-feature-scenario on title mismatch alone
    And a task doing legitimate work outside its feature's scenarios is not warned per row

  Scenario: AC5 — An unmatched verdict is blocking where it can be acted on
    Given a feature whose done gate is reached with no verdict row matching any scenario
    When the feature done transition is attempted
    Then it is blocked with a finding, not a stderr warning at task verdict time

  Scenario: AC6 — The dogfood gate does not depend on untracked files
    Given a fresh clone containing no untracked docs/dogfood reports
    When spur task check --corpus runs
    Then the L4.dogfood-missing population equals the working tree's population

  Scenario: AC7 — Requirements format accepts the implement-ready shape
    Given a Requirements section with four contiguous R-items and a non-goals prose block
    When spur task check runs
    Then L3.requirements-format does not fire
    And a section with multi-paragraph R-item bodies still does not false-positive

  Scenario: AC8 — The gate-language advisory reads the dependency it demands
    Given a task carrying a non-empty frontmatter dependencies list
    When spur task check runs
    Then the L4 gate-language advisory does not fire
    And a task with gate language and no declared dependency is still warned

  Scenario: AC9 — Task 0698 checks clean without being edited
    Given task 0698 unchanged at its current content
    When spur task check 0698 runs after R3 and R6 land
    Then it reports zero L4.uncovered-task-scenario and zero L4.gate-language findings

  Scenario: AC10 — Feature B lists its three tasks
    Given tasks 0687, 0689 and 0690 all carry feature_id B
    When docs/features/B_agent-execution.md is read
    Then its AUTO-GENERATED block lists all three with their statuses
```
### Q&A
**Q: For R1, is the fix in the parser or in the flip?** The parser. `flipVerifiedCheckboxes` is
already correct — it normalizes verdict ids to their `R\d+` prefix (`task-record.ts:173`, the 0692
fix) and skips anything whose `requirementId` is `undefined`. What is wrong is that
`parseChecklist` never produces an id for an AC row or a bold R row. Widening one regex in
`packages/domain/src/bdd/checklist.ts:49` makes both work with no change to the flip. That is the
root-cause fix; patching `flipVerifiedCheckboxes` to re-parse would leave `feature-check.ts:276,519,639`
and `task-check.ts:1569` — the other four `parseChecklist` callers — still blind to AC ids.

**Q: Won't widening the id regex change DD-09 matching?** Check it. `feature-check.ts:519` passes
`parseChecklist(taskAc)` into `checkAcCoverage`, so AC rows that currently yield no `requirementId`
would start yielding `AC1`, `AC2`, …. Confirm against the existing `feature-check` tests before and
after; if coverage semantics shift, that interaction is R3's business and the two must land together.

**Q: For R2, which verdict line does the rule read when a task carries two?** Task 0693 carries a
stale `PARTIAL — request-changes` at `:272` and a superseding `**Verdict: PASS**` at `:315`. **Open —
implementer's call, record it in `### Solution`.** Reading the last verdict line treats an append as
a correction and 0693 passes; flagging the contradiction outright treats both as live and 0693 fails
until someone deletes the stale line. The second is stricter and arguably more honest, but it makes
`/sp:dev-review` the only repair path for a section three prior runs already had to hand-edit. Decide,
then make the finding message say which semantics it enforces.

**Q: For R3, alias or decomposition-time title carrying?** Both are listed in 0698 `### Design`; they
are not exclusive. An explicit `covers:` alias per AC row is the smaller, backward-compatible change
and it fixes the existing corpus without rewriting 117 features' tasks. Carrying scenario titles at
decomposition time prevents the *next* mismatch but does nothing for tasks already written. Prefer the
alias for this task and note the decomposition change as a follow-up if the alias proves insufficient.

**Q: For R4, track the reports or move the evidence?** **Open — operator-adjacent, record the choice
in `### Solution`.** Tracking `docs/dogfood/*.md` makes the gate read committed evidence and makes
reports reviewable in PRs, at the cost of ~84 files and whatever they contain entering git history.
Moving the gate's evidence to a tracked ledger (a `dogfood:` frontmatter field on the feature, or a
tracked index file) keeps the reports local but requires a write step nobody currently performs. What
is **not** acceptable is leaving a shipped gate deciding feature readiness from files that are not in
the repository.

**Q: How much corpus fallout should I expect?** Material. `L3.unchecked-checklist` has 158 baselined
entries and `L3.requirements-checkbox` has 267; R1 changes what is repairable, R5 and R6 change what
fires. Constitution **T10** requires reconciling that movement in the same commit — not regenerating
`config/corpus-baseline.json` to absorb it. Run `spur task check --corpus` **once** at commit prep
(constitution **T11**), not per edit; the sweep costs ~41 s and is a commit gate, not a diagnostic.

**Q: Why does this task's own AC warn `L4.uncovered-task-scenario`?** Same reason task 0698's does —
it is R3's root cause seen from the subset side. The warnings are the regression fixture (AC9), not a
defect to work around by renaming scenarios.
### Design
#### WHAT

Seven gate repairs across four service modules and one shared domain parser. One new L3 rule (R2),
one widened regex (R1), one new coverage alias (R3), one evidence-source decision (R4), two advisory
predicates corrected (R5, R6), one corpus resync (R7). No new abstraction and no new CLI surface.

#### WHY one task

Every item moves corpus-sweep counts, and constitution **T10** binds the author who moves them to
reconcile the fallout in the same commit. Four smaller tasks would pay that reconciliation four times
against a baseline shifting underneath each pass. They also cluster on one file family, so the tests
that prove them live in two test files, not seven.

#### WHERE — change map

| R | File | Anchor | Change |
| --- | --- | --- | --- |
| R1 | `packages/domain/src/bdd/checklist.ts` | `:49` | Widen `^(R\d+)\s*[:\-—]?\s*(.*)$` to also match `AC\d+` and optional `**` emphasis — e.g. `^\**\s*((?:AC\|R)\d+)\.?\**\s*[:\-—]?\s*(.*)$`. Verify the four other `parseChecklist` callers (`feature-check.ts:276,519,639`, `task-check.ts:1569`) before and after |
| R1 | `packages/app/src/services/structural-repair.ts` | `:22`, `:266-300` | Either add a `verified-checkbox` repair kind driven by the task's verdict artifact, or leave repair alone and strike "R-item checkboxes" from `apps/cli/src/commands/task.ts:1122`'s help text. Do not leave the text claiming a repair that does not exist |
| R2 | `packages/app/src/services/task-check.ts` | L3 block near `:865` | New rule: on `done`/`cancelled`, parse `### Review`'s verdict line; if it matches `PARTIAL\|FAIL\|request-changes` while `### Testing` records PASS, emit an error naming `/sp:dev-review <wbs>` as the repair. Two-verdict semantics are an open decision — see `### Q&A` |
| R2 | `packages/config/src/finding-codes.ts` | code table | Register the new code alongside the existing `L3.*` entries |
| R3 | `packages/app/src/services/feature-check.ts` | `:446`, `:519`, `:627-650` | Add an explicit per-AC-row `covers:` alias so coverage stops depending on title mimicry; keep normalized-title matching as the fallback so no existing task regresses |
| R3 | `apps/cli/src/commands/task.ts` | `:1013-1020` | Promote the "no verdict row matches any scenario" stderr warning to a blocking finding at the **feature done gate**, where it can be acted on, rather than repeating it on every `task verdict` derivation |
| R4 | `.gitignore:184` **or** `packages/app/src/services/feature-check.ts:575-590` | — | Implement one of the two options in `### Q&A`. Whichever is chosen, the gate must read repository state |
| R5 | `packages/app/src/services/task-check.ts` | `:656-671` | Count R-numbered *items* rather than blank-line blocks, or exempt a trailing `**Out of scope`/non-goals block from the denominator. Preserve the line-count tolerance the block heuristic exists to provide (0174) |
| R6 | `packages/app/src/services/task-check.ts` | `:1266` | Suppress when `doc.frontmatterData?.dependencies` is non-empty, or reword to name the specific unsatisfied gate |
| R7 | `docs/features/B_agent-execution.md` | `:25-27` | `spur feature sync B` (CLI-gated — never a raw edit). Confirm *why* it drifted before closing |

#### Frozen names

One new L3 finding code for R2 (name it in `packages/config/src/finding-codes.ts`) and one new AC-row
field name for R3's `covers:` alias. Both are corpus-schema surface, not CLI surface — **ADR-051
consent is not triggered**. Document both in `docs/04_DESIGN.md` in the same commit (constitution
**T3**).

#### Precedence

`docs/00_ADR.md` ADR-090 owns the single-sided baseline gate; this task must work *inside* it, never
around it. `docs/99_PROJECT_CONSTITUTION.md` **T10** governs the fallout, **T11** governs when the
sweep runs.

#### Anti-patterns — do not do these

- **Do not regenerate `config/corpus-baseline.json` to absorb findings this task creates.** T10 is
  explicit: a tightened or added finding code obliges same-commit reconciliation. Regeneration is the
  acceptance path for findings you have decided not to fix, not a way to silence your own.
- **Do not "fix" R3 by renaming task acceptance criteria to copy feature scenario titles.** Three
  prior dogfood runs did exactly that; it is the disease, and it scales to every task in the corpus.
- **Do not patch `flipVerifiedCheckboxes` instead of `parseChecklist`.** The flip is correct; the
  parser is blind. Fixing the caller leaves four other callers blind.
- **Do not leave the `--fix` help text advertising a repair that does not exist.** Either implement
  it or delete the claim.
- **Do not run `spur task check --corpus` per edit.** Once, at commit prep (T11).
### Plan
Ordered so the two advisory corrections (cheap, high-noise) land before the coverage work that has to
be read against a quiet sweep.

1. [ ] **Capture the pre-change baseline.** Record `spur task check --corpus --json` counts by code
   and `spur task check 0698` warning counts. These are AC9's fixture and the T10 reconciliation
   reference. Test intent: without a recorded starting point, "reconcile the fallout" is unverifiable.

2. [ ] **Silence the two misfiring advisories (R5, R6).** Count R-items rather than blocks; suppress
   the gate-language advisory when `frontmatter.dependencies` is non-empty. Unit-test both directions
   — the well-formed case stops warning **and** the genuinely malformed case still warns. Test intent:
   the sweep gets quieter by exactly the number of false positives, and no true positive is lost.

3. [ ] **Widen the checklist id parser (R1, first half).** Extend `packages/domain/src/bdd/checklist.ts:49`
   to `AC\d+` and bold emphasis. Run the four other `parseChecklist` callers' tests before deciding
   whether DD-09 semantics shift; if they do, fold that interaction into step 5. Regression: a verdict
   marking AC1 MET flips the AC1 box, and a bold `**R1.**` box flips.

4. [ ] **Settle the `--fix` claim (R1, second half).** Either add the `verified-checkbox` repair kind
   or strike "R-item checkboxes" from `apps/cli/src/commands/task.ts:1122`. Record which and why in
   `### Solution`. Test intent: `task check --fix` never again reports a finding it silently declines
   to repair.

5. [ ] **Make coverage satisfiable (R3).** Add the `covers:` alias with normalized-title matching
   retained as fallback; promote the unmatched-verdict warning to the feature done gate. Regression:
   `spur feature check F95 --strict` reports no title-mismatch orphan, and task 0698 emits zero
   `L4.uncovered-task-scenario` findings **without 0698 being edited** (AC9).

6. [ ] **Add the Review-vs-Testing rule (R2).** Register the finding code, implement the rule, decide
   the two-verdict semantics from `### Q&A` and make the message state which it enforces. Regression:
   task 0693 behaves per the chosen semantics; a task whose Review and Testing agree stays clean.

7. [ ] **Decide and implement the dogfood evidence source (R4).** Track the reports or move the gate
   to a tracked ledger. Prove it: with untracked `docs/dogfood/*` temporarily moved aside, the
   `L4.dogfood-missing` population must be unchanged. Test intent: the gate reads the repository, not
   the machine.

8. [ ] **Resync feature B (R7).** `spur feature sync B` through the CLI. Confirm and record why the
   block drifted — a one-off nobody noticed for a day says something about when rosters regenerate.

9. [ ] **Reconcile and commit-prep.** `bun run autofix && bun run spur-check`; then
   `spur task check --corpus` **once**. Diff the by-code counts against step 1's baseline; every delta
   must be either an intended fix or an explicitly reconciled finding — **not** a baseline regeneration.
   Author `### Solution` with the change map, the three open decisions resolved (R1 `--fix`, R2 verdict
   semantics, R4 evidence source), and the before/after count table.
### Root Cause
All seven reproduced against `HEAD` = `dad078ad5` on 2026-08-28.

**R1 — AC checkboxes are invisible to the flip.** `packages/domain/src/bdd/checklist.ts:49`:

```ts
const reqIdMatch = rawText.match(/^(R\d+)\s*[:\-—]?\s*(.*)$/);
```

Only a bare `R\d+` yields a `requirementId`. `flipVerifiedCheckboxes`
(`packages/app/src/services/task-record.ts:191-221`) then skips every item it cannot identify:

```ts
const rid = item.requirementId;
if (rid === undefined || !proven.has(rid)) continue;
```

So `- [ ] AC1. …` never flips, and `- [ ] **R1.** …` never flips — while `task-check.ts:667`'s
format gate explicitly accepts the bold spelling
(`/^\s*[-*]?\s*(?:\[[ xX]\]\s*)?[*_]{0,2}R\d+\.?[*_]{0,2}\s/`). The 0692 `prefixId` fix
(`task-record.ts:173`) normalizes the *verdict* side only; the *document* side was never widened.

`packages/app/src/services/structural-repair.ts:22` declares
`kind: 'heading-level' | 'section-order' | 'missing-section' | 'requirement-checkbox'`, and the last
only inserts a `[ ]` marker (`:298`: `lines[rr.index] = …'[ ]'…`). Nothing anywhere flips `[ ]` to
`[x]` outside `flipVerifiedCheckboxes`. Meanwhile `apps/cli/src/commands/task.ts:1122` reads
`'repair structural findings in place (heading presence/level/order, R-item checkboxes)'`.

Scale, from `config/corpus-baseline.json` (1,949 entries): `L3.unchecked-checklist` **158**,
`L3.requirements-checkbox` **267**.

**R2 — no gate reads the Review verdict.**

```
$ grep -rn "request-changes" packages/app/src packages/config/src
(no output)
```

`docs/tasks4/0693_….md:272` → `**Verdict: PARTIAL — request-changes** (blocks gate; R1–R3 MET, R4/AC4
PARTIAL on the failure-envelope surface)`; `:315` → `**Verdict: PASS** (R1–R4 MET, AC1–AC4 MET).
Supersedes the PARTIAL — request-changes above.` Both live on a `done` task.
`packages/app/src/services/task-service.ts:1147` gates the backfill on `sectionIsBare(doc, 'Review')`,
and `plugins/sp/skills/code-verification/SKILL.md` Step 10 states "Do not write `## Review` directly,
ever" — so the verify pass is contractually barred from repairing it and `record` declines to.

**R3 — DD-09 matches titles.** `packages/app/src/services/feature-check.ts:446`: *"A scenario is
'covered' by a task when DD-09 normalized-title matching …"*; the covering-set build is at `:627-650`
and the orphan intersection at `:507-529`. Feature F95's scenarios are `R1 — The envelope decision is
recorded as an ADR`, `R2 — The current shapes are inventoried per noun`, `R3 — Implementation follows
the approved ADR`; task 0693's are `AC1`–`AC4`. `apps/cli/src/commands/task.ts:1013-1020` re-emits
the same complaint on every `task verdict` run as a stderr warning that fails nothing.

The subset direction is live right now on task 0698: `spur task check 0698` returns `pass: true` with
**17 × `L4.uncovered-task-scenario`**, one per acceptance criterion that is not in F95's list — while
`AC1`, deliberately titled `R3 — Implementation follows the approved ADR`, matches and is silent.
That single row also flipped `spur feature check F95` from reporting three orphan scenarios to `PASS`,
which is direct evidence that title mimicry is the only currently-working mechanism.

**R4 — the dogfood gate reads gitignored files.**

```
$ grep -n dogfood .gitignore
183:# Local dogfood run reports (gitignored); keep README tracked …
184:/docs/dogfood/*
189:!/docs/dogfood/README.md
$ git ls-files docs/dogfood | wc -l   # 5
$ ls docs/dogfood | wc -l             # 84
```

`packages/app/src/services/feature-check.ts:575-585` builds
`new RegExp('(^|[^A-Za-z0-9])' + featureId + '([^A-Za-z0-9]|$)', 'i')` and tests it against
`readdir('docs/dogfood')`. A scan of all features against the on-disk listing finds **41** currently
satisfied by a report; at most 5 survive a fresh clone. (The case-sensitivity half of this defect was
already fixed — the `i` flag landed in `1a2cfd75e`.)

**R5 — the block heuristic vs the implement-ready checklist.**
`packages/app/src/services/task-check.ts:656-671` splits on `/\n\s*\n/`, counts blocks whose first
line is R-numbered, and warns when `numbered === 0 || numbered < blocks.length * 0.5`. Four contiguous
R-item lines collapse to one block; the two non-goals prose blocks `--depth ready` requires make the
ratio 1 of 3. The comment at `:651-655` records that the block form exists to fix the 0174 bug
(per-line counting diluted multi-line R-items) — that property must survive.

**R6 — the advisory ignores the remedy it demands.**
`packages/app/src/services/task-check.ts:1266` emits
`` `${section} contains gate language; model the gate as a frontmatter dependency or verify it before treating the task as ready` `` with no read of `frontmatter.dependencies`. Task 0694 carries
`dependencies: [0691]` and is warned on Design and Plan; task 0698 is warned on Background,
Requirements and Acceptance Criteria — three of its three prose sections.

**R7 — feature B's roster is stale.** `docs/features/B_agent-execution.md:25-27`:

```
<!-- AUTO-GENERATED by spur feature refresh -->
_No linked tasks._
<!-- END AUTO-GENERATED -->
```

while `docs/tasks4/0687_….md`, `0689_….md` and `0690_….md` all carry `feature_id: B`. A sweep of
every feature carrying an `AUTO-GENERATED` block (**117** of them) against the corpus edges found
exactly **one** mismatch: B, missing 0687, 0689, 0690.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
**Parent:** task **0698** — `### Requirements` R7, R8, R9, R12, R17, R18, R19(a). **Feature:** F95
(placement inherited from the parent; the gate work itself is wider than F95's charter — see 0698
`### Background`).

**Source dogfood runs.** `docs/dogfood/2026-08-27-dev-verify-0693-dogfood.md` (fixed #3: eight boxes
flipped by hand; P2 `task check --fix` repairs nothing; P2 stale `request-changes` Review with no
gate; P2 all three F95 scenarios uncovered; P4 gitignored dogfood reports) ·
`docs/dogfood/2026-08-27-dev-runall-f94-inline-dogfood.md` (Finding 1 decomposition emitted
non-matching AC; Finding 6 R2 auto-flip under-flipped on parenthesized ids; batch-wrap-hop re-keyed
two tasks' verdicts to feature scenario titles) ·
`docs/dogfood/2026-08-27-sp-dev-verify-0687-dogfood.md` (fixed #3: Review retained a prior PARTIAL) ·
`docs/dogfood/2026-08-27-dev-refine-0693-dogfood.md` (P3 `L3.requirements-format` penalizes the
implement-ready shape) · `docs/dogfood/2026-08-27-sp-dev-refineall-f94-dogfood.md` (P4 gate-language
advisory on a task with a declared dependency) ·
`docs/dogfood/2026-08-27-dev-runall-feature-D7-dogfood.md` (F8 dogfood gate is machine-local) ·
`docs/dogfood/2026-08-27-dev-runall-feature-b-dogfood.md` (P3 stale feature B roster) ·
`docs/dogfood/2026-08-27-sp-dev-run-0693-worktree-dogfood.md` (F5 scenario-keying warning noise).

**Authority.** `docs/00_ADR.md` ADR-090 — the single-sided corpus baseline gate this task works
inside · `docs/99_PROJECT_CONSTITUTION.md` **T10** (a tightened finding code obliges same-commit
reconciliation), **T11** (the corpus sweep is a commit gate, not a per-edit diagnostic), **T3**
(surface + `docs/04_DESIGN.md` same commit) · `plugins/sp/skills/code-verification/SKILL.md` Step 10
(verify may never write `## Review` — the contract that makes R2 necessary).

**Code anchors.**

- `packages/domain/src/bdd/checklist.ts:27-67` — `parseChecklist`, the `:49` id regex
- `packages/app/src/services/task-record.ts:173` (`prefixId`), `:191-221` (`flipVerifiedCheckboxes`)
- `packages/app/src/services/task-service.ts:1147` (Review backfill gate), `:1161-1172` (flip caller)
- `packages/app/src/services/structural-repair.ts:22` (repair kinds), `:266-300` (checkbox repair)
- `packages/app/src/services/task-check.ts:651-679` (requirements format + the 0174 rationale),
  `:840-870` (`L3.unchecked-checklist`), `:1266` (gate-language advisory), `:1569` (a `parseChecklist` caller)
- `packages/app/src/services/feature-check.ts:276`, `:446`, `:507-529`, `:519`, `:575-590`, `:627-650`
- `apps/cli/src/commands/task.ts:1013-1020` (verdict scenario warning), `:1122` (`--fix` help text)
- `packages/config/src/finding-codes.ts:22,31,91,100` — where R2's new code is registered
- `config/corpus-baseline.json` — 1,949 entries; `L3.unchecked-checklist` 158, `L3.requirements-checkbox` 267
- `.gitignore:183-189` · `docs/features/B_agent-execution.md:25-27` · `docs/tasks4/0693_….md:272,315`

**Live fixtures.** `spur task check 0698` (17 × `L4.uncovered-task-scenario`, 3 × `L4.gate-language`)
and `spur feature check F95` (`PASS` only because task 0698's `AC1` mimics F95's `R3` title).

**Commits consulted.** `cee844c45` (anchor-drift detection + verified-box auto-flip — the 0692 work
this task completes), `1a2cfd75e` (case-insensitive feature-id match — the already-fixed half of R4),
`71f588678` / `0c2c0eaea` / `42c4aabbc` (ADR-090 baseline gate and regen script).
### History
