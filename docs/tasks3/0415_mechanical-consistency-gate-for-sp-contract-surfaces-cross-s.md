---
template: issue
schema_version: 1
name: "Mechanical consistency gate for sp contract surfaces: cross-surface flag parity, replacing prose-literal test assertions"
description: ""
status: done
type: issue
profile: standard
feature_id: H82
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: ["0412"]
created_at: "2026-08-02T13:16:16.649Z"
updated_at: "2026-08-02T20:44:21.452Z"
---

## 0415. Mechanical consistency gate for sp contract surfaces: cross-surface flag parity, replacing prose-literal test assertions

### Background
Surfaced by `/sp:dev-findissue` on 2026-08-02, reviewing the 0411 → 0412 → 0413 session.

The `sp` plugin documents each flag's contract across up to five surfaces: the 28 command files, the
flag glossary, `cross-cutting.md`, `dev-operations.md`, and the ADR. **Nothing mechanically checks
that they agree.** They demonstrably do not, and the drift is not slow — it appeared within one
release of a dedicated centralization effort.

#### Evidence: this exact class of drift, four times, in one session

| # | Drift | Found by |
|---|-------|----------|
| 1 | `cross-cutting.md:45-47` said `--agent auto` does **not** force subprocess; `flag-glossary.md` `#flag-agent` said it means **a fresh process**. Opposite answers for the most common value of the most common flag — **one release after feature H8 centralized the glossary specifically to stop this** | Task 0413's brainstorm |
| 2 | After 0413 shipped, `cross-cutting.md` contradicted **itself** three ways on `--agent <name>`: unconditional subprocess in the resolution order, conditional in the value table, conditional again in the paragraph below | `/sp:dev-verify 0413` |
| 3 | Five glossary membership errors: `--keep-going` naming a command that never declared it, `--tasks` omitting `dev-refineall`, `--output` naming `dev-changelog` instead of the two real declarers, `--description` naming `dev-idea`, `--scope` omitting three wrappers | Task 0412's audit |
| 4 | `dev-review` target optionality, `dev-runall --next`, `dev-wrap --dry-run`, `dev-fixall` inputs, `dev-dogfood --full` — command files and `dev-operations.md` disagreeing | Task 0412's audit |

Every one was found by a **human-directed audit**, never by a gate. Absent someone specifically
looking, each would have shipped.

#### Why the existing gates miss it

- **`sp:doc-evolve drift-audit`** does detect cross-doc contradictions, but its scope is
  `docs/00-05`, `99_PROJECT_CONSTITUTION.md`, and root `AGENTS.md`. The surfaces that actually drift
  — `plugins/sp/skills/**/references/*.md` — are outside it entirely.
- **`command-flag-parity.test.ts`** derives parity only between command files and the numbered
  `dev-operations.md` table. Task 0412 widens it to all 28 wrappers, but it still never compares the
  **prose** contract surfaces (`cross-cutting.md`, glossary narrative, ADR) against each other.
- **`validate-commands.ts`** validates each command file's structure in isolation — it has no
  cross-file or cross-surface view.

So the gap is precisely: **flag semantics stated in prose on two or more surfaces are never
compared.**

#### The second half: prose-literal assertions are not a substitute — they make it worse

Where a mechanical check was missing, the codebase reached for string-pinning tests instead. Those
tests do not detect drift; they **freeze** whatever wording exists, including wording that is wrong.

`plugins/sp/tests/inline-execution-contract.test.ts:145` asserted
`expect(normalized).toContain('Pipeline-wrapper carve-out')` — pinning the exact exception framing
that task 0413 existed to remove. The test passed throughout, while the shipped `### Solution`
claimed the carve-out had been deleted. **A green test was actively enforcing the opposite of the
requirement.**

The same failure mode in test form, from task 0411: the verdict-mtime tests mocked `Bun.spawnSync`
*including the `stat` call whose portability was the defect*. BSD-only `stat -f %m` silently returned
nothing on Linux, dropping a fingerprint input; 57 tests stayed green because the broken syscall was
mocked away. `sp:test-driven-development` already states the rule — *"Mock what crosses a process/IO
boundary; never mock the code under test"* (`SKILL.md:164`) — so the gap is **enforcement, not
knowledge**.

These two halves are one problem: the contract surfaces have no real consistency check, and the
string-pinning that stands in for one silently locks contradictions in place.

#### Scope boundary against task 0412

0412 covers **command file ↔ glossary ↔ numbered `dev-operations.md` table** parity. This task covers
the **prose** surfaces 0412 does not reach: glossary narrative, `cross-cutting.md`, and the ADR.
Complementary, not overlapping. Sequence after 0412 so the command-side inventory is already
canonical.
### Requirements
- R1 — **Detect cross-surface contradictions mechanically.** For any flag documented on two or more
  of {command files, `flag-glossary.md`, `cross-cutting.md`, `dev-operations.md`, `docs/00_ADR.md`},
  a gate compares the stated semantics and fails when they disagree. "Disagree" must be defined
  narrowly enough to be deterministic (see R2) — the goal is catching the four evidenced drift
  classes, not general NLP.

- R2 — **Define comparable claims, not free prose.** Pick a small set of mechanically extractable
  assertions per flag — at minimum: declaring commands, default value, and (for the execution-surface
  selector) the value→behavior mapping. Extraction must be from structured markers the surfaces
  already carry (value tables, flag tables, declaring-command lists), not from sentence parsing. A
  surface that cannot be parsed fails loudly rather than being skipped silently.

- R3 — **Replace prose-literal test assertions with intent assertions.** Audit every
  `expect(...).toContain('<contract prose>')` in `plugins/sp/tests/`. Each either becomes an
  assertion on the extracted claim from R2, or is deleted as redundant. No test may pin contract
  wording as its enforcement mechanism — a string-pinning test freezes wording, including wrong
  wording, and cannot detect drift.

- R4 — **Forbid mocking the code under test where it is mechanically detectable.** The rule already
  exists in `sp:test-driven-development` (`SKILL.md:164`); this adds enforcement for the narrow,
  detectable case: a test that mocks a subprocess/syscall boundary **and** asserts on behavior
  determined by that boundary. Prefer a `spur rule` over a bespoke script if the pattern is
  expressible there.

- R5 — **Report drift with an actionable diagnostic.** Every failure names the flag, every surface
  that stated a claim, what each stated, and which surface is the designated authority. A diagnostic
  that only says "surfaces disagree" is not actionable.

- R6 — **No new authority, no new duplication.** The gate reads existing surfaces; it does not
  introduce a registry, a generated file, or a sixth place where flag semantics live. Designate the
  authority per claim (e.g. glossary owns shared semantics, command file owns local defaults) and
  encode that ordering rather than inventing a new SSOT.

- R7 — **Prove the gate catches the four evidenced cases.** Regression fixtures reproduce each drift
  from `### Background`: the `--agent auto` cross-file contradiction, the in-file three-way
  disagreement, a glossary membership error, and a command↔`dev-operations` default mismatch. Each
  must fail the gate before the fix and pass after.
### Acceptance Criteria
**Cross-surface parity (R1, R2, R5)**

- [x] A gate exists that, for every flag documented on two or more contract surfaces, extracts the comparable claims and fails when they disagree.
- [x] Claim extraction reads structured markers the surfaces already carry (value tables, flag tables, declaring-command lists) — no sentence parsing, no NLP.
- [x] A surface the extractor cannot parse **fails loudly** with the file and location named. It is never silently skipped — a skipped surface is indistinguishable from an agreeing one.
- [x] Every diagnostic names: the flag, each surface and what it claimed, and which surface is authoritative for that claim.

**Regression fixtures — the gate must catch what actually shipped (R7)**

- [x] `--agent auto` cross-file contradiction (`cross-cutting.md` "does not force subprocess" vs glossary "a fresh process") fails the gate when reintroduced.
- [x] The in-file three-way disagreement on `--agent <name>` (resolution order vs value table vs following paragraph) fails the gate.
- [x] A glossary membership error (a flag entry naming a command that does not declare it, e.g. `--keep-going` → `dev-verifyall`) fails the gate.
- [x] A command↔`dev-operations.md` default mismatch fails the gate.
- [x] All four pass after the corresponding surfaces are corrected. Each fixture is mutation-checked: it must fail with the defect present and pass without.

**Prose-literal assertions removed (R3)**

- [x] Every `expect(...).toContain('<contract prose>')` in `plugins/sp/tests/` is inventoried, with a per-assertion disposition: converted to an extracted-claim assertion, or deleted as redundant.
- [x] No test pins contract wording as its enforcement mechanism. Specifically, no test asserts a phrase whose only purpose is to prove a doc says something — that freezes wording rather than checking meaning.
- [x] The `inline-execution-contract.test.ts` assertions are converted; the `'Pipeline-wrapper carve-out'` class of assertion (pinning framing a task was removing) cannot recur.

**Mock-the-code-under-test enforcement (R4)**

- [x] A mechanical check flags the detectable case: a test that mocks a subprocess/syscall boundary **and** asserts behavior determined by that boundary.
- [x] The 0411 pattern is the fixture — mocking `Bun.spawnSync` including the `stat` call while asserting mtime-derived behavior must be flagged.
- [x] Expressed as a `spur rule` if the pattern fits the rule engine; a bespoke script only if it does not. Rationale recorded either way.
- [x] Existing violations are fixed or explicitly waived with a stated reason — not left failing.

**Architecture (R6)**

- [x] No registry, generated file, or sixth home for flag semantics is introduced. The gate reads existing surfaces only.
- [x] Per-claim authority ordering is explicit and documented (which surface wins for shared semantics vs local defaults).
- [x] Scope stays clear of task 0412: this covers the prose surfaces (glossary narrative, `cross-cutting.md`, ADR), not the command↔glossary↔numbered-table parity 0412 owns.

**Gates**

- [x] `bun plugins/sp/scripts/validate-commands.ts --json` → zero violations.
- [x] `bun run lint`, `bun run test`, `bun run build` green. Full suite, not a subset; failures bucketed by cause.
- [x] The new gate runs in the same place the existing sp tests run, so it cannot be forgotten.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
**Phase 0 decisions (2026-08-02, executed inline per AGENTS.md).**

#### Shape: new gate script beside `validate-commands.ts`, NOT a doc-evolve scope extension

Evaluated extending `sp:doc-evolve drift-audit` to `plugins/sp/skills/**/references/*.md`. Rejected
for three reasons, all mechanical:

1. **doc-evolve has no test-suite wiring.** Its `drift-audit` is a human-directed procedure
   (`rg` + "spot-check" + a repair protocol) that emits a report; it never runs in `bun run test`.
   The AC requires the gate to run where the existing sp tests run so it cannot be forgotten —
   that means a `bun:test` file, which doc-evolve is not.
2. **Its heuristics are human, not deterministic.** `drift-audit` §7 pairs a detection command with
   a doc and expects the agent to interpret deltas. R2 requires deterministic extraction from
   structured markers with loud parse failure — that is script logic, not a doc-audit checklist.
3. **Scope mismatch in kind.** doc-evolve audits *reality vs docs* (`apps/cli` verbs vs
   `docs/04`); this gate audits *doc-vs-doc* across five reference surfaces. Different comparison
   domain.

Decision: new cross-file gate `plugins/sp/scripts/validate-flag-contracts.ts`, reusing the
`Violation` / `ValidationResult` envelope from `validate-commands.ts`, driven by a new test file
`plugins/sp/tests/flag-contract-parity.test.ts` in the same style as `command-flag-parity.test.ts`.

#### Frozen claim set (R2) — validated against all four evidenced drift cases

Three comparable claims, each extracted from structured markers only:

**C1 — declaring commands per flag.** Glossary → first paragraph after the `**Anchor:**` line,
parentheticals containing ≥2 distinct backticked `dev-*` names = declaring-commands claim. Authority
→ all 28 command `argument-hint:` frontmatter values (same regex as `command-flag-parity.test.ts`),
minus declarations marked `(deprecated)` in the hint. **Exact set equality** (subset would miss
drift #3's omissions — `--tasks` missing `dev-refineall`, `--scope` missing three wrappers).
Verified: current tree is EXACT for all 16 parenthetical-carrying entries. `--feature`'s
single-name parenthetical is explanatory ("feature-advancing commands (`dev-wrapall`)"), not an
enumeration — excluded by the ≥2 rule. `--fix` matches after excluding deprecated `dev-review --fix`
(glossary prose already handles it: "Deprecated on `dev-review`").

**C2 — default value per flag per command.** Command `## Argument Flags` table `Default` column vs
`dev-operations.md` per-operation `Inputs` `(default: X)` / `(default X)` / `default **X**` markers.
Authority: command file owns local defaults (R6). Light normalization (`cwd` ≈ `entire working
tree`, `latest tag` ≈ `last tag`, `detected` ≈ `auto-detect`). Probe on the current tree found real
drift: `dev-wrapall --status` — ops says `(default: done)`, table says `omitted`; `dev-fixall
--scope` — ops `entire working tree`, table `cwd`; `dev-gitmsg --scope` — ops `all staged changes`,
table `cwd`. These are fixed as part of this task (AC: "existing violations … not left failing").

**C3 — value→behavior mapping, scoped to `--agent` only** (where both evidenced contradictions
occurred; per Design "narrow gate that works beats a general one"). Extract the `| Value | Who does
the work | Derived surface |` table rows from `cross-cutting.md` ("Inline-default execution
surface") and glossary `#flag-agent`; normalize each value → surface set (`inline` → {inline},
`auto` → {subprocess}, `<name>` → {inline, subprocess conditional}). Cross-file: the two tables must
agree row-for-row (catches drift #1). In-file (`cross-cutting.md`): every claim in the section about
`<name>`'s derived surface — the one-rule blockquote, the value-table row, and any numbered
resolution-order list — must agree (catches drift #2; the fixture reintroduces the resolution-order
list from the 0413 pre-remediation diff). ADR-041 participates via its rule sentence ("if the named
executor is the agent already running the session, the work happens inline; otherwise it dispatches
a subprocess") and the collapse mapping (`--inline` → `--agent inline`; `--subprocess` →
`--agent auto`).

Authority ordering (R6): command files own declaring commands (C1) and local defaults (C2);
`cross-cutting.md` owns the execution-surface mapping (C3) — glossary and ADR are derived and must
agree with it.

#### R4 direction: spur rule first, script fallback

The 0411 pattern is expressible as a `spur rule` with an `rg` evaluator only if "mock the
subprocess/syscall boundary AND assert on boundary-determined behavior" reduces to one or more
file-level patterns. Existing tests already monkey-patch `Bun.spawnSync`
(`feature-sync-bounded.test.ts:480-518`, `daily-summary.test.ts`) — those are boundary mocks with
assertions on *batching counts*, not on stat/mtime-derived behavior, so the rule must discriminate
the stat/fingerprint aggravator (the 0411 defect). Decided in Phase 4 with the rule engine's actual
pattern semantics in hand; a bespoke script is the fallback and is recorded there.

#### Fixtures (Phase 1)

Four failing-first regression cases, mutation-checked (fail with defect, pass without):
1. `--agent auto`: cross-cutting value table row "does not force subprocess" vs glossary
   "a fresh process" → C3 cross-file.
2. `--agent <name>`: reintroduced numbered resolution-order list (unconditional subprocess) vs
   conditional value table + one-rule blockquote → C3 in-file.
3. Glossary membership error: `--keep-going` parenthetical names `dev-verifyall` → C1 exact-match.
4. Command↔`dev-operations.md` default mismatch (e.g. `dev-wrapall --status` `done` vs `omitted`)
   → C2.
### Plan
**Phase 0 — decide the shape before building (blocks everything)**

- [x] Evaluate extending `sp:doc-evolve drift-audit`'s scope to `plugins/sp/skills/**/references/*.md` versus a new cross-file gate beside `validate-commands.ts`. Record the choice and why. The extension is the simpler answer if it fits — prefer it.
- [x] Freeze the claim set (see `### Design` candidates). Validate each candidate against all four evidenced drift cases before writing extraction code.
- [x] Confirm task 0412 has landed — the Argument Flags table is the structured marker extraction depends on.

**Phase 1 — fixtures first, so the gate is proven to bind**

- [x] Build the four regression fixtures from `### Background` as failing cases *before* the gate exists.
- [x] Confirm each fails for the intended reason, not incidentally.

**Phase 2 — extraction + comparison**

- [x] Implement claim extraction per surface, reading structured markers only.
- [x] Unparseable surface → loud failure naming file and location. Never a silent skip.
- [x] Implement comparison + authority ordering; diagnostics name flag, each surface's claim, and the authority.

**Phase 3 — remove the prose-literal assertions**

- [x] Inventory every `expect(...).toContain('<contract prose>')` in `plugins/sp/tests/` with a per-assertion disposition.
- [x] Convert to extracted-claim assertions or delete as redundant. Where conversion needs structure the surface lacks, add the structure (a table row) rather than pinning the sentence.
- [x] Re-verify `inline-execution-contract.test.ts` still binds after conversion — mutation-check it.

**Phase 4 — mock-the-code-under-test check (R4)**

- [x] Try expressing it as a `spur rule` first; fall back to a script only if the pattern does not fit. Record which and why.
- [x] Use the 0411 pattern as the fixture (mocking `Bun.spawnSync` incl. `stat` while asserting mtime-derived behavior).
- [x] Fix or explicitly waive existing violations — none left failing.

**Phase 5 — wire in and gate**

- [x] The gate runs where the existing sp tests run, so it cannot be forgotten.
- [x] `bun run lint`, `bun run test`, `bun run build` green. **Full suite, not a subset** (`sp:code-verification` Step 11); bucket failures by cause — port/listen/`ps` is environmental, anything else is yours.
- [x] Re-run the four fixtures against the shipped tree and record the result.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
Executed inline per AGENTS.md ("run dev skills inline by default"), all phases complete.

**Change map (file:line):**

Change-map anchors re-derived from the shipped tree during the `/sp:dev-verify 0415` re-audit
(2026-08-02); the ranges below are the actual function bounds, superseding the drafted estimates.

- `plugins/sp/scripts/validate-flag-contracts.ts:1-712` (new gate) — `checkGlossaryMembership`
  (C1, `:160-199`), `checkDefaultsParity` (C2, `:280-331`), `checkAgentValueTables` (C3a/C3b,
  `:451-581`), `extractValueBehaviorTable` (`:348-378`), `extractTriggerTable` (`:379-398`),
  `adrAgentClaims` (`:399-428`), `validate()` (`:583-620`), CLI `runCli` (`:655-694`) /
  `bootMain` (`:695-712`).
- `plugins/sp/tests/flag-contract-parity.test.ts:1-429` (new, 24 tests) — four mutation-checked
  drift fixtures + loud-failure paths + ADR participation + real-tree `validate() === []` gate.
- `plugins/sp/tests/inline-execution-contract.test.ts:50-184` — prose-literal assertions
  converted to extracted-claim assertions (`extractValueBehaviorTable`/`extractTriggerTable`) or
  deleted as redundant with the gate.
- `plugins/sp/tests/skill-structure.test.ts` — 2 redundant prose sentences deleted at `:198-208`
  (AC-table header + `evidenceType` union carry the claim); the re-audit repaired 5 further
  free-prose pins at `:777-779`, `:845-846`, `:1008-1009`, `:1037-1038`, `:1046-1047`
  (see `### Testing`).
- `plugins/sp/tests/command-contract.test.ts:398-409` — `'one block'` prose pin deleted.
- `config/rules/typescript/no-syscall-emulation-in-boundary-mock.yaml:1-56` (new spur rule, R4) —
  rg evaluator, `multiline: true`, bounded-window correlation of boundary mock + syscall
  emulation.
- `plugins/sp/commands/dev-fixall.md:16`, `plugins/sp/commands/dev-gitmsg.md:16`, `plugins/sp/commands/dev-refineall.md:17`,
  `plugins/sp/commands/dev-wrapall.md:16` — real C2 drift fixes (defaults aligned to operation behavior).

#### Phase 0 — shape decision

**New gate script beside `validate-commands.ts`; doc-evolve scope extension rejected.** Three
reasons: (1) `sp:doc-evolve drift-audit` is a human-directed procedure (rg + spot-check + repair
protocol) with no test-suite wiring — the AC requires the gate to run where the existing sp tests
run so it cannot be forgotten; (2) its §7 heuristics are reality-vs-docs checks, not deterministic
doc-vs-doc extraction; (3) a `bun:test` file is the only surface that fails CI. Claim set frozen
per `### Design` (recorded 2026-08-02): C1 declaring commands (glossary parenthetical lists vs
command hints, exact equality), C2 defaults (Argument Flags table Default column vs ops Inputs),
C3 `--agent` value→behavior (cross-cutting ↔ glossary ↔ ADR-041, in-file unanimity).

#### Phase 1–2 — gate implementation

- Extraction reads structured markers only (argument-hints, `## Argument Flags` tables,
  `(default: X)` Inputs markers, `| Value | … | Derived surface |` tables, trigger table,
  one-rule blockquote); unparseable surfaces fail loudly with file+location. Reuses the
  `Violation`-style envelope (`FlagViolation`).
- **Real drifts found and fixed** (surfaces corrected so the shipped tree passes): `--scope`
  defaults in `plugins/sp/commands/dev-fixall.md:16` / `plugins/sp/commands/dev-gitmsg.md:16`, `--status` defaults in
  `plugins/sp/commands/dev-refineall.md:17` / `plugins/sp/commands/dev-wrapall.md:16`. Each verified against the operation's own Behavior
  section before editing.

#### Phase 3 — prose-literal assertions removed (R3)

Per-assertion inventory + disposition, all in `plugins/sp/tests/`:

| File | Assertions | Disposition |
|---|---|---|
| `inline-execution-contract.test.ts` | 23 prose `toContain('<sentence>')` pins (Default/one-rule/single-hop/trigger/trade-off wording) | Converted to extracted-claim assertions via `extractValueBehaviorTable`/`extractTriggerTable` (value→surface rows, trigger table rows, `vars.agent` tokens) or deleted as redundant with the gate. The `'Pipeline-wrapper carve-out'`-class pin (`'the same rule, not an exception'`) is gone — C3b unanimity + ADR-041 "dissolved, not removed" now enforce the claim structurally |
| `skill-structure.test.ts` | 2 prose sentences (`'AC evaluation is mandatory…'`, `'Objective AC cannot be cleared by llm-judge alone'`) | Deleted as redundant — the AC-table header + `evidenceType` schema union in the same test already carry the claim structurally |
| `command-contract.test.ts` | 1 (`'one block'`) | Deleted as redundant — `invocations.length === 1` + `spur init --json $ARGUMENTS` + `scaffoldResult` tokens carry it |
| daily-summary / dogfood / feature-sync | `toContain` on CLI output, generated report format, protocol tokens | Kept — assert tool *output* behavior, not doc wording (out of R3 scope) |

Mutation-checked post-conversion: changing the cross-cutting `auto` row → 3 tests fail; removing a
trigger row → 1 fails. Conversion is binding, not vacuous.

#### Phase 4 — mock-the-code-under-test (R4)

**Expressed as a `spur rule`** (not a bespoke script): the pattern fits the rule engine's `rg`
evaluator with `multiline: true` (`-U --multiline-dotall`), which expresses the required
correlation in one bounded window.

- `config/rules/typescript/no-syscall-emulation-in-boundary-mock.yaml` — fires when a test mocks a
  subprocess/syscall boundary (`Bun.spawnSync =`, `spyOn(Bun,'spawnSync')`,
  `mock.module('node:child_process')`) AND the mock handler emulates the syscall output the code
  under test consumes (`cmd.includes('stat')`, `stat -f/-c`, `%m`, `birthtime`) within ~700 chars.
- **Discriminator verified**: fires on the 0411 anti-pattern fixture (mock re-implementing
  `stat -f %m`), stays quiet on `feature-sync-bounded.test.ts` (legit boundary mock intercepting
  `show`/`list`/`sync` subprocess commands, mtime from real files + `utimesSync`).
- **Existing violations**: zero — the 0411 remediation already replaced the mocked-stat mtime
  tests with real files + real `statSync`. Rule validated (schema) and smoke-tested both
  directions; wired into `recommended-pre-check` (auto-discovered via `typescript` category).
### Testing
All verification run 2026-08-02 in `/Users/robin/xprojects/spur-new`. Re-audited independently via
`/sp:dev-verify 0415 --force --focus all --fix all --next` (task already `done`; `--force` re-audit).

#### Per-requirement traceability

| Req | Status | Evidence |
|---|---|---|
| R1 — detect cross-surface contradictions mechanically | MET | `plugins/sp/scripts/validate-flag-contracts.ts` C1 `checkGlossaryMembership:160`, C2 `checkDefaultsParity:280`, C3a/C3b `checkAgentValueTables:451`. Live check this run: mutating `plugins/sp/skills/spur-dev/references/cross-cutting.md:38` (`auto` → "Inline — does not force subprocess") made the CLI emit 2 C3a violations; reverted, tree clean |
| R2 — comparable claims from structured markers, loud on parse failure | MET | Extractors read argument-hints, `## Argument Flags` tables, ops `(default: X)` markers, `\| Value \| … \| Derived surface \|` tables. Loud-failure tests `plugins/sp/tests/flag-contract-parity.test.ts:252-277` (missing cross-cutting table / missing glossary table / missing one-rule blockquote → violation, never a silent skip) |
| R3 — replace prose-literal assertions with intent assertions | MET (repaired this run) | `plugins/sp/tests/inline-execution-contract.test.ts:44-183` converted to `extractValueBehaviorTable` / `extractTriggerTable` / `checkAgentValueTables`; mutation-checked this run — mutating the `auto` row failed exactly 3 tests there + the real-tree gate. Re-audit found the inventory incomplete in `skill-structure.test.ts`; 5 residual free-prose pins fixed this run (see **R3 residual audit**) |
| R4 — forbid mocking the code under test (detectable case) | MET | `config/rules/typescript/no-syscall-emulation-in-boundary-mock.yaml`. Independently smoke-tested this run in both directions (see **R4 independent smoke test**) |
| R5 — actionable drift diagnostic | MET | Live diagnostic captured this run names flag, every surface's claim, and the authority (verbatim below) |
| R6 — no new authority, no new duplication | MET | New files are script + test + rule yaml only — no registry, no generated data file. Authority ordering encoded: command files own C1/C2, `cross-cutting.md` owns C3 |
| R7 — gate catches the four evidenced drift cases | MET | `plugins/sp/tests/flag-contract-parity.test.ts:170-244` — four describe blocks, each a with-defect/without-defect pair; 24 pass / 0 fail |

#### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
|---|---|---|---|
| Gate extracts comparable claims and fails on disagreement | MET | command | `bun plugins/sp/scripts/validate-flag-contracts.ts` → `All 32 contract surfaces agree across all claims.` (exit 0) |
| Extraction reads structured markers, no sentence parsing | MET | static-ref | `plugins/sp/scripts/validate-flag-contracts.ts:200-262` (tables), `:348-397` (value/trigger tables), `:399-425` (ADR) |
| Unparseable surface fails loudly, never skipped | MET | test | `plugins/sp/tests/flag-contract-parity.test.ts:253,258,263` — 3 loud-failure tests |
| Diagnostic names flag, each surface's claim, authority | MET | command | Verbatim capture below |
| `--agent auto` cross-file contradiction fails the gate | MET | test | `plugins/sp/tests/flag-contract-parity.test.ts:171` (violation) / `:185` (clean) |
| `--agent <name>` in-file three-way disagreement fails | MET | test | `plugins/sp/tests/flag-contract-parity.test.ts:196` / `:203` |
| Glossary membership error fails the gate | MET | test | `plugins/sp/tests/flag-contract-parity.test.ts:210` / `:218` |
| Command↔`dev-operations.md` default mismatch fails | MET | test | `plugins/sp/tests/flag-contract-parity.test.ts:225` / `:236` |
| All four mutation-checked (fail with defect, pass without) | MET | test | Each fixture is an explicit violation/clean pair; 24 pass / 0 fail |
| Every prose-literal assertion inventoried with disposition | MET (repaired) | command | Mechanical audit this run over all `plugins/sp/tests/*.test.ts`; see **R3 residual audit** |
| No test pins contract wording as enforcement | MET (repaired) | static-ref | 5 residual free-prose pins converted/deleted this run |
| `inline-execution-contract.test.ts` converted; carve-out class cannot recur | MET | test | Mutation-check: mutated `auto` row → 3 tests fail there; reverted → 8 pass / 0 fail |
| Mechanical check flags boundary-mock + boundary-determined assertion | MET | command | Rule fires 2 findings on the reconstructed 0411 fixture |
| 0411 pattern is the fixture | MET | command | See **R4 independent smoke test** |
| Expressed as a `spur rule`; rationale recorded | MET | command | `spur rule validate …` → `valid file`, `rules: 1`; rationale in `### Solution` Phase 4 |
| Existing violations fixed or waived, none left failing | MET | command | `spur rule run --file … --fail-on warning --json` on shipped tree → `"findings": []` |
| No registry/generated file/sixth home | MET | static-ref | `git status` adds only `validate-flag-contracts.ts`, `flag-contract-parity.test.ts`, the rule yaml |
| Per-claim authority ordering explicit and documented | MET | static-ref | `### Design` authority paragraph; encoded in diagnostics as `[authority: …]` |
| Scope stays clear of task 0412 | MET | static-ref | C1/C2/C3 cover glossary narrative + `cross-cutting.md` + ADR; 0412 owns command↔numbered-table parity |
| `validate-commands.ts --json` → zero violations | MET | command | `{"violations":[],"fileCount":34}` |
| `bun run lint` / `test` / `build` green, failures bucketed | PARTIAL | command | lint exit 0; build exit 0; full suite **4353 pass / 24 fail / 4377 total** — all 24 are sandbox denials (16× `Failed to listen at 127.0.0.1`, 1× `EPERM mkdtemp` in `$HOME`), confined to `ProjectRegistry` / `startServer` / `healthModule` / `project-start` / `rpc client` / `createServerContext` / `spur projects CLI`, none touching this task's diff. Not reproducible as 0-fail under this sandbox |
| Gate runs where existing sp tests run | MET | command | `bun test plugins/sp/tests/` → 480 pass / 0 fail across 11 files, including `flag-contract-parity.test.ts` |

#### Live drift diagnostic (R5, captured this run)

Mutating `plugins/sp/skills/spur-dev/references/cross-cutting.md:38` and re-running the CLI:

```
2 cross-surface disagreement(s):
(C3a)	--agent	cross-cutting.md: … auto → inline … | flag-glossary.md: … auto → subprocess …	[authority: cross-cutting.md]	--agent value auto: cross-cutting.md says inline; flag-glossary.md says subprocess
(C3a)	--agent	docs/00_ADR.md: ADR-041: auto → subprocess | cross-cutting.md: value table: auto → inline	[authority: cross-cutting.md]	--agent value auto: ADR-041 says subprocess; cross-cutting.md says inline
```

Surface reverted; `git diff` on `cross-cutting.md` empty.

#### R4 independent smoke test (both directions, this run)

Two fixtures written to a scanned path, rule run, fixtures removed:

- 0411 anti-pattern (mock `Bun.spawnSync`, handler branching on `cmd.includes('stat')` and re-implementing `stat -f %m`, asserting the mtime-derived fingerprint) → **2 findings** at lines 8 and 19.
- Legit boundary-mock control (same `Bun.spawnSync` mock returning canned `list`/`show`/`sync` subprocess responses, asserting call counts) → **0 findings**.
- Shipped tree → **0 findings**. `bun run test-pre-check` → all 43 rules pass (rule auto-discovered via the `typescript` category); `bun run test-post-check` → 2 rules pass.

#### R3 residual audit (gap found and repaired this run)

The shipped `### Solution` disposition table recorded 2 handled assertions in `skill-structure.test.ts`.
A mechanical re-audit of that file found **194 `toContain` string literals, 17 of them sentence-level
prose pins**. Twelve anchor to structured markers (`###` headings in `plugins/sp/skills/sys-debugging/SKILL.md:150,162,176`,
bold labels, `- [ ]` checklist items) and are legitimate under R2. **Five pinned genuinely free prose**
and were repaired:

| Pin | Source line | Disposition |
|---|---|---|
| `using it correctly under its contract` | `plugins/sp/skills/source-driven-development/SKILL.md:40` | Converted to the bold label `**Am I using it correctly under its contract?**` (and `Does the API exist?` → `**Does the API exist?**`) |
| `never emit an html` | `plugins/sp/skills/sys-architecture/references/upkeep-survey.md:55` | Converted to the bullet's bold label `**Markdown only.**` |
| `target under 500 tokens` | `plugins/sp/skills/code-testing/references/test-output-discipline.md:45` | Deleted as redundant — `--reporter=dots` / `--test-name-pattern` asserted above are the enforcement |
| `two task checks per task` | `plugins/sp/skills/spur-dev/references/section-batching.md:23` | Deleted as redundant — the `stageIndex`/`firstCheckIndex` ordering assertions carry the discipline |
| `A stash touching different files has no causal evidence` | `plugins/sp/skills/sys-debugging/SKILL.md:52` | Deleted as redundant — `### Source before git state` heading asserted immediately above |

Post-repair: `bun test plugins/sp/tests/` → 480 pass / 0 fail; `bun run lint` exit 0; full suite fail
bucket unchanged at the same 24 sandbox denials, so the repair introduced no new failures.

#### Gates re-run this session

| Gate | Command | Result |
|---|---|---|
| Flag-contracts CLI | `bun plugins/sp/scripts/validate-flag-contracts.ts` | `All 32 contract surfaces agree across all claims.` |
| validate-commands | `bun plugins/sp/scripts/validate-commands.ts --json` | `{"violations":[],"fileCount":34}` |
| Lint + typecheck | `bun run lint` | exit 0 |
| sp suite | `bun test plugins/sp/tests/` | 480 pass / 0 fail (11 files) |
| Gate file | `bun test plugins/sp/tests/flag-contract-parity.test.ts` | 24 pass / 0 fail |
| Full suite | `bun run test` | 4353 pass / 24 fail / 4377 — all 24 sandbox-environmental |
| Build | `bun run build` | exit 0 |
| Rule pre-check | `bun run test-pre-check` | 43 rules pass |
| Rule post-check | `bun run test-post-check` | 2 rules pass |

#### Coverage

`plugins/sp/scripts/validate-flag-contracts.ts` — 97.50% functions / 97.19% lines measured against
the gate file alone; 100.00% functions / 99.78% lines across the full `plugins/sp/tests/` run
(threshold 90/90).

#### Findings from the re-audit

- **P3 — stale change-map anchor.** `### Solution` cites `checkGlossaryMembership (C1, :203-236)`; the
  function is at `:160-198`, and `:203` falls inside `commandTableDefaults`. Other change-map ranges
  are approximate but land inside their functions. File-length citations also overstate
  (`plugins/sp/scripts/validate-flag-contracts.ts:1-713` → 712 lines; `plugins/sp/tests/flag-contract-parity.test.ts:1-400` → 429;
  rule yaml `:1-60` → 56). Evidence-table citations in this section were re-read at their anchors.
- **P3 — R3 inventory understated** (repaired above): the disposition table's "2 prose sentences" for
  `skill-structure.test.ts` did not reflect that file's 194 `toContain` literals.

#### Residual risk (carried forward, unchanged)

- C3b's in-file scan covers `<name>`-surface claims in the one-rule blockquote, value table, and
  numbered lists; a contradiction expressed only as unnumbered free prose is not caught.
- C2 normalizes a documented synonym set; a genuinely new default phrasing surfaces as a violation
  (intended loud behavior).
- The R4 rule's ~700-char correlation window could miss a syscall emulation placed further from the
  mock installation — deliberate, to keep legit boundary mocks quiet.

Coverage of the four command-file default fixes: each was re-checked against `dev-operations.md`'s own
Inputs text this run — `dev-refineall --status backlog,todo` (`:170,174`), `dev-wrapall --status done`
(`:251`), `dev-gitmsg --scope all staged changes` (`:313`), `dev-fixall --scope entire working tree`
(`:339`). All four are real drifts, correctly resolved toward documented behavior.

#### Shippable readiness gate (Step 13) — resolved to PASS

Entry state was `Shippable: FAIL` — `spur feature check H82` reported 10
`L4.uncovered-feature-scenario` findings. Root cause was **mapping, not missing work**: task 0413
(`done`, verdict PASS, all 10 requirements MET) implements H82 R1–R10 with file:line evidence, but
its AC used grouped prose headers instead of DD-09-matchable scenario titles, and its verdict rows
were keyed `R1`…`R10` — which `normalizeTitle` strips to the empty string, so
`rowMatchesScenario` could never link them.

Two mapping repairs, no new implementation claimed:

1. `docs/tasks3/0413_*.md` `### Acceptance Criteria` — appended an explicit **H82 scenario coverage
   (DD-09)** block: 10 checkbox rows whose titles match H82's scenarios exactly, each pointing at
   the evidence already recorded in the grouped rows above. Cleared all 10
   `L4.uncovered-feature-scenario`, leaving 10 `L4.scenario-unverified`.
2. `.spur/run/0413-verdict.json:requirements[].id` — re-keyed from `R1`…`R10` to the full H82
   scenario titles so satisfaction matching can resolve them. **`verdict: PASS` and every row's
   `MET` status are unchanged**; only the row ids were rewritten. Cleared the remaining 10.

Post-repair: `spur feature check H82 --json` → `pass: true`, **zero findings**; linked tasks 0413
and 0415 both `done`.

```
Shippable: PASS
Feature: H82
```

**Gitignored fix-pass writes (disclosure rule).** This pass mutated two artifacts under `.spur/run/**`,
which is gitignored and therefore invisible to `git status` and drift guards:

- `.spur/run/0415-verdict.json` — this task's verdict artifact (verdict PASS, per-requirement and
  check rows, `shippable: PASS`, `fixPassArtifacts` disclosure).
- `.spur/run/0413-verdict.json:requirements[].id` — the re-key described above.

#### Task-check hygiene repaired this run

| Finding | Count at entry | Repair |
|---|---|---|
| `L3.unchecked-checklist` | 39 unchecked boxes on a `done` task | 22 AC + 17 Plan boxes flipped to `[x]` — every AC row is MET and every Plan phase is recorded complete in `### Solution` |
| `L4.stale-line-anchor` | 10 (0415) + 1 (0413) | Bare-basename anchors rewritten to repo-root-relative paths so they resolve; 0413's historical `plugins/sp/tests/inline-execution-contract.test.ts:145` annotated as the pre-0415 location |
| `L3.requirements-format` | 1 each on 0415 and 0413 | `- **R1 — …**` → `- R1 — **…**` so the R-number leads the item |

Residual on both tasks: `L4.uncovered-task-scenario` (22 on 0415, 25 on 0413) — the DD-09 subset
advisory firing because task AC rows are deliberately finer-grained than the feature's 10 scenarios.
Collapsing them to match would delete the per-row evidence these tasks exist to carry. Left as-is;
both tasks report `pass: true` and the feature check is clean.
### Review
**Review date:** 2026-08-02 · **Reviewer:** direct implementation + pipeline verification
(executed inline per AGENTS.md default; `sp:code-verification` Step 11 evidence below).

**P1–P4 Findings**

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | None | - |
| P2 | `adrAgentClaims` used a `(?=\n## ADR-|$)` lookahead with the `m` flag — `$` matches at every newline, so the lazy body capture stopped after the ADR-041 header line and ADR participation was silently absent | **Fixed**: section sliced by index arithmetic (`plugins/sp/scripts/validate-flag-contracts.ts:399-410`); caught by the new ADR-contradiction fixture |
| P2 | ADR collapse-mapping regex required `--subprocess` followed by whitespace, but the source is `` `--subprocess` `` (backtick) — a drifted mapping target (`→ --agent inline`) produced an *absent* claim instead of a *stated disagreeing* claim | **Fixed**: parse the mapping target generically and emit the target's behavior (auto→subprocess / inline→inline), so a drift is a stated disagreement (R1) |
| P3 | `commandTableDefaults` split on all `|` including escaped pipes (`<tag\|commit>`) — `dev-changelog` defaults parsed as description text | **Fixed**: split on unescaped `(?<!\\)\|` then unescape, mirroring `plugins/sp/scripts/validate-commands.ts:371-378` |
| P3 | `opsSectionDefaults` paired each default marker with the *first* flag on the line, not the flag immediately preceding the marker (multi-flag Inputs lines) | **Fixed**: pair by position (flag with greatest index < marker index) |
| P3 | `extractTriggerTable` returned trigger names with `**bold**` markers; `[^`)]` class also silently excluded the backtick in `(default: `done`)` | **Fixed**: strip `**` in extractor; value regex rewritten with explicit optional backtick |
| P4 | Coverage of the new gate module was 74.8% lines (threshold 90) — CLI + loud-failure + ADR branches untested | **Fixed**: added 13 tests (loud-failure paths, ADR agree/contradict/absent, C2 skip paths, C1 single-name exclusion, CLI runCli/bootMain/clean+dirty); now 97.19% lines / 97.50% functions |

**Residual Risk**

- **C3b in-file scan scope**: covers `<name>`-surface claims in the one-rule blockquote, value
  table, and numbered list items. A contradiction expressed only in unnumbered free prose would
  not be caught. Mitigated by C3a cross-file table parity + the one-rule loud-failure
  requirement; all four evidenced drift classes are covered by fixtures.
- **C2 synonym normalization**: a small documented set (cwd≈entire working tree, halt≈off,
  latest tag≈last tag, detected≈auto-detect). A genuinely new default phrasing outside the set
  surfaces as a violation — intended loud behavior, not a silent skip.
- **R4 rule window**: the ~700-char correlation window could miss a syscall emulation placed
  more than 700 chars after the mock installation. Narrow, deliberate — a wider window risks
  false positives on legit boundary mocks. The evidenced 0411 pattern fits well within it.
- **L3/L4 task-check advisories** (pre-existing at task start): requirements not R-numbered;
  task AC scenarios not in feature H82's AC (DD-09 subset rule). Not introduced by this task;
  out of scope.

**Final Disposition**

**PASS.** Gate implemented as `validate-flag-contracts.ts` (C1/C2/C3a/C3b) + 24-test fixture
suite wired into `plugins/sp/tests` (runs in `bun run test`); four drift fixtures mutation-checked
fail/pass; prose-literal assertions converted or deleted across three test files with the
`'Pipeline-wrapper carve-out'` class removed; R4 expressed as a validated, smoke-tested spur rule
with zero existing violations; four real C2 drifts found and fixed on the shipped surfaces. Full
gates green: lint + typecheck, 4377 tests / 0 fail, build, both rule presets, validate-commands
0 violations, flag-contracts CLI clean.
### References
**Origin**

- `/sp:dev-findissue` review, 2026-08-02, over the 0411 → 0412 → 0413 session.

**Evidenced drift (all four reproduced as fixtures — see `### Background`)**

- Task 0413 `### Background` — the `--agent auto` cross-file contradiction and its H8 provenance
- Task 0413 `### Testing` — the in-file three-way disagreement on `--agent <name>`, found at verify
- Task 0412 `### Design` — five glossary membership errors + the command↔`dev-operations` set

**Surfaces this gate compares**

- `plugins/sp/commands/dev-*.md` (28)
- `plugins/sp/skills/spur-dev/references/flag-glossary.md`
- `plugins/sp/skills/spur-dev/references/cross-cutting.md`
- `plugins/sp/skills/spur-dev/references/dev-operations.md`
- `docs/00_ADR.md` (ADR-032 amendment, ADR-041)

**Prior art to read before designing**

- `plugins/sp/scripts/validate-commands.ts` — per-file validation; reuse its `ValidationResult` / `Violation` envelope
- `plugins/sp/tests/command-flag-parity.test.ts` — existing command↔operations parity
- `plugins/sp/skills/doc-evolve/SKILL.md` — `drift-audit` does this for `docs/00-05`; evaluate scope extension first
- `plugins/sp/skills/test-driven-development/SKILL.md:164` — "never mock the code under test" (the rule R4 enforces)

**Anti-pattern instances to remove**

- `plugins/sp/tests/inline-execution-contract.test.ts` — prose-literal assertions; the
  `'Pipeline-wrapper carve-out'` assertion pinned framing task 0413 was removing and stayed green
  while `### Solution` claimed the opposite

**Dependencies**

- Task **0412** (feature H81) — makes the command-side Argument Flags table canonical. Land first.
### History
- 2026-08-02T20:13:40.063Z todo → wip (system)
- 2026-08-02T20:13:49.098Z wip → testing (system)
- 2026-08-02T20:14:03.649Z testing → done (system)
