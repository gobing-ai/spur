---
template: issue
schema_version: 1
name: "Post-mortem (task 0486): implement-skill sibling-task conflation, precheck auth gate, and large-task executor sizing"
description: ""
status: done
type: issue
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-09T05:50:21.046Z"
updated_at: "2026-08-09T21:48:35.820Z"
---

## 0487. Post-mortem (task 0486): implement-skill sibling-task conflation, precheck auth gate, and large-task executor sizing

### Background

Driving task 0486 (`/sp:dev-find-conflict`) through `task-pipeline.yaml` on 2026-08-08/09 consumed several hours and **four pipeline runs** (`d5f4f7cd` failed precheck size, `ca130182` omp timed out at 30 min, `e8cb00e7` cancelled — wrong executor var, `b16bfbf4` cancelled — claude re-conflated) before the task was completed via a **manual inline force-done**.

The 0486 deliverable itself is sound (all structural gates green; force-done with honest `done_reason`). The **process** failed in repeatable, fixable ways. This task captures every finding from that session with run-ID/file:line evidence and a concrete fix proposal, so each can be implemented independently. Findings are ordered by severity; Finding 1 (implement-stage sibling-task conflation) is the dominant time sink and the highest-value fix.

#### Verification pass (2026-08-09 review, pre-implementation)

Every finding was re-verified against the tree; all seven hold. Corrections applied to the original draft:

- **0485's code landed (commit `c8ecfb4a`) but task 0485 remains `status: todo`** — that mismatch is the exact conflation magnet from Finding 1 (a committed-but-todo task sitting in the tree), and it is still live: an implement pass for 0487 runs the same risk until 0485's status is resolved.
- Finding 2's fix target was split across two files (see Design §R3); the doctor JSON `tier` field is the _support_ tier, NOT the capability tier — using it would be a bug.
- Finding 3's doctor shell is at pipeline ~L117-127 (not ~L150) and probes only `$agent` — `$implementAgent` is never probed.
- Finding 4's residual gap is confirmed in the landed 0485 code, and fixing it requires updating a landed 0485 test (named in Design §R4).
- Finding 7 gained a third sub-item: a latent `extractReviewSectionBody` parsing bug found in the same file during review (Design §R7c).
- Stale references fixed: pipeline edits target `config/workflows/task-pipeline.yaml` (tracked SSOT; `.spur/workflows/` is a symlink), `resolveDefaultAgentVar` is at `workflow-service.ts:1092` (not ~1060), `requireDiff` is at pipeline L186 / `agent-run.ts:318` (not ~L182).
- **Self-application:** this task has 7 R-items, which FAILS the size precheck (max 5) — measured with the real script. The pipeline run for 0487 must pass `--vars '{"maxImplementReqs":"10"}'` (see Notes).

### Requirements
- [x] R1. **Scope the implement stage to the target WBS** — `/sp:dev-run --mode implement <wbs>` must not pull in or implement other `todo`/`wip` tasks found in the tree; add a diff-scope guard so non-corpus changes outside the target task's declared surfaces fail the implement step naming the rogue file(s). (Finding 1, S0)
- [x] R2. **Fail precheck when a resolved executor is unauthenticated** — probe BOTH `$agent` and `$implementAgent` via `spur agent doctor <exec> --json`; when either reports `authenticated: "unauthenticated"`, write FAIL to the doctor status file so the run routes to `failed` naming the executor and the missing provider key. CLI doctor exit semantics stay unchanged. (Finding 3, S1)
- [x] R3. **Large-task executor sizing gate** — when the task exceeds the size caps (> 5 R-items or > 8 Plan items) AND the resolved implement executor's capability tier is below `capable-1`, the size precheck emits a blocking finding requiring `--agent <capable>` / `--vars '{"implementAgent":...}'` or an explicit split, instead of silently dispatching a flash model into the 30-min timeout. Tier source is the declared `tier` in `agent.executors` (inference via the shared `getExecutorTier` when undeclared), NOT the doctor JSON `tier` field. (Finding 2, S1)
- [x] R4. **Eliminate the `agent` vs `implementAgent` footgun** — when the caller sets `vars.agent` but not `vars.implementAgent`, inject `implementAgent := vars.agent` (caller choice outranks `agent.default`); the `agent.default` injection from 0485 remains the fallback when neither is caller-set. (Finding 4, S2)
- [x] R5. **Document the one-writer-per-repo coordination rule** — no code fix; add an AGENTS.md + `cross-cutting.md` note that two concurrent agent sessions in one working tree will clobber each other, and that parallel agent work uses git worktree isolation. (Finding 5, S1 — process)
- [x] R6. **Commit-per-task hygiene** — surface a pre-launch "working tree has uncommitted non-corpus changes" warning (with the file list) so a task is not started on a tree dirty with another task's implementation; document commit-per-task in AGENTS.md. (Finding 6, S2 — hygiene)
- [x] R7. **Review gate robustness + force-done path** — (a) accept prose severity cells like `P1 (blocker)` in `hasPopulatedPriorityTable`; (b) document or auto-perform the `todo→wip→testing→done` hops so `--force-done` reaches `done` from any pre-state; (c) fix the `extractReviewSectionBody` lookahead that truncates Review bodies at a literal `Z` and fails to match when Review is the last section. (Finding 7, S2)

### Acceptance Criteria
```gherkin
Feature: 0486-session post-mortem hardening

  @core
  Scenario: R1 — implement stage stays scoped to the target WBS
    Given a repo with a target task 0486 and an unrelated still-todo task 0485 in the tree
    When the pipeline runs `/sp:dev-run --mode implement 0486`
    Then the implementer reads only 0486's task file and its declared dependencies
    And it does not implement or modify 0485's owning surfaces
    And a post-implement diff-scope guard rejects any non-corpus change outside 0486's allowlist
    And on an out-of-scope change the run routes to `failed` naming the rogue file(s)
    And the guard is disabled when the run var `implementScopeGuard` is "off"
    And pre-existing out-of-scope dirt is not attributed to the implementer

  @core
  Scenario: R2 — precheck fails on an unauthenticated executor
    Given the resolved `$agent` or `$implementAgent` reports `authenticated: "unauthenticated"`
    When the pipeline runs precheck
    Then the doctor status file is written FAIL
    And the run routes to `failed` with a message naming the executor and the missing provider key
    And it does not proceed to implement
    And `spur agent doctor` CLI exit-code semantics are unchanged

  @core
  Scenario: R3 — oversized task with a sub-capable executor is blocked
    Given a task exceeds the size caps (> 5 R-items or > 8 Plan items)
    And the resolved implement executor's capability tier is below `capable-1`
    When the pipeline runs the size precheck
    Then it writes FAIL with a finding requiring `--agent <capable>` or an explicit split
    And the finding names the resolved executor and its tier
    And an executor with no declared/inferrable tier is treated as `standard`

  @core
  Scenario: R4 — explicit `vars.agent` reaches the implement hop
    Given `spur workflow run` is invoked with `--vars '{"agent":"claude"}'` and no `implementAgent`
    When the workflow resolves agent vars
    Then `implementAgent` is injected as `claude` (not `agent.default`)
    And the landed 0485 AC2 second-case test is updated to the new expectation
    And when caller sets neither var, the 0485 `agent.default` injection behavior is unchanged

  Scenario: R5 — [docs-only] concurrent agent work uses worktree isolation
    Given two agent sessions need to write in parallel
    When an agent reads the project and portable harness guidance
    Then both contracts require one writer per working tree
    And they route parallel writers to isolated git worktrees

  Scenario: R6 — dirty-tree precheck warning names non-corpus files
    Given a task starts with uncommitted non-corpus changes
    When the pipeline runs precheck
    Then it prints a warning with the dirty file list
    And the warning recommends committing or stashing before the new task
    And the warning does not block the run

  Scenario: R7 — Review gate accepts prose severities and parses robustly
    Given a Review table row with severity cell `P1 (blocker)` and real content
    Then `hasPopulatedPriorityTable` accepts it
    And a Review body containing an uppercase `Z` is parsed in full
    And a Review section that is the task file's last section still matches
    And `--force-done` from `todo` either auto-traverses wip→testing→done or the hops are documented in `--help`
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Each finding is independently implementable. Severity: S0 (critical/major time sink) → S2 (minor). "Effort" is a rough implementer estimate.

#### R1 — implement WBS-scoping (Finding 1, S0 / medium) — HIGHEST VALUE

- **Problem:** `/sp:dev-run --mode implement <wbs>` does not constrain its context to the target WBS. `sp:code-implementation` has anti-drive-by rules (`plugins/sp/skills/code-implementation/SKILL.md:101,110`) but NO rule against reading/implementing sibling `todo` tasks — so agents emergently pull freshly-committed-but-still-`todo` work into the diff. (The original draft said the skill's context-gathering "pulls sibling tasks" — overstated; no such instruction exists, the pull is emergent. The fix is the same.)
- **Evidence:** omp run `ca130182` and claude run `b16bfbf4` BOTH wrote a `redactAndBound` secret-redaction feature + `0485 R6` tests while implementing **0486**. 0486's own deliverables do NOT reference redaction/secrets/0485 (`rg 'redact|secret|0485' plugins/sp/commands/dev-find-conflict.md plugins/sp/skills/conflict-finding/` → clean — re-verified 2026-08-09). A third agent (Codex, PID 4087) hit the same conflation — skill-level, not model-specific.
- **Fix (two layers):**
  1. **Scope the context** — in `plugins/sp/skills/code-implementation/SKILL.md` (+ `references/implementation-patterns.md` if it carries context-gathering text): instruct the implementer to read ONLY the target WBS task file + its `dependencies`/`feature_id` + declared plan targets, and to explicitly IGNORE other `todo`/`wip` tasks in the tree even when recently changed.
  2. **Diff-scope guard** — extend the implement step's `requireDiff` path (`config/workflows/task-pipeline.yaml:186`, `packages/app/src/workflow/actions/agent-run.ts:318`, machinery at `:699 gitHasNonCorpusChanges`). Frozen contract:
     - Allowlist = path prefixes extracted from backticked file paths in the target task's body (Requirements/Design/Plan) + corpus dirs (already excluded) + any new file in the SAME directory as an allowlisted path.
     - Post-implement `git status --porcelain`: any non-corpus changed file outside the allowlist → route to `failed`, message names the rogue file(s).
     - Escape hatch: run var `implementScopeGuard: "off"` (documented in the YAML vars comment).
     - This contract would have caught the 0486 conflation: 0486's task body names only `plugins/sp/**` paths; the redaction work touched `packages/app/**` → blocked.

#### R2 — precheck auth gate (Finding 3, S1 / small) — HIGH LEVERAGE

- **Problem:** `agent.default: omp-dsv4-flash-volc` has no volc API key; precheck doctor prints `auth: no` but the run proceeds. Re-verified: `AgentService.doctor` exits 1 only when a probed agent is `!usable && tier === 1` (`packages/app/src/services/agent-service.ts:353`), and `usable` = installed + version detected — auth plays no role.
- **Evidence:** run logs (`e8cb00e7`, `b16bfbf4`) precheck: `✓ omp-dsv4-flash-volc status: usable auth: no detail: API key not found for provider 'volc'` → precheck ✓, run continues to a guaranteed implement failure.
- **Fix (frozen):** rewrite the precheck doctor shell (`config/workflows/task-pipeline.yaml:~117-127`) to use `--json`:
  - Probe BOTH `$agent` and `$implementAgent`: `spur agent doctor <exec> --json` → `.agents[0].authenticated` (field verified present; values `authenticated|unauthenticated|…`).
  - Write FAIL when EITHER probes `unauthenticated`, or when the doctor command itself exits non-zero (existing semantic preserved); include the doctor `detail` line (names the missing provider key) in the status/log.
  - `unknown` auth states keep today's soft behavior (PASS with the printed warning).
  - Do NOT change `spur agent doctor` CLI exit-code semantics (standalone diagnostic UX; the `modelStatus` quota warning stays warn-not-block).

#### R3 — size-vs-tier gate (Finding 2, S1 / small)

- **Problem:** A 7-req / 9-plan-item / 12+ file task cannot be completed by a `standard`-tier flash model in the 30-min `implementTimeoutMs`. Evidence: run `ca130182` exit 3 at `1800036ms`; partial artifact shows 6/12 files, no tests/docs/Solution.
- **Fix (frozen):** the size precheck is TWO files — pure logic `packages/app/src/services/task-size-precheck.ts`, thin CLI wrapper `plugins/sp/scripts/task-size-precheck.ts` (the YAML call site invokes the script, `config/workflows/task-pipeline.yaml:~152-160`).
  - Script gains `--executor <name>`; YAML passes `--executor "$implementAgent"`.
  - Tier lookup: script imports the config loader (`@gobing-ai/spur-config`) + the SHARED `getExecutorTier` — export it from `packages/app/src/services/agent-service.ts:1371` (do NOT duplicate the inference regex; do NOT use the doctor JSON `tier` field — that is the support tier 1/2/3, not the capability tier).
  - Executor unknown or tier undeclared-and-uninferrable → treat as `standard` (conservative → blocks oversized tasks).
  - Blocking finding text: "task size (N reqs / M plan items) requires a capable executor — pass `--agent <capable>` or `--vars '{"implementAgent":...}'`, or split the task". Written to the FAIL status file, so the precheck→implement guard routes to `failed`.
  - Document the heuristic (≥6 reqs or ≥8 plan items → capable or split) in `plugins/sp/skills/spur-dev/references/execution-workflow.md`.

#### R4 — agent→implementAgent default (Finding 4, S2 / small)

- **Problem:** Passing `--vars '{"agent":"X"}'` selects X for review/verify/test-fix but NOT implement (reads `${vars.implementAgent}`). Evidence: run `e8cb00e7` dispatched `agent=omp` despite `--vars '{"agent":"claude"}'`. Re-verified in the landed 0485 code: `resolveDefaultAgentVar` (`packages/app/src/services/workflow-service.ts:1092-1124`) injects `implementAgent := agent.default` when the caller didn't set it — the caller's explicit `agent` never reaches the implement hop.
- **Fix (frozen precedence):** caller `vars.agent` > `agent.default` > YAML literal, independently per var:
  - `implementAgent` unset by caller → inject `callerVars.agent ?? agent.default` (validated per the 0485 rules).
  - **Must update the landed 0485 test** `packages/app/tests/services/workflow-service.test.ts:1600` ("AC2: caller-set agent but no implementAgent — only implementAgent is injected"), which locks the OLD expectation `operator-pick my-exec`; new expectation: `operator-pick operator-pick`.
  - Precheck divergence notice: when resolved `$agent` ≠ `$implementAgent`, log one line naming both (they legitimately diverge when only `implementAgent` is pinned).

#### R5 — one-writer rule (Finding 5, S1 / doc = small)

- **Problem:** Two agent sessions (Pi + Codex PID 4087) editing the same tree silently overwrote each other; the symptom was mis-diagnosed as model regression for ~10 min. Verified absent: no one-writer/worktree coordination rule exists in `AGENTS.md` or `cross-cutting.md`.
- **Fix:** add the rule to `AGENTS.md` (Safety or Conventions section) AND `plugins/sp/skills/spur-dev/references/cross-cutting.md`: one writer per working tree; parallel agent work uses git worktrees (reference the WT-4 pattern already documented at `cross-cutting.md:429`). The optional `.spur/run/writer.lock` from the original draft is **out of scope** (advisory lock nothing else reads — pure speculation; see Notes).

#### R6 — commit-per-task hygiene (Finding 6, S2 / small)

- **Problem:** 0486's pipeline launched on a tree carrying 0485's uncommitted implementation across `packages/app` (9 unstaged files), forcing a commit-0485-first detour. Verified absent: no dirty-tree guidance in AGENTS.md/cross-cutting.md.
- **Fix:** pre-launch WARNING (not block): in the pipeline precheck, if `git status --porcelain` shows uncommitted non-corpus changes, log the file list with "commit or stash before starting a new task". Reuse the `gitHasNonCorpusChanges`-style excludes. Document commit-per-task in AGENTS.md next to the R5 rule.

#### R7 — Review gate robustness + force-done (Finding 7, S2 / small)

- (a) `hasPopulatedPriorityTable` (`packages/app/src/services/task-check.ts:96`, regex at `:101`) requires severity cells matching `/^\s*P[1-4]\s*$/` exactly; prose `P1 (blocker)` is rejected. Relax to `/^\s*P[1-4]\b/` — still requires a real table row with a non-placeholder content cell.
- (b) `--force-done` from `todo` is denied (`GuardDeniedError: No transition from "todo" to "done"` — observed during the 0486 force-done). Fix: when `--force-done` is requested from an earlier status, auto-traverse `todo→wip→testing→done` running the structural `task check` at each hop; OR document the required hops in `spur task update --help` next to `--force-done`. Implementer's choice; auto-traverse preferred (the gates still run per-hop, so no guard is bypassed).
- (c) **NEW (found in this review):** `extractReviewSectionBody` (`task-check.ts:114`) matches with lookahead `(?=^### |Z)` — the literal `Z` alternative truncates the Review body at any uppercase Z, and when Review is the final section with no following `### ` heading the match FAILS entirely (returns null → gate reads the Review as absent). Fix the lookahead to terminate at the next `^### ` heading or end-of-input; add regression tests for both cases.

### Plan
- [x] Scope `sp:code-implementation` to the target WBS (skill text) and add the diff-scope allowlist guard to the implement `requireDiff` path with the `implementScopeGuard:"off"` escape hatch; focused test reproducing the 0485↔0486 conflation (R1)
- [x] Rewrite the precheck doctor shell to probe `$agent` + `$implementAgent` via `doctor --json` and FAIL on `unauthenticated`, keeping CLI exit semantics unchanged (R2)
- [x] Add the tier-aware blocking finding to the size precheck (script `--executor` flag + YAML call site + exported `getExecutorTier` reuse) and document the heuristic in `execution-workflow.md` (R3)
- [x] Implement caller-agent→implementAgent precedence in `resolveDefaultAgentVar`, update the landed 0485 AC2 test at `workflow-service.test.ts:1600`, add the precheck divergence notice (R4)
- [x] Relax the severity-cell regex, fix the `extractReviewSectionBody` `Z` lookahead with regression tests, and implement or document the force-done multi-hop path (R7)
- [x] Add the one-writer-per-repo + commit-per-task rules to AGENTS.md and `cross-cutting.md`; add the pre-launch dirty-tree warning (R5, R6)
- [x] Validate: `bun run autofix && bun run spur-check`, focused plugin tests, and a reproduction dogfood (implement pass with a sibling todo task — confirm no conflation). NOTE: this task has 7 R-items — the pipeline run needs `--vars '{"maxImplementReqs":"10"}'` or it fails its own precheck (see Notes). Update Solution/Testing/Review and transition to done (R1–R7)

### Root Cause

The hours trace to **one reproducible defect compounding a sizing mismatch**.

1. **Dominant defect — implement stage does not scope to the target WBS.** `sp-code-implementation` auto-discovers "related" in-tree work and implements it alongside the target task. Task 0485 was freshly committed but still `status: todo` in the tree, so every `/sp:dev-run --mode implement 0486` pass — omp (run `ca130182`) AND claude (run `b16bfbf4`) — pulled in 0485's `redactAndBound` observability feature and wrote `0485 R6` tests unprompted. This scope creep had to be detected and reverted 4+ times.

2. **Sizing mismatch.** The task (7 requirements / 9 plan items / 12+ files / dogfood / full gates) exceeded what a flash-tier executor (`omp-dsv4-flash-opencode`, deepseek-v4-flash, tier `standard`) can complete in the 30-min `implementTimeoutMs`. omp used the full budget, produced 6 good core files, then exited code 3 (timeout) with no tests/docs/Solution.

3. **Two collision sources.** (a) The configured `agent.default` (`omp-dsv4-flash-volc`) was unauthenticated (`auth: no` for volc) — precheck's doctor prints this but does not fail. (b) A parallel Codex session (PID 4087) was editing the same repo, re-applying the 0485 redaction each time it was reverted — which was mis-attributed to omp/claude "regression" until a live-writer process check revealed it.

**Net effect:** what should have been "1 pipeline run → done" became "3 failed/cancelled runs + a manual inline finish." The 6 good files omp produced prove the pipeline mechanics worked; the conflation (Finding 1) is what forced the detour. **Fixing Finding 1 + Finding 3 would have made this a single clean run.**

### Solution
Seven post-mortem findings landed across the pipeline, executor selection, lifecycle help, and agent guidance.

**R1 — target-WBS scope.** `plugins/sp/skills/code-implementation/SKILL.md:55` restricts implement context to the target task, dependencies, feature, and declared paths. `packages/app/src/workflow/actions/agent-run.ts:238` snapshots the non-corpus tree before dispatch; the post-run comparison at `packages/app/src/workflow/actions/agent-run.ts:326` enforces exact declared files and explicit directory/glob prefixes while ignoring pre-existing dirt. Regression coverage includes same-package rejection and dirty-tree isolation at `packages/app/tests/workflow/actions/agent-run.test.ts:958`.

**R2 — authenticated precheck.** `config/workflows/task-pipeline.yaml:125` probes both resolved executors, writes FAIL for unauthenticated/non-zero doctor results, and keeps unknown auth soft. Standalone doctor exit semantics remain unchanged.

**R3 — size/capability gate.** `packages/app/src/services/task-size-precheck.ts:112` blocks large tasks below `capable-1`; `plugins/sp/scripts/task-size-precheck.ts:107` consumes the doctor capability projection through argv-safe `execFileSync` calls. `plugins/sp/tests/task-size-precheck.test.ts:48` locks the duplicated shipping thresholds to application defaults without adding a runtime API.

**R4 — executor precedence.** `packages/app/src/services/workflow-service.ts:1107` applies caller `implementAgent` > caller `agent` > `agent.default` > YAML literal. Tests at `packages/app/tests/services/workflow-service.test.ts:1600` cover caller propagation, missing defaults, and explicit implement pins; `config/workflows/task-pipeline.yaml:140` logs divergence.

**R5/R6 — coordination hygiene.** One-writer/worktree isolation and commit-per-task are recorded in `AGENTS.md:340`, portable `config/templates/AGENTS.md:176`, and the Spur development guidance. `config/workflows/task-pipeline.yaml:172` prints the non-corpus dirty-tree warning without blocking.

**R7 — Review/force-done robustness.** `packages/app/src/services/task-check.ts:100` accepts prose severity cells and `packages/app/src/services/task-check.ts:123` reads Review through the next heading or EOF. `apps/cli/src/commands/task.ts:283` documents the mandatory lifecycle hops for `--force-done`.

**Surface/docs.** `docs/04_DESIGN.md:1140` documents auth/size gates, executor precedence, exact-path scope semantics, and pre-dispatch snapshot attribution. The workflow SSOT remains `config/workflows/task-pipeline.yaml`.

**Verification remediation.** The final audit removed all Review findings: R1 now isolates per-dispatch changes, the shipped size script is argv-safe, threshold parity is regression-tested, and portable guidance is synchronized. Fresh gates passed 444 targeted tests and 4,794 repository tests; `spur-check`, `test-cf`, and `build` exited 0.
### Testing
**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Target-only skill contract `plugins/sp/skills/code-implementation/SKILL.md:55`; baseline/delta guard `packages/app/src/workflow/actions/agent-run.ts:238,326`; pre-existing dirt regression `packages/app/tests/workflow/actions/agent-run.test.ts:958`. |
| R2 | MET | Dual-executor auth gate and FAIL status write `config/workflows/task-pipeline.yaml:125`; standalone doctor semantics unchanged. |
| R3 | MET | Capability gate `packages/app/src/services/task-size-precheck.ts:112`; argv-safe shipped script `plugins/sp/scripts/task-size-precheck.ts:107`; threshold parity regression `plugins/sp/tests/task-size-precheck.test.ts:48`; dogfood returned PASS for 7 R-items / 7 Plan items on `claude`. |
| R4 | MET | Caller-agent propagation `packages/app/src/services/workflow-service.ts:1107`; precedence regressions `packages/app/tests/services/workflow-service.test.ts:1600`. |
| R5 | MET | One-writer/worktree isolation in `AGENTS.md:340` and portable `config/templates/AGENTS.md:176`. |
| R6 | MET | Commit-per-task contract `AGENTS.md:343`; non-blocking dirty-tree file list `config/workflows/task-pipeline.yaml:172`. |
| R7 | MET | Prose priority parsing and EOF-safe Review extraction `packages/app/src/services/task-check.ts:100,123`; force-done lifecycle help `apps/cli/src/commands/task.ts:283`. |

**Fresh Commands**

- `bun test packages/app/tests/workflow/actions/agent-run.test.ts packages/app/tests/services/task-check.test.ts packages/app/tests/services/task-size-precheck.test.ts packages/app/tests/services/workflow-service.test.ts packages/app/tests/services/agent-service.test.ts plugins/sp/tests/task-size-precheck.test.ts` — 444 pass, 0 fail.
- `bun plugins/sp/scripts/task-size-precheck.ts 0487 --spur-bin /Users/robin/xprojects/spur-new/dist/cli/spur --max-reqs 10 --max-plan-items 12 --executor claude` — PASS, 7 R-items / 7 Plan items.
- `bun run autofix && bun run spur-check` — formatting/typechecks, 43 pre-rules, 4,794 tests, and 2 post-rules passed; aggregate coverage 99.29% functions / 99.33% lines.
- `bun run test-cf` — 1 test passed.
- `bun run build` — CLI, server, and web builds exited 0.

Coverage: 99.29% functions / 99.33% lines (full `spur-check`).

**Fix-pass artifacts:** `.spur/run/0487-fix-created.json:1` records no follow-up tasks; `.spur/run/0487-verify-answer.txt:1` and `.spur/run/0487-verdict.json:1` are regenerated after the final bounded fix pass.
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P1 | — | — | No open findings. |
| P2 | — | — | No open findings. |
| P3 | — | — | No open findings. |
| P4 | — | — | No open findings. |

**Functional Verdict: PASS**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Target-only skill contract and the pre/post-dispatch Git snapshot guard enforce exact declared files, explicit directory/glob prefixes, and new siblings without attributing pre-existing dirt; regressions cover rogue same-package edits and dirty-tree isolation. |
| R2 | MET | Precheck probes both resolved executors and writes FAIL for unauthenticated or failed doctor results while preserving standalone doctor semantics. |
| R3 | MET | Size/capability logic blocks oversized work below `capable-1`; the shipped script passes argv without shell interpolation and a parity regression locks its thresholds to application defaults. |
| R4 | MET | Executor precedence is caller `implementAgent` > caller `agent` > configured default > YAML literal, with divergence logging and regression coverage. |
| R5 | MET | Repository and portable project guidance require one writer per working tree and git-worktree isolation for parallel work. |
| R6 | MET | Precheck names dirty non-corpus files without blocking; repository guidance requires a clean task boundary and commit per task. |
| R7 | MET | Review parsing accepts prose severities through EOF/next heading, and force-done help states the required lifecycle traversal. |

**SECUA:** PASS. No open security, efficiency, correctness, usability, or architecture findings.

**Resolved during verification:**

- Threshold duplication is guarded by a CI parity test; no new runtime surface was added.
- R5/R6 guidance is present in `config/templates/AGENTS.md` as well as the monorepo contract.
- The scope guard now compares Git snapshots around the agent dispatch, eliminating the former full-tree attribution risk.
- Shell-interpolated `execSync` calls were replaced with argv-safe `execFileSync` calls.

**Architecture disposition:** keep scope helpers co-located with their sole caller; extract only if a second caller appears.
### References

- **Source session:** task 0486 drive (2026-08-08/09) — the subject of this post-mortem.
- **Pipeline runs (evidence):** `d5f4f7cd` (precheck size fail), `ca130182` (omp 30-min timeout, exit 3, partial artifact `.spur/run/ca130182-…-implement-partial.md`), `e8cb00e7` (cancelled — `agent` var didn't reach implement), `b16bfbf4` (cancelled — claude re-conflated 0485).
- **Finding 1 evidence:** `rg 'redact|secret|0485' plugins/sp/commands/dev-find-conflict.md plugins/sp/skills/conflict-finding/` → clean (re-verified 2026-08-09). `requireDiff` at `config/workflows/task-pipeline.yaml:186` + `packages/app/src/workflow/actions/agent-run.ts:318,699`.
- **Finding 2 evidence:** `packages/app/src/services/task-size-precheck.ts` (pure logic) + `plugins/sp/scripts/task-size-precheck.ts` (YAML call site, `config/workflows/task-pipeline.yaml:~152-160`); no tier-awareness in either (verified). Capability-tier source: `agent.executors[].tier` + `getExecutorTier` at `packages/app/src/services/agent-service.ts:1371`.
- **Finding 3 evidence:** doctor exit condition `packages/app/src/services/agent-service.ts:353` (`!usable && tier === 1` — auth ignored); precheck doctor shell `config/workflows/task-pipeline.yaml:~117-127` probes `$agent` only; doctor JSON exposes `.agents[0].authenticated` (verified).
- **Finding 4 evidence:** `config/workflows/task-pipeline.yaml:177` (`${vars.implementAgent}`) vs L262/298/328 (`${vars.agent}`); `resolveDefaultAgentVar` at `packages/app/src/services/workflow-service.ts:1092-1124` (post-0485); landed test to update at `packages/app/tests/services/workflow-service.test.ts:1600`.
- **Finding 7 evidence:** `hasPopulatedPriorityTable` at `packages/app/src/services/task-check.ts:96` (regex :101); `extractReviewSectionBody` `Z` lookahead at `:114`; FSM denied `todo→done` (observed `GuardDeniedError`).
- **0485 landed:** commit `c8ecfb4a` (code + tests), but task 0485 remains `status: todo` as of this review — resolve before/while implementing 0487.
- **Parent feature:** `docs/features/N_0451-pipeline-post-mortem-process-and-infrastructure-hardening.md` (active; this extends its hardening theme).
- **Related delivered task:** `docs/tasks3/0486_*.md` (done, force-done) — the capability that exposed these failure modes.
- **Preserved artifact:** `/tmp/0486-stray-redact.patch` (omp's earlier redaction variant) — reference for the conflation behavior.

### History

- 2026-08-09T19:05:48.473Z todo → wip (system)
- 2026-08-09T19:32:52.643Z wip → testing (system)
- 2026-08-09T19:32:53.480Z testing → done (system)
### Notes

- **Self-application of the size precheck:** this task carries 7 R-items (> the max-5 default). Its own pipeline run must pass `--vars '{"maxImplementReqs":"10"}'`, or precheck fails exactly like run `d5f4f7cd`. After R3 lands, the same run also needs a `capable`-tier implement executor (`--vars '{"implementAgent":"claude"}'` or equivalent) or the new gate blocks it. This is intentional dogfooding: the run exercises the R2/R3 gates.
- **Out of scope (cut during review):** the advisory `.spur/run/writer.lock` from the original Finding 5 proposal — an advisory lock nothing else reads is speculative machinery; the documentation rule (R5) carries the value. Revisit only if the doc rule proves insufficient in practice.
- **Doctor CLI exit semantics deliberately unchanged** (R2): `spur agent doctor` is a standalone diagnostic; the auth gate lives in the pipeline's precheck shell, not in the CLI contract.
- **0485 status hazard:** 0485's implementation is committed (`c8ecfb4a`) but the task is still `todo` — the live conflation magnet from Finding 1. Resolve 0485's lifecycle (verify/wrap) before or alongside this task, or the 0487 implement pass risks the same scope creep.
- **Review corrections (2026-08-09):** all seven original findings verified against the tree before implementation; corrections recorded in Background § Verification pass.
