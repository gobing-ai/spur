---
template: issue
schema_version: 1
name: "Mechanical consistency gate for sp contract surfaces: cross-surface flag parity, replacing prose-literal test assertions"
description: ""
status: todo
type: issue
profile: standard
feature_id: H82
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: ["0412"]
created_at: "2026-08-02T13:16:16.649Z"
updated_at: "2026-08-02T13:16:41.947Z"
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
- **R1 — Detect cross-surface contradictions mechanically.** For any flag documented on two or more
  of {command files, `flag-glossary.md`, `cross-cutting.md`, `dev-operations.md`, `docs/00_ADR.md`},
  a gate compares the stated semantics and fails when they disagree. "Disagree" must be defined
  narrowly enough to be deterministic (see R2) — the goal is catching the four evidenced drift
  classes, not general NLP.

- **R2 — Define comparable claims, not free prose.** Pick a small set of mechanically extractable
  assertions per flag — at minimum: declaring commands, default value, and (for the execution-surface
  selector) the value→behavior mapping. Extraction must be from structured markers the surfaces
  already carry (value tables, flag tables, declaring-command lists), not from sentence parsing. A
  surface that cannot be parsed fails loudly rather than being skipped silently.

- **R3 — Replace prose-literal test assertions with intent assertions.** Audit every
  `expect(...).toContain('<contract prose>')` in `plugins/sp/tests/`. Each either becomes an
  assertion on the extracted claim from R2, or is deleted as redundant. No test may pin contract
  wording as its enforcement mechanism — a string-pinning test freezes wording, including wrong
  wording, and cannot detect drift.

- **R4 — Forbid mocking the code under test where it is mechanically detectable.** The rule already
  exists in `sp:test-driven-development` (`SKILL.md:164`); this adds enforcement for the narrow,
  detectable case: a test that mocks a subprocess/syscall boundary **and** asserts on behavior
  determined by that boundary. Prefer a `spur rule` over a bespoke script if the pattern is
  expressible there.

- **R5 — Report drift with an actionable diagnostic.** Every failure names the flag, every surface
  that stated a claim, what each stated, and which surface is the designated authority. A diagnostic
  that only says "surfaces disagree" is not actionable.

- **R6 — No new authority, no new duplication.** The gate reads existing surfaces; it does not
  introduce a registry, a generated file, or a sixth place where flag semantics live. Designate the
  authority per claim (e.g. glossary owns shared semantics, command file owns local defaults) and
  encode that ordering rather than inventing a new SSOT.

- **R7 — Prove the gate catches the four evidenced cases.** Regression fixtures reproduce each drift
  from `### Background`: the `--agent auto` cross-file contradiction, the in-file three-way
  disagreement, a glossary membership error, and a command↔`dev-operations` default mismatch. Each
  must fail the gate before the fix and pass after.
### Acceptance Criteria
**Cross-surface parity (R1, R2, R5)**

- [ ] A gate exists that, for every flag documented on two or more contract surfaces, extracts the comparable claims and fails when they disagree.
- [ ] Claim extraction reads structured markers the surfaces already carry (value tables, flag tables, declaring-command lists) — no sentence parsing, no NLP.
- [ ] A surface the extractor cannot parse **fails loudly** with the file and location named. It is never silently skipped — a skipped surface is indistinguishable from an agreeing one.
- [ ] Every diagnostic names: the flag, each surface and what it claimed, and which surface is authoritative for that claim.

**Regression fixtures — the gate must catch what actually shipped (R7)**

- [ ] `--agent auto` cross-file contradiction (`cross-cutting.md` "does not force subprocess" vs glossary "a fresh process") fails the gate when reintroduced.
- [ ] The in-file three-way disagreement on `--agent <name>` (resolution order vs value table vs following paragraph) fails the gate.
- [ ] A glossary membership error (a flag entry naming a command that does not declare it, e.g. `--keep-going` → `dev-verifyall`) fails the gate.
- [ ] A command↔`dev-operations.md` default mismatch fails the gate.
- [ ] All four pass after the corresponding surfaces are corrected. Each fixture is mutation-checked: it must fail with the defect present and pass without.

**Prose-literal assertions removed (R3)**

- [ ] Every `expect(...).toContain('<contract prose>')` in `plugins/sp/tests/` is inventoried, with a per-assertion disposition: converted to an extracted-claim assertion, or deleted as redundant.
- [ ] No test pins contract wording as its enforcement mechanism. Specifically, no test asserts a phrase whose only purpose is to prove a doc says something — that freezes wording rather than checking meaning.
- [ ] The `inline-execution-contract.test.ts` assertions are converted; the `'Pipeline-wrapper carve-out'` class of assertion (pinning framing a task was removing) cannot recur.

**Mock-the-code-under-test enforcement (R4)**

- [ ] A mechanical check flags the detectable case: a test that mocks a subprocess/syscall boundary **and** asserts behavior determined by that boundary.
- [ ] The 0411 pattern is the fixture — mocking `Bun.spawnSync` including the `stat` call while asserting mtime-derived behavior must be flagged.
- [ ] Expressed as a `spur rule` if the pattern fits the rule engine; a bespoke script only if it does not. Rationale recorded either way.
- [ ] Existing violations are fixed or explicitly waived with a stated reason — not left failing.

**Architecture (R6)**

- [ ] No registry, generated file, or sixth home for flag semantics is introduced. The gate reads existing surfaces only.
- [ ] Per-claim authority ordering is explicit and documented (which surface wins for shared semantics vs local defaults).
- [ ] Scope stays clear of task 0412: this covers the prose surfaces (glossary narrative, `cross-cutting.md`, ADR), not the command↔glossary↔numbered-table parity 0412 owns.

**Gates**

- [ ] `bun plugins/sp/scripts/validate-commands.ts --json` → zero violations.
- [ ] `bun run lint`, `bun run test`, `bun run build` green. Full suite, not a subset; failures bucketed by cause.
- [ ] The new gate runs in the same place the existing sp tests run, so it cannot be forgotten.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
Not designed yet — this task is filed from a findissue review, not from a solution. What follows is
the constraint set the design must satisfy, plus the traps already identified.

#### The hard part is R2, not R1

Comparing two documents is easy once you know *what* to compare. The failure mode of a task like this
is trying to compare prose and drowning in false positives. So the design work is almost entirely:
**pick the smallest set of claims that (a) covers the four evidenced drift classes and (b) can be
extracted deterministically.**

Candidate claim set — validate before building:

| Claim | Extractable from | Covers evidenced drift |
|---|---|---|
| Declaring commands per flag | command `argument-hint` + glossary "declaring commands" prose | #3 (glossary membership errors) |
| Default value per flag per command | command Argument Flags table (post-0412) + `dev-operations.md` inputs | #4 (command↔operations mismatch) |
| Value→behavior mapping (execution-surface selector only) | `cross-cutting.md` value table + glossary value table + ADR | #1, #2 (`--agent auto` / `<name>`) |

If the third row proves hard to generalize, scoping it to the selector alone is acceptable — that is
where both contradictions occurred, and a narrow gate that works beats a general one that does not.

#### Traps

- **Silent skip is the failure mode.** A parser that shrugs at an unparseable surface reports "no
  disagreement" — indistinguishable from agreement. R2/AC require loud failure. This is the single
  most likely way to ship a gate that proves nothing.
- **Prose-literal assertions are the anti-pattern, not the fallback.** When extraction is hard, the
  tempting shortcut is `toContain('some sentence')`. That is exactly what this task removes. If a
  claim cannot be extracted structurally, add the structure to the surface (a table row) rather than
  pinning the sentence.
- **Authority must be encoded, not assumed.** "They disagree" is only actionable with "and this one
  wins." Without it the gate produces a standoff and someone picks arbitrarily — how drift #1 lasted
  a full release.
- **Do not become a sixth surface.** The moment the gate carries its own table of expected values, it
  is a registry and it will itself drift. It must derive everything from the surfaces it checks.

#### Sequencing

After task **0412** (feature H81). 0412 makes the command-side Argument Flags table canonical and
machine-readable, which is the structured marker most of the extraction depends on. Running this
first would mean building extraction against a surface 0412 is about to reshape.

#### Prior art in-repo

- `plugins/sp/scripts/validate-commands.ts` — per-file structural validation; the natural place for a
  cross-file sibling, and its `ValidationResult` / `Violation` envelope is worth reusing.
- `plugins/sp/tests/command-flag-parity.test.ts` — existing command↔operations parity; extend the
  pattern rather than inventing a second one.
- `sp:doc-evolve drift-audit` — the same idea for `docs/00-05`; worth reading for its contradiction
  heuristics before designing new ones. Consider whether this belongs as a *scope extension* of
  doc-evolve rather than a new script. **Evaluate that option explicitly** — a scope extension is the
  simpler answer if it fits.
### Plan
**Phase 0 — decide the shape before building (blocks everything)**

- [ ] Evaluate extending `sp:doc-evolve drift-audit`'s scope to `plugins/sp/skills/**/references/*.md` versus a new cross-file gate beside `validate-commands.ts`. Record the choice and why. The extension is the simpler answer if it fits — prefer it.
- [ ] Freeze the claim set (see `### Design` candidates). Validate each candidate against all four evidenced drift cases before writing extraction code.
- [ ] Confirm task 0412 has landed — the Argument Flags table is the structured marker extraction depends on.

**Phase 1 — fixtures first, so the gate is proven to bind**

- [ ] Build the four regression fixtures from `### Background` as failing cases *before* the gate exists.
- [ ] Confirm each fails for the intended reason, not incidentally.

**Phase 2 — extraction + comparison**

- [ ] Implement claim extraction per surface, reading structured markers only.
- [ ] Unparseable surface → loud failure naming file and location. Never a silent skip.
- [ ] Implement comparison + authority ordering; diagnostics name flag, each surface's claim, and the authority.

**Phase 3 — remove the prose-literal assertions**

- [ ] Inventory every `expect(...).toContain('<contract prose>')` in `plugins/sp/tests/` with a per-assertion disposition.
- [ ] Convert to extracted-claim assertions or delete as redundant. Where conversion needs structure the surface lacks, add the structure (a table row) rather than pinning the sentence.
- [ ] Re-verify `inline-execution-contract.test.ts` still binds after conversion — mutation-check it.

**Phase 4 — mock-the-code-under-test check (R4)**

- [ ] Try expressing it as a `spur rule` first; fall back to a script only if the pattern does not fit. Record which and why.
- [ ] Use the 0411 pattern as the fixture (mocking `Bun.spawnSync` incl. `stat` while asserting mtime-derived behavior).
- [ ] Fix or explicitly waive existing violations — none left failing.

**Phase 5 — wire in and gate**

- [ ] The gate runs where the existing sp tests run, so it cannot be forgotten.
- [ ] `bun run lint`, `bun run test`, `bun run build` green. **Full suite, not a subset** (`sp:code-verification` Step 11); bucket failures by cause — port/listen/`ps` is environmental, anything else is yours.
- [ ] Re-run the four fixtures against the shipped tree and record the result.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
