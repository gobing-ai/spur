---
template: standard
schema_version: 1
name: "Promote corpus-check from spur-dev to spur task check --corpus (ADR-051 misplacement fix)"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T21:12:13.589Z"
updated_at: "2026-08-10T21:14:08.453Z"
---

## 0502. Promote corpus-check from spur-dev to spur task check --corpus (ADR-051 misplacement fix)

### Background



### Requirements
<!-- R-numbered list of what must be true when this task is complete. -->

- **R1 — Corpus sweep is a flag on the existing `task check` verb.** `spur task check --corpus`
  (no WBS argument) sweeps every task AND every feature and fails on any structural error outside
  `config/corpus-baseline.json`, with the same two-sided baseline semantics as today (a new error
  fails; a baseline entry that no longer reproduces also fails — ADR-050/T10). NO new first-layer
  noun is added (`spur corpus …` is a rejected design — ADR-051 noun discipline).
- **R2 — Logic lives in `packages/app`, not the CLI transport and not `scripts/`.** Per ADR-021
  (apps are thin transports), the sweep + baseline-reconciliation logic moves from
  `scripts/commands/corpus-check.ts` into a `packages/app` service. The CLI self-spawn pattern
  (`sweep()` in `scripts/commands/corpus-check.ts:60` spawns `bun run apps/cli/src/index.ts …`) is
  replaced by direct in-process calls to the task/feature check services.
- **R3 — `--since <ref>` parity.** `spur task check --corpus --since <ref>` scopes the sweep exactly
  like the spur-dev version; `--corpus --since` with a missing or flag-like value fails loud with a
  usage error (current behavior: `scripts/spur-dev.ts:102` throws; the CLI must set a non-zero exit
  code with a clear message).
- **R4 — `--json` contract preserved.** `spur task check --corpus --json` emits a machine-readable
  summary (observed count, baselined count, new errors, stale baseline entries) so CI and the
  package.json `corpus-check` script keep working without parsing prose.
- **R5 — `package.json` retargeted; spur-dev copy removed.** Root `package.json` `corpus-check`
  script (line 87) invokes the CLI (`bun run apps/cli/src/index.ts task check --corpus`), so
  `spur-check-new` (line 79) and `spur-check-new:full` (line 85) keep passing unchanged. The
  `corpus-check` case/header/usage/import is removed from `scripts/spur-dev.ts` (lines 21, 30, 39,
  96–106) and `scripts/commands/corpus-check.ts` is deleted — the misplacement is fixed, not
  duplicated. (spur-dev is the internal surface — no consent gate applies to the removal; ADR-051.)
- **R6 — Exit-code semantics exact.** Exit 0 when every observed error is baselined and no baseline
  entry is stale; exit non-zero on any new error, any stale baseline entry, or an unparseable sweep
  (hard failure — never silently treated as "no errors"; see `sweep()` doc comment).
- **R7 — Docs synced same-commit (T3).** `AGENTS.md` verification-gate and misplacement notes and
  `docs/04_DESIGN.md:753` corpus-baseline mention updated to the CLI verb. Historical ADR-050 text
  is NOT rewritten (append-only decisions). ADR-051 Detail updated to record the promotion as done.
- **R8 — Gates green.** `bun run lint`, `bun run test`, `bun run build`, `bun run spur-check-new`
  exit 0. The moved service carries unit coverage in `packages/app/tests/` (baseline reconcile,
  new-error, stale-entry, unparseable-sweep cases) and the CLI flag/exit-code behavior has coverage
  in `apps/cli/tests/`.
### Acceptance Criteria
```gherkin
Feature: 0502 Promote corpus-check to the spur CLI

  Scenario: AC1 — corpus sweep runs under the task noun
    Given a Spur project checkout
    When spur task check --corpus runs
    Then every task and every feature is swept against the section matrix
    And errors not in config/corpus-baseline.json cause a non-zero exit
    And errors that ARE baselined do not cause a non-zero exit
    And a baseline entry that no longer reproduces causes a non-zero exit

  Scenario: AC2 — no new first-layer noun
    When spur --help lists top-level nouns
    Then no "corpus" noun exists
    And the noun list is exactly the pre-existing twelve nouns

  Scenario: AC3 — --since validation fails loud
    When spur task check --corpus --since runs with no value
    Then the CLI exits non-zero with a usage error naming --since
    When spur task check --corpus --since ee0771ab~1 runs
    Then the sweep is scoped to that ref as in the spur-dev version

  Scenario: AC4 — JSON output preserved
    When spur task check --corpus --json runs
    Then stdout is parseable JSON with observed/baselined/new/stale counts
    And CI consumers need no prose parsing

  Scenario: AC5 — package.json retargeted, spur-dev copy removed
    When root package.json is read
    Then the corpus-check script invokes the CLI verb, not scripts/spur-dev.ts
    And spur-check-new still chains bun run corpus-check and passes
    And scripts/spur-dev.ts has no corpus-check case, import, or usage line
    And scripts/commands/corpus-check.ts no longer exists

  Scenario: AC6 — exit semantics
    Given a corpus with only baselined errors
    When spur task check --corpus runs
    Then exit code is 0
    Given an injected unbaselined task error
    Then exit code is non-zero and the error is named

  Scenario: AC7 — consent recorded
    Then the Q&A section records operator consent for this CLI surface change
    And the verb shape (task check --corpus) is the consented design

  Scenario: AC8 — gates green
    When bun run lint, bun run test, bun run build, bun run spur-check-new run
    Then each exits 0
    And the packages/app corpus-check service tests and CLI flag tests pass
```
### Q&A
<!-- CLOSED decisions from refinement -->

- **Operator consent obtained (ADR-051 gate).** Robin explicitly ordered this promotion
  (2026-08-10: "file a new task file to fix the One genuine misplacement: corpus-check"). This task
  file IS the design-context record the consent gate requires.
- **Verb shape: `spur task check --corpus`, NOT `spur corpus check`.** ADR-051 noun discipline:
  first layer must be a noun grouping similar actions; a one-gate `corpus` noun is rejected.
  `task` hosts it because the corpus sweep is the whole-corpus form of `task check` (which already
  sweeps all tasks when no WBS is given — `apps/cli/src/commands/task.ts:963`) and the feature half
  rides the same check-matrix family. A matching `spur feature check --corpus` is deliberately NOT
  added — one gate, one entry point.
- **Move, don't wrap.** The spur-dev `corpus-check` command is removed outright rather than kept as
  a delegate: keeping both recreates the two-surfaces-for-one-gate problem ADR-051 exists to
  prevent. Root `package.json` scripts are the only retained caller-facing name (`bun run
  corpus-check`), retargeted to the CLI.
- **Kill the CLI self-spawn.** Today's sweep shells out to `bun run apps/cli/src/index.ts …` from
  inside a script. After promotion the CLI hosts the logic in-process via packages/app services —
  the self-spawn would be the CLI invoking itself.
- **Baseline file unchanged.** `config/corpus-baseline.json` format and `docs/04_DESIGN.md`'s
  ownership notes are untouched; only the invoking surface moves.
### Design
**Approach.** Relocate the corpus sweep + two-sided baseline reconciliation from
`scripts/commands/corpus-check.ts` into a `packages/app` service, expose it as `--corpus` on the
existing `spur task check` verb, retarget the root `package.json` script, and delete the spur-dev
copy. No new noun (ADR-051); no behavior change to the gate itself (ADR-050/T10 semantics kept).

**Why `--corpus` on `task check` (not a new noun, not `feature check`).** `spur task check` with no
WBS already sweeps the full task corpus (`apps/cli/src/commands/task.ts:963` — "full corpus (no
specific WBS)"). corpus-check's delta over that sweep is exactly: baseline reconciliation +
fail-on-new + fail-on-stale. A flag on the existing verb is the minimal surface change that keeps
the gate discoverable next to the per-task gate it extends. The feature half is swept by the same
command (one gate, one entry point) — the corpus is the task/feature corpus, and `task check` is
the corpus-check family host.

**Surfaces to change**

| Surface | Change |
| --- | --- |
| `packages/app/src/services/corpus-check.ts` (new) | Service: run full task + feature check sweeps in-process, collect `{kind,id,code,message}` errors, reconcile against `config/corpus-baseline.json` (two-sided), return `{observed, baselined, newErrors, staleEntries, ok}`. Port `key()` from `scripts/commands/corpus-check.ts:44`. Baseline path resolution must work from any project cwd (runtime context, not repo-root assumptions). |
| `packages/app/tests/services/corpus-check.test.ts` (new) | Port/extend `scripts/commands/corpus-check.test.ts`: baseline reconcile pass, new-error fail, stale-entry fail, unparseable-sweep hard-fail. In-memory fixtures, no repo sweep. |
| `apps/cli/src/commands/task.ts` (~line 133 registration; check verb) | Add `--corpus` and `--since <ref>` options to `task check`. `--corpus` requires NO WBS argument (usage error otherwise); `--since` without a value or with a flag-like value → exit non-zero with message naming `--since`. Human output mirrors today's summary lines; `--json` emits the structured summary. Exit code via `context.setExitCode`. |
| `apps/cli/tests/` (task check corpus cases) | CLI-level coverage: `--corpus` exit 0 on clean fixture corpus; non-zero on injected unbaselined error; `--since` misuse fails loud; `--json` parses. |
| `packages/app/src/index.ts` (or package barrel) | Export the new service for the CLI. |
| `scripts/spur-dev.ts` | Remove `corpus-check`: case (lines 96–106), import (line 30), header line (line 21), usage string (line 39). |
| `scripts/commands/corpus-check.ts` + `corpus-check.test.ts` | Delete (logic and coverage superseded by the packages/app service). |
| `package.json` (line 87) | `"corpus-check": "bun run apps/cli/src/index.ts task check --corpus"`. `spur-check-new` (79) and `spur-check-new:full` (85) unchanged — they chain `bun run corpus-check`. |
| `AGENTS.md` | Verification-gate bullets (~284, ~287) reference the CLI verb; "Known misplacement" note (~242) becomes "promoted — see ADR-051 + this task". |
| `docs/04_DESIGN.md:753` | Corpus-baseline comment mentions the CLI invocation (`spur task check --corpus`) instead of the spur-dev script. |
| `docs/00_ADR.md` ADR-051 Detail | Record the promotion as completed (one-line edit; ADR-050 historical text untouched). |

**Invariants**

- **Two-sided baseline semantics unchanged** — new error fails; stale baseline entry fails;
  unparseable sweep is a hard failure (never "no errors"). Port the `sweep()` doc-comment contract.
- **No CLI surface addition beyond the flag.** `--corpus` + `--since` on `task check` only; no new
  nouns, no new verbs, no `feature check --corpus` (Q&A).
- **No self-spawn.** The service calls check services in-process; the CLI never spawns itself.
- **Baseline format frozen.** `config/corpus-baseline.json` schema is not touched.
- **`bun run corpus-check` stays a valid gate entry** (script name unchanged; target changes), so
  `spur-check-new` and operator muscle memory keep working.

**Out of scope**

- Promoting any other spur-dev command (all correctly internal per ADR-051 inventory).
- Changing baseline contents or adding/removing baselined entries (except if the move itself makes
  a baseline entry stale — then reconcile same-commit per T10).
- Rewriting ADR-050 historical text.

**Risk**

| Risk | Mitigation |
| --- | --- |
| Baseline path resolution breaks when the CLI runs from a non-repo-root cwd | Service resolves the baseline via the runtime context / project root, not `process.cwd()` of the caller; cover with a test running from a nested cwd |
| Exit-code regression silently disables the gate | AC6 injects an unbaselined error and asserts non-zero; unparseable-sweep hard-fail test |
| `spur-check-new` breaks from the script retarget | AC5 runs the full chain before commit |
| Two implementations drift during transition | Move-then-delete in one commit; no parallel copies survive the commit |
### Plan
- [ ] **T1 — Service.** Create `packages/app/src/services/corpus-check.ts`: port sweep (in-process,
  not spawned), `key()`, baseline load + two-sided reconcile from
  `scripts/commands/corpus-check.ts`. Export from the package barrel.
- [ ] **T2 — Service tests.** `packages/app/tests/services/corpus-check.test.ts`: reconcile pass /
  new-error fail / stale-entry fail / unparseable-sweep hard-fail / nested-cwd baseline resolution.
- [ ] **T3 — CLI verb.** Add `--corpus` + `--since <ref>` to `task check` in
  `apps/cli/src/commands/task.ts` (mutual exclusion with WBS arg; fail-loud `--since` validation;
  `--json` summary; `context.setExitCode`).
- [ ] **T4 — CLI tests.** `apps/cli/tests/`: corpus exit codes, `--since` misuse, JSON shape,
  WBS+`--corpus` usage error.
- [ ] **T5 — Remove + retarget.** Delete `scripts/commands/corpus-check.{ts,test.ts}`; strip the
  case/import/header/usage from `scripts/spur-dev.ts`; retarget root `package.json` `corpus-check`
  to the CLI; grep for residual `spur-dev.ts corpus-check` references.
- [ ] **T6 — Docs same-commit (T3).** `AGENTS.md` (verification gate + misplacement note),
  `docs/04_DESIGN.md:753`, ADR-051 Detail one-liner.
- [ ] **T7 — Gates.** `bun run lint && bun run test && bun run build && bun run spur-check-new`
  (the last exercises the retargeted script end-to-end). If a baseline entry goes stale because of
  the move, reconcile `config/corpus-baseline.json` in the same commit (T10).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Decision authority:** `docs/00_ADR.md` ADR-051 (surface boundary + noun discipline + consent
  gate — consent recorded in Q&A), ADR-050 (two-sided baseline + T10), ADR-021 (apps are thin
  transports; logic in `packages/app`).
- **Current implementation:** `scripts/commands/corpus-check.ts` (`corpusCheck` at :393, `sweep()`
  self-spawn at :60, `key()` at :44, `scripts/spur-dev.ts:96-106` dispatch + :102 `--since`
  validation); `scripts/commands/corpus-check.test.ts`.
- **CLI host:** `apps/cli/src/commands/task.ts:133` (`registerTaskCommand`); full-corpus sweep mode
  at ~:963; feature sweep via the existing `feature check` service.
- **Callers/config:** root `package.json` lines 79/85/87; `config/corpus-baseline.json`;
  `docs/04_DESIGN.md:753`.
- **Docs to touch:** `AGENTS.md` (~242 misplacement note, ~284/287 verification gate),
  `docs/00_ADR.md` ADR-051 Detail.
- **Constitution:** T3 (surface + docs/04 same commit), T10 (baseline reconciliation same commit).
- **Prior naming work:** commit 86975fe7 (`bundle-plugins` rename) — the conformance precedent this
  task follows for surface changes.
### History
