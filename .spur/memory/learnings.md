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
- **DD-09 orphan-scenario resolution: carry, don't create.** When a feature's scenarios aren't covered by linked task AC sections, add the destination scenario titles (bare, no R-prefix) to the tasks that already genuinely deliver them — following the 0466 pattern (`# Carried verbatim from feature E1's AC for DD-09 coverage`). One task may carry several scenarios. The normalized-title matcher in `feature-check.ts:464-489` strips `R<n> — ` from feature scenarios and compares against task AC scenario titles.
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

