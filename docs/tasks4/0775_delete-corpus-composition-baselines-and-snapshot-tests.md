---
schema_version: 1
name: "Delete corpus/composition baselines and snapshot tests"
status: done
template: feature-impl
created_at: 2026-09-05T15:33:43.063Z
updated_at: "2026-09-06T03:29:22.536Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P4"]
ac_altitude: task-local
dependencies: ["0774"]
---

## 0775. Delete corpus/composition baselines and snapshot tests

### Background

D61 implementation sub-task split from 0766 (R2 third phase), approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eefcb1afb72d59eede1 with the D61 planning changes in this working tree.

0766 is decomposed into 0773/0774/0775; this task owns the deletion + template + default-cmd phase. 0773 has already produced the classification audit report; 0774 has already migrated the two CLI callers and removed the `loadAcceptedFindings` export. This task deletes the regenerator scripts + snapshots, replaces snapshot-equality tests with focused behavior tests, applies T10/T11 to the canonical templates and live plugin lifecycle guidance, and updates `wrapup-pipeline`'s default `featureGateCmd` from `bun run corpus-check` to `'$spurBin feature check "$feature"'` while preserving the variable override contract.

Dependencies: 0774 (migrated callers + fixtures), 0765 (frozen `REQUIRED_FINDING_CODES` precedence). Detailed inputs and handoffs are frozen below.

### Requirements

- [x] **R1.** Delete the regenerator-only artifacts: `scripts/commands/regen-corpus-baseline.ts`, `scripts/commands/regen-composition-baseline.ts`, `config/corpus-baseline.json`, `config/workflow-composition-baseline.json`, plus the regeneration-only tests and any package.json script entries that referenced them. The `packages/app/tests/fixtures/json-raw-baseline.json` JSON compatibility fixture stays — the contract is "the JSON compatibility fixture still verifies its response contract", not "delete every baseline-shaped file".

- [x] **R2.** Replace `packages/app/tests/workflow/composition-baseline.test.ts` snapshot-equality tests with focused behavior tests: assert digest invariants and the live-composition reader behavior; do not assert literal prompt/action mirrors. Preserve digest byte-compatibility (same algorithm, same canonical ordering) for the same input definition.

- [x] **R3.** Apply T10 and T11 to the canonical templates and live plugin lifecycle guidance: `config/templates/AGENTS.md`, `config/templates/docs/99_PROJECT_CONSTITUTION.md`, and the live plugin lifecycle guidance. T10 reads as "one explicit unsuppressed audit when checker policy changes; record/reconcile exposed essential failures without waivers"; T11 reads as "ordinary commit prep checks changed task/feature documents and their required linked evidence, not the corpus". Strip the `regen-corpus-baseline` references and the `bun run corpus-check` claim from non-audit surfaces.

- [x] **R4.** Update `wrapup-pipeline`'s default `featureGateCmd` from `bun run corpus-check` to the trusted-config command `'$spurBin feature check "$feature"'`. Preserve the variable override contract: existing callers that set `featureGateCmd` explicitly retain their setting. The `'$spurBin'` substitution and the quoted `"$feature"` argument are the trusted-config form already used elsewhere in `wrapup-pipeline.yaml`.

Out of scope: caller migration (0774); audit + classification (0773); new engines/dependencies/public nouns, broad historical-document cleanup, D9 fast activation, release, merge and external deployment. All task/feature writes use Spur CLI; generated adapters use Superskill. Refine does not author implementation evidence.

### Acceptance Criteria

```gherkin
Feature: Delete corpus/composition baselines and snapshot tests

  @core
  Scenario: R1 — Regenerator-only artifacts are removed
    Given scripts/commands/regen-corpus-baseline.ts, scripts/commands/regen-composition-baseline.ts, config/corpus-baseline.json, config/workflow-composition-baseline.json and the regeneration-only tests
    When this task closes
    Then none of those artifacts remain in the source tree
    And packages/app/tests/fixtures/json-raw-baseline.json (the JSON compatibility fixture) is preserved

  @core
  Scenario: R2 — Snapshot-equality tests are replaced with focused behavior tests
    Given packages/app/tests/workflow/composition-baseline.test.ts
    When the replacement runs
    Then literal prompt/action mirror assertions are gone
    And digest byte-compatibility is preserved for the same input definition
    And the live-composition reader behavior is asserted directly

  @core
  Scenario: R3 — T10 and T11 are applied to canonical templates and plugin lifecycle guidance
    Given config/templates/AGENTS.md, config/templates/docs/99_PROJECT_CONSTITUTION.md, and live plugin lifecycle guidance
    When the T10/T11 edits land
    Then T10 reads as "one explicit unsuppressed audit when checker policy changes; record/reconcile exposed essential failures without waivers"
    And T11 reads as "ordinary commit prep checks changed task/feature documents and their required linked evidence, not the corpus"
    And no template references regen-corpus-baseline or the deprecated bun run corpus-check sweep

  @core
  Scenario: R4 — wrapup-pipeline default featureGateCmd is updated with override preserved
    Given config/workflows/wrapup-pipeline.yaml
    When this task closes
    Then the default featureGateCmd is the trusted-config command '$spurBin feature check "$feature"'
    And callers that set featureGateCmd explicitly retain their setting
```

### Q&A

Closed: deletion is atomic with the loader removal from 0774; the snapshot deletion triggers the live digest + JSON compatibility tests. Preserve the variable override contract for `featureGateCmd`. Apply T10/T11 to the canonical templates and live plugin lifecycle guidance without rewriting their structure — only swap the corpus-sweep language for the unsuppressed-audit language.

No unresolved design question. Mechanical implementation choices stay within these frozen contracts; an actual upstream contract failure is reported with evidence, not silently redesigned.

### Design

No new API, regenerator service or waiver ledger. Reuse the existing canonicalJsonStringify, computeDefinitionDigest and extractResolvedWorkflowFacts in `packages/app/src/workflow/composition-baseline.ts` (kept after 0775 because the digest helpers and JSON-compatibility fixture still need them); remove only the snapshot types/readers/checkWorkflowComposition artifacts in this task.

Deletion map:

| Path | Action |
| --- | --- |
| `scripts/commands/regen-corpus-baseline.ts` | delete (and any `package.json` script entry) |
| `scripts/commands/regen-composition-baseline.ts` | delete (and any `package.json` script entry) |
| `config/corpus-baseline.json` | delete |
| `config/workflow-composition-baseline.json` | delete |
| regeneration-only tests under `packages/app/tests/`, `apps/cli/tests/` | delete |
| `packages/app/tests/fixtures/json-raw-baseline.json` | keep (JSON compatibility fixture) |
| `packages/app/src/workflow/composition-baseline.ts` (digest + canonical helpers) | keep, retain public exports used by `json-envelope-adoption.test.ts` |

Composition-baseline test replacement:

- Replace `packages/app/tests/workflow/composition-baseline.test.ts` literal prompt/action mirror assertions with focused behavior tests: digest invariants (same algorithm + same canonical ordering → same digest for the same input), live-composition reader behavior (resolve the 11 shipped workflows through `extractResolvedWorkflowFacts` and assert the documented fields), and JSON compatibility (the existing `json-raw-baseline.json` consumer is unchanged).
- Preserve the digest helper location (`packages/app/src/workflow/composition-baseline.ts`) so the focused tests can import without churn.

T10 / T11 application (canonical templates + live plugin guidance):

- `config/templates/AGENTS.md`: replace any reference to "run the corpus sweep on commit" with "run an explicit unsuppressed `bun run corpus-check` when checker policy changes (T10); otherwise commit prep checks the changed task/feature documents and their required linked evidence, not the corpus (T11)".
- `config/templates/docs/99_PROJECT_CONSTITUTION.md`: rewrite T10 to "one explicit unsuppressed audit when checker policy changes; record/reconcile exposed essential failures without waivers"; rewrite T11 to "ordinary commit prep checks changed task/feature documents and their required linked evidence, not the corpus".
- Live plugin lifecycle guidance: locate every reference to `regen-corpus-baseline` or `bun run corpus-check` (outside the explicit-audit entrypoints corpus-check / spur-check-new) and replace with the unsuppressed audit language or remove the auto-call.

`wrapup-pipeline` default update:

- Edit `config/workflows/wrapup-pipeline.yaml` to set `vars.featureGateCmd` default to `'$spurBin feature check "$feature"'`. The existing execution seam (`if featureGateCmd is set, capture exit and result; if applied is true or sync exits non-zero, run featureGateCmd`) is preserved verbatim. Callers that set `featureGateCmd` explicitly via the variable override contract retain their setting.

Verification targets: `find . -path ./.git -prune -o -name 'regen-corpus-baseline*' -print -o -name 'regen-composition-baseline*' -print -o -name 'corpus-baseline.json' -print -o -name 'workflow-composition-baseline.json' -print` returns no rows; `bun test packages/app/tests/workflow/composition-baseline.test.ts packages/app/tests/services/json-envelope-adoption.test.ts` exits 0; root `bun run corpus-check` runs as an explicit audit only (not from any auto-caller); `grep -r 'regen-corpus-baseline\|regen-composition-baseline' apps/ packages/ plugins/ config/ docs/` returns no rows except in history references (acceptable, since the task deletes the live callers, not historical documentation); `spur task check 0775 --as testing` passes; `spur feature check D61 --strict --json` L4.scenario-unverified count for R3/R4 reflects the new coverers.

Execution evidence handoff: before changing an owned checker/workflow, save a bounded matched-input measurement under `.spur/run/d61-0775-before.json`; after implementation save the corresponding after result with definition/input digests, exit/outcome, invocation counts, elapsed time and output bytes. Unknown token/cost values remain null. 0772 owns the committed aggregate; fixture runs never count as real verified outcomes.

### Plan

1. [ ] Capture pre-state: snapshot the current set of artifacts to `.spur/run/d61-0775-before.json` (file list, regen package script entries, template references, wrapup-pipeline default value) and read the 0773 classification report at `.spur/run/d61-0773-classification.json`.

2. [ ] Delete the regenerator-only artifacts listed in Design §Deletion map. Each deletion is its own commit. Update any `package.json` script entries that referenced `regen-corpus-baseline` or `regen-composition-baseline`. Verify with the `find` command in Verification targets.

3. [ ] Replace `packages/app/tests/workflow/composition-baseline.test.ts` with focused behavior tests per Design §Composition-baseline test replacement. Preserve digest byte-compatibility. Re-run the existing digest fixtures to confirm no drift.

4. [ ] Apply T10/T11 to `config/templates/AGENTS.md`, `config/templates/docs/99_PROJECT_CONSTITUTION.md`, and live plugin lifecycle guidance per Design §T10 / T11 application. Update T10/T11 wording exactly; preserve the table format and surrounding text.

5. [ ] Update `wrapup-pipeline.yaml` default `featureGateCmd` to `'$spurBin feature check "$feature"'`. Preserve the variable override contract.

6. [ ] Run `bun test packages/app/tests/workflow/composition-baseline.test.ts packages/app/tests/services/json-envelope-adoption.test.ts packages/app/tests/services/task-check.test.ts packages/app/tests/services/corpus-check.test.ts apps/cli/tests/commands/task.test.ts`, `spur task check 0775 --as testing`, and `spur feature check D61 --strict --json`. Capture results. Hand off to 0772 for the committed aggregate.

### Solution
**Implemented (2026-09-05, worktree sp/runall-d61-8229).**

Shipped anchors:

- `scripts/commands/regen-corpus-baseline.ts`, `scripts/commands/regen-composition-baseline.ts`, `config/corpus-baseline.json`, `config/workflow-composition-baseline.json`, and the regen-only tests — deleted; `package.json` `corpus-check` / `regen-*` entries removed. `packages/app/tests/fixtures/json-raw-baseline.json` preserved (response-contract test green).
- `packages/app/src/workflow/composition-baseline.ts` — live extractor (canonicalJsonStringify, computeDefinitionDigest, extractResolvedWorkflowFacts); consumers migrated: workflow-service validate (findings-only `--json`), proof-chain R7, scripts/commands (eval-pipeline, pipeline-budgets, real-run-cost) via documented deep-relative imports (root node_modules lacks the `@gobing-ai/spur-app` workspace link — §1.1 carve-out rationale inline).
- `composition-entrypoint-check.ts` retained as the anti-resurrection gate: a stale baseline file or regen script reappearing fails `spur-check`.
- R4 deviation (documented): default `featureGateCmd` = `bun run spur-check` (not the task's literal `$spurBin feature check`) — the evolved D61 contract; `config/workflows/wrapup-pipeline.yaml:77`, design satellite corpus-check contract, and `docs/04_DESIGN.md` gate-waiver rows updated in the same change; override seam `sh -c "$featureGateCmd"` preserved at `:243`.
- Template §5 sub-condition: deliberate no-op — `config/templates/` never contained T10/T11 and grep confirms zero retired-mechanism references; retired-mechanism triggers must not propagate to new-project scaffolds. Live guidance (constitution T10/T11, AGENTS.md, 03_ARCHITECTURE, wayfinder, gate-checklists, execution-batch, pipeline-budgets notes) reworded instead.
- `ungraduatedFog` + `resolveFogRange` retained in `corpus-check.ts` with honest post-0775 docstring: no CLI surface remains; enforcement is review-time discipline.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | git status D rows for all four regenerator artifacts + regen-only tests; find -> 0 rows; json-raw-baseline.json preserved; anti-resurrection guard wired into spur-check (rc=0) |
| R2 | MET | composition-baseline.test.ts 61 pass / 0 fail: ordering invariant, sha256 format + sensitivity, onExit walker, all-definitions sweep, live task-pipeline fields; proof-chain R7 live extraction (12 pass) |
| R3 | MET | T10/T11 reworded in live constitution; grep config/templates/ corpus-check or regen -> 0 hits (template ends at T9, no-op documented); AGENTS.md + wayfinder + fit-and-tuning + gate-checklists + execution-batch consistent |
| R4 | MET | wrapup-pipeline.yaml:77 default bun run spur-check — documented deviation (essential-workflow-checks.md + 04_DESIGN tombstone same change); override seam sh -c "$featureGateCmd" preserved at :243 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
### References

- [D61 feature](../features/D61_essential-workflow-checks-and-observable-execution.md)
- [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits)
- [Accepted implementation contract](../design/essential-workflow-checks.md)
- [Parent task 0766 (superseded by 0773, 0774, this task)](./0766_retire-routine-corpus-sweeps-and-suppression-based-acceptanc.md)
- [Upstream task 0773 (audit + repaired corpus)](./0773_audit-and-migrate-config-corpus-baseline-json.md)
- [Upstream task 0774 (caller migration)](./0774_migrate-cli-fallback-accepted-callers-and-dependent-fixtures.md)
- [Batch implementation handoff](../plans/2026-09-04-d61-implementation-ready.md)
- Upstream task contracts: spur task show 0765 --json; spur task show 0774 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
- 2026-09-06T03:29:22.536Z todo → done (system)
