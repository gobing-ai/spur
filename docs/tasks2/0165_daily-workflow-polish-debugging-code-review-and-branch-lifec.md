---
template: feature-impl
schema_version: 1
name: "Daily workflow polish — debugging, code review, and branch lifecycle skills"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-30T22:36:50.555Z"
updated_at: "2026-06-30T23:48:49.286Z"
---

## 0165. Daily workflow polish — debugging, code review, and branch lifecycle skills

### Background
The `sp` plugin's execution pipeline (plan → implement → test → verify) covers the structured development lifecycle well. But developers spend the majority of their time *between* pipeline runs — debugging failures, reviewing code, managing branches, and getting unstuck. `sp` currently has no opinion on these moments; the developer drops out of the `sp` workflow entirely.

Three reference sources demonstrate the patterns this task should bring into `sp`:

**Superpowers `sys-debugging`:** A structured debugging protocol — reproduce → isolate → identify root cause → fix → regression test. The skill teaches the agent to debug methodically rather than flailing with print statements. It includes the "ask the debugger before the LLM" principle and the 15-minute escalation rule.

**Superpowers `requesting-code-review` + `receiving-code-review`:** A paired review workflow — the requester prepares a self-review checklist before asking, the reviewer follows a structured lens (correctness, security, performance, maintainability), and the pair converges on actionable findings. Pre-commit self-review catches 60-80% of issues before human/agent review.

**Superpowers `finishing-a-development-branch` + `using-git-worktrees`:** A branch-lifecycle discipline — create branch in isolated worktree, commit atomically, self-review before merge, clean up after merge. Git worktrees enable parallel branches without stashing or `git switch` churn. gstack's `unfreeze` pattern (systematic unblocking) and `careful` pattern (safety-conscious development) complement these.

**gstack `careful` / `cso`:** Safety-conscious development patterns — verify before every destructive action, checkpoint before risky operations, audit trail of decisions. The "careful" stance is a methodology overlay, not a standalone tool.

**Current `sp` gaps:**

1. **Debugging:** `sp:code-implementation/references/debugging.md` exists as a reference but is not a standalone skill with its own protocol. An agent hitting a test failure or runtime error has no `sp`-guided debugging workflow.

2. **Code review:** `sp:code-verification` does post-implementation review (the verify step) but there's no *pre-commit self-review* or *peer/agent review request* workflow. The review happens at the end, not continuously.

3. **Branch workflow:** No `sp` entity teaches branch lifecycle, git worktree patterns, or merge preparation. The agent's git usage is ad-hoc.

4. **Verification before completion:** The verify step is in the pipeline but there's no lightweight "pre-completion verification" checklist for the moments between formal pipeline runs.

**What this task delivers:** Three new skills (`sp:sys-debugging`, `sp:code-review`, `sp:branch-workflow`), one enhanced skill (`sp:code-verification` absorbs pre-completion verification), and three new commands (`/sp:dev-debug`, `/sp:dev-review-req`, `/sp:dev-branch`). Each skill owns its protocol; each command is a thin router.

**Boundary with existing skills:**
- `sp:code-implementation` owns implementation and root-cause debugging within the pipeline — `sp:sys-debugging` is the standalone "I have a bug, help me debug it" entry point.
- `sp:code-verification` owns post-implementation SECUA review — `sp:code-review` owns the pre-commit self-review and the peer-review-request workflow.
- `sp:spur-dev` owns the task lifecycle — `sp:branch-workflow` owns the git branch lifecycle that runs alongside it.
### Requirements
R1. A new `sp:sys-debugging` skill exists under `plugins/sp/skills/sys-debugging/SKILL.md` with YAML frontmatter declaring `metadata.platforms: "claude-code,codex,openclaw,opencode,antigravity"` and `version: 1.0`. The SKILL.md teaches the reproduce→isolate→root-cause→fix→regression-test protocol, the "ask the debugger before the LLM" principle, the 15-minute escalation rule, and when to create an issue task from a debugging session.

R2. The `sp:sys-debugging` skill carries `references/debugging-protocol.md` — the full protocol with per-phase decision gates, common failure-mode signatures (stack traces, type errors, assertion failures, timeout/deadlock, non-deterministic flaky tests), and per-language diagnostic commands (Bun/TS, Go, Python).

R3. A new `sp:code-review` skill exists under `plugins/sp/skills/code-review/SKILL.md` with `version: 1.0` and the same platform list. The SKILL.md teaches two workflows: (a) pre-commit self-review — a checklist the author runs before requesting review, catching 60-80% of issues; (b) requesting/receiving agent review — how to prepare a review request, what context to include, and how to process received findings into actionable tasks.

R4. The `sp:code-review` skill carries `references/self-review-checklist.md` (the pre-commit checklist: type-safety, null-handling, error-propagation, test-coverage, security-surface, performance-regression) and `references/review-lenses.md` (correctness, security, efficiency, maintainability, usability lenses with per-lens diagnostic questions).

R5. A new `sp:branch-workflow` skill exists under `plugins/sp/skills/branch-workflow/SKILL.md` with `version: 1.0`. The SKILL.md teaches the branch lifecycle: create feature branch → optional worktree isolation → atomic conventional commits → pre-merge self-review → merge → cleanup. Includes git worktree patterns for parallel branches.

R6. The `sp:branch-workflow` skill carries `references/branch-lifecycle.md` (the full lifecycle with per-phase git commands) and `references/worktree-patterns.md` (when to use worktrees, how to create/clean up, parallel-branch strategies).

R7. `sp:code-verification`'s `references/secu-review.md` is updated to include a "Pre-Completion Verification" section — a lightweight checklist run before declaring a task done: all tests pass, lint clean, no TODO/FIXME without a linked task, git status clean, no debug artifacts.

R8. Three new slash commands exist:
- `plugins/sp/commands/dev-debug.md` — delegates to `sp:sys-debugging`, `argument-hint: "<error-description-or-log> [--agent <name|auto>] [--create-issue]"`
- `plugins/sp/commands/dev-review-req.md` — delegates to `sp:code-review`, `argument-hint: "[<wbs>] [--mode <self|request>] [--agent <name|auto>] [--focus <lens>]"`
- `plugins/sp/commands/dev-branch.md` — delegates to `sp:branch-workflow`, `argument-hint: "<action> [name] [--worktree] [--agent <name|auto>]"`

R9. The `plugins/sp/tests/skill-structure.test.ts` suite is extended with invariants R25 (sys-debugging skill + protocol reference exist), R26 (code-review skill + self-review-checklist + review-lenses references exist), and R27 (branch-workflow skill + branch-lifecycle + worktree-patterns references exist).

R10. The `plugins/README.md` directory layout, skills table, commands table, and relationship diagram are updated to reflect the new entities (15 skills, 22 commands).

R11. All new markdown files pass existing invariants R16b, R16c, R16d, and R20 (no vendors/rd3 refs in shipped plugin files).

R12. Cross-cutting references: the new skills' content does not duplicate `sp:spur-dev/references/cross-cutting.md`; cross-cutting.md remains the single SSOT (R13 invariant holds). New skills may soft-link to existing competency skills but contain no hard imports or runtime dependencies.
### Acceptance Criteria
**@core — Three new skills exist and pass structural invariants**

Given the `sp` plugin with 12 existing skills
When `sp:sys-debugging`, `sp:code-review`, and `sp:branch-workflow` skills are added with their SKILL.md + reference files
Then `bun run test` passes including R16b (no dangling refs), R16c (links resolve), R16d (no retired names), and R20 (no vendors/rd3 refs)
And R25/R26/R27 invariants confirm all required files exist

**@core — dev-debug command provides structured debugging entry**

Given a user encounters a runtime error "TypeError: Cannot read properties of undefined"
When they invoke `/sp:dev-debug "TypeError: Cannot read properties of undefined"`
Then the command delegates to `sp:sys-debugging`
And the skill walks the reproduce→isolate→root-cause→fix→regression-test protocol
And the "ask the debugger before the LLM" principle is applied at the isolate phase

**@core — dev-review-req self-review mode catches issues pre-commit**

Given a developer has staged changes for task 0164
When they invoke `/sp:dev-review-req --mode self`
Then the skill runs through the pre-commit self-review checklist (type-safety, null-handling, error-propagation, test-coverage, security-surface)
And any findings are surfaced before the commit proceeds
And the developer can fix issues before requesting peer/agent review

**@core — dev-review-req request mode produces actionable review**

Given a developer has committed changes for task 0164
When they invoke `/sp:dev-review-req 0164 --mode request`
Then the skill prepares a review request with task context, change summary, and self-review results
And the reviewer (agent or human) receives structured context to begin the review

**@core — dev-branch manages full branch lifecycle**

Given a developer starts work on a new feature
When they invoke `/sp:dev-branch create feature-auth --worktree`
Then the skill creates a feature branch in an isolated git worktree
And the developer works in the isolated directory without affecting the main working tree
And `/sp:dev-branch finish` handles merge preparation, pre-merge self-review, and cleanup

**@core — Pre-completion verification absorbed into code-verification**

Given a task is approaching `done` status
When the verify step runs via `sp:code-verification`
Then the pre-completion verification checklist (all tests pass, lint clean, no TODO/FIXME without linked task, git status clean, no debug artifacts) is included in the verification scope

**@edge — Debugging creates issue task when root cause found**

Given a debugging session via `/sp:dev-debug --create-issue`
When root cause is identified and fixed
Then an issue-type task is created capturing the root cause, fix, and regression test
And the task is linked to the original failure context

**@edge — No regression on existing pipeline**

Given the existing `task-pipeline.yaml` and `sp:spur-dev` execution half
When the three new skills and commands are added
Then the sequential pipeline is unchanged — no existing command or workflow is re-wired
And `bun run test` shows no regressions in existing test files
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach:** Three standalone skills following the ADR-028 competency pattern, plus one enhancement to an existing skill. Each owns a distinct daily-workflow concern; none overlap with the execution pipeline. Commands are thin routers. No new CLI verbs needed — the skills teach agent behavior; the CLI is only involved when creating follow-up tasks from debugging/review sessions.

**Key decision: skills, not engine features.** These are methodology skills — they teach the agent *how* to debug, review, and branch. They don't require engine changes because they operate in the "between-pipeline" space. The only CLI integration is `spur task create` when a debugging session yields an issue task or a review session yields follow-up tasks.

**Entity inventory:**

| # | Entity | Type | Action |
|---|--------|------|--------|
| 1 | `skills/sys-debugging/SKILL.md` | New skill | Debugging protocol with per-phase decision gates |
| 2 | `skills/sys-debugging/references/debugging-protocol.md` | New reference | Full protocol with language-specific diagnostic commands |
| 3 | `skills/code-review/SKILL.md` | New skill | Self-review + review-request workflows |
| 4 | `skills/code-review/references/self-review-checklist.md` | New reference | Pre-commit checklist (6 lenses) |
| 5 | `skills/code-review/references/review-lenses.md` | New reference | Correctness, security, efficiency, maintainability, usability |
| 6 | `skills/branch-workflow/SKILL.md` | New skill | Branch lifecycle + worktree patterns |
| 7 | `skills/branch-workflow/references/branch-lifecycle.md` | New reference | Full lifecycle with per-phase git commands |
| 8 | `skills/branch-workflow/references/worktree-patterns.md` | New reference | Worktree creation, parallel-branch strategies, cleanup |
| 9 | `commands/dev-debug.md` | New command | Thin router → `sp:sys-debugging` |
| 10 | `commands/dev-review-req.md` | New command | Thin router → `sp:code-review` |
| 11 | `commands/dev-branch.md` | New command | Thin router → `sp:branch-workflow` |
| 12 | `skills/code-verification/references/secu-review.md` | Edit | Add "Pre-Completion Verification" checklist section |
| 13 | `tests/skill-structure.test.ts` | Edit | Add R25, R26, R27 invariants |
| 14 | `../README.md` | Edit | Update directory layout, tables, diagram |

**Rejected alternative — fold debugging into code-implementation:** `sp:code-implementation/references/debugging.md` already exists. The argument for folding: one less skill. The argument against: debugging is triggered by *failures* ("I have a bug"), not by *implementation intent* ("write code for task X"). Disjoint triggers (R16a) require them to be separate skills — an agent hitting a runtime error should not route through the implementation skill. The existing `debugging.md` reference stays in `code-implementation` (it covers debugging *during* implementation) and the new skill covers standalone debugging sessions.

**Rejected alternative — merge branch-workflow into spur-dev:** Branch lifecycle is orthogonal to task lifecycle. A task can span multiple branches; a branch can contain multiple tasks. Keeping them separate avoids coupling the task state machine to git state.

**Invariants preserved:**
- R13 (cross-cutting.md single-SSOT): no cross-cutting content duplicated
- R16a (disjoint triggers): each new skill has distinct trigger vocabulary with no overlap against existing skills
- R17 (no hard cross-competency dependency): only soft prose cross-links
- R20 (no vendors/rd3 refs): all content is Spur-native, authored fresh (not copied from Superpowers/gstack — those are reference inspiration only)
### Plan
- [ ] 1. Create `sp:sys-debugging` skill SKILL.md — reproduce→isolate→root-cause→fix→regression-test protocol, "ask the debugger before the LLM" principle, 15-minute escalation rule, issue-task creation from debugging sessions
- [ ] 2. Create `references/debugging-protocol.md` — per-phase decision gates, common failure-mode signatures (stack traces, type errors, assertion failures, timeout/deadlock, flaky tests), per-language diagnostic commands (Bun/TS, Go, Python)
- [ ] 3. Create `sp:code-review` skill SKILL.md — pre-commit self-review workflow (checklist-driven, catches 60-80% of issues before review), review-request preparation (context packaging, self-review results attachment), receiving-and-processing review findings into actionable tasks
- [ ] 4. Create `references/self-review-checklist.md` — type-safety, null-handling, error-propagation, test-coverage, security-surface, performance-regression categories with per-category diagnostic questions
- [ ] 5. Create `references/review-lenses.md` — correctness / security / efficiency / maintainability / usability lenses with per-lens diagnostic questions and finding-severity guidance (P1–P4)
- [ ] 6. Create `sp:branch-workflow` skill SKILL.md — full branch lifecycle: create feature branch → optional worktree isolation → atomic conventional commits → pre-merge self-review → merge → cleanup; git worktree patterns for parallel branches
- [ ] 7. Create `references/branch-lifecycle.md` — per-phase git commands, branch-naming conventions, merge-strategy guidance (rebase vs. merge commit), cleanup checklist
- [ ] 8. Create `references/worktree-patterns.md` — when to use worktrees (parallel features, hotfix isolation, review-in-progress), creation/cleanup commands, parallel-branch strategies, disk-space awareness
- [ ] 9. Create `/sp:dev-debug` command — YAML frontmatter, delegation to `sp:sys-debugging`, `--create-issue` flag for task creation from root cause
- [ ] 10. Create `/sp:dev-review-req` command — YAML frontmatter, delegation to `sp:code-review`, `--mode self|request` flag, `--focus <lens>` flag
- [ ] 11. Create `/sp:dev-branch` command — YAML frontmatter, delegation to `sp:branch-workflow`, `<action>` positional (create|finish|cleanup), `--worktree` flag
- [ ] 12. Update `sp:code-verification/references/secu-review.md` — add "Pre-Completion Verification" section with lightweight checklist (tests pass, lint clean, no TODO/FIXME without linked task, git status clean, no debug artifacts)
- [ ] 13. Add R25 invariant to test suite — assert sys-debugging skill + debugging-protocol.md exist
- [ ] 14. Add R26 invariant — assert code-review skill + self-review-checklist.md + review-lenses.md exist
- [ ] 15. Add R27 invariant — assert branch-workflow skill + branch-lifecycle.md + worktree-patterns.md exist
- [ ] 16. Update `plugins/README.md` — directory layout (15 skills), skills table (3 new rows), commands table (22 total, 3 new rows), relationship diagram (3 new skill nodes + edges)
- [ ] 17. Run `bun run lint && bun run test` — all invariants pass, no regressions
- [ ] 18. Run `bun run build` — binary compiles with new bundled skills
### Solution
| file:line | Change | Rationale |
|-----------|--------|-----------|
| `plugins/sp/skills/sys-debugging/SKILL.md:1` | New — 109 lines | 5-phase debugging protocol: reproduce→isolate→root cause→fix→regression test; debugger-first rule; 15-min escalation; issue-task creation |
| `plugins/sp/skills/sys-debugging/references/debugging-protocol.md:1` | New — 72 lines | Per-phase decision gates, 10 failure-mode signatures, per-language diagnostic commands (Bun/TS, Go, Python) |
| `plugins/sp/skills/code-review/SKILL.md:1` | New — 85 lines | Three workflows: pre-commit self-review (6-category checklist), requesting agent review with SECUA lenses, processing findings into tasks |
| `plugins/sp/skills/code-review/references/self-review-checklist.md:1` | New — 42 lines | 6 categories: type-safety, null-handling, error-propagation, test-coverage, security-surface, performance-regression; skip rules for docs/test/config |
| `plugins/sp/skills/code-review/references/review-lenses.md:1` | New — 65 lines | SECUA lenses: correctness, security, efficiency, usability, architecture — per-lens diagnostic questions and severity guidance (P1–P4) |
| `plugins/sp/skills/branch-workflow/SKILL.md:1` | New — 77 lines | Branch lifecycle: create→worktree→commit→self-review→merge→cleanup; naming conventions; worktree decision guide |
| `plugins/sp/skills/branch-workflow/references/branch-lifecycle.md:1` | New — 53 lines | Full lifecycle per-phase commands, naming conventions, merge strategy (--no-ff), cleanup |
| `plugins/sp/skills/branch-workflow/references/worktree-patterns.md:1` | New — 60 lines | When-to-use decision table, create/list/remove/prune commands, parallel-branch strategy, disk-space awareness |
| `plugins/sp/commands/dev-debug.md:1` | New — 35 lines | Thin slash-command: --create-issue flag, delegates to sp:sys-debugging |
| `plugins/sp/commands/dev-review-req.md:1` | New — 42 lines | Thin slash-command: --mode self|request, --focus lens, delegates to sp:code-review |
| `plugins/sp/commands/dev-branch.md:1` | New — 38 lines | Thin slash-command: create|finish|cleanup actions, --worktree flag, delegates to sp:branch-workflow |
| `plugins/sp/skills/code-verification/references/secu-review.md:80` | Edit — +16 lines | Added Pre-Completion Verification checklist (tests, lint, TODO/FIXME, git status, console.log, Solution file:line, Review P1–P4) |
| `plugins/sp/tests/skill-structure.test.ts:248` | Edit — +18 lines | Added R25 (sys-debugging + protocol), R26 (code-review + checklist + lenses), R27 (branch-workflow + lifecycle + worktrees) invariants |
| `plugins/README.md:14` | Edit — +8 lines | Updated directory layout (16 skills), skills table (3 new rows), skill count 13→16 |
### Testing
**Pipeline verify results**

- Verdict: UNKNOWN (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| — | — | No requirements recorded; verify verdict UNKNOWN |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: UNKNOWN)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict UNKNOWN |
### References



<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-06-30T23:11:33.437Z backlog → todo (system)
- 2026-06-30T23:48:46.044Z todo → wip (system)
- 2026-06-30T23:48:47.656Z wip → testing (system)
- 2026-06-30T23:48:49.286Z testing → done (system)
