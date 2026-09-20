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

## I3 batch learnings (0539, 0540) — 2026-08-15

- `spur task verdict --from-answer` requires a `| Req | Status | Evidence |` markdown table (header located by column name); free-form PASS prose parses to UNKNOWN. (0539)
- Reviewer/implementer subagents reliably trip on `intercom` AFTER delivering complete reports — treat that error class as benign; validate the artifact, not the exit status. (0539, 0540)
- Inline YAML action execution: yq `-o=json` with brackets + jq `===CMD===` delimiters + awk split; each action = own bash process with env exported. (0539)
- `task update <wbs> <status>` is positional; `--status` is unknown. Status hops todo→wip→testing are host-driven when subagents implement. (0539)
- Reviewer minor diagnostics that are polish, not defects, go to wrap notes — no fix cycle. (0540)

## 2026-08-15 — M5 batch 1 (0543, 0544)

- **Extend the union, do not fork it.** Role became the primary axis by relaxing `executor` to optional on the EXISTING member schema + one superRefine (R4), not by adding a parallel member type. A second member shape is how the tier prose drifted before.
- **One selector, never two (0543 R1).** The role → tier → cheapest-eligible funnel was extracted from `AgentService.resolveRole` into a shared `cheapestEligibleExecutors` — `--agent <role>` and team materialization now route through the same code. The task's own design demanded this; duplicating the sort in team-service would have created exactly the disagreeing-selector defect feature B2 exists to remove.
- **Derive local ids in ONE shared function.** `memberLocalId` (config core) is called by config-load validation AND materialization AND autostart derivation — config-load ids and materialized spec ids can never disagree. Indexed `<role>-<n>` by declaration order, frozen.
- **Unset is a value (0544 R4).** Undeclared role renders literal `unset` in human output and the Board badge, and is field-absent (undefined) in `--json` — never blank, never back-derived from the executor's tier. Tier inference over executor names is the exact failure feature B2's terrain notes record.
- **Zod 4.4.3 enum errors are terse.** Default enum error ("Invalid option: expected one of …") omits the received value; `z.enum(vals, { error: (issue) => new Error(...) })` gives a dynamic message naming value + accepted set while preserving the union type. Union parses nest variant errors in `error.message`, not top-level `issues` — assert on `error.message` in tests.
- **Inline-driver + worktree pitfall: agent.run stages must NOT dispatch native subagents when the batch runs in a worktree.** A native subagent shares the HOST tree, not the worktree — it would implement in the wrong checkout. The inline driver contract's eligibility condition 4 (subagent shares the working tree) fails; execute the stage in the host with every command pinned to the worktree cwd.
- **Biome forbids `!` (noNonNullAssertion).** Replace with an explicit undefined check (cheapest-eligible winner) or a cast in tests — never `biome-ignore` to force green.
- **Edit-tool hazard with structural-summary reads.** A ranged read can render elided bodies as `{ … }`; using that rendered text as an edit old_string corrupts the target block (mangled a describe header mid-task). Always verify edits that matched suspiciously against `git diff`/raw read before proceeding.

Captured to `.spur/run/wrapup-learnings.md` from task 0547 (run `dev-run-0547-3751c`; task list arrived empty, resolved to the run's task).

# Working learnings

## 2026-08-15 — 0547. Attribute token totals to roles by joining run attribution to the history plane

Verdict: PASS (R1–R5 MET, AC R7/R8 MET). 11 tests, 0 fail; `role-tokens.ts` 100% function / 93.83% line coverage.

### Conventions

- **Tokens, never prices** (operator ruling 2026-08-13). Per-model pricing changes faster than any table can track, so a stored price is a stored error. `costUsd` on `CostRecord`/`TokenTotals` is left untouched — neither extended, populated, nor read. New surface carries no currency field; a test asserts it by regex on serialized output (`/costUsd|cost_usd|price|\$|usd/i`) plus a key check.
- **Never-fabricate invariant.** Absent usage → `unmeasured: true` with the matched-run count, never zero tokens presented as observed fact. `recordsWithUsage > 0` gates bucket population. A role with no matched rows or no usage reads unmeasured; observed-zero (measured 0 tokens) is a distinct, separately-tested state.
- **Exact vs estimated never summed.** `exact` and `estimated` are separate buckets per role (R4); summing them discards the only trust signal the operator has. Mirrors `attributeActionCost`'s split.
- **Coverage is part of the answer.** Report `matchedRuns`/`totalRuns` per role; partial coverage is the expected condition (feature E1: `history_etl_*` dead for six sources), never silently compensated.
- **One extractor, one fold.** Reuse `extractClaudeTokens` / `foldTotals` semantics; a second implementation is how the two drift. Typed columns summed in SQL (`inputTokens` = fresh + cache-read + cache-write — never subtract cache).
- **Frozen-names table verified against the live tree before implementing.** Pinning `file:line` + semantics + "never call" list upfront is what made the premise correction possible.
- **T3 same-commit surface docs.** `docs/04_DESIGN.md` updated in the same commit.
- **Accepted ceilings are documented, not hidden.** Time-window narrowing absent and per-message attribution inside shared sessions are recorded in a `ponytail:` comment naming the upgrade path (per-message run stamps), matching the existing `attributeActionCost` ceiling.
- **Missing tables read as empty, never throw** — unmigrated DB and dead history plane are tested.
- **Null-role group included** (pure pins), mirroring 0546 parity; 0552 must render it distinctly.

### Errors fixed

- **Premise correction (blocked the task as specified):** the "reuse the `run-cost.ts` join" instruction was written from code shape, not from data. Measured against the live `.spur/spur.db`: all 10 `history_etl_*` tables hold 0 rows; `history_message.run_id` is NULL for all 1,296,633 rows (column and index exist, nothing populates them); real tokens live in typed columns on `history_message` (166,162 rows carry them). Resolution: 0557/0558 built the `history_run_session` run→session mapping; 0547 joins routing rows → mapping by indexed `run_id` → `history_message`.
- **P3 review fix — `matchedRuns` double-count (R5).** First fold summed per-exactness `matchedRuns`, so a run with mappings in both exactness classes counted twice in coverage. Fixed with a `matched_runs` CTE counting `DISTINCT run_id` per role across both classes; assignment, not accumulation, in the assembly loop. Regression test: "a run mapped in both exactness classes counts once in coverage".

### Patterns

- **Measure data before trusting code shape.** The premise-correction table (live row counts + consequence per premise) is the template for "is this join actually reusable?" — check data existence, not just API shape.
- **Two indexed SQL passes:** attributed runs (window-bounded routing rows), then folds grouped by `(role, exactness)` — avoids one wide join.
- **Deterministic output:** roles ordered `role ASC, nulls as ''`; window reported in the result rather than implied.
- **Executable evidence per AC row** — every behavior-bearing AC carries a named test; verify asserts "no currency field" via serialization regex + key check, not just type inspection.

### Gotchas

- Reusing code by shape ≠ reusing it by data path: `extractClaudeTokens` is the dead ETL-payload path, not the live typed-column path — know which one actually reads rows.
- `claude` and `codex` contribute 0 token rows despite being full-fidelity sources — bounds how much of the roster this feature can ever measure (E1 scope).
- Never reintroduce length-based token estimates (task 0474 R7 removed the 4-chars-per-token heuristic) — an estimate entering a total is the fabrication the forensic contract exists to end.
- Distinct-run counting in coverage: accumulate per-class then sum, and a run straddling exactness classes inflates the numerator — use `DISTINCT run_id`.
Appended to `.spur/run/wrapup-learnings.md` — `## 2026-08-15 — task 0552` entry after the 0542 block.

Source: task file `docs/tasks4/0552_render-role-routing-and-token-consumption-on-the-board.md` (done 2026-08-15). Nine learnings:

- **Conventions** — render-don't-re-derive (consume 0546/0547 as-is, route holds no query/window logic); extend-via-tab-registry not a peer module; permanent exclusions asserted by regex both sides, not just documented; T3 docs same commit; ADR-005 §4 type seam over scratch DB.
- **Patterns** — narrow the envelope once at the client boundary; `Promise.all` honest-failure composition matching sibling handlers; single `parseRoutingSummaryResponse`.
- **Errors/gotchas** — flattening unmeasured/estimated/no-data-yet into `0` is the core failure mode; trusting 0547's `unmeasured` boolean requires knowing its invariant (`exact === null && estimated === null` at `role-tokens.ts:166`); `toContain('4')` substring assertions cross-match digits (row-count is the real guard); review scoped to task diff, concurrent 0539/0540 edits excluded.

Format matches prior entries: dated header, title, bolded lesson + rationale, `file:line` evidence.

## 2026-08-15 — task 0561

Source: task file `docs/tasks4/0561_harden-verdict-ac-row-id-matching-so-embedded-gherkin-bodies.md` (done 2026-08-15). Learnings:

- **Conventions** — verdict artifacts are evidence, never rewritten at parse time: `extractAcceptanceCriteria` (`task-verdict.ts:200-207`) takes `cells[0]` verbatim; fix the matcher, not the parser, so every on-disk artifact is repaired without re-derivation. Fix the single choke point every caller routes through (`rowMatchesScenario`, `feature-check.ts:923`) — no new API, no exported symbol, no new file, no shared normalization helper for one call site. Anti-patterns written down in the task ("do not implement" list) and enforced during review.
- **Errors fixed** — verdict id preserved the full Gherkin body (`Scenario: R4 — … (Given … / Then …)`), exact normalized-title matching in the feature scenario gate (`isScenarioVerified`, `feature-check.ts:681-696`) flagged `L4.scenario-unverified` against a PASS/MET verdict, forcing post-hoc answer-file surgery (task 0558, E6 batch). Root cause was the matcher, not the parser: `normalizeTitle` (`packages/domain/src/bdd/coverage.ts:57-65`) absorbs prefix/case/quotes/whitespace but nothing trailing. Fixed additively: `bodyStripped = stripped.replace(/\s*\([\s\S]*\)\s*$/, '').trim()` as a third derived form beside `id`/`stripped` (`feature-check.ts:926-940`).
- **Patterns** — additive matching: four existing comparisons untouched, two added — never replace existing comparisons with the new form, or legitimately parenthesized titles regress (R2). Greedy `[\s\S]*` anchored from first `(` to string-final `)` strips a whole trailing parenthetical incl. nested pairs and line breaks; a conservative `[^(]*` leaves a dangling fragment (Q1 closed greedy). Backstop + guidance split: matcher is the backstop for broken artifacts, the style guide (`ac-style-guide.md` "id is exactly the scenario title") is the prevention half — guidance alone already failed once. Frozen design shape agreed pre-implementation; implementation matched it exactly.
- **Gotchas** — accepted ceiling (Q2): a title legitimately ending in `(...)` *and* carrying an appended body (`handles (a) and (b) cases (Given …)`) strips from the first `(`, no form matches → still unverified, same as before, not a regression. Greedy regex is O(n²)-worst-case on ids without a trailing `)` — negligible for short sentence ids. `feature_id` unset on purpose: E6 is done, linking a backlog issue under it would leave a done feature holding unfinished work. Doc drift: "six new tests" vs 8 added (5 e2e + 3 direct) — fix count on next touch. E6/0558 regression AC verified via verbatim-faithful *reconstructed* fixture (literal `.spur/run/0558-verdict.json` lived in deleted sibling worktree `spur-new-runall-e6-e91f`); byte-for-byte artifact test needs the run dir restored. Unpinned path: `bodyStripped === sc.alias` (e.g. `AC-1 (Given …)`) has no direct test — recommend a one-liner on next touch.

## 2026-08-15 — feature G5 batch (tasks 0565, 0566)

### 0565 — Headless --agent inline special error

- Frozen-message pattern: a stable greppable error text lives as ONE exported const
  (`AGENT_INLINE_HEADLESS_MESSAGE`) co-located with the resolution it guards
  (agent-service.ts), imported by CLI + workflow action. Tests assert the text verbatim,
  not by substring/pattern. This makes the contract greppable and single-sourced.
- Split-by-class error contract: `inline` on headless surfaces = exit 2 special message;
  invalid names keep the existing flag-boundary rejection (`Unknown agent:` naming valid
  values). Do not merge the classes into one error.
- Exit code 2 (usage class) reused for the inline rejection — no dedicated exit code.

### 0566 — Explicit-inline zero-dispatch contract

- The frozen `rg` sweep pattern (`inline.{0,40}(omit|agent\.default)|synonym for omit|exactly .inline`)
  is **pattern-invisible to `default: inline` cells** — 17 command files still defaulted
  `--agent` to `inline` post-sweep. Sweeps over inline≡omit equivalence must also grep
  `default[: ]+inline` (review found it; verify --fix all corrected it).
- Review PARTIAL → verify `--fix all` is the designed fix loop for doc-contract tasks:
  the review surfaces P2/P3 gaps, verify applies the fixes and re-verifies. No ad-hoc
  fix hop needed.
- next-router/SKILL.md documents dispatch routing rules that skill docs elsewhere assume
  inverted — when inverting a routing rule (inline no longer overrideable), grep the
  router docs, not just the command docs.

### Batch-wide

- Strict feature check (feature-derived runall preflight) aborts on
  `L4.uncovered-feature-scenario`: every feature scenario needs a covering task link.
  R5 (edge) was uncovered because its behavior lived inside 0565's scope but was never
  linked — link edge scenarios to the task that owns their regression guard.
- `spur task verdict` warns when REQUIREMENT rows (bare R1 ids) match no feature scenario,
  but the L4 gate credits the ACCEPTANCE rows — key AC rows by FULL scenario title
  (`Scenario: R2 — …`), then the warning is diagnostic-only.
- `project-start.test.ts:181` ("port polling times out") is a timing flake — passes
  standalone; do not attribute to unrelated diffs (0565's gate hit it once).
- Worktree inline runs: `.spur/context/.session.json` is absent in a fresh worktree →
  the driver allocates `host-session-<run-id>` and records the fallback in the run log.
- Recorded `## Testing` evidence anchors from verify answers must be project-root
  resolvable: abbreviating `plugins/sp/commands/dev-runall.md:84` to `dev-runall.md:84`
  produces L4.stale-line-anchor warnings.

## 2026-08-16 — task 0572

Source: task file `docs/tasks4/0572_move-role-tier-ssot-from-roles-md-into-packages-config-code-.md` (done 2026-08-16) + diff of the 16-file change map + ADR-061 (`docs/00_ADR.md:642`). Learnings:

- **Conventions** — SSOT placement follows dependency direction: the role→tier map is a CLI routing contract, so it lives in `packages/config` (`DEFAULT_AGENT_ROLES: ReadonlyMap<AgentRoleName, AgentRoleSpec>`, `index.ts:173`) beside the closed vocabulary `AGENT_ROLE_NAMES` — extend, don't duplicate; keep it a CF-safe literal so the config-load collision guard can prove the vocabulary. Plugin markdown the core regex-parses at runtime is implementation drift, not SSOT. Delete-don't-shim: code defaults were byte-identical to the last parsed values, so the `bundledRolesFile`/regex walk-up was deleted outright and no `@transition-shim` entry added (R4 pins this; a fallback could only reintroduce drift). Execution-order pattern: `options.agentRoles ?? resolveAgentRoles(options.agentConfig)` at the call site (`context.ts:113`) keeps explicit map injection for tests; merge happens at the CLI boundary, `AgentServiceContext.roles` type untouched — resolution never reads the field.
- **Errors fixed** — two inversions: (1) core role dispatch hard-failed with `Unknown declared role` when the plugin tree was missing/stale (resolution could fail silently); (2) the plugin test (`roles.test.ts`) owned the frozen regex shape of the CLI's runtime dependency. Fix: `agentRoles` is now always defined on `CliContext`, and R9 tests the plugin's *own* projection against the code SSOT. Zod 4 trap: `z.record(z.enum(…))` requires ALL enum keys present (exhaustive record semantics) — contradicts the optional-subset override; `z.partialRecord` swallows custom enum errors behind a generic "Invalid key in record". Fix: `z.record(z.string(), …)` + superRefine for closed-vocabulary rejection, message naming the accepted four (0543-R5-shaped). Test fallout enumerated up front in Q&A: `agent.test.ts:861` repointed from `bundledRolesFile`/`parseAgentRoles` to `resolveAgentRoles()`; `team.ts` consumes the map and is untouched.
- **Patterns** — parity gate with teeth: R9 reads the SSOT constant as *text* (regex over the Map literal) because plugin trees install into foreign repos and cannot resolve `@gobing-ai/spur-config` — the Design's "import the constant" citation was factually wrong for that tree, caught and recorded as a deviation (same discipline as the pre-existing `AGENT_ROLE_NAMES` parity test). The gate includes a mutation check (flip `tier: cheap` → `tier: standard` in a mutated copy; must drift or the assertion is vacuous) and a banner assertion (`DEFAULT_AGENT_ROLES`, `packages/config/src/index.ts`, "generated view" present). roles.md keeps an HTML-comment projection banner naming the code SSOT; the commands half stays plugin-owned (command frontmatter is its SSOT). Per-field merge override: `override?.tier ?? spec.tier`, absent role → default wholesale.
- **Gotchas** — parity only fires when `plugins/sp` tests run (they are in the standard suite/CI, so drift is caught, but not locally at config load). The plugin-internal `stage-registry-adapter.ts` stage floors still read roles.md — intentional (plugin owns its projection). The stale gitignored `apps/cli/config/` staging copy's comments now contradict ADR-061 — must be regenerated before publish; a standard build step, but easy to miss since the file is gitignored. R5 (byte-identical resolution) depended on leaving roles.md's fenced block byte-untouched by the diff — the projection's value is only meaningful against the frozen fixture. Implementation was left uncommitted in the working tree at done — 16 modified files, six of them docs (ADR/constitution/architecture/design/example config all named the old SSOT and needed same-commit sync); commit-per-task means the evidence only lands with the commit.

Captured to `.spur/run/wrapup-learnings.md` (appended after the 0561 entry, same format).

## 2026-08-16 — task 0569

Source: task file `docs/tasks4/0569_dev-history-load-degraded-source-tolerance-for-bare-runs-exi.md` (done 2026-08-16) + working-tree diff (4 source/doc files + task file, +169/−32 plus task evidence) + `0569-verdict.json` (PASS).

- **Conventions** — consume domain-owned exit-code semantics instead of re-deriving health: the script reads `computeExitCode`'s contract (`packages/app/src/services/history-service.ts:973` — `0` clean / `1` every source failed / `2` mixed-or-degraded) and splits on it, never on child-process prose; warnings derive from parsed import JSON only. Tolerance is behavior, not a mode: no opt-in flag on a frozen flag surface, and tolerance stayed narrow — only exit 2 is a *defined* degraded signal; exit 1 and any other non-zero keep the abort (analyzing after all-failed yields a confusing empty-window error). Tolerate-and-warn matches the house precedent (`history-refresh-service.ts` daily pipeline: degraded fan-out is non-fatal, reported per source, never an abort). Payload discipline: top-level `warnings: DegradedWarning[]` only when non-empty, so clean-run JSON stays byte-identical for existing consumers; the human warning is gated on `!args.json` to preserve the single-object stdout contract. Feature-scenario amendment lands in the same commit as the code (T3 surface rule analog); feature files have no `--section` verb — edit directly, then `spur feature check I5 --json` (exit 0, `pass: true`).
- **Errors fixed** — test title lied: the new abort test was titled `'exit 2 (all-failed) — analyze is never invoked, exit 1 propagates'` while its fixture ran `importExit: '1'` — assertions correct, title misdirected anyone grepping "exit 2" away from the tolerance describe block; fixed as a one-word edit under `--fix all` from review P3. Lesson: titles must name the actual fixture exit code. Silent-degradation edge (P4, noted not fixed): import exits 2 but emits unparseable stdout ⇒ `degraded = []` ⇒ no warning anywhere and the final fallback payload reports `import.exitCode: 0` while the child really exited 2 — reachable only with a binary that exits 2 without valid coverage JSON (real CLI never does); documented, no action.
- **Patterns** — stub-script test with branch-by-exit-code: the `writeStub` + `SPUR_BIN=/bin/sh` stub now branches import on exit code (1 → single failed entry; 2 → degraded fan-out with `agy` degraded parseErrors=203 + `pi` ok + a `source-degraded` warning; 0 → clean), so one stub serves all three branches. Behavioral assertions beyond exit code: analyze was never invoked is proven via the stub's calls log; JSON-mode stderr must be `''` (pins the single-object contract); clean-run payload asserted to have no `warnings` key. Verify ran a live probe on this machine's real exit-2 fan-out (`agy`, 104 parse errors) → analyze ran, exit 0, `warnings[0]` named agy with counts — real degraded data, not just stubs. One-language rule: the human stderr block reuses the CLI's own renderer wording (`history.ts:324` per-source status + error counts) so both output surfaces agree. `spur task check 0569` PASS carries two advisory DD-09 WARNs (R2/R3 titles don't text-match feature I5 scenario titles) — feature R9 pins the behavior under different wording and R3 is a doc-sync scenario that can't be a product AC; advisory, leave unless the title-match rule tightens.
- **Gotchas** — the whole task exists because re-auditing 0567 (done via `--force`) surfaced that fail-hard permanently blocks bare `--source all` runs on machines hosting a corrupt source — agy here has 203 parse errors in Antigravity's own log chunks, unfixable by this project (upstream corruption is the source's problem, explicitly a non-goal). Sequencing: operator first chose the documented `--source <name>` workaround and kept fail-hard; this task shipped only because that workaround proved noisy — the deferred-alternative pattern: record the decision, keep the task file as the fallback, ship when reality calls for it. Exit-2 handling must not silently warn-and-succeed in JSON mode — the `warnings` array is mandatory on the tolerated path when degradation exists. Field-name parity matters across surfaces: `parseErrors`/`validationErrors` must match `CoverageEntry`'s real emit (`history-service.ts:546`) or the JSON contract drifts; counts default to 0 when absent. Implementation left uncommitted in the working tree at done — 5 modified files (script, tests, command doc, feature file, task file), same wrap-after pattern as 0572.

## 2026-08-16 — task 0575

Source: task file `docs/tasks4/0575_authoring-time-task-size-warning-on-spur-task-create-update-.md` (done 2026-08-16, pipeline run `99A9FB3E` / session `mswlw0hh-2qe6hxc5`) + commit `e4dc09eb` (4 files, +130/−9) + `0575-verdict.json` (PASS, 2 req + 6 AC MET).

- **Conventions** — ride existing channels, add no surface: the warning folds `report.reasons` into the mutation result's existing `warnings?: string[]` (`task-service.ts:191`), so `apps/cli` needed **zero change** — the CLI already renders warnings to stderr in human mode (`task.ts:315-317`) and inside the payload under `--json` (`:313`). Spread `[...(result.warnings ?? []), ...reasons]` mirrors the `checkAcSubsetWarning` fold (`task-service.ts:1138-1145`) so warning sources compose, never overwrite. Thresholds stay single-owned: call `evaluateTaskSize(content)` with **one argument** (omit `limits` → `DEFAULT_TASK_SIZE_LIMITS`, max 5 R / max 8 Plan; omit `executor` → size-vs-capability tier branch stays dormant), parity pinned by `plugins/sp/tests/task-size-precheck.test.ts:76`. Advisory by construction: the section write lands first, evaluation reads the whole post-write body (a Plan write must still see the file's R-items), exit code unchanged, `ok === true` returns the result untouched (no empty-array churn). Trigger sections only — `Requirements`/`Plan`; Background/Design/Solution/Testing/Review writes stay evaluation-free. ADR-051: an observable output change on an existing verb needs recorded operator consent even when the code diff is confined to `packages/app` — small diff ≠ exemption (task Q13); approval recorded in the task Background before code began.
- **Errors fixed** — no runtime code errors surfaced (implement + review + verify all first-pass clean); the corrections happened *before* implementation, during refine: Q11 dropped `spur task create` as a trigger — the standard template seeds placeholder Requirements, so a fresh create has 0 R-items and the warning can never fire; wiring it is dead code (premise-verification rule at `--depth ready`). Q12 overturned the original "thin wiring in `apps/cli`" design — reading `task-service.ts` showed `warnings[]` already exists and both render modes flow through it, so a CLI stderr write would have forked the channel and silently skipped `--json` consumers. The seed was parent 0568 failing its own size gate (6 R-items vs `maxReqs: 5` at precheck); splitting R1 out cleared 0568 to exactly 5 — the warning exists so oversize surfaces at creation, not after a run + round-trip.
- **Patterns** — unit tests: `sizeWarnings()` filter helper asserts only the size-related subset of `warnings[]`, so tests compose with unrelated warnings instead of asserting the whole array; non-blocking proven at unit level by asserting the write landed on disk (`**R6.**` present) *and* the warning fired; whole-body precedence pinned by writing 6 R-items then a small Plan — asserts the R-item warning fires from the file body and no Plan-item warning for the small Plan. E2E probes against the **rebuilt real CLI** (`./apps/cli/spur.js`) in an isolated `--folder` scratch corpus (`/tmp/0575v`): human mode → stderr carries the reason; `--json` → `jq -e` validates stdout and `warnings[]` holds the identical string; exit 0 in both modes. Suite-triaging: 3 full-suite failures were **stash-verified pre-existing at clean HEAD** (corpus-check git-replay 5s bun timeout — 29/29 green at `--timeout 30000`; rule.test.ts stop-on-first flake passes isolated) before attribution; targeted first (`bun test packages/app/tests/services --test-name-pattern 'size|warning'`), then lint + parity test + `spur task check`.
- **Gotchas** — the entry condition for a parked consent-gated task is the *recorded* decision, not a resume formality: approval came via the consent ask surfaced at the start of `/sp-dev-run 0575 --auto --next`. `spur task check 0575` PASS carries 3 pre-accepted L4 advisories: `missing-feature-id` deferred with owner (matches parent 0568; harness self-improvement has no home feature), `gate-language` accepted — the gate is a **human consent decision**, not an upstream task dependency, and the wording must stay visible (it is the whole reason the task was parked). Emit `report.reasons` verbatim — identical wording at authoring and precheck time is the point; never compose new message text or duplicate `5`/`8`. Cost: one extra file read + pure evaluation per Requirements/Plan write only, mirrors the `checkAcSubsetWarning` precedent. T3 doc row landed at `docs/04_DESIGN.md:1330` in the same commit; doc-evolve follow-up `cf664a30` (ADR-051 amendment + 04 frontmatter bump) came in a separate commit.

Captured to `.spur/run/wrapup-learnings.md` (appended after the 0569 entry, same format).

## 2026-08-17 — E5 batch (0576, 0577)

- **0576**: pi watermark trip was upstream mapper symptom, not watermark bug — Spur-side fail-open guard added; root cause split to 0577. Lesson: when a guard fires on one source only, diff that source's mapper against its sibling (piSplit vs ompSplit) before touching the guard.
- **0577**: ts-libs release is LOCKSTEP — per-package tags do NOT trigger Publish; only aggregate `@gobing-ai/ts-libs-v*` does. Correct flow: `bun run drop-tags <v> --remote` → `bun run bump-ver <v> --push`. Per-package tag attempt silently publishes nothing.
- **0577**: spur-new deps: root `package.json` `workspaces.catalog` is the SSOT for `catalog:` refs; a `bun update <pkg>` alone re-resolves to the stale catalog pin (installed 0.4.33 while 0.4.36 was on npm). Bump the catalog entry + exact root pin, then `bun install`.
- **0577**: `task update <wbs> done` provenance gate needs a `task_run_links` row — `spur task run-link <wbs> --run-id <batch-run> --source dev-runall` records it without SPUR_PROVENANCE_OVERRIDE.
- **0577**: epoch-ms timestamps: verify expected ISO strings by computation, not intuition (test expected wrong date; mapper was right).

## 2026-08-17 — E5 batch (0578, 0580, 0579, 0581)

- **0578**: importer release is a two-surface atomic: bump catalog pins (`workspaces.catalog`) AND the ts-libs dep versions in the same commit, then `bun install` — a catalog-only bump leaves `bun update` resolving stale.
- **0578**: `history import` provenance header (`binary:` + resolved importer version) is the ground truth for which code ran — record it in the transcript before dry-run/write validation; a rebuilt CLI silently loses to a stale global `spur` on PATH.
- **0580**: role mapper classification is per-source: codex lifecycle records → `meta`, `developer` → `user`; verify per-source `distinct role` counts after a mapper change, not just totals.
- **0579**: a guard/metric change that touches an interface shape must update test fixtures in the SAME commit — 0579 added `spanExcludedSessions` to `TimeDecomposition` and left `derived.test.ts`/`render-forensics.test.ts`/`report-modes.test.ts` typecheck-broken on HEAD until 0581's gate run caught it. Pre-existing `noUncheckedIndexedAccess` failures (`spans[0]`) need the tuple-cast destructure (`as [SessionSpanRow]`), since Biome bans `!`.
- **0581**: additive artifact fields are the right extension vector — no schemaVersion bump for `topStepsByTokens`/`cacheWaste`/`stepSupport`; consumers treat absence as unknown, never fabricate.
- **0581**: the R2 structural scanner matches SQL by backtick-span, so a shared `STEP_SELECT` const (single-quoted!) still trips it when its `FROM history_message` text lands inside a span — inline projections per query, matching file convention.
- **0581**: raw (non-watermarked) sqlite reproduces the AC4 baseline exactly (2,478 / 354,130,045); the analyze path applies watermark exclusion (task 0550) so rendered numbers drift — record which plane a baseline was measured on.
- **0581**: edit-tool hazard repeated: `PUT N.=N` replaces, not inserts; and a replaced block leaves stale shifted lines below that must be CUT. Re-read the region after every batch edit.
Captured to `.spur/run/wrapup-learnings.md` (appended after the 0575 entry, same format).

Extracted working learnings from task **0587** grouped by date/WBS:

**Conventions**

- Refuse a harmful action at the earliest spine state that can observe it (`cmdPreflight`, pre-push) — preflight FAIL routes straight to `failed` before `push` fires; keep the later guard as defense-in-depth.
- Guard on the resolved base (`--base` override, else default) via one shared `resolveUpstream()` that feeds both refusal message and divergence output — two outputs can never disagree.
- Drive product changes through existing script surfaces: retarget `package.json`'s `check` (what CI runs) instead of touching the CRITICAL `.github/workflows/` path; drop not defer now-unneeded approval gates.

**Errors fixed**

- R3 as first written ("targeted intermediate rechecks, full gate on final") was unimplementable — `test-recheck` is one state whose `→ review` fires on `PASS`. Restructured as **probe-then-full**: only the full gate writes `PASS`, so the invariant holds by construction.
- Flipping coverage off red-gated the repo: `test-post-check`'s preset `extends: [quality]` pulls in `coverage-gate` reading `.coverage/lcov.info`. Fixed by filtering the fast script to `--rule every-export-has-tsdoc`.
- R5 split to 0588 — open-ended measurement blocked `done`, pinned the 5-R-item cap.

**Patterns**

- Non-fatal `run()` never `runOk()` for a normal-state condition; `0` fallback on non-numeric `rev-list --count`.
- When a git-stub fixture has a `*) exit 1` default, every new git call needs a stub case + fixture seed or the suite fails.
- Don't add a new engine action (`file.read.into-var`) — engine drops non-final `setVars` (0571); read in-shell instead.
- Prefer an under-inclusive probe (safe by construction — only falls through to existing behavior).

**Gotchas**

- Installed `~/.agents/scripts/sp/pr-reviewing.ts` ≠ in-repo source: `superskill install sp` rewrites the namespace prefix. Fix in-repo (SSOT); re-run install to deploy.
- Exact branch-name match is the contract; detached HEAD fails earlier in `preflightContext`.
- Re-derive line refs against the live tree — the original draft's `task-pipeline.yaml` refs were ~150 lines stale.
- Left recorded back-notes: `preflight` HELP text omits the new hard-fail (deferred); R3 shell has no automated test (AC6 smoke covers it).

## Feature A3 batch (2026-08-21) — working learnings

- **Promoting an internal spur-dev command to a public noun (0617):** the promoted code must pass the boundary rule gates that `scripts/` never saw — route output through the `CommandOutput` seam (no `console.*`), process spawn through `NodeProcessExecutor` (no `Bun.spawnSync`), and get a `runtime-boundaries` fs-io exemption for sync manifest reads (mirrors `task.ts`). A helper module that is not a command module must NOT live in `apps/cli/src/commands/` — the `cli-surface-parity`/`consistency` noun scan treats every file there as a noun (`release-ops.ts` had to move to `src/` root).
- **New CLI verbs must be documented in the `sp:spur-cli` facade + AGENTS.md + `04_DESIGN.md` noun tables simultaneously** — the `cli-surface-parity` and `consistency` tests fail otherwise (hyphenated verbs like `bump-ver` previously weren't parsed by the consistency regex; fixed to `[\w-]+`).
- **Task-corpus line anchors shift when you edit a heavily-cited source file.** Every doc/TSDoc edit to `task-check.ts`/`feature-check.ts`/`markdown-document.ts` shifted `file:line` citations in many task files; the two-sided `corpus-check` surfaced them as `L4.anchor-subject-mismatch` NEW findings — repoint via `spur task update --section` in the same commit.
- **New structural finding codes fire on pre-existing corpus debt.** Adding `L2.heading-level`/`L2.section-order`/`L3.requirements-checkbox` flagged ~315 legacy files (non-checkbox R-items, `##`-level sections). Baseline them with a real reason ("pre-existing structural debt — repair with `--fix`"); the two-sided baseline means they go STALE and get pruned once `--fix` clears them.
- **Canonical section order is template authority.** `TASK_CANONICAL_SECTIONS` had `Solution` before `Root Cause`, but the `issue` template (and every issue task) puts `Root Cause` first — the section-order check fired on ~200 tasks. Fix the domain order, not the corpus.
- **`task record` clobbers hand-written Testing/Solution with an auto-generated verdict UNKNOWN + change-map** when run before the verdict artifact exists — write `.spur/run/<wbs>-verdict.json` first, then restore the sections.
- **Change-map table rows in Solution** must be one `file:line` per row — a ·-joined paragraph makes each anchor's "subject" the other anchors and trips `L4.anchor-subject-mismatch`; paths with `_` (`cmd_*.md`) can never match their cited line and must be dropped from the table.
- **`--fix`-style structural repair engines** are best implemented as pure string transforms (frontmatter split + code-fence-aware heading scan) so the byte-identical no-op property is free.
- **`spur workflow show`** renders the *resolved* definition, not the YAML text; both engine kinds (state-machine + transition-flow) discriminated on `kind`; mermaid ids need escaping; empty edge labels should be omitted (`A --> B`).

Doc drift repaired in constitutional order: append-only ADR-050/051 amendments, architecture sync, detail-first satellite updates, then the `04` index/surface projection.

Files: [00_ADR.md](/Users/robin/xprojects/spur-new/docs/00_ADR.md:439), [03_ARCHITECTURE.md](/Users/robin/xprojects/spur-new/docs/03_ARCHITECTURE.md:531), [04_DESIGN.md](/Users/robin/xprojects/spur-new/docs/04_DESIGN.md:40), [lifecycle-projection-integrity.md](/Users/robin/xprojects/spur-new/docs/design/lifecycle-projection-integrity.md:1).

Verification: 354 targeted tests passed; typecheck passed; diff/frontmatter/index checks passed; live CLI help matches. Full lint is blocked by 148 unrelated errors in the concurrent 0626–0629 prototype files. No task/feature corpus writes or git-index operations were performed.

## 2026-08-21

### Task 0625

#### Conventions

- Converge authoritative lifecycle state and derived projections at the application-service seam: an applied `syncFeature` hop refreshes the same feature’s `## Tasks` region.
- Require explicit write breadth for public commands: `spur feature refresh --feature <id>` is scoped, `--all` opts into the broad sweep, and the bare form exits 2.
- Keep the per-task gate fast. Run the corpus-aware `spur-check-new` once after an applied feature transition instead of adding the corpus sweep to every task loop.
- Reconcile every new or widened finding against `config/corpus-baseline.json` by key and severity in the implementing change; warning-first is appropriate when historical migration is intentionally deferred.

#### Errors fixed

- Feature transitions could arm feature-level findings while running only the corpus-blind fast gate; wrap-up now observes the corpus-aware gate after an applied sync.
- Feature status and its generated task roster were maintained by separate verbs; applied sync now refreshes the touched roster automatically.
- A record-generated hollow Testing table could survive in a done task; `L4.testing-verdict-stub` now reports it.
- Prose-free Solution change-map rows produced no subject tokens, allowing drifted anchors to pass; subject tokens now fall back to the cited path basename.
- Dogfood evidence used raw substring matching, allowing incidental feature-ID matches; filenames now require a delimited ID segment.
- Bare `feature refresh` silently rewrote unrelated feature rosters; broad mutation now requires `--all`.

#### Patterns

- Presence is not proof. Validate projected content and identity, not merely that a section, anchor, or filename exists.
- Fix recurring caller drift by deepening the owning service invariant, not by teaching every pipeline caller to invoke a second repair verb.
- A broad default that mutates many corpus files should carry an explicit breadth token.
- Documentation must be transcribed from live code and tests. Task prose is evidence, not authority, when it contradicts implementation.

#### Gotchas

- The wrap-up corpus gate is observational, not enforcing: it prints PASS/FAIL but exits 0. It prevents silent red state; it does not block completion automatically.
- Post-sync roster convergence occurs only when `appliedHops.length > 0`. A no-op sync does not repair an independently stale roster; use scoped `feature refresh`.
- Passing both `--feature` and `--all` is not rejected by the current CLI; `--feature` determines service scope. Do not document mutual exclusivity until it is enforced.
- Path fallback includes a plain basename token: `workflow.ts` becomes `workflow`. The task’s Solution prose claiming whole basenames are excluded is stale.
- Keep YAML comments outside folded `>-` shell strings; folding can place `#` on the same logical line as the next statement and comment it out.
- `featureGateCmd` executes through `sh -c`; treat it as trusted operator/project configuration and never interpolate untrusted input.

## 2026-08-24 — F84 batch 0643/0644/0645 (Features board UI refactor)

- **`spur task verdict --from-answer` regenerates the verdict JSON from the answer file** — manual `jq` edits to the artifact are clobbered. Key rows AC-N (F84 scenario aliases) *in the answer file itself* or the L4 feature gate reports `L4.scenario-unverified`; a bare R-id row is cosmetic-pass but credits no scenario.
- **`spur task update --section X --from-file` replaces the WHOLE section** with the file content — never pass the full task file (it re-embeds the frontmatter/whole doc into the section and can eat the `#### Out of scope` sub-block). Extract the exact section span before applying.
- **Done-gate `L3.review-priority-table`** wants a P1–P4 table with at least one substantive non-placeholder row; bare `| P1 | — | — | — |` scaffold fails.
- **Solution section anchors must name the requirement's subject.** The L4 anchor gate parses the cited line and rejects anchors whose content lacks the requirement tokens (e.g. the glass-bar class string) — point the anchor at the exact implementing line, not the file head; test-helper rows must cite the helper's own line.
- **Reviewer-agent model quota (zai-cn/glm-5.3) is a real failure mode** — 429 weekly/monthly limit. Fall back to inline review/verify in the host session; the pipeline's proof artifacts (answer file, verdict, sections) carry the evidence either way.
- **`spur task record --transition testing` and `--as done` run the shell guard** — L4 Solution anchor + Requirements checkbox-marker checks are real gates, not decoration; fix sections, then re-record (idempotent-ish: `Testing written, 0643 → testing` style lines).
- **feature-sync-bounded hops chain** (backlog→active→verifying→done) once all linked tasks are terminal and verdict rows match scenarios — the batch-once wrap transition is automatic.

## Learnings — 2026-08-25 (batch F72: 0663 shell, 0664 cards)

- 0663 (Tasks shell): Solution change-map anchors go stale easily — re-derive `file:line` AFTER every source edit (doc-comment moves shift lines), and cite lines whose content literally contains the row's backticked symbol (L4 subject-mismatch is a hard error; missing-file is a warning).
- Verdict artifacts must key requirement rows by the FEATURE scenario titles (`R1 — <title>`), not task-local requirement numbers — `normalizeTitle` strips the `R\d+` prefix so only full titles match `L4.scenario-unverified` coverage (feature-check `isScenarioVerified`).
- `--agent inline` + a task > 5 R-items: the size-precheck R3 capability gate blocks on tier `standard` even after raising caps — under inline there is no subprocess executor, so run the size precheck without `--executor` (faithful to inline) and raise `maxImplementReqs`.
- Lifecycle guards re-run `spur task check` at `testing`; the A3 dogfood ordering — verdict artifact BEFORE `task record` — is load-bearing, and `record` backfills Testing from the verdict (PASS rows), not hand-authored prose.
- pi-lens hooks can autofix the MAIN tree during a worktree batch (wrong-tree hazard); verify paths via `git status` in both trees before WT-4 merge. Don't `pkill -f` broad patterns inside a batch (killed the operator's `spur serve` instances; restart with exact `--cwd/--port/--no-open` args).
- 0664 (cards): the `.task-kanban` timestamp baseline is already `spur-text-muted`, so the staleness "tint" lands as the dimmer `spur-text-faint` step of the same token ladder — never change the R5-protected baseline.

## F93 learnings (2026-08-25)

- **F93/0671** — Testing-section coverage parser (`parseTesting`) + canonical `VerifyVerdict` convergence. Key: renderTesting now takes the canonical type so `parseTesting(renderTesting(v))` is type-exact in canonical status space; legacy `parseVerdict`/`readVerdict` converge to canonical with a lenient `normalizeRowStatus` that preserves unrecognised statuses as-read (never defaulted).
- **F93/0672** — completion-gate fallback: when `<wbs>-verdict.json` is absent, feature-check derives coverage from the tracked `## Testing` section via `parseTesting`; artifact stays authoritative; `L4.evidence-not-recoverable` named state for evidence that predates durable recording.
- **Anchor lesson (0671/0672)**: L4 anchor-subject-mismatch fires when Solution/Testing citations point at stale line numbers or carry multiple citations per cell. Fix: compute `file:line` fresh at write time, one citation per row, backtick the exact symbol (underscore form for `L4_EVIDENCE_NOT_RECOVERABLE`).
- **Section-update gotcha**: `spur task update --section Requirements --from-file <(awk ...)` with a wrong header regex wipes the section. Use the exact header (`### Requirements`, not `## Requirements`).

# Wrap-up learnings — feature D7 (tasks 0695, 0696)

## 2026-08-27/28 — task 0695 (kind-aware workflow todo renderer, `spur workflow show --format/--json`)

- **Premise verification reshaped the design before implementation.** Refine-time checks against the tree found all 11 `config/workflows/` definitions are `kind: state-machine` (zero transition-flow), so topological ordering was dropped outright and feature scenario R2 was retitled before any task referenced it. Verify design premises mechanically against the tree during refine — a Kahn sort written for a kind nothing uses is speculative generality with a failure mode (cycle handling) nobody needs.
- **Bidirectional doc gates dictate task scope.** `plugins/sp/tests/cli-surface-parity.test.ts` compares `spur-cli/references/workflows.md` bidirectionally against live `workflow show --help`, so the reference row edit had to move from 0696 into 0695 — otherwise 0695 could not go green on its own, violating commit-per-task. When a gate compares a doc against code in both directions, the doc edit belongs to the task that changes the surface, not to a follow-on task.
- **Freeze the cross-task contract in the producer's Design.** 0695 froze the command string (`spur workflow show <file> --format todo --json`), the JSON envelope, and the `WorkflowStep` field names, and 0696 treats them as read-only input ("if they changed, re-read the producer's Design, don't invent a reconciliation"). Naming things after both tasks exist is how two docs drift.
- **Byte-identity is provable, not assertable.** R1 (default output unchanged) was verified by stashing HEAD, capturing the pre-change `show` output (2936 bytes), and diffing — empty. A renderer rewrite built on a shared `buildWorkflowSteps` kept `renderRunPlan`'s `plan: a → b → c` string identical because the builder preserves declaration order.
- **Marker semantics frozen as an algorithm, not prose.** `loopBack` = some incoming edge whose source declares at-or-after the target (self-loops included); `conditional` = at least one incoming edge and every one guarded, never on the initial step. Freezing these in Design made the CLI test, the unit test, and the doc description agree without negotiation.
- **Error parity by construction.** Unknown `--format` fails fast before file resolution (exit 1, stderr names both values); not-found and schema-invalid branches are shared by all formats, so "identical message for every format" is structural, not a per-format promise.
- **Rejected shapes are part of the record.** The D7 idea gate rejected a boolean `--todo` flag, a separate `todo` verb (flag-not-action: it would duplicate `resolveWorkflowDef`/error branches for an encoding change only), and output caching (single-digit-ms parse, pure render). Recording rejections at the gate stops them being re-proposed later.
- `renderWorkflowMermaid` stayed in `apps/cli` — the single-builder rule was scoped to the plan/todo step sequence only; forcing the diagram renderer through the builder would couple two output models for no benefit.

## 2026-08-28 — task 0696 (route inline pipeline driver to the todo projection)

- **A descriptive procedure in a reference doc is a renderer doing LLM work.** The inline driver's step 4 made the model read `task-pipeline.yaml` and *infer* state order/terminality/pause every run; `--format todo --json` turns inference into read operations. Look for instructions that make the model derive what a deterministic tool can emit.
- **Narrow the win; don't overclaim it.** Layer 2 (the active state's `onEnter` actions) stays on the step-1 YAML parse because `steps[]` carries ids and markers, not action bodies — the driver stops *deriving* the state list, not reading the file. The reference explicitly must not claim otherwise.
- **`conditional` is not a prediction.** With no `--vars`, the marker means "entered only through guarded transitions", never "will be skipped" — consumer docs must not reinterpret markers as execution forecasts.
- **A sweep's empty/out-of-scope result still gets recorded.** R3's `rg` sweep over `plugins/sp/**` for other hand-derivation instructions found five residual hits, each classified (authoring-order guidance, layer-2 interpreter, team-spec naming, a return-type argument) and recorded in `### Solution` — an unrecorded sweep is indistinguishable from a skipped one.
- **Verify untouched means untouched.** The rewrite was checked by diff: only the Layer 1 and Source-of-truth bullets changed; steps 1–3, 5, and the refresh cadence stayed byte-identical.
- **Don't restate the producer's contract in the consumer.** The rewritten reference names the command and field names and points at the CLI; repeating marker semantics or ordering rules in a second doc is the drift this task removes.

## 2026-08-27 — doc-sync stage (this wrap-up)

- **ADR-051 consent records live in `00`, not only in the derived consent table.** Tasks 0625 and 0683 each added a dated `Amendment` under ADR-051; 0695 recorded its consent only in `docs/design/harness-surface-governance.md` §4. Repair order (constitution §7) puts the authoritative doc first: the amendment was appended here, citing the satellite.
- **§4.5 rule 5 reaches landing tasks, not just wrap-ups.** The satellite's consent table gained the 0695 row but the `04` §0 index row still said "current through 0625" — detail-first, then index, same change-set, applies to whoever edits the satellite.
- **Behavior-identical refactors don't open `03`.** `03_ARCHITECTURE.md` had zero findings: no module boundary, data flow, or invariant changed, so §6.4 rule 4 (mechanism replacement) doesn't trigger even though `renderRunPlan` was rebuilt on a shared builder. Zero-finding audits still list the checks that returned zero.

<think>OK. So ADR-083 (lines around 1370-1450) describes the matcher behavior pre-0714. It says:
> "The matcher (`citedLinesNameSubject`, `extractSubjectTokens`, the cited-window slice in `checkLineAnchors`) stays byte-for-byte unchanged"

But task 0714 R1 *did* change `checkLineAnchors` (and `extractPathSubjectTokens` was deleted).

This is a potential drift issue but it's complicated. The ADR-083 was about NOT changing the matcher as part of the baseline reconciliation. Task 0714 changed it via F91 ownership ("Feature F91 owns the matcher"). So this isn't really drift — it's an ADR amendment situation.

Looking at this more carefully, this is actually a T1 trigger — task 0714 made changes to the matcher mechanism that should have an ADR entry. But task 0714's R4 says:
> Set task 0714's AC altitude to `task-local`, update the task-check surface documentation for R1, and leave the F95/F91 shipped contracts intact: no new finding code, CLI noun, verb, flag, or severity change.

So this is a NARROWING of the matcher, not a new finding code or severity change. Task 0714 itself says it does NOT make a new decision — it just narrows the matcher's heuristic without changing its public contract.

But wait, the constitution's ADR rule says (§6.1 rule 6):
> Before any code that contradicts an ADR: the superseding entry lands first (§5 row 2).

Task 0714 didn't contradict ADR-083 — ADR-083 said the matcher stays unchanged *in that specific reconciliation campaign*. Task 0714 is doing a different campaign (post-F95 reconciliation), and F91 owns the matcher.

Actually, looking more carefully at ADR-083, it says "F91 owns the matcher". F91 is "done". So technically task 0714 is doing follow-up work to F91, not contradicting ADR-083.

But there might be a case for an ADR amendment. Let me look at the §3 of 03_ARCHITECTURE.md to see if there's drift there too.

Actually let me also check if docs/03_ARCHITECTURE.md has any stale references to checkLineAnchors or anchor subject matching.]<]minimax[>[<tool_call>
]<]minimax[>[<invoke name="read">]<]minimax[>[<path>/Users/robin/xprojects/spur-new/docs/03_ARCHITECTURE.md]<]minimax[>[</path>]<]minimax[>[<offset>570]<]minimax[>[</offset>]<]minimax[>[<limit>80]<]minimax[>[</limit>]<]minimax[>[</invoke>
]<]minimax[>[</tool_call>

## 2026-08-29

### 0716 — Database single-flight for history refresh producers

- Unique-index migration pattern (0027_spur_cli_history_refresh_active_unique): when tightening a coalescing index, drop the old pending-only index, deterministically retire superseded duplicates FIRST (keep oldest survivor by created_at ASC, id ASC; demote the rest to status='failed' with audit last_error, processing_at=NULL), then create the replacement covering status IN ('pending','processing'). The migration must never depend on ambient row order.
- Fresh-DB vs migrated-DB duality: the base schema already carries the new index, so the migration runner journals 0027 but skips execution when queue_jobs doesn't exist yet (runner skip guard); keep the drizzle/ SQL mirror in lockstep.
- enqueueCoalesced gained a third outcome: a processing row found (pre-scan or claimed between read and update) returns {status:'already-running', jobId, payload}; a bounded 3-attempt loop throws loudly on exhaustion (enqueueCoalesced: <type> stayed active past 3 attempts) instead of returning a fake outcome. Merge semantics: earliest windowStart, latest windowEnd, full dominates incremental; an immediate join only shortens due time (min(existing, now)), never delays an earlier due.
- Closed outcome vocabulary surfaced end-to-end: enqueueHistoryRefresh union disabled|enqueued|coalesced|already-running (manual trigger ungated + immediate; schedule gated on history.refresh.schedule_minutes); Board contracts narrowed to a strict answer grammar z.enum(['queued','coalesced','already-running']) — enum verdicts at the API boundary beat stringly outcomes.
- Emit-side observability: maybeTriggerHistoryRefresh emits history.refresh.enqueued with source/renderer/trigger/triggerId/jobId/coalesced/outcome/windowStart/windowEnd/severity, best-effort only (stderr warning; never changes the CLI exit code).

### 0717 — Isolated child-process execution for queued refreshes

- Parent→child env-contract design: SPUR_HISTORY_REFRESH_CONTEXT carries the serialized, validated payload; parseHistoryRefreshContext returns null when the env is absent (interactive history daily unchanged) and throws on malformed JSON/shape → CLI exits 1 BEFORE EventBus/ledger/import creation, so a bad contract can never emit partial history.*rows. The child owns all history.* emission; the parent server emits none (no duplicate events).
- Strict payload gate: the queue handler unwraps ONLY job.payload via validateHistoryRefreshPayload; a whole queue envelope arriving as payload fails the attempt — kills the envelope-drift bug class. Validation runs before any spawn.
- DI seam for spawnability: HistoryRefreshJobDeps {cwd, invocation, executor} — the child opens its own DB/agentConfig from cwd (shared WAL DB + 5s busy timeout preserved, contention behaviorally tested); executor injection keeps ProcessExecutor mockable.
- PATH-independent re-invocation: resolveSpurBin() returns "<execPath> <mainModule>" at serve bootstrap and flows into startServer as optional spurInvocation (omission degrades to a run-time split failure, keeping existing callsites compiling); splitLaunchCommand splits argv only — no shell string evaluation (accepted ceiling: a space inside a single token's path; argv-only is the injection-safety win).
- Child command: "<leading args> history daily --json --json-envelope", awaited via executor.run in the project root; output bounded at HISTORY_REFRESH_MAX_OUTPUT = 1 MB; spawn failure / non-zero exit / invalid JSON / wrong {ok:true,data} shape all throw and map onto the existing queue retry state — retry/failure ownership stays with the queue consumer; the handler never converts failure to success.

### wrap-hop doc-audit notes

- docs/design/event-tracking.md emitter path:line refs are approximate audit-baseline refs (row 36 cites :47, actual emit :41 since 2026-08-14) — do not "fix" them during feature drift passes unless the batch actually moved the code.
- ADR built-status convention: flip "Accepted (design)" → "Accepted" via an in-place Status edit plus a dated > **Amendment (date).** Built: block naming the tasks (ADR-056 precedent; constitution §6.1 rules 3/5/8); never rewrite the decision body.

Done. Summary:

**Doc-evolve wrapup (task 0720) — drift audit + repair**

- Ran a §7 drift audit scoped to 0720's change (a plugin skill-reference + contract-test change; no public CLI surface). Only one verifiable factual drift in the scoped set: `execution-batch.md` line count in `docs/design/dev-spine-cost-and-drift.md` (claimed 799, actually 956).
- **Repaired:** `docs/design/dev-spine-cost-and-drift.md:66,69` — refreshed the spine-routing counts (execution-batch 799→956, execution-workflow 361→368, inline-pipeline-driver 130→172, subtotal ~1,645→~1,851) plus a dated correction note flagging the rest as a 2026-08-15 snapshot.
- **Zero drift:** `docs/00_ADR.md` (no decision reversed — R2d no-replay is consistent with ADR-026/048, no public API change), `docs/03_ARCHITECTURE.md` (0720 touches no described mechanism; corpus-check claims reflect the untouched command), `docs/04_DESIGN.md` (no new surface; §7.8 pointer to execution-batch.md still accurate), and `run-record-contract.md` (0720's new artifact family postdates the 0598 analysis; no contradiction — noted, not edited).
- No task/feature corpus touched; satellites carry no frontmatter so no §4.3 bump applied.

**Artifact:** `/Users/robin/xprojects/spur-new/.spur/run/wrapup-learnings.md` written (learnings from 0720, grouped by date + WBS).

---

# Wrap-up Learnings — task 0720

## 2026-08-30 · WBS 0720 — Fix E31 integration friction (orphaned serve daemons, corpus gate cost, R2d verdict disposition)

### Conventions (what to keep doing)

- **Evidence persistence precedes destructive cleanup.** A worktree batch persists its report and per-task verdict JSONs to the invoking tree (`.spur/run/worktree-<marker-id>-batch-report.md`, `.spur/run/worktree-<marker-id>-verdicts/<wbs>-verdict.json`) before any worktree removal — so a green batch can never destroy its own evidence.
- **Single ownership of lifecycle state.** Committed task files own lifecycle status; persisted invoking-tree artifacts own batch/verdict evidence. No post-merge `task update`/`task record` replay, no `task_run_links` import, no timestamp-only corpus churn.
- **Reuse the existing identity scheme.** Marker-id namespacing (`worktree-<marker-id>-*`) gives collision-free artifact identity — no new public flag or DTO needed for a new artifact family.
- **Reuse mode still persists the Step 5 report** even though it keeps its operator-owned tree.
- **Verify-only is a legitimate task outcome** when a guardrail already exists (R2: `bun run corpus-check` already the corpus-only fast path; zero-diff on `package.json`/`AGENTS.md` was the pass condition).
- **Fail-closed over fail-open:** a surviving holder routes to WT-5 with worktree + branch retained, halts, and reports PID (mandatory) + listening port (best-effort) before any prune/remove/branch delete.

### Errors fixed (root causes)

- **Orphaned daemons defeat worktree removal (R1):** serve proof daemons (PPID 1, ports 3000/3005) held the removed worktree as CWD → `git worktree remove` ENOTEMPTY, `rm -rf` os error 66, while `git worktree prune` had already deregistered the tree — three confusing partial states. Fix: exact-absolute-path `lsof -t +D` holder enumeration, TERM → bounded 6×1s wait → KILL survivors → re-query; only an empty set proceeds to `git worktree remove` + `git branch -d`.
- **Quoted `$SURVIVORS` broke KILL for multi-PID sets:** `kill -KILL "$SURVIVORS"` passes a newline-separated PID list as one argument, so KILL never fires for ≥2 survivors — exactly the canonical E31 case. Unquote, mirroring the correct TERM line.
- **`lsof` enumeration semantics:** `-t <dir>` matches only the dir; `-t +D <dir>` walks the tree and matches any open fd under it (over-matches CWD holders but errs toward removal success). The holder-scope comment must describe the enumeration it sits on, and `+D` is a full-tree walk — with node_modules present the bounded wait bounds *iterations*, not wall-clock.
- **Post-merge gate cost (R2):** `spur-check-new` runs the full ~6766-test suite (~126s) plus corpus sweep; re-running it after a baseline-only JSON fix re-runs everything. `bun run corpus-check` is the corpus-only fast path and should be the iteration loop for corpus-only changes.
- **R2d lifecycle replay (R3):** `task record` after files were already merged as `done` wrote `updated_at`-only churn and never persisted the copied verdicts as `task_run_links`; verdict JSONs under the worktree `.spur/run/` were effectively discarded on worktree removal (only survived because manually copied first).

### Patterns (what worked)

- **Static contract pins over prose:** extend `execution-batch-contract.test.ts` with 4 new pins (11 total, 38 expects) covering the TERM/wait/KILL/re-query sequence, the fail-closed empty-set gate, and the absence of replay instructions (`not.toContain('Re-sync')`, `not.toContain('task update <wbs>')`, `not.toContain('spur task record <wbs>')`).
- **Negative/absence pins** assert what must *not* regress (one-shot `xargs` kill, replay instructions) — cheap insurance on an executable orchestration contract.
- **Repoint shifted anchors in the same commit** when insertions move referenced line ranges (References anchor drifted off the R2d paragraph after edits).
- **Fix in the contract, not the caller:** `execution-batch.md` is the SSOT the inline batch driver reads; the two-file fix closed the real failure boundary without touching runtime app code.

### Gotchas (watch out next time)

- **PID-reuse TOCTOU** between lsof enumeration and KILL (~1s window) is a pre-existing, accepted residual risk for a spec contract.
- **Negative global pins can false-trip** on future unrelated prose — accepted per the mandated absence pins.
- **Reuse-mode code block has no inline WT-4a persistence callout**; the Step 5 paragraph is SSOT and explicitly covers reuse mode — don't add a duplicate.
- **`kill` failures must not be ignored** and one unverified signal is not cleanup — the bounded TERM→KILL sequence with re-query is the minimum.
- **Never repair timestamp churn with `git checkout`** — that fixes the symptom, not the no-replay contract.
- **`+D` over-match is fail-safe** (errs toward removal success), but comment wording must not claim it is CWD-only.

## 2026-08-29 — feature A6 batch (0703–0712, runall inline driver)

### 0709 — escalation packets

- Bun's `coverageThreshold` (root bunfig) is enforced **per file**: a new untested helper in `apps/cli/src/commands/workflow.ts` dropped funcs to 88.46% and failed the whole suite with rc=1 and "0 fail" — the only tell is the coverage table. When adding functions to big CLI command files, add/extend a CLI e2e test in the same change.
- Swallow-style `.catch(() => undefined)` arrows count as uncovered functions; prefer a try/catch inside the helper returning `undefined` (zero extra funcs) over per-call-site arrows.
- Redaction split: identifiers get length-only `boundId` (SECRET_PATTERN `sk-[a-z0-9_-]{8,` mangles ids like `task-pipeline` → `ta[REDACTED]`); operator free text gets `bounded()` (redact + truncate).
- Async dedupe must reserve **synchronously before the first await** (tripwire + failed-finalize interleave otherwise); release the reservation on projection failure so a later trigger retries.
- Event catalog is a two-sided doc gate: new `SYSTEM_EVENT_NAMES` entries need presenters AND §11 matrix rows in `docs/design/event-tracking.md`.
- `diagnostic`-tier events are invisible under default CLI taps (system-event-tap skips them) — a "never silent" failure path needs tier `default` with `metadata-only` payload.

### Batch driver mechanics

- `git diff --` excludes untracked files — `git add -N` every batch-new source/test file before capturing implement diffs.
- sqlite `artifacts.run_id` FK → insert the runs row before projecting artifacts; `db.queryAll` is async (always `await`).
- Pipes eat exit codes under `sh -c`: capture with `>/tmp/f 2>&1; echo rc=$?`.
- Per-task diffs in a one-branch batch are cumulative overlays (later tasks' diffs include earlier tasks' hunks in shared files) — reviewers must be told this up front to avoid false "commit per task" findings.
- pi-lens "0 issue(s) must be fixed" banner with zero issues is benign; green CLI gates are authoritative.

## 2026-09-02 — Feature E9 skill-call loading band (0735–0737, runall inline driver)

This batch adds the skill-load data plane end to end: the `history_skill_call` derived table, the importer extraction that populates it, and the Summary-tab skill-load breakdown backed by a materialized rollup. The cross-cutting thread is **cross-repo (ts-libs) upstream work + a published-version release dependency + one migration-index test sweep**.

### 0735 — Add `history_skill_call` derived table

- **The importer (not Spur) owns the schema.** 0735's real work is the frozen `history_skill_call` DDL + `SkillCall` type + DAO typed-column map in `@gobing-ai/ts-llm-jsonl-importer` (the `ts-libs` monorepo). Spur only consumes the published build via the lockstep `@gobing-ai/ts-*` pin bump. Don't look for importer files under the Spur monorepo `packages/` — the source of truth is the sibling repo `~/xprojects/ts-libs`, `packages/llm-jsonl-importer`.
- **Every `history_*` table must join `HISTORY_RESET_TABLES`.** After bumping the importer pin, the drift-guard test `packages/domain/tests/analytics/history-reset.test.ts` ("table list covers every history_* table the migrations create") fails until the new table is added to `packages/domain/src/analytics/history-reset.ts`. A lockstep bump alone is never "no Spur-side change needed" — the reset registry is Spur-side and must be extended.

### 0736 — Populate `history_skill_call` during import

- **The publish gate is real.** A release exists in two places: the repo commit and the published npm version. ts-libs HEAD `07eae3f` (the extraction) was a **descendant** of the `0.4.53` release commit — so published `0.4.53` did **not** contain the extraction. Consuming a version requires a NEW release from the feature commit, not just a higher number already published.
- **Partial lockstep releases break type coupling.** The operator published 7/8 `@gobing-ai/ts-*` at 0.4.54, leaving `ts-rule-engine` at 0.4.53. `ts-rule-engine`'s `.d.ts` embed `ts-infra` types and `ts-infra@0.4.54` changed a private `syncHandlers` field — so infra and rule-engine MUST be the same version. Mixed pins (infra@0.4.54 + rule-engine@0.4.53) fail typecheck with "Types have separate declarations of a private property 'syncHandlers'" and two co-resident `ts-infra` copies. The fix is a full lockstep: get `ts-rule-engine@0.4.54` published, pin all 8 identically.
- **Bun caches the packument.** After a version is published, `bun install` may still fail to resolve it ("No version matching ^x.0 found, but package exists" / "failed to resolve") because the packument cache is stale. Clear it: `rm -rf ~/.bun/install/cache/@gobing-ai@ts-*` then reinstall. `bun pm view` (tarball API) may already see it while the resolver does not.

### 0737 — Summary tab skill-load breakdown + materialized rollup

- **Migration-index tests are a fixed sweep.** Adding a migration (`0032_spur_cli_history_board_skill_5m`) requires updating `packages/domain/tests/dao/migrations.test.ts` in **five** ways: the array `toHaveLength(32→33)`, add the `[32]` id expectation, and the four apply-count assertions (28→29, 31→32, 23→24, 10→11) that assume the old migration count. Miss any and `spur-check` fails with an unrelated-looking "db migrations" failure.
- **A new rollup joins the reset set AND the migrate sweep.** `history_board_skill_5m` must be added to `HISTORY_RESET_TABLES` too (same rule as 0735).
- **AC5 stale-rollup → never silent-empty.** `computeSummaryExtras` read the skill rollup unconditionally, so a stale/never-analyzed DB returned "No skill activity" for skill rows that exist — a silent-empty. The design forbids a direct `history_skill_call` scan in the request path, so the approved fix is to **flag freshness** rather than recompute: add `skillBreakdown.fresh: !exact` (the `exact` flag already distinguishes the not-fresh/exact path), and the UI renders a "run history analyze" state when `fresh === false`. This is a contract-shape change → `fresh: z.boolean().default(true)` — so every fixture/producer that constructs `skillBreakdown` must add `fresh` (service, mock, web test fixtures, the stale-path expectation).
- **Adding a required contract field breaks equality tests.** `history-analysis-service.test.ts` compares pre-refresh (not-fresh, `fresh:false`) vs post-refresh (fresh, `fresh:true`) summaries with `toEqual`; the freshness flag is genuine metadata and legitimately differs. Normalize it in the test (`withoutFresh`) rather than weakening the assertion — the numeric-equality intent is preserved.
- **Verify-answer schema is the host's to reconcile.** The verify subagent is prone to writing a rich-but-non-canonical answer: 0737's first attempt was canonical (good), but 0735/0736 wrote answers that failed `verify-answer-lint` (duplicate `Verdict:` line; `**Verdict:** PASS` bold form; missing per-requirement R1-R6 rows). The host must reformat into the canonical `Verdict: PASS` line + `| Req | Status | Evidence |` + `| AC | Status | Evidence Type | Evidence |` tables before `spur task verdict --from-answer`, or the deterministic verdict derivation is poisoned.

### Batch-driver mechanics (this run)

- **Bump-then-regen the lockfile.** `bun install --frozen-lockfile` fails after a pin change ("lockfile had changes, but lockfile is frozen"); run `bun install --ignore-scripts` (no frozen) to save the regenerated lockfile.
- **`bun run spur-check` is ~2 min; probe with `bun run lint` first.** The probe (biome + typecheck) catches format/type drift in seconds; only run the full gate once the probe is green.

### Getting from the run

- **The `skill` dimension and `SkillCall` extraction are strictly additive** — claude native `Skill` tool_use is preserved as a `history_tool_call` row AND emitted as `history_skill_call` (287 rows in the real corpus), so no regression in message/tool-call counts. The ledger invariant holds: `history_message + history_tool_call + history_skill_call == history_import_ledger`.

## 2026-09-02 — Feature E9 skill-call loading band (0735–0737, runall inline driver)

This batch adds the skill-load data plane end to end: the `history_skill_call` derived table, the importer extraction that populates it, and the Summary-tab skill-load breakdown backed by a materialized rollup. The cross-cutting thread is **cross-repo (ts-libs) upstream work + a published-version release dependency + one migration-index test sweep**.

### 0735 — Add `history_skill_call` derived table

- **The importer (not Spur) owns the schema.** 0735's real work is the frozen `history_skill_call` DDL + `SkillCall` type + DAO typed-column map in `@gobing-ai/ts-llm-jsonl-importer` (the `ts-libs` monorepo). Spur only consumes the published build via the lockstep `@gobing-ai/ts-*` pin bump. Don't look for importer files under the Spur monorepo `packages/` — the source of truth is the sibling repo `~/xprojects/ts-libs`, `packages/llm-jsonl-importer`.
- **Every `history_*` table must join `HISTORY_RESET_TABLES`.** After bumping the importer pin, the drift-guard test `packages/domain/tests/analytics/history-reset.test.ts` ("table list covers every history_* table the migrations create") fails until the new table is added to `packages/domain/src/analytics/history-reset.ts`. A lockstep bump alone is never "no Spur-side change needed" — the reset registry is Spur-side and must be extended.

### 0736 — Populate `history_skill_call` during import

- **The publish gate is real.** A release exists in two places: the repo commit and the published npm version. ts-libs HEAD `07eae3f` (the extraction) was a **descendant** of the `0.4.53` release commit — so published `0.4.53` did **not** contain the extraction. Consuming a version requires a NEW release from the feature commit, not just a higher number already published.
- **Partial lockstep releases break type coupling.** The operator published 7/8 `@gobing-ai/ts-*` at 0.4.54, leaving `ts-rule-engine` at 0.4.53. `ts-rule-engine`'s `.d.ts` embed `ts-infra` types and `ts-infra@0.4.54` changed a private `syncHandlers` field — so infra and rule-engine MUST be the same version. Mixed pins (infra@0.4.54 + rule-engine@0.4.53) fail typecheck with "Types have separate declarations of a private property 'syncHandlers'" and two co-resident `ts-infra` copies. The fix is a full lockstep: get `ts-rule-engine@0.4.54` published, pin all 8 identically.
- **Bun caches the packument.** After a version is published, `bun install` may still fail to resolve it ("No version matching ^x.0 found, but package exists" / "failed to resolve") because the packument cache is stale. Clear it: `rm -rf ~/.bun/install/cache/@gobing-ai@ts-*` then reinstall. `bun pm view` (tarball API) may already see it while the resolver does not.

### 0737 — Summary tab skill-load breakdown + materialized rollup

- **Migration-index tests are a fixed sweep.** Adding a migration (`0032_spur_cli_history_board_skill_5m`) requires updating `packages/domain/tests/dao/migrations.test.ts` in **five** ways: the array `toHaveLength(32→33)`, add the `[32]` id expectation, and the four apply-count assertions (28→29, 31→32, 23→24, 10→11) that assume the old migration count. Miss any and `spur-check` fails with an unrelated-looking "db migrations" failure.
- **A new rollup joins the reset set AND the migrate sweep.** `history_board_skill_5m` must be added to `HISTORY_RESET_TABLES` too (same rule as 0735).
- **AC5 stale-rollup → never silent-empty.** `computeSummaryExtras` read the skill rollup unconditionally, so a stale/never-analyzed DB returned "No skill activity" for skill rows that exist — a silent-empty. The design forbids a direct `history_skill_call` scan in the request path, so the approved fix is to **flag freshness** rather than recompute: add `skillBreakdown.fresh: !exact` (the `exact` flag already distinguishes the not-fresh/exact path), and the UI renders a "run history analyze" state when `fresh === false`. This is a contract-shape change → `fresh: z.boolean().default(true)` — so every fixture/producer that constructs `skillBreakdown` must add `fresh` (service, mock, web test fixtures, the stale-path expectation).
- **Adding a required contract field breaks equality tests.** `history-analysis-service.test.ts` compares pre-refresh (not-fresh, `fresh:false`) vs post-refresh (fresh, `fresh:true`) summaries with `toEqual`; the freshness flag is genuine metadata and legitimately differs. Normalize it in the test (`withoutFresh`) rather than weakening the assertion — the numeric-equality intent is preserved.
- **Verify-answer schema is the host's to reconcile.** The verify subagent is prone to writing a rich-but-non-canonical answer: 0737's first attempt was canonical (good), but 0735/0736 wrote answers that failed `verify-answer-lint` (duplicate `Verdict:` line; `**Verdict:** PASS` bold form; missing per-requirement R1-R6 rows). The host must reformat into the canonical `Verdict: PASS` line + `| Req | Status | Evidence |` + `| AC | Status | Evidence Type | Evidence |` tables before `spur task verdict --from-answer`, or the deterministic verdict derivation is poisoned.

### Batch-driver mechanics (this run)

- **Bump-then-regen the lockfile.** `bun install --frozen-lockfile` fails after a pin change ("lockfile had changes, but lockfile is frozen"); run `bun install --ignore-scripts` (no frozen) to save the regenerated lockfile.
- **`bun run spur-check` is ~2 min; probe with `bun run lint` first.** The probe (biome + typecheck) catches format/type drift in seconds; only run the full gate once the probe is green.

### Getting from the run

- **The `skill` dimension and `SkillCall` extraction are strictly additive** — claude native `Skill` tool_use is preserved as a `history_tool_call` row AND emitted as `history_skill_call` (287 rows in the real corpus), so no regression in message/tool-call counts. The ledger invariant holds: `history_message + history_tool_call + history_skill_call == history_import_ledger`.
All other modified files (`docs/00_ADR.md`, `docs/features/D9_*`, `docs/tasks4/*`) are pre-existing in-progress changes from the sibling D9 batch — not mine. My session's changes are exactly the two docs under repair plus the `.spur/run/wrapup-learnings.md` artifact. No task/feature corpus was written.

Done.

## Drift repair (sp:doc-evolve, wrapup tasks=[0763])

0763 shipped code (bounded rollup derivations, migration 0039, `ROLLUP_DEFINITION_VERSION` v3) with zero key-doc updates. Repaired per constitution §7 / §4.5 / §6.5:

- **`docs/design/history-incremental-materialization.md`** — the E91/ADR-103 satellite (detail owner): header status `proposed (design)` → `implemented (0741, 0763)`; §5 class table split the "Global ranked" class per 0763's premise verification (loop findings → keyed aggregate over sessions via `deltaSessionScope`; ranked steps → index-ordered top-N via `rankOrderExpr`/`selectorIsUnfiltered`) with a dated correction note; §9 D7 `applyToolAliases` documented as scoped `{sources, since}` on incremental / guarded whole-table on full rebuild; §16 accepted limits replaced the stale "rebuild fully" row with the real residual limits.
- **`docs/04_DESIGN.md`** — index row for the satellite updated to `implemented (0741, 0763)` + description notes the bounded derivations; frontmatter version 1.63.0 → 1.64.0, `updated_at` → 2026-09-05 (§4.3 rule 3).
- **`docs/00_ADR.md`** — no change: ADR-103 records no class taxonomy as a decision (task plan step 8 gates a 00 note on that), and its read-path aggregation prohibition + definition-version decision still hold. (The visible ADR-103-adjacent diff is a pre-existing sibling-D9 change, not mine.)
- **`docs/03_ARCHITECTURE.md`** — no change: §7 carries no stale rollup-derivation-class claim.
- No task/feature corpus written.

## Learnings — task 0763 (2026-09-04 → 2026-09-05)

- [2026-09-04] 0763 (E91): Premise verification before freezing design — 0741's "global ranked, cheap because bounded" class split on inspection: loop findings is a keyed aggregate over sessions (reuses `deltaSessionScope`), ranked steps is an index-ordered top-N whose three rank indexes a SQLite unary `+` was defeating. Two problems, two fixes, no candidate-contribution table.
- [2026-09-04] 0763 (E91): Reject the speculative intermediate — per-bucket top-N + merge computed to 79k×1000 rows at 5-min grain (bigger than the corpus); dropping the `+` on unfiltered selectors is the whole ranked-steps fix, `EXPLAIN QUERY PLAN` as the deterministic proof.
- [2026-09-04] 0763 (E91): P1 — `distinctSourceFileCounts` recursive CTE: independent column-wise MIN anchor pair may not exist (walk starts nowhere, `[]`, `?? 0` under-count) and non-lex-next recursion is superpolynomial (600-file >89 s, 2000-file >118 s). Green EXPLAIN test passed only on an accidentally valid MIN-pair fixture. Fix: lex-next pair per walk row + guarded anchor (600-file 0.4 ms).
- [2026-09-04] 0763 (E91): P2 — required R6 measurement skipped (`## Testing` left as template); post-fix CTE 0.4/3.0/10.7 ms at 12k/198k/1M rows, sublinear in corpus. Gotcha: a "plan names the index" test proves neither correctness nor sublinearity — small fixtures dodge both.
- [2026-09-04] 0763 (E91): Scope creep (`config/**` in `coveragePathIgnorePatterns`) and test fidelity (hand-written SQL instead of real `topStepsBy*`) caught in review (P3).
- [2026-09-04] 0763 (E91): Derivation change ⇒ `ROLLUP_DEFINITION_VERSION` v2→v3 + digest re-pin (R8); existing DBs rebuild rather than extend.
- [2026-09-04] 0763 (E91): Doc-sync deferred to wrapup again — plan scheduled the 04/00 step but the commit shipped no doc edits; wrapup corrected the satellite's class table, accepted limits, alias note, and 04 index row + frontmatter.

# Wrapup learnings — task 0763 (feature E91)

## 2026-09-04 · 0763 — Bound the whole-corpus rollup derivations

### Conventions / patterns that worked

- **Premise verification before freezing design.** 0741's design classified `loop_findings` +
  `ranked_steps` as one "global ranked" class, rebuilt in full because "a top-N is not
  decomposable by bucket". The refine checked five premises against the real tree and three
  changed the build: `loop_findings` is a **keyed aggregate over sessions** (its grouping key
  carries `session_id`), not a ranking — so it reused the existing `deltaSessionScope` instead of
  new machinery; `ranked_steps` is a genuine top-N whose exact bounded path was the three rank
  indexes a unary `+` was defeating. Two different problems, two different fixes — reusing the
  existing helper and fallback over inventing a candidate-contribution table.
- **Reject the speculative intermediate.** The per-bucket top-N + merge design was computed out:
  exactness needs `RANK_DEPTH`=1000 per partition (79k buckets × 1000 rows at 5-min grain) —
  larger than the corpus it was meant to bound. The whole fix for ranked steps is dropping the
  unary `+` on unfiltered selectors via `rankOrderExpr`/`selectorIsUnfiltered`; filtered selectors
  keep the `+` and the selective `(source, ts)` index (R7 pins the no-regression).
- **One scope resolution feeds both consumers.** `deltaSessionScope` is resolved once and shared
  by loop findings and keyed aggregates, so the two can never disagree.
- **`EXPLAIN QUERY PLAN` as the deterministic proof.** R2/R7/R4 assert the plan names the rank /
  covering index and contains no `USE TEMP B-TREE FOR ORDER BY` unfiltered, and keeps the
  pre-change plan filtered.
- **Derivation change ⇒ version bump + digest re-pin.** Every step changed emitted SQL, so
  `ROLLUP_DEFINITION_VERSION` went v2 → v3 and the digest was re-pinned (keeping v2); existing
  databases rebuild rather than extend. The pinned-digest test trips on any derivation change
  (R8).

### Errors fixed (from Phase-7 review FAIL → verify PASS)

- **P1 — `distinctSourceFileCounts` recursive CTE broken two ways.**
  (a) The anchor `WHERE (m.source, m.source_file) = (SELECT MIN(source), MIN(source_file))` takes
  independent column-wise MINs whose pair may not exist in the table (e.g. sources `a`,`b` with
  files `m.jsonl`,`a.jsonl` → MIN pair `('a','a.jsonl')` absent) — the walk starts nowhere, returns
  `[]`, and the caller merges the miss as `?? 0`, silently wrong file counts.
  (b) The recursive step emitted *every* strictly-greater row per walk row with no lex-next
  selection and no dedupe — superpolynomial: 600-file corpus did not complete in ~89 s, 2000-file
  hung >118 s, contradicting the docstring's O(distinct files × log n).
  The shipped green EXPLAIN test passed only because its fixture accidentally contained a valid MIN
  pair. Fix: rewrite the recursive step to select the lex-next `(source, source_file)` pair per
  walk row and guard/de-anchor the start. Post-fix probes: 600-file 0.4 ms, 2000-file 1.2 ms.
- **P1 — no timeout/fallback on the hot refresh path.** `recomputeKeyedAggregates` called the
  broken CTE on every incremental refresh; with a real corpus it hangs the refresh indefinitely.
- **P2 — required R6 measurement never performed.** Task `## Testing` was the untouched template;
  the 3-scale × 400-row delta timing was a plan step that got skipped, and the pre-fix
  implementation could not be sublinear anyway. Post-fix rollup-level measurement recorded: CTE
  0.4/3.0/10.7 ms and refresh 126.5 ms / 2.13 s / 10.83 s at 12k/198k/1M rows; 400-row delta on 12k
  base → 151.1 ms incremental, files 30→130 correct. Caveat: single-run dev-laptop timings,
  reported as measured.

### Gotchas

- **A test asserting "the plan names the index" is not proof of correctness or sublinearity.**
  Small fixtures dodge both defects while CI stays green — the residual risk note names exactly
  this: "the green test suite masks the P1 defects; fixtures are small and accidentally
  anchor-valid, so CI stays green while production refreshes hang or under-count."
- **Scope creep in the diff.** `config/**` added to `bunfig.toml` `coveragePathIgnorePatterns` —
  unrelated to any requirement, unmentioned in the Solution (P3).
- **Test fidelity.** The filtered-plan test hand-wrote the SQL instead of calling the real
  `topStepsBy*` under a filtered selector, so the `rankOrderExpr` routing was verified only
  indirectly at its 5 call sites (P3).
- **Doc-sync deferred to wrapup again.** The plan scheduled a doc step ("update 04 history
  surfaces if the rollup derivation contract is described there; note in 00 only if the class
  taxonomy is recorded as a decision") but the implementing commit shipped no 04/00 edits — the
  same-commit obligation (§5/T3) fell to wrapup, which corrected the E91 satellite's class table,
  accepted limits, and alias-backfill note, and the 04 index row + frontmatter. The satellite's
  class-taxonomy text (the "global ranked / honest limit" framing) was the stale claim; ADR-103
  itself records no class taxonomy as a decision, so no 00 change was warranted.

## Working learnings

## 2026-09-06 — batch f21-7d20 (runall F21, ADR-109)

### 0787 — make task creation and checking agree on valid persisted content

- Conventions — the section matrix (`config/tasks/section-matrix.yaml`) is the sole semantic authority: `sectionsForStatus` throws loudly on missing entries, no silent fallback. Removed `DEFAULT_CREATION_SECTIONS` and `FALLBACK_MATRIX`; packaged/compiled builds load a matrix data asset copied from the canonical YAML and fail loudly with attempted paths if unreachable — same task must never render differently by installation layout.
- Conventions — one frontmatter writer: `serializeTaskFrontmatter` in `packages/domain` (shared YAML emitter with `MarkdownDocument.parse`); reader/writer cannot drift. Never hand-interpolate YAML, never use `escapeYamlValue` as a writer. Round-trips quotes, backslashes, colons, Unicode, newlines exactly.
- Pattern — `checkContentPolicy` is the single creation/checking policy seam; 0788's readiness post-check consumes it. Creation renders the candidate AS `todo` and validates against the matrix `todo` row: complete spec enters `todo`, capture without required todo bodies lands `backlog`.
- Error fixed — batch items silently dropped template-seeded Background: `batchCreate` passed `background: item.background ?? ''` (never `undefined`) while the template-append path fires only on `undefined`, so `template: review` batch items lost the template Background that single create kept. One-token fix: pass the value through so `undefined` survives. Lesson: `?? ''` destroys tri-state semantics at API boundaries.
- Decision recorded — placeholder-only Requirements at `todo` no longer hard-fails: matrix-aware gating intentionally supersedes task 0339's unconditional gate (matrix marks Requirements todo-optional; creation ships guidance-comment scaffolds in optional sections and checking must agree — create→check parity was the task's point).
- Pattern — validate candidates BEFORE WBS allocation/lock; batch invalid ⇒ `TaskCandidateInvalidError`, zero files, no parent mutation.
- Convention — one parseable raw/enveloped JSON error on stdout; exit 1 candidate-invalid/preparation-failed, 2 usage, 3 collision/dedupe; enveloped errors collapse to `INTERNAL_ERROR` + `details.cliCode`.
- Gotcha — auto-status candidates run the L1–L3 policy twice (todo-eligibility probe + final validate); negligible next to fs I/O, noted not fixed. `summarizeWithStatus` at 7 positional params — switch to options object only if it grows.
- Process — checker-policy change ⇒ explicit unsuppressed corpus audit (T10): 289 PASS / 10 FAIL, all pre-existing done-status L4 findings, 0 from the change.

### 0788 — deliver ready-by-default task creation across CLI and planning

- Pattern — ALL agent orchestration lives in `packages/app/src/services/task-readiness.ts`; `task-service.ts` writers have zero diff (verified via `git diff 272451a8d131`). Deterministic writers never dispatch agents; CLI injects `context.agentService()` ports from outside locks.
- Pattern — default create: save capture → prepare the SAME WBS via the canonical ready competency → deterministic `task check` must pass as `todo` → promote backlog→todo only on pass. "Exit 0 alone is not readiness." `--skip-ready` = zero-model title-only backlog capture; `--agent` + `--skip-ready` is invalid usage (exit 2).
- Pattern — failure contract: `TaskPreparationError` carries stage/wbs/filePath/findings/recoveryCommand (`/sp:dev-refine <wbs> --auto --depth ready`); never roll back, delete, or silently recreate; retry keeps the same WBS identity.
- Pattern — batch: `prepareBatchTaskReady` runs strictly BEFORE `svc.batchCreate`, schema-validates the whole batch once, zero files on rejection; host planning synthesizes inline then calls `batch-create --skip-ready` so a host batch can never trigger a second model pass.
- Error fixed (P2) — Bun one-liner digest read the wrong argv: `bun -e '<code>' <file>` places the operand at `process.argv[1]`, not `[2]`; `Bun.file(undefined)` throws ("Expected file path string or file descriptor", verified on bun 1.3.14). Fail-closed (everything degraded to refineall) but the run-scoped ready-evidence stage was dead as written. One-line fix: `process.argv[1]`.
- Gotcha — batch raw-mode preparation failure passed `err.message` only while single create folded "Recover with: …" into stderr; recovery action must be mirrored in the batch branch for non-JSON output.
- Gotcha — seeded jq fallback verifies strictly less than the monorepo TS finalize (row status only, no per-row checklist evidence or digest freshness) — fail-open relative to `finalizeIdeaHandoff`; bounded by ready-prepare shape validation. Fail-closed beats fail-open, but fail-closed that always trips (the P2) silently disables a stage.
- Gotcha — `DEFAULT_READY_PREPARE_TIMEOUT_MS` docstring said "10 minutes", value is 900_000 = 15; and no CLI surface overrides the preparation budget yet.
- Convention — handoff gates on evidence, not structure: stale `planningDigest` degrades to refine even when checks pass; refineall-vs-runall recommendation is mutually exclusive; missing/stale readiness evidence yields one precise preparation action while unfinished dependencies stay visible.
- Testing pattern — fake-executor matrix: default/skip/missing-agent/timeout/invalid-output/retry-identity/batch-rejection/host-no-double-synthesis; `exit 0 alone is not readiness` and `preserves authored work (no rollback)` as named regressions.

### Doc-sync (this wrapup)

- Gotcha — flipping an ADR status (Accepted→Implemented) in-commit does not propagate: 03 §12.4 ("Approved extension, not yet shipped … will reuse") and the 04 satellite index row stayed stale even though `updated_at` was already today. Sweep derived docs for "not yet shipped"/"will" phrasing whenever an ADR status flips; frontmatter recency alone proves nothing about body sync.

[You have received this identical output 9 times. Re-reading 'agent://DocSync788' will not change it — use a narrower selector (path:A-B), or proceed with the edit.]

Wrapup complete. Summary:

**Doc drift repair (sp:doc-evolve wrapup, batch 0796–0799):**

- `docs/03_ARCHITECTURE.md` — §25 heading dropped "(accepted design — not yet built)" (§6.4 rule 1); body rewritten to the shipped mechanism: `disabled` config authority, upstream quota events, `setProjectExecutorDisabled`, `agent_executor_updates` durable record + DAO, one server consumer with correct lifecycle, CLI flush-before-exit, in-run exclusion, launch-boundary reload, reserved recovery contract. Version 1.42.0 → 1.43.0.
- `docs/04_DESIGN.md` — index row status → "implemented (0796–0799); ADR-111"; added `agent_executor_updates` row (migration 0040) to the tables table; added an accurate §7.9 note that the quota events are **bus-consumed, not `SYSTEM_EVENT_CATALOG`-registered** (verified against `event-names.ts`), pointing to the satellite §4. Version 1.70.0 → 1.71.0.
- `docs/design/executor-availability.md` — frontmatter `status: implemented`, version 1.1.0; header updated (all four tasks done, ADR-111 Accepted); added a shipped-delta note on catalog registration. Detail-first order followed (satellite before its index row).
- `docs/00_ADR.md` — already correct (ADR-111 Accepted, frontmatter current); no edit needed.

Per the §7 repair protocol, I verified frontmatter vs §4.1 (`owns`/`authority`/`updated_at` all match; bumps done same-edit), confirmed ADR-111's `03 §25` pointer still resolves, and confirmed no task/feature corpus was written. Two pre-existing orphan satellites (`observability-module-refactor.md`, `sqlite-forensics-token-time-per-step.md`) were found but are out of this batch's scope (J93/E5-era, referenced from task corpus) — flagged, not touched. The project's real gate is Biome (code only; `.md` files are ignored), so the doc edits carry no gate risk; the edit tool's markdown checks passed on all three files.

**Learnings artifact** written to `/Users/robin/xprojects/spur-new-runall-b5-a57e58e6/.spur/run/110d68dc-41b0-4764-ab00-ee8c06dd2b29-wrapup-learnings.md` (grouped by date 2026-09-07 and WBS 0796–0799, plus batch-level lessons). It follows:

# Wrapup learnings — run 110d68dc (batch 0796–0799, feature B5)

## 2026-09-07

### 0796 — config: executor `disabled` flag respected in routing and doctor

- **Convention (strict-boolean config):** `agent.executors[].disabled` is boolean-only. The Zod
  schema and the shipped JSON Schema (`apps/cli/schemas/spur-config.schema.json`) must reject
  `"yes"`/`"true"`/null/`1`/`{}` *identically* — one schema passing what the other rejects is a
  silent config-format divergence that bites later. Update both plus `config/config.example.yaml`
  in the same change.
- **Merge semantics:** raw global/project merge yields false by default; a project *omission*
  inherits global true, an explicit project false overrides it. Layer tests must pin both
  directions, not just "defaults to false".
- **Explicit-pin discipline:** a disabled executor that is *explicitly pinned* (agent run, drain,
  team materialization, role ladder) fails loudly pre-spawn with the profile name and the enable
  fix (exit 2), and is **never silently substituted**. Automatic selection skips disabled
  candidates; explicit references never fall back. Materialized team agent/model pairs cannot
  bypass a later disable — the final enabled check runs immediately before each subprocess launch.
- **Doctor probe hygiene:** disabled entries are synthesized from config without a probe
  (`usable: false`, error `disabled by config`) — never probe what config says is off. The
  fingerprint must include the disabled state or a stale cache serves pre-disable eligibility.
  Elected enabled row stays `agents[0]`.
- **Exit-status contract:** doctor *inventory* exits 0 with intentional disables; *naming* a
  disabled executor (or all-disabled sets) exits nonzero. Tests pin inventory-vs-named exit codes
  separately.

### 0797 — config: safe single-entry `setProjectExecutorDisabled`

- **Pattern (document-model edit):** flip one YAML key via the parsed document model, not text
  search — comments, ordering, unrelated values, and file mode (`0o640`) survive. Byte-stable
  no-op when the explicit value already matches; explicit false is *written* when the attribute is
  absent.
- **Strict no-op discipline:** missing file / missing `executors` / missing executor return a
  structured `{status:'unchanged', reason}` and create **nothing** — no path or dir creation on
  no-op paths. Invalid args (empty name, non-boolean) reject before any filesystem work.
- **Error taxonomy:** stable codes `INVALID_CONFIG` (bad args, malformed/ambiguous YAML,
  aliases/merge keys, duplicate names, symlinked config via `lstat`), `CONFIG_CONFLICT` (external
  change detected pre-commit), `CONFIG_WRITE_FAILED` (lock/atomic-write failure).
- **Concurrency:** per-path exclusive lock keyed `<configPath>.lock` with **dead-owner reclaim
  only** (a live writer's long hold is never stolen); external-change detection by
  mtime/size/ino identity immediately before rename; atomic same-dir tmp + fsync + rename with
  mode preservation; loader cache invalidated on success. Locks are conflict *detection* — an
  arbitrary editor never honors the lock, so never retry silently over a detected conflict.

### 0798 — upstream: quota observation producer in @gobing-ai/ts-ai-runner

- **Upstream-delivery convention:** the producer lives in the upstream package; Spur records the
  handoff task (commit, harness task 0065 done) and does **not** bump/publish — release is
  operator-gated. Tested package identity by commit (0.4.56+9285ab4), not version.
- **Classifier discipline (allowlist, structured-only):** only confirmed-exhaustion codes
  (`insufficient_quota`, `insufficient_credit_balance`, `quota_exceeded`, `usage_limit_reached`,
  `credits_exhausted`, `billing_hard_limit_reached`, `provider_quota_exhausted`) over structured
  JSON error envelopes produce events. Generic 429/`rate_limit_error`, `overloaded_error`,
  `authentication_error`, context-length, timeout, free text, *quoted prompt content*, and
  non-JSON stderr are tested **negatives** — zero events, original result intact. Successful
  stdout is never scanned for quota vocabulary.
- **Deterministic identity:** `observationId` = sha256 over evidence/reason/attribution — stable
  across redelivery, so one event per observation (producer emits at most once per id).
- **Attribution:** exact `{projectId, executor, agent, model}` carried via `quotaContext` from the
  dispatch; missing attribution stays observable but cannot mutate config. Never infer an executor
  from agent/model similarity.
- **Bounded evidence:** trailing 8 KiB (`MAX_QUOTA_EVIDENCE_BYTES`); the same classifier drives
  buffered, streaming/team, and opt-in health-probe paths (health stays read-only by default).

### 0799 — app: durable quota updates, server consumer, runtime refresh

- **Pattern (durable latest-observation):** one pending row per `(project_id, executor_name)` in
  the existing SQLite DB (`agent_executor_updates`, migration 0040, `AgentExecutorUpdateDao`) —
  chosen over a ledger cursor or the generic job queue because it coalesces superseded writes,
  survives restart, and isolates delivery from event-history pruning. Observation order is
  `(observedAt, observationId)` with deterministic lexical ID tie-breaking; a conditional
  latest-observation upsert with version-specific ack means stale/duplicate/superseded
  classifications never overwrite newer state.
- **Lifecycle (server):** exactly **one** project-scoped consumer starts **before** autostart or
  accepting dispatch; shutdown detaches subscriptions, flushes, and final-drains **before** DB
  close and supervisor teardown. Startup failure is logged non-fatal — rows stay pending for the
  next start.
- **Lifecycle (CLI):** the same subscription attaches to agent/workflow/team run buses with
  flush-before-exit; persistence failure is reported while preserving the original agent failure.
- **Crash-safety:** a crash after YAML rename but before ack replays the idempotent operation on
  restart; failed writes stay pending and visible (no failed ack, 3-attempt bound, serial drain —
  bus wake-ups and a 30 s poll feed the *same* serialized drain, so bus callbacks never
  independently write YAML).
- **In-run exclusion vs persistence:** a run-scoped `agent.quota.exhausted` listener is
  correlation-filtered to the active invocation and escalates as `resource-exhaustion` — the
  current fallback set excludes the executor **without waiting for persistence**.
  `reloadAgentConfig` suppliers thread into team/workflow services so availability re-resolves at
  each selection/launch boundary without restart.
- **Recovery is a reserved contract:** `agent.quota.recovered` maps trusted recovery through the
  same `setProjectExecutorDisabled` path to `disabled: false`; absent entries stay absent. No
  timer, poller, or automatic recovery producer exists — the 30 s poll is pending-record delivery
  only.
- **Trusted-shape schemas on a Workers-safe subpath:** the Zod schemas ship as
  `@gobing-ai/spur-config/agent-quota-events` (a subpath export like `./loader`) so
  Workers-bundled consumers never pull the Node-only root barrel; the consumer validates every
  event against them before any attribution check — a malformed payload is a classified rejection,
  never a YAML write.

## Cross-cutting (batch-level)

- **Docs sync was done in-commit per task** (T3/T9): 0796/0797 touched `04_DESIGN.md` +
  `docs/design/executor-availability.md`; 0799 flipped ADR-111 to Accepted. The wrapup hop still
  had to fix: 03 §25 still read "(accepted design — not yet built)" after the mechanism shipped
  (§6.4 rule 1), the satellite header still said "0798–0799 remain", the 04 index row status was
  stale, and the new `agent_executor_updates` table had no 04 table row. Frontmatter
  version/`updated_at` bumps belong in the same edit as the body change.
- **The two quota events are bus-consumed, not `SYSTEM_EVENT_CATALOG`-registered** — verify
  against `packages/app/src/services/event-names.ts` before writing any "catalog entries provide
  presentation" claim; board presentation awaits ADR-110 (catalog-open ingestion, still Proposed).
  A 04 edit that names an enforcement surface must be checked against the actual file.
- **Upstream tasks don't create repo surface:** 0798 (upstream producer) required no 00/03/04
  repo-side surface — only the consuming side (0799) did.
Wrapup complete for task batch [0815].

**Doc-evolve wrapup — drift repair:**
- **Drift audit (targeted to 0815's change surface):** zero delta in `docs/00_ADR.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/design/*`. The merge `39563d002` changed only `package.json`/`bun.lock` (ts-db ^0.4.62 catalog bump), two workaround deletions in `packages/app`, and four test assertion repairs — no CLI/flag/config/env/schema/DTO surface (no T3), no decision reversal (no T1/T2; 0784 R1 intent restored, not changed), no mechanism replacement (no 03 delta), no satellite added/changed (no T9). No doc claimed `queryFirst` returns null or documented the deleted workarounds; the version table in `history-incremental-materialization.md` is a frozen incident record, not a current claim.
- **Contract-verify:** 00/03/04 frontmatter matches §4.1; `updated_at` plausible for 0815. *(Flagged, not edited: commit `5abb2d68b` — task 0817's own doc edits — made substantive 04 changes without bumping 04's `updated_at`; that's 0817's obligation, kept out of this diff.)*
- **Lesson-append (§8):** three lessons appended to `docs/99_PROJECT_CONSTITUTION.md` (00: facade-fix scoping; 04: weakened-assertion, registry-package release coordination), frontmatter bumped 1.5.1→1.5.2 / `updated_at` 2026-09-09 in the same edit. No task/feature corpus written; pre-existing dirty files (`protected-files.yaml`, `docs/tasks4/0815_*.md`) untouched.
- **Learnings artifact:** written to `/Users/robin/xprojects/spur-new/.spur/run/713a9136-cac5-44c4-a5dc-de498f61603d-wrapup-learnings.md`.

---

# Wrapup learnings — 2026-09-09

Tasks: 0815

## 2026-09-09 · 0815 — Align RunDao.traceRowById return type with queryFirst SQL-NULL semantics

### Conventions

- **Fix the facade, not the consumers.** When a declared type contradicts runtime behavior across a
  package boundary, the adapter/facade lies — fix it once at that layer. The retype-15-DAO-
  signatures and per-call-site normalization alternatives were rejected because they leave every
  sibling call site broken. Hand-written call-site compensation (`?? undefined` workarounds with
  explanatory comments) is the exact pattern AGENTS.md forbids — it accumulates because the facade's
  runtime contradicts its declared contract.
- **Assert the exact contract value a test's comment claims.** A regression test asserting
  `toBeFalsy()` while commenting "queryFirst returns undefined" cannot fail when the contract
  breaks. The weakened assertion sat directly on top of the defect and hid it for a release cycle;
  the fix strengthened it to `toBeUndefined()`.
- **A cross-repo dependency fix is a publish-then-bump flow, not a local edit.** `@gobing-ai/ts-db`
  is consumed as a published registry package (resolved via bun's global cache), not a workspace
  link — a local ts-libs edit never reaches Spur. Plan steps must name both sides: release/publish in
  ts-libs, then catalog bump + install in Spur.
- **Restore intent, don't widen scope.** The "no authoritative row" refusal string and trigger
  condition (0809 R3) had to stay byte-identical; the workaround deletions were behavior-preserving
  because the adapter now supplies what call sites compensated for. Sweeping every `=== undefined`
  comparison into `== null` style was explicitly out of scope — the adapter fix makes them correct
  as written.

### Errors fixed

- `BunSqliteAdapter.queryFirst` cast `bun:sqlite` `Statement.get()` to `T | undefined` without
  normalizing — `get()` returns `null` on no match, so every no-row lookup resolved to `null`
  against a type that said `undefined`. The D1 adapter already normalized (`?? undefined`); the two
  adapters disagreed on the same `DbAdapter` interface. Fixed in ts-libs (inner cast corrected to
  `T | null` + `?? undefined`), released as `@gobing-ai/ts-db@0.4.62`.
- The `existing === undefined` identity-stamp guard at `workflow-service.ts:213` was semantically
  wrong under `null` (a genuinely new row could skip stamping) — latent, not shipped-broken, because
  the inline setup writes identity in the insert. After the adapter fix it is correct with no edit.
- Two stale compensating `?? undefined` workarounds deleted from `run-artifact.ts` and
  `inline-run-setup.ts`; surrounding refusal/attach branches unchanged.
- Weakened not-found assertions repaired (`run-dao.test.ts` → `toBeUndefined()`), plus the
  assertion suite in `db.test.ts`, `migrations.test.ts`, `inline-run-setup.test.ts` that had
  codified the old null contract.

### Patterns

- **Retargeting a deferral to root cause.** The original 0815 framing blamed the declared return
  type; triage proved the type correct at every layer and located the lie in the adapter
  implementation. Scope was rewritten around the actual root cause, with the DAO signature left
  alone. Evidence was graded HIGH (executed/reproduced) vs MEDIUM (read+reasoned) vs LOW
  (unverified) so the implementer knew which claims still needed proving — e.g. "no shipped path is
  broken" was an absence claim from partial call-graph tracing, explicitly re-rateable to P1.
- **Blast-radius analysis before the fix.** Every `?.` / `??` / truthiness call site is unaffected
  by null→undefined; only strict `=== undefined` comparisons change, and each one changed from
  wrong to right. Known exposed sites were enumerated with their failure modes (identity stamp,
  escalation-packet sink throw-then-swallow, unreachable aggregate).
- **Behavior-preserving deletion verified by contract tests.** After removing workarounds, the
  refusal-contract and malformed-metadata tests were re-run to prove the exact message strings and
  branch triggers survived byte-identical.

### Gotchas

- **TS server stale module cache after dependency bumps.** After `bun install` version changes the
  LSP keeps serving pre-bump types (6 false positives this session on `bounded-child-run*`).
  Restart the TS server (or session) after dependency sync before trusting diagnostics.
- **Importer-schema drift after dependency bumps.** `importer-schema-check` fails on
  recorded-vs-installed version drift in gitignored `.spur/spur.db`; remedy is a manual
  `spur migrate` per checkout — environment, not a regression.
- **`spur task update` exposes no rename flag.** A task title can't be renamed, so a retargeted
  task's frontmatter name keeps the stale symptom phrasing; Background/Requirements are
  authoritative over the title until a rename surface exists.
- **A bare-aggregate query always returns one row** — a `=== undefined` guard on it is unreachable;
  leave it, document it, and don't sweep it into a "fix the whole class" change.
- **Task references sections outlive the task.** 0815's References remained the durable parking
  spot for unrelated session-review residuals (items 1–6) that predate and outlive the fix; if the
  task closes, those items need a new owner surface first.
**Drift repaired and committed** — `e23efdaaa`, 5 paths, tree clean. Artifact written to `/Users/robin/xprojects/spur-new/.spur/run/446990df-5098-4fd3-b269-d75d5a83acd1-wrapup-learnings.md`.

Drift report (§7 + §4.3, over 0850's owners):

| # | Doc | Reality | Doc said | Repair |
|---|---|---|---|---|
| 1–3 | `00_ADR`, `03_ARCHITECTURE`, `04_DESIGN` | content edited 2026-09-14 | `updated_at` 2026-09-09/09-13, version unbumped | minor bump + date |
| 4 | `design/cli-contracts.md` | `spur agent list --specs` takes `--server <url>` and merges live supervisor status (`agent.ts:55,326-348`) | detection only | flag + behavior documented |
| 5 | `design/project-switcher.md` | `spur projects list --fleet` exists (`projects.ts:113`) | `list [--json]` only; stale `updated_at` | row widened, date refreshed |
| 5b | `04_DESIGN` index | satellite bannered superseded | row read as current | ADR-116 disclosure |

Zero-finding checks backed by commands: CLI noun/verb + `--json` parity (`consistency.test.ts` 3 pass), module inventory vs `apps/web/src/modules/*/index.ts*`, `mergeTimeline` 0 hits, `RETIRED_ROUTES` match, `FleetDeclarationSchema`/`FleetService` match, `/api/team/*` still live, `AGENTS.md` map == §4.1, 65/65 `docs/design` files indexed, all new links/anchors resolve.

Verification: `test-pre-check` green (45 rules); 48 doc-related tests pass. Full `spur-check`: 8480 pass / 1 fail — `agent.test.ts:1075` fails only because this session exports `SPUR_ROLE=coder`, which the inline path inherits via `ctx.env.SPUR_ROLE`; unsetting that one var gives 48/48 pass, and the failure reproduces with my doc changes reverted. Not a regression.

---

# Wrapup learnings — batch 0850 (feature G64)

Batch 0850 — *Reconcile superseded authority across ADRs, architecture, and templates* — is `done` at `7db3fb9ba` (21 paths). This wrapup ran `sp-doc-evolve` (§7 drift-audit + §4.3 contract-verify) over the owners the task touched and repaired the surviving drift in `e23efdaaa` (5 paths).

## 2026-09-14 · WBS 0850 · recording a supersession without rewriting history

### Conventions

- **Additive supersession, never a rewrite.** ADR-052 keeps its number, title, date, `Decision`, `Why` and `Detail` links byte-identical; only the status line becomes `Superseded by ADR-116` (`docs/00_ADR.md:500`). The replacement carries its own `Supersedes:` and `Retains:` lines. A reversal costs one status-line edit plus one appendix — history stays readable where it changed.
- **Re-check the ADR ceiling in the same pass that writes the entry.** ADR-115 was reconfirmed as the last entry (`docs/00_ADR.md:1639`) immediately before ADR-116 was appended. Parallel planning can consume a number between "I picked 116" and "I wrote 116".
- **One carrier per fact.** The pointer lives on the status line only, and a test enforces that ADR-052 is the *only* pre-116 ADR carrying it (`adr-supersession.test.ts` (c1)) — so a later well-meaning "also update ADR-086" edit fails loudly instead of silently doubling the authority.
- **Superseded satellites are bannered, not rewritten.** `workspace-design.md`, `inbox-board-module.md`, `board-module-boundaries.md`, `spur-team-mode-design.md` keep their bodies as the historical record, gain a `> **Superseded (ADR-116).**` banner and a `**Status:**` line, and forward to the current owner. Deleting them is deferred to the cutover commit.
- **Render a task-owned invariant as a test at the moment it could be violated.** (c2) reads the *working* diff of `docs/00_ADR.md` and allows only ADR-116 lines plus ADR-052's old/new status line — the assertable form of "no historical decision is rewritten".

### Patterns

- **Derived-owner reconciliation is a chain, not a vibe.** One decision propagated through: ADR (`00`) → architecture §14 (`03`) → index rows + per-verb deprecation table (`04`) → owning satellites (`docs/design/*`) → both seeded config templates → `01` scope row → `help2` pages. The 21-path diff is exactly that chain; skipping any link leaves a doc reading as current.
- **Supersession is two-sided.** The new ADR must declare what it *Retains* (ADR-037/057/022). Without it, a retired decision's neighbours read as implicitly retired too.
- **Widen the existing owner before inventing a satellite.** The fleet data contract (`FleetDeclaration`/`FleetService`) landed in `docs/design/project-switcher.md` §3.1 with its `owns:` line widened — no new file.
- **Retire by redirect, not by deletion.** `RETIRED_ROUTES` in `apps/web/src/router.tsx:14-19` maps `workspace` / `inbox` / `teams` → `/board/projects*`, so stale URLs keep resolving while the modules are gone.
- **Deprecate a CLI noun in place, then gate its removal on evidence.** All six `spur team` verbs keep running with a one-time stderr warning and unchanged exit codes; `config/transition-shims.json` (`team-noun-retired`) names the removal condition (no caller in `config/workflows/`, `plugins/sp/`, `scripts/`, `docs/`). The noun is removed by a *later* commit once that condition holds.
- **Prove the surface claim from the shipped tree, not from the doc.** §14's module inventory was verified against `id`/`order` in each `apps/web/src/modules/*/index.tsx`: observability 10, history 20, features 30, `task-kanban` id `tasks` 40, projects 45.

### Errors fixed

| Symptom | Root cause | Fix |
| --- | --- | --- |
| `00_ADR`, `03_ARCHITECTURE`, `04_DESIGN` carry `updated_at` 2026-09-09 / 2026-09-13 despite 2026-09-14 content edits | §4.3 metadata not refreshed with the content | minor version bump + `updated_at: 2026-09-14` |
| `project-switcher.md` `updated_at` stayed 2026-09-13 although `owns:` was widened and §3.1 added | its three sibling satellites were refreshed in the same commit, it was missed | `updated_at: 2026-09-14` |
| `cli-contracts.md` `spur agent list` had no `--server <url>` and no live run-status merge | 0848 moved both from `spur team status`; `docs/help/cmd_agent.md:113` and the plugin reference were updated, the owning non-UI satellite was not | flag added to the heading + one sentence naming the merge, its states and the unreachable-server fallback |
| `project-switcher.md` §6 listed `list [--json]` only | `owns:` widened to "the project fleet" but the verb table was not revisited, while `04_DESIGN` already cited `spur projects list --fleet` | `list [--json] [--fleet]` + the resolution it performs |
| `04_DESIGN`'s index row for `spur-team-mode-design.md` read as current | three of four bannered satellites got an index disclosure; this one was missed | same "**superseded by ADR-116**" disclosure as its siblings |

### Gotchas

- **`spur task update --section "Q&A"` appends; it does not replace.** (`apps/cli/src/commands/task.ts:434-435`) An intended "anchor qualification" landed as a duplicate 44-line Q&A entry with the stale anchor surviving in the live copy. The replace path is a body starting with `<!-- qa:replace -->`. Use that marker whenever the intent is to *correct* an existing entry.
- **A doc-diff guard can veto an unrelated metadata edit.** `adr-supersession.test.ts` (c2) reads the uncommitted `git diff HEAD -- docs/00_ADR.md` and rejects any added line that is not ADR-116 or the status line — so a §4.3 frontmatter refresh fails it while the tree is dirty. Its own docblock states the assertion is vacuous once committed, i.e. the guard is scoped to the task's working window; a doc repair belongs in its own commit.
- **Ambient `SPUR_ROLE` breaks the test suite from inside a Spur-driven session.** `runAgentRun --agent inline` returns 1 instead of 0 (`apps/cli/tests/commands/agent.test.ts:1075`) because the auto path inherits the dispatcher role through `ctx.env.SPUR_ROLE` (`packages/app/src/services/agent-service.ts:2236`, 0551 R2) and the test's `agentConfig: {}` has no executor for `coder`. Bisected: unsetting **only** `SPUR_ROLE` turns 1 fail into 48 pass. Run the gate as `env -u SPUR_ROLE bun run spur-check`, or outside the session.
- **The owning non-UI satellite is the link that gets missed.** CLI behavior changes tend to land in `docs/help/*` (parity enforced by `help-doc-parity.test.ts`) and the plugin reference tree, while `docs/design/*-contracts.md` — the §6.5 owner of signatures and defaults — has no parity test at all. Grep the owning satellite explicitly after any verb/flag change.
- **Widening `owns:` does not update a document's tables.** Treat an `owns:` edit as a trigger to re-read the body for facts that just fell inside the widened responsibility.
- **Cross-artifact identity matters in ADR/Plan prose.** `config/config.global.yaml` is the machine-wide layer `spur init` seeds as `~/.config/spur/config.yaml` (`apps/cli/src/commands/init.ts:31-34`; `:162` skips it from the project-template copy); `config/config.example.yaml` is the project template. Naming the wrong one sends readers to a file the command never reads.
- **Do not "fix" a historical ADR that is still true.** ADR-086 presents `agent.team.<id>.members` and the `agent.team.demo` example as current. Verified *not* false: `team: z.record(z.string(), TeamConfigSchema).optional()` still parses (`packages/config/src/index.ts:658`) and `misplacedGlobalKeys` reports the key rather than rejecting it (`:979-990`). Owner is the cutover commit that removes the noun.
- **A §4.3 metadata refresh is a content edit, not bookkeeping to defer.** `version:` had already been left behind once before (ADR-113/114/115 landed 2026-09-11 with no bump), so stale `updated_at` accumulates silently across a program rather than failing anywhere.

### Unverified / open (carried, not fixed)

- 0850's own closure items: the duplicated Q&A entry (P3), the Design/Plan reference to `config/config.example.yaml` as the seeded artifact, one accepted `L4.stale-line-anchor` warning, and a cosmetic double blank line in G64's AC fence.
- Retired Board surfaces with no owning task claim — process watch list (0852) and the three Teams supervisor facets (0853).
- `bun run spur-check` cannot go green inside a git worktree on this machine (minified-identifier renames in `plugins/sp/lib/idea-handoff.generated.mjs`) — unassigned harness residual.

## Drift report — 2026-09-14 (doc-evolve over 0850's owners)

Checks run: 8 (§7 items) · Findings: 5 · Repaired in `e23efdaaa`

| # | Doc | Reality / source says | Doc said | Authority | Trigger | Repair |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `00_ADR.md` | content edited 2026-09-14 (ADR-116, ADR-052 status) | `version: 1.44.0`, `updated_at: 2026-09-09` | §4.3 | T1 | version 1.45.0, date refreshed |
| 2 | `03_ARCHITECTURE.md` | §14 rewritten 2026-09-14 | `version: 1.46.0`, `updated_at: 2026-09-13` | §4.3 | T1 | version 1.47.0, date refreshed |
| 3 | `04_DESIGN.md` | index rows + `spur team` deprecation table changed 2026-09-14 | `version: 1.73.0`, `updated_at: 2026-09-09` | §4.3 | T3/T9 | version 1.74.0, date refreshed |
| 4 | `design/cli-contracts.md` | `spur agent list [--specs]` accepts `--server <url>` and merges live supervisor status (`agent.ts:55,326-348`; `docs/help/cmd_agent.md:113`) | detection only | §6.5 | T3 | flag added; merge, states, fallback documented |
| 5 | `design/project-switcher.md` | `spur projects list` accepts `--fleet` (`projects.ts:113`); `04_DESIGN:152` already cites it | §6 listed `list [--json]`; `owns:`/§3.1 changed with stale `updated_at` | §6.5, §4.3 | T3 | row widened to `[--fleet]`; date refreshed |
| 5b | `04_DESIGN.md` | `spur-team-mode-design.md` carries a superseded banner | index row read as current | §4.5, §7 | T9 | ADR-116 disclosure added |

Zero-finding checks (with the command that produced zero):

| §7 item | Evidence |
| --- | --- |
| Real CLI surface vs docs | `bun test apps/cli/tests/consistency.test.ts` — 3 pass: noun parity both directions, `--json` parity per verb |
| `03` module inventory vs tree | `rg -n "id:\|order:" apps/web/src/modules/*/index.ts*` → 10/20/30/40/45 exactly as §14 states |
| Retired module/merge claims | no `workspace`/`inbox`/`teams` dir under `apps/web/src/modules/`; `mergeTimeline` → 0 hits |
| Redirect table | `apps/web/src/router.tsx:14-19` matches §14's `RETIRED_ROUTES` description |
| Fleet contract vs code | `FleetDeclarationSchema` (`packages/config/src/index.ts:537`) and `FleetService`'s five methods match `project-switcher.md` §3.1 |
| `/api/team/*` still live | 7 routes still registered under `apps/server/src/modules/team/`; §14.1's transport table accurate |
| Doc-map agreement | `AGENTS.md:88-98` vs constitution §4.1 — same meaning, no edit owed (§4.4) |
| Index discoverability | every file in `docs/design/` is referenced from `04_DESIGN.md` (65/65) |
| Reference resolution | every link added by `7db3fb9ba` resolves; `<a id="spur-agent-list---json---specs">` preserved across the heading change |
| Template identity | `init.ts:31,162` confirms `config.global.yaml` → `~/.config/spur/config.yaml` and `config.example.yaml` → project template |

Verification of the repair: `bun run test-pre-check` green (45 rules); `consistency`, `help-doc-parity`, `agents-md-portable-alignment`, `init-templates`, `json-envelope-inventory` green (48 pass); `adr-supersession` green once the frontmatter refresh was committed (c2 vacuous by design). Full `bun run spur-check`: 8480 pass / 1 fail — the ambient `SPUR_ROLE` pollution above, reproduced identically with the doc changes reverted, so not a regression from this wrapup.
**Wrapup complete — zero drift, zero repairs needed, no corpus writes.**

- **Doc-evolve audit (§7):** batch resolved to task `0850` from the validated capture. All reconciliation 0850 required already landed in `7db3fb9ba` + `e23efdaaa`: real CLI verbs match `04`, `/api/team/*` routes are 9/9 parity with `observability-contracts.md`, every `04` pointer resolves, all four superseded satellites carry ADR-116 banners, and `00`/`03`/`04` frontmatter contracts pass §4.1. Per §7, a clean report lists its checks — all listed in the artifact.
- **No repairs written:** nothing drifted. The uncommitted `docs/00_ADR.md` diff is task 0854's in-flight amendment work — left untouched.
- **Learnings:** written to `/Users/robin/xprojects/spur-new/.spur/run/003152d0-a410-41ad-a94d-1bfac97f0461-wrapup-learnings.md`.

# Wrapup Learnings — run 003152d0 (task 0850 · feature G64)

## 2026-09-14 · Task 0850 — Reconcile superseded authority across ADRs, architecture, and templates

### Conventions

- Supersession is **additive, never destructive**: change the status line (`Superseded by ADR-116`), append an amendment block or banner, and leave decision text, ADR numbers, dates, and feature receipts untouched (R2). Retconning history is the failure mode, not staleness.
- Retired design satellites get a **superseded banner at the head only** — bodies stay as historical record (`workspace-design.md`, `inbox-board-module.md`, `board-module-boundaries.md`, `spur-team-mode-design.md` all follow this).
- Deprecation ≠ removal: docs must match the **shipped** CLI. While `spur team` verbs still run, they keep a deprecation header + per-verb replacement table (`04:143`, `cli-contracts.md:523`, `team.md`); deletion belongs to the cutover commit, not the deprecation commit.
- Superseded authority is repaired **at its owner first** (00_ADR), then derived docs (03 → 04 → satellites → CLI references → init templates). Never patch a derived doc to disagree with its authority.

### Errors fixed / avoided

- **Sequencing trap in the task framing:** 0848 ships a deprecation *warning*, not a removal. Deleting `team.md` / the `spur team` help page during 0850 would have made references contradict the live CLI — exactly what R3 exists to prevent.
- **ADR number allocation race:** next free number (116, after ADR-115) must be re-verified immediately before writing; another feature can land it first.
- G61/G62/G63 shipping without ADRs was deliberate, not an oversight — authoring retroactive ADRs for already-shipped work is the retconning R2 forbids. ADR-116 is scoped to the composition unit only (the thing ADR-052 got wrong).

### Patterns

- Extend the satellite that already owns the attached surface instead of creating a new one: fleet composition went into `project-switcher.md` (it already owns project registry + Board switching) rather than a fresh G6 satellite. Rejected alternative recorded with a revisit condition, not left implicit.
- Transition shims track removal conditions: `team-noun-retired` in `config/transition-shims.json` records "no caller remains" so the cutover commit is evidence-driven, not calendar-driven.
- R2/R5 scope discipline: only owners whose facts changed get touched; `docs/tasks*/` and `docs/features/` are receipts of what was decided *at the time* — their `spur team` references are historical record, not authority.

### Gotchas

- **The portable artifact is `config/config.example.yaml`**, not a doc: `init.ts` seeds it as `~/.config/spur/config.yaml` on first run, so a stale `agent.team` template block teaches the retired composition to every new install (R4). Repo-docs-only propagation is the gap portable propagation exists to close.
- `agent.team.<id>.members` still *parses* during deprecation (`packages/config` reports it via `misplacedGlobalKeys` rather than rejecting) — removal of key + noun is one cutover commit, coordinated with the shim condition.

### Wrapup drift audit (detection evidence, this run)

- Real CLI verbs (`.command()` across `apps/cli/src/commands/`) vs `04` documented surface: match; `spur team` correctly framed as deprecated with replacement table and `up`→no-verb note.
- Server `/api/team/*` routes vs `observability-contracts.md` rows: **9/9 exact parity**; web still calls `/api/team/teams` + `/api/team/processes` (fleet read path).
- All `04` → `docs/design/*.md` pointers resolve (zero missing).
- ADR-116 banners present on all four superseded satellites; `03` §14.3 names fleet.json/FleetService/modules-projects, all of which exist (`FleetService`, `spur projects list --fleet` at `projects.ts:113`).
- Frontmatter contracts for `00`/`03`/`04`: owns/authority/edit_rules/sync match constitution §4.1 verbatim in meaning; `updated_at: 2026-09-14` = last commit `e23efdaaa`. **Zero drift found — no repairs required.**
Doc-evolve wrapup complete. Drift report:

- **docs/00_ADR.md** (authority) — already repaired by task 0854 itself (ADR-042 supersession chain, ADR-086 dated amendment, ADR-116 transitive `**Supersedes:**`); verified against the diff, no further edit.
- **docs/03_ARCHITECTURE.md** — no drift: §14/§14.1/§17 already record the 0849 retirement, `mergeTimeline` deletion, and ADR-116 replacing ADR-052.
- **docs/04_DESIGN.md** — no drift: index rows for all four retired satellites already carry `superseded by ADR-116`; `spur team` deprecation block present.
- **docs/design/*** — three stale claims repaired in live docs:
  - `inter-agent-control-plane.md:24` — `mergeTimeline` row no longer "Display only until G3"; records retirement by 0849, ADR-116 supersession, and the two surviving Projects panes.
  - `inter-agent-control-plane.md:211` — Wave-3 "G3 Board un-merge (feature G3 / ADR-052)" annotated as landed via retirement (0849 deleted the merge; ADR-116 supersedes ADR-052). This closes the review's carried finding #3 on the doc-evolve surface it was assigned to.
  - `project-switcher.md:250` — plain-message consumer re-pointed from the deleted Inbox module to the Projects Conversation tab.
- Checked and deliberately untouched: `cli-contracts.md:460` (`team up` still materializes via shared `materializeRoster` under the deprecation shim — accurate), `data-output-contracts.md:26` (inert reserved draft), feature/task receipts (CLI-gated corpus, out of scope), `board-ui-layout-and-global-agent-bar.md` (A7 draft, not implicated by 0854's authority changes).

Verification: `bun test apps/cli/tests/adr-supersession.test.ts` → 7 pass / 0 fail / 69 expect on the post-wrapup tree. Artifact written to `.spur/run/e19046ce-b73b-4d79-8186-c12134465c80-wrapup-learnings.md`.

# Wrapup learnings

## 2026-09-14

### 0854 — Retire the team-scoped ADRs the fleet model replaced

**Conventions (ADR corpus)**

- Supersession is a status-line edit, never a rewrite: `- **Status:** Superseded by ADR-116 (via ADR-052)` — live authority first, the single-hop chain parenthesized so transitive retirements stay readable. The replacement ADR must name the full set (`**Supersedes:** ADR-052 (and ADR-042 via it)`) plus a `**Retains:**` line so live neighbors are not swept up.
- A decision that survives with stale framing gets an additive dated amendment (`**Amendment (YYYY-MM-DD · ADR-116 / task 0854):**`), not a supersession — superseding a live decision to fix a stale example misstates the corpus (ADR-086's three-layer taxonomy was fine; only its roster carrier moved to `.spur/fleet.json` + `FleetService.materialize`).
- Retired design satellites get a `> **Superseded (ADR-116).**` banner right after frontmatter naming the current surface; the body stays as the historical record (pattern already on workspace-design.md, inbox-board-module.md, board-module-boundaries.md).

**Errors fixed / review craft**

- Pass-2 review hole: the diff-additivity guard's `allowedRemovals` was broader than the change, so an Accepted-bearing status swap passed 7/7. Fix: derive removable lines only from statuses that actually moved (exactly the diff's two `**Status:**` lines).
- Adjudicate handoff mutation claims in two halves — reproduced in substance, refuted in attribution: the named witness mutation already failed pre-fix; the mutation the fix actually closes was the Accepted-bearing swap. Verify which mutation a guard really kills before repeating the claim.
- `computeProofInputFingerprint` folds only spec sections (Background/Requirements/AC/Design/Plan), not Review/Solution — writing the review report does not stale recorded gate evidence. Proved by recomputation, not assumed.
- The diff guard `(e)` is transient by construction (early-returns once committed); the durable committed-state guard is `(a)`–`(d)` + `(f)`. State that explicitly or a later reader mistakes the early return for drift.

**Gotchas**

- Compat surface is recorded, not deleted: `agent.team.*` is still live — it selects autostart members at serve boot (unioned with `SPUR_TEAM_AUTOSTART`), is accepted via `misplacedGlobalKeys`, and its removal is gated by the `team-noun-retired` entry in `config/transition-shims.json`. The cutover commit owns that deletion, not the ADR amendment.
- Feature receipts and the task corpus are CLI-gated; stale derived claims inside them (`G4` receipt, `G64` row) are recorded as findings with owners, never edited in a docs task (R5).
- Doc-evolve wrapup detection found `03`, `04`, and the retired-module satellites already reconciled; residual drift hides in *live* satellites: a non-goals row still saying `mergeTimeline` is "display only until G3", a wave table labeling a landed-via-retirement item `(feature G3 / ADR-052)`, and `project-switcher.md` naming the deleted Inbox module as the plain-message consumer. Repair is one line each, naming current authority (0849/ADR-116, Projects Conversation tab).
- `spur team up` still materializes through the shared `materializeRoster` under its deprecation shim, so `cli-contracts.md`'s description stays accurate — check code before "repairing" a true sentence about a deprecated-but-working verb.
- Wrapup verification: `bun test apps/cli/tests/adr-supersession.test.ts` → 7 pass / 0 fail / 69 expect after the satellite edits (the suite pins `docs/00_ADR.md` only; satellite edits cannot stale it).
Wrapup complete. Drift report:

- **`docs/04_DESIGN.md`** — 1 finding, repaired: "Agents roster two-fact card (0842)" didn't reflect 0853's shipped uptime line; added one paragraph (uptime via `formatUptime`/`data-roster-uptime`, running + derivable `startedAt` only; non-reinstated facets with successors; 0855 owns route+row removal). T3/§6.5; `updated_at` already 2026-09-14.
- **`docs/00_ADR.md`** — clean. Display-facet reinstatement is not a §6.1 architectural choice; ADR-116's 2026-09-14 amendments already own the fleet/successor mechanisms. No T1 entry.
- **`docs/03_ARCHITECTURE.md`** — clean (`rg` for team up/down/SupervisorTab/uptime: zero hits; §14.3's no-new-route invariant holds — uptime derives from poll data already carried).
- **`docs/design/*`** — `board-module-boundaries.md` stale-by-design (ADR-116 supersession banner, pinned at 04:75 — frozen history, untouched); `observability-contracts.md:353-355` rows match the still-present routes (`team/index.ts:250`) — accurate until 0855 removes routes + rows together; `project-switcher.md` and `inter-agent-control-plane.md` carry other tasks' uncommitted edits — collision-guarded, untouched (04 now carries the authoritative fact). Frontmatter contract-verify passed for 00/03/04.

Artifact written to `.spur/run/05e7544a-d3a3-4f79-8ed4-1130510722f3-wrapup-learnings.md`. Learnings follow.

## 2026-09-14

### 0853 — Record ownership for the retired Teams supervisor facets (uptime, live activity, team up/down) [G64, done, verify PASS]

**Pattern — derive display facets from data the existing poll already carries.** Reinstating a
retired roster facet cost one pure helper (`formatUptime` in `apps/web/src/modules/projects/roster.ts:125-145`)
plus one render line (`AgentsView.tsx:239-243`), because `RosterEntry.observed.startedAt` already
rides AgentsView's own `setInterval` tick — zero new fetch, zero new subscription, zero new state.
Before proposing any new fetch/poll for a UI fact, name the real carrier first.

**Gotcha — premise-check the requirement's named mechanism (Q4).** The drafted R3 credited
`useProjectContext` with the roster's live poll; verified against the tree it is a one-shot mount
fetch — the real tick is AgentsView's own interval (`AgentsView.tsx:126`). Auto-refine rewrote R3
to name the actual carrier. Requirements naming a mechanism should be verified against the tree,
not trusted.

**Convention — retirement needs an owner, not silence (0849 R2).** Each facet deleted with the
Teams supervisor tab got an explicit frozen decision with its successor: uptime → REINSTATE on the
Agents roster card (data already reaches the Board); live last-activity → REMOVAL recorded
(MemberDetail read-on-open history is the successor, `ponytail:` sseUrl tailing named as upgrade
path); team up/down controls → REMOVAL recorded (fleet materialization at serve start +
`spur agent stop` are the designed CLI successors, 0848). "Unreachable with no owner" is the
finding shape; "removed with reason + successor" is the fix shape.

**Convention — orphaned surfaces get routed, never silently kept or deleted in a record-only task.**
`POST /api/team/:team/up|down` (`apps/server/src/modules/team/index.ts:250,280`) has no non-test
caller repo-wide; the routes + their server tests + the `docs/design/observability-contracts.md`
rows must be removed together, and that bundle is owned by follow-up task 0855 (created via
`spur task create`, linked from References). Deletion is never smuggled into a decision-recording task.

**Gotcha — make the null case type-honest.** Design sketched `formatUptime(startedAt: string)`;
shipped as `string | null` to mirror `RosterEntry.observed.startedAt`, so AC1's no-uptime case is
encoded in the signature instead of a runtime surprise. The only sanctioned deviation from the
frozen design, recorded in the Solution.

**Gotcha — clock skew in age math.** `formatUptime` returns null for a future `startedAt` (negative
age) — otherwise clock skew renders as negative uptime. Largest two units, never seconds
(`up 4m`, `up 2h 13m`, `up 3d 1h`); injectable `now` parameter keeps tests deterministic.

**Convention — collision guard on shared docs.** `docs/design/inter-agent-control-plane.md` carries
another task's uncommitted changes — never edited here. Same rule held in this wrapup:
`docs/design/project-switcher.md` (0852's in-flight edit) was left to its owner; the authoritative
surface fact was repaired in `docs/04_DESIGN.md` (roster-card section now records the 0853 uptime
line, the non-reinstated facets with successors, and 0855's route-removal ownership) per T3.

**Convention — stale feature corpus conflicts route via tooling.** M2's feature file still demands
"Surface team Up/Down bulk controls in the Teams UI", superseded by G64; flagged via `spur feature`
tooling / operator — never a raw edit, never silently honored.

**Verification receipts.** Five new `formatUptime` cases in `apps/web/tests/modules/projects/roster.test.ts:177-199`
(20 pass / 0 fail); `bun run spur-check` PASS; rg-guards held: no new fetch/subscription in the
roster path, Projects still exactly three tabs (`tabs.tsx` absent from the diff).

**Wrapup doc repair (this run).** `docs/04_DESIGN.md` "Agents roster two-fact card (0842)" was
stale against the shipped uptime line — repaired with one paragraph (T3, §6.5). Clean findings:
`00_ADR.md` needs no entry (display-facet reinstatement is not a §6.1 architectural choice; ADR-116
amendments already own the successor mechanisms); `03_ARCHITECTURE.md` has zero stale up/down /
SupervisorTab references and §14.3's no-new-route invariant still holds; `board-module-boundaries.md`
is stale-by-design under its ADR-116 supersession banner; `observability-contracts.md` rows still
match the live routes until 0855 removes routes + rows in one commit.
Drift audit complete (detection-backed). Task batch = 0855 only.

**Findings & repairs**

| Doc | Finding | Repair |
|---|---|---|
| `docs/04_DESIGN.md:147` | "`up` has no CLI verb at all" — literal contradiction: `spur team up` still registered (deprecated+running, `apps/cli/src/commands/team.ts:106`) | Reworded → "no replacement verb at all" |
| `docs/04_DESIGN.md` frontmatter | v1.74.0 set at `e23efdaa` *before* the task's uncommitted surface edit (§4.3) | Bumped → 1.75.0 |
| `docs/design/observability-contracts.md` | Route rows vs code: 7 = 7 exact match (only prose wildcard `/api/team/*`) | Clean — task already removed the 2 rows |
| `docs/00_ADR.md`, `docs/03_ARCHITECTURE.md` | ADR-116/052 supersession recorded (`a1c647eae`/`7db3fb9ba`); 03 names only surviving routes | Clean — no edit (placement guard: task work stays out of ADRs) |
| `docs/design/cli-contracts.md` | Deprecation banner present (`:523`); up/down bullets accurate (CLI materializes via TeamService, best-effort via surviving routes) | Clean |

No task/feature corpus writes. Artifact written to `.spur/run/6c11f7e9-4f2b-4d57-b00f-11b01ead1faf-wrapup-learnings.md`. Note: working tree still holds 0852 in-flight files (untouched, out of this wrapup's scope).

# Working Learnings — wrapup run 6c11f7e9 (tasks: 0855)

## 2026-09-14 → 2026-09-15

### 0855 — Remove the orphaned POST /api/team/:team/up|down routes (feature G64, done)

Conventions & patterns

- Dead-surface removal contract: plain removal → Hono default 404. No 410 tombstone, no alias, no shim when zero callers exist (0853 R4 repo-wide audit); shims require an objectively checkable removal condition (0849 precedent, reaffirmed in 0855 Q3).
- Capability ≠ surface: `TeamService.materializeTeam` / `teardownTeam` stayed while their HTTP routes died — the deprecated `spur team up|down` CLI verbs call them directly (`apps/cli/src/commands/team.ts:492,537`). G64 R4: a capability must stay reachable until the noun itself retires at the recorded cutover; the shim-removal condition owns that sequencing, not the route cleanup.
- Test removals re-anchor by describe header text, never line number; stub fields used only by removed tests are trimmed only when typecheck/lint flags them (conditional trim, not preemptive).
- T3 same-commit discipline held: the two `docs/design/observability-contracts.md` rows (`:353-354`) were deleted in the same changeset as the route handlers; table rhythm preserved (teams row flows into health row).
- Executable evidence where no standing test exists: live-mount check (`teamModule.mount` + Hono `fetch`, `.tmp-0855-404.ts`) proving both removed paths 404 — a one-off probe script as verify evidence.
- Grep-audit carve-outs are part of the AC: `rg "team/:team/up|team/:team/down"` excluding `docs/tasks*`, `docs/features*`, and ADR/history receipts; remaining hits must be disposition-aware, not silent.

Errors fixed & gotchas

- AC4's literal "zero hits" is carve-out-scoped: `CHANGELOG.md:2069` (immutable historical release note) and `docs/04_DESIGN.md:415` (explicitly records the removal) legitimately remain — both P4 advisories, neither implies live surface. Don't "fix" historical records when sweeping for stale references; sweep with the receipts excluded.
- No standing negative test covers the 404 fall-through after the route describes were removed (review P4). Add one only if the corpus later demands executable coverage for removed paths.
- Pure-deletion diffs still need the conditional-trim check: `tsc --noEmit` + `biome lint` on the touched files proved no orphaned imports/stubs (54 deleted lines in the module, 274 in tests, 0 insertions anywhere).

Wrapup doc-evolve repairs (this run, 2026-09-14)

- `docs/04_DESIGN.md:147` said "`up` has no CLI verb at all" while `spur team up` is still registered (`apps/cli/src/commands/team.ts:106`) — deprecated but running. Literal drift against code and against the same sentence's "all six verbs still run"; reworded to "no replacement verb at all".
- 04 frontmatter was last bumped at `e23efdaa` before the task's uncommitted surface edit; per §4.3 bumped version 1.74.0 → 1.75.0 (`updated_at` already 2026-09-14, today locally).
- Parity check backing the clean report: 7 code routes (`index.ts:41,77,88,99,120,213,250`) exactly match the 7 contract table rows in observability-contracts.md; the only extra string is the prose wildcard `/api/team/*` in the intro sentence, not a row.
- Clean (no repair): `docs/00_ADR.md` (ADR-116/ADR-052 supersession already recorded in `a1c647eae`/`7db3fb9ba`; execution work is placement-guarded out of ADRs), `docs/03_ARCHITECTURE.md` (only surviving routes named), `docs/design/cli-contracts.md` (deprecation banner at `:523`; up/down bullets accurate — CLI materializes locally via TeamService, best-effort start/stop via the surviving `/api/team/agents/:id/*` routes).
## 2026-09-15 — G65 batch (tasks 0856–0861), feature `G65` "Fleet declaration in spur config"

### 0856 — deleting a service can red the gate through coverage, not tests

- Bun's `coverageThreshold` in `bunfig.toml` is enforced **per file** (0.9 functions / 0.9 lines).
  Deleting code that was the *only* coverer of a surviving file drops that file below the floor, and
  `bun test` then exits 1 while printing `0 fail` and **no diagnostic**. The only signal is the
  coverage table in the log (`.spur/run/<wbs>-test-gate.log`); `--findings` stays empty, so the fix
  hop gets a log, not a finding.
- Here the orphaned coverer was `readAddressedSpecIds` in `packages/domain/src/dao/addressed-spec-ids.ts`
  (its only caller was the deleted CLI wiring; its only test was the deleted `legacy-migration.test.ts`).
  The right repair was deleting the now-consumerless export, not adding a test for dead code.
- `spur task record` copies the verdict's evidence strings verbatim into `## Testing`, so bare
  basenames (`loader.ts:337`, `serve.ts:620`) become `L4 Testing: Stale line anchor` warnings. Cite
  repo-relative paths (`packages/config/src/loader.ts:337`) all the way through the answer artifact.

### 0857 — a requirement can be "met" by a placeholder

- R5 said `MemberDetail` renders "the work dir and model from the fleet snapshot". The work dir was
  wired; the model rendered the constant `Executor default`, because `ResolvedFleetMember` carried no
  model while the *retired* feed had surfaced `spec.config.model`. Tests were green and the gate was
  green. Only an independent review found it, and an independent verify confirmed it.
- Lesson: when a requirement names a data surface, verify the data *source* end to end — a rendering
  fallback can make an unimplemented requirement look implemented.

### 0858 — the size precheck cannot see this corpus's requirements

- `task-size-precheck.ts` reported `PASS — 0 R-items, 0 Plan items` for a task with seven requirements
  written as `- **R1** — …` bullets and a five-item `### Plan`. The heuristic that should have forced
  a reviewer-tier executor ("> 6 requirements or ≥ 9 plan items → reviewer, or split") never fires, so
  an oversized task enters implement and dies at the 30-minute host limit — twice, across 42 files and
  six workspaces.

### 0858 / 0860 — the 30-minute dispatch ceiling is a real budget, not a formality

- Multi-workspace implementation (`packages/config` + `packages/app` + `apps/server` + `apps/cli` +
  `apps/web` + docs) does not fit one dispatched implement pass on this platform.
- Observed sequence ×2: dispatch → timeout with a half-migrated tree → resume (same budget) → timeout
  again at the next workstream. The runbook's remedy (stop and record rather than raise the budget
  without sign-off) is correct; the cheapest *recovery* once the tree typechecks is host completion of
  the remainder, because the gate plus the independent review/verify stages still certify the result.
- Practical guidance for the next batch: order the pass so code workstreams land before docs, run the
  gate once at the end, and instruct the implementer to stop at a coherent boundary and report rather
  than be killed mid-file.

### 0860 — a module move can break a consumer that every test covers

- Moving `/api/team/processes` to `/api/processes` dropped the `teamId` key from the payload. The web
  `parseExecutions` requires the key to be present (`null` or string); absent → the whole response is
  rejected and the Processes tab never leaves its loading state. **All tests stayed green** because
  the web fixtures still carried `teamId: null`.
- Lesson: when a route moves, pin the response **key shape** in a server test and feed the *real*
  payload into the *real* client parser. Fixture drift hides wire-contract breaks.

### 0860 / 0861 — two independent stages catch what a green gate cannot

- Both the review and the verify stages independently reproduced the `teamId` break by driving the
  real parser with the real route output; the gate was green throughout.
- Both flagged the help-diagram `TeamSvc` phantom node, which no checker parses (the `help-doc-parity`
  test compares flag sets; nothing renders mermaid). Derived/rendered surfaces are gate-invisible —
  and a name-based sweep lens cannot see a stale label that isn't itself a retired name.

### Corpus — the AC format decides whether coverage is machine-checkable

- The feature-scoped strict preflight (`spur feature check <id> --strict`) is the only place
  `L4.uncovered-feature-scenario` fires, and it aborts a `--feature` batch. It fired for all eight G65
  scenarios because every task stated criteria as prose (`**ACn — …**`) with no `Scenario:` block.
- Fix shape: each task carries the feature's own Gherkin scenarios (titles byte-identical) above its
  task-local rows. Assignment came from each task's existing Background claim plus its requirement
  text — 0856←R5, 0857←R2, 0858←R1/R2/R3/R8, 0859←R4, 0860←R6, 0861←R7.
- A single-line `- **ACn — …** Given …` bullet is **not** machine-declarable: `verify-answer-lint`
  warns that the id matches no task AC label. The parseable forms are a whole-line bold paragraph
  (`**ACn — title**` with the prose on the next line) or a checklist row; the remediation hop's
  answers had to cite either the verbatim scenario title or a short `**ACn` token.

### Harness — engine-only action kinds on the inline path

- `proof.fingerprint` and `run.artifact` are engine built-ins with no CLI surface (ADR-051). The
  faithful inline implementation is a **repo-only scratch script** that imports the app's own
  `computeProofInputFingerprint` and passes the same option set (`cwd`, `taskContent`, `featureContent`)
  — no digest logic reimplemented — plus the documented registration-equivalent check for
  `run.artifact` before `spur task record`.
- The inline run identity comes from `plugins/sp/scripts/inline-run-setup.ts`
  (`<runtime> <mainModule>` form of `spurBin`, i.e. `bun <tree>/apps/cli/src/index.ts`), which also
  gives the `__definitionDigest` that the record-time proof block must match.

Wrapup complete.

**Drift repairs applied** (skill `sp:doc-evolve`, §7.2 auto-repair; docs only — no corpus writes):

| File | Repair |
| --- | --- |
| `docs/00_ADR.md` | frontmatter `1.45.0/2026-09-14` → `1.46.0/2026-09-16` (ADR-117/118/119 content landed without bump) |
| `docs/03_ARCHITECTURE.md` | NEW §27 "Workflow Execution Economy" (compact, §6.4 style: trace parity, stage contracts, gate scope, promotion gate) + `1.47.0` → `1.48.0` |
| `docs/04_DESIGN.md` | frontmatter `1.75.0/2026-09-14` → `1.76.0/2026-09-16` (content already synced) |
| `docs/design/event-tracking.md` | §4 matrix 74/74 → 75/75; added row 75 `workflow.agent.contract-violation` (0870) |
| `docs/design/system-events-human-table.md` | dropped retired `workflow.action.start` from operator + test pins (0869 alias collapse) |

Verified: links resolve, `00:1750` alias mention is ADR-117 decision history (preserved), no residual stale counts. `docs/design/workflow-execution-economy.md` was already current. Artifact written to `.spur/run/27010e57-a163-4258-a4b8-cc7825714cd2-wrapup-learnings.md`.

# Workflow Execution Economy — batch learnings (feature D62, tasks 0866–0875)

Date: 2026-09-16 (all tasks done; commits bc8e52739..de8a43dbe)

## Cross-cutting conventions

- Workflow stage economics, not graph shape, drive machine time: `agent.run` is ~96% of workflow machine time. Every change in the batch was judged by its effect on `agent.run` count/duration, not node count.
- One action boundary keeps exactly one start name and one finish name. Alias pairs (`workflow.action.start`/`.done`) were retired in favor of the verb-form names existing consumers already read (`workflow.action.started`/`.finished`); retired matrix rows stay as strikethrough audit trail.
- The trace is the record of truth; run logs are a human convenience. A structured action trace (`action_runs` row + start/finish `system_events` pair) is owed by whichever surface executes the action — engine subprocess or inline host-session driver alike (trace parity).
- Doc comments in source are contract records: when a digest deliberately excludes a field or a command narrows scope, the WHY lives in the adjacent doc comment (`packages/app/src/services/task-readiness.ts:389`, `scripts/commands/*`) and in the owning design satellite, same commit.
- Census guards track definition counts: `plugins/sp/tests/inline-pipeline-parity-check.test.ts` went 11→8 after 0866 retirements, 8→9 after 0872 added `feature-verification.yaml`.
- Guards keep ≤5 logical commands (composition-gate warn band, zero error-level findings). Named status captures (`gate_status="$(cat …)"`) reduce command counts and read better than repeated inline `$(cat … 2>/dev/null)`.

## Patterns that worked

- Fail-closed status guard (0872): the shell command always exits 0 and writes a status file; the transition guard reads it, so missing/corrupt/FAIL fails closed. Verdicts come from the status, never from command exit codes.
- Parity-by-execution (0874): after refactoring guard predicates, run pre-refactor (baseline fixture) and post-refactor commands against the same recorded var/artifact state cross-product and assert identical routing decisions — executed proof, not inspection.
- Third outcome, not a boolean (0870/0871): a violated `agent.run` post-condition is `contract-violation`, distinct from executor failure, because the executor-failure payload carries no discriminator. Routing distinguishes them at the transition `trigger`.
- Opt-in guards (0871): the `contract-violation` guard is inert unless the definition declares a `contract-violation`-guarded edge; existing definitions unchanged.
- Repair states are cheap and shell-only (0871): a repair edge must not re-dispatch the full stage on its first attempt — the pilot `repair` state records the miss with no `agent.run`. `onError: continue` on the action lets a clean-exit contract miss reach the guards instead of halting.
- Promotion bar as data (0873): promote a candidate only when it projects strictly fewer `agent.run` actions than the canonical declares, citing measured real-run count/duration from `action_runs`/`runs`; `resolve --decision promote` refuses until the canonical actually carries the count. Zero-`agent.run` runs count 0 with an unmeasured (null) duration.
- Smaller honest diff over contract preservation (0875): Option B (unbind `dependencies` from `computePlanningDigest`) beat Option A (move deps application into the pipeline state) because B satisfies idempotence for free and the only digest consumer is also the only writer of the field — a bound value can never signal drift there.
- Shadow-run then delete (0873, ADR-076 amendment): candidate graphs are shadow-run against recorded real-run inputs and promoted or deleted by a named deadline recorded at creation — never a standing `<name>2.yaml`.

## Errors fixed / gotchas

- 0866: retiring definitions (`basic`, `docs-pipeline`, `feature-dev`) required a compatibility surface for batch runs still referencing them; `wrapup-solo` was added in the same change. Real-run evidence: dogfood execution 8 `agent.run`s/run vs 10 inline; mean duration 72.6s vs 48.3s.
- 0867: workflow progress moved to the `runs`/`action_runs` projection (`projectWorkflowProgress`, `run-progress.ts:99`); the `planningWorkflowProgress` table is retained only for retired v1 writers — do not read it for current state. CLI reads the `workflow_progress` view.
- 0868: nested `agent.run` dispatch needs `trigger_run_id` correlation so the trace keeps one boundary = one start/finish pair even when a stage dispatches another action.
- 0869: event renames must update consumer-facing docs and test pins the same commit; the alias collapse left two stale `workflow.action.start` pins in `docs/design/system-events-human-table.md` (operator + test pins) — repaired in this wrapup.
- 0870: `workflow.agent.contract-violation` was missing from the event-tracking 5W1H matrix (claimed 74/74) — repaired to 75/75 in this wrapup; emitters `agent-run.ts:36` (`contractViolation`) and `observability.ts:272` (event map).
- 0872: the adr-supersession test was repo-wide, not task-local — relocated to `repo-wide-tests/` (not rewritten), fixing its repo-root anchor in the move. A per-task pipeline must not host a check that can fail for a reason the current task did not cause (ADR-119 scope rule).
- 0874: the 455-character `verify → record` jq predicate was the legibility floor; one `and`-clause per line plus renamed capture (`V` → `verdict`). Proof-chain test assertions needed updating because they pinned definition text, not just behavior.
- 0875: binding `dependencies` into `computePlanningDigest` made every dep application look like drift (digest stale → refine degradation). The forbidden fix (rebinding the digest after deps) would mask all other post-preparation changes — kept the independent ready-checklist/checker coverage instead.
- Wrapup itself (this session): the batch landed 00/03/04 content without bumping frontmatter version/updated_at, and 03 had zero coverage of the new invariants — added compact §27 "Workflow Execution Economy" (ADR-117/118/119 + ADR-076 amendment) per constitution §6.4 style. Drift in doc-sync batches concentrates in frontmatter metadata, audit matrices, and naming pins — check those three specifically.
Drift audit complete per sp-doc-evolve §7. Two real drift findings, both repaired; five surfaces verified clean with the detection commands that produced zero delta. Batch task list resolved to WBS **0871** (only entry in the normalized capture).

**Drift report**

| Doc | Code says | Doc said | Authority | Repair |
|---|---|---|---|---|
| `docs/design/workflow-composition-contract.md` | Per-action `onError: fail\|continue` shipped in both dialect schemas (0871: `state-machine-workflow.schema.json:165`, `transition-flow-workflow.schema.json:144`) | `softFail` bullet claimed the schema "exposes no `onError`" | 03 §20.2 points here for exact shapes | Bullet rewritten: both knobs documented, `softFail` keeps the `resultFile` guarantee |
| `docs/design/workflow-execution-economy.md` | `contract-violation` routing shipped (guard builtin at `builtins.ts:77`, pilot edges in `wrapup-pipeline.yaml`, event at `event-tracking.md:121`) | §3 in proposal tense ("Today … indistinguishable"); header `Status: proposed` vs Accepted ADR-117/118/119 | ADR-118 is authority; this is its declared detail target | §3 moved to shipped state with the opt-in mechanism + 0876 handoff; status split honestly (§5 gate still pending on 0873/0876) |

**Clean (no repair):** `docs/00_ADR.md` ADR-118/119/120 · `docs/03_ARCHITECTURE.md:1038-1041` · `docs/04_DESIGN.md` index rows · `docs/design/event-tracking.md` · `docs/design/workflow-run-log.md`.

**Out-of-scope note (not committed):** the same false "no `onError`" claim also lives in a code comment at `packages/app/src/workflow/actions/command-gate.ts:46` — needs a code change, not a doc edit.

No task/feature corpus writes. Diff: 2 files, +22/−12. Artifact written to `.spur/run/fadca099-25a7-4884-a4ae-923cd0239775-wrapup-learnings.md`.

# Working learnings — wrapup run fadca099 (batch: task 0871)

## 2026-09-16 — Task 0871 (feature D62): route a contract violation to a repair edge, piloted on wrapup-pipeline

### Conventions

- New workflow guard kinds register as Spur builtins on the workflow host: `ContractViolationGuardRunner` (`packages/app/src/workflow/guards/contract-violation.ts:19`) registered at `packages/app/src/workflow/builtins.ts:77`. The guard passes iff the prior action's `data.outcome === 'contract-violation'` and reports `contract`/`observed` for the trace.
- Dialect parity is a same-commit rule: a new action-level capability (`onError: fail | continue`) lands in BOTH dialect schemas — `apps/cli/schemas/state-machine-workflow.schema.json:165` and `apps/cli/schemas/transition-flow-workflow.schema.json:144` — plus the inline-driver parity set (`plugins/sp/scripts/inline-pipeline-parity-check.ts:46` gains `action-ok` and `contract-violation`) and the driver reference (`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:28`).
- New outcomes are opt-in and inert by default (R4): a graph changes behavior only when it authors a `contract-violation`-guarded edge; definitions without the edge are unchanged.
- Evidence vocabulary stays layered: routing decisions are distinguished at the transition `trigger` (`contract-violation` vs `executor-failure`) alongside 0870's `workflow.agent.contract-violation` run-log line, with the action trace carrying an `outcome`/`contract`/`observed` triple.
- ADR-118's repair constraint shapes the graph: the repair edge must not re-dispatch the full `agent.run` stage on its first attempt — the pilot's `repair` state (`config/workflows/wrapup-pipeline.yaml:222`) is a cheap shell that only records the miss, and `learnings-append` was moved out of `doc-sync` into its own state so the append cannot be blamed for the stage's failure.

### Errors fixed

- `doc-sync` `agent.run` previously hard-failed the whole wrapup run on a clean-exit contract miss; the pilot hop now declares `onError: continue` (`config/workflows/wrapup-pipeline.yaml:182`) so transition guards read the result and route: contract violation → shell-only `repair`, success → `learnings-append`, executor failure → existing `failed` routing (trigger `executor-failure`).
- A false schema claim ("the shipped action schema exposes no `onError`") had propagated into two surfaces: `docs/design/workflow-composition-contract.md` (the `softFail` bullet) and a code comment (`packages/app/src/workflow/actions/command-gate.ts:46`). Once 0871 added `onError`, both became false. The design doc was repaired in this wrapup run; the code comment is flagged as out-of-doc-scope residue for a follow-up code change.

### Patterns

- Name the failure population before routing it: 0870 made the contract violation a distinct, traceable stage outcome; 0871 routed it. Splitting the work keeps executor-failure retry semantics untouched (ADR-118's rejected alternatives: merging stages raises per-failure cost; finer FSM states change when a failure is observed, not what it costs).
- Promotion discipline (ADR-076 amendment): the pattern spreads to other `agent.run` stages only after task 0873's promotion gate consumes measured real-run data — never synthetic fixtures (R5).

### Gotchas

- A "real-run evidence" acceptance conjunct is structurally unverifiable in the same task that ships the edge: no real contract violation can occur before the edge lands. The verify verdict was recorded honestly as PARTIAL (exactly one conjunct) in `.spur/run/0871-verdict.json` — not rewritten to PASS — and the task closed via the documented F6 provenance override with the partial recorded in `done_reason`.
- The outstanding conjunct has a named owner: task 0876 records the pilot's first real-run routing decision and feeds the measurement to 0873's promotion gate. If the F6 closure call is wrong, revert 0871 to `testing` and let 0876 carry R5.

## 2026-09-17 — Doc-drift wrapup over the 0871 surface (this run)

- Drift found and repaired: `docs/design/workflow-composition-contract.md` `softFail` bullet asserted the action schema "exposes no `onError`" — false since 0871; rewritten to describe both knobs (`softFail` keeps the gate-specific guarantee that `FAIL` reaches `resultFile`; `onError: continue` is the general per-action routing path).
- Drift found and repaired: `docs/design/workflow-execution-economy.md` §3 still spoke in proposal tense ("Today … indistinguishable in the trace") after the routing shipped; rewritten to shipped state with the opt-in mechanism, pilot pointer, and 0876 handoff. Frontmatter `Status: proposed` contradicted Accepted ADR-117/118/119; updated to in-flight split (§2/§3/§4 shipped via 0870–0872; §5 promotion gate pending on 0873/0876 evidence).
- Verified current, left untouched: `docs/00_ADR.md` ADR-118/119/120; `docs/03_ARCHITECTURE.md:1038-1041` (ADR-118 summary names `contract-violation`, the repair edge, and the wrapup pilot); `docs/04_DESIGN.md` index rows (economy, run log, composition contract); `docs/design/event-tracking.md:121` (`workflow.agent.contract-violation`, added 0870); `docs/design/workflow-run-log.md` (sink/marker-level contract, no line-kind catalogue to extend).
- Audit method that paid off: grep the exact change surface (guard files, schema diffs via `git log -S`, task anchors) against the docs that point at them (ADR "Detail:" targets, `03` "Exact shapes live in" pointers, `04` index rows) — every finding was a code-reality vs. doc-claim contradiction with a file:line on both sides; no speculative rewrites.
**Wrapup complete.** Batch = task 0898 only. Drift audit found 3 defects, all repaired (diff: 3 files, +5/−5):

1. `docs/design/session-pinned-dispatch.md:80` — bullet described resumeById:false as unconditional "fresh per stage + `executor-no-resume` warning"; the token is phantom (source grep: doc-only hit) and 0898 made resume-only `continue` fail pre-spawn as the ADR-118 violation. Rewritten to shipped behavior (`session: 'fresh'`, `__agentSession: 'no-resume'` sentinel, pre-spawn gate, with-input carve-out).
2. `docs/00_ADR.md` frontmatter — ADR-121 landed 09-17 (cf44cbefa) but `updated_at` said 09-16; refreshed + 1.46.0 → 1.47.0 (§4.3).
3. `docs/04_DESIGN.md` frontmatter — same commit added the index row; refreshed + 1.76.0 → 1.77.0.

**Clean:** `docs/03_ARCHITECTURE.md` (ADR-118 invariant block consistent, dates match last touch); `docs/design/planning-workflow-contracts.md` was already correct from 0898's same-commit T3 edit; 04 → satellite anchors resolve. No task/feature corpus writes. Verification: `git diff` surgical; frontmatter dates ≥ content commits; no rule owns these files.

Artifact written to `/Users/robin/xprojects/spur-new/.spur/run/cad76019-a5e7-4789-b527-0c95aba762e8-wrapup-learnings.md`:

# Wrapup Learnings — run cad76019 (batch: 0898)

## 2026-09-17 — Task 0898: Harden capability gating boundaries and coverage (B8)

### Conventions

- Reuse the B8 R4 pair (`evaluateSessionCapabilities` + `AgentRunActionRunner.contractViolation`) for any new session-capability gate — never introduce a new `ContractName` or error shape (`agent-run.ts:41` owns `'requiresCapabilities'`).
- Capability gating stays in the action runner, not `AgentService` — boundary integrity; the service remains dispatch-only.
- Fail closed **pre-spawn**: name the missing axis before any subprocess (`runTraced` unreached), citing ADR-118 and the agent label; carry the record's `note` in `gate.reason` for operator diagnosis.
- Unknown-agent fail-open (`sessionCaps === undefined`) is a documented design invariant — every change to the gate carries an explicit regression guard for it.
- Test literals byte-match implementation strings (copy-literal-strings rule): assertion literals are copied from `capability-attestation.ts`, not paraphrased.
- T3 same-commit discipline: an `agent.run` contract behavior change ships with its owning satellite sentence in `docs/design/planning-workflow-contracts.md` (session-axis paragraph) in the same commit.

### Errors fixed / gotchas

- Design-to-implementation drift on the doctor selector: Design named `agent doctor coder` for text mode, but a **role** selector renders `renderRoleLadder`, which has no CAPS column — the CAPS cell with the `⚠` staleness suffix lives only in full-mode `renderDoctorTable`. Fixed by reading full mode in text tests; JSON mode keeps the role selector (returns `capabilities`/`capabilityStale` per agent).
- Design prose drift on the happy path: pass-case `reason` was said to name the agent, but the implementation returns `reason: ''` with the agent named in `observed`. Resolved toward the implementation per the copy-literal rule; no code change.
- Parallel-work hazard: B6/0893 owns `packages/app/src/services/agent-service.ts` in another worktree — this task kept zero diffs on that file and header-locates the CAPS column (robust to new columns) instead of fixed column indices.
- Gate ordering matters: the pre-spawn check must precede both the input guard and the `flags.continue` suppression; strict `continueFlag === true` is load-bearing — the session latch can never reach the branch because the latch itself requires `resumeSupported` (`agent-run.ts:291`), so only explicit `continue: true` gates.
- Red→green confirmed: R1(a) (gemini + `continue` + no input) failed before the fix and passed after — the test encodes WHY (no prompt exists to fall back to).

### Patterns

- Decision-table coverage for capability evaluators: no session axis / all true / declared false + note / missing record / multi-miss joined with `; ` in `SESSION_CAPABILITY_AXES` order, plus parser acceptance of all four session axes.
- Real-CLI subprocess harness over mocks for surface tests: frozen text assertions (header-located CAPS cell, `r✓`…`⚠`) + JSON object assertions (`verifiedAgainst`, `supportsResumeById`, `capabilityStale`) + byte-identical stderr invariant (diff adds lines only).
- Cheapest guard shape: one pure-function call on an already-failing path — zero happy-path cost, no new state.

## 2026-09-17 — Doc-evolve wrapup (drift repairs over 0898's surface)

- Phantom token gotcha: `docs/design/session-pinned-dispatch.md` described a per-run warning `executor-no-resume` that exists **nowhere in source** (`rg` across `packages/ apps/ config/` → doc-only hit). Detection-before-repair: grep the token before documenting/repairing around it. Bullet rewritten to shipped behavior: fresh dispatch with `session: 'fresh'` + `__agentSession: 'no-resume'` sentinel; resume-only `continue` fails pre-spawn as the ADR-118 violation.
- Frontmatter staleness is real drift: commit cf44cbefa added ADR-121 (00, 31 lines) and a 04 index row on 09-17 but left `updated_at: 2026-09-16` — §4.3 requires refreshing `updated_at` and bumping the minor version when content changes. Check `git log -1 -- <doc>` against frontmatter dates at wrapup.
- Authority ordering held: `planning-workflow-contracts.md` (agent.run contracts owner) was already correct from the same-commit T3 edit; only the conflicting projection (`session-pinned-dispatch.md:80`) and the metadata blocks (00, 04) needed repair. `docs/03_ARCHITECTURE.md` clean — its ADR-118 invariant block and dated frontmatter needed no edit; unchanged owners get no ceremonial edit.
Wrapup complete.

**Doc-evolve repairs** (detection-backed, §7 protocol; 2 files changed, no corpus writes):

- `docs/design/session-pinned-dispatch.md` §5 — the design-time sketch table ("to be verified, LOW confidence `?`") contradicted the shipped `ts-ai-runner@0.4.68` record (sketch said codex `resumeById: false`; 0888 shipped `true` via `exec resume <id> <prompt>`). Replaced with the landed record; upstream record named SSOT.
- `docs/design/cli-contracts.md:471` — dangling `ADR/0127` citation (no such ADR; born in renumbering commit 5f4b7a33a) → repointed to `agent-doctor-inspection-surface.md` §4, the real owner of the liveness-only auth gate.
- Clean: `00` (ADR-121 generic and accurate — 0899 is a refinement, not a reversal), `03` (no stale statements; `≥0.4.57` floor holds), `04` (all anchor pointers resolve; unchanged index = synchronized), `cli-contracts.md` capability section (0899 wording already landed).
- Verification: `git diff --stat` shows only the two design files; superseded strings confirmed gone.

Learnings for tasks 0888/0889/0899 extracted below and written to `.spur/run/2778f031-68de-4729-be9a-6ab2f11364db-wrapup-learnings.md`:

# Wrapup learnings — run 2778f031 (doc-evolve wrapup + tasks 0888/0889/0899)

## 2026-09-18

### 0888 — ts-ai-runner `AgentSessionCapability` extension + 0.4.68 release (B8, P1, done)

Conventions / patterns:

- Extend a shared type in place rather than adding a parallel type: the accessor (`getAgentSessionCapability`) and every Spur consumer already import `AgentSessionCapability`; a second type would need a second accessor and a merge rule (`docs/design/session-pinned-dispatch.md` §5).
- Capability-matrix contract: every `false` row carries a `note`; unverifiable rows are `false` + `verifiedAgainst: 'unverified (CLI not installed)'`, never guessed `true` — the matrix exists to stop silent degradation.
- `verifiedAgainst` is a plain raw CLI-version string, so Spur can compare it without a runner-side semver/date model.

Errors fixed / gotchas:

- Lockstep upstream releases: ai-runner 0.4.68 declares sibling `ts-*` packages `^0.4.68`; leaving Spur's sibling pins at 0.4.67 produced duplicate ts-infra copies and a nominal `EventBus.syncHandlers` type clash in `packages/app` typecheck. Fix: align all eight `workspaces.catalog` pins + root dep in the same change, then `bun install` to move `bun.lock`.
- Release order that worked: upstream feat commit → release commit + npm tag `@gobing-ai/ts-ai-runner-v0.4.68` + CI green → Spur catalog pin bump → runtime smoke (`getAgentSessionCapability('codex')`, `getPromptCommand({sessionId})` argv).

### 0889 — Spur consumes the record: affinity, doctor `--json`, attestation, stale warning (B8, done)

Conventions / patterns:

- Record-driven affinity: no agent-name conditionals on the resume path; canonicalize via `resolveAgentName`; `supportsResumeById: false` suppresses the resume latch, `flags.sessionId`, and `flags.continue`; result records `session: 'fresh'` and writes `__agentSession: 'no-resume'` with no `__agentSessionId` so downstream steps never arm a latch against an incapable agent (0406 exit-2 fallback stays as the safety net for record-unknown binaries).
- Attestation extends in place: `SESSION_CAPABILITY_AXES` in `packages/config` (4 session + 4 execution axes = 8-token vocabulary); `evaluateSessionCapabilities` fails closed — a `false` row or missing record satisfies neither `available` nor `enforced`; gate runs BEFORE any spawn and returns the ADR-118 contract-violation outcome naming executor + axis.
- Defense-in-depth: the per-attempt capability gate in `agent-service.ts` also evaluates session axes, so an escalation cannot land on an incapable executor (exit 2 pre-spawn).
- Doctor surface: `DoctorRow.capabilities` (record verbatim, `note` included) + `capabilityStale`; compact `CAPS` column `r✓d✗s✓o✗` with `—` for runner-unknown binaries; JSON stays stderr-clean while text mode warns.

Errors fixed / gotchas:

- Task-text discrepancy rule: design prose said "two enum members" but R4 listed four session axes — requirements win; all four admitted.
- Behavior-encoding tests must track upstream record changes: the 0451 codex second-hop test needed an annotation because codex became resume-capable post-0888.
- Guarded resolution (`try/catch` around executor `resolve`) keeps legacy behavior for test fakes without a `resolve` method.
- Do not assert "no warning on stderr" broadly in host-real doctor tests — any host whose installed CLI version legitimately differs from the record would warn and fail (0899 Q3 kept the narrowed usage-scoped form).

### 0899 — doctor capability-staleness compares version cores (B8, P3, done)

Conventions / patterns:

- Compare contract: normalize both sides with `VERSION_CORE = /\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?/` and string-compare cores; no semver ordering, no semver dependency — works for date versions (`2026.6.11`). Branding decorations (`2.1.274 (Claude Code)`, `codex-cli 0.154.0`, `omp/18.2.3`) are not drift.
- Token-less values (`unverified (CLI not installed)`) extract no core → `capabilityStale: null`, never warns: unverifiable is neither fresh nor stale, and only an upstream re-verify can act on it.
- Root-cause fix lives in the shared `sessionCapabilityFor`, not at rendering call sites — one guard covers table, detail, role-ladder, and JSON.
- Test versions derive from `getAgentSessionCapability` instead of hard-coded strings, so upstream re-verification doesn't break tests.
- Supersession discipline: 0899 Q1 explicitly supersedes 0889's design line "no semver parsing — a mismatch of any kind is worth a warning" and records why (exact compare was the bug; informational-only mismatch buries real drift; token extraction is not semver ordering).

Errors fixed / gotchas:

- Exact string compare warned on nearly every host; the doubled binary name in the warning text was the visible symptom users reported.
- A concurrent refine superseded this task's own earlier Solution draft ("exact-compare fallback") mid-flight — implemented null-on-missing-core instead; the conflict note is recorded in the task Solution.

### doc-evolve wrapup (this run) — drift report

Findings and repairs (detection: `rg` over real CLI/config surface, shipped record read from installed `@gobing-ai/ts-ai-runner@0.4.68`, anchor resolution, frontmatter vs `git log`):

- `docs/design/session-pinned-dispatch.md` §5 — REPAIRED: the design-time sketch table ("Initial rows, to be verified per CLI at implementation; LOW confidence marked ?") contradicted the shipped record (sketch: codex `resumeById: false` interactive-only; shipped 0.4.68: `true` via non-interactive `exec resume <id> <prompt>`). Replaced with a landed-record paragraph naming the upstream record as SSOT — no duplicate ledger.
- `docs/design/cli-contracts.md:471` — REPAIRED: dangling citation `ADR/0127` (no such ADR exists; born in renumbering commit 5f4b7a33a). Repointed to `agent-doctor-inspection-surface.md` §4, the actual owner of "auth removed / liveness-only gate".
- `docs/00_ADR.md` — clean: ADR-121 stays generic and accurate; 0899 is a refinement, not a reversal, so no superseding decision; numbers/dates preserved.
- `docs/03_ARCHITECTURE.md` — clean: attestation/quota statements still true; `ts-ai-runner ≥0.4.57` is a floor and still holds; no capability enum listed to go stale.
- `docs/04_DESIGN.md` — clean: all doctor/cli anchor pointers resolve; satellite edits with unchanged index pointers are synchronized (§5).
- `docs/design/cli-contracts.md` capability section — already in sync: 0899 wording landed at contract level (core compare, unverifiable ⇒ null) and no exact warning sentence is quoted.

Gotchas:

- Task files under `docs/tasks5/` are historical records — superseded phrasing ("mismatch of any kind") lives there and must never be rewritten.
- Design satellites carry no YAML frontmatter (H1 + metadata bullets), so the §4.3 `updated_at` contract applies only to the numbered key docs.
Wrapup complete. Drift repaired in 7 files, committed as `15b72e31b` (`docs(wrap)`, hooks green):

- `docs/design/executor-availability.md` — ownership schema, `setExecutorAvailability` signature (§3 renamed to Availability updater), 0048 columns + owner-scoped drain precedence (§5), recovery supersession + run-once producer (§4), §1 owner table + "no public CLI" claim corrected; frontmatter 1.2.0 / 2026-09-18.
- `docs/03_ARCHITECTURE.md` §25 — all four stale paragraphs rewritten (object form, layer-targeted updater, 0048, quota/probe-only recovery, usage producer).
- `docs/design/cli-contracts.md` — new `spur agent usage` contract row + anchor; doctor row gains provenance columns and `availability`/`usage` JSON facts.
- `docs/design/configuration-contracts.md` — updater bullet renamed to `setExecutorAvailability` with layer semantics (old wrapper deleted 0892).
- `docs/design/agent-doctor-inspection-surface.md` — new §3.5 (provenance + usage snapshot).
- `docs/design/harness-surface-governance.md` — duplicate stray consent row after §5 deleted; in-table ADR-051 row retained.
- `docs/04_DESIGN.md` — usage pointer row. `docs/00_ADR.md` needed no edit (ADR-111 unchanged; ADR-121 already owns B6 decisions).

Verification: stale-string sweep clean across scope; single consent row; anchor `spur-agent-usage---dry-run---source-name---json---json-envelope` matches between `04` and `cli-contracts`; table pipe escaped. Pre-existing uncommitted 0899-era files (`.spur/memory/*`, `session-pinned-dispatch.md`, tasks5/0888–0899, B8 feature) were left untouched — not this run's evidence. Learnings written to `.spur/run/d39d0f49-685a-4070-acae-dd676b5230a0-wrapup-learnings.md`.

# Working learnings — B6 executor availability (WBS 0890–0893)

## 2026-09-17

### 0890 — availability ownership (widen `agent.executors[].disabled`)

- Convention: `disabled` accepts `boolean | {owner: 'quota'|'probe', since: RFC3339, reason}`; a bare `true` is equivalent to `{owner: 'operator'}`. `owner: 'operator'` is human-only — never valid in automatic writes; automatic callers must pass the object form.
- Pattern: single reader — all code reads availability through `normalizeExecutorAvailability` (packages/config); never raw truthiness on the flag.
- Migration 0048 adds `owner`, `layer`, `skipped_reason` to `agent_executor_updates`; drain precedence: operator-owned rows survive quota updates as classified `skipped_reason` no-ops (never auto-re-enabled).

### 0891 — global-layer updater + quota recovery

- Pattern: `setExecutorAvailability({layer, projectRoot, executor, disabled})` targets the layer that actually DECLARES the executor — project fragment wins when both layers declare the name; `layer` in the request is a hint, not the final target.
- Global writes hit `~/.config/spur/config.yaml` through the identical backup + atomic-rename + conflict-detection path; the untouched layer stays byte-identical; loader cache invalidation covers both layers.
- Recovery ownership: `agent.quota.recovered` upserts `disabled: false, owner: 'quota'` and applies only when the current owner is `quota`/`probe` — operator-owned disables survive.

### 0892 — `spur agent usage` run-once producer

- Convention: the only proactive quota producer is a run-once public verb; an external scheduler (cron/launchd) owns invocation; `spur serve` never runs it (test-asserted) — no poller, no timer.
- Snapshot contract: `~/.config/spur/agent-usage.json` = `{captured_at, source, providers, raw}`; `SPUR_AGENT_USAGE_SNAPSHOT` overrides the path in tests.
- Producer observations enter the drain as synthetic quota events with `owner: 'quota'`; `--dry-run` prints would-be changes and writes nothing.
- Gate: new public verb needs a consent row in harness-surface-governance.md §4 per ADR-051, with the rejected shape recorded (`spur agent doctor --refresh-usage` — mixing read-only inspection with a write).

### 0893 — doctor provenance + usage snapshot

- Doctor renders OWNER/SINCE/REASON on disabled rows only (`—` otherwise); header grew to `STATUS EXECUTOR AGENT MODEL TIER VERSION CAPS ROLES OWNER SINCE REASON`.
- `--json` adds per-entry `availability {disabled, owner|null, since|null, reason|null}` plus top-level `usage` snapshot report (`usage: none` when absent — informational, never a warning; ≥6 h = stale). Doctor stays read-only.

## 2026-09-18

### Wrapup / doc-sync gotchas

- Stale linked binary pitfall: `spur` on PATH lacked `agent usage` — verify CLI facts against source (`bun run apps/cli/src/index.ts`), not the installed binary, before writing contract docs.
- Drift pattern: a duplicate consent row landed OUTSIDE the §4 table (after §5) in harness-surface-governance.md, citing ADR-121, while the correct in-table row (ADR-051) already existed — same grant recorded twice. Consent citations: ADR-051 owns public-surface consent gating; ADR-121 owns headless session-pinned dispatch (it narrates the producer but is not the consent authority).
- Satellites go stale in both directions — content AND frontmatter (version/date). executor-availability.md drifted in §1 (owner table + "no public CLI" claim), §2 ("accepts only booleans"), §3 (old updater name/signature), §5 (column list), while §6 was already synced.
- Deleted-wrapper sweep: `setProjectExecutorDisabled` was generalized in 0891 but the configuration-contracts.md satellite still documented the old name — "kept only while a caller exists" wrappers need a deletion pass (0892 deleted it; docs caught up only at wrapup).
- `spur agent doctor --refresh-usage` is the canonical example of the rejected shape: refresh belongs to an explicit producer verb, doctor stays read-only.
- GFM gotcha: escape literal pipes inside code spans in table cells (`boolean \| {owner, ...}`) or the cell splits.
Doc-evolve wrapup complete. Drift report (detection: `rg` doc mentions vs code surface, satellite §8 obligations, frontmatter vs `git log`):

| Doc | Finding | Repair |
| --- | --- | --- |
| `docs/03_ARCHITECTURE.md` §19 | Satellite §8 obligates resolve-once + ownership invariants "when B6/B7 ship" — shipped in abb745673, §19 silent | Added run-scoped dispatch paragraph + invariants 5–7 (ownership, resolve-once/single re-resolve, session policy + capability gate); Shapes line cites `agent-service.ts`; frontmatter 1.49.0 / 2026-09-18 |
| `docs/design/workflow-composition-contract.md` | Shipped `session: reuse \| fresh` stage option absent from rule 5 | Documented role defaults + declaration-in-trace + `freshSession: true` precedence (verified against `agent-run.ts:323`) |
| `docs/00_ADR.md` | Clean — ADR-121 matches shipped reality; task completion never justifies an ADR entry (§5/§6.1) | None |
| `docs/04_DESIGN.md` | Clean — index pointer unchanged ⇒ synchronized (§5) | None |
| `docs/design/session-pinned-dispatch.md` | Clean — updated same-commit as B7 (abb745673) | None |

Committed `5de7e6ee6` (conventional hooks passed). No task/feature corpus written. Learnings artifact written from tasks 0894/0895 (normalized capture, WBS ids only — no raw-input re-parse). Learnings follow.

# Working learnings — B7 run-scoped executor session pins (batch wrapup, run f0d3a226)

## 2026-09-18 — task 0894 (run-scoped executor pins, coder-reuse / reviewer-fresh policy)

- Convention — run vars are the pin store: `__executor.<role>` and `__session.<role>.{dir,id}` live in workflow run vars because they already survive pause/resume and are visible in `workflow trace`; no new store was created (reuse-before-create). Legacy `__agentSessionDir`/`__agentSessionId` remain only for invalid roles.
- Convention — stage isolation is declared policy, not a process side effect: `session: reuse | fresh` on `agent.run`, defaults by role (coder → `reuse`; reviewer/planner/scribe → `fresh`); a reviewer stage may explicitly declare `session: reuse`. `spur workflow validate` rejects any other value (closed vocabulary). The trace records the declaration source (`default | declared`).
- Pattern — resolve once at the pipeline seam: task-pipeline `precheck` / idea-pipeline `start` resolve every declared role exactly once (doctor.probe with an injected `agentService` writes the pins); the per-stage path performs no doctor/detection call. The test asserting doctor invocation count == 1 after precheck is the guard worth copying.
- Pattern — capability gate: a runner record with `supportsResumeById: false` gets fresh dispatch with no `--resume`/`--session-id` flag emitted; one warning `workflow.executor-no-resume` per run (not per stage) via the `__executorNoResumeWarned` latch; a resume-only step (`continue: true`, no `input`) against such a record fails pre-spawn per the ADR-118 `requiresCapabilities` contract.
- Error fixed (P0) — roles-mode wiring: `DoctorProbeActionRunner` needed `agentService` threaded through `builtins.ts`; without the injection, precheck-time pin resolution silently fell back to per-stage behavior. When adding constructor deps to action runners, check the builtins registration seam.
- Gotcha — workflow YAML is bundled: edits to `config/workflows/*.yaml` are not live until `bun run --filter @gobing-ai/spur build:bundle` regenerates `apps/cli/config/`; verify the regenerated output is byte-identical to intent.
- Gotcha — corpus token vs code name: design/task token `pin-reresolved` is implemented as camelCase `pinReresolved` end-to-end; consistent, cosmetic — do not "fix" one side.
- Invariant kept — ADR-047 precedence: an explicit session pin never emits a global continue; role-slot write-back via `discoverSessionId` preserves this.

## 2026-09-18 — task 0895 (pin invalidation, trace columns, exact E6 mapping)

- Pattern — invalidation is a read, not a subscription: before each `agent.run` the pinned executor's availability is read through the same loader the drain invalidates (`reloadAgentConfig` cache invalidation); one cheap read per stage beats event plumbing.
- Pattern — re-resolve exactly once per run per role: first mid-run disable re-resolves (records `pinReresolved` + owner/reason, forces the stage fresh via `pinReresolved !== undefined`); a second disable means the tier ladder is exhausted and the stage fails loudly with the ADR-118 outcome instead of hunting.
- Pattern — trace fields go end to end or not at all: `executor`, `sessionId`, `session: reused | fresh` flow action result → `TRACE_RESULT_FIELDS` (workflow-service) → projection copy loop → CLI `workflow trace --json` envelope + k=v table rendering. `sessionId` is omitted (never falsified) when a stage has no session id yet.
- Pattern — E6 exact mapping by construction: dispatch supplies `flags['run-id'] = context.runId` and the agent-accepted `flags.sessionId`; a supplied id skips watermark observation and the observer writes `exactness: 'exact', mechanism: 'supplied'` — heuristic matching never enters the resumed-stage path. One observer per dispatch ⇒ one mapped row.
- Convention — gate receipts: `bun run spur-check` exit 0 (8540 tests / 484 files); verify is verdict-based PASS with per-requirement file:line evidence; coverage is N/A in this pipeline (say so, don't fake it).

## 2026-09-18 — wrapup doc-evolve (drift audit + repairs, commit 5de7e6ee6)

- Detection pattern — audit T3 drift against the design satellite's own §8 same-commit obligations: `rg` the obligation lines ("add … when B6/B7 ship", "when the tasks land"), cross-check doc mentions vs the real code surface (`rg "session:|freshSession|__executor\." code`), and compare frontmatter `updated_at` vs `git log -1 -- <doc>`. This turned two candidate drifts into confirmed findings with zero prose guessing.
- Repair 1 — `docs/03_ARCHITECTURE.md` §19 gained the run-scoped dispatch paragraph + enforceable invariants 5–7 (ownership recovery limited to `quota | probe`; resolve-once with single re-resolve; role-default session policy with capability gate) and the Shapes line now cites `agent-service.ts`. Frontmatter bumped to 1.49.0 / 2026-09-18 per §6.4.
- Repair 2 — `docs/design/workflow-composition-contract.md` rule 5 now documents `session: reuse | fresh` (role defaults, declaration recorded in trace) and pins the precedence: `freshSession: true` remains the action-level hard guarantee and wins over a declared `session: reuse` (verified in `agent-run.ts`: `freshSession = options.freshSession === true || sessionPolicy === 'fresh' || pinReresolved !== undefined`).
- Audited clean (no edit justified) — `docs/00_ADR.md`: ADR-121 matches shipped reality and tasks completing an accepted decision never justify an ADR entry (§5/§6.1); `docs/04_DESIGN.md`: satellite index pointer unchanged ⇒ synchronized (§5); `session-pinned-dispatch.md` was already updated same-commit (abb745673).
Wrapup complete.

**Doc-evolve audit verdict: clean.** Tasks 0894/0895's surface was already synced by the same-session wrapup commit `5de7e6ee6` (03 §19 invariants + composition-contract rule 5). My audit verified all four owners against code with zero new deltas: `docs/00_ADR.md` ADR-121 consistent (no reversal, decision-level text stands), `docs/03_ARCHITECTURE.md` §19 matches implementation (pins, once-per-run re-resolve, role defaults, capability gate, trace fields), `docs/04_DESIGN.md` index pointer current, and `docs/design/session-pinned-dispatch.md` §4 verified true against verify evidence — including the E6 claim (run-id join, `exactness: 'exact', mechanism: 'supplied'`, agent-run.ts:470 → agent-service.ts:1740). Detection commands: `rg` of YAMLs/code vs docs, frontmatter + `git log` recency. No task/feature corpus writes.

**Artifact written:** `.spur/run/7312879d-5288-4538-bbad-286c23f67cee-wrapup-learnings.md`

# Working learnings — B7 run-scoped executor session pins (tasks 0894, 0895)

Scope: feature B7 (ADR-121 / docs/design/session-pinned-dispatch.md §4), batch run 7312879d. Extracted from task records 0894/0895 (docs/tasks5/), commit abb745673, and the doc-evolve wrapup audit.

## 2026-09-18

### 0894 — run-scoped executor pins, per-role session slots, stage session policy

Conventions

- The run var store is the pin store: `__executor.<role>` (JSON `{name, agent, model, tier, capabilities}`), `__session.<role>.{dir,id}`, written once by the pipeline's `precheck` (task-pipeline) / `start` (idea-pipeline) `doctor.probe` step via `roles:` map + `setVars`. No new persistence layer — run vars already survive pauses/resumes and are visible in `workflow trace`.
- Role-scoped state keeps a legacy fallback: `roleValid ? '__session.<role>.dir' : '__agentSessionDir'` — undeclared callers still get global-var behavior instead of breaking.
- Workflow YAML edits go to `config/workflows/*.yaml` (SSOT), then `bun run --filter @gobing-ai/spur build:bundle` regenerates `apps/cli/config/workflows/*`; verify bundle identity after every YAML change.
- Stage policy is declared, not inferred: `session: reuse | fresh` option on `agent.run`; default is `coder → reuse`, every other role `fresh`; `spur workflow validate` rejects other values.

Errors fixed

- P0 wiring gap: roles-mode `doctor.probe` had no `agentService` injected (`builtins.ts`), so the one-time resolution at precheck couldn't resolve roles at all. Fix: thread `agentService` through `DoctorProbeActionRunner` registration + a seam test (`agent-service.test.ts:1931-1942`, pinResolved=true skips the doctor walk). Lesson: a new constructor dependency on an action runner needs a `builtins.ts` wiring change AND a test that fails on the missing injection — stub-based tests alone pass with the broken wiring.
- Doctor-per-stage cost removed: after precheck pins, the per-stage path performs zero doctor/detection calls (asserted by a test that fails on any doctor invocation after precheck, `session-pinned-dispatch.test.ts:475-516`, `calls).toHaveLength(1)`).

Patterns

- Once-per-run semantics = run-var latch flag: `__executorNoResumeWarned` gates the single `workflow.executor-no-resume` event (0894 R5); the same pattern returned as `__executorReresolved.<role>` in 0895. Cheap, visible in trace, survives stage boundaries.
- Capability gate before affinity: `supportsResumeById: false` ⇒ no `--resume`/`--session-id` flag emitted, result records `session: 'fresh'`, `freshSession: true` remains the action-level hard guarantee; a resume-only step (`continue: true`, no input) against such a record fails pre-spawn as the ADR-118 `requiresCapabilities` violation.

Gotchas

- `sessionSource: declared | default` is recorded in trace (R4) so an explicit reviewer `session: reuse` is auditable — don't collapse the two sources.
- Task record process miss: the implement step never wrote `## Solution` (plan step 6), so the change-map was auto-generated at verify. `spur task update <wbs> --section Solution --from-file` should run inside the implement step, not be left to the verifier.

### 0895 — pin invalidation, per-stage trace columns, exact E6 mapping

Conventions

- Pin invalidation is a read of the same loader the drain invalidates (`executorAvailability` → `reloadAgentConfig`), not an event subscription — one cheap pin check per stage beats event plumbing.
- New agent.run result fields must be added to `TRACE_RESULT_FIELDS` (`workflow-service.ts:2402-2412`) to surface in `spur workflow trace <run> --json`; the copy loop projects them into timeline events and the CLI table renders all result fields as k=v. Adding a result field without the TRACE list silently hides it from trace.

Errors fixed

- Mid-run executor disable left stages dispatching on a stale pin. Fix: pre-spawn availability check → `resolveRoleFresh` live-roster walk → fresh pin + `__executorReresolved.<role>` marker persisted via setVars; the stage is forced fresh (`pinReresolved !== undefined` ⇒ freshSession) even if it declared `session: reuse`; trace records the hop with owner/reason.
- Second disable now fails loudly (ADR-118-cited) instead of silently hunting — the re-resolve ladder is once per run per role by design.

Patterns

- Exact E6 run→session mapping via identity, not heuristic: `flags['run-id'] = context.runId` (never let agent-service mint a fresh UUID when a run id is supplied) + `flags.sessionId = storedSessionId` ⇒ run-session-observer writes `exactness: 'exact', mechanism: 'supplied'`; one observer per dispatch = one mapped row per resumed stage.
- `sessionId` is omitted (not falsified) on a stage with no session id yet; resumed stages always carry the accepted id.

Gotchas

- Naming drift between task tokens and code is acceptable only when consistent end-to-end: design/task token `pin-reresolved` is implemented as `pinReresolved` (cosmetic, noted in verify evidence, not a gap).
- Compose-check scope: when a reviewer brief scopes exact-row writer behavior as pre-existing covered behavior (`run-session-observer.test.ts:149-161`), the new-task tests only assert the join inputs (`run-id`/`sessionId`) — don't duplicate the writer's own tests.

### doc-evolve wrapup audit (this run)

- Drift audit clean across the four owners; checks: `rg` of workflow YAMLs + `agent-run.ts`/`agent-service.ts`/`observability.ts` vs docs; frontmatter/`updated_at` vs `git log -1`.
- `docs/03_ARCHITECTURE.md` §19 and `docs/design/workflow-composition-contract.md` rule 5 were repaired in the same-session wrapup commit 5de7e6ee6 (satellite §8 T3 obligations: resolve-once + ownership + session-policy invariants land in 03 only when B6/B7 ship, not at design time).
- `docs/00_ADR.md` ADR-121 needed no edit — shipped implementation matches the decision text (no reversal); implementation receipts belong in tasks, not the ADR.
- `docs/04_DESIGN.md` index pointer unchanged and correct — a satellite edit with an unchanged index pointer is synchronized (constitution §5).
- Satellite §4's E6 claim ("exact mapping by construction for resumed stages") verified true against R3 evidence: join inputs are the workflow run id + accepted session id (`exactness: 'exact', mechanism: 'supplied'`).
Wrapup complete. Drift report: **zero findings** across all four targets — detection commands (`rg` for `__executor`/`pin-reresolved`/`session` option/trace fields vs. `agent-run.ts`/`observability.ts`; frontmatter `updated_at` vs. `git log`; 04 index pointer check) confirm the T3 repairs already landed in wrapup commit `5de7e6ee6` (03 §19 invariants 6–7 + workflow-composition-contract rule 5), ADR-121 is consistent with shipped behavior (no reversal), 04's unchanged index pointer is synchronized per §5. No repairs needed; no task/feature corpus written. Learnings artifact written to `.spur/run/8bd5eb1e-c472-440f-8a3e-7ea7b4e8b4b3-wrapup-learnings.md`.

# Working Learnings — B7 run-scoped executor pins (tasks 0894, 0895)

## 2026-09-18

### Task 0894 — run-scoped executor pins, per-role session slots, stage session policy

- Conventions — Run vars are the pin store; do not invent a new one. `__executor.<role> = { name, agent, model, tier, capabilities }` and `__session.<role>.{dir,id}` survive pause/resume and are already visible in `workflow trace`; a dedicated store would duplicate that. Role-keyed slots (`__session.<role>`) replace the global `__agentSessionDir`/`__agentSessionId` pair.
- Conventions — Stage isolation is a declared policy, never inferred: `session: reuse | fresh` is an optional `agent.run` stage option; defaults are role-based (coder → `reuse`, reviewer/planner/scribe → `fresh`); `spur workflow validate` rejects any other value; trace records the declaration source (`sessionSource: 'declared' | 'default'`, `agent-run.ts:244`) so an explicit reviewer `reuse` is distinguishable from a default.
- Patterns — Capability-gated degradation: when the runner record says `supportsResumeById: false`, every stage dispatches fresh (no resume flags emitted), the result records `session: 'fresh'`, and exactly one `executor-no-resume` warning is emitted per run via a latch (`noResumeNotYetWarned` + `__executorNoResumeWarned` run var), not one per stage. ADR-047 precedence is preserved: an explicit role pin never emits a global continue.
- Patterns — Enforce "no per-stage resolution" with a test, not a comment: R1 is asserted by a test that fails on any doctor invocation after precheck (`session-pinned-dispatch.test.ts:475-516` asserts the resolver `toHaveLength(1)`; `agent-service.test.ts:1931-1942` asserts `pinResolved=true` skips the doctor walk). `agentService` is threaded through `builtins.ts` so `doctor.probe` resolves roles at precheck with an injectable stub.
- Gotchas — Workflow YAML SSOT is `config/workflows/`; after editing `task-pipeline.yaml` / `idea-pipeline.yaml` you must run `bun run --filter @gobing-ai/spur build:bundle` and verify the regenerated `apps/cli/config/workflows/*` are identical (R6 evidence did exactly this).
- Verification — `bun run spur-check` exit 0 (8536 tests / 484 files, verdict-artifact PASS).

### Task 0895 — pin invalidation, trace columns, exact E6 mapping

- Patterns — Pin invalidation is a read, not a subscription: one pre-spawn availability read through the same loader the B6 drain cache-invalidates (`agent-run.ts:259-263` → `executorAvailability` → `reloadAgentConfig`). No event plumbing; the per-stage cost is a cached config re-read.
- Error-handling convention — Re-resolve a stale pin exactly once per run per role; a second mid-run disable means the ladder is exhausted for that tier and the stage fails loudly with the ADR-118 outcome (`agent-run.ts:266-274`), never hunts further. The re-resolve writes a fresh pin + marker via setVars (`agent-run.ts:1094-1104`) and forces the stage fresh (`pinReresolved !== undefined`, `agent-run.ts:323`).
- Conventions — Token naming: the task/design token `pin-reresolved` is implemented as camelCase `pinReresolved` consistently from action result through trace projection; treat kebab design tokens as camel in code (cosmetic, but pick one and stay consistent end to end).
- Patterns — New trace result fields need the full chain, or they silently don't surface: action result → `TRACE_RESULT_FIELDS` (`workflow-service.ts:2402-2412`) → `projectActionTraceResult` copy loop (`:2499-2504`) → timeline event `result` (`:1531,1551`) → CLI JSON envelope (`workflow.ts:1384-1387`) + k=v table render (`:1557-1620`). Adding the field to the action result alone is not enough. `executor`, `sessionId`, `session: reused|fresh` were added through all five hops.
- Gotchas — Omit, never falsify, absent data: `sessionId` is omitted on a stage that has no session id yet; resumed stages always carry the id the agent actually accepted.
- Patterns — Exact E6 run→session mapping by construction: dispatch passes `flags['run-id'] = context.runId` (join on the workflow run id, never a minted one) plus `flags.sessionId = storedSessionId` (`agent-run.ts:468-477`); a supplied id skips watermark observation and the observer writes `exactness: 'exact', mechanism: 'supplied'` (`run-session-observer.ts:136-161`). One observer per dispatch ⇒ one mapped row; no heuristic matching anywhere.
- Verification — `bun run spur-check` exit 0 (8540 tests / 484 files); mid-run disable paths covered at `agent-run.test.ts:3143-3193` (re-resolve once + second-disable loud failure), trace fields at `:3143-3219` and CLI `workflow.test.ts:3039-3073`.

### Wrapup / docs (both tasks)

- T3 sync executed via wrapup commit `5de7e6ee6`: `03_ARCHITECTURE` §19 gained the resolve-once / ownership / session-policy invariants (new invariants 6–7) and `docs/design/workflow-composition-contract.md` rule 5 documents the `session: reuse | fresh` option; `00_ADR` ADR-121 was audited consistent (no reversal ⇒ no superseding decision needed); `04_DESIGN` index pointer unchanged is synchronized per constitution §5 (an unchanged pointer is not drift).
- Gotcha — `docs/design/*` satellite frontmatter is not uniform: `executor-availability.md` carries YAML frontmatter, `session-pinned-dispatch.md` and `workflow-composition-contract.md` do not. Constitution §4.3 governs key docs (00–05, 99, AGENTS) only; satellites have no enforced frontmatter contract — don't "fix" this unsolicited.
- Drift-audit method that worked: diff doc claims against code mechanically first (`rg` for `__executor`, `pin-reresolved`, `session` option validation, trace fields in `observability.ts`/`agent-run.ts`), then judge. Zero-finding conclusions must cite the commands that produced zero.
Wrapup complete. Drift report (§7 shape), then the learnings capture at `.spur/run/239b58c6-f783-4a46-8e8e-2987f2888380-wrapup-learnings.md`.

**Findings — 1 doc repaired**

| Doc | Code/reality says | Doc said | Authority | Repair |
| --- | --- | --- | --- | --- |
| `docs/04_DESIGN.md:64` | `fleet-config-declaration.md` now owns G66 member-session modes/observability (0897) | Index row: "Fleet declaration in spur config — `agent.fleet` (feature G65, accepted)" | T9 (indexed facts changed → update index) | Row label now "(G65, G66) … member session modes/observability" |
| `docs/04_DESIGN.md` frontmatter | Content last changed 09-18; this edit 09-18 | `version 1.77.0`, `updated_at: 2026-09-17` | §4.3 | `1.78.0` / `2026-09-18` |

**Verified clean — no edit owed** (detection commands returned zero delta):

- `docs/00_ADR.md` — G66 already retained via the session-pinned ADR detail line (`00:1873`); no T1-eligible new decision (member-session persistence was design-approved in `session-pinned-dispatch.md` §6, 2026-09-17).
- `docs/03_ARCHITECTURE.md` — no contradictory loop/session claims; `ts-ai-runner ≥0.4.57` floor survives the 0.4.69 bump; mechanism correctly owned by the satellite, not duplicated (§6.4).
- `docs/design/session-pinned-dispatch.md` §6 — matches shipped code (`MAX_CONSECUTIVE_FAILED_DRAINS=3` at `agent.ts:992`, mode precedence at `agent.ts:1065-1078`, reset reasons, snapshot exposure).
- `docs/design/fleet-config-declaration.md` — updated in 0897's own commit (T3 satisfied).

**Out-of-scope note (not committed):** `spur agent status` has no row in 04/cli-contracts — pre-existing gap predating G66; its session fields are documented in the satellite. File it when the agent CLI surface is next touched. No ADR/corpus writes performed, per scope.

# Working Learnings — G66 wrapup (0896, 0897, 0900)

Grouped by date and task WBS. Source: task records at `docs/tasks5/` (0896/0897/0900), git
commits `70d2da96f`, `36d18e536`, `b11e20c86`, `87df2645c`, and the doc-evolve wrapup audit of
this run (2026-09-18 PST).

## 2026-09-18

### 0896 — Persistent fleet member sessions in `spur agent loop`

Conventions

- Session continuity is an **agent-memory property; delivery state stays in the DB**. Settled
  inbox rows are never redelivered after a resume or reset (0831/0834 invariants unchanged,
  regression-tested). Any future session work must preserve this split.
- Mode selection reads the **executor capability record** (`supportsPersistentStdin` →
  `persistent`, else `supportsResumeById` → `resume`, else `one-shot`) so the loop has no
  per-agent branches (`apps/cli/src/commands/agent.ts:1060-1079`).
- Deliberate resets write reason-named ledger rows (`fleet.member-session-reset`, reasons
  `restart` | `operator` | `failed-drains`) via `packages/domain/src/dao/member-session.ts`;
  `MAX_CONSECUTIVE_FAILED_DRAINS = 3` is a constant, not config — the design gives no reason to
  vary it.
- Reuse before create: `TeamAgentProcess` (already in the runner, already imported by the
  coordination service) backs persistent mode through the shared `buildAgentCommand` seam; no
  new process wrapper.

Errors fixed

- **Attempt-2 blocker (P2): runner shims emitted one-shot print argv**, contradicting the
  persistent-dispatch premise. Fixed by overlaying runner 0.4.68: claude
  `-p --input-format stream-json`, pi/omp `--mode rpc`, per-shim `persistentStdinProtocol.frame`,
  plus a selector-authoritative argv gate (`selectsPersistentStdinDispatch`) and an honest
  degrade warning (`member-persistent-stdin-unwired`, one per member lifetime).
- **Tests verified stubs, not the real path** (review finding). Closed with an omp end-to-end
  that drives the real resolver + builder + real shim framer, and an 0831 send-failure
  redelivery regression in `agent-team.test.ts`.

Patterns

- Test seam `AgentLoopRuntime.memberProcessFactory` (`agent.ts:1036`) keeps the 8-scenario
  member-session suite (`agent-loop-member-session.test.ts`) stub-runner deterministic.
- Multi-drain test sequencing needs a **FIFO hold/gate on the mock run**: a drain claims the
  whole inbox and the exit-row wake races the test's enqueues — gate before asserting.
- "A successful `send()` IS delivery acceptance" (0831) — no extra ack plumbing.

Gotchas

- Persistent process starts **lazily at the first drained prompt**, not loop start (avoids idle
  agent processes for members that never drain). Accepted, documented deviation in the task
  Solution.
- Accepted ceiling: exit-vs-send microtask race (send into a dying process succeeds) is bounded
  by the 3-strike reset, not solved.
- One-shot agents warn once per member (loop-process) lifetime, not per drain.

### 0897 — Session mode/id across fleet surfaces

Conventions

- Observability rides **existing read surfaces, no new endpoint** (ADR-057: durable artifacts,
  no terminal scraping): `FleetService.resolve()` joins the newest session row per member so
  `GET /api/project/fleet`, `GET /api/processes`, `spur agent status`, and
  `spur agent list --specs` all carry `session: { mode, id? }`; members that never ran carry no
  session field.
- T3 done in-commit: `docs/design/fleet-config-declaration.md` gained the member-sessions
  section (modes, reset rows, observability) in the same commit as the surface code;
  `docs/help/cmd_agent.md` updated with it. Contracts live in `packages/contracts/src/fleet.ts`;
  raw-baseline + json-envelope inventory tests bumped together.
- CLI renders mode + a shortened (8-char) id in human output; the full object only under
  `--json`. Board roster shows the mode as read-only text.

Gotchas

- Changing snapshot payloads touches the shared `json-raw-baseline.json` and the envelope
  inventory test — update both in the same commit or `spur-check` fails downstream.
- 0896 review deferred refactors (extract ~170-line member-session block from `agent.ts`,
  document `resolveMemberSessionMode`) land as doc/JSDoc passes in 0897, not as mid-feature
  rewrites.

### 0900 — test-cf environment fix (workerd/miniflare, macOS 26.5)

Errors fixed

- `test-cf` segfaulted under miniflare 4.20260526.0 / old workerd on macOS 26.5. **Reproduced on
  a clean base (`eae5c7ac6`) before blaming 0897's change** — proving it pre-existing unlocked
  the env-fix path. Fix: bump workerd/miniflare, unify all `@gobing-ai/ts-*` catalog deps on
  ^0.4.69 (`b11e20c86`, `87df2645c`), then re-verify 0897 R5 to done with a PASS verdict.

Gotchas

- Environment failures block verify verdicts: split "my change is bad" from "the environment is
  bad" by clean-base reproduction, record the base SHA as evidence.
- Version floors in docs (e.g. `ts-ai-runner ≥0.4.57` in `docs/03_ARCHITECTURE.md`) survive
  catalog bumps — floors, not pins; no doc edit owed for 0.4.69.

## Wrapup audit (doc-evolve, this run)

- Detection before judgment: real CLI surface via `rg '.command(' apps/cli/src/commands/agent.ts`
  vs `docs/04_DESIGN.md`/`cli-contracts.md` rows; satellite §6 claims vs code constants
  (`MAX_CONSECUTIVE_FAILED_DRAINS=3`, mode precedence); `git log -1` per doc for `updated_at`
  plausibility.
- One drift found and repaired, both in `docs/04_DESIGN.md`: index row for
  `fleet-config-declaration.md` still said G65-only although the satellite now owns G66
  member-session modes/observability (T9 — indexed facts changed → update index), and
  frontmatter `updated_at`/version were stale vs the 09-18 content (§4.3 → 1.78.0 / 2026-09-18).
- Verified clean, no edit owed: `docs/00_ADR.md` (G66 already retained via the session-pinned
  ADR detail line; no T1-eligible new decision — member-session persistence was design-approved
  inside `session-pinned-dispatch.md` §6), `docs/03_ARCHITECTURE.md` (no contradictory runtime
  claims; the mechanism is owned by the satellite, which 03 correctly does not duplicate),
  `session-pinned-dispatch.md` §6 (matches shipped code), `fleet-config-declaration.md`
  (updated in 0897's commit).
- Out-of-scope note (not fixed): `spur agent status` has no row in the `docs/04_DESIGN.md`
  command list or `cli-contracts.md` (pre-existing gap that predates G66; its session fields are
  documented in the satellite). Worth a row whenever the agent CLI surface is next touched.
## Wrapup report — task 0901 (WBS from `.spur/run/2e03427c…-wrapup-tasks.json`: `["0901"]`)

**Drift findings & repairs** (constitution §5/§6/§7; committed as `5c4aa5129`):

| Doc | Finding | Repair |
| --- | --- | --- |
| `docs/design/cli-contracts.md`, `workflow-run-log.md`, `workflow-observability.md`, `plugins/sp/skills/spur-cli/references/workflows.md` | Stale vs R1–R6 | **Already repaired on the feature branch** (`5747d5454`, same commit as code per T3). Not duplicated on main — that would conflict at merge. |
| `docs/04_DESIGN.md:158,160` | `continue` index signature missing `[--async] [--no-log]`; anchor slug stale | Signature + slug updated (slug verified against the house slugger: triple-hyphen `--async---no-log---json`). |
| `docs/03_ARCHITECTURE.md` §6.2, §10 | No mechanism statement for the delivered interruption contract; risk row claimed engine gaps "blocked" pause/continue/HITL that 0902 shipped | §6.2 states the engine-owned CAS/resume invariant (ADR-122 pointer); risk row rewritten to "recovery drifting from engine contract" with upstream-first mitigation. |
| `docs/00_ADR.md` | Cross-module recovery-ownership decision (R2) unrecorded | **ADR-122** added (Accepted, 2026-09-19): recovery is the engine's contract; Spur claims resume at its own boundary; headless never invents gate answers. Frontmatter `00`→1.48.0, `03`→1.50.0, `04`→1.79.0, all `updated_at: 2026-09-19`. |

No task/feature corpus written. Verification: all ADR claims cross-checked against the feature-branch code (`workflow-service.ts:888,1140`, `resumeOwner`, `WorkflowResumeError`) and the task record; anchor slug validated programmatically against the known-good existing anchor.

**Notes:** (1) The feature branch `feat/0901-harden-workflow-engine` (code + satellites) is **not yet merged into main** — my `00/03/04` edits don't conflict with it. (2) A second writer is active in this tree (`AGENTS.md`, `package.json`, `plugins/sp/script-contract-check` files, 2 untracked scripts) — left unstaged and uncommitted.

Learnings captured to `.spur/run/2e03427c-1e94-495e-a009-e3a37dc42319-wrapup-learnings.md`:

## 2026-09-19 · task 0901 — Harden workflow engine: shell-output persistence, async continue, terminal-id guard (feature D3; prerequisite 0902)

### Conventions

- Upstream-first for engine contracts: design and release the contract in ts-libs (`@gobing-ai/ts-dual-workflow-engine` 0.5.0, upstream ADR-025) before freezing the consuming task's spec. Spur integrates at existing seams only — adapter pass-through of `claimRunOwnership`/`interruptRun`, `resumeOwner` at the driver — never node_modules patches, no spur-side recovery FSM, no status surgery.
- Idempotency refusals are layered: CLI pre-flight check plus an engine collision backstop; never depend on one layer alone (0901 R1).
- `--yes` means "skip the CLI confirm", never "answer a HITL gate". Headless `continue` without explicit `--answer` exits 2; shipped as a BREAKING CHANGE footer in the conventional commit (0901 R3).
- Persisted process output ordering: redact secrets FIRST, then bound to a utf8-safe 64 KiB tail with truncation flags — bounding before redaction can keep exactly the tail that contains the secret (0901 R5).
- Claim-then-report: `--async` continue detaches a worker and reports `started`/`failed` only after the worker actually claims the run — never optimistically (0901 R4).
- Doc layering per constitution §5: mechanism invariant → `03` § + ADR; command surface → `04` index row + design satellite; the spur-cli facade reference (`plugins/sp/skills/spur-cli/references/*.md`) and `docs/help/` are part of the same-commit surface sync set as the code (T3).
- `04` anchor slugs use triple hyphens between adjacent `[--flag]` tokens (`--json---no-schema`, `--yes---answer`); derive new anchors by transforming the existing anchor string, not from memory — a hand-written double-hyphen variant was wrong and caught by slugifier verification.

### Patterns (testing)

- Interruption/resume contracts need a real worker subprocess + migrated SQLite + action sentinel files; a mocked `continuePaused` cannot prove at-least-once re-execution or ghost-owner CAS races. Must hold for both workflow dialects.
- Sentinel files prove durable-state-before-side-effect ordering for at-least-once semantics.

### Errors fixed (found in kk dogfood 091825)

- Run id silently reused a live run → duplicate-id refusal at CLI and service layers.
- Headless resume persisted a default `no` answer without an operator decision → admission policy: exit 2 without `--answer`.
- `clean` marked stale `running`/`pending` runs `failed` (wedged terminal) → sweep to `interrupted` (rerun-resumable), never `failed`.

### Gotchas

- Ghost owner: `interruptRun` preserves the stale owner row; a concurrent continue must lose the CAS claim with `WorkflowResumeError` — never blind-retry.
- A pre-existing paused row is not startup acknowledgement: record PID at the actual resume mutation, clear only the matching owner's PID, never overwrite terminal cancellation with `paused`.
- Comments are not evidence: the nohup launcher comment claimed process-group leadership but its code never established setsid — real subprocess tests must prove descendant cancellation.
- No new drizzle migration for engine-side schema changes: the engine adapter runs guarded `WORKFLOW_ENGINE_MIGRATIONS_SQL` ALTERs at `ensureSchema` for pre-0.5.0 databases.
- utf8-safe byte bounds: never split multibyte characters when tail-bounding persisted output.

### Process

- Blocked-on-upstream tasks: register the prerequisite as a real dependency (0902), then re-freeze requirement/design/AC against the DELIVERED contract after it ships — never implement against a draft.
- Wrapup doc split that avoids merge conflicts: design satellites + facade reference + help ride the feature branch in the same commit as code; the ADR (cross-module invariant), `03` mechanism text, and `04` index land on main at wrapup — keep the two sets disjoint.
- One writer per working tree is real: a second writer appeared in main mid-wrapup (`AGENTS.md`, `package.json`, `plugins/sp/scripts/script-contract-check.ts` + test, untracked rule/script files). Foreign changes were left unstaged; only the three wrapup docs files were committed (`5c4aa5129`).
# Working Learnings — runall-i31-20260919-180944 wrapup

## 2026-09-20 — WBS 0903 (Audit post-delivery CLI-plugin-workflow contract adoption)

### Conventions
- Evidence provenance convention: capture all live evidence with the source-local CLI (`bun apps/cli/src/index.ts … --json`), never bare `spur` — bare runs resolve the published `registered` workflow layer which shadows the checkout copy (`~/node_modules/@gobing-ai/spur/config/workflows`, published 0.3.90) over `shared` (A7/F7 dual-copy shadowing).
- Research-artifact shape that survived review: one contract matrix (source path:line + asserted shape + live behavior + evidence command + confidence), one disposition list, one owner register — reuse existing owners (I7, B1, B3, I4, D62, P, E6); never open a parallel backlog subsystem.
- Disposition vocabulary discipline: confirmed mismatch / stale guidance / adoption gap / hypothesis — a hypothesis is never reported as a bug (AC2).

### Errors fixed
- Round-1 defect: A4/H1 misdescribed the `agent doctor --json` availability schema. Fixed by re-verifying against a fresh capture field-for-field: 16 rows, every row carries `availability{disabled,owner,since,reason}`, exactly 6 disabled rows with `owner:"operator"`, `since`/`reason` null on all, top-level `usage` null, B8 `capabilities`+`verifiedAgainst` present.
- Four stale line anchors re-pointed after review; a second pass found two more in A3 (`session-pinned-dispatch.md` usage producer is §3.4 at :57-69, not :113-118; `agent.md` usage row is :29, not :26).
- Dangling label "H2" referenced twice but defined nowhere — every referenced label must resolve.

### Patterns
- Runtime receipt/error vocabulary (wait-family `occupant_gone/run_replaced/wait_stalled/timeout`, `selector_unmatched/selector_ambiguous`; message hold reasons with `outcome-unknown` never auto-released) verified flag-level; runtime semantics need `spur serve` + a live occupant — declared as a named gap instead of guessed (G1/G4/G65).
- Session-policy adoption checkable mechanically: precheck `doctor.probe` pins `__executor.<role>`; implement/fix = `role: coder` + `session: reuse` + `requireDiff` + `requiresCapabilities`; review/verify = `role: reviewer` + fresh pins (`task-pipeline.yaml:199-213, 229-241, 423-442, 494-505`).

### Gotchas
- Line anchors rot within a single session even when the claim stays true — re-verify every path:line citation against the file before publishing.
- Installed `~/.agents/skills/sp-*` adapters (83 dirs) strip `role:` frontmatter from every SKILL.md; roles actually resolve from `config` (scan roots `plugins/sp/commands` + `.claude/commands`) — installed-copy impact unproven (F4 → B3+I4), no parallel owner.
- `mtime` comparisons: file vs directory mtime differ (17:28 file vs 17:38 dir) — name which one you cite.
- doctor provenance `since`/`reason` stay null until a real availability event or usage snapshot exists; a missing snapshot (`usage: null`) is operator data, not a code bug (F6) — scheduled capture is run-once by design.
- Status/evidence questions (D62 `active` while all children `done`) are recorded as questions — never auto-closed, no status touched by research.
- Open decisions stay open: public-surface compatibility tolerance (U1), who owns code-side help-text-vs-behavior drift (U2) — plugin parity harnesses do not see CLI help strings.

## 2026-09-20 — WBS 0904 (Validate usage-to-availability decisions with sanitized fixtures)

### Conventions
- Hermetic sandbox pattern for provider/config-adjacent validation: own project dir + own SQLite DB + `SPUR_SKIP_GLOBAL_CONFIG=true`; pin snapshot path with `SPUR_AGENT_USAGE_SNAPSHOT`; freeze fixture schema and redaction rules BEFORE reading any live provider output.
- Sanitization rules that passed security review: no auth material; error entries carry labeled fixture text only; live codexbar output quoted only as provider + `usedPercent` + `updatedAt` (stderr/diagnostic bodies unquoted).
- Reuse the real producer/consumer against fixtures (`agent-usage-producer.ts` loop, `agent-quota-updates.ts` drain) instead of building a parallel mock classifier.
- Read-only proof discipline: `agent usage --dry-run` writes nothing (`snapshotPath: null`, `drain: null`, no `~/.config/spur/agent-usage.json`); `agent doctor --json` writes only the gitignored `.spur/run/` cache — state these verifications explicitly.

### Errors fixed
- The observed `codex-astra` would-apply-vs-blocked mismatch explained deterministically: producer `needsRow` checks operator ownership only in the disable direction (`agent-usage-producer.ts:331-333`); the drain blocks both directions (`agent-quota-updates.ts:302-315`, `skippedOperatorOwned`); the pre-drain `changes[]` label is never reconciled — recovery-direction previews over-promise while protection itself works exactly as specified.
- Review-caught P3s fixed: one mis-transcribed latency timestamp (113.43 s claimed vs its own 92 s window), two stale anchors (`NodeProcessExecutor()` construction at :30-35 not :35-41; codexbar entry shape at :41-68 not :69-89), one wrong mechanism clause ("slashless model never prefix-matches" — it does when the model value equals a provider slug via the same branch).

### Patterns
- Provider→executor mapping is conservative and case-insensitive: agent equality first, then `model.split('/')[0].toLowerCase()` prefix; drain-time executor lookup stays case-sensitive; unmapped providers are listed, never guessed.
- Availability outcome correctness vs preview honesty are separable claims — report each separately (outcome correct in every exercised case; only the preview label lies in the recovery direction).
- R4 categories for apply runs: eligible (applied) / protected (`skippedOperatorOwned`) / unchanged (idempotent re-write absorbed into `applied`) / unresolved (`skippedUnknownExecutor`, `failed`/`deferred`).

### Gotchas
- No timeout is armed anywhere in the usage chain: `CodexbarUsageSource` constructs `new NodeProcessExecutor()` with no config, so `resolveDeadline(undefined, undefined)` arms no deadline — a hung codexbar hangs `agent usage` indefinitely; ~113 s all-provider captures make that expensive. The executor already supports deadlines; the source just never passes one.
- Producer has no staleness gate: a 72 h-old `updatedAt` still disables an executor and the stale timestamp seeds `since` (`since: row.observed_at`, `agent-quota-updates.ts:331`); doctor's 6 h staleness is snapshot-display-only.
- A no-usage (all-null windows) provider can become an executor's alphabetically-first `driver` and render misleading "headroom" reason text for a provider with no windows; the availability outcome was still correct.
- `AgentQuotaDrainSummary` counts idempotent re-writes as `applied` — updater result `unchanged` has no separate counter (reporting-honesty nuance).
- Write-boundary subtlety: the consumer always requests `layer: 'global'` but the updater re-selects the declaring layer (project fragment wins) — on a machine where every executor is declared globally, a real (non-dry) quota run writes `~/.config/spur/config.yaml` machine-wide. First updater write normalizes YAML indentation (comments/order otherwise preserved).
- Per-provider timings are structurally unknowable (one buffered spawn covers all providers; the capture shape carries no per-provider error timestamps) — record unknown as unknown rather than estimating (AC4).
- A `/tmp` fixture harness that is not retained/committed leaves "reproduced deterministically" resting on recorded output only — link or commit the harness if reproduction matters.
- H2 (`## A.`) sub-headings above the task section level are parser-safe (`MarkdownDocument` splits only at the domain level; `--section` round-trips intact) but off corpus convention — prefer `####`.

Done. Drift report (§7, scoped to 00/03/04 + design/*): 8 checks run, 1 finding, repaired.

**Finding (T3, fixed):** `spur builder bump-ver` gained a plugin-install-smoke refusal gate (3b53e064f, `release-ops.ts:135-156`) after the last satellite sync — undocumented. Repaired in the owning satellite `docs/design/cli-contracts.md` (abort-conditions paragraph). 04 index row untouched per §4.5 (pointer/title/state unchanged).

**Zero-finding checks (commands backing them):** 04↔`docs/design/` set equality via `comm` of link targets vs disk (68/68 both ways); ADR register `rg '^## ADR-'` (000–122 contiguous, no dupes); frontmatter contract-verify 00/03/04 vs constitution §4.1/§4.3 (owns/authority/edit_rules all match); 03 recovery prose + cli-contracts recovery/continue sections vs merged 0901 code (`workflow-service.ts:1140`, `workflow.ts:1067` exit 2, sweep-to-interrupted, redacted 64 KiB tails — all in sync); post-sync commits `git show --stat` on d8ff752b2/7b957ddaa (plans/features/tasks/memory layers only — no T1/T3 obligation on scoped docs). Out-of-scope 0903 findings (stale help string, wayfinder recipe, plugin prose) stay notes — already owner-routed to backlog I7; not repaired here.

No task/feature corpus writes. Artifact written to `.spur/run/4630aaa2-4589-4b42-843f-8c19b2546a46-wrapup-learnings.md`.

# Wrapup learnings — run 4630aaa2 (feature I31, tasks 0903/0904)

## 2026-09-20 (UTC, task-record dates)

### Task 0903 — Audit post-delivery CLI-plugin-workflow contract adoption (wayfinder:research, done)

Conventions

- Evidence provenance convention: capture live evidence with the source-local CLI (`bun apps/cli/src/index.ts … --json`) in the worktree, never bare `spur` for evidence — bare `spur` resolves to the registered published package (0.3.90), whose `config/workflows` layer shadows the checkout.
- Audit pattern that held: a contract matrix per surface — source assertion vs live behavior vs evidence command vs confidence — makes drift findings reproducible instead of narrative.
- Role-routing SSOT scans only `plugins/sp/commands` + `.claude/commands` (`slash-commands-service.ts:161-188`); installed `~/.agents/skills` adapters are NOT scanned for roles.

Patterns

- Design satellites can carry same-commit prose obligations (e.g. B7 session-policy paragraph owed to `cross-cutting.md` per `session-pinned-dispatch.md §8`); grep the obligation, not the feature, to find adoption gaps — code shipped, prose lags silently (F3).
- Findings routed with owner candidates + smallest slice named (F1 → backlog I7; F4 → B3+I4) keeps an audit actionable without scope creep.

Gotchas

- Dual-copy workflow shadowing: 9 definitions resolve from BOTH `registered` and `shared` layers, 0 project overrides — editing checkout `config/workflows/` does not affect bare-`spur` runs until the registered copy updates (ADR-113 layering; F7).
- Stale help string vs behavior: `agent run --agent` help says "host-session-only; errors on headless" while code substitutes + warns once (`agent-service.ts:1766-1778` vs `commands/agent.ts:290`) — help strings need parity assertions, they rot independently of behavior (F2).
- Stale recipe in skill corpus: wayfinder SKILL.md still documents `feature update --section tags --from-file`; live surface is `--field/--value` + closed-world `--section` set (F1) — already owned by backlog I7, do not re-fix ad hoc.
- Installed superskill adapters strip `role:` frontmatter and lag source by mtime (stale-by-date, semantically equal on diff); no audited consumer reads roles from `~/.agents/skills`, so impact unproven — hypothesis, not bug (F4).
- Partial provenance is expected, not a bug: doctor `--json` rows carry `availability{owner,since,reason}` but `since`/`reason` render null and `usage` null on a machine with no snapshot/availability event (H1 → routed to 0904, which confirmed it).

### Task 0904 — Validate usage-to-availability decisions with sanitized fixtures (wayfinder:research, done)

Conventions

- Hermetic validation pattern: `/tmp` sandbox with own project dir + own SQLite + `SPUR_SKIP_GLOBAL_CONFIG=true`; freeze redaction rules BEFORE reading any live provider output; no auth material in fixtures; error entries carry labeled fixture text only; live codexbar quoted only as provider + `usedPercent` + `updatedAt`.
- Dry-run write-nothing must be proven, not assumed: check no `~/.config/spur/agent-usage.json` appears, `snapshotPath: null`, `drain: null`, and diff fixture YAML before/after apply.
- Fixture rows should map 1:1 to decision categories (exhausted / no-usage / headroom / error / stale / unmapped / ghost / operator-owned / case-variant prefix) and run against the REAL producer/consumer (`agent-usage-producer.ts`, `agent-quota-updates.ts`), never a mock — that is what made the preview-vs-drain mismatch reproducible.

Gotchas (validated against live code, none fixed — investigation-only task)

- Preview honesty is asymmetric: producer `changes[]` is computed before the drain and consults operator ownership only in the disable direction — recovery-direction dry-run predicts "would-apply enabled" for an operator-owned disable, the drain blocks it (`skippedOperatorOwned`, `agent-quota-updates.ts:302-315`) and the row still reads `applied`. Protection works; the preview over-promises (§C, ranked follow-up, nothing implemented).
- No producer-side staleness gate: a 72 h-old `updatedAt` still disables an executor and the stale timestamp propagates into the written `since` (`agent-quota-updates.ts:327-331`); staleness is enforced only doctor-side (6 h, display-only, `agent-service.ts:2634`).
- No timeout owner in the usage chain: `CodexbarUsageSource` passes no timeout (`agent-usage-source.ts:35-41`), `resolveDeadline(undefined, undefined)` arms none — a hung codexbar hangs `agent usage` indefinitely; ~113 s wall for a full 128-provider sweep is normal, not a hang.
- Reporting honesty: idempotent re-writes count as `applied: 1` with updater result `unchanged`; `AgentQuotaDrainSummary` has no separate unchanged counter — "applied" absorbs no-ops.
- Quota writes land in the DECLARING layer, not the requested one: consumer asks `layer: 'global'` but the updater re-selects the declaring layer (project fragment wins, `executor-update.ts:89-107`); on this machine every executor is global, so a real (non-dry) quota run would write `~/.config/spur/config.yaml` machine-wide.
- Matching asymmetries are by design: provider equality is case-insensitive on `agent`, model prefix is `split('/')[0].toLowerCase()` (slashless model never prefix-matches), but executor lookup at drain time is case-sensitive (`agent-quota-events.ts:91-97`); `antigravity` provider does not match `agent: antigravity-cli` (equality, not substring).
- Reason-text quirk: an all-null provider sorting alphabetically first becomes the row `driver` and renders "headroom: all usage windows below 100%" for a provider with no windows; the availability outcome was still correct in every exercised case.
- First updater write normalizes YAML indentation (comments/ordering/values otherwise preserved) — don't mistake the reformat for content drift when diffing.
- Per-provider elapsed time is unknowable: one buffered spawn covers all providers and the capture shape carries no per-provider timings — record as unknown, don't estimate.

Testing convention

- Implement-scope verification is targeted probes only (29+28+3 pass across `executor-update` / `agent-quota-updates` / `agent-usage-producer` test files); the full gate belongs to the pipeline's test hop.

## 2026-09-20 — wrapup doc-evolve (this pass, run-scoped)

- Drift audit (§7, scoped to 00/03/04 + design/*): 04↔`docs/design/` set equality clean both ways (68/68); ADR register contiguous ADR-000…122, no dupes; 00/03/04 frontmatter matches constitution §4.1/§4.3; ADR-122 + 03 §6.2 + cli-contracts recovery prose all match merged 0901 code (CAS resume, `paused|interrupted` resumable, sweep to `interrupted`, headless `continue` exit 2 at `workflow.ts:1067`, secret-redacted 64 KiB tails); no missed T1/T3 obligations in post-sync commits.
- One T3 finding repaired: `spur builder bump-ver` now refuses without a passing plugin-install-smoke gate (3b53e064f, `release-ops.ts:135-156`) — documented in the owning satellite `docs/design/cli-contracts.md` bump-ver section; 04 index row unchanged (§4.5: pointer/title/state unchanged → no index edit).
- Out-of-scope notes stay notes: F1/F2/F3 live in `plugins/sp` prose and CLI help strings, already owner-routed by 0903 (I7 etc.) — not repaired here.
## Working learnings — run 7797801e (feature B61, batch 0907–0908)
### 2026-09-20
#### WBS 0907 — usage preview/apply outcomes conservative and truthful
- **Convention:** reported `action` values are delivery semantics, not byte-mutation proof — `would-apply` (dry run), `applied` only when the exact observation this invocation created is post-drain acknowledged without a skip, `no-op` for protected/already-satisfied decisions, `skipped` for superseded/rejected observations, `pending` when delivery is unconfirmed or failed. The drain summary's `applied` counter keeps its delivery-ack meaning.
- **Errors fixed at HEAD:** (1) `action: 'applied'` was claimed unconditionally at plan time before the drain ran; (2) decisions were driven from the full provider mapping — an all-null-window `no-usage` provider could fake a recovery or invent a headroom reason; (3) observations were recorded for operator-owned executors and reported as applied even when the drain acked them as `operator-owned` skips.
- **Pattern (deep extension):** outcome reconciliation pushed to one post-drain boundary (`finalizeOutcomes` in `packages/app/src/services/agent-usage-producer.ts`) reusing the existing DAO row shape instead of re-implementing row queries; result mutation carried on `PendingReconciliation` is acceptable while the producer stays small — promote to return values only if it grows.
- **Pattern (two-layer ownership guard):** operator ownership (including bare `disabled: true` → owner `operator` via the single reader `normalizeExecutorAvailability`) is evaluated before planning (pushes `no-op`, records no observation), and the drain re-checks ownership against the fresh config to protect races.
- **Gotcha:** on shared executors, exhausted-wins merge — only signal-bearing providers (exhausted/headroom) drive decisions; `no-usage` and errored providers stay diagnostic-only so an absent window can neither imply recovery nor hide valid headroom.
- **Test pattern:** hermetic tests use the real loader/writer/DAO with in-memory SQLite, not mocks of the availability pipeline; cost is one extra indexed `getUpdate` per decided executor.
- **Advisories noted, not committed (P4):** summary line "(N change(s))" counts every non-`no-op` action so `skipped`/`pending` inflate the headline; `row === undefined` in `finalizeOutcomes` labels "superseded" though no code path deletes a row.
#### WBS 0908 — Codexbar capture bounded by the existing runtime timeout
- **Pattern (reuse the runtime):** bound the external capture with `@gobing-ai/ts-runtime` `NodeProcessExecutor.run({ timeout })` — the runtime owns process-group termination (SIGTERM → escalate → output settlement); no caller-side second watchdog.
- **Gotcha (check outcome before parsing):** the structured `outcome` must be checked before the exit-code/parsing fallback — an interrupted run (`timeout|cancelled|signal|error`) is unusable even when partial stdout parses; only `outcome: 'exit'` reaches the existing nonzero pass-through, which preserves the "codexbar exits 1 whenever any provider fails" partial-provider behavior.
- **Error-message discipline:** deadline errors name the deadline and explicitly avoid the `install codexbar` hint — that advice belongs to the missing-binary failure only.
- **Test pattern:** disposable Bun child writes valid JSON `[]` then hangs; inject a 2 s deadline, assert `UsageSourceError` contains "deadline" (not "install"), then `kill(pid, 0)` to prove runtime-owned reaping; timeout regression leaves prior state intact.
- **Calibration knob:** `DEFAULT_CAPTURE_TIMEOUT_MS = 180_000` (`apps/cli/src/services/agent-usage-source.ts:21`) is a chosen limit with headroom above the ~113 s all-provider capture measured in I31/0904 — a chosen limit, not a measured percentile or provider SLA.
#### Cross-task conventions
- **T3 in practice:** the owning design satellite (`docs/design/session-pinned-dispatch.md` §3.4) was edited in the same change set as the code, plus contract-parity touches to `docs/design/cli-contracts.md` and the plugin reference `plugins/sp/skills/spur-cli/references/agent.md`.
- **Gates:** focused workspace tests while iterating (`cd packages/app && bun test …`), then `bun run spur-check` per task, `bun run spur-check-feature` once per feature after both tasks, `bun link` in `apps/cli` + `bun run --filter @gobing-ai/spur build:bundle` after CLI source changes.
- **I31 evidence stance:** agent reports identify candidate defects; fixes start from executable regression evidence against current source anchors — sparse historical runs do not authorize redesign.

