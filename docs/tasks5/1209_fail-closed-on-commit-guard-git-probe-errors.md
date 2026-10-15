---
schema_version: 1
name: Fail closed on commit-guard Git probe errors
status: done
template: feature-impl
created_at: 2026-10-14T23:25:06.627Z
updated_at: "2026-10-15T02:42:35.459Z"
feature_id: H1

priority: P2
ac_altitude: task-local
estimate_hours: 2
done_forced: "false"
done_reason: unforced close
---

## 1209. Fail closed on commit-guard Git probe errors

### Background

Inline advisory review on 2026-10-14 reproduced commit-guard false success. `plugins/sp/scripts/commit-guard.ts:102` returns an empty change set when git diff or ls-files fails; `plugins/sp/scripts/commit-guard.ts:208` then emits {foreign:[]} and exits zero. With a valid start snapshot and injected GitRunner returning status 1 for every later probe, runCheck returned 0. Separately, the conflict scan at `plugins/sp/scripts/commit-guard.ts:163` ignores the unmerged-probe status: a forced failure there, with successful change probes and an ordinary target, allowed git add and returned exit 0. Reproducer and output: `.spur/run/review-audit.ts` and `.spur/run/review-audit.log` (gitignored).

H1 owns driver staging discipline. No existing non-terminal task owns this defect. The review directly fixed unrelated composite-primary-key metadata in DatabaseInspector; no database work belongs here.

**Refine corrections (2026-10-14)**
- Design left throw versus typed private result to the implementer → select native Error propagation from the private failed probes, with existing public entrypoints mapping it to exit 1; no new error class or exported type.
- Plan did not distinguish repeated changed-path scans → runContext scans once and runCheck scans again → test failures in either scan for diff and ls-files, ensuring no second-scan false success.
- Evidence anchor 101 pointed to the ls-files invocation → the failed-probe-to-empty-set branch is at line 102 → corrected the Background anchor.

The fresh audit independently reproduced diff failure and ls-files failure returning runCheck exit 0; original unmerged-probe stage reproduction remains valid in the current unchanged source. All issues remain valid, with none dropped. Evidence: .spur/run/refineall-1208-1209-audit.ts and .spur/run/refineall-1208-1209-audit.log (gitignored).

### Requirements

- [x] R1. commit-guard check returns nonzero and a diagnostic when either changed-path probe fails; it must not emit a successful empty foreign-file report.
- [x] R2. commit-guard stage refuses before git add when a required changed-path or unmerged-conflict probe fails.
- [x] R3. Successful snapshots, foreign-file detection, staging and conflict-marker refusals retain their current behavior and JSON shapes.

Out of scope: authorship tracking for post-start foreign edits, write journals, pathname parsing redesign, new subcommands/options, corpus edits and staging real operator changes.

### Acceptance Criteria

- [x] AC1 — Failed change probes cannot certify a clean tree (req: R1): Given a valid start snapshot and otherwise successful probes, when diff or ls-files returns nonzero in either runContext or runCheck's second scan, then runCheck returns 1, names the failed operation/status on stderr and emits no success JSON; prove all four combinations in plugins/sp/tests/commit-guard.test.ts.
- [x] AC2 — Failed safety probes cannot stage files (req: R2): Given an otherwise stageable ordinary file, when a changed-path or unmerged probe returns nonzero or the injected runner throws, then runStage returns {staged:[], foreign:[], exitCode:1}, emits an operation/error diagnostic and never calls git add; prove through injected GitRunner in plugins/sp/tests/commit-guard.test.ts.
- [x] AC3 — Shipped guard preserves successful behavior (req: R3): Given source and regenerated node CLI running against temporary repositories, when probes succeed, foreign files or conflict markers exist, then existing success JSON and exit 0/2/3 behavior remain and refused conflict leaves the index unchanged; an invalid-base check exits 1 without successful foreign JSON. Prove in plugins/sp/tests/commit-guard.test.ts and preserve standalone generated imports.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-14T23:26:08.186Z

Closed: probe failure is exit 1, distinct from foreign refusal 2 and conflict refusal 3; no retries or partial staging after a failed probe. Use task-local AC under H1 because this is regression hardening. No open decisions.

#### Q&A entry — 2026-10-14T23:34:26.078Z

Ready audit decisions closed: use native Error in the private probes, caught at runCheck/runStage with exit 1 and stderr; no exported error/result types. Guard both runCheck scans. Preserve hashPath's null/deletion behavior and do not refactor scanning or staging. Generated .mjs changes only through verified Superskill conversion. No open decisions.

### Design

WHAT: Distinguish failed Git safety probes from successful empty results. WHY: a failed probe supplies no proof that a tree is clean or safe to stage.

WHERE: plugins/sp/scripts/commit-guard.ts, generated plugins/sp/scripts/commit-guard.mjs, plugins/sp/tests/commit-guard.test.ts. Preserve all exported signatures, StageResult and success JSON shapes. No new public API, option, error class, dependency or abstraction.

Frozen error policy: changedSinceBase checks each GitRunResult.status before consuming stdout and throws native Error naming the operation and status when diff --name-only or ls-files --others --exclude-standard -z fails. conflictingTarget applies the same rule to diff --name-only --diff-filter=U. Keep these helpers private. runCheck and runStage catch probe errors around the probes they invoke (including runContext); write one commit-guard-prefixed stderr diagnostic and return exit 1. runStage returns {staged:[], foreign:[], exitCode:1} and calls no git add after a failed safety probe; runCheck emits no success JSON. Preserve missing snapshot handling, conflict refusal 3 and foreign refusal 2. Do not change hashPath's deletion/null semantics or invent guarantees about a failing git add.

runCheck performs a changed-path scan through runContext and another scan for its report: both must be guarded and tested. Do not refactor away the duplicate scan as part of this fix; reducing it could change snapshot/report semantics and is unnecessary for closing the error path.

Tests use the existing GitRunner injection with a valid temporary start snapshot, one forced nonzero probe and otherwise successful probes. Count git add calls. Cover both changed-path scans, and an unmerged probe failure with an otherwise stageable ordinary file. Existing real-repository staging/foreign/conflict tests retain their behavior. Extend test-local capture to accept injected options rather than mutating a global Git function. CLI smoke tests spawn node with the absolute repository path to the regenerated commit-guard.mjs, cwd set to a temporary repository and invalid --base, capturing status/stdout/stderr. Do not use a repository-relative script path after switching cwd to the fixture.

Regenerate via superskill script convert sp commit-guard.ts (verified against local CLI help and dry-run). Run node plugins/sp/scripts/commit-guard.mjs in isolated fixture repositories; never hand-edit the twin. Update the exit-code comment to include Git probe failures; driver runbooks already halt on nonzero and require no new public surface. Generated code must preserve standalone node builtin/relative imports.

Rejected: failed probe as empty Set (false success); typed-result union/new error class (unneeded private machinery); retries, best-effort staging, write journals or a wider path set (outside the fix).

Execution boundary: estimate 2 hours, one task pipeline, partial evidence under .spur/run/1209-*. A source/twin change is expected, so requireDiff remains enabled. No pending dependencies; 1208 is independent. Audit found one worktree and no WIP tasks. The prior unrelated composite-key fix must not enter a 1209 commit; recheck clean task ownership before implementation.

### Plan

- [x] R1/R2: add injected-GitRunner failures for diff and ls-files in the initial runContext scan and the second runCheck scan; use a valid temporary start snapshot and assert exit 1, operation/status diagnostic and no success JSON.
- [x] R2: add stage failures for changed-path and unmerged probes, with an otherwise stageable ordinary target; assert empty staged/foreign arrays and zero git add calls. Cover a thrown GitRunner failure at the public entrypoint boundary.
- [x] R1/R2/R3: throw native Error from the two private safety-probe helpers, catch it in runCheck/runStage, and keep the exported shapes, existing missing-start behavior and exit 0/2/3 paths.
- [x] Regenerate commit-guard.mjs using superskill script convert sp commit-guard.ts; exercise source and node-twin CLI in temporary repositories with invalid --base and successful/foreign/conflict cases (R1/R3).
- [x] Run bun test tests/commit-guard.test.ts inside plugins/sp; then the task pipeline's gate and verify. Record generated-twin and unchanged-index evidence under .spur/run/1209-*; do not stage unrelated dirty files.

### Solution

**WHAT/WHY**: A failed Git safety probe previously collapsed to an empty change set, which the guard misread as "tree is clean/safe" — a false success that could sweep foreign changes or stage blind (probe failure ≠ clean tree). Now each private safety probe throws a native `Error` naming the operation and status; the public entrypoints catch it, emit one `commit-guard:`-prefixed stderr diagnostic, and exit 1 (distinct from foreign refusal 2 and conflict refusal 3). No retries, no partial staging, no new error class or exported type.

**R1 — check fails closed (plugins/sp/scripts/commit-guard.ts)**
- `changedSinceBase` throws per probe before consuming stdout: `diff --name-only` at commit-guard.ts:102, `ls-files --others --exclude-standard -z` at commit-guard.ts:104-105 (replaces the failed-probe→`new Set()` branch at the old line 102).
- `runCheck` wraps both scans — the `runContext` scan and the second report scan (duplicate scan preserved by design) — in one try/catch: commit-guard.ts:222-233; on catch it writes the diagnostic (commit-guard.ts:232) and returns 1 with no success JSON.
- Tests: four-combination proof {diff, ls-files} × {scan 1, scan 2} in plugins/sp/tests/commit-guard.test.ts (AC1 loop, "a failed changed-path probe cannot certify a clean tree"), each asserting exit 1, `commit-guard:`-prefixed operation/status diagnostic, empty stdout; plus a real-git invalid-`--base` check exiting 1 with no JSON.

**R2 — stage refuses before git add**
- `conflictingTarget` applies the same rule to the unmerged gate `diff --name-only --diff-filter=U`: commit-guard.ts:168-169.
- `runStage` guards `runContext` + `conflictingTarget` in one try/catch (commit-guard.ts:192-201): returns `{staged:[], foreign:[], exitCode:1}`, writes the diagnostic, and `git add` sits after the guard so it is unreachable after a failed probe (comment at commit-guard.ts:199). Shared diagnostic helper `probeDiagnostic` at commit-guard.ts:182-185.
- Tests: changed-path (diff) probe failure, unmerged-probe failure with an otherwise stageable ordinary file, and a thrown injected GitRunner at the `main` boundary — all assert `{staged:[], foreign:[], exitCode:1}` / exit 1, empty stdout, zero counted `git add` calls, index unchanged (plugins/sp/tests/commit-guard.test.ts, "failed safety probes never reach git add").

**R3 — shipped behavior preserved**
- Exported signatures, `StageResult`, success JSON shapes, exit 0/2/3 semantics, missing-snapshot handling, `hashPath` null/deletion semantics untouched; exit-code comments updated to name failed Git safety probes (commit-guard.ts:13, commit-guard.ts:49).
- Existing real-repo staging/foreign/conflict tests stay green (20/20 in the file), including refused-conflict-leaves-index-unchanged.

**Regeneration proof**: twin rebuilt only via `superskill script convert sp commit-guard.ts` (local CLI help + `--dry-run` verified first; dry-run then real run reported 7966 bytes written). Twin imports remain standalone node builtins (`child_process`, `fs`, `path`); node-twin CLI smoke in plugins/sp/tests/commit-guard.test.ts ("regenerated node twin CLI") spawns `node` with the absolute .mjs path, cwd = temp repo, proving exit 0/2/3 preserved and invalid `--base` → exit 1 without success JSON.

**Verification**: `bun test tests/commit-guard.test.ts` in plugins/sp → 20 pass / 0 fail (104 expects); Biome clean on both hand-edited files (generated .mjs is biome-excluded). No deviations from the frozen Design.

**Verification regression improvements (2026-10-15).** Fresh forced verification extended `plugins/sp/tests/commit-guard.test.ts:251` so both diff and ls-files probe failures before staging return `{staged:[], foreign:[], exitCode:1}`, name the operation, emit no success JSON, call no git add and leave the index untouched. Existing four check-probe/scan combinations, unmerged and thrown-runner refusals, and the Node twin exit 0/2/3 plus invalid-base smoke remain. Fresh focused result: 21 tests, 111 assertions, zero failures. Superskill conversion dry-run succeeded; no source or generated script change was needed. Final verification/gate evidence is owned by the fresh Testing record.

**Forced verification close-out (2026-10-15).** `bun run spur-check` exited 0: lint/typechecks, all 51 pre-check rules, 10770 tests across 614 files (0 failures), certified coverage and both post-check rules. Log: `.spur/run/verifyall-1208-1209-gate-final.log`. Fresh canonical verdicts for 1208 and 1209 are PASS and post-record residual folds remain PASS. Source anchors: `packages/app/src/services/board-catalog-service.ts:166` (canonical startup refusal), `apps/server/src/modules/board/index.ts:97` (request gate), `plugins/sp/scripts/commit-guard.ts:181` (staging refusal before add).

Both were already done at intake; --next is an idempotent no-op, without status demotion or forced-done override. The mixed A8/H1 batch has Shippable N/A under the shared-feature rule. Additional owner checks each pass with zero findings: A8 has 9 complete linked tasks; H1 has 18. The original Review sections are preserved. Full results and current artifact paths: `.spur/run/verifyall-1208-1209-report.md`. No commit was made; no live browser or external-agent session was launched.

**Final shippable confirmation (2026-10-15).** No remaining in-scope work. Task verdict PASS, strict-core check PASS and fresh residual scan/fold PASS with zero items. H1 check PASS with zero findings and all 18 linked tasks complete. The source and generated guard retain fail-closed behavior; regression evidence: `plugins/sp/tests/commit-guard.test.ts:251` and `plugins/sp/tests/commit-guard.test.ts:306`.

The full task gate passed 10770 tests with no failures (`.spur/run/verifyall-1208-1209-gate-final.log`). Fresh `bun run spur-check-feature` exited 0: all structural checks, 10 repository-wide tests and 28 heavy tests passed (`.spur/run/ship-1208-1209-feature-gate.log`). Coverage provenance still validates after the feature run. Final report: `.spur/run/ship-1208-1209-report.md`. No commit made; no separate live browser/external-agent session launched.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/scripts/commit-guard.ts:90` and `plugins/sp/scripts/commit-guard.ts:92` reject failed diff and ls-files probes; `plugins/sp/scripts/commit-guard.ts:209` catches both changed-path scans before success JSON. `plugins/sp/tests/commit-guard.test.ts:218` exercises all four probe/scan combinations plus an invalid-base CLI check; fresh 21-test suite passed. |
| R2 | MET | `plugins/sp/scripts/commit-guard.ts:155` refuses an unmerged probe failure; `plugins/sp/scripts/commit-guard.ts:181` catches safety-probe failures before git add. `plugins/sp/tests/commit-guard.test.ts:251` proves both diff and ls-files stage failures return empty arrays with zero add calls; `plugins/sp/tests/commit-guard.test.ts:269` proves unmerged refusal and the thrown runner case. Fresh 21-test suite passed. |
| R3 | MET | `plugins/sp/tests/commit-guard.test.ts:306` executes the shipped Node twin against real temp repositories and pins success/foreign/conflict exit 0/2/3, unchanged index on conflict and invalid-base exit 1 without success JSON. Existing source regressions and the standalone builtin-only twin imports passed inspection; Superskill conversion dry-run succeeded without rewriting generated code. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Failed change probes cannot certify a clean tree (req: R1): Given a valid start snapshot and otherwise successful probes, when diff or ls-files returns nonzero in either runContext or runCheck's second scan, then runCheck returns 1, names the failed operation/status on stderr and emits no success JSON; prove all four combinations in plugins/sp/tests/commit-guard.test.ts. | MET | test | `plugins/sp/tests/commit-guard.test.ts:218` proves diff and ls-files failures in runContext and the second report scan, each with exit 1, operation/status stderr and no success JSON; the real invalid-base check also passed in the fresh 21-test run. |
| AC2 — Failed safety probes cannot stage files (req: R2): Given an otherwise stageable ordinary file, when a changed-path or unmerged probe returns nonzero or the injected runner throws, then runStage returns {staged:[], foreign:[], exitCode:1}, emits an operation/error diagnostic and never calls git add; prove through injected GitRunner in plugins/sp/tests/commit-guard.test.ts. | MET | test | `plugins/sp/tests/commit-guard.test.ts:251` proves diff and ls-files stage failures return empty staged/foreign arrays and zero git add calls; `plugins/sp/tests/commit-guard.test.ts:269` and the following thrown-runner case retain unmerged/exception refusal and unchanged index. Fresh 21-test run passed. |
| AC3 — Shipped guard preserves successful behavior (req: R3): Given source and regenerated node CLI running against temporary repositories, when probes succeed, foreign files or conflict markers exist, then existing success JSON and exit 0/2/3 behavior remain and refused conflict leaves the index unchanged; an invalid-base check exits 1 without successful foreign JSON. Prove in plugins/sp/tests/commit-guard.test.ts and preserve standalone generated imports. | MET | test | `plugins/sp/tests/commit-guard.test.ts:306` uses the absolute regenerated .mjs entry under Node with fixture cwd to prove exit 0/2/3 parity, unchanged index on conflict and invalid-base exit 1 without success JSON. Shipped imports remain builtins and conversion dry-run leaves the twin unchanged. Fresh 21-test run passed. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: H1 — spur-dev umbrella skill.
- Driver caller: plugins/sp/skills/spur-dev/references/execution-batch-report.md:191.
- Intake evidence: `.spur/run/review-audit.ts` and `.spur/run/review-audit.log` (gitignored).
- Generated script: plugins/sp/scripts/commit-guard.mjs; regenerate through Superskill.
- Fresh audit: .spur/run/refineall-1208-1209-audit.ts and .spur/run/refineall-1208-1209-audit.log (gitignored).
- Private helper/callers: plugins/sp/scripts/commit-guard.ts:99, plugins/sp/scripts/commit-guard.ts:121, plugins/sp/scripts/commit-guard.ts:163, plugins/sp/scripts/commit-guard.ts:180 and plugins/sp/scripts/commit-guard.ts:208.
- Current source and .mjs both contain the reviewed failed-probe behavior; conversion CLI confirmed locally through help/dry-run.
- Readiness/ownership: todo, feature H1 active; one worktree and no WIP tasks at audit. Prior unrelated composite-key changes remain dirty.

### History

- 2026-10-14T23:26:13.719Z backlog → todo (system)
- 2026-10-15T01:11:02.776Z todo → wip (system)
- 2026-10-15T01:11:03.530Z wip → testing (system)
- 2026-10-15T01:11:43.065Z testing → done (system)

