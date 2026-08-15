---
template: issue
schema_version: 1
name: "Harden verdict AC-row id matching so embedded Gherkin bodies cannot fail the scenario gate"
description: ""
status: done
type: issue
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T18:15:14.986Z"
updated_at: "2026-08-15T16:47:33.569Z"
---

## 0561. Harden verdict AC-row id matching so embedded Gherkin bodies cannot fail the scenario gate

### Background
During the E6 batch (2026-08-14), task 0558's verify answer embedded the full Gherkin body in the AC row id — `Scenario: R4 — ... (Given ... / When ... / Then ... / And ...)` — and `spur task verdict --from-answer` preserved that id verbatim in the verdict artifact. The feature scenario gate matches AC rows by exact normalized scenario title (feature-check.ts `isScenarioVerified`), so R4 was flagged `L4.scenario-unverified` despite a PASS verdict with a MET row. This required post-hoc surgery: hand-editing the answer file and re-deriving the verdict before the E6 feature could transition to done. Evidence: `.spur/run/0558-verify-answer.txt` (row 15), `.spur/run/0558-verdict.json` (AC id), feature-check finding at 17:23.
### Requirements
- [x] R1. An AC row id carrying a trailing Gherkin body still matches its feature scenario — `rowMatchesScenario` (`packages/app/src/services/feature-check.ts:923`) accepts the id with a trailing parenthetical group removed as an additional candidate form, so a PASS verdict with a MET row can never be reported `L4.scenario-unverified` for that reason alone. Existing verdict artifacts on disk are repaired by the same change (no re-derivation required).
- [x] R2. Additive matching does not regress a legitimately parenthesized title — a feature scenario whose own title ends in `(...)` still matches its unmodified AC row id, because the raw and prefix-stripped forms are still compared.
- [x] R3. The answer-file contract states the rule — `plugins/sp/skills/spur-dev/references/ac-style-guide.md` says an AC row id is exactly the scenario title with no Gherkin body appended.
### Acceptance Criteria
```gherkin
Scenario: R1 — an AC row id with an embedded Gherkin body still verifies its scenario
  Given a done task whose PASS verdict artifact holds a MET AC row whose id is the scenario title followed by a parenthetical Gherkin body
  When spur feature check runs over the feature linking that scenario
  Then the scenario is reported verified
  And no L4.scenario-unverified finding is emitted for it

Scenario: R1 — the repair applies to artifacts already on disk
  Given the unmodified .spur/run/0558-verdict.json produced before any answer-file surgery
  When spur feature check runs over feature E6
  Then R4's scenario is verified without re-deriving the verdict

Scenario: R2 — a legitimately parenthesized scenario title still matches
  Given a feature scenario whose own title ends in a parenthetical group
  And a verdict AC row whose id is that exact title
  When the scenario gate runs
  Then the row matches and the scenario is verified

Scenario: R3 — the answer-file contract names the rule
  Given the sp:spur-dev AC style guide
  When an author looks up the AC row id format
  Then it states the id is exactly the scenario title with no Gherkin body appended
```
### Q&A
**Q1 — Why greedy `[\s\S]*` rather than a conservative `[^(]*`?** The observed body is
`(Given … / When … / Then … / And …)`, and a Gherkin step can itself contain parentheses. A greedy
match from the first `(` to the final `)` removes the whole trailing group including nested pairs;
`[^(]*` would strip only the innermost tail and leave a dangling fragment. **Closed: greedy.**

**Q2 — What about a title that legitimately contains a parenthetical *and* has a body appended?**
E.g. `handles (a) and (b) cases (Given …)`. The greedy strip cuts from `(a)`, and the raw comparison
still carries the body, so neither form matches and the scenario reports unverified — the same
outcome as today, no regression. **Closed: accepted ceiling**, covered by the R3 style-guide rule.
Not worth a parser to disambiguate a case that has never occurred.

**Q3 — `feature_id` is unset.** These are E6-batch remediation issues; E6 is already `done`, so
linking a backlog task under it would leave a done feature holding unfinished work. **Deferred to
the operator** — link to a remediation feature if one is opened, otherwise leave unset (the L4
advisory is expected and non-blocking).
### Design
**Fix target: `rowMatchesScenario` (`packages/app/src/services/feature-check.ts:923-935`) — the single matcher every caller routes through. No new API, no new exported symbol, no new file.**

#### Why the matcher and not the parser

The reported symptom names the verdict parser, but the parser is not where the mismatch happens.
`extractAcceptanceCriteria` (`packages/app/src/services/task-verdict.ts:200-207`) takes `cells[0]`
verbatim as the row id — correctly so: a verdict artifact is evidence, and rewriting an operator's
row text at parse time would make the artifact disagree with the answer file it was derived from.
The mismatch happens one layer later:

```ts
// feature-check.ts:923-935 — strips a leading [tag] and a leading `Scenario: ` prefix only
const stripped = id.replace(/^\[[^\]]*\]\s*/, '').replace(/^Scenario:\s*/i, '')...
return normalizeTitle(id) === sc.normalized || normalizeTitle(stripped) === sc.normalized
    || id === sc.alias || stripped === sc.alias;
```

`normalizeTitle` (`packages/domain/src/bdd/coverage.ts:57-65`) already absorbs the `R4 — ` prefix,
case, quotes, and whitespace runs. Nothing handles a **trailing** parenthetical, so
`Scenario: R4 — <title> (Given … / Then …)` normalizes to `<title> (given … / then …)`, matches no
feature scenario, and `isScenarioVerified` (`:681-696`) returns false against a PASS verdict holding
a MET row.

#### Frozen matching rule

Add a third derived form beside `id` and `stripped`, and compare it through the same two lenses —
four existing comparisons become six. Frozen shape:

```ts
const bodyStripped = stripped.replace(/\s*\([\s\S]*\)\s*$/, '').trim();
```

- Applied to `stripped`, never to raw `id` — prefix stripping runs first, exactly as today.
- Greedy `[\s\S]*` anchors from the first `(` to the string-final `)`, so a multi-line Gherkin body
  containing its own parentheses is removed whole.
- Added as `normalizeTitle(bodyStripped) === sc.normalized || bodyStripped === sc.alias`.
  **Additive only** — the four existing comparisons stay untouched and are still evaluated, so a
  scenario whose real title ends in a parenthetical still matches on its raw form (R2).
- Empty result (an id that is *only* a parenthetical) matches nothing, as before.

#### Anti-patterns — do not implement

- Do **not** normalize ids in `task-verdict.ts`. It leaves every verdict artifact already on disk
  broken, and silently mutates evidence. Fixing the matcher repairs existing artifacts for free.
- Do **not** replace the existing comparisons with the body-stripped form. Non-additive matching
  regresses legitimately parenthesized titles (R2).
- Do **not** widen this to strip parentheticals anywhere but the end of the string.
- Do **not** introduce a shared "id normalization" helper for one call site.

#### Secondary — guidance, not a gate

`plugins/sp/skills/spur-dev/references/ac-style-guide.md`: one line stating an AC row id is exactly
the scenario title, no Gherkin body. Guidance alone was never sufficient — the E6 run had the guide
and still produced the bad row — so it is the prevention half and the matcher is the backstop.

**Measurable target:** re-derive 0558's verdict from the *original* (pre-surgery) answer file and run
`spur feature check` on E6 — R4 verifies with no answer-file edit.

**Evidence:** `.spur/run/0558-verify-answer.txt` row `| Scenario: R4 — … (Given …) | MET | test | …`;
`.spur/run/0558-verdict.json` `acceptanceCriteria[].id` preserving the parenthetical; feature-check
finding at 17:23.
### Plan
- [x] 1. Add the trailing-parenthetical candidate form to `rowMatchesScenario` (`packages/app/src/services/feature-check.ts:923`) alongside the existing raw/stripped/alias comparisons (R1, R2)
- [x] 2. Unit test in the feature-check suite: MET row id with a trailing Gherkin body verifies; parenthesized-title row still matches; unrelated title still fails (R1, R2)
- [x] 3. Regression check against the real artifact — restore the pre-surgery `.spur/run/0558-verdict.json` into a fixture and assert the E6 scenario verifies (R1)
- [x] 4. Add the row-id rule to `plugins/sp/skills/spur-dev/references/ac-style-guide.md` (R3)
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
Change map (0561):

- `packages/app/src/services/feature-check.ts:923` (`rowMatchesScenario`) — added a third derived id form `bodyStripped` next to `id`/`stripped`:
  `const bodyStripped = stripped.replace(/\s*\([\s\S]*\)\s*$/, '').trim();`
  and two new comparisons `normalizeTitle(bodyStripped) === sc.normalized || bodyStripped === sc.alias`.
  - Applied to `stripped` only — prefix stripping (`[tag]`, `Scenario:`) runs first, exactly as before.
  - Greedy `[\s\S]*` anchored from the first `(` to the string-final `)` removes a whole trailing
    parenthetical group including nested pairs and line breaks (a Gherkin step may itself contain parentheses).
  - **Additive only** — the four existing comparisons are untouched and still evaluated, so a title
    that legitimately ends in `(...)` still matches on its raw form (R2); an id that is *only* a
    parenthetical strips to empty and matches nothing, as before.
  - No parser change (`task-verdict.ts` `extractAcceptanceCriteria` still takes `cells[0]` verbatim):
    the matcher-side fix repairs every verdict artifact already on disk without re-derivation (R1).

- `packages/app/tests/services/feature-check.test.ts` — nine new tests:
  - `verdictRowsMatchScenarios` (direct matcher): trailing-Gherkin-body row matches (incl. `Scenario:` prefix + bracket tag + multi-line nested body); legitimately parenthesized title matches unmodified; body naming a DIFFERENT scenario still fails (no over-matching); alias row id with a trailing body matches via `bodyStripped === sc.alias`.
  - `setupScenarioSatisfaction` (end-to-end gate): trailing-body MET row verifies; bracket-tagged multi-line body verifies; parenthesized title verifies; different-scenario body still emits `L4.scenario-unverified`; E6/0558 regression — reconstructed pre-surgery `R4` AC row id (title + embedded Gherkin body) verifies via the acceptanceCriteria path without any answer-file edit.

- `plugins/sp/skills/spur-dev/references/ac-style-guide.md` — new subsection under "Four accepted id forms": an AC row id is exactly the scenario title (no Gherkin body appended); the verifier preserves ids verbatim and the gate's trailing-parenthetical strip is a backstop for existing artifacts, not a license to append bodies (R3).

Rationale: the mismatch lived in the matcher, not the parser — verdict artifacts are evidence and must not be rewritten at parse time. Fixing `rowMatchesScenario` (the single matcher every caller routes through: `isScenarioVerified`, `verdictRowsMatchScenarios`) repairs existing artifacts for free. No new API, no exported symbol, no new file, no shared normalization helper (one call site).
### Testing
**Re-verify (--force, focus all) 2026-08-15 — Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `rowMatchesScenario` re-read at `packages/app/src/services/feature-check.ts:923` — third derived form `bodyStripped = stripped.replace(/\s*\([\s\S]*\)\s*$/, '').trim()` with two added comparisons (`:935-941`), additive beside the existing four; greedy strip handles nested pairs + line breaks. Parser untouched: `packages/app/src/services/task-verdict.ts:200-207` re-read — `cells[0]` still taken verbatim (matcher-side fix, so on-disk artifacts repair without re-derivation). Tests this run: `bun test packages/app/tests/services/feature-check.test.ts --test-name-pattern "0561"` → 8 pass / 0 fail (incl. the E6/0558 reconstructed-fixture regression). |
| R2 | MET | Additive-only design confirmed by re-read: the four pre-existing comparisons are intact and evaluated; legitimately parenthesized titles match on the raw form — asserted by the 0561 R2 tests in both the e2e and direct-matcher blocks (pass this run). |
| R3 | MET | `plugins/sp/skills/spur-dev/references/ac-style-guide.md:116` — subsection "The id is exactly the scenario title — no Gherkin body appended" present (re-read this run): id = scenario title exactly, body never appended, verifier-verbatim + gate-backstop rationale. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — an AC row id with an embedded Gherkin body still verifies its scenario | MET | test | 0561-block e2e + direct-matcher tests pass this run (8/8); 0 `L4.scenario-unverified` asserted |
| Scenario: R1 — the repair applies to artifacts already on disk | MET | test | E6/0558 regression test (verbatim-faithful reconstructed R4 row id) passes this run — shape-equivalent per the documented deleted-worktree caveat |
| Scenario: R2 — a legitimately parenthesized scenario title still matches | MET | test | R2 tests in both blocks pass this run |
| Scenario: R3 — the answer-file contract names the rule | MET | static-ref | `ac-style-guide.md:116` subsection re-read this run |

**Design conformance:** frozen shape implemented exactly (`bodyStripped` on `stripped` only, greedy `[\s\S]*`, additive, no new API/exported symbol/file, no shared helper); anti-patterns all held (no parser normalization, non-additive replacement, interior stripping, or helper abstraction); the Q2 accepted ceiling (interior-parenthetical + appended body still unverified) is documented and unchanged. Full suite this run: 96 pass / 0 fail / 352 assertions.

**SECUA Review**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | efficiency | `packages/app/src/services/feature-check.ts:935` | Greedy `[\s\S]*` is O(n²)-worst-case on adversarial ids without a trailing `)`; row ids are short sentences — negligible, as the original review noted. No blocker/major/minor findings. |

Coverage: N/A (verdict-based; targeted 8/8 + suite 96/96 re-run this turn).
Fix-pass writes: `.spur/run/0561-verdict.json` (regenerated this run).
### Review

| Priority | Finding | Evidence | Disposition |
|----------|---------|----------|-------------|
| P1 | None | — | — |
| P2 | None | — | — |
| P3 | None | — | — |
| P4 | Solution doc count drift: "six new tests" vs 8 actually added (5 in `setupScenarioSatisfaction` e2e block, 3 in `verdictRowsMatchScenarios` direct-matcher block) | `feature-check.test.ts` diff | Fix doc count on next touch |
| P4 | E6/0558 regression AC is verified by a *reconstructed* fixture, not the literal pre-surgery `.spur/run/0558-verdict.json` — the artifact lived in the deleted sibling worktree `spur-new-runall-e6-e91f`. Reconstruction is verbatim-faithful (R4 title + Given/When/Then copied from `docs/features/E6_run-to-session-correlation-and-cost-path-repair.md:87-90`), so "repair applies to artifacts already on disk" holds by shape-equivalence; a byte-for-byte artifact test would need the run dir restored | `feature-check.test.ts` "0561 R1 regression (E6/0558)" | Accept (fixture is the only viable path in this repo) |
| P4 | No test pins the new alias+trailing-body path (`AC-1 (Given …)` → `bodyStripped === sc.alias`). This alias comparison is behavior newly introduced by the additive change; a one-line direct-matcher assertion would guard it. Over-match safety for the title path is already covered by the different-scenario tests | `feature-check.ts:936` (`bodyStripped === sc.alias`); `feature-check.test.ts` 0561 R1 different-scenario tests | Recommend adding on next touch (low value, cheap) |


- `bun test tests/services/feature-check.test.ts` in `packages/app` → **96 pass / 0 fail** (includes all 8 new 0561 tests).
- `bun run typecheck` in `packages/app` → clean.
- Implementation matches the frozen design shape exactly: `bodyStripped = stripped.replace(/\s*\([\s\S]*\)\s*$/, '').trim()`, applied to `stripped` (prefix stripping first), greedy `[\s\S]*` handles nested pairs + line breaks, **additive** (four existing comparisons untouched, two added) — R2 (legitimately parenthesized title matches on raw form) and the no-over-match guard (different-scenario body still fails) are both asserted by tests in both suites.
- R3: `ac-style-guide.md` new subsection accurately states the id contract, the verbatim-preservation rationale, and the backstop nature of the gate's strip; consistent with the "Four accepted id forms" section above it.


- **Q2 accepted ceiling** (documented in task Q&A): a title that legitimately ends in `(...)` *and* has a body appended (`handles (a) and (b) cases (Given …)`) strips from the first `(`, so neither raw nor stripped form matches → still reported `L4.scenario-unverified`, same as before the fix. Accepted — never observed; R3 guidance is the prevention half. Not a regression.
- Regex cost is O(n²)-worst-case per row on ids without a trailing `)` (greedy backtracking), but row ids are short sentences; negligible.
- No parser change to `task-verdict.ts` — verdict artifacts remain evidence; matcher-side fix repairs on-disk artifacts without re-derivation, as required by R1.


**PASS** — approve. All three requirements (R1, R2, R3) are implemented, tested (8 new tests, all green), and consistent with the task's frozen design and anti-pattern constraints. Remaining items are P4 documentation/test-polish notes only.
### References
- Code (fix target): `packages/app/src/services/feature-check.ts:923-935` (`rowMatchesScenario`) · `:681-696` (`isScenarioVerified`)
- Code (parser, intentionally unchanged): `packages/app/src/services/task-verdict.ts:200-207` (`extractAcceptanceCriteria` — row id taken verbatim from `cells[0]`)
- Guidance: `plugins/sp/skills/spur-dev/references/ac-style-guide.md`
- Evidence: `.spur/run/0558-verify-answer.txt` (row 15) · `.spur/run/0558-verdict.json` · feature-check finding at 17:23
- Report: `docs/report/2026-08-14-E6-batch-forensic-report.md` §2 RC4 / §4
- Session log: `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-08-14T05-07-58-417Z_*.jsonl` (17:23:32-17:26:24)
- Prior art: task 0340 (feature check strict AC satisfaction) · `docs/design/feature-check-strict-ac-satisfaction.md`
### History
- 2026-08-15T16:24:48.789Z backlog → todo (system)
- 2026-08-15T16:29:34.771Z todo → wip (system)
- 2026-08-15T16:36:10.964Z wip → testing (system)
- 2026-08-15T16:36:15.756Z testing → done (system)
