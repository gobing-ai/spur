---
schema_version: 1
name: "Close the plugins conflict-audit residuals: 0587 AC-altitude ruling, bare-basename anchor re-authoring, and the six surface/gate drifts left open"
status: todo
template: standard
created_at: 2026-09-09T07:12:32.313Z
updated_at: "2026-09-09T07:18:15.483Z"
feature_id: F91

ac_altitude: task-local
---

## 0816. Close the plugins conflict-audit residuals: 0587 AC-altitude ruling, bare-basename anchor re-authoring, and the six surface/gate drifts left open

### Background

`/sp:dev-find-conflict plugins --mode full --resolve` (2026-09-08) ran the four-pillar audit over
`plugins/` and landed eight repairs directly: three surface-count corrections in `docs/04_DESIGN.md`
(wrapper counts, the five-gate validator enumeration, the 19-op dev-\* map), four index corrections in
`plugins/sp/README.md` (super-planner's four bound skills, the `pr-reviewing/` tree node, the hooks
shared-module annotation, two stale `Ver` cells), one broken relative link in
`plugins/sp/skills/daily-summary/SKILL.md`, and 34 dangling `plugins/**` evidence anchors re-pointed or
de-anchored across 12 task files through `spur task update --section`.

That run left residue in three shapes, and this task owns all of it:

1. **One finding was deliberately not repaired** because clearing it changes a traceability contract
   rather than a stale fact — task 0587's three `L4.uncovered-task-scenario` warnings.
2. **A finding class was unmasked, not created, by the repair.** `checkLineAnchors` caps at five
   findings per section (`packages/app/src/services/task-check.ts:1431`), so fixing the fully-qualified
   `plugins/**` anchors revealed bare-basename siblings that the cap had been hiding. Corpus
   `L4.stale-line-anchor` fell 189 → 156, not 189 → 155, for exactly this reason.
3. **Six drifts were observed but sat outside the repair set the operator authorised** — a stale command name, an
   ambiguous README paragraph, a malformed flag value the command accepted silently, task-hygiene
   findings on the audited tasks, a pre-existing coverage-gate failure, and the untouched features
   pillar.

This is F91's problem space by construction. F91 already diagnosed RC-2 (one repo-root-relative
citation notation, so in-repo paths get written incompletely and external evidence has no legal form)
and RC-3 (DD-09 is unsatisfiable for tasks whose AC sits below their feature's ship altitude), and it
shipped both remedies: `spur task migrate-anchors` and the `ac_altitude` carve-out. F91's Scope
section then explicitly excludes "re-authoring the ... ambiguous bare-filename anchors, which need an
author's judgment, not a migration." R2 below is that excluded work, scoped to what this audit
surfaced rather than to the whole corpus.

**Measured starting state** (`spur task check --json`, 2026-09-08, after the audit's repairs):

| Signal | Value |
| --- | --- |
| `plugins/**` fully-qualified stale anchors | **0** (was 34) |
| Corpus `L4.stale-line-anchor` | 156 |
| `spur task migrate-anchors --dry-run` | 47 auto-qualifiable, 1134 ambiguous, 0 skipped, 437 files scanned |
| Residual anchors on audited tasks that the migration **can** fix | 6 — 0661 ×4, 0755 ×2 |
| Residual anchors on audited tasks that it **cannot** | 6 — 0492 ×2, 0568 ×2, 0755 ×2 |
| `spur feature check` | 57 of 132 features failing |
| `bun run test` | 7951 pass / 0 fail; gate exits 1 on coverage only |

### Requirements

- **R1 — 0587's AC altitude is ruled on, not suppressed.** Task 0587 carries three
  `L4.uncovered-task-scenario` findings: AC1, AC4 and AC5 are task-local verification mechanics
  ("`bun run lint` green", "the preflight fixture exits 2") that are not in feature H1's AC. The other
  five ACs do graduate. Either set `ac_altitude: task-local` on 0587 (F91 RC-3's carve-out; exempts all
  eight, including the five that legitimately graduate) or promote the three scenarios into H1's AC —
  with the choice and its cost recorded in `### Q&A`, and 0587's three findings at zero afterwards.
- **R2 — Every residual bare-basename anchor on the audited tasks is either qualified or re-authored.**
  Six are auto-qualifiable by the shipped `spur task migrate-anchors` (0661: `dev-find-issue.md:47`,
  `eval-pipeline.ts:204`, `flag-glossary.md:262`, `roles.md:93`; 0755:
  `inline-pipeline-driver.md:18-26`, `inline-pipeline-driver.md:96`). Six are ambiguous and need an
  author (0492 `SKILL.md`, 0568 `issue-finding/SKILL.md` + `code-verification/SKILL.md`, 0755
  `index.ts` + `package.json`). One is genuinely external (0492 `mappers.ts:189`, from
  `@gobing-ai/ts-llm-jsonl-importer`) and must adopt F91's external-evidence notation
  (`packages/app/src/services/task-check.ts:264`), not a repo-relative path.
- **R3 — The `dev-featurechange` → `dev-feature-change` rename is complete in the corpus.** The shipped
  command is `/sp:dev-feature-change` (`plugins/sp/commands/dev-feature-change.md`,
  `plugins/sp/README.md:111`). The audit corrected the *path* anchors in 0494/0495 but left 32
  `featurechange` occurrences — command-name prose, the 0495 task title, and feature F31's name — still
  spelling the retired form.
- **R4 — The README "Skills, not commands" paragraph states whether it is exhaustive.** The paragraph
  at `plugins/sp/README.md:168` names 26 of 32 skills, omitting `doubt-driven-development`,
  `functional-review`, `history-anatomy`, `next-feature`, `pr-reviewing` and
  `source-driven-development`. It must either list all 32 or say in its own text that it is
  illustrative, so the next audit can classify it deterministically instead of at LOW confidence.
- **R5 — An invalid `--mode` value is rejected, not silently coerced.** The audit was invoked with
  `--mode fu;;`; the declared domain is `adaptive|full`
  (`plugins/sp/commands/dev-find-conflict.md:20`). Nothing in the command or
  `plugins/sp/skills/conflict-finding/SKILL.md` obliges the run to refuse or warn, so a typo silently
  became a `full` scan. The skill's Step 1 ("Parse and guard") must name the failure behaviour for an
  out-of-domain enum value.
- **R6 — Task-hygiene findings on the tasks this audit rewrote are cleared or baselined.** 0492 carries
  8 unchecked checklist boxes while `done`; 0568 carries 10 plus `L4.missing-feature-id`; 0567's AC
  cites requirements R6–R10 that its `### Requirements` section does not define
  (`L3.ac-requirement-coverage`). Each is either repaired through `spur task update` or accepted into
  the warning-side baseline with a reason.
- **R7 — The coverage gate is green or its shortfall is accepted explicitly.** `bun run spur-check`
  exits 1 with **0 test failures** (7951 pass across 439 files): `apps/server/src/context.ts` sits at
  89.80% lines against the 0.90 threshold in `bunfig.toml:11`. Pre-existing and unrelated to the
  audit's markdown-only diff — but it means the project's own comprehensive gate is red, so it is
  either covered or baselined with a dated reason.
- **R8 — The features pillar gets a scoped disposition, not a bulk edit.** `spur feature check` reports
  57 of 132 features failing (554 findings, 25 plugins-related, dominated by
  `L4.scenario-unverified`). This task must not attempt the campaign; it must produce the ruling —
  accept into baseline, spawn a feature-level campaign under F91, or reclassify the check — and record
  it, so the class stops being re-reported as an unresolved audit item.

### Acceptance Criteria

```gherkin
Feature: Plugins conflict-audit residuals

  Scenario: R1 — 0587's AC altitude is ruled on, not suppressed
    Given task 0587 reports three L4.uncovered-task-scenario findings against feature H1
    When the chosen disposition is applied through spur task update or spur feature update
    Then spur task check 0587 --json reports zero L4.uncovered-task-scenario findings
    And the Q&A section records which of the two options was taken and what it costs
    And if ac_altitude task-local was chosen, Q&A names the five ACs that were graduating and are now exempt

  Scenario: R2 — Every residual bare-basename anchor is qualified or re-authored
    Given spur task migrate-anchors --dry-run lists 6 auto-qualifiable anchors on tasks 0661 and 0755
    And 6 further anchors on 0492, 0568 and 0755 resolve to multiple candidates
    And 0492 cites mappers.ts:189 from the external package @gobing-ai/ts-llm-jsonl-importer
    When the migration is run and the ambiguous and external citations are hand-authored
    Then spur task check --json reports zero L4.stale-line-anchor findings on 0492, 0568, 0661 and 0755
    And no anchor was deleted to clear a finding — each was repointed, qualified, or moved to the external-evidence notation
    And the corpus-wide L4.stale-line-anchor count is reported before and after in Testing

  Scenario: R3 — The dev-featurechange rename is complete in the corpus
    Given 32 occurrences of "featurechange" remain across tasks 0494 and 0495 and feature F31
    And the shipped command file is plugins/sp/commands/dev-feature-change.md
    When each occurrence is corrected through spur task update --section or spur feature update
    Then rg "sp:dev-featurechange" over docs/ and plugins/ returns no hit outside a deliberate historical note
    And feature F31's name no longer advertises the retired command spelling

  Scenario: R4 — The README skills paragraph declares its own completeness
    Given the "Skills, not commands" paragraph names 26 of the 32 skills under plugins/sp/skills
    When the paragraph is either completed to 32 or marked illustrative in its own text
    Then a reader can tell from the paragraph alone whether an unlisted skill is missing or merely unmentioned
    And the skills tree, the skills table and the tree header still agree at 32

  Scenario: R5 — An invalid --mode value is rejected, not silently coerced
    Given the declared domain of --mode is adaptive|full
    When /sp:dev-find-conflict is invoked with a value outside that domain, such as "fu;;"
    Then the run stops with a usage error, or proceeds under a named default after emitting one warning that quotes the rejected value
    And the behaviour is written into the skill's Step 1 parse-and-guard step, not left to the model's discretion
    And the report envelope records the substitution under unresolved when a default was substituted

  Scenario: R6 — Task-hygiene findings on the audited tasks are cleared or baselined
    Given 0492 carries 8 unchecked checklist boxes while done, 0568 carries 10 plus a missing feature_id
    And 0567's AC cites requirements R6 through R10 that its Requirements section does not define
    When each is repaired through spur task update or accepted into the warning-side baseline
    Then spur task check reports 0567 and 0569 as pass, having been pass false at the start of this task
    And every baseline acceptance carries a dated reason rather than a bare entry

  Scenario: R7 — The coverage gate is green or its shortfall is accepted explicitly
    Given bun run spur-check exits 1 with zero test failures because apps/server/src/context.ts is at 89.80% lines
    And the threshold in bunfig.toml is 0.90
    When the uncovered branches are tested or the shortfall is accepted in the coverage baseline
    Then bun run spur-check exits 0
    And no test was weakened, skipped, or suppressed to reach it

  Scenario: R8 — The features pillar gets a scoped disposition, not a bulk edit
    Given spur feature check reports 57 of 132 features failing with 554 findings
    When the disposition is decided and recorded
    Then the Q&A section names the ruling — baseline acceptance, a follow-on campaign, or a check reclassification — with the reasoning
    And this task's diff contains no bulk edit to docs/features
    And if a campaign was chosen, its WBS or feature id is cited so the class is owned rather than re-reported
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-09T07:14:09.136Z

**Q: Why one task instead of eight?**
A: Operator instruction, 2026-09-09 — "create one task to contain all of these issues". The eight
requirements are independently landable and are ordered in `### Plan` so a partial run still leaves a
coherent state; R1, R7 and R8 are decisions and can be answered before any of the edits.

**Q: Why F91 and not H11?**
A: H11 owns the *finder*; six of the eight residuals are things the finder correctly reported about the
corpus gate. F91 already names them: RC-2 is the bare-basename/external-evidence notation problem (R2),
RC-3 is the DD-09 altitude problem (R1), RC-4 is the warning-ratchet problem that R6, R7 and R8 all
route through. Only R5 belongs to H11, and it is one paragraph in that skill's Step 1 — not worth a
second task with a second feature edge. R3 and R4 are `plugins/sp` surface drift riding along because
they were found in the same sweep.

**Q: Why `ac_altitude: task-local` on this task, when R1 questions that same flag on 0587?**
A: They are different situations, and the difference is the point. This task's scenarios are cleanup
mechanics — "rg returns no hit", "spur-check exits 0" — that were never candidates for F91's ship
contract, so the carve-out fits exactly as F91 RC-3 intended. 0587 is the hard case: five of its eight
ACs *do* graduate into H1, so the flag there would exempt criteria that belong at feature altitude.
That asymmetry is why R1 is a ruling and not an edit.

**Q: Was the 189 → 156 drop in stale anchors real, or did the repair just hide findings?**
A: Real, and smaller than the repair. The `plugins/**` fully-qualified class went 34 → 0. The net was
33 rather than 34+ because `checkLineAnchors` caps at five findings per section
(`packages/app/src/services/task-check.ts:1431`): clearing one anchor lets a previously-suppressed
sibling report. R2 exists because of that unmasking, and its AC requires before/after counts precisely
so the next reader does not have to re-derive this.

**Q: Should the de-anchoring the audit already applied be reverted in favour of re-pointing?**
A: No. The `history-load` surface (`plugins/sp/scripts/history-load.ts`,
`plugins/sp/tests/history-load.test.ts`, `plugins/sp/commands/dev-history-load.md`) was deleted by
commit `9187db346` (task 0661) and `dev-find-issue.md` was repointed from `sp:issue-finding` to
`sp:history-anatomy` in the same commit. There is no target to re-point to; inventing one would
manufacture evidence. Each affected section carries a dated provenance note naming that commit. R2
covers only anchors whose target still exists.

**Q: Does R7 licence lowering the coverage threshold?**
A: No. The two options are covering `apps/server/src/context.ts`'s uncovered branches or an explicit,
dated baseline acceptance. Editing `coverageThreshold` in `bunfig.toml:11`, weakening an assertion, or
adding a suppression are all out — AGENTS.md forbids forcing green, and task 0587 R7 already recorded
the ruling that `coverage = true` stays.

**Q: What is deliberately not in scope?**
A: The 554-finding features-pillar campaign (R8 rules on it, does not run it); the other ~1128
corpus-wide ambiguous anchors that `migrate-anchors` flags outside the audited tasks; the 50
corpus-wide `L3.unchecked-checklist` and 20 `L4.missing-feature-id` findings beyond the tasks this
audit rewrote; and any change to `checkLineAnchors`' five-per-section cap, which is a checker-policy
change (T10) needing its own task.

### Design

**Shape: three decisions, then five bounded edits.** R1, R7 and R8 are rulings — answer them first and
record them in `### Q&A`, because R1's answer changes whether 0587 is edited at all and R8's answer
decides whether this task's diff touches `docs/features` (it should not). R2–R6 are then mechanical.

**Every corpus write goes through the CLI.** `spur task update <wbs> --section <name> --from-file
<path>` for task prose, `spur feature update` for feature files. Raw `Write`/`Edit` on `docs/tasks*/`
or `docs/features/` is forbidden (AGENTS.md) and the `PreToolUse` write-guard hook denies it anyway.
`--section` resolves `###` headings in task files and `##` in feature files. A missing required
frontmatter key makes `spur task update` reject the whole write — that is an owner-surface failure to
report, never a reason to route around the CLI.

**R2 splits three ways by what the evidence actually is.** The distinction matters more than the
mechanics:

| Bucket | Members | Treatment |
| --- | --- | --- |
| Auto-qualifiable — basename resolves to exactly one in-repo file | 0661 ×4, 0755 ×2 | `spur task migrate-anchors` (dry-run, read the report, then apply) |
| Ambiguous — basename resolves to several | 0492 `SKILL.md`; 0568 `issue-finding/SKILL.md`, `code-verification/SKILL.md`; 0755 `index.ts`, `package.json` | Hand-author the repo-relative path, then re-read the cited line to confirm it still says what the row claims |
| External — the file is not in this repo | 0492 `mappers.ts:189` (`@gobing-ai/ts-llm-jsonl-importer`) | F91's frozen external-evidence notation: named origin, backticked path, line number **outside** the backticks (`packages/app/src/services/task-check.ts:264`) |

`migrate-anchors` is corpus-wide: its dry-run reports 47 qualifications across 437 files, only 6 of
them on this task's tasks. Read the full dry-run report before applying — the other 41 are in scope for
F91 generally but are not this task's claim, and Testing must say which of the two happened.

**R2's ambiguous bucket needs the line re-read, not just the path resolved.** A qualified path with a
line number that has since drifted passes the existence and bounds checks while pointing at unrelated
code — F91 RC-1, exactly the defect this feature exists to close. Resolving `SKILL.md` to
`plugins/sp/skills/issue-finding/SKILL.md` is half the work; confirming line 150 still carries the
Phase 2 extraction table is the other half. Where the content has moved, repoint to where it moved; where
it is gone, use the same de-anchor-plus-provenance-note form the 2026-09-08 audit used on the
`history-load` citations.

**R5 is a skill edit, not a validator.** `plugins/sp/skills/conflict-finding/SKILL.md` Step 1 is the
SSOT for parse-and-guard behaviour; `plugins/sp/commands/dev-find-conflict.md` is a thin wrapper and
stays thin ("Fat Skills, thin others", `docs/99_PROJECT_CONSTITUTION.md:68`). Do not add a TypeScript
argument parser — the skill is prompt-first by its own honesty contract, and v1 adds no analyzer. One
paragraph naming the refuse-or-warn behaviour is the whole change. If the warn-and-default branch is
chosen, the substitution belongs in the report envelope's `unresolved` array so it survives into the
output rather than living only in a console line.

**R3 touches a feature name, which is a public-ish surface.** F31 is named "Feature tree restructure
kit: audit, hierarchy guide, and /sp:dev-featurechange". Renaming a feature goes through `spur feature
update`, not an edit, and F31 is currently `verifying` — check that renaming it does not disturb an
in-flight verification before doing it. The 0495 task *title* carries the same spelling; task titles
are frontmatter `name`, so that is a frontmatter write, not a `--section` write.

**Ordering constraint.** R6 repairs 0567 and 0569, and R2 also touches 0567's neighbours; run R2 before
R6 so the anchor state is settled before the hygiene pass re-reads those files. R1 is independent. R7
and R8 touch nothing this task edits.

**Verification is the audit's own gate set**, re-run at the end: `bun plugins/sp/scripts/validate-commands.ts`,
`bun run script-contract-check`, `bun run transition-shim-check`, `bun run inline-pipeline-parity-check`,
`bun run lint`, `bun test ./plugins`, `spur task check --json`, `spur feature check --json`, and
`bun run spur-check` last (R7's gate). Baseline for comparison is in `### Background`.

### Plan

1. **Rule on R1 (0587 AC altitude).** Read `docs/tasks4/0587_*.md` and its feature H1's Acceptance
   Criteria. For each of the three uncovered scenarios decide: graduate into H1's AC, or declare it
   task-local. Apply via `spur task update 0587 --ac-altitude task-local` **or** `spur feature update H1
   --section "Acceptance Criteria" --from-file <tmp>`, whichever the ruling chose. Record the ruling and
   its cost in 0587's `### Q&A`. Verify: `spur task check 0587 --json` shows zero
   `L4.uncovered-task-scenario`. (AC1)
2. **Rule on R8 (features pillar).** Run `spur feature check --json`, bucket the 554 findings by
   `rule` and by whether the owning feature is `active`. Write the disposition — which buckets are
   in-scope for a later campaign, which are accepted — into F91's `## Notes` via `spur feature update
   F91`. Do not edit any other feature file. Verify: `git diff --name-only docs/features/` lists at
   most `F91` (plus `F31` if step 5 renames it). (AC8)
3. **R2a — auto-qualify.** `spur task migrate-anchors --dry-run --json`, read the report, confirm the
   6 rows on 0661/0755 resolve to the intended files, then apply. Verify: `spur task check 0661 --json`
   and `spur task check 0755 --json` lose those `L4.stale-line-anchor` findings; record the
   qualified/ambiguous/skipped counts in `### Testing`. (AC2)
4. **R2b — hand-author the ambiguous and external anchors.** For each of 0492 `SKILL.md`, 0568
   `issue-finding/SKILL.md` + `code-verification/SKILL.md`, 0755 `index.ts` + `package.json`: resolve
   the repo-relative path, **read the cited line**, and either repoint or de-anchor with a provenance
   note. Re-author 0492's `mappers.ts:189` into the external-evidence form
   (`` @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` line 189 ``). Write each via `spur task update
   --section --from-file`. Verify: `spur task check` on 0492/0568/0755 reports zero bare-basename
   anchors; every repointed anchor's line content is quoted in `### Testing`. (AC2)
5. **R3 — finish the `dev-featurechange` → `dev-feature-change` rename.** `rg -n 'dev-featurechange'`
   to get the live count, then: task prose via `spur task update 0494/0495 --section --from-file`; the
   0495 title via `spur task update 0495 --name`; F31's name via `spur feature update F31 --name`
   (check F31's `verifying` status first — if a verification is mid-flight, record that and leave the
   feature name for the verifier). Verify: `rg -c 'dev-featurechange'` is 0, or the only survivors are
   deliberate historical citations named in `### Testing`. (AC3)
6. **R4 — README exhaustiveness.** Edit `plugins/sp/README.md:168` to state plainly whether the
   "Skills, not commands" list is exhaustive; if it is meant to be, add the 6 missing skills, otherwise
   label it illustrative. Plain file — `Edit`, not the CLI. Verify: `bun
   plugins/sp/scripts/validate-commands.ts` still PASSes and the count in the paragraph matches
   `ls plugins/sp/skills | wc -l`. (AC4)
7. **R5 — reject invalid `--mode`.** Add the refuse-or-warn paragraph to
   `plugins/sp/skills/conflict-finding/SKILL.md` Step 1, and mirror the one-line contract into
   `docs/04_DESIGN.md`'s dev-command argument-contract gate (T3: surface and design change together).
   Keep `plugins/sp/commands/dev-find-conflict.md` thin. Verify: `bun run script-contract-check` and
   `bun test ./plugins` stay green; the SKILL.md text names both `--mode` values and the rejection
   behaviour. (AC5)
8. **R6 — task hygiene.** 0492: flip or remove the 8 stale checklist boxes. 0568: flip or remove 10
   boxes and set `--feature <id>` (or record why it has no owner). 0567: repoint the AC rows that cite
   R6–R10 to requirements that exist, or add the missing requirements. All via `spur task update`.
   Verify: `spur task check` on 0492/0567/0568 clears `L3.unchecked-checklist` and the AC-citation
   finding, or `### Q&A` records why a specific one is baselined. (AC6)
9. **R7 — coverage gate.** Re-run `bun run spur-check`. If it still fails only on
   `apps/server/src/context.ts` (89.80% vs 0.90), add tests for the uncovered lines in
   `apps/server/tests/` until the file clears the threshold. Do **not** edit `bunfig.toml`, weaken an
   assertion, or add a suppression. If the shortfall proves structurally untestable, record that in
   `### Q&A` with the specific lines and leave the gate red with an explicit statement. Verify: `bun run
   spur-check` exits 0, or `### Testing` names the exact uncovered lines and the accepted-shortfall
   ruling. (AC7)
10. **Final gate sweep.** `bun run autofix`, `bun run lint`, `bun plugins/sp/scripts/validate-commands.ts`,
    `bun run script-contract-check`, `bun run transition-shim-check`, `bun run inline-pipeline-parity-check`,
    `bun test ./plugins`, `bun run test`, `spur task check --json`, `spur feature check --json`,
    `bun run spur-check`. Compare corpus finding counts against the `### Background` baseline and record
    the deltas in `### Testing`. Zero pass→fail regressions is the bar.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

**Owning feature**

- `docs/features/F91_corpus-gate-integrity-content-verified-evidence-anchors-external-evidence-notation-ac-altitude-carve-out.md` —
  RC-1 (anchors validated for existence, not content), RC-2 (one repo-root-relative notation), RC-3
  (DD-09 unsatisfiable below feature altitude → the `ac_altitude` carve-out), RC-4 (no warning-side
  ratchet). Its Scope explicitly excludes "Re-authoring the 178 ambiguous bare-filename anchors, which
  need an author's judgment, not a migration" — R2 is that excluded work, scoped down to the 13
  residuals this audit actually touched.

**Checker authority (read before changing any anchor)**

- `packages/app/src/services/task-check.ts:224` — `extractBacktickLineAnchors`: repo-relative
  `` `path:NN` `` form; requires a backtick-wrapped path with an extension and no `://`.
- `packages/app/src/services/task-check.ts:264` — `EXTERNAL_EVIDENCE_RE`: the frozen external form
  `origin \`path\` line NN`, number **outside** the backticks, origin must bear one of `/@._-`. This is
  R2's third bucket.
- `packages/app/src/services/task-check.ts:1410` — `checkLineAnchors`: scans **only** `Testing` and
  `Solution`; **caps at 5 findings per section** (`:1431`, `:1446`); terminal records (`done`/`cancelled`)
  get path-existence + line-bounds only, no subject matching (ADR-092, task 0714 R1). The cap is why the
  audit's "37" was a floor, not a total, and why repairs unmask siblings.

**The audited artifacts**

- `docs/tasks4/0587_*.md` — R1's three `L4.uncovered-task-scenario` findings; 5 of its 8 ACs
  legitimately graduate into H1, which is why this needs a ruling rather than a blanket
  `--ac-altitude task-local`.
- `docs/tasks4/0492_*.md`, `0567`, `0568`, `0661`, `0755` — R2 and R6's targets.
- `docs/tasks4/0494_*.md`, `0495_*.md` and feature `F31` — R3's 32 `dev-featurechange` occurrences.

**Surfaces**

- `plugins/sp/commands/dev-find-conflict.md:20` — declares `--mode <adaptive|full>`; R5's evidence that
  `--mode fu;;` was accepted and silently defaulted.
- `plugins/sp/skills/conflict-finding/SKILL.md` — Step 1 "Parse and guard" is the SSOT for R5's fix;
  the command file stays a thin wrapper per "Fat Skills, thin others"
  (`docs/99_PROJECT_CONSTITUTION.md:68`).
- `plugins/sp/README.md:168` — R4's "Skills, not commands" paragraph.
- `docs/04_DESIGN.md:1357` — the five-gate dev-command list that R5's contract must appear in (T3:
  surface code and `docs/04_DESIGN.md` change together).

**Gates**

- `bunfig.toml:11` — `coverageThreshold = { lines = 0.9, functions = 0.9 }`; R7's gate. The shortfall is
  `apps/server/src/context.ts` at 89.80% lines and is **pre-existing** — `git diff --name-only` at audit
  time listed zero `.ts`/`.tsx`/`.js`/`.mjs`/`.json`/`.toml` files.
- `AGENTS.md` — CLI-gated corpus writes; the `PreToolUse` write-guard hook enforces it. Never use
  `--no-verify` or a suppression to force green (R7 depends on this).

**Prior art**

- Commit `9187db346` (task 0661) — removed the `dev-history-load` surface and repointed
  `/sp:dev-find-issue` from `sp:issue-finding` to `sp:history-anatomy`. The 2026-09-08 audit de-anchored
  the citations to that dead surface and left a provenance note pointing at the live replacement
  (`plugins/sp/commands/dev-find-issue.md:50`); R2's ambiguous bucket reuses that form wherever the
  cited content is gone rather than moved.
- `spur task migrate-anchors` — shipped under F91 RC-2. Dry-run at audit time: 47 qualified / 1134
  ambiguous / 0 skipped across 437 files. Only 6 of the 47 belong to this task.

### History

- 2026-09-09T07:18:15.483Z backlog → todo (system)

