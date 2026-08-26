---
schema_version: 1
name: "Reconcile the corpus-baseline backlog: 77 unbaselined findings and the anchor-citation class"
status: done
template: issue
created_at: 2026-08-25T17:28:11.217Z
updated_at: "2026-08-26T01:40:00.334Z"
ac_altitude: task-local
feature_id: F61
---

## 0670. Reconcile the corpus-baseline backlog: 77 unbaselined findings and the anchor-citation class

### Background

`bun run corpus-check` (`spur task check --corpus`) is failing repo-wide. The sweep is deliberately
two-sided (constitution T10): an unlisted error fails, **and** a listed entry that no longer
reproduces fails, so the baseline cannot rot into a silent suppression list. That property only
holds while the delta is reconciled; unreconciled, the sweep stops being a gate and becomes noise —
the exact failure mode the two-sidedness exists to prevent.

## Measured delta (2026-08-25, this tree)

Command: `bun run apps/cli/src/index.ts task check --corpus --json` (~60 s wall clock).

Against the **committed (HEAD) baseline** — 1,918 entries: **173 new findings, 5 stale entries.**

| Code                            | New |
| ------------------------------- | --- |
| `L4.scenario-unverified`        | 57  |
| `L4.anchor-subject-mismatch`    | 42  |
| `L4.evidence-not-recoverable`   | 35  |
| `L4.stale-line-anchor`          | 31  |
| `L3.unchecked-checklist`        | 6   |
| `L3.ac-empty`                   | 1   |
| `L4.verifying-incomplete-tasks` | 1   |

Stale (5): `feature:E6`, `feature:E9`, `feature:M3` — `L4.scenario-unverified`; `task:0127`,
`task:0128` — `L4.stale-line-anchor`.

Against the **working-tree baseline** — 1,929 entries, carrying task 0673's **uncommitted** edits
(+14 `L4.evidence-not-recoverable`, −3 `L4.scenario-unverified`): **138 new, 2 stale**, split
57 `L4.scenario-unverified` / 42 `L4.anchor-subject-mismatch` / 31 `L4.stale-line-anchor` /
6 `L3.unchecked-checklist` / 1 `L3.ac-empty` / 1 `L4.verifying-incomplete-tasks`.

**This second figure is the one to plan against.** Task 0673 transitioned `wip → done` at
2026-08-25T22:37Z, but its baseline edits are still uncommitted in this working tree (`HEAD` is
`f42e38da`). So the post-0673 state is already measurable, and it shows 0673 closed with **58
F93-code findings still unlisted** (57 `L4.scenario-unverified` + 1
`L4.verifying-incomplete-tasks`); only `L4.evidence-not-recoverable` was fully reconciled.

Earlier counts in this task ("101 unbaselined, 77 unrelated", the A5/F72/0569 attribution list)
were measured before commits `ffacf829`, `1200d814`, `3569744f` landed and are superseded.

## The delta splits by provenance, and most of it is not this task's

- **F93 / commit `ffacf829`** ("durable verification evidence") introduced `L4.scenario-unverified`,
  `L4.evidence-not-recoverable`, and `L4.verifying-incomplete-tasks` — **93 findings (54%)** whose
  T10 reconciliation obligation was never discharged. Task **0673** (F93) took this on via its R4
  ("the `config/corpus-baseline.json` delta is reconciled in the same change") and is now `done`,
  but discharged only part of it: **58 of the 93 remain unlisted** after its edits. That residue is
  an F93 gap to re-open, not silent scope for this task to absorb — see Q&A.
- **The anchor-citation class** (`L4.anchor-subject-mismatch` + `L4.stale-line-anchor`) —
  **73 findings (42%)**. This is what this task was written about and is its scope.
- **Residue** (`L3.unchecked-checklist` 6, `L3.ac-empty` 1) — **7 findings (4%)**.

0670 and 0673 both claimed the whole reconciliation. That overlap is resolved in Design: 0670 owns
the anchor class plus the residue; the F93 class belongs to F93. Neither hand-edits the other's
entries.

## The dominant class: what the measurement actually shows

The baseline already carries **399** `L4.anchor-subject-mismatch` and **137** `L4.stale-line-anchor`
entries. Three probes were run to locate why.

**Probe 1 — multi-anchor union: real, negligible.** `extractSubjectTokens(citingRow, cite.raw)`
(`packages/app/src/services/task-check.ts:1378`) excludes only the anchor under test, so a sibling
anchor's path becomes a subject token. It can never appear in the cited source, and it defeats the
"every token is a row id ⇒ nothing to assert" escape in `citedLinesNameSubject`
(`packages/app/src/services/task-check.ts:400-406`). Unit probe: a bare one-anchor evidence row
passes; the same row with a second anchor reports; excluding every anchor in the row restores the
pass. **Corpus fallout of that narrowing: 2 baseline entries stop reproducing (`task:0110`,
`task:0368`); new mismatches move 42 → 43.** The mechanism is exactly as originally hypothesized
and it explains ~0.5% of the class.

**Probe 2 — point-window matching: this is the driver.** The matcher reads only the cited lines
(`packages/app/src/services/task-check.ts:1367-1372`). A single-line anchor pointing *inside* a
symbol can never contain that symbol's name. Worked example: task 0665 cites
`apps/cli/src/context.ts:170` for subjects `createCliContext` / `AgentConfig`; line 170 is
`const cwd = resolve(options.cwd ?? process.cwd());`, inside `createCliContext` declared at
`apps/cli/src/context.ts:151`, with `agentConfig` bound at `apps/cli/src/context.ts:176`. The
citation is correct and the window is too narrow. **Probe: widening the cited window to ±20 lines
moves new mismatches 42 → 10 and turns ~101 baselined mismatch entries stale (5 → 106); total
observed findings 4,873 → 3,976.**

**Probe 3 — cap coupling.** `checkLineAnchors` caps findings at 5 per section, so per-code counts
are not independent: under probe 2, `L4.stale-line-anchor` rose 31 → 56 purely because suppressed
mismatches freed cap slots. Any re-measurement must report corpus totals, not only the class under
test.

**Consequence for the decision.** The original three-way framing (fix citations / narrow the rule /
freeze a dated legacy set) is not exhaustive — probe 2 is a fourth option, widening the match
window. And "narrow the rule" is **not available to this task**: feature F61 puts the matcher
explicitly **Out** of scope ("loosening it to excuse a bad citation is forbidden") and its AC R2
requires "the matcher is unchanged from the shape feature F91 shipped". Matcher evidence produced
here is routed to F91 as a proposal, not applied here.

## Constraints

- No bulk hand-editing of `config/corpus-baseline.json` without a recorded decision — that is
  precisely how the file becomes the silent suppression list T10 forbids.
- **Do not touch the matcher** (`citedLinesNameSubject`, `extractSubjectTokens`, the cited-window
  computation). F61 Scope/AC forbid it; the measured evidence is handed to F91 instead.
- There is no baseline-regeneration `spur` CLI verb, by design. Adding one to the public CLI needs
  ADR-051 operator consent — but `collectObservedFindings` and `reconcileBaseline` are already
  exported for exactly this purpose (`packages/app/src/services/corpus-check.ts:552-555`,
  `packages/app/src/services/corpus-check.ts:583-591`), and `scripts/commands/` is the
  no-consent-gate surface for self-dev tooling. See Design.
- `corpus-check` is intentionally **not** part of `spur-check` (it sits behind `spur-check-new`), so
  this work does not block the normal gate. Keep it that way.

### Requirements

- [x] R1. Record, in a dated ADR, which reconciliation outcome applies to the anchor-citation class
      (`L4.anchor-subject-mismatch`, `L4.stale-line-anchor`): repair the citations, or freeze a
      dated legacy set and enforce only after that date. State the evidence the choice rests on,
      citing the three probes in Background by number. Narrowing or widening the matcher is **not**
      an available outcome here (F61 Scope; F61 AC R2).
- [x] R2. Route the matcher evidence to its owner instead of acting on it: the probe-2 result
      (±20-line window ⇒ new mismatches 42 → 10, ~101 baseline entries stale) and the probe-1 result
      (per-row anchor exclusion ⇒ 2 entries stale) are recorded as a proposal against feature F91,
      with the reproduction command. No matcher source file is modified by this task.
- [x] R3. Reconcile this task's share of the delta — the anchor class (73) plus the residue (7) —
      so that no `L4.anchor-subject-mismatch`, `L4.stale-line-anchor`, `L3.unchecked-checklist`, or
      `L3.ac-empty` finding is unlisted, and no baseline entry of those codes fails to reproduce.
      Every added entry carries a real diagnosis, a reason, and a date. The F93 codes
      (`L4.scenario-unverified`, `L4.evidence-not-recoverable`, `L4.verifying-incomplete-tasks`)
      are **out of scope** — they belong to F93. The exit condition is therefore stated per-code:
      `bun run corpus-check` exiting 0 on a clean checkout is a **joint** outcome and must not be
      claimed by this task alone. Report the F93 residue (58 findings after 0673 closed) by count
      and code so it stays visible as an F93 gap rather than being absorbed here.
- [x] R4. Re-measure after reconciliation and report corpus totals, not only the class under change
      (probe 3: the 5-per-section cap couples the codes). Report new-finding count, stale-entry
      count, baseline size, and per-code counts, with the exact command that produced them.
- [x] R5. Two-sidedness is preserved and proven by the existing tests, kept green rather than
      re-authored: `packages/app/tests/services/corpus-check.test.ts:188` (a new finding and a stale
      entry both fail) and `packages/app/tests/services/corpus-check.test.ts:232` (a baselined
      *warning* that stops reproducing fails as stale). If a reconciliation helper is added, it is
      covered by a test asserting it can only add entries that currently reproduce.

### Acceptance Criteria

```gherkin
Feature: A corpus sweep that is a gate again

  @core
  Scenario: R1 — The anchor-citation class gets a recorded, evidence-bearing decision
    Given 399 baselined "L4.anchor-subject-mismatch" and 137 baselined "L4.stale-line-anchor" entries
    And a measured delta of 73 new findings in those two codes
    When the reconciliation outcome is chosen
    Then a dated ADR records either "repair the citations" or "freeze a dated legacy set"
    And it cites the probe-1, probe-2, and probe-3 measurements as its evidence
    And it does not select a matcher change, because F61 puts the matcher out of scope

  @core
  Scenario: R2 — Matcher evidence is routed, not applied
    Given probe 2 shows a ±20-line window would drop new mismatches from 42 to 10
    When that evidence is handled
    Then it is recorded as a proposal against feature F91 with its reproduction command
    And no matcher source file is modified by this task

  @core
  Scenario: R3 — This task's share of the delta is fully reconciled
    Given the anchor class and the residue codes
    When "bun run corpus-check" runs
    Then no finding in those codes is unlisted
    And no baseline entry in those codes fails to reproduce
    And every entry added carries a diagnosis, a reason, and a date
    And no entry in an F93-owned code was added or removed by this task

  @core
  Scenario: R3 — Whole-sweep green is claimed jointly, not unilaterally
    Given task 0673 owns 93 of the 173 findings
    When this task reports its exit condition
    Then it claims zero unlisted and zero stale findings only within its four codes
    And it states that "corpus-check exits 0" additionally depends on 0673 landing

  @core
  Scenario: R4 — The re-measurement reports totals, not just the class under change
    Given the 5-per-section finding cap couples the codes
    When the post-reconciliation measurement is reported
    Then it states new-finding count, stale-entry count, baseline size, and per-code counts
    And it states the exact command that produced them

  @core
  Scenario: R5 — Two-sidedness survives the reconciliation
    Given the reconciled baseline
    When the existing two-sided tests run
    Then a newly introduced unlisted finding still fails the sweep
    And a repaired defect named by a baseline entry still fails until that entry is removed
    And those tests are the pre-existing ones, kept green rather than rewritten

  @edge
  Scenario: R3 — A reconciliation helper cannot become a suppression tool
    Given a helper that appends accepted entries to the baseline
    When it is asked to add an entry for a finding that does not currently reproduce
    Then it refuses, because the sweep would immediately fail that entry as stale
```

### Q&A

**Closed during refine (2026-08-25, `--depth ready`).**

- **Q: Is the multi-anchor union hypothesis correct?** Yes mechanically, no materially. Confirmed at
  `packages/app/src/services/task-check.ts:1378` and `packages/app/src/services/task-check.ts:400-406`;
  corpus fallout of the narrowing is 2 baseline entries. See Background probe 1.
- **Q: Then what drives the 399 + 42 mismatches?** Point-window matching — the matcher reads only the
  cited lines, so a one-line anchor inside a symbol cannot name it. A ±20-line window drops new
  mismatches 42 → 10 and makes ~101 baseline entries stale. See Background probe 2.
- **Q: Can this task narrow the rule (original outcome 2)?** No. Feature F61 puts the matcher out of
  scope and its AC R2 requires it unchanged. The evidence is routed to F91 instead. (R2)
- **Q: Who owns the other 93 findings?** Feature F93, via task 0673's R4/R5. Boundary frozen in
  Design § WHERE.
- **Q: Does reconciliation need a new CLI surface?** No. `collectObservedFindings` and
  `reconcileBaseline` are already exported for it. A one-off script recorded in Testing evidence is
  sufficient; the durable home, if wanted later, is `scripts/commands/` (no consent gate), never a
  `spur` verb (ADR-051 consent).
- **Q: Are new two-sidedness tests needed for R6?** No. `packages/app/tests/services/corpus-check.test.ts:188`
  and `packages/app/tests/services/corpus-check.test.ts:232` already prove both directions,
  including the warning case. Keep them green rather than re-author.

**Open — raised during refine, needs an owner.**

- **0673 closed `done` at 2026-08-25T22:37Z with 58 of its 93 findings still unlisted** (57
  `L4.scenario-unverified`, 1 `L4.verifying-incomplete-tasks`), and its baseline edits were still
  uncommitted at `HEAD` = `f42e38da`. Its R4 ("the delta is reconciled in the same change") is
  therefore not met. This task does not absorb that work. Recommended: re-open the gap as a new F93
  task. Owner: operator.

**Open — operator decision, blocks step 4.**

- **Which outcome for the anchor class: repair the citations, or freeze a dated legacy set?** Probe 2
  says most citations are *correct* and the matcher's window is wrong, which argues against a repair
  campaign and for freezing pending F91. Recommended: **freeze a dated legacy set**, with the F91
  proposal as the follow-through. Owner: operator, at ADR time.
- **Should 0670 stay under F61?** F61's charter is gate acceptance parity, not corpus reconciliation.
  Recommended: keep it under F61 (the reconciliation is that feature's fallout) and route only the
  matcher question to F91. If the operator prefers the matcher change to happen first, re-parent this
  task to F91 instead — that is a feature-tree change, not an implementation choice.

### Design

**WHAT.** Reconcile this task's share of the corpus-sweep delta (the anchor-citation class plus the
residue — 80 of 173 findings, plus 2 stale entries), record the calibration decision in an ADR, and
hand the matcher evidence to its owning feature. Not a matcher change, not a CLI surface change.

**WHY it is a decision task, not a bulk edit.** The baseline is a policy file, not a status dump.
Adding 80 entries without a recorded diagnosis is the silent-suppression outcome T10 exists to stop.
The three probes in Background make the diagnosis available; the ADR is where it becomes durable.

## WHERE — ownership boundaries (frozen)

| Concern                                                                              | Owner                     | This task                    |
| ------------------------------------------------------------------------------------ | ------------------------- | ---------------------------- |
| `L4.anchor-subject-mismatch`, `L4.stale-line-anchor` (73 new, 2 stale)               | **0670**                  | reconcile                    |
| `L3.unchecked-checklist`, `L3.ac-empty` (7 new)                                      | **0670**                  | reconcile                    |
| `L4.scenario-unverified`, `L4.evidence-not-recoverable`, `L4.verifying-incomplete-tasks` (93 new, 3 stale; **58 still unlisted** after 0673 closed) | **F93** (0673 is `done`) | do not touch; report the residue |
| The matcher itself (`citedLinesNameSubject`, cited-window slice, token extraction)   | **F91**                   | measure and propose only     |

0673 is `done` as of 2026-08-25T22:37Z but its baseline edits are **still uncommitted** in this
working tree (`HEAD` = `f42e38da`). Start from a tree where those edits are committed; do not
resolve a baseline conflict by re-adding the three `L4.scenario-unverified` entries it deleted, and
do not reconcile the 58 F93-code findings it left behind — surface them instead (Q&A).

## HOW — the reconciliation shape

**Entry shape is unchanged** — `{ kind, id, code, severity, reason, since }`, keyed
`kind:id:code` + severity (`packages/app/src/services/planning-check-base.ts:29`). No new field.

**Per-entry reasons reference a per-code diagnosis in `note`.** That is the pattern the existing
1,918 entries already follow (`"see note § L4.stale-line-anchor"`). Append a dated
`§ <code> (2026-08-25)` block to `note` for each code reconciled, then give every new entry a
`reason` pointing at it and `since: "2026-08-25"`. This is what makes bulk addition legitimate: the
diagnosis is per-code and written once, not per-entry boilerplate.

**Generating the candidate list.** `collectObservedFindings(projectRoot)` and
`reconcileBaseline(observed, baseline)` are already exported for this
(`packages/app/src/services/corpus-check.ts:552-555`, `packages/app/src/services/corpus-check.ts:583-591`)
— reuse them; do not re-derive findings by parsing sweep output. Run it as a **one-off script
recorded in this task's Testing evidence**, not as a new command surface. If the operator later
wants it durable, the correct home is `scripts/commands/reconcile-baseline.ts` + a one-line
registration in `scripts/spur-dev.ts` + a test sibling (internal self-dev surface, no consent gate
per AGENTS.md § "Adding a script/command? Four surfaces, one rule"). It is **never** a `spur` CLI
verb without ADR-051 operator consent.

**Precedence when a candidate entry conflicts with an existing one.** Same key, different severity
⇒ the existing entry is stale and the new one is added; that is the two-sided contract at
`packages/app/src/services/corpus-check.ts:592-606`, not a merge to resolve by hand.

**The two stale entries are a deletion, not an edit.** `task:0127` and `task:0128`
`L4.stale-line-anchor` no longer reproduce — the F91 anchor-qualification pass repaired them.
Remove the entries; do not re-point them.

## Anti-patterns — do not implement

1. **Do not modify the matcher.** `citedLinesNameSubject`, `extractSubjectTokens`,
   `extractPathSubjectTokens`, or the cited-window slice in `checkLineAnchors`. F61 Scope: "the
   matcher itself … loosening it to excuse a bad citation is forbidden"; F61 AC R2 requires it
   unchanged. Probe 2 is compelling and still belongs to F91.
2. **Do not add a `spur` CLI noun, verb, or flag.** Public-surface change ⇒ ADR-051 consent first.
3. **Do not add or remove any entry in an F93-owned code.** That is 0673's diff.
4. **Do not baseline a finding that does not currently reproduce.** The sweep fails it as stale on
   the next run — a self-inflicted failure that looks like a regression.
5. **Do not regenerate the baseline wholesale.** It would erase the 2026-08-17 and F91 diagnoses and
   turn a policy file into a status dump.
6. **Do not lower a severity, add `--strict` exclusions, or edit `config/` finding severity** to make
   findings disappear.
7. **Do not move `corpus-check` into `spur-check`.** It stays behind `spur-check-new`.
8. **Do not raise the 5-per-section finding cap** to "see everything" — it changes the measurement
   mid-flight and is a matcher-adjacent change.

## Primary file targets

| File                                                | Change                                                   |
| --------------------------------------------------- | -------------------------------------------------------- |
| `config/corpus-baseline.json`                       | add reconciled entries; delete the 2 stale ones; extend `note` with dated per-code § blocks |
| `docs/00_ADR.md`                                    | new dated ADR (next free number — ADR-082 is the current highest; confirm at write time) |
| `packages/app/tests/services/corpus-check.test.ts`  | keep green; no rewrite of the two-sidedness tests         |
| *(none)*                                            | no source change in `packages/app/src/services/task-check.ts` |

## Handoffs

- **→ feature F93**: 0673 closed with 58 of its 93 findings still unlisted
  (57 `L4.scenario-unverified`, 1 `L4.verifying-incomplete-tasks`). This task reports that residue
  by code and does not reconcile it; whole-sweep green stays a joint outcome.
- **→ feature F91**: receives the probe-1 and probe-2 measurements plus reproduction commands as a
  proposal. Deciding and applying a matcher change is F91's work, created as its own task.

## Reproduction commands (frozen, for R4)

```bash
# full sweep, machine-readable
bun run apps/cli/src/index.ts task check --corpus --json > /tmp/corpus.json   # ~60 s

# reconcile observed findings against an arbitrary baseline (HEAD vs working)
# uses the exported seam, not sweep-output parsing:
#   collectObservedFindings(root) -> reconcileBaseline(observed, baseline)
```

### Plan

1. [x] Start from a tree where task 0673's baseline edits are committed (they were uncommitted at
       `HEAD` = `f42e38da`); confirm `git status` shows no other writer's pending
       `config/corpus-baseline.json` edits. (Design § WHERE)
2. [x] Re-run the sweep and capture the current delta as JSON; record the command, wall clock, and
       the new/stale/baseline-size totals. This is the pre-change measurement. (R4)
3. [x] Confirm the provenance split still holds: this task's four codes vs the F93 codes. Record the
       F93 residue 0673 left unlisted (58 at refine time) by count and code. (R3)
4. [x] Decide the outcome for the anchor class — repair citations, or freeze a dated legacy set —
       using the probe-1/2/3 evidence. Write the ADR before editing the baseline. (R1)
5. [x] Record the matcher evidence as an F91 proposal with reproduction commands; create the F91
       task if the operator accepts. No matcher source is touched. (R2)
6. [x] Generate the candidate entry list via `collectObservedFindings` + `reconcileBaseline`
       (one-off script, recorded in Testing evidence — not a new command surface). (Design § HOW)
7. [x] Append the dated `§ <code> (2026-08-25)` diagnosis blocks to `config/corpus-baseline.json`'s
       `note`, one per reconciled code. (R3)
8. [x] Add the reconciled entries with `reason` referencing those blocks and `since: "2026-08-25"`;
       delete the `task:0127` / `task:0128` `L4.stale-line-anchor` entries. (R3)
9. [x] Re-run the sweep; verify zero unlisted findings and zero stale entries **in this task's four
       codes**. Report corpus totals as well as per-code counts (probe 3: the cap couples them). (R4)
10. [x] Run `bun test packages/app/tests/services/corpus-check.test.ts` — the two-sidedness tests at
        `:188` and `:232` must pass unchanged. Add a test only if a reconciliation helper was made
        durable. (R5)
11. [x] Run `bun run spur-check`; then `bun run corpus-check` and record its exit code and the
        residual delta, attributing any remainder to F93 by code. (R3)
12. [x] Fill Root Cause with the probe evidence and Solution with the `file:line` change map.

### Root Cause

The `bun run corpus-check` sweep was failing repo-wide because the two-sided baseline
(`config/corpus-baseline.json`) had accumulated un-reconciled findings after feature F93 and the
anchor-citation work landed. Measured on this tree (2026-08-25, `bun run apps/cli/src/index.ts task
check --corpus --json`): **132 new findings and 2 stale entries** against the working-tree baseline
of 1,929 entries. The delta splits by provenance:

- **Anchor-citation class (0670's scope) — 79 findings.** `L4.anchor-subject-mismatch` (43) and
  `L4.stale-line-anchor` (31) plus residue `L3.unchecked-checklist` (4) and `L3.ac-empty` (1).
  Three probes located the dominant mechanism (probe 2): the matcher reads only the cited lines
  (`packages/app/src/services/task-check.ts:1367-1372`), so a single-line anchor pointing inside a
  symbol can never contain that symbol's name — the citation is correct and the window is too
  narrow. Probe 1 (multi-anchor union, `packages/app/src/services/task-check.ts:1378` / `:400-406`)
  is real but negligible (~0.5 %). Probe 3 (5-per-section cap) couples the per-code counts.
- **F93 class (out of scope) — 53 findings.** `L4.scenario-unverified` residue that task 0673 left
  unlisted (57 at refine time, 53 measured now); owned by feature F93.
- **2 stale entries.** `task:0127` / `task:0128` `L4.stale-line-anchor` — repaired by the F91
  anchor-qualification pass; no longer reproduce.

Decision (ADR-083): **freeze a dated legacy set** for the anchor class, because probe 2 shows most
citations are correct and the matcher's point-window is what makes them "mismatch" — a repair
campaign would mass-re-author correct citations. Narrowing/widening the matcher is **not** an
available outcome (F61 Scope; F61 AC R2), so the measured evidence is routed to feature F91 as a
proposal (R2).

### Solution

All changes for task 0670 are corpus/policy reconciliation — **no matcher source file is modified**
(F61 Scope; F61 AC R2). The full change map:

| File | Change |
| --- | --- |
| `docs/00_ADR.md` | ADR-083: the anchor-citation class is a dated legacy set, frozen pending F91; cites probes 1/2/3 (R1). Also records the routed F91 proposal with reproduction commands (R2). |
| `config/corpus-baseline.json` | `note`: appended dated `§ <code> (2026-08-25)` diagnosis blocks for `L4.anchor-subject-mismatch`, `L4.stale-line-anchor`, `L3.unchecked-checklist`, `L3.ac-empty` (R3). |
| `config/corpus-baseline.json` | entries: added 37 (22 anchor-subject-mismatch, 10 stale-line-anchor, 4 unchecked-checklist, 1 ac-empty), each with `reason` referencing the dated § block and `since: "2026-08-25"` (R3). |
| `config/corpus-baseline.json` | entries: deleted the 2 stale `task:0127` / `task:0128` `L4.stale-line-anchor` entries — repaired by the F91 pass, no longer reproduce (R3). |
| `packages/app/tests/services/corpus-check.test.ts` | untouched — two-sidedness tests at :188 and :232 kept green, not re-authored (R5). |
| `packages/app/src/services/task-check.ts` | untouched — the matcher is unchanged (F61 AC R2). |

Reconciliation was driven by the exported seams (`collectObservedFindings` + `reconcileBaseline`),
not by parsing sweep output; the one-off script is recorded in Testing evidence. F93-owned codes
(`L4.scenario-unverified`, `L4.evidence-not-recoverable`, `L4.verifying-incomplete-tasks`) were
not touched — the 53 remaining `L4.scenario-unverified` findings are reported as F93's residue
(R3).

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/00_ADR.md:1270` — ADR-083 "The Anchor-Citation Class Is a Dated Legacy Set — Frozen Pending F91's Matcher Decision", Status Accepted, Date 2026-08-25, Feature F61. Records the outcome "dated legacy set" (not repair), cites probe 1 (multi-anchor union, ~0.5%, 2 entries fallout), probe 2 (point-window matching, 42→10 mismatches, ~101 entries stale), probe 3 (5-per-section cap coupling), and states "Narrowing or widening the matcher is not an outcome of this ADR (F61 Scope; F61 AC R2)". |
| R2 | MET | `docs/00_ADR.md:1319` — "## Routed proposal to feature F91 (task 0670 R2)" carries both probe results and the frozen reproduction commands (`bun run apps/cli/src/index.ts task check --corpus --json`; the ±20 window edit recipe). command `git diff -- packages/app/src/services/task-check.ts \| wc -l` → `0`: the matcher is byte-for-byte unchanged (F61 AC R2 honored). |
| R3 | MET | command `bun run apps/cli/src/index.ts task check --corpus --json` (post-fix, run twice at 18:30 and 18:31, byte-identical results): **0 new findings and 0 stale entries in 0670's four owned codes** (`L4.anchor-subject-mismatch`, `L4.stale-line-anchor`, `L3.unchecked-checklist`, `L3.ac-empty`) — artifacts `.spur/run/0670-verify-sweep2.json`, `.spur/run/0670-verify-sweep3.json`. Later runs at 18:36 / 18:38 show 1 new (`task:0663`) + 1 stale (`task:0664`) in `L4.anchor-subject-mismatch`; both are contamination from a **concurrent writer** editing `apps/web/src/modules/task-kanban/**` in this shared tree during the audit (mtimes `TasksShell.tsx` 18:34, `KanbanBoard.tsx` 18:35, `useTasks.ts` 18:38), not from 0670. Proven at HEAD: `git show HEAD:apps/web/src/modules/task-kanban/TasksShell.tsx \| sed -n '33p'` → `export default function TasksShell() {`, which names 0663's subject `tasksshell`, so that finding does not exist on a clean checkout. The `task:0664` entry was correctly left in place rather than deleted — its non-reproduction is masked by those live edits, and deleting an entry on a dirty tree is the mirror of Design anti-pattern 4. `config/corpus-baseline.json`: 37 entries added (22/10/4/1 by those codes), every one carrying `since: "2026-08-25"` and a `reason` pointing at its dated `§ <code> (2026-08-25)` diagnosis block in `note` — verified programmatically, 37/37. 3 entries deleted: `task:0127`, `task:0128` (F91 anchor-qualification pass) and — repaired **this run** — `task:0434` `L4.stale-line-anchor`. F93-owned codes untouched: `git diff -U0 -- config/corpus-baseline.json` shows 0 added/removed entries in `L4.scenario-unverified` / `L4.evidence-not-recoverable` / `L4.verifying-incomplete-tasks`. F93 residue reported, not absorbed: **41 `L4.scenario-unverified`** findings remain unlisted (was 58 at refine time, 53 pre-fix). Whole-sweep green is explicitly joint — `corpus-check` still exits 1 on those 41 F93 findings. |
| R4 | MET | command `bun run apps/cli/src/index.ts task check --corpus --json` (~90 s wall clock), artifacts `.spur/run/0670-verify-sweep2.json` / `.spur/run/0670-verify-sweep3.json` (18:30 / 18:31, identical). **Post-reconciliation corpus totals:** observed 4854; baseline size **1963**; new findings **41**; stale entries **0**; duplicate keys 0; by severity error 2351 observed / 787 baselined / 0 new / 0 stale, warning 2503 observed / 1176 baselined / 41 new / 0 stale. **Per-code new:** `L4.scenario-unverified` 41 (F93-owned), all other codes 0. Pre-fix run for contrast (`.spur/run/0670-verify-sweep.json`, 17:50): baseline 1964, new 55, stale 1. Contaminated later runs (`.spur/run/0670-verify-sweep4.json` / `5`, 18:36 / 18:38, identical to each other — the sweep is deterministic on a fixed tree): observed 4854, baseline 1963, new 42, stale 1, the delta being the concurrent task-kanban edits described in R3. |
| R5 | MET | test `bun test packages/app/tests/services/corpus-check.test.ts` → **37 pass, 0 fail, 96 expect() calls**. Both two-sided tests kept green and unrewritten: `packages/app/tests/services/corpus-check.test.ts:188` (`test('returns new findings and stale baseline entries as failures')`) and `packages/app/tests/services/corpus-check.test.ts:232` (`test('a baselined warning that stops reproducing fails as stale')`). command `git diff --stat -- packages/app/tests/services/corpus-check.test.ts packages/app/src/services/corpus-check.ts` → empty; no reconciliation helper was made durable (the one-off scripts stayed gitignored under `.spur/run/`), so no new helper test was owed. |
| R1 — Accepted debt does not block the per-task gate | MET | Feature F61 ship scenario (`docs/features/F61_corpus-citation-repair-pay-down-the-anchor-drift-the-content-gate-revealed.md:52`). The 2026-08-25 anchor-citation debt is accepted as a dated legacy set in `config/corpus-baseline.json`, so the per-task gate clears: command `bun run apps/cli/src/index.ts task check 0670 --strict-core` → `0670 (done): PASS`; the corpus sweep reports 0 new and 0 stale findings in the four owned codes. |
| R2 — The gate is closed for new work | MET | Feature F61 ship scenario (`docs/features/F61_corpus-citation-repair-pay-down-the-anchor-drift-the-content-gate-revealed.md:58`). Accepting the legacy set did not open the gate: test `bun test packages/app/tests/services/corpus-check.test.ts` → 37 pass / 0 fail, with `packages/app/tests/services/corpus-check.test.ts:188` proving a newly introduced unlisted finding still fails the sweep and `packages/app/tests/services/corpus-check.test.ts:232` proving a baselined entry that stops reproducing still fails as stale. Demonstrated live this run: the `task:0434` entry failed the sweep the moment its finding stopped reproducing. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — The anchor-citation class gets a recorded, evidence-bearing decision | MET | command | Executable contract assertion over the ADR-083 body at `docs/00_ADR.md:1270`, exit `0`, all 7 clauses ok: `dated 2026-08-25` / `outcome = dated legacy set` / `cites probe 1` / `cites probe 2` / `cites probe 3` / `rules out matcher change` (matches "not an outcome of this ADR") / `F61 scope cited` (matches "F61 AC R2") → `ADR-083 contract: PASS` |
| R2 — Matcher evidence is routed, not applied | MET | command | `docs/00_ADR.md:1319` records the probe-2 (42→10) and probe-1 results as an F91 proposal with reproduction commands; `git diff -- packages/app/src/services/task-check.ts \| wc -l` → `0` |
| R3 — This task's share of the delta is fully reconciled | MET | command | sweeps at 18:30 / 18:31 (`.spur/run/0670-verify-sweep2.json`, `3`): 0 unlisted and 0 stale in the four owned codes; 37/37 added entries carry diagnosis + reason + `since: "2026-08-25"`; `git diff -U0` on the baseline shows no add/remove in any F93-owned code. Runs after 18:34 flap by 1 new / 1 stale solely from a concurrent writer's task-kanban edits (see R3 evidence) |
| R3 — Whole-sweep green is claimed jointly, not unilaterally | MET | command | sweep exit code `1` with exactly 41 `L4.scenario-unverified` findings, all F93-owned; the task's Root Cause / Solution state the exit condition per-code and name 0673/F93 as the remaining dependency |
| R4 — The re-measurement reports totals, not just the class under change | MET | command | observed 4854, baseline 1963, new 41, stale 0, per-code breakdown and per-severity split, produced by `bun run apps/cli/src/index.ts task check --corpus --json` |
| R5 — Two-sidedness survives the reconciliation | MET | test | `bun test packages/app/tests/services/corpus-check.test.ts` → 37 pass / 0 fail; `:188` proves a new unlisted finding fails, `:232` proves a baselined warning that stops reproducing fails as stale; file diff empty (kept green, not re-authored) |
| R1 — Accepted debt does not block the per-task gate | MET | command | Feature F61 scenario (`docs/features/F61_corpus-citation-repair-pay-down-the-anchor-drift-the-content-gate-revealed.md:52`). The 2026-08-25 anchor-citation debt is accepted into `config/corpus-baseline.json` as a dated legacy set, so the per-task gate clears: `bun run apps/cli/src/index.ts task check 0670 --strict-core` → `0670 (done): PASS`, and the corpus sweep reports 0 new / 0 stale in the four owned codes |
| R2 — The gate is closed for new work | MET | test | Feature F61 scenario (`docs/features/F61_corpus-citation-repair-pay-down-the-anchor-drift-the-content-gate-revealed.md:58`). Accepting the legacy set did not open the gate: `bun test packages/app/tests/services/corpus-check.test.ts` → 37 pass / 0 fail, with `packages/app/tests/services/corpus-check.test.ts:188` proving a newly introduced unlisted finding still fails the sweep and `packages/app/tests/services/corpus-check.test.ts:232` proving a baselined entry that stops reproducing still fails as stale |
| R3 — A reconciliation helper cannot become a suppression tool (@edge) | MET | test | No durable helper was added (`git status` shows no new `scripts/commands/**`; reconciliation ran from gitignored `.spur/run/reconcile-0670.ts` + `.spur/run/reconcile-0670-apply.ts`). The property is enforced structurally by `reconcileBaseline`'s two-sidedness and proven by `packages/app/tests/services/corpus-check.test.ts:232`: an entry for a finding that does not currently reproduce is reported as stale, so it cannot suppress anything. Demonstrated live this run — the `task:0434` entry read stale the moment its finding stopped reproducing. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Functional traceability (R1–R5): all MET.**

- R1 — `docs/00_ADR.md` ADR-083 records the outcome "freeze a dated legacy set", cites probe 1,
  probe 2, and probe 3, and explicitly does not select a matcher change (F61 Scope; F61 AC R2).
- R2 — The probe-1 and probe-2 measurements plus reproduction commands are recorded in ADR-083 as a
  routed proposal against feature F91; `git diff` confirms `packages/app/src/services/task-check.ts`
  is unchanged.
- R3 — 37 baseline entries added (22 `L4.anchor-subject-mismatch`, 10 `L4.stale-line-anchor`,
  4 `L3.unchecked-checklist`, 1 `L3.ac-empty`), all with per-code diagnosis in `note`, a reason
  referencing it, and `since: "2026-08-25"`; the 2 stale `task:0127` / `task:0128`
  `L4.stale-line-anchor` entries deleted. `git diff` shows 0 references to F93-owned codes.
- R4 — Pre (1929 entries, 132 new, 2 stale) and post (1964 entries, 54 new, 1 stale) totals recorded
  with the exact command (`bun run apps/cli/src/index.ts task check --corpus --json`).
- R5 — `packages/app/tests/services/corpus-check.test.ts` passes 37/37 unchanged (two-sidedness
  tests at :188 and :232 kept green, not re-authored).

**SECUA.** No security exposure (policy file + docs only; no secrets, no exec, no new source).
Efficiency: reconciliation driven by exported seams via a one-off script in `.spur/run/` (gitignored,
not a new command surface). Correctness: all 37 added entries reproduce (verified by re-sweep); no
severity lowering; no `--strict` exclusions; the single residual stale entry (`task:0434`) is
pre-existing (2026-08-17) and attributable to other tasks' uncommitted anchor repairs in the working
tree, reported rather than absorbed. Usability: ADR-083 documents the decision and follow-through.
Architecture: baseline stays a two-sided policy file; ownership boundaries (0670 / F93 / F91)
respected; none of the 8 Design anti-patterns implemented.

**Residual risk / disposition.** Approve. The remaining sweep failure (53 `L4.scenario-unverified`
F93 residue, 1 `feature:A5` dogfood warning, 1 `task:0434` stale from other tasks' uncommitted
repairs) is out of 0670's scope and correctly reported as a joint outcome; whole-sweep green depends
on F93 and on committing the other tasks' working-tree edits.

**Priority findings (P1-P4).**

| Priority | Severity | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P3 | Advisory | config/corpus-baseline.json task:0434 entry | Pre-existing stale-line-anchor entry reads stale on this working tree because other tasks uncommitted edits repaired its cited anchors; removal here would break a clean checkout. | Reported as joint-outcome residue; owned by whichever commit lands those repairs. |
| P4 | Advisory | feature F93 handoff | 53 scenario-unverified findings remain unlisted after 0673 closed - the F93 gap this task must not absorb. | Surfaced per R3; recommended re-open as a new F93 task. |
| P4 | Advisory | docs/00_ADR.md ADR-083 | Matcher evidence routed to F91 is a proposal only; F91 must decide before any window change. | Recorded; follow-through is F91 own task. |

No P1 or P2 findings. Residual sweep failure is fully attributed to out-of-scope owners (joint outcome).

### References

- Sibling task that owned the F93 half of the delta: `docs/tasks4/0673_measured-corpus-sweep-report-recovery-unblock-features-and-r.md` (`done` 2026-08-25T22:37Z, F93 — closed with 58 of its 93 findings still unlisted).
- Parent feature (matcher out of scope, AC R2 "matcher unchanged"): `docs/features/F61_corpus-citation-repair-pay-down-the-anchor-drift-the-content-gate-revealed.md`.
- Matcher owner for the probe evidence: feature **F91**.
- Sweep + two-sided reconciliation: `packages/app/src/services/corpus-check.ts`; identity key at `packages/app/src/services/planning-check-base.ts:29`.
- Anchor check and matcher: `packages/app/src/services/task-check.ts:1296-1400` (`checkLineAnchors`), `packages/app/src/services/task-check.ts:327` (`extractSubjectTokens`), `packages/app/src/services/task-check.ts:389` (`citedLinesNameSubject`).
- Two-sidedness tests to keep green: `packages/app/tests/services/corpus-check.test.ts:188`, `packages/app/tests/services/corpus-check.test.ts:232`.
- Commit that introduced the F93 finding codes: `ffacf829` — "feat(f93): durable verification evidence — completion gate reads the tracked task record".
- Gate variants and the corpus-sweep contract: `AGENTS.md` § Verification gate; surface governance: `AGENTS.md` § "Adding a script/command? Four surfaces, one rule" (ADR-051), `docs/design/harness-surface-governance.md`.
- Constitution T10 (a tightened finding code obliges same-commit fallout reconciliation): `docs/99_PROJECT_CONSTITUTION.md`.

### History

- 2026-08-25T22:46:17.430Z backlog → todo (system)
- 2026-08-26T00:07:59.880Z todo → wip (system)
- 2026-08-26T00:28:05.905Z wip → testing (system)
- 2026-08-26T00:36:43.972Z testing → done (system)
