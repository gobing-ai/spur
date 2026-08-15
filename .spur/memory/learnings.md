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

## 2026-08-05 — 0436 (spur-dev pipeline performance)

#### Conventions

- **Env-var shell refs don't re-parse operators.** `( $qualityGateCmd )` in `/bin/sh -c` word-splits the var; `&&` becomes a literal arg, so a multi-command gate (`bun run autofix && bun run spur-check`) breaks with TS5112. Use `( sh -c "$qualityGateCmd" )` to re-parse the command string (task-pipeline.yaml test/test-recheck) — prefer `sh -c` over `eval` for the same multi-command effect. `qualityGateCmd` is trusted pipeline config only; never interpolate untrusted input into it. Regression introduced by task 0432's env-handoff rewrite of `${vars.X}` → `$X`.

#### Gotchas

- **`spur workflow continue --yes` ≠ injecting the HITL answer.** `--yes` only skips the CLI confirm; use `--answer yes` to set the persisted `__hitlAnswer`, else the approve guard treats empty answer as rejection → `failed`.
- **Review section must carry a populated `| P# |` table row** for `spur task check` L3 to pass (precheck guard). Prose SECUA findings alone fail `hasPopulatedPriorityTable`; add a `| P3 | … |` row.

## 2026-08-08 — E1 batch (0455, 0457, 0463–0471, 0474)

#### Conventions

- **DD-09 orphan-scenario resolution: carry, don't create.** When a feature's scenarios aren't covered by linked task AC sections, add the destination scenario titles (bare, no R-prefix) to the tasks that already genuinely deliver them — following the 0466 pattern (`# Carried verbatim from feature E1's AC for DD-09 coverage`). One task may carry several scenarios. The normalized-title matcher in `feature-check.ts:464-489` strips `R<n> —` from feature scenarios and compares against task AC scenario titles.
- **Verdict artifact MET rows must reference carried scenario titles.** After carrying a scenario into a task's AC section, the corresponding `.spur/run/<wbs>-verdict.json` must have an `acceptanceCriteria` MET row whose `id` normalizes to the same value as the feature scenario title (via `rowMatchesScenario` at `feature-check.ts:912-924`). Adding scenarios to AC without updating verdicts produces `L4.scenario-unverified` warnings.
- **External anchors convention for cross-package work.** When implementation spans `~/xprojects/ts-libs/` and the Spur monorepo, cite the external package + symbol (e.g., `llm-jsonl-importer types.ts — splitConfig`) per the convention established in 0455 and followed throughout E1.
- **`--source all` fan-out with per-source failure isolation.** History import fans out across all sources; per-source failures are isolated (one failing source doesn't abort the others). Empty sources report distinguishable from total failure. Ad-hoc `--file <path>` targets one session.

#### Gotchas

- **`bun link` does not enqueue `prepare` hooks.** Bun only runs `prepare` for `Git | Github | Root` and `Workspace` resolution tags, never for `Symlink` (which `bun link` produces). A ts-libs source edit can silently appear as "my edit did nothing" because `dist/` isn't regenerated. Guard with `bun run --filter <pkg> build` after `bun link`, not a `prepare` hook (task 0468, 77 minutes lost).
- **`@ts-nocheck` hides errors across an entire package.** A package-wide `@ts-nocheck` in `ts-llm-jsonl-importer` masked multiple type errors. Removing it and running `tsc --noEmit` is the only reliable way to surface them (task 0468).
- **Source-conversion changes the ETL table.** Converting a built-in source to a custom mapper moves rows from `history_etl_<source>` to `history_message`/`history_tool_call`. Any test asserting generic ETL behavior must account for the table change (task 0468 R3).
- **`spur workflow run` with `agent.run` steps dispatches external CLIs.** The `wrapup-pipeline.yaml` uses `agent.run` which spawns external agent processes (Claude Code, Codex, etc.). These can timeout in an orchestrating session. When the workflow stalls on `agent.run`, execute the pipeline stages inline as the agent instead.
- **Feature transition guard runs in text mode where L4 warnings render as `[ERR]`.** Even when `spur feature check E1 --json` returns `pass: true` with only warning-level findings, the shell guard for `spur feature update E1 done` runs in text mode where L4 warnings render as `[ERR]` → FAIL. All findings (including warnings) must be cleared before the guard passes.
- **Never-fabricate convention: `n/a` not `0`.** In history reports, unmeasured durations (`durationUnmeasured === calls`) render as `n/a`, never `0`. Same convention as `formatRatio` for unavailable cache-hit ratios. Together: unavailable is never rendered as zero (task 0469 R5).

#### Patterns

- **Versioned artifact as contract.** `spur history analyze` writes a JSON artifact with `schemaVersion`; `spur history report` asserts `schemaVersion` matches `HISTORY_ARTIFACT_SCHEMA_VERSION` before rendering. A mismatch refuses the artifact with a clear message — no silent downgrade. The artifact is a versioned contract, not ad-hoc JSON (tasks 0474, 0469).
- **Daily pipeline as single run-once invocation.** `spur history daily`: import-all → analyze → write artifact → prune (90-day retention). Scheduled via external launchd plist, not an embedded scheduler. History `.*` events emitted to the event ledger for observability. Pre-logging failures captured by routing launchd stdout/stderr to `.spur/logs/` (tasks 0470, 0471).
- **SQL aggregation over load-all+JS.** `spur history analyze` uses SQL `GROUP BY` and `HAVING` queries (`forensic-query.ts`) instead of loading every ETL record into memory. Every query carries a `GROUP BY` or `LIMIT` — a benchmark passing on a small fixture proves nothing about a 600k-row corpus (task 0474).
- **Four detection layers, no single sole signal.** Artifact freshness, ledger events, per-source coverage status, and launchd error log — designed so no single layer is the sole signal for nightly failure detection (task 0471 R5, 0464 R8).
Captured to `.spur/run/wrapup-learnings.md`. Preserved the existing 0481 entry and appended 0480 + 0482 (both 2026-08-08) in the same grouped format — `## date — task WBS (title)` with `### Conventions/patterns` and `### Errors fixed / gotchas`.

Key learnings extracted per task:

**0480 — SSOT for `--agent` contract**

- One SSOT or drift is the default (8+ files restated the value table); a parity gate is what keeps an SSOT an SSOT (R1 without R8 decays at next ADR).
- "Declared impossible" ≠ impossible — host-agent detection was implemented twice in hooks while a test rationale recorded it absent.
- A shipped reference contradicted the code (`execution-batch.md:223` said `auto` detects the runtime; `resolveAgentAuto` does no detection).
- Freeze behavior when the real fix needs an ADR, so cleanup lands without blocking on a decision.

**0482 — E1 batch waste**

- A pin chooses where a run *starts*, not whether it may *recover* — pinned executor silently set `maxEscalations=0`, severing the 0407 tier-fallback ladder.
- The proof must exercise the mode production actually uses; 0407's `agent:'auto'` test passed with the path severed.
- Preflight can't see the wall — doctor degrades to `usable · auth:no · model:unknown` and the dominant burn consumed quota mid-run.
- Read the script before blaming it (size precheck already honored `--spur-bin`; the YAML just omitted it).
- Handoffs must point at the dead agent's transcript (`.spur/run/<runId>/agent-sessions/<executor>/`).
- Every executor can exhaust; guidance is "survivable", not "pin away".
Captured to `.spur/run/wrapup-learnings.md`.

Extracted 0487's learnings from its full task body (the post-mortem of 0486), grouped under `## 2026-08-09 — 0487` with `### Conventions / patterns` and `### Errors fixed / gotchas` sections, plus a key-evidence block. Preserved the existing 0480/0481/0482 bullets under their own date/WBS headers.

Core learnings:

- **Conventions:** one writer per working tree (git worktree isolation); commit per task (pre-launch warning, never block); agent var precedence `implementAgent` > `agent` > `agent.default` > YAML; size precheck uses default caps (raising `maxImplementReqs` doesn't make flash finish); unknown tier ⇒ `standard`; doctor `tier` is the *support* tier, not capability tier.
- **Errors fixed:** implement stage didn't scope to target WBS (dominant S0 — sibling committed-but-`todo` 0485 pulled in, reverted 4+ times); unauth `agent.default` isn't a precheck failure; `--vars '{"agent":...}'` never reached the implement hop; parallel-session collision mis-read as regression; `extractReviewSectionBody` literal-`Z` lookahead truncation; prose severity `P1 (blocker)` rejected; `--force-done` from `todo` denied.

`0487` was absent from the prior file (it only held 0480–0482), so no duplicate.
Captured to `.spur/run/wrapup-learnings.md`.

## 2026-08-10 — 0502

### Conventions / patterns

- **ADR-051 noun discipline: a flag on an existing verb beats a new first-layer noun.** The corpus sweep became `spur task check --corpus` (not `spur corpus check`) — the rejected one-gate `corpus` noun; `task check` already sweeps the full corpus when no WBS is given (`apps/cli/src/commands/task.ts`). First layer = nouns grouping similar actions; verbs/flags are the expansion mechanism.
- **Apps are thin transports (ADR-021).** Sweep + two-sided baseline reconciliation live in a `packages/app` service (`runCorpusCheck(cwd, since?)`), not the CLI transport and not `scripts/`; the CLI verb is a thin flag/output adapter.
- **Move-and-delete, never wrap/delegate.** Two surfaces for one gate is the defect being fixed — the spur-dev `corpus-check` command was removed outright, not kept as a compatibility wrapper; no parallel copies survive the transition.
- **Kill the CLI self-spawn.** The old `sweep()` shelled out to `bun run apps/cli/src/index.ts …`; the promoted service calls `task-check.ts`/`feature-check.ts` in-process.
- **Frozen names contract.** Design pinned exact file/export/type/flag names (`runCorpusCheck`, `CorpusCheckResult = {observed, baselined, newErrors, staleEntries, ok}`, `key()`, JSON keys) — implement exactly, don't rename.
- **Baseline semantics + format frozen (ADR-050/T10).** Two-sided: a new error fails AND a stale baseline entry fails; unparseable sweep is a hard failure (never "no errors"). `config/corpus-baseline.json` schema untouched.
- **Port compliance on the move into app layer:** `node:fs` direct IO → ts-runtime `FileSystem` seam; `Bun.spawnSync` git helper → `ProcessExecutor.run` (sync tree readers converted async); hardcoded planning folders → `resolvePlanningFolders`; `console.log` report dropped.

### Errors fixed

- **Unresolved `--since` refs silently skipped the fog check.** The port dropped the spur-dev-era console report, so an unresolvable ref produced no visible diagnostic. Fixed: CLI emits a SKIPPED reason on stderr (human + JSON, exit 0 — original semantics).
- **`--since` misuse wasn't loud.** Missing value → commander usage error (non-zero, names `--since`); flag-like value (`--since --json`) → exit 2 + usage message (R3 fail-loud).
- **Concurrent DB-lock collision.** `spur-check-new`'s rule-gate intermittently collided with the operator's concurrent `spur history import` DB lock; re-run to green after it finished — not a code regression.

### Gotchas

- **Verify evidence-type whitelist is strict.** The `--corpus` verdict check flagged `ac-row-dropped`: 8 AC rows used unrecognised evidence types (`live run`, `grep`, `CLI tests`, `git diff`, `task file`). Only `test` / `command` / `static-ref` are accepted — phrase AC evidence as an accepted type.
- **Baseline path resolution must use project root, not bare `process.cwd()` of the caller.** Covered by a nested-cwd test (T2).
- **Design-frozen scope is a deliberate boundary, not a missing abstraction.** Review P1 flagged that `structuralSweep()` validates only the active task folder; broadening to all configured folders would surface 404 legacy ratchet-drift errors and force a massive baseline reconciliation (T10) — tracked as follow-up, out of scope.
- **Selective staging for unrelated tree changes.** Unrelated concurrent work (`history-service.ts`, executor config) shared the working tree; excluded from 0502's commit via selective staging. One writer per tree / commit per task.

Key evidence: real repo `spur task check --corpus` → 2 observed / 2 baselined / 0 new / 0 stale, exit 0; injected unbaselined fixture error exits 1; `bun run lint` / `test` / `build` / `spur-check-new` all exit 0. Service tests 30/30 green (new-error, stale-entry, unparseable-sweep, nested-cwd, fog decision table).
Captured to `.spur/run/wrapup-learnings.md`.

## 2026-08-10 — 0505

### Conventions / patterns

- **Real-data history validation must use a source-local binary.** Invoke `bun run apps/cli/src/index.ts …` (or the built `apps/cli/spur.js`) directly; a bare global `spur` silently runs stale published code. Every invocation prints a provenance header (`binary:` + resolved `@gobing-ai/ts-llm-jsonl-importer@<version>`); record it before dry-run/write, `--json` embeds `provenance`.
- **Lockstep ts-libs release, never links.** When the reconciliation code lives in an unpublished ts-libs commit newer than the tagged package, publish via the sibling repo's operator-controlled `bun run bump-ver <version> --push`, wait for OIDC publication, then update Spur's catalog/lock. Temporary `bun link` or store overlays are not acceptable evidence.
- **Additive projection at the existing seam.** `CoverageEntry.reconciliation?: ReconcileSummary` (`packages/domain/src/analytics/artifact.ts:58`), copied unchanged at `HistoryService.importOneIsolated`/fan-out (`packages/app/src/services/history-service.ts:433-435,582`). No noun, verb, flag, wrapper, or config switch; text output need not grow — the verification consumes `--json`.
- **Real-data verification contract:** target is repository-root `.spur/spur.db` (1.7 GB), never `apps/cli/.spur/spur.db`; baseline counts are evidence, not frozen expectations (histories are live); idempotence means zero *stale reconciliation* on the second pass, not zero new records or unchanged global totals; read-only SQL only — reconciliation must happen through `history import --mode full`.
- **Backup before any destructive write:** SQLite online backup API to `.spur/backups/` with a WAL-quiescence sample (3 s stable size → no active writer), then `PRAGMA integrity_check` the backup itself.

### Errors fixed

- **Implement probe hit the real DB without `--dry-run`** — deleted 1 pre-existing antigravity row+ledger+checkpoint (leftover temp-file junk) and inserted 2 probe rows. Recovered via the frozen pre-probe snapshot (`.spur/run/0505-quarantine/`, integrity ok, totals matched baseline) used to surgically restore all three antigravity tables count-exact; pipeline writes preserved; the later R2 backup became the authoritative recovery point. Lesson logged: any real-data write probe must use `--dry-run` or an explicit dbUrl override.
- **Test gap closed:** P2's "focused mapping/CLI JSON tests" — the app-level mapping test already existed; added the CLI JSON assertion (`apps/cli/tests/commands/history.test.ts`) proving full-mode entries carry `entries[].reconciliation` and incremental omits it.

### Gotchas

- **Exit 2 is not automatically failure.** The seven documented malformed AGY source lines legitimately yield `degraded`/exit 2; only that known class is allowed — any other failed/degraded source blocks the write.
- **Four long-running `spur serve` daemons hold the real DB open** — potential concurrent writers on future real-data runs. Mitigated by WAL-quiescence sampling before the backup; recommended: stop serve daemons or use a dedicated `DATABASE_URL` for future verification passes.
- **Live sources insert fresh records while the verification runs.** Compare per source, not just aggregates: ledger accounting came out exact — 1,581,539 − 196,370 stale + 4,197 fresh (codex 2165, omp 1490, pi 354, agy 188) = 1,389,366 post-write.
- **Prove dry-run is mutation-free** by snapshotting the four history-table counts before and after and requiring them identical.

### Key evidence

- R1–R5 all MET (verdict PASS). Importer `@gobing-ai/ts-llm-jsonl-importer@0.4.25` (contains `b988a64`), catalog `^0.4.25` (`631ceaea`); provenance `binary=apps/cli/src/index.ts importer=0.4.25`.
- Dry-run exit 2 with only agy degraded; reconciliation previews per source (pi 66781/66781/757, claude 49659/49659/226, codex 10807/10807/315, omp 10095/10095/30, grok 39091/39091/25, agy 19936/19936/57, antigravity 1/1/1, gemini/opencode/openclaw 0/0/0).
- Write parity: programmatic `all_parity=true` across 10 sources; second full dry-run: all stale counts 0. Post-write: `PRAGMA integrity_check=ok`, unknown 0, orphan 0 (1,295,980 msg / 93,386 tool / 1,389,366 ledger / 15,857 cp).
- Raw evidence retained under `.spur/run/0505/` (`r2-baseline.txt`, `r3-dryrun.json`, `r4-write.json`, `r4-second-dryrun.json`, `r5-postwrite.txt`); dry-run 46 s / write 71 s on 1.7 GB.
Captured to `.spur/run/wrapup-learnings.md` (appended after the existing 0505 entry; 114 lines total).

Extracted from the three task files (all `done`, verdict PASS, 2026-08-11), grouped by date/WBS:

**0506** — wrap `--agent` selector hop, `--file + --mode full` without `--dry-run` guard, schema-first SQL rule. Conventions: prompt-runtime surfaces pinned by structural tests; surface overrides named pre-dispatch; guard exact unsafe CLI combination before DB access; live `sqlite_schema` introspection with importer as sole authority. Errors fixed: silent subprocess wrap handoff (3 sessions, 7.2 min, $0.11, 3.2M tokens), probe that mutated the real DB, four `no such column` retries.

**0507** — OMP envelope fix at the owning mapper (released `0.4.26`, tag `f817429`), additive assistant-duration fields (schemaVersion stays 1), selected-file force-file history bridge. Errors fixed: released mapper read `raw.*` instead of `raw.message` — wrong roles, event-ID-as-session-ID, dropped duration, zero tool rows. Patterns: ETL-vs-raw signal split, filename-stem session keys, sanitized regressions (structural keys only).

**0508** — inline redefined as host-controlled/native-subagent-first, four-check deterministic eligibility, dual provenance, no post-launch replay. Errors fixed: contradictory prior draft with subjective handoff-cost heuristic; host-only promises across ADR-047 + 7 doc surfaces updated in lockstep.

## 2026-08-11 — task 0510

- **Solution citation is a write-seam concern, not a check-time concern.** The L3 `solution-file-line`
  rule must be enforced at `TaskService.updateSection` (before mutation) via the SAME exported
  predicate the checker uses — otherwise an invalid authored Solution lands on disk and only a later
  lifecycle check rejects it. One predicate (`hasSolutionFileLineCitation`) prevents write-time /
  check-time drift.
- **Bun's `coverageThreshold` is per-file, not aggregate** (oven-sh/bun#17028). Importing a
  previously-unimported script module into a test drags it into the coverage report, and a
  low-coverage module fails the run silently (exit 1, no message). Cover script modules fully or
  keep them out of test imports. In ts-libs this meant full `bumpVersion`/`dropTags`/`publishPackages`
  coverage via `mock.module` (workspace + npm seams) plus scripted spawn — the injectable
  `spawn`/`sleep` parameters mirror the module's existing `npmViewVersion(..., spawn?)` pattern.
- **`mock.module` in bun:test** intercepts relative module imports if registered before the import
  statement in the same file, with `import { mock } from 'bun:test'` (not a global).
- **Order-based fake spawn beats matcher-based.** A matcher `routes.find` spawn replays the same
  canned output for every identical call; a consuming scripted spawn matches exact command order and
  fails loudly on mismatch — necessary for bounded-lookup tests where `gh run list` repeats 3-5x.
- **Markdown table cells can carry abbreviated `path:line` anchors.** After a full path is named once
  in a sentence, an abbreviated re-reference (`execution-batch.md:67`) does NOT resolve from the
  project root and trips L4 stale-anchor warnings. Every `file:line` citation in Testing/Review must
  be a full repo-relative path.
- **Precheck's dirty-tree warning excludes `docs/tasks*`** (the pipeline writes the corpus itself),
  so pre-existing uncommitted corpus changes from another batch are invisible at precheck. They stay
  out of the task's commit — stage only the task's own files.
- **GH Actions run lookup needs eventual-consistency headroom**: a just-dispatched
  `workflow_dispatch` run may not appear in `gh run list` immediately; the fail-loud path (throw,
  no tag mutation) is the safe recovery for the release script.

## 2026-08-13 — 0530

- **Convention:** `every-export-has-tsdoc` fires on exported classes even when the sibling `type` has a doc comment. `WaitError` shipped in f9af0dc5 without one and failed `spur-check` only at `test-post-check`.
- **Gotcha:** Design satellite **Status** can say "landed" while the intro paragraph still says "do not invoke" — grep both, not just the status line.
- **Pattern:** Re-running `/sp:dev-run` on a `done` task must not `task update wip` / `record --transition testing`. Leftover fixes stay in the working tree; status stays `done`.

## 2026-08-13 — 0533

- **Gotcha:** Plan step 1 (catalog bump to `@gobing-ai/ts-dual-workflow-engine` 0.4.31) was excluded from commit `2bf0fdb5` as "concurrent dirt" while D4 notes claimed it shipped. HEAD `bun.lock` still pins 0.4.30. C1 APIs (`collectWorkflowExtensions`) need the bump in the same leftover commit as the consumer.
- **Pattern:** A done-task re-run must not reopen status; leftover catalog + T4/T3 docs are the wrap-up, not a new implement.
Captured to `.spur/run/wrapup-learnings.md` (appended under existing 0510 entry).

## 2026-08-13 — task 0532

- **Historical `<wbs>-verdict.json` artifacts unblock `verifying→done` on archive tasks.** Tasks that
  predate the verdict-artifact feature carry no `.spur/run/<wbs>-verdict.json`, so
  `feature check --strict --as done` fails L4 (`readVerdictArtifact`,
  `packages/app/src/services/feature-check.ts:699`) and `feature sync` stalls at
  `verifying→done`. The fix is artifacts only: write PASS verdicts from existing test/code evidence
  — no new CLI verb, no `team attach`, no `--force` done, no edits to `docs/tasks2/` bodies.
- **L4 reads verdict artifacts only for *done* covering tasks** (`feature-check.ts:615`), so a
  wrap-up task's own scenario stays `L4.scenario-unverified` while the task is `wip`. The final
  scenario of a verdict-artifact task cannot go green until the pipeline's verify→record→done
  certifies the wrapping task itself — expected, not a defect; do not force it.
- **AC `id` must match the feature scenario title exactly** (R-prefix stripped) — matched by
  `rowMatchesScenario` (`feature-check.ts:923`). The verify step's answer-file AC row id must equal
  the scenario title verbatim or the gate re-opens after the task is done.
- **L4 is OR across covering tasks**: a parent task (0195) may carry all 7 G2 scenario rows while
  children 0207–0210 carry subsets. Redundant but correct — no need to split coverage.
- **Frozen `VerifyVerdict` shape** (`packages/app/src/services/task-record.ts`):
  `{wbs, verdict, requirements[], acceptanceCriteria[], checks[], source}`; runDir is repo
  `.spur/run` (`defaultVerdictRunDir`). `checks[]` rows like `{name: targeted-test, status: pass,
  evidence: "exit 0"}` satisfy the record gate.
- **Verdict evidence = freshly-run targeted tests with pass counts, not full-suite runs.** Each AC
  row cites `bun test <file> --test-name-pattern "<pat>"` actually executed this session with
  counts (`startAutostart` 2 pass, `GET /api/team/processes` 11, `stream` 12, `stdin` 4, `list` 2,
  `start/stop` 12). No fabricated PASS: every row maps to a green run; missing web UI test → cite
  component paths as evidence, don't invent coverage.
- **Wrapup-pipeline `agent.run` steps default to `agent.default`, which is not a registered
  executor.** First wrapup run failed in 0s: `Unknown agent: 'agent.default'` (available: minimax,
  omp, omp-deepseek, codex-*, agy-*…). Re-dispatch must name an explicit executor (e.g. `omp`).
- **Even an artifact-only task trips doc-sync T3 and surfaces pre-existing drift.** 04_DESIGN (the
  surface SSOT) was missing six verbs that exist in code — `task deps` (`task.ts:491`), `task
  sections` (`:538`), `task path` (`:1121`), `task verifyall-aggregate` (`:853`), `task run-link`
  (`:1147`), `workflow cancel` (`workflow.ts:616`). Repaired with signatures + exit codes, version
  1.27.0 → 1.28.0.
- **`docs/features/INDEX.md` lags the synced satellite** (G2 still `[active]`): `spur feature
  refresh` owns that at the G2→done transition — flagged, not hand-repaired, per tool ownership.
Captured to `.spur/run/wrapup-learnings.md` (appended after the existing 0532 entry).

## 2026-08-13 — task 0534

- **Verify every premise against the live tree before implementing — two of four forensic findings were wrong on first analysis.** R1 originally said "enable `showSuggestionAfterError`" — it is already on and working (`spur task shwo 0119` → `(Did you mean show?)`); implementing the original wording would have been a no-op and the ticket would close with the bug intact. R2 originally said "hoist the section list into help" — `spur task sections <wbs> list` already computes it. Corrected premises are recorded in the task Notes; do not re-derive them.
- **Commander's `showSuggestionAfterError` is lexical (edit distance) — it catches `shwo`→`show` but cannot bridge semantically-near, lexically-distant guesses like `get`→`show`.** The only close for an observed wrong verb is an explicit alias, not a config flag.
- **Alias over second command:** `.alias('get')` on `task.command('show')` (`apps/cli/src/commands/task.ts:239`) and on `feature show` (`feature.ts:47`) — one help entry, one code path. Never register a second top-level command for a synonym.
- **Alias set is evidence-driven:** `get` was added because 6 independent invocations reached for it; nothing beyond that. Add the next alias when a log shows it — this is what keeps `--help` honest.
- **Point at the command that computes the answer instead of hoisting the answer into prose.** R2's fix appends `Valid section names (no failed write): \`spur task sections <wbs> list\`` to `task update`/`feature update --help` and to the `feature-service.ts:233` rejection. The `task sections` command already interpolates `UNIVERSAL_SECTIONS` from the domain constant (comment at `task.ts:550-551` exists so prose cannot drift); a literal list in help would reintroduce exactly that drift.
- **A forensic analyzer that fails open is worse than one that errors.** R3: the OMP field map documented `input.command`; the live toolCall shape is `arguments.command` (keys `['arguments','id','intent','name','partialArgs','streamIndex','type']`), so the analyzer produced a silent "no test-loop waste" verdict for sessions that ran 40 tests and 147 spur calls — indistinguishable from a clean run. The fail-loud note (zero tool-command count across a non-empty set = broken field map, never idle sessions) is the load-bearing half; the map fix alone leaves the next format change silently wrong again.
- **Fix the analyzer first so before/after measurements are trustworthy** (R3 landed before R1/R2's re-measure).
- **Heuristic thresholds must derive from the domain shape, not task count.** The section-write bottleneck (`> 2× task count`, SKILL.md:205) falsely flagged a healthy 7.6-writes/task feature-impl batch — one write per canonical section is correct behavior for ~9-section tasks. New formula: flag when writes exceed `> 1.5× the canonical section count for the task's variant/status matrix entry` (≈ 13.5 for feature-impl); never hardcode "9".
- **Cross-session findings are agent-independent, not one model's habit** — the same `task get`/`--help` patterns recurred in a parallel Claude Code session. Findings recurring across ≥2 independent sessions are `/sp:rule-scan` codification candidates; the skill forbids inventing rules inside itself, so that is a follow-on.
- **Test-suite constraint:** `apps/cli/tests/commands/feature.test.ts` runs at the A–Z top-level letter ceiling — its alias test deliberately asserts the error contract with no `create`, because one extra feature would exhaust allocation.
- **Alias normalization `split('|')[0]` is safe** (`plugins/sp/tests/helpers/cli-surface.ts`) — Commander alias tokens never contain pipes.
- **Skill-doc changes need no unit test but must not break `spur-cli-parity.test.ts`** — it extracts `TASK_CANONICAL_SECTIONS` (`apps/cli/tests/spur-cli-parity.test.ts:182`).
- **The 4 observed section-name failures were on the feature path, not task** (`packages/app/src/services/feature-service.ts:233`) — when fixing discoverability, check where agents actually stand, not where the command is defined.
- **Preserved from the analyzed run:** zero compactions across 21 sessions, one loop candidate in 876 tool calls, batch-write-then-single-check protocol held (2.6 `task check`/task, under the 3-per-task guard). Counts exact; per-incident waste multipliers are estimates — treat "~20–25 min" as order-of-magnitude, not measurement.
Appended to `.spur/run/wrapup-learnings.md` after the 0534 entry. Verified in file.

## 2026-08-13 — task 0541

- **A two-sided gate is the anti-rotting pattern for compatibility shims.** Modeled on `config/corpus-baseline.json` / `corpus-check.ts`: an unregistered marker fails **and** a manifest entry whose marker disappeared fails — the second half is what stops a suppression list decaying into permanence. Reuse the same "observed vs baselined vs new vs stale" reporting vocabulary so an operator reads either gate the same shape.
- **Build the gate before the shims it governs.** 0541 shipped the tripwire first so 0536/0537/0538 have somewhere to register; a shim task that forgets to register fails its own quality gate with a named violation — the two-sided gate *is* the tripwire. The gate being trivially green until then is by design, not a gap.
- **Seed the manifest empty; registration belongs to the task that creates the shim.** The mechanism ships with no entries; each shim-carrying task records its own `id` (lowercase kebab), `wbs`, `file`, `keepsWorking`, `removalCondition` — all required fields, enforced by the gate.
- **Removal conditions must be objectively checkable, or the shim is permanent.** "Remove when the binary-name form is unused" is unfalsifiable and rejected; "remove when `docs/` and `config/workflows/` contain no bare-binary `--agent` value" is checkable. `docs/04_DESIGN.md` §2.5 defines emptying `config/transition-shims.json` as the definition of transition complete.
- **Marker in a comment, never in code.** `@transition-shim(<id>)` must not change runtime behavior — it is a grep target and review signal; a comment keeps it free of imports or helpers.
- **A standing gate must be cheap and dependency-free.** Full tree walk over 6 source roots ≈ 0.5 s per `spur-check` run, node-builtins only for plugin portability — acceptable standing cost (P3 finding, no action).
- **Exclude build output, `docs/`, and `tests/` from the marker scan.** Prose examples and gate-fixture marker text are not shims; scanning them would false-fail every gate run.
- **Report the two violation directions distinctly, and assert the distinction.** A stale entry fails as "stale manifest entry gone", never "unregistered" — the tests assert the absent word so the directions can't be conflated. Duplicate marker ids in two files are reported once, naming both.
- **Accepted noise, by design:** an invalid entry (missing field) whose marker still exists in source also reports as unregistered (P4 double-report — the actionable message is the incomplete-field one); the manifest `file` field is recorded info, not validated against the scan — the two-sided marker scan is the enforcement, the field is worklist findability (P4).
- **Gates wire into the existing quality chain, not a new opt-in step.** `transition-shim-check` appended to `spur-check`, `spur-check-new`, and both `:full` mirrors (`package.json:78-88`); no new CLI noun/verb (ADR-051) — a check script, not a `spur` surface.
Captured to `.spur/run/wrapup-learnings.md` (appended after 0541 entry; verified in file). Extracted from task files 0535/0536/0537/0538/0542 — all done 2026-08-14, feature B2 role-routing batch.

## 2026-08-14 — task 0535 (Layer-1 role-to-tier table)

- **Right-size the vocabulary by selection consequence, not by name count.** 0344 proposed eight intentions; checked against the stage registry they carried only four distinct tier floors — four names had zero routing difference. Collapsed to four roles, one per tier. The role→tier one-to-one property is self-checking: a proposed fifth role must bring a fifth tier, otherwise it is a synonym.
- **Fold when tiers agree, keep when they differ.** `tester` folded into `coder` because `test` and `implement` share `min_tier: standard` — same eligible executor set; test-writer-vs-implementer is a *prompting* difference the skill carries, not a selection difference. Reopen only with a concrete model strong at one and weak at the other.
- **Naming is a decision, record it.** `utility` → `scribe` (other roles name people; work is mostly derived text). `rule-scan` under `reviewer`, not `scribe`: analysis, not transcription.
- **Supersede, do not rewrite (corpus discipline).** Task 0344 kept its recorded D1–D8; an appended superseding note points at this task. The record of what was decided when is the corpus's value.
- **Consistency is a test, not a convention.** `roles.test.ts` parses the YAML and asserts every invariant against the live command directory and the real registry — without it the file becomes the seventh place tier facts drift.
- **The live directory is the authority, not the decided table.** The decided 31-command list was wrong: the directory held 37. Placed the six extras by the same stage logic and documented the placement; the design itself declared the directory authoritative.
- **The plugin cannot import `@gobing-ai/spur-domain`** — read the registry as text (regex over `schema.ts`), the same discipline as `stage-registry-parity.test.ts`.
- **Word-boundary match vendor strings** so `resolve` ≠ vendor `sol`; take the first yaml fence — safe while the file carries exactly one.

## 2026-08-14 — task 0536 (--agent takes a role; extractPhase retired)

- **Extend the resolution funnel, never fork it.** `resolveExecutorSelector` gained a `'role'` branch; a parallel selector path is the defect class feature B2 exists to close — two selectors that can disagree.
- **Never hardcode the role ids in TypeScript.** Parse them from `roles.md`; a second copy of the list is exactly how the tier prose drifted originally. (Exception that stayed: `AGENT_ROLE_NAMES` in config — test-guarded by a parity test, so it cannot drift; documented as acceptable.)
- **Roles and executor names coexist in one flag only because the collision guard proves the namespaces disjoint.** Match role-first — a closed four-value vocabulary makes a hit unambiguous.
- **A pin is permanent, a shim is transitional.** Explicit executor name = permanent escape hatch, no deprecation warning, load-bearing for workflow pins. Bare coding-agent binary name = registered transition shim with an objectively checkable removal condition; the two-sided shim gate tracks its removal. Warn once (`warnDeprecationOnce` pattern) so a retry loop cannot spam.
- **Reject at the flag boundary before any spawn**, naming both accepted sets; unknown value exits non-zero and spawns nothing.
- **Delete, don't degrade.** `extractPhase` was removed outright — no regex fallback survives; a caller declaring nothing lands on the default role *visibly*, and the stage door is the explicit `--stage` flag.
- **Deletion leaves residue — prune on the next touch.** P3 finding: dead `'phase'` union member and `phase?` param after R4 (no call site passes one). No behavior impact; queued for 0542's edit of the same files.
- **Public CLI surface change needs ADR-051 operator consent recorded** — ADR-033 amended in the same commit (T3) as the surface docs.

## 2026-08-14 — task 0537 (executor binding through spec materialization and drain)

- **Root cause was one dropped field, not a redesign.** The executor name was already correct in config; both hops discarded it. Carry it instead of re-architecting.
- **Silent downgrades are the bug class to hunt.** On-disk proof: config declares `codex-sol` (capable-3, gpt-5.6-sol), spec stores only `type: codex`, so the run was bare `codex` at the undeclared standard tier — no error, no warning. The regression test asserts a spec materialized from `executor: codex-sol` never runs bare `codex`.
- **Additive fields over replacements.** `executor` sits *beside* `type` — AiRunner resolves the runner from `type`, and existing on-disk specs carry only it. Pre-existing specs without the field fall back to `type` under a registered shim.
- **Extend the existing `superRefine`, don't add a second validation pass.** The collision guard grew in the schema's existing member-id-uniqueness check.
- **The namespace guard is three-way** (role × executor × spec id) — roles arrived with 0535, making the original two-way framing incomplete. Each failure message names both colliding names.
- **Ordering inside a rewrite is a contract.** `spec-id` is set *before* the drain selector rewrite because the flag must survive an empty inbox — `runAgentLoop` depends on it. Never move it.
- **Fail loud on a dangling reference.** Inject `isCanonicalAgent` so `resolveExecutor` throws on an executor absent from config rather than silently returning a bare binary — the exact downgrade the task removes.
- **Keep the bare-string member shorthand** (`- claude` → `{executor}`); `normalizeMember` is its contract.
- **A lockstep ts-libs bump rides outside the task's backticked allowlist** — the pipeline `requireDiff` scope guard needs `implementScopeGuard: off`, or the bump ships as its own chore commit first.
- **Unreachable guard code and overstated counts get flagged.** P4: composed-id↔role check can never fire (composed ids always carry a `teamId-` prefix); the Solution said "5 collision cases" but the test implements 4.

## 2026-08-14 — task 0538 (declare role across commands, workflows, team members)

- **Deletion is the deliverable, not a tidy-up.** The hand-restated tier prose existed only because Layer 1 had no file; once it does, it is a duplicate source that can drift. Removing it is the point — and it is how you verify the declaration half was total: a grep for tier literals returning only `roles.md` pointers is the completeness proof.
- **Migration-scoped by ruling.** Touch what the intention layer forces and nothing else; the broad `plugins/sp` defect audit is a sibling feature sequenced *after* so it inventories the post-migration tree.
- **Never invent the mapping.** A command's role is read from its `roles.md` row; a command missing from the table is a 0535 defect to route back, not a judgment call. Command count is 37, not the charting-era 31.
- **Pins beat role routing permanently — `role:` declares the reason, not the executor.** Workflow steps keep their `agent:` pin (a misconfigured box must not capture the run); removing a pin later routes correctly instead of falling to the default role.
- **Preserve real behaviour when re-expressing.** The size→tier rule encodes something real (a large task on a sub-`capable-1` executor burns budget without failing fast) — it must survive as a rule that *reads its floor from Layer 1*, not restate `capable-1` inline.
- **Enforce, don't convene.** Extend the existing `roles.test.ts` rather than creating a new test file; a command added without `role:` fails the suite naming the file.
- **Don't split a self-verifying task.** The deletion half verifies the declaration half, so splitting would leave the delete side unable to tell whether coverage was total — run it on a capable-1+ executor instead of slicing.
- **30-min subprocess timeout hit again** (omp-deepseek on a multi-surface task): implement completed inline per the timed-out-implement runbook; full gate still PASS (5042 tests).
- **The tier-literal scan excludes the test file itself by design** — that carve-out must stay explicit or a future inline literal silently passes.

## 2026-08-14 — task 0542 (--spec flag; agent.default redefined as a role)

- **One flag per concept — and the split is cheapest inside an existing migration.** `--spec` was deferred twice when `--agent` wasn't otherwise changing; redefining `--agent` anyway made the split cost one deprecation window instead of two.
- **`agent.default` migration is a three-way branch, not a fallback chain.** Known role → new semantics; known executor name → warn once + legacy fallthrough under a registered shim; neither → fail naming both accepted sets. The middle row is the load-bearing one: silently treating a stale executor name as an unknown role routes every undeclared dispatch to the wrong tier with no signal.
- **A role is not a unique address.** Two members can share a role — the identical multiplicity argument G4 applied to coding-agent kind — so `--spec` takes ids only.
- **Don't re-flatten what 0537 fixed.** The spec→executor binding must survive the flag move; the occupant record must stay byte-identical. `spec-id` set before any selector rewrite, unchanged.
- **Process-global warn-once sets are unobservable in a shared test process** — earlier tests pre-warm the once-set, so first-warning assertions need a fresh-process test file (`agent-spec-flag.test.ts`).
- **Path-literal markers trip the `sp-runtime-path` rule.** The partial implement wrote `config/workflows/` in the shim marker; the convention is the `.spur/workflows/` symlink path. Matches the 0536 marker convention.
- **Timed-out implement leaves a non-compiling tree — the runbook is: define the missing symbol, fix failure swallowing, then re-run the full gate.** `resolveAgentAuto` was swallowing the R2 exit-2; the inline completion fixed it.
- **Config migration must be loud, never silent reinterpretation** — every existing config's `agent.default` value changed domain; the warn-and-legacy branch kept this repo's own `omp-dsv4-flash-opencode` working under a shim.

## 2026-08-14 — dev-runall feature:E6 (tasks 0557/0558/0559)

- 0557: run-to-session mapping — new `history_run_session` table with `exactness` (exact/unresolved) + `mechanism` (observed/supplied); run path never writes imported-history tables. Watermark at invoke start = timestamp capture only (never a directory walk); resolve after exit; any failure records `unresolved`, never fails the run.
- 0557: the minted `runId` was never threaded into `agent.invoke.*` payloads (system_events.run_id NULL for all 202 events). Fix: pass `correlation: { runId, executionId }`; the tap's existing `nested.runId` lookup does the rest — no second correlation channel.
- 0558: retro-correlation by bounded time window; estimated/inferred rows never overwrite exact ones (EXISTS guard in DAO write path, not convention).
- 0559: cost attribution repointed at history_message typed token columns via attributeActionCost; dead ETL path (queryEtlRecords/SOURCE_TABLES) deleted; exact/estimated folded apart, never summed.
- 0559: ts-libs fix delivery — detectProvenance removal requires a lockstep ts-libs release (bun run bump-ver <ver> --push, OIDC CI publish) THEN bun update in the monorepo. The tag trigger didn't fire on push; workflow_dispatch on main published the same version (workflow reads package.json versions). Pre-push lefthook blocks on pre-existing lint warnings — fix the warning (rename to_col), never --no-verify.
- Batch ops gotchas: inline implement can exhaust implementTimeoutMs (30 min) on large tasks mid-work — raise the budget for resume (partial state carries). A hung review subagent (zero tool calls >5 min) should be stopped and re-dispatched fresh — no partial mutations to protect when nothing was called.
- Verdict answer files: stray review-table rows leak into the AC table and trip ac-row-dropped warnings — cosmetic, verdict stays authoritative.
# Wrap-up LEARNING-CAPTURE — Feature E3 (tasks 0548, 0549, 0550)

Raw markdown grouped by date + task WBS. Captured from verdicts, verify answers, test-gate logs, and
commits. Date is the task's done date (UTC).

## 2026-08-14 — 0548 (measure incremental import + analyze cost on real data)

### Conventions

- Real-data history validation must use a source-local binary (`bun run apps/cli/src/index.ts …` or
  built `apps/cli/spur.js`), never a bare global `spur` — mandated after the 2026-08-10 backfill ran
  old code ~83 s. Every `spur history import` prints a provenance header (`binary:` + resolved
  `@gobing-ai/ts-llm-jsonl-importer@<version>`); `--json` embeds the same `provenance` field.
- A measurement task produces a citeable artifact (precedent `docs/tasks2/0347-inventory.md`) and
  leaves the full `spur-check` gate to the pipeline's test hop (implement-scope rule: the full gate is
  never run from inside implement).
- Measure the condition the trigger will actually run in (steady state), then the backlogged case as
  an upper bound — a cold full import is the wrong number.

### Patterns

- Import and analyze measured in **separate** processes so they can be triggered at different
  cadences; a single combined number hides the order-of-magnitude split (import ≈ 20.6 s all-fanout,
  analyze ≈ 9 s over 1.5 M records).
- Ledger dedup (`record_hash TEXT PRIMARY KEY` on `history_import_ledger`) makes idle-period backlogs
  near-free: 248k re-parsed lines → 34 net inserts.

### Gotchas

- `--source all` also imports gemini (3,083 records) and opencode (28,149 records) on this machine,
  contradicting the "unsupported sources import nothing" assumption of the 2026-08-06 ruling. Scope
  decision (six full-fidelity vs all) must be explicit before quoting window arithmetic (13.9 s vs
  20.6 s).
- n=1 measurements: each import condition measured once; conclusions carry ≥10× margins so the R5
  recommendation holds, but downstream tasks must not quote per-source figures as more precise than
  run-to-run variance.
- Raw run JSON/time files under /tmp/0548/ were deleted after transcription — figures are auditable
  through the artifact, not raw payloads.

## 2026-08-14 — 0549 (enqueue coalesced history refresh on work completion)

### Conventions

- Off the hot path is a project principle (deterministic over hidden automation): the trigger enqueues
  and returns; the refresh never runs inline on the firing operation.
- The trigger is explicit + opt-in config (`history.refresh.on_completion`, default off), observable,
  and disable-able without code edits — hidden automation is ruled out by the constitution.
- Trigger points are exhaustive and terminal: task-done + pipeline-run completion; never "every CLI
  invocation".

### Errors fixed

- **P2 correctness/concurrency:** coalescing made atomic via `INSERT … ON CONFLICT DO NOTHING` + a
  **scoped partial unique index** `queue_jobs_history_refresh_pending_unique`
  (`queue_jobs(type) WHERE type='history.refresh' AND status='pending'`). Index scoped to ONE type on
  purpose: `task-action`/`feature-action` legitimately hold multiple pending rows. Cross-process
  concurrency test added (`packages/domain/tests/db.test.ts:201-244`).
- **P3 observability:** `enqueueHistoryRefresh` returns the POST-merge payload (merged burst window),
  asserted in tests.

### Patterns

- Coalescing join: merged payload keeps earliest `windowStart`, extends `windowEnd` to latest
  completion, `nextRetryAt` slides to `now + debounce_ms`; once claimed (`processing`), next
  completion starts a fresh job — an in-flight refresh is never starved.
- Debounce default (600 000 ms) follows 0548's measured figures: window must dwarf the import cost
  (~20.6 s) so a burst pays one import.

### Gotchas

- **Server-only consumption (P2, documented not fixed):** `history.refresh` jobs are consumed ONLY by
  `spur serve`'s `JobWorkerService`; the CLI has no worker/scheduler. A CLI-only operator (common:
  `spur task done` / `spur workflow run`, incl. runall parallel agents) enqueues a pending job that
  never runs without the server. Operator-confirmed intended (2026-08-14); documented as a
  precondition in `docs/04_DESIGN.md` + task `### Notes`.
- **Coalescing migration residual:** `CREATE UNIQUE INDEX IF NOT EXISTS` fails on an existing DB that
  already holds duplicate pending rows of that type (only possible via the pre-fix race); none
  expected since the trigger is opt-in and default-off.
- 0548's single-flight guard + stricter cadence recommendations were NOT implemented here — recorded
  as residual, not silently dropped.

## 2026-08-14/15 — 0550 (watermark live sessions + report refresh coverage honestly)

### Conventions

- Honesty about coverage is a hard requirement: a refresh must report `{ refreshed, skipped, window }`
  rather than bare success, so the reader can tell current data from stale.
- Additive output: `sessionState` is output on the artifact, never a new DB column — pre-0550
  artifacts are unaffected (absent ⇒ unknown).

### Errors fixed

- **Watermark role-unknown regression (P2, review-fix):** the original watermark predicate treated a
  final `role='unknown'` / role-less message as *not assistant-like*, so the session was marked
  in-progress and its data **zeroed** — but the claude mapper writes `'unknown'` for role-less
  messages and imported rows commonly lack a role. Fix: role-less / `'unknown'`-role imported messages
  **degrade to complete** — analyzed, not zeroed. New regression test
  `packages/domain/tests/analytics/watermark.test.ts:181-202` (final `role='unknown'` no tool call ⇒
  state complete, watermarkSeq = maxSeq, rollup counts 3 messages / 42 input tokens).

### Patterns

- Watermark policy: analyze bound to the last **complete turn** (assistant-like, non-meta message with
  no open tool call); everything after is a possibly-incomplete trailing turn excluded from derived
  values. Where "complete" is ambiguous (no tool-call rows), degrade to "last message is assistant-like".
- Growing in-progress session contributes only the completed portion to totals (30 tokens not 80) —
  verified by test.

### Gotchas

- Pre-0550 behavior for complete sessions is unchanged — no data is excluded; the policy only affects
  sessions still being written.

## Cross-task — bun 1.3.14 coverage-exit-1 bug (all three tasks)

- **Symptom:** `bun test` prints "0 fail" then `error: script "test" exited with code 1`; the
  project coverage gate (bunfig `coverageThreshold` lines 0.9 / functions 0.8, plus the
  `.coverage/lcov.info` post-check) exits nonzero spuriously.
- **Root cause:** Bun 1.3.14 coverage instrumentation is unreliable from monorepo root with
  `--coverage`; lcov is sometimes written to a workspace-relative dir, sometimes not at all, and the
  gate fails closed. Focused runs apply the repo threshold to every loaded dependency pulled through
  package barrels, so a single-file target at 100% can still exit 1.
- **Workaround (this batch):** judge test success by "0 fail", not exit code; use the per-file
  coverage row as focused evidence; verify the real gate with `bun run test`. 0549's test-gate.status
  shows FAIL purely from this spurious exit while the actual suite was 51 pass / 0 fail.
- **Where recorded:** `.spur/context/buglog.md` (bugs 146/148/762 + root-coverage instrumentation),
  `.spur/context/learnings.md`.

## 2026-08-15 — M5 batch 1 (0543, 0544)

- **Extend the union, do not fork it.** Role became the primary axis by relaxing `executor` to optional on the EXISTING member schema + one superRefine (R4), not by adding a parallel member type. A second member shape is how the tier prose drifted before.
- **One selector, never two (0543 R1).** The role → tier → cheapest-eligible funnel was extracted from `AgentService.resolveRole` into a shared `cheapestEligibleExecutors` — `--agent <role>` and team materialization now route through the same code. The task's own design demanded this; duplicating the sort in team-service would have created exactly the disagreeing-selector defect feature B2 exists to remove.
- **Derive local ids in ONE shared function.** `memberLocalId` (config core) is called by config-load validation AND materialization AND autostart derivation — config-load ids and materialized spec ids can never disagree. Indexed `<role>-<n>` by declaration order, frozen.
- **Unset is a value (0544 R4).** Undeclared role renders literal `unset` in human output and the Board badge, and is field-absent (undefined) in `--json` — never blank, never back-derived from the executor's tier. Tier inference over executor names is the exact failure feature B2's terrain notes record.
- **Zod 4.4.3 enum errors are terse.** Default enum error ("Invalid option: expected one of …") omits the received value; `z.enum(vals, { error: (issue) => new Error(...) })` gives a dynamic message naming value + accepted set while preserving the union type. Union parses nest variant errors in `error.message`, not top-level `issues` — assert on `error.message` in tests.
- **Inline-driver + worktree pitfall: agent.run stages must NOT dispatch native subagents when the batch runs in a worktree.** A native subagent shares the HOST tree, not the worktree — it would implement in the wrong checkout. The inline driver contract's eligibility condition 4 (subagent shares the working tree) fails; execute the stage in the host with every command pinned to the worktree cwd.
- **Biome forbids `!` (noNonNullAssertion).** Replace with an explicit undefined check (cheapest-eligible winner) or a cast in tests — never `biome-ignore` to force green.
- **Edit-tool hazard with structural-summary reads.** A ranged read can render elided bodies as `{ … }`; using that rendered text as an edit old_string corrupts the target block (mangled a describe header mid-task). Always verify edits that matched suspiciously against `git diff`/raw read before proceeding.

