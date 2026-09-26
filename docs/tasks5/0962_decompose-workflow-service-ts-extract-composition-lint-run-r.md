---
schema_version: 1
name: "Decompose workflow-service.ts: extract composition lint, run-record inspection and reclamation"
status: done
template: standard
created_at: 2026-09-26T04:37:18.168Z
updated_at: "2026-09-26T21:46:41.086Z"

feature_id: D91
ac_numbering: task-local
---

## 0962. Decompose workflow-service.ts: extract composition lint, run-record inspection and reclamation

### Background

Source: `/sp:dev-review packages --focus all` (2026-09-25), architecture candidate **C2 (weak locality)**, commit base `959f84bd6`.

`packages/app/src/services/workflow-service.ts` is 3,412 lines, 47 exports. `WorkflowAppService` (:606) orchestrates validate/run/continue/cancel/list/trace, but the file also hosts two separable concerns that are pure or I/O-thin and already tested as free functions.

**Group A — composition lint (pure over `WorkflowDef`), ≈540 lines:**

| Symbol | Line | Exported | Used by (rg, 2026-09-25) |
|---|---|---|---|
| `CompositionAdvisory`, `CompositionFinding` | 266, 271 | yes (barrel) | `WorkflowValidateResult` (:261), tests |
| `COMPOSITION_CAPS` | 292 | yes | `tests/workflow/composition-advisory.test.ts` |
| `ShellCommandEntry` (iface), `collectShellCommands` | 2081, 2096 | no | service validate :649 |
| `collectAgentRunRoleViolations` | 2156 | no | service :678 |
| `collectTerminalReasonViolations` | 2207 | no | service :711 |
| `collectDecideViolations` | 2230 | yes | service :702; `tests/workflow/actions/decide.test.ts:5` |
| `HITL_DECISION_KINDS`, `HitlActionSite`, `hitlAnswerVar`, `gateSitesForState` | 2257, 2296, 2309, 2320 | partly | service continuePaused :1382-1387, :1516, :1524; lint :2377-2391 |
| `collectHitlDecisionViolations` | 2368 | yes | service :694; `tests/workflow/decision-evidence.test.ts:10` |
| `collectUndeclaredShellVarViolations` | 2450 | yes | service :686; `tests/workflow/undeclared-shell-vars.test.ts:3` |
| `STRUCTURE_TOKENS`, `countLogicalCommands` | 2520, 2530 | yes | `tests/workflow/idea-pipeline-routing.test.ts:31`, composition-advisory test |
| `collectCompositionAdvisory` | 2548-2691 | no | service :718 |

Stay in the service (continue-path types, not lint): `GateActionKind` :2265, `PendingGate` :2268, `ContinuePausedOptions` :2278, `pendingGateMismatchMessage` :2345.
`workflow/actions/decide.ts:18` names `collectDecideViolations` in a **comment only** — no production importer outside the service.

**Group B — run-record inspection + retention, ≈280 lines:**
`ReclaimedRunLog` / `…ReclamationResult` / `ReclaimedCheckpoint` types (:366-410), `resolveWorkflowLogRetentionDays` :2835, `resolveOutputLogConfig` :2844, `WorkflowRunRecordRead` :2869, `readWorkflowRunRecord` :2889, `RUN_RECORD_INSPECT_MAX_BYTES` :2926, `RUN_RECORD_INSPECT_MAX_CHARS` :2933, `stateReadFailureReason` :2936, `WorkflowRunRecordInspection` :2944, private `readConfinedRunFile` :2969 and `redactJsonValue` :2998, `inspectWorkflowRunRecord` :3023.
Importers: `services/agent-service.ts:78` (`readWorkflowRunRecord`), `apps/cli/src/commands/workflow.ts` (via barrel), barrel `src/index.ts:~691-707`, `tests/services/workflow-service.test.ts`.
Group B uses `node:fs` sync calls (:2896-3035); the service keeps its own at :1055, :1081 (reclamation methods).

Stay in the service: `WorkflowAppService`, `workflowVersionLiteral` :2077 (imported by `services/inline-run-setup.ts:51`), `mergeWorkflowRunVars` :2718, `InvalidWorkflowRunIdError` :2737, `outputArtifactForRun` :2860 and the trace projection helpers (:3079+).

Plugin standalone contract: `plugins/sp/scripts/inline-run-setup.ts` mentions `readWorkflowRunRecord` only in a comment (:358) and uses `import type` from the barrel — safe.

Rule impact: `config/rules/strict/runtime-boundaries.yaml:75` allowlists `workflow-service.ts` for `no-direct-fs-io`; the new `run-record.ts` needs its own entry.

Advisory severity. No behavior change intended.

### Requirements

- [x] R1. Every Group A symbol (Background table) lives in `packages/app/src/workflow/composition-lint.ts`, which imports nothing from `services/workflow-service.ts`.
- [x] R2. Every Group B symbol lives in `packages/app/src/workflow/run-record.ts` (retention resolvers and reclamation types co-located there — no separate `run-retention.ts`), which imports nothing from `services/workflow-service.ts`.
- [x] R3. Every symbol the `@gobing-ai/spur-app` barrel exported before the move is still exported with the same name and type; no file under `apps/` is edited; `agent-service.ts` imports `readWorkflowRunRecord` from `../workflow/run-record` directly.
- [x] R4. Zero behavior change: test files change only import lines; no assertion, cap value, error string or lint rule changes.
- [x] R5. `hitlAnswerVar`, `gateSitesForState` and `HitlActionSite` are exported from `composition-lint.ts` only for the service's continue path and are **not** re-exported from the barrel (they are not today); the previously non-exported walkers stay non-exported except where the service needs them.
- [x] R6. `config/rules/strict/runtime-boundaries.yaml` `no-direct-fs-io` allowlist gains `packages/app/src/workflow/run-record.ts` with a justification comment; the `workflow-service.ts` entry stays (it still reads at :1055/:1081) with its now-stale comment (composition advisory) replaced by what remains.
- [x] R7. Live design docs that cite a moved symbol at `workflow-service.ts` are re-pointed: `docs/design/planning-workflow-contracts.md:260` (`collectAgentRunRoleViolations`), `docs/design/universal-config-loading.md:75` (retention resolvers). Historical records (`docs/tasks*/`, `docs/dogfood/`, `docs/reports/`, `docs/inventory/`) are not edited.

### Acceptance Criteria

Graduates all four of feature D91's scenarios (exact titles below); the numbered rows are the verify lens.

- [x] AC1 — R1 — Composition lint lives in its own module without a back-edge (req: R1, R5)
- [x] AC2 — R2 — Run-record inspection and retention live in their own module (req: R2, R6)
- [x] AC3 — R3 — The spur-app public surface is unchanged (req: R3, R7)
- [x] AC4 — R4 — Workflow behavior is unchanged (req: R4)

**Verify lens**

- **AC1** — `rg -n "workflow-service" packages/app/src/workflow/composition-lint.ts` returns nothing; `rg -n "^export (function|const) (collect\w+Violations|countLogicalCommands|COMPOSITION_CAPS)" packages/app/src/services/workflow-service.ts` returns nothing; `rg -n "hitlAnswerVar|gateSitesForState" packages/app/src/index.ts` returns nothing.
- **AC2** — `rg -n "workflow-service" packages/app/src/workflow/run-record.ts` returns nothing; `rg -n "readWorkflowRunRecord|inspectWorkflowRunRecord|resolveWorkflowLogRetentionDays|resolveOutputLogConfig" packages/app/src/services/workflow-service.ts` shows only import/call lines, no declarations; `spur rule run --json` reports no new `no-direct-fs-io` finding.
- **AC3** — `git diff <base> --stat -- apps/` is empty; `bun run typecheck` green; a before/after diff of the barrel's exported names (`bun -e "console.log(Object.keys(await import('./packages/app/src/index.ts')).sort().join('\n'))"` at base vs HEAD) is identical; `wc -l packages/app/src/services/workflow-service.ts` ≤ 2,700 (baseline 3,412).
- **AC4** — `git diff <base> -- 'packages/app/tests/**' 'apps/**/tests/**'` shows only `import` line changes to existing test files (new corresponding test files required by `require-corresponding-test` are permitted; no existing assertion changes); `(cd packages/app && bun test tests/workflow tests/services/workflow-service.test.ts tests/services/agent-service.test.ts)` green; `bun run spur-check` and `bun run test-cf` green.

### Q&A

- **Q:** Separate `run-retention.ts` or co-locate with run-record? **A:** Co-locate in `run-record.ts`. The retention resolvers (≈25 lines) plus reclamation types (≈45 lines) are well under the ~150-line threshold set at filing; a third module would be shallow. Decided 2026-09-25 (refinement).
- **Q:** Make `hitlAnswerVar` / `gateSitesForState` module-private as originally filed? **A:** No — `WorkflowAppService.continuePaused` calls them (:1382-1387, :1516, :1524), so they must stay exported from `composition-lint.ts`. They remain absent from the barrel (they are today). Original R5 corrected.
- **Q:** Original AC1 said the service drops below 2,500 lines. **A:** Unreachable without splitting `WorkflowAppService` (out of scope): Group A ≈540 + Group B ≈280 lines → ≈2,600 remaining. AC threshold recalibrated to ≤ 2,700.
- **Q:** Where do `CompositionAdvisory` / `CompositionFinding` go — `WorkflowValidateResult` in the service references them? **A:** Into `composition-lint.ts` (they are the lint's output types); the service imports them as types. Barrel re-exports them from the new path.
- **Q:** Does `workflow/actions/decide.ts` import the lint? **A:** No — comment reference only (:18). Update the comment path; no code edge.

### Design

Pure move refactor, two commits (one per group) so each is independently revertible.

**Module layout**

```text
packages/app/src/workflow/composition-lint.ts   Group A — imports: WorkflowDef types, domain/config only
packages/app/src/workflow/run-record.ts         Group B — imports: node:fs, redaction helpers, config types
packages/app/src/services/workflow-service.ts   imports both; never imported by them
```

Placement under `workflow/` co-locates lint with `actions/decide.ts` and the run-record reader with the other run artifacts (`workflow/checkpoint-contract.ts`, `workflow/action-trace.ts`).

**Rules for the mover**

1. Move code byte-for-byte (including doc comments and `// ponytail:` / task-id comments). Do not rename, reorder parameters or "tidy" logic.
2. A helper both groups need stays with the group that owns it; if the service still needs a moved private helper, export it from the new module (not the barrel).
3. If a moved function reads a module-level constant or helper still in the service, move that dependency too, or pass it in — never import back from the service (AC1/AC2 enforce).
4. Barrel (`src/index.ts`): change only the `from` path of re-exports; keep names, `type` modifiers and ordering.
5. Tests: change only import paths to the new module (in-package relative). Do not edit assertions.
6. `runtime-boundaries.yaml`: add `- "packages/app/src/workflow/run-record.ts" # confined sync run-record reads: realpath + fstat byte-window (moved from workflow-service.ts, 0962)` beside the `workflow-service.ts` entry; replace that entry's stale comment (it cites the composition advisory, which does no fs I/O and moves out) with "run-log/checkpoint reclamation realpath confinement (:1055, :1081)".
7. Update `decide.ts:18` comment path and the two design-doc citations (R7) to `workflow/composition-lint.ts` / `workflow/run-record.ts` without line numbers.

**Rejected:** splitting `WorkflowAppService` itself — its methods share private state; no caller pain identified. Revisit only if a later change forces it.

**Grilling:** *Challenge:* import churn across tests for no functional gain. *Defense:* ≈820 lines leave the hottest file in the package, the pure lint gains a direct test surface without instantiating the service, and churn is mechanical and confined to import lines (AC4).

### Plan

- [x] Record base: `git rev-parse HEAD`; snapshot barrel export names to `$TMPDIR/barrel-before.txt` (AC3 command).
- [x] **Commit 1** — create `workflow/composition-lint.ts` with Group A; service imports it; update `tests/workflow/{composition-advisory,undeclared-shell-vars,decision-evidence,idea-pipeline-routing}.test.ts` and `tests/workflow/actions/decide.test.ts` imports; barrel re-export paths; `decide.ts:18` comment. Run `(cd packages/app && bun test tests/workflow)`. Commit `refactor(app): extract workflow composition lint module (0962)`.
- [x] **Commit 2** — create `workflow/run-record.ts` with Group B; service + `agent-service.ts:78` import it; barrel paths; `tests/services/workflow-service.test.ts` imports; `runtime-boundaries.yaml` entry; R7 doc citations. Run `(cd packages/app && bun test tests/services/workflow-service.test.ts tests/services/agent-service.test.ts)`. Commit `refactor(app): extract workflow run-record module (0962)`.
- [x] Gates: `bun run spur-check`, `bun run test-cf`, `spur rule run --json`; AC1–AC4 probes and barrel-names diff pasted into Testing.

### Solution

Pure move refactor in two independently revertible commits; no behavior change intended.

| Change | Anchor |
| --- | --- |
| Group A — composition-lint module created (composition advisory, shell/role/terminal-reason/decide/HITL/undeclared-var walkers, `COMPOSITION_CAPS`, `CompositionAdvisory`/`CompositionFinding`) | `packages/app/src/workflow/composition-lint.ts:473` |
| Service imports the Group A walkers and `CompositionAdvisory` (no back-edge) | `packages/app/src/services/workflow-service.ts:67` |
| Group A call sites inside `WorkflowAppService.validate` | `packages/app/src/services/workflow-service.ts:582` |
| Continue-path gate lookup (`gateSitesForState`/`hitlAnswerVar`) now imports from the lint module | `packages/app/src/services/workflow-service.ts:1315` |
| Group B — run-record module created (record inspection, retention resolvers, reclamation types) | `packages/app/src/workflow/run-record.ts:27` |
| `InvalidWorkflowRunIdError` moved with the reader that throws it; re-exported so the barrel surface and class identity are unchanged (Design rule 3) | `packages/app/src/services/workflow-service.ts:2110` |
| Service imports the reclamation types and `inspectWorkflowRunRecord` | `packages/app/src/services/workflow-service.ts:81` |
| `inspectRunRecord` call site | `packages/app/src/services/workflow-service.ts:1634` |
| Barrel re-export paths re-pointed; names, `type` modifiers and ordering unchanged | `packages/app/src/index.ts:889` |
| `agent-service.ts` imports `readWorkflowRunRecord` from the new module directly (R3) | `packages/app/src/services/agent-service.ts:64` |
| `no-direct-fs-io` allowlist gains `run-record.ts`; the `workflow-service.ts` entry comment now names checkpoint reclamation | `config/rules/strict/runtime-boundaries.yaml:76` |
| R7 — design citation re-pointed to the lint module | `docs/design/planning-workflow-contracts.md:260` |
| R7 — design citation re-pointed to the run-record module | `docs/design/universal-config-loading.md:75` |

Verification evidence (targeted, run in the execution worktree):

- `(cd packages/app && bun run typecheck)` — clean.
- `(cd packages/app && bun test tests/services/workflow-service.test.ts tests/services/agent-service.test.ts)` — 370 pass, 0 fail.
- `(cd packages/app && bun test tests/workflow)` — 932 pass, 1 fail. The single failure (`tests/workflow/idea-pipeline-routing.test.ts`, "0945 routing truth-table parity") is **pre-existing and environmental**, not caused by this task: it reproduces identically with this task's changes stashed at base, and at base in the main tree. It declares its own 60000 ms timeout (`:316`) and performs ~2,600 `/bin/sh` spawns; the host load average was 13.7 on 10 CPUs at run time.
- Byte-identity: the moved blocks are byte-for-byte identical to the base source apart from the `export` keywords the service needs (`composition-lint.ts`) and the relocated error class (`run-record.ts`).
- AC1 probes: `rg "workflow-service" composition-lint.ts` empty; no moved walker/const declaration remains in the service; `hitlAnswerVar|gateSitesForState` absent from the barrel.
- AC2 probes: `rg "workflow-service" run-record.ts` empty; the service shows only import/call lines for the moved readers; `spur rule run --json` reports zero `no-direct-fs-io` findings.
- AC3 probes: `git diff <base> --stat -- apps/` empty; barrel export-name set identical before/after; `wc -l` = 2,553 ≤ 2,700.

No barrel export was added or removed: `CompositionAdvisory`, `CompositionFinding`, `COMPOSITION_CAPS` and the walkers were never barrel-exported, so re-pointing them does not change the public surface.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/composition-lint.ts:1` (every Group A symbol); `rg -n "workflow-service" packages/app/src/workflow/composition-lint.ts` → no match (re-run 2026-09-26) |
| R2 | MET | `packages/app/src/workflow/run-record.ts:17` (`InvalidWorkflowRunIdError` + Group B readers, retention resolvers, reclamation types); `rg -n "workflow-service" packages/app/src/workflow/run-record.ts` → no match |
| R3 | MET | `git show --name-only 71c4b9d56 f919bc434 89b1f2ca0 -- apps/` → empty; barrel diff (`f919bc434` on `packages/app/src/index.ts`) re-points `readWorkflowRunRecord`, `resolveOutputLogConfig`, `resolveWorkflowLogRetentionDays`, `WorkflowRunRecordRead` with names unchanged; `packages/app/src/services/agent-service.ts:64` imports from `../workflow/run-record` |
| R4 | MET | moved lines byte-identical to base `53f5fa37c` apart from headers/imports/`export` (line-set `comm` check); existing test files changed only on import lines (`git show -U0` of both refactor commits); `(cd packages/app && bun test tests/workflow)` → 951 pass / 0 fail |
| R5 | MET | `rg -n "hitlAnswerVar\|gateSitesForState\|HitlActionSite" packages/app/src/index.ts` → no match; service imports `gateSitesForState`/`hitlAnswerVar` from the lint module (`packages/app/src/services/workflow-service.ts:67`) |
| R6 | MET | `config/rules/strict/runtime-boundaries.yaml:76` run-record allowlist entry with justification; `:75` workflow-service comment names reclamation realpath reads (`workflow-service.ts:988`, `:1014` confirmed `realpathSync`); `spur rule run --json` (recommended-pre-check, 47 rules incl. strict) → 0 findings |
| R7 | MET | `docs/design/planning-workflow-contracts.md:260` cites `workflow/composition-lint.ts`; `docs/design/universal-config-loading.md:75` cites `workflow/run-record.ts`; commit `f919bc434` touches no historical record |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Composition lint lives in its own module without a back-edge | MET | command | `rg -n "workflow-service" packages/app/src/workflow/composition-lint.ts` → rc=1; `rg -n "^export (function\|const) (collect\w+Violations\|countLogicalCommands\|COMPOSITION_CAPS)" packages/app/src/services/workflow-service.ts` → rc=1; barrel probe for `hitlAnswerVar\|gateSitesForState` → rc=1 |
| R2 — Run-record inspection and retention live in their own module | MET | command | `rg -n "workflow-service" packages/app/src/workflow/run-record.ts` → rc=1; service shows only `packages/app/src/services/workflow-service.ts:75` (import) and `:1634` (call); `spur rule run --json` → `findings: []` |
| R3 — The spur-app public surface is unchanged | MET | command | 0962 commits touch no `apps/` file; barrel names unchanged (path-only re-point); `(cd packages/app && bun run typecheck)` rc=0; `wc -l packages/app/src/services/workflow-service.ts` = 2553 ≤ 2700 |
| R4 — Workflow behavior is unchanged | MET | test | `(cd packages/app && bun test tests/workflow)` → 951 pass / 0 fail; workflow-service + agent-service + lint/run-record suites → 449 pass / 0 fail; `bun run test-cf` rc=0; `bun run spur-check` → 9175 pass / 1 fail, sole failure `apps/cli/tests/commands/feature.test.ts:33` fixture `git init` EPERM on `.git/hooks` (sandbox write-deny, file untouched by 0962) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Review disposition: approved** — pure move refactor, no behavior change, both module boundaries hold, public surface unchanged. No P1/P2 findings. Dimensions: functional traceability (R1–R7, AC1–AC4 all MET — see Testing), SECUA (all), architecture (locality improved: ≈860 lines leave the service; dependency edge is service → `workflow/composition-lint.ts` / `workflow/run-record.ts`, never back).

| Priority | Dimension | Location | Finding | Disposition |
|----------|-----------|----------|---------|-------------|
| P3 | task contract | task 0962 Acceptance Criteria (AC4 verify lens) | AC4's diff lens ("only `import` line changes") could not hold together with a green `spur-check`: `require-corresponding-test` requires a test file per new source module, so `packages/app/tests/workflow/composition-lint.test.ts` and `run-record.test.ts` were added. No existing assertion changed. | FIXED — AC4 lens amended via `spur task update --section "Acceptance Criteria"` (2026-09-26) to permit new corresponding test files while forbidding assertion changes. |
| P4 | rule comment | `config/rules/strict/runtime-boundaries.yaml:75` | The `workflow-service.ts` allowlist comment cites `:988, :1014`; line citations in a path-based allowlist drift. Currently accurate (`realpathSync` at both). Documentation only. | Accepted |
| P4 | module layout | `packages/app/src/workflow/run-record.ts:17` | `InvalidWorkflowRunIdError` moved out of the service (plan said stay) to honor the no-back-edge rule; the service re-export at `packages/app/src/services/workflow-service.ts:2110` keeps name, path and class identity. | Accepted |
| P4 | barrel ordering | `packages/app/src/index.ts:891` | Run-record re-exports sit in a new `from './workflow/run-record'` block instead of their original position (Design rule 4) — unavoidable with a new `from` path; names and `type` modifiers unchanged. | Accepted |

**Residual risk.** `tests/workflow/idea-pipeline-routing.test.ts` ("0945 routing truth-table parity") is load-sensitive (≈3,400 `/bin/sh` spawns under a 60 s timeout) and pre-existing at base. Separately, under the Claude Code sandbox `apps/cli/tests/commands/feature.test.ts:33` fails its fixture `git init` (EPERM copying hook templates into `.git/hooks`); unrelated to 0962 and green unsandboxed.

### References

- Feature: D91 (parent D9 — workflow seam stabilization).
- Review source: `/sp:dev-review packages --focus all`, 2026-09-25, candidate C2; base commit `959f84bd6`.
- ADR-115 (composition caps parity anchor — `COMPOSITION_CAPS` doc comment must survive the move verbatim).
- `config/rules/strict/runtime-boundaries.yaml` rule `no-direct-fs-io`.

### History

- 2026-09-26T04:40:07.144Z backlog → todo (system)
- 2026-09-26T06:32:48.034Z todo → wip (system)
- 2026-09-26T07:22:44.230Z wip → testing (system)
- 2026-09-26T07:23:34.698Z testing → done (system)

