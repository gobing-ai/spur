---
template: feature-impl
schema_version: 1
name: "Create plugins/sp/references/roles.md as the Layer-1 role-to-tier table"
description: ""
status: todo
type: task
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-13T23:24:21.932Z"
updated_at: "2026-08-14T00:08:30.496Z"
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
- [ ] **R1.** Create `plugins/sp/references/roles.md` carrying exactly four roles — `scribe`,
      `coder`, `reviewer`, `planner` — as a fenced YAML block (`version: 1`, then `id` / `tier` /
      `commands` / `stages` per row) plus prose annotations for the reading agent. The authoritative
      role→tier→commands table is in this task's Design section; transcribe it, do not re-derive it.
      Measurable: the file parses as YAML and has exactly four rows, each with all four keys.
- [ ] **R2.** The four roles occupy four **distinct** tiers, one each. This is the invariant that
      keeps the vocabulary right-sized: two roles sharing a tier resolve to the same eligible
      executor set and are one role with two names. Measurable: a test asserts the four `tier` values
      are pairwise distinct and each is drawn from `cheap | standard | capable-1 | capable-2 |
      capable-3`.
- [ ] **R3.** The command→role mapping is exhaustive and closed. Every file under
      `plugins/sp/commands/` appears in exactly one role row. Measurable: a test enumerating that
      directory and diffing against the file reports zero unmapped and zero duplicated commands, and
      names the offending command on failure.
- [ ] **R4.** Role tiers do not contradict the stage registry. No role's `tier` is below the highest
      `min_tier` among the stages it folds in `REGISTERED_CANONICAL_STAGES`
      (`packages/domain/src/stage-registry/schema.ts`). Measurable: a test asserts the invariant per
      row, naming the role and the conflicting stage id on failure.
- [ ] **R5.** The layer boundary holds and the file is discoverable. The file names no executor,
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
- [ ] Create `plugins/sp/references/roles.md` with the four roles as fenced YAML plus prose (R1)
- [ ] Place `rule-scan` under `reviewer` and record why it is not `scribe` (R1)
- [ ] Add `plugins/sp/tests/roles.test.ts` parsing the YAML block (R1)
- [ ] Assert the four tiers are pairwise distinct and drawn from the live vocabulary (R2)
- [ ] Assert every command under `plugins/sp/commands/` maps to exactly one role (R3)
- [ ] Assert no role's tier is below the highest `min_tier` among its folded stages (R4)
- [ ] Assert the file names no executor, model, or vendor; add the reference to the three SKILL.md files (R5)
- [ ] Append a superseding note to task 0344 without editing its recorded decision
- [ ] Run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
