---
schema_version: 1
name: "Make the find-issue surface honest about --agent and fail the run on undeclared model-stage writes"
status: done
template: feature-impl
created_at: 2026-08-26T05:38:44.933Z
updated_at: "2026-08-26T15:43:41.584Z"
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

- [x] R1. Correct the `--agent` contract on `/sp:dev-find-issue`: either drop `inline` from the flag table for this headless target or translate `inline` to the sanctioned surface at the seam. Whichever is chosen, invoking the documented default must not produce the headless-rejection error.
- [x] R2. Audit the sibling `/sp:dev-*` command files for the same over-promise and correct any that advertise `inline` against a headless target — `/sp:dev-idea` is a known second instance.
- [x] R3. Assert after each `agent.run` stage that the working tree gained no file outside the stage's declared output path; an undeclared write fails the run and names the offending path.
- [x] R4. Remove the leaked `history-anatomy..md` from the repository root as part of this task.
- [x] R5. Change the workflow's fallback executor from the quota-dead `omp` to one the project currently expects to be reachable, and keep the existing fail-loud error naming the sanctioned alternatives.
- [x] R6. Do not change any public `spur` CLI noun or verb — this task changes plugin-surface documentation and workflow configuration only (ADR-051 consent gate).

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

Plugin docs, one helper subcommand, and workflow config — no public spur noun/verb touched (R6).

| Change | Why |
| --- | --- |
| plugins/sp/commands/dev-find-issue.md | R1: flag table and argument-hint no longer advertise `inline` (was the documented default on a headless target that exits 2 on it); options now `auto\|name`, default omitted |
| plugins/sp/commands/dev-idea.md | R2: same over-promise corrected; rejection sentence retained for operators who pass it anyway. dev-run/dev-runall/dev-refine keep inline legitimately (host driver); dev-wrap/wrapall already document the rejection explicitly |
| history-anatomy-cache.ts `assert-clean` verb + pure `diffPorcelain` (`plugins/sp/scripts/history-anatomy-cache.ts:813`) + .mjs twin regen | R3: porcelain fingerprint diff around model stages; undeclared writes exit 1 naming each path |
| config/workflows/history-anatomy.yaml enrich/validate states capture a pre-dispatch baseline and assert-clean after | R3: an undeclared write fails the run before publication |
| repo-root leaked `history-anatomy..md` deleted from main tree | R4 |

R5: workflow fallback literal `agent: "omp"` → `agent: "claude"` (omp returned HTTP 429 quota-dead in the 2026-08-25 dogfood; claude verified usable/capable by `spur agent doctor` in this batch's precheck). `config.agent.default` still overrides via the precedence chain, so no new stale pin is created beyond the project's current healthy default.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | plugins/sp/commands/dev-find-issue.md flag table options are `auto |
| R2 | MET | plugins/sp/commands/dev-idea.md same correction; sweep of plugins/sp/commands/ confirms wrap/wrapall document rejection explicitly and run/runall/refine keep host-driver inline |
| R3 | MET | history-anatomy-cache.ts assert-clean verb + diffPorcelain; enrich/validate states capture baseline then assert; failing action routes run to failed before publish |
| R4 | MET | leaked history-anatomy..md removed from main-tree repo root |
| R5 | MET | config/workflows/history-anatomy.yaml agent literal claude (doctor-verified reachable); comment records omp 429 precedent and agent.default override |
| R6 | MET | no public spur noun/verb changed — plugin docs, plugin script, workflow config only |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R15 — A headless surface never advertises an execution mode it rejects | MET | test | doc change pinned by HEADLESS_NO_INLINE_ADVERTISED assertions in plugins/sp/tests/inline-execution-contract.test.ts; default no longer produces the rejection error |
| R16 — A model stage that writes outside its declared output path fails the run | MET | test | assert-clean unit tests (clean passes, stray write exits 1 naming path, declared output exempt); workflow asserts after enrich and validate before publication |
| R17 — The workflow's default executor is not a quota-dead one | MET | command | doctor probe in this batch's precheck shows claude installed/usable/capable-3; yaml literal updated |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Functional traceability** — all six requirements MET. R1: `dev-find-issue.md` no longer presents `inline` as usable (options `auto|name`, default omitted); invoking the documented default now resolves through the precedence chain, never hitting the headless rejection. R2: `dev-idea.md` corrected; repo-wide audit found dev-wrap/wrapall already document the explicit rejection honestly (kept), dev-run/runall/refine keep inline legitimately (host driver). R3: porcelain fingerprint diff (`assert-clean` verb + pure `diffPorcelain`) wired as baseline-capture/assert actions around enrich and validate; undeclared writes exit 1 naming each path and halt before publication; unit tests cover clean/undeclared/declared paths with a gitignored-run-dir mirror of the real repo. R4: leaked root file deleted. R5: fallback literal moved from quota-dead `omp` to currently-reachable `claude` with `agent.default` still overriding via the precedence chain.

| Priority | Finding | Disposition |
| --- | --- | --- |
| P3 | The inline-contract test pinned "every contract-referencing command advertises inline | auto | name"; headless carve-out set added for find-issue/idea | Accept — same-commit reconciliation; the corrected contract is that headless surfaces never present inline as usable |
| P3 | `assert-clean` scopes to git-visible paths only; `.spur/` run glue is gitignored so sanctioned sidecars never trip it | Accept — matches the defect class (root-level leaks) exactly |

SECUA — no new trust boundaries; fail-loud only. Correctness: twin regenerated, script-contract-check green. Architecture: helper-owned glue per ADR-069 R1, no public CLI surface change.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-26T07:28:49.036Z todo → wip (system)
- 2026-08-26T15:43:40.981Z wip → testing (system)
- 2026-08-26T15:43:41.584Z testing → done (system)
