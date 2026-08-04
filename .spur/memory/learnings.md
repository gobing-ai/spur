Captured to `.spur/run/wrapup-learnings.md`. Learnings from task **0425** (ADR-044 implementation: workflow terminal failure status + run-scoped artifacts), grouped by date (2026-08-04) and task WBS, grounded in `0425-verdict.json` and `0425-verify-answer.txt`:

# Working learnings

## 2026-08-04

### 0425 — Workflow terminal failure is a run status; shared run artifacts are run-scoped (ADR-044)

Sources: `.spur/run/0425-verdict.json`, `0425-verify-answer.txt`; task implements ADR-044 (feature D).

#### Conventions

- **Failure classification is workflow configuration, not driver logic.** The workflow schema partitions terminal states into success (`terminalStates`) and failure (`failureStates`) sets (apps/cli/schemas/state-machine-workflow.schema.json, engine config schema). `failureStates` is validated as a subset of `terminalStates`. This replaced the per-`failed`-state `onEnter` shell-hop approach — a declarative schema seam beats a shell hop in ten YAML files.
- **Reader contract is explicit and documented.** Read a run as `status === 'done' AND finalState === <expected>`; never trust the process exit code alone. Recorded in `plugins/sp/skills/spur-cli/references/workflows.md` and `operations.md` so every consumer (batch drivers, CI wrappers, `&&` chains) reads the same rule.
- **Run-scoped artifacts use `${vars.__runId}`.** `__runId` is already injected by `WorkflowAppService.run()` and survives pause/resume via the effective-vars snapshot — so run-scoping needed no new plumbing, only a declared `__runId: ""` var per workflow and path rewrites (basic.yaml, idea-pipeline.yaml).
- **Docs pointer over restated shapes.** The runId glob + `spur workflow trace` guidance lives in `docs/help/cmd_workflow.md`; the reader contract lives in the spur-cli reference. No duplication.

#### Errors fixed

- **Silent-success hazard:** a pipeline routing to its declared `failed` state reported `status: "done"`, `finalState: "failed"`, and the CLI exited **0**. An orchestrator could not tell "pipeline succeeded" from "pipeline diagnosed its own failure and stopped cleanly". Fixed by driving failure terminals through `lifecycle.fail()` so status, the persisted run row, the `workflow.run.failed` event, and the process exit code all agree; CLI exits 1 unless done.
- **Cross-run artifact collision:** fixed paths under `.spur/run/` (e.g. `basic-gate.status`, `basic-fix-attempt`, the `idea-*` set) were singleton-only — two concurrent runs of one workflow shared one status file and one attempt counter, so one run's red gate could satisfy another's PASS guard. Fixed by `${__runId}`-scoping; the `idea-archive` fixed-path artifact was removed.
- **No-regression on legacy workflows:** workflows without a declared `failureStates` must be unaffected — guarded by subset validation and a legacy smoke (`done`/`failed` still correct).

#### Patterns

- **Declarative terminal outcome instead of exit-code plumbing.** A schema field is the reviewable, reversible seam; the driver's `terminal.has(current.id) → lifecycle.done` gained a `lifecycle.fail` counterpart for failure terminals.
- **Evidence rule held:** every behavioral AC carried `test` or `command` evidence (fail-term smoke `exit=1`, legacy smoke, wrapup `tasks=[] → skipped done exit=0`, concurrent-isolation test at workflow.test.ts:399); 10/10 workflows still validate after the schema change.
- **Golden-path smokes:** fail-term + legacy + wrapup-empty smokes exercise the three terminal classes in one pass.

#### Gotchas

- **`__runId`-scoping holds only when `__runId` is injected.** SECUA P3 flagged empty-`__runId` bare-engine paths: a run launched outside `WorkflowAppService` (bare engine) resolves paths to a literal `__runId` directory. Follow-up if bare-engine runs are a supported surface.
- **AC title drift (advisory, P4):** a feature scenario title and its task AC reference drifted — the title is the traceability identity key; keep task AC titles byte-identical to the feature scenario.
- **Verify anchors name the subject, not just exist.** The stale-anchor discipline (constitution §8, 2026-07-19) applied: each cited `file:line` was re-read to confirm it names the requirement's subject before writing MET — never cite a line that merely exists.
- **wrapup is exempt from `failureStates`.** The wrapup workflow declares no failure states; an empty wrapup run must still reach `skipped`/`done` cleanly, not be misread as a failure.

Note: the task file itself (`docs/tasks/0425_*.md`) is absent from the working tree (archived post-done); learnings were extracted from the authoritative run artifacts (`0425-verdict.json`, `0425-verify-answer.txt`), which record the verified R1–R6 and SECUA findings.
