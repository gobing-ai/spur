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
Write was declined at the permission prompt. Here's the deliverable as raw markdown (no fences) — the file write to `.spur/run/wrapup-learnings.md` is pending your approval; the content below is ready to capture.

---

Captured to `.spur/run/wrapup-learnings.md`. Learnings from tasks **0426–0430** (feature D2 / ADR-045 — all-in-one per-run workflow run log), grouped by date (2026-08-04) and task WBS, grounded in each task's Solution/Testing/Review sections:

# Working learnings

## 2026-08-04

### 0426 — Consolidated all-in-one per-run workflow run log sink (feature D2 / ADR-045)

Sources: `docs/tasks3/0426_*.md` (Design/Solution/Testing/Review); code in the working tree (`packages/app/src/observability/workflow-run-log-sink.ts`).

#### Conventions

- **Reuse the redaction + rendering seams; never build parallel ones.** Event payloads are already redacted at the bus seam (`[prompt N chars]` / `[shell command redacted]` / `[REDACTED]`); progress lines reuse `renderStepLine(event, { detail: 'full', showRunId: true })` so the log matches the human renderer; agent chunks keep the old `[ts] stream: chunk` contract. No new prompt or shell text ever enters the log (R10 test-guarded).
- **Repointing an artifact is a compatibility decision, not a refactor.** Consumers were checked before repointing: `outputArtifactForRun`/`traceRun` → `.spur/run/<RUNID>.log`, and the timed-out-implement runbook references only `<RUNID>-STEP-partial.md` (not `-output.log`) — so no runbook change was needed.

#### Errors fixed

- **`--async` narration discarded:** the detached nohup worker points std streams at `/dev/null`, so the run's narration vanished in exactly the mode operators most need to watch. Fixed by the in-process sink — see Pattern 1.

#### Patterns

- **Single file, in-process sink, `finally`-closed.** Built in the CLI run path where the bus/runId/plan live; closed in the run's `finally`. The `--async` worker re-enters the *same synchronous path* (`SPUR_ASYNC_WORKER=1` → `workflow run --run-id`), so the log is written in-process independent of the nohup redirect — zero new plumbing for the async case.
- **Bounds + best-effort inherited from existing config.** `agent.output` max-bytes (default 1 MiB) / max-lines (unbounded), visible truncation marker — never a silent cut; an unwritable `.spur/run/` degrades the log, never the run (R8/R12).
- **Duplicate `run.started` guard** so header + plan preview are written exactly once.

#### Gotchas

- **The sync-FD allowlist must be repointed in the same change.** `config/rules/strict/runtime-boundaries.yaml` gates all sync FS usage; moving the module (run-output-sink.ts → workflow-run-log-sink.ts) without repointing the allowlist entry breaks the strict rule.
- **Durable disk boundary deserves belt-and-braces (P3, accepted).** The sink writes `event.chunk` verbatim, relying solely on upstream `redactAndBound`; a future agent-service change emitting a raw chunk would leak into the persisted log undetected — re-bounding at the sink was suggested as defense-in-depth, non-blocking.

### 0427 — `run --no-log` opt-out and retain-by-default (feature D2 / ADR-045)

Sources: `docs/tasks3/0427_*.md` (Design/Solution/Testing/Review); `apps/cli/src/commands/workflow.ts`.

#### Conventions

- **ADR-038 parity is a same-change obligation.** Every shipped flag updates `plugins/sp/skills/spur-cli/references/workflows.md` (signature + flag table) in the same commit; verified by `spur-cli-parity.test.ts`.
- **Design-conformance deviations are documented, not hidden.** The design draft assumed `options.noLog`; implementation exposes `options.log` — recorded as CHANGED in Solution and PASS-acceptable.

#### Errors fixed

- **Commander negated-flag semantics:** `--no-log` maps to `options.log` (default `true`, `false` when passed) — **not** `options.noLog` as the design assumed. Gate on `options.log === false`. Non-obvious to readers: comment it at the gate and in the Solution.
- **NPE on opt-out:** `runLog?.close()` in `finally` — the sink is absent under `--no-log`.

#### Patterns

- **Conditional construction beats a null-object sink.** Leave `runLog` undefined when opted out: no fd opened, no file written, no empty files, no maintenance surface.
- **Flag propagation to the detached `--async` worker mirrors `--trace-file`** — same spawn arm, same push shape, and the test spies `NodeProcessExecutor.prototype.run` argv to assert propagation end-to-end.
- **Golden-path triples:** default-retains, `--no-log`-writes-none, async-propagates — three tests pin the polarity.

#### Gotchas

- **Retention is a no-op under opt-out** — no file means nothing for 0429's policy to reclaim; keep the two surfaces decoupled.
- **Polarity is operator-settled:** retain-by-default was explicitly overridden over delete-by-default (D2 Notes). Don't reintroduce `--keep-log` or a config key for the opposite polarity.

### 0428 — `trace --follow --output` log-streaming source (feature D2 / ADR-045)

Sources: `docs/tasks3/0428_*.md` (Design/Solution/Testing/Review); `apps/cli/src/commands/workflow.ts`.

#### Conventions

- **Distinct source, never interleave.** `--output` branches to `followRunLog` and skips `followTrace` entirely; DB timeline and log stream never mix.
- **Validation mirrors the sibling contract:** `--output` requires `--follow` + run-id; rejects `--json` — the same human-stream rule `--follow` already has.
- **Match the sibling's exit code over the design doc.** Design said exit 2; implementation used exit 1 to match `--follow`. Documented CHANGED, PASS-acceptable.

#### Patterns

- **Offset-based tail with line buffering.** `readRunLogChunk` reads only complete lines since the last offset and holds back a trailing partial line until a newline lands — no mid-chunk partial flushes, blank separator lines preserved. Read-only; never writes the log.
- **Best-effort missing-log.** If the file never appears (run started with `--no-log`), poll until terminal status, then print a clear message instead of hanging forever. "Run not found" is swallowed inside the follow window, rethrown after — the retry window mirrors `followTrace`.

#### Gotchas

- **Review P4s (accepted, non-blocking):** trailing partial line is not drained at terminal exit (theoretical — the sink always terminates lines with `\n`); `runId` interpolated into the log path without sanitization (`../` runId → arbitrary `.log` under cwd; read-only, same-user, local); `.spur/run` + `*.log` path composition duplicated across follower and sink — shared-helper candidate.
- **Rejected FSEvents/inotify:** overkill; the existing `--poll` interval is portable and sufficient. No new `monitor` verb — operator-settled; a plain tail -f caps the marginal value.

### 0429 — `clean` run-log retention (feature D2 / ADR-045)

Sources: `docs/tasks3/0429_*.md` (Design/Solution/Testing/Review); `packages/config/src/index.ts`, `packages/app/src/services/workflow-service.ts`.

#### Conventions

- **Never overload units across scopes.** `--older-than` stays **minutes** (stale-run finalization, one-shot); `workflow.logRetentionDays` is **days** (retention policy). Config units = days, flag units = minutes; they are never cross-applied.
- **Extend the existing housekeeping verb, don't add `clean-logs`.** Default `spur workflow clean` runs **both** scopes so it stays the housekeeping one-liner; `--logs` scopes to reclamation only.
- **`workflow:` (singular) vs `workflows:` (plural) key adjacency is deliberate** — documented; reviewers will ask.

#### Patterns

- **Degrade-to-defaults seam:** `resolveWorkflowLogRetentionDays` follows the `resolveOutputLogConfig` pattern — any config failure → 30-day default, never fails the verb.
- **Best-effort deletes:** one file's permission error never aborts the rest; failures reported in the result + stderr. Missing run dir is a no-op.
- **mtime + retention is the only gate — never glob-delete without it** (would wipe active runs' logs). Age-only gate means a still-running run with an old mtime is reclaimable: rare, accepted under policy.
- **JSON is additive:** `{ ...cleanResult, logs: { retentionDays, dryRun, reclaimed, failures } }`, or the reclamation object alone under `--logs`.

#### Errors fixed

- **Misplaced JSDoc (P3, review-found):** inserting the 0429 resolver *before* the documented `resolveOutputLogConfig` left 0426's doc block dangling above the wrong function and the original undocumented. When inserting adjacent to a documented function, check which function the doc comment now attaches to.

#### Gotchas

- **Dir-level failure is silent (P4, accepted):** a `readDir` error on `.spur/run` is swallowed as a no-op, so the CLI prints "No retained run logs older than 30d." — reads as success. Per-file failures are reported; the dir failure is not.
- **CLI tests must pin temp cwds:** the verb now scans the real filesystem; unpinned tests would read the developer's own `.spur/run`.

### 0430 — Run-log observability doc sync (feature D2 / ADR-045)

Sources: `docs/tasks3/0430_*.md` (Design/Solution/Testing/Review); `docs/design/workflow-run-log.md`, `docs/04_DESIGN.md`.

#### Conventions

- **Ship-then-sync:** diff the design doc against the **live CLI** (`spur workflow run|trace|clean --help`) after code lands — never against the design's own claims. Signatures transcribed from code registrations (constitution §6.5), never recalled.
- **Authority order on repair:** satellite detail first (`docs/design/workflow-run-log.md`), then `04` index + signatures, then ADR-045 / `03 §6.1` consistency pass only if drift found; never re-author ADR rationale.
- **Corpus is CLI-gated:** `.claude/settings.json` write-guard excludes `docs/tasks*` / `docs/features*`; feature status via `spur feature sync`/`advance`, auto-gen tables via `spur feature refresh`.
- **Doc-sync is a scheduled meta task (T8):** per-task same-change covers only the spur-cli reference; the cross-cutting design/04/05 surface is a batch-closing item, not left to memory.

#### Patterns

- **ADR-038 parity is executable:** `spur-cli-parity.test.ts` (14/14) asserts the spur-cli reference matches live flags — run it after every flag-shipping batch instead of eyeballing the doc.

#### Gotchas

- **Auto-gen artifacts lie transiently:** the feature tasks table + `status: done` can show a task done while it is `wip` (reopened for review) — a review-cycle artifact that heals on the next `spur feature refresh`, not real drift.
- **Post-ship docs keep pre-ship vocabulary:** "subsumes the **current** `RunOutputSink`" survived into a doc marked `built` after 0426 removed the symbol (the code's own comments mirror the idiom). When a symbol is removed, grep derived docs *and comments* for its present-tense references in the same change (constitution §6.4 rule 4 lesson).
- **Snapshot tables read as claims:** a "Reads today" audit column describing the pre-D2 `<RUNID>-output.log` is correct for its purpose but misreadable post-ship — label the snapshot as historical.

---

File write declined — say "approve" to capture this to `.spur/run/wrapup-learnings.md` (appended after the 0425 entry, matching its format).
