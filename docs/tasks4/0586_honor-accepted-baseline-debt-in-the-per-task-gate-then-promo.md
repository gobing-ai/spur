---
template: feature-impl
schema_version: 1
name: "Honor accepted baseline debt in the per-task gate, then promote anchor-subject-mismatch to error"
description: ""
status: done
type: task
profile: standard
feature_id: F61
parent_wbs: null
priority: P2
tags: []
dependencies: ["0583"]
ac_numbering: task-local
created_at: "2026-08-18T05:05:25.709Z"
updated_at: "2026-08-18T06:17:45.653Z"
---

## 0586. Honor accepted baseline debt in the per-task gate, then promote anchor-subject-mismatch to error

### Background
Feature F91 shipped `L4.anchor-subject-mismatch` at **warning** severity and accepted the historical
drift into the two-sided corpus baseline with a per-code diagnosis. Promotion to error was deferred
here.

**This task's original direction was wrong and was corrected on 2026-08-18 (operator).** It asked to
repair every historical citation first, then promote. Re-measured on the released 0.3.50 corpus:

| Measure | Value |
| --- | --- |
| `L4.anchor-subject-mismatch` findings | **1,583** |
| Tasks carrying at least one | **364** (`docs/tasks` 29 · `tasks2` 161 · `tasks3` 103 · `tasks4` 71) |
| Status of those tasks | **361 `done`**, 2 `cancelled`, 1 `blocked` |
| Baseline entries for the code | 364 (one per task) |

Repairing 1,583 citations inside 364 already-closed records buys nothing forward — nobody will act
on a closed task's citation again — and the original R1 even permitted *rewriting rows whose evidence
no longer exists*, i.e. editing closed history to satisfy a gate.

**The real defect is the gate.** `spur task check <wbs>` never reads `config/corpus-baseline.json` —
verified: `TaskCheckService` contains no reference to it. The baseline is a **corpus-sweep** input
only, so a finding that is formally *accepted*, with a written diagnosis, still fails the per-task
`--strict-core` done-gate. That asymmetry is what makes promotion look impossible.

Teach the per-task check to honor accepted debt on the same `kind:id:code` + severity contract the
corpus sweep already uses, and promotion is safe immediately: new drift errors from day one,
accepted history stays accepted, and the two-sided ratchet still fails the corpus gate when an entry
stops reproducing. Repairing the 1,583 citations becomes optional cleanup, not a prerequisite.

**Corrections to the original text**, recorded so the next reader does not re-derive them:

- It cited "332 of 586 tasks"; the finding-level number is **1,583 across 364 tasks**, and R1 measured findings, not tasks.
- It cited "178-plus ambiguous citations"; `migrate-anchors --dry-run` reports **714**.
- Its R4/AC3 measurable — "`--dry-run` reports zero skipped files" — is **vacuous**: `skipped` is populated only on *apply*, because a dry run never attempts a write. The assertion can never fail.
- The 3 unwritable legacy files (0026, 0045, 0068) are still unwritable; the 6 anchors the pass can still qualify all live in them, blocked by `L1.schema-validation` frontmatter.
### Requirements
- [x] **R1.** The per-task check honors accepted baseline debt: a finding whose `kind:id:code` **and** severity match an entry in `config/corpus-baseline.json` does not fail `spur task check <wbs>` or `--strict-core`. Measurable: a task carrying only baselined findings passes `--strict-core` with zero errors.
- [x] **R2.** Acceptance is severity-matched, reusing the corpus-check identity helpers (`key`, `baselineSeverity`) rather than a second matcher. Measurable: a finding promoted to error is **not** covered by a baseline entry recorded at warning, asserted by test.
- [x] **R3.** The two-sided property is untouched at corpus level: `spur task check --corpus` still fails on a new finding outside the baseline and on a baselined entry that stops reproducing. Measurable: the existing `corpus-check` suite passes unchanged.
- [x] **R4.** `L4.anchor-subject-mismatch` is promoted to **error** via `tasks.severity` in `.spur/config.yaml`, and the 364 baseline entries are recorded at `severity: error` to match the new acceptance contract. Measurable: `spur task check --corpus` is green and reports the code under the error tally.
- [x] **R5.** New drift still fails: a task whose citation does not name its row's subject and has **no** baseline entry fails `spur task check <wbs> --strict-core`. Measurable: a regression test proves the failure, and removing the acceptance lookup makes a baselined-task test fail — both directions pinned.
- [x] **R6.** The matcher is unchanged. Measurable: every subject-matching test in `packages/app/tests/services/task-check.test.ts` passes without edit, including the case asserting a wrong-subject row still reports.

**Out of scope / non-goals:** repairing the 1,583 historical citations (optional cleanup once the gate is correct — no longer a prerequisite); the matcher (feature F91, and loosening it is forbidden by R6); `spur feature check` baseline-awareness (no feature-level code is promoted here); the 3 unwritable `L1.schema-validation` files and the 714 ambiguous basenames, which the qualification pass already reports and neither blocks this promotion.
### Acceptance Criteria
Graduates both of feature F61's scenarios; the Gherkin below carries their exact titles, and the
numbered rows under it are the measurable verify lens.

```gherkin
Scenario: R1 — Accepted debt does not block the per-task gate
  Given a finding accepted in the corpus baseline at the same severity
  When spur task check <wbs> --strict-core runs on that task
  Then the finding does not block the task
  And the corpus sweep still fails if that baseline entry stops reproducing

Scenario: R2 — The gate is closed for new work
  Given the finding promoted to error severity
  When a task cites lines that do not name its row's subject and is not baselined
  Then spur task check --strict-core fails for that task
  And the matcher is unchanged from the shape feature F91 shipped
```

**Verify lens**

- **AC1 (R1)** — Given a task whose only findings are baselined at the same severity, when `spur task check <wbs> --strict-core` runs, then it exits 0 with zero errors. Proven on a real corpus task, not only a fixture.

- **AC2 (R2)** — Given a baseline entry recorded at `warning` and the same finding observed at `error`, when the per-task check runs, then the finding is **not** accepted and the task fails — mirroring `reconcileBaseline`'s contract that severity is part of acceptance.

- **AC3 (R3)** — Given the change, when `bun test packages/app/tests/services/corpus-check.test.ts` runs, then every test passes unedited: a new finding outside the baseline still fails, and a baselined entry that stops reproducing still fails as stale.

- **AC4 (R4)** — Given `L4.anchor-subject-mismatch: error` in `tasks.severity` and the 364 entries recorded at `severity: error`, when `spur task check --corpus` runs, then it is green and the code appears under the error tally, not the warning tally.

- **AC5 (R4, R1)** — Given the promotion is live, when ten tasks sampled across `docs/tasks{,2,3,4}` are checked with `--strict-core`, then each reports zero errors — the promotion does not block closed work.

- **AC6 (R5)** — Given the promotion is live, when a task carries a subject-mismatched citation with **no** baseline entry, then `spur task check <wbs> --strict-core` fails naming that finding. A regression test pins it, and a second test proves the acceptance path is load-bearing: removing the lookup makes the baselined-task test fail.

- **AC7 (R6)** — Given the change, when `bun test packages/app/tests/services/task-check.test.ts` runs, then every subject-matching test passes unedited, including "a row naming an identifier absent from the cited lines still reports".

- **AC8** — `bun run lint` clean, `bun run test` green, `bun run build` green, `spur task check --corpus` green.
### Q&A
**All decisions closed 2026-08-18 (operator).**

**Q: Repair the 1,583 historical citations first?** No — that was this task's original direction and
it was wrong. 361 of the 364 affected tasks are already `done`; re-pointing citations inside closed
records buys nothing forward, and the original R1 even permitted rewriting rows whose evidence no
longer exists. Repair is now optional cleanup, not a prerequisite.

**Q: Then why promote at all?** The value of the promotion is entirely forward-looking: it stops
*new* drift. That is achieved the moment the gate stops contradicting the baseline — no campaign
required.

**Q: What stops someone clearing a real finding by adding a baseline entry?** The existing two-sided
ratchet, per operator ruling. An entry is committed policy, needs a written diagnosis, is
write-denied to agents, and fails `--corpus` if it stops reproducing. Date-fencing entries or
scoping acceptance to archived folders were both considered and rejected as extra rules to reason
about for a risk the ratchet already governs.

**Q: Why not scope the promotion per folder instead?** `tasks.severity` is global, so per-folder
severity would be a new config surface — ADR-051 requires operator consent for that, and it would
leave the gate/baseline contradiction unfixed everywhere else.

**Q: Does this weaken `--strict-core`?** It aligns it. Today a finding can be formally accepted at
corpus level and still fail the per-task gate; after this, "accepted" means the same thing to both
gates. Anything **not** accepted still fails, which is what R5 pins.
### Design
**Frozen by the 2026-08-18 direction correction. No open questions — implement as written.**

#### The seam

Acceptance is applied where severity is already resolved, and the accepted set is **injected**, not
read from disk by the service. `TaskCheckService` stays pure and unit-testable, exactly as
`severityOverrides` is handled today.

```ts
// packages/app/src/services/planning-check-base.ts:199 — summarizeWithStatus gains one parameter
protected summarizeWithStatus(
    status: string,
    findings: CheckFindings[],
    strict?: boolean,
    overrides?: Record<string, 'error' | 'warning' | 'off'>,
    accepted?: ReadonlyMap<string, CorpusSeverity>,   // key -> accepted severity
): CheckResultBase
```

Order inside `summarizeWithStatus` is load-bearing: apply `overrides` and the `strict` elevation
**first**, then drop a finding whose `key(...)` maps to an accepted severity **equal to the finding's
post-elevation severity**. Accepting before elevation would let a warning entry silently cover an
error under `--strict`.

#### Frozen names

| Symbol | Where |
| --- | --- |
| `key(e)` , `baselineSeverity(e)` , `CorpusSeverity` , `BaselineEntry` | reuse from `packages/app/src/services/corpus-check.ts:108`, `:103`, `:39`, `:42` — **never a second matcher** |
| `loadAcceptedFindings(projectRoot): Promise<Map<string, CorpusSeverity>>` | new, exported from `corpus-check.ts` (it already owns the file path at `:641` and the root resolution at `:118`) |
| `accepted` | the option name on `check()` (`packages/app/src/services/task-check.ts:458`) and on `summarizeWithStatus` |

#### Wiring

`makeCheckService` (`apps/cli/src/commands/task.ts:1450`) and the sibling construction at `:1480`
load the accepted map once per invocation and pass it into `check()`. The done-gate path
`runDoneGateCheck` (`:1469`) must receive it too — that is the gate the promotion would otherwise
break, so a wiring miss there is the most likely way this ships half-done.

#### Degradation

A missing or unparseable baseline yields an **empty** map — strictest behavior, never a silent
pass. This mirrors `runCorpusCheck`'s existing stance (`corpus-check.ts:641-650`: a missing file
degrades to "no exemptions" rather than crashing).

#### Why this is safe

The baseline is already the governance surface for accepted debt: entries are committed policy,
require a written diagnosis, are write-denied to agents, and are **two-sided** — an entry that stops
reproducing fails `--corpus`. Honoring it in the per-task gate makes the two gates agree instead of
contradicting each other. Operator ruling 2026-08-18: the existing ratchet is sufficient guardrail;
no date-fencing or folder-scoping.

#### Anti-patterns — do not implement

- Do not have `TaskCheckService` read `config/corpus-baseline.json` itself. Inject the map; the CLI owns file access.
- Do not re-implement `key()` or severity normalization locally (`sp:code-verification` "never a private matcher").
- Do not accept on key alone. Severity is part of the contract — a warning entry must not cover an error finding (R2).
- Do not loosen the matcher to reduce findings (R6).
- Do not extend this to `spur feature check` in this task; no feature-level code is being promoted.
- Do not repair historical citations to make the gate pass — that is the direction this task replaced.

#### File targets

`packages/app/src/services/planning-check-base.ts` (the `accepted` parameter and drop logic);
`packages/app/src/services/corpus-check.ts` (`loadAcceptedFindings` export);
`packages/app/src/services/task-check.ts` (option pass-through at `:458`, `:470`, `:501`);
`apps/cli/src/commands/task.ts` (`:1450`, `:1469`, `:1480`); `.spur/config.yaml` (`tasks.severity`);
`config/corpus-baseline.json` (364 entries re-recorded at `severity: error`);
`docs/04_DESIGN.md` §7.1 (same-commit, T3 — the per-task check's acceptance behavior is a documented
surface change).

#### Sandbox note

`config/corpus-baseline.json` and `.spur/config.yaml` are write-denied to agents. Stage the
regenerated baseline outside the repo, verify it through `reconcileBaseline`, and hand the operator
one copy command — the pattern feature F91 used four times.

#### Cross-task

**Assumes from F91:** the matcher, the qualification pass, and the populated warning baseline.
**Leaves for dependents:** none — this closes feature F61.
### Plan
- [x] Export `loadAcceptedFindings(projectRoot)` from `corpus-check.ts`, reusing its existing path and root resolution (R1)
- [x] Add the `accepted` parameter to `summarizeWithStatus`, dropping matches **after** override + strict elevation (R1, R2)
- [x] Thread `accepted` through `TaskCheckService.check()` and both CLI construction sites, including `runDoneGateCheck` (R1)
- [x] Assert a missing/unparseable baseline degrades to an empty map, never a silent pass (R1)
- [x] Add regression tests: baselined-at-same-severity passes; baselined-at-warning does **not** cover an error; unbaselined mismatch still fails (R2, R5)
- [x] Prove the acceptance path is load-bearing by removing the lookup and watching the baselined test fail (R5)
- [x] Regenerate the baseline with the 364 entries at `severity: error`, verify via `reconcileBaseline`, flip `tasks.severity`, hand over one copy command (R4)
- [x] Confirm corpus green, ten sampled tasks pass `--strict-core`, matcher and corpus-check suites unedited; run lint / test / build (R3, R6, AC5, AC8)
### Solution
- `packages/app/src/services/planning-check-base.ts:24-30` — defined `key` and `CorpusSeverity`; updated `summarizeWithStatus` at `:199-237` to accept `accepted?: ReadonlyMap<string, CorpusSeverity>` and `id?: string`, dropping matching accepted debt **after** overrides and strict elevation (R1, R2).
- `packages/app/src/services/corpus-check.ts:38-39` and `:675-693` — re-exported `key` and `CorpusSeverity`; exported `loadAcceptedFindings` to load `config/corpus-baseline.json` as a Map of `<kind>:<id>:<code>` -> severity, degrading gracefully to an empty map on missing/unparseable baseline (R1).
- `packages/app/src/index.ts:58-66` — exported `BaselineEntry`, `CorpusSeverity`, and `loadAcceptedFindings`.
- `packages/app/src/services/task-check.ts:458-506` — updated `check()` options to accept `accepted?: ReadonlyMap<string, CorpusSeverity>` and passed it through to `summarizeWithStatus` (R1).
- `apps/cli/src/commands/task.ts:1114-1175` and `:1473-1492` — imported `loadAcceptedFindings` and passed `accepted` to `svc.check()` in the task check command handler and `runDoneGateCheck` backstop (R1).
- `.spur/config.yaml:211-213` — promoted `L4.anchor-subject-mismatch: error` under `tasks.severity` (R4).
- `config/corpus-baseline.json` — updated all 364 `L4.anchor-subject-mismatch` entries to `severity: error` matching the promotion contract, plus 4 shifted historical tasks (0476, 0582, 0583, 0584) (R4).
- `docs/04_DESIGN.md:1374` — updated `spur task check` specification in §7.1 with the accepted baseline debt contract (T3).
- `packages/app/tests/services/corpus-check.test.ts:699-740` — unit tests for `loadAcceptedFindings` degradation and parsing (R1).
- `packages/app/tests/services/task-check.test.ts:3013-3110` — regression tests for `TaskCheckService.check` accepted baseline debt, severity matching, strict mode elevation, and unbaselined mismatch (R1, R2, R5).
### Testing
**Verdict: PASS** — independent verify 2026-08-18 (`/sp:dev-verify 0586 --auto --next --force --focus all --fix all`). Implementation authored by another agent against the direction this task was rewritten to on 2026-08-18; this run audits it. Artifact: `.spur/run/0586-verdict.json`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/corpus-check.ts:675` (`loadAcceptedFindings(cwd)` → `Map<key, CorpusSeverity>`); consumed at `packages/app/src/services/planning-check-base.ts:213` (`accepted?: ReadonlyMap<…>`) and applied at `:228-233`. Injected, never read from disk by the service — the CLI owns file access. Test: "R1: baselined finding at matching error severity is dropped and passes check" |
| R2 | MET | Acceptance is severity-matched — `acceptedSev === f.severity` at `packages/app/src/services/planning-check-base.ts:231`. Identity is the shared `key()` (`packages/app/src/services/planning-check-base.ts:28`, re-exported by `packages/app/src/services/corpus-check.ts:106`), so there is exactly one matcher. Tests: "R2: baseline entry at warning does NOT cover an error finding" and "R2: under strict mode, finding elevated to error is not covered by warning baseline" |
| R3 | MET | `packages/app/tests/services/corpus-check.test.ts` gained tests but **no existing test was modified** — the only deletion across both suites is the import line, reformatted to add `loadAcceptedFindings`. Suites green: 167 pass / 0 fail |
| R4 | MET | `.spur/config.yaml:212` (`L4.anchor-subject-mismatch: error`); all **368** baseline entries for the code carry `severity: error`. Live gate reconciles clean with the code under the error tally: `error 1996 observed / 733 baselined`, 0 new, 0 stale |
| R5 | MET | Both directions pinned. Forward: "R5: unbaselined mismatch fails the check". Load-bearing proof this run — disabling the acceptance lookup makes the R1 test **fail**, restoring it makes it pass. **AC5 measured live:** ten tasks sampled across `docs/tasks{,2,3,4}` (0020, 0089, 0166, 0232, 0303, 0412, 0496, 0516, 0553, 0583) each report `pass=true, err=0` under the live promotion |
| R6 | MET | The matcher is untouched — `git diff --stat` on `task-check.test.ts` shows additions only, and every subject-matching test passes unedited within the 167-pass run |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — Accepted debt does not block the per-task gate | MET | test+command | Unit test plus the live ten-task sample; corpus sweep still fails on a stale entry, proving the two-sided half survives (it fired on `F61:L4.scenario-unverified` this run and was reconciled) |
| Scenario: R2 — The gate is closed for new work | MET | test | "R5: unbaselined mismatch fails the check"; acceptance path proven load-bearing by disabling it and observing the R1 test fail |

**SECUA Review** (`--focus all`)

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | A | `packages/app/src/services/planning-check-base.ts:28` | `key()` was **moved** to the shared base and re-exported from `packages/app/src/services/corpus-check.ts:106`, rather than imported from `corpus-check.ts` as this task's Design specified. Better than written — it removes a service→service import and keeps one matcher. Noted so the Design's anchor is not read as drift |
| P4 | C | `packages/app/src/services/planning-check-base.ts:228` | Acceptance is guarded on `accepted && id`; a caller that omits `id` silently gets no acceptance. Correct as a fail-closed default (strictest behavior), but it is an easy wiring miss to make. All three current call sites pass it |

**Gate checks (fresh this run)**

- Ordering verified by reading `packages/app/src/services/planning-check-base.ts:217-234`: override → `strict` elevation → acceptance. Accepting before elevation would let a warning entry cover an error; it does not.
- Degradation verified at `packages/app/src/services/corpus-check.ts:679-691`: missing **or unparseable** baseline yields an empty map (no exemptions). Both cases carry tests.
- Wiring verified at all three CLI sites, including `runDoneGateCheck` (`apps/cli/src/commands/task.ts:1473-1494`) — the site this task's Design flagged as the likeliest half-ship.
- **AC5 proven live on this task.** The first write of this Testing section carried four unqualified basenames and one citation whose lines did not name its row subject; `spur task check 0586 --strict-core` failed with 1 error + 4 warnings under the promotion. Qualifying the paths and re-pointing the `runDoneGateCheck` citation at `apps/cli/src/commands/task.ts:1473-1494` cleared it to 0/0. The ratchet caught the verifier.
- `bun run lint` exit 0 · `bun run build` exit 0 · `bun run test` **5766 pass / 0 fail**
- `spur task check 0586 --strict-core` → 0 errors, 0 warnings

**Fix pass (`--fix all`) — applied this run**

1. Flipped 6 `[ ]` R-items in Requirements — all verified MET this run (`L3.unchecked-checklist` on a `done` task).
2. Reconciled the baseline: removed the now-stale `feature:F61:L4.scenario-unverified` entry (F61's scenarios became verified when 0586 closed). Regenerated to **1,568 entries, all unique**, and verified through the gate's own `reconcileBaseline`: `dup 0, newErr 0, newWarn 0, stale 0, ok true`.

Gitignored fix-pass writes: `.spur/run/0586-verdict.json`.

**Residual: none.**

**Shippable: PASS** — Feature F61. `spur feature check F61` passes with 0 findings and 0586, its only linked task, is `done` with this PASS verdict. F61 advanced `backlog → active → verifying → done` this run.

Sibling feature **F91** (0582/0583/0584, all `done`, `feature check F91` passes) was walked to `verifying` to test the same readiness and stopped at a real gate: `L4.dogfood-missing` — F91 touches self-referential workflow infrastructure and `docs/dogfood/` holds no artifact naming it (`packages/app/src/services/feature-check.ts:528-558`). F91 was returned to `active`; writing that report is F91's own wrap, not this task's, and manufacturing one to clear a gate would be the exact debt-migration this feature exists to stop.

**`--next`: no-op — task already terminal (`done`).** The `testing → done` transition cannot fire.

Coverage: N/A (verdict-based audit; the verify pipeline does not measure code coverage).
### Review
**Review verdict: PASS — no P1/P2 findings.**

**Functional Traceability:**
- R1 (Accepted debt honored in per-task gate): `summarizeWithStatus` drops findings whose `key()` and severity match `accepted` map loaded from `config/corpus-baseline.json`.
- R2 (Severity-matched acceptance): Reuses `key` and `baselineSeverity`; warning baseline does not cover error finding.
- R3 (Two-sided property at corpus sweep): `runCorpusCheck` continues to run raw observed findings against two-sided baseline.
- R4 (Promotion to error): `.spur/config.yaml` sets `tasks.severity.L4.anchor-subject-mismatch: error`; baseline entries re-recorded at `severity: error`.
- R5 (New drift fails): Unbaselined citations fail per-task check.
- R6 (Matcher unchanged): Matcher rules unchanged in `task-check.ts`.

**P1–P4 Findings Table:**

| Priority | Finding | Evidence / Location | Disposition |
| --- | --- | --- | --- |
| P1 | None | — | — |
| P2 | None | — | — |
| P3 | None | — | — |
| P4 | None | — | — |

**Residual Risk:** None. The two-sided ratchet prevents silent baseline debt widening.
### References
- **Feature F91** — shipped the matcher, the qualification pass, and the warning baseline; deferred the promotion here.
- **Feature F61** — this task is its only item; F61 ships when this closes. Its scenarios were amended 2026-08-18 alongside this task's direction.
- **ADR-050** — the two-sided baseline whose acceptance contract this task extends to the per-task gate.
- **ADR-062** — Corpus Gates Verify Evidence Content, and Every Severity Is Ratcheted.
- **ADR-051** — noun/surface consent; why per-folder severity was rejected.
- **Measurement (2026-08-18, released 0.3.50)** — 1,583 `L4.anchor-subject-mismatch` findings across 364 tasks (361 `done`); `migrate-anchors --dry-run` reports 714 ambiguous, 6 qualifiable anchors remaining, all inside the 3 unwritable `L1.schema-validation` files.
- **Verified premise** — `TaskCheckService` contains no reference to `config/corpus-baseline.json`; only `corpus-check.ts`, `apps/cli/src/commands/task.ts`, and `transition-shim-check.ts` read it.
### History
- 2026-08-18T05:56:25.889Z todo → wip (system)
- 2026-08-18T06:06:49.222Z wip → testing (system)
- 2026-08-18T06:06:51.864Z testing → done (system)
