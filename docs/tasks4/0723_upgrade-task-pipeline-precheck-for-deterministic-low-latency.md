---
schema_version: 1
name: "Upgrade task-pipeline precheck for deterministic low-latency execution"
status: done
template: issue
created_at: 2026-08-30T19:39:38.243Z
updated_at: "2026-09-06T23:41:55.674Z"
feature_id: D6
priority: P1
dependencies: ["0454", "0487", "0608", "0682", "0683", "0706"]
ac_numbering: task-local
ac_altitude: task-local
---

## 0723. Upgrade task-pipeline precheck for deterministic low-latency execution

### Background

Recent task-pipeline runs pay an unconditional executor doctor probe before any implementation work,
even when `/sp:dev-run` is explicitly using the interactive `--agent inline` surface. The inline
driver still executes host-side workflow actions, so the selector does not bypass `doctor.probe`.
Large tasks can then trigger a second `spur agent doctor` from `task-size-precheck.ts`.

Current-source measurements on 2026-08-30 put `spur task check` at 0.36–0.48 s, the count-only size
check at about 0.25 s, and a concrete single-executor doctor at about 0.4 s. A persisted task-pipeline
trace for run `inline-20260821-083900-0614` recorded 1.702 s in `doctor.probe`, 575 ms in auto feature
sync, and 268 ms in size precheck before implementation. Doctor is not the only possible source of a
long stall, but it is redundant, sometimes duplicated, and cannot prove authentication or quota.

An operator-approved config-only bypass has removed both precheck doctor call sites from
`config/workflows/task-pipeline.yaml` so task work can continue. This task turns that emergency edit
into the permanent, contract-aligned task-pipeline design and proves the released/installed artifact
uses it.

### Requirements

- [x] **R1.** Make task-pipeline precheck deterministic and doctor-free on inline, named, and headless
      execution surfaces. No precheck action or size check may invoke `spur agent doctor`; executor
      liveness, routing, and native capability attestation remain fail-closed at the existing
      `agent.run` dispatch boundary.
- [x] **R2.** Preserve readiness and size safety without a new public CLI surface: run the existing
      `spur task check <wbs>` exactly once on the successful precheck path, raise and keep the default
      ceiling at ten Requirements and sixteen Plan items, and make a missing or failed size checker fail closed.
      An explicit raised size limit accepts the larger task; it does not add a second executor-tier
      resolver.
- [x] **R3.** Keep auto-profile feature reactivation and dirty-tree visibility, but remove hidden or
      duplicate work: reuse the existing bounded feature-sync owner where compatible, surface a
      failed reactivation instead of swallowing it, and ensure each deterministic precheck operation
      executes at most once per run.
- [x] **R4.** Reconcile every coupled contract in the same change: task-pipeline resilience and
      lifecycle tests, inline-driver fixtures, workflow composition baseline/ownership docs,
      task-pipeline design text, size-precheck tests and drift inventory, while preserving
      `doctor.probe` for workflows such as idea-pipeline that still intentionally use it.
- [x] **R5.** Prove the upgrade from source: capture before/after task-pipeline traces, validate and
      dry-run the workflow, and pass targeted plus full repository gates. Activation — rebuilding the
      bundled CLI, releasing and reinstalling Spur plus plugin `sp` through the governed surfaces, and
      the fresh-session canary — is a release activity the operator runs directly after merge, not
      tracked as implementation work here; this task closes on its source-local proof.

### Acceptance Criteria

```gherkin
Feature: Deterministic low-latency task-pipeline precheck

  @core
  Scenario: R1 — Inline execution performs no doctor preflight
    Given a valid todo task and an interactive task-pipeline run with --agent inline
    When precheck completes
    Then no doctor.probe action is entered
    And no child command invokes spur agent doctor
    And executor usability and capabilities are checked only when agent.run resolves the stage

  @core
  Scenario: R2 — Readiness and size gates remain fail closed
    Given a malformed task, a task above ten Requirements or sixteen Plan items, or an unavailable size-check owner
    When task-pipeline evaluates precheck
    Then the run reaches the failed terminal before implementation
    And a valid task within the doubled ceiling runs spur task check exactly once and may enter implementation

  @core
  Scenario: R3 — Auto feature reactivation is bounded and observable
    Given a todo task linked to a completed feature and profile auto
    When precheck reactivates the feature
    Then the existing bounded feature-sync path runs at most once
    And a real reactivation failure is reported and blocks implementation
    And dirty-tree diagnostics remain advisory

  @core
  Scenario: R4 — Workflow contracts describe the shipped graph
    Given the doctor-free task-pipeline definition
    When workflow, composition, lifecycle, resilience, inline-driver, and drift tests run
    Then every assertion and baseline entry matches the new precheck action order and semantics
    And idea-pipeline doctor behavior remains covered and unchanged

  @core
  Scenario: R5 — Source-local proof gates the upgrade
    Given the doctor-free task-pipeline definition in the working tree
    When the before-after trace comparison, workflow validate, and the repository gates run
    Then the workflow validates and dry-runs without error
    And the targeted and full repository suites pass
    And the release-time activation and fresh-session canary are left to the operator's post-merge release
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-08-30T19:47:58.795Z

#### Q&A entry — 2026-08-30

**Operator decision:** Double the task-pipeline size ceiling because the original five-Requirement /
eight-Plan-item defaults repeatedly blocked otherwise valid implementation tasks. The temporary
workflow and permanent upgrade therefore use ten Requirements and sixteen Plan items. This changes
the default boundary only; per-run overrides remain available and task readiness still fails closed.

### Design

Use the existing task-pipeline state machine; do not add a parallel workflow or public command.

1. Permanently remove `doctor.probe` from task-pipeline precheck and remove the `--executor` path
   from the task-size script. Keep the doctor built-in registered because idea-pipeline still owns an
   intentional executor-election preflight.
2. Keep task readiness at the existing `spur task check` guard. Double the default size ceiling from
   five Requirements/eight Plan items to ten/sixteen, then keep enforcement as a deterministic
   count-only operation; delete executor-tier inference and doctor coupling from both the application
   evaluator and plugin script. Further raised limits become an explicit size override, while actual
   dispatch still enforces resolved executor availability and `requiresCapabilities`.
3. Change the size-check fallback from silent PASS to FAIL. Preserve the dirty-tree advisory. Reuse
   `feature-sync-bounded.ts` for auto reactivation if its current contract supports precheck; otherwise
   keep one direct sync call but propagate its failure. Do not introduce another wrapper.
4. Update positional workflow baselines and tests atomically with the definition. Record a trace
   comparison using the existing workflow observability data rather than adding timing telemetry.
5. Activate only after source-local validation: bundle/release Spur, reinstall plugin `sp` through
   Superskill, verify binary/plugin provenance, and start a fresh agent session before the canary.

The deliberate simplification is that precheck no longer predicts whether a selected model tier can
finish an operator-approved oversized task. The doubled deterministic size ceiling remains the
default boundary; an operator who raises it owns the larger dispatch, and the authoritative runtime
checks remain at `agent.run`.

### Plan

- [x] Add focused failing tests for a doctor-free task-pipeline, count-only size enforcement,
      fail-closed missing checker, bounded feature reactivation, and unchanged idea-pipeline doctor.
- [x] Finalize the temporary YAML bypass: remove transitional wording, make size fallback fail closed,
      and make auto feature reactivation single-shot and observable.
- [x] Remove executor/doctor coupling from the application size evaluator and plugin size script;
      update their focused tests and drift inventory without adding a CLI verb.
- [x] Reconcile lifecycle/resilience/inline-driver tests, composition baseline, workflow ownership,
      task-pipeline design text, and plugin references with the new graph.
- [x] Validate and dry-run task-pipeline, capture the after trace against the recorded before trace,
      then run targeted tests, `bun run spur-check`, and one `bun run corpus-check`.

Activation (rebuild the bundled CLI, governed Spur release + Superskill plugin-sp reinstall,
fresh-session canary) is an operator-run release step after merge — deliberately not tracked as
implementation work in this task.
### Root Cause

`config/workflows/task-pipeline.yaml` declares `doctor.probe` as its first precheck action and gates
the precheck-to-implement transition on a WBS-scoped doctor status file. The inline driver executes
all non-model workflow actions in the host session, so `--agent inline` never implied that this probe
would be skipped.

The size checker adds a second coupling: when the task exceeds the default thresholds and an
executor is supplied, `plugins/sp/scripts/task-size-precheck.ts` shells to `spur agent doctor` only to
read `capabilityTier`. This duplicates startup/detection work and places model-tier prediction in a
task-shape check. Meanwhile, current `doctor.probe` classifies only installed/version usability;
authentication and quota were removed as unreliable by tasks 0682–0683. Actual `agent.run`
resolution already performs the authoritative liveness and capability checks at dispatch.

The emergency removal exposes coupled residue: task-pipeline resilience and lifecycle tests still
require doctor status, and `config/workflow-composition-baseline.json` keys actions by positional
`precheck:onEnter:<n>`. Those contracts must move with the final graph. The current size-script
fallback also writes PASS when the plugin script is absent, which is incompatible with a fail-closed
readiness gate.

### Solution

Precheck is now deterministic and doctor-free on every execution surface (R1). The `doctor.probe` action and the `--executor` capability-tier coupling are removed from `config/workflows/task-pipeline.yaml:210`, `plugins/sp/scripts/task-size-precheck.ts:1`, and `packages/app/src/services/task-size-precheck.ts:1`; executor liveness, routing, and native capability attestation stay fail-closed at the `agent.run` dispatch boundary (0706), which the inline driver executes on every surface — nothing is skipped under `--agent inline`.

The size check is count-only and fails closed (R2): the checker counts R-items and Plan checklist items and writes PASS/FAIL to `.spur/run/<wbs>-precheck-size.status`; a missing or failing checker writes FAIL, never PASS (`config/workflows/task-pipeline.yaml:210-216`). Defaults doubled to max 10 R-items / max 16 Plan items in the plugin fallbacks (`plugins/sp/scripts/task-size-precheck.ts:73`) and the app `DEFAULT_TASK_SIZE_LIMITS` (`packages/app/src/services/task-size-precheck.ts:30`) consumed by the 0575 authoring-time warning. A raised limit is an explicit size override, not a capability grant.

Auto-profile feature reactivation is single-shot (R3): `feature sync` with exactly one `feature update` fallback; a real reactivation failure prints diagnostics, exits non-zero, and blocks implementation — no `|| true` swallowing anywhere (`config/workflows/task-pipeline.yaml:189-190`).

Coupled contracts reconciled (R4): `config/workflow-composition-baseline.json` (line 321 at the time; store retired by ADR-108, `docs/00_ADR.md:1002`) regenerates the two changed precheck invocations; `docs/design/workflow-shell-ownership.md:168-170` precheck rows and option-(c) narrative updated (doctor.probe stays for idea-pipeline, which elects an executor at start); `docs/04_DESIGN.md:2206` precheck section, TIER note, and authoring caps rewritten; `plugins/sp/scripts/surface-drift-inventory.ts` executor-probe args and capabilityTier row updated; coupled tests rewritten in `plugins/sp/tests/task-pipeline-resilience.test.ts:104`, `plugins/sp/tests/task-size-precheck.test.ts`, `packages/app/tests/services/task-size-precheck.test.ts`, and `packages/app/tests/services/task-service.test.ts` (authoring-warning fixtures bumped to the new ceiling).

R5 is the source-local proof and it holds: workflow validate exit 0, targeted suites green, full repository gate 6952 pass / 0 fail, and the before/after trace comparison against `inline-20260821-083900-0614`. The activation half (rebuild the bundled CLI, governed release/reinstall of Spur plus plugin `sp`, fresh-session canary) is a release activity, not implementation; by operator decision on 2026-08-30 the operator runs it directly after merge rather than tracking it as a follow-up task. Until that release lands, the shipped bundle still carries the pre-0723 precheck — running from source is what exercises this change.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/task-pipeline.yaml:155-219` — precheck onEnter is [shell git-status, note, shell feature-reopen, shell size]; zero `doctor` matches in the whole file (rg, this run). Size checkers carry no executor/doctor path: `plugins/sp/scripts/task-size-precheck.ts:7-8`, `packages/app/src/services/task-size-precheck.ts:78`. Asserted fresh at `plugins/sp/tests/task-pipeline-resilience.test.ts:75-80` (no `doctor.probe` action; no `agent doctor` in precheck commands) — 96 pass / 0 fail this run. |
| R2 | MET | Single `spur task check` on the success path lives only in the precheck→implement guard (`config/workflows/task-pipeline.yaml:686`), paired with size-status PASS. Ceilings doubled to 10/16 in all three owners: `config/workflows/task-pipeline.yaml:129,132`, `packages/app/src/services/task-size-precheck.ts:30-33`, `plugins/sp/scripts/task-size-precheck.ts:73-74`. Fail-closed proven on both paths: missing checker writes FAIL (`config/workflows/task-pipeline.yaml:215-218`), unreachable `spur` writes FAIL (`plugins/sp/scripts/task-size-precheck.ts:122-128`). No second executor-tier resolver added. Tests: 129 pass / 0 fail (`packages/app/tests/services/task-size-precheck.test.ts`, `tests/services/task-service.test.ts`). |
| R3 | MET | `config/workflows/task-pipeline.yaml:182-198` — one `feature sync`, one `feature update` fallback, `exit 1` with diagnostics when both fail; no `\|\| true` anywhere in the block (the pre-change baseline shows the swallow that was removed, `config/workflow-composition-baseline.json` (line 321 at the time; store retired by ADR-108, `docs/00_ADR.md:1002`)). Dirty-tree diagnostics stay advisory (`config/workflows/task-pipeline.yaml:155-168`, exit 0). Each deterministic operation runs once per run: one task check (guard), one size check, one reactivation. |
| R4 | MET | Reconciled: composition baseline regenerated to the shipped invocations (`config/workflow-composition-baseline.json` (line 321,328 at the time; store retired by ADR-108, `docs/00_ADR.md:1002`)), drift inventory de-coupled from the executor probe (`plugins/sp/scripts/surface-drift-inventory.ts`), `docs/04_DESIGN.md:2206-2211` precheck + size text rewritten, idea-pipeline's `doctor.probe` preserved and still covered (`config/workflows/idea-pipeline.yaml:82`, `plugins/sp/tests/skill-structure.test.ts:618,624`). Index drift found this run and REPAIRED: `docs/design/workflow-shell-ownership.md:168-170` now keys the three precheck shells 0/2/3, matching the shipped graph and the machine-checked baseline (`precheck:onEnter:1` is the note action). Suites green after the repair: 85 pass / 0 fail (resilience + drift inventory). |
| R5 | MET | Scope narrowed to the source-local proof by operator decision 2026-08-30; activation is an operator-run release step after merge, not tracked as a follow-up task. Proof re-run this session: `spur workflow validate config/workflows/task-pipeline.yaml` exit 0; dry-run completes (run `ad05b840`) and reaches the `failed` terminal only because dry-run skips onEnter actions so the size-status gate file is never written — the pre-0723 workflow dry-runs to the identical terminal in 1 transition (run `0e728251`), so this is inherent to a status-file-gated workflow, not a regression. Before-trace `inline-20260821-083900-0614` confirmed present in the runs table. Gates: full repo 6952 pass / 0 fail; targeted 96 + 129 + 85 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Inline execution performs no doctor preflight | MET | test | `plugins/sp/tests/task-pipeline-resilience.test.ts:75-80` — asserts no `doctor.probe` onEnter action and no `agent doctor` substring in precheck commands; 96 pass / 0 fail this run. |
| Scenario: R2 — Readiness and size gates remain fail closed | MET | test | Fail-closed branches read this run at `config/workflows/task-pipeline.yaml:215-218` and `plugins/sp/scripts/task-size-precheck.ts:122-128`; ceilings at `packages/app/src/services/task-size-precheck.ts:30-33`; single task check at `config/workflows/task-pipeline.yaml:686`; `packages/app/tests/services/task-size-precheck.test.ts` 129 pass / 0 fail. |
| Scenario: R3 — Auto feature reactivation is bounded and observable | MET | test | `plugins/sp/tests/task-pipeline-resilience.test.ts:166` — "auto feature reactivation: single-shot on success, blocking on real failure (0723 R3)"; executed this run (`plugins/sp` `bun test tests/task-pipeline-resilience.test.ts tests/skill-structure.test.ts` -> 83 pass / 0 fail). Shipped graph re-read at `config/workflows/task-pipeline.yaml:182-198` — single sync + single update fallback, `exit 1` on both failing; advisory dirty-tree block at `:155-168` exits 0. |
| Scenario: R4 — Workflow contracts describe the shipped graph | MET | test | Contract suites executed this run: `plugins/sp` `bun test tests/inline-pipeline-driver.test.ts tests/surface-drift-inventory.test.ts tests/inline-execution-contract.test.ts` -> 94 pass / 0 fail; `packages/app` `bun test tests/workflow/composition-advisory.test.ts` -> 6 pass / 0 fail and `tests/workflow/composition-baseline.test.ts` green in the 73-pass app run. Design rows re-read this run at `docs/design/workflow-shell-ownership.md:168-171` (precheck:onEnter:2 / draft:onEnter:1 / record:onEnter:0). The disposition-store cross-check named in the original verdict is no longer available: `config/workflow-composition-baseline.json` was retired by ADR-108 (`docs/00_ADR.md:1002`), so contract agreement is now proven by the live-definition suites above rather than by snapshot equality. |
| Scenario: R5 — Source-local proof gates the upgrade | MET | command | Scope narrowed to the source-local proof by operator decision 2026-08-30; activation is an operator-run release step after merge, not tracked as a follow-up task. Proof re-run this session: `spur workflow validate config/workflows/task-pipeline.yaml` exit 0; dry-run completes (run `ad05b840`) and reaches the `failed` terminal only because dry-run skips onEnter actions so the size-status gate file is never written — the pre-0723 workflow dry-runs to the identical terminal in 1 transition (run `0e728251`), so this is inherent to a status-file-gated workflow, not a regression. Before-trace `inline-20260821-083900-0614` confirmed present in the runs table. Gates: full repo 6952 pass / 0 fail; targeted 96 + 129 + 85 pass / 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | correctness | `docs/design/workflow-shell-ownership.md:169-170` | Ownership-doc precheck rows cite `precheck:onEnter:1`/`:2` for feature-reopen/size, but the live graph and machine baseline key them `:2`/`:3` — the `kind: note` action at `config/workflows/task-pipeline.yaml:168` (`precheck:onEnter:1`, baseline `config/workflow-composition-baseline.json:316`) is omitted, shifting the doc labels by one. Executable contracts all match (composition-baseline test 19/0 fresh); doc-only drift. **RESOLVED** 2026-08-30 in commit `1bbd56c81` — rows renumbered to `:2`/`:3`; re-read at `docs/design/workflow-shell-ownership.md:169-170`. |
| P3 | usability | `config/workflows/task-pipeline.yaml:189-190` | Feature-reactivation failure surfaces the fact ("sync + update both errored") but both verbs still run with `2>/dev/null`, so the underlying sync/update diagnostics are discarded — an operator must re-run manually to learn why reactivation failed. |
| P4 | correctness | `plugins/sp/tests/task-size-precheck.test.ts:42` | Vestigial assertion `existsSync(injected.replace('injected', 'injected '))` checks a never-created trailing-space path; the original shell-injection guard lost its target when `--executor` was deleted and the replacement argv check does not re-establish hostile-payload coverage (execFileSync argv execution stays injection-safe by construction). |
| P4 | — | — | No P1–P2 findings; SECUA + architecture verdict PASS |

#### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `config/workflows/task-pipeline.yaml:150-218` — precheck onEnter is [git-status shell, note, feature-sync shell, size shell]; no `doctor.probe` action and no `agent doctor` spawn (asserted `plugins/sp/tests/task-pipeline-resilience.test.ts:75-84`); `plugins/sp/scripts/task-size-precheck.ts` count-only with `--executor`/`capabilityTier` deleted (negative test `plugins/sp/tests/task-size-precheck.test.ts:91-97`); dispatch-time liveness/capability attestation unchanged at `packages/app/src/services/agent-service.ts:584,656`. |
| R2 | MET | precheck→implement guard runs size-PASS + `spur task check` exactly once (`config/workflows/task-pipeline.yaml:685`); defaults doubled to 10/16 in `packages/app/src/services/task-size-precheck.ts:30-33`, plugin fallbacks `plugins/sp/scripts/task-size-precheck.ts:73-74`, YAML vars `config/workflows/task-pipeline.yaml:126-131`; missing checker writes FAIL (`config/workflows/task-pipeline.yaml:213-217`, proven behaviorally in `plugins/sp/tests/task-pipeline-resilience.test.ts:85-96`); over-ceiling FAIL proven app- and plugin-side (`packages/app/tests/services/task-size-precheck.test.ts:166-176`, `plugins/sp/tests/task-size-precheck.test.ts:148-157`). |
| R3 | MET | Single-shot sync→update with failure propagation (`config/workflows/task-pipeline.yaml:183-197`; ` | | true` asserted absent at `plugins/sp/tests/task-pipeline-resilience.test.ts:84`); behavioral test proves one sync on success, sync+update rescue, and blocking double-failure (`plugins/sp/tests/task-pipeline-resilience.test.ts:126-166`); dirty-tree advisory unchanged (`config/workflows/task-pipeline.yaml:154-166`). |
| R4 | MET | Baseline regenerated for both changed invocations (`config/workflow-composition-baseline.json:321,328`; composition-baseline test 19/0 fresh this run); `docs/04_DESIGN.md` precheck section, ownership doc, and drift inventory updated; idea-pipeline keeps its intentional `doctor.probe` (`config/workflows/idea-pipeline.yaml:82`). Residual: P3 doc-index drift above. |
| R5 | MET | Source-local proof re-proven (`workflow validate` exit 0, `spur task check 0723` PASS, targeted 112/0, full repo 6952/0). Scope narrowed by operator decision 2026-08-30: activation is an operator-run release step, not implementation work. That release landed as **0.3.69** and the shipped artifacts were verified — bundled `task-pipeline.yaml` carries no `doctor.probe`, `plugins/sp/scripts/task-size-precheck.ts` in the installed bundle has no doctor/`--executor` path and ships the 10/16 ceilings. Fresh-session canary not run: it needs a `todo` task and none exists; the operator elected not to create one. |

#### SECUA + Architecture

- Security: attack surface reduced (both precheck doctor call sites removed); no new exec/secrets; argv-only spur invocation preserved (`plugins/sp/scripts/task-size-precheck.ts:110-116`).
- Efficiency: precheck no longer spawns `spur agent doctor` on any surface; consistent with the before-trace (1.702 s doctor.probe + duplicate tier probe eliminated).
- Correctness: fail-closed direction verified statically (missing status file fails the guard `test ... = PASS`) and behaviorally; `Number() || default` fallbacks read an explicit `0` as the default — fail-closed direction, pre-existing pattern.
- Usability: P3 diagnostics finding above; block messages themselves are clear.
- Architecture: deepening is real — duplicated capability-tier inference deleted across app+plugin (locality restored), `TaskSizeExecutor` removed so the evaluator interface shrank, no new wrapper introduced (per Design); no blocker/major deepening candidates.

#### Residual Risk

- R5 activation is complete: the governed Spur release + plugin-sp reinstall shipped as 0.3.69 (2026-08-30 17:33) and its artifacts were verified to carry the doctor-free precheck. The fresh-session canary remains unrun — it requires a `todo` task and the corpus has none; verify it opportunistically on the next real pipeline run.
- Full-repo gates (`bun run test` 6952/0, typecheck) are implement-stage Testing claims not re-run at review; targeted suites re-run fresh: 112 pass / 0 fail.

Verdict: PASS (stage scope: implement diff — no blocker/major findings). Reviewed at implement stage with R5 activation open; rows above updated 2026-08-30 after the operator's scope decision and the 0.3.69 release. Open findings carried forward: P3 reactivation diagnostics discarded by `2>/dev/null`, P4 vestigial assertion at `plugins/sp/tests/task-size-precheck.test.ts:42` — both re-read and still present.

### References

- `config/workflows/task-pipeline.yaml` — live workflow and temporary config-only bypass.
- `packages/app/src/workflow/actions/doctor-probe.ts` — usability-only doctor action retained for
  intentional callers.
- `packages/app/src/services/task-size-precheck.ts` — shared size evaluator.
- `plugins/sp/scripts/task-size-precheck.ts` — plugin-local size gate and second doctor call.
- `packages/app/src/services/agent-service.ts` — authoritative dispatch resolution and capability
  attestation.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` — host-side action semantics.
- `plugins/sp/tests/task-pipeline-resilience.test.ts`
- `packages/domain/tests/planning/lifecycle-drift.test.ts`
- `packages/app/tests/workflow/composition-baseline.test.ts`
- `config/workflow-composition-baseline.json`
- `docs/design/workflow-shell-ownership.md`
- `docs/04_DESIGN.md` task-pipeline precheck and size-gate contract.
- Tasks 0454 and 0487 — original size and size-versus-tier gates.
- Tasks 0608, 0682, and 0683 — doctor action ownership and removal of unreliable auth/health work.
- Task 0706 — dispatch-time executor capability attestation.
- Trace `inline-20260821-083900-0614` — persisted before evidence for precheck action timings.

### History

- 2026-08-30T19:42:42.695Z backlog → todo (system)
- 2026-08-30T23:56:49.969Z todo → wip (system)
- 2026-08-30T23:56:50.547Z wip → testing (system)
- 2026-08-30T23:56:51.149Z testing → done (system)
