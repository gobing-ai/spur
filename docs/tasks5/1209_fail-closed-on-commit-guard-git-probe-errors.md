---
schema_version: 1
name: Fail closed on commit-guard Git probe errors
status: todo
template: feature-impl
created_at: 2026-10-14T23:25:06.627Z
updated_at: "2026-10-14T23:34:26.415Z"
feature_id: H1

priority: P2
ac_altitude: task-local
estimate_hours: 2
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

- [ ] R1. commit-guard check returns nonzero and a diagnostic when either changed-path probe fails; it must not emit a successful empty foreign-file report.
- [ ] R2. commit-guard stage refuses before git add when a required changed-path or unmerged-conflict probe fails.
- [ ] R3. Successful snapshots, foreign-file detection, staging and conflict-marker refusals retain their current behavior and JSON shapes.

Out of scope: authorship tracking for post-start foreign edits, write journals, pathname parsing redesign, new subcommands/options, corpus edits and staging real operator changes.

### Acceptance Criteria

- [ ] AC1 — Failed change probes cannot certify a clean tree (req: R1): Given a valid start snapshot and otherwise successful probes, when diff or ls-files returns nonzero in either runContext or runCheck's second scan, then runCheck returns 1, names the failed operation/status on stderr and emits no success JSON; prove all four combinations in plugins/sp/tests/commit-guard.test.ts.
- [ ] AC2 — Failed safety probes cannot stage files (req: R2): Given an otherwise stageable ordinary file, when a changed-path or unmerged probe returns nonzero or the injected runner throws, then runStage returns {staged:[], foreign:[], exitCode:1}, emits an operation/error diagnostic and never calls git add; prove through injected GitRunner in plugins/sp/tests/commit-guard.test.ts.
- [ ] AC3 — Shipped guard preserves successful behavior (req: R3): Given source and regenerated node CLI running against temporary repositories, when probes succeed, foreign files or conflict markers exist, then existing success JSON and exit 0/2/3 behavior remain and refused conflict leaves the index unchanged; an invalid-base check exits 1 without successful foreign JSON. Prove in plugins/sp/tests/commit-guard.test.ts and preserve standalone generated imports.

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

- [ ] R1/R2: add injected-GitRunner failures for diff and ls-files in the initial runContext scan and the second runCheck scan; use a valid temporary start snapshot and assert exit 1, operation/status diagnostic and no success JSON.
- [ ] R2: add stage failures for changed-path and unmerged probes, with an otherwise stageable ordinary target; assert empty staged/foreign arrays and zero git add calls. Cover a thrown GitRunner failure at the public entrypoint boundary.
- [ ] R1/R2/R3: throw native Error from the two private safety-probe helpers, catch it in runCheck/runStage, and keep the exported shapes, existing missing-start behavior and exit 0/2/3 paths.
- [ ] Regenerate commit-guard.mjs using superskill script convert sp commit-guard.ts; exercise source and node-twin CLI in temporary repositories with invalid --base and successful/foreign/conflict cases (R1/R3).
- [ ] Run bun test tests/commit-guard.test.ts inside plugins/sp; then the task pipeline's gate and verify. Record generated-twin and unchanged-index evidence under .spur/run/1209-*; do not stage unrelated dirty files.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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

