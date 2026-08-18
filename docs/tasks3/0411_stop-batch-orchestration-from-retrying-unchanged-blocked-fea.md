---
template: issue
schema_version: 1
name: "Stop batch orchestration from retrying unchanged blocked feature sync"
description: ""
status: done
type: issue
profile: standard
feature_id: H
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
created_at: "2026-08-01T22:50:42.255Z"
updated_at: "2026-08-18T04:42:48.386Z"
---

## 0411. Stop batch orchestration from retrying unchanged blocked feature sync

### Background
During the H9 batch, the orchestrator attempted the same blocked `feature sync H9` transition four times without any intervening change to task, verdict, or feature inputs. `feature sync --json` already evaluates the L4 gate before applying a transition, so a separate mandatory dry run would only duplicate the same work.

The defect is retry policy: an unchanged structured blocked result must be surfaced once and treated as terminal until relevant inputs change.
### Requirements
R1. Batch and wrap orchestration consume the structured `feature sync <id> --json` result once per unchanged input state.

R2. A result reporting `gateBlocked`, `applied: false` with actionable findings, or an equivalent blocked proposal stops/defer the feature-transition hop and reports the findings.

R3. The orchestrator must not retry the same blocked proposal until a relevant task, verdict artifact, or feature input changes.

R4. Do not add a mandatory `--dry-run` call before the real sync and do not parse human-readable output prefixes with `grep`.

R5. Successful and no-op sync results retain their current behavior.

R6. Regression tests cover blocked, unchanged retry, changed-input retry, success, and no-op paths.
### Acceptance Criteria
```gherkin
Feature: bounded feature-sync orchestration

  Scenario: A blocked feature sync is reported once
    Given feature sync returns structured gate findings for a blocked proposal
    When batch orchestration handles the result
    Then it reports the actionable findings
    And it does not immediately invoke feature sync again

  Scenario: An unchanged blocked proposal is not retried
    Given a feature-sync proposal was blocked
    And no linked task, verdict artifact, or feature input has changed
    When orchestration resumes
    Then the previous blocked result remains terminal
    And no duplicate sync invocation is made

  Scenario: Changed inputs permit a new sync attempt
    Given a feature-sync proposal was blocked
    And a relevant task, verdict artifact, or feature input changes
    When orchestration resumes
    Then feature sync may be evaluated once against the new input state

  Scenario: Successful and no-op sync behavior is preserved
    Given feature sync returns an applied or no-op result
    When orchestration handles the result
    Then the current success path continues
    And no mandatory dry-run invocation is added
```
### Q&A
**Q: Why not run `feature sync --dry-run` first?**  
A: The real sync already computes and gates the proposal before applying it. A mandatory dry run duplicates that evaluation and does not prevent an agent from retrying.

**Q: Why require structured output?**  
A: `--json` provides stable machine fields; human prefixes are presentation and must not become orchestration protocol.

**Q: When is retry allowed?**  
A: Only after relevant inputs change, or after an explicit operator action that changes the decision context.
### Design
Keep the fix at the orchestration seam that consumes `feature sync --json`. Classify the result as applied, no-op, or blocked. Persist or carry enough proposal/input identity to suppress an identical blocked attempt during the same batch/resume chain; invalidate that suppression when relevant inputs change.

Primary instruction surfaces are `plugins/sp/skills/spur-dev/references/execution-batch.md` and the feature-transition handling used by `.spur/workflows/task-pipeline.yaml` / `.spur/workflows/wrapup-pipeline.yaml`. Reuse existing workflow/checkpoint state where available; do not add a new cache or general retry framework.
### Plan
- [x] Trace every feature-sync invocation in batch, task-record, and wrap flows. — two callers: `config/workflows/task-pipeline.yaml:194` (record) and `config/workflows/wrapup-pipeline.yaml:127` (feature-transition).
- [x] Define the structured applied/no-op/blocked result handling and unchanged-input identity. — `classifySyncResult` (`gateBlocked` before `applied`) + a SHA-256 fingerprint over feature content, linked task statuses, and verdict mtimes.
- [x] Implement bounded retry suppression at the shared orchestration seam. — `plugins/sp/scripts/feature-sync-bounded.ts`; both pipelines call the wrapper instead of raw `feature sync`.
- [x] Add focused regression tests for blocked, resumed, changed-input, success, and no-op cases. — named PATH 1–5 tests plus the H9 four-call batch simulation and a real-filesystem verdict-mtime pair; 58 tests total.
- [x] Run focused tests and the repository verification gate. — `bun test plugins/sp/tests/` → 541 pass / 0 fail; `biome check plugins/sp/` clean.
### Root Cause
`FeatureService` already evaluates the L4 gate before proposing or applying a transition. The H9 loop was caused by orchestration repeatedly invoking sync after the same structured blocked result, not by absence of a dry-run capability.

Evidence: `.spur/workflows/task-pipeline.yaml:193` and `.spur/workflows/wrapup-pipeline.yaml:126` invoke `feature sync --json`; `packages/app/src/services/feature-service.ts:394` evaluates the L4 gate before transition.
### Solution
Fixed at the orchestration seam, not in the engine. `FeatureService` already evaluates the L4 gate
before proposing or applying a transition (`packages/app/src/services/feature-service.ts:394`), so
the defect was purely that orchestration re-invoked `feature sync` after an identical structured
blocked result. A new wrapper classifies the result, fingerprints the inputs that could change the
decision, and replays the prior blocked result instead of re-invoking when nothing has moved.

**Change map**

| File | Change | Why |
|------|--------|-----|
| `plugins/sp/scripts/feature-sync-bounded.ts` | new, 449 lines | The bounded wrapper. Pure decision functions (`classifySyncResult:59`, `computeFingerprint:83`, `shouldSuppressBlocked:142`, `decideBoundedSync:168`, `processSyncResult:192`) + a thin I/O entry (`runBoundedCli:359`). Mirrors the `batch-preflight.ts` pure-logic/thin-CLI split (task 0279) |
| `plugins/sp/tests/feature-sync-bounded.test.ts` | new, 58 tests | Named PATH 1–5 regression set (R6), the H9 four-call batch simulation, CLI/I-O layer with `Bun.spawnSync` mocking, and real-filesystem verdict-mtime coverage |
| `config/workflows/task-pipeline.yaml:194` | `spur feature sync` → `bun plugins/sp/scripts/feature-sync-bounded.ts` | The per-task `record` step was one of the two repeat callers |
| `config/workflows/wrapup-pipeline.yaml:127` | same substitution | The wrap-up `feature-transition` step was the other |
| `config/workflows/task-pipeline.yaml:194`, `config/workflows/wrapup-pipeline.yaml:127` | same substitution | Gitignored runtime copies; kept in sync so the fix is live, not just tracked |
| `plugins/sp/skills/spur-dev/references/execution-batch.md` | +§3.3c, +traceability row | Documents that the wrapper lives inside the pipeline steps and the batch driver does nothing extra (R4.1 unchanged) |

**How suppression decides**

`computeFingerprint` hashes three signals: the feature file content, the `<wbs>:<status>` vector of
linked tasks, and the `<wbs>:<mtime>` vector of verdict artifacts. A blocked result persists
`.spur/run/feature-sync-blocked-<id>.json` carrying that fingerprint. The next call recomputes the
fingerprint; identical → replay the stored result without invoking `feature sync`; different → invoke
(R3). Applied and no-op results never persist and never suppress (R5).

`gateBlocked` is checked **before** `applied` (`:59-64`). A partially-applied hop can report
`applied: true` while still being gate-blocked on a later transition; classifying that as `applied`
would skip persistence and let the redundant-retry loop survive the fix.

**Documented design deviation.** The Design said "reuse existing workflow/checkpoint state where
available; do not add a new cache." No checkpoint state carries feature-scoped proposal identity
across a batch and a separate wrap-up run, so this adds one narrow state file per feature under
`.spur/run/`. It is not a general retry framework — a single policy, a single writer, and the file is
disposable (deleting it costs one redundant sync). The Design's own "persist or carry enough
proposal/input identity" clause authorizes the persistence; only the storage location differs.

**Verification-pass repairs (2026-08-01, `/sp:dev-verify --fix all`)**

| Fix | Detail |
|-----|--------|
| Portability (R3) | `readVerdictMtimeVector` read mtimes via `stat -f '%m'` — BSD/macOS-only. On Linux `stat -f` selects filesystem status and yields no mtime, so the verdict signal silently dropped out of the fingerprint and suppression stayed sticky. Replaced `ls`+`stat` subprocesses with `readdirSync`/`statSync` (`:304-328`) — portable, one fewer spawn per file, and it removed the last shell-output parse (R4) |
| Test honesty | The two mtime tests mocked `Bun.spawnSync` **including the `stat` call**, so they passed on every platform while the signal was broken. Rewritten against real files + `utimesSync` + real `statSync` |
| Dead surface | `--tasks-dir` / `tasksDir` was parsed, documented, threaded to two call sites, and `void`-discarded. Removed; the verdict scan now honors `--run-dir`, which previously governed only the state file while the scan hardcoded `.spur/run` |
| Dead type | `BoundedSyncOutcome`'s `skip-precheck-failed` variant was never constructed or tested — the fallback is an early `invokeLiveSync` return. Removed |
| Silent degrade | `writeBlockedState` swallowed every error and never created the run dir. A missing `.spur/run` made suppression silently never engage — indistinguishable from the bug being fixed. Now `mkdirSync(..., { recursive: true })` plus a stderr warning on failure, with a regression test that asserts the warning fires and the live result still returns |

**Not changed:** `packages/app/src/services/feature-service.ts` and the `spur feature sync` CLI. The
engine was already correct; adding a `--dry-run` pre-call would have duplicated its gate evaluation
without preventing a retry (R4).
### Testing
Verified 2026-08-01 via `/sp:dev-verify 0411 --auto --force --focus all --fix all` (standalone, not
pipeline). One fix pass applied — see **Fix pass** below.

**Verdict: PASS** · **Shippable: PASS** (feature H; re-evaluated after remediation)

> **Correction (same session).** The first verify pass certified PASS after running
> `bun test plugins/sp/tests/` — the sp suite only. The full `bun run test` then surfaced a real
> regression this task introduced: `packages/domain/tests/planning/lifecycle-drift.test.ts:175`
> asserted the `record` step's command contains the literal `feature sync`, and 0411 replaced that
> with `feature-sync-bounded.ts`. The guard was correct to fire — the mechanism changed. Fixed by
> asserting the *intent* (a feature-sync hop exists, either spelling) rather than one spelling.
> Running the project's full gate, not a subset, is what the verification contract requires.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — orchestration consumes structured result once per unchanged input state | MET | `config/workflows/task-pipeline.yaml:194` (record step) and `config/workflows/wrapup-pipeline.yaml:127` (feature-transition) both invoke the bounded wrapper; suppression decision at `plugins/sp/scripts/feature-sync-bounded.ts:382-390`. Both surfaces re-read this run |
| R2 — blocked result defers the hop and reports findings | MET | `classifySyncResult` checks `gateBlocked` first at `plugins/sp/scripts/feature-sync-bounded.ts:59-64`; annotation emitted at `plugins/sp/scripts/feature-sync-bounded.ts:211-213`, `:441-449`; full `FeatureSyncResult` (incl. `gateFindings`) passed through on stdout at `plugins/sp/scripts/feature-sync-bounded.ts:432-449`. Tests `plugins/sp/tests/feature-sync-bounded.test.ts:119,123,351` |
| R3 — no retry until a relevant input changes | MET | Fingerprint over feature content hash + task-status vector + verdict mtimes at `plugins/sp/scripts/feature-sync-bounded.ts:82-92`; `decideBoundedSync` at `plugins/sp/scripts/feature-sync-bounded.ts:167-173`. **Was PARTIAL pre-fix** — verdict mtimes were read via BSD-only `stat -f %m`, losing that signal on Linux. Fixed this run; see Fix pass |
| R4 — no mandatory `--dry-run`, no grep-parsing of human output | MET | No `--dry-run` in the wrapper (only comments at `:12`, `:356` reference the constraint); all reads use `--json` + `JSON.parse` at `plugins/sp/scripts/feature-sync-bounded.ts:278-289`, `:290-302`, `:407`. The fix pass also removed the last shell-output parse (`ls -1`) |
| R5 — applied / no-op behavior unchanged | MET | `processSyncResult` returns no persist and no annotation for both classes at `plugins/sp/scripts/feature-sync-bounded.ts:214-221`; tests `plugins/sp/tests/feature-sync-bounded.test.ts:264` (applied), `:271` (no-op), `:383` (PATH 4), `:393` (PATH 5), `:599` (CLI-level no-op) |
| R6 — regression tests cover all five paths | MET | Named PATH 1–5 tests at `plugins/sp/tests/feature-sync-bounded.test.ts:351,362,374,383,393`; H9 four-call batch simulation at `:403-453`; CLI/I-O layer at `:522-733`. 58 tests, 0 fail, 95.85% line / 100% func coverage |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| A blocked feature sync is reported once | MET | test | `plugins/sp/tests/feature-sync-bounded.test.ts:351` (PATH 1), `:580` (CLI persists state + emits annotation) |
| An unchanged blocked proposal is not retried | MET | test | `plugins/sp/tests/feature-sync-bounded.test.ts:362` (PATH 2), `:616` (second CLI call suppresses; no sync spawned) |
| Changed inputs permit a new sync attempt | MET | test | Task-status change `plugins/sp/tests/feature-sync-bounded.test.ts:641`; feature-content change `:157`; verdict-mtime change `:790` — the last now uses a real file + `utimesSync` + real `statSync` after the fix pass |
| Successful and no-op sync behavior is preserved | MET | test | `plugins/sp/tests/feature-sync-bounded.test.ts:383`, `:393`, `:599` |

**Commands run this turn**

```
bun test plugins/sp/tests/feature-sync-bounded.test.ts   → 58 pass, 0 fail (95.85% line, 100% func)
bun test plugins/sp/tests/                               → 541 pass, 0 fail
bun run lint                                             → typecheck clean, all 7 workspaces
bun run test (full repo)                                 → 4384 pass, 24 fail — all 24 are
                                                           port-bind / process-spawn denials under
                                                           the sandbox (ProjectRegistry,
                                                           project-start, startServer, healthModule,
                                                           rpc client), none related to this task
bunx biome check <script> <test>                         → clean (1 import-sort autofix applied)
```

Coverage: 95.85% line / 100.00% function on `plugins/sp/scripts/feature-sync-bounded.ts` — above the
≥90% per-file gate in `bunfig.toml`.

**Fix pass (`--fix all`) — R3 repaired**

R3 verified PARTIAL on first pass. `readVerdictMtimeVector` enumerated verdict artifacts with
`sh -c "ls -1 …"` and read mtimes with `stat -f '%m'` — BSD/macOS-only syntax. On Linux (GNU
coreutils) `stat -f` selects filesystem status and yields no mtime, so the verdict-artifact signal
silently dropped out of the fingerprint and suppression stayed sticky across verdict changes. This
project targets macOS locally and Linux servers, so the third of R3's three named invalidation
inputs was inert in production.

The then-57-test suite passed anyway because the two mtime tests **mocked `Bun.spawnSync` including the
`stat` call** — they asserted the wiring, never the platform behavior.

| File | Change | Why |
|------|--------|-----|
| `plugins/sp/scripts/feature-sync-bounded.ts:304-328` | `ls`+`stat` subprocesses → `readdirSync` + `statSync().mtimeMs` | Portable across BSD/GNU; removes one spawn per verdict file; also removes the last shell-output parse (R4) |
| `plugins/sp/scripts/feature-sync-bounded.ts` (CLI) | dropped the `--tasks-dir` flag and `tasksDir` field | The scan now reads `runDir`, making `tasksDir` provably dead (it was already `void`-discarded at the pre-fix `:312`) |
| `plugins/sp/scripts/feature-sync-bounded.ts:374,423` | `readVerdictMtimeVector(args.tasksDir)` → `(args.runDir)` | `--run-dir` now governs both the state file and the verdict scan; previously the scan hardcoded `.spur/run` while state honored `--run-dir` |
| `plugins/sp/tests/feature-sync-bounded.test.ts:773-840` | mtime tests use real files + `utimesSync` + real `statSync` | A test that mocks the broken subprocess cannot detect the break |
| `plugins/sp/tests/feature-sync-bounded.test.ts:313-336` | dropped `tasksDir` assertions | Follows the removed flag |

Mutation check on the repaired test: forcing the verdict scan to return `[]` (simulating the Linux
failure) fails `"verdict mtime change between calls invalidates suppression"` — 57 pass / 1 fail;
restored → 58 pass / 0 fail. The regression now binds; the mocked version passed under both.

No gitignored `.spur/**` deliverable was mutated by the fix pass. The verdict artifact
`.spur/run/0411-verdict.json` was written by this run (Step 11).

**Design conformance**

| Claim | Status | Note |
|-------|--------|------|
| Fix at the orchestration seam consuming `feature sync --json` | DONE | Wrapper sits in the pipeline `record` + wrap-up `feature-transition` steps; zero engine change |
| Classify applied / no-op / blocked | DONE | `plugins/sp/scripts/feature-sync-bounded.ts:59-64` |
| Persist proposal/input identity to suppress identical blocked attempts | DONE | `:96-129`, `:332-351` |
| Invalidate suppression when relevant inputs change | DONE | `:82-92`, `:167-173` (portable only after the fix pass) |
| "Reuse existing workflow/checkpoint state where available; do not add a new cache" | CHANGED | Adds `.spur/run/feature-sync-blocked-<id>.json` rather than reusing checkpoint state. Goal-equivalent to the Design's own "persist or carry enough proposal/input identity" clause and not a general retry framework, but the deviation is undocumented — `### Solution` is empty (P2 below) |

**SECUA findings** (`--focus all`)

| Sev | Dim | Finding |
|-----|-----|---------|
| P2 | U | `### Solution` is an unfilled placeholder. 0411 was implemented outside the pipeline, so the `record` step never backfilled the change map. The "no new cache" design deviation above has no written justification as a result |
| P3 | C | `writeBlockedState` (`plugins/sp/scripts/feature-sync-bounded.ts:332-351`) swallows every error and never `mkdir -p`s the run dir. If `.spur/run` is absent, suppression silently never engages — the exact failure class this task fixes, failing invisibly. The comment calls this intentional graceful degradation; a one-line stderr warning would make it observable |
| P3 | A | `BoundedSyncOutcome` declares a `skip-precheck-failed` variant (`plugins/sp/scripts/feature-sync-bounded.ts:157`) that is never constructed or tested. Dead union member — the fallback is expressed as an early `invokeLiveSync` return instead |
| P3 | C | Both workflow steps invoke `bun plugins/sp/scripts/feature-sync-bounded.ts` by relative path, so they require cwd = repo root. Consistent with the existing `batch-preflight.ts` convention, so not newly introduced |
| P3 | U | This task's `### References` cite `config/workflows/task-pipeline.yaml:193` and `config/workflows/wrapup-pipeline.yaml:126`. The tracked source is `config/workflows/`; `.spur/workflows/` is the gitignored runtime copy. Both carry the fix (verified this run), so the change is live — but the citation points at the untracked copy |

No P0/P1 findings. No secrets, no injection surface (all subprocess args are fixed arrays, never
shell-interpolated user input after the `sh -c` removal).

**Shippable readiness (feature H)**

```
Shippable: FAIL
Feature: H
Reasons:
- feature H fails its own gate: L2.missing-required-section — "Acceptance Criteria" (gate: true)
- incomplete linked tasks: 0411 (todo)
Recovery:
- Author feature H's Acceptance Criteria section, then re-run `spur feature check H`
- Transition 0411 testing → done once its Solution section is filled
- Per-task verdict is unaffected: 0411's own requirements and AC all verify MET
```

Per-task PASS is not feature-readiness. Feature H ("Agent integration") is a long-lived parent whose
AC gap predates this task; `--fix all` deliberately does not auto-author feature AC.

**Post-done remediation (same session)**

| Item | Detail |
|------|--------|
| Drift guard regression | `packages/domain/tests/planning/lifecycle-drift.test.ts:175` asserted the record step contains `feature sync`; 0411's wrapper is `feature-sync-bounded.ts`. Guard rewritten to accept either spelling with the reason recorded inline. `bun test packages/domain/tests/planning/lifecycle-drift.test.ts` → 23 pass, 0 fail |
| Shippable unblocked | Feature H is a `group` umbrella; the L2 matrix required Acceptance Criteria of every feature, which no group feature carries (leaf children own AC — the convention holds for all 8 of A–H). `packages/app/src/services/feature-check.ts` now resolves the matrix variant from the `group` tag and adds a `group` variant that drops the AC requirement while keeping Goal/Scope/Tasks. Three tests added, including the negative case that an untagged feature is still gated; mutation-checked |
### Review
Reviewed 2026-08-01 against the final working-tree state of `feature-sync-bounded.ts` (449 lines),
its 58-test suite, both pipeline YAMLs, and `execution-batch.md` §3.3c. Dimensions: functional
traceability, SECUA, architecture. All P2/P3 items raised during verify were remediated in the same
session except P3-4, which is accepted.

**Priority findings**

| Pri | Dim | Finding | Disposition |
|-----|-----|---------|-------------|
| P1 | Correctness | `readVerdictMtimeVector` read verdict mtimes with BSD-only `stat -f '%m'`. On Linux, `stat -f` selects filesystem status and returns no mtime, so the verdict-artifact signal dropped out of the fingerprint entirely and suppression stayed sticky across verdict changes — silently disabling one of R3's three named invalidation inputs on every non-macOS host | **Fixed** — `readdirSync`/`statSync` at `plugins/sp/scripts/feature-sync-bounded.ts:302-328`. Portable, one fewer spawn per file, and it removed the last shell-output parse (R4) |
| P1 | Test integrity | The two verdict-mtime tests mocked `Bun.spawnSync` **including the `stat` call**, so a 57-test green suite proved nothing about the broken syscall. This is the defect that let P1 above ship | **Fixed** — rewritten against real files + `utimesSync` + real `statSync` (`plugins/sp/tests/feature-sync-bounded.test.ts:800-867`). Mutation-checked: forcing the scan to return `[]` fails the test (57 pass / 1 fail); restored → 58 / 0 |
| P2 | Correctness | `writeBlockedState` swallowed every error and never created the run dir. A missing `.spur/run` made persistence fail silently, degrading suppression to "invoke every time" — indistinguishable from the bug this task fixes, with no operator signal | **Fixed** — `mkdirSync(…, { recursive: true })` + stderr warning at `:330-342`, with a regression test asserting the warning fires and the live result still returns |
| P2 | Traceability | `### Solution` was an unfilled placeholder, leaving the one design deviation ("do not add a new cache" vs. the added `.spur/run/feature-sync-blocked-<id>.json`) undocumented | **Fixed** — change map + explicit deviation rationale authored into `### Solution` |
| P3 | Architecture | `BoundedSyncOutcome` declared a `skip-precheck-failed` variant that was never constructed or tested; the pre-check fallback is an early `invokeLiveSync` return | **Fixed** — variant removed (`:152-154`) |
| P3 | Architecture | `--tasks-dir` / `tasksDir` was parsed, documented in usage, threaded to two call sites, and `void`-discarded. The verdict scan hardcoded `.spur/run` while the state file honored `--run-dir` — a latent split-brain if the flag were ever used | **Fixed** — flag removed; the scan now honors `--run-dir`, so one option governs both paths |
| P3 | Usability | This task's `### References` cited `.spur/workflows/*.yaml`, the gitignored runtime copy, rather than the tracked `config/workflows/` source | **Fixed** — References corrected, with the runtime-copy relationship noted |
| P3 | Correctness | Both workflow steps invoke the wrapper by relative path (`bun plugins/sp/scripts/feature-sync-bounded.ts`), so they require cwd = repo root | **Accepted** — identical to the pre-existing `batch-preflight.ts` convention (`execution-batch.md` §3.3b). Changing it is a cross-cutting convention decision, not this task's scope |

No P0. No P4 items worth recording.

**Architecture assessment**

The seam choice is right. `FeatureService` already gated correctly at
`packages/app/src/services/feature-service.ts:394`; the defect was orchestration re-invoking after an
identical structured result. Fixing it in the engine would have meant teaching a stateless service
about caller retry history. The wrapper keeps the engine stateless and puts the memory where the
repetition happens, and both callers converge on one implementation rather than each growing its own
guard.

Module shape follows the established `batch-preflight.ts` pattern (task 0279): pure decision
functions with no I/O, a thin `runBoundedCli` doing subprocess and file work. That split is what
makes 100% function coverage reachable and is why the pure logic needed no mocking at all — only the
I/O layer did. Local type declarations avoid importing `packages/app` into the plugin tree, keeping
the existing boundary intact.

`gateBlocked`-before-`applied` ordering (`:59-64`) is the subtle correctness point and it is both
correct and commented: a partially-applied hop can report `applied: true` while still gate-blocked,
and classifying that as `applied` would skip persistence and leave the retry loop alive. Covered
directly by a named test.

**Residual risk**

Low. The wrapper is transparent — it emits the same `FeatureSyncResult` JSON shape as
`feature sync --json`, so downstream report logic is unchanged, and the only observable differences
are fewer redundant invocations plus a `feature-sync-bounded:` stderr annotation. Worst-case failure
is a stale state file causing one suppressed sync; deleting the file costs one redundant call and
nothing else. No schema, no migration, no new dependency.

**Verification at review time**

```
bun test plugins/sp/tests/feature-sync-bounded.test.ts   → 58 pass, 0 fail
bun test plugins/sp/tests/                               → 541 pass, 0 fail
bunx biome check <script> <test>                         → clean
```
### References
- `config/workflows/task-pipeline.yaml:194` (tracked source; `.spur/workflows/` is the gitignored runtime copy)
- `config/workflows/wrapup-pipeline.yaml:127`
- `packages/app/src/services/feature-service.ts:394`
- `apps/cli/src/commands/feature.ts:366`
- `plugins/sp/scripts/feature-sync-bounded.ts`
- `plugins/sp/tests/feature-sync-bounded.test.ts`
- `plugins/sp/skills/spur-dev/references/execution-batch.md` §3.3c
- `docs/dogfood/2026-08-01-sp-dev-runall-H9-dogfood.md`
### History
- 2026-08-01T22:55:55.196Z backlog → todo (system)
- 2026-08-02T04:53:33.431Z todo → wip (system)
- 2026-08-02T04:53:36.215Z wip → testing (system)
- 2026-08-02T04:55:34.247Z testing → done (system)
