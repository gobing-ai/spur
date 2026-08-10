---
template: standard
schema_version: 1
name: "Fix stale projection drift in sp plugin README and derived docs (version, counts, workflow table)"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T07:14:03.693Z"
updated_at: "2026-08-10T15:24:46.931Z"
done_forced: "true"
done_reason: "Inline execution approved by operator. Pipeline run 1d21cbbf failed at precheck due to infrastructure blockers (omp-zai executor auth + spurBin multi-word execFileSync ENOENT bug). All 8 audit findings applied, R8 stale-string sweep clean, R9 lint+typecheck+contract-test+corpus-check all green. No verify verdict artifact — inline execution bypassed the verify stage."
---

## 0499. Fix stale projection drift in sp plugin README and derived docs (version, counts, workflow table)

### Background
A full-mode, read-only conflict audit (`sp-dev-find-conflict plugins/sp --mode full`) surfaced **8
findings** — all stale-projection drift introduced when the `0.3.22 → 0.3.41` release wave shipped
new entities (`dev-find-conflict` command, `conflict-finding`/`next-feature`/`issue-finding` skills,
`docs-pipeline`/`wayfinder-resolution` workflows) without propagating aggregate counts and version
stamps into derived documentation surfaces.

**Pattern:** per-entity tables (the command index, the skills table) are correct and complete. Only
the **aggregate count strings**, the **version frontmatter**, the **workflow summary table**, and one
**self-referential symlink description** drifted. No structural or contract conflicts were found.

**Authority sources (source of truth for every fix below):**

| Authority | Value |
|---|---|
| `plugins/sp/plugin.json:4` | `"version": "0.3.41"` |
| `.claude-plugin/marketplace.json` | `"version": "0.3.41"` |
| `ls plugins/sp/commands/*.md \| wc -l` | **37** (31 `dev-*` + 6 non-dev) |
| `ls -d plugins/sp/skills/*/ \| wc -l` | **28** |
| `ls config/workflows/*.yaml \| wc -l` | **10** |
| `ls .spur/workflows` | symlink → `../config/workflows` |

**Remediation class:** all 8 findings are mechanical string updates on derived docs — no authority
changes, no schema migrations, no code edits. Per `remediation-routing.md`, every finding routes to
README/derived-doc maintenance.

**Constitution hook:** **T3** (surface code + `docs/04_DESIGN.md` same commit) governs F4; the
version stamp (F1, F5) is part of the release-surface contract.
### Requirements
<!-- R-numbered list of what must be true when this task is complete. -->

- **R1 — README marketplace-entry version matches authority (F1).** `plugins/sp/README.md:13` — the
  `**Marketplace entry:**` bullet's `version: "0.3.22"` reads `"0.3.41"`, matching `plugin.json` and
  `.claude-plugin/marketplace.json` exactly. (Refinement note: the README has no YAML frontmatter;
  line 13 is the marketplace-entry bullet — verified against the file.)
- **R2 — README command count is 37 at all aggregate sites (F2).** Every occurrence of the command
  total in `plugins/sp/README.md` reads `37` — specifically lines 246 (directory tree comment),
  337 (prose count), 351 (`The 36 .md files in commands/` SSOT prose), 359 (validate-commands
  comment), and 470 (mermaid `CMD` node label). The per-command index table is already correct and
  must not change.
- **R3 — README skill count is 28 at the aggregate site (F3).** `plugins/sp/README.md:183`
  directory tree comment reads `(28 skills)`. The per-skill table (lines 288–311) is already
  correct and must not change.
- **R4 — `docs/04_DESIGN.md` command split matches reality (F4).** `docs/04_DESIGN.md:535` reads
  `31 /sp:dev-* wrappers; 37 command wrappers total` (was 30/36). Same-commit sync per T3.
- **R5 — `docs/help/how_to_use_spur_for_daily_software_development.md` version stamp updated (F5).**
  The three `0.3.22` references at lines 3, 74, and 726 read `0.3.41`. If the doc's CLI examples have
  drifted beyond the version stamp, note it in the Solution but do not expand scope — this task is
  the version-stamp fix only.
- **R6 — README workflow table lists all 10 workflows (F6).** The table at `README.md:566` includes
  rows for `docs-pipeline.yaml` and `wayfinder-resolution.yaml` in addition to the existing 8, each
  with the Phase and Entry command values confirmed in Design (sourced from the workflow YAMLs).
- **R7 — README symlink description is corrected (F7).** `README.md:564` no longer contains the
  self-referential `(symlinked from .spur/workflows/)`. Resolution: the parenthetical is **dropped
  entirely** — rule `sp-runtime-path` forbids `config/workflows` literals in `plugins/sp` (ADR-015:
  `config/` is build-time SSOT, `.spur/` is the runtime path), so the audit's proposed
  `../config/workflows` replacement is non-compliant. The runtime path `.spur/workflows/` stands
  alone.
- **R8 — No stale counts remain in the scanned surfaces.** A post-fix grep across
  `plugins/sp/README.md`, `docs/04_DESIGN.md`, `docs/help/how_to_use_spur_for_daily_software_development.md`,
  and `docs/tasks3/0486*.md` (if still open) confirms zero remaining `36 command`, `36 slash`,
  `36 .md`, `27 skill`, or `0.3.22` strings. F8 (task 0486 historical artifact) is informational and
  excluded — 0486 is `done` (verified during refinement).
- **R9 — Contract suite stays green.** `bun run spur-check` (which includes `corpus-check`) and the
  `plugins/sp` test suite pass after the edits. No test relies on a stale count as a fixture; if one
  does, update the fixture to the correct value, not the value to the test.
### Acceptance Criteria
```gherkin
Feature: 0499 Stale projection drift fix

  Scenario: R1 — README marketplace-entry version matches authority
    Given plugins/sp/plugin.json declares version "0.3.41"
    And .claude-plugin/marketplace.json declares version "0.3.41"
    When plugins/sp/README.md line 13 (the Marketplace entry bullet) is read
    Then it contains version: "0.3.41"
    And no "0.3.22" string remains anywhere in plugins/sp/README.md

  Scenario: R2 — README command count is 37 at every aggregate site
    Given 37 command files exist under plugins/sp/commands/
    When the five aggregate-count sites in plugins/sp/README.md are read
    Then line 246 directory tree comment says 37 slash-command wrappers
    And line 337 prose says 37 commands
    And line 351 SSOT prose says The 37 .md files in commands/
    And line 359 validate-commands comment says validate all 37 commands
    And line 470 mermaid CMD node says 37 slash commands
    And the per-command index table is unchanged

  Scenario: R3 — README skill count is 28 at the aggregate site
    Given 28 skill directories exist under plugins/sp/skills/
    When README.md line 183 directory tree comment is read
    Then it says (28 skills)
    And the per-skill table is unchanged

  Scenario: R4 — docs/04_DESIGN.md command split matches reality
    Given 31 dev-* command files and 37 total command files exist
    When docs/04_DESIGN.md line 535 is read
    Then it says 31 /sp:dev-* wrappers; 37 command wrappers total

  Scenario: R5 — help doc version stamp updated to 0.3.41
    Given the authority version is 0.3.41
    When docs/help/how_to_use_spur_for_daily_software_development.md is read
    Then line 3 verified-against banner says 0.3.41
    And line 74 --version example output says 0.3.41
    And line 726 changelog --version example says 0.3.41

  Scenario: R6 — README workflow table lists all 10 workflows
    Given config/workflows/ contains 10 yaml files
    When the README.md workflow-pipelines table is read
    Then it includes rows for docs-pipeline.yaml and wayfinder-resolution.yaml
    And the docs-pipeline row's Entry command is /sp:dev-run --mode implement
    And the wayfinder-resolution row's Entry command is spur workflow run (no slash surface)

  Scenario: R7 — README symlink description is corrected
    Given rule sp-runtime-path forbids config/workflows literals in plugins/sp
    When README.md line 564 is read
    Then it does not say symlinked from .spur/workflows/
    And no config/workflows literal appears in plugins/sp/README.md

  Scenario: R8 — No stale counts remain in scanned surfaces
    Given all fixes R1-R7 are applied
    When a grep for 36 command, 36 slash, 36 .md, 27 skill, and 0.3.22 runs across README, docs/04_DESIGN.md, and the help doc
    Then zero matches are returned

  Scenario: R9 — Contract suite stays green
    Given all R1-R7 edits are applied
    When bun run spur-check runs
    Then it passes including corpus-check
    And the plugins/sp test suite passes
```
### Q&A
<!-- CLOSED decisions from refinement -->

- **F8 excluded from scope.** Decision: task 0486's `36/36 commands` validation record is
  historical/append-only evidence and is not updated. Verified during refinement: 0486 status is
  `done`, so the exclusion holds unconditionally.
- **F6 row values confirmed against the workflow YAMLs (refinement).** `docs-pipeline.yaml` →
  Phase "Docs-only task execution (draft → docs-review HITL → record)", Entry
  `/sp:dev-run --mode implement` (its draft step is a pure slash `agent.run` hop, ADR-043).
  `wayfinder-resolution.yaml` → Phase "Wayfinder ticket resolution loop (investigate → verify →
  record)", Entry `spur workflow run` with a free-form resolution prompt — the YAML header states
  there is no pure-slash research surface yet. The audit's draft values (`sp:doc-evolve`,
  `/sp:dev-plan`) were wrong and are replaced.
- **F1 is not frontmatter (refinement).** `plugins/sp/README.md` has no YAML frontmatter; the stale
  `0.3.22` lives in the line-13 Marketplace entry bullet. R1/AC reworded accordingly.
- **F2 has five sites, not four (refinement).** The audit missed line 351
  (`The 36 .md files in commands/` SSOT prose) and mis-numbered the mermaid node (470, not 468).
  R2/R8 updated to cover all five.
- **F5 scope held to version stamp only.** Decision: the help doc's three `0.3.22` stamps are updated
  to `0.3.41`, but the doc's CLI examples are not re-verified against live `--help`. Condition: if
  examples are otherwise stale, a separate task owns the full re-verification.
### Design
**Approach:** mechanical string corrections on derived documentation. No code, schema, or authority
changes. The per-entity tables (command index, skill table) are already authoritative — only
aggregate counts, version stamps, the workflow summary table, and the symlink description drifted.

**Finding → change map (all 8 findings, owner surface + exact before/after; line numbers verified
against the files during refinement)**

| ID | Sev | File:line | Before | After | Authority |
|---|---|---|---|---|---|
| F1 | Med | `plugins/sp/README.md:13` (Marketplace entry bullet — no YAML frontmatter exists) | `version: "0.3.22"` | `version: "0.3.41"` | `plugin.json`, `marketplace.json` |
| F2a | Low | `plugins/sp/README.md:246` | `# 36 slash-command wrappers` | `# 37 slash-command wrappers` | `ls commands/*.md` = 37 |
| F2b | Low | `plugins/sp/README.md:337` | `**36 commands**` | `**37 commands**` | same |
| F2c | Low | `plugins/sp/README.md:351` | `The 36 .md files in commands/` | `The 37 .md files in commands/` | same |
| F2d | Low | `plugins/sp/README.md:359` | `# validate all 36 commands` | `# validate all 37 commands` | same |
| F2e | Low | `plugins/sp/README.md:470` | `36 slash commands` (mermaid) | `37 slash commands` | same |
| F3 | Low | `plugins/sp/README.md:183` | `(27 skills)` | `(28 skills)` | `ls -d skills/*/` = 28 |
| F4 | Low | `docs/04_DESIGN.md:535` | `30 /sp:dev-* wrappers; 36 command wrappers total` | `31 /sp:dev-* wrappers; 37 command wrappers total` | `ls commands/dev-*.md` = 31; total 37 |
| F5a | Low | `docs/help/how_to_use_spur_for_daily_software_development.md:3` | `spur \`0.3.22\`` | `spur \`0.3.41\`` | `plugin.json` |
| F5b | Low | `docs/help/how_to_use_spur_for_daily_software_development.md:74` | `# 0.3.22` | `# 0.3.41` | same |
| F5c | Low | `docs/help/how_to_use_spur_for_daily_software_development.md:726` | `--version 0.3.22` | `--version 0.3.41` | same |
| F6 | Low | `plugins/sp/README.md:566` table | 8 workflow rows | 10 rows (add `docs-pipeline.yaml`, `wayfinder-resolution.yaml`) | `config/workflows/` = 10 |
| F7 | Low | `plugins/sp/README.md:564` prose | `(symlinked from .spur/workflows/)` | `(symlinked from ../config/workflows)` | `ls -la .spur/workflows` → `../config/workflows` |
| F8 | Info | `docs/tasks3/0486*.md:348` | `36/36 commands` (historical) | **no change** — 0486 is `done` (verified) | — |

**New workflow table rows (F6) — confirmed against the workflow YAMLs during refinement**

| Workflow | Phase | Entry command |
|---|---|---|
| `docs-pipeline.yaml` | Docs-only task execution (draft → docs-review HITL → record) | `/sp:dev-run --mode implement` |
| `wayfinder-resolution.yaml` | Wayfinder ticket resolution loop (investigate → verify → record) | `spur workflow run` (free-form resolution prompt; no slash surface yet) |

> Sources: `docs-pipeline.yaml` draft step runs `agent.run` with input
> `/sp:dev-run --mode implement ${vars.wbs} --auto` (pure slash hop, ADR-043).
> `wayfinder-resolution.yaml` investigate step uses a free-form resolution prompt — its own header
> notes "no pure-slash research surface yet", and forbids invoking `/sp:dev-run`.

**Invariants**

- **Per-entity tables untouched.** The command index and skills table are already correct; widening
  any edit into them risks introducing new drift.
- **No authority changes.** `plugin.json`, `marketplace.json`, and `config/workflows/*.yaml` are not
  modified by this task — they are the authority being projected *from*.
- **No scope creep into the CLI surface or help-doc example re-verification (F5).** This task fixes
  the version stamp only. If the help doc's CLI examples are otherwise stale, that is a separate task.
- **Constitution T3.** The `docs/04_DESIGN.md` edit (F4) and the command-surface change it tracks
  belong in the same commit; here the surface change already shipped (the 37th command), so this is
  the catch-up sync, but the same-commit discipline still applies to the doc edit.

**Out of scope**

- F8 (task 0486 historical artifact) — append-only evidence; 0486 is `done`, confirmed excluded.
- Re-verifying the full help doc's CLI examples against live `--help` output — separate task.
- Any change to `plugin.json`, `marketplace.json`, or workflow YAMLs.
### Plan
1. **Apply F1 — README version stamp.** `plugins/sp/README.md:13` Marketplace entry bullet:
   `0.3.22` → `0.3.41`.
2. **Apply F2 (a–e) — README command count.** Lines 246, 337, 351, 359, 470: `36` → `37`. Do not
   touch the command index table.
3. **Apply F3 — README skill count.** Line 183: `27` → `28`. Do not touch the skills table.
4. **Apply F6 — README workflow table.** At the `### Workflow pipelines` table (starts ~line 566),
   add rows for `docs-pipeline.yaml` and `wayfinder-resolution.yaml` using the confirmed values in
   Design (already extracted from the YAMLs during refinement — no re-read needed beyond a sanity
   check).
5. **Apply F7 — README symlink description.** Line 564 prose: `(symlinked from .spur/workflows/)`
   → `(symlinked from ../config/workflows)`.
6. **Apply F4 — `docs/04_DESIGN.md` command split.** Line 535: `30` → `31` and `36` → `37`.
7. **Apply F5 (a–c) — help doc version stamp.**
   `docs/help/how_to_use_spur_for_daily_software_development.md` lines 3, 74, 726: `0.3.22` → `0.3.41`.
8. **Verify R8 — no stale counts remain.** Grep `36 command`, `36 slash`, `36 .md`, `27 skill`,
   `0.3.22` across `plugins/sp/README.md`, `docs/04_DESIGN.md`, and the help doc → expect zero matches.
9. **Verify R9 — contract suite green.** `bun run autofix && bun run spur-check` (includes
   `corpus-check`). If a test asserts a stale count as a fixture, update the fixture to 37/28.
10. **Commit.** Conventional Commit `docs(sp): sync stale version/counts/workflow table to 0.3.41`.
    Same commit for F4 (T3). Leave status `backlog → wip → review → done` transitions to the pipeline.
### Solution
**Change map (all edits, this task's diff):**

| File:line | Change | Finding |
| --- | --- | --- |
| `plugins/sp/README.md:13` | `0.3.22` → `0.3.41` (Marketplace entry bullet) | F1 |
| `plugins/sp/README.md:183` | `27` → `28 skills` | F3 |
| `plugins/sp/README.md:246,337,351,359,470` | `36` → `37` (five aggregate sites) | F2a–e |
| `plugins/sp/README.md:564` | self-referential symlink parenthetical **dropped** | F7 (deviation, below) |
| `plugins/sp/README.md` workflow table | +2 rows (`docs-pipeline.yaml`, `wayfinder-resolution.yaml`), entries from the workflow YAMLs; columns repadded (MD060) | F6 |
| `docs/04_DESIGN.md:535` | `30/36` → `31/37` | F4 |
| `docs/help/how_to_use_spur_for_daily_software_development.md:3,74,726` | `0.3.22` → `0.3.41` ×3 | F5a–c |

**Deviation (F7, CHANGED — goal-equivalent).** The audit proposed `(symlinked from
../config/workflows)` as the replacement. During verify, rule `sp-runtime-path`
(`config/rules/boundary/sp-runtime-path.yaml`, ADR-015) failed the build: `config/workflows` is a
forbidden literal in `plugins/sp` — `config/` is the build-time bundled-asset SSOT, `.spur/` is the
runtime path. Resolution: drop the parenthetical entirely; the accurate runtime path
`.spur/workflows/` stands alone. R7/AC amended in the task corpus to match. This also invalidates
the symlink-direction detail for the published plugin (where no symlink exists) — dropping it is
the correct projection for both monorepo and published layouts.

**R6 note.** `docs-pipeline.yaml` entry is `/sp:dev-run --mode implement` (its draft step is a pure
slash `agent.run` hop, ADR-043); `wayfinder-resolution.yaml` has no slash surface by design (YAML
header: "no pure-slash research surface yet"), so its entry is `spur workflow run` with a free-form
resolution prompt. The working tree initially had `direct spur workflow run` for both — corrected
during the `--fix all` pass.

**Out of scope confirmed.** F8 untouched (0486 is `done`); help-doc CLI examples not re-verified
against live `--help` (separate task if needed); no authority files modified.
### Testing
**Verdict: PASS** (standalone `/sp-dev-verify 0499 --force --fix all`, 2026-08-10)

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/README.md:13` — `version: "0.3.41"` (re-read this run) |
| R2 | MET | `plugins/sp/README.md:246,337,351,359,470` — all read 37; command index table untouched |
| R3 | MET | `plugins/sp/README.md:183` — `(28 skills)`; skills table untouched |
| R4 | MET | `docs/04_DESIGN.md:535` — `31 /sp:dev-* wrappers; 37 command wrappers total` |
| R5 | MET | `docs/help/how_to_use_spur_for_daily_software_development.md:3,74,726` — all read 0.3.41 |
| R6 | MET | README workflow table = 10 rows; `docs-pipeline.yaml` entry `/sp:dev-run --mode implement`, `wayfinder-resolution.yaml` entry `spur workflow run` (free-form) — values sourced from the workflow YAMLs |
| R7 | MET | `plugins/sp/README.md:564` — self-referential parenthetical removed; no `config/workflows` literal in `plugins/sp` (see Solution deviation note) |
| R8 | MET | `grep '36 command\|36 slash\|36 .md\|27 skill\|0\.3\.22'` across README + 04_DESIGN + help doc → zero matches (exit 1), run this turn |
| R9 | MET | `bun run spur-check` exit=0 this run (45 rule passes incl. corpus-check; lint + typecheck + workspace/plugins-sp tests green) — log `/tmp/spurcheck.log` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — marketplace-entry version | MET | command | `sed -n 13p` → 0.3.41; `grep 0.3.22 README` → 0 matches |
| R2 — command count 37 at five sites | MET | command | `sed` lines 246/337/351/359/470 → all 37 |
| R3 — skill count 28 | MET | command | `sed -n 183p` → `(28 skills)` |
| R4 — 04_DESIGN split 31/37 | MET | command | `sed -n 535p` → 31/37 |
| R5 — help doc 0.3.41 ×3 | MET | command | `sed` lines 3/74/726 → 0.3.41 |
| R6 — workflow table 10 rows | MET | command | table re-read; entries match workflow YAML draft/investigate steps |
| R7 — self-referential symlink text gone | MET | command | `grep 'symlinked from \`.spur/workflows/\`'` → 0; `sp-runtime-path` rule passes |
| R8 — no stale counts | MET | command | grep across three surfaces → zero matches |
| R9 — contract suite green | MET | command | `bun run spur-check` exit=0 |

**SECUA Review**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; docs-only string sync, verdict PASS |

**Fix-pass disclosure.** One fix-pass mutation this run: `plugins/sp/README.md` workflow table
(R6 entry cells + column repad for MD060) and line 564 (F7 rework, see Solution). Verdict artifact:
`.spur/run/0499-verdict.json` (written after verdict final; re-evaluated R6/R7 evidence after fix).

Coverage: N/A (documentation-only change; no runtime code path added).
### Review
No blocking findings. All 8 audit findings were mechanical string updates on derived documentation — no structural changes, no contract changes, no authority source changes.

| Priority | Finding | File | Resolution |
| -------- | ------- | ---- | ---------- |
| P4 (Low) | F8: Historical `36/36 commands` validation record in task 0486 | `docs/tasks3/0486_*.md:348` | Excluded — append-only historical evidence, not in scope for this sync task |

**Summary:** Version stamps, aggregate counts, and the workflow table in `plugins/sp/README.md`, `docs/04_DESIGN.md`, and the help doc now match their filesystem/codegen authorities. The symlink description fix corrects a path that was always wrong (`.spur/workflows/` is itself the symlink; it points to `../config/workflows/`). Zero blast radius — changes are prose in non-executable documentation.
### References
- **Audit skill:** `sp:conflict-finding` (`plugins/sp/skills/conflict-finding/`) + references
  (`authority-resolution.md`, `comparison-protocol.md`, `finding-contract.md`, `remediation-routing.md`)
- **Authority files:** `plugins/sp/plugin.json`, `.claude-plugin/marketplace.json`,
  `config/workflows/*.yaml`
- **Constitution:** `docs/99_PROJECT_CONSTITUTION.md` — T3 (surface + `docs/04_DESIGN.md` same
  commit), T10 (corpus-check baseline reconciliation)
- **Derived surfaces fixed:** `plugins/sp/README.md`, `docs/04_DESIGN.md`,
  `docs/help/how_to_use_spur_for_daily_software_development.md`
- **Related task (informational F8):** `docs/tasks3/0486_…findconflict….md`
- **Validation scripts:** `plugins/sp/scripts/validate-commands.ts`,
  `plugins/sp/scripts/validate-flag-contracts.ts`
### History
- 2026-08-10T07:41:14.616Z backlog → todo (system)
- 2026-08-10T07:41:14.769Z todo → wip (system)
- 2026-08-10T07:41:15.140Z wip → testing (system)
- 2026-08-10T07:42:12.476Z testing → done (system)
