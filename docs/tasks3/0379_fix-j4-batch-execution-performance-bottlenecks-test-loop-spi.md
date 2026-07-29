---
template: meta
schema_version: 1
name: "Fix J4 batch execution performance bottlenecks: test-loop spinning, L3 guard format discovery, lifecycle transition errors, and context pressure"
description: ""
status: backlog
type: meta
profile: standard
feature_id: J4
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-07-29T19:13:27.778Z"
updated_at: "2026-07-29T19:16:48.228Z"
---

## 0379. Fix J4 batch execution performance bottlenecks: test-loop spinning, L3 guard format discovery, lifecycle transition errors, and context pressure

### Background
The J4 batch execution (`/skill:sp-dev-runall --feature J4 --auto --next --agent omp`) completed all 5 tasks (0374–0378) with PASS verdicts, but took **13.65 hours** across all sessions — approximately 3x slower than expected. A forensic analysis of session logs (`~/.omp/agent/sessions/-xprojects-spur-new/`) identified 5 root causes, each with concrete evidence from tool-call timestamps, repeated command counts, and guard failure messages.

## Session breakdown (evidence)

| Session | Duration | Tools | Compactions | Test runs | Key problem |
|---|---|---|---|---|---|
| Run0376 (subagent) | 5.45h | 307 | 6 | 103 | Test loop: 79 identical `bun test` runs |
| Run0375 (subagent) | 4.05h | 228 | 5 | 9 | Stuck on test failure, git stash red herring |
| Main (current) | 2.46h | 546 | 10 | 55 | L3 guard format discovery via trial-and-error |
| Refine0374–0378 (5 sessions) | 1.65h total | 176 | 1 | 0 | ✅ Efficient — no changes needed |
| **TOTAL** | **13.65h** | **1,257** | **22** | **168** | |

## Root causes (ranked by time cost)

1. **P0: Test-loop spinning** (Run0376, ~4h waste): Agent ran `bun test tests/modules/observability/components.test.tsx` **103 times** — 79 were the identical command. It re-ran the same failing test every ~80 seconds for 2+ hours (13:01–14:17+) without changing the source between runs. Pattern: run test → see failure → grep for context → run same test again → see same failure → repeat.

2. **P0: L3 guard format discovery** (Main session, ~1.5h waste): Agent discovered correct task-section formats through trial-and-error across **20 `spur task check` calls** and **26 `spur task update --section` calls** (5.2 per task). Each format error cost ~3–5 minutes (read error, diagnose, rewrite section, re-check). Issues discovered:
   - Solution citations require `filename:line` format (e.g., `SupervisorTab.tsx:17-20`), NOT bare `:line` (e.g., `:17-20`) — L3 guard code at `task-check.ts:404-407`
   - Review section requires a P1–P4 priority findings table with cells matching `/^\s*P[1-4]\s*$/` — L3 guard code at `task-check.ts:429-435`
   - Verdict JSON `requirements`/`acceptanceCriteria` must be arrays of objects with `id`/`status`/`evidence` fields — `task-record.ts:136-157`
   - "Verdict" is NOT a canonical section name — only `Background`, `Requirements`, `Acceptance Criteria`, `Q&A`, `Design`, `Plan`, `Solution`, `Root Cause`, `Testing`, `Review`, `References`, `History`, `Notes` are valid
   - Lifecycle transitions must follow `todo -> wip -> testing -> done` — `todo -> testing` and `todo -> done` are invalid (7 `GuardDeniedError` events)

3. **P1: Context window pressure** (22 compactions, ~1h waste): 22 compactions across sessions from flooding context with verbose test output and spur task JSON. Each compaction costs ~2–3 minutes of re-orientation.

4. **P1: Section write retries** (Main session, ~45min waste): 26 section updates for 5 tasks (5.2 per task) — many due to writing sections, running `spur task check`, finding format errors, then rewriting. Task 0377 alone needed 9 section writes.

5. **P2: Git stash confusion** (Run0375, ~30min waste): Agent found an unrelated stash (`config-yaml-unrelated`) and spent ~20 minutes investigating it via `git stash list`, `git stash show`, `git branch` — a red herring that didn't affect test behavior.

## What worked well (no changes needed)

- **Refine sessions**: All 5 refine subagents completed in 10–27 minutes each with 25–47 tool calls and zero or one compactions.
- **Implementation quality**: All 5 tasks passed review with PASS verdicts, 3939 tests passing, lint clean.
- **Learning curve**: Tasks 0377 and 0378 went faster (5–14 min lifecycle work) after the agent learned format requirements on 0374–0376.
### Requirements
- [ ] R1. **Add a test-loop breaker to the pipeline or agent guidance** that detects when the same test command has been run 3+ times with the same failure and forces the agent to: (a) read the component under test, (b) form a hypothesis, (c) make one edit, before re-running. Target: eliminate the Run0376 pattern where `bun test tests/modules/observability/components.test.tsx` was run 103 times (79 identical).
- [ ] R2. **Add an L3 guard format cheat sheet** to the `sp:spur-cli` skill reference (`references/tasks/section-editing.md`) or `task-pipeline.yaml` comments, containing: (a) valid lifecycle transition graph (`todo->wip->testing->done`), (b) Solution citation pattern (`filename:line`, NOT `:line`), (c) Review P1–P4 table format (markdown table with a cell matching `/^\s*P[1-4]\s*$/` and at least one non-placeholder content cell), (d) verdict JSON schema (`requirements: [{id, status, evidence}]`, `acceptanceCriteria: [{id, status, evidenceType, evidence}]`), (e) canonical section names list. Target: reduce `spur task check` calls from 20 to ≤5 per task.
- [ ] R3. **Add test output filtering guidance** to the `sp:code-implementation` or `sp:code-testing` skill: always pipe `bun test` output through `grep -E "fail|pass|error" | tail -20` (or `--test-name-pattern` for single-test runs) instead of raw `tail -40`. Target: reduce per-test-run context cost by ~60%, preventing compaction cascades.
- [ ] R4. **Add a "write all sections before checking" guidance** to `sp:spur-dev` or `sp:code-implementation`: write Solution + Testing + Review sections in the correct format using a template, then run `spur task check` once. Target: reduce section writes from 5.2/task to ≤2/task.
- [ ] R5. **Add lifecycle transition graph to pipeline YAML comments** at the top of `config/workflows/task-pipeline.yaml`, showing the valid task status transitions (`backlog -> todo -> wip -> testing -> blocked -> done -> cancelled`) and which transitions run guards (`wip->testing` runs `spur task check`; `testing->done` runs `spur task check --strict-core`). Target: eliminate all 7 `GuardDeniedError` events from invalid transitions.
- [ ] R6. **Add a "git stash is usually irrelevant" note** to `sp:sys-debugging` or `sp:code-implementation`: when tests fail, investigate the test and component first, not git state. A stash from a different file is unlikely to affect test behavior. Target: eliminate the 20-minute git stash investigation in Run0375.
### Acceptance Criteria
```gherkin
Scenario: R1 - Test-loop breaker prevents repeated identical test runs
  Given an agent running a failing test command
  When the same test command has been run 3 times with the same failure signature
  Then the agent reads the component under test before re-running
  And the agent forms a hypothesis and makes one edit before re-running
  And the total test runs for a single debugging session does not exceed 5 without a source change

Scenario: R2 - L3 guard format cheat sheet is available in skill reference
  Given an agent writing task sections for the first time
  When it reads the sp:spur-cli skill reference or task-pipeline.yaml
  Then it finds the valid lifecycle transition graph
  And it finds the Solution citation format (filename:line)
  And it finds the Review P1-P4 table format
  And it finds the verdict JSON schema
  And it finds the canonical section names list
  And it writes all sections in the correct format on the first attempt
  And spur task check passes on the first or second attempt (not the 5th)

Scenario: R3 - Test output filtering reduces context pressure
  Given an agent running bun test during a pipeline
  When it pipes test output through grep and tail
  Then each test run adds less than 500 tokens to context (vs 2000+ for raw tail -40)
  And compactions per session are reduced from 10+ to 5 or fewer

Scenario: R4 - Section batching reduces spur task calls
  Given an agent writing Testing, Review, and Solution sections
  When it writes all sections before running spur task check
  Then section writes per task are 2 or fewer (down from 5.2)
  And spur task check calls per task are 2 or fewer (down from 4)

Scenario: R5 - Lifecycle transition graph prevents GuardDeniedError
  Given an agent transitioning a task between lifecycle statuses
  When it reads the transition graph in task-pipeline.yaml or sp:spur-cli
  Then it never attempts todo->testing or todo->done
  And it follows todo->wip->testing->done
  And GuardDeniedError events are zero per batch

Scenario: R6 - Debugging guidance prioritizes source over git state
  Given an agent debugging a test failure
  When it reads the debugging skill guidance
  Then it investigates the test and component first
  And it does not investigate git stashes unless the failure is git-related
  And time spent on git state investigation is under 2 minutes per debugging session
```
### Q&A
**Q: Why create a separate meta task instead of fixing the issues inline during J4 execution?**

A: The J4 batch execution is complete (all 5 tasks done with PASS verdicts). These performance issues are process-level improvements to the harness skills and pipeline configuration, not code changes to the J4 feature itself. A separate meta task keeps the fixes traceable and prevents re-discovery in future batch runs.

**Q: Why are the fixes documentation/guidance changes, not code changes?**

A: The root causes are agent behavior patterns (test-loop spinning, format discovery, git stash investigation) not code bugs. The harness code (task-check.ts, task-record.ts, task-pipeline.yaml) is working correctly - it's enforcing the right constraints. The problem is that agents don't know the constraints until they hit them. Documenting the constraints in skill references makes them discoverable before the agent wastes time on trial-and-error.

**Q: Should R1 (test-loop breaker) be a hook instead of guidance?**

A: A PreToolUse hook that counts repeated bash commands and warns after 3 identical invocations would be more enforceable, but it requires state tracking across tool calls (the hook needs to remember previous commands). This is a future enhancement. The immediate fix is guidance in the `sp:code-testing` skill that agents read before debugging.

**Q: What's the expected time savings from implementing all 6 requirements?**

A: Based on the J4 batch analysis: 13.65h -> ~6h (55% reduction). Breakdown:
- R1 (test-loop breaker): ~4h saved (eliminates Run0376-style spinning)
- R2 (L3 cheat sheet): ~1.5h saved (eliminates format discovery)
- R3 (test output filtering): ~1h saved (reduces compactions)
- R4 (section batching): ~45min saved (reduces spur task calls)
- R5 (transition graph): ~30min saved (eliminates GuardDeniedError retries)
- R6 (git stash note): ~30min waste per occurrence eliminated

**Q: How should this task be decomposed for execution?**

A: The 6 requirements map to 6 independent fixes in different skill files. They can be executed in parallel (no dependencies between them). Suggested decomposition:
- Sub-task A: R1 + R3 (both in `sp:code-testing` skill)
- Sub-task B: R2 (in `sp:spur-cli` skill)
- Sub-task C: R4 (in `sp:spur-dev` skill)
- Sub-task D: R5 (in `config/workflows/task-pipeline.yaml`)
- Sub-task E: R6 (in `sp:sys-debugging` skill)

Or execute as a single task since each fix is a documentation addition (~50-100 lines per skill file).
### Design
Five independent fixes, each targeting a different layer of the harness. All are documentation/guidance changes except R1 which may need a pipeline guard or hook.

## Fix 1: Test-loop breaker (R1) — `sp:code-testing` or `sp:sys-debugging` skill

**Problem evidence**: Run0376 session ran `bun test tests/modules/observability/components.test.tsx` 103 times. The first 5 runs (13:01–13:06) all showed the same failure: `expect(received).toBe(expected) - Expected: true` on the tab-switching test. Between runs, the agent grepped for context but never read the component source or made an edit. It then spent 2+ more hours (13:20–14:17+) continuing to re-run with minor variations (adding `--test-name-pattern`, creating debug-test.tsx files) but never forming a clear hypothesis.

**Fix**: Add a "test-loop breaker" protocol to the `sp:code-testing` skill (`references/test-execution.md` or equivalent):

```markdown
## Test-loop breaker protocol

When a test fails twice with the same error signature:

1. STOP re-running the test.
2. Read the component under test (the file path in the test failure).
3. Read the test file at the failing assertion line.
4. Form a written hypothesis: "The test expects X because Y, but the code does Z."
5. Make ONE edit to address the hypothesis.
6. Re-run the test ONCE.
7. If it still fails with the same error, go to step 2 with a new hypothesis.
8. Hard cap: 3 runs of the same test command without a source change. If exceeded, escalate to the operator.

Anti-pattern: running the same test command more than 3 times without changing source code between runs. This is spinning, not debugging.
```

**Alternative**: Add a PreToolUse hook that counts repeated bash commands and warns after 3 identical invocations. This is harder to implement (requires state tracking) but would be enforced automatically.

**Location**: `~/.omp/plugins/cache/plugins/spur___sp___0.3.26/skills/code-testing/` or `sys-debugging/` skill. The fix is a new `references/test-loop-breaker.md` file linked from the skill's SKILL.md.

## Fix 2: L3 guard format cheat sheet (R2) — `sp:spur-cli` skill reference

**Problem evidence**: The agent made 20 `spur task check` calls and 26 `spur task update --section` calls across 5 tasks. Specific failures:

1. **Solution `file:line` citation** (2 failures on 0377, 0378): The L3 guard at `packages/app/src/services/task-check.ts:404-407` checks for a file:line pattern. The agent initially wrote citations as `:17-20` (bare line numbers) which failed. The correct format is `SupervisorTab.tsx:17-20` (filename:line). The guard code uses a regex that requires a filename before the colon.

2. **Review P1–P4 table** (1 failure on 0374): The L3 guard at `task-check.ts:429-435` calls `hasPopulatedPriorityTable()` (task-check.ts:94-104) which scans for markdown table rows containing a cell matching `/^\s*P[1-4]\s*$/` with at least one non-placeholder content cell. The agent initially wrote prose-only review text without the table.

3. **Verdict JSON format** (1 failure on 0376): The `normalizeRequirements()` function at `task-record.ts:136-144` expects `requirements` to be an array of objects with `id`, `status`, `evidence` string fields. The agent initially wrote a plain object `{R1: {status: "MET"}}` instead of an array `[{id: "R1", status: "MET", evidence: "..."}]`.

4. **"Verdict" section name** (1 failure): The agent tried `spur task update --section Verdict` which failed because "Verdict" is not in the canonical section list. Valid sections: `Background`, `Requirements`, `Acceptance Criteria`, `Q&A`, `Design`, `Plan`, `Solution`, `Root Cause`, `Testing`, `Review`, `References`, `History`, `Notes`.

5. **Invalid lifecycle transitions** (7 `GuardDeniedError` events): The agent tried `todo -> testing` (0374), `todo -> done` (0376), and `wip -> testing` with failing guard (0377, 0378 x2). Valid transitions: `backlog -> todo -> wip -> testing -> blocked -> done -> cancelled`. Guards fire on `wip->testing` (`spur task check`) and `testing->done` (`spur task check --strict-core`).

**Fix**: Add a new reference file `references/tasks/l3-guard-cheatsheet.md` to the `sp:spur-cli` skill, and link it from `references/tasks/section-editing.md`. Content:

```markdown
# L3 guard format cheat sheet

## Lifecycle transition graph

```
backlog -> todo -> wip -> testing -> done -> cancelled
                                     ^
                                     |
                                  blocked
```

- `wip -> testing`: guard runs `spur task check <wbs>` (L1-L4 validation)
- `testing -> done`: guard runs `spur task check <wbs> --strict-core` (hard-core errors only)
- INVALID: `todo -> testing`, `todo -> done`, `wip -> done` (no transition exists)
- Use `spur task update <wbs> wip` first, then `spur task update <wbs> testing`

## Solution section: file:line citations

The L3 guard (`task-check.ts:404-407`) requires at least ONE `file:line` citation in the Solution section body.

✅ CORRECT: `SupervisorTab.tsx:17-20` — filename followed by colon and line number(s)
✅ CORRECT: `apps/web/src/modules/teams/tabs.ts:15` — full path also works
❌ WRONG: `:17-20` — bare line numbers without filename
❌ WRONG: `line 17` — prose without the `file:line` pattern

## Review section: P1–P4 priority findings table

The L3 guard (`task-check.ts:429-435`, `hasPopulatedPriorityTable()` at :94-104) requires a markdown table with:
- At least one row containing a cell matching `/^\s*P[1-4]\s*$/` (exactly "P1", "P2", "P3", or "P4")
- At least one non-placeholder content cell in that row (not empty, not "—")

✅ CORRECT:
| Priority | Finding | File:Line | Status |
|---|---|---|---|
| P1 | Missing null check | foo.ts:42 | Fixed |
| P2 | Unused import | bar.ts:10 | Fixed |

❌ WRONG: Prose-only review without a table
❌ WRONG: Table with `| P1 | | | |` (empty cells = scaffold, not populated)

## Verdict JSON schema (`.spur/run/<wbs>-verdict.json`)

```json
{
  "wbs": "0378",
  "verdict": "PASS",
  "requirements": [
    { "id": "R1", "status": "MET", "evidence": "SupervisorTab.tsx:17-20" },
    { "id": "R2", "status": "MET", "evidence": "SupervisorTab.tsx:93-458" }
  ],
  "acceptanceCriteria": [
    { "id": "AC-1", "status": "MET", "evidenceType": "test", "evidence": "components.test.tsx:42" }
  ],
  "checks": [
    { "name": "SECU", "status": "P3", "evidence": "No SQL injection vectors" }
  ],
  "source": "spur-task-verdict"
}
```

- `requirements[]` and `acceptanceCriteria[]` MUST be arrays of objects (not plain objects)
- `acceptanceCriteria[]` objects need `evidenceType` field (not present in `requirements[]`)
- `verdict`: `PASS` | `PARTIAL` | `FAIL` | `UNKNOWN`
- `source`: must be `"spur-task-verdict"` for `spur task verdict` output

## Canonical section names

`Background`, `Requirements`, `Acceptance Criteria`, `Q&A`, `Design`, `Plan`, `Solution`, `Root Cause`, `Testing`, `Review`, `References`, `History`, `Notes`

"Verdict" is NOT a section. Use `Notes` for verdict summaries.
```

## Fix 3: Test output filtering (R3) — `sp:code-testing` skill

**Problem evidence**: Run0376 had 6 compactions from 103 test runs flooding context. Each raw `bun test ... 2>&1 | tail -40` adds ~2000 tokens. Filtered output (`grep -E "fail|pass|error" | tail -20`) adds ~500 tokens. Over 103 runs, that's 206K vs 51.5K tokens - the difference between 6 compactions and ~1.

**Fix**: Add a "test output discipline" section to `sp:code-testing` skill:

```markdown
## Test output discipline

Always filter test output to reduce context pressure:

```bash
# Full suite - summary only
bun test 2>&1 | grep -E "^\(|fail|pass|error" | tail -20

# Single test file - failures only
bun test tests/foo.test.ts 2>&1 | grep -A 5 "fail\|error" | tail -30

# Single test by name
bun test tests/foo.test.ts --test-name-pattern "specific test name" 2>&1 | tail -20
```

Never run `bun test ... | tail -40` - the raw output includes full assertion diffs, source snapshots, and stack traces that flood context and trigger compactions.

Use `--test-name-pattern` on first failure to isolate the failing test, not the full suite.
```

## Fix 4: Section batching (R4) — `sp:spur-dev` skill or `sp:code-implementation`

**Problem evidence**: 26 section updates for 5 tasks (5.2 per task). The agent wrote a section, ran `spur task check`, found a format error, rewrote the section, re-checked. Task 0377 needed 9 section writes.

**Fix**: Add a "section batching" protocol to the pipeline execution guidance:

```markdown
## Section batching protocol

When writing pipeline output sections (Solution, Testing, Review):

1. Read the L3 guard cheat sheet FIRST (references/tasks/l3-guard-cheatsheet.md).
2. Write ALL sections to temp files in the correct format.
3. Apply ALL sections with `spur task update --section <name> --from-file <path>`.
4. Run `spur task check <wbs>` ONCE.
5. If check fails, read the findings, fix ALL sections, re-apply, re-check.

Do NOT write one section, check, fix, check, write next section, check, fix, check.
This doubles your spur task calls and triples your context usage.
```

## Fix 5: Lifecycle transition graph in pipeline YAML (R5) — `config/workflows/task-pipeline.yaml`

**Problem evidence**: 7 `GuardDeniedError` events:
- `0374`: `todo -> testing` (no such transition)
- `0376`: `todo -> done` (no such transition)
- `0377`: `wip -> testing` guard failed (L3 Solution file:line citation missing)
- `0378`: `wip -> testing` guard failed twice (same L3 citation issue)

**Fix**: Add a comment block at the top of `config/workflows/task-pipeline.yaml` (after the `description` line, before `initialState`):

```yaml
# ── Task lifecycle transitions (not pipeline states) ──
# The task being executed transitions through statuses via `spur task update <wbs> <status>`.
# Valid transitions: backlog -> todo -> wip -> testing -> blocked -> done -> cancelled
# Guards:
#   wip -> testing:   spur task check <wbs>           (L1-L4 validation must pass)
#   testing -> done:  spur task check <wbs> --strict-core  (hard-core errors only)
# INVALID: todo -> testing, todo -> done, wip -> done (no transition exists)
# The pipeline's implement step does: spur task update <wbs> wip --no-lifecycle
# The pipeline's record step does: spur task record <wbs> --transition testing
# The pipeline's done step does:   spur task update <wbs> done --no-lifecycle
```

## Fix 6: Git stash irrelevance note (R6) — `sp:sys-debugging` skill

**Problem evidence**: Run0375 spent ~20 minutes (4 tool calls) investigating `git stash list`, `git stash show -p`, `git stash show --name-only`, `git branch --show-current` after finding an unrelated stash (`config-yaml-unrelated`). The stash contained only `.spur/config.yaml` changes, which did not affect the test failure.

**Fix**: Add a note to `sp:sys-debugging` skill:

```markdown
## Debugging discipline: source before state

When a test fails, investigate in this order:
1. Read the test file at the failing assertion line.
2. Read the component/module under test.
3. Form a hypothesis.
4. Make a fix.
5. Re-run the test.

Do NOT investigate git state (stash list, branch, diff) unless:
- The failure message mentions a missing file or path (possible git issue)
- You recently did a git operation (checkout, rebase, stash pop)
- The test was passing before a git operation

A stash from a different file is irrelevant to a test failure in another file.
```
### Plan
- [ ] **Step 1 (R2): Create L3 guard cheat sheet reference file** — Add `references/tasks/l3-guard-cheatsheet.md` to the `sp:spur-cli` skill. Link it from `references/tasks/section-editing.md`. Content: lifecycle transition graph, Solution `file:line` citation format, Review P1–P4 table format (with the exact `/^\s*P[1-4]\s*$/` regex), verdict JSON schema, canonical section names. Source of truth: `packages/app/src/services/task-check.ts:94-104,391-450` and `packages/app/src/services/task-record.ts:127-168`.
- [ ] **Step 2 (R5): Add lifecycle transition graph comment to task-pipeline.yaml** — Insert a comment block after the `description` line in `config/workflows/task-pipeline.yaml` showing valid task status transitions and guard behavior. Keep it under 15 lines.
- [ ] **Step 3 (R1): Add test-loop breaker protocol to sp:code-testing skill** — Create `references/test-loop-breaker.md` in the `sp:code-testing` skill. Content: the 8-step protocol (stop after 2 identical failures, read source, form hypothesis, one edit, one re-run, hard cap at 3). Link from SKILL.md.
- [ ] **Step 4 (R3): Add test output filtering guidance to sp:code-testing skill** — Create `references/test-output-discipline.md` in the `sp:code-testing` skill. Content: filtered `bun test` command patterns, token cost comparison, `--test-name-pattern` guidance. Link from SKILL.md.
- [ ] **Step 5 (R4): Add section batching protocol to sp:spur-dev skill** — Add a "Section batching protocol" subsection to the `sp:spur-dev` SKILL.md or a new reference file. Content: write all sections before checking, check once, fix-all-then-recheck pattern.
- [ ] **Step 6 (R6): Add git stash irrelevance note to sp:sys-debugging skill** — Add a "Debugging discipline: source before state" subsection to `sp:sys-debugging` SKILL.md. Content: investigation order (test → component → hypothesis → fix → re-run), when git state IS relevant vs NOT.
- [ ] **Step 7: Validate all changes** — Run `bun run lint` and `bun run test` to ensure no skill/reference file changes break the build. Run `spur task check 0379` to verify this task's own format.
- [ ] **Step 8: Dogfood validation** — Run a single task through the pipeline (`/sp:dev-run <wbs> --auto`) and verify: (a) test runs stay under 5 per debugging session, (b) `spur task check` calls stay under 3 per task, (c) no `GuardDeniedError` events, (d) compactions stay under 5 per session.
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Root Cause

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **J4 batch execution report**: `/skill:sp-dev-runall --feature J4 --auto --next --agent omp` output (Main session, 2026-07-29)
- **Performance analysis source**: Session JSONL logs at `~/.omp/agent/sessions/-xprojects-spur-new/`
  - Main session: `2026-07-29T04-54-05-620Z_*` (2.46h, 546 tools, 10 compactions)
  - Run0376: `2026-07-29T04-54-05-620Z_*/Run0376_*` (5.45h, 307 tools, 6 compactions, 103 test runs)
  - Run0375: `2026-07-29T04-54-05-620Z_*/Run0375_*` (4.05h, 228 tools, 5 compactions)
  - Refine0374–0378: 5 sessions in same subdirectory (1.65h total, 176 tools)
- **L3 guard source code**: `packages/app/src/services/task-check.ts`
  - `hasPopulatedPriorityTable()`: lines 94–104
  - Solution file:line check: lines 404–407
  - Review P1–P4 table check: lines 429–435
- **Verdict parsing source code**: `packages/app/src/services/task-record.ts`
  - `normalizeRequirements()`: lines 127–144
  - `normalizeAcceptanceCriteria()`: lines 146–157
  - `normalizeChecks()`: lines 159–168
- **Pipeline definition**: `config/workflows/task-pipeline.yaml` (8 steps: precheck -> implement -> test -> review -> approve -> verify -> record -> done)
- **Task-pipeline bug-742 warning**: task-pipeline.yaml step comments warn against recursive `spur workflow run` or `/sp:dev-run` invocation from within agent.run steps
- **Spur CLI task reference**: `~/.omp/plugins/cache/plugins/spur___sp___0.3.26/skills/spur-cli/references/tasks/verbs.md` and `section-editing.md`
- **Git commits (J4 batch)**: `dbf2fa2f` (0374 code), `4e6f2d20` (0374 done), `9ff3b4c5` (0375 code), `71881ef4` (0375 done), `c45e5ef6` (0376 code), `6b739d80` (0376 done), `53f36a02` (0377 code), `92d3c474` (0377 done), `ba3ea3c5` (0378 code), `2f9a6d95` (0378 done)
- **Test results (final)**: 3939 pass, 0 fail, 12199 expect() calls, 231 files
### History
### Notes

## RC1: Test-loop spinning (P0, ~4h waste)

**What happened**: Run0376 subagent ran `bun test tests/modules/observability/components.test.tsx` **103 times**, 79 of which were the exact same command with no source change between runs. The first 5 runs all produced the same failure:

```
expect(received).toBe(expected)
Expected: "tasks"
Received: "events"
```

The agent's response to this failure was to grep for `data-testid`, grep for `tab-switching`, grep for `ObservabilityTabs` - but never read the component source file or make an edit. It then created a `debug-test.tsx` file, ran the test again, got the same failure, and continued the loop.

**Root cause**: No protocol existed in the agent's skills to break out of a test-loop. The `sp:code-testing` and `sp:sys-debugging` skills describe TDD and debugging methodology but do not address the specific anti-pattern of repeatedly running the same failing test without changing source.

**Evidence**: Run0376 JSONL session log. Test command timestamps: 13:01:03, 13:01:28, 13:01:53, 13:02:18, 13:02:43 (first 5 runs, all same failure). Peak frequency: 13:02–13:06 (5 runs in 4 minutes). Total duration: 13:01 to ~14:17+.

## RC2: L3 guard format discovery via trial-and-error (P0, ~1.5h waste)

**What happened**: The agent needed to write Solution, Testing, and Review sections in formats enforced by L3 guards in `task-check.ts`. It did not know the formats, so it wrote sections, ran `spur task check`, got errors, rewrote sections, re-checked. This happened 26 times across 5 tasks (5.2 writes per task).

**Specific format failures**:

1. **Solution `file:line` citation** (0377, 0378): L3 guard at `task-check.ts:404-407` requires at least one `file:line` pattern in the Solution body. Agent wrote `:17-20` (bare line numbers) which failed the regex. Correct: `SupervisorTab.tsx:17-20`.

2. **Review P1–P4 table** (0374): L3 guard at `task-check.ts:429-435` calls `hasPopulatedPriorityTable()` (task-check.ts:94-104) which scans markdown table rows for a cell matching `/^\s*P[1-4]\s*$/` with at least one non-placeholder content cell. Agent wrote prose-only review without a table.

3. **Verdict JSON format** (0376): `normalizeRequirements()` at `task-record.ts:136-144` expects an array of objects `[{id, status, evidence}]`. Agent wrote a plain object `{R1: {status: "MET"}}`.

4. **"Verdict" section name**: Agent tried `spur task update --section Verdict`. "Verdict" is not canonical. Use `Notes`.

5. **Invalid lifecycle transitions** (7 events): Agent tried `todo->testing` (0374), `todo->done` (0376), which are invalid. Valid path: `todo->wip->testing->done`.

**Root cause**: The L3 guard format requirements are encoded only in TypeScript code (`task-check.ts`, `task-record.ts`) and are not surfaced as human-readable documentation in the `sp:spur-cli` skill references. An agent encountering the pipeline for the first time has no reference for the exact formats expected.

**Evidence**: Main session JSONL log. 20 `spur task check` calls, 26 `spur task update --section` calls. Per-task: 0374 (3 writes), 0375 (3), 0376 (4), 0377 (9), 0378 (5).

## RC3: Context window pressure from test output flooding (P1, ~1h waste)

**What happened**: 22 compactions across all sessions. The primary contributor was Run0376 with 6 compactions from 103 test runs. Each raw `bun test ... 2>&1 | tail -40` command added ~2000 tokens to context (full assertion diffs, source snapshots, stack traces). Over 103 runs, that's ~206K tokens of test output alone, far exceeding the context window.

**Root cause**: No guidance in the `sp:code-testing` skill on filtering test output. The agent used `tail -40` which includes full diff output. Filtered output (`grep -E "fail|pass|error" | tail -20`) would add ~500 tokens per run (~51.5K total), reducing compactions from 6 to ~1.

**Evidence**: Run0376: 6 compactions. Main session: 10 compactions (from verbose `spur task` JSON output and test runs). Run0375: 5 compactions.

## RC4: Section write retries from checking-then-fixing (P1, ~45min waste)

**What happened**: 26 section updates for 5 tasks. The pattern was: write Solution section -> check -> fail -> fix Solution -> check -> write Testing -> check -> fail -> fix Testing -> check -> write Review -> check -> fail -> fix Review -> check. Instead of: write all sections -> check once -> fix all -> check once.

**Root cause**: No batching guidance in the pipeline execution skills. The agent treated each section as a separate write-check cycle.

**Evidence**: Main session JSONL log. Section writes per task: 0374 (3), 0375 (3), 0376 (4), 0377 (9), 0378 (5). Average 5.2 writes per task vs. expected 2 (one initial write + one fix).

## RC5: Git stash red herring (P2, ~30min waste)

**What happened**: Run0375 found a git stash (`config-yaml-unrelated`) and spent 4 tool calls (~20 minutes) investigating it: `git stash list`, `git stash show -p`, `git stash show --name-only`, `git branch --show-current`. The stash contained only `.spur/config.yaml` changes and was unrelated to the test failure in `apps/web/src/modules/observability/`.

**Root cause**: No guidance in `sp:sys-debugging` on when git state is relevant to test failures. The agent's default behavior was to investigate all anomalous git state, even when the failure was clearly in application code.

**Evidence**: Run0375 JSONL session log. 4 git-related tool calls between test failure and fix.

