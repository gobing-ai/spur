---
template: feature-impl
schema_version: 1
name: "Fix spur-cli/spur-dev drift exposed by the parity harness"
description: ""
status: done
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["parity", "drift-fix", "plugins/sp"]
dependencies: ["0517"]
ac_numbering: task-local
created_at: "2026-08-11T20:41:23.659Z"
updated_at: "2026-08-18T04:42:48.698Z"
---

## 0513. Fix spur-cli/spur-dev drift exposed by the parity harness

### Background
Phase 1b of feature I2. This task consumes the complete sorted finding set emitted by 0517 and makes only the evidence-driven documentation corrections required to return the focused parity suite to green. It implements feature scenarios R2, R3, R4, R10, and R11.

Current dependency chain is 0512 (capture) → 0516 (scope parsing) → 0517 (live assertions) → 0513 (correction). The authoritative edit list is therefore 0517's failing assertion output, not 0512. Expected targets are the owning facade references, spine routing table, Tier C reasons, and root AGENTS noun table; task 0514 separately owns README/link/catalog discoverability.

The ADR-054 boundary is preserved: the facade owns CLI noun/verb/flag semantics, including status transitions; the spine owns multi-step orchestration. If a finding can only be resolved by changing runtime or the public CLI surface, record it as deferred evidence and leave the focused suite non-green rather than widening this task silently.

Rubric: E3 D1 L2 C0 R0 = 6 → task; corrections span multiple documentation owners but remain finding-bounded.
### Requirements
- [ ] R1. Correct every facade noun/verb/flag inventory named by 0517's `documented-not-on-CLI` or `on-CLI-not-documented` findings; leave no documentation-fixable finding unresolved.
- [ ] R2. Correct every reported CLI-classified spine route or reclassify it as non-CLI with an explicit reason in the authoritative Step routing table; never add a silent test exclusion.
- [ ] R3. Sync `AGENTS.md` § Spur CLI surface with source-local root help; update `config/templates/AGENTS.md` only if the changed contract is present in that portable template.
- [ ] R4. Reconcile every reported Tier C reason in the facade owner without creating another noun/verb/flag catalog. README/link/catalog discovery findings remain owned by 0514.
- [ ] R5. Keep corrections documentation-only: no runtime behavior, public CLI command/flag, dependency, schema, persistence, or transport change. Record any runtime-only finding with exact evidence and defer it.

Non-goals: speculative prose cleanup, README/link crawling, CLI changes, or edits not named by the 0517 finding set.
### Acceptance Criteria
```gherkin
Feature: Evidence-driven plugin drift correction

  Scenario: R1 — Exposed drift is fixed before the pass is green
    Given the parity harness reports facade or noun-table drift
    When each reported documentation surface is corrected
    Then the focused parity suite passes with no outstanding finding

  Scenario: R2 — CLI-routed spine rows reference real verbs
    Given a reported spine row names an absent CLI noun or verb
    When the row is corrected or explicitly classified as non-CLI
    Then the routing parity check passes without silent exclusion

  Scenario: R3 — AGENTS.md noun inventory matches the CLI
    Given root help exposes the public noun set
    When AGENTS.md and its portable template are checked
    Then the documented noun table matches the live set and the portable contract remains aligned

  Scenario: R4 — Explicit facade exclusions do not create false drift
    Given an excluded noun is intentionally outside facade coverage
    When its Tier C entry is reconciled
    Then the entry carries a current reason and produces no false finding

  Scenario: R5 — Refinement changes no runtime surface
    Given a finding would require a runtime or public CLI change
    When task 0513 is implemented
    Then the finding is recorded and deferred rather than changing that surface
```
### Q&A
- **Authority:** 0517's sorted test failure arrays are the edit list; a surface absent from those findings is out of scope.
- **Portable AGENTS contract:** root and `config/templates/AGENTS.md` move together only when both contain the affected noun-table contract.
- **Runtime-only finding:** preserve the failing evidence and defer; do not change the CLI to make a documentation task green.
- **Catalog ownership:** edit the facade/spine/AGENTS owner and link dependents; do not copy inventories.
- **Handoff:** 0514 starts only after the full focused parity suite has zero outstanding findings.
### Design
Start by running `bun test plugins/sp/tests/cli-surface-parity.test.ts` from the repository root and capture its complete sorted findings. Treat those arrays as the allow-list for edits.

Allowed owners, only when named by a finding:

- `plugins/sp/skills/spur-cli/SKILL.md` for noun routing, Tier C exclusions, and facade ownership wording.
- `plugins/sp/skills/spur-cli/references/*.md` for per-noun verb/flag maps.
- `plugins/sp/skills/spur-dev/SKILL.md` for CLI/non-CLI Step routing and spine ownership wording.
- `AGENTS.md`, plus `config/templates/AGENTS.md` only when the affected portable contract exists there.
- `docs/design/plugin-surface-parity.md` only if the correction changes the documented parity shape rather than inventory data.

For documented-only entries, correct/remove the stale owner row. For live-only entries, add the real verb/flag to its facade owner or a reasoned Tier C row when the noun is intentionally outside coverage. For a spine finding, either name the real CLI noun/verb or make the non-CLI reason explicit in the same Step routing row. Re-run the focused test after each owner group; finish with all parity tests green. Do not touch `apps/cli`, package manifests, schemas, persistence, transport, README, or unrelated prose.
### Plan
- [ ] Run 0517's focused test and preserve all sorted bidirectional findings (R1–R4).
- [ ] Correct only the named facade verb/flag and Tier C owner rows; rerun the focused test (R1/R4).
- [ ] Correct or explicitly classify only named spine Step routing rows; rerun the focused test (R2).
- [ ] Sync the root noun table, and the portable template only if it owns the same changed contract (R3).
- [ ] Record any runtime-only finding as deferred and confirm the implementation diff excludes runtime/public surfaces (R5).
- [ ] Run `bun test plugins/sp/tests/cli-surface-parity.test.ts plugins/sp/tests/command-flag-parity.test.ts plugins/sp/tests/flag-contract-parity.test.ts plugins/sp/tests/routing-table-parity.test.ts plugins/sp/tests/skill-structure.test.ts`; hand off the zero-finding surface to 0514.
### Solution

**Parity suite result:** `bun test plugins/sp/tests/cli-surface-parity.test.ts` → **19 pass / 0 fail** (85 expect calls, 2.80s). The 0517 focused parity suite is green with an **empty finding set** — no `documented-not-on-CLI` or `on-CLI-not-documented` findings, no spine routing findings, no Tier C reason findings. The only Commander built-in beyond the facade inventory (`help`) is already covered by the 0516 Tier C exclusion data (`plugins/sp/skills/spur-cli/SKILL.md:64`), so it produces no finding.

**Per-requirement disposition (all satisfied-by-parity):**

- **R1** — Satisfied by parity: zero facade noun/verb/flag inventory findings; no documentation-fixable finding exists to correct.
- **R2** — Satisfied by parity: zero CLI-routed spine Step routing findings; every spine row already names a real CLI noun/verb or carries an explicit non-CLI reason. No silent exclusions added (none needed).
- **R3** — Satisfied by parity: `AGENTS.md` § Spur CLI surface noun table matches the live root help (asserted by the suite's noun-table check); `config/templates/AGENTS.md` portable contract remains aligned — no change required since no noun-set drift was reported.
- **R4** — Satisfied by parity: Tier C exclusion reasons in the facade owner are current; the suite reports no stale-reason findings.
- **R5** — Satisfied by parity: no finding requires a runtime, public CLI surface, dependency, schema, persistence, or transport change; nothing recorded for deferral, therefore the implementation diff contains **no runtime/public-surface changes** — documentation-only by construction (zero diff).

**Corrections made:** none. No doc-only gap surfaced in passing that is within 0513's finding-bounded scope (README/link/catalog discoverability remains owned by 0514 per the task's non-goals). Working tree contains no 0513-authored edits; prior modified files in the tree belong to sibling tasks 0512/0516/0517 in this batch.

**Handoff:** zero-finding surface confirmed; 0514 may proceed per the task's Handoff Q&A.
### Testing
**Testing**

Re-audited 2026-08-11 via `/sp:dev-verifyall --feature I2 --force`: evidence re-run — cli-surface-parity + skill-structure 73 pass / 0 fail. Verdict artifact regenerated at `.spur/run/0513-verdict.json` (gitignored). Prior verdict evidence below remains accurate.

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Focused parity suite green with an EMPTY finding set: `bun test plugins/sp/tests/cli-surface-parity.test.ts` → 19 pass / 0 fail, 85 expect calls (verified 2026-08-12, worktree sp/runall-i2-c763; 2.54s). The suite's R1 describe blocks (`plugins/sp/tests/cli-surface-parity.test.ts:268-292` facade noun routing Tier A/B/C union vs root help via bidirectional `expectParity`; per-noun verb/flag inventories vs `<noun> --help` / `<noun> <verb> --help` at :294-362) report zero `documented-not-on-CLI` / `on-CLI-not-documented` findings, so no documentation-fixable facade inventory correction exists to make. |
| R2 | MET | Suite R2 block (`plugins/sp/tests/cli-surface-parity.test.ts:365-415`): all six `kind:'cli'` spine Step-routing rows' noun and verb asserted live against root help and `<noun> --help` (help-filtered); all twelve non-CLI rows retained in the diagnostic with explicit non-empty gate-text reasons and the exact 12-step set pinned (:394-413). 0 findings — every CLI-routed row already names a real noun/verb and non-CLI rows carry explicit reasons; no silent test exclusion added. |
| R3 | MET | Suite R4 block (`plugins/sp/tests/cli-surface-parity.test.ts:417-432`) asserts the `AGENTS.md` `## Spur CLI surface` noun table (13 nouns: init/agent/history/rule/workflow/message/team/task/feature/status/projects/migrate/serve) matches live root help (13 commands + Commander `help`) via `diffSets`, honoring only parsed Tier C exclusions → both labels empty. Independently confirmed: live `bun run apps/cli/src/index.ts --help` = agent, feature, history, init, message, migrate, projects, rule, status, serve, team, task, workflow (+ help) — exact match modulo the excluded `help`. `config/templates/AGENTS.md:139` has no noun table (prose/long-tail contract only), so the portable contract cannot drift and needs no sync. |
| R4 | MET | Suite asserts Tier C routing-table rows ≡ parsed exclusion table (`plugins/sp/tests/cli-surface-parity.test.ts:269-281`) and every exclusion reason non-empty (:283-289). `plugins/sp/skills/spur-cli/SKILL.md:64` carries the current `help` reason ("Auto-generated by Commander.js; not a real noun") — the only Commander built-in beyond the facade inventory — so explicit exclusions produce no false finding. |
| R5 | MET | 0513 commit `f66547ec` (`git show --name-status`) touches exactly one file: `docs/tasks4/0513_fix-spur-cli-spur-dev-drift-exposed-by-the-parity-harness.md` (37+/32-, scope-bounding wording only). Zero runtime behavior, public CLI command/flag, dependency, schema, persistence, or transport change → documentation-only by construction. No runtime-only finding exists to defer (the empty finding set confirms none surfaced). Working-tree SKILL.md/design edits are sibling-batch artifacts (0517's Solution documents the suite + helper + ownership-marker assertions; the ADR-054 ownership markers in `spur-cli/SKILL.md:101-104` and `spur-dev/SKILL.md:45-49` are documentation the R8 test reads, not runtime). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Exposed drift is fixed before the pass is green | MET | test | `bun test plugins/sp/tests/cli-surface-parity.test.ts` → 19 pass / 0 fail, 85 expects, 2.54s, empty finding set: no `documented-not-on-CLI` / `on-CLI-not-documented` facade or noun-table drift reported; suite passes with no outstanding finding. |
| Scenario: R2 — CLI-routed spine rows reference real verbs | MET | test | R2 describe (`plugins/sp/tests/cli-surface-parity.test.ts:366-392`) asserts every `kind:'cli'` row's noun ∈ root commands and verb ∈ `<noun> --help` (minus parsed `help` exclusion); non-CLI rows carry explicit reasons with the 12-step set pinned (:394-413). Routing parity check passes; no silent exclusion added (diff contains none). |
| Scenario: R3 — AGENTS.md noun inventory matches the CLI | MET | test | R4 test (`plugins/sp/tests/cli-surface-parity.test.ts:418-432`): 13-noun `## Spur CLI surface` table vs live root help via `diffSets` honoring Tier C exclusions → both labels empty. Independent check: root help nouns = AGENTS table modulo `help` exactly. Portable template (`config/templates/AGENTS.md:139`) carries no noun table → portable contract remains aligned with no change. |
| Scenario: R4 — Explicit facade exclusions do not create false drift | MET | test | Tier C routing rows ≡ exclusion table (`plugins/sp/tests/cli-surface-parity.test.ts:269-281`); every reason non-empty (:283-289); `help` exclusion carries current reason (`spur-cli/SKILL.md:64`) and is the only Commander delta — suite produces no false finding from exclusions. |
| Scenario: R5 — Refinement changes no runtime surface | MET | command | `git show f66547ec --name-status` → single docs file modified (task 0513 markdown, 37+/32-); `git diff f66547ec^ f66547ec --stat` confirms docs-only. No runtime/public surface changed; no runtime-only finding exists to record/defer (empty finding set); no silent test exclusion added. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Verdict: PASS** — zero-finding parity state independently confirmed; the Solution honestly documents the satisfied-by-parity disposition.

**Verification performed (2026-08-12, worktree sp/runall-i2-c763):**

- `bun test plugins/sp/tests/cli-surface-parity.test.ts` → **19 pass / 0 fail, 85 expect calls** (Solution cites 2.80s; re-run 2.66s — timing variance only). Empty finding set confirmed: no `documented-not-on-CLI` / `on-CLI-not-documented`, no spine routing, no Tier C reason findings.
- Broader Plan-step-6 set re-run: `command-flag-parity`, `flag-contract-parity`, `routing-table-parity`, `skill-structure` → **168 pass / 0 fail** (187 total parity tests green).
- 0513 commit `f66547ec` touches **only** the task file (37+/32−): scope-bounding wording of Background / Requirements / Q&A / Design / Plan. Zero code, runtime, or public-surface change → R5 satisfied by construction.
- Solution's factual citation checked: `plugins/sp/skills/spur-cli/SKILL.md:64` is the `help` Tier C row ("Auto-generated by Commander.js; not a real noun") — exactly as claimed.
- Working-tree modifications (SKILL.md ×2, `docs/design/plugin-surface-parity.md`, feature doc, sibling task files, untracked parity suite + helpers) are sibling-batch artifacts (0512/0516/0517); no 0513-authored out-of-scope edits found.

**Traceability (R1–R5):**

| Req | Disposition | Evidence |
|-----|-------------|----------|
| R1 | Satisfied by parity | Suite asserts bidirectional facade noun routing vs root help + per-noun verb/flag parity for all 8 Tier A/B nouns; 0 findings |
| R2 | Satisfied by parity | Suite asserts every `kind:"cli"` spine row's noun/verb exists live + non-CLI rows carry explicit reasons (pinned 12-step set); 0 findings |
| R3 | Satisfied by parity | Suite asserts AGENTS.md `## Spur CLI surface` noun table vs root help honoring Tier C exclusions; portable template untouched (no noun-set drift → no required change) |
| R4 | Satisfied by parity | Suite asserts Tier C routing table ≡ exclusion table and every reason non-empty; 0 stale-reason findings |
| R5 | Satisfied by construction | 0513 diff = 1 docs file; no runtime-only finding exists to defer; no silent test exclusion added |

**Findings (P1–P4):**

| ID | Severity | Finding | Evidence | Action |
|----|----------|---------|----------|--------|
| F1 | P4 | Solution cites only the focused 19-test suite; Plan step 6 names 5 test files and the broader run result is uncited | 168 additional tests (command-flag / flag-contract / routing-table / skill-structure) verified green during review | None required; optionally cite the broader run in Solution for completeness |

**Residual risk:** The parity gate is a documentation-vs-live-surface check (it spawns the real CLI), not a runtime behavior test; inherent to the task's documentation-only scope, does not affect this disposition. Zero-diff verification task has no security / efficiency / correctness surface in code.

**Disposition:** Approve. 0514 may proceed per the task's Handoff Q&A.
### References
- Feature: I2, scenarios R2–R4, R10, R11
- Design: `docs/design/plugin-surface-parity.md` §§3–5, 8
- Decisions: ADR-053, ADR-054
- Dependency: 0517 (complete live parity finding set; transitively 0512/0516)
- Owning surfaces: `plugins/sp/skills/spur-cli/**`; `plugins/sp/skills/spur-dev/SKILL.md`; `AGENTS.md`
- Dependent task: 0514
### History
- 2026-08-12T00:52:15.586Z todo → wip (system)
- 2026-08-12T00:58:50.697Z wip → testing (system)
- 2026-08-12T00:58:51.829Z testing → done (system)
