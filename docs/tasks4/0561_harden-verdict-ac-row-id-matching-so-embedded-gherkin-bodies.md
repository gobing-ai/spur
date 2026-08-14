---
template: issue
schema_version: 1
name: "Harden verdict AC-row id matching so embedded Gherkin bodies cannot fail the scenario gate"
description: ""
status: backlog
type: issue
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T18:15:14.986Z"
updated_at: "2026-08-14T19:33:55.707Z"
---

## 0561. Harden verdict AC-row id matching so embedded Gherkin bodies cannot fail the scenario gate

### Background
During the E6 batch (2026-08-14), task 0558's verify answer embedded the full Gherkin body in the AC row id — `Scenario: R4 — ... (Given ... / When ... / Then ... / And ...)` — and `spur task verdict --from-answer` preserved that id verbatim in the verdict artifact. The feature scenario gate matches AC rows by exact normalized scenario title (feature-check.ts `isScenarioVerified`), so R4 was flagged `L4.scenario-unverified` despite a PASS verdict with a MET row. This required post-hoc surgery: hand-editing the answer file and re-deriving the verdict before the E6 feature could transition to done. Evidence: `.spur/run/0558-verify-answer.txt` (row 15), `.spur/run/0558-verdict.json` (AC id), feature-check finding at 17:23.
### Requirements
- [ ] R1. An AC row id carrying a trailing Gherkin body still matches its feature scenario — `rowMatchesScenario` (`packages/app/src/services/feature-check.ts:923`) accepts the id with a trailing parenthetical group removed as an additional candidate form, so a PASS verdict with a MET row can never be reported `L4.scenario-unverified` for that reason alone. Existing verdict artifacts on disk are repaired by the same change (no re-derivation required).
- [ ] R2. Additive matching does not regress a legitimately parenthesized title — a feature scenario whose own title ends in `(...)` still matches its unmodified AC row id, because the raw and prefix-stripped forms are still compared.
- [ ] R3. The answer-file contract states the rule — `plugins/sp/skills/spur-dev/references/ac-style-guide.md` says an AC row id is exactly the scenario title with no Gherkin body appended.
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
- [ ] 1. Add the trailing-parenthetical candidate form to `rowMatchesScenario` (`packages/app/src/services/feature-check.ts:923`) alongside the existing raw/stripped/alias comparisons (R1, R2)
- [ ] 2. Unit test in the feature-check suite: MET row id with a trailing Gherkin body verifies; parenthesized-title row still matches; unrelated title still fails (R1, R2)
- [ ] 3. Regression check against the real artifact — restore the pre-surgery `.spur/run/0558-verdict.json` into a fixture and assert the E6 scenario verifies (R1)
- [ ] 4. Add the row-id rule to `plugins/sp/skills/spur-dev/references/ac-style-guide.md` (R3)
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Code (fix target): `packages/app/src/services/feature-check.ts:923-935` (`rowMatchesScenario`) · `:681-696` (`isScenarioVerified`)
- Code (parser, intentionally unchanged): `packages/app/src/services/task-verdict.ts:200-207` (`extractAcceptanceCriteria` — row id taken verbatim from `cells[0]`)
- Guidance: `plugins/sp/skills/spur-dev/references/ac-style-guide.md`
- Evidence: `.spur/run/0558-verify-answer.txt` (row 15) · `.spur/run/0558-verdict.json` · feature-check finding at 17:23
- Report: `docs/report/2026-08-14-E6-batch-forensic-report.md` §2 RC4 / §4
- Session log: `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-08-14T05-07-58-417Z_*.jsonl` (17:23:32-17:26:24)
- Prior art: task 0340 (feature check strict AC satisfaction) · `docs/design/feature-check-strict-ac-satisfaction.md`
### History
