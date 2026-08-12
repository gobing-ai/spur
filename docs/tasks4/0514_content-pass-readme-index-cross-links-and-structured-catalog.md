---
template: feature-impl
schema_version: 1
name: "Content pass: README index, cross-links, and structured-catalog ownership"
description: ""
status: done
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["parity", "content-pass", "plugins/sp"]
dependencies: ["0513"]
ac_numbering: task-local
created_at: "2026-08-11T20:41:23.667Z"
updated_at: "2026-08-12T01:13:36.526Z"
---

## 0514. Content pass: README index, cross-links, and structured-catalog ownership

### Background
Phase 2 of feature I2 — the bounded content/discoverability review that follows the green parity layer. Implements: R5 — README indexes match shipped plugin surfaces; R6 — Plugin cross-links resolve; R7 — Structured catalogs have one owner.

Checks and fixes, bounded per the design doc (§6): every `plugins/sp/README.md` command index entry resolves to a shipped command/skill/agent surface and every shipped surface is indexed; every cross-link in plugin surfaces and the AGENTS.md doc map resolves to an existing file, section, or command; duplicated exact/structured catalogs (verb lists, routing rows, noun tables) are consolidated so one surface owns each and others link to the owner. Arbitrary prose similarity is left to bounded manual review only — mechanical duplication detection is limited to exact catalogs, never general prose. Add no new runtime, dependency, schema, or transport.

Ordering: third task — runs after the drift-fix task so the review covers a settled surface; independent of the harness internals. Rubric: E2 D1 L1 C0 R0 = 4 → task (optional band; kept separate as the goal's explicit phase 2 with its own review gate — merging into the fix task would push it past target_max_hours 8h).
### Requirements
- [ ] R1. Extend `skill-structure.test.ts` R43 so the existing README tables index every shipped `commands/*.md`, `skills/*/SKILL.md`, and `agents/*.md` entry exactly once within their owning README sections; report both missing shipped entries and indexed names without a shipped target.
- [ ] R2. Extend the existing structural checks rather than adding a crawler: R16c validates relative Markdown file plus heading anchors across plugin Markdown; the AGENTS.md doc-map rows resolve to existing `docs/*.md`; existing R16b continues to own `sp:<skill>` references; R43 owns command/skill/agent index targets.
- [ ] R3. Detect only exact machine-comparable structured catalogs (Markdown noun/verb/flag/routing/index tables or explicit lists). Retain the ADR-054/current-test owner and replace any reported duplicate catalog with a link; do not score arbitrary prose similarity.

Non-goals: new test file, generic Markdown crawler, prose rewriting, runtime behavior, public CLI changes, dependencies, schemas, persistence, or transport.
### Acceptance Criteria
```gherkin
Feature: Plugin content and discoverability pass

  Scenario: R1 — README indexes match shipped plugin surfaces
    Given plugins/sp ships commands, skills, and subagents
    When the README index assertion runs
    Then every shipped surface is indexed exactly once and every entry resolves

  Scenario: R2 — Plugin cross-links resolve
    Given plugin markdown and the AGENTS.md doc map contain checked references
    When the focused link assertion resolves their targets
    Then no checked file, heading, command, or skill reference is missing

  Scenario: R3 — Structured catalogs have one owner
    Given the same exact noun, verb, flag, routing, or index catalog appears on multiple surfaces
    When the content pass completes
    Then one surface owns the catalog and the remaining surfaces link to it
```
### Q&A
- **Existing owners:** `skill-structure.test.ts` R43 owns README index completeness and R16c owns relative Markdown links; extend those assertions instead of adding a new test family.
- **Duplication threshold:** exact tables and machine-comparable inventories only. Similar prose is reviewed manually and is not a finding by itself.
- **Edit boundary:** only files exposed by an index, link, or exact-catalog finding are changed.
### Design
Keep all changes in the existing structural owner `plugins/sp/tests/skill-structure.test.ts` plus Markdown files named by failures.

- Expand R43's existing directory enumeration from commands to three tuples: `commands/*.md` ↔ `### Command index`; `skills/*/SKILL.md` ↔ `#### 1. Skills`; `agents/*.md` ↔ `#### 3. Agents`. Parse only the first backticked name cell in each owning table, then report missing, duplicate, and indexed-without-file entries.
- Extend R16c's current relative-`.md` resolver to validate optional `#heading` fragments using GitHub-style lowercase/hyphen heading slugs. Add the root `AGENTS.md` doc-map paths as a bounded second input and `stat` each backticked `docs/*.md` target. Keep R16b as the skill-reference owner; do not add another skill scanner.
- For structured-catalog ownership, compare only tables/lists explicitly named by ADR-054 or the current tests. When exact duplicates are found, keep the facade verb inventory, spine Step routing, README entity index, or AGENTS noun table as applicable and replace non-owner copies with a link. Similar prose is never a mechanical finding.

Run the assertions first and edit only paths named by their diagnostics. No new test file, parser package, runtime helper, or production code. 0515 may later update planning-workflow guidance; this task leaves the structural suite green before that dependency starts.
### Plan
- [ ] Extend R43 to bidirectionally cover command, skill, and agent README tables against shipped files (R1).
- [ ] Extend R16c for relative heading anchors and the bounded AGENTS.md doc-map paths; retain R16b/R43 as skill/command target owners (R2).
- [ ] Run `bun test plugins/sp/tests/skill-structure.test.ts` and capture exact index/link/catalog findings before editing Markdown.
- [ ] Fix only reported README entries, links/anchors, and exact duplicate catalogs at their named owners (R1–R3).
- [ ] Re-run `skill-structure.test.ts` plus `cli-surface-parity.test.ts`; verify the diff contains no runtime, CLI, schema, dependency, persistence, or transport files, then hand off to 0515.
### Solution
R1 (README index completeness) — `plugins/sp/tests/skill-structure.test.ts` R43 rewritten from the
single-command regex scan into a table-driven bidirectional check over the three owning README index
tables: `### Command index` ↔ `commands/*.md` (37), `#### 1. Skills` ↔ `skills/*/SKILL.md` (28),
`#### 3. Agents` ↔ `agents/*.md` (4). Each section is bounded to its own table (commands run to the
next `## ` heading; skills/agents to the next `#### ` subsection inside `### Entity design`) and only
the first backticked name cell of each table row counts as an index entry, so prose mentions cannot
register as duplicates or as indexed-without-a-target. Reports missing shipped entries, duplicated
names, and indexed names with no shipped file. Pre-existing index state was already complete — no
README edits required.

R2 (cross-links resolve) — R16c extended to validate `#fragment` anchors: each anchor must match a
GitHub-style lowercase/hyphen heading slug (same `slugify` as `scripts/validate-commands.ts`) or an
explicit `**Anchor:** `#id`` directive (the flag-glossary.md convention, honored by
`validate-commands.ts`), with the anchor set cached per target file. A bounded second R16c test stats
every backticked `docs/*.md` target in the root `AGENTS.md` doc map (all 7 resolve). The scan found
2 broken anchors, fixed to point at their real heading slugs:
- `skills/spur-dev/references/execution-batch.md:684` — `flag-glossary.md#-next-chain-contract` →
  `#--next-chain-contract` (heading `## --next chain contract`).
- `skills/spur-dev/references/flag-glossary.md:369` —
  `execution-batch.md#worktree-isolation---worktree` →
  `#worktree-isolation---worktree-name` (heading `## Worktree isolation (`--worktree [<name>]`)`).

R3 (structured-catalog ownership) — new R3 test detects exact machine-comparable duplicates only:
normalized markdown tables (≥2 data rows, whitespace-insensitive cells) and explicit ≥3-item lists
of backticked tokens, compared across shipped plugin markdown (tests/ and evals/ fixtures excluded
as intentional samples; prose similarity never scored, per the ADR-054 amendment). The scan found no
exact duplicate catalog on any two shipped surfaces — the ADR-054 owners (facade verb inventory,
spine Step routing, README entity index, AGENTS noun table) already hold their catalogs exclusively,
so no duplicate-to-link replacement was required.

No runtime, CLI, schema, dependency, persistence, or transport files touched.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/tests/skill-structure.test.ts:746-838` — R43 rewritten from single-command regex into a table-driven bidirectional check over the three owning README tables: `### Command index` ↔ `commands/*.md` (37 shipped, verified `ls plugins/sp/commands/*.md` = 37), `#### 1. Skills` ↔ `skills/*/SKILL.md` (28 shipped, verified `ls -d plugins/sp/skills/*/` = 28), `#### 3. Agents` ↔ `agents/*.md` (4 shipped, verified = 4). Section bounding: command span runs to next `## `, skill/agent spans to next `#### ` subsection (skill-structure.test.ts:787-791); only the first backticked name cell of each table row counts as an index entry (skill-structure.test.ts:801-804), so prose mentions cannot register as duplicates or indexed-without-a-target. Asserts missing/duplicated/noTarget for each surface (skill-structure.test.ts:829-833). `bun test plugins/sp/tests/skill-structure.test.ts` → 51 pass / 0 fail, 476 expects. |
| R2 | MET | `plugins/sp/tests/skill-structure.test.ts:138-166` — R16c extended in place (no new crawler): `#fragment` must resolve to a GitHub-style heading slug or an explicit `**Anchor:** #id` directive, anchor set cached per target file (anchorSet, skill-structure.test.ts:62-74). slugifyHeading (skill-structure.test.ts:55-59) is byte-identical to the runtime validator `plugins/sp/scripts/validate-commands.ts:42-46` (same `.toLowerCase()`, same `/[^\p{Letter}\p{Number} -]/gu` strip, same `.replaceAll(' ', '-')`) — the test asserts the same contract the tool enforces. Second bounded R16c test (skill-structure.test.ts:168-183) stats every backticked `docs/*.md` target in root `AGENTS.md` — all 7 (00_ADR, 01_PRD, 02_ROADMAP, 03_ARCHITECTURE, 04_DESIGN, 05_FEATURES, 99_PROJECT_CONSTITUTION) verified present. R16b retained as `sp:<skill>` owner (skill-structure.test.ts:108-135). 2 broken anchors found and fixed: `plugins/sp/skills/spur-dev/references/execution-batch.md:684` → `flag-glossary.md#--next-chain-contract` (target heading `## \`--next\` chain contract`, flag-glossary.md:375); `plugins/sp/skills/spur-dev/references/flag-glossary.md:369` → `execution-batch.md#worktree-isolation---worktree-name` (target heading `## Worktree isolation (\`--worktree [<name>]\`)`, execution-batch.md:416). Both slugs verified by slugifyHeading. |
| R3 | MET | `plugins/sp/tests/skill-structure.test.ts:841-872` — new R3 test in the existing structural owner detects only exact machine-comparable catalogs: whitespace-normalized markdown tables (≥2 data rows, header row part of key, skill-structure.test.ts:856-870) and explicit ≥3-item backticked token bullet lists (skill-structure.test.ts:872-879); `tests/` and `evals/` fixtures excluded as intentional samples (skill-structure.test.ts:848-850); prose similarity never scored, per the ADR-054 amendment `docs/00_ADR.md:467` ("Duplication assertions are limited to exact catalogs and structured inventories, never arbitrary prose"). Independent read-only re-run of the identical scan logic: 152 shipped files scanned, 361 machine-comparable catalogs found, 0 cross-surface exact duplicates, README.md in the comparison universe — scan is non-vacuous and would have fired on a real duplicate. No duplicate-to-link replacement was required because the ADR-054 owners (facade verb inventory, spine Step routing, README entity index, AGENTS noun table) already hold their catalogs exclusively. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — README indexes match shipped plugin surfaces | MET | test | `bun test plugins/sp/tests/skill-structure.test.ts` → 51 pass / 0 fail (476 expects), including R43 at skill-structure.test.ts:746 which asserts every shipped surface is indexed exactly once and every entry resolves, per surface: commands 37/37, skills 28/28, agents 4/4 (shipped counts verified independently against the filesystem; R43 also asserts each owning section heading exists, skill-structure.test.ts:782-784). |
| Scenario: R2 — Plugin cross-links resolve | MET | test | R16c at skill-structure.test.ts:138 runs over all plugin Markdown: every relative `.md` link must stat and every `#fragment` must match a GitHub-style heading slug or explicit Anchor directive; the root AGENTS.md doc-map test (skill-structure.test.ts:168) stats all 7 `docs/*.md` rows (verified present). The two broken anchors found by the scan were fixed and re-verified: execution-batch.md:684 → `flag-glossary.md#--next-chain-contract` (heading flag-glossary.md:375), flag-glossary.md:369 → `execution-batch.md#worktree-isolation---worktree-name` (heading execution-batch.md:416). Green gate (51/51) confirms no checked file, heading, command, or skill reference is missing. |
| Scenario: R3 — Structured catalogs have one owner | MET | test | R3 test at skill-structure.test.ts:841 detects exact duplicate structured catalogs across shipped surfaces (tables ≥2 data rows; backticked bullet lists ≥3 items; tests/evals excluded; prose never scored). Independent re-run: 361 catalogs compared across 152 shipped files, 0 exact duplicates — the ADR-054 owners already hold each catalog exclusively, so the one-owner invariant holds and no link-replacement was needed. Detection mechanism verified genuine (README's own large tables are in the universe), so the scenario is MET with a vacuous consolidation half. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
Reviewed against the worktree diff (branch sp/runall-i2-c763): `plugins/sp/tests/skill-structure.test.ts` (+185/−28), `plugins/sp/skills/spur-dev/references/execution-batch.md` (anchor fix @684), `plugins/sp/skills/spur-dev/references/flag-glossary.md` (anchor fix @369). README.md untouched (index already complete — matches the task's edit-boundary). No runtime, CLI, schema, dependency, persistence, or transport files in the diff.

## Traceability

| Req | Verdict | Evidence |
|---|---|---|
| R1 README indexes match shipped surfaces | PASS | R43 rewritten to a table-driven bidirectional check over `### Command index` ↔ `commands/*.md` (37), `#### 1. Skills` ↔ `skills/*/SKILL.md` (28), `#### 3. Agents` ↔ `agents/*.md` (4); only the first backticked name cell of each table row counts; reports missing / duplicated / indexed-without-a-target. Verified section bounding against the real README (command span `### Command index` → next `## `; skill/agent spans bounded by next `#### ` subsection) — no stray tables in any span. |
| R2 Cross-links resolve | PASS | R16c extended in place (no crawler): `#fragment` must match a GitHub-style heading slug or an explicit `**Anchor:** #id` directive, with per-file anchor cache. Slugify and the Anchor regex verified byte-identical to `plugins/sp/scripts/validate-commands.ts` (the runtime validator) — test asserts the same contract the tool enforces. Second bounded R16c test stats all 7 backticked `docs/*.md` doc-map rows in root AGENTS.md — all resolve. R16b retained as `sp:` reference owner; R43 owns index targets. |
| R3 Structured catalogs have one owner | PASS | New R3 test in the existing file detects only exact machine-comparable catalogs (whitespace-normalized tables ≥2 data rows; explicit ≥3-item backticked token lists); tests/ and evals/ excluded as intentional fixtures; prose similarity never scored (ADR-054 amendment, docs/00_ADR.md:451). Scan is non-vacuous (README's own large tables are in the comparison universe) and found no exact duplicate on any two shipped surfaces — ADR-054 owners already hold their catalogs exclusively, so no duplicate-to-link replacement was required. |

## SECUA

- **Security**: no new surface — read-only test code and two doc link fixes; no exec, network, secrets, or writes to production paths. Anchor/slug regexes are anchored literals (no ReDoS/injection vector).
- **Errors**: all failure diagnostics carry `relative path → target (reason)` (e.g. "missing file", "no such heading/anchor") and named counts — actionable when the gate fires.
- **Correctness**: both anchor fixes verified against the real target headings: flag-glossary.md `## \`--next\` chain contract` → slug `--next-chain-contract`; execution-batch.md `## Worktree isolation (\`--worktree [<name>]\`)` → slug `worktree-isolation---worktree-name`. `bun test plugins/sp/tests/skill-structure.test.ts` → 51 pass / 0 fail, 476 expects.
- **Usability**: R43's section array is table-driven and self-describing; anchor cache avoids re-reading targets; comments state the WHY of each bounded scope.

## Findings

| Pri | Finding | Evidence | Disposition |
|---|---|---|---|
| P1 | None | — | — |
| P2 | None | — | — |
| P3 | None | — | — |
| P4 | R3 duplicate-catalog threshold is the minimum (≥2 data rows, header row part of the key). A future intentional reuse of a small 2-row legend/status table across two reference docs would trip the gate with no escape hatch. | skill-structure.test.ts R3 (`dataRows.length >= 2`) | Informational — zero false positives today; revisit only if a legitimate shared 2-row table appears. |
| P4 | R3 fixture exclusion is substring-based on `…/plugins/sp/tests` and `…/plugins/sp/evals`; a future shipped path containing either segment would be silently excluded from catalog scanning. | skill-structure.test.ts R3 filter (`!p.includes(...tests)` / `...evals`) | Informational — current plugin layout has no such shipped path; harden to a directory check only if layout grows. |

## Residual risk

Low. The R3 "one owner" AC passed vacuously (no duplicate existed to consolidate) — the detection mechanism is genuine and would have fired, but the link-replacement half of the scenario was not exercised by a live duplicate. Anchor semantics are tied to `validate-commands.ts`'s slugify; if that tool's algorithm ever changes, R16c and the validator must change together (same failure surface, low drift risk since both live in plugins/sp).

## Verdict

**PASS** — all three requirements implemented as specified, 51/51 tests green, edit boundary respected, no findings above P4.
### References
- Feature: I2
- Design: `docs/design/plugin-surface-parity.md` §§6–8
- Existing owner: `plugins/sp/tests/skill-structure.test.ts` R16c and R43
- Dependency: 0513 (green parity surfaces)
- Dependent task: 0515
### History
- 2026-08-12T01:06:23.505Z todo → wip (system)
- 2026-08-12T01:13:35.387Z wip → testing (system)
- 2026-08-12T01:13:36.526Z testing → done (system)
