---
template: issue
schema_version: 1
name: "Harden verdict artifact parsing: accept scenario key, warn on zero-coverage PASS verdicts, and add fuzzy AC title matching"
description: ""
status: done
type: issue
profile: standard
feature_id: H
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
created_at: "2026-08-01T22:24:39.364Z"
updated_at: "2026-08-02T01:32:15.722Z"
---

## 0410. Harden verdict artifact parsing: accept scenario key, warn on zero-coverage PASS verdicts, and add fuzzy AC title matching

### Background
During H9 verification, model-authored PASS verdict artifacts used `scenario` instead of the canonical `id` field on coverage rows. `FeatureCheckService.readVerdictArtifact` silently filtered those rows, so valid-looking PASS artifacts contributed no scenario-verification evidence and produced misleading downstream L4 findings.

The narrow defect is malformed verdict compatibility and diagnostics. AC title matching remains exact after documented normalization; fuzzy semantic matching is intentionally out of scope because DD-09 is a specification traceability gate. Feature-sync retry policy is independent follow-up work, not a prerequisite for this parser fix.
### Requirements
R1. Verdict parsing accepts canonical `{ id, status }` rows and a compatibility alias `{ scenario, status }`, normalizing accepted rows to canonical `id` internally.

R2. When both `id` and `scenario` are present, `id` is authoritative; conflicting values produce an actionable malformed-row finding rather than silent selection.

R3. Missing artifacts, malformed JSON, absent arrays, empty arrays, malformed rows, and valid rows that do not match a feature scenario remain distinguishable outcomes.

R4. A PASS artifact containing rejected coverage rows emits an L4 warning that names the task WBS, artifact path, rejected-row count, and invalid fields. Rows are never silently dropped.

R5. A legitimate task with no applicable acceptance-criteria rows is not warned merely because an array is empty; diagnostics depend on malformed input, not row count alone.

R6. Canonical producers and documentation continue to emit `id`; accepting `scenario` is compatibility behavior, not a second canonical schema.

R7. Regression tests cover canonical `id`, compatible `scenario`, both keys equal, conflicting keys, unknown keys, empty arrays, malformed JSON, missing artifacts, and unmatched valid rows.

R8. Current repository lint, test, test-cf, and build gates remain green with no new `any` or suppression comments.
### Acceptance Criteria
```gherkin
Feature: verdict artifact parsing diagnostics

  Scenario: Canonical id-keyed rows remain supported
    Given a PASS verdict artifact with id-keyed coverage rows
    When feature-check reads the artifact
    Then the rows are parsed without compatibility warnings

  Scenario: Scenario-keyed rows are accepted as a compatibility alias
    Given a PASS verdict artifact with scenario-keyed coverage rows
    When feature-check reads the artifact
    Then each scenario value is normalized to the internal id field
    And matching MET rows can verify their feature scenarios

  Scenario: Conflicting id and scenario keys are rejected visibly
    Given a coverage row whose id and scenario values differ
    When feature-check reads the artifact
    Then the row is rejected
    And an L4 warning names the task, artifact, row, and conflicting fields

  Scenario: Unknown row keys are not silently discarded
    Given a PASS verdict artifact containing rows with neither id nor scenario
    When feature-check reads the artifact
    Then an L4 malformed-artifact warning reports the rejected-row count and invalid fields

  Scenario: Empty valid coverage is distinct from malformed coverage
    Given a readable verdict artifact with valid empty coverage arrays
    When feature-check reads the artifact
    Then it is not reported as a malformed-row problem
    And ordinary scenario-verification rules still determine feature coverage

  Scenario: Missing and malformed artifacts remain distinguishable
    Given one task with no verdict artifact and another with invalid JSON
    When feature-check evaluates scenario satisfaction
    Then the findings identify the correct failure mode and task WBS for each
```
### Q&A
**Q: Is `scenario` a new canonical verdict field?**  
A: No. `id` remains canonical. `scenario` is accepted only as compatibility input because model-authored H9 artifacts repeatedly used it.

**Q: Why not add fuzzy AC title matching?**  
A: DD-09 is a specification traceability gate. Similar wording is not proof of scenario identity; task and feature scenarios should share stable titles or explicit identifiers.

**Q: Why not warn on every PASS artifact with zero rows?**  
A: Zero applicable rows can be legitimate. The actionable defect is malformed or rejected input, which must be diagnosed explicitly.

**Q: Is feature-sync retry behavior part of this task?**  
A: No. It has different ownership and is tracked by task 0411.
### Design
Add a narrow verdict-row decoding result at the existing `FeatureCheckService` artifact boundary. It should return canonical accepted rows plus structured diagnostics for rejected rows and artifact-level failures. Keep `rowMatchesScenario` and DD-09 exact normalized-title semantics unchanged.

For each row, accept a string `id`; otherwise accept a string `scenario` as a compatibility alias. If both exist and differ, reject the row. Preserve enough context to emit one bounded L4 finding per task/artifact rather than one noisy finding per field. Canonical verdict writers, schema documentation, and examples continue to use `id`.

No fuzzy matcher, configuration threshold, mandatory feature-sync dry run, or human-output parsing belongs in this task.
### Plan
- [x] Define accepted-row and artifact-diagnostic shapes at the feature-check boundary.
- [x] Parse canonical id rows and normalize the scenario compatibility alias.
- [x] Emit bounded actionable findings for conflicts, rejected rows, malformed JSON, and missing artifacts.
- [x] Preserve exact normalized AC matching and legitimate empty-array behavior.
- [x] Add the full compatibility and failure-mode regression matrix.
- [x] Synchronize verdict schema documentation if compatibility behavior is externally visible.
- [x] Run focused tests and the repository verification gate.
### Root Cause
`packages/app/src/services/feature-check.ts:607` filters coverage rows by `typeof r.id === 'string'` and returns `null` when no accepted rows remain. Rows using the model-natural `scenario` key, conflicting keys, and other malformed shapes are therefore collapsed into the same generic unverified path without an artifact-specific diagnostic.

The canonical schema uses `id`; H9 dogfood evidence records that three initially generated verdict artifacts used `acceptanceCriteria[].scenario`. The root defect is silent schema degradation at the read boundary, not insufficiently fuzzy scenario-title comparison.
### Solution
`packages/app/src/services/feature-check.ts:22` reuses the existing done-transition verdict reader for missing, unreadable, malformed-JSON, and non-object artifact handling instead of duplicating file/JSON guards.

`packages/app/src/services/feature-check.ts:547` reads each done-task artifact once and emits one bounded `L4.malformed-verdict-artifact` finding with the WBS, full artifact path, rejected-row count, and deduplicated invalid fields.

`packages/app/src/services/feature-check.ts:639` returns canonical accepted rows plus structured artifact/array diagnostics; `packages/app/src/services/feature-check.ts:721` accepts canonical `id` and the `scenario` compatibility alias, rejects conflicting or malformed rows, and preserves exact scenario matching.

`packages/app/tests/services/feature-check.test.ts:2117` adds the canonical/alias/equal/conflict/unknown/empty/malformed/missing/non-object/unmatched regression matrix, including the prior null-root crash and non-string alias gap.

`packages/config/src/finding-codes.ts:59` registers the bounded malformed-artifact finding code, and `plugins/sp/skills/code-verification/references/verdict-schema.md:41` documents `id` as canonical plus the narrow `scenario` compatibility contract.

`docs/design/feature-check-strict-ac-satisfaction.md:21` synchronizes the existing feature-check satisfaction satellite with compatibility-row and malformed-artifact semantics; `docs/04_DESIGN.md:38` indexes it and `docs/04_DESIGN.md:712` updates the command surface.

`AGENTS.md:229` keeps the lean entry-point surface aligned by naming feature AC gates without duplicating the detailed design contract.
### Testing
**Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/feature-check.ts:721` normalizes string `id` or `scenario` rows; alias/canonical regressions at `packages/app/tests/services/feature-check.test.ts:2117`, `:2130`, and `:2368`; `bun run test` exit 0. |
| R2 | MET | `packages/app/src/services/feature-check.ts:748` detects field presence and rejects unequal or non-string dual-key rows; regressions at `packages/app/tests/services/feature-check.test.ts:2143`, `:2156`, and `:2178`; `bun run test` exit 0. |
| R3 | MET | `packages/app/src/services/feature-check.ts:639` preserves artifact failures and `:721` distinguishes absent, empty, invalid, rejected, and populated coverage; regressions at `packages/app/tests/services/feature-check.test.ts:2249`, `:2261`, `:2273`, `:2286`, `:2300`, `:2312`, and `:2325`; `bun run test` exit 0. |
| R4 | MET | `packages/app/src/services/feature-check.ts:556` emits one bounded L4 warning naming WBS/path/count/invalid fields; asserted at `packages/app/tests/services/feature-check.test.ts:2156`, `:2215`, `:2232`, `:2337`, and `:2381`; `bun run test` exit 0. |
| R5 | MET | Empty arrays are accepted without malformed warnings at `packages/app/src/services/feature-check.ts:721`; regression at `packages/app/tests/services/feature-check.test.ts:2249`; `bun run test` exit 0. |
| R6 | MET | Canonical schema remains `id`-keyed at `plugins/sp/skills/code-verification/references/verdict-schema.md:13`; compatibility behavior is isolated at `:41`; canonical regression at `packages/app/tests/services/feature-check.test.ts:2368`; `bun run test` exit 0. |
| R7 | MET | The complete compatibility/failure matrix is covered at `packages/app/tests/services/feature-check.test.ts:2117-2398`; full suite reports 4,347 pass and 0 fail. |
| R8 | MET | Fresh `bun run autofix && bun run spur-check`, `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`, and `git diff --check` all exit 0; changed-file scan finds no `any`, suppressions, skipped tests, console calls, TODO, or FIXME. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: Canonical id-keyed rows remain supported | MET | test | `packages/app/tests/services/feature-check.test.ts:2368`; `bun run test` exit 0. |
| Scenario: Scenario-keyed rows are accepted as a compatibility alias | MET | test | `packages/app/tests/services/feature-check.test.ts:2117`, `:2130`, and `:2354`; `bun run test` exit 0. |
| Scenario: Conflicting id and scenario keys are rejected visibly | MET | test | `packages/app/tests/services/feature-check.test.ts:2156` and `:2178`; `bun run test` exit 0. |
| Scenario: Unknown row keys are not silently discarded | MET | test | `packages/app/tests/services/feature-check.test.ts:2215`; `bun run test` exit 0. |
| Scenario: Empty valid coverage is distinct from malformed coverage | MET | test | `packages/app/tests/services/feature-check.test.ts:2249`, `:2261`, and `:2325`; `bun run test` exit 0. |
| Scenario: Missing and malformed artifacts remain distinguishable | MET | test | `packages/app/tests/services/feature-check.test.ts:2273`, `:2286`, and `:2300`; `bun run test` exit 0. |

**Gate Evidence**

| Check | Status | Evidence |
| --- | --- | --- |
| review | pass | Functional, SECUA, and architecture review is recorded in Review; one P4 stale-comment finding was fixed and no blocker/major remains. |
| task-check-strict-core | pass | `bun run apps/cli/src/index.ts task check 0410 --strict-core --json` exit 0 with no findings at status `testing`. |
| comprehensive-gate | pass | `bun run autofix && bun run spur-check` exit 0: 42 pre-check rules, 4,347 tests/0 failures, and 2 post-check rules. |
| lint | pass | `bun run lint` exit 0 across 581 files and all workspace typechecks. |
| tests | pass | `bun run test` exit 0: 4,347 pass, 0 fail, 13,625 assertions across 243 files; `feature-check.ts` has 100% function and 96.71% line coverage. |
| test-cf | pass | `bun run test-cf` exit 0: 1 test passes. |
| build | pass | `bun run build` exit 0 for CLI, server, and web. |
| diff-integrity | pass | `git diff --check` exit 0 and all modified paths are intentional. |
| fix-pass-disclosure | pass | `.spur/run/0410-verdict.json:1` is replaced with the final machine-readable PASS verdict after this Testing write. |
### Review
**Disposition: PASS** — functional traceability, SECUA, and architecture review found no unresolved blocker or major issue.

**Functional Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/feature-check.ts:721` accepts canonical `id` and compatible `scenario`; regressions start at `packages/app/tests/services/feature-check.test.ts:2117`. |
| R2 | MET | `packages/app/src/services/feature-check.ts:748` detects dual-key presence and rejects unequal/non-string conflicts; tests at `packages/app/tests/services/feature-check.test.ts:2143` and `:2178`. |
| R3 | MET | `packages/app/src/services/feature-check.ts:639` preserves artifact failures and `:721` distinguishes absent, empty, invalid, rejected, and populated coverage; matrix at `packages/app/tests/services/feature-check.test.ts:2249`. |
| R4 | MET | `packages/app/src/services/feature-check.ts:556` emits one bounded warning containing WBS, path, rejected count, and invalid fields; assertions at `packages/app/tests/services/feature-check.test.ts:2156` and `:2381`. |
| R5 | MET | Empty arrays remain valid at `packages/app/src/services/feature-check.ts:721`; regression at `packages/app/tests/services/feature-check.test.ts:2249`. |
| R6 | MET | `plugins/sp/skills/code-verification/references/verdict-schema.md:13` keeps `id` canonical and `:41` documents only the compatibility alias. |
| R7 | MET | Canonical, alias, equal/conflicting keys, unknown keys, empty/absent/non-array coverage, malformed/missing/non-object artifacts, and unmatched rows are covered at `packages/app/tests/services/feature-check.test.ts:2117-2398`. |
| R8 | MET | Fresh `bun run autofix && bun run spur-check`, lint, 4,347-test suite, test-cf, build, and `git diff --check` all exit 0; changed-file anti-pattern scan is clean. |

**P1–P4 Findings**

| Priority | Finding | File:Line | Disposition |
| --- | --- | --- | --- |
| P4 | A pre-0410 test comment still described the former nullable reader behavior. | `packages/app/tests/services/feature-check.test.ts:2025` | Fixed; the comment now describes the actual todo-task eligibility rule. |

No P1, P2, or P3 findings remain.

**SECUA**

| Dimension | Result | Evidence |
| --- | --- | --- |
| Security | Clear | The local artifact boundary adds no new external input, secret, auth, shell, SQL, or path capability. |
| Efficiency | Clear | `packages/app/src/services/feature-check.ts:550` deduplicates done WBS values and reads each artifact once. |
| Correctness | Clear | Null roots, missing/malformed artifacts, malformed rows, aliases, conflicts, empty coverage, and valid unmatched rows have executable regressions. |
| Usability | Clear | `packages/app/src/services/feature-check.ts:577` names task, artifact path, failure mode, count, invalid fields, and remediation. |
| Architecture | Clear | The decoder stays private at the existing feature-check boundary and reuses `readVerdictArtifact`; no new dependency, public API, fuzzy matcher, or retry policy was added. |

**Architecture Deepening**

No deepening candidate survives the deletion test: the private decoder owns non-trivial trust-boundary validation, is exercised through the public `FeatureCheckService`, and keeps verdict compatibility local to its sole consumer.

**Fresh Gate Evidence**

- `bun run autofix && bun run spur-check` — exit 0; 42 pre-check rules, 4,347 tests, and 2 post-check rules pass.
- `bun run lint` — exit 0 across 581 files and all workspace typechecks.
- `bun run test` — exit 0; 4,347 pass, 0 fail, 13,625 assertions across 243 files.
- `bun run test-cf` — exit 0; 1 test passes.
- `bun run build` — exit 0 for CLI, server, and web.
- `git diff --check` and changed-file suppression/debug scan — clean.

Functional Verdict: PASS
### References
- `packages/app/src/services/feature-check.ts:591`
- `plugins/sp/skills/code-verification/references/verdict-schema.md:14`
- `plugins/sp/skills/spur-cli/references/tasks/verbs.md:238`
- `plugins/sp/skills/spur-dev/references/ac-style-guide.md:141`
- `docs/dogfood/2026-08-01-sp-dev-runall-H9-dogfood.md:47`
- Task 0411 — bounded handling of blocked feature-sync results
### History
- 2026-08-02T01:23:50.087Z todo → wip (system)
- 2026-08-02T01:24:24.433Z wip → testing (system)
- 2026-08-02T01:27:26.973Z testing → done (system)
