---
template: feature-impl
schema_version: 1
name: "Create plugins/sp/references/roles.md as the Layer-1 role-to-tier table"
description: ""
status: done
type: task
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-13T23:24:21.932Z"
updated_at: "2026-08-14T04:43:05.687Z"
---

## 0535. Create plugins/sp/references/roles.md as the Layer-1 role-to-tier table

### Background
Task 0344 (done) decided the **two-layer contract**: Layer 1 maps *role → tier* and is owned by
plugin `sp`; Layer 2 maps *tier → executor* and is owned by the operator in `.spur/config.yaml`.
Layer 1 was specified down to the file path and the format, and was never built.

Verified 2026-08-13: `plugins/sp/references/` does not exist. With no file to live in, Layer 1 has
leaked into hand-written prose that duplicates `packages/domain/src/stage-registry/schema.ts` with
nothing keeping the two in sync (`skills/spur-dev/references/dev-operations.md:256`,
`commands/dev-refine.md:37`, `skills/spur-dev/references/execution-workflow.md:301-310`).

**The vocabulary is coarser than 0344's.** 0344 proposed eight intentions. Checked against the stage
registry, those eight carry only **four** distinct floors: `plan` is capable-2 (schema.ts:757),
`verify` and `dogfood` are capable-1 (:827, :896), `changelog` is cheap (:938), and everything else
is standard. Eight names, four selection consequences — four names carried no routing difference.

Operator ruling 2026-08-13 collapses them to four **roles**, one per tier, named as people rather
than categories. Three of the four names already exist in this plugin as the `sp:super-planner` /
`sp:super-coder` / `sp:super-reviewer` subagent roster.
### Requirements
- [x] **R1.** Create `plugins/sp/references/roles.md` carrying exactly four roles — `scribe`,
      `coder`, `reviewer`, `planner` — as a fenced YAML block (`version: 1`, then `id` / `tier` /
      `commands` / `stages` per row) plus prose annotations for the reading agent. The authoritative
      role→tier→commands table is in this task's Design section; transcribe it, do not re-derive it.
      Measurable: the file parses as YAML and has exactly four rows, each with all four keys.
- [x] **R2.** The four roles occupy four **distinct** tiers, one each. This is the invariant that
      keeps the vocabulary right-sized: two roles sharing a tier resolve to the same eligible
      executor set and are one role with two names. Measurable: a test asserts the four `tier` values
      are pairwise distinct and each is drawn from `cheap | standard | capable-1 | capable-2 |
      capable-3`.
- [x] **R3.** The command→role mapping is exhaustive and closed. Every file under
      `plugins/sp/commands/` appears in exactly one role row. Measurable: a test enumerating that
      directory and diffing against the file reports zero unmapped and zero duplicated commands, and
      names the offending command on failure.
- [x] **R4.** Role tiers do not contradict the stage registry. No role's `tier` is below the highest
      `min_tier` among the stages it folds in `REGISTERED_CANONICAL_STAGES`
      (`packages/domain/src/stage-registry/schema.ts`). Measurable: a test asserts the invariant per
      row, naming the role and the conflicting stage id on failure.
- [x] **R5.** The layer boundary holds and the file is discoverable. The file names no executor,
      model, or vendor, and `sp:spur-dev`, `sp:spur-cli`, and `sp:code-verification` each reference
      it from their SKILL.md. Measurable: a test greps the file for every `agent.executors[].name`
      value and for known vendor strings and finds none; the three SKILL.md files contain the path.
### Acceptance Criteria
```gherkin
Scenario: R1 — The Layer-1 role table exists at the decided path in the decided format
  Given plugin sp is installed
  When an agent reads plugins/sp/references/roles.md
  Then it finds a fenced YAML block with version 1 and exactly the four roles scribe, coder, reviewer, planner
  And each role declares id, tier, commands, and stages
  And no entry names an executor, a model, or a vendor

Scenario: R2 — The four roles occupy four distinct tiers
  Given the role table declares a tier per role
  When the four tier values are compared
  Then they are pairwise distinct
  And each is drawn from cheap, standard, capable-1, capable-2, capable-3

Scenario: R3 — The command mapping is exhaustive and closed
  Given the file lists commands per role
  When the command list is compared against plugins/sp/commands/
  Then every command appears in exactly one role row
  And a command present in the directory but absent from the file fails the check

Scenario: R4 — Role tiers agree with the stage registry
  Given a role folds one or more stage ids
  When its tier is compared to those stages' min_tier in REGISTERED_CANONICAL_STAGES
  Then the role's tier is not below the highest min_tier it folds
  And a disagreement is reported with the role id and the conflicting stage id

Scenario: R5 — The multi-role skills point at the file
  Given a skill dispatches work under more than one role
  When its SKILL.md is read
  Then it references plugins/sp/references/roles.md
  And sp:spur-dev, sp:spur-cli, and sp:code-verification each carry that reference
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**The authoritative table (R1).** Transcribe exactly:

| Role | Tier | Stages folded | Commands |
| --- | --- | --- | --- |
| `scribe` | cheap | changelog | dev-gitmsg, dev-handover, dev-daily, dev-changelog, dev-refresh, rule-add, rule-refine, workflow-add, workflow-refine, spur-init |
| `coder` | standard | implement, test, wrap | dev-run, dev-unit, dev-debug, dev-simplify, dev-fixall, dev-reverse, dev-wrap, dev-wrapall |
| `reviewer` | capable-1 | verify, review, dogfood | dev-verify, dev-verifyall, dev-review, dev-dogfood, rule-scan |
| `planner` | capable-2 | plan, refine, brainstorm | dev-plan, dev-refine, dev-brainstorm, dev-idea, dev-runall, dev-parallel, dev-next, dev-arch |

Verify the command column against the live `plugins/sp/commands/` directory before writing (R3) —
the list above is the decided mapping, but the directory is the authority on what exists.

**Four roles, four tiers, one each** (R2). That one-to-one property is the whole design. It makes the
vocabulary self-checking: a proposed fifth role must bring a fifth tier, otherwise it is a synonym.

`tester` was evaluated and **folded into `coder`**: stage `test` (schema.ts:809) and stage `implement`
(:780) are both `min_tier: standard`, so they resolve to the same eligible executor set. The
test-writer-versus-implementer difference is real but is a *prompting* difference carried by the
skill, not a selection difference. Reopen only with a concrete case of a model strong at
implementation and weak at tests.

`utility` was renamed **`scribe`** — the other three roles name people, and the work is dominated by
writing derived text (commit messages, changelogs, handovers, daily summaries) with template
scaffolding as the remainder. **`rule-scan` sits under `reviewer`**, not `scribe`: it analyses for
anti-patterns rather than transcribing.

**File location:** `plugins/sp/references/roles.md` at the plugin root, not inside any one skill,
because it is consumed by several skills and by the dispatcher. Fenced YAML plus prose, matching the
existing `references/*.md` convention already used across the plugin.

**Supersede, do not rewrite (corpus discipline).** Task 0344 is `done` and its Solution records the
eight-intention vocabulary this table collapses. Append a superseding note pointing at this task; do
not edit its recorded decision. The record of what was decided when is the corpus's value.

**Consistency is a test, not a convention.** `plugins/sp/tests/roles.test.ts` parses the YAML and
asserts R2/R3/R4/R5 against the real command directory and the real registry. Without it this file
becomes the seventh place tier facts drift.
### Plan
- [x] Create `plugins/sp/references/roles.md` with the four roles as fenced YAML plus prose (R1)
- [x] Place `rule-scan` under `reviewer` and record why it is not `scribe` (R1)
- [x] Add `plugins/sp/tests/roles.test.ts` parsing the YAML block (R1)
- [x] Assert the four tiers are pairwise distinct and drawn from the live vocabulary (R2)
- [x] Assert every command under `plugins/sp/commands/` maps to exactly one role (R3)
- [x] Assert no role's tier is below the highest `min_tier` among its folded stages (R4)
- [x] Assert the file names no executor, model, or vendor; add the reference to the three SKILL.md files (R5)
- [x] Append a superseding note to task 0344 without editing its recorded decision
- [x] Run `bun run autofix && bun run spur-check`
### Solution
**Change map (implement step, task 0535).**

- `plugins/sp/references/roles.md` (new) — the Layer-1 role→tier table: fenced YAML `version: 1`
  with exactly four roles (`scribe` cheap / `coder` standard / `reviewer` capable-1 / `planner`
  capable-2), each declaring `id` / `tier` / `commands` / `stages`, plus prose annotations. The
  decided four-row table from this task's Design is transcribed verbatim; the live command
  directory has **37** files vs the 31 the decided table listed, so the six additional commands are
  placed by the same stage logic (documented in the file's Placement notes): `dev-refineall`,
  `dev-find-next`, `dev-featurechange` → planner; `dev-gtd` → coder; `dev-find-conflict`,
  `dev-find-issue` → reviewer. `rule-scan` sits under reviewer (analysis, not transcription).
- `plugins/sp/tests/roles.test.ts` (new) — parses the fenced YAML and asserts R2 (four pairwise
  distinct tiers from the live vocabulary), R3 (every file under `plugins/sp/commands/` maps to
  exactly one role; zero unmapped/duplicated, names the offender), R4 (no role tier below the
  highest `min_tier` among its folded stages, read from `REGISTERED_CANONICAL_STAGES` as text —
  the plugin cannot import `@gobing-ai/spur-domain`), and R5 (no executor name from
  `.spur/config.yaml` `agent.executors`, no known vendor string — word-boundary matched so
  `resolve` ≠ vendor `sol`; the three SKILL.md files contain the path).
- `plugins/sp/skills/spur-dev/SKILL.md`, `plugins/sp/skills/spur-cli/SKILL.md`,
  `plugins/sp/skills/code-verification/SKILL.md` — each now references
  `plugins/sp/references/roles.md` (R5).
- Task 0344 Solution — appended a superseding note pointing at this task; the recorded D1–D8
  decision was not edited (corpus discipline).
- The leaked prose at `plugins/sp/skills/spur-dev/references/dev-operations.md:256`, `plugins/sp/commands/dev-refine.md:37`, and
  `plugins/sp/skills/spur-dev/references/execution-workflow.md:301-310` is deliberately **not** touched — task 0538 deletes it.
### Testing
**Re-verify 2026-08-14 (`/sp-dev-verifyall --feature B2 --force --fix all`).** Task already `done`; `--force` re-audited. Line anchors re-read this run.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/references/roles.md:39-58` fenced YAML `version: 1`, exactly four rows (`scribe`/`coder`/`reviewer`/`planner`), each with `id`/`tier`/`commands`/`stages`. Tests `plugins/sp/tests/roles.test.ts:112-145` (this run: 17 pass / 0 fail). |
| R2 | MET | `plugins/sp/tests/roles.test.ts:147-160` — four pairwise-distinct tiers from the live vocabulary (`cheap`/`standard`/`capable-1`/`capable-2`). |
| R3 | MET | `plugins/sp/tests/roles.test.ts:162-191` — every file under `plugins/sp/commands/` (37/37) maps to exactly one role; zero unmapped/duplicated/ghosts. Live `rg '^role:'` this run: 37/37 command files declare `role:`. |
| R4 | MET | `plugins/sp/tests/roles.test.ts:193-219` — no role tier below the highest `min_tier` among its folded stages. |
| R5 | MET | `plugins/sp/tests/roles.test.ts:221-239` — zero executor/vendor hits; `plugins/sp/skills/spur-dev/SKILL.md:214`, `plugins/sp/skills/spur-cli/SKILL.md`, `plugins/sp/skills/code-verification/SKILL.md` each reference `plugins/sp/references/roles.md`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — The Layer-1 role table exists at the decided path in the decided format | MET | test | `plugins/sp/tests/roles.test.ts:112-145` + file `plugins/sp/references/roles.md:39-58` |
| Scenario: R2 — The four roles occupy four distinct tiers | MET | test | `plugins/sp/tests/roles.test.ts:147-160` |
| Scenario: R3 — The command mapping is exhaustive and closed | MET | test | `plugins/sp/tests/roles.test.ts:162-191` (37/37) |
| Scenario: R4 — Role tiers agree with the stage registry | MET | test | `plugins/sp/tests/roles.test.ts:193-219` |
| Scenario: R5 — The multi-role skills point at the file | MET | test | `plugins/sp/tests/roles.test.ts:235-239` |

Coverage: N/A (table + plugin test; no new runtime package). `--fix all` flipped leftover Requirements/Plan checkboxes and replaced basename-only Testing citations (L3.unchecked-checklist + L4.stale-line-anchor). Artifacts: `.spur/run/0535-verdict.json`.
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; functional verdict PASS |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/references/roles.md:23-36` — fenced `yaml` block, `version: 1`, exactly 4 rows (scribe/coder/reviewer/planner), each with `id`/`tier`/`commands`/`stages`; `plugins/sp/tests/roles.test.ts:103-110` asserts 4 rows, exact ids, all 4 keys |
| R2 | MET | `plugins/sp/tests/roles.test.ts:112-128` — pairwise-distinct tiers + membership in live vocabulary (`cheap/standard/capable-1/capable-2/capable-3`); tiers used: cheap/standard/capable-1/capable-2, all distinct |
| R3 | MET | `plugins/sp/tests/roles.test.ts:130-158` — enumerates `plugins/sp/commands/` (37 files), zero unmapped, zero duplicated, zero ghosts; error names the offending command |
| R4 | MET | `plugins/sp/tests/roles.test.ts:160-190` — floors read from `REGISTERED_CANONICAL_STAGES` (`packages/domain/src/stage-registry/schema.ts`:757 plan capable-2, :827 verify capable-1, :896 dogfood capable-1, :938 changelog cheap, rest standard); no role tier below its highest folded floor; error names role + conflicting stage id |
| R5 | MET | `plugins/sp/tests/roles.test.ts:192-217` — zero hits for `.spur/config.yaml` executor names (10+ active) and zero known-vendor hits (word-boundary matched); `plugins/sp/skills/spur-dev/SKILL.md`, `spur-cli/SKILL.md`, `code-verification/SKILL.md` each contain `plugins/sp/references/roles.md` (verified via grep, 1 occurrence each) |

**Design conformance.** The decided four-row table is transcribed verbatim. The 6 commands absent
from the decided 31-command list (`dev-refineall`, `dev-find-next`, `dev-featurechange`,
`dev-gtd`, `dev-find-conflict`, `dev-find-issue`) are placed by the same stage logic and documented
in the file's Placement notes + Solution — CHANGED-documented, PASS-acceptable (design itself
declares the live directory authoritative for R3). `rule-scan` sits under reviewer with the
analysis-vs-transcription rationale recorded. Task 0344 got an appended superseding note; its
recorded D1–D8 decision untouched.

**SECUA.** No security, efficiency, correctness, or usability findings. `yamlBlock` /
`stageMinTiers` regexes are read-only against repo-owned files; no injection surface.

**Architecture.** No blocker/major candidates. Advisory: `roles.test.ts:66-84` `VENDOR_STRINGS`
is a hand-maintained belt-and-suspenders list — the config-driven executor check is the primary
boundary; rotate if new vendors ship. Advisory: `roles.test.ts:44-46` takes the first ` ```yaml `
fence — safe while the file carries exactly one. Registry-read-as-text discipline matches
`stage-registry-parity.test.ts` (plugin cannot import `@gobing-ai/spur-domain`).

**Verification run this turn.** `bun test plugins/sp/tests/roles.test.ts` → 12 pass / 0 fail (53
expect). `bun test plugins/sp` → 727 pass / 0 fail. `bunx biome check plugins/sp/tests/roles.test.ts`
→ clean.
### References
- **Source of the vocabulary:** task 0344 § Solution D1/D2 —
  `docs/tasks2/0344_decide-who-emits-intention-skill-declaration-inferred-judge-.md`
  (eight intentions; this task collapses them to four roles per feature B2 § *The role vocabulary*)
- **Tier floors to reconcile against:** `packages/domain/src/stage-registry/schema.ts` —
  `refine` :733, `plan` :757, `implement` :780, `test` :809, `verify` :827, `wrap` :850,
  `review` :873, `dogfood` :896, `brainstorm` :919, `changelog` :938; `isTierEligible` :425-427
- **Live tier vocabulary:** `packages/config/src/index.ts:119-160`;
  `apps/cli/schemas/spur-config.schema.json:133`
- **Command surface to cover:** `plugins/sp/commands/` (31 files); index in `plugins/sp/README.md`
- **Prose to be superseded (deleted by 0538, not here):**
  `plugins/sp/skills/spur-dev/references/dev-operations.md:256`,
  `plugins/sp/commands/dev-refine.md:37`,
  `plugins/sp/skills/spur-dev/references/execution-workflow.md:301-310`
- **Skills to wire (R5):** `plugins/sp/skills/spur-dev/SKILL.md`,
  `plugins/sp/skills/spur-cli/SKILL.md`, `plugins/sp/skills/code-verification/SKILL.md`
- **Existing subagent roster the names align with:** `sp:super-planner`, `sp:super-coder`,
  `sp:super-reviewer`
### History
- 2026-08-14T01:23:40.701Z todo → wip (system)
- 2026-08-14T01:35:57.059Z wip → testing (system)
- 2026-08-14T01:35:58.010Z testing → done (system)
