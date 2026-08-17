---
template: feature-impl
schema_version: 1
name: "Update dev-find-issue command docs: latest source list, template default parity, history-load preflight pointer"
description: ""
status: done
type: task
profile: standard
feature_id: E2
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-16T16:39:31.132Z"
updated_at: "2026-08-17T00:49:25.003Z"
---

## 0570. Update dev-find-issue command docs: latest source list, template default parity, history-load preflight pointer

### Background
`plugins/sp/commands/dev-find-issue.md` is the `reviewer`-role wrapper over `sp:issue-finding` —
report-first session forensics over the history data plane. The command shipped as part of feature
E2's forensics work (task 0556) and has not been re-synced since the history plane grew. Three
concrete drifts were verified against the current tree on 2026-08-16 (after task 0567 shipped
`/sp:dev-history-load`):

1. **Stale `--source` value list.** The command's argument-hint and flag table list
   `auto|omp|claude|codex|gemini|opencode|antigravity|openclaw|pi`, but the `spur history` CLI
   (both `import` and `analyze`) now accepts
   `pi|claude|codex|gemini|opencode|antigravity|openclaw|omp|grok|agy|all`
   (`apps/cli/src/commands/history.ts:54`, `:132`). `grok` and `agy` are missing from the command
   surface; `all` (the CLI default) is missing too.

2. **`--template` default mismatch.** The command's flag table says `standard`
   (`dev-find-issue.md:29`), but the skill SSOT (`sp-issue-finding` Arguments table) says the
   default is `meta` — "Task template: `meta` (multi-fix umbrella), `issue` (single finding), or
   `standard`" (`sp-issue-finding/SKILL.md:49`). A doc-only default that disagrees with the skill
   misleads operators into expecting `standard` when `meta` is produced.

3. **No import-preflight pointer.** Task 0567's Q&A records the deferred integration gap:
   "`/sp:dev-find-issue` assumes the history data plane is already loaded and has no import
   preflight … Revisit after this command ships, when `/sp:dev-history-load` is the obvious thing
   for that preflight to recommend" (`docs/tasks4/0567…:135`). `/sp:dev-history-load` is now
   shipped and green; the command docs should point at it as the on-demand preflight so an operator
   who finds empty forensics knows the one-command remedy.

This is a documentation-conformance task: no CLI surface, no new flags, no behavior change. The
command is a long-tail `Skill()` wrapper (no numbered `dev-operations.md` row), so the fix is the
command file itself plus verification against the plugin closure tests (`command-flag-parity`,
`command-contract`, `roles`).
### Requirements
- [x] R1. Update the `--source` value list in `plugins/sp/commands/dev-find-issue.md` (argument-hint frontmatter + `## Argument Flags` table) to match the `spur history` CLI surface: `auto|pi|claude|codex|gemini|opencode|antigravity|openclaw|omp|grok|agy|all`. Keep `auto` as the skill-level default (the skill resolves it); add the CLI's `grok`, `agy`, and `all` values. Acceptance: the hint and table list the full source set; `command-flag-parity` and `command-contract` suites still pass (flag tokens unchanged — only the value vocabulary inside `<…>` changes, which the parity gates do not tokenize).
- [x] R2. Fix the `--template` default in the `## Argument Flags` table to `meta` (matching `sp-issue-finding` SSOT), with a clarifying note matching the skill: `issue` is the explicit single-finding override, `standard` the generic override. Acceptance: the table default cell reads `meta`; a reader cross-checking the skill sees no disagreement.
- [x] R3. Add an import-preflight pointer in the command's `## Usage` section: before forensics, direct operators to `/sp:dev-history-load` when the data plane may be stale/empty (the shipped on-demand cumulative import+analyze command, task 0567), mirroring the deferred-owner note in the 0567 Q&A. Acceptance: the Usage section names `/sp:dev-history-load` as the preflight and links its glossary/command context; no behavior change to the `Skill()` invocation.
- [x] R4. Re-verify the command against the current plugin closure after the doc edits: `bun test plugins/sp/tests/command-contract.test.ts plugins/sp/tests/command-flag-parity.test.ts plugins/sp/tests/roles.test.ts plugins/sp/tests/flag-contract-parity.test.ts` green, and `validate-commands.ts` still reports 38/38 (invoke from the repo root: `bun plugins/sp/scripts/validate-commands.ts` — it resolves `plugins/sp/commands` from cwd and crashes with ENOENT from any other directory). Acceptance: all four suites pass with no count/parity drift; the edited file passes the 5 thin-wrapper gates.
### Acceptance Criteria
```gherkin
Feature: dev-find-issue command docs conformance

  @core
  Scenario: R1 — --source lists the full CLI source set
    Given the file plugins/sp/commands/dev-find-issue.md
    When the argument-hint and Argument Flags table are read
    Then --source accepts auto, pi, claude, codex, gemini, opencode, antigravity, openclaw, omp, grok, agy, and all
    And no legacy value list omits grok, agy, or all

  @core
  Scenario: R2 — --template default matches the skill SSOT
    Given the Argument Flags table in dev-find-issue.md
    When the --template row is read
    Then its Default cell is "meta"
    And the description notes standard/issue are explicit single-finding overrides

  @core
  Scenario: R3 — Usage points at the history-load preflight
    Given the ## Usage section of dev-find-issue.md
    When an operator reads the forensics guidance
    Then it names /sp:dev-history-load as the on-demand import preflight for stale/empty data
    And the Skill(skill="sp:issue-finding", ...) invocation is unchanged

  @core
  Scenario: R4 — Plugin closure suites stay green after the edits
    Given the edited command file
    When the four closure suites run (command-contract, command-flag-parity, roles, flag-contract-parity)
    Then all pass
    And validate-commands.ts reports 38/38 commands
```
### Q&A
**Q1: Why is this doc-only and not a code change?** The command is a thin `Skill()` wrapper — the
behavior lives in `sp:issue-finding`, which is already correct (its `--template` default is `meta`,
its `--source` guidance resolves sources at runtime). The drifts are in the *command's* frozen
surface documentation, which is what operators read and what the closure tests pin. No CLI, schema,
or skill change is needed; editing the wrapper's hint/table/usage restores conformance.

**Q2: Does changing the `--source` value list trip the flag-parity gates?** No. `command-flag-parity`
tokenizes `--flag` literals from hints, not the value vocabulary inside `<…>`. The flag token
`--source` is unchanged and already has its canonical glossary entry (added by task 0567). Only the
human-readable value set inside the angle brackets changes — invisible to the parity regexes.

**Q3: Why add `all` to the command's list when the skill's default is `auto`?** `auto` is the skill's
source *resolution* default (pick the cwd agent, then omp, then first existing root). `all` is the
CLI's fan-out default for both `import` and `analyze` — a valid explicit value an operator may pass.
Both belong in the documented vocabulary; they mean different things and neither is a typo of the
other.

**Q4: Why link `/sp:dev-history-load` rather than `spur history daily`?** This command covers the
on-demand investigation case. `/sp:dev-history-load` (task 0567) is the shipped on-demand surface
that runs import-then-analyze in one command with checkpoint resume — exactly the preflight an
operator with stale forensics needs. `spur history daily` owns the periodic cadence; pointing the
interactive preflight at the interactive command is the right affordance, and it is the deferred
owner recorded in 0567's Q&A.

**Q5: What breaks if this task is skipped?** Operators get a command surface that under-lists real
sources (`--source grok`/`--source agy` would be assumed invalid), a `--template` default that
contradicts the skill, and no discoverable preflight when forensics come back empty. All three are
doc-level, but they are the first thing a new operator reads.

**Q6: Decomposition?** Single-file edit with four verification surfaces; R1–R3 are one pass over the
command file, R4 is the gate. No dependency on other tasks; safe to implement standalone. Feature
E2 owns the forensics surface, so it links here per the deferred-owner note.
### Design
**WHAT.** Three doc-conformance edits to `plugins/sp/commands/dev-find-issue.md`, verified against
the current closure suites. No CLI surface, no skill change, no behavior change.

**WHY.** The command's frozen surface drifted from the codebase it wraps:
- `--source` value list predates `grok`/`agy` support in `spur history` (`apps/cli/src/commands/history.ts:54,132` — both `import` and `analyze` accept `pi|claude|codex|gemini|opencode|antigravity|openclaw|omp|grok|agy|all`).
- `--template` default cell says `standard`; `sp-issue-finding` SSOT says `meta` (multi-fix umbrella default).
- No import-preflight pointer, despite the deferred-owner note in 0567's Q&A naming
  `/sp:dev-history-load` as the obvious preflight once shipped.

**WHERE — primary file target:**

| Path | Change |
| --- | --- |
| `plugins/sp/commands/dev-find-issue.md` | (1) argument-hint frontmatter: `--source <auto\|pi\|claude\|codex\|gemini\|opencode\|antigravity\|openclaw\|omp\|grok\|agy\|all>`; (2) same value list in the `## Argument Flags` table row; (3) `--template` Default cell `meta` + description note (`issue` = explicit single-finding override, `standard` = generic override — mirrors `issue-finding/SKILL.md:255`); (4) `## Usage`: add `/sp:dev-history-load` preflight pointer for stale/empty data. The `Skill(skill="sp:issue-finding", args="$ARGUMENTS")` Implementation line is untouched. |

**Precedence / frozen constraints.** Flag tokens (`--source`, `--template`, …) stay byte-identical —
only value vocabularies and Default cells change. The three `##` headings stay in order, no `###`,
glossary footer stays exactly once. `allowed-tools` unchanged (still `Skill` — the `Skill()` call
remains). No `dev-operations.md` row (long-tail command). The flag-parity R1 glossary entry for
`--source` (`#flag-source`) is already in place from task 0567 and needs no change.

**Anti-patterns.** Do not add flags, do not change the skill invocation, do not touch
`sp-issue-finding` (its defaults are already correct), do not add a numbered table row.

**Out of scope.** `sp-issue-finding` internals; the raw-JSONL fallback conditions; report rendering;
task creation templates themselves.
### Plan
- [x] Edit `plugins/sp/commands/dev-find-issue.md` argument-hint: full `--source` value list (`auto|pi|claude|codex|gemini|opencode|antigravity|openclaw|omp|grok|agy|all`) (R1)
- [x] Edit the `## Argument Flags` table: `--source` row value list + `--template` Default cell `meta` with single-finding-override note (R1, R2)
- [x] Add `/sp:dev-history-load` preflight pointer to `## Usage` (R3)
- [x] Verify closure: `bun test plugins/sp/tests/command-contract.test.ts plugins/sp/tests/command-flag-parity.test.ts plugins/sp/tests/roles.test.ts plugins/sp/tests/flag-contract-parity.test.ts` + `bun plugins/sp/scripts/validate-commands.ts` from the repo root → 38/38 (R4)
### Solution
**Single-file doc-conformance edit** to `plugins/sp/commands/dev-find-issue.md` (+24/−19 incl. table re-alignment):

1. **R1 — `--source` vocabulary** (`plugins/sp/commands/dev-find-issue.md:4` hint, `:21` table row): value list expanded to `auto|pi|claude|codex|gemini|opencode|antigravity|openclaw|omp|grok|agy|all`, matching `apps/cli/src/commands/history.ts:54` (import) and `:132` (analyze); `auto` stays the skill-level default, `all` documented as CLI fan-out.
2. **R2 — `--template` default** (`plugins/sp/commands/dev-find-issue.md:23`): Default cell corrected `standard` → `meta` per SSOT `plugins/sp/skills/issue-finding/SKILL.md:71`; description notes `issue` = explicit single-finding override, `standard` = generic override (`plugins/sp/skills/issue-finding/SKILL.md:254`).
3. **R3 — preflight pointer** (`plugins/sp/commands/dev-find-issue.md:56`): `## Usage` gains a "Data-plane preflight" paragraph naming `/sp:dev-history-load` (on-demand cumulative import + analyze, checkpoint resume, task 0567) for stale/empty findings, with the `spur history daily` cadence split. `Skill(skill="sp:issue-finding", args="$ARGUMENTS")` at `:68` untouched.

Rationale: the command is a thin wrapper over `sp:issue-finding`; all three drifts were in the frozen surface docs, not behavior. Flag tokens byte-identical; no skill/CLI changes.
### Testing
**Forced re-verify results** (`/sp:dev-verify 0570 --force --focus all --fix all`, 2026-08-16)

- Verdict: PASS

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/commands/dev-find-issue.md:4` hint + `:21` Argument Flags `--source` row list `auto\|pi\|claude\|codex\|gemini\|opencode\|antigravity\|openclaw\|omp\|grok\|agy\|all`; re-read this run — matches CLI vocabulary `apps/cli/src/commands/history.ts:54` (import) and `:132` (analyze) plus skill-level `auto` |
| R2 | MET | `plugins/sp/commands/dev-find-issue.md:23` `--template` Default cell = `meta`; description notes `issue` = explicit single-finding override, `standard` = generic override; matches SSOT `plugins/sp/skills/issue-finding/SKILL.md:71` (re-read: default `meta`) |
| R3 | MET | `plugins/sp/commands/dev-find-issue.md:56` `## Usage` "Data-plane preflight" paragraph names `/sp:dev-history-load` (checkpoint resume, task 0567) for stale/empty findings; `Skill(skill="sp:issue-finding", args="$ARGUMENTS")` at `:68` unchanged (re-read) |
| R4 | MET | `bun test plugins/sp/tests/command-contract.test.ts command-flag-parity.test.ts roles.test.ts flag-contract-parity.test.ts` (this run): 200 pass / 0 fail, 1128 expect() calls; `bun plugins/sp/scripts/validate-commands.ts` from repo root: 39 commands pass all 5 gates (AC's "38/38" is a stale count — `dev-gtd.md` landed the 39th command outside this task; zero drift from 0570) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — --source lists the full CLI source set | MET | command | File re-read this run: hint `:4` and table row `:21` carry the full 12-value list; no legacy list omits `grok`/`agy`/`all` (git diff confirms only value vocabulary changed) |
| R2 — --template default matches the skill SSOT | MET | command | `grep -n template plugins/sp/skills/issue-finding/SKILL.md` → `:71` default `meta`; command table `:23` Default cell `meta` with override note |
| R3 — Usage points at the history-load preflight | MET | command | File re-read: `## Usage` preflight paragraph names `/sp:dev-history-load`; Implementation `Skill()` invocation byte-identical |
| R4 — Plugin closure suites stay green after the edits | MET | command | `bun test` 4 suites (this run): 200 pass / 0 fail; validator: 39/39 — AC count stale, not a drift from 0570 |

- Design conformance: 4/4 claims DONE (hint list, table list, `--template` default + note, Usage preflight pointer); `Skill()` invocation untouched as designed; no scope creep (diff +24/−19, single file).
- SECUA: no P1–P3 findings; doc-only diff, flag tokens byte-identical, no behavior change.
- Coverage: N/A (documentation-only change; no runtime code path added).
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References
- Command file: `plugins/sp/commands/dev-find-issue.md` (hint `:4`, `--source` table row, `--template` row `:23`, `## Usage` `:33-49`)
- CLI surface: `apps/cli/src/commands/history.ts:54` (import `--source` values), `:132` (analyze `--source` values)
- Skill SSOT: `sp-issue-finding/SKILL.md` (Arguments table `--template` default `meta` at `:71`)
- Deferred-owner note: `docs/tasks4/0567_dev-history-load-slash-command-cumulative-import-then-narrow.md:135` ("Revisit after this command ships, when `/sp:dev-history-load` is the obvious thing for that preflight to recommend")
- Preflight command: `plugins/sp/commands/dev-history-load.md` (shipped, task 0567)
- Feature: `docs/features/E2_session-forensics-extension-of-the-history-plane-forensic-primitives-derived-variable-analyze-multi-mode-report-rewritten-find-issue.md`
- Closure tests: `plugins/sp/tests/command-contract.test.ts`, `plugins/sp/tests/command-flag-parity.test.ts`, `plugins/sp/tests/roles.test.ts`, `plugins/sp/tests/flag-contract-parity.test.ts`
### History
- 2026-08-17T00:28:32.257Z todo → wip (system)
- 2026-08-17T00:43:44.525Z wip → testing (system)
- 2026-08-17T00:43:49.866Z testing → done (system)
