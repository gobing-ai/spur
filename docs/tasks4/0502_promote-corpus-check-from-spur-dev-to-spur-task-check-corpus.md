---
template: standard
schema_version: 1
name: "Promote corpus-check from spur-dev to spur task check --corpus (ADR-051 misplacement fix)"
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
created_at: "2026-08-10T21:12:13.589Z"
updated_at: "2026-08-18T04:42:48.676Z"
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

**Frozen names (implement exactly — do not rename, do not invent alternatives).**

| Kind | Name |
| --- | --- |
| Service file | `packages/app/src/services/corpus-check.ts` |
| Service export | `runCorpusCheck(cwd: string, since?: string): Promise<CorpusCheckResult>` (async, in-process) |
| Result type | `CorpusCheckResult = { observed: number; baselined: number; newErrors: CorpusError[]; staleEntries: BaselineEntry[]; ok: boolean }` |
| Helper export | `key(e: { kind; id; code }): string` — ported verbatim from `scripts/commands/corpus-check.ts:46` |
| Barrel export | `export { runCorpusCheck } from './services/corpus-check';` + `export type { CorpusCheckResult }` in `packages/app/src/index.ts` |
| CLI flags | `--corpus` (boolean), `--since <ref>` (string) on the existing `task check` verb — no other surface additions |
| JSON output keys | exactly `{ observed, baselined, newErrors, staleEntries, ok }` (same shape as the result type) |
| Sweep seam | in-process calls into the existing `task-check.ts` / `feature-check.ts` services (`packages/app/src/services/`) — the same services the `task check` / `feature check` verbs use |
| package.json script | `"corpus-check": "bun run apps/cli/src/index.ts task check --corpus"` |

**Anti-patterns (what NOT to implement).**

- No `spur corpus` noun (or any new first-layer noun) — ADR-051 noun discipline; AC2 greps for it.
- No spur-dev `corpus-check` delegate/wrapper "for compatibility" — move-and-delete in one commit;
  two surfaces for one gate is the defect being fixed.
- No CLI self-spawn — the service must not shell out to `bun run apps/cli/src/index.ts` (the current
  `sweep()` at `scripts/commands/corpus-check.ts:57` does exactly this; do not port that pattern).
- No baseline schema changes — `config/corpus-baseline.json` format is frozen.
- `--corpus` must not accept a WBS argument — usage error, not silent ignore.
- Do not rewrite ADR-050 historical text — only ADR-051 Detail gets a one-line completion note.

**Surfaces to change**

| Surface | Change |
| --- | --- |
| `packages/app/src/services/corpus-check.ts` (new) | `runCorpusCheck`: run full task + feature check sweeps in-process via `task-check.ts` / `feature-check.ts`, collect `{kind,id,code,message}` errors, reconcile against `config/corpus-baseline.json` (two-sided), return `CorpusCheckResult`. Baseline path resolves via runtime context / project root — never bare `process.cwd()` of the caller. |
| `packages/app/tests/services/corpus-check.test.ts` (new) | Port/extend `scripts/commands/corpus-check.test.ts`: reconcile pass, new-error fail, stale-entry fail, unparseable-sweep hard-fail, nested-cwd baseline resolution. In-memory fixtures, no repo sweep. |
| `packages/app/src/index.ts` | Barrel exports (see Frozen names). |
| `apps/cli/src/commands/task.ts` (`registerTaskCommand` at :132; check verb, full-corpus sweep at :963) | Add `--corpus` + `--since <ref>` to `task check`. `--corpus` requires NO WBS argument (usage error otherwise); `--since` missing/flag-like value → non-zero exit naming `--since`. Human output mirrors today's summary lines; `--json` emits `CorpusCheckResult`. Exit via `context.setExitCode`. |
| `apps/cli/tests/` (task check corpus cases) | CLI coverage: exit 0 on clean fixture corpus; non-zero on injected unbaselined error; `--since` misuse; `--json` parses; WBS+`--corpus` usage error. |
| `scripts/spur-dev.ts` | Remove `corpus-check`: case (:96–~:105), import (:30), header line (:21), usage string (:39). |
| `scripts/commands/corpus-check.ts` + `corpus-check.test.ts` | Delete (superseded by the packages/app service + tests). |
| `package.json` (:87) | Retarget `corpus-check` script (Frozen names). `spur-check-new` (:79) and `spur-check-new:full` (:85) unchanged. |
| `AGENTS.md` | Verification-gate bullets (:284, :287) reference the CLI verb; misplacement note (:242) becomes "promoted — ADR-051 + task 0502". |
| `docs/04_DESIGN.md:753` | Corpus-baseline comment names `spur task check --corpus` instead of the spur-dev script. |
| `docs/00_ADR.md` ADR-051 Detail | One-line completion note. |

**Invariants**

- **Two-sided baseline semantics unchanged** — new error fails; stale baseline entry fails;
  unparseable sweep is a hard failure (never "no errors"). Port the `sweep()` doc-comment contract.
- **No CLI surface addition beyond the flag.** `--corpus` + `--since` on `task check` only; no new
  nouns, no new verbs, no `feature check --corpus` (Q&A).
- **Baseline format frozen.** `config/corpus-baseline.json` schema is not touched.
- **`bun run corpus-check` stays a valid gate entry** (script name unchanged; target changes), so
  `spur-check-new` and operator muscle memory keep working.

**Out of scope**

- Promoting any other spur-dev command (all correctly internal per ADR-051 inventory).
- Changing baseline contents (except if the move itself makes a baseline entry stale — reconcile
  same-commit per T10).
- Rewriting ADR-050 historical text.

**Risk**

| Risk | Mitigation |
| --- | --- |
| Baseline path resolution breaks when the CLI runs from a non-repo-root cwd | Baseline resolves via runtime context / project root; covered by the nested-cwd test (T2) |
| Exit-code regression silently disables the gate | AC6 injects an unbaselined error and asserts non-zero; unparseable-sweep hard-fail test |
| `spur-check-new` breaks from the script retarget | AC5 runs the full chain before commit (T7) |
| Two implementations drift during transition | Move-then-delete in one commit; no parallel copies survive |
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
- `packages/app/src/services/corpus-check.ts` moves the structural task/feature sweep, duplicate-ID and fog checks, project-root baseline resolution, and two-sided reconciliation into the application layer; task/feature validators run in-process (no CLI self-spawn) and return the frozen `CorpusCheckResult` JSON shape.
- The port is rule-gate compliant: `node:fs` direct IO replaced by the ts-runtime `FileSystem` seam, the `Bun.spawnSync` git helper by `ProcessExecutor.run` (sync tree readers converted to async), hardcoded planning folders derived from `resolvePlanningFolders`, and the `console.log` report default dropped. Fog readers/git range resolution are async throughout.
- `apps/cli/src/commands/task.ts:921` adds `--corpus` and `--since <ref>` to `task check`, enforces WBS+`--corpus` usage errors (exit 2), rejects missing/flag-like `--since` values (R3 fail-loud), restores the spur-dev-era visible fog SKIPPED diagnostic on stderr for unresolvable refs (P3), and maps new/stale findings to exit 1.
- `packages/app/src/index.ts` barrels `runCorpusCheck`, `resolveFogRange`, and `CorpusCheckResult`.
- `packages/app/tests/services/corpus-check.test.ts` covers baseline reconciliation, new and stale failures, unparseable in-process sweeps, nested-cwd root resolution, and the moved fog decision table; `apps/cli/tests/commands/task.test.ts:537` covers JSON keys, exit codes, `--since` misuse (missing value, flag-like value, ref), and WBS+`--corpus`.
- `scripts/spur-dev.ts` drops the misplaced command (case/import/header/usage); `scripts/commands/corpus-check.{ts,test.ts}` are deleted; `package.json:87` retargets `bun run corpus-check` to `spur task check --corpus`, so `spur-check-new` exercises the promoted gate unchanged.
- `docs/00_ADR.md` (ADR-051 Detail), `docs/04_DESIGN.md:753`, and `AGENTS.md` (verification gate + misplacement note) record the promotion same-commit (T3); ADR-050 historical text untouched.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `spur task check --corpus` (no WBS) sweeps the active task corpus + every feature and reconciles against the two-sided baseline; real run: 2 observed / 2 baselined / 0 new / 0 stale, exit 0 (final spur-check-new 2026-08-10). Sweep scope matches the `task check` no-WBS verb per the Design's frozen gate semantics (P1 disposition in ## Review). |
| R2 | MET | `packages/app/src/services/corpus-check.ts` owns the in-process sweep + two-sided reconciliation via `task-check.ts`/`feature-check.ts`; `apps/cli/src/commands/task.ts:920-965` is a thin flag/output adapter; the deleted `sweep()` self-spawn is not ported. |
| R3 | MET | Missing `--since` value → commander usage error (non-zero, names `--since`); flag-like value → exit 2 + usage message (`apps/cli/src/commands/task.ts:940-944`); unresolvable ref → visible SKIPPED diagnostic on stderr, exit 0 (spur-dev parity; CLI tests `apps/cli/tests/commands/task.test.ts:537-592` cover all three). |
| R4 | MET | JSON output exactly `{ observed, baselined, newErrors, staleEntries, ok }`; asserted in `apps/cli/tests/commands/task.test.ts`; parsed on the real repo: `{observed:2, baselined:2, newErrors:[], staleEntries:[], ok:true}`. |
| R5 | MET | `package.json:87` `corpus-check` → `spur task check --corpus`; `spur-check-new`/`spur-check-new:full` chain it unchanged (final run green); `scripts/spur-dev.ts` has no corpus-check case/import/usage; `scripts/commands/corpus-check.{ts,test.ts}` deleted. |
| R6 | MET | New-error fail, stale-entry fail, unparseable-sweep hard fail all covered (`packages/app/tests/services/corpus-check.test.ts` — 29/29 green (re-audit 2026-08-10)); real corpus exit 0 with only baselined findings. |
| R7 | MET | `AGENTS.md` (verification gate + misplacement note), `docs/04_DESIGN.md:753`, ADR-051 Detail synced same-commit; ADR-050 historical text untouched. |
| R8 | MET | `bun run lint`, `bun run test`, `bun run build`, `bun run spur-check-new` all exit 0 (2026-08-10; spur-check-new final run green after the operator's concurrent `spur history import` DB locks cleared). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P1 | Correctness / functional | `packages/app/src/services/corpus-check.ts:116-163` | `structuralSweep()` validates only the active task folder, not every configured folder. **Disposition: out of scope — gate semantics are Design-frozen.** The task's Design invariants ("no behavior change to the gate itself", "Baseline file unchanged") fix the sweep to the `task check` no-WBS corpus (active folder + features), matching the superseded spur-dev gate exactly. Broadening to all configured folders surfaces 404 legacy ratchet-drift errors (docs/tasks 294, docs/tasks2 108, docs/tasks3 2 — measured 2026-08-10) and would force a massive `config/corpus-baseline.json` reconciliation (T10). Tracked as follow-up work, not this promotion. |
| P3 | Correctness / usability | `apps/cli/src/commands/task.ts:944-959`; `packages/app/src/services/corpus-check.ts:305-330` | Unresolved explicit `--since` refs silently skipped the fog check with no visible diagnostic (the port dropped the spur-dev-era console report). **Fixed:** the CLI now emits the SKIPPED reason on stderr (human and JSON modes, exit 0 — original semantics) and rejects missing/flag-like values with a usage error (exit 2). |
| P3 | Architecture / scope | `packages/app/src/services/history-service.ts:41,185-192`; `.spur/config.yaml:32,84-88` | Unrelated concurrent changes (OpenCode history-import feature and executor config) share the working tree. **Disposition:** neither is 0502 work; both excluded from 0502's commit via selective staging; the diff is otherwise task-scoped. |

**Functional traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `spur task check --corpus` sweeps the task corpus (active folder — the `task check` no-WBS scope the Design freezes) plus every feature, reconciled against the two-sided baseline. Real repo: 2 observed / 2 baselined / 0 new / 0 stale, exit 0. P1 disposition above. |
| R2 | MET | `packages/app/src/services/corpus-check.ts` owns the in-process sweep + reconciliation; `apps/cli/src/commands/task.ts:920-965` is a thin flag/output adapter; no self-spawn (the deleted `sweep()` pattern is not ported). |
| R3 | MET | Missing `--since` value → commander usage error (non-zero, names `--since`); flag-like value (`--since --json`) → exit 2 with usage message; unresolvable ref → visible SKIPPED diagnostic on stderr, exit 0 (spur-dev parity). CLI tests cover all three. |
| R4 | MET | JSON output is exactly `{ observed, baselined, newErrors, staleEntries, ok }` (asserted in `apps/cli/tests/commands/task.test.ts`); parses cleanly on the real repo with exit 0. |
| R5 | MET | `package.json:87` retargets `bun run corpus-check` to the CLI verb; `spur-check-new`/`spur-check-new:full` chain it unchanged; `scripts/spur-dev.ts` has no corpus-check case/import/usage; `scripts/commands/corpus-check.{ts,test.ts}` deleted. |
| R6 | MET | Two-sided semantics ported verbatim: new-error fails, stale-entry fails, unparseable sweep is a hard failure; service tests cover all four cases; real repo exit 0. |
| R7 | MET | `AGENTS.md` (verification gate + misplacement note), `docs/04_DESIGN.md:753`, ADR-051 Detail synced same-commit; ADR-050 historical text not rewritten. |
| R8 | MET | `bun run lint`, `bun run test`, `bun run build`, `bun run spur-check-new` each exit 0 (spur-check-new's rule-gate intermittently collided with the operator's concurrent `spur history import` DB lock and was re-run to green after it finished). |

**Architecture depth**

The app service presents a narrow `runCorpusCheck()` entry over cohesive sweep/reconciliation logic; the CLI boundary stays thin. The P1 is a deliberate scope boundary (see disposition), not a missing abstraction.

Functional Verdict: PASS
### References
- **Decision authority:** `docs/00_ADR.md` ADR-051 (surface boundary + noun discipline + consent
  gate — consent recorded in Q&A), ADR-050 (two-sided baseline + T10), ADR-021 (apps are thin
  transports; logic in `packages/app`).
- **Current implementation (verified 2026-08-10):** `scripts/commands/corpus-check.ts`
  (`corpusCheck` :393, `key()` :46, `sweep()` self-spawn :57); `scripts/spur-dev.ts` (case :96,
  `--since` validation :102, import :30, header :21, usage :39);
  `scripts/commands/corpus-check.test.ts`.
- **CLI host:** `apps/cli/src/commands/task.ts` (`registerTaskCommand` :132; full-corpus sweep
  mode :963). In-process sweep seam: `packages/app/src/services/task-check.ts` +
  `feature-check.ts`; barrel `packages/app/src/index.ts`.
- **Callers/config:** root `package.json` :79/:85/:87; `config/corpus-baseline.json`;
  `docs/04_DESIGN.md:753`.
- **Docs to touch:** `AGENTS.md` (:242 misplacement note, :284/:287 verification gate),
  `docs/00_ADR.md` ADR-051 Detail.
- **Constitution:** T3 (surface + docs/04 same commit), T10 (baseline reconciliation same commit).
- **Prior naming work:** commit 86975fe7 (`bundle-plugins` rename) — the conformance precedent.
### History
- 2026-08-10T22:33:17.612Z backlog → wip (system)
- 2026-08-10T23:30:37.549Z wip → testing (system)
- 2026-08-10T23:30:43.279Z testing → done (system)
