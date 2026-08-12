---
template: feature-impl
schema_version: 1
name: "Wire facade/spine parity assertions against the captured surface"
description: ""
status: done
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["parity", "harness", "plugins/sp"]
dependencies: ["0516"]
ac_numbering: task-local
created_at: "2026-08-11T22:25:19.879Z"
updated_at: "2026-08-12T03:59:44.175Z"
---

## 0517. Wire facade/spine parity assertions against the captured surface

### Background

Split from task 0512 (feature I2, decomposition 2026-08-11): the assertion slice. 0512 owns the capture helper (with provenance); 0516 owns the exclusion data and ADR-054 boundary. This task wires the focused parity test comparing the facade's documented inventories, the spine's CLI-routed rows, and the AGENTS.md noun table against the live captured surface, reporting drift in both directions. Its focused-suite finding set is the input task 0513 consumes.

Implements feature I2 scenarios: R1 (facade inventories match), R2 (CLI-routed spine rows), R4 (AGENTS.md noun inventory). Ordering: after 0516 (assertions consume the exclusion data).

Rubric: E3 D1 L1 C0 R0 = 5 → split (parent scored 5+; size gate).

### Requirements
- [ ] R1. Add the single focused `plugins/sp/tests/cli-surface-parity.test.ts`, importing the 0512/0516 helper API, to compare facade noun/verb/flag inventories with source-local CLI help in both directions.
- [ ] R2. In that focused test, parse `plugins/sp/skills/spur-dev/SKILL.md` Step routing and validate every `kind: 'cli'` noun/verb against captured help; report every non-CLI row explicitly by its retained reason. Do not modify `routing-table-parity.test.ts`, which owns next-router Markdown/adapter parity.
- [ ] R3. Compare the root CLI noun set bidirectionally with both the facade routing/Tier C tables and `AGENTS.md` § Spur CLI surface, honoring only the reasoned exclusions parsed by 0516. Failure output must label `documented-not-on-CLI` and `on-CLI-not-documented` sets.

Non-goals: generic Commander parsing, duplicated exclusion constants, a second focused test file, runtime CLI changes, or reinterpretation of non-CLI spine rows as verbs.
### Acceptance Criteria
```gherkin
Feature: Source-local CLI parity assertions
  Scenario: R1 — Facade inventories match the live CLI surface
    Given the facade documents noun, verb, and flag inventories
    When the focused parity test compares them with the captured CLI surface
    Then both documented-not-on-CLI and on-CLI-not-documented differences fail the test

  Scenario: R2 — CLI-routed spine rows reference real verbs
    Given a spine routing row is marked as a CLI route
    When its noun and verb are checked against the captured surface
    Then an absent noun or verb fails the test

  Scenario: R3 — AGENTS.md noun inventory matches the CLI
    Given AGENTS.md lists the public Spur CLI nouns
    When the list is compared with the captured root help
    Then a noun present on only one side fails the test
```
### Q&A
- **Test owner:** one new `cli-surface-parity.test.ts` owns live facade/spine/root comparisons. The existing next-router parity test remains unchanged.
- **Facade inventory source:** parse each documented noun's `## Verb map` table and its key-flag cells from `plugins/sp/skills/spur-cli/references/*.md`; use the facade Tier routing table to determine coverage and 0516's Tier C reasons for exclusions.
- **Special nouns:** `init.md` may own both `init` and `status`; Commander-generated `help` is compared at root then excluded only by its Tier C reason.
- **Finding transport:** deterministic assertion messages are the complete finding set consumed by 0513; no parallel report format is introduced.
### Design
Create only `plugins/sp/tests/cli-surface-parity.test.ts`. Import `captureCliSurface`, `parseCommanderHelp`, `parseTierCExclusions`, `parseSpineRoutes`, and `parseOwnershipMarkers` from `tests/helpers/cli-surface.ts`.

Build three deterministic comparisons:

1. Parse the facade noun-routing table and Tier C reasons from `plugins/sp/skills/spur-cli/SKILL.md`; compare their union with root help, with only the parsed Tier C rows treated as reasoned exclusions.
2. For each Tier A/B noun, parse the owned `## Verb map` table in `plugins/sp/skills/spur-cli/references/*.md` (including the combined `init`/`status` reference). Compare documented verbs with `<noun> --help`; for each documented/live verb, compare that row's key flags with `<noun> <verb> --help`. Sort all differences before assertion.
3. Parse `plugins/sp/skills/spur-dev/SKILL.md` Step routing. For each CLI record, capture its noun once and assert its verb exists; retain non-CLI records in the diagnostic with their reason but do not query them as CLI verbs. Parse the `AGENTS.md` noun table between `## Spur CLI surface` and the next H2 and compare it with root help.

Use one small `diffSets` helper local to the focused test and emit both labels even when one side is empty. Cache live capture per command path inside the test process. The source-local entry/version provenance assertion must run for root, noun, and noun+verb captures. Do not add snapshots, a crawler, dependencies, or changes to public/runtime code. The test's sorted failure arrays are 0513's authoritative edit list.
### Plan
- [ ] Add fixture cases for Commander root/noun help to the single focused test, then assert source-local live provenance (0512 R1/R13).
- [ ] Parse and compare facade root nouns plus per-noun verb/flag maps in both directions, using only 0516's reasoned Tier C data (R1/R3).
- [ ] Validate every CLI-classified spine row and the AGENTS.md noun table against captured help; retain reasoned non-CLI rows in diagnostics (R2/R3).
- [ ] Run `bun test plugins/sp/tests/cli-surface-parity.test.ts` and the existing `command-flag-parity`, `flag-contract-parity`, `routing-table-parity`, and `skill-structure` suites.
- [ ] Preserve the complete sorted failure output for 0513; do not correct drift in this task.
### Solution
**New: `plugins/sp/tests/cli-surface-parity.test.ts`** — the single focused parity suite (19 tests) wiring the frozen 0512 capture helper and the 0516 scope parsers into the three deterministic comparisons, exactly per the Design:

- **Provenance (0512 R1/R13):** root, noun, and noun+verb captures each assert source-local provenance (`apps/cli/src/index.ts` entry, `@gobing-ai/spur` package, dynamic version) via `assertProvenance` (`plugins/sp/tests/cli-surface-parity.test.ts:56`); live root help is also re-parsed under the frozen Commander adapter to prove the text still parses (`cli-surface-parity.test.ts:252`).
- **R1 — facade noun routing vs root help:** `## Noun routing` Tier A/B/C union compared bidirectionally with root help (`cli-surface-parity.test.ts:272`); the routing table's Tier C row must agree with `parseTierCExclusions` (`cli-surface-parity.test.ts:263`); every exclusion reason non-empty.
- **R1 — per-noun verb/flag inventories vs live:** each Tier A/B noun's reference inventory (`## Verb map` tables; combined `init.md` `## CLI verbs`; `rules.md`/`workflows.md` `## Command surface` fences — layouts at `cli-surface-parity.test.ts:163`, parsers at `:183`/`:194`) compared with `<noun> --help` (`cli-surface-parity.test.ts:326`); Commander's generated `help` subcommand excluded via its parsed Tier C reason only (`helpNoun` at `cli-surface-parity.test.ts:238` — other Tier C nouns may legitimately be sub-verbs, e.g. `task migrate`). Documented key flags must exist on live `<noun> <verb> --help` Options (`cli-surface-parity.test.ts:332`); live-only flags are the documented "unlisted long-tail", not drift. Leaf nouns (`init`/`status`/`serve`) are noun commands — verified against root help existence plus their own Options block (`cli-surface-parity.test.ts:293`).
- **R2 — spine Step routing:** all six `kind: 'cli'` rows' nouns/verbs verified live (`cli-surface-parity.test.ts:356`); all twelve non-CLI rows retained in the diagnostic with their gate-text reasons, never queried as CLI verbs (`cli-surface-parity.test.ts:373`).
- **R4 — AGENTS.md noun table:** the `## Spur CLI surface` table (13 nouns) compared bidirectionally with root help, honoring only the parsed Tier C exclusions (`cli-surface-parity.test.ts:376`).
- **R8 — ADR-054 boundary:** `parseOwnershipMarkers` claims asserted — facade owns CLI noun/verb/flag semantics incl. status-transition verbs; spine owns orchestration (`cli-surface-parity.test.ts:391`).

One local `diffSets` helper (`cli-surface-parity.test.ts:74`); both labels (`documented-not-on-CLI` / `on-CLI-not-documented`) emitted even when one side is empty; sorted failure arrays are 0513's authoritative edit list; live captures cached per command path (`liveCapture` at `cli-surface-parity.test.ts:50`); no snapshots, crawler, dependencies, or public/runtime changes.

**Modified: `plugins/sp/tests/helpers/cli-surface.ts`** — two minimal fixes to the frozen helper, genuinely needed because the parity gate must read the true live surface (the hardening class 0512's review deferred):

1. `parseCommanderHelp` commands extraction anchored to the entry start `/^ {2}(\S+)/` (`plugins/sp/tests/helpers/cli-surface.ts:67`). Commander wraps long descriptions onto deeper-indented continuation lines whose first word was parsed as a phantom command (`as` under message; `best-effort`/`groups`/`removes`/`serve).` under team; `(DD-14)` under feature; `with` under agent) — corrupting the captured surface for 6 of 10 nouns and generating false `on-CLI-not-documented` findings.
2. `parseSpineRoutes` CLI-gate verb capture `([^\s`]+)` stops at whitespace or the closing backtick (`plugins/sp/tests/helpers/cli-surface.ts:244`) — gates written `` `spur feature create` `` (backtick immediately after the verb) yielded verb `` create` `` for 4 of 6 CLI rows.

**Modified: `plugins/sp/tests/helpers/cli-surface.test.ts`** — one regression fixture: wrapped description lines must not inject phantom commands.

**Verified (from the worktree, `sp/runall-i2-c763`):**

- `bun test plugins/sp/tests/cli-surface-parity.test.ts` → **19 pass / 0 fail** (live surface, with the 0516 exclusion data).
- `bun test plugins/sp/tests/helpers/cli-surface.test.ts` → **17 pass / 0 fail** (16 pre-existing + 1 new regression).
- `bun test plugins/sp/tests/{command-flag-parity,flag-contract-parity,routing-table-parity,skill-structure}.test.ts` → **168 pass / 0 fail** — adjacent parity/structure contracts preserved.

**Drift found:** none beyond the known Commander-generated `help` delta, already covered by the parsed 0516 Tier C exclusion data — the three comparisons pass against the current live surface; the (empty today) sorted failure arrays remain 0513's authoritative edit list. No AGENTS.md correction was needed (its 13-noun table matches live root minus `help` exactly).
### Testing
**Testing**

Re-audited 2026-08-11 via `/sp:dev-verifyall --feature I2 --force`: evidence re-run — cli-surface-parity + skill-structure 73 pass / 0 fail. Verdict artifact regenerated at `.spur/run/0517-verdict.json` (gitignored). Prior verdict evidence below remains accurate.

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Single focused `plugins/sp/tests/cli-surface-parity.test.ts` (443 ln, 19 tests) imports the 0512/0516 helper API (`captureCliSurface`, `parseCommanderHelp`, `parseTierCExclusions`, `parseSpineRoutes`, `parseOwnershipMarkers` — `cli-surface-parity.test.ts:21-30`) and compares facade inventories bidirectionally with source-local CLI help. Provenance asserted for root/noun/noun+verb captures (`assertProvenance` :61, provenance describe :252-266). Facade `## Noun routing` Tier A/B/C union vs root help via `expectParity` (:87, R1 routing describe :268-292) plus per-noun verb/flag inventories (`REFERENCE_LAYOUT` :163 → `## Verb map` / `## CLI verbs` / `## Command surface` parsers :183/:194) vs `<noun> --help` / `<noun> <verb> --help` (:294-362). `diffSets` (:74-84) always emits both `documented-not-on-CLI` and `on-CLI-not-documented` labels, even when one side is empty. |
| R2 | MET | `parseSpineRoutes(spineMd)` (`cli-surface-parity.test.ts:249`; helper `cli-surface.ts:236-250`, CLI-gate regex `^`spur\s+(\S+)\s+([^\s`]+)` at :246) parses `## Step routing` of `plugins/sp/skills/spur-dev/SKILL.md`; R2 describe (`cli-surface-parity.test.ts:365-415`) validates all six `kind: 'cli'` rows' nouns against root commands and verbs against `<noun> --help` (help-filtered :373-389), and retains all twelve non-CLI rows in the diagnostic with their gate-text reasons — non-empty reasons (:390-392) plus the exact 12-step set pinned (:394-413, P3 fix). `routing-table-parity.test.ts` untouched (worktree `git status`: only the parity test, helper, and helper test modified). |
| R3 | MET | Root noun set compared bidirectionally with both facade surfaces: routing/Tier C union vs root help (`cli-surface-parity.test.ts:268-292`, Tier C row must agree with `parseTierCExclusions` :269-281, exclusion reasons non-empty :283-289) and AGENTS.md `## Spur CLI surface` table (13 nouns) vs root help honoring only the parsed Tier C exclusions (`firstTableUnderHeading` + `tierCNouns` filter, R4 describe :417-432). Failure output labels `documented-not-on-CLI` / `on-CLI-not-documented` via `diffSets` (:74-84) in every comparison. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Facade inventories match the live CLI surface | MET | test | `bun test plugins/sp/tests/cli-surface-parity.test.ts` → 19 pass / 0 fail (85 expects), live source-local surface. `expectParity` (:87-92) asserts both `documentedNotOnCli` and `onCliNotDocumented` equal `[]` for the facade noun union vs root help (:272-279) and for per-noun verbs vs `<noun> --help` (:332-333); documented key flags must exist on live `<noun> <verb> --help` Options with the `flags-documented-not-on-CLI` label (:337-360); leaf-noun branch (`init`/`status`/`serve`) checks noun existence in root commands and flag presence (:307-331). Any documented-not-on-CLI or on-CLI-not-documented difference fails the test. Provenance gates each capture path (`assertProvenance` :61, tests :252-266). |
| Scenario: R2 — CLI-routed spine rows reference real verbs | MET | test | R2 test (`cli-surface-parity.test.ts:366-392`): for each of the 6 `kind: 'cli'` rows (live parse: `feature create/check/update`, `task batch-create/update/list`), asserts `rootCommands.toContain(noun)` (:372) and `liveVerbs.toContain(verb)` with `liveVerbs` = `<noun> --help` minus the parsed Tier C `help` exclusion (:373-389) — an absent noun or verb fails. Non-CLI rows: all 12 retained as `step -> gate-text` diagnostic entries (:384), reasons non-empty (:390-392), exact 12-step set pinned and each entry's step→reason pairing asserted (:394-413, P3 fix). |
| Scenario: R3 — AGENTS.md noun inventory matches the CLI | MET | test | R4 test (`cli-surface-parity.test.ts:418-432`): `## Spur CLI surface` table parsed (13 nouns), compared with live root help via `diffSets`; `onCliNotDocumented` honored by excluding only the parsed Tier C nouns (`help`), asserting both labels empty. Routing-table Tier C agreement test (:269-281) proves the exclusion source matches the facade routing table. A noun present on only one side fails the test with the labeled sets. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Verdict: PASS** — 1 P3 + 2 P4 findings; none blocking. All three comparisons verified against the live source-local CLI surface; the frozen 0512/0516 helper surfaces are touched only by the two justified single-line regex fixes, each behaviorally pinned.

**Scope reviewed:** new `plugins/sp/tests/cli-surface-parity.test.ts` (418 ln, 19 tests); helper fixes at `plugins/sp/tests/helpers/cli-surface.ts:67` (`parseCommanderHelp` command-token anchoring `/^ {2}(\S+)/`) and `:244` (`parseSpineRoutes` verb capture `([^\s`]+)`); regression fixture at `plugins/sp/tests/helpers/cli-surface.test.ts:53`. 0517's footprint is exactly these three test-side files — the SKILL.md ADR-054 markers are 0516's, and the docs diffs are 0512/0516 records plus system status flips.

**Frozen-surface audit:** 0512 surface — only the `parseCommanderHelp` commands-extraction regex changed (wrapped description continuation lines no longer inject phantom commands; 6 of 10 nouns were corrupted, generating false `on-CLI-not-documented` findings); `captureCliSurface`, provenance, and the Commander adapter are untouched; regression-pinned by the new wrapped-description fixture. 0516 surface — only the `parseSpineRoutes` CLI-gate verb capture changed (`` `spur feature create` `` previously yielded verb `` create` `` for 4 of 6 CLI rows); Tier C exclusion parser, ownership markers, and the skill tables themselves untouched; pinned end-to-end by the R2 live `toContain(verb)` assertions. No drift beyond the excluded Commander `help` noun; the (empty today) sorted failure arrays remain 0513's authoritative edit list.

**Traceability:** R1 ✓ — facade `## Noun routing` Tier A/B/C union vs root help, plus per-noun verb/flag inventories (`## Verb map` / `## CLI verbs` / `## Command surface` layouts) vs `<noun> --help` / `<noun> <verb> --help`, bidirectional with both `documented-not-on-CLI` / `on-CLI-not-documented` labels always emitted; Tier C row must agree with `parseTierCExclusions`; exclusion reasons non-empty. R2 ✓ — all six `kind: 'cli'` rows' nouns/verbs validated against live help; all twelve non-CLI rows retained with their gate-text reasons and never queried as CLI verbs; `routing-table-parity.test.ts` untouched. R3 ✓ — root noun set compared bidirectionally with both the facade routing/Tier C union and AGENTS.md `## Spur CLI surface` (13 nouns), honoring only the parsed Tier C exclusions. Provenance (0512 R1/R13) asserted for root, noun, and noun+verb captures; R8 ADR-054 ownership boundary asserted. All three AC scenarios covered; non-goals respected (one focused file, no duplicated exclusion constants, no runtime CLI changes, no reinterpreting non-CLI rows as verbs).

**SECUA:** Security — repo-local files and fixed-argv source-local CLI spawn only (`process.execPath run apps/cli/src/index.ts`), never a PATH `spur`; no untrusted input, no shell interpolation, no new dependencies. Errors — fail-loudly throughout (non-Commander help throws, missing headings throw, empty/duplicate exclusion reasons throw, non-zero CLI exit throws with argv, missing/inverted ADR-054 markers throw, unknown noun layout throws); no silent suppression of drift. Cleanliness — no console.*, no .skip, no TODO; helper at 83.2% line / 100% func coverage (uncovered lines are documented failure branches). Unambiguous — deterministic sorted labeled outputs; live captures cached per command path.

**Verification (run in the worktree):** `cli-surface-parity.test.ts` → 19 pass / 0 fail, stable across 4 consecutive runs; `helpers/cli-surface.test.ts` → 17 pass / 0 fail (16 pre-existing + 1 new regression); adjacent `command-flag-parity` / `flag-contract-parity` / `routing-table-parity` / `skill-structure` → 168 pass / 0 fail. The previously observed "unidentified flaky test" (2 spur-check runs) was not reproduced in 4 parity runs here.

**Findings:**

| Severity | Dimension | Finding | Disposition |
|---|---|---|---|
| P1 | — | None. | — |
| P2 | — | None. | — |
| P3 | Cleanliness / R2 | Tautological `expect(diagnostic).toEqual(diagnostic)` at `cli-surface-parity.test.ts:373`: the non-CLI diagnostic array is asserted only against itself — a parser regression that mislabels step→reason pairs would still pass; only reason non-emptiness is actually enforced. | Fix: assert the exact expected non-CLI rows (12 steps with gate-text prefixes) or drop the tautology; keep the non-empty-reason loop. |
| P4 | Errors / R1 | `helpNoun` fallback `?? 'help'` at `cli-surface-parity.test.ts:238` silently defaults if the parsed `help` Tier C exclusion ever vanishes — contradicting its "loud if it ever vanishes" comment. Compensated today: the R1/R4 comparisons would fail loudly on `help` drift. | Assert the `help` exclusion's presence in setup so removal fails at the parser level. |
| P4 | Testing | Fix 2 (`parseSpineRoutes` backtick capture) has no dedicated unit fixture in the helper test — only the `Refine` flags-inside-backticks live case plus R2 end-to-end assertions; the verb-immediately-before-backtick shape is unpinned at unit level. | Add a fixture row `` `spur feature create` `` asserting verb `create`, mirroring the wrapped-description pin. |

**Residual risk:** the observed-but-unreproduced flake remains unexplained (not seen in 4 runs here; spur-check exercises a broader live-CLI set — likely environmental). The suite is intentionally dependent on `apps/cli` building and running (source-local gate by design). No action required before done.
### References
- Feature: I2, scenarios R1, R2, R4
- Design: `docs/design/plugin-surface-parity.md` §§1–5, 7–8
- Decisions: ADR-053, ADR-054
- Dependencies: 0512 (capture/provenance), 0516 (scope and ownership parsers)
- Source surfaces: `plugins/sp/skills/spur-cli/{SKILL.md,references/*.md}`; `plugins/sp/skills/spur-dev/SKILL.md`; `AGENTS.md`
- Existing unaffected owner: `plugins/sp/tests/routing-table-parity.test.ts` (next-router table/adapter only)
- Dependent task: 0513
### History
- 2026-08-12T00:32:02.133Z todo → wip (system)
- 2026-08-12T00:50:13.311Z wip → testing (system)
- 2026-08-12T00:50:14.521Z testing → done (system)
