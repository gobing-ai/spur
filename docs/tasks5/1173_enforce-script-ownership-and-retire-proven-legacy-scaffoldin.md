---
schema_version: 1
name: Enforce script ownership and retire proven legacy scaffolding
status: done
template: feature-impl
created_at: 2026-10-12T03:34:10.708Z
updated_at: "2026-10-12T18:09:59.608Z"
feature_id: A91
priority: P1
tags:
  - script-consolidation
estimate_hours: 8

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1173-verdict.json
---

## 1173. Enforce script ownership and retire proven legacy scaffolding

### Background

Implements: R1 — Placement policy prevents a second harness implementation; R7 — Legacy cleanup removes obsolete surfaces without weakening safeguards.

Plan and detailed dispositions: docs/plans/2026-10-11-harness-script-consolidation.md. Scope is this vertical slice only; unrelated current edits are foreign.

**Refine corrections (2026-10-11)**

- Immediate hook-layout enforcement would fail before hook relocation → defer activation of the tested helper to 1174, retain current strict checks.
- Dogfood scripts described as helpers → both have import.meta.main entries; retain entries and move only pure logic.
- Executable routing config treated as runtime policy → only two app tests import it; make it a test fixture instead of adding production code.
- Builder aliases described as possibly stale → package.json still calls them; preserve root entry names while migrating their implementation.
- Prototype deletion was conditional and unspecified → compare its self-checks with graduated projection tests and preserve the Markdown historical record.

### Requirements

- [x] R1. Extend the current placement checker with focused source-layout and handwritten-lib boundary tests; retain every existing strict check and the shrinking baseline.
- [x] R2. Keep executable skill adapters, move their pure helpers to lib, and remove the tiny daily-summary logger helper without changing its executable entry contract.
- [x] R3. Move the test-only proportional routing model into app test fixtures and replace still-valid prototype assertions with production projection tests before deleting the executable prototype.
- [x] R4. Preserve root bump-ver/drop-tags script names while routing them to the existing source-local builder commands; remove unused dispatcher aliases/forwarder after caller migration, with no release operation executed by tests.
- [x] R5. Remove stale active gate-lock instructions and comments; retain SQLite busy retries, corpus allocation locks, test preload and git commit protection.

Out of scope: No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Acceptance Criteria

- [x] AC1 — Placement policy prevents a second harness implementation (req: R1)
- [x] AC2 — Legacy cleanup removes obsolete surfaces without weakening safeguards (req: R5)

Given the supported source and installed contracts, when the focused fixtures exercise this migration, then behavior and failure policy remain compatible. Verification lens: Checker fixtures: scripts/commands/script-contract-check.test.ts. Dogfood regressions: plugins/sp/tests/dogfood-testing/report-contract.test.ts and pipeline-detect.test.ts. Logger integration: plugins/sp/tests/daily-summary/daily-summary.test.ts. Routing/prototype: packages/app/tests/workflow/proportional-route-table.test.ts, proportional-routing-pilots.test.ts and plan-projection.test.ts. Run each inside its workspace; assert no live release side effect. A grep of current instruction owners must find no active host-wide-lock requirement. Existing quality-gate retry tests and commit-guard tests must remain green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-12T03:58:01.728Z

- Closed: no new public API; checker changes are repository tooling.
- Closed: new strict hook-layout activation belongs to 1174 after the source moves, not a baseline waiver.
- Closed: routing model remains a test fixture; dogfood scripts keep their executable contracts.
- Deferred owner: operator, separate work only if a reusable public check/runner is later requested; no dependency of this slice.

### Design

WHAT/WHY: close the source-placement holes without a new framework. WHERE: extend `scripts/commands/script-contract-check.ts` and its existing sibling tests. Frozen internal additions: `checkHookLayout` (exported pure checker returning existing placement-finding records) and handwritten-lib DB/corpus checks; do not add a public command or a second registry. Unit-fixture the hook checker here; 1174 wires its strict runtime call only when the hook move lands. This avoids adding migration suppressions or making the intermediate tree fail because 1174 has not run. Existing budget/DB/corpus/noun-clash checks remain active throughout. Generated .mjs/.d.mts outputs are excluded from handwritten-lib source checks; source-owner/exception review remains semantic, never inferred from line count.

Move pure dogfood report/detection logic to `plugins/sp/lib/dogfood-report.ts` and `plugins/sp/lib/dogfood-pipeline.ts`; keep both current scripts and their parse/run/main/usage behavior as thin entries. Both are already executables, not stale libraries. Update plugin tests/imports and generated twins in this task. The 28-line daily logger has a caller and a file-channel no-op: inline the used console toggling into daily-summary, update tests, remove the helper and its manifest repo-only row; do not invent a shared logger.

`config/proportional-route-table.ts` has test-only imports: relocate to `packages/app/tests/fixtures/proportional-route-table.ts`, update the two importing tests, and add no production route engine. Compare prototype self-checks with `plan-projection.test.ts`, port only missing still-valid assertions, keep the historical Markdown record, then remove the executable prototype.

For root release script names use source-local `bun run apps/cli/src/index.ts builder bump-ver` and `... builder drop-tags`; migrate all active references before removing `scripts/commands/release.ts` and its dispatcher cases. Root names remain stable; test argv forwarding with a fake command runner, never bump versions or delete tags in verification. Clean current lock claims in inline-pipeline-driver/code-implementation, quality-gate comments and scripts/plugin bunfig comments; historical dated examples may remain labeled historical. Do not delete preload or change real busy retry policy. Anti-patterns: baseline expansion, LOC-only semantic judgments, stripping fail-open guards, introducing production code for test-only fixtures.

Dependencies and handoff: No prerequisites. Leaves checkHookLayout + fixtures for 1174, stable plugin script entries for downstream tasks, and unchanged bundle/runtime behavior. 1174 activates the hook layout check; 1176 may shrink its own now-stale baseline rows only after extraction.

Primary references: `scripts/commands/script-contract-check.ts:556`; `scripts/commands/script-contract-check.test.ts:566`; `config/script-placement-baseline.json:1`; `config/proportional-route-table.ts:58`; `packages/app/tests/workflow/proportional-route-table.test.ts:8`; `packages/app/tests/workflow/proportional-routing-pilots.test.ts:8`; `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:363`; `plugins/sp/scripts/dogfood-testing/validate-report.ts:362`; `plugins/sp/scripts/daily-summary/logger.ts:1`; `package.json:76`; `docs/analysis/2026-10-plan-projection-prototype.ts:382`; `packages/app/tests/workflow/plan-projection.test.ts:58`.

Environment and scope: root Bun/TypeScript workspaces and existing Superskill conversion; no dependency change. No wip tasks or extra worktrees were present at the frozen batch kickoff. Recheck conflict scope before implementation; prior A91 planning edits are part of the operator-authorized context.

No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Plan

- [x] 1. Read the exact callers and existing checker fixtures; record current baseline and active lock-text matches.
- [x] 2. Implement lib-boundary checks and the unit-fixtured hook layout helper without wiring the pending hook layout into the strict scan.
- [x] 3. Extract dogfood pure helpers, inline logger behavior, update all callers/manifests, and regenerate affected twins through existing scripts.
- [x] 4. Move the routing fixture, port missing prototype assertions, remove only the superseded executable, and migrate root release aliases to current builder calls.
- [x] 5. Remove stale active gate-lock guidance while retaining preload/retries/commit guard; run tests named below, placement/standalone and plugin-smoke, then task-local spur-check. Sync actual owner docs only.

### Solution

Placement enforcement (ADR-130 review surface, no new command or registry):

- `scripts/commands/script-contract-check.ts:571` — the DB/corpus boundary is now one helper (`recordDbAndCorpusFindings`) shared by scripts, hooks and handwritten lib, so the three surfaces cannot drift apart.
- `scripts/commands/script-contract-check.ts:625` — new exported `checkHookLayout`: one authored entry per registered `hooks.json` identity, helpers belong in `plugins/sp/lib`, tests belong to `plugins/sp/tests/hooks`, with the Pi extension and the opt-in conditional guard as the two supported extra entry mechanisms. Pure and unit-fixtured; 1174 wires its strict call once the hook relocation lands.
- `scripts/commands/script-contract-check.ts:744` — `plugins/sp/lib` now carries the boundary and no line budget: a line count is a review trigger, not an architecture test, so shortening a wrapper cannot push application logic out of review; it is the same path `biome.json:23` re-includes in lint.
- `scripts/commands/script-contract-check.test.ts:686` — fixtures for the lib boundary (boundary applies, budget does not); `scripts/commands/script-contract-check.test.ts:723` to `:796` cover the hook helper (missing entry, duplicate registration within one event, unregistered helper, misplaced test, both extension entries, unreadable registry); `scripts/commands/script-contract-check.test.ts:809` pins the real tree clean.
- `biome.json:23` — the blanket lib ignore became generated-output-only patterns, restoring lint on handwritten lib sources; `plugins/sp/lib/run-summary-core.ts:1` took the resulting import-order and trailing-blank fix.
- `config/script-placement-baseline.json:29` — shrank by the two rows the dogfood move made stale, since the baseline may only shrink.

Ownership moves:

- `plugins/sp/lib/dogfood-report.ts:236` and `plugins/sp/lib/dogfood-pipeline.ts:125` — pure cores extracted from the two dogfood scripts; `plugins/sp/scripts/dogfood-testing/validate-report.ts:14` and `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:21` re-export them and keep argv, usage, exit codes and refusal messages, so plugin tests, skill references and the live Phase 1.0 gate keep working through the script path.
- `plugins/sp/scripts/daily-summary/daily-summary.ts:23` — the used part of the 28-line logger (a console toggle) inlined; `plugins/sp/scripts/daily-summary/logger.ts` and its repo-only manifest row are gone, leaving `config/plugin-scripts.json:21` as the only daily-summary entry. Test hook re-pointed at `plugins/sp/tests/daily-summary/daily-summary.test.ts:29`.
- `packages/app/tests/fixtures/proportional-route-table.ts:1` — the test-only routing model left `config/`, which keeps declarative data only; both importers re-pointed. `packages/app/tests/workflow/plan-projection.test.ts:178` ports the prototype's still-valid label-stability assertion, and `docs/analysis/2026-10-plan-projection-prototype.md:4` records the retirement of the executable prototype.

Legacy retirement:

- `package.json:76` — the stable root names now route to the source-local builder commands; `scripts/commands/release.ts` is deleted together with its `scripts/spur-dev.ts` dispatcher cases, pinned by `scripts/commands/release-alias.test.ts:84`, so one implementation serves the surface.
- `scripts/commands/release-alias.test.ts:55` — fake-runner argv test that invokes its shim by absolute path, so it pins forwarding without any possibility of reaching the real release flow.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:769` and `:910`, `plugins/sp/skills/code-implementation/SKILL.md:168` — active gate-lock claims removed while the surviving rules stay; `scripts/bunfig.toml:1` and `plugins/sp/bunfig.toml:1` keep the preload with its real reason. The deleted mechanism itself is proven gone by `refactor(gate): remove gate-lock mechanism and simplify quality-gate` (f1d3c2caa).

Deferred, by design: the strict hook-layout call (1174), lib-dependency review beyond the boundary, and any shrink of other tasks' now-stale baseline rows (1176).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/script-contract-check.ts:571` (shared DB/corpus boundary for scripts, hooks and handwritten lib), `scripts/commands/script-contract-check.ts:625` (hook source-layout checker: one authored entry per registered identity, helpers to lib, tests to the plugin test owner), `scripts/commands/script-contract-check.ts:741` (lib gets the boundary with no 250-line budget — Biome `files.includes` is resolved relative to the config file, https://biomejs.dev/installation/upgrade-to-biome-v2/); fixtures `scripts/commands/script-contract-check.test.ts:686` and `scripts/commands/script-contract-check.test.ts:723` through `:796`; real tree clean `scripts/commands/script-contract-check.test.ts:809` |
| R2 | MET | Pure cores `plugins/sp/lib/dogfood-report.ts:236` and `plugins/sp/lib/dogfood-pipeline.ts:125`; thin executable entries `plugins/sp/scripts/dogfood-testing/validate-report.ts:14` and `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:21` (argv, usage and exit codes unchanged); inlined console toggle `plugins/sp/scripts/daily-summary/daily-summary.ts:23`; helper deleted and the manifest carries no repo-only row `config/plugin-scripts.json:21`; suite `plugins/sp/tests/daily-summary/daily-summary.test.ts:29` |
| R3 | MET | Test fixture `packages/app/tests/fixtures/proportional-route-table.ts:1` with both importers re-pointed `packages/app/tests/workflow/proportional-route-table.test.ts:8` and `packages/app/tests/workflow/proportional-routing-pilots.test.ts:8`; ported still-valid assertion `packages/app/tests/workflow/plan-projection.test.ts:178`; executable prototype removed with its historical Markdown record kept `docs/analysis/2026-10-plan-projection-prototype.md:4` |
| R4 | MET | Root script names route to the source-local builder `package.json:76` and `package.json:77`; forwarder and dispatcher cases removed `scripts/spur-dev.ts:1` (no bump-ver/drop-tags case remains); fake-runner argv test `scripts/commands/release-alias.test.ts:55`; live probe `bun run bump-ver --help` exits 0 with the builder options, which is Bun appending operator args to a script command (https://bun.com/docs/runtime); no release executed by any check — version `apps/cli/package.json:3` and both `0.1.4` tags unchanged on local and origin |
| R5 | MET | Active lock claims gone `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:769` and `:910`, `plugins/sp/skills/code-implementation/SKILL.md:168`; the mechanism itself was deleted (`git log -S full-gate.lock` → f1d3c2caa); preload kept with its real reason `scripts/bunfig.toml:1` and `plugins/sp/bunfig.toml:1`; safeguards retained: SQLite busy retries `packages/domain/src/db.ts:19`, commit guard `plugins/sp/scripts/commit-guard.ts:3` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Placement policy prevents a second harness implementation (req: R1) | MET | test | `scripts/commands/script-contract-check.test.ts:686` (handwritten-lib boundary, no lib line budget), `scripts/commands/script-contract-check.test.ts:723` to `:796` (hook layout: one entry per identity, registered-twice group, unregistered helper, misplaced test, extension entries), `scripts/commands/script-contract-check.test.ts:809` (real tree produces no placement finding); dev-time probe `bun scripts/commands/script-contract-check.ts --placement-only` → `0 finding(s) — PASS` |
| AC2 — Legacy cleanup removes obsolete surfaces without weakening safeguards (req: R5) | MET | command | Full gate through the sanctioned primitive: `wbs=1173 ... bun plugins/sp/scripts/quality-gate.ts run` → `quality gate PASS (attempts: 1)`; durable artifacts `.spur/run/1173-test-gate.status` (`PASS`) and `.spur/run/1173-test-gate.log:455` (`11076 pass`, `0 fail`), `:15` (51 pre-check rules), `:460` (2 post-check rules), `:3` (1353 files formatted/linted) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

**Confidence:** MEDIUM

The gap: the placement/lib boundary and the hook-layout checker were verified by the tree’s own full gate plus the placement scan, but these hops ran out of band from the pipeline. So the `test` hop never captured `proofDigest` and no digest-bound
`.spur/run/1173-check-receipt.json` exists; the deciding evidence is
`.spur/run/1173-test-gate.status` plus its log. A pipeline-driven run that writes that receipt
is what raises this to HIGH.

### References

Feature A91; ADR-130 (2026-10-11 amendment), ADR-129, ADR-065 and ADR-021. Detailed investigation: `docs/plans/2026-10-11-harness-script-consolidation.md`.

Premise sources:
- `scripts/commands/script-contract-check.ts:556`
- `scripts/commands/script-contract-check.test.ts:566`
- `config/script-placement-baseline.json:1`
- `config/proportional-route-table.ts:58`
- `packages/app/tests/workflow/proportional-route-table.test.ts:8`
- `packages/app/tests/workflow/proportional-routing-pilots.test.ts:8`
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:363`
- `plugins/sp/scripts/dogfood-testing/validate-report.ts:362`
- `plugins/sp/scripts/daily-summary/logger.ts:1`
- `package.json:76`
- `docs/analysis/2026-10-plan-projection-prototype.ts:382`
- `packages/app/tests/workflow/plan-projection.test.ts:58`

### History

- 2026-10-12T05:09:15.074Z todo → wip (system)
- 2026-10-12T05:09:17.449Z wip → testing (system)
- 2026-10-12T05:09:22.539Z testing → done (system)

