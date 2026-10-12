---
schema_version: 1
name: Enforce script ownership and retire proven legacy scaffolding
status: todo
template: feature-impl
created_at: 2026-10-12T03:34:10.708Z
updated_at: "2026-10-12T04:01:53.670Z"
feature_id: A91
priority: P1
tags:
  - script-consolidation
estimate_hours: 8

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

- [ ] R1. Extend the current placement checker with focused source-layout and handwritten-lib boundary tests; retain every existing strict check and the shrinking baseline.
- [ ] R2. Keep executable skill adapters, move their pure helpers to lib, and remove the tiny daily-summary logger helper without changing its executable entry contract.
- [ ] R3. Move the test-only proportional routing model into app test fixtures and replace still-valid prototype assertions with production projection tests before deleting the executable prototype.
- [ ] R4. Preserve root bump-ver/drop-tags script names while routing them to the existing source-local builder commands; remove unused dispatcher aliases/forwarder after caller migration, with no release operation executed by tests.
- [ ] R5. Remove stale active gate-lock instructions and comments; retain SQLite busy retries, corpus allocation locks, test preload and git commit protection.

Out of scope: No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Acceptance Criteria

- [ ] AC1 — Placement policy prevents a second harness implementation (req: R1)
- [ ] AC2 — Legacy cleanup removes obsolete surfaces without weakening safeguards (req: R5)

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

- [ ] 1. Read the exact callers and existing checker fixtures; record current baseline and active lock-text matches.
- [ ] 2. Implement lib-boundary checks and the unit-fixtured hook layout helper without wiring the pending hook layout into the strict scan.
- [ ] 3. Extract dogfood pure helpers, inline logger behavior, update all callers/manifests, and regenerate affected twins through existing scripts.
- [ ] 4. Move the routing fixture, port missing prototype assertions, remove only the superseded executable, and migrate root release aliases to current builder calls.
- [ ] 5. Remove stale active gate-lock guidance while retaining preload/retries/commit guard; run tests named below, placement/standalone and plugin-smoke, then task-local spur-check. Sync actual owner docs only.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
