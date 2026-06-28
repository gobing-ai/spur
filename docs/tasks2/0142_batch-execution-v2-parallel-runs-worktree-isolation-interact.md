---
template: feature-impl
schema_version: 1
name: "Batch execution v2 — parallel runs (worktree isolation) + interactive within-step escalation"
description: ""
status: blocked
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P3
tags: []
dependencies: []
created_at: "2026-06-28T05:37:28.269Z"
updated_at: 2026-06-28T16:53:38.429Z
---

## 0142. Batch execution v2 — parallel runs (worktree isolation) + interactive within-step escalation

### Background
Task 0141 shipped batch task execution (`/sp:dev-runall` + the `sp:super-coder` orchestrator) with
two slices **explicitly deferred** to keep v1 a solid, sequential slice. This task tracks those two
follow-ups. Neither is buildable today without prerequisites; this is a backlog placeholder that
records the design intent and the gating so 0141 can close without dangling promises.


v1 runs the plan strictly sequentially because the per-task pipeline mutates the **shared corpus**
(`docs/tasks*/`, feature files) and the **git working tree**. Two tasks running at once over
overlapping files corrupt each other. Parallelism requires per-run isolation — a **git worktree**
(or equivalent sandbox) per concurrent task — plus a join/merge step and a concurrency bound.
Topologically-independent tasks (no dependency path between them) are the only candidates.

**Prerequisite:** none hard — git worktrees exist today. The work is the isolation + merge
mechanism + the orchestrator's fan-out/fan-in logic. The risk is corpus-merge conflicts on the
auto-generated kanban/index (`spur task refresh` / `spur feature refresh` output).


v1's `sp:super-coder` surfaces blockers only at the **batch boundary** (between task runs). It cannot
let a headless `agent.run` subprocess (implement/test/review inside one task's pipeline) ask the
operator a real question mid-step — the subprocess runs detached and captures an answer file. The
"represent me — auto-answer routine decisions, escalate genuine ones" promise needs a channel from a
running step back to the operator.

**Prerequisite (hard blocker):** the **workspace module + inbox module + enhanced `spur agent` team
mode**. Per the 0141 design and `docs/04_DESIGN.md` (spur-team-mode-design), within-step Q&A is
routed through the inbox/team-mode messaging seam, not invented here. This slice **cannot start**
until those modules land; it is `blocked`, not merely `todo`.


0141 is `done` and verified. These two slices have distinct prerequisites (Slice B is hard-blocked),
distinct blast radius (Slice A touches git/worktree mechanics + corpus merge), and should be
prioritized independently. Folding them back into 0141 would either block its closure or ship a
half-feature advertised as whole — the exact failure mode 0141's `⚠️ PARTIAL` discipline exists to
prevent.
### Acceptance Criteria
```gherkin
Feature: Batch execution v2 — parallel runs + interactive within-step escalation

  # ── R6: parallel execution of independent tasks (worktree isolation) ──
  Scenario: R6.1 Independent tasks run concurrently under isolation
    Given two topologically-independent tasks in the plan
    And a concurrency bound greater than one
    When the batch runs in parallel mode
    Then each task executes in its own isolated worktree
    And neither task's corpus or working-tree writes clobber the other

  Scenario: R6.2 Dependent tasks never run concurrently
    Given task B depends on task A in the plan
    When the batch runs in parallel mode
    Then A completes and merges before B starts

  Scenario: R6.3 Concurrency is bounded
    Given N independent tasks and a concurrency bound of K (K < N)
    When the batch runs in parallel mode
    Then at most K tasks execute at any moment

  Scenario: R6.4 Isolated runs merge back cleanly
    Given parallel tasks completed in separate worktrees
    When the batch joins them
    Then each task's committed changes land on the base branch
    And the auto-generated kanban/index are regenerated once after the join, not raced

  Scenario: R6.5 Parallel mode is opt-in; sequential remains default
    Given no parallelism flag
    When the batch runs
    Then it runs sequentially (the v1 behavior is unchanged)

  # ── R7: interactive within-step escalation (workspace + inbox + team mode) ──
  Scenario: R7.1 A running step can escalate a real question to the operator
    Given a pipeline step encounters a genuine decision outside its authority
    When it escalates
    Then the question reaches the operator through the inbox/team-mode channel
    And the step blocks awaiting the answer rather than guessing

  Scenario: R7.2 Routine decisions are auto-answered, not escalated
    Given a pipeline step encounters a decision within the agent's authority
    When it proceeds
    Then it decides without escalating (no operator interruption for routine choices)

  Scenario: R7.3 The operator's answer resumes the blocked step
    Given a step is blocked on an escalated question
    When the operator answers via the inbox
    Then the step resumes with that answer
    And the batch continues

  Scenario: R7.4 Escalation is gated on the prerequisite modules
    Given the workspace + inbox + team-mode modules are not yet available
    When within-step escalation is attempted
    Then the capability is unavailable and the task remains blocked on its prerequisite
```

- [ ] R6.1 Independent tasks run concurrently under isolation
- [ ] R6.5 Parallel mode is opt-in; sequential remains default
- [ ] R7.1 A running step can escalate a real question to the operator
- [ ] R7.4 Escalation is gated on the prerequisite modules
### Design
Two independent slices extending the 0141 batch driver. Same architectural stance as 0141 where
possible (orchestration as prose over CLI verbs, ADR-022) — but each slice introduces a genuinely new
mechanism, so this task is **not** pure-markdown by mandate the way 0141 was. Where new mechanism is
unavoidable (worktree isolation, the escalation channel), it belongs in the **owning module**, never
as ad-hoc code in the plugin (`plugins/sp/scripts/<subfolder>` only if a script is truly justified,
never under a skill subtree).


Extends `sp:super-coder`'s sequential driver loop (`execution-batch.md` Step 3) with a bounded
fan-out/fan-in over **topologically-independent** tasks.

- **Isolation:** each concurrent task runs in its own `git worktree` rooted at the base branch.
  `spur workflow run` executes inside that worktree (`--cwd` already exists on `spur agent run`;
  confirm/extend the pipeline's cwd plumbing). One worktree = one task's blast radius.
- **Scheduling:** the topo-sort already yields the dependency DAG; parallel mode releases all
  zero-indegree tasks up to a concurrency bound `K` (`--parallel <K>`, default 1 = today's
  sequential behavior — R6.5). As each finishes and merges, its dependents' indegrees decrement;
  newly-zero tasks are released.
- **Join/merge (R6.4):** on a task's clean completion, fast-forward/merge its worktree commits onto
  the base branch, then remove the worktree. The auto-generated kanban/index (`spur task refresh` /
  `spur feature refresh`) regenerate **once** after the join barrier, never concurrently — they are
  whole-corpus writes and must not race.
- **Conflict policy:** a merge conflict on a non-generated file is a failure for that task (apply the
  batch failure policy from 0141). Generated-file conflicts are avoided by deferring refresh to the
  barrier.
- **Open design question (resolve before build):** worktrees vs. a lighter sandbox; how to bound
  conflict risk when two independent tasks legitimately edit the same source file (they are
  "independent" by task-dependency, not by file-touch). Document the chosen model in
  `docs/design/<slug>.md` and index it in `04 §7.8`.


The `sp:super-coder` "represent me" contract gains a real escalation channel from inside a running
pipeline step back to the operator.

- **Routing:** escalations flow through the **inbox / `spur agent` team-mode** messaging seam
  (the `spur message` surface + team mode), NOT a bespoke mechanism. A blocked step posts a
  structured question to the operator's inbox and waits; the operator's reply resumes it. This reuses
  `spur message send/inbox/reply` rather than inventing a channel.
- **Authority boundary (R7.2):** the step's executing agent auto-answers decisions within the global
  Decision Authority table (naming, test structure, which existing pattern to follow); it escalates
  only genuine decisions (schema/API/auth/irreversible/scope-affecting-AC). This is the same boundary
  `sp:super-coder` applies at the batch level, pushed down to the step level.
- **Prerequisite (blocking):** workspace module + inbox module + enhanced `spur agent` team mode.
  Until they ship, R7 is unbuildable (R7.4). This task stays `blocked` on those modules; only Slice A
  is independently startable.


Slice A (parallel) is startable now. Slice B (escalation) is blocked. They may be split into two
tasks at refine time if their timelines diverge — keep them together here only while both are
backlog.
### Plan
- [ ] **P1 — Slice A design spike (parallel).** Resolve the open design question (worktree vs.
      sandbox; same-file conflict policy for task-independent-but-file-overlapping runs). Write
      `docs/design/<slug>.md`, index it in `04 §7.8`. (R6)
- [ ] **P2 — Slice A: worktree isolation + cwd plumbing.** Confirm/extend the pipeline's cwd path so
      `spur workflow run` executes inside a per-task git worktree. (R6.1)
- [ ] **P3 — Slice A: bounded scheduler + join barrier.** Extend `sp:super-coder`'s loop with
      `--parallel <K>` (default 1), zero-indegree release up to K, merge-on-complete, single
      post-barrier `refresh`. Update `execution-batch.md` + `dev-runall.md` flag table. (R6.2–R6.5)
- [ ] **P4 — Slice A: tests + dogfood.** Cover concurrency bound, dependent-never-concurrent,
      clean-merge, sequential-default. Dogfood a 2+ independent-task set. (R6)
- [ ] **P5 — Slice B (BLOCKED): escalation channel.** Gated on workspace + inbox + team-mode modules.
      Route within-step escalations through `spur message`/team mode; push the Decision Authority
      boundary down to step level; block-and-resume semantics. Do NOT start until prerequisites land.
      (R7)
- [ ] **P6 — Docs sync.** `04_DESIGN.md` (parallel flag + escalation seam), `05_FEATURES.md §9`
      (promote the deferred row as slices ship). ADR entry if worktree-isolation is judged a new
      cross-cutting decision.
### Solution

### Testing

### Review

### References

### History
- 2026-06-28T05:39:44.679Z todo → blocked (system)
- 2026-06-28T05:39:57.815Z blocked → todo (system)
- 2026-06-28T16:53:38.429Z todo → blocked (system)
