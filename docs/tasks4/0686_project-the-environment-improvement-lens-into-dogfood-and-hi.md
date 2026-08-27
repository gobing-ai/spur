---
schema_version: 1
name: "Project the environment-improvement lens into dogfood and history-anatomy reports"
status: done
template: feature-impl
created_at: 2026-08-27T00:28:30.651Z
updated_at: "2026-08-27T02:57:03.768Z"
feature_id: I9
priority: P2
tags: ["environment-lens", "dogfood-testing", "history-anatomy"]
---

## 0686. Project the environment-improvement lens into dogfood and history-anatomy reports

### Background

Feature I9 implements the accepted Approach 1 from `docs/plans/2026-08-26-retro-skills-brainstorm.md` and `docs/design/environment-improvement-lens.md` (ADR-084/085): one plugin-level environment-improvement mapping projected into the two live report owners. There is no third skill, `/sp:dev-retro`, public CLI change, or protocol bump.

Current-tree premises verified during ready-depth refinement:

- `vendors/misc/retro/SKILL.md` is a 3,388-byte, report-only retrospective with seven environment categories and an implementation-versus-review placement rule; it has no reference tree or tests and remains inspiration only.
- `/sp:dev-find-issue` routes to `sp:history-anatomy`; `plugins/sp/skills/issue-finding/` is a bounded-coexistence legacy surface and is not an implementation target.
- `plugins/sp/skills/dogfood-testing/SKILL.md` is 37,435 bytes against its 37,452-byte BODY_BUDGET baseline; `issue-finding/SKILL.md` is 27,052 against 27,060; `history-anatomy/SKILL.md` is a 3,434-byte dispatcher under the 20,000-byte default budget. None needs to grow.
- `validateReport` in `plugins/sp/scripts/dogfood-testing/validate-report.ts` validates headings, protocol, footer, Issues subheads, and ledger cardinality; it does not parse section 6 bullets. Optional class tags therefore require report-contract documentation and regression tests, not validator logic. Its committed `.mjs` twin remains unchanged.
- `checkReportStructure` in `plugins/sp/scripts/history-anatomy-cache.ts` recognizes only pipe rows whose key already starts with a closed category and checks bullet blocks for field presence. It does not reject an unknown explicit `category` or an unknown key first segment. The root fix is generic enforcement of the existing closed category vocabulary; retro names in owner-surface or signal segments remain valid.

The mapping, both projections, the closed-category gate, generated history-anatomy `.mjs` twin, and focused structural fixtures form one cohesive rollback boundary. `plugins/sp/skills/issue-finding/` and all three named `SKILL.md` bodies remain unchanged.

### Requirements

- [x] R1. Add exactly one `plugins/sp/references/environment-lens.md` mapping that owns the seven canonical names (navigation, automated checks, coding standards, AGENTS.md placement, tool economy, no-ops, information access), their dogfood/history-anatomy projections, and the placement rule: prefer an automated check over always-loaded prose, route coding standards to review, and keep AGENTS.md/CLAUDE.md pointer-only.
- [x] R2. Make `plugins/sp/skills/dogfood-testing/references/report-template.md` and `plugins/sp/skills/history-anatomy/references/report-contract.md` link to that mapping as their category table; neither projection nor any `SKILL.md` may reproduce all seven names as another table.
- [x] R3. Document the optional dogfood section 6 class tag `environment` | `testee` | `waste`, positioned immediately after the em dash and distinct from the trailing feasibility tag, while retaining protocol `sp:dogfood-testing@1.2` and adding no required validator field.
- [x] R4. Prove tagged and untagged @1.2 dogfood reports both pass `validateReport`, including an untagged cache-health P3; do not change `validate-report.ts` or `validate-report.mjs` unless a failing regression demonstrates that the current bullet-agnostic validator premise is false.
- [x] R5. State in the dogfood report contract that an `environment` finding is proposal-only and is never an `Edit`/`Write` target for bounded fix-mode; `testee` step-failure repair remains unchanged and class, not file path, owns the mutation decision.
- [x] R6. Keep history-anatomy's closed category vocabulary exactly `reliability | repetition | workflow | performance | coverage | telemetry | positive`; encode environment-lens names only in `<owner-surface>` or `<signal>`, and make `checkReportStructure` reject any finding whose explicit category or key first segment is outside that closed set.
- [x] R7. Define the additive section 9 projected-candidate shape in `report-contract.md`: a backticked stable key plus owner surface, expected impact, verification method, and reversibility. Existing unprojected numbered prose remains valid, and reports remain proposal-only with no applied change, diff, or claimed execution.
- [x] R8. Classify navigation delays, dead always-loaded instructions, and missed coding standards as `environment`, not `testee`; coding-standards findings name `sp:code-verification`, `sp:code-review`, or pipeline review as owner, never the implementer skill.
- [x] R9. Make automated-check candidates propose a linter, typecheck, test, script-contract check, or filesystem gate rather than another AGENTS.md/CLAUDE.md sentence.
- [x] R10. Leave `plugins/sp/skills/issue-finding/` byte-for-byte unedited and add no new category, flag, or environment-lens projection there.
- [x] R11. Keep `dogfood-testing/SKILL.md` at or below 37,452 bytes and `issue-finding/SKILL.md` at or below 27,060 bytes; keep the mapping and both projections outside those bodies and do not raise BODY_BUDGET baselines.
- [x] R12. Add history-anatomy fixtures proving a report with only closed categories still passes, including unprojected numbered section 9 prose, while an invalid explicit category or key first segment fails and the same environment signal in a later key segment passes.
- [x] R13. Keep `history-anatomy/SKILL.md` a dispatcher below 20,000 bytes with no copied seven-name table; place the projection in its existing report reference.
- [x] R14. Preserve the existing dogfood cache-health P3 contract: aggregate cache below 50% or a step below 40% may remain untagged and still validates under @1.2.

**Out of scope:** installing or invoking vendor `retro`; adding `writing-for-agents`, `CODING_STANDARDS.md`, a new skill/command/CLI surface, required dogfood fields, a dogfood protocol bump, history category expansion, runtime parsing of the markdown mapping, automatic environment remediation, wrap-up/context integration, issue-finding edits, or BODY_BUDGET increases.

### Acceptance Criteria

```gherkin
Feature: Environment-improvement lens: retro categories in dogfood and history-anatomy reports

  @core
  Scenario: R1 — A single plugin-level mapping owns the seven retro categories and the placement rule
    Given the sp plugin tree
    When structural tests load the environment-improvement mapping
    Then exactly one file under "plugins/sp/references/" enumerates the seven categories navigation, automated checks, coding standards, AGENTS.md placement, tool economy, no-ops, and information access
    And that file states the implementer-versus-reviewer placement rule: prefer an automated check over a new always-loaded sentence, place coding standards on the review path not the implementer skill, and keep AGENTS.md as navigation pointers
    And no other file restates those seven names as a second category table

  @core
  Scenario: R2 — Dogfood and history-anatomy projections point at the mapping rather than duplicating it
    Given the plugin-level environment-improvement mapping
    When structural tests scan "plugins/sp/skills/dogfood-testing/references/report-template.md" and "plugins/sp/skills/history-anatomy/references/report-contract.md"
    Then each projection names that mapping file as the category table
    And neither file redefines the seven retro names with different wording

  @core
  Scenario: R3 — A dogfood section 6 finding may carry an optional environment, testee, or waste tag without leaving protocol @1.2
    Given a dogfood run of a skill or command testee under protocol "sp:dogfood-testing@1.2"
    When the driver records a section 6 Findings line tagged "environment", "testee", or "waste"
    Then "validate-report.mjs" accepts the report
    And the report frontmatter protocol remains "sp:dogfood-testing@1.2"

  @core
  Scenario: R4 — An untagged dogfood report remains valid under protocol @1.2
    Given a well-formed "sp:dogfood-testing@1.2" report whose section 6 findings carry no environment, testee, or waste tag
    When "validate-report.mjs" checks the report
    Then the report is accepted
    And those tags are not required fields

  @core
  Scenario: R5 — Dogfood fix-mode does not apply environment-tagged findings as tree mutations
    Given a dogfood run in fix mode that produced an environment-tagged finding
    When the driver applies bounded retries
    Then the driver does not Edit or Write AGENTS.md, skills, rules, or other environment sources for that finding
    And the finding remains a recommended action in section 6 Findings

  @core
  Scenario: R6 — History-anatomy encodes retro names as signal or owner-surface values and rejects them as categories
    Given the closed finding vocabulary "reliability", "repetition", "workflow", "performance", "coverage", "telemetry", and "positive"
    When the structure gate checks section 9 candidates
    Then a finding whose category is one of those seven values and whose stable-key owner-surface or signal carries a retro name passes
    And a finding whose category is a retro name such as "navigation" fails
    And the closed vocabulary in "plugins/sp/skills/history-anatomy/references/report-contract.md" is unchanged

  @core
  Scenario: R7 — History-anatomy environment remediations remain operator proposals
    Given a history-anatomy report whose section 9 carries a candidate projected from the environment lens
    When the report is published
    Then each such remediation names an owner surface, expected impact, verification method, and reversibility
    And the report contains no applied change, no diff, and no command it claims to have run

  @core
  Scenario: R8 — Steering, navigation, and coding-standards remediations are classified as environment changes, not implementer bugs
    Given a dogfood run of a skill or command testee that exhibited a navigation delay, a dead always-loaded instruction, or a missed coding standard
    When the driver records those candidates in section 6 Findings
    Then each is tagged "environment" rather than "testee"
    And a coding-standards finding names a review owner surface ("sp:code-verification", "sp:code-review", or pipeline review), never the implementer skill

  @core
  Scenario: R9 — An automated-check candidate proposes a gate rather than a new always-loaded sentence
    Given a session mistake a linter, typechecker, test, or filesystem linter could have caught
    When the environment lens classifies the candidate
    Then the recommended action is a new or tighter check
    And the action is not a new sentence in AGENTS.md or another always-loaded steering file

  @core
  Scenario: R10 — sp:issue-finding stays a coexistence-window non-target
    Given the skill at "plugins/sp/skills/issue-finding/"
    When structural tests inspect that skill
    Then "SKILL.md" byte size does not exceed the BODY_BUDGET baseline of 27,060
    And the skill gains no new finding category, flag, or environment-lens projection

  @core
  Scenario: R11 — The two named SKILL.md bodies do not grow past their BODY_BUDGET baselines
    Given the skill-structure BODY_BUDGET baselines "dogfood-testing" 37,452 and "issue-finding" 27,060
    When the skill-structure suite runs
    Then neither body exceeds its listed baseline
    And the mapping and both projections live outside those two SKILL.md files

  @edge
  Scenario: R12 — A history-anatomy fixture that uses only the closed category vocabulary still passes the structure gate
    Given a history-anatomy report fixture whose findings use only "reliability", "repetition", "workflow", "performance", "coverage", "telemetry", and "positive"
    When the structure gate runs
    Then the fixture passes
    And no finding is required to carry a retro signal

  @edge
  Scenario: R13 — history-anatomy SKILL.md stays a dispatcher and does not absorb the mapping
    Given "plugins/sp/skills/history-anatomy/SKILL.md"
    When the BODY_BUDGET dispatcher-shape check runs
    Then the body remains under 20,000 bytes
    And the seven retro categories are not copied into that SKILL.md

  @edge
  Scenario: R14 — Existing cache-health P3 findings remain valid without a waste tag
    Given a dogfood report whose section 6 includes the cache-health P3 for aggregate cache percent below 50
    When "validate-report.mjs" checks the report
    Then the report is accepted
    And that P3 does not require an environment or waste tag
```

### Q&A

- **Closed — owning surfaces:** Use one plugin-level mapping projected into dogfood-testing and history-anatomy. `sp:issue-finding` remains the legacy coexistence non-target because `/sp:dev-find-issue` already routes to history-anatomy.
- **Closed — dogfood validation:** Class tags are optional report prose. The current validator deliberately ignores section 6 bullet grammar, so implementation proves compatibility with tests and does not add parsing or required fields.
- **Closed — history validation:** Enforce the already-frozen closed category vocabulary generically. Do not hard-code or load the seven retro names in runtime code; any unknown category is invalid, while later owner/signal segments remain free text.
- **Closed — mutation:** Environment findings are operator proposals only. Dogfood bounded fix may still repair a failed `testee`-class step; history-anatomy remains report-only.
- **Closed — execution boundary:** This task has no dependencies or dependent handoff. All mapping, projection, gate, twin, and fixture changes land and roll back together.
- **Deferred by scope:** A standalone retro skill/command, new public CLI surface, `CODING_STANDARDS.md`, and retirement of issue-finding each require a separate operator decision.

### Design

**Decision and invariants**

Implement the accepted design as one reference SSOT plus two report projections. There is no new API, flag, command, dependency, protocol version, database shape, or task dependency. Do not edit any `SKILL.md`, anything under `plugins/sp/skills/issue-finding/`, `validate-report.ts`, or `validate-report.mjs`; do not raise a BODY_BUDGET baseline.

**Frozen change map**

| Path | Required change |
| --- | --- |
| `plugins/sp/references/environment-lens.md` (new) | Own the canonical seven-name table, the exact projection table from `docs/design/environment-improvement-lens.md`, the three-step placement rule, present-don't-apply, and the keep/drop boundary. |
| `plugins/sp/skills/dogfood-testing/references/report-template.md` §6 | Link `../../../references/environment-lens.md`; add the optional class grammar and classification/mutation rules without changing @1.2 required structure. |
| `plugins/sp/skills/history-anatomy/references/report-contract.md` | Link the same mapping; document closed-category key usage and the additive section 9 projected-candidate line. |
| `plugins/sp/scripts/history-anatomy-cache.ts` | Enforce the existing closed category set for live bullet findings and legacy pipe-row findings. |
| `plugins/sp/scripts/history-anatomy-cache.mjs` | Generated twin only; regenerate from the `.ts` source with `superskill script convert sp history-anatomy-cache.ts`. |
| `plugins/sp/tests/dogfood-testing/report-contract.test.ts` | Add tagged, untagged, and cache-health compatibility cases using the existing complete fixture. |
| `plugins/sp/tests/history-anatomy-cache.test.ts` | Add closed-category, invalid-category/key, valid retro-signal, section 9 prose, and bare-node twin cases. |
| `plugins/sp/tests/skill-structure.test.ts` | Add I9 single-source/projection assertions and reuse the existing R44 BODY_BUDGET gate; do not add a second baseline table. |

**Mapping and dogfood shape**

`environment-lens.md` is documentation SSOT, not runtime configuration. Both projections link to it but do not enumerate all seven names. Dogfood findings retain the current feasibility suffix and gain only this optional prefix after the em dash:

```text
- **<P>** — [environment|testee|waste] <finding>. → **Action:** <change>. (`file:line`, ~effort) [feasible|stale|unverifiable]
```

Omitting the class preserves the current line. `environment` means proposal-only even when the run uses `--max-retry N`; `testee` keeps the existing failed-step repair path; `waste` is diagnostic. Class, not the cited path, decides whether bounded fix may mutate. The cache-health P3 remains legal without a class.

**History-anatomy gate algorithm**

1. Replace the inline closed-category regex literal with one `FINDING_CATEGORIES` constant containing the existing seven history categories and a membership helper. This is the executable closed vocabulary, not a copy of the retro table.
2. Extract the `## Findings` body once. Preserve validation of legacy pipe rows and live `###` bullet blocks, but scope category parsing to that body.
3. For each finding, parse the explicit `category` value and the stable key's first segment after trimming markdown backticks/whitespace. An explicit value outside `FINDING_CATEGORIES` adds `finding-invalid-category:<value>`; an invalid key first segment adds `finding-invalid-key-category:<value>`.
4. Keep the existing missing-field and severity checks. Do not add key/category-equality enforcement in this task.
5. Inspect only the explicit category and first key segment. A key such as `workflow:agents-md:navigation` passes; `navigation:agents-md:delay` fails. Spaced or kebab-case retro names fail automatically because neither is in the closed set. Do not parse `environment-lens.md` at runtime.
6. Section 9 remains additive report grammar, not a new parser branch. A projected bullet begins with a backticked stable key and carries bold `owner surface`, `expected impact`, `verification method`, and `reversibility` fields. Existing numbered prose without a projected-key shape remains valid.

**Structural proof**

Use the existing recursive markdown inventory in `skill-structure.test.ts` to assert that only `plugins/sp/references/environment-lens.md` contains all seven canonical names; both projection references contain the exact relative link; none of the three `SKILL.md` bodies contains the table. R44 remains the sole numeric BODY_BUDGET owner. Add no new fixture file unless an inline mutation of the existing complete report cannot express a case.

The history-anatomy tests must exercise both the TypeScript function and the committed `.mjs` twin's `check` CLI so a timestamp-only script-contract pass cannot hide a stale generated twin.

**Anti-patterns**

Do not add `sp:retro`, `/sp:dev-retro`, `CODING_STANDARDS.md`, another category enum, runtime markdown parsing, required dogfood fields, automatic environment edits/tasks, a section 9 validator that rejects ordinary numbered prose, a manual `.mjs` edit, copied category tables in projection files, or changes to issue-finding/SKILL.md bodies.

### Plan

1. [x] Add `plugins/sp/references/environment-lens.md` from the accepted mapping and extend `skill-structure.test.ts` with the single-source/projection assertions (R1, R2, R8–R11, R13).
2. [x] Update dogfood `report-template.md` §6 with the optional class grammar, classification rules, and environment proposal-only boundary; add tagged/untagged/cache-health cases to `report-contract.test.ts` without changing the validator (R3–R5, R8, R9, R14).
3. [x] Update history-anatomy `report-contract.md` with the mapping link, closed-category signal rule, and additive projected section 9 shape while preserving ordinary prose and proposal-only behavior (R2, R6, R7, R12, R13).
4. [x] Refactor `checkReportStructure` around `FINDING_CATEGORIES`, validate bullet and legacy pipe-row category/key first segments with the frozen error codes, and add positive/negative fixtures including valid later-segment signals (R6, R12).
5. [x] Regenerate only `history-anatomy-cache.mjs` with `superskill script convert sp history-anatomy-cache.ts`; extend the bare-node twin check so the new reject behavior is exercised (R6, R12).
6. [x] Run focused checks first: `bun test plugins/sp/tests/dogfood-testing/report-contract.test.ts`, `bun test plugins/sp/tests/history-anatomy-cache.test.ts`, `bun test plugins/sp/tests/skill-structure.test.ts`, and `bun run script-contract-check`. Confirm `git diff -- plugins/sp/skills/issue-finding plugins/sp/skills/*/SKILL.md` is empty and re-check the three byte budgets (R10, R11, R13).
7. [x] Executed under operator-approved scope waiver: lint/test/test-cf/build/script-contract-green; spur-check/-new aggregate blocked solely by concurrent task-0685 state (DDL scan) — see .spur/run/0686-test-findings.md. Run the project completion gates required by `AGENTS.md`: `bun run autofix`, `bun run spur-check-new`, `bun run lint`, `bun run test`, `bun run test-cf`, and `bun run build`; then record fresh evidence and verify task/feature traceability before lifecycle advancement.

### Solution

Change map (0686-owned paths only). The first `record --solution-from-diff` pass auto-captured foreign uncommitted files from the concurrently running task-0685 session (packages/, apps/, config/); superseded by this curated map. Foreign provenance: `.spur/run/0686-test-findings.md`.

| Change (`file:line`) | What & why |
| --- | --- |
| `plugins/sp/references/environment-lens.md` (new, 4258 B) | Single-source seven-name mapping + projection table + three-step placement rule (R1); keep/drop boundary per ADR-084/085; no `vendors/` literal (R20-clean) |
| `plugins/sp/skills/dogfood-testing/references/report-template.md:§6` | Optional class tag `- [environment\|testee\|waste]` after em dash, distinct from trailing feasibility tag; proposal-only mutation rule; link to mapping (R3, R5, R8, R9) |
| `plugins/sp/skills/history-anatomy/references/report-contract.md` | Closed-vocabulary rejection codes doc; additive §9 projected-candidate shape (owner surface / expected impact / verification method / reversibility); link to mapping (R2, R6, R7) |
| `plugins/sp/scripts/history-anatomy-cache.ts:322-394` | `FINDING_CATEGORIES` const; `## Findings`-scoped parsing of explicit category + key first segment for bullets and legacy pipe rows; error codes `finding-invalid-category:*` / `finding-invalid-key-category:*`; case-insensitive field-presence latent bug fixed (R6) |
| `plugins/sp/scripts/history-anatomy-cache.mjs` | Regenerated twin only, 28095 B (R6; script-contract fresh) |
| `plugins/sp/tests/dogfood-testing/report-contract.test.ts:201+` | Tagged/untagged/cache-health-P3 validateReport cases (19/19) (R4, R14) |
| `plugins/sp/tests/history-anatomy-cache.test.ts:290+,1067+` | Closed-vocab describe: valid set passes, invalid category/key fails, later-segment retro signal passes, legacy dense pipe row, bare-node twin CLI check (62/62) (R12) |
| `plugins/sp/tests/skill-structure.test.ts:1785+` | Exactly-one-file seven-name assertion across shipped markdowns; both projections carry exact relative link; SKILL.mds restatement ban; no BODY_BUDGET table added (64/64) (R2, R13) |

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/references/environment-lens.md:20-28` — the one canonical seven-name projection table |
| R2 | MET | `plugins/sp/tests/skill-structure.test.ts:1808-1821` — both projections carry the exact relative link and neither restates the table |
| R3 | MET | `plugins/sp/skills/dogfood-testing/references/report-template.md:241-250` — optional class grammar after the em dash, protocol unchanged, no required field |
| R4 | MET | `plugins/sp/tests/dogfood-testing/report-contract.test.ts:202-244` — tagged, untagged, and untagged cache-health findings all validate |
| R5 | MET | `plugins/sp/skills/dogfood-testing/references/report-template.md:255-263` — environment findings are proposal-only, never an edit target; class, not path, decides mutation |
| R6 | MET | `plugins/sp/scripts/history-anatomy-cache.ts:322-403` — closed category constant plus rejection of an out-of-set explicit category or key first segment |
| R7 | MET | `plugins/sp/skills/history-anatomy/references/report-contract.md:155-171` — section 9 projected-candidate shape with owner surface, expected impact, verification method, reversibility; proposal-only |
| R8 | MET | `plugins/sp/skills/dogfood-testing/references/report-template.md:262-268` — navigation and dead always-loaded instructions are environment, and coding standards route to a review owner |
| R9 | MET | `plugins/sp/references/environment-lens.md:41-47` — automatable observations become a check, not a reminder sentence in an always-loaded steering file |
| R10 | MET | `git diff -- plugins/sp/skills/issue-finding` empty and `git show --name-only fa4fb0b59` lists no path under it; body 27052 bytes against the 27060 baseline |
| R11 | MET | `plugins/sp/tests/skill-structure.test.ts:1823-1828` — no skill body restates the table; measured bodies 37435 and 27052 bytes against 37452 and 27060, no baseline raised |
| R12 | MET | `plugins/sp/tests/history-anatomy-cache.test.ts:1113-1170` — closed-only passes, unprojected numbered section 9 prose passes, retro name in a later segment passes, invalid category and key fail |
| R13 | MET | `plugins/sp/tests/skill-structure.test.ts:1823-1828` — the dispatcher body restates none of the seven names; measured at 3434 bytes, under the 20000 default |
| R14 | MET | `plugins/sp/tests/dogfood-testing/report-contract.test.ts:234-244` — the untagged cache-health finding is accepted unchanged |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — A single plugin-level mapping owns the seven retro categories and the placement rule | MET | test | `plugins/sp/tests/skill-structure.test.ts:1798-1806` — exactly one shipped markdown enumerates all seven names |
| R2 — Dogfood and history-anatomy projections point at the mapping rather than duplicating it | MET | test | `plugins/sp/tests/skill-structure.test.ts:1808-1821` — exact relative link asserted, seven-name restatement asserted absent |
| R3 — A dogfood section 6 finding may carry an optional environment, testee, or waste tag without leaving protocol @1.2 | MET | test | `plugins/sp/tests/dogfood-testing/report-contract.test.ts:211-222` — all three class tags validate and the class precedes the trailing feasibility tag |
| R4 — An untagged dogfood report remains valid under protocol @1.2 | MET | test | `plugins/sp/tests/dogfood-testing/report-contract.test.ts:224-231` — an untagged finding and a findings-free report both validate |
| R5 — Dogfood fix-mode does not apply environment-tagged findings as tree mutations | MET | test | `plugins/sp/tests/skill-structure.test.ts:1833-1848` — the never-edit and class-not-path clauses are pinned in the report template |
| R6 — History-anatomy encodes retro names as signal or owner-surface values and rejects them as categories | MET | test | `plugins/sp/tests/history-anatomy-cache.test.ts:1129-1150` — a retro name in a later key segment passes while an out-of-set category or key first segment fails by name |
| R7 — History-anatomy environment remediations remain operator proposals | MET | test | `plugins/sp/tests/skill-structure.test.ts:1850-1858` — the four projected fields and the proposal-only clause are pinned in the report contract |
| R8 — Steering, navigation, and coding-standards remediations are classified as environment changes, not implementer bugs | MET | test | `plugins/sp/tests/skill-structure.test.ts:1833-1848` — the environment-not-testee and review-owner clauses are pinned |
| R9 — An automated-check candidate proposes a gate rather than a new always-loaded sentence | MET | test | `plugins/sp/tests/skill-structure.test.ts:1833-1848` — the check-first clause is pinned against the report template |
| R10 — sp:issue-finding stays a coexistence-window non-target | MET | command | `git diff -- plugins/sp/skills/issue-finding` returned empty and the implementation commit touches no path under it; body 27052 bytes against 27060 |
| R11 — The two named SKILL.md bodies do not grow past their BODY_BUDGET baselines | MET | test | `plugins/sp/tests/skill-structure.test.ts:1823-1828` — no skill body restates the table; the byte gate ran green at 66 of 66 |
| R12 — A history-anatomy fixture that uses only the closed category vocabulary still passes the structure gate | MET | test | `plugins/sp/tests/history-anatomy-cache.test.ts:1113-1132` — a closed-only report passes and unprojected numbered section 9 prose passes alongside it |
| R13 — history-anatomy SKILL.md stays a dispatcher and does not absorb the mapping | MET | test | `plugins/sp/tests/skill-structure.test.ts:1823-1828` — no restatement of the seven names; the body measured 3434 bytes, under 20000, with a grep count of zero |
| R14 — Existing cache-health P3 findings remain valid without a waste tag | MET | test | `plugins/sp/tests/dogfood-testing/report-contract.test.ts:234-244` — the untagged cache-health finding is accepted unchanged |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Inline review** (host session mtat5zb9-zg2cj4gy, auto profile): no blocking findings.

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P3 | process/SECUA | packages/domain/src/agent-instance.ts:85 (foreign) | Concurrent task-0685 session wrote shared tree during this run (one-writer violation, 0487-R5 precedent); not touched by 0686 — documented in `.spur/run/0686-test-findings.md` |
| P4 | self-caught | plugins/sp/references/environment-lens.md | Implement briefly tripped skill-structure R20 (`vendors/` literal); reworded pre-commit; nothing outstanding |

Residual risk: low. Aggregate `spur-check`/`spur-check-new` blocked solely by the foreign 0685 DDL scan hit; operator approved scope waiver 2026-08-26 ~19:10 PST. Task-owned evidence green: focused suites 64+62+19, script-contract fresh twin (28095 B), lint/test/test-cf/build/corpus-check(all PASS), `spur task check --corpus` NEW findings attributable to other tasks only. Verify verdict PASS 14/14 MET; proof digest sha256:b7f6a4db060b3318a3d8651c49efaea53f8095a9620d3343a3c58b2051a0492e.

### References

- [Feature I9](../features/I9_environment-improvement-lens-retro-categories-in-dogfood-and-history-anatomy-reports.md)
- [Accepted environment-lens design](../design/environment-improvement-lens.md)
- [Retro-skill brainstorm and keep/drop analysis](../plans/2026-08-26-retro-skills-brainstorm.md)
- [ADR-084/085](../00_ADR.md)
- [Vendor retro source](../../vendors/misc/retro/SKILL.md)
- [Dogfood report contract](../../plugins/sp/skills/dogfood-testing/references/report-template.md)
- [History-anatomy report contract](../../plugins/sp/skills/history-anatomy/references/report-contract.md)
- [History-anatomy surface design](../design/history-anatomy.md)

### History

- 2026-08-27T01:34:40.116Z todo → wip (system)
- 2026-08-27T02:20:06.194Z wip → testing (system)
- 2026-08-27T02:27:55.302Z testing → done (system)
