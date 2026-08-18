---
template: standard
schema_version: 1
name: "Fix consolidated open findings from 2026-07-18 task-0281 dogfood runs"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-19T04:14:21.088Z"
updated_at: "2026-08-18T04:42:47.606Z"
---

## 0296. Fix consolidated open findings from 2026-07-18 task-0281 dogfood runs

### Background
On 2026-07-18, task 0281 was driven through the harness twice with dogfood monitoring, producing two reports under `docs/dogfood/`:

1. `2026-07-18-skill-sp-dev-run-0281-dogfood.md` (`/skill:sp-dev-run 0281 --auto --next`, run `95a5d11d`) — PARTIAL: stopped at the `--next` chained verify leg (stop-at-testing), 1 unresolved + 6 findings.
2. `2026-07-18-sp-dev-verify-0281-auto-next-force-focus-all-fix-all-dogfood.md` (`$sp-dev-verify 0281 --auto --next --force --focus all --fix all`, run `20260718T202245`) — PASS: 3 fixed in-run + 3 findings; completed `testing → done` with verdict PASS.

Across both reports, 10 issues/findings were raised. This task consolidates the **still-open** ones after a triage against HEAD (`ed7c55d1`, 2026-07-18). Every item below was re-verified against the current tree (and the installed skill copies under `~/tools/dot_files/`) before inclusion — findings already fixed, superseded, or invalid are excluded from scope and recorded here so no effort is re-spent on them.

**Verified FIXED / superseded at HEAD (excluded from scope):**

| Finding (report) | Fixed / superseded by | Evidence at HEAD |
| --- | --- | --- |
| Unresolved: 0281 left at `testing`, `0281-verdict.json` absent (dev-run report §5) | The second run (verify dogfood) completed the chain | `spur task show 0281` → `status: done`; History `2026-07-19T03:36:38Z testing → done`; `.spur/run/0281-verdict.json` exists, aggregate PASS |
| P3: L3 Testing warning — literal "N/A" missing on 0281 (dev-run report §6) | Verify run rewrote `### Testing` via CLI-gated section write | Section now opens `Coverage: N/A (research/specification change…)`; `spur task check 0281 --json` no longer emits any L3 finding |
| P4: 0281 reached `done` twice without a verdict artifact — "verify-chain-never-run" detector proposal (dev-run report §6) | Task 0292 (done) + provenance guard | `packages/app/src/services/done-transition-guard.ts` gates `* → done` on `.spur/run/<wbs>-verdict.json` (aggregate recomputed from rows, harsher wins); the provenance guard denies `testing → done` with no recorded pipeline run (documented via 0294 R1). The 0281 flips (18:24–18:37Z) predate the guard. A retrospective `task check` sweep over historical `done` tasks would be noise; the prospective gate is the shipped fix. |
| Fixed-in-run: placeholder verification evidence on 0281 (verify report §5.1) | Fixed during the run itself | `docs/tasks2/0281_….md` `### Solution`/`### Testing` now carry the durable source-backed provider contract + full R1–R7/AC traceability |
| Fixed-in-run: monitor verdict projection snake_case vs camelCase (verify report §5.2) | Driver-side one-off, corrected in-run | Ad-hoc jq projection error in the monitor, not a product defect; verdict artifact was never wrong |

**Invalid / no-action (excluded from scope):**

| Finding | Reason |
| --- | --- |
| P3: low cache hit rate (dev-run ~36%, verify ~45%) | Marked `[unverifiable]` in both reports; chars/4 heuristic with no per-step meter. Systemic cache-efficiency work is owned by feature O: 0280 (done) established the evidence baseline and 0284 (todo) owns cache-stable context envelopes. Same disposition 0294 applied to the identical findings from the 0280/0292/0293 runs. |

Everything remaining is in Requirements below, deduplicated across the two reports with per-item source, current-state evidence, and required change. R1 is cross-repo (superskill); R2/R3 are `plugins/sp` dogfood-skill contract changes; R4 is a corpus edit.
### Requirements
Four deduplicated open items. Priority = highest severity among the merged source findings.

- R1. **Core, P1 — superskill `rewriteSkillReferences` mangles the version-pinned dogfood protocol string in installed skill files.**
  Source: verify report P1 + fixed-issue #3 (report protocol mismatch — the report was hand-normalized; the root cause is untouched).
  Current state: the monorepo source is uniformly colon-form (`plugins/sp/skills/dogfood-testing/SKILL.md:8,124,453`, `references/report-template.md:7,16,21,51`, `references/monitor-ledger.md:7` — all `sp:dogfood-testing@1.2`), and the validator + contract tests require exactly that form (`plugins/sp/scripts/dogfood-testing/validate-report.ts:22` `CANONICAL_PROTOCOL = 'sp:dogfood-testing@1.2'`; `plugins/sp/tests/dogfood-testing/report-contract.test.ts:44` forbids `protocol: sp-dogfood-testing@`). But every installed copy under `~/tools/dot_files/config/agents/skills/sp-dogfood-testing/` carries the dash form (`SKILL.md:108,437`, `report-template.md:7,16,21,51`, `monitor-ledger.md:7`) — including the self-contradicting sentence at installed `report-template.md:21` whose colon-form example was itself rewritten away. Root cause: `~/xprojects/superskill/packages/core/src/pipeline/rewrite-references.ts:14` — the flattening regex `\b(<prefix>):([a-z][a-z0-9-]*)` matches the name part of `sp:dogfood-testing@1.2` and rewrites it like any skill reference; version-pinned protocol identifiers are not exempted. Call site for skill content: `~/xprojects/superskill/packages/core/src/mapper.ts:185` (also `adapt-command.ts:31`, `adapt-subagent.ts:38,82,111`).
  Impact: any agent on any platform that builds its report skeleton from the installed reference files emits `protocol: sp-dogfood-testing@1.2`, which `validate-report.ts` rejects — Phase 4 (finalize-or-abort) blocks on every dogfood run driven from the installed skill until the operator hand-normalizes the string (observed live in the verify run).
  Required:
  - (a) In superskill `rewriteSkillReferences`, exempt version-pinned identifiers: a matched `<prefix>:<name>` token immediately followed by `@` is left untouched. Plain `sp:<name>` references (no `@`) must still be flattened, and the existing slash-command-line and foreign-prefix (`node:`, `bun:`) exemptions must be preserved.
  - (b) Regression tests in `~/xprojects/superskill/packages/core/tests/pipeline/rewrite-references.test.ts`: content containing `protocol: sp:dogfood-testing@1.2` survives the rewrite verbatim; `sp:dogfood-testing` without a version suffix in the same document is still flattened; a token like `sp:foo@1.0` inside prose survives.
  - (c) Re-run `superskill install sp` and verify the installed files: all seven dash-form protocol occurrences above become colon-form, while ordinary `sp:` skill references in the same files remain flattened (spot-check installed `SKILL.md` body still says `sp-dogfood-testing` where it names the skill itself).
  - (d) Cross-repo note: the code change and its tests land in `~/xprojects/superskill` (separate repo, its own commit + release/`bun link` flow); this task tracks the end-to-end outcome including the reinstall verification. Do not "fix" the installed files by hand — they are generated artifacts and the next install would regress them.

- R2. **Core, P2 — dogfood driver has no workspace-drift guard for mutating runs.**
  Source: verify report P2 (concurrent formatter mutated 0280/0281 mid-run during step 3; ownership attribution had to be resolved manually).
  Current state: `plugins/sp/skills/dogfood-testing/SKILL.md` contains no worktree/isolation/fingerprint/concurrency content at all (grep-verified). Fix mode (`--max-retry ≥ 1`) and mutating-`--fix` testees write to the shared working tree with zero detection of concurrent external writers, so a mid-run external mutation is indistinguishable from testee/driver mutation in the ledger and report.
  Required:
  - (a) Phase 1 (Plan) records a workspace fingerprint in the live ledger frontmatter: HEAD sha + a `git status --porcelain` snapshot (or a stable hash of it) taken before the first testee step.
  - (b) Before each fix application (Phase 2) and once at Phase 4 finalize, the driver re-takes the snapshot and diffs against baseline minus files the run itself has touched (driver fixes + testee-attributed writes from the ledger). Unexplained drift → a warning row in the ledger naming the drifted paths + a mandatory report finding with an attribution note; the driver never claims drifted files as its own or the testee's work.
  - (c) The §Mutating `--fix` mode contract section recommends an isolated `git worktree` for fix-mode dogfoods of pipeline-driving or mutating-`--fix` testees (advisory, not a hard gate — the refuse-gate semantics from 0293 are unchanged).
  - (d) Additive only: protocol stays `sp:dogfood-testing@1.2`; new ledger/report fields are optional so existing reports remain valid. `references/monitor-ledger.md` and `references/report-template.md` document the new fields.

- R3. **Core, P2 — `--next` chained-leg observability on Claude Code: document the boundary, formalize the override.**
  Merges: dev-run report P2 (chain verify leg unobservable same-session; every `--next` dogfood force-stops at testing) + dev-run report P3 (chained-leg provenance/cost unattributed).
  Current state: `plugins/sp/skills/dogfood-testing/SKILL.md:396-422` already documents the stop-at-testing rule and a prose-only "Operator override" (operator "may direct" chain-following); `SKILL.md:431-436` §Platform Notes → Claude Code says only "Native — Skill() delegation … work directly" and never states the consequence that `Skill()` runs inline (no subprocess boundary), so a chained verify leg is never independently observable in the same session — the dev-run dogfood hit exactly this and stopped. There is no `--chain-follow` argument (`SKILL.md:46-56` argument table; `plugins/sp/commands/dev-dogfood.md` table). Note the skill's own prohibition at `SKILL.md:410-418`: the driver must not change chained lifecycle code mid-run to gain observability — so any dev-verify-side marker is a deliberate product change owned by the dev-verify contract, decided here, not improvised by a driver.
  Required:
  - (a) Platform Notes → Claude Code gains an explicit boundary note: `Skill()` is inline, chained `--next` legs are same-session-unobservable, therefore a `--next` dogfood on Claude Code ends stop-at-testing unless the operator overrides; name the standalone workaround (run the chained leg as its own invocation — exactly how the 0281 pair completed).
  - (b) Formalize the operator override as a `--chain-follow` argument (default off): explicit permission for the driver to follow the chain into subagent output or a named artifact set, replacing the informal "operator may direct" prose. Add the row to both the SKILL.md argument table and `plugins/sp/commands/dev-dogfood.md`; `detect-pipeline-driving.ts` gate semantics are unchanged (`--chain-follow` is a driver flag, not a testee mutation source).
  - (c) Decision point (resolve in Design, implement only if accepted): a chained-leg start marker written by the dispatching command before handing off to the chained leg (e.g. `.spur/run/<wbs>-chained-leg.json` with leg name + timestamp + source), so a driver can distinguish "leg dispatched but unobservable" from "leg never started" and segment cost. Weigh against artifact sprawl: verify already writes `<wbs>-verdict.json` + `<wbs>-verify-answer.txt` when it actually runs, so the marker only adds the dispatch-time signal. If rejected, record the rejection rationale in this task's Solution so the finding is closed either way.

- R4. **Non-core, P3 — feature O AC is missing task 0281's second scenario (DD-09 L4 warning fires on a done task).**
  Source: dev-run report P3 (L4 AC subset warning); verify report confirms it as "the pre-existing feature-AC subset warning" still present after `done`.
  Current state: `spur task check 0281 --json` → single finding: L4 warning `Task scenario "Cache evidence cannot silently inflate fresh input" is not in feature "O"'s AC (DD-09 subset rule)`. Feature O's AC (`docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md`) has the 15 R-scenarios plus "Baseline remains usable when provider telemetry is absent" (added by 0294 for the parallel 0280 case) but not the anti-inflation scenario. The scenario is a legitimate feature-level constraint — it restates feature O's locked metric rule (fresh/uncached input per verified PASS, never folding cache-read tokens into fresh input) and is load-bearing for 0284/0287.
  Required: add the scenario to feature O's Acceptance Criteria via CLI-gated section write (`spur feature update O --section … --from-file …` — never a raw edit), with a title that DD-09 normalized-title matching (`packages/domain/src/bdd/coverage.ts`) resolves against the task's scenario title. Follow the exact precedent 0294 used for 0280's scenario. Afterward `spur task check 0281 --json` must return zero findings and `spur feature check O` must still pass. No DD-09 rule relaxation.
### Acceptance Criteria
```gherkin
Scenario: Version-pinned protocol strings survive superskill install (R1)
  Given plugins/sp/skills/dogfood-testing sources carrying "protocol: sp:dogfood-testing@1.2"
  When superskill install sp regenerates ~/tools/dot_files/config/agents/skills/sp-dogfood-testing/
  Then every installed protocol occurrence (SKILL.md, references/report-template.md, references/monitor-ledger.md) is the colon form sp:dogfood-testing@1.2
  And plain sp:<name> skill references without a version suffix in the same files are still flattened to sp-<name>
  And a report skeleton copied from the installed report-template.md passes plugins/sp/scripts/dogfood-testing/validate-report.ts with no protocol_string error

Scenario: superskill rewrite exemption is regression-tested (R1)
  Given packages/core/tests/pipeline/rewrite-references.test.ts in ~/xprojects/superskill
  When the suite runs
  Then a test asserts content containing "sp:dogfood-testing@1.2" is returned verbatim
  And a test asserts "sp:dogfood-testing" without a version suffix is rewritten to "sp-dogfood-testing"
  And the existing slash-command-line and foreign-prefix exemptions still pass

Scenario: Concurrent workspace mutation is detected and attributed (R2)
  Given a fix-mode dogfood run whose Phase 1 ledger recorded the workspace fingerprint
  When a file neither the driver nor the testee touched changes during the run
  Then the live ledger gains a warning row naming the drifted paths
  And the final report carries a finding attributing the drift to an external writer
  And no ledger row or fixed-issue entry claims the drifted files as run work

Scenario: Worktree isolation is recommended for mutating dogfoods (R2)
  Given the §Mutating --fix mode contract section of the dogfood SKILL.md
  When an operator plans a fix-mode dogfood of a pipeline-driving or mutating---fix testee
  Then the section recommends running in an isolated git worktree
  And the 0293 refuse-gate semantics are unchanged

Scenario: Claude Code chain boundary is documented with its workaround (R3)
  Given the dogfood SKILL.md Platform Notes at the fix commit
  When an operator reads the Claude Code note
  Then it states Skill() runs inline and chained --next legs are same-session-unobservable
  And it states a --next dogfood therefore ends stop-at-testing by default
  And it names the standalone-invocation workaround for completing the chain

Scenario: --chain-follow formalizes the operator override (R3)
  Given the argument tables of dogfood SKILL.md and dev-dogfood.md
  When --chain-follow is passed
  Then the driver may read named chained-leg artifacts and attribute normally instead of stopping at testing
  And omitting the flag preserves stop-at-testing as the default
  And detect-pipeline-driving gate behavior is unchanged by the flag

Scenario: Chained-leg marker decision is closed either way (R3)
  Given the Design decision on the dispatch-time chained-leg marker
  When this task completes
  Then the marker is implemented in the dispatching command's contract with its artifact path documented
  Or the rejection rationale is recorded in this task's Solution

Scenario: Feature O AC covers the anti-inflation scenario (R4)
  Given feature O's Acceptance Criteria after the CLI-gated section write
  When spur task check 0281 --json runs
  Then it returns zero findings
  And spur feature check O still passes
  And the git diff for docs/features/O_*.md shows only the added scenario
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**R1 — superskill rewrite exemption.** Fix at the single choke point `rewriteSkillReferences` (`rewrite-references.ts:20-23`), not at its call sites (`mapper.ts:185`, `adapt-command.ts:31`, `adapt-subagent.ts:38,82,111`) — all installed surfaces then inherit the fix. Recommended mechanism: switch the per-line `line.replace(re, '$1-$2')` to a replacer callback that inspects the character following the full match and returns the match unchanged when it is `@`:

```ts
line.replace(re, (m, p1, p2, offset: number, s: string) =>
    s[offset + m.length] === '@' ? m : `${p1}-${p2}`)
```

A lookahead-only regex variant (`(?!@)`) is rejected: with the greedy `[a-z0-9-]*` name class it backtracks one character and rewrites `sp:dogfood-testin` — silently worse than the current bug. Two alternatives considered and rejected: (a) making spur's `validate-report.ts` accept the dash form as an alias — weakens a deliberately strict contract (`report-template.md:21` and `report-contract.test.ts:44` reject it by design) and hides the mangling instead of fixing it; (b) renaming the protocol constant so it no longer starts with the plugin prefix — touches the validator, contract tests, fixtures, both templates, and every historical report for zero semantic gain. Sequencing: superskill change + tests land in `~/xprojects/superskill` first (its own conventional commit; use the released version or `bun link` per that repo's flow), then `superskill install sp`, then the installed-file verification from AC. Record the superskill commit hash in this task's Solution for traceability.

**R2 — workspace-drift guard.** Pure protocol-text change in `plugins/sp/skills/dogfood-testing/SKILL.md` + the two reference files; no scripts required (the fingerprint is two shell commands the driver already has). Fingerprint = `git rev-parse HEAD` + `git status --porcelain` output hash, stored in the live-ledger frontmatter at Phase 1. Drift check points: immediately before each fix application and once at Phase 4 — not after every testee step, to keep observe-only runs zero-overhead. "Explained" set = files named in ledger rows (driver fixes + testee writes); anything else changing is drift. Drift is a warning + finding, never an abort: the run's evidence is degraded, not void, and the report says exactly which files are unattributable. The worktree recommendation lives in §Mutating `--fix` mode contract as advisory prose — a hard gate would break the established single-tree dogfood flow and 0293's refuse-gate semantics. Keep protocol `@1.2`: all additions are optional fields; the report validator is not extended (no new failure modes for old reports).

**R3 — chain observability.** Three sub-decisions:
1. Platform-note text (a): one paragraph under §Platform Notes → Claude Code, cross-linking §"`--next` chain stop-at-testing". No behavior change — it documents why the existing rule always triggers on this platform.
2. `--chain-follow` (b): argument-table row + one sentence in the stop-at-testing section replacing "The operator may direct…" prose with the flag as the sanctioned mechanism (prose direction remains honored for back-compat). The flag's contract: driver reads the chained leg's named artifacts (`.spur/run/<wbs>-verdict.json`, task-file section diffs, review table) after the leg completes and attributes normally; it does NOT license the driver to execute the leg itself.
3. Marker (c) — decide here: recommendation is **reject** the dispatch-time `.spur/run/<wbs>-chained-leg.json` marker. Rationale: the dispatching commands (`dev-run.md` §`--next`) already record provenance via `spur task run-link --source next-auto` (observed working in the dev-run report, step 6 — run id `chain:next-auto:0281:…`), which is DB-backed and precisely the "leg dispatched" signal the marker would duplicate as filesystem sprawl. The driver should instead read the run-link record. If implementation reveals run-links are not queryable enough for this (no `spur task run-link list`-equivalent), flip the decision and implement the marker — record either outcome in Solution.

**R4 — feature O AC scenario.** Corpus-only change following the 0294 precedent. Append to feature O's `Acceptance Criteria` gherkin block, matching the file's existing style (non-`@core`, title matching the task scenario's normalized title):

```gherkin
  Scenario: Cache evidence cannot silently inflate fresh input
    Given provider records separately expose fresh input, cache read, or cache creation
    When normalized metrics are calculated
    Then raw fields are retained, fresh input per verified PASS never folds in cache-read tokens, and provider-specific totals are labeled with their exact definitions
```

Write via `spur feature update O --section "Acceptance Criteria" --from-file <tmp>` carrying the full replacement section body (read the current body first; section writes replace, not append). DD-09 matches on normalized title only (`packages/domain/src/bdd/coverage.ts`), so body wording may be condensed; the title must stay verbatim.

**Ordering/blast radius.** R4 is independent and zero-risk (do first). R1 is cross-repo but self-contained. R2/R3 touch the same SKILL.md — implement together in one commit to avoid churn; they are text-contract changes with test impact limited to `plugins/sp/tests/skill-structure.test.ts` (verify it still passes; extend only if it asserts argument-table contents).
### Plan
1. **R4 first (corpus, ~15 min):** read feature O's current AC body; append the anti-inflation scenario; write via `spur feature update O --section "Acceptance Criteria" --from-file`; verify `spur task check 0281 --json` → zero findings and `spur feature check O` passes.
2. **R1 superskill change (~1 h, cross-repo):** implement the `@`-suffix exemption in `~/xprojects/superskill/packages/core/src/pipeline/rewrite-references.ts` with the replacer-callback approach; add the three regression tests to `packages/core/tests/pipeline/rewrite-references.test.ts`; run that repo's check gate; commit there (conventional commit) and note the hash.
3. **R1 reinstall + verify (~15 min):** `superskill install sp`; grep `~/tools/dot_files/config/agents/skills/sp-dogfood-testing/` — expect 0 occurrences of `sp-dogfood-testing@` and 7 colon-form protocol occurrences; confirm ordinary flattened refs (e.g. the skill's own name in prose) are still dash-form; validate a skeleton copied from the installed template with `bun run plugins/sp/scripts/dogfood-testing/validate-report.ts` (or its test harness).
4. **R2+R3 skill-contract edit (~1.5 h, one commit):** update `plugins/sp/skills/dogfood-testing/SKILL.md` (Phase 1 fingerprint, Phase 2/4 drift check, §Mutating `--fix` worktree advisory, Platform Notes Claude Code boundary, `--chain-follow` argument row, stop-at-testing override sentence), `references/monitor-ledger.md` (fingerprint frontmatter + drift warning row), `references/report-template.md` (optional drift-finding note), and `plugins/sp/commands/dev-dogfood.md` (`--chain-follow` row). Resolve the R3(c) marker decision against the run-link record capability and write the outcome into this task's Solution.
5. **R3 follow-through:** re-run `superskill install sp` so the installed copies pick up R2/R3 text (single reinstall may be merged with step 3 if steps land together).
6. **Gates:** `bun run autofix && bun run spur-check`; `bun run lint`; `bun run test` (includes `plugins/sp` — `skill-structure.test.ts` and `report-contract.test.ts` must stay green); `bun run test-cf`; `bun run build`; intentional-only `git status`.
7. **Wrap:** record per-requirement evidence in `### Testing`; run `/sp:dev-verify 0296` for the verdict; note the superskill commit hash + reinstall timestamp in `### Solution`.
### Solution

#### R1 — superskill `rewriteSkillReferences` @-suffix exemption (cross-repo)
- **`~/xprojects/superskill/packages/core/src/pipeline/rewrite-references.ts:20-33`** — Replaced `.map(l => l.replace(re, '$1-$2'))` with a replacer callback `(m, p1, p2, offset, s) => s[offset + m.length] === '@' ? m : `${p1}-${p2}` `. A `@` immediately after the full match leaves the token unchanged; ordinary `sp:<name>` references are still flattened. Preserves existing slash-command-line and foreign-prefix exemptions.
- **`~/xprojects/superskill/packages/core/tests/pipeline/rewrite-references.test.ts`** — Added regression tests: version-pinned protocol string survives verbatim; plain reference in same doc is flattened; token like `sp:foo@1.0` in prose survives.

#### R2 — workspace-drift guard
- **`plugins/sp/skills/dogfood-testing/SKILL.md`** Phase 1 step 3 — workspace fingerprint recording (git HEAD + `git status --porcelain` hash + timestamp) for fix-mode and mutating-`--fix` dogfoods.
- **`plugins/sp/skills/dogfood-testing/SKILL.md`** Phase 2 step 3 — drift check before each fix application: re-take snapshot, diff against baseline minus run-touched files; on drift → warning row + P2 finding.
- **`plugins/sp/skills/dogfood-testing/SKILL.md`** Phase 4 step 5 — drift check at finalize.
- **`plugins/sp/skills/dogfood-testing/SKILL.md`** New §Workspace-drift guard section — fingerprint spec, drift check contract, drift definition ("explained" set vs drift), detection behavior, worktree advisory for mutating dogfoods.
- **`plugins/sp/skills/dogfood-testing/references/monitor-ledger.md`** Rule 6 — `drift:external` row contract: Outcome `drift`, Fix Applied = drifted paths, mandatory P2 finding, cache columns `—`.
- **`plugins/sp/skills/dogfood-testing/references/report-template.md`** — `workspace_fingerprint` block in canonical frontmatter; P2 drift finding mandatory in §6 Findings; Phase 4 checklist updated (step 5 drift check + ledger cardinality drift-row exclusion).
- Protocol stays `sp:dogfood-testing@1.2`; new fields optional — existing reports remain valid.

#### R3 — `--next` chain observability
- **`plugins/sp/skills/dogfood-testing/SKILL.md`** §Arguments — `--chain-follow` row: operator override, licenses reading chained-leg artifacts, does NOT license executing the chained leg. Default off.
- **`plugins/sp/skills/dogfood-testing/SKILL.md`** §`--next` chain stop-at-testing — "operator may direct" prose replaced with `--chain-follow` as the sanctioned mechanism (prose direction honored for back-compat).
- **`plugins/sp/skills/dogfood-testing/SKILL.md`** §Platform Notes → Claude Code — boundary note: `Skill()` runs inline, chained `--next` legs are same-session-unobservable, `--next` dogfood stops at testing by default; standalone invocation workaround named with the 0281 pair as example.
- **`plugins/sp/commands/dev-dogfood.md`** — `--chain-follow` row in argument table; argument-hint updated.
- **R3(c) — dispatch-time chained-leg marker rejected.** Run-links (`spur task run-link --source next-auto`) already provide the "leg dispatched" signal (DB-backed, observed working in the dev-run report step 6). Adding `.spur/run/<wbs>-chained-leg.json` would duplicate this as filesystem sprawl with zero additional information. The driver should read the run-link record instead. Rejection rationale recorded here per AC "Scenario: Chained-leg marker decision is closed either way."

#### R4 — feature O anti-inflation scenario
- **`docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md`** — Appended `@edge` Scenario "Cache evidence cannot silently inflate fresh input" to Acceptance Criteria gherkin block via `spur feature update O --section "Acceptance Criteria" --from-file <tmp>`, following the 0294 precedent. No DD-09 rule change.
### Testing
Coverage: N/A for this repo (plugin markdown + corpus changes only; no spur-new runtime code path changed). The superskill code change is covered by its own suite: 17 pass / 0 fail in `packages/core/tests/pipeline/rewrite-references.test.ts`.

Independent audit (2026-07-19, `--force` re-verify in a restricted sandbox; implementation was authored by a concurrent agent session — see Review P4 for the environment split).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|---|---|---|
| R1 | MET | Replacer-callback exemption live in `~/xprojects/superskill/packages/core/src/pipeline/rewrite-references.ts` (commit `c6efa6d`); functional probe this run: 4/4 PASS (`protocol: sp:dogfood-testing@1.2` preserved; plain `sp:dogfood-testing` flattened; `sp:foo@1.0` preserved; `node:fs`/`bun:test` untouched). Regression tests exist (`rewrite-references.test.ts:73,78,85`) and pass 17/0. Installed copies verified: colon-form protocol at installed `SKILL.md:108,437`, `report-template.md:7,16,51`, `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:7`; sole dash occurrence is the deliberate "dash form is rejected" prose at `plugins/sp/skills/dogfood-testing/references/report-template.md:21`; ordinary refs still flattened. |
| R2 | MET | `plugins/sp/skills/dogfood-testing/SKILL.md` — Phase 1 fingerprint step, Phase 2 pre-fix drift check, Phase 4 step 5 finalize check, §Workspace-drift guard (fingerprint yaml spec, explained-set definition, drift = warning row + mandatory P2 finding, never-attribute rule); worktree advisory at `SKILL.md:418`; `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:39` rule 6 `drift:external` row contract; `plugins/sp/skills/dogfood-testing/references/report-template.md:52` optional `workspace_fingerprint` frontmatter, `:242` mandatory P2 drift finding, `:268` cardinality excludes drift rows. Protocol unchanged at `sp:dogfood-testing@1.2`. |
| R3 | MET | (a) Platform boundary note `SKILL.md:524-531` (inline `Skill()`, same-session-unobservable, stop-at-testing default, standalone-invocation workaround with the 0281 pair as example); (b) `--chain-follow` argument row in `SKILL.md` table and `plugins/sp/commands/dev-dogfood.md:38` + argument-hint `:3`; licenses reading chained-leg artifacts only, never executing the leg; `detect-pipeline-driving.ts` untouched (git status clean for scripts). (c) Dispatch-time marker REJECTED with rationale in Solution — run-links already provide the DB-backed dispatch signal (verified: `task_run_links` row `chain:chain:0296:1784440269435`, kind `pipeline`, 05:51:09Z). |
| R4 | MET | Anti-inflation scenario present in feature O AC gherkin block; `spur task check 0281 --json` → pass, zero findings (DD-09 L4 warning gone); `spur feature check O --json` → pass; `spur task check 0280` → pass (title-dash normalization did not break DD-09 matching). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|---|---|---|---|
| Version-pinned protocol strings survive superskill install | MET | command | Installed-tree grep: 7 colon-form occurrences, 1 deliberate dash mention; plain refs flattened; installed template frontmatter `protocol:` equals `CANONICAL_PROTOCOL` (`plugins/sp/scripts/dogfood-testing/validate-report.ts:22`); `report-contract.test.ts` green in gate suite. |
| superskill rewrite exemption is regression-tested | MET | test | `bun test tests/pipeline/rewrite-references.test.ts` → 17 pass / 0 fail (run this audit, TMPDIR copy; repo-root run blocked only by sandbox EPERM on `.coverage`); all three required cases at `:73,:78,:85`. |
| Concurrent workspace mutation is detected and attributed | MET | static-ref | Contract text: SKILL.md §Workspace-drift guard (warning row + mandatory P2 finding + never-claim rule); protocol-text deliverable — enforcement is driver-behavioral by design (`--max-retry 0` observe-only stays zero-overhead). |
| Worktree isolation is recommended for mutating dogfoods | MET | static-ref | `SKILL.md:418-419` — advisory, refuse-gate semantics from 0293 unchanged. |
| Claude Code chain boundary is documented with its workaround | MET | static-ref | `SKILL.md:524-531`. |
| --chain-follow formalizes the operator override | MET | static-ref | `SKILL.md` argument row + `dev-dogfood.md:3,38`; stop-at-testing remains the default; gate scripts untouched. |
| Chained-leg marker decision is closed either way | MET | static-ref | Rejection rationale recorded in Solution §R3(c) with the run-link record as the existing dispatch signal. |
| Feature O AC covers the anti-inflation scenario | MET | command | `spur task check 0281` zero findings; `spur feature check O` pass. Deviation noted: diff also carries CLI gherkin re-render em-dash→hyphen title normalization beyond the added scenario (semantics unchanged; 0280/0281 checks pass). |

**Discrete checks**

| Check | Status | Evidence |
|---|---|---|
| design-conformance | pass | All Design claims implemented as written (R1 replacer callback incl. rejected lookahead variant; R2 check points exactly before-fix + finalize; R3(c) resolved to the Design-recommended rejection); no silent deviation. |
| scope-creep | pass | Diff hunks map to R1–R4; only extra hunks are CLI-rendering normalization in feature O (noted, semantics unchanged). |
| security | pass | No secrets, no exec-surface change; skill-text and corpus edits; superskill change narrows a rewrite, adds no capability. |
| correctness | pass | Functional probe 4/4; 17/17 regression tests; installed-tree state matches source contract. |
| usability | pass | `--chain-follow` documented on both surfaces; drift guard states operator-facing attribution rules. |
| architecture | pass | Fix at the single choke point (`rewriteSkillReferences`), not call sites; protocol stays @1.2 additive. |
| strict-core | pass | `spur task check 0296 --json` → pass (sole L4: deliberate `feature_id: null` deferral, DD-07 advisory). |

**Fresh command evidence (this audit run)**

- `bun -e <rewrite functional probe>` → `R1 functional check: PASS (4 checks)`.
- `bun test tests/pipeline/rewrite-references.test.ts` (TMPDIR copy) → 17 pass, 0 fail.
- `bun run lint` → clean (biome + per-workspace tsc).
- `bun run test` → 3051 pass / 3 fail — exactly the known environmental trio (2× `Bun.serve port:0` denied, 1× `ps` EPERM); re-run of the two files reproduced all 3 with sandbox errors; no additional failures. Implementer's out-of-sandbox run: 3054/0.
- `bun run test-cf` → fails in-sandbox on localhost bind (same denial class); implementer's out-of-sandbox run: pass.
- `bun run build` → green (CLI + server + web complete).
- `spur task check 0281` / `0280` / `0296`, `spur feature check O` → all pass.

Verdict: PASS
### Review
Independent post-done audit review (2026-07-19, `--force` re-verify). The implementation was produced by a concurrent agent session; this table replaces the scaffold table that the done-gate accepted (see P2).

| Priority | Finding | Location | Action |
|----------|---------|----------|--------|
| P1 | No unresolved implementation blocker. R1–R4 all verified MET by independent audit (fresh command + static evidence in Testing). | — | None. |
| P2 | `isReviewScaffold` treats em-dash (`—`) cells as real table content, so a `\| P1 \| — \| — \| — \|` placeholder Review passes the done-gate's Review L3 layer — empirically how this task reached `done` at 05:52:36Z with an unauthored Review. Cells containing only `—`/`-`/`n/a` should count as empty in the scaffold detector. | `packages/app/src/services/task-check.ts:127` | File a follow-up task (out of 0296 scope; pre-existing gate code, not part of this diff). |
| P3 | The R1 fix (superskill `c6efa6d`) is committed on top of the v0.3.5 release commit and is not in the npm-registry tarball. The global `superskill` dist was rebuilt locally with the fix (verified: exemption present in `~/.bun/install/global/.../dist/index.js`, mtime post-commit), so installs work today — but a registry reinstall of 0.3.5 would silently regress the installed skill files. | `~/xprojects/superskill` HEAD `c6efa6d` | Release/publish superskill 0.3.6 containing `c6efa6d`. |
| P4 | Implementer's gate evidence (3054 pass / 0 fail, test-cf pass) was measured outside the restricted sandbox; the in-sandbox audit run shows 3051/3 (known environmental trio: 2× `Bun.serve port:0`, 1× `ps` EPERM) and a test-cf localhost-bind failure of the same class. Both are true in their environments; no regression. Additionally, the feature O diff includes em-dash→hyphen scenario-title normalization from the CLI's gherkin re-render beyond the added scenario — semantics unchanged, `task check` passes on 0280/0281 and `feature check O` passes. | `docs/features/O_*.md`, memory: sandbox-port-binding-tests | None (recorded for evidence context). |

Review outcome: PASS. SECUA lenses (S/E/C/U/A) surfaced no blocker or major finding in the diff itself; both P2/P3 findings concern surrounding tooling (gate detector, release pipeline), filed as follow-ups rather than scope expansion.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-19T04:17:45.110Z backlog → todo (system)
- 2026-07-19T05:51:02.001Z todo → wip (system)
- 2026-07-19T05:51:05.752Z wip → testing (system)
- 2026-07-19T05:52:36.433Z testing → done (system)
