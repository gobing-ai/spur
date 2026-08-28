---
schema_version: 1
name: "Remaining verified findings from the 2026-08-27 dogfood sweep and history-anatomy reports"
status: todo
template: issue
created_at: 2026-08-28T22:05:05.989Z
updated_at: "2026-08-28T22:49:26.343Z"
feature_id: F95
ac_altitude: task-local
---

## 0698. Remaining verified findings from the 2026-08-27 dogfood sweep and history-anatomy reports

### Background
Two days of harness work (2026-08-27 → 2026-08-28) produced eleven dogfood reports and two
history-anatomy reports. Between them they filed roughly 70 issues, findings, and advisories. This
task is the **deduplicated, source-verified remainder**: every claim below was re-checked against
`HEAD` (`dad078ad5`) on 2026-08-28, reduced to its root cause, and merged with its duplicates.

**Source artifacts.**

- `docs/dogfood/2026-08-27-dev-refine-0693-dogfood.md` (7 findings)
- `docs/dogfood/2026-08-27-dev-run-0690-dogfood.md` (5 unresolved)
- `docs/dogfood/2026-08-27-dev-run-0697-dogfood.md` (10 findings)
- `docs/dogfood/2026-08-27-dev-runall-f94-inline-dogfood.md` (9 findings)
- `docs/dogfood/2026-08-27-dev-runall-feature-b-dogfood.md` (5 findings)
- `docs/dogfood/2026-08-27-dev-runall-feature-D7-dogfood.md` (13 findings)
- `docs/dogfood/2026-08-27-dev-verify-0693-dogfood.md` (14 findings)
- `docs/dogfood/2026-08-27-sp-dev-refineall-f94-dogfood.md` (9 findings)
- `docs/dogfood/2026-08-27-sp-dev-run-0689-dogfood.md` (7 observations)
- `docs/dogfood/2026-08-27-sp-dev-run-0693-worktree-dogfood.md` (10 findings)
- `docs/dogfood/2026-08-27-sp-dev-verify-0687-dogfood.md` (6 findings)
- `docs/report/2026-08-27-history-anatomy.md` (9 findings)
- `docs/report/2026-08-28-history-anatomy.md` (8 findings)

**Deduplication result.** Nineteen root causes survive, filed as R1–R19. Seven filed items were
dropped because the codebase already closed them or their premise changed — the drop list with
evidence is in `### Q&A`. The remaining history-anatomy entries (repetition loops, model mix,
cost-per-token, reviewer pairing escalations) are runner/routing behaviour that `0680 R5` classifies
as report-only advisories, not Spur code defects; they are named in `### Q&A` and deliberately not
filed here.

**Scope honesty (operator decision, 2026-08-28).** R1–R19 span eight subsystems and are wider than
feature F95's charter, which is the CLI JSON envelope alone. R1/R2 and AC1 are genuinely F95 work
and close F95's still-uncovered `R3` scenario. The operator chose a single task under F95 over a new
feature with a decomposed batch; that choice is recorded here so a later reader does not mistake the
breadth for a scoping accident. An implementer may split R3–R19 into follow-up tasks at any time —
each R-item is written to stand alone.

**The pattern behind the pattern.** Four of the six highest-severity items share one shape: *a gate
or contract that reports success on an unproven path*. The envelope says `ok: true` on a
not-found error (R1); `git merge --ff-only` says success on a branch with zero commits (R3); the
targeted-test loop says exit 1 on a green test (R6); the AC checkbox flip says nothing while never
flipping a single AC box (R7). Each is cheap to fix individually. Together they are why several
dogfood runs burned retries chasing phantom failures and shipped real ones.
### Requirements
Each R-item is one root cause with one owner surface. Severity in brackets is the deduplicated
severity across all source reports, not the highest single filing.

- [ ] R1. **[P1] Under `--json --json-envelope`, no `spur` verb may report `ok: true` or emit no JSON at all on a failure path.** Today `task check 9999` and `feature check F999` both print `{"ok": true, "data": []}` to stdout with exit code 1, and `task path` / `task resolve` / `rule show` / `workflow show` / `agent show` print a bare stderr line and no JSON. Every verb that declares `SHARED_OPTIONS.jsonEnvelope` (68 today) must emit `{ok: false, error: {code, message}}` on every non-zero-exit path, and the surface must be enumerated rather than sampled.

- [ ] R2. **[P2] `writeJsonError` must be able to carry an error code and must not leak the JS class prefix.** `packages/app/src/output/envelope.ts:99-109` hardcodes `INTERNAL_ERROR` and accepts no `details`, while ADR-091 (`docs/00_ADR.md:1664`, `:1708`) promises CLI-local codes collapse to `INTERNAL_ERROR` *with* `details.cliCode`. Thirty-five call sites pass `String(err)`, so the machine-readable message reads `"Error: Task 9999 not found in any registered task folder"`.

- [ ] R3. **[P1] The `--worktree` lifecycle must commit the batch's writes before WT-4, and WT-4 must refuse to report success on an empty branch.** `plugins/sp/skills/spur-dev/references/execution-batch.md` WT-1…WT-7 never names a commit step; `git merge --ff-only "$BRANCH"` on a branch with zero commits succeeds trivially, after which create mode runs `git worktree remove` and `git branch -d` — deleting the tree that held the only copy of the work.

- [ ] R4. **[P2] Worktree setup must not reconfigure the operator's main repo, must not leak a branch on a failed create, and must state marker and DB-state ownership.** Four defects in one section: `bun install --frozen-lockfile` (no `--ignore-scripts`) runs the repo's `prepare: lefthook install` (`package.json:56`) against the worktree-*shared* `.git/hooks`; a failed `git worktree add -b` leaves the branch behind so the natural retry dies on "already exists"; WT-3 does not say which tree owns `.spur/run/worktree-<id>.json`; and WT-4/WT-5 do not migrate lifecycle DB state, so a merged branch's task file says `done` while the target tree's DB still says `todo`.

- [ ] R5. **[P2] `bun test` must be green from any workspace directory on a clean tree.** Run from `apps/cli`, the suite is 880 pass / 6 fail at `HEAD`; run as `SPUR_SKIP_GLOBAL_CONFIG=true bun test` from the same directory it is 886 / 0. The six failures are machine-dependent, so neither a dogfood nor a `--fix` pass can use suite colour as a regression signal on that workspace.

- [ ] R6. **[P2] The targeted-test-first command documented in `CLAUDE.md` must be able to exit 0.** `bun test <file> --test-name-pattern <name>` reports `1 pass / 0 fail` and exits **1**, because the repo-wide 90/90 coverage threshold in `bunfig.toml` is applied to a single-file run. The iteration contract every agent is told to use cannot signal success.

- [ ] R7. **[P2] A verdict that marks an acceptance criterion MET must flip that criterion's checkbox, and `task check --fix` must repair what it reports.** `parseChecklist` recognises only `^(R\d+)`, so every `- [ ] AC1. …` box is invisible to `flipVerifiedCheckboxes` and stays unchecked forever; bold `- [ ] **R1.** …` is likewise invisible even though `L3.requirements-format` explicitly accepts that spelling. `structural-repair.ts` only ever *adds* a `[ ]` marker, never flips to `[x]`, while `task check --fix`'s help text claims "R-item checkboxes".

- [ ] R8. **[P2] A `done` task must not be able to carry a `PARTIAL — request-changes` Review verdict with no gate.** Task 0693 carries `**Verdict: PARTIAL — request-changes**` and, further down, a superseding `**Verdict: PASS**`; both remain, and no code in `packages/app/src` or `packages/config/src` mentions `request-changes`. `task record` backfills Review only when the section is bare and `sp:code-verification` Step 10 forbids verify from writing it, so nothing closes the loop.

- [ ] R9. **[P2] Feature-scenario coverage must not be structurally unsatisfiable for AC-numbered tasks.** DD-09 links a feature scenario to a task by normalized *title*; F95's scenarios are titled `R1 —`/`R2 —`/`R3 —` while task 0693's AC are `AC1`–`AC4`, so all three scenarios report `L4.uncovered-feature-scenario` forever on a `done`, linked, correctly-implemented task. Three separate runs "fixed" this by re-authoring task AC to copy feature scenario titles verbatim.

- [ ] R10. **[P2] Pairing run cost must be able to say "no signal" instead of zero.** `packages/domain/src/analytics/pairings.ts:43` types `totalCostUsd` as a non-nullable `number`, `:132` defaults it to 0, and `:344` wraps the join in `COALESCE(SUM(h.cost_usd), 0)`. Live over 2026-08-27→28, four of six pairings report `0` — including `agy-opus`/reviewer with 16 dispatches. `0680 R6` requires absence to render `not available`, never zero; the type makes the distinction unrepresentable, so every report has to guess.

- [ ] R11. **[P2] Assistant-step duration must be attributable for the busiest sources.** Live `stepSupport` over 2026-08-27→28: claude 7,583 steps / **0** with duration, pi 3,650 / **0**, codex 1,396 / **0**, agy 356 / **0**; only omp (1,588/1,588) is complete and grok is partial (774/3,889). `derived-unattributed-time` fires on both report days and ~73% of the measured span cannot be attributed to llm/tool/idle.

- [ ] R12. **[P2] The `L4.dogfood-missing` gate must not depend on gitignored files.** `.gitignore:184` ignores `/docs/dogfood/*` with five tracked exceptions; 84 reports exist on disk. Forty-one features currently satisfy the gate from untracked files, so a fresh clone or a CI run flips roughly 36 features from passing to failing with no code change.

- [ ] R13. **[P3] `sp:spur-dev` must not silently discard an undeclared flag.** `/sp:dev-refine 0693 … --worktree` was accepted and dropped: `plugins/sp/commands/dev-refine.md:4` does not declare it, `flag-glossary.md:406-410` scopes it away from `dev-refine`, only `plugins/sp/skills/next-router/SKILL.md:55` carries an unknown-flag rule, and `plugins/sp/scripts/validate-flag-contracts.ts` gates `--agent` only. The operator asked for isolation, silently got none, and lost seven section writes to a concurrent writer in that same run.

- [ ] R14. **[P3] `dev-operations.md` must not document a flag the command it describes rejects.** §5a lists `--next` among shared refine flags (`:239`) and carries a `--next` warning bullet (`:251`), while `plugins/sp/commands/dev-refineall.md:56` records `--next` as dropped by feature H8 on 2026-07-31 and the command's `argument-hint` omits it. `dev-operations.md` is the SSOT for what each command does.

- [ ] R15. **[P3] The dogfood driver's gates must cover mutating batch verbs and accept the drift-row form its own skill prescribes.** `detect-pipeline-driving.ts:50-62` omits `dev-refineall`/`refineall`/`dev-verifyall`/`verifyall` from `PIPELINE_TOKENS`, and `tokenMatches` is hyphen-word exact so nothing else covers them — a run that mutated three tasks, committed, and fast-forwarded `main` was reported `pipelineDriving: false`. Separately, `validate-report.ts:41` excludes `^\|\s*drift:` while `dogfood-testing/SKILL.md:159,218,418` prescribes the code-span form `` `drift:external` ``, so a correctly-tagged drift row is counted as a data row and refuses `status: complete`.

- [ ] R16. **[P3] `spur task update --section` should demote a same-level heading, not delete it.** `MarkdownDocument.stripSameLevelHeadings` (`packages/domain/src/planning/markdown-document.ts:411-427`) removes `###` lines from a task section body. The warning channel *does* work (`planning-write-service.ts:476` populates `warnings[]` from `strippedHeadings`), correcting the source report's claim — but under `--depth ready` an authored Design still loses every structural subheading, and in `--json` mode the warning only rides inside the payload where a shell caller reading stdout will not see it.

- [ ] R17. **[P3] `L3.requirements-format` must not penalize the shape `--depth ready` mandates.** `packages/app/src/services/task-check.ts:656-679` counts blank-line-delimited *blocks*, not R-items, so four contiguous R-item lines collapse to one block; adding the two non-goals prose blocks the implement-ready checklist requires scores 1 numbered of 3 and warns. The scaffolded template passes only because it contains nothing but R-items.

- [ ] R18. **[P3] The `L4 gate-language` advisory must not fire on a task that already models its gate.** `packages/app/src/services/task-check.ts:1266` tells the author to "model the gate as a frontmatter dependency **or** verify it" without ever reading `frontmatter.dependencies[]`. Task 0694 carries `dependencies: [0691]` and still warns on both Design and Plan — pure noise on exactly the well-formed case.

- [ ] R19. **[P4] Four small corpus and config truths must be restored.** (a) `docs/features/B_agent-execution.md:26` reads `_No linked tasks._` while 0687/0689/0690 all carry `feature_id: B` — the only stale roster of 117 features. (b) `config/workflows/history-anatomy.yaml:76` declares `correctionCount: "0"`, which is never interpolated anywhere; the live bound is the run-scoped file `.spur/run/$__runId-correction-count`. (c) `### Q&A` is replaced wholesale by `task update --section`, so 0693's R3 gate entry destroyed six earlier refinement entries — an append-only history section with replace semantics. (d) `execution-batch.md` Step 1 defines abort vocabulary for cycle and unknown-selector but no zero-task rule, while `dev-operations.md` §5a already lists `empty set after filter` as an abort verdict; it is undefined whether create mode still cuts a worktree for an empty set.

**Out of scope.** Runner and routing behaviour surfaced by the history-anatomy reports — the pi
`bash` poll repetition, the claude `Read`/`Edit` repeat digests, the model-mix cost delta, and the
reviewer `resource-exhaustion` escalations — is `0680 R5` report-only advisory territory, decided by
humans, and is not filed as an R-item here.

**Also out of scope.** Re-tightening the `L4.stale-line-anchor` drift detector (474 baselined
entries after the ADR-090 acceptance), un-ignoring `docs/dogfood/` as a delivery-contract change
independent of R12's gate correctness, and any change to the `raw` (non-enveloped) `--json`
byte-identity contract that ADR-091 deliberately froze.
### Acceptance Criteria
Each scenario is a runnable regression. `AC1` is titled to match feature F95's third scenario
verbatim so DD-09 links it and F95's standing `L4.uncovered-feature-scenario` warning clears.

```gherkin
Feature: Remaining verified findings from the 2026-08-27 harness sweep

  Scenario: R3 — Implementation follows the approved ADR
    Given every spur verb that declares --json-envelope
    When each verb is driven down a failure path with --json --json-envelope
    Then stdout carries {ok: false, error: {code, message}} and never {ok: true}
    And no failure path exits non-zero while emitting no JSON at all
    And the enveloped message carries no leading "Error: " class prefix

  Scenario: AC2 — Envelope errors distinguish not-found from internal fault
    Given writeJsonError accepts an optional ApiErrorCode
    When spur task show 9999 --json --json-envelope runs
    Then error.code is NOT_FOUND, or INTERNAL_ERROR with details.cliCode set
    And ADR-091's compat paragraph and the shipped helper agree

  Scenario: AC3 — A worktree batch cannot silently merge nothing
    Given a --worktree batch whose tasks wrote corpus files
    When the terminal action runs with zero commits on the branch
    Then WT-4 fails loudly instead of reporting a successful fast-forward
    And the worktree is retained per WT-5 rather than removed

  Scenario: AC4 — Worktree setup leaves the main tree's git config untouched
    Given a fresh worktree created by WT-2
    When dependencies are installed per the documented command
    Then the main tree's .git/hooks is byte-identical before and after
    And a failed worktree add leaves no branch behind for the retry to trip on

  Scenario: AC5 — Every workspace suite is green on a clean tree
    Given a clean checkout with a populated ~/.config/spur/config.yaml
    When bun test runs from apps/cli
    Then the suite reports 0 failures without an operator-set environment variable

  Scenario: AC6 — The documented targeted-test loop exits 0 on a passing test
    Given the targeted-test-first command in CLAUDE.md
    When it runs a single passing test by name
    Then the process exit code is 0

  Scenario: AC7 — A MET acceptance criterion flips its own checkbox
    Given a task whose verdict marks AC1 MET and R1 MET in bold form
    When spur task record runs
    Then both the AC1 box and the bold R1 box read [x]
    And spur task check --fix repairs, not merely reports, L3.unchecked-checklist

  Scenario: AC8 — A done task cannot hide a request-changes Review
    Given a done task whose Review verdict reads PARTIAL — request-changes
    When spur task check runs on it
    Then a finding names the contradiction with the Testing verdict
    And the repair is routed to /sp:dev-review

  Scenario: AC9 — Feature scenario coverage is satisfiable without title mimicry
    Given feature F95 and its linked done task 0693 with AC1–AC4
    When spur feature check F95 --strict runs
    Then no scenario reports L4.uncovered-feature-scenario purely on title mismatch

  Scenario: AC10 — Absent pairing cost renders not available, never zero
    Given a pairing whose history_run_session mapping yields no cost rows
    When spur history analyze --json runs
    Then totalCostUsd is null for that pairing and non-null where cost exists

  Scenario: AC11 — Assistant-step duration is attributed for claude and pi
    Given a window containing claude and pi assistant steps
    When spur history analyze --json runs
    Then stepSupport reports stepsWithDuration > 0 for both sources
    And the derived-unattributed-time warning shrinks or disappears

  Scenario: AC12 — The dogfood gate does not depend on untracked files
    Given a fresh clone with no untracked docs/dogfood reports
    When spur task check --corpus runs
    Then the L4.dogfood-missing population is identical to the working tree's

  Scenario: AC13 — An undeclared flag is surfaced, never dropped
    Given /sp:dev-refine <wbs> --worktree
    When sp:spur-dev parses the arguments
    Then the plan line names --worktree as undeclared, or the operation stops

  Scenario: AC14 — Command docs and command surfaces agree on --next
    Given dev-operations.md §5a and plugins/sp/commands/dev-refineall.md
    When both are read
    Then neither documents --next as an accepted refineall flag

  Scenario: AC15 — Dogfood gates cover batch mutators and the prescribed drift row
    Given a testee string containing dev-refineall or dev-verifyall
    When detect-pipeline-driving runs without --max-retry
    Then it refuses with the pipeline-driving message
    And validate-report accepts a ledger row whose Step cell is `drift:external`

  Scenario: AC16 — Section sub-headings survive a section write
    Given a Design body containing ### sub-headings
    When spur task update --section Design --from-file writes it
    Then the sub-headings are present as #### rather than deleted

  Scenario: AC17 — Requirements format and gate-language advisories stop misfiring
    Given a Requirements section with contiguous R-items plus a non-goals block
    And a task carrying a non-empty frontmatter dependencies list
    When spur task check runs
    Then neither L3.requirements-format nor the L4 gate-language advisory fires

  Scenario: AC18 — The four small corpus and config truths are restored
    Given feature B, history-anatomy.yaml, the Q&A writer, and execution-batch.md Step 1
    When each is inspected
    Then B lists its three tasks, the dead correctionCount var is gone or wired,
      Q&A appends rather than replaces, and a zero-task batch has a defined outcome
```
### Q&A
**Q: Which filed items were dropped, and on what evidence?** Seven. Each was re-checked at `HEAD`
(`dad078ad5`) on 2026-08-28.

| Dropped item | Source | Evidence it is closed |
| --- | --- | --- |
| ADR-091 status still reads `Proposed` while carrying an approval block | dev-verify-0693 P3 | `docs/00_ADR.md:1631` now reads `**Status:** Accepted · **Date:** 2026-08-27` |
| history-anatomy correct-pass prompt offers anchors the gate rejects | dev-run-0690 P2 | Commit `dcbc0d0ef` — the prompt at `config/workflows/history-anatomy.yaml:255` now names "a backticked `.md`/`.ts`/`.json` path or a `path:line` anchor", matching the gate |
| `L4.Dogfood-missing` segment regex is case-sensitive (`d7` never matches `D7`) | dev-runall-D7 F8, runall-f94 step 6 | `packages/app/src/services/feature-check.ts:580` carries the `i` flag (commit `1a2cfd75e`) |
| The `[docs-only]` evidence tag lives only in `task-verdict.ts` | dev-run-0697 F-V1 | Documented in the skill's own reference at `plugins/sp/skills/code-verification/references/verdict-schema.md:94` alongside `[advisory]`/`[non-core]`/`[non-behavior]` |
| `spur feature show F999` emits no JSON on failure | dev-verify-0693 fixed #2 | Fixed at `apps/cli/src/commands/feature.ts:60,175` (commit `6b89162e1`); re-probed live — returns `{"ok":false,"error":{...}}`. **The `check` verbs were not fixed — that residue is R1.** |
| `spur task check <wbs> --json` returns a bare array vs `--corpus`'s flat object | dev-refine-0693 P3 | Under `--json-envelope` both are wrapped correctly (`{ok,data,meta}` list vs `{ok,data}` object). The raw divergence is the deliberate byte-identity freeze ADR-091 chose |
| `spur task update --section` strips `###` with *no* `warnings[]` entry | dev-refine-0693 P2 | The claim is wrong: `planning-write-service.ts:476` populates `warnings[]` from `doc.strippedHeadings`, verified by a direct `MarkdownDocument.replaceSection` probe returning `["### Sub A","### Sub B"]`. The *destructive* half is real and is filed as R16 |

**Q: Why are the history-anatomy repetition and cost findings not R-items?** Because `0680 R5`
classifies repeated-signature and model-mix observations as report-only advisories: "nothing in this
section drives automated behavior — process changes here are human-decided only". The pi `bash`
digest `0a615b1b…` (848 repeats / 29 sessions), the claude `Edit` digest `5561ecc5…` (119 repeats),
the model-mix cost delta ($118.96 → $47.09, mix-confounded by the absent codex spend), and the
`agy-opus` reviewer `resource-exhaustion` escalations are all runner/routing behaviour outside Spur's
code. R10 and R11 *are* filed because they are defects in Spur's own analytics fold and importer
contract, not in the agents being observed.

**Q: Why does writing this task's own AC emit two DD-09 warnings?** Because `AC17` and `AC18` are not
in feature F95's scenario list — which is R9's root cause seen from the other side. DD-09 enforces
that a task's AC is a title-subset of its feature's AC, so a task doing legitimate work outside the
parent's scenarios warns on every such row. The warnings are expected and are themselves evidence
for R9; do not "fix" them by renaming this task's scenarios.

**Q: Why does `spur task check` warn that this task has 19 R-items (max 5)?** Because it does, and
the harness is right. The operator chose one task under F95 over a new feature with a decomposed
batch (2026-08-28). The size warning is the honest record of that trade, not a defect. Every R-item
is written to stand alone so an implementer can lift R3–R19 into follow-up tasks without re-deriving
context.

**Q: For R11, is the step-duration fix Spur's or the importer's?** Both are viable and the choice is
open. `history_message.duration_ms` is populated by `@gobing-ai/ts-llm-jsonl-importer@0.4.46`, so the
adapter is the natural owner. But claude and pi transcripts carry a per-message `timestamp`, so
Spur's ETL could derive an assistant step's duration as the delta from the preceding user/tool-result
record without touching the importer. **Deferred to the implementer**, with the decision to be
recorded in `### Solution`. Prefer the importer if a released fix is cheap; prefer ETL derivation if
it is not, and say which was chosen and why.

**Q: For R1, is the fix per-site or at the seam?** At the seam. The failing verbs share one shape:
a not-found branch calls `context.output.error(...)` + `setExitCode(1)` and then *falls through* to
the shared terminal `if (json) write(toEnvelopeJson(results, …))`, which serialises the empty
accumulator as a success envelope. Patching only the two `check` verbs the sweep found would leave
every sibling caller broken; 110 raw `context.output.error(` sites live in `apps/cli/src/commands`.
The enumeration in R1 is the deliverable, not a sample.

**Q: Is `--worktree` on `dev-refine` (R13) a surface expansion or a parse fix?** R13 is scoped to the
**parse fix only** — surfacing an undeclared flag instead of dropping it. Whether `dev-refine`
*should* declare `--worktree` is a `/sp:dev-*` surface change and, per ADR-051, needs explicit
operator consent with design context. **Open, owner = operator.** Do not land a surface expansion
under this task.
### Design
#### WHAT — the shape of the fix

Nineteen independent repairs across eight owner surfaces. No shared abstraction is introduced; the
only cross-cutting change is one added parameter on `writeJsonError`. Each R-item is a local edit
plus a test.

#### WHY — the common failure mode

Four of the six P1/P2 items are the same bug class: **a success signal on an unproven path**. Fixing
them individually is correct; there is no framework to build. What they justify is a bias in review —
when a gate reports success, ask what it actually proved.

#### WHERE — per-R-item change map

| R | Owner surface | Anchor | Shape of the change |
| --- | --- | --- | --- |
| R1 | `apps/cli/src/commands/*.ts` | `task.ts:1266-1269` then `:1326`; `feature.ts` check verb | Add the missing `return` after the not-found branch and route it through `writeJsonError`. Then enumerate all 68 `SHARED_OPTIONS.jsonEnvelope` verbs — a table-driven test that drives each failure path is cheaper than reading 110 `output.error(` sites |
| R2 | `packages/app/src/output/envelope.ts` | `:99-109` | Add an optional 4th param `code: ApiErrorCode = 'INTERNAL_ERROR'` and an optional `details`; strip a leading `Error: ` inside the helper (or have callers pass `err instanceof Error ? err.message : String(err)` — the helper-side strip is the smaller diff and fixes all 35 sites at once) |
| R3 | `plugins/sp/skills/spur-dev/references/execution-batch.md` | §WT-4, after §WT-3 | Insert `WT-3b — commit the batch's writes on $BRANCH before the terminal action`; make WT-4 assert `git rev-list --count $BASE_SHA..$BRANCH` is non-zero and fall to WT-5 when it is zero |
| R4 | same file | §WT-2 create/reuse, §WT-3, §WT-4/5 | (a) prescribe `bun install --frozen-lockfile --ignore-scripts` and say why (`package.json:56` `prepare: lefthook install` rewrites the *shared* `.git/hooks`); (b) wrap the create in `git branch -D "$BRANCH"` on non-zero exit, or derive a fresh short-id per attempt; (c) state that the marker is written to the **invoking** tree and have WT-6's scan say so; (d) add a DB-state disposition line to WT-4/WT-5 (replay `spur task record` into the target tree, or state explicitly that file state is authoritative and DB resync is the operator's) |
| R5 | `apps/cli/bunfig.toml` (new) | — | Add a `bunfig.toml` per workspace with `preload = ["../../tests/setup.ts"]` (which already sets `SPUR_SKIP_GLOBAL_CONFIG='true'` at `tests/setup.ts:58`). One file; proven to take 880/6 → 886/0 |
| R6 | `bunfig.toml` + `CLAUDE.md` §Verification gate | `bunfig.toml` `[test]`, `CLAUDE.md` targeted-test paragraph | Either give the iteration loop a coverage-free entrypoint (`bun test --coverage=false <file>`) and document *that* as the contract, or scope the threshold. Documenting the working command is the smaller change; verify the chosen command actually exits 0 before writing it down |
| R7 | `packages/domain/src/bdd/checklist.ts:49`, `packages/app/src/services/structural-repair.ts` | `checklist.ts:49` regex; `structural-repair.ts:22` kinds | Widen the id regex to `^\**\s*((?:AC\|R)\d+)\**` so AC boxes and bold R-items carry a `requirementId`; `flipVerifiedCheckboxes` then works unchanged. Separately add a `verified-checkbox` repair kind, or drop "R-item checkboxes" from `task.ts:1122`'s help text — do not leave the text claiming a repair that does not exist |
| R8 | `packages/app/src/services/task-check.ts` L3 | near `:865` | New L3 rule: on `done`/`cancelled`, if `### Review`'s verdict line matches `PARTIAL\|FAIL\|request-changes` while `### Testing` records PASS, emit an error naming `/sp:dev-review <wbs>` as the repair. Note task 0693 carries *both* a stale PARTIAL and a superseding PASS — the rule must read the last verdict line, or flag the contradiction outright |
| R9 | `packages/app/src/services/feature-check.ts:446,519,627-650` | DD-09 matcher | Add an explicit `covers:` alias per AC row (an AC may name the feature scenario it covers) so coverage stops depending on title mimicry, **or** have decomposition carry feature scenario titles into task AC by default. Also promote "no verdict row matches any scenario" from a `task verdict` stderr warning (`apps/cli/src/commands/task.ts:1013-1020`) to a blocking finding at the feature `done` gate, where it can actually be acted on |
| R10 | `packages/domain/src/analytics/pairings.ts` | `:43`, `:132`, `:344` | Type `totalCostUsd` as `number \| null`; drop the `COALESCE(...,0)` so an absent join yields `NULL`; keep `0` meaningful for a genuinely free dispatch. Update `render-pairings.ts:48,75,126` (the sort comparator and the `usd()` formatter both assume non-null) |
| R11 | `@gobing-ai/ts-llm-jsonl-importer` adapters, or the domain ETL | `history_message.duration_ms` | See `### Q&A` — importer-side or ETL-derived from consecutive timestamps; record the choice in `### Solution` |
| R12 | `.gitignore:184` + `packages/app/src/services/feature-check.ts:575-590` | — | Two honest options: track `docs/dogfood/*.md` so the gate reads committed evidence, or move the gate's evidence to a tracked ledger (a `dogfood:` frontmatter field or a tracked index file) and stop reading a gitignored directory. Do **not** leave a shipped gate reading untracked files |
| R13 | `plugins/sp/skills/spur-dev/SKILL.md` argument parse | model on `plugins/sp/skills/next-router/SKILL.md:55` | Import next-router's rule verbatim: "Unknown flags are not silently dropped: note them in the plan line, or stop". Optionally extend `plugins/sp/scripts/validate-flag-contracts.ts` (which gates `--agent` only) with a contract that every flag a `/sp:` command accepts appears in its `argument-hint` |
| R14 | `plugins/sp/skills/spur-dev/references/dev-operations.md` | `:239`, `:251` | Strike `--next` from §5a Inputs; delete the §5a `--next` warning bullet. Leave the H8 removal note in `dev-refineall.md:56` as the record |
| R15 | `plugins/sp/scripts/dogfood-testing/{detect-pipeline-driving,validate-report}.ts` | `:50-62`; `:41` | Add `dev-refineall`/`refineall`/`dev-verifyall`/`verifyall` to `PIPELINE_TOKENS` (note `tokenMatches` is hyphen-word exact, so `refineall` is not covered by `runall`); relax the drift exclusion to strip markdown code spans before matching, and state the exact literal cell form in `dogfood-testing/SKILL.md` §Workspace-drift guard |
| R16 | `packages/domain/src/planning/markdown-document.ts:411-427` | `stripSameLevelHeadings` | Demote `###` → `####` (legal below a task's `###` section level) instead of deleting; keep the existing `strippedHeadings` → `warnings[]` channel, reworded as "demoted" |
| R17 | `packages/app/src/services/task-check.ts:656-679` | block loop | Count R-numbered *items*, or exempt a trailing `**Out of scope`/non-goals block from the denominator. The line-count-tolerant block heuristic exists to fix the 0174 bug — keep that property |
| R18 | `packages/app/src/services/task-check.ts:1266` | advisory emit | Suppress when `frontmatter.dependencies` is non-empty, or reword to name the *unsatisfied* gate |
| R19 | four files | see R19 | (a) `spur feature sync B`; (b) delete `correctionCount` from `config/workflows/history-anatomy.yaml:76` and reword the `:234` comment to name the file as the live bound, or interpolate it; (c) make `task update --section "Q&A"` append with a timestamp header instead of replacing; (d) add a zero-task rule to `execution-batch.md` Step 1 (early-exit report shape, and whether WT-2 is skipped) plus a contract test |

#### Frozen names

Only one new public-ish name: the optional `code` (and `details`) parameter on
`writeJsonError` in `packages/app/src/output/envelope.ts`. It is module-internal — no new CLI noun,
verb, or flag — so **ADR-051 consent is not triggered**. If any R-item turns out to need a new CLI
noun/verb/flag, stop and get explicit operator consent first (this is exactly what R13's `--worktree`
question is deferred on).

#### Precedence when R-items conflict

`docs/99_PROJECT_CONSTITUTION.md` owns process; `docs/00_ADR.md` owns decisions. R2 changes what
ADR-091's compat paragraph promised — reconcile the ADR text in the same commit (T3), do not leave
the ADR describing behaviour the helper does not have.

#### Anti-patterns — do not do these

- **Do not patch only the verbs the R1 sweep names.** The sweep is a sample of a fall-through
  pattern; the deliverable is the enumeration, not the two verbs.
- **Do not "fix" the DD-09 warnings on this task's own AC** by renaming its scenarios to mimic F95's.
  That workaround is R9's disease, and three prior runs already paid for it.
- **Do not regenerate `config/corpus-baseline.json` to absorb new findings** from R7/R8/R17/R18.
  Constitution **T10**: tightening or adding a finding code obliges you to reconcile the fallout in
  the same commit. Regeneration is for accepted findings, not for silencing your own.
- **Do not widen `--worktree` to `dev-refine`** under this task (see `### Q&A`).
- **Do not touch the raw (non-enveloped) `--json` byte-identity** that ADR-091 froze; R1/R2 change
  only the `--json-envelope` branch and the fixture baseline in
  `apps/cli/tests/` must stay byte-identical on the raw path.
### Plan
**This task is now the tracking parent for the decomposition** (operator decision, 2026-08-28). Its
`### Requirements` and `### Root Cause` remain the findings register — the single place where all
nineteen root causes and their verified evidence live. Implementation happens in the four child tasks
below; 0698 closes when they do.

Grouping is by **owner-surface family**, not by severity, so each child is one coherent commit with
one test-file family and one reconciliation pass.



| Child | R-items carried | Owner surface | Why grouped |
| --- | --- | --- | --- |
| **0699** — Honest success and failure signals | R1, R2, R5, R6 | `apps/cli/src/commands/*`, `packages/app/src/output/envelope.ts`, `bunfig.toml`, `CLAUDE.md` | All four are the tool's own signal being wrong. R5/R6 are ordered first because until the suite and the exit code can be believed, nothing else in this decomposition is verifiable |
| **0700** — Corpus gates tell the truth | R7, R8, R9, R12, R17, R18, R19a | `packages/app/src/services/{task-check,feature-check,structural-repair,task-service}.ts`, `packages/domain/src/bdd/checklist.ts` | Every item moves corpus-sweep counts, and constitution **T10** binds the author to reconcile that movement in the same commit. Split four ways, the reconciliation is paid four times against a shifting baseline |
| **0701** — Harness contracts | R3, R4, R13, R14, R15, R16, R19c, R19d | `plugins/sp/skills/spur-dev/references/*`, `plugins/sp/commands/*`, `plugins/sp/scripts/dogfood-testing/*`, `packages/domain/src/planning/markdown-document.ts` | One contract layer. The spec, the command file, the glossary and the validator currently disagree in four places — which is only visible while holding all of them |
| **0702** — History analytics telemetry honesty | R10, R11, R19b | `packages/domain/src/analytics/{pairings,render-pairings,forensic-query,derived}.ts`, `@gobing-ai/ts-llm-jsonl-importer`, `config/workflows/history-anatomy.yaml` | Both R10 and R11 violate the same `0680 R6` contract — absence must render `not available`, never zero — in two folds of one plane, verified from one pinned artifact |

**Ordering.** No hard dependencies: the four touch disjoint files and can run in parallel. There is
one soft ordering preference — 0699 R3 (the missing `apps/cli/bunfig.toml`) makes per-workspace
`bun test` trustworthy, which every other child benefits from while verifying. Root `bun run test` is
already green, so nothing is *blocked*; 0699 first is a convenience, not a gate.

**Three decisions deliberately left open**, each recorded in the owning child's `### Q&A` and to be
resolved in its `### Solution`:

1. **0699 R4** — document a coverage-free iterate command, or scope the coverage threshold.
2. **0700 R2 / R4** — two-verdict Review semantics (read the last line vs flag the contradiction); and
   track `docs/dogfood/*.md` vs move the gate to a tracked ledger.
3. **0702 R2** — attribute assistant-step duration in the importer, or derive it in the domain ETL.

One decision is **operator-owned and out of scope for every child**: whether `/sp:dev-refine` should
declare `--worktree`. That is a public `/sp:dev-*` surface expansion and ADR-051 (amended 2026-08-20)
requires explicit operator consent with design context. 0701 R3 fixes only the parse behaviour —
surface an undeclared flag rather than dropping it.

**Parent close-out.** 0698 transitions when all four children are `done` and a corpus sweep confirms
that its own 17 × `L4.uncovered-task-scenario` and 3 × `L4.gate-language` warnings have cleared
**without 0698 being edited** — that is 0700's AC9, and it is the parent's own regression fixture.

<!-- AUTO-GENERATED by spur task refresh-roster -->
| WBS | Sub-task | Status |
| --- | -------- | ------ |
| 0699 | Honest success and failure signals: close the --json-envelope failure surface and repair the developer test loop | todo |
| 0700 | Corpus gates tell the truth: checkbox flip, Review reconciliation, scenario coverage, and three misfiring signals | todo |
| 0701 | Harness contracts: worktree lifecycle safety and /sp:dev-* specification drift | todo |
| 0702 | History analytics telemetry honesty: pairing cost absence and assistant-step duration attribution | todo |
<!-- END AUTO-GENERATED -->
### Root Cause
Every claim below was reproduced against `HEAD` (`dad078ad5`) on 2026-08-28. Commands are literal and
runnable from the repo root.

**R1 — the envelope reports success on a failure path.** The not-found branch at
`apps/cli/src/commands/task.ts:1266-1269` calls `context.output.error(...)` and `setExitCode(1)` but
does **not** `return`; control falls through to the shared terminal emit at `:1326`
(`toEnvelopeJson(results, { enveloped, kind: 'list' })`), which serialises the empty accumulator as a
success envelope. Reproduced:

```
$ bun run apps/cli/src/index.ts task check 9999 --json --json-envelope
{ "ok": true, "data": [], "meta": { "hasMore": false, "limit": 1 } }   # exit 1
$ bun run apps/cli/src/index.ts feature check F999 --json --json-envelope
Feature F999 not found                                                 # stderr
{ "ok": true, "data": [], "meta": { "hasMore": false, "limit": 1 } }   # exit 1
```

A ten-verb sweep of not-found probes: `task show` and `feature show` are correct (`ok:false`);
`task check` and `feature check` emit `ok:true`; `task path`, `task resolve`, `rule show`,
`workflow show`, `agent show` emit **no JSON at all**. Surface size: 68 verbs declare
`SHARED_OPTIONS.jsonEnvelope`, 39 call `writeJsonError`, and 110 raw `context.output.error(` calls
live in `apps/cli/src/commands`.

**R2 — `writeJsonError` cannot express a code.** `packages/app/src/output/envelope.ts:99-109` is
three statements: `if (options.json && envelopeEnabled(...)) { output.write(toEnvelopeError('INTERNAL_ERROR', message)); return; } output.error(message);`. `toEnvelopeError` at `:86` *does*
accept `details`, but the helper never passes any. Thirty-five sites pass `String(err)`, so:
`{"ok":false,"error":{"code":"INTERNAL_ERROR","message":"Error: Task 9999 not found in any registered task folder"}}`.
`docs/00_ADR.md:1708` promises "CLI-local codes collapse to `INTERNAL_ERROR` with `details.cliCode`";
only hand-rolled sites (`history.ts:80,101,129`, `builder.ts:56,108`, `message.ts:55`) honour it.

**R3 — the worktree lifecycle never commits.** `plugins/sp/skills/spur-dev/references/execution-batch.md`
WT-1 (dirty-tree precheck), WT-2 (create/adopt), WT-3 (marker), WT-4 (FF-merge), WT-5 (retain),
WT-6 (`--continue`), WT-7 (exclusions) — no commit step in any of them. WT-4's create-mode block is
`git checkout "$BASE_REF"; git merge --ff-only "$BRANCH"; git worktree remove …; git branch -d …`.
On a branch with zero commits the merge succeeds ("Already up to date") and the next two lines delete
the only copy of the work. The 2026-08-27 refineall run hit this and only survived because the driver
hand-committed `4e0e826af` before merging.

**R4 — worktree setup leaks into the main tree.** `package.json:56` is `"prepare": "lefthook install"`.
Worktrees share the main tree's `.git`, and WT-2 prescribes bare `bun install --frozen-lockfile`, so
installing deps inside an "isolated" worktree rewrites the operator's main-repo hooks. Separately,
`git worktree add -b` creates the branch before the directory, so a create failure leaves a dangling
branch and the natural retry dies on `a branch named … already exists`. WT-3 says the marker lives
"under `.spur/run/`" without naming a tree, and WT-4/WT-5 say nothing about the worktree's own `.spur`
DB, which is deleted with the tree.

**R5 — `apps/cli` is red on a clean tree.** Proven both ways:

```
$ cd apps/cli && bun test                            #  880 pass /  6 fail
$ cd apps/cli && SPUR_SKIP_GLOBAL_CONFIG=true bun test #  886 pass /  0 fail
```

Failing: 4 × workflow list/run, 2 × agent-team role/executor. The assertion:
`agent-team.test.ts:296` expects `capable-exec` and receives
`alpha-reviewer-1  antigravity-cli  reviewer  agy-opus  antigravity-cli agent` — `agy-opus` comes
from the operator's `~/.config/spur/config.yaml:161`, not the test's temp fixture. Root cause:
`packages/config/src/loader.ts` deep-merges the global and project layers **by design**, and
`tests/setup.ts:58` sets `SPUR_SKIP_GLOBAL_CONFIG='true'` — but that preload is registered only in the
**root** `bunfig.toml`, and `apps/cli` has no `bunfig.toml` of its own.

**R6 — the documented targeted-test loop exits 1 on a green test.**

```
$ bun test apps/cli/tests/commands/agent-team.test.ts --test-name-pattern "role and executor"
 1 pass
 0 fail
$ echo $?
1
```

`bunfig.toml` `[test] coverage = true` with `coverageThreshold = { lines = 0.9, functions = 0.9 }`
applies the repo-wide denominator to a single-file run. `CLAUDE.md` prescribes exactly this command
as the iterate loop.

**R7 — AC boxes are invisible to the flip.** `packages/domain/src/bdd/checklist.ts:49` is
`rawText.match(/^(R\d+)\s*[:\-—]?\s*(.*)$/)` — only bare `R\d+`. `flipVerifiedCheckboxes`
(`packages/app/src/services/task-record.ts:212`) skips any item whose `requirementId` is `undefined`,
so `- [ ] AC1. …` never flips and `- [ ] **R1.** …` never flips — even though `task-check.ts:667`'s
format gate explicitly accepts the bold spelling. `structural-repair.ts:22` declares kinds
`heading-level | section-order | missing-section | requirement-checkbox`; the last only *adds* a
`[ ]` marker (`:298`). Scale: `config/corpus-baseline.json` carries 158 accepted
`L3.unchecked-checklist` entries and 267 `L3.requirements-checkbox`.

**R8 — no gate reads the Review verdict.** `grep -rn "request-changes" packages/app/src packages/config/src`
returns nothing. `docs/tasks4/0693_….md:272` reads `**Verdict: PARTIAL — request-changes**` and
`:315` reads `**Verdict: PASS** … Supersedes the PARTIAL — request-changes above` — both present on a
`done` task. `task-service.ts:1147` backfills Review only `if (sectionIsBare(doc, 'Review'))`.

**R9 — DD-09 matches titles.** `packages/app/src/services/feature-check.ts:446` ("A scenario is
'covered' by a task when DD-09 normalized-title matching…"), `:519` and `:627-650`. F95's scenarios
are `R1 — The envelope decision is recorded as an ADR`, `R2 — The current shapes are inventoried per
noun`, `R3 — Implementation follows the approved ADR`; 0693's AC are `AC1`–`AC4`. Nothing matches, so
all three report `L4.uncovered-feature-scenario` on a `done`, linked, shipped task; the same warning
is re-emitted by `apps/cli/src/commands/task.ts:1013-1020` on every `task verdict` derivation.

**R10 — cost absence is unrepresentable.** `packages/domain/src/analytics/pairings.ts:43`
(`totalCostUsd: number`), `:132` (`totalCostUsd: 0`), `:344` (`COALESCE(SUM(h.cost_usd), 0)`). Live
over 2026-08-27→28: `agy-opus`/coder 0, `agy-opus`/reviewer **16 dispatches → 0**, `claude`/reviewer 0,
`pi-deepseek`/reviewer 9.59, `pi-dsv4-flash-volc`/coder 0, `pi-k3`/reviewer 0.67.

**R11 — duration is unmeasured for four of six sources.** Live `stepSupport` over the same window:

| source | assistantSteps | withUsage | withDuration |
| --- | --- | --- | --- |
| agy | 356 | 0 | **0** |
| claude | 7,583 | 7,583 | **0** |
| codex | 1,396 | 997 | **0** |
| grok | 3,889 | 24 | 774 |
| omp | 1,588 | 1,588 | 1,588 |
| pi | 3,650 | 3,650 | **0** |

`packages/domain/src/analytics/forensic-query.ts:752` reads `SUM(m.duration_ms IS NOT NULL)`;
`history_message.duration_ms` is written by `@gobing-ai/ts-llm-jsonl-importer@0.4.46`.

**R12 — the dogfood gate reads gitignored files.** `.gitignore:184` = `/docs/dogfood/*`;
`git ls-files docs/dogfood | wc -l` = **5**; `ls docs/dogfood | wc -l` = **84**.
`packages/app/src/services/feature-check.ts:575-585` scans that directory for a filename segment
matching the feature id. Forty-one features currently satisfy the gate from an on-disk report; at
most five would survive a fresh clone.

**R13 — no unknown-flag policy.** `plugins/sp/commands/dev-refine.md:4` argument-hint:
`"<wbs> [--focus <mode>] [--description <text>] [--depth <standard|ready>] [--agent <inline|auto|name>] [--auto] [--next]"`
— no `--worktree`. `plugins/sp/skills/spur-dev/references/flag-glossary.md:377,406-410` scopes the
flag to `dev-refineall`/`dev-runall`/`dev-verifyall`/`dev-run`. `grep -rn "[Uu]nknown flag" plugins/sp`
returns exactly one hit: `plugins/sp/skills/next-router/SKILL.md:55`.

**R14 — SSOT contradicts the command.** `dev-operations.md:239` lists `--next` under §5a "Shared
refine flags"; `:251` is a `**--next` warning:**` bullet explaining how it chains.
`plugins/sp/commands/dev-refineall.md:56` reads `> **`--next` dropped** (feature H8, 2026-07-31)` and
its `argument-hint` omits the flag.

**R15 — driver gates.** `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:50-62`
`PIPELINE_TOKENS = ['--next','dev-runall','dev-wrapall','dev-run','dev-wrap','dev-idea','runall','wrapall','run','wrap','idea']`;
`tokenMatches` at `:119-125` uses `(?<![\w-])…(?![\w-])`, so `dev-refineall` matches none of them.
`validate-report.ts:41` filters `!/^\|\s*drift:/` while `dogfood-testing/SKILL.md:159,218,418`
prescribes the code-span form `` `drift:external` ``.

**R16 — headings are deleted, warned about, and lost.** Direct probe of
`MarkdownDocument.replaceSection` with a body containing `### Sub A` / `### Sub B`:

```
strippedHeadings: ["### Sub A","### Sub B"]
--- body ---            (both headings gone; prose retained)
```

`packages/domain/src/planning/markdown-document.ts:411-427` strips them;
`packages/app/src/services/planning-write-service.ts:476` does turn them into `warnings[]`, which
`apps/cli/src/commands/task.ts:364` prints — but only on the **non-`--json`** branch, to stderr.

**R17 — block heuristic vs the implement-ready checklist.** `packages/app/src/services/task-check.ts:656-671`
splits on `/\n\s*\n/` and warns when `numbered < blocks.length * 0.5`. Four contiguous R-item lines
are one block; the two non-goals prose blocks `--depth ready` requires make it 1 numbered of 3.

**R18 — advisory ignores the remedy it demands.** `packages/app/src/services/task-check.ts:1266`:
`` `${section} contains gate language; model the gate as a frontmatter dependency or verify it before treating the task as ready` `` — emitted with no read of `frontmatter.dependencies`. Task 0694 carries
`dependencies: [0691]` and warns on both Design and Plan.

**R19 — the four small ones.** (a) `docs/features/B_agent-execution.md:25-27` is
`<!-- AUTO-GENERATED … -->\n_No linked tasks._\n<!-- END AUTO-GENERATED -->` while 0687, 0689 and 0690
all carry `feature_id: B`; a sweep of all 117 features with an auto-generated block finds this is the
**only** stale roster. (b) `config/workflows/history-anatomy.yaml:76` declares `correctionCount: "0"`;
`grep -n 'vars\.correctionCount'` on that file returns one hit — a prose comment at `:234` — and no
interpolation. (c) `task update --section` routes to `MarkdownDocument.replaceSection`, so `### Q&A`
is overwritten. (d) `execution-batch.md:414` lists `aborted (cycle or selector error before any run)`;
`dev-operations.md` §5a lists `aborted (cycle / unknown selector / empty set after filter)`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
**Verification baseline.** All claims re-checked at `HEAD` = `dad078ad5` on 2026-08-28.

**Source reports (all in `docs/`, `docs/dogfood/*` is gitignored — see R12).**

- `docs/dogfood/2026-08-27-dev-refine-0693-dogfood.md` — R13, R16, R17, R15(b)
- `docs/dogfood/2026-08-27-dev-run-0690-dogfood.md` — R4(d)
- `docs/dogfood/2026-08-27-dev-run-0697-dogfood.md` — R1 family
- `docs/dogfood/2026-08-27-dev-runall-f94-inline-dogfood.md` — R7, R9, R19
- `docs/dogfood/2026-08-27-dev-runall-feature-b-dogfood.md` — R19(a), R19(d)
- `docs/dogfood/2026-08-27-dev-runall-feature-D7-dogfood.md` — R12
- `docs/dogfood/2026-08-27-dev-verify-0693-dogfood.md` — R1, R2, R5, R7, R8, R9, R12
- `docs/dogfood/2026-08-27-sp-dev-refineall-f94-dogfood.md` — R3, R4, R14, R15(a), R18
- `docs/dogfood/2026-08-27-sp-dev-run-0689-dogfood.md` — context only
- `docs/dogfood/2026-08-27-sp-dev-run-0693-worktree-dogfood.md` — R1, R19(c)
- `docs/dogfood/2026-08-27-sp-dev-verify-0687-dogfood.md` — R6
- `docs/report/2026-08-27-history-anatomy.md` — R10, R11
- `docs/report/2026-08-28-history-anatomy.md` — R10, R11

**Authority documents.**

- `docs/00_ADR.md` ADR-091 (`:1629-1710`) — the envelope decision R1/R2 must stay consistent with;
  its compat paragraph at `:1664` and `:1708` is what R2 corrects.
- `docs/00_ADR.md` ADR-090 — the single-sided corpus baseline gate; constrains how R7/R8/R17/R18
  fallout may be handled.
- `docs/00_ADR.md` ADR-051 (amended 2026-08-20) — the four-surface rule and the public-CLI consent
  gate that R13's deferred `--worktree` question turns on.
- `docs/99_PROJECT_CONSTITUTION.md` **T3** (surface code + `docs/04_DESIGN.md` same commit),
  **T10** (a tightened finding code obliges same-commit reconciliation), **T11** (the corpus sweep is
  a commit gate, not a per-edit diagnostic).
- `docs/04_DESIGN.md` §4.1 — the 102-verb `--json` ledger R1's enumeration must keep truthful.

**Primary code anchors.**

- `packages/app/src/output/envelope.ts:86,99-109` — `toEnvelopeError`, `writeJsonError`
- `apps/cli/src/commands/task.ts:1266-1269,1326,1122,1013-1020` — check fall-through, terminal emit,
  `--fix` help text, verdict scenario warning
- `packages/domain/src/bdd/checklist.ts:27-67` — `parseChecklist`
- `packages/app/src/services/task-record.ts:173-221` — `prefixId`, `flipVerifiedCheckboxes`
- `packages/app/src/services/structural-repair.ts:22,266-300` — repair kinds, checkbox repair
- `packages/app/src/services/task-check.ts:656-679,865,1266` — requirements format, unchecked
  checklist, gate-language advisory
- `packages/app/src/services/feature-check.ts:446,519,575-590,627-650` — DD-09 matching, dogfood gate
- `packages/app/src/services/task-service.ts:1147,1161-1172` — Review backfill, checkbox flip caller
- `packages/domain/src/planning/markdown-document.ts:411-427` — `stripSameLevelHeadings`
- `packages/app/src/services/planning-write-service.ts:476-494` — `warnings[]` from stripped headings
- `packages/domain/src/analytics/pairings.ts:43,132,344` — pairing cost fold
- `packages/domain/src/analytics/render-pairings.ts:48,75,126` — consumers of `totalCostUsd`
- `packages/domain/src/analytics/forensic-query.ts:741-760` — `stepSupport`
- `packages/config/src/loader.ts:146-230` — layered config merge (R5's mechanism, working as designed)
- `bunfig.toml` `[test]`; `tests/setup.ts:58`; `package.json:56`; `.gitignore:184`

**Plugin and workflow anchors.**

- `plugins/sp/skills/spur-dev/references/execution-batch.md` §WT-1…WT-7, Step 1
- `plugins/sp/skills/spur-dev/references/dev-operations.md` §5a (`:239`, `:251`)
- `plugins/sp/skills/spur-dev/references/flag-glossary.md:377,406-410`
- `plugins/sp/commands/dev-refine.md:4`, `plugins/sp/commands/dev-refineall.md:56`
- `plugins/sp/skills/next-router/SKILL.md:55` — the unknown-flag rule to import
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:50-62,119-137`
- `plugins/sp/scripts/dogfood-testing/validate-report.ts:39-41`
- `plugins/sp/skills/dogfood-testing/SKILL.md:159,218,418`
- `plugins/sp/scripts/validate-flag-contracts.ts`
- `config/workflows/history-anatomy.yaml:76,234`

**Commits consulted for the drop list.** `dcbc0d0ef` (correct-pass prompt), `1a2cfd75e`
(case-insensitive feature-id match), `6b89162e1` (feature not-found envelope), `cee844c45`
(anchor-drift + verified-box auto-flip), `791dc9c94` (envelope adoption), `9043d390c` / `7dcddadbb` /
`33e642f42` (0697 service-layer envelope seam).
### History
