---
schema_version: 1
name: Start or resume a workflow run from a chosen state
status: backlog
template: feature-impl
created_at: 2026-10-04T06:57:19.805Z
updated_at: "2026-10-04T06:59:01.761Z"
feature_id: D6

---

## 1072. Start or resume a workflow run from a chosen state

### Background

A workflow run that finishes without doing all the work the operator wants has no engine path to continue it.

Live example (20261002 knowledge-kit daily episode): the run was launched with `publish_enabled=false`, so the
state machine correctly reached `quality-control → done` (run `aed3a205-4cc8-4049-8fab-f9f82a35acd9`,
2026-10-03T03:27Z → 04:26Z). Publishing that episode afterwards had no `spur workflow run` entry point: the CLI
offers `--run-id`, `--vars`, `--dry-run`, `--async`, `--no-plan`, `--quiet`, `--silent`, `--verbose`, `--detail`,
`--trace-file`, `--no-log`, `--steer`, `--json` — no `--from`, no `--start-state`, and `--resume` only continues a
run from its own saved state. The tail was therefore driven stage-by-stage with `kk stage …`.

That hand chain omitted three channels (en/ja locales, XHS, WeChat draft) and nothing said so: the run's own
artifacts still reported `full`, the trace recorded none of it, and the gap surfaced only when the operator looked
at the published sites. knowledge-kit has since added a per-channel completeness report so a hand-driven tail
cannot hide, but that treats the symptom. Structurally, a resumed publish is always hand-driven, and a hand-driven
tail is always incomplete in ways the harness cannot see.

The same gap applies in the other direction: a run that paused or failed mid-graph can only be resumed from its
own state, so re-driving one segment (e.g. the publish tail after fixing a credential) means either re-running the
expensive earlier nodes or leaving the engine entirely.

### Requirements

- [ ] R1. `spur workflow run` can begin at a chosen state: `--from <state-id>` on a run id or a fresh run id, validated
  against the workflow definition. An unknown state exits non-zero with a message naming the valid ids.
- [ ] R2. Nothing before the start state executes or is recorded as done. The run record carries the start point
  (`startState`, and `continuedFrom` when a prior run id is given), and the run-start plan/checklist shows the
  earlier nodes as not visited — a receipt must never imply an unwalked node ran.
- [ ] R3. Guards, transitions, terminal reasons and failure states behave exactly as in a normal run from that state
  onwards; `--dry-run` still walks the graph without executing, including from `--from`.
- [ ] R4. Mid-graph starts refuse by default where the definition declares earlier nodes as prerequisites (a
  definition-level marker or an explicit opt-out flag), so this flag cannot silently skip a required side effect —
  the anti-pattern that produced the KIT incident.
- [ ] R5. Lineage is visible: run list/trace shows that a run started at state X and, when applicable, which run it
  continued from.
- [ ] R6. Existing behavior is untouched when `--from` is absent: pause/resume, interrupt, `--async`, steering, run
  memory and the two-file run record all behave as today.
- [ ] R7. Documented surface: `--from` semantics, the refuse-by-default rule, and a worked example (re-driving the
  publish tail of a completed daily run) in `spur workflow run --help` and the workflow docs.

### Acceptance Criteria

- AC1 — Given a workflow file and a state id, when `spur workflow run <file> --from <state> --vars '{…}'` runs,
  then execution starts at that state (no earlier action is invoked) and `.spur/memory/runs/<runId>.state.json`
  records the start state. (req: R1, R2)
- AC2 — Given an unknown `--from` state, or a mid-graph start on a workflow whose earlier nodes are declared
  required, when the command runs, then it exits non-zero with a specific message and writes no partial run record
  or run memory. (req: R1, R4)
- AC3 — Given the knowledge-kit daily workflow fixture started at `publish-prep`, when the run completes, then it
  reaches the same terminal states as the documented manual chain and produces the same per-state receipts, with
  every independent channel (locales, XHS, WeChat) executed — an end-to-end fixture run in an isolated project.
  (req: R3)
- AC4 — Given a run continued from an earlier run id, when `spur workflow list`/trace is read, then the lineage
  (source run id + start state) is shown. (req: R5)
- AC5 — Given the existing suites for pause, resume, interrupt, `--async`, steering and `--dry-run`, when the
  change lands, then they pass unchanged and no behavior differs when `--from` is absent. (req: R6)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Shape.** `WorkflowService.run` already resolves a `resumeFromState` internally (`src/service.ts` → `RunLifecycle.run`
/ `RunLifecycle.resume`, `loadLatestStateSnapshot`). `--from` exposes the same entry point for a *fresh* run id:
resolve the state id against the definition, seed vars (defaults + `--vars` + explicitly inherited recorded vars),
set `current = startState`, record `startState`/`continuedFrom` in run metadata, and enter the existing loop.

**Refusal rule.** Add an explicit definition attribute (e.g. `startable: true` on a state, or a workflow-level
`midGraphStart: { allowed: true }`) so a start point is an author's decision, not a CLI assumption; without it,
`--from` refuses with the reason. This is the guard that keeps the flag from becoming a way to skip required work.

**Plan output.** The run-start plan/checklist derives from the definition; it must render pre-start nodes as
"not visited" rather than pending/done, so the record of a partial graph is honest.

**Interactions to settle.** `--from` with `--async`, with `--steer`, with a paused source run, with `--dry-run`,
and with states whose `onEnter` actions assume earlier artifacts exist (the fixture in AC3 is the acceptance test
for the last one; knowledge-kit's `daily-publish-prep` refuses drafts without its inputs, which is the desired
fail-loud behavior).

**Routing note (D6).** This is a D6 public-CLI-surface item: the hand-driven publish tail is exactly the compound shell D6 exists to retire. Under ADR-051 the surface may land as a flag on `spur workflow run` (the shape assumed here) or as an application service the CLI and the board both call — decide it in this task's Q&A rather than assuming the flag.

### Plan

- [ ] 0. Capture the current entry points (`WorkflowService.run`, `RunLifecycle.run|resume`,
      `loadLatestStateSnapshot`) and the exact validation errors for an unknown state; add the CLI flag with
      argument validation and the refusal rule.
- [ ] 1. Implement the start-state entry: state resolution, var seeding, `current` initialization, run metadata
      (`startState`, `continuedFrom`), and the plan/checklist rendering for unwalked nodes.
- [ ] 2. Lineage surface: run list/trace fields and, where the UI exists, the display of a mid-graph start.
- [ ] 3. Tests: unknown state, refused start without the definition attribute, `--dry-run --from`, `--async
      --from`, and the isolated knowledge-kit publish-tail fixture (AC3).
- [ ] 4. Docs: `spur workflow run --help` + the workflow docs worked example; note the interim knowledge-kit
      completeness report so the two mechanisms are understood as complementary, not competing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- CLI surface today: `spur workflow run --help` (this repo) — no `--from`/`--start-state`; `--resume` continues a
  run from its own saved state only.
- Engine entry points: `packages/dual-workflow-engine` (`WorkflowService.run`, `RunLifecycle.run|resume`,
  `loadLatestStateSnapshot`, `resumeFromState`).
- Incident evidence (knowledge-kit): run `aed3a205-4cc8-4049-8fab-f9f82a35acd9` ended at `quality-control → done`
  with `publish_enabled=false`; the publish tail then ran stage-by-stage; three channels were missing and the run
  reported `full`. See `.spur/context/learnings.md` → "Daily 20261002 publish-tail forensics (20261003)" and the
  completeness artifact `31-publish/<run_date>_17_publish_completeness.json` added by `daily-publish-classify`.
- Related upstream gap: ts-libs task 0092 (fork/join `type: parallel` node execution) — orthogonal, but the two
  together remove the remaining reasons to leave the engine for a partial re-drive.

### History
