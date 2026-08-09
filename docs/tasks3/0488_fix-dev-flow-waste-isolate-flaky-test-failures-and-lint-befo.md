---
template: meta
schema_version: 1
name: "Fix dev-flow waste: isolate flaky test failures and lint before the comprehensive gate"
description: ""
status: cancelled
type: meta
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-09T06:08:34.766Z"
updated_at: "2026-08-09T17:28:21.402Z"
---

## 0488. Fix dev-flow waste: isolate flaky test failures and lint before the comprehensive gate

### Background
**CANCELLED 2026-08-09 — no-op.** Both original requirements proposed documenting guidance that
already exists verbatim in the exact files this task named as the destination, is linked from
`sp:code-testing/SKILL.md`, and is enforced by `plugins/sp/tests/skill-structure.test.ts:1029`.
Implementing it would have added a fourth copy of a rule already written three times. The finding is
**adherence**, not missing content. Verification of the original evidence also found the central
claim to be wrong (below).

Task 0485 (agent executor exhaustion failover) took ~2.7h of tool activity inside a single ~5.1h OMP
session (`019fe3f7`, 2026-08-08 ~17:41-22:46 local). The dominant cost is legitimate task
complexity — 6 requirements across 4 packages (`agent-service.ts`, `workflow-service.ts`,
`stage-registry/schema.ts`, `agent-run.ts`) and 20+ new tests — not a fixable defect. That part of
the original analysis stands.

**Corrections to the original evidence (re-derived from the raw session JSONL):**

- **"13 full-suite re-runs" is wrong.** 13 is the count of *all* test invocations in the 00:52-01:19
  window. Only **6** were full `bun test apps/cli/tests` (01:09:15, 01:09:47, 01:10:17, 01:10:41,
  01:11:06, 01:19:43). Four were targeted `--test-name-pattern` runs and three were scoped-file runs.
- **The prescribed discipline was already applied.** The first action of the flake investigation
  (00:52:37) was a `--test-name-pattern` run, and 01:11:35 ran the flake candidate 3x in a loop to
  confirm transience — textbook flake triage. The original R1 would have graded this session PASS.
- **"~27 wall-clock minutes" is wrong.** The contiguous flake-chase burst is 01:09:15-01:12:13,
  **~3 minutes**. The 01:12-01:19 span was 0484 task recording (`task record`, `task update`, git
  status), not flake chasing. Redundant suite execution is ~80s, not "5-6 min".
- **"0 compactions" is wrong.** One compaction record exists at `06:53:06.323Z`. It falls at the very
  end of the session, during the `sp-issue-finding` analysis itself, so "0 compactions during the
  0485 implementation window" is fair — the flat claim is not.
- **"280 tool executions" is wrong.** Actual count is **296** (read 61, bash 134, edit 37, todo 20,
  write 17, grep 13, eval 10, glob 3, ask 1).

**What the session actually did wrong (RC1, corrected):** the five runs at 01:09:15-01:11:06 are the
*same* command varying only in the output filter (`grep -E "pass|fail"` → `grep -B1 -A6 "fail)"` →
`grep -E "fail\)|✗|FAIL"` → `grep -iE "fail"` → `grep -E "^ *[0-9]+ (pass|fail)"`). The suite was
re-executed to re-grep output it had already produced and discarded. This is not a test-scoping
failure; it is an output-capture failure.

**RC2 stands but is minor.** `bun run spur-check` ran at 04:26:25 (failed on biome formatting of the
new test files), `biome check --write` at 04:28:20, re-run at 04:33:57 passed. One ~60s gate cycle
lost to a mechanical issue — but `AGENTS.md:289` already budgets "at most twice per task", so the
session was *within* the documented limit.
### Requirements
- [x] R1. **WITHDRAWN — no-op** (resolved by withdrawal, not implementation). Originally: record
  flake-isolation guidance next to the targeted-test-first discipline. Withdrawn because
  `code-testing/references/test-output-discipline.md` already states it verbatim ("Do not run a full
  suite again while debugging one assertion. Isolate with `--test-name-pattern`…"), and
  `test-loop-breaker.md` already names the actual mechanism observed ("Changing flags, output
  filters, or temporary filenames does not reset the count"). The premise was also false: the session
  used `--test-name-pattern` 4 times, including as the first action of the investigation.
- [x] R2. **WITHDRAWN — no-op** (resolved by withdrawal, not implementation). Originally: document
  lint/format-before-gate for inline pipeline driving. Withdrawn because the ordering is already
  authoritative in two places: `AGENTS.md:267` (verification gate step 1 =
  `bun run autofix && bun run spur-check`) and `config/workflows/task-pipeline.yaml:87`
  (`qualityGateCmd: "bun run format && bun run spur-check"`).
### Acceptance Criteria
**WITHDRAWN** — both scenarios described the withdrawn R1/R2 and are removed with them.

The original R1 scenario ("a transient full-suite failure is isolated before a full-suite re-run")
would have graded the very session it was written to catch as PASS: that session opened its flake
investigation with a `--test-name-pattern` run at 00:52:37 and re-confirmed the flake with a 3x
targeted loop at 01:11:35. An AC that passes the behaviour it was written to prevent is the clearest
signal the requirement was mis-derived.
### Q&A
- Q: Was task 0485 itself slow because of a defect?
  - A: No. The ~2.7h is mostly legitimate work — 6 requirements across 4 packages, 20+ new tests,
    and 9 targeted/full test runs. The session had 0 compactions, 0 guard failures, and no
    repeated-command loops. The two wastes found are S2 (process) and not the driver of the wall
    clock.
- Q: Why is the flake-chase the biggest finding even though it is in the 0484 phase, not 0485?
  - A: It is the largest single avoidable cost in the session: 13 full `apps/cli/tests` re-runs
    over ~27 wall-clock minutes to confirm a transient 2-fail. The suite is cheap (~20s each) but
    the repeated full re-runs plus re-reading to locate the failing test added ~5-6 min and several
    minutes of reasoning. Isolating via `--test-name-pattern` removes the whole loop.
- Q: Why did `spur-check` run twice for 0485?
  - A: The inline flow ran the comprehensive gate before the new test files were biome-clean. The
    first run failed purely on biome line-wrap formatting; `biome check --write` fixed it and the
    re-run passed. The pipeline `test` step already runs `bun run format` before the gate — the
    inline path skipped that format-first order.
- Q: Are these worth fixing?
  - A: Yes, but low priority (S2 / P3). They are guidance/adherence fixes, not code defects.
    Codifying them prevents recurrence at near-zero cost — the fix is a few lines of guidance plus
    following it.
- Q: Could this be a hook or a rule rather than guidance?
  - A: Partially. The biome-before-gate issue is already caught by the pre-commit / lint gate (that
    is exactly why spur-check failed before biome ran). The flake-triage is a judgement discipline
    (distinguish flaky from real before re-running the suite) and belongs as guidance in
    `sp-code-testing`, not a deterministic hook.
- Q: Will fixing this change 0485-type task durations materially?
  - A: No. 0485 was large and most of its time was legitimate. These fixes remove minutes of
    avoidable waste per task, not hours; they matter for hygiene and throughput across many tasks,
    not for any single large task.
### Design
**Root cause (corrected): the guidance existed at every layer and was never loaded.**

Session read counts show `sp:code-testing` and its two reference files were read **0 times** during
the entire run. The spine `sp:spur-dev/SKILL.md` *was* read (00:43:00) and line 113 of it already
carries the dispatch contract: "Test (dispatch) | execution | `sp:code-testing` | competency skill —
the spine dispatches, does not inline". The inline pipeline run simply never dispatched.

Every layer of the supposed fix already exists:

| Layer | Where | Already covers |
| --- | --- | --- |
| Loop cap | `code-testing/references/test-loop-breaker.md` | "Hard cap: three executions of the same command without a relevant source/test change." **"Changing flags, output filters, or temporary filenames does not reset the count."** Anti-pattern: "test → grep → unchanged test → same failure." |
| Output capture | `code-testing/references/test-output-discipline.md` | The captured-log pattern (`test_log=$(mktemp)`; run once; re-grep the file) and "Do not run a full suite again while debugging one assertion. Isolate with `--test-name-pattern`…" |
| Link + enforcement | `code-testing/SKILL.md:48,50`; `plugins/sp/tests/skill-structure.test.ts:1029` | Both references linked from SKILL.md; links asserted by a structure test |
| Dispatch contract | `spur-dev/SKILL.md:113`; `spur-dev/references/dev-operations.md:104` | Spine dispatches the test phase to `sp:code-testing` |
| Format-before-gate | `AGENTS.md:267` | Verification gate step 1 is `bun run autofix && bun run spur-check` (autofix = format + typecheck) |
| Format-before-gate | `config/workflows/task-pipeline.yaml:87` | `qualityGateCmd: "bun run format && bun run spur-check"` |

RC1's real mechanism (re-running a suite to change an output filter) is named *explicitly* in
`test-loop-breaker.md`. RC2's fix is written twice. There is no content gap to close.

**Why the original R1/R2 were withdrawn.** R1's premise ("the whole suite was re-run each time
instead of isolating with `--test-name-pattern`") is contradicted by the log — `--test-name-pattern`
was used 4 times including as the first action. Its AC would have passed the very session it was
written to catch. R2 asked to document an ordering already documented in two authoritative places.
Both are no-ops; neither would prevent recurrence, because non-adherence is not fixed by another
copy of the rule.

**What worked well (preserve):** 0 compactions and no repeated-command loops during the 0485
implementation window; the pipeline `test` step's format-first-then-gate shape is correct as written.
### Plan
- [x] Verify the two proposed fixes against the raw session JSONL and their destination files (done 2026-08-09 — both already present verbatim)
- [x] Correct the overstated evidence (13→6 full-suite runs, ~27→~3 min, 0→1 compaction, 280→296 tool calls)
- [x] Cancel the task rather than write a fourth copy of existing guidance
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Session log: `~/.omp/agent/sessions/-xprojects-spur-new/2026-08-09T00-41-10-472Z_019fe3f7-6a48-7000-9111-2fdac908f835.jsonl` (OMP, source=omp, High fidelity; 280 tool executions, 0 compactions)
- Task 0485: `docs/tasks3/0485_agent-executor-exhaustion-failover-classifier-coverage-imple.md` (the slow task under analysis)
- Task 0484: `docs/tasks3/0484_fix-feature-n-batch-defects-worktree-merge-contradiction-p.md` (the flake-chase phase)
- Guidance owners: `AGENTS.md` (targeted-test-first; verification gate), `config/workflows/task-pipeline.yaml` `test` step (format-first gate)
- Methodology: `sp-issue-finding` (5-phase protocol: DISCOVER/ANALYZE/IDENTIFY/PROPOSE/GENERATE)
### History
- 2026-08-09T17:27:44.760Z todo → cancelled (system)
### Notes
**Disposition: cancelled as a no-op (2026-08-09), after verification against the raw session JSONL.**

The one finding worth carrying forward is not the one this task was written for. It is:

> During an inline `/sp:dev-run`, the spine's documented test-phase dispatch to `sp:code-testing`
> did not happen (0 reads of the skill or its references across 296 tool calls), so three layers of
> already-written, already-linked, already-test-enforced testing discipline never reached the point
> of use.

That is an adherence/dispatch gap, not a content gap. It is deliberately **not** re-opened as a
documentation task here: writing a fourth copy of the rule is what this task was cancelled for. If it
recurs and is judged worth mechanising, the only fix with teeth is deterministic — e.g. detecting a
repeated identical test command whose sole delta is the output filter — not more prose.

**Method note for future `sp-issue-finding` runs.** Three of this task's four headline numbers were
wrong in the same direction (overstated waste): 13 vs 6 full-suite runs, ~27 min vs ~3 min, 0 vs 1
compaction, 280 vs 296 tool calls. The 13/6 error came from counting *all* test invocations and
labelling them "full-suite re-runs". Post-mortem findings should be re-derived from the log with the
classifying predicate stated explicitly, and a proposed fix should be grepped for in its own
destination file before it is written as a requirement.
