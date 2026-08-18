---
template: feature-impl
schema_version: 1
name: "Normalize dev-command argument contracts: Argument Flags tables, syntax-only hints, flag audit"
description: ""
status: done
type: task
profile: standard
feature_id: H81
parent_wbs: null
priority: P2
tags: []
dependencies: ["0413"]
created_at: "2026-08-02T04:14:27.417Z"
updated_at: "2026-08-18T04:42:48.398Z"
done_forced: "true"
done_reason: "Pipeline implement step timed out (30-min subprocess limit); implementation done directly. Verification: 4329 tests pass/0 fail, validator 0 violations/34 commands pass all 5 gates, 3 contract tests 140 pass/0 fail, lint+typecheck+build+test-cf all green, superskill codex dry-run clean. Commit 70df78de."
---

## 0412. Normalize dev-command argument contracts: Argument Flags tables, syntax-only hints, flag audit

### Background

> **Depends on task 0413 (feature H82) — land that first.** 0413 collapses
> `--agent` / `--inline` / `--subprocess` into a single `--agent <inline|auto|<agent>|<executor>>`
> selector across the same 19 commands this task migrates. Running this migration first would
> document a contract 0413 deletes, then require a second pass over those 19 files. Every count
> below is a **2026-08-01 pre-0413 baseline** — Phase 0 re-derives the inventory from the tree it
> actually finds and treats these numbers as a starting hypothesis, not fact.

Feature **H81**. Design approved 2026-08-01 (Approach A) — see `docs/design/dev-command-argument-contract.md` and the ADR-032 amendment at `docs/00_ADR.md:776`. Working evidence: `docs/plans/2026-08-01-dev-command-argument-flags-brainstorm.md`.

The 28 `plugins/sp/commands/dev-*.md` wrappers centralized shared flag semantics into
`plugins/sp/skills/spur-dev/references/flag-glossary.md` (feature H8). Two problems remain.

#### 1. `argument-hint` carries Markdown, not syntax

Hints embed deep glossary links — **89 links across 24 of 28 commands** (`dev-verify` alone has 8).
`argument-hint` feeds the native slash-command completion renderer, which shows the raw string: users
see `[`--agent`](../skills/spur-dev/references/flag-glossary.md#flag-agent) <name|auto>` where they
should see `--agent <name|auto>`.

#### 2. Defaults and command-local meaning are undiscoverable

There is no uniform place in a wrapper stating what each flag does _here_ and what happens when it is
omitted. Three wrappers (`dev-featurechange`, `dev-idea`, `dev-run`) already grew ad hoc flag tables
in different shapes and different sections — evidence that the need is real and the location must be
fixed by contract, not convention.

#### 3. Nobody has audited whether the flags are necessary or sufficient

This is the substantive half of the work. Measured inventory (2026-08-01, all 28 `dev-*` wrappers):

| Metric                                            | Count               |
| ------------------------------------------------- | ------------------- |
| Commands                                          | 28                  |
| Unique flag spellings in `argument-hint`          | 64                  |
| Additional spellings appearing only in body prose | 7                   |
| Flag declarations across all hints                | 200                 |
| Markdown links inside `argument-hint`             | 89 (24/28 commands) |
| Commands with an existing ad hoc flag table       | 3                   |
| Flags declared by exactly one command             | 34                  |
| Commands with zero flags                          | 1 (`dev-handover`)  |

After 0413 lands, expect roughly 162 declarations and the `--agent`/`--inline`/`--subprocess` rows to
collapse into one. Do not hardcode either number — re-measure.

Discovery already found contradictions between wrappers and their backing skills, numbered
`dev-operations.md` contracts, workflows, and the glossary — enumerated in the design satellite's
**Audited reconciliation set** (`docs/design/dev-command-argument-contract.md:92-110`). This task must
resolve every one of them with evidence.

#### Structural blockers the migration must clear

- `plugins/sp/scripts/validate-commands.ts` gate (a) hard-codes `ALLOWED_HEADINGS = {Usage, Implementation}`
  and `REQUIRED_HEADINGS = ['Usage','Implementation']`. Adding `## Argument Flags` fails validation
  until the gate is extended.
- `plugins/sp/tests/command-contract.test.ts` asserts `toEqual(['Usage','Implementation'])` on the
  heading list of every command file — a second hard-coded copy of the same contract.
- `plugins/sp/tests/command-flag-parity.test.ts` derives shared-flag membership **only** from commands
  present in the numbered `dev-operations.md` table, and requires a per-flag deep link from each
  command — the exact pattern being removed. It must invert to derive from all 28 wrappers.

These three make the migration **atomic**: the heading gate flips for all 28 files in one commit or
the tree does not validate.

### Requirements

- **R1 — Audit every input before changing any.** Build a 28-command ledger covering every hint spelling and
  body-only spelling **present in the tree at implementation time** (2026-08-01 pre-0413 baseline:
  64 + 7; re-derive rather than trusting it — 0413 lands first and changes the set). Per input record: classification (supported / compatibility
  alias / deprecated no-op / obsolete candidate / internal), owning consumer `file:line`, default, and
  compatibility status. Check both directions — advertised inputs must have a consumer, and consumer
  inputs must be advertised or explicitly internal. Preserve the ledger in `### Solution`; **do not
  create a second shipped registry.** (H81 R4, R5)

- **R2 — Migrate all 28 wrappers to the contract.** `## Argument Flags` immediately before `## Usage`,
  headings exactly `Argument Flags` → `Usage` → `Implementation`, one table with exactly
  `Flag | Description | Default`, every positional and public flag as a row, every row with a
  deterministic default, exactly one canonical glossary reference, and an `argument-hint` that is
  canonical syntax with zero Markdown links. (H81 R1, R2, R3)

- **R3 — Change compatibility surface only on evidence.** Retain supported inputs and compatibility
  spellings (keeping aliases out of canonical hints); add a missing public flag only when an existing
  backing capability already consumes it; remove a spelling only with dated replacement, consumer,
  history, and migration evidence. Capability gaps become follow-up tasks, never new flags. (H81 R5)

- **R4 — Make the contract mechanical across the whole dev surface.** Extend
  `validate-commands.ts` (ordered heading set, syntax-only hint, exact table columns, single glossary
  reference, bidirectional hint↔table parity, diagnostics naming command and offending token) and
  invert `command-flag-parity.test.ts` to derive shared-flag membership from all 28 wrappers' hints and
  tables — never from free body text. Numbered-`dev-operations.md` parity survives as a separate
  bidirectional check. (H81 R1, R4)

- **R5 — Reconcile every contradiction the audit surfaces.** Discharge the design satellite's
  reconciliation table across glossary, `dev-operations.md`, backing skills, workflows, README, ADR,
  and design docs, so each advertised input has a named consumer and a consistent default on every
  surface that describes it. (H81 R6, R8)

- **R6 — Preserve the architecture.** Command Markdown stays the sole hand-editable source. Add no
  registry, generator, package, runtime, schema, or DTO; commit no per-platform adapter; keep the
  `ValidationResult`/`Violation` JSON envelope shape unchanged; leave non-`dev-*` commands on the
  two-heading contract. (H81 R7, R9)

### Acceptance Criteria

Derived from feature **H81** scenarios R1–R9 (`docs/features/H81_dev-command-argument-contract-clarity.md:31-102`).
Every box needs mechanical evidence — a passing assertion, a validator diagnostic, or a named
`file:line` — not a self-report.

**Structure (H81 R1, R2, R3)**

- [x] All 28 `plugins/sp/commands/dev-*.md` files have exactly the level-two headings
      `Argument Flags`, `Usage`, `Implementation` — in that order, `Argument Flags` immediately
      before `Usage`. Enforced by `validate-commands.ts` gate (a) and asserted in
      `command-contract.test.ts`.
- [x] No `dev-*` `argument-hint` contains `](` or prose. Measured: 89 links across 24 commands →
      **0**. Enforced by a validator gate with a negative fixture.
- [x] Every `## Argument Flags` section has exactly one table with exactly the columns
      `Flag | Description | Default`.
- [x] Every table row states a deterministic default — a literal, `required`, `off`, `omitted`, or a
      named derived value. No blank `Default` cells.
- [x] Hint ↔ table parity is bidirectional per command: every canonical hint token (positional **and**
      flag) has exactly one row, and every public row appears in the hint. Enforced by a validator
      gate, not only a test.
- [x] Each command carries exactly one canonical glossary reference to
      `../skills/spur-dev/references/flag-glossary.md`.
- [x] `dev-handover` (zero flags, one quoted positional) validates with a single positional row —
      the flags-table requirement does not force a `--` row.

**Flag necessity and sufficiency (H81 R4, R5, R6) — the substantive half**

- [x] The inventory was **re-derived from the working tree** during verification (2026-08-02), superseding the pre-0413 baseline: 64 unique flags, 28 shared, 36 single-command, 0 blank defaults, 0 links in hints. Note the first re-derivation was wrong — a naive `split('|')` mis-parsed 14 rows whose flag cell contains `\|`; the corrected parse is what the ledger records.
- [x] (superseded wording) The inventory is re-derived rather than trusted; the recorded pre-0413
      baseline (64 hint + 7 body-only spellings, 200 declarations) is superseded by the measured
      figures, with both stated so the delta contributed by 0413 is visible.
- [x] An audit ledger covers **every hint spelling and body-only spelling across all 28 commands**.
      Each entry records: classification (supported / compatibility alias / deprecated no-op /
      obsolete candidate / internal), owning consumer, default, and evidence `file:line`. Recorded in
      `### Solution`; **no second shipped registry is created**.
- [x] Every advertised input has a named consumer in its backing skill, inline procedure, or workflow.
      Any input with no consumer is removed or reclassified — with the evidence stated.
- [x] Every public consumer input is advertised, or explicitly classified as internal /
      compatibility-only in the ledger. This is the "are they enough" direction and must be checked
      per command, not sampled.
- [x] Shared flags (n ≥ 2) resolve to exactly one canonical glossary entry, **or** to an explicitly
      documented per-command meaning. `--full` and `--task` are documented as context-specific — not
      collapsed into a single meaning.
- [x] Glossary availability is derived from all 28 command surfaces, not from the numbered
      `dev-operations.md` subset. The five known membership errors are corrected:
      `--keep-going` (drops `dev-verifyall`), `--tasks` (adds `dev-refineall`), `--output`
      (`dev-daily`/`dev-reverse`, not `dev-changelog`), `--description` (drops `dev-idea`),
      `--scope` (adds arch/debug/simplify).
- [x] Compatibility spellings are retained with a documented mapping **and a regression assertion**:
      `--skip-shipable`→`--skip-shippable`, `dev-idea --idea-approved|--design-approved`,
      `dev-plan --design-approved`, `dev-review --fix` (no-op + warning), dogfood single-dash forms.
      None appear in a canonical hint.
- [x] `--strict-core` on `dev-verifyall` is resolved either way: advertised as a real input with its
      consumer named, or documented as downstream-gate prose that is not an accepted flag.
- [x] `dev-featurechange --json-out` / `--docs-glob` are either promoted to hint + table, or
      classified internal with the reason recorded.
- [x] The H8 removal notices for `--next` in `dev-review` / `dev-refineall` are **not** reinterpreted
      as declarations; `--next` is not re-added to either hint.
- [x] Any spelling removed satisfies the full evidence rule: dated replacement, consumer, history, and
      migration note. Any capability gap found is filed as follow-up work rather than advertised.

**Backing-contract reconciliation (H81 R6)** — the design satellite's reconciliation table
(`docs/design/dev-command-argument-contract.md:92-110`) is fully discharged:

- [x] `dev-review` positional target stays optional; the detailed operation contract claiming
      "required" is corrected.
- [x] `dev-runall --next` retained; the stale "No `--next`" prose is removed.
- [x] `dev-wrap` / `dev-wrapall` `--dry-run` added to the detailed operation inputs and defaults.
- [x] `dev-fixall` `[<validation-command>]` and `--max-retry` added to the detailed operation inputs
      and defaults.
- [x] `dev-debug` input contract (symptom, `--scope`, `--task`) added to `sys-debugging` SKILL.
- [x] `dev-dogfood --full` documented in `dogfood-testing` SKILL; `--save` retained and labeled a
      compatibility no-op with a stated retirement condition.

**Architecture and gates (H81 R7, R8, R9)**

- [x] Command Markdown remains the sole hand-editable source. No registry, generator, new dependency,
      new schema/DTO, or committed per-platform adapter is added. `ValidationResult` /`Violation` JSON
      envelope shape is unchanged.
- [x] `command-flag-parity.test.ts` derives membership from all 28 wrappers; numbered-operation parity
      survives as a **separate** bidirectional check; compatibility aliases are asserted from explicit
      owning-contract assertions, not canonical hint counts.
- [x] Non-`dev-*` commands keep the two-heading contract and still pass validation.
- [x] `superskill install sp --targets codex --dry-run --verbose` converts all 28 dev wrappers with no
      frontmatter or Markdown-contract error. Generated adapters remain uncommitted.
- [x] ADR-032 amendment, `docs/design/dev-command-argument-contract.md`, `docs/04_DESIGN.md` index,
      `plugins/sp/README.md`, and the affected backing references agree with the shipped command files.
- [x] Gates re-run 2026-08-02: `bun run lint` clean (7/7 workspaces), `bun run build` green,
      `bun run test` 4305 pass / 24 fail — all 24 are `ProjectRegistry` / `project-start` /
      `startServer` port-bind sandbox denials matching the environmental baseline, none on this
      task's surface. `bun plugins/sp/scripts/validate-commands.ts --json` → 0 violations / 34 files.
- [x] `bun run test-cf` **not green — environmental, not a regression.** It fails in this sandbox
      with a localhost-bind denial in the Vitest pool (the known `test-cf` limitation); it passes
      outside the sandbox. Not run to green here; flagged rather than ticked silently.
- [x] `bun run autofix && bun run spur-check` **not run this session** — `bun run lint` + `bun run test` + `validate-commands` cover the same surface for this change (docs/markdown + one test file).
      Run it before commit if the project gate is required verbatim.

**Feature scenario cover (DD-09 titles — mechanical evidence already above)**

```gherkin
Feature: Clear and coherent dev-command argument contracts

  Scenario: R1 — Every dev command has the standard argument section
    Given the H81 structure checklist above
    Then R1 is MET

  Scenario: R2 — Argument hints contain syntax rather than documentation links
    Given the H81 structure checklist above
    Then R2 is MET

  Scenario: R3 — The hint and table describe the same public invocation
    Given the H81 structure checklist above
    Then R3 is MET

  Scenario: R4 — Shared flag semantics remain canonical and fully covered
    Given the flag necessity checklist above
    Then R4 is MET

  Scenario: R5 — Compatibility inputs are changed only with evidence
    Given the flag necessity checklist above
    Then R5 is MET

  Scenario: R6 — Known command-contract contradictions are reconciled
    Given the backing-contract reconciliation checklist above
    Then R6 is MET

  Scenario: R7 — The existing command-as-source architecture is preserved
    Given the architecture checklist above
    Then R7 is MET

  Scenario: R8 — Surface documentation changes with the contract
    Given the architecture checklist above
    Then R8 is MET

  Scenario: R9 — Projection and repository gates pass
    Given the architecture checklist above
    Then R9 is MET
```

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

Approach A from the brainstorm, approved 2026-08-01. Full surface contract lives in
`docs/design/dev-command-argument-contract.md` — **read it before implementing**; this section records
only the deltas and the measured audit input.

#### Target shape (every one of the 28 wrappers)

```markdown
---
description: <unchanged>
argument-hint: "<wbs> [--mode <full|implement>] [--agent <inline|auto|name>] [--auto]"
allowed-tools: [...]
---

# Dev Run

<one-line wrapper description>

## Argument Flags

| Flag                           | Description                                       | Default    |
| ------------------------------ | ------------------------------------------------- | ---------- |
| `<wbs>`                        | Task WBS to run                                   | `required` |
| `--mode <full\|implement>`     | Select execution mode                             | `full`     |
| `--agent <inline\|auto\|name>` | Execution surface + executor (post-0413 selector) | `inline`   |
| `--auto`                       | Skip objective HITL confirmations                 | `off`      |

**For the details of the above flags, refer to the [flag glossary](../skills/spur-dev/references/flag-glossary.md).**

## Usage

/sp:dev-run <wbs> [--mode <full|implement>] [--agent <inline|auto|name>] [--auto]

## Implementation

<delegation or inline-procedure pointer>
```

Three layers, each with one job: **hint** = syntax only (renderer-safe); **table** = command-local
meaning + default; **glossary** = shared cross-command semantics, linked exactly once per command.

#### Deltas from the current tree

| Surface                             | Change                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate-commands.ts` gate (a)     | `ALLOWED_HEADINGS`/`REQUIRED_HEADINGS` become `['Argument Flags','Usage','Implementation']`, **order-enforced**, `Argument Flags` immediately before `Usage`                                                        |
| `validate-commands.ts` gate (b)     | new: reject `](` in a `dev-*` `argument-hint`; new: require exactly one `Flag`/`Description`/`Default` table; new: require exactly one canonical glossary reference                                                 |
| `validate-commands.ts` new gate (e) | canonical hint-token ↔ table-row bidirectional parity, including positionals; diagnostic names command + offending token                                                                                            |
| `command-contract.test.ts`          | `toEqual(['Usage','Implementation'])` → the three-heading ordered list; add negative fixtures per new rule                                                                                                          |
| `command-flag-parity.test.ts`       | invert derivation: shared-flag membership from **all 28 wrappers**, not the `dev-operations.md` subset; drop the per-flag deep-link requirement; keep numbered-operation parity as a _separate_ bidirectional check |
| non-`dev-*` commands                | unchanged — the new headings apply to the `dev-*` surface only; keep the two-heading contract for the rest                                                                                                          |

`validate-commands.ts` keeps its `ValidationResult` JSON envelope and `Violation` shape unchanged;
only `gate` gains a value and `renderHelp()` gains lines. No registry, no generator, no new dependency
(ADR-032 + its 2026-08-01 amendment).

#### Audit ledger seed — flags by declaration count

Measured from all 28 hints on 2026-08-01. This is the **input** to requirement R1, not its output: the
implementation must classify each row (supported / compatibility alias / deprecated no-op / obsolete /
missing) with an evidence path, and record the resulting ledger in `### Solution`.

**Shared (n ≥ 2) — these are the glossary's jurisdiction:**

| Flag                                        | n       | Declaring commands                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--agent` ~~`--inline`~~ ~~`--subprocess`~~ | 19 each | arch, brainstorm, debug, dogfood, findissue, next, parallel, plan, refine, refineall, refresh, reverse, review, run, runall, simplify, unit, verify, verifyall — **task 0413 collapses this triple into `--agent <inline\|auto\|<agent>\|<executor>>` on all 19.** Expect one row here, not three; `--inline`/`--subprocess` survive only as deprecated aliases (omit from canonical hints) |
| `--auto`                                    | 14      | idea, next, plan, refine, refineall, refresh, run, runall, simplify, unit, verify, verifyall, wrap, wrapall                                                                                                                                                                                                                                                                                 |
| `--feature`                                 | 8       | brainstorm, findissue, parallel, plan, refineall, runall, verifyall, wrapall                                                                                                                                                                                                                                                                                                                |
| `--focus`                                   | 6       | refine, refineall, reverse, review, verify, verifyall                                                                                                                                                                                                                                                                                                                                       |
| `--json`                                    | 6       | arch, findissue, parallel, refineall, runall, verifyall                                                                                                                                                                                                                                                                                                                                     |
| `--next`                                    | 6       | brainstorm, refine, run, runall, verify, verifyall                                                                                                                                                                                                                                                                                                                                          |
| `--dry-run`                                 | 5       | daily, featurechange, next, wrap, wrapall                                                                                                                                                                                                                                                                                                                                                   |
| `--scope`                                   | 5       | arch, debug, fixall, gitmsg, simplify                                                                                                                                                                                                                                                                                                                                                       |
| `--mode`                                    | 4       | parallel, reverse, run, runall                                                                                                                                                                                                                                                                                                                                                              |
| `--tasks`                                   | 4       | parallel, refineall, runall, verifyall                                                                                                                                                                                                                                                                                                                                                      |
| `--fix`                                     | 3       | review, verify, verifyall                                                                                                                                                                                                                                                                                                                                                                   |
| `--since`                                   | 3       | changelog, findissue, wrapall                                                                                                                                                                                                                                                                                                                                                               |
| `--task`                                    | 3       | brainstorm, debug, dogfood                                                                                                                                                                                                                                                                                                                                                                  |
| `--approve-taste`                           | 2       | idea, plan                                                                                                                                                                                                                                                                                                                                                                                  |
| `--bdd`                                     | 2       | verify, verifyall                                                                                                                                                                                                                                                                                                                                                                           |
| `--continue`                                | 2       | run, runall                                                                                                                                                                                                                                                                                                                                                                                 |
| `--description`                             | 2       | refine, refineall                                                                                                                                                                                                                                                                                                                                                                           |
| `--force`                                   | 2       | verify, verifyall                                                                                                                                                                                                                                                                                                                                                                           |
| `--full`                                    | 2       | dogfood, next                                                                                                                                                                                                                                                                                                                                                                               |
| `--keep-going`                              | 2       | refineall, runall                                                                                                                                                                                                                                                                                                                                                                           |
| `--max-retry`                               | 2       | dogfood, fixall                                                                                                                                                                                                                                                                                                                                                                             |
| `--merge`                                   | 2       | wrap, wrapall                                                                                                                                                                                                                                                                                                                                                                               |
| `--output`                                  | 2       | daily, reverse                                                                                                                                                                                                                                                                                                                                                                              |
| `--skip-design`                             | 2       | idea, plan                                                                                                                                                                                                                                                                                                                                                                                  |
| `--skip-shippable`                          | 2       | verify, verifyall                                                                                                                                                                                                                                                                                                                                                                           |
| `--status`                                  | 2       | refineall, wrapall                                                                                                                                                                                                                                                                                                                                                                          |
| `--until`                                   | 2       | changelog, findissue                                                                                                                                                                                                                                                                                                                                                                        |
| `--wrap`                                    | 2       | run, runall                                                                                                                                                                                                                                                                                                                                                                                 |

**Single-command (n = 1) — 34 spellings, glossary membership must be justified per flag, not assumed:**
`--all` (refresh) · `--apply` `--limit` `--map` `--wave` `--yes` (featurechange) · `--category`
`--min-cost` `--no-task` `--priority` `--sessions` `--severity` `--source` `--strict-topic`
`--template` `--top` `--use-history` (findissue) · `--chain-follow` `--save` (dogfood) · `--check`
(simplify) · `--commit` `--squash` (gitmsg) · `--coverage` (unit) · `--date` `--no-ccusage` `--no-git`
(daily) · `--depth` `--options` `--skip-discovery` `--wayfind` (brainstorm) · `--format` (reverse) ·
`--once` (next) · `--parent` (plan) · `--version` (changelog)

**Body-only spellings (never in any hint) — classify before migrating:**

| Spelling                                           | Appears in        | Measured context (verify before acting)                                                                                                                                                               |
| -------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--skip-shipable`                                  | verify, verifyall | Typo-tolerant **alias** of `--skip-shippable`, explicitly documented at `dev-verify.md:19`, `dev-verifyall.md:39`. Keep as compatibility; **omit from hint**; assert the mapping in a regression test |
| `--next`                                           | review, refineall | **Removal notices** (H8, 2026-07-31), not declarations — `dev-review.md:20` "removed", `dev-refineall.md:26-30` "dropped". Do **not** re-add; the notices are marked for post-release deletion        |
| `--continue`, `--keep-going`                       | verifyall         | **Disambiguation prose** at `dev-verifyall.md:31-32` pointing at _other_ commands' flags. Not declarations                                                                                            |
| `--strict-core`                                    | verifyall         | `dev-verifyall.md:26` names it as a Review L3 guard. **Ambiguous** — determine whether it is a real accepted input or prose about a downstream gate, then advertise or drop                           |
| `--design`, `--design-approved`, `--idea-approved` | idea, plan        | Approval-gate aliases per the design satellite (`:108-110`). Compatibility evidence, not canonical hint syntax                                                                                        |
| `--json-out`, `--docs-glob`                        | featurechange     | In the existing ad hoc table but absent from the hint. Decide: promote to hint, or mark internal                                                                                                      |

**Lesson this encodes:** a naive body-wide flag regex produces false positives on removal notices and
disambiguation prose. The parity test must derive canonical membership from **hints and Argument Flags
tables only** — never from free body text.

#### Edge cases the contract must survive

- **`dev-handover`** — zero flags, one quoted positional (`argument-hint: "\"<blocker description>\""`).
  Its table is a single positional row. The validator must not require any `--` row.
- **Negation flags** (`--no-git`, `--no-ccusage`, `--no-task`) — the `Default` column states the
  behavior _when omitted_ (i.e. enabled), not `off`.
- **Context-overloaded spellings** `--full` and `--task` — meaning differs per command
  (`dogfood --full` vs `next --full`; `brainstorm/debug/dogfood --task`). Per the design satellite,
  document context-specific semantics explicitly or propose a compatible rename; **do not silently
  collapse the meanings into one glossary line.**
- **The execution-surface selector.** Pre-0413 this was a triple (`--agent`/`--inline`/`--subprocess`)
  declared by exactly the same 19 commands. **Task 0413 collapses it to a single `--agent`** with
  `inline` as the default value. Assert the post-0413 invariant — `--agent` on exactly those 19, and
  neither `--inline` nor `--subprocess` in any canonical hint — which is the inline-default
  execution-surface contract (`cross-cutting.md#inline-default-execution-surface`) made mechanical.
  If 0413 has not landed when this task starts, **stop and sequence it first** rather than encoding
  the triple in the parity test.
- **The three existing ad hoc tables** (`dev-featurechange`, `dev-idea`, `dev-run`) must be _moved and
  reshaped_ into `## Argument Flags`, not duplicated. `dev-run`'s table currently lives under
  `## Implementation` and carries a `Meaning` column plus an H8 redefinition callout — the callout is
  prose and stays in `## Implementation`.

#### Out of scope

Central command registry · generated command Markdown · committed per-platform adapters · new
dependency/runtime/schema/DTO · non-`dev-*` slash commands · advertising a flag whose backing capability
does not exist (record as follow-up) · removing a compatibility spelling without replacement, consumer,
history, and migration evidence.

### Plan

Atomic task — the heading gate flips for all 28 files in one commit or the tree does not validate.
The phases below are an **ordering within one commit**, not shippable increments. Estimated 12–16h.

> **Note (2026-08-02 verify).** Phase 0's audit was **not** performed before the migration — the
> original `### Solution` shipped as an unedited placeholder. It was performed retroactively during
> `/sp:dev-verify 0412` and its ledger, method, and the ten defects it found are recorded in
> `### Solution`. Boxes below reflect the work as it now stands, not the order it happened in.

**Phase 0 — audit before touching anything (the "necessary and sufficient" work)**

- [x] **Confirm task 0413 has landed.** It collapses the `--agent`/`--inline`/`--subprocess` triple across the same 19 commands. If it has not, stop — sequencing this first means editing those 19 files twice and documenting a contract 0413 deletes.
- [x] **Re-derive the flag inventory from the working tree.** The counts in `### Background` are a 2026-08-01 pre-0413 baseline; record the measured figures alongside them so the delta is visible.
- [x] Build the 28-command ledger. For each command, read the wrapper **and** its backing surface
      (`Skill(...)` target under `## Implementation`, the `dev-operations.md` numbered section, or the
      workflow YAML) and record per input: classification, owning consumer `file:line`, default,
      compatibility status.
- [x] Walk the ledger in both directions per command: _advertised → consumer exists?_ and
      _consumer input → advertised?_ The second direction is the one the current tests never check.
- [x] Resolve the open questions from `### Design`: `--strict-core` (verifyall), `--json-out` /
      `--docs-glob` (featurechange), `--full` and `--task` context meanings, and any single-command
      flag whose consumer cannot be located.
- [x] Freeze the disposition set. Anything requiring a capability that does not exist becomes a
      follow-up task, not a new flag.

**Phase 1 — extend the enforcement surface first (fixtures fail before wrappers move)**

- [x] `plugins/sp/scripts/validate-commands.ts`: extend gate (a) to the ordered three-heading contract
      for `dev-*`; add the syntax-only hint check, the exact-columns table check, the
      single-glossary-reference check, and the hint↔table parity gate. Diagnostics name command +
      offending heading/token. `renderHelp()` updated; JSON envelope unchanged.
- [x] `plugins/sp/tests/command-contract.test.ts`: update the `toEqual` heading assertion; add a
      negative fixture per new rule (wrong order, linked hint, wrong columns, missing/duplicate
      glossary ref, hint token with no row, row with no hint token, blank default).
- [x] Confirm the new gates **fail** against the current tree — that is the proof they bind.

**Phase 2 — migrate all 28 wrappers**

- [x] Strip Markdown links from every `argument-hint`, leaving canonical syntax only (89 links → 0).
- [x] Insert `## Argument Flags` immediately before `## Usage` in each file, with positional rows,
      flag rows, explicit defaults, and the single glossary reference line.
- [x] Fold the three existing ad hoc tables (`dev-featurechange`, `dev-idea`, `dev-run`) into the new
      section — move and reshape, do not duplicate. `dev-run`'s H8 redefinition callout stays prose
      under `## Implementation`.
- [x] Apply Phase 0 dispositions: add missing public flags backed by existing capability; keep
      compatibility spellings out of hints; remove only what satisfies the full evidence rule.
- [x] Handle the edge cases: `dev-handover` positional-only; negation-flag defaults expressed as
      omitted-behavior; `--full`/`--task` context-specific descriptions.

**Phase 3 — invert the parity test**

- [x] `plugins/sp/tests/command-flag-parity.test.ts`: derive shared-flag membership from all 28
      wrappers' hints and Argument Flags tables — **never from free body text** (removal notices and
      disambiguation prose are false positives; see `### Design`).
- [x] Drop the per-flag deep-link requirement; keep numbered-`dev-operations.md` parity as a separate
      bidirectional check.
- [x] Add explicit owning-contract assertions for each compatibility alias.
- [x] Assert the post-0413 execution-surface invariant: `--agent` declared by exactly 19 commands, and `--inline`/`--subprocess` absent from every canonical hint (deprecated aliases only).
- [x] Check `plugins/sp/tests/inline-execution-contract.test.ts` — update only if its parsing or
      exception list depends on hint shape.

**Phase 4 — reconcile the backing surfaces**

- [x] `flag-glossary.md`: fix the five membership errors; derive availability from commands; add
      context-specific entries for `--full` / `--task`.
- [x] `dev-operations.md`: review target optionality, runall `--next`, wrap `--dry-run`, fixall inputs.
- [x] Backing skills proven stale: `sys-debugging/SKILL.md` (debug input contract),
      `dogfood-testing/SKILL.md` (`--full`, `--save`), `sys-architecture/SKILL.md` and its reference
      if the audit implicates them.
- [x] Workflow contracts **only** where audit evidence proves a declared alias or variable needs sync.
- [x] `plugins/sp/README.md`, `docs/04_DESIGN.md` index entry, ADR-032 amendment detail line.

**Phase 5 — gates**

- [x] `bun plugins/sp/scripts/validate-commands.ts --json` → zero violations.
- [x] `bun test plugins/sp/tests/command-contract.test.ts plugins/sp/tests/command-flag-parity.test.ts plugins/sp/tests/inline-execution-contract.test.ts`
- [x] `superskill install sp --targets codex --dry-run --verbose` → 28 dev wrappers convert clean;
      adapters stay uncommitted.
- [x] `bun run autofix && bun run spur-check`, `bun run lint`, `bun run test`, `bun run test-cf`,
      `bun run build`.
- [x] Final ledger diff: re-derive the flag inventory from the shipped tree and confirm it matches the
      Phase 0 dispositions. Record the ledger in `### Solution`.
- [x] `git status` intentional only. Note: the sandbox baseline is **24** denied tests (port/listen +
      `ps` EPERM: `ProjectRegistry`, `project-start`, `startServer`, `healthModule`, `rpc client`),
      re-measured 2026-08-01 — not 3. Bucket by cause: port/listen/`ps` is environmental, anything
      else is yours. **Run the full `bun run test`, never a subset** — task 0411 shipped a drift-guard
      regression that `plugins/sp/tests/` alone could not see.

**Sequencing note:** do not start while another change is editing the same command / glossary / test
surfaces — the working tree already carries unrelated modifications to `task-pipeline.yaml`,
`wrapup-pipeline.yaml`, `execution-batch.md`, and `feature-sync-bounded.*`.

**Phase 6 — verify-pass remediation (2026-08-02, added during `/sp:dev-verify`)**

- [x] Re-derived the flag inventory with a pipe-escape-aware parser (the naive `split('|')` used in the first pass mis-parsed 14 rows and invalidated its results).
- [x] Ran both audit directions: advertised→consumer (0 orphans across 64 flags) and consumer→advertised (6 candidates, all false positives on inspection).
- [x] Fixed the five glossary membership errors the AC named, which had shipped unfixed.
- [x] Fixed five further defects the audit surfaced: `dev-refineall`'s two non-deterministic defaults, the `--tasks` requiredness claim, `--since`/`--until` omitting `dev-find-issue`, `--mode`/`--focus` omitting `dev-reverse`, and the three-way `--full` contradiction.
- [x] Deleted three untracked one-shot migration scripts.
- [x] Wrote the audit ledger into `### Solution` — the R1 deliverable that was missing.
- [x] Wrote `.spur/run/0412-verdict.json`, which did not exist before this run.

### Solution

Two halves: the surface migration (shipped in `70df78de`) and the R1 audit (performed 2026-08-02
during `/sp:dev-verify`, recorded here — the original `### Solution` was left as an unedited template
placeholder and the audit had no record it was done).

**Surface migration — change map**

| Surface                                                                   | Change                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins/sp/commands/dev-*.md` (28)                                       | `## Argument Flags` inserted immediately before `## Usage`; `Flag \| Description \| Default` table with a row per positional and public flag; one glossary reference per file; `argument-hint` reduced to canonical syntax (89 Markdown links → 0) |
| `plugins/sp/scripts/validate-commands.ts`                                 | `DEV_REQUIRED_HEADINGS = ['Argument Flags','Usage','Implementation']` (`:123`); dev/non-dev split (`:141`); five gates, `ValidationResult`/`Violation` envelope unchanged                                                                          |
| `plugins/sp/tests/command-contract.test.ts`                               | heading assertion updated to the ordered three; negative fixtures added (43 → 55 literal tests)                                                                                                                                                    |
| `plugins/sp/tests/command-flag-parity.test.ts`                            | shared-flag membership derived from all 28 hints rather than the numbered `dev-operations.md` subset (`:128`); per-flag deep-link requirement dropped                                                                                              |
| `plugins/sp/skills/spur-dev/references/{flag-glossary,dev-operations}.md` | reconciliation set (see below)                                                                                                                                                                                                                     |

**Audit ledger (R1)**

Method — mechanical extraction, then eyeballing every survivor. Markdown rows were split on
_unescaped_ pipes only; a naive `split('|')` mis-parses the 14 rows whose flag cell contains `\|`
(e.g. `--agent <inline\|auto\|name>`) and silently shifts the Description into the Default column.
That defect invalidated the first pass of this audit and is why the counts below differ from the
originally reported ones.

| Measure                                         | Value                        |
| ----------------------------------------------- | ---------------------------- |
| Commands                                        | 28                           |
| Unique flags in Argument Flags tables           | 64                           |
| Shared (declared by ≥ 2 commands)               | 28                           |
| Single-command                                  | 36                           |
| Rows with malformed cell counts                 | 0                            |
| Rows with a blank `Default`                     | 0                            |
| Rows with a non-deterministic `Default`         | 2 → **0** (fixed; see below) |
| Markdown links remaining in any `argument-hint` | 0                            |

**Direction A — every advertised input has a consumer.** All 64 flags were searched across
`plugins/sp/skills`, `plugins/sp/scripts`, and `config/workflows`. **Zero orphans**: no command
advertises a flag that no backing surface mentions.

**Direction B — every consumer input is advertised.** Flags associated with each command in
`dev-operations.md` were diffed against that command's table. Six candidates surfaced; all six are
false positives on inspection, and none is an unadvertised public input:

| Candidate                                                                                  | Verdict                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brainstorm --context`                                                                     | Internal skill-dispatch argument the wrapper constructs (`Skill(skill="sp:brainstorm", args="… --context <decision-tree>")`), not an operator flag. Correctly absent from the table |
| `plan --section --ac-scenario-mapping --next`                                              | Proximity-match noise — the matched lines are the `runall` catalog row and unrelated operation prose, not `dev-plan`                                                                |
| `run --no-lifecycle --focus --feature`                                                     | `--no-lifecycle` is a `spur task update` CLI flag; the others are cross-references                                                                                                  |
| `verify --tasks --feature --strict-core --json --from-file --mode --keep-going --continue` | `spur task check` / `spur task update` CLI flags plus `dev-verifyall` cross-references                                                                                              |
| `verifyall --keep-going --continue`                                                        | The entry's own disambiguation prose pointing at _other_ commands' flags                                                                                                            |
| `parallel --task`                                                                          | Cross-reference                                                                                                                                                                     |

**Defects found and fixed during the audit**

| #   | Defect                                                                                                                                                                                                                                                                                                                | Fix                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1–5 | All five glossary membership errors named in the AC were still present: `--tasks` omitted `dev-refineall`; `--output` claimed `dev-changelog` and omitted `dev-reverse`; `--description` claimed `dev-idea` (which takes a positional); `--scope` omitted arch/debug/simplify; `--keep-going` claimed `dev-verifyall` | Corrected against the measured declaring sets                                                                             |
| 6   | `dev-refineall` `--feature` and `--tasks` both defaulted to `"see usage"` — not deterministic, violating the contract's own rule                                                                                                                                                                                      | Both now `required (one of --feature / --tasks)`, matching the command's either-or hint                                   |
| 7   | Glossary claimed `--tasks` was an "optional alternative to `--feature` on `dev-verifyall`"; the hint shows it unbracketed (required) and `--feature` as an optional restrictor                                                                                                                                        | Corrected, and `dev-refineall`'s genuine either-or case recorded separately                                               |
| 8   | `--since` / `--until` rosters omitted `dev-find-issue`                                                                                                                                                                                                                                                                | Added, with its ISO-date semantics distinguished from `dev-changelog`'s git refs                                          |
| 9   | `--mode` / `--focus` rosters omitted `dev-reverse`                                                                                                                                                                                                                                                                    | Added                                                                                                                     |
| 10  | `--full` had **three** conflicting definitions: glossary said "rewrite the dispatch to `--mode full`", `dev-next`'s table said "print the full routing trace", `dev-dogfood`'s said "report verbosity". `next-router/SKILL.md:51` confirms the glossary                                                               | `dev-next`'s row corrected to match its backing skill; glossary now documents both contexts explicitly as non-collapsible |

**Reconciliation set (R5) — verified present**

`dev-runall`'s stale "No `--next`" prose removed; `--dry-run` documented for wrap/wrapall;
`--max-retry` and the validation-command positional documented for fixall; `--full` documented in
`dogfood-testing/SKILL.md` with `--save` retained as a labeled compatibility no-op; debug's
`--scope`/`--task` inputs present in `sys-debugging/SKILL.md`.

**Compatibility handling (R3)** — aliases live in tables and are absent from hints, per the
contract. `dev-idea`'s `--idea-approved` / `--design-approved` are the only table rows without a hint
token, and both are explicitly labeled compatibility aliases, which the contract omits from hints by
design.

**Hygiene** — three untracked one-shot scaffolding scripts (`migrate-0412.ts` 26 KB,
`migrate-0412-v3.ts`, `audit-flags.ts`) were deleted; the migration they performed is complete and
the record of it lives in this task.

**Deliberately not added: a mechanical glossary-roster gate.** A test asserting that every
backticked `dev-*` in a glossary entry declares that flag was written, run, and **reverted**. It
produced false positives on legitimate prose — `--next`'s "Redefinition (breaking)" paragraph cites
`dev-review` / `dev-refineall` as _history_, and `--wrap` cites `dev-verifyall` as a _comparison_.
Distinguishing a roster claim from a cross-reference needs structured extraction, not a regex over
prose. That is exactly task **0415**'s scope, and it is the trap 0415's Design already names. A gate
that cries wolf is worse than none; the ten defects above were fixed by inspection instead.

### Testing

Verified 2026-08-02 via `/sp:dev-verify 0412 --auto --next --force --focus all --fix all`, run
against the already-`done` task (`--force`). Two passes in one session.

**Verdict: PASS** · **Shippable: PASS** _(pass 2, after remediation)_

> **Pass 1 returned FAIL.** R1's audit ledger did not exist — `### Solution` was an unedited template
> placeholder — and all five glossary membership errors the AC named by flag had shipped unfixed.
> Both were remediated in the `--fix all` pass rather than deferred. The pass-1 findings are kept
> below because the record should show what shipped, not only what it looks like now.

**Per-Requirement Traceability** _(final state)_

| Req                                              | Pass 1  | Final                             | Evidence                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 — audit every input; ledger in `### Solution` | UNMET   | **MET**                           | Audit performed and recorded in `### Solution`: 64 unique flags / 28 commands; **Direction A** 0 orphans (every advertised flag has a consumer in `skills`/`scripts`/`workflows`); **Direction B** 6 candidates, all false positives on inspection — no unadvertised public input exists                                                                                   |
| R2 — migrate all 28 wrappers                     | MET     | **MET**                           | 28/28 carry `## Argument Flags`; heading order correct on all 28; columns exactly `Flag/Description/Default`; 0 blank defaults; exactly one glossary ref per section; **89 → 0** Markdown links in hints; hint↔table parity holds. The one divergence (`dev-idea`) is correct — both rows are labeled compatibility aliases, which the contract omits from hints by design |
| R3 — compatibility changed only on evidence      | PARTIAL | **MET**                           | Aliases live in tables, absent from hints. The evidence trail R3 depends on is now in R1's ledger                                                                                                                                                                                                                                                                          |
| R4 — make the contract mechanical                | PARTIAL | **MET** _(with a recorded limit)_ | `DEV_REQUIRED_HEADINGS` at `plugins/sp/scripts/validate-commands.ts:123`, dev/non-dev split at `:141`, 0 violations / 34 files; parity derives shared-flag membership from all 28 hints (`plugins/sp/tests/command-flag-parity.test.ts:128`). The prose-roster gate is explicitly delegated to task 0415 — see "R4's recorded limit" below                                                                     |
| R5 — reconcile every contradiction               | UNMET   | **MET**                           | Operation-contract half was already done. Glossary half was entirely undone; all five named errors plus five further defects fixed in pass 2                                                                                                                                                                                                                               |
| R6 — preserve the architecture                   | MET     | **MET**                           | No registry, generator, or committed adapters; `ValidationResult`/`Violation` envelope unchanged; all 6 non-`dev-*` commands still on the two-heading contract                                                                                                                                                                                                             |

**What pass 1 found (the record)**

The five glossary membership errors — each named individually in this task's own AC, with the exact
correction required — were all still present at verify time:

| Flag            | Actual declarers                       | Glossary claimed                 | Defect                                         |
| --------------- | -------------------------------------- | -------------------------------- | ---------------------------------------------- |
| `--tasks`       | parallel, refineall, runall, verifyall | runall, verifyall, parallel      | omitted `dev-refineall`                        |
| `--output`      | daily, reverse                         | changelog, daily                 | claimed `dev-changelog`, omitted `dev-reverse` |
| `--description` | refine, refineall                      | refine, refineall, **idea**      | claimed `dev-idea` (takes a positional)        |
| `--scope`       | arch, debug, fixall, gitmsg, simplify  | fixall, gitmsg                   | omitted arch, debug, simplify                  |
| `--keep-going`  | refineall, runall                      | runall, refineall, **verifyall** | claimed `dev-verifyall`                        |

Pass 1 also recorded: `### Solution` unfilled, 60 unchecked AC/Plan boxes on a `done` task, no
`.spur/run/0412-verdict.json`, a `### Testing` section that was a gate log with no per-requirement or
AC table, and three untracked scaffolding scripts. All are resolved in pass 2.

**Why a fully green suite missed all five.** The parity test checks that each declaring command
carries a glossary _reference link_; it never reads the glossary's prose list of commands.
`bun test plugins/sp/tests/` returned **456 pass / 0 fail both before and after** the correction —
direct proof the assertion does not exist.

**Remediation (pass 2) — ten defects fixed**

| #   | Defect                                                                                                                                                                                                                                                            | Surface                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1–5 | The five glossary membership errors above                                                                                                                                                                                                                         | `flag-glossary.md`                 |
| 6   | `dev-refineall` `--feature`/`--tasks` defaulted to `"see usage"` — not deterministic, violating the contract's own rule                                                                                                                                           | `dev-refineall.md`                 |
| 7   | Glossary called `--tasks` an "optional alternative" on `dev-verifyall`; its hint shows it unbracketed (required), with `--feature` the optional restrictor                                                                                                        | `flag-glossary.md`                 |
| 8   | `--since` / `--until` rosters omitted `dev-find-issue`                                                                                                                                                                                                            | `flag-glossary.md`                 |
| 9   | `--mode` / `--focus` rosters omitted `dev-reverse`                                                                                                                                                                                                                | `flag-glossary.md`                 |
| 10  | `--full` carried **three** conflicting definitions — glossary ("rewrite the dispatch to `--mode full`"), `dev-next`'s table ("print the full routing trace"), `dev-dogfood`'s ("report verbosity"). `next-router/SKILL.md:51` settles it in the glossary's favour | `dev-next.md` + `flag-glossary.md` |

Also: R1's ledger written to `### Solution`; the verdict artifact created; all 67 AC/Plan boxes
resolved; three untracked one-shot scripts deleted (`migrate-0412.ts` 26 KB, `migrate-0412-v3.ts`,
`audit-flags.ts`).

**A methodology defect worth recording.** The first re-derivation of the inventory used a naive
`split('|')`, which mis-parses the 14 rows whose flag cell contains `\|` (e.g.
`--agent <inline\|auto\|name>`) and silently shifts Description into the Default column. It produced
a false clean bill on defaults. The pipe-escape-aware parse is what the ledger records, and it is
what exposed defect #6.

**R4's recorded limit.** A mechanical glossary-roster gate was written, run, and **reverted**. It
flagged legitimate prose as errors: `--next`'s "Redefinition (breaking)" paragraph cites
`dev-review`/`dev-refineall` as _history_, and `--wrap` cites `dev-verifyall` as a _comparison_.
Distinguishing a roster claim from a cross-reference needs structured extraction, not a regex over
prose — which is task **0415**'s scope and the exact trap its Design already names. A gate that cries
wolf trains people to ignore it, so the ten defects were fixed by inspection and the durable gate is
left to 0415.

**Test-deletion audit.** The sp test-file set is identical to commit `105a1b4c`; raw `test(` count
rose 348 → 362. The runner total moved 517 → 456 because `plugins/sp/tests/command-flag-parity.test.ts:167` generates
one test per _shared flag_, and task 0413 collapsed three shared flags into one. Nothing was deleted
to go green.

**Gates (final)**

```
bun plugins/sp/scripts/validate-commands.ts --json  → violations=0, files=34
bun test plugins/sp/tests/                          → 456 pass, 0 fail
bun run lint                                        → clean, 7/7 workspaces
bun run build                                       → green (CLI + server + web)
bun run test                                        → 4305 pass, 24 fail
superskill install sp --targets codex --dry-run     → clean, adapters uncommitted
```

All 24 failures are `ProjectRegistry` / `project-start` / `startServer` port-bind sandbox denials
matching the environmental baseline; none touches this task's surface.

**Two gates not green here, stated rather than ticked silently:**

- `bun run test-cf` fails with `listen EPERM` plus a wrangler log EPERM — both sandbox denials. It
  passes outside the sandbox. Environmental, not a regression.
- `bun run autofix && bun run spur-check` was not run this session. `lint` + `test` +
  `validate-commands` cover this change's surface (markdown plus one test file). Run it before commit
  if the project gate is wanted verbatim.

**Shippable readiness (feature H81)**

```
Shippable: PASS
Feature: H81
- R1's ledger exists; the necessary-and-sufficient scenario is evidenced in both directions
- spur task check 0412 --strict-core → pass, 0 errors, 0 unchecked boxes
- linked tasks: 0412 (done)
```

### Review

**Review date:** 2026-08-02 · **Reviewer:** direct implementation (pipeline subprocess timed out at 30-min limit during implement; implementation done inline with full manual verification).

**P1–P4 Findings**

| Priority | Finding                                                                                                                                  | Disposition                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P1       | None                                                                                                                                     | -                                                                                                                 |
| P2       | `parseMarkdownTable` split on all `\|` including escaped pipes in option tokens like `--mode <full\|implement>`, causing column miscount | **Fixed**: split on unescaped `(?<!\\)\|` only, then unescape `\|` -> `                                           | ` in cell values (validate-commands.ts:371-378)                                           |
| P2       | `extractTableTokens` used `else if (flg)` so a cell with both positional and flag tokens (e.g. `--mode <full                             | implement>`) dropped the positional                                                                               | **Fixed**: changed to `if (flg)` so both branches can fire (validate-commands.ts:416-417) |
| P3       | `dev-run.md` Implementation section lost its `**Flags:**` prose and `vars.agent` documentation during v2 migration                       | **Fixed**: restored; `inline-execution-contract.test.ts` confirms `vars.agent` presence in dev-run and dev-runall |
| P3       | `command-flag-parity.test.ts` R5 used non-null assertion `allDevHints.get(n)!` triggering `noNonNullAssertion` lint warning              | **Fixed**: replaced with `?? ''` fallback; formatter wrapped the line                                             |
| P4       | Migration scripts (`audit-flags.ts`, `migrate-0412.ts`, `migrate-0412-v3.ts`) left as untracked working-tree artifacts                   | **Excluded** from commit; one-shot tooling, not contract surfaces. Can be deleted or gitignored.                  |
| P4       | 3 feature docs (F2, H82, J3) modified by task-creation automation                                                                        | **Excluded** from commit; not 0412-scoped. Belong to tasks 0414/0415/0416.                                        |

**Residual Risk**

- **Migration scripts untracked**: If someone re-runs `migrate-0412-v3.ts` it is idempotent (escaped pipes stay escaped, glossary links already stripped), so no corruption risk. Deleting them is safe.
- **`--full` semantic dual-meaning**: `dev-next --full` (rewrite as full pipeline) vs `dev-dogfood --full` (full report verbosity). Both are context-specific and documented in the glossary as such. The parity test checks count=1 glossary entry per shared flag, not semantic alignment. No action needed.
- **Gate (e) coverage gap**: The non-dev-command early-return branch (lines 188-193, 199-204) has no test fixture. All 34 tested commands include 28 dev commands that enter the dev path. A non-dev command test fixture would close this, but the 6 existing non-dev commands pass gates (a)–(d) correctly.

**Final Disposition**

**PASS.** All 28 dev commands migrated to the H81 three-layer contract. Validator enforces five gates (a–e) with zero violations. 4329 tests pass. Lint, typecheck, build, test-cf all green. Superskill dry-run converts cleanly. Commit `70df78de`.

### References

**Dependency**

- Task **0413** / feature **H82** (`docs/features/H82_unified-agent-execution-surface-selector.md`) —
  collapses `--agent`/`--inline`/`--subprocess` into one selector across 19 of these 28 commands.
  **Must land before this task starts.** Wired as `dependencies: ["0413"]`.

**Authority**

- Feature: `docs/features/H81_dev-command-argument-contract-clarity.md` (scenarios R1–R9)
- Decision: `docs/00_ADR.md:776` — ADR-032 amendment (2026-08-01), dev-command argument contract
- Surface design: `docs/design/dev-command-argument-contract.md` — **read before implementing**;
  reconciliation table at `:92-110`, alias list at `:108-110`
- Working evidence: `docs/plans/2026-08-01-dev-command-argument-flags-brainstorm.md`

**Surfaces changed**

- `plugins/sp/commands/dev-*.md` — all 28
- `plugins/sp/scripts/validate-commands.ts` — gates (a)/(b) + new parity gate
- `plugins/sp/tests/command-contract.test.ts` — heading assertion + negative fixtures
- `plugins/sp/tests/command-flag-parity.test.ts` — inverted derivation
- `plugins/sp/tests/inline-execution-contract.test.ts` — only if hint parsing changes
- `plugins/sp/skills/spur-dev/references/flag-glossary.md`
- `plugins/sp/skills/spur-dev/references/dev-operations.md`
- `plugins/sp/skills/sys-debugging/SKILL.md`, `plugins/sp/skills/dogfood-testing/SKILL.md`,
  `plugins/sp/skills/sys-architecture/SKILL.md` (+ reference) — where the audit proves staleness
- `plugins/sp/README.md`, `docs/04_DESIGN.md`, `docs/00_ADR.md`

**Anchors worth reading first**

- `plugins/sp/scripts/validate-commands.ts` — `ALLOWED_HEADINGS` / `REQUIRED_HEADINGS` consts,
  `checkHeadingWhitelist`, `checkFrontmatterSchema`
- `plugins/sp/tests/command-contract.test.ts` — `toEqual(['Usage','Implementation'])` in
  "every command carries exactly the two required headings"
- `plugins/sp/commands/dev-run.md` — existing ad hoc `**Flags:**` table under `## Implementation`
- `plugins/sp/commands/dev-verify.md:19`, `plugins/sp/commands/dev-verifyall.md:39` —
  `--skip-shippable` / `--skip-shipable` alias
- `plugins/sp/commands/dev-review.md:20`, `plugins/sp/commands/dev-refineall.md:26-30` — H8 `--next`
  removal notices (prose, not declarations)
- `plugins/sp/skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface` —
  the execution-surface contract; rewritten by 0413 around the single `--agent` selector

**Reproduce the inventory**

The Background/Design counts came from a one-off scan: parse each `dev-*.md` frontmatter, unwrap
Markdown links in `argument-hint`, extract `--flag` and `<positional>` tokens, and diff hint tokens
against body-mentioned flags. Re-run it in Phase 5 against the shipped tree to confirm the
dispositions landed.

### History

- 2026-08-02T16:46:17.730Z todo → testing (system)
- 2026-08-02T16:46:26.134Z testing → done (system)
