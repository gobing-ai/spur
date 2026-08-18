---
template: feature-impl
schema_version: 1
name: "Parity scope data: explicit exclusions and the ADR-054 ownership boundary"
description: ""
status: done
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["parity", "harness", "plugins/sp"]
dependencies: ["0512"]
ac_numbering: task-local
created_at: "2026-08-11T22:25:19.816Z"
updated_at: "2026-08-18T04:42:48.720Z"
---

## 0516. Parity scope data: explicit exclusions and the ADR-054 ownership boundary

### Background
Split from task 0512 (feature I2, decomposition 2026-08-11). Task 0512 creates the source-local capture helper; this task makes the existing facade and spine scope tables mechanically consumable without copying them into a second fixture; 0517 wires the live parity assertions.

Current-tree premises verified during ready refinement: `plugins/sp/skills/spur-cli/SKILL.md` already owns a Tier C table with reasons for `history`, `migrate`, `projects`, and Commander's generated `help`; `plugins/sp/skills/spur-dev/SKILL.md` already owns the Step routing table, whose `CLI gate` cells distinguish backticked `spur <noun> <verb>` routes from prompt/schema/skill dispatch. ADR-054 keeps noun/verb/flag semantics, including status transitions, in the facade and multi-step orchestration in the spine.

Implements feature I2 scenarios R8, R11, and R12. Ordering: after 0512 because it extends that helper; before 0517 because the focused assertions consume these parsers.

Rubric: E3 D1 L1 C0 R0 = 5 → split from the original six-item harness task.
### Requirements
- [ ] R1. Extend `plugins/sp/tests/helpers/cli-surface.ts` to parse Tier C exclusions directly from `plugins/sp/skills/spur-cli/SKILL.md`; every excluded noun, including generated `help`, must retain a non-empty reason. Do not duplicate the table in a TypeScript allow-list.
- [ ] R2. Parse `plugins/sp/skills/spur-dev/SKILL.md` Step routing rows into explicit CLI and non-CLI records: only a backticked `spur <noun> <verb>` gate is a CLI route; prompt, schema, slash-command, inline, and skill dispatch rows are non-CLI records with their table text retained as the reason.
- [ ] R3. Expose the ADR-054 ownership markers from the two skill documents so 0517 can assert facade-owned CLI semantics (including status-transition verbs) and spine-owned orchestration without banning legitimate lifecycle verbs from the facade.

Non-goals: no second exclusion catalog, regex-based silent ignore list, public CLI/runtime change, or assertion of live parity (owned by 0517).
### Acceptance Criteria
```gherkin
Feature: Parity scope data
  Scenario: R1 — Explicit facade exclusions do not create false drift
    Given a noun is explicitly marked as outside the facade reference with a reason
    When the parity harness compares documented coverage
    Then that noun is not reported as missing facade documentation

  Scenario: R2 — Non-CLI spine routes do not create false drift
    Given a spine row targets a slash command or inline model-bearing step
    When CLI route parity is checked
    Then the row is excluded explicitly rather than treated as a missing CLI verb

  Scenario: R3 — Facade and spine ownership remain distinct
    Given the facade and spine state their ADR-054 ownership
    When the boundary assertion runs
    Then ownership inversion fails while facade-owned status-transition verbs remain valid
```
### Q&A
- **Exclusion owner:** the existing Tier C Markdown table remains the only noun-exclusion catalog; tests parse it instead of mirroring it.
- **Route classification:** a Step routing gate is CLI-routed only when its gate cell starts with a backticked `spur <noun> <verb>` command. Every other row is retained as an explicit non-CLI record rather than ignored by regex miss.
- **Boundary check:** 0516 freezes parsers and ownership markers; 0517 owns the live assertions. Status-transition verbs remain facade-owned under ADR-054.
- **Deferred:** arbitrary prose classification and semantic-duplication detection remain outside the mechanical parity gate.
### Design
Extend the single helper created by 0512; add no fixture module or new test file. Freeze these exports:

- `parseTierCExclusions(markdown): Array<{ noun: string; reason: string }>` reads only the `### Tier C exclusion reasons` table and fails on an empty reason or duplicate noun.
- `parseSpineRoutes(markdown): Array<{ step: string; kind: 'cli' | 'non-cli'; noun?: string; verb?: string; reason: string }>` reads only `## Step routing`; a backticked `spur <noun> <verb>` gate yields `kind: 'cli'`, while every other gate yields `kind: 'non-cli'` with the original gate text as `reason`.
- `parseOwnershipMarkers(facadeMarkdown, spineMarkdown)` returns the two documented ownership claims and fails if either ADR-054 phrase is absent or inverted.

Use section-heading boundaries plus Markdown table cells, not global regex suppression. Update `plugins/sp/skills/spur-cli/SKILL.md` or `plugins/sp/skills/spur-dev/SKILL.md` only if the current table/ownership wording cannot satisfy the parsers; the Markdown remains authoritative. 0517 imports these functions and compares only `kind: 'cli'` rows with live help. Do not touch `routing-table-parity.test.ts`, which owns the unrelated next-router Markdown/adapter contract.
### Plan
- [ ] Add the Tier C, Step routing, and ownership parsers to the 0512 helper (R1–R3).
- [ ] Normalize only the two owning skill tables/phrases if parsing proves them ambiguous; never create a copied exclusion list.
- [ ] Run a direct helper smoke import against both skill files and assert: four reasoned Tier C nouns; at least one CLI and one non-CLI route; facade/spine ownership markers present.
- [ ] Run `bun test plugins/sp/tests/skill-structure.test.ts plugins/sp/tests/routing-table-parity.test.ts` to preserve existing structure/routing contracts, then hand the parser API to 0517.
### Solution

**`plugins/sp/tests/helpers/cli-surface.ts`** — extended the 0512 helper with the three frozen
0516 scope parsers (no new fixture module, per the Design; section at `plugins/sp/tests/helpers/cli-surface.ts:122`):

- `parseTierCExclusions(markdown)` (`plugins/sp/tests/helpers/cli-surface.ts:199`) — reads only
  the `### Tier C exclusion reasons` table of `plugins/sp/skills/spur-cli/SKILL.md`
  (section-heading + table-cell scoped, no global regex suppression). Returns `{ noun, reason }[]`;
  fails loudly on an empty reason or a duplicate noun. Commander's generated `help` is consumed
  here like any other Tier C noun — excluded with a reason, never regex-silenced (R1).
- `parseSpineRoutes(markdown)` (`plugins/sp/tests/helpers/cli-surface.ts:232`) — reads only the
  `## Step routing` table of `plugins/sp/skills/spur-dev/SKILL.md`. A row is `kind: 'cli'` only
  when its `CLI gate` cell starts with a backticked `spur <noun> <verb>`; every other gate
  (prompt work, schema, slash-command, inline driver, skill dispatch) is retained as
  `kind: 'non-cli'` with the original gate text as its `reason`, so spine rows are never reported
  as missing CLI verbs (R2). Live table yields 6 CLI rows (`feature create`, `feature check`,
  `task batch-create`, `task update`, `task list`, `feature update`) and 12 explicit non-CLI rows.
- `parseOwnershipMarkers(facadeMarkdown, spineMarkdown)` (`plugins/sp/tests/helpers/cli-surface.ts:292`)
  — returns each surface's documented ADR-054 ownership claim (`{ facade, spine }`); fails when
  the marker is absent or inverted (facade claiming `owns multi-step lifecycle orchestration`, or
  spine claiming `owns CLI noun/verb/flag semantics`). Phrase matching normalizes Markdown
  whitespace so a wrapped marker still satisfies the contract (R3). Nothing here bans lifecycle
  verbs from the facade — status-transition verbs remain valid facade semantics for 0517 to assert
  against the live CLI.

**`plugins/sp/skills/spur-cli/SKILL.md:104`** — added one ADR-054 ownership bullet to
`## What this skill is NOT`: the facade owns CLI noun/verb/flag semantics (including task and
feature status-transition verbs); multi-step lifecycle orchestration belongs to `sp:spur-dev`.
The Tier C table itself was already authoritative (4 reasoned nouns incl. `help`) and is now
mechanically consumed, not mirrored.

**`plugins/sp/skills/spur-dev/SKILL.md:48`** — added the `**Ownership (ADR-054).**` paragraph after
the intro: the spine owns multi-step lifecycle orchestration; CLI noun/verb/flag semantics are
the facade's. The existing Step routing table needed no change — its gate cells already
distinguish backticked `spur <noun> <verb>` routes from dispatch rows.

**`plugins/sp/tests/helpers/cli-surface.test.ts:122`** — added the `0516 scope parsers` describe
block reading both live SKILL.md files: 4 reasoned Tier C nouns incl. `help`; duplicate/empty
reason and missing-heading failures; CLI vs non-CLI route classification (with noun/verb on CLI
rows and gate text retained as reason on non-CLI rows); ownership claims present; inversion and
missing-marker failures. The 0512 frozen surface (`captureCliSurface` / `parseCommanderHelp`)
is untouched.


The exclusion and route catalogs stay single-source in the two owning skill tables (ADR-054,
`docs/design/plugin-surface-parity.md` §4–5) — 0516 only makes them mechanically consumable so
0517 can compare `kind: 'cli'` rows and reasoned exclusions against the live captured CLI
without a copied allow-list or regex silence.
### Testing
**Testing**

Re-audited 2026-08-11 via `/sp:dev-verifyall --feature I2 --force`: evidence re-run — cli-surface-parity + skill-structure 73 pass / 0 fail. Verdict artifact regenerated at `.spur/run/0516-verdict.json` (gitignored). Prior verdict evidence below remains accurate.

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `parseTierCExclusions` (`plugins/sp/tests/helpers/cli-surface.ts:199-228`) reads only the `### Tier C exclusion reasons` table (heading const `plugins/sp/tests/helpers/cli-surface.ts:131`) of `plugins/sp/skills/spur-cli/SKILL.md:55` via section-heading-scoped `tableUnderHeading` (`plugins/sp/tests/helpers/cli-surface.ts:168-186`) — no global regex suppression, no copied TypeScript allow-list (the Markdown table remains the single catalog). Table rows at `SKILL.md:61-64` carry non-empty reasons for all four nouns (`history`, `migrate`, `projects`, `help`); `help` is reasoned as Commander-generated (`SKILL.md:64`). The parser strips backticks, fails loudly on an empty reason (`plugins/sp/tests/helpers/cli-surface.ts:215-217`), a duplicate noun (`plugins/sp/tests/helpers/cli-surface.ts:218-220`), or an absent heading (`plugins/sp/tests/helpers/cli-surface.ts:204-206`). Live smoke run: `parseTierCExclusions(SKILL.md)` returns exactly `[history, migrate, projects, help]`, each with non-empty reason. |
| R2 | MET | `parseSpineRoutes` (`plugins/sp/tests/helpers/cli-surface.ts:232-250`) reads only the `## Step routing` table (heading const `plugins/sp/tests/helpers/cli-surface.ts:133`) of `plugins/sp/skills/spur-dev/SKILL.md:101` (rows at `SKILL.md:108-125`). A row is `kind: 'cli'` only when its `CLI gate` cell starts with a backticked `spur <noun> <verb>` (`plugins/sp/tests/helpers/cli-surface.ts:239-245`); every other gate — prompt work, schema (`task-batch.schema.json`), slash-command (`sp:dev-refineall`), inline YAML driver, skill dispatch (`sp:code-implementation`, `sp:parallel-execution`) — is retained as `kind: 'non-cli'` with the original gate text as `reason` (`plugins/sp/tests/helpers/cli-surface.ts:246-248`), so spine rows are never regex-missed or reported as missing CLI verbs. Live smoke run: 18 rows → 6 `cli` (`feature create`, `feature check`, `task batch-create`, `task update` [Refine, inline `--section` flag], `task list`, `feature update`) and 12 explicit `non-cli` records with gate text retained. Absent heading fails loudly (`plugins/sp/tests/helpers/cli-surface.ts:234-236`). |
| R3 | MET | `parseOwnershipMarkers` (`plugins/sp/tests/helpers/cli-surface.ts:297-306`) delegates to `ownershipClaim` (`plugins/sp/tests/helpers/cli-surface.ts:262-279`) and returns each surface's documented ADR-054 claim. Facade marker: `plugins/sp/skills/spur-cli/SKILL.md:104-106` ("the ADR-054 boundary: this facade owns CLI noun/verb/flag semantics — including task and feature status-transition verbs — while multi-step lifecycle orchestration belongs to `sp:spur-dev`"). Spine marker: `plugins/sp/skills/spur-dev/SKILL.md:48-50` ("This spine owns multi-step lifecycle orchestration — intake, gates, decomposition, pipeline runs, HITL pauses. CLI noun/verb/flag semantics, including status-transition verbs, are the facade's (`sp:spur-cli`), never this skill's."). Fails when the marker is absent (`plugins/sp/tests/helpers/cli-surface.ts:268-270`), when the owns-phrase is absent (`plugins/sp/tests/helpers/cli-surface.ts:271-273`), or when the boundary is inverted (`plugins/sp/tests/helpers/cli-surface.ts:274-276`); phrase matching normalizes Markdown whitespace so wrapped markers still satisfy the contract (`plugins/sp/tests/helpers/cli-surface.ts:266`). Status-transition verbs remain facade-owned — nothing bans lifecycle verbs from the facade (doc comment `plugins/sp/tests/helpers/cli-surface.ts:291-296`). Live smoke run returns both claims. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Explicit facade exclusions do not create false drift | MET | test | `bun test plugins/sp/tests/helpers/cli-surface.test.ts plugins/sp/tests/skill-structure.test.ts plugins/sp/tests/routing-table-parity.test.ts` → 69 pass / 0 fail (545 expects); cli-surface.ts 100% funcs / 96.93% lines. Test `plugins/sp/tests/helpers/cli-surface.test.ts:122-131` parses the live SKILL.md and asserts exactly `['history', 'migrate', 'projects', 'help']`, every reason non-empty, `help` reasoned `/Commander/i`; `plugins/sp/tests/helpers/cli-surface.test.ts:133-137` proves empty-reason and duplicate-noun failures; `:139-141` proves absent-heading failure. Because the parser consumes the authoritative Tier C table with a reason attached to every noun, a noun explicitly excluded there is never reported as missing facade documentation — no false drift. |
| Scenario: R2 — Non-CLI spine routes do not create false drift | MET | test | Test `plugins/sp/tests/helpers/cli-surface.test.ts:143-162` parses the live Step routing table and asserts ≥1 cli and ≥1 non-cli row, `task`/`feature` nouns present, the `Refine` row CLI-routed with noun `task` / verb `update` despite the inline `--section` flag, and non-CLI rows retaining gate text as reason (e.g. `Intake` reason contains `prompt work`); `:164-166` proves absent-heading failure. Live parse yields 6 cli + 12 non-cli records. A spine row targeting a slash command (`sp:dev-refineall`), inline model-bearing step, schema, or skill dispatch is excluded explicitly with its gate text as reason — never treated as a missing CLI verb, so CLI-route parity checks see no false drift. |
| Scenario: R3 — Facade and spine ownership remain distinct | MET | test | Test `plugins/sp/tests/helpers/cli-surface.test.ts:168-176` parses both live documents and asserts `facade.surface === 'facade'`, claim contains `ADR-054` and `owns CLI noun/verb/flag semantics`, `spine.surface === 'spine'`, claim contains `owns multi-step lifecycle orchestration`; `:178-180` proves an inverted boundary (facade claiming orchestration) throws `/inverts the ADR-054 boundary/`; `:182-185` proves a missing marker throws. Ownership claims live at `spur-cli/SKILL.md:104` and `spur-dev/SKILL.md:48`. The boundary assertion fails on inversion while the facade's documented ownership explicitly includes status-transition verbs (`SKILL.md:104-106`) — so facade-owned lifecycle verbs remain valid, distinct from spine orchestration. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Reviewer:** Review0516 — `/sp:dev-review 0516 --auto` (functional traceability + SECUA + architecture)

**Scope reviewed:** 0516's uncommitted diff on `sp/runall-i2-c763` — the 0516 scope-parser section of
`plugins/sp/tests/helpers/cli-surface.ts:122-306`, the 8 new tests in
`plugins/sp/tests/helpers/cli-surface.test.ts:122-256`, the owning-skill edits
(`plugins/sp/skills/spur-cli/SKILL.md:104`, `plugins/sp/skills/spur-dev/SKILL.md:48`), and the
`docs/design/plugin-surface-parity.md` +2-line note. The 0512 capture half of the helper is untouched.


| Severity | Dimension | Finding | Disposition |
|----------|-----------|---------|-------------|
| P4 | Architecture (robustness) | `ownershipClaim` (`cli-surface.ts:280-281`) tests the inversion phrase against the whole normalized document, not the ADR-054 ownership paragraph — a future accurate cross-reference of the counterpart's ownership inside the same SKILL.md (e.g. a summary bullet "the spine owns multi-step lifecycle orchestration" in spur-cli/SKILL.md) would throw a false "inverts the ADR-054 boundary". Untriggered today; fails loudly (safe direction). | Accept — scope the inversion check to the `paragraphContaining` output if a false positive ever surfaces |
| P4 | Robustness | `parseSpineRoutes` (`cli-surface.ts:239`) hardcodes the CLI-gate column at `cells[2]`; inserting or reordering a column in the `## Step routing` table would silently misclassify every row as non-cli. Header-row column lookup would pin the contract. | Accept — live-table tests pin the current shape; revisit only if the table evolves |
| P4 | Data completeness (handoff to 0517) | Multi-command gate cells capture only the first verb: the `Continue` row's `` `spur feature update` / `refresh` `` yields verb `update` only, and the two `spur workflow run` mentions classify non-cli (gates start with "inline YAML driver or …" / "sp:super-planner + …"). Full gate text is retained in `reason` for every row, so no documentation is lost — but 0517 must not treat `refresh` / `workflow run` as parity holes. | Inform 0517 — data lives in `reason`, not cli-row verbs; no 0516 change |
| P4 | Coverage | Defensive branches untested: `cli-surface.ts:210` (empty noun cell), `:253` (dead `idx === -1` in `paragraphContaining`, unreachable behind the normalized marker check), `:279-281` (one owns-phrase-absent throw per surface). Helper suite: 100% funcs / 96.93% lines. | Accept — adequate for a test helper; add tests only if branches become reachable |


- **R1 — PASS.** `parseTierCExclusions` (`cli-surface.ts:199`) reads only the `### Tier C exclusion reasons`
  table (`plugins/sp/skills/spur-cli/SKILL.md:55`), section-heading scoped with no global regex
  suppression. Live parse yields exactly `history / migrate / projects / help`, each with a non-empty
  reason (`help` reasoned as Commander-generated, `SKILL.md:63`); fails loudly on empty reason, duplicate
  noun, or absent heading. No TypeScript mirror of the exclusion catalog — the Markdown table remains the
  single source. AC R1 (explicit exclusions produce no false drift) satisfied.
- **R2 — PASS.** `parseSpineRoutes` (`cli-surface.ts:232`) reads only the `## Step routing` table
  (`plugins/sp/skills/spur-dev/SKILL.md:101`); 18 live rows → 6 `kind: 'cli'` (`feature create`,
  `feature check`, `task batch-create`, `task update` — inline `--section` flag still CLI-routed — `task
  list`, `feature update`) and 12 `kind: 'non-cli'` with the original gate text retained as `reason`.
  Prompt work, schema, slash-command, inline-driver, and skill-dispatch rows are explicit non-CLI
  records, never regex-missed. AC R2 (non-CLI routes not reported as missing CLI verbs) satisfied.
- **R3 — PASS.** `parseOwnershipMarkers` (`cli-surface.ts:292`) reads ADR-054 markers from both skills;
  facade bullet `spur-cli/SKILL.md:104` ("owns CLI noun/verb/flag semantics — including task and feature
  status-transition verbs; multi-step lifecycle orchestration belongs to `sp:spur-dev`") and spine
  paragraph `spur-dev/SKILL.md:48` ("owns multi-step lifecycle orchestration; CLI noun/verb/flag
  semantics … are the facade's") both match; the doc edits (+3/+4 lines) are the minimal normalization
  the Design permitted. Inversion (facade claiming orchestration) and missing-marker cases throw. Nothing
  bans lifecycle verbs from the facade — status-transition verbs remain valid facade semantics for 0517.
  AC R3 (ownership distinct; inversion fails) satisfied.

Non-goals respected: no second exclusion catalog, no regex-based silent ignore list, no public
CLI/runtime change, no live-parity assertion (deferred to 0517). `routing-table-parity.test.ts` untouched.


- **Structure / Clarity (A):** section-scoped comment block, documented frozen interfaces, clear naming;
  extends the 0512 helper module without a new fixture or parallel catalog — matches Design.
- **Error handling (A):** loud failures for absent heading, empty reason, duplicate noun, missing/inverted
  markers; no silent skips. Minor: an empty gate cell would silently yield a non-cli row with an empty
  reason (no current row triggers it).
- **Usability (A):** frozen export shapes (`{ noun, reason }`, `{ step, kind, noun?, verb?, reason }`,
  `{ facade, spine }`) are directly consumable by 0517; `reason` always carries the source table text.
- **Security (N/A):** reads two trusted local SKILL.md files; no untrusted input, no injection surface.


- `bun test plugins/sp/tests/helpers/cli-surface.test.ts` → **16 pass / 0 fail** (8 new 0516 tests;
  helper 100% funcs / 96.93% lines).
- `bun test plugins/sp/tests/skill-structure.test.ts plugins/sp/tests/routing-table-parity.test.ts` →
  **53 pass / 0 fail** — adjacent structure/routing contracts preserved.


**PASS** — 0 × P1, 0 × P2, 0 × P3, 4 × P4 (all accepted or informational). R1–R3 fully traced, AC
scenarios R1/R2/R3 satisfied, gates green. Residual risk limited to the documented P4 robustness nits
(whole-doc inversion check, hardcoded gate column) and the 0517 handoff note (`refresh` / `workflow run`
live in `reason`, not cli-row verbs).
### References
- Feature: I2, scenarios R8, R11, R12
- Design: `docs/design/plugin-surface-parity.md` §§4–5, 7–8
- Decision: ADR-054
- Dependency: 0512 (`plugins/sp/tests/helpers/cli-surface.ts`)
- Authoritative data: `plugins/sp/skills/spur-cli/SKILL.md` Tier C table; `plugins/sp/skills/spur-dev/SKILL.md` Step routing
- Dependent task: 0517
### History
- 2026-08-12T00:13:01.160Z todo → wip (system)
- 2026-08-12T00:18:45.770Z wip → testing (system)
- 2026-08-12T00:18:46.847Z testing → done (system)
