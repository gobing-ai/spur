---
schema_version: 1
name: Verify the claimed confidence level is earned by the verdict evidence
status: done
template: standard
created_at: 2026-10-08T22:44:30.518Z
updated_at: "2026-10-09T17:11:28.541Z"

ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1133-verdict.json
---

## 1133. Verify the claimed confidence level is earned by the verdict evidence

### Background

Task 1068 made every verify answer carry a `Confidence: HIGH|MEDIUM|LOW` line, lint-verified for
presence and closed vocabulary, and carried it into the verdict artifact. The done gate refuses a
`PASS` artifact that states no confidence (`done-transition-guard.ts:413`). Task 1123 — "require a
usable confidence level at the done gate" — was cancelled, so enforcement stops at presence.

Nothing verifies that the stated level is **earned by the evidence in the same answer**. A verifier
can assert `HIGH` beside a `PARTIAL`/`UNMET` row, or bury an all-`MET` answer under `LOW`, and the
lint reports no finding for the level in either direction. Observed live on this run: the task 1131
verify answer was submitted with `Confidence: HIGH` while its row `R3` read `UNMET`, and
`spur task verdict` returned zero lint findings — the only complaints were the invalid row-status
vocabulary and an AC-identity mismatch, never the level.

The level is a consumed signal, not decoration. `spur task record` renders it into `## Testing`,
and the operator reads a `HIGH` verdict as "the evidence needs no re-check". A level that no
evidence supports is worse than an absent one: it launders an unproven claim as settled, and the
cost lands on whoever trusts it later. The contract is therefore two-sided — a level too high for
its rows is unwarranted, and a level too low for them is understated.

### Requirements

- [x] R1. `lintVerifyAnswer` rejects a confidence level the row evidence does not earn. `HIGH` is unwarranted when any requirement row normalizes to `PARTIAL` or `UNMET`, when any acceptance-criteria row does not normalize to `MET`, or when any `MET` row's evidence carries a hedged uncertainty phrase. Finding rule `confidence-unwarranted`, addressed to the `Confidence:` line.
- [x] R2. `lintVerifyAnswer` rejects an understated level. `LOW` is understated when at least one requirement row exists, every declared requirement row normalizes to `MET`, and every acceptance-criteria row normalizes to `MET`. Finding rule `confidence-understated`, addressed to the `Confidence:` line.
- [x] R3. `MEDIUM` is never a coherence finding: it passes with every row `MET` and it passes beside a `PARTIAL`/`UNMET` row. Only `HIGH` can be unwarranted and only `LOW` can be understated, so a verifier keeps a working middle for "proven, but with a caveat I cannot name as a row".
- [x] R4. The two rules ride the existing lint contract unchanged: `add()`'s `ANSWER_LINT_MAX_FINDINGS` cap, a 1-based line addressed to the `Confidence:` line, and emission from the same `lintVerifyAnswer` that `spur task verdict` calls before writing an artifact. A rejected answer writes no artifact, exactly as the existing findings behave.
- [x] R5. An answer with no valid `Confidence:` line keeps its current single `confidence-missing` finding and gains no coherence finding — vocabulary validation stays the first gate, so a malformed level is never reported twice.

### Acceptance Criteria

```gherkin
Scenario: AC1 — HIGH beside an UNMET row is rejected (req: R1)
  Given a task whose Requirements declare R1 and R2
  And an answer whose Verdict is PARTIAL, whose Confidence is HIGH, and whose R2 row reads UNMET
  When lintVerifyAnswer runs over that answer
  Then a confidence-unwarranted finding names the HIGH level

Scenario: AC2 — HIGH beside hedged MET evidence is rejected (req: R1)
  Given a task whose Requirements declare R1
  And an answer whose Confidence is HIGH and whose R1 row is MET with evidence containing "likely"
  When lintVerifyAnswer runs over that answer
  Then the findings include confidence-unwarranted

Scenario: AC3 — LOW over an all-MET answer is rejected (req: R2)
  Given a task whose Requirements declare R1 and whose AC checklist declares AC1
  And an answer whose Confidence is LOW, whose R1 row is MET, and whose AC1 row is MET
  When lintVerifyAnswer runs over that answer
  Then a confidence-understated finding names the LOW level

Scenario: AC4 — MEDIUM is never a coherence finding (req: R3)
  Given a task whose Requirements declare R1 and R2
  And answers whose Confidence is MEDIUM, one with both rows MET and one with R2 UNMET
  When lintVerifyAnswer runs over each answer
  Then neither answer carries a confidence coherence finding

Scenario: AC5 — a warranted HIGH lints clean and a rejected answer writes no artifact (req: R1, R2, R4)
  Given a task whose Requirements declare R1 and whose AC checklist declares AC1
  And an answer whose Verdict is PASS, whose Confidence is HIGH, and whose every row is MET with unhedged cited evidence
  When lintVerifyAnswer runs over that answer
  Then no confidence coherence finding is emitted
  And when the same answer is edited to HIGH beside an UNMET row, spur task verdict leaves 1133-verdict.json unwritten

Scenario: AC6 — a malformed level is reported once, not twice (req: R5)
  Given a task whose Requirements declare R1 and whose R1 row is MET
  And an answer whose Confidence line reads SURE
  When lintVerifyAnswer runs over that answer
  Then exactly one confidence finding is emitted, named confidence-value
  And no confidence coherence finding is emitted
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-08T22:45:02.011Z

- **Why the lint and not the done gate?** The level is a property of the answer, and the answer is
  the artifact that claims it. Rejecting it at lint time fails before an artifact exists, so no
  consumer ever reads an unwarranted level. The gate-side counterpart (1123) stays cancelled: it
  would block an otherwise complete run over a wording choice the verifier can fix in one line.
- **Why is the hedge clause kept even though `evidence-hedged` already rejects a hedged `MET` row?**
  The two rules answer different questions — is this row trustworthy, versus may this level stand.
  Dropping the clause would make the level unverifiable whenever a hedge happens to be the only
  contradiction. Cost is one extra finding on an answer that is rejected either way.
- **Why does `MEDIUM` have no coherence rule in either direction?** It is the only level that
  carries a caveat with no row to point at. Making `MEDIUM`-with-all-rows-`MET` a finding would
  pressure verifiers into `HIGH`; making `MEDIUM`-beside-a-`PARTIAL` row a finding would ban a
  legitimate combination.
- **Why `LOW`-with-all-`MET` and not "level lower than the evidence supports" for both `LOW` and
  `MEDIUM`?** A rule that also fires on `MEDIUM` has no defensible boundary: nothing distinguishes a
  defensive `MEDIUM` from an understated one. `LOW` beside a fully proven answer has no such
  ambiguity, so the rule stops there.
- **Deferred:** any judgment that the row statuses themselves are wrong, and any gate-side
  enforcement. Both need evidence the lint does not hold; neither is a lint rejection class.

### Design

**Location.** One coherence pass appended inside `lintVerifyAnswer`
(`packages/app/src/services/verify-answer-lint.ts`), after the requirement and AC row passes and
before `return findings`. No new module, no second parser, no change to `task-verdict.ts`: the lint
already holds `tables.confidence`, `tables.reqs`, `tables.acs`, `normalizeReqStatus`,
`normalizeAcStatus` and `firstHedgedPhrase`, and `spur task verdict` already calls this function
before writing an artifact.

**Predicates.** Normalize every row first; a row whose status does not normalize is already rejected
by the row passes, and an unnormalizable row contributes nothing to the coherence decision (it
cannot be silently read as MET).

- `confidence-unwarranted` — `tables.confidence` is present *and* normalizes to `HIGH`, and any of:
  a requirement row normalizes to `PARTIAL`/`UNMET`; an AC row fails to normalize to `MET`; a `MET`
  row's evidence yields a non-null `firstHedgedPhrase`.
- `confidence-understated` — `tables.confidence` normalizes to `LOW`, at least one requirement row
  exists, and every declared requirement row and every AC row normalizes to `MET`.

Both use `tables.confidence.line` so the finding lands on the `Confidence:` line, and both go through
`add()`, inheriting the 10-finding cap.

**Deliberate choice — the hedged clause overlaps `evidence-hedged`.** A hedged `MET` row already
emits `evidence-hedged` and rejects the answer on its own. Emitting `confidence-unwarranted` as well
answers a different question (may this *level* stand, not is this *row* trustworthy) and makes AC2
observable in the finding set rather than inferable from another rule's side effect. The alternative —
suppressing the coherence finding when the hedge rule already fired — couples two rules to keep the
finding count tidy and was rejected. Verified consequence: a `HIGH` + hedged answer reports both
rules, which is the intended reading.

**Deliberate choice — the middle stays open.** `MEDIUM` carries no coherence rule in either
direction. Understatement is scoped to `LOW` because `MEDIUM` is the only level a verifier can use
for a caveat that has no row to point at, and closing it would force either an overclaimed `HIGH` or
an unusable `LOW`. Recorded here so a later "MEDIUM with all MET is suspicious" proposal reads this
as a decision, not an oversight.

**Gaps left open, on purpose.** This pass reads only the rows and the level. It does not judge
whether the row statuses are themselves correct (that is the verifier's job and `confidence` cannot
detect it), and it does not gate the done transition — 1123's gate-side enforcement stays cancelled.

**Impacted surfaces.** `packages/app/src/services/verify-answer-lint.ts` (rules),
`packages/app/tests/services/verify-answer-lint.test.ts` (AC coverage). No contract, schema, CLI or
artifact shape changes: the finding list is already an open set consumed by `spur task verdict`.

### Plan

1. Read `verify-answer-lint.ts` end to end and confirm the coherence pass can be appended with the
   existing helpers; confirm where the row loops end so the pass runs after them.
2. Write the AC1–AC5 cases in `packages/app/tests/services/verify-answer-lint.test.ts` first,
   against a minimal task document fixture that declares R1/R2 and AC1 — red before green.
3. Implement the two predicates as one small helper each and call them from `lintVerifyAnswer`.
4. Check the reverse direction explicitly: a warranted `HIGH` (all rows MET, unhedged, cited) and
   both `MEDIUM` shapes emit no coherence finding — the rules must not fire on a healthy answer.
5. Run the focused suite, then `bun run spur-check` once at the boundary.
6. Confirm `spur task verdict 1133 --from-answer` agrees with the lint on a deliberately
   unwarranted answer: findings present, no artifact written.

### Solution

Single commit `c279b8712` (4 files: the task file, the lint module, its tests and the schema reference). Recorded at re-verify, 2026-10-09.

- **Coherence pass:** after the presence and vocabulary checks, `verify-answer-lint.ts` checks the confidence level against the rows (`packages/app/src/services/verify-answer-lint.ts:175-212`). It normalizes every requirement and AC row and computes `allRowsMet`, which needs at least one requirement row, and `hedgedRow`, which is true when a MET row's evidence contains a hedged phrase.
  - `HIGH` with `!allRowsMet || hedgedRow` emits `confidence-unwarranted`.
  - `LOW` with `allRowsMet` emits `confidence-understated`.
  - The guard admits only HIGH and LOW, so MEDIUM is never a coherence finding, and a malformed level is reported only once, by the vocabulary pass.
- **Artifact safety:** both findings go through `add()`, so they share the `ANSWER_LINT_MAX_FINDINGS` cap and address the `Confidence:` line. `spur task verdict --from-answer` lints first (`apps/cli/src/commands/task.ts:1440`) and returns before the artifact write (`apps/cli/src/commands/task.ts:1452`), so a rejected answer writes no verdict.
- **Docs:** the rejection classes are documented in `plugins/sp/skills/code-verification/references/verdict-schema.md:59`.
- **Known boundary:** a justified `N/A` AC row is not MET, so it makes HIGH unwarranted. This is deliberate under R1, which says an AC row must normalize to MET. Answers with N/A rows claim MEDIUM.

The earlier auto change-map also listed `apps/web/src/lib/rpc-client.ts` and `plugins/sp/lib/inline-run.generated.mjs`. Those files changed in the base, not in this task.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/verify-answer-lint.ts:182-202` HIGH branch fires when not allRowsMet (req row not MET or AC row not MET, :186-189) or a MET row's evidence yields firstHedgedPhrase (:190-194); tests `packages/app/tests/services/verify-answer-lint.test.ts:833`, :845, :851, :864, :923 green (94 pass / 0 fail, re-run 2026-10-09); live source-CLI probe HIGH beside 5 UNMET rows returned exactly [confidence-unwarranted], exit 1. |
| R2 | MET | `packages/app/src/services/verify-answer-lint.ts:203-209` LOW branch fires only when allRowsMet, which requires at least one requirement row (:187); tests `packages/app/tests/services/verify-answer-lint.test.ts:877` (positive) and :888 (negative control) green. |
| R3 | MET | `packages/app/src/services/verify-answer-lint.ts:183` guard admits only HIGH and LOW, so MEDIUM never reaches either add call; test `packages/app/tests/services/verify-answer-lint.test.ts:894` covers both directions; live probe MEDIUM beside 5 UNMET rows returned zero lint findings. |
| R4 | MET | Both rules go through add() with the ANSWER_LINT_MAX_FINDINGS cap and address tables.confidence.line (`packages/app/src/services/verify-answer-lint.ts:195`); CLI path `apps/cli/src/commands/task.ts:1440` lints first and returns at `apps/cli/src/commands/task.ts:1452` before the artifact write at `apps/cli/src/commands/task.ts:1486`; live: rejected HIGH-beside-UNMET answer exited 1 and left `.spur/run/1133-verdict.json` byte-identical (shasum before/after). |
| R5 | MET | Presence/vocabulary pass runs first and the coherence guard (`packages/app/src/services/verify-answer-lint.ts:183`) only admits normalized HIGH/LOW; test `packages/app/tests/services/verify-answer-lint.test.ts:940` green; live probe Confidence SURE over all-MET rows returned exactly [confidence-value]. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — HIGH beside an UNMET row is rejected (req: R1) | MET | test | `packages/app/tests/services/verify-answer-lint.test.ts:833` asserts one confidence-unwarranted naming HIGH on the Confidence line; suite 94 pass / 0 fail via `(cd packages/app && bun test tests/services/verify-answer-lint.test.ts)`. |
| AC2 — HIGH beside hedged MET evidence is rejected (req: R1) | MET | test | `packages/app/tests/services/verify-answer-lint.test.ts:864` (hedged requirement row) and `packages/app/tests/services/verify-answer-lint.test.ts:923` (hedged AC row) assert confidence-unwarranted is present; same green run. |
| AC3 — LOW over an all-MET answer is rejected (req: R2) | MET | test | `packages/app/tests/services/verify-answer-lint.test.ts:877` asserts one confidence-understated naming LOW; same green run. |
| AC4 — MEDIUM is never a coherence finding (req: R3) | MET | test | `packages/app/tests/services/verify-answer-lint.test.ts:894` asserts no coherence rule for MEDIUM with all MET and with R2 UNMET; same green run; live MEDIUM-beside-UNMET probe produced no lint finding. |
| AC5 — a warranted HIGH lints clean and a rejected answer writes no artifact (req: R1, R2, R4) | MET | command | `packages/app/tests/services/verify-answer-lint.test.ts:906` warranted HIGH yields no finding; `bun run apps/cli/src/index.ts task verdict 1133 --from-answer <HIGH plus UNMET probe>` exit 1 with confidence-unwarranted and `.spur/run/1133-verdict.json` shasum unchanged (re-run 2026-10-09). |
| AC6 — a malformed level is reported once, not twice (req: R5) | MET | test | `packages/app/tests/services/verify-answer-lint.test.ts:940` asserts exactly one confidence-value finding; live SURE probe returned exactly [confidence-value]. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — run-1133-c3f1 (standard lane, sp-super-reviewer pattern, 2026-10-08)

**Scope:** `packages/app/src/services/verify-answer-lint.ts` + its test file; plus two out-of-scope-but-necessary changes (the foreign `apps/web` TSDoc repair and the regenerated plugin twin)
**Dimensions:** functional traceability, SECUA (security/efficiency/correctness/usability/architecture), architecture depth
**Verdict:** PASS — Confidence HIGH. 1 P3 and 4 P4 findings; the P3 was fixed in this commit.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 | documentation | The skill reference owns the lint's rejection-class vocabulary and documented `evidence-hedged` / `evidence-citation` but not the two new classes, so the surface a verifier reads to choose a level was stale. Fixed by adding a "Coherence: the level must be earned" section to the reference. A first attempt also edited `SKILL.md`, which broke the R44 skill-body budget (a genuine guard: a SKILL.md is a dispatcher, not the procedure); that edit was reverted and the detail kept in `references/`. | `plugins/sp/skills/code-verification/references/verdict-schema.md` | FIXED |
| 2 | P4 (advisory) | correctness | `allRowsMet` requires every present requirement row to normalize to `MET`, so `HIGH` beside an unnormalizable status (e.g. `DONE`) or a zero-requirement answer also draws `confidence-unwarranted`, although R1 names only `PARTIAL`/`UNMET`. No accept/reject impact — those answers already fail the row passes (`req-status`/`req-missing`) — and every corpus task declares Requirements. | `verify-answer-lint.ts:186-194` | ACCEPTED |
| 3 | P4 (advisory) | tests | Verified the three changed pre-existing assertions are truthful, not regression-hiding: the shared fixture genuinely carries `PARTIAL` rows, the old `HIGH` default emits exactly one `confidence-unwarranted` on it, and the `test.each` rewrite still pins 1068's vocabulary contract. | `verify-answer-lint.test.ts:44,105` | ACCEPTED |
| 4 | P4 (advisory) | tests | Uncovered paths in the new block: lowercase level, AC-row hedge, `LOW` with zero AC rows, and cap saturation swallowing the coherence finding. Two of the four (lowercase, AC-row hedge) were closed with tests in this commit; `LOW`-with-zero-AC rows is vacuous by design and cap saturation is the shared `ANSWER_LINT_MAX_FINDINGS` contract (R4). | `verify-answer-lint.test.ts` | PARTIALLY FIXED |
| 5 | P4 (advisory) | provenance | The regenerated `inline-run.generated.mjs` is not caused by this task: the plugin bundle contains none of the new rule strings, and its 2-line minified diff is main-side drift catching up to committed `action-trace.ts` shell-invocation stamping. Source-consistent, and the "byte-identical rebuild" claim is reproducible outside a read-only review. | `plugins/sp/lib/inline-run.generated.mjs` | ACCEPTED |

##### Requirement and evidence verification

- **R1** — the unwarranted rule fires on a `PARTIAL` row, an `UNMET` row, a non-MET AC row, and hedged MET evidence (req-row and AC-row paths both pinned); a lowercase level normalizes before the decision.
- **R2** — the understated rule requires at least one present requirement row and every requirement and AC row `MET`, so `LOW` beside a non-MET row stays clean.
- **R3** — `MEDIUM` is structurally excluded at the level comparison, not merely untested; both directions pinned by test.
- **R4** — findings land on the `Confidence:` line through `add()`, inheriting the 10-finding cap; a rejected answer writes no artifact (`spur task verdict` exits 1, `.spur/run/1133-verdict.json` absent — verified live).
- **R5** — `Confidence: SURE` yields exactly one `confidence-value` finding and no coherence finding.
- **Blast radius** — `lintVerifyAnswerForTask` and every `Confidence: HIGH` fixture in `dispatch-handoff-contract.test.ts` and `apps/cli/tests/commands/task.test.ts` still pass; no consumer enumerates rule names, so the new findings are additive to an open set.
- **Quality gate** — PASS over the final code (`bun run spur-check`; 10,582 tests; post-check rule preset green, including the `every-export-has-tsdoc` repair that was blocking it).

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-08T22:45:22.644Z backlog → todo (system)
- 2026-10-09T06:36:37.491Z todo → testing (system)
- 2026-10-09T06:36:45.698Z testing → done (system)

