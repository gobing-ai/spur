---
schema_version: 1
name: "W0 placement contract enforcement: key-file pointers, glue-budget check and sp-script-placement rule"
status: done
template: feature-impl
created_at: 2026-09-29T06:25:03.413Z
updated_at: "2026-10-01T00:39:42.730Z"
feature_id: A9
priority: P2
tags:
  - A9
  - script-placement

estimate_hours: 3
---

## 1000. W0 placement contract enforcement: key-file pointers, glue-budget check and sp-script-placement rule

### Background

Wave W0 of feature A9. ADR-130 and governance §2 are written; this task makes them enforceable and discoverable.

Implements: R1 — Each script surface has one written owner and boundary; R2 — New public spur surface requires operator confirmation at planning time; R3 — Key project files state the placement contract; R4 — A spur rule flags scripts placed on the wrong surface; R5 — Complete inventory classifies every existing script

Source: ADR-130, harness-surface-governance §2, docs/plans/A9-script-placement-migration.md.

**Refine corrections (2026-09-28)**

- "Add the init key-file template pointer" → `config/templates/AGENTS.md` is the foreign-project template; foreign projects have no `plugins/sp` or `scripts/commands`, so the placement contract is repo-specific → dropped; only root `AGENTS.md` gains the pointer.
- "Add sp-script-placement to recommended-pre-check running script-contract-check" → the full check spawns `superskill script convert` per twin (`plugins/sp/scripts/script-contract-check.ts:318`) and is slow; `recommended-pre-check` runs on every `spur-check` (`package.json` `test-pre-check`) and ships to foreign projects → the rule runs a fast `--placement-only` mode and SKIPs outside the Spur repo; the full twin check stays in `spur-check-feature`.
- "Existing references to script-contract-check" → besides `package.json` and `config/plugin-scripts.json`, prose refs exist in `plugins/sp/skills/code-verification/SKILL.md:279`, `plugins/sp/commands/dev-verify.md:51`, `plugins/sp/commands/dev-verifyall.md:80` ("script-contract-check rule 4"), `plugins/sp/scripts/script-root.ts:72` and `plugins/sp/tests/feature-verification-scope.test.ts:27` → they name the check, not its path, and stay valid; only path references change.

### Requirements

- [x] R1. `script-contract-check` lives at `scripts/commands/script-contract-check.ts` with a sibling `scripts/commands/script-contract-check.test.ts`; `package.json` `script-contract-check` runs it; `plugins/sp/scripts/script-contract-check.ts`, `plugins/sp/tests/script-contract-check.test.ts` and its `config/plugin-scripts.json` row are deleted. Existing rules 1–4 behave unchanged.
- [x] R2. A new `--placement-only` mode reports one finding per `plugins/sp/scripts/**/*.ts` or `plugins/sp/hooks/**/*.ts` file (tests and generated `.mjs` excluded) that exceeds 250 lines, value-imports `bun:sqlite` or `drizzle-orm`, or contains a `docs/tasks` / `docs/features` path literal (corpus parsing).
- [x] R3. `--placement-only` also reports a `scripts/commands/<name>.ts` whose basename equals an `apps/cli/src/commands/<name>.ts` basename (public noun clash).
- [x] R4. `config/script-placement-baseline.json` suppresses listed findings; a baseline entry whose file no longer produces that finding is itself a finding (the baseline can only shrink).
- [x] R5. `config/rules/boundary/sp-script-placement.yaml` (severity error, `exit-code` evaluator) runs `--placement-only`, and exits 0 with `SKIP: not the Spur source repo` when `scripts/commands/script-contract-check.ts` is absent.
- [x] R6. Root `AGENTS.md` "Public-surface consent" paragraph gains one sentence pointing at ADR-130 and governance §2 (no restated table).
- [x] R7. Every file in plan §2 marked Move/Delete/→scripts/over-budget-Keep appears in the seeded baseline, and every baseline entry appears in plan §2.

Out of scope: moving or deleting any other script (tasks 1001–1007); a new rule-engine evaluator; `config/templates/AGENTS.md`; changing rules 1–4 semantics.

### Acceptance Criteria

- [x] AC1 — Each script surface has one written owner and boundary (req: R6)
- [x] AC2 — New public spur surface requires operator confirmation at planning time (req: R6)
- [x] AC3 — Key project files state the placement contract (req: R6)
- [x] AC4 — A spur rule flags scripts placed on the wrong surface (req: R1, R2, R3, R5)
- [x] AC5 — Complete inventory classifies every existing script (req: R4, R7)

Task-local observability: AC1–AC3 are proven by `docs/design/harness-surface-governance.md` §2/§4 (already landed) plus the `AGENTS.md` sentence; AC4 by `scripts/commands/script-contract-check.test.ts` fixture cases (301-line plugin script, `bun:sqlite` import, `docs/tasks` literal, `task.ts` name clash → each one finding) and `spur rule run --rule sp-script-placement` exiting 0 on the real tree; AC5 by a test that diffs the baseline keys against plan §2 rows.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-29T06:34:26.639Z

- **Rule cost** — CLOSED: the rule runs `--placement-only` (file reads only, no twin convert) so it fits the per-task `recommended-pre-check`; the full twin check stays in `spur-check-feature`.
- **Foreign projects** — CLOSED: `boundary/` ships with `recommended-pre-check`; the rule SKIPs when the checker is absent (same pattern as `config/rules/strict/rule-files-structural.yaml` SKIP on missing yq).
- **Name-clash scope** — CLOSED: basename match against `apps/cli/src/commands/*.ts` (noun files) only; per-verb matching deferred — no consumer needs it (owner: operator, reopen if a verb-level clash is reported).
- **Init templates** — CLOSED: not updated; the contract is repo-specific.

### Design

**What.** Relocate `script-contract-check` to the self-dev surface and give it a fast placement mode that a `spur rule` runs on every pre-check.

**Frozen names.**
- Module: `scripts/commands/script-contract-check.ts` (keeps exports `parseArgs`, `validateContract`, `run`; adds `checkPlacement(opts): PlacementFinding[]`).
- `interface PlacementFinding { file: string; kind: 'budget' | 'db-import' | 'corpus-parse' | 'noun-clash' | 'stale-baseline'; detail: string }`.
- CLI mode: `--placement-only` (internal arg; `scripts/commands` is not public surface — no consent needed). Existing `--manifest/--scripts-dir/--plugin-dir` defaults are unchanged; add `--baseline <path>` (default `config/script-placement-baseline.json`) and `--repo-root <dir>` for fixture tests.
- Baseline: `config/script-placement-baseline.json` = `{ "schemaVersion": 1, "entries": { "<repo-relative path>": { "kinds": ["budget", …], "reason": "<plan §2 target + wave>", "exempt": false } } }`. `exempt: true` only for plan §2 Keep rows over budget: ADR-129 hook cores (`plugins/sp/hooks/context-*.ts`), `batch-preflight.ts`, `wrapup-steps.ts`, `wrapup-drift-probe.ts`, `feature-verification-steps.ts`; 1007 re-reviews every exemption.
- Rule: `config/rules/boundary/sp-script-placement.yaml`, id `sp-script-placement`, `evaluator.type: exit-code`, `command: sh -c '[ -f scripts/commands/script-contract-check.ts ] || { echo "SKIP: not the Spur source repo"; exit 0; }; bun scripts/commands/script-contract-check.ts --placement-only'` (copy the shape of `config/rules/strict/rule-files-structural.yaml:10`).
- Line count = `content.split('\n').length` minus one trailing empty line; threshold constant `GLUE_BUDGET_LINES = 250`.

**Why.** ADR-130 glue budget needs an executable check; the existing checker already walks the plugin tree and manifest, so extend it rather than add a second walker or an LOC evaluator type (one consumer).

**Where.** `scripts/commands/script-contract-check.ts(+.test.ts)`, `config/script-placement-baseline.json`, `config/rules/boundary/sp-script-placement.yaml`, `package.json` (`script-contract-check` path), `config/plugin-scripts.json` (row removed), `AGENTS.md`.

**Anti-patterns.** Do not add a `spur` verb or a rule-engine evaluator. Do not register the module in `scripts/spur-dev.ts` (gates are invoked by `bun scripts/commands/<x>.ts`, like `dependency-drift-check`). Do not make the SKIP silent inside the Spur repo. Do not exempt a file without a plan §2 Keep row.

**Handoff.** 1001, 1002–1007 each delete their baseline entries in the same commit as the move (stale entries fail the rule, so they cannot forget). This task seeds entries only.

### Plan

1. `git mv` checker + test into `scripts/commands/`; fix imports/paths; update `package.json` and drop the manifest row; run the moved test (R1).
2. Add `checkPlacement` + `--placement-only` + fixture tests for each finding kind (R2, R3, R4).
3. Run it on the real tree, seed `config/script-placement-baseline.json` from the output, reconcile with plan §2 and add the baseline↔plan test (R4, R7).
4. Add `sp-script-placement.yaml`; `bun run apps/cli/src/index.ts rule run --rule sp-script-placement` passes; a temp 300-line `plugins/sp/scripts/tmp.ts` makes it fail, then remove it (R5).
5. Add the `AGENTS.md` sentence (R6).
6. Verify: `bun run spur-check`, `bun run script-contract-check`, `bun run plugin-smoke`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `scripts/commands/script-contract-check.test.ts:14` |
| `scripts/commands/script-contract-check.test.ts:16` |
| `scripts/commands/script-contract-check.test.ts:2` |
| `scripts/commands/script-contract-check.test.ts:398` |
| `scripts/commands/script-contract-check.test.ts:448` |
| `scripts/commands/script-contract-check.test.ts:6` |
| `scripts/commands/script-contract-check.test.ts:8` |
| `scripts/commands/script-contract-check.ts:13` |
| `scripts/commands/script-contract-check.ts:18` |
| `scripts/commands/script-contract-check.ts:487` |
| `scripts/commands/script-contract-check.ts:622` |
| `scripts/commands/script-contract-check.ts:63` |
| `scripts/commands/script-contract-check.ts:71` |
| `scripts/commands/script-contract-check.ts:78` |
| `scripts/commands/script-contract-check.ts:82` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `package.json:94` runs `scripts/commands/script-contract-check.ts`; `plugins/sp/scripts/script-contract-check.ts`, `plugins/sp/tests/script-contract-check.test.ts` absent and `config/plugin-scripts.json` has 0 rows; `bun test scripts/commands/script-contract-check.test.ts` -> 26 pass / 0 fail (re-verify 2026-09-30) |
| R2 | MET | `scripts/commands/script-contract-check.ts:489` GLUE_BUDGET_LINES = 250; `scripts/commands/script-contract-check.ts:536` DB_IMPORT_RE (type imports excluded); `scripts/commands/script-contract-check.ts:586` budget finding; `scripts/commands/script-contract-check.ts:589` db-import finding; `scripts/commands/script-contract-check.ts:605` corpus-parse finding; `scripts/commands/script-contract-check.test.ts:469` each finding kind once per file |
| R3 | MET | `scripts/commands/script-contract-check.ts:574` noun-clash finding; `bun scripts/commands/script-contract-check.ts --placement-only` -> 0 finding(s), exit 0 |
| R4 | MET | `scripts/commands/script-contract-check.ts:510` loadPlacementBaseline; `scripts/commands/script-contract-check.ts:628` stale-baseline finding; `scripts/commands/script-contract-check.test.ts:534` baseline suppresses listed kinds and flags stale entries |
| R5 | MET | `config/rules/boundary/sp-script-placement.yaml:7` rule id sp-script-placement, severity error, exit-code evaluator; `config/rules/boundary/sp-script-placement.yaml:17` SKIP guard; `spur rule run --rule sp-script-placement` -> All 1 rule passed, exit 0 |
| R6 | MET | `AGENTS.md:209` one sentence pointing at ADR-130 and governance section 2, no restated table |
| R7 | MET | `scripts/commands/script-contract-check.test.ts:592` placement baseline reconciles with plan section 2; passes in the 26-test run |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Each script surface has one written owner and boundary | MET | command | `spur rule run --rule sp-script-placement` exit 0; `AGENTS.md:209` pointer to ADR-130 and governance section 2 |
| Scenario: R2 — New public spur surface requires operator confirmation at planning time | MET | command | `spur rule run --rule sp-script-placement` exit 0; `AGENTS.md:205` public-surface consent paragraph |
| Scenario: R3 — Key project files state the placement contract | MET | command | `bun scripts/commands/script-contract-check.ts --placement-only` exit 0; `AGENTS.md:209` names the enforcing rule |
| Scenario: R4 — A spur rule flags scripts placed on the wrong surface | MET | test | `bun test scripts/commands/script-contract-check.test.ts` 26 pass; `scripts/commands/script-contract-check.test.ts:469` and `scripts/commands/script-contract-check.test.ts:564` |
| Scenario: R5 — Complete inventory classifies every existing script | MET | test | `scripts/commands/script-contract-check.test.ts:592` baseline reconciles with plan section 2; 26 pass / 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-29T08:55:40.838Z todo → wip (system)
- 2026-09-29T10:34:01.677Z wip → testing (system)
- 2026-09-29T10:47:50.470Z testing → done (system)

