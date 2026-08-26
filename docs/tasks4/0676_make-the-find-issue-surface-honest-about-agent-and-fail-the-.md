---
schema_version: 1
name: "Make the find-issue surface honest about --agent and fail the run on undeclared model-stage writes"
status: todo
template: feature-impl
created_at: 2026-08-26T05:38:44.933Z
updated_at: "2026-08-26T05:48:10.904Z"
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
**R1: drop, do not translate.** Translating `inline` to `auto` at the seam would silently give the operator a different execution surface than the one they asked for, which is precisely the failure `AGENT_INLINE_HEADLESS_MESSAGE` exists to prevent — `cross-cutting.md` § Inline-default execution surface states explicit `--agent inline` is a *hard* host-session guarantee. The honest fix is for the flag table in `plugins/sp/commands/dev-find-issue.md` to stop advertising a mode this target rejects. Omission is the correct default for a headless target; it resolves through the executor precedence chain to `agent.default`, then the YAML literal.

**R2 scope.** `/sp:dev-idea` is the confirmed second instance — its own flag table lists `--agent <inline|auto|name>` while `dev-operations.md` § idea states the pipeline's `agent.run` stages reject explicit `inline` with exit 2. Grep the `plugins/sp/commands/` tree for `inline` in a flag table and check each against whether its target is a headless `spur workflow run` or an interactive host driver. Only correct the headless ones — `dev-run`, `dev-runall`, and `dev-refine` legitimately support inline via the host driver.

**R3: assert, do not sandbox.** The lazy correct shape is a fingerprint diff — capture `git status --porcelain` before the stage, compare after, and fail on any new path that is not the stage's declared `expectFile`. The dogfood protocol already uses exactly this mechanism in this repo (`workspace_fingerprint` / `porcelain_hash_baseline` in both dogfood reports), so it is proven and needs no new concept. Sandboxing the executor's filesystem would be a far larger change for the same signal.

**Frozen names.** A new `assert-clean` subcommand on `plugins/sp/scripts/history-anatomy-cache.ts`, sitting alongside the existing `digest` / `check` / `publish` / `paths` / `probe` / `stamp` / `refresh` cases in the same `switch` (`:691-800`). Signature: `assert-clean --baseline <porcelain.txt> --expect <declared-output-path> [--expect <path>…]`, exit 0 clean, exit 1 naming each undeclared path. A `.mjs` twin regeneration is mandatory (ADR-065, enforced by `bun run script-contract-check`).

**Wiring.** One shell action capturing the baseline before `enrich` and before `validate`, one shell action running `assert-clean` after each. On failure the run takes an edge to `failed` — the existing `structure-gate -> failed` transition is the shape to copy.

**R5: prefer the precedence chain over another literal.** `config/workflows/history-anatomy.yaml:63` pins `agent: "omp"`, which returned HTTP 429 during the 2026-08-25 dogfood run. Hard-coding a different executor name only moves the problem to whichever one goes quota-dead next. The executor precedence chain (`cross-cutting.md` § R7) already resolves `agent.default` from `.spur/config.yaml` ahead of the YAML literal, so the literal should be the project's current healthy default rather than a stale pin — and the fail-loud error already names the sanctioned alternatives, so no error-message work is needed.

**Anti-patterns.** Do not add an `--agent` translation shim. Do not make `assert-clean` a warning — an undeclared write must block publication. Do not touch any public `spur` CLI noun or verb (ADR-051 consent gate); this task changes plugin-surface docs, a plugin script, and workflow config only.

**Reversibility.** Documentation and config; `assert-clean` can only refuse to publish, never publish something the run otherwise would not.
### Plan
1. Read `cross-cutting.md` § Inline-default execution surface for the exact `AGENT_INLINE_HEADLESS_MESSAGE` wording and the R7 executor precedence chain, so the corrected flag tables quote the sanctioned contract rather than paraphrasing it.
2. Correct the `--agent` row in `plugins/sp/commands/dev-find-issue.md`: drop `inline` for this headless target and state the resolved default.
3. Grep `plugins/sp/commands/` for `inline` in flag tables; classify each command by whether its target is a headless `spur workflow run` or an interactive host driver; correct only the headless ones (`/sp:dev-idea` is a known instance). Leave `dev-run` / `dev-runall` / `dev-refine` alone — they support inline through the host driver.
4. Add the `assert-clean` subcommand to `plugins/sp/scripts/history-anatomy-cache.ts` beside the existing cases, and regenerate the committed `.mjs` twin.
5. Wire baseline-capture shell actions before `enrich` and `validate`, and `assert-clean` shell actions after each, in `config/workflows/history-anatomy.yaml`.
6. Add the failure edges to `failed`, mirroring the existing `structure-gate -> failed` transition shape.
7. Delete the leaked `history-anatomy..md` from the repository root.
8. Change the workflow's executor literal at `:63` per the design note.
9. Tests: `assert-clean` passes on a clean stage; fails and names the path on a stray write; the corrected flag tables match the headless contract (extend `validate-flag-contracts.ts` if it already covers this shape).
10. Run `bun run lint`, `bun run test`, `bun run script-contract-check`, and `spur workflow validate config/workflows/history-anatomy.yaml`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
