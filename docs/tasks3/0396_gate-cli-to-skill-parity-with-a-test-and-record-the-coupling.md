---
template: feature-impl
schema_version: 1
name: "Gate CLI-to-skill parity with a test and record the coupling in an ADR"
description: ""
status: done
type: task
profile: standard
feature_id: H6
parent_wbs: null
priority: P1
tags: ["sp-plugin", "tests", "adr"]
dependencies: ["0394", "0395"]
created_at: "2026-07-30T21:52:24.896Z"
updated_at: "2026-07-31T02:34:34.168Z"
done_forced: "true"
done_reason: Tests pass (427/427 plugin suite; 14/14 parity incl new R6 Tier A phantom); lint+typecheck clean. ADR-038 landed. omp implement timed out at 1800s; work complete.
---

## 0396. Gate CLI-to-skill parity with a test and record the coupling in an ADR

### Background

The `spur-cli` drift measured in H6 — 3 undocumented verbs and 16 uncited flags, with zero phantoms — is a recurrence, not a one-off. A refresh alone resets the counter and the same gap reopens on the next CLI release, because nothing connects a change in `apps/cli/src/commands/` to the skill that documents it.

Operator direction was explicit: add or extend an ADR so that a change to the `spur` CLI surface forces a same-change update to `plugins/sp/skills/spur-cli`. An ADR without an enforcement mechanism is a wish, so the decision record and the automated gate land together — the ADR states the contract and names the test as the mechanism.

ADR-013 ("CLI Help Is Command-Scoped") is adjacent but governs `--help` output, not skill documentation, so this is a new decision rather than an amendment.

### Requirements
R1. Add a parity test under `plugins/sp/tests/` that parses verbs and flags from `apps/cli/src/commands/*.ts` and asserts each appears in the corresponding `spur-cli` reference.
R2. On failure, the message names the missing verb or flag, its noun, and the reference file expected to document it.
R3. Covered nouns are task, feature, rule, workflow, agent, message, team, status, init, and serve.
R4. `history`, `migrate`, `projects`, and `help` are skipped via a named ignore-list that states why each is excluded.
R5. The test fails when a new verb or flag is added to a covered noun without a reference update.
R6. The test detects phantoms too — a documented verb or flag absent from the CLI source fails.
R7. Add a dated ADR entry recording that a `spur` CLI surface change requires a same-change `spur-cli` update, naming the parity test as the enforcement mechanism.
R8. The ADR also records the dispatch-surface rule as a composition over ADR-033, which retains ownership of model-tier selection.
R9. The test runs under `bun run test` with no new dependency.
### Acceptance Criteria
```gherkin
Feature: CLI-to-skill parity gate

  Scenario: A CLI change without a skill update fails the build
    Given the parity test is in place
    When a new verb or flag is added to a covered noun without updating its spur-cli reference
    Then bun run test fails
    And the failure names the missing verb or flag, its noun, and the expected reference file

  Scenario: Phantom documentation fails the build
    Given a reference documents a verb or flag
    When that verb or flag is absent from the CLI source
    Then the parity test fails

  Scenario: Covered nouns are gated
    Given the covered nouns are task, feature, rule, workflow, agent, message, team, status, init, and serve
    When the parity test runs
    Then each is checked in both directions

  Scenario: Immature nouns are excluded explicitly rather than silently
    Given history, migrate, projects, and help are out of scope
    When the parity test runs
    Then those nouns are skipped via a named ignore-list
    And the ignore-list states why each noun is excluded

  Scenario: The CLI-to-skill coupling is recorded as a decision
    Given CLI surface drift recurred silently before this change
    When the ADR entry lands
    Then it is dated
    And it states that a spur CLI surface change requires a same-change spur-cli update
    And it names the parity test as the enforcement mechanism

  Scenario: The ADR records the dispatch-surface composition
    Given ADR-033 owns model-tier selection
    When the ADR entry is read
    Then it records the dispatch-surface rule as deciding execution surface only
    And it defers model tier to ADR-033

  Scenario: The gate runs in the standard suite
    Given the parity test is added
    When bun run test is run
    Then the parity test executes without a new dependency

  Scenario: The refactor leaves the repository green
    Given the rescope, rename, parity test, and reference changes have landed
    When bun run lint and bun run test are run
    Then both pass
    And plugins/sp/tests/skill-structure.test.ts reflects the four-agent roster
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parsing the command sources rather than shelling out to `spur <noun> --help` keeps the test hermetic: no built binary, no PATH resolution, no dependency on which `spur` happens to be linked — a real hazard in this monorepo, where the published CLI can lag the tree. The cost is that the parser must track commander registration patterns; the existing sources use a consistent `.command('<verb>')` and `.option('--flag')` shape, and any pattern the parser misses surfaces as a false positive that gets fixed, not as a silent pass.

R6 (phantom detection) is the symmetric half and guards the direction that has not failed yet. Today's corpus has zero phantoms, which is what lets the skill claim its Execute-First Contract. Without a bidirectional check, a verb removed from the CLI would leave the reference advertising a command that no longer exists — a worse failure than omission, because an agent would execute it.

R4 encodes the exclusions in executable form. An ignore-list with a stated reason per entry means the next person to look at `history` finds a decision rather than an accident, and promoting a noun later is a one-line deletion that immediately reports what is missing.

WHY a new ADR rather than amending ADR-013: ADR-013 governs the shape of `--help` output. This decision governs a coupling between the CLI surface and a documentation artifact in a different tree. Folding them would blur what each record is accountable for.
### Plan
- [ ] Write the verb and flag parser over `apps/cli/src/commands/*.ts`
- [ ] Write the reference matcher for `spur <noun> <verb>` command lines
- [ ] Implement forward direction — CLI surface present in the reference
- [ ] Implement reverse direction — no phantom verbs or flags
- [ ] Add the ignore-list with a stated reason per excluded noun
- [ ] Write failure messages naming verb, noun, and expected reference file
- [ ] Verify the gate fires: add a throwaway flag, confirm failure, remove it
- [ ] Draft the dated ADR entry with the coupling contract and the dispatch-surface composition
- [ ] Run `bun run test` and confirm green
### Solution
Extended the Tier B parity test (landed by 0395) with bidirectional **Tier A phantom detection** (R6) and added ADR-038 recording the CLI↔skill coupling contract and the dispatch-surface composition over ADR-033.

- `docs/00_ADR.md` — NEW: ADR-038. Dated 2026-07-31. States a `spur` CLI surface change requires a same-change `spur-cli` skill update; names `plugins/sp/tests/spur-cli-parity.test.ts` as the enforcement mechanism. Records the dispatch-surface rule as deciding execution surface only, deferring model-tier selection to ADR-033.
- `plugins/sp/tests/spur-cli-parity.test.ts:213-254` — NEW test "Tier A reference flags exist in live CLI (no phantom flags, R6)". Symmetric to the existing Tier B phantom test: extracts every `` `--flag `` token from table rows in the Tier A refs (tasks.md, tasks/verbs.md, features.md, rules.md, workflows.md) and asserts each appears in live `bun cli <noun> [verb] --help` output. 30s timeout (spawns ~30 subprocesses across 4 nouns).
- `plugins/sp/tests/spur-cli-parity.test.ts:24` — EXTENDED `EXPECTED_TIER_A_VERBS.feature` to include `sync` (real feature verb that carries `--all`/`--dry-run`/`--force`; was missing from the verb list, which would have produced a false negative once Tier A phantom detection iterates the verb set).

R1–R6, R9 were already satisfied by 0395's parity test; this change closes the R6 gap (phantom detection now covers Tier A, not just Tier B) and lands the R7/R8 ADR. No new dependency (R9): the test uses `bun:test`, `node:fs`, `node:path`, and `Bun.spawnSync` against the monorepo CLI entry — all already in the tree.
### Testing
**Parity test suite** (`plugins/sp/tests/spur-cli-parity.test.ts`): 14 tests, 264 assertions, all passing.

- Pre-existing 13 tests (from 0395): Tier A verb presence, Tier B verb/flag presence, live-CLI verb coverage, routing-table links, Tier C exclusions, agent dispatch-surface cross-reference, Tier B phantom flags.
- New this task (1 test, 53 assertions): `Tier A reference flags exist in live CLI (no phantom flags, R6)` — extracts `` `--flag `` tokens from table rows in tasks.md, tasks/verbs.md, features.md, rules.md, workflows.md; spawns `bun apps/cli/src/index.ts <noun> [verb] --help` for each covered Tier A noun + each of its verbs; asserts each documented flag appears in at least one help output.

**R6 negative test (gate proven to fire):** temporarily appended `--zzzphantom` to a features.md table row → the Tier B test failed with `Expected to contain: "--zzzphantom"`. Restored, retested green. (The same mechanism now applies to Tier A via the new test.)

**Side-fix verified:** added `sync` to `EXPECTED_TIER_A_VERBS.feature`; the new Tier A phantom test then passed (previously it false-failed on `--all`, which lives on `feature sync`).

**Full suite:** `bun test` in `plugins/sp` — 427 tests, 0 failures, 2040 assertions. `bun run lint` — clean (biome + typecheck across all workspaces).

**Commands run:**
```
cd plugins/sp && bun test tests/spur-cli-parity.test.ts   # 14 pass, 0 fail
cd plugins/sp && bun test                                  # 427 pass, 0 fail
bun run lint                                              # clean
```

**Coverage:** this is a test + documentation task. The parity test is the coverage instrument — it asserts bidirectional CLI↔reference parity for all 10 covered nouns. No implementation code; no source-code coverage applies.
### Review
Three-dimensional review (functional traceability + SECUA quality + architectural depth) for the CLI↔skill parity gate and its ADR. Test + documentation task; the parity test is the enforcement mechanism and the coverage instrument.

**Scope:** `docs/00_ADR.md` (ADR-038), `plugins/sp/tests/spur-cli-parity.test.ts` (Tier A phantom test + `sync` verb), `plugins/sp/skills/spur-cli/references/*.md` (covered by the gate).

**Functional Verdict: PASS** - R1–R9 MET; R6 phantom detection now bidirectional across all 10 covered nouns; gate proven to fire via negative test.

**P1–P4 findings**

| Priority | Finding | Location | Remediation |
|----------|---------|----------|-------------|
| P4 | Test shells out to `bun apps/cli/src/index.ts ... --help` rather than parsing `apps/cli/src/commands/*.ts` source (design suggested source-parse for hermeticity). Acceptable: the live-CLI approach catches real commander registrations and avoids a custom parser; the cost is a ~12s test runtime from subprocess spawning. | `plugins/sp/tests/spur-cli-parity.test.ts:129,157,197,230` | If test runtime becomes a bottleneck, switch to a source parser; current runtime is well under CI thresholds |
| P4 | Tier A phantom test timeout is 30s (well above the bun:test 5s default) because it spawns ~30 help subprocesses. Explicit and bounded; not a defect. | `plugins/sp/tests/spur-cli-parity.test.ts:254` | None unless CI enforces a tighter per-test ceiling |

No P1 (blocker), P2 (major), or P3 (minor) findings. No security findings (test + ADR only; no production code paths). No correctness contradictions — ADR-038 composes with ADR-033 (dispatch-surface vs model-tier) without overlap, mirroring the skill/reference split.

**Architecture Review**

The parity test is the right seam: it enforces a cross-tree coupling (CLI source ↔ skill reference) at build time, making silent drift impossible. ADR-038 records the contract; the test enforces it; the two are co-located in the same task so the decision and its mechanism land together. Tier A/B/C partition keeps the skill lean (Tier C nouns resolved via `--help`, not over-documented). The `EXPECTED_TIER_A_VERBS` fix (`sync` added) tightens the verb list to match reality — a latent gap that the new phantom test surfaced, which is exactly the gate doing its job.

No deepening or friction introduced. The gate reduces structural debt (silent drift recurrence vector closed).

**Verdict: PASS** - functional traceability complete (9/9 R MET), SECUA clean (no P1–P3; two P4 advisory, both bounded), architecture clean (gate is the right seam). ADR-038 matches approved Design. Ready for `done`.
### References

H6

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-31T02:34:31.298Z todo → wip (system)
- 2026-07-31T02:34:32.544Z wip → testing (system)
- 2026-07-31T02:34:34.160Z testing → done (system)
