---
schema_version: 1
name: "Make the find-issue surface honest about --agent and fail the run on undeclared model-stage writes"
status: todo
template: feature-impl
created_at: 2026-08-26T05:38:44.933Z
updated_at: "2026-08-26T05:39:24.304Z"
feature_id: I81
priority: P2
tags: ["history-anatomy", "sp-plugin", "contract", "hygiene"]
---

## 0676. Make the find-issue surface honest about --agent and fail the run on undeclared model-stage writes

### Background

Three defects share one theme — the find-issue surface promises or permits things the engine does not honor.

First, `plugins/sp/commands/dev-find-issue.md` lists `--agent <inline|auto|name>` with **Default: inline**, but the command routes into the engine-driven `history-anatomy.yaml`, a headless surface that rejects `inline` fail-loud with `AGENT_INLINE_HEADLESS_MESSAGE` (exit 2). Any operator following the documented default gets a guaranteed failure — reproduced in the 2026-08-25 `--agent inline` dogfood run, which had to retry with `agent=auto`. The error message itself is good; the flag table is the defect.

Second, the enrich stage wrote `history-anatomy..md` (note the double dot) into the repository root — a mermaid rendering of the workflow FSM, outside the run directory and outside any declared output path. It is still sitting untracked at the repo root today. The workflow declares `expectFile` for each `agent.run` stage but never asserts the stage wrote *only* that.

Third, the workflow's default executor is `agent: "omp"` (`config/workflows/history-anatomy.yaml:63`), which returned HTTP 429 "Monthly usage limit reached" during the 2026-08-25 dogfood run, hard-failing at the first `agent.run` stage for any operator who does not override it.

### Requirements
- [ ] R1. Correct the `--agent` contract on `/sp:dev-find-issue`: either drop `inline` from the flag table for this headless target or translate `inline` to the sanctioned surface at the seam. Whichever is chosen, invoking the documented default must not produce the headless-rejection error.
- [ ] R2. Audit the sibling `/sp:dev-*` command files for the same over-promise and correct any that advertise `inline` against a headless target — `/sp:dev-idea` is a known second instance.
- [ ] R3. Assert after each `agent.run` stage that the working tree gained no file outside the stage's declared output path; an undeclared write fails the run and names the offending path.
- [ ] R4. Remove the leaked `history-anatomy..md` from the repository root as part of this task.
- [ ] R5. Change the workflow's fallback executor from the quota-dead `omp` to one the project currently expects to be reachable, and keep the existing fail-loud error naming the sanctioned alternatives.
- [ ] R6. Do not change any public `spur` CLI noun or verb — this task changes plugin-surface documentation and workflow configuration only (ADR-051 consent gate).
### Acceptance Criteria

```gherkin
@core
Scenario: R15 — A headless surface never advertises an execution mode it rejects
  Given "/sp:dev-find-issue" targets the engine-driven history-anatomy workflow
  When an operator reads the command's "--agent" flag contract
  Then the contract does not present "inline" as the default for that surface
  And invoking the documented default does not produce the headless-rejection error

@core
Scenario: R16 — A model stage that writes outside its declared output path fails the run
  Given the enrich stage declares one expected output file
  When the stage also writes a file elsewhere in the working tree
  Then the workflow reports the undeclared write and does not publish
  And the report names the offending path

@edge
Scenario: R17 — The workflow's default executor is not a quota-dead one
  Given an operator runs the history-anatomy workflow without naming an executor
  When the first "agent.run" stage dispatches
  Then the resolved executor is one the project currently expects to be reachable
  And a quota or availability failure names the executor and the sanctioned alternatives
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**R1: drop, do not translate.** Translating `inline` to `auto` at the seam would silently give the operator a different execution surface than the one they asked for, which is precisely the failure mode the `AGENT_INLINE_HEADLESS_MESSAGE` contract exists to prevent (cross-cutting.md: explicit `--agent inline` is a *hard* host-session guarantee). The honest fix is for the flag table to stop advertising a mode this target rejects. The default for a headless target is omission, which resolves through the executor precedence chain to `agent.default`.

**R3: assert, do not sandbox.** The lazy correct shape is a fingerprint diff — capture `git status --porcelain` before the stage, compare after, and fail on any new path that is not the declared `expectFile`. This is exactly what the dogfood protocol's workspace fingerprint already does, so the mechanism is proven in this repo and needs no new concept. Sandboxing the executor's filesystem would be a much larger change for the same signal.

The check belongs in the `history-anatomy-cache` helper (ADR-069 R1: this is a program, not glue) invoked as a shell action after each `agent.run` stage.

**R5: pick the default from what the project already declares.** Rather than hard-coding another executor name that can go quota-dead in turn, prefer resolving through `agent.default` and keep the YAML literal as the last-resort fallback per the executor precedence chain. A literal that is already known dead is worse than no literal.

**Blast radius.** Documentation and workflow config; no product code path changes, and R3 adds a gate that can only refuse to publish, never publish something it otherwise would not.

### Plan

1. Read the `AGENT_INLINE_HEADLESS_MESSAGE` contract and the executor precedence chain in `cross-cutting.md` to confirm the sanctioned wording.
2. Correct the `--agent` row in `plugins/sp/commands/dev-find-issue.md`; grep the sibling `/sp:dev-*` command files for the same over-promise and correct each.
3. Add an undeclared-write check to the `history-anatomy-cache` helper (and its committed `.mjs` twin per ADR-065); wire it as a shell action after `enrich` and after `validate`.
4. Add a transition from the check's failure to `failed`, so an undeclared write cannot reach `publish`.
5. Delete the leaked `history-anatomy..md` from the repository root.
6. Change the workflow's executor fallback per the design note.
7. Tests: the check passes on a clean stage, fails and names the path on a stray write; the corrected flag table matches the headless contract.
8. Run `bun run lint`, `bun run test`, `bun run script-contract-check`, and `spur workflow validate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
