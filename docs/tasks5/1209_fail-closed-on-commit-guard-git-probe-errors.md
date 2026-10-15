---
schema_version: 1
name: Fail closed on commit-guard Git probe errors
status: done
template: feature-impl
created_at: 2026-10-14T23:25:06.627Z
updated_at: "2026-10-15T01:11:43.069Z"
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

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `changedSinceBase` checks each probe status before consuming stdout and throws naming operation+status: `git diff --name-only failed (status N)` at `plugins/sp/scripts/commit-guard.ts:90`, `git ls-files --others failed (status N)` at `plugins/sp/scripts/commit-guard.ts:92`. `runCheck` wraps both scans — the `runContext` scan (`plugins/sp/scripts/commit-guard.ts:211`, throwing helper invoked at :124) and the second report scan (:214) — in one try/catch that writes the `commit-guard:`-prefixed diagnostic and returns 1 with no success JSON (`plugins/sp/scripts/commit-guard.ts:216-219`). Twin `.mjs` carries the identical logic (`plugins/sp/scripts/commit-guard.mjs:55,58`, runCheck try/catch at :179-191). Tests prove all four combinations {diff, ls-files} × {scan 1, scan 2} asserting exit 1, `commit-guard:` prefix, operation name, `failed (status 1)`, empty stdout: `plugins/sp/tests/commit-guard.test.ts:218-240`; fresh re-run this session: `bun test tests/commit-guard.test.ts` in plugins/sp → 20 pass / 0 fail (exit 0). Full repo gate (not re-run per instructions): `.spur/run/1209-test-gate.log`, exit 0, 10762 pass / 0 fail. |
| R2 | MET | `conflictingTarget` throws on a failed unmerged probe naming the operation: `plugins/sp/scripts/commit-guard.ts:155`. `runStage` guards `runContext` + `conflictingTarget` in one try/catch returning `{staged:[], foreign:[], exitCode:1}` (`plugins/sp/scripts/commit-guard.ts:181-188`); the `git add` call sits at `plugins/sp/scripts/commit-guard.ts:200`, after the guard, so it is unreachable after a failed probe. Tests count `git add` calls (0) and assert the index is empty after refusal: failed diff probe `plugins/sp/tests/commit-guard.test.ts:251-263`, failed unmerged probe on an otherwise stageable ordinary file :265-275, thrown GitRunner at the `main` boundary :277-291. Twin identical (`plugins/sp/scripts/commit-guard.mjs:120`, runStage guard :143-155, add :170). Verified in the same fresh 20/20 run. |
| R3 | MET | Success paths preserved vs base `5d6efc088776eb22e46808df900bfa68e987f384`: `git diff <base> -- plugins/sp/scripts/commit-guard.ts` shows no change to the `hashPath` body (`:56-59`, null on probe failure) and `missingStart` still returns exit 1 in both `runStage` (:183) and `runCheck` (:212); exit-code comment updated to name failed Git safety probes (`plugins/sp/scripts/commit-guard.ts:13`). Twin CLI smoke proves exit 0 (staged-ok JSON), exit 2 (foreign refusal), exit 3 (conflict refusal leaving the index untouched), and invalid `--base` → exit 1 without success JSON: `plugins/sp/tests/commit-guard.test.ts:302-339`. Twin imports remain standalone node builtins only (`child_process`, `fs`, `path` — `plugins/sp/scripts/commit-guard.mjs:5-7`), no relative-import or hand-edit drift. Pre-1209 1129 regression suite green in the fresh run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Failed change probes cannot certify a clean tree (req: R1): Given a valid start snapshot and otherwise successful probes, when diff or ls-files returns nonzero in either runContext or runCheck's second scan, then runCheck returns 1, names the failed operation/status on stderr and emits no success JSON; prove all four combinations in plugins/sp/tests/commit-guard.test.ts. | MET | test | Four-combination loop {diff, ls-files} × {scan 1 runContext, scan 2 report} with a per-probe nth-call failing injected GitRunner over real temp repos: `plugins/sp/tests/commit-guard.test.ts:218-240`, each test asserting exit 1, stderr starting `commit-guard:` and containing the probe name plus `failed (status 1)`, and empty stdout (no success JSON). Real-git invalid-`--base` check also exits 1 without JSON (`plugins/sp/tests/commit-guard.test.ts:241-247`). Static basis: both scans route through the throwing `changedSinceBase` (`plugins/sp/scripts/commit-guard.ts:90,92,124,214`). Fresh re-run this session: 20 pass / 0 fail, 104 expects. |
| AC2 — Failed safety probes cannot stage files (req: R2): Given an otherwise stageable ordinary file, when a changed-path or unmerged probe returns nonzero or the injected runner throws, then runStage returns {staged:[], foreign:[], exitCode:1}, emits an operation/error diagnostic and never calls git add; prove through injected GitRunner in plugins/sp/tests/commit-guard.test.ts. | MET | test | Three injected-GitRunner tests: failed changed-path (diff) probe refuses an otherwise stageable `a.txt` asserting `{staged:[], foreign:[], exitCode:1}`, `commit-guard:` diagnostic naming `diff`, `adds()===0`, empty index (`plugins/sp/tests/commit-guard.test.ts:251-263`); failed unmerged probe asserting the `--diff-filter=U` diagnostic with zero `git add` calls (:265-275); thrown GitRunner surfacing at the `main` entrypoint as exit 1 with no JSON (:277-291). Static basis: the guard's try/catch precedes the `git add` call (`plugins/sp/scripts/commit-guard.ts:181-188` vs :200). Verified in the same fresh 20/20 run. |
| AC3 — Shipped guard preserves successful behavior (req: R3): Given source and regenerated node CLI running against temporary repositories, when probes succeed, foreign files or conflict markers exist, then existing success JSON and exit 0/2/3 behavior remain and refused conflict leaves the index unchanged; an invalid-base check exits 1 without successful foreign JSON. Prove in plugins/sp/tests/commit-guard.test.ts and preserve standalone generated imports. | MET | test | Twin CLI smoke spawns `node` with the absolute regenerated `commit-guard.mjs` path, cwd = temp repo (`plugins/sp/tests/commit-guard.test.ts:302-339`): exit 0 `{staged:['a.txt'],foreign:[]}`, check `{foreign:['b.txt']}`, exit 2 foreign refusal, exit 3 conflict refusal with index unchanged (`staged(cwd)===['a.txt']`), invalid `--base` → status 1, stderr starts `commit-guard:`, stdout without `foreign`. Pre-1209 1129 staging/foreign/conflict/missing-snapshot suite green in the same run. Standalone imports preserved: `plugins/sp/scripts/commit-guard.mjs:5-7` imports only `child_process`, `fs`, `path` (static-ref this session). |
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

