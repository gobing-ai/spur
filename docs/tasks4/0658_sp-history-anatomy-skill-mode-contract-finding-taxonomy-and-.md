---
schema_version: 1
name: "sp:history-anatomy skill: mode contract, finding taxonomy, and the eleven-section report contract"
status: done
template: feature-impl
created_at: 2026-08-25T04:06:58.527Z
updated_at: "2026-08-25T17:07:52.743Z"
feature_id: I8
priority: P2
tags: ["plugin", "skill", "history"]
dependencies: ["0657"]
---

## 0658. sp:history-anatomy skill: mode contract, finding taxonomy, and the eleven-section report contract

### Background

Feature I8 needs one independent owner of diagnostic interpretation over already-imported history.
The skill owns everything judgment-shaped; orchestration (cache branching, retry policy,
publication) belongs to `history-anatomy.yaml` (task 0660) so that branching is not prose a model
must re-execute correctly on every run.

**Verified against the tree on 2026-08-24:**

| Claim | Evidence |
| --- | --- |
| A new `SKILL.md` body over 20,000 bytes fails the gate, and a **new** skill cannot be baselined | `plugins/sp/tests/skill-structure.test.ts:770` (`BODY_BUDGET`), `:771-778` (two-sided `BASELINE`) |
| `issue-finding` is 27,060 bytes and only survives because it is baselined | `plugins/sp/tests/skill-structure.test.ts:778`; `wc -l` = 436 lines |
| The skill-description aggregate budget is `8200` and the roster currently sums to **8120** — 80 chars of headroom across 29 skills | `plugins/sp/tests/skill-structure.test.ts:736`; measured 2026-08-24 |
| A non-router skill description is capped at 350 chars | `plugins/sp/tests/skill-structure.test.ts:734` |
| The aggregate budget is documented as scaling with skill count; per-skill caps are "the real bloat guard" | `plugins/sp/tests/skill-structure.test.ts:736` comment |
| `superskill` resolves on PATH for the skill lifecycle | `/Users/robin/.bun/bin/superskill` |
| The plugin README carries a per-skill roster row and a directory tree entry | `plugins/sp/README.md:235`, `:315` |
| `roles.md` carries a per-role command roster | `plugins/sp/references/roles.md:53` |

**Two blockers this refine froze rather than deferring to the implementer:**

1. **The report contract cannot fit in `SKILL.md`.** Eleven required sections, nine per-finding
   fields, the evidence rules, mode validation, and two rubrics will exceed 20,000 bytes. The split
   into `references/` is therefore mandatory, not the conditional "split only if it exceeds the
   gate" the brainstorm hedged at.
2. **Skill #30 does not fit under the current aggregate description budget.** 80 chars of headroom
   cannot hold a 350-char description. `AGGREGATE_BUDGET` must be raised in the same change.

Shapes: `docs/design/history-anatomy.md` §Operator surface, §Report contract. Evidence policy
derives from ADR-079.

### Requirements

- [x] R1. Create `plugins/sp/skills/history-anatomy/SKILL.md` through the Superskill skill lifecycle (`superskill skill …`); do not hand-maintain generated platform adapters. The body stays under `BODY_BUDGET` (20,000 bytes) by routing to `references/` — a new skill cannot be added to the `BASELINE` exemption map.
- [x] R2. Raise `AGGREGATE_BUDGET` in `plugins/sp/tests/skill-structure.test.ts` to accommodate skill #30, and keep the new description within the 350-char non-router cap.
- [x] R3. Mode validation: `--mode daily` is the default and rejects focus text, `--since`, `--until` and `--output`; `--mode ad-hoc` requires a non-empty focus and both ordered inclusive bounds and rejects `--date` and `--recompute`. Every conflict fails loud naming the offending argument. `--date` maps to a DST-aware local calendar interval, never a fixed 24-hour offset.
- [x] R4. The report contract defines all eleven required sections and, for each finding, the full field set: stable `<category>:<owner-surface>:<signal>` key, category from the closed vocabulary, impact, trend, observation, inference, per-finding confidence, contradictions shown beside the finding, and at least one evidence anchor.
- [x] R5. Evidence rules are stated and enforceable: causality needs two independent signals (one signal is a labelled hypothesis with a confirmation path); a process/workflow change needs recurrence across two independent sessions or one high-impact contract violation cited at `file:line`; unsupported dimensions read `not available` and are mirrored into the telemetry-gaps section; focus biases ranking, not collection.
- [x] R6. Comparison semantics: daily compares the immediately preceding local calendar day, ad-hoc the immediately preceding equal-duration window, and insufficient or materially different coverage renders `not comparable` with no trend, delta or percentage stated.
- [x] R7. The recurrence ledger classifies every finding as new / recurring / regressed / improved / resolved / not-comparable, matched on the stable key so that rewording a title never reclassifies a recurring finding as new.
- [x] R8. Positive patterns carry the same observation / inference / confidence / evidence-anchor fields as problem findings; an entry with no anchor is invalid.
- [x] R9. Remediation options are proposals only: owner surface, expected impact, verification method and reversibility, with no applied change, diff, or command the report claims to have run.
- [x] R10. The skill defines explicit `enrich` and `validate` operations the workflow invokes; neither operation launches a workflow, so the rubric stays single-sourced and cannot recurse.
- [x] R11. Skill structure tests pass and the skill contains no JSONL/session-root discovery recipe, no import invocation, and no corpus, docs or source mutation recipe.
- [x] R12. The plugin README roster row, directory-tree entry, and the `roles.md` command roster name the new skill.

### Acceptance Criteria

```gherkin
Feature: sp:history-anatomy skill — mode contract, taxonomy, and report contract

  @core
  Scenario: R2 — Daily is the default mode and rejects ad-hoc-only arguments
    Given an operator invoking "/sp:dev-find-issue" with no mode argument
    When the skill resolves the mode
    Then the resolved mode is "daily"
    And the resolved window is the current local calendar day
    And the report prints the normalized inclusive ISO bounds and the timezone used
    And an invocation combining "--mode daily" with focus text, "--since", "--until" or "--output" fails loud naming the conflicting argument

  @core
  Scenario: R3 — Ad-hoc mode requires a focus and two ordered bounds
    Given an operator invoking "/sp:dev-find-issue" with "--mode ad-hoc"
    When the skill validates the arguments
    Then a missing or empty focus fails loud
    And "--until" without "--since" fails loud
    And "--until" earlier than "--since" fails loud
    And "--date" or "--recompute" combined with "--mode ad-hoc" fails loud
    And a valid ad-hoc run writes to the run directory unless "--output <path>" is explicit

  @edge
  Scenario: R4 — A daily date selector maps to a DST-aware local calendar interval
    Given a local timezone in which the requested calendar date is 23 or 25 hours long
    When the operator runs "/sp:dev-find-issue --date <that-date>"
    Then the normalized bounds span the full local calendar day including the DST shift
    And the report states the timezone alongside the bounds
    And the bounds are not computed as a fixed 24-hour offset from local midnight

  @core
  Scenario: R18 — Every finding carries the full per-finding field set
    Given the findings table of a published report
    When each row is inspected
    Then it carries a stable key of the form "<category>:<owner-surface>:<signal>"
    And its category is one of reliability, repetition, workflow, performance, coverage, telemetry or positive
    And it carries impact, trend, observation, inference, confidence and at least one evidence anchor
    And any contradicting signal is shown beside the finding rather than silently reconciled
    And confidence is per finding, not one blanket score for the report

  @core
  Scenario: R19 — Observation and inference are separated and causality is gated on two signals
    Given a finding asserting that one condition caused another
    When the evidence validation stage reviews it
    Then a causal claim supported by two or more independent signals passes
    And a causal claim supported by exactly one signal fails unless it is labeled a hypothesis with a stated confirmation path
    And an inference that does not name its supporting observations fails validation

  @core
  Scenario: R21 — Baseline comparison states an explicit comparability verdict
    Given a daily report for a closed calendar day
    When the baseline is computed
    Then it compares against the immediately preceding local calendar day
    And an ad-hoc report instead compares against the immediately preceding equal-duration window
    And missing or materially different baseline coverage renders "not comparable"
    And no trend, delta or percentage is stated for a "not comparable" baseline

  @core
  Scenario: R22 — The recurrence ledger classifies every finding against the baseline
    Given a report with a comparable baseline
    When the recurrence ledger renders
    Then every finding is classified as new, recurring, regressed, improved, resolved or not-comparable
    And classification matches on the stable key, not the prose title
    And rewording a finding's title between two runs does not reclassify a recurring finding as new

  @core
  Scenario: R23 — Remediation options are proposals with an owner, an impact and a verification method
    Given the remediation section of a published report
    When each option is inspected
    Then it names the owner surface that would apply it
    And it states expected impact and a verification method
    And it states its reversibility
    And it does not contain an applied change, a diff, or a command the report claims to have already run

  @core
  Scenario: R25 — Positive patterns are held to the same evidence standard as problems
    Given the positive patterns section of a published report
    When each entry is inspected
    Then it carries the same observation, inference, confidence and evidence anchor fields as a problem finding
    And an entry without a supporting evidence anchor fails validation

  @edge
  Scenario: R27 — Focus biases ranking without suppressing high-severity off-topic evidence
    Given an ad-hoc invocation carrying a focus string
    When the report is produced
    Then the focus changes finding ranking and emphasis
    And material off-topic findings within the window remain visible in the report
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT.** One new skill, `sp:history-anatomy`, owning interpretation only: which arguments are legal
in which mode, what counts as evidence, how findings are keyed and graded, what a report must
contain, and the rubrics its `enrich` and `validate` operations follow.

**WHY.** Feature I8 needs a single owner of the report contract. Putting it in the workflow YAML
would make the rubric unreadable and unversioned; leaving it in `sp:issue-finding` would keep the
raw-JSONL fallback and task-mutation surface the feature exists to remove.

**WHERE.**

| Path | Role |
| --- | --- |
| `plugins/sp/skills/history-anatomy/SKILL.md` | dispatcher body — routes, does not carry the procedure |
| `plugins/sp/skills/history-anatomy/references/report-contract.md` | the eleven sections + finding fields + evidence rules |
| `plugins/sp/skills/history-anatomy/references/modes.md` | mode validation matrix, bounds normalization, DST rule |
| `plugins/sp/skills/history-anatomy/references/operations.md` | `enrich` and `validate` rubrics |
| `plugins/sp/tests/skill-structure.test.ts` | `AGGREGATE_BUDGET` raise |
| `plugins/sp/README.md`, `plugins/sp/references/roles.md` | roster rows |

**The split is mandatory, not optional.** `BODY_BUDGET` is 20,000 bytes
(`skill-structure.test.ts:770`) and the `BASELINE` exemption map is two-sided — a *new* skill added
to it fails the ratchet. `spur-cli` (8.5KB body / 211KB references) and `spur-dev` (13.6KB / 294KB)
are the shape the test comment names: the body routes, `references/` carries the procedure.

**The aggregate description budget must be raised.** Measured 2026-08-24: 29 skills sum to 8,120
chars against `AGGREGATE_BUDGET = 8200` — 80 chars of headroom, against a 350-char non-router cap.
The test's own comment says the budget "scales with skill count (29 skills …)" and that the
per-skill caps are "the real bloat guard", so raising it on roster growth is the designed behavior,
not a gate bypass. Set it to `8550` and update the skill-count note in the comment.

**Frozen vocabulary** (consumed verbatim by 0659's structure gate and 0660's validation stage — do
not rename downstream):

- Modes: `daily` | `ad-hoc`.
- Finding categories: `reliability` | `repetition` | `workflow` | `performance` | `coverage` |
  `telemetry` | `positive`.
- Stable key: `<category>:<owner-surface>:<signal>`.
- Confidence: `high` | `medium` | `low` — per finding, never one report-level score.
- Recurrence classes: `new` | `recurring` | `regressed` | `improved` | `resolved` |
  `not-comparable`.
- Unsupported value literal: `not available`.
- The eleven section names, in order: Scope and provenance · Executive summary · Baseline comparison
  · Findings · Recurrence ledger · Telemetry gaps · Remediation options · Performance analysis ·
  Workflow and process improvements · Positive patterns · Evidence ledger.

**Operations.** `enrich` takes the rendered forensics artifacts (current + baseline) and authors the
model half of the report. `validate` takes a candidate report and independently checks evidence
claims against the artifacts. Both are skill operations invoked by the workflow; **neither launches
a workflow** — that is the recursion guard, and it is why the rubric lives here rather than being
duplicated into the YAML.

**Anti-patterns — do not implement.**

- Do **not** copy any procedure from `plugins/sp/skills/issue-finding/`. Coexistence means both ship;
  it does not mean shared source.
- Do **not** add the skill to `BASELINE` in `skill-structure.test.ts`. That map exists to stop drift
  on four pre-existing bodies, not to exempt new ones.
- Do **not** put cache branching, retry counting, or publication ordering in the skill — 0660 owns
  those. The skill must read identically whether it was invoked by the workflow or directly.
- Do **not** write a `--create-task`, `--resolve`, or fix mode, and do not include a recipe that
  calls `spur task`, `spur feature`, `spur rule`, or `spur history import`.
- Do **not** include a raw-JSONL or session-root discovery fallback. A dimension the artifact cannot
  support is a telemetry gap, by design.
- Do **not** emit one blanket confidence score for the report.

**Cross-task.** Depends on 0657 for `SelectionPopulation` — the report's coverage section and the
"top N of M" labeling read `artifact.population`. Leaves for 0659: the frozen section names and
finding-field names its structure gate asserts. Leaves for 0660: the `enrich` / `validate` operation
names and their input/output contract. Leaves for 0661: the skill name for the command's single
invocation, plus the roster rows.

### Plan

- [x] 1. Scaffold via `superskill skill` into `plugins/sp/skills/history-anatomy/`; confirm no
      hand-maintained platform adapters are added. (R1)
- [x] 2. Author `references/modes.md`: the daily/ad-hoc validation matrix, bounds normalization,
      the DST-aware calendar-day rule, and the fail-loud message shape. (R3)
- [x] 3. Author `references/report-contract.md`: the eleven sections in order, the nine per-finding
      fields, the closed category vocabulary, the stable-key grammar, the evidence rules, the
      comparison/`not comparable` rule, the recurrence classes, and the positive-pattern and
      remediation standards. (R4–R9)
- [x] 4. Author `references/operations.md`: the `enrich` and `validate` rubrics, each stating
      explicitly that it never launches a workflow. (R10)
- [x] 5. Write `SKILL.md` as a dispatcher that routes to the three references; keep the description
      under 350 chars and the body under 20,000 bytes. (R1, R2)
- [x] 6. Raise `AGGREGATE_BUDGET` to `8550` in `plugins/sp/tests/skill-structure.test.ts` and update
      its skill-count comment. Do **not** touch `BASELINE`. (R2)
- [x] 7. Add the roster row and directory-tree entry in `plugins/sp/README.md` and the command/skill
      reference in `plugins/sp/references/roles.md`. (R12)
- [x] 8. Boundary test: assert the skill tree contains no `spur task` / `spur feature` / `spur rule`
      / `spur history import` invocation and no JSONL or session-root discovery recipe. (R11)
- [x] 9. Contract test: assert all eleven section names and the nine finding-field names appear in
      `references/report-contract.md`, so 0659 and 0660 cannot drift from the frozen vocabulary. (R4)
- [x] 10. Gate: `bun test plugins/sp/tests/skill-structure.test.ts` first, then `bun run spur-check`.

### Solution

**Goal:** create `sp:history-anatomy` — the independent owner of diagnostic interpretation over
already-imported history — as a dispatcher body routing to three references, splitting the report
contract out of `SKILL.md` (BODY_BUDGET) and raising the aggregate description budget for skill #30.

| File | Change |
| --- | --- |
| `plugins/sp/skills/history-anatomy/SKILL.md:2` | `name: history-anatomy` — new dispatcher skill body (3.4 KB, under BODY_BUDGET 20,000) routing to the three references; description under the 350-char non-router cap; a fresh skill cannot enter the BASELINE exemption map. |
| `plugins/sp/skills/history-anatomy/references/modes.md:57` | The DST-aware calendar-day rule — the daily vs ad-hoc mode contract, bounds normalization, and the fail-loud argument shape. |
| `plugins/sp/skills/history-anatomy/references/report-contract.md:1` | `# Report contract` — the eleven frozen sections in order (Findings, Recurrence ledger, Evidence ledger among them), the nine per-finding fields, category vocabulary, stable keys, evidence rules, comparison/recurrence, and the positive-pattern + remediation standards. |
| `plugins/sp/skills/history-anatomy/references/operations.md:1` | `# Operations` — the enrich and validate operation rubrics; each states it never launches a workflow (recursion guard). |
| `plugins/sp/tests/skill-structure.test.ts:736` | AGGREGATE_BUDGET raised 8200 to 8550 with the 30-skill count note; added the HA-S1 boundary test (line 812) and the report-contract freeze test (line 838). |
| `plugins/sp/README.md:322` | Added the skill roster row; the directory-tree entry at line 243; bumped the platforms note. |
| `plugins/sp/references/roles.md:2` | `name: roles` — noted dev-find-issue routes through the new sp:history-anatomy skill in the reviewer roster (line 86). |

The body routes; the procedure lives in `references/` (the test's named shape). No hand-maintained
platform adapters were added; BASELINE in the BODY test was not touched.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/history-anatomy/SKILL.md:1-12` carries the Superskill frontmatter shape (name/description/license/version/metadata.platforms/category/interactions), matching every other `plugins/sp/skills/*` skill. Body = 3,434 bytes, well under `BODY_BUDGET` 20,000; it routes to `references/{modes,report-contract,operations}.md` (`SKILL.md:59-63`) and is absent from `BASELINE` (`plugins/sp/tests/skill-structure.test.ts:776-788`). `git show 33c3e951 --name-only` lists only `.md` + `.ts` — no generated platform adapter was hand-added. |
| R2 | MET | `plugins/sp/tests/skill-structure.test.ts:740` raises `AGGREGATE_BUDGET` to 8550 with the comment naming skill #30. Description measured this run = 299 chars ≤ the 350-char non-router cap. Suite green: 59 pass / 0 fail. |
| R3 | MET | `plugins/sp/skills/history-anatomy/references/modes.md:11-14` (daily default + current local calendar day), `:16-32` (daily rejects focus/`--since`/`--until`/`--output`, each fail-loud), `:34-50` (ad-hoc requires non-empty focus + ordered inclusive bounds; rejects `--date`/`--recompute`), `:57-67` (DST-aware calendar-day rule, explicitly not `midnight + 24h`), `:69-84` (fail-loud message shape naming the offending argument). |
| R4 | MET | `references/report-contract.md:7-22` freezes the eleven sections in order; `:46-60` the per-finding field set (key, category, impact, trend, observation, inference, confidence, contradictions, evidenceAnchor); `:24-29` the closed category vocabulary; `:31-44` the `<category>:<owner-surface>:<signal>` stable-key grammar. Pinned by test `plugins/sp/tests/skill-structure.test.ts:894-929`. |
| R5 | MET | `references/report-contract.md:62-78` — rule 1 causality needs two independent signals (one signal ⇒ labelled hypothesis with a confirmation path); rule 2 process/workflow change needs recurrence across two independent sessions or one high-impact contract violation cited at `file:line`; rule 3 unsupported dimensions read `not available` mirrored into telemetry-gaps; rule 4 focus biases ranking not collection; rule 5 every inference names its supporting observations. |
| R6 | MET | `references/report-contract.md:80-88` — daily → immediately preceding local calendar day; ad-hoc → immediately preceding equal-duration window; insufficient or materially different coverage → `not comparable` with no trend, delta or percentage. |
| R7 | MET | `references/report-contract.md:90-102` — the six classes (new/recurring/regressed/improved/resolved/not-comparable), matched on the stable key, never the prose title; rewording must not reclassify a recurring finding as new. |
| R8 | MET | `references/report-contract.md:104-109` — positive entries carry observation, inference, confidence and at least one evidence anchor; an anchor-less entry is invalid. |
| R9 | MET | `references/report-contract.md:111-121` — each option names owner surface, expected impact, verification method and reversibility; the report must contain no applied change, no diff, and no command it claims to have run. |
| R10 | MET | `references/operations.md:1-12` defines exactly `enrich` and `validate` as skill operations and states the recursion guard ("Neither operation launches a workflow"); `:23-42` and `:44-70` carry the two rubrics; both close with "Never launch a workflow". |
| R11 | MET | `bun test plugins/sp/tests/skill-structure.test.ts` — 59 pass / 0 fail this run, including `history-anatomy (HA-S1) contains no import/corpus-mutation/discovery recipe` (`:816-837`) which forbids `spur task`, `spur feature`, `spur rule`, `spur history import`, `.jsonl`, `readdir`, `session-root`, `session_formats` across every `.md` in the skill dir. |
| R12 | MET | `plugins/sp/README.md:321` roster row, `:242` directory-tree entry, `:131` command row, `:358` dev-* skill list; `plugins/sp/references/roles.md:86` names `sp:history-anatomy`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| [docs-only] R2 — Daily is the default mode and rejects ad-hoc-only arguments | MET | static-ref | `plugins/sp/skills/history-anatomy/references/modes.md:11-14` resolves omitted `--mode` to `daily` over the current local calendar day; `:29-32` requires printing the normalized inclusive ISO bounds + timezone; `:22-28` rejects focus text, `--since`, `--until` and `--output`, each naming the offending argument (`:69-84`). Skill-contract deliverable — the artifact is prose, so static-ref is the terminal evidence form. |
| [docs-only] R3 — Ad-hoc mode requires a focus and two ordered bounds | MET | static-ref | `references/modes.md:36-42` — focus required (empty fails loud); `--since` required; `--until` must accompany `--since` and must not precede it; `--output` optional, otherwise the run directory. `:44-50` rejects `--date` and `--recompute`. Message shapes for all four failures at `:74-79`. |
| [docs-only] R4 — A daily date selector maps to a DST-aware local calendar interval | MET | static-ref | `references/modes.md:57-67` — the interval runs first-to-last local instant, is 23 or 25 hours on a DST day, states the timezone, and is explicitly NOT `midnight + 24h`. |
| R18 — Every finding carries the full per-finding field set | MET | test | `plugins/sp/tests/skill-structure.test.ts:894-929` pins all eleven section names and all nine finding fields (key, category, impact, trend, observation, inference, confidence, contradictions, evidenceAnchor) against `references/report-contract.md`. Green this run (59 pass / 0 fail). Contract text: `report-contract.md:46-60` (fields incl. per-finding confidence and contradictions shown beside the finding), `:24-29` (closed category vocabulary), `:31-44` (stable key). |
| [docs-only] R19 — Observation and inference are separated and causality is gated on two signals | MET | static-ref | `references/report-contract.md:64-67` (two independent signals pass; exactly one ⇒ labelled hypothesis with a confirmation path), `:75-76` (an inference that does not name its supporting observations fails validation); enforced by the `validate` rubric at `references/operations.md:52-56`. |
| [docs-only] R21 — Baseline comparison states an explicit comparability verdict | MET | static-ref | `references/report-contract.md:80-88` — daily vs preceding local calendar day, ad-hoc vs preceding equal-duration window, `not comparable` on insufficient/materially different coverage, and no trend/delta/percentage stated for it; `operations.md:60-61` makes it a `validate` FAIL rule. |
| [docs-only] R22 — The recurrence ledger classifies every finding against the baseline | MET | static-ref | `references/report-contract.md:90-102` — the six classes; matching on the stable key, never the prose title; rewording must not reclassify recurring as new. `operations.md:62-63` gates it in `validate`. |
| [docs-only] R23 — Remediation options are proposals with an owner, an impact and a verification method | MET | static-ref | `references/report-contract.md:111-121` — owner surface, expected impact, verification method, reversibility; "no applied change, no diff, and no command it claims to have run". `operations.md:66-67` FAILs any applied change. |
| [docs-only] R25 — Positive patterns are held to the same evidence standard as problems | MET | static-ref | `references/report-contract.md:104-109` — same observation/inference/confidence/anchor fields; an anchor-less entry is invalid. `operations.md:64-65` FAILs an anchor-less positive entry. |
| [docs-only] R27 — Focus biases ranking without suppressing high-severity off-topic evidence | MET | static-ref | `references/report-contract.md:72-73` — rule 4: "Focus biases ranking, not collection. A focus string changes finding ranking and emphasis; it never suppresses material off-topic findings within the window." |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Final disposition: APPROVED** — implementation satisfies all twelve requirements; no P1–P3 findings.

| Priority | Finding | Evidence |
| --- | --- | --- |
| P4 (note) | `description`/body are under their budget caps by a healthy margin; the skill braces against re-entering a workflow (recursion guard) by design, which means any future cross-skill reference must stay in prose, not a nested invocation. | `plugins/sp/skills/history-anatomy/SKILL.md:1` |

No P1/P2/P3.

All twelve requirements MET with direct evidence:

- R1 (SKILL.md via lifecycle, body under BODY_BUDGET, not baselined): `plugins/sp/skills/history-anatomy/SKILL.md:2` — 3.4 KB body; `BASELINE` untouched (`skill-structure.test.ts:745-769` unchanged).
- R2 (AGGREGATE_BUDGET raise + 350-cap): `plugins/sp/tests/skill-structure.test.ts:736` → 8550; the R42 test asserts both the 350 non-router cap and the new aggregate ceiling hold (57 tests green).
- R3 (mode validation): `references/modes.md:57` — daily/ad-hoc matrix, DST calendar rule, fail-loud shape.
- R4–R9 (report contract): `references/report-contract.md:1` — eleven sections, nine fields, closed vocabulary, stable key, evidence rules, comparison semantics, recurrence classes, positive-pattern and remediation standards.
- R10 (enrich/validate, never launches workflow): `references/operations.md:1`.
- R11 (boundary — no import/corpus/discovery recipe): the boundary test `skill-structure.test.ts:812` greps the skill tree and passes; the word-scan confirms no `spur task`/`spur feature`/`spur rule`/`spur history import`/history-file-discovery recipe.
- R12 (README roster + tree + roles.md): `plugins/sp/README.md:322` roster row + `:243` dir tree; `plugins/sp/references/roles.md:86` reviewer roster note.

- Security: the skill is read-only documentation + rubrics; it contains no command that mutates the corpus, docs, or source tree (boundary test enforces).
- Efficiency: the body is a thin dispatcher (3.4 KB), keeping invocation time bounded; the nine-finding-field + rubric procedure lives in `references/` so the body never bloats.
- Correctness: the frozen vocabulary (modes, categories, stable-key grammar, confidence, recurrence classes, `not available`) is single-sourced and pinned by the contract test (`skill-structure.test.ts:838`), so 0659/0660 cannot drift.
- Usability: fail-loud argument validation and a mode matrix an operator can follow without re-reading source.
- Architecture: no new workflow, no recursion (operations never launch workflows), no hand-maintained platform adapters; the dispatcher/`references/` split follows the named spur-cli/spur-dev shape.

None material. The route relies on the skill being invoked through `/sp:dev-find-issue` (0661 repoints the command); until 0661 lands, the skill is unreferenced by any command but is independently testable and valid.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-25T05:24:00.649Z todo → wip (system)
- 2026-08-25T05:27:30.344Z wip → testing (system)
- 2026-08-25T05:27:40.330Z testing → done (system)
