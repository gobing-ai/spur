---
template: issue
schema_version: 1
name: "Enforce worktree-absolute artifact paths for wrap-up capture steps"
description: ""
status: done
type: issue
profile: standard
feature_id: null
parent_wbs: null
priority: P3
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T18:15:15.539Z"
updated_at: "2026-08-15T21:58:08.982Z"
---

## 0563. Enforce worktree-absolute artifact paths for wrap-up capture steps

### Background
During the E6 batch wrap-up (2026-08-14), the wrapup-pipeline's learning-capture agent.run step dispatched a subagent to write `.spur/run/wrapup-learnings.md`; the subagent wrote the artifact relative to its own sandbox cwd instead of the worktree, so the follow-up append shell read an empty/missing file and skipped the append. The learnings had to be reconstructed manually from first-hand session knowledge. Root cause: the dispatch input named a relative path and the capture step's answerFile path was not enforced against the process cwd (worktree). Evidence: append shell output `empty capture - skip` at 17:22:43; missing `.spur/run/wrapup-learnings.md` in the worktree; report §4 wrap item.
### Requirements
- [ ] R1. A missing or empty wrap-up capture is never silent — the `learning-capture` and `metrics-record` append shells in `config/workflows/wrapup-pipeline.yaml` emit a stderr line naming the resolved absolute artifact path when `test -s` finds nothing, instead of falling through the `if` with no output. The append stays soft (`exit 0`): hard-failing would abort wrap-up after doc-sync has already run, which the steps' own descriptions deliberately rule out.
- [ ] R2. Capture artifacts are addressed worktree-absolutely across the dispatch boundary — `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` states that `answerFile` and `expectFile` are resolved against the worktree root before an `agent.run` action is dispatched, and that the resolved absolute path (not the YAML's relative string) is what the dispatched agent is told to write and what the post-join validation reads.
- [ ] R3. The dispatch-eligibility rule that was violated is enforceable — the same reference makes explicit that an `agent.run` whose `input` is free-form prose (not a pure slash command) is host-executed and never eligible for native-subagent dispatch, and states what the driver does when it encounters one. The wrap-up capture steps are exactly this shape; the incident began with that rule being ignored.
- [ ] R4. Both capture steps stay consistent — whatever R1/R2 change for `learning-capture` applies identically to `metrics-record`, so the second capture cannot regress the way the first did.
### Acceptance Criteria
```gherkin
Scenario: R1 — a missing capture artifact is announced, not swallowed
  Given the learning-capture append shell runs with no .spur/run/wrapup-learnings.md present
  When the step executes
  Then stderr carries one line naming the resolved absolute artifact path
  And the step still exits 0 so wrap-up continues

Scenario: R1 — a present capture still appends unchanged
  Given a non-empty .spur/run/wrapup-learnings.md
  When the append shell runs
  Then its contents are appended to .spur/memory/learnings.md
  And no missing-artifact line is emitted

Scenario: R2 — capture paths are worktree-absolute across dispatch
  Given the inline pipeline driver reference
  When an agent.run action declaring answerFile or expectFile is dispatched
  Then the reference requires resolving both against the worktree root first
  And requires the resolved absolute path to be what the agent is told to write and what post-join validation reads

Scenario: R3 — a free-prose agent.run is not dispatch-eligible
  Given an agent.run action whose input is free-form prose rather than a pure slash command
  When the driver evaluates native-subagent eligibility
  Then the reference states the action is host-executed
  And states what the driver does on encountering one

Scenario: R4 — metrics-record matches learning-capture
  Given the metrics-record step
  When its append shell and artifact declarations are compared with learning-capture's
  Then both carry the same named-path reporting and the same path-resolution contract
```
### Q&A
**Q1 — Should a missing capture fail the step instead of warning?** No. Both capture steps document
soft-append as deliberate ("empty capture skips without aborting wrap-up"), and they run after
doc-sync — a hard failure strands wrap-up half-done to report a missing learnings file. **Closed:
stay soft (`exit 0`), become loud (stderr, named absolute path).** R1's wording was filed as
"fail loudly"; that conflict is resolved here in favour of the existing design.

**Q2 — Does `$PWD` survive the workflow engine's interpolation?** The engine expands `${vars.*}`;
bare `$PWD` has no braces and should reach the shell intact, but this is unverified. **Open, bounded:
confirm at implement** (Plan step 2). If it does not survive, use the engine's worktree-root variable
instead of hardcoding an absolute path — never fall back to printing the relative path, which is the
ambiguity being removed.

**Q3 — Why is R2/R3 reference text rather than code?** The inline pipeline driver is a
model-interpreted contract; its reference file is its implementation. There is no host code path to
patch for inline runs. The subprocess surfaces (`spur agent run`, engine-driven `agent.run`) already
resolve against the process cwd, which is the worktree.

**Q4 — `feature_id` is unset.** E6-batch remediation; E6 is already `done`, so linking a backlog task
under it would leave a done feature holding unfinished work. **Deferred to the operator** — link to a
remediation feature if one is opened, otherwise leave unset (the L4 advisory is expected and
non-blocking).
### Design
**Two corrections to the filed framing, both from reading the current tree.**

*Paths.* The fix target is `config/workflows/wrapup-pipeline.yaml`, not `.spur/workflows/…` —
`.spur/workflows` is a symlink to `../config/workflows`, and `CLAUDE.md` makes the tracked
`config/workflows/` tree the only editable SSOT. The driver reference is
`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`; the `.rulesync/**/sp-spur-dev/**`
and `apps/cli/plugins/**` copies are generated and editing them is a no-op that gets overwritten.

*`expectFile` already exists.* Both capture steps already declare it (`wrapup-pipeline.yaml:100-101`,
`:123-124`), so "add an expectFile-style gate" is not the gap. Three real gaps remain.

#### Gap 1 — the append is silent, not soft (R1, R4)

`if test -s …; then … fi && exit 0` produces no output at all when the artifact is missing. The
step's own `description` documents the soft intent ("empty capture skips without aborting wrap-up")
and that intent is correct — hard-failing would abort wrap-up after doc-sync has already run — but
soft must not mean invisible. Frozen change, both steps, `else` branch only:

```yaml
command: >-
  mkdir -p .spur/memory &&
  if test -s .spur/run/wrapup-learnings.md; then
    cat .spur/run/wrapup-learnings.md >> .spur/memory/learnings.md &&
    printf '\n' >> .spur/memory/learnings.md;
  else
    echo "wrapup: learning capture missing or empty at $PWD/.spur/run/wrapup-learnings.md - append skipped" >&2;
  fi &&
  exit 0
```

`metrics-record` takes the same shape with its own path and the word `metrics`. `exit 0` stays.
**Verify at implement that `$PWD` survives the engine's `${vars.*}` interpolation** into the shell
unexpanded; if it does not, substitute the engine's own worktree-root variable rather than
hardcoding a path.

#### Gap 2 — relative paths cross a process boundary (R2)

`answerFile`/`expectFile` are `.spur/run/…`, resolved against whatever cwd the writer has. In-process
that is the worktree and it works; hand the step to a subagent with its own sandbox cwd and the
artifact lands where the append never looks — exactly what happened at 17:22:43. Add to the
dispatch-and-join paragraph (`inline-pipeline-driver.md:76-86`): `answerFile` and `expectFile` are
resolved against the worktree root **before** dispatch, the resolved absolute path is what the
dispatched agent is instructed to write, and post-join validation reads that same absolute path.
Resolving once at the dispatch boundary fixes every surface at once rather than patching the one
that failed.

#### Gap 3 — the step was never dispatch-eligible (R3)

`inline-pipeline-driver.md:64-66` already restricts native-subagent dispatch to an `agent.run` "whose
input is a pure slash command"; both capture steps' inputs are free-form prose ("Extract working
learnings from tasks …"). Under the contract as written this was host-executed work. The reference
states the rule but never states what the driver *does* on meeting a non-eligible action, which is
how it got read past. Add that consequence beside the four eligibility conditions: a free-prose
`agent.run` is executed in the host session and logged with the existing host-fallback line.

#### Layering and anti-patterns

R1 is the deterministic backstop (you always learn the capture failed). R2 makes the artifact land
correctly whichever surface runs the step. R3 removes the reason a subagent was involved at all.
Only R1 is executable; R2/R3 are contract text, which is the correct home — the inline driver is
interpreted by the model, so its reference *is* its implementation.

- Do **not** make the append hard-fail or drop `exit 0`. That aborts wrap-up mid-flight and
  contradicts both steps' documented design.
- Do **not** edit `.spur/workflows/…`, `.rulesync/**`, or `apps/cli/plugins/**` — symlink and
  generated trees.
- Do **not** add a new workflow step, guard kind, or engine feature; this is an `else` branch and
  two reference paragraphs.
- Do **not** fix `learning-capture` alone — `metrics-record` is the same shape and regresses the
  same way (R4).

**Measurable target:** run the wrap hop with the capture step's writer deliberately given a foreign
cwd — the append emits the named-path stderr line and wrap-up continues; with R2's absolute-path
resolution in place the artifact lands in the worktree and the append consumes it.
### Plan
- [ ] 1. Add the `else` branch naming the resolved absolute path to both append shells in `config/workflows/wrapup-pipeline.yaml`, keeping `exit 0` (R1, R4)
- [ ] 2. Validate the YAML — `spur workflow validate config/workflows/wrapup-pipeline.yaml` plus a dry-run of the wrap hop (R1)
- [ ] 3. State the worktree-absolute resolution rule for `answerFile`/`expectFile` in `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, in the dispatch-and-join paragraph (R2)
- [ ] 4. State the non-eligible-action consequence beside the four eligibility conditions in the same reference (R3)
- [ ] 5. Exercise the wrap hop with a foreign-cwd writer: confirm the named-path stderr line and that wrap-up continues (R1)
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
| File | Lines | What / Why |
| --- | --- | --- |
| `config/workflows/wrapup-pipeline.yaml` | 108-113 | `learning-capture` append shell gains an `else` branch: when `test -s .spur/run/wrapup-learnings.md` finds the artifact missing or empty, stderr gets `wrapup: learning capture missing or empty at $PWD/.spur/run/wrapup-learnings.md - append skipped` naming the resolved absolute path; `exit 0` retained so the soft append never aborts wrap-up (R1). `$PWD` survives the engine's `${vars.*}` interpolation — `resolveTemplates` expands only `${vars.X}`/`${env.X}` and does no shell expansion (confirmed against `packages/app/src/services/workflow/actions/shell.ts`; Q2 closed). |
| `config/workflows/wrapup-pipeline.yaml` | 133-138 | `metrics-record` append shell gains the identical `else` branch with its own artifact path (`.spur/run/wrapup-metrics.jsonl`) and the word `metrics`, keeping `exit 0` — the second capture cannot regress the way the first did (R4). |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` | 82-86 | Dispatch-and-join paragraph now states `answerFile`/`expectFile` are resolved against the worktree root **before** dispatch; the resolved absolute path — not the YAML's relative string — is what the dispatched agent is instructed to write and what post-join validation reads. Resolving once at the dispatch boundary fixes every surface (R2). |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` | 75-80 | Beside the four eligibility conditions: an `agent.run` whose `input` is free-form prose (not a pure slash command) fails condition 2 and is never dispatch-eligible — the driver executes it in the host session, logs it with the existing host-fallback line `stage <id> executed inline in session <session-id>`, and neither reformulates the prose into a command nor spawns a subagent for it (R3). |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — missing/empty capture never silent; stderr names resolved absolute path; soft exit 0 | MET | config/workflows/wrapup-pipeline.yaml:110-111 (learning-capture `else` → `echo "wrapup: learning capture missing or empty at $PWD/.spur/run/wrapup-learnings.md - append skipped" >&2`), :113 (`exit 0`). Behavioral: missing artifact in temp cwd → exactly one stderr line `wrapup: learning capture missing or empty at /private/var/.../tmpXXXX/.spur/run/wrapup-learnings.md - append skipped` (=$PWD-resolved absolute path), exit 0, no learnings.md written. Empty artifact → same line, exit 0. `$PWD` reaches shell intact: engine resolveTemplates expands only `${vars.*}`/`${env.*}` (review-confirmed against dist/variables.js); bare `$PWD` unexpanded. |
| R2 — capture artifacts worktree-absolute across dispatch boundary | MET | plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:82-87 (dispatch-and-join): "resolve `answerFile`/`expectFile` against the worktree root — the resolved absolute path, not the YAML's relative string, is what the dispatched agent is instructed to write and what post-join validation reads"; :86-87 names the failure mode ("a relative path would resolve against whatever cwd the writer process happens to have"). Consistent with engine surface: packages/app/src/workflow/actions/agent-run.ts resolves answerFile/expectFile against cwd with isAbsolute guard (review-verified). |
| R3 — free-prose agent.run never dispatch-eligible, consequence stated | MET | plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:68-69 (condition 2: `agent.run` + pure slash command required) and :76-79 ("An `agent.run` whose `input` is free-form prose ... fails condition 2 and is never dispatch-eligible: the driver executes it in the host session and logs it with the existing host-fallback line `stage <id> executed inline in session <session-id>` — it does not reformulate the prose into a command, spawn a subagent for it, or silently promote it to dispatch"); :75 states the generic host-execute consequence; :99 confirms host-fallback line retained. |
| R4 — metrics-record consistent with learning-capture | MET | config/workflows/wrapup-pipeline.yaml:133-138 (metrics-record append shell: `if test -s .spur/run/wrapup-metrics.jsonl; then ... else echo "wrapup: metrics capture missing or empty at $PWD/.spur/run/wrapup-metrics.jsonl - append skipped" >&2; fi && exit 0`); answerFile/expectFile declared identically at :126-127 (learning-capture at :100-101). Behavioral: empty metrics artifact → stderr names absolute metrics path, exit 0, no metrics file created; non-empty → appended to .spur/memory/wrapup-metrics.jsonl, no stderr line. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Review — sp:dev-review 0563 --auto** (SECUA + functional traceability + architecture depth; surface: `config/workflows/wrapup-pipeline.yaml` + `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`)

**Verdict: APPROVE — 0 P1/P2 (blocking), 2 P4 (informational). All four requirements PASS; AC R1-1/R1-2/R4 behaviorally verified by execution.**

**Functional traceability**

- **R1 PASS** — `config/workflows/wrapup-pipeline.yaml:110-111` (learning-capture `else`) emits `wrapup: learning capture missing or empty at $PWD/.spur/run/wrapup-learnings.md - append skipped` to stderr when `test -s` fails (missing or empty); `exit 0` retained at `:113`. AC R1-1 verified by execution: missing artifact -> exactly one stderr line naming the `$PWD`-resolved absolute path, exit 0, no `learnings.md` written. AC R1-2 verified: non-empty artifact -> contents appended to `.spur/memory/learnings.md`, no missing-artifact line. `$PWD` survival confirmed against engine source: `resolveTemplates` substitutes only `/\$\{([^}]+)\}/g` (`node_modules/@gobing-ai/ts-dual-workflow-engine/dist/variables.js:4,21-23`); bare `$PWD` is not matched and reaches the shell unexpanded (Q2 closed; corroborated by `packages/app/src/workflow/actions/file-read-into-var.ts:25-27` and `shell.ts:52-57`). YAML + embedded shell validated: `spur workflow validate` -> `workflow valid: wrapup-pipeline`.
- **R4 PASS** — `config/workflows/wrapup-pipeline.yaml:135-136` (metrics-record `else`) is the identical shape with its own artifact path (`.spur/run/wrapup-metrics.jsonl`) and the word `metrics`; `exit 0` at `:138`. Verified by execution: empty metrics artifact -> stderr names absolute path, exit 0, no metrics file created. Both steps declare matching `answerFile`/`expectFile` (`:100-101`, `:123-124`) — AC R4 satisfied; the second capture cannot regress silently the way the first did.
- **R2 PASS** — `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:82-86` (dispatch-and-join paragraph) states `answerFile`/`expectFile` are resolved against the worktree root before dispatch and that the resolved absolute path — not the YAML's relative string — is what the dispatched agent is instructed to write and what post-join validation reads. AC R2 satisfied. Contract is consistent with actual engine behavior: `packages/app/src/workflow/actions/agent-run.ts:150` (`cwd = options.cwd ?? context.workdir ?? '.'`) and `:323`/`:331` resolve both files against `cwd` with an `isAbsolute` guard — the reference now states for the inline surface exactly what the engine already does, so both surfaces agree.
- **R3 PASS** — `inline-pipeline-driver.md:76-79`, placed immediately after the four eligibility conditions (`:62-73`) and the "All four pass" line (`:75`), states a free-prose `agent.run` fails condition 2 (pure slash command, `:62-66`), is never dispatch-eligible, is executed in the host session and logged with the existing host-fallback line `stage <id> executed inline in session <session-id>`, and is neither reformulated into a command nor spawned as a subagent. AC R3 satisfied (host-executed stated; driver consequence stated). Scope wording is accurate: the consequence names "the driver", so it does not falsely claim the engine never dispatches free-prose `agent.run` (the wrap-up capture design depends on engine dispatch).

**SECUA**

- Security: no new surface. The added lines are a static echo to stderr; `$PWD` is shell-expanded runtime data, not engine-pre-resolved template content; no secrets, no injection path, no new file writes.
- Efficiency: one conditional stderr write on the failure path; zero cost on the happy path.
- Correctness: `test -s` covers missing and empty (matches R1 wording); both branches terminate at `exit 0` (`fi && exit 0` — the else-branch last command `echo` succeeds); harness validation passes. All three branches (missing / present / empty) executed with expected output and exit code.
- Usability: the failure that cost manual reconstruction (silent skip at 17:22:43) is now announced with the exact absolute path the append looked at — actionable for manual recovery.
- Architecture: R1 is the executable backstop; R2/R3 are contract text in the model-interpreted inline driver reference — the correct home per Q3 (no host code path for inline runs). No new steps, guards, engine features, or hard-fail introduced; the diff is two `else` branches plus two reference paragraphs. Generated trees untouched — `git status` shows only the two target files plus pre-existing 0562 dirt (`.rulesync`/`apps/cli/plugins` clean).

**Findings**

| Severity | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | `config/workflows/wrapup-pipeline.yaml:107-113`, `inline-pipeline-driver.md:76-79` | Solution-table line ranges drift from the final files: R3 paragraph is :76-79 (table stated 75-80); learning-capture if-block is :107-113 (table stated 108-113). Cosmetic only; this Review cites actual lines. | Accept; no code impact. |
| P4 | `inline-pipeline-driver.md:82-86` vs `packages/app/src/workflow/actions/agent-run.ts:150,323,331` | R2/R3 text binds only the inline-driver surface; the engine surface that produced the incident (wrap-up via `spur workflow run`) is covered by the engine's existing cwd-based answerFile resolution plus R1's stderr backstop, not by new binding text. Consistent with task Q3; residual risk: an explicit `options.cwd` on a future engine `agent.run` would move answerFile/expectFile resolution off-worktree and only R1's message would reveal it. | Accept as scoped; keep `options.cwd` unset in the wrap-up YAML. |

**Residual risk**

- Engine-side free-prose `agent.run` remains dispatch-capable by design (the capture steps depend on it); R3 constrains only the inline driver. R1 is the deterministic backstop for the engine path.
- Pre-existing then-branch semantics unchanged: a failing `cat`/`printf` in learning-capture still fails the step before `exit 0` (not introduced by this diff; not in scope).
- R1's message names the shell's `$PWD` (step execution cwd = worktree). If a future run ever executes the step from a foreign cwd, the message truthfully names where the append looked — the actionable fact — but would not name the worktree itself.

**Disposition: APPROVE.** No P1/P2. R1-R4 fully implemented with behavior verified by execution (missing / present / empty branches), `spur workflow validate` green, and R2/R3 contract text accurate against engine source. Proceed to verification.
### References
- Code (fix target): `config/workflows/wrapup-pipeline.yaml` — `learning-capture` (:88-111, `answerFile`/`expectFile` at :100-101) · `metrics-record` (:113-135, at :123-124). `.spur/workflows` is a symlink to this tree; never edit through it.
- Contract (fix target): `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` — `agent.run` action semantics (:56-60), native-subagent eligibility conditions (:62-73), dispatch-and-join validation (:76-86). `.rulesync/**` and `apps/cli/plugins/**` copies are generated — do not edit.
- Evidence: append emitted `empty capture - skip` at 17:22:43 with no `.spur/run/wrapup-learnings.md` in the worktree; learnings reconstructed by hand at 17:23:19
- Session log: `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-08-14T05-07-58-417Z_*.jsonl` (17:21:57-17:23:32)
- Report: `docs/report/2026-08-14-E6-batch-forensic-report.md` §4 wrap item
- Related: task 0508 (native-subagent-first dispatch) · task 0538 R2 (declared Layer-1 roles)
### History
- 2026-08-15T21:50:29.440Z backlog → todo (system)
- 2026-08-15T21:50:29.592Z todo → wip (system)
- 2026-08-15T21:58:03.727Z wip → testing (system)
- 2026-08-15T21:58:08.982Z testing → done (system)
