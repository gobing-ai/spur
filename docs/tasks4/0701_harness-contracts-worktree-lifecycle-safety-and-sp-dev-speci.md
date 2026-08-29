---
schema_version: 1
name: "Harness contracts: worktree lifecycle safety and /sp:dev-* specification drift"
status: done
template: issue
created_at: 2026-08-28T22:21:18.814Z
updated_at: "2026-08-29T05:18:50.247Z"
feature_id: F95
parent_wbs: "0698"
ac_altitude: task-local
---

## 0701. Harness contracts: worktree lifecycle safety and /sp:dev-* specification drift

### Background

Decomposed from task **0698** (`### Requirements` R3, R4, R13, R14, R15, R16, R19c, R19d). Every
claim was reproduced against `HEAD` = `dad078ad5` on 2026-08-28; the full evidence bundle is in 0698
`### Root Cause`.

**Why these belong in one task.** They are the harness's own contract layer: the `--worktree`
lifecycle spec, the `/sp:dev-*` flag contracts, the dogfood driver's gates, and the section writer
they all depend on. Six of the seven live under `plugins/sp/`; the seventh
(`packages/domain/src/planning/markdown-document.ts`) is the writer every one of those prose contracts
is authored through. An implementer holding the whole contract layer in context can check that the
spec, the command file, the glossary, and the validator all say the same thing — which is precisely
what none of them do today.

**What the source runs actually cost.** The `sp-dev-refineall-f94` run reached WT-4 with three
refined task files sitting uncommitted in the worktree; `git merge --ff-only` reported success on a
branch with zero commits, and create mode's next two lines would have deleted the tree holding the
only copy. The driver caught it by hand and committed `4e0e826af` first. In the same run, a failed
`git worktree add -b` left a dangling branch that made the natural retry fail with a second,
unrelated error. In the `dev-refine-0693` run the operator passed `--worktree`, the flag was silently
discarded because `dev-refine` never declared it, and all seven of that run's section writes were
then clobbered by a concurrent writer in the unprotected checkout. The `sp-dev-refineall-f94` run
mutated three tasks, created a commit, and fast-forwarded `main` while the dogfood refuse gate
reported `pipelineDriving: false`. Every one of these is a contract that promised isolation or a gate
that promised detection, and delivered neither.

**One correction carried forward.** The source report claimed `spur task update --section` strips
`###` headings "with no `warnings[]` entry". That is wrong — `planning-write-service.ts:476` does
populate `warnings[]` from `doc.strippedHeadings`, proven by a direct `MarkdownDocument.replaceSection`
probe. R6 is filed for the half that is real: the headings are **deleted** rather than demoted, so an
authored Design loses its structure even when the warning is read.

### Requirements

Source mapping (parent → this task): 0698 R3 → R1, 0698 R4 → R2, 0698 R13 → R3, 0698 R14 → R4,
0698 R15 → R5, 0698 R16 → R6, 0698 R19(c) and R19(d) → R7.

- [x] R1. **The `--worktree` lifecycle must commit the batch's writes before its terminal action, and WT-4 must refuse to report success on a branch with no commits.** `plugins/sp/skills/spur-dev/references/execution-batch.md` specifies WT-1 (dirty-tree precheck), WT-2 (create/adopt), WT-3 (marker), WT-4 (FF-merge), WT-5 (retain), WT-6 (`--continue`) and WT-7 (exclusions) — and **never names a commit step**. `git merge --ff-only "$BRANCH"` on a branch with zero commits succeeds trivially, after which create mode runs `git worktree remove` and `git branch -d`, deleting the tree that held the only copy of the work. The operator sees a green batch report and an unchanged main tree.

- [x] R2. **Worktree setup must not reconfigure the operator's main repository, must not leak a branch on a failed create, and must state marker and lifecycle-DB ownership.** Four defects in one section. (a) WT-2 prescribes bare `bun install --frozen-lockfile`, which runs the repo's `prepare: lefthook install` (`package.json:56`) — and because worktrees share the main tree's `.git`, installing deps inside an "isolated" worktree rewrites the operator's main-repo hooks. (b) `git worktree add -b` creates the branch before the directory, so any create failure leaves a dangling branch and the natural retry dies on `a branch named … already exists`. (c) WT-3 says the marker lives "under `.spur/run/`" without naming a tree, while both trees have one and WT-6's resume scans from wherever the operator stands. (d) WT-4 and WT-5 say nothing about the worktree's own `.spur` lifecycle DB, which is deleted with the tree — so a merged branch's task file reads `done` while the target tree's DB still reads `todo`.

- [x] R3. **`sp:spur-dev` must not silently discard an undeclared flag.** `/sp:dev-refine 0693 --auto --depth ready --agent inline --worktree` was accepted and the isolation silently dropped: `plugins/sp/commands/dev-refine.md:4` does not declare `--worktree`, `flag-glossary.md:406-410` scopes it away from `dev-refine`, only `plugins/sp/skills/next-router/SKILL.md:55` carries an unknown-flag rule, and `plugins/sp/scripts/validate-flag-contracts.ts` gates `--agent` only. Scope is the **parse behaviour** — surface an undeclared flag in the plan line or stop. Whether `dev-refine` *should* declare `--worktree` is a `/sp:dev-*` surface change requiring ADR-051 operator consent and is explicitly **not** in this task.

- [x] R4. **`dev-operations.md` must not document a flag the command it describes rejects.** §5a lists `--next` among shared refine flags (`:239`) and carries a `**--next` warning:**`bullet explaining how it chains (`:251`), while`plugins/sp/commands/dev-refineall.md:56` records `--next` as dropped by feature H8 on 2026-07-31 and the command's `argument-hint` omits it. `dev-operations.md` is the SSOT for what each command does, so the SSOT currently documents a flag the surface rejects.

- [x] R5. **The dogfood driver's gates must cover mutating batch verbs and must accept the drift-row form its own skill prescribes.** (a) `detect-pipeline-driving.ts:50-62` omits `dev-refineall`/`refineall`/`dev-verifyall`/`verifyall` from `PIPELINE_TOKENS`, and `tokenMatches` (`:119-125`) is hyphen-word exact so `runall` cannot cover `refineall` — a run that mutated three tasks, committed, and fast-forwarded `main` was classified `pipelineDriving: false` and would have been accepted without `--max-retry`. (b) `validate-report.ts:41` excludes rows matching `^\|\s*drift:` while `plugins/sp/skills/dogfood-testing/SKILL.md:159,218,418` prescribes the code-span form `` `drift:external` ``, so a correctly-tagged drift row counts as a data row and refuses `status: complete` on `ledger_cardinality`.

- [x] R6. **`spur task update --section` should demote a same-level heading, not delete it.** `MarkdownDocument.stripSameLevelHeadings` (`packages/domain/src/planning/markdown-document.ts:411-427`) removes `###` lines from a task section body; a probe with `### Sub A` / `### Sub B` returns `strippedHeadings: ["### Sub A","### Sub B"]` and a body with both headings gone. `####` is legal below a task's `###` section level, so demotion preserves the author's structure at no cost. The existing `warnings[]` channel (`planning-write-service.ts:476`) stays — reworded from "stripped" to "demoted".

- [x] R7. **Two spec gaps must be closed.** (a) `### Q&A` is an append-only history section written through `MarkdownDocument.replaceSection`, so `task update --section "Q&A"` overwrites it — task 0693's R3 gate entry destroyed six earlier refinement entries. (b) `execution-batch.md:414` defines the abort vocabulary as `aborted (cycle or selector error before any run)` with no zero-task rule, while `dev-operations.md` §5a already lists `empty set after filter` as an abort verdict; it is undefined whether create mode still cuts a worktree for an empty set, and which report shape is emitted.

**Out of scope.** Declaring `--worktree` on `dev-refine` or any other `/sp:dev-*` surface expansion
(ADR-051 consent required — R3 is the parse fix only). Also out: changing the FF-only merge policy,
the WT-5 retention default, or the create-mode auto-decision carve-out; and any change to the
`--worktree` flag's own semantics beyond the safety gaps named above.

### Acceptance Criteria

```gherkin
Feature: Harness contracts

  Scenario: AC1 — A worktree batch cannot silently merge nothing
    Given a --worktree batch whose tasks wrote corpus files
    And a branch carrying zero commits at the terminal action
    When WT-4 runs
    Then it fails loudly instead of reporting a successful fast-forward
    And the worktree is retained per WT-5 rather than removed
    And the spec names an explicit commit step before the terminal action

  Scenario: AC2 — Worktree setup leaves the main tree's git config untouched
    Given a fresh worktree created by WT-2
    When dependencies are installed by the documented command
    Then the main tree's .git/hooks is byte-identical before and after

  Scenario: AC3 — A failed worktree create leaves no branch behind
    Given a git worktree add -b that fails after the branch is created
    When the documented retry runs
    Then it does not fail with "a branch named ... already exists"

  Scenario: AC4 — Marker and lifecycle DB ownership are stated
    Given WT-3 and the WT-4/WT-5 terminal actions
    When the spec is read
    Then it names the tree that owns .spur/run/worktree-<id>.json
    And it states what happens to the worktree's own lifecycle DB state

  Scenario: AC5 — An undeclared flag is surfaced, never dropped
    Given /sp:dev-refine <wbs> --worktree
    When sp:spur-dev parses the arguments
    Then the plan line names --worktree as undeclared, or the operation stops
    And no /sp:dev-* surface gains a new flag as part of this change

  Scenario: AC6 — Command docs and command surfaces agree on --next
    Given dev-operations.md section 5a and plugins/sp/commands/dev-refineall.md
    When both are read
    Then neither presents --next as an accepted refineall flag
    And the H8 removal note remains as the record

  Scenario: AC7 — The dogfood gate covers mutating batch verbs
    Given a testee string containing dev-refineall, refineall, dev-verifyall or verifyall
    When detect-pipeline-driving runs without --max-retry
    Then it refuses with the pipeline-driving message
    And a testee containing none of the pipeline tokens is still accepted

  Scenario: AC8 — The prescribed drift-row form validates
    Given a ledger row whose Step cell is the code-span form drift:external
    When validate-report runs against the report
    Then the row is excluded from the data-row count
    And status complete is not refused on ledger_cardinality

  Scenario: AC9 — Section sub-headings survive a section write
    Given a Design body containing ### sub-headings
    When spur task update --section Design --from-file writes it
    Then the sub-headings are present as #### in the written section
    And warnings[] reports them as demoted rather than stripped

  Scenario: AC10 — Q&A appends rather than replaces
    Given a task whose Q&A section carries prior entries
    When a new Q&A entry is written through the CLI
    Then the prior entries are still present

  Scenario: AC11 — A zero-task batch has a defined outcome
    Given a selector that resolves to no tasks after the status filter
    When the batch runs with --worktree
    Then the spec states whether a worktree is cut and which report shape is emitted
    And a contract test pins that behaviour
```

### Q&A

**Q: R1 and R2 are prose specs — how are they tested?** Two ways. The mechanical halves are testable:
`validate-commands.ts` / the `plugins/sp` suite can assert that the spec text contains the commit step
and the non-empty-branch guard, and R5's changes are ordinary unit tests. The behavioural half needs a
dry-run: cut a `--worktree` batch on a throwaway feature, make it write nothing, and confirm WT-4
halts to WT-5 instead of reporting a green merge. Record that run's transcript as AC1's evidence —
this is a `command`-typed evidence row, not a `static-ref` one (`spur task verdict` downgrades
behaviour-bearing AC with only static evidence to PARTIAL).

**Q: For R2(a), why `--ignore-scripts` rather than removing the `prepare` script?** Because `prepare:
lefthook install` is correct for a normal clone — it is only wrong inside a worktree, which shares
`.git` with the main tree. `--ignore-scripts` is the narrow fix at the one call site that has the
problem. Verify the worktree still gets a usable dependency tree afterwards; the reason WT-2 installs
at all is that a fresh worktree has no `node_modules` and the first `bun test` fails on a workspace
import.

**Q: For R2(d), migrate the DB state or declare file state authoritative?** **Open — implementer's
call, record it in `### Solution`.** Replaying `spur task record` into the target tree after the merge
is the complete fix and the more work. Declaring the committed task file authoritative and telling the
operator to resync is honest, cheap, and matches what the `dev-run-0690` driver actually did by hand.
Either is acceptable; silence is not — WT-4 and WT-5 currently say nothing at all.

**Q: For R3, why not just add `--worktree` to `dev-refine`?** Because that is a `/sp:dev-*` surface
expansion and ADR-051 (amended 2026-08-20) requires explicit operator consent with design context for
any noun or verb change on a public surface. The parse fix — surface the undeclared flag or stop — is
strictly inside this task and fixes the whole class rather than one flag on one command. The surface
question is recorded in 0698 `### Q&A` as **open, owner = operator**.

**Q: For R3, is the `validate-flag-contracts.ts` extension in scope?** Optional. The required change is
the runtime parse rule in `sp:spur-dev`, modelled on `plugins/sp/skills/next-router/SKILL.md:55`. A
static gate asserting that every flag a `/sp:` command accepts appears in its `argument-hint` is the
stronger, cheaper-forever version; add it if the parse rule turns out to be hard to enforce by prose
alone.

**Q: For R5(b), relax the regex or change the prescribed form?** Relax the regex. `SKILL.md` writes
every other tag as a code span, so the code-span drift row is the consistent form and three places in
the skill prescribe it. Strip markdown code spans before matching (or match `` ^\|\s*`?drift: ``), and
state the exact literal cell form in §Workspace-drift guard so the next author does not have to infer
it.

**Q: For R7(a), does append-only Q&A break the section writer's contract?** It needs care.
`updateSection` is `replaceSection` by construction and four other sections legitimately depend on
that. Scope the append semantics to `Q&A` specifically (a timestamped entry header appended to the
existing body), and make sure `--from-file` with an explicit full-section rewrite is still reachable
for the case where an author genuinely means to replace.

### Design

#### WHAT

Five prose-contract repairs under `plugins/sp/`, two script fixes, and one behaviour change in the
shared section writer. No new abstraction; no `/sp:dev-*` surface expansion.

#### WHY one task

They are one layer: the spec that describes the worktree lifecycle, the command files and glossary
that describe the flags, the driver scripts that gate them, and the writer every one of those
documents is authored through. Today the spec, the command file, the glossary and the validator
disagree with each other in four separate places. Fixing them in one pass is how you notice that.

#### WHERE — change map

| R | File | Anchor | Change |
| --- | --- | --- | --- |
| R1 | `plugins/sp/skills/spur-dev/references/execution-batch.md` | after §WT-3 | New **WT-3b — commit the batch's writes on `$BRANCH` before the terminal action**, with the exact command and a note that generated corpus files are included |
| R1 | same file | §WT-4 | Before the FF-merge, assert `git rev-list --count "$BASE_SHA".."$BRANCH"` is non-zero; on zero, fall through to WT-5 with an explicit halt cause ("branch carries no commits — nothing to merge") |
| R2 | same file | §WT-2 create mode | `bun install --frozen-lockfile --ignore-scripts`, with one sentence saying why (`package.json:56` `prepare: lefthook install` rewrites the *shared* `.git/hooks`). Apply to reuse mode's conditional install too |
| R2 | same file | §WT-2 create mode | Wrap the create: on non-zero exit from `git worktree add -b`, run `git branch -D "$BRANCH"` before surfacing the error — or derive a fresh short-id per attempt |
| R2 | same file | §WT-3, §WT-6 | State that the marker is written to the **invoking** tree; have WT-6's scan say so |
| R2 | same file | §WT-4, §WT-5 | Add a lifecycle-DB disposition paragraph (see the open decision in `### Q&A`) |
| R3 | `plugins/sp/skills/spur-dev/SKILL.md` | argument-parse step | Import next-router's rule verbatim: *"Unknown flags are not silently dropped: note them in the plan line, or stop."* Model: `plugins/sp/skills/next-router/SKILL.md:55` |
| R3 | `plugins/sp/scripts/validate-flag-contracts.ts` | C-series contracts | **Optional**: add a contract asserting every flag a `/sp:` command accepts appears in its `argument-hint`. Currently only `--agent` is gated |
| R4 | `plugins/sp/skills/spur-dev/references/dev-operations.md` | `:239`, `:251` | Strike `--next` from §5a Inputs; delete the §5a `--next` warning bullet. Leave `dev-refineall.md:56`'s H8 removal note as the record |
| R5 | `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts` | `:50-62` | Add `dev-refineall`, `refineall`, `dev-verifyall`, `verifyall` to `PIPELINE_TOKENS` |
| R5 | `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts` | — | Boundary cases: `refineall` matches, `runall` still matches, a word merely containing `run` does not |
| R5 | `plugins/sp/scripts/dogfood-testing/validate-report.ts` | `:41` | Strip markdown code spans before matching, or relax to `` ^\|\s*`?drift: `` |
| R5 | `plugins/sp/skills/dogfood-testing/SKILL.md` | §Workspace-drift guard | State the exact literal cell form so the next author does not infer it |
| R6 | `packages/domain/src/planning/markdown-document.ts` | `:411-427` | Demote `###` → `####` instead of deleting; rename the accumulator's semantics from stripped to demoted |
| R6 | `packages/app/src/services/planning-write-service.ts` | `:476-482` | Reword the warning text accordingly; keep the channel |
| R7 | `packages/app/src/services/planning-write-service.ts` (+ writer) | Q&A path | Append a timestamped entry to `Q&A` rather than replacing; keep an explicit full-rewrite path reachable |
| R7 | `plugins/sp/skills/spur-dev/references/execution-batch.md` | Step 1 | Zero-task rule: early-exit report shape, and whether WT-2 is skipped. Add a contract test |

#### Frozen names

`WT-3b` as a lifecycle step id. Nothing else — no new CLI noun, verb, or flag, and **no `/sp:dev-*`
surface expansion**. If any R-item appears to need one, stop and get ADR-051 consent first.

#### Precedence

`plugins/sp/skills/spur-dev/references/dev-operations.md` is the SSOT for what each command does;
`plugins/sp/commands/*.md` is the surface record. Where they disagree (R4), the surface wins on
*what the command accepts* and the SSOT is corrected — never the reverse.

#### Anti-patterns — do not do these

- **Do not declare `--worktree` on `dev-refine`** (or any other flag on any other `/sp:dev-*`
  command) under this task. R3 is the parse fix; the surface question needs operator consent.
- **Do not weaken WT-4's FF-only policy** to make the commit step unnecessary. FF-only is deliberate:
  the corpus files are generated and conflict-prone, and automated conflict resolution over them
  unattended is exactly the wrong thing.
- **Do not remove the `prepare` script** to fix R2(a). It is correct for a normal clone; only the
  worktree call site is wrong.
- **Do not change the prescribed `` `drift:external` `` form** to match the validator. Three places in
  `SKILL.md` prescribe the code span and every other tag in that document is written the same way.
- **Do not make `updateSection` append for every section.** R7(a) is scoped to `Q&A`; four other
  sections legitimately depend on replace semantics.

### Plan

Ordered so the cheap mechanical fixes land first and the prose spec work — which needs a live dry-run
to verify — comes last.

1. [ ] **Fix the driver gates (R5).** Extend `PIPELINE_TOKENS`; relax the drift-row exclusion; state
   the literal cell form in `dogfood-testing/SKILL.md` §Workspace-drift guard. Extend
   `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts` with the `refineall`/`verifyall` cases
   and a negative case proving `tokenMatches` still will not fire on an unrelated word. Test intent: a
   mutating batch verb can no longer reach Phase 2 classified as non-mutating.

2. [ ] **Demote instead of delete (R6).** Change `stripSameLevelHeadings` to demote `###` → `####`;
   reword the warning. Regression: a `MarkdownDocument.replaceSection` probe with two `###`
   sub-headings returns a body containing both as `####`, and `warnings[]` reports them as demoted.
   Test intent: an authored Design under `--depth ready` keeps its structure.

3. [ ] **Scope Q&A to append (R7a).** Append a timestamped entry rather than replacing; keep an
   explicit full-rewrite path. Regression: writing a new Q&A entry leaves the prior entries present;
   the other four sections still replace.

4. [ ] **Reconcile the flag contracts (R3, R4).** Import next-router's unknown-flag rule into
   `sp:spur-dev`'s argument parse; strike `--next` from `dev-operations.md` §5a Inputs and delete the
   §5a warning bullet. Optionally extend `validate-flag-contracts.ts` with the argument-hint contract.
   Test intent: `/sp:dev-refine <wbs> --worktree` surfaces the flag instead of dropping it, and the
   SSOT stops documenting a rejected flag.

5. [ ] **Repair the worktree spec (R1, R2).** Add WT-3b and the WT-4 non-empty-branch guard;
   prescribe `--ignore-scripts` with its rationale; add branch cleanup on failed create; state marker
   tree ownership in WT-3 and WT-6; add the lifecycle-DB disposition paragraph (decision from
   `### Q&A`). Add the Step 1 zero-task rule (R7b) in the same pass.

6. [ ] **Prove the spec behaviourally (AC1–AC4, AC11).** Run a `--worktree` batch on a throwaway
   feature that writes nothing: confirm WT-4 halts to WT-5 with the new cause instead of reporting a
   green merge. Capture `.git/hooks` hashes before and after a worktree install. Force a
   `worktree add -b` failure and confirm the retry succeeds. Run a zero-task selector. Record these as
   `command`-typed evidence — behaviour-bearing AC with only `static-ref` evidence are downgraded to
   PARTIAL by `spur task verdict`.

7. [ ] **Commit prep.** `bun run autofix && bun run spur-check` (which runs `link-check`,
   `transition-shim-check` and `script-contract-check` ahead of the suite — all three touch files this
   task edits). Then `spur task check --corpus` **once** (constitution T11). Author `### Solution`
   with the change map and the R2(d) lifecycle-DB decision.

### Root Cause

All seven reproduced against `HEAD` = `dad078ad5` on 2026-08-28.

**R1 — the worktree lifecycle never commits.**
`plugins/sp/skills/spur-dev/references/execution-batch.md` defines WT-1 (`:450`), WT-2 (`:473`),
WT-3 (`:569`), WT-4 (`:620`), WT-5 (`:670`), WT-6 (`:699`), WT-7 (`:723`). No commit step exists in
any of them. WT-4's create-mode block reads:

```bash
git checkout "$BASE_REF"
git merge --ff-only "$BRANCH"          # FF-only: never rebase, merge-commit, or resolve conflicts
# if FF succeeded:
git worktree remove "../<worktree-dir>"
git branch -d "$BRANCH"
# update marker: status = "merged"
```

On a branch with zero commits `git merge --ff-only` exits 0 ("Already up to date"), so the next two
lines delete the worktree and the branch — with the batch's uncommitted corpus writes inside. The
`sp-dev-refineall-f94` run reached exactly this point with three modified task files uncommitted and
survived only because the driver hand-committed `4e0e826af` first.

**R2 — worktree setup leaks into the main tree.**

(a) `package.json:56` is `"prepare": "lefthook install"`. `execution-batch.md` §WT-2 create mode
prescribes `cd "../<worktree-dir>" && bun install --frozen-lockfile` with no `--ignore-scripts`. Git
worktrees share the main tree's `.git`, so `lefthook install` rewrites the operator's main-repo hooks
from inside the "isolated" tree.

(b) `git worktree add "../<dir>" -b "$BRANCH" "$BASE_REF"` creates the branch before the directory.
The `sp-dev-refineall-f94` run's first attempt died on the directory step under a sandbox, and the
retry failed with `a branch named 'sp/refineall-f94-6915' already exists` — one clear error turned
into two confusing ones. Nothing in WT-2 cleans up.

(c) WT-3 (`:569-591`) says the marker is written "under `.spur/run/`" and names the file
`.spur/run/worktree-<marker-id>.json`, without saying which tree. Both the invoking tree and the
worktree have a `.spur/run/`, and WT-6's resume (`:699-713`) scans `.spur/run/worktree-*.json` from
wherever the operator stands.

(d) WT-4 (`:620-668`) and WT-5 (`:670-698`) describe merge, removal, retention and the marker's
status transition, and say nothing about the worktree's own `.spur` lifecycle DB — which is removed
with the tree. In the `dev-run-0690` run the branch's committed task file read `status: done` while
main's DB still reported 0690 as `todo`.

**R3 — no unknown-flag policy.** `plugins/sp/commands/dev-refine.md:4`:

```
argument-hint: "<wbs> [--focus <mode>] [--description <text>] [--depth <standard|ready>] [--agent <inline|auto|name>] [--auto] [--next]"
```

No `--worktree`. `plugins/sp/skills/spur-dev/references/flag-glossary.md:377` scopes the flag and
`:406-410` lists the commands that get it (`dev-refineall`, `dev-runall`, `dev-verifyall`, `dev-run`)
and the ones that do not. `grep -rn "[Uu]nknown flag" plugins/sp/skills plugins/sp/commands` returns
exactly one hit: `plugins/sp/skills/next-router/SKILL.md:55` — *"Parse — split `$ARGUMENTS` into
target + flags. Unknown flags are not silently dropped:"*. `plugins/sp/scripts/validate-flag-contracts.ts`
gates `--agent` only.

**R4 — the SSOT contradicts the command.**
`plugins/sp/skills/spur-dev/references/dev-operations.md:239`:
*"Shared refine flags (passed through to each per-task refine): `--focus <mode>`, `--description
<text>`, `--depth <standard|ready>`, `--agent <inline|auto|name>`, `--auto`, `--next`."*
`:251`: *"**`--next` warning:** Passing `--next` chains **each** successful refine into
`/sp:dev-run <wbs> --mode implement --auto --next` …"*
Against `plugins/sp/commands/dev-refineall.md:56`:
*"> **`--next` dropped** (feature H8, 2026-07-31). Batch-level chaining was a token bomb …"* —
and that file's `argument-hint` omits it.

**R5 — the driver gates.**
`plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:50-62`:

```ts
const PIPELINE_TOKENS = ['--next','dev-runall','dev-wrapall','dev-run','dev-wrap','dev-idea',
                         'runall','wrapall','run','wrap','idea'] as const;
```

`tokenMatches` (`:119-125`) builds `new RegExp('(?<![\\w-])' + escaped + '(?![\\w-])', 'i')`, so
`dev-refineall` matches none of them — `refineall` is not `runall`, and the hyphen-word boundary
prevents `run` from matching inside it.

`plugins/sp/scripts/dogfood-testing/validate-report.ts:39-41`:

```ts
// drift:external rows are documentary (task 0296) — included in the table but
.filter((line) => !/^\|\s*drift:/.test(line.trim()));
```

`plugins/sp/skills/dogfood-testing/SKILL.md:159`, `:218` and `:418` all prescribe the code-span form
`` `drift:external` ``, which this filter does not match.

**R6 — headings are deleted, not demoted.** Direct probe of `MarkdownDocument.replaceSection` on a
task document with a Design body of `### Sub A` / prose / `### Sub B` / prose:

```
strippedHeadings: ["### Sub A","### Sub B"]
--- body ---
(prose one and prose two only; both headings gone)
```

`packages/domain/src/planning/markdown-document.ts:411-427` (`stripSameLevelHeadings`) removes them;
`:379` calls it from `replaceSection`. The warning path **does** work —
`packages/app/src/services/planning-write-service.ts:476-482` maps `doc.strippedHeadings` into
`warnings[]`, and `apps/cli/src/commands/task.ts:364` prints them — which corrects the source report's
claim that no warning is emitted. The loss of structure is the real defect: `####` is legal below a
task's `###` section level, so nothing forces deletion.

**R7 — two spec gaps.**

(a) `task update --section` routes to `MarkdownDocument.replaceSection`, so `### Q&A` is overwritten
wholesale. The `sp-dev-run-0693` run recorded that 0693's R3 gate entry replaced six earlier
refinement Q&A entries; the substance survived in Design and ADR-091 but the append-only trail did not.

(b) `execution-batch.md:414` reads `aborted` (cycle or selector error before any run)`;
`dev-operations.md` §5a's batch verdict vocabulary reads
`aborted`(cycle / unknown selector / **empty set after filter**)`. The zero-task path is undefined in
the lifecycle spec — including whether WT-2 still cuts a worktree for an empty set — and the
`dev-runall-feature-b` run left it unprobed because feature B resolved three tasks.

### Solution

Implemented per the Design change map; R-item → as-built mapping (file:line):

- **R5a** `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:50` — added `dev-refineall`, `dev-verifyall` (complete-token group) and `refineall`, `verifyall` (bare-noun group) to `PIPELINE_TOKENS`; hyphen-word `tokenMatches` covers the rest.
- **R5b** `plugins/sp/scripts/dogfood-testing/validate-report.ts:42` — drift-row exclusion relaxed to `/^\|\s*`?drift:/` so the prescribed code-span form matches; comment states both forms.
- **R6** `packages/domain/src/planning/markdown-document.ts:166,310,379` — `stripSameLevelHeadings` now demotes (`#` + line) instead of deleting; accumulator/accessor renamed `_demotedHeadings`/`demotedHeadings`; `packages/app/src/services/planning-write-service.ts:476` warning reworded stripped→demoted (channel kept).
- **R7a** `packages/app/src/services/planning-write-service.ts:548,587` — new `appendQaEntry` helper; an `updateSection` write to `Q&A` appends a `#### Q&A entry — <iso-ts>` block instead of replacing. Explicit full rewrite stays reachable: a body starting with `<!-- qa:replace -->` (`:588`) replaces wholesale. All other sections keep replace semantics.
- **R3** `plugins/sp/skills/spur-dev/SKILL.md:237` (Platform Notes, argument parsing) — imported the unknown-flag rule (source: `plugins/sp/skills/next-router/SKILL.md`, "Parse" step): unknown flags are noted in the plan line or the operation stops; names `--worktree`-on-`dev-refine` as the motivating case. No `/sp:dev-*` surface gained a flag. The optional `validate-flag-contracts.ts` argument-hint gate was **not** added (optional per Q&A; the prose rule shipped instead).
- **R4** `plugins/sp/skills/spur-dev/references/dev-operations.md:251` — §5a shared-flags line no longer lists `--next`; the old warning bullet is now an explicit not-accepted note pointing at the H8 removal record in `plugins/sp/commands/dev-refineall.md`.
- **R1** `plugins/sp/skills/spur-dev/references/execution-batch.md` — new **WT-3b** (commit the batch's writes on `$BRANCH`, inside the worktree, before any terminal action) plus the WT-4 zero-commit guard (`git rev-list --count "$BASE_SHA..$BRANCH"` must be > 0; on zero → WT-5 with halt cause "branch carries no commits — nothing to merge", worktree retained).
- **R2a/b/c/d** same file — WT-2 installs (create + reuse conditional) are now `bun install --frozen-lockfile --ignore-scripts` with the shared-`.git/hooks` rationale (`package.json:56`, `prepare: lefthook install`); the create is wrapped so a failed `git worktree add -b` deletes the dangling branch (or derives a fresh short-id); WT-3 states the marker lives in the **invoking** tree and WT-6's scan says so; WT-4/WT-5 carry the **Lifecycle-DB disposition** paragraph.
- **R7b** `execution-batch.md` Step 1 — zero-task rule: empty set after filter → `aborted (empty set after filter)`; under `--worktree` WT-2 is skipped entirely (no worktree, no marker); early-exit report shape stated; pinned by `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`.
- **R2(d) decision (was open in Q&A): the committed task file is authoritative.** The operator resyncs the invoking tree's DB by replaying the recorded terminal transitions; auto-migration rejected — the DB is per-tree by design and the committed corpus files are the durable record.

Tests: see `### Testing`. Static spec pins for the worktree/zero-task prose live in `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The spec now names an explicit commit step and refuses a no-op merge. `plugins/sp/skills/spur-dev/references/execution-batch.md:640-654` adds **WT-3b — Commit the batch's writes on `$BRANCH`**, placed before any terminal action, with the rationale that an FF-only merge carries only commits so uncommitted worktree writes would be destroyed by create mode's `git worktree remove`. WT-4's create path (`:665-672`) guards the zero-commit case ahead of the merge — `[ "$(git rev-list --count "$BASE_SHA..$BRANCH")" -gt 0 ] |
| R2 | MET | All four sub-defects closed in `execution-batch.md`. **(a)** `:513-520` prescribes `bun install --frozen-lockfile --ignore-scripts` and states the reason as a requirement, not a style note: worktrees share the main tree's `.git` and this repo's `prepare` is `lefthook install`, so a bare install rewrites the operator's main-repo hooks from inside the "isolated" tree. **(b)** `:500-503` wraps the create — `git worktree add … -b "$BRANCH" … |
| R3 | MET | The spine carries the parse rule verbatim — "Argument parsing. Split `$ARGUMENTS` into target + flags before dispatching. Unknown flags are not silently dropped: note them in the plan line, or stop" (`plugins/sp/skills/spur-dev/SKILL.md:237-238`). Scope held to parse behaviour: `bun plugins/sp/scripts/validate-flag-contracts.ts` → **"All 72 contract surfaces agree across all claims."** (exit 0), confirming no `/sp:dev-*` surface gained a flag as part of this change. |
| R4 | MET | `plugins/sp/skills/spur-dev/references/dev-operations.md:239` lists the shared refine flags as `--focus`, `--description`, `--depth`, `--agent`, `--auto` — `--next` is **absent**, and `:251` states "**`--next` is not accepted** (dropped by feature H8, 2026-07-31 — see `plugins/sp/commands/dev-refineall.md` for the removal record)". The record itself survives at `plugins/sp/commands/dev-refineall.md:56-60`. The SSOT and the command surface now agree. |
| R5 | MET | Source fixed **and shipped** — the second half required this run. **(a)** `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:54,60` carry `dev-refineall`/`dev-verifyall`/`refineall`/`verifyall` in `PIPELINE_TOKENS`. **(b)** `plugins/sp/scripts/dogfood-testing/validate-report.ts:42` filters `!/^\|\s*`?drift:/`, accepting the code-span form the skill prescribes. **Fix-pass repair:** both `.mjs` twins were **stale** at the start of this run (built 15:14 against `.ts` sources edited 17:42/17:44), and the `.mjs` is what actually executes — `node …/detect-pipeline-driving.mjs --testee "/sp:dev-verifyall --feature F95"` returned `pipelineDriving: false`, i.e. the fix was committed but never shipped. Rebuilt via `superskill script convert sp dogfood-testing/detect-pipeline-driving.ts` and `… validate-report.ts`; `bun plugins/sp/scripts/script-contract-check.ts` → **"15 script(s) baselined (7 standard, 8 repo-only), 0 violation(s) — PASS"**. |
| R6 | MET | Demotion, not deletion. `packages/domain/src/planning/markdown-document.ts:426` pushes each demoted line onto `_demotedHeadings` instead of dropping it, exposed via the `demotedHeadings` getter at `:310`. The advisory string is `Demoted same-level heading one level deeper in section body` (`packages/app/src/services/planning-write-service.ts:478`). Live probe this run on a scratch task: a Design body containing `### Sub A` / `### Sub B` was written back as `#### Sub A` / `#### Sub B` (raw section read: `'Body text.\n\n#### Sub A\n\nalpha\n\n#### Sub B\n\nbeta\n'`) with both headings reported in `warnings[]` as demoted. The `warnings[]` channel is retained as the requirement specifies. |
| R7 | MET | Both spec gaps closed. **(a)** `### Q&A` is append-only in practice — two successive `spur task update 0714 --section "Q&A" --from-file` writes this run produced two timestamped `#### Q&A entry — <iso>` blocks with the **first entry still present**, so the overwrite that destroyed task 0693's earlier refinement entries can no longer happen. **(b)** `plugins/sp/skills/spur-dev/references/execution-batch.md:416-423` defines the zero-task rule: an empty set after the status filter is `aborted (empty set after filter)` matching dev-operations.md §5a, **WT-2 is skipped entirely** (no worktree cut, no WT-3 marker), the early-exit report carries zero per-task rows and `Steps: 0 derived, 0 executed`, and no WT-3b/WT-4/WT-5 action runs. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 [docs-only] — A worktree batch cannot silently merge nothing | MET | static-ref | `plugins/sp/skills/spur-dev/references/execution-batch.md:665-672` fails loudly on a zero-commit branch (`halt: branch carries no commits - nothing to merge`, `false`) **before** `git merge --ff-only`, and `:679-680` routes that halt to WT-5 retention rather than `git worktree remove`. The explicit commit step the scenario demands is WT-3b at `:640-654`. |
| AC2 [docs-only] — Worktree setup leaves the main tree's git config untouched | MET | static-ref | `plugins/sp/skills/spur-dev/references/execution-batch.md:513` documents the install as `bun install --frozen-lockfile --ignore-scripts`, and `:515-520` states the byte-identity rationale directly: worktrees share the main tree's `.git`, this repo's `prepare` is `lefthook install`, so `--ignore-scripts` is "required, not stylistic". Reuse mode carries the same rule at `:527-529`. |
| AC3 [docs-only] — A failed worktree create leaves no branch behind | MET | static-ref | `plugins/sp/skills/spur-dev/references/execution-batch.md:500-503` — the create is wrapped ` |
| AC4 [docs-only] — Marker and lifecycle DB ownership are stated | MET | static-ref | `plugins/sp/skills/spur-dev/references/execution-batch.md:589-593` names the tree that owns `.spur/run/worktree-<id>.json` — the **invoking** tree, "not the worktree's own `.spur/run/`" — and `:714-721` states what happens to the worktree's lifecycle DB: it does not travel with the merge, the committed task file is authoritative, and re-sync is an explicit replay. |
| AC5 — An undeclared flag is surfaced, never dropped | MET | command | The spine states that unknown flags are not silently dropped and must be noted in the plan line or stop, naming `--worktree` on `dev-refine` as the worked example (`plugins/sp/skills/spur-dev/SKILL.md:237-240`). The no-new-flag half is machine-checked: `bun plugins/sp/scripts/validate-flag-contracts.ts` → "All 72 contract surfaces agree across all claims." (exit 0). |
| AC6 — Command docs and command surfaces agree on --next | MET | command | `plugins/sp/skills/spur-dev/references/dev-operations.md:239` (shared refine flag list) contains no `--next`; `:251` states it is not accepted and points at the removal record; `plugins/sp/commands/dev-refineall.md:56-60` retains the H8 note. Cross-surface agreement machine-checked by the same `validate-flag-contracts.ts` run (72 surfaces, exit 0). |
| AC7 — The dogfood gate covers mutating batch verbs | MET | command | Post-rebuild probe this run: `node plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.mjs --testee "/sp:dev-verifyall --feature F95 --fix all" --json` → `pipelineDriving: true`, `refuse: true`, `exitCode: 2`, message "⚠ pipeline-driving testee detected; pass --max-retry …". Negative control still accepted: `--testee "spur task show 0693"` → `pipelineDriving: false`, `refuse: false`, `exitCode: 0`. Before the rebuild the same positive probe returned `pipelineDriving: false` — see the R5 fix-pass note. |
| AC8 — The prescribed drift-row form validates | MET | test | `plugins/sp/scripts/dogfood-testing/validate-report.ts:42` excludes both the bare and the code-span form (`!/^\|\s*`?drift:/`), so a `` `drift:external` `` Step cell is not counted as a data row and cannot refuse `status: complete` on `ledger_cardinality`. Pinned by the report-contract suite: `cd plugins/sp && bun test tests/dogfood-testing/` → **83 pass / 0 fail** across 3 files. The shipped `.mjs` carries the fix only after this run's rebuild (`grep -c '`?drift:' …validate-report.mjs` → 1). |
| AC9 — Section sub-headings survive a section write | MET | command | Live probe on scratch task 0714 (created and removed this run): `spur task update 0714 --section Design --from-file` with a body containing `### Sub A` and `### Sub B` wrote the section as `'Body text.\n\n#### Sub A\n\nalpha\n\n#### Sub B\n\nbeta\n'` — both sub-headings present as `####` — and returned two `warnings[]` entries beginning "Demoted same-level heading one level deeper in section body", not "stripped". |
| AC10 — Q&A appends rather than replaces | MET | command | Same scratch task: two successive `spur task update 0714 --section "Q&A" --from-file` writes produced `#### Q&A entry — 2026-08-29T03:26:08.776Z / First Q&A entry.` followed by `#### Q&A entry — 2026-08-29T03:26:09.006Z / Second Q&A entry.` — the prior entry survived the second write. |
| AC11 — A zero-task batch has a defined outcome | MET | test | `plugins/sp/skills/spur-dev/references/execution-batch.md:416-423` states the behaviour (verdict `aborted (empty set after filter)`; **WT-2 skipped entirely** so no worktree is cut and no WT-3 marker written; early-exit report with zero per-task rows, `Steps: 0 derived, 0 executed`; no WT-3b/WT-4/WT-5) and names the pinning test. That test exists and passes: `cd plugins/sp && bun test tests/dogfood-testing/execution-batch-contract.test.ts` → **7 pass / 0 fail**. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Reviewer:** review coordinator (functional traceability + SECUA + architecture), 2026-08-28
close-out. **Verdict: PASS.** Supersedes the `PARTIAL by design of this run` disposition below —
that PARTIAL rested on AC1–AC4/AC11 carrying `static-ref` evidence, which `spur task verdict`
downgrades. The close-out re-evidenced them: the behavioural halves that were deferred are now
driven (the dogfood gate probed end-to-end, the demote and Q&A-append paths exercised against a
scratch task, the zero-task contract test run), and the spec-only halves are tagged `[docs-only]`
because they assert document content, not runtime behavior.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | correctness | `plugins/sp/scripts/dogfood-testing/*.mjs` | **R5 was committed but not shipped.** Commit `4748fa566` edited both `.ts` sources without regenerating their `.mjs` twins, and the `.mjs` is the executed artifact — so the pipeline-driving gate was still blind to `verifyall`/`refineall`. The repo already owns the guard: `script-contract-check` enforces "a valid `.mjs` twin not older than its `.ts` source" and is `spur-check`'s third step, so it was not run before that commit. Both twins regenerated in the close-out; `script-contract-check` → 0 violations. No code change warranted — the gate is correct and was bypassed. |
| P3 | correctness | `packages/app/src/services/planning-write-service.ts:478` | The same commit's strip→demote change left `apps/cli/tests/commands/task.test.ts` asserting the retired `Stripped same-level heading` string, so the `apps/cli` suite ran 900/1 until the close-out repaired it. Same root cause as the P2 above: a behaviour change landed without the full gate. Fixed; the suite is 901/0. |
| P3 | architecture | `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:50-62` | `IMPLEMENT_HEAVY_TOKENS` deliberately not extended alongside `PIPELINE_TOKENS`: a `refineall`/`verifyall` testee under an explicit `--max-retry N` is pipeline-driving-refused but not implement-heavy-advised. Narrow and documented in Solution; carried forward unchanged. |
| P4 | usability | `plugins/sp/skills/spur-dev/references/execution-batch.md` | The Q&A full-rewrite escape hatch is a body-prefix marker (`<!-- qa:replace -->`), not a CLI flag — no new flag surface was permitted under this task (ADR-051). Discovery is via docs only. |
| P4 | usability | task section rendering | Appended Q&A entries introduce `####` timestamp headers into the section body; renderers must tolerate depth-4 headings. Already legal below a task's `###` sections, and now exercised — a scratch-task probe produced two timestamped entries with the first intact. |

**Functional traceability.** All seven requirements MET against the close-out evidence: R1 (WT-3b
commit step + zero-commit guard routing to WT-5), R2 (all four sub-defects — `--ignore-scripts`,
branch cleanup on failed create, marker owned by the invoking tree, lifecycle-DB disposition),
R3 (the spine's unknown-flag parse rule, with `validate-flag-contracts` confirming 72 surfaces
agree and no surface gained a flag), R4 (`--next` absent from the §5a flag list, removal record
retained), R5 (source correct **and now shipped**), R6 (demote not delete, proven live), R7 (Q&A
appends; zero-task rule specified and pinned by a 7-pass contract test).

**Architecture.** The residual risk stands and is worth restating: the worktree lifecycle is
prose. WT-3b's commit step and WT-4's zero-commit guard bind a driver only as strongly as the
spec is followed, and the static contract pins catch regressions in the text, not disobedience by
a driver. The zero-task contract test is the one behavioural anchor; the rest of the worktree
lifecycle has no executable guard, which is the honest limit of a spec-shaped task.
### References

**Parent:** task **0698** — `### Requirements` R3, R4, R13, R14, R15, R16, R19(c), R19(d).
**Feature:** F95 (placement inherited from the parent; this task's subject is the `plugins/sp`
contract layer, wider than F95's charter — see 0698 `### Background`).

**Source dogfood runs.** `docs/dogfood/2026-08-27-sp-dev-refineall-f94-dogfood.md` (P1 no commit step
— fixed by hand as `4e0e826af`; P1 sandbox worktree base; P2 branch leak on failed create; P2
`bun install` runs lefthook against the shared `.git`; P2 `PIPELINE_TOKENS` omits `refineall`; P2
`dev-operations.md` §5a `--next`; P3 marker tree ownership) ·
`docs/dogfood/2026-08-27-dev-refine-0693-dogfood.md` (P1 `--worktree` accepted and discarded — the run
then lost seven section writes to a concurrent writer; P2 `###` headings stripped; P4 drift-row
exclusion; P4 no machine gate for undeclared testee flags) ·
`docs/dogfood/2026-08-27-dev-run-0690-dogfood.md` (P2 lifecycle DB does not travel with WT-4/WT-5;
fresh worktree lacked `node_modules` so `biome` resolved to a stale global) ·
`docs/dogfood/2026-08-27-sp-dev-run-0693-worktree-dogfood.md` (F7 Q&A is not append-enforced) ·
`docs/dogfood/2026-08-27-dev-runall-feature-b-dogfood.md` (P4 zero-task batch behaviour undefined).

**Authority.** `docs/00_ADR.md` ADR-051 (amended 2026-08-20) — the four-surface rule and the
public-CLI consent gate that keeps R3 scoped to the parse fix · `CLAUDE.md` §Conventions — "One writer
per working tree" (task 0487 R5), the discipline `--worktree` exists to make enforceable ·
`docs/99_PROJECT_CONSTITUTION.md` **T11** (corpus sweep is a commit gate).

**Spec and contract anchors.**

- `plugins/sp/skills/spur-dev/references/execution-batch.md` — §WT-1 `:450`, §WT-2 `:473`
  (create mode `:481-500`, reuse `:505-522`, name resolution `:524-540`), §WT-3 `:569-604`,
  §WT-4 `:620-668`, §WT-5 `:670-698`, §WT-6 `:699-722`, §WT-7 `:723`, Step 1 abort vocabulary `:414`
- `plugins/sp/skills/spur-dev/references/dev-operations.md:239`, `:251` — §5a `--next`
- `plugins/sp/commands/dev-refineall.md:56` — the H8 removal record
- `plugins/sp/commands/dev-refine.md:4` — the `argument-hint` missing `--worktree`
- `plugins/sp/skills/spur-dev/references/flag-glossary.md:377`, `:406-410` — `--worktree` scope
- `plugins/sp/skills/next-router/SKILL.md:55` — the unknown-flag rule to import
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:50-62`, `:119-125`, `:133-138`
- `plugins/sp/scripts/dogfood-testing/validate-report.ts:39-41`
- `plugins/sp/skills/dogfood-testing/SKILL.md:159`, `:218`, `:418` — the prescribed drift-row form
- `plugins/sp/scripts/validate-flag-contracts.ts` — currently gates `--agent` only

**Code anchors.**

- `packages/domain/src/planning/markdown-document.ts:379` (call site), `:411-427`
  (`stripSameLevelHeadings`), `:305-311` (`strippedHeadings` accessor)
- `packages/app/src/services/planning-write-service.ts:476-494` — `warnings[]` construction
- `apps/cli/src/commands/task.ts:364` — where those warnings are printed (non-JSON branch only)
- `package.json:56` — `"prepare": "lefthook install"`

**Gate interaction.** `bun run spur-check` runs `link-check`, `transition-shim-check` and
`script-contract-check` before the suite; all three read files this task edits, so a broken link or an
undeclared plugin script fails in under a second rather than after the 63 s test run.

### History

- 2026-08-29T00:37:55.649Z todo → wip (system)
- 2026-08-29T00:54:28.935Z wip → testing (system)
- 2026-08-29T05:18:50.247Z testing → done (system)
