# Changelog

## [0.3.21] — 2026-07-22

### Fixed

- resolve sp-spur-init knowledge-kit dogfood findings — align doc templates with canonical constitution (§4.3 frontmatter, `{{init-date}}` tokens, updated bodies), fix status health to key on `spurConfigExists` (stack-neutral projects now report `ok: true`), add `substituteDocTemplateTokens()` for `{{init-date}}` → `YYYY-MM-DD` at scaffold, update init command to use `--json` and summarize once, fix 3 existing tests that relied on `package.json` for `ok: true`, add docs-contract / stack-neutral status tests (bcf309d7)
- CI: source-vs-bundle template parity no longer reads gitignored `apps/cli/config/` (missing on clean CI). The gate materializes a temp tree via `bundleConfig()` — the same publish path — and compares `config/templates/docs/*` byte-for-byte

### New Features

- **Add `/sp:dev-debug` and `/sp:dev-daily` thin commands (task 0316).** Added `/sp:dev-debug` (backed by `sp:sys-debugging` systematic debugging protocol) and `/sp:dev-daily` (backed by `sp:daily-summary` report generator). Renamed `RD3_DAILY_SUMMARY_NO_PROMPT` → `SP_DAILY_SUMMARY_NO_PROMPT` with dual-read deprecation warning, fixed stale `SKILL.md` script reference link, bumped command count 28 → 30, and synchronized plugin version `0.3.21` across `plugin.json`, `.claude-plugin/marketplace.json`, and README.

### Changed

- **Make `sp:spur-cli` an executable surface SSOT (task 0317).** Added missing `deps`, `sections`, and `run-link` verbs to `sp:spur-cli` task reference (`references/tasks.md` and `references/tasks/verbs.md`). Corrected section-editing matrix documentation to list the complete canonical and universal sections (`Background`, `Requirements`, `Acceptance Criteria`, `Q&A`, `Design`, `Plan`, `Solution`, `Testing`, `Review`, `References`, `History`, `Notes`). Updated `AGENTS.md` and `SKILL.md` to establish the Execute-First Contract (Tier A reference execution without calling `spur --help` every turn). Added unit test suite `plugins/sp/tests/spur-cli-parity.test.ts` to assert reference↔CLI parity across all Tier A nouns.
- **Harden `sp:dev-review` and `sp:dev-handover` command contracts (task 0315).** `dev-review` simplified into deterministic modes (WBS mode: functional traceability + SECUA framework + architectural depth with `Review` section write; Path mode: advisory SECUA + architecture with zero task mutation); deprecated `--fix` and `--next` flags with warning guidance, and trimmed `allowed-tools` to least privilege (`["Bash", "Read", "Skill"]`). `dev-handover` updated so standalone `docs/handover/<date>-<slug>.md` acts as durable SSOT and task association appends a pointer link into `References` / `Notes` without clobbering existing content.
- clarify UI/UX boundary in scaffolded 04_DESIGN.md template (6f370a70)

## [0.3.18] — 2026-07-21

### New Features

- **Workflow trace per-step cost and cache-hit (task 0311).** `spur workflow trace <run-id>` now renders token cost and cache-hit ratio per `agent.run` step, joined from imported history ETL records. Cost appears as `$X.XXX · cache Y%` for exact session-id joins (R1a), `~...` for time-window heuristic estimates (R1b fallback), and `cost n/a` when no usage data is available (never `$0.00` — 0281/0284 never-fabricate invariant). Unjoined steps append a `spur history import` hint. The `--json` output gains an additive, nullable per-action `cost` object. ETL tables are loaded once per trace and matched in memory — no re-scan per action.

- **Workflow run observability design locked (task 0310).** The design record for feature P settles six decisions: engine seam (widened `saveActionStart` with optional 4th param), verbosity model (`--detail <quiet|normal|verbose|debug>` with TTY auto-degrade), two-line step formats with terminal-width-aware truncation and `ActionRedactor` support, FSM transition rendering under verbose mode, CLI-side elapsed liveness timer (TTY) / periodic heartbeat (non-TTY), and `spur workflow trace --follow` for async runs. Token cost display slot reserved with `[cost unavailable]` rendering; acquisition deferred to task 0311.

- **Analytics cache split.** `extractClaudeTokens` now preserves `cache_read_input_tokens` and `cache_creation_input_tokens` separately instead of folding them into `inputTokens`. `CostRecord` gains `cacheReadTokens`, `cacheCreationTokens`, and `usageReported` fields. `cacheHitRatio(totals)` returns `number | null` — `null` means unavailable (never fabricated 0%). `formatSummary` shows cache hit ratio; `formatRatio` renders `n/a` for null and `42.0%` otherwise.

- **Stage-registry adapter from shared metadata (task 0308).** The stage-registry feature pipeline ships a code-generated adapter (`plugins/sp/scripts/stage-registry-adapter.ts`) that maps the stage-registry schema to CLI/Task corpus operations, with command structure validation and batch-preflight logic supporting execution-mode (`--dry-run` / `--auto`) and worktree isolation.

- **CLI `sections` verb (task 0306).** `spur task sections init/add/list` for managing canonical task sections — part of the progressive-disclosure envelope implementation.

- **Task dependency mutation (task 0303).** `spur task depend add <wbs> <dep-wbs>` and `spur task depend rm <wbs> <dep-wbs>` for safe dependency management via the CLI, with validation against circular references.

- **Context-envelope layers (task 0306).** Progressive disclosure, attribution, and invalidation for task envelope storage with canonical serialization — production-grade review findings propagation and disclosure-budget enforcement.

### Improvements

- **run-cost module optimized for single-pass ETL loading.** `matchEtlForAction` split into `loadAllEtlPayloads` (one DB scan per trace) and `matchEtlPayloads` (pure in-memory join per action). `EtlMatch` return type bundles both matched records and the estimated flag, so callers no longer need to extract session ids separately.

- **Commands as SSOT (ADR-032).** The `plugins/sp` skill structure now treats commands as the single source of truth for CLI verb definitions, replacing the prior adapter-generation approach. Adapter validation replaces generation — `validate-commands.ts` checks command structure against the intended contract instead of producing derived code.

### Bug Fixes

- **Feature check accepts scaffold forms in scope delineation.** `spur feature check` no longer rejects features whose acceptance criteria include partial or scaffold-level steps.

- **Web accessibility suppressions removed.** Replaced `biome-ignore` suppressions in `apps/web` with accessible markup patterns — no silently hidden violations in the frontend.

- **Envelope review fixes.** Disclosure budgets now cap correctly; empty-hash guard prevents zero-length content from passing verification; AC and Solution sections are properly filled during envelope serialization.

- **`UNIVERSAL_SECTIONS` included in canonical getter.** The universal section set (History, References) is now included in `canonicalSections` lookups, so they appear in task metadata without special-casing.

- **Feature O tasks wrapped in auto-generated markers.** Auto-generated tasks in feature O now carry correct `<!-- AUTO-GENERATED ... -->` markers for lifecycle tracking.

## [0.3.16] - 2026-07-19

### Fixed

- **Verify line-anchor fidelity rule (anti-stale-citation).** A `--force` re-audit of task 0282 exposed that the prior verify run certified the task `done` citing `file:line` anchors that resolved to a *different ticket's* content (0281 telemetry text), with requirement rows marked MET on material absent from the deliverable. The `code-verification` skill now requires every `file:line` evidence citation in the Testing table (and in Acceptance Criteria evidence) to be re-read at the cited lines this run and confirmed to name the requirement's subject before a MET row is written. Stale or cross-ticket anchors fail the row to UNMET and surface as a P2+ finding. Closes task 0299 (R1).

- **`--next` no-op surfaced in the verify report line.** When `--next` is invoked on a task already at `done` or `cancelled`, the transition cannot fire - but the no-op previously lived only in the CLI print, not in the verify report. The skill's Step 13 now requires the report line itself to state `--next: no-op - task already terminal (<status>)`, so a terminal-task re-audit cannot be misread as a successful `testing -> done` transition. Closes task 0299 (R2).

- **Gitignored `.spur/run/**` fix-pass writes now disclosed in Testing.** A `--fix all` verify pass can mutate deliverables under `.spur/run/**` that are invisible to `git status` and to drift guards. The skill's Step 12 now requires the Testing write-back to name the exact artifact path and line range the fix pass touched, so the mutation is discoverable from the tracked task file alone without diffing untracked directories. Closes task 0299 (R3).

### Documentation

- **Verify-fidelity lesson added to the project constitution.** `docs/99_PROJECT_CONSTITUTION.md` §8 records the 0282 stale-anchor incident and the line-anchor verification rule it produced, so the gap is not re-closed as a new finding in a future audit.

## [0.3.15] — 2026-07-19

### Added

- **Dogfood workspace-drift guard.** The dogfood driver now records a workspace fingerprint
  (git HEAD + `git status --porcelain` hash) in Phase 1 and checks for external drift before
  each fix application and at finalize (Phase 4). A `drift:external` ledger row and mandatory
  P2 finding name the drifted paths and state the run's evidence is degraded, not voided.
  Mutating dogfoods are advised to run in an isolated `git worktree`. The new `workspace_fingerprint`
  frontmatter block is additive — existing reports remain valid.

- **`--chain-follow` flag for dogfood chained-leg observability.** The informal "operator may
  direct" prose override is replaced with an explicit `--chain-follow` argument (default off)
  that permits the driver to read named chained-leg artifacts and attribute normally instead
  of stopping at the testing boundary. The Platform Notes for Claude Code now document that
  `Skill()` runs inline, so `--next` chain legs are same-session-unobservable by default;
  the standalone-invocation workaround is named for completing the chain.

- **Feature O anti-inflation acceptance criteria.** The `@edge` scenario "Cache evidence cannot
  silently inflate fresh input" is added to feature O's AC gherkin block, codifying the locked
  metric rule (fresh input per verified PASS never folds in cache-read tokens).

### Fixed

- **Workflow `agent.run` hardened against non-TTY slash-command stalls.** The agent service
  now detects non-TTY environments and adapts slash-command invocation so a workflow step
  does not hang when the agent's output is piped or redirected.

- **Review L3 done-gate no longer accepts dash-filled placeholder P-tables.** A `| P1 | — | — | — |`
  row previously passed the populated-findings check because `—` was a non-empty cell.
  `isPlaceholderCell` now treats dash/em-dash runs and bare `n/a` cells as empty, closing the
  false-pass that let task 0296 reach `done` with an unauthored Review table.

## [0.3.14] — 2026-07-18

### Added

- **Verify verdict now gates every `* → done` task transition.** A two-layer done gate at the CLI layer (`apps/cli/src/commands/task.ts` `update` action) consults `.spur/run/<wbs>-verdict.json` on every done transition — including `--no-lifecycle` updates — and denies non-PASS verdicts with an actionable message naming the wbs, file path, verdict value, and remediation. Operators can still override with `--force-done --reason`, which records an audit trail via new `done_forced` and `done_reason` frontmatter fields. R10 hardening: `computeAggregate` recomputes the verdict from requirement/AC rows and takes the harsher of stored-vs-computed, so self-inconsistent artifacts are denied with the inconsistency named. Closes task 0292 (R1–R10).

- **Dogfood refuse-gate extended to mutating `--fix` modes.** `detect-pipeline-driving.ts` now refuses testees carrying `--fix all` or `--fix blockers-first` without `--max-retry`, closing a second tree-mutation source that the original pipeline-driving token matcher did not cover. The same modes are flagged as implement-heavy on verify/review legs (task 0280 P2), while `--fix none` stays observational and a boundary guard prevents `--focus all` from ever matching. `dev-dogfood.md` and the `dogfood-testing` skill document both refuse sources in the `--max-retry` row, the detection section, and a new "Mutating `--fix` mode contract" section.

### Fixed

- **Status-case canonicalization before the done gate.** `apps/cli/src/commands/task.ts` now normalizes the target and stored status via `normalizeTaskStatus` before any verdict-gate match, so `Done`, `DONE`, and legacy aliases can no longer slip past the `=== 'done'` checks (0292 fix-pass, R1/R8 closure). Backed by a CLI integration regression test and an R10 cross-check pin comparing `computeAggregate` vs `deriveVerdict` across every row-status shape in the guard vocabulary.

### Documentation

- **"A Day with the `/sp:dev-*` Slash Commands" walkthrough.** The CLI guide (`docs/help/how_to_use_spur_for_daily_software_development.md`) gains a §7 that walks a full workday driven by slash commands — morning orientation, planning (`dev-idea` / `dev-brainstorm` / `dev-plan`), execution (`dev-refine` / `dev-run` / `dev-runall`), wrap-up (`dev-wrap` / `dev-wrapall`), and blocked-work handover — complementing the CLI-only daily loop in §6.

- **Universal-router coverage for `/sp:dev-next`.** The slash-command guide now documents the status-aware router end to end: a command-map row, a mental-model diagram entry, a dedicated "universal router" section (TABLE A/B lookup, `--dry-run` / `--once` / `--full` / `--auto` / `--agent`, smart target detection for WBS / task path / feature id), and the command-vs-flag distinction between `/sp:dev-next` and the `--next` chain flag.

## [0.3.12] — 2026-07-17

### Added

- **`spur task run-link` — link a task to its pipeline run.** New CLI verb records a run link (`--source`, `--run-id`, `--json`) against a task WBS, so chained `/sp:dev-next` executions leave an auditable run trail on the task.

- **`/sp:dev-next` command and `sp:next-router` skill.** Next-step routing tables tell the agent exactly what to run after each pipeline verdict: batch-preflight STOP rows (A2/A7/A8/A9) with recovery hints, plus one-shot recovery after a FAIL. Wired into super-coder at batch boundaries — `task-pipeline.yaml` remains the happy path; deep-merge via looping dev-next is forbidden.

- **Dogfood-testing protocol @1.2.** Reports are now footer-mandatory with a 7-check finalize-or-abort gate (structure scrub, ledger cardinality vs `Steps:N`, footer mirrored at report end, refusal rule on any fail). Ships a `validate-report` CLI — pure `validateReport(md)` with stable error codes — plus golden/mutation fixtures.

- **Machine-checked pipeline-driving detection.** A word-boundary detector replaces the leading-space prose matcher for pipeline-driving testees, leading-space invariant without letting `run` leak into `runaway`. Adds a meta-run cost policy for implement-heavy chained steps (driver-vs-chained cost source table) and a stop-at-testing discipline: when chained-leg provenance is missing, the report says so instead of fabricating an outcome.

- **Review L3 done-gate.** The lifecycle adapter now refuses `testing → done` without a populated P1–P4 Review priority table — prose-only reviews can no longer slip through strict-core verification. Dogfood Phase 4 self-validates via the new `validate-report` CLI.

- **Teams board refinements.** Controls centralized in the Terminal tab; the server exposes team and message metadata for the board; the recent message feed is enriched; and the supervisor stamps process event identity onto runs.

### Fixed

- **System event actors derived from process agent ids**, so process-originated rows attribute to the right agent instead of a generic source.
- **Tighter automated workflow guards** across `/sp:dev-*` commands, closing gaps where automated runs could skip required gates.
- **Dogfood Phase 1.0 gate is shell-executable, not prose-only.** `evaluateDogfoodGate` ships as a bun CLI required before planning and after step derivation; W8 advisory documented; DD-09 acceptance-criteria gaps cleared.

### Changed

- **ADR-031 plugin layout for executable helpers.** Inside `plugins/sp`, executable TS helpers now live at `scripts/<skill>/` with their suites at `tests/<skill>/`; skill directories hold `SKILL.md` and prompt-side companions only. The daily-summary scripts/tests were relocated accordingly, and a structure test (R53) enforces the rule.

## [0.3.10] — 2026-07-13

### Added

- **Tool Using observability tab.** New web tab surfaces real-time agent tool-use telemetry: every `PreToolUse` / `PostToolUse` event with tool name, arguments, response, duration, and token cost. Backed by `TokenLedgerService` (reverse-tail cursor pagination over `token-ledger.jsonl`) and `TokenLedgerWatcher` (`fs.watch` fan-out with offset tracking), exposed via `GET /api/observability/tool-use` and an SSE stream route. The web tab polls the tail API live with a `lastEventId` cursor for efficient resumption.

- **CLI-driven task and feature status changes now surface in System Events (task 0249).** When `spur task create`, `spur task update --status`, `spur feature create`, or `spur feature update --status` runs, a row is written to the shared `system_events` SQLite ledger via a new `SystemEventEmitter` — so CLI-originated `task.created`, `task.transitioned`, `feature.created`, and `feature.transitioned` events appear alongside Board-originated rows in the System Events tabview. Sink failures are swallowed (never break the mutation); read-only CLI verbs never open the DB.

- **Hook matchers expanded to bash, grep, and glob.** The context-post-tool hook now pattern-matches `Bash`, `Grep`, and `Glob` tool calls (previously `Read`/`Write`/`Edit` only), with redaction of sensitive argument fields. A token cascade propagates the estimated token cost of each matched tool call into the token ledger, and session-start hints seed the indexed-context skill on first launch.

### Fixed

- **`sp-runtime-path` rule no longer flags `.pi-lens` cache snapshots.** The boundary rule's exclude list now includes `**/.pi-lens/**`, so autogenerated snapshot data in `.pi-lens/cache/` is not misclassified as a source-code path violation.

- **Exported `safeStringify` now carries TSDoc.** The shared JSON serialization helper in `system-event-tap.ts` was promoted to an export for reuse by the CLI emitter but lacked a doc comment; the `every-export-has-tsdoc` post-check rule now passes.

### Changed

- **System Events producer audit doc reflects narrowed CLI gap.** `docs/inventory/system-events-producer-audit.md` now shows planning events as Board+CLI reachable, with the Gap 1 path table updated to mark the CLI path as wired through `makePlanningEmitter(context)`.

## [0.3.11] — 2026-07-16

### Added

- **Teams board — a full module for managing agent teams from the web.** `spur team up` / `spur team down` / `spur team status` CLI verbs drive a persistent agent loop that the supervisor self-drains. A new web module (board) hosts four tabs: **Terminal** (team → member cascading dropdowns with live status badges, localStorage-persisted selection, start/stop with confirmation modal, stdin POST, local echo, and message enqueue for loop agents), **Processes** (live watch list with team / source / running-only filters and a per-row Attach button that jumps to the member's terminal), **Messages** (per-member inbox with `EventSource` live-tail that refetches on `message.sent` / `message.replied`), and **Activity** (timeline of team / message / agent / supervisor …

- **Cross-process registry exposes every harness-launched run.** A new `ProcessRegistry` records supervisor-tracked processes **and** one-shot agent executions. `apps/server` now injects the registry into the team module so `GET /api/team/processes` returns the full inventory — supervisor-tracked rows, ad-hoc `spur agent` runs, and descendants — with a `teamId` tag derived from `spec.tags.team:<id>` for grouping.

- **`spur agent loop` — a persistent agent loop the supervisor self-drains.** Long-running members stay alive between requests without per-call spawn overhead. `SupervisorService.defaultWrapperArgv` switches to `agent loop` and boot-time autostart resolves via `resolveAutostartSet` across `agent.team.*` config and `SPUR_TEAM_AUTOSTART`.

- **`spur init` substitutes AGENTS.md placeholders at scaffold time.** New projects no longer ship `{project-name}` / `{project-description}` placeholder tokens — `init` resolves them at write time. The bundled template is split into a **portable** `config/templates/AGENTS.md` (seeded by `spur init`) and a **monorepo-instance** root `AGENTS.md`, with a new alignment test that enforces the portable contract.

- **Declarative team config schema.** New `parseTeamConfig()` validates `.spur/config.yaml` `agent.team.*` blocks (collision rejection across composed ids), and a sample team ships in the bundled config so the Teams board has data to render on a fresh init.

- **`/sp:dev-verifyall` slash command.** Batch verification across a feature's task set — runs `/sp:dev-verify` over each member and emits a per-task PASS / PARTIAL / FAIL summary.

- **Tooltips in observability tabs surface more diagnostic fields.** Each renderer in `buildTooltipSummary` now shows 2–4 high-value fields instead of 1, with a shared `formatDuration` / `pickNumber` helper pair. The `workflow` renderer collapses `phase / transition / action` into one labeled pair (not three redundant ones).

- **Server error envelopes use status-specific messages in production.** Non-500 errors (404 / 409 / 422 / 503) now carry a client-safe message that corresponds to the status code instead of the generic "Internal server error". 500 errors still return the generic message with no stack leak.

### Changed

- **HITL default behavior is now deny, opt-in to approve.** The server-side default HITL responder never auto-approves unless the operator opts in via `SPUR_HITL_AUTO_APPROVE=1` (or the equivalent config key). The CLI desktop-notifier responder's non-macOS / osascript-error fallback also defaults to `no`. Eliminates the foot-gun where a missing interactive operator would silently approve work.

- **Model-status doctor column renders the full enum.** `spur agent doctor` shows the full status string (`available | quota_exhausted | rate_limited | unavailable | unknown`) instead of 3-char abbreviations.

- **Tool selection tab now lists `omp`, `Hermes`, and `Grok`** alongside the prior agents. Codex is removed from the supported list.

- **Tailwind 4.3.2** — bumped `tailwindcss` and `@tailwindcss/vite` to 4.3.2.

### Fixed

- **`spur serve` board 404 after global install.** The published `@gobing-ai/spur` package did not ship the Astro board static assets, so `http://localhost:<port>/board` returned `{"error":"Not Found"}` from any non-monorepo cwd (e.g. after `bun i -g @gobing-ai/spur`). `build:bundle` now runs `bundle-web` (copies `dist/web` → `apps/cli/web`), `package.json` `files` includes `web/`, and `resolveWebDistPath` looks next to the bundled `spur.js` / binary. Missing assets log a warning and browser-open falls back to `/api/health` instead of a JSON 404.

- **Restore package-root `config/` in the npm release (ADR-015).** After the bin moved to package-root `spur.js`, default config assets were nested under the leftover `spur-cli/config/` path and docs still said `dist/config`. Releases now ship top-level `config/` (via `bundle-config config` + `files: ["config", …]`); `bundledConfigRoot()` still accepts legacy `spur-cli/config`. **`spur init` full-tree seeds** every bundled asset into project `.spur/` (rules/**, workflows/**, tasks/**, templates/**, plugins/**), then applies the scaffold manifest for remaps and root-scoped docs/AGENTS — matching the monorepo symlink intent with real copies for end-user projects.

- **`POST /:team/up` now starts only `autoStart=true` members.** Prior implementation started every materialized member regardless of the spec's autoStart flag — contradicting the docs, the CLI, and the team definition. Routes now filter via `listAgentSpecs` so an `autoStart=false` member is created but not started.

- **Cross-team composed-id collisions are rejected.** Two teams that would compose to the same `<team>:<member>` id now fail config parse instead of silently shadowing each other.

- **ProcessesTab source filter aligns to production sources.** Dropdown now offers `supervisor` / `one-shot` / `other` (the labels actually produced) instead of `supervisor` / `registry` (the latter never matched production rows).

- **ProcessesTab filters use utility-only tokens.** Replaced DaisyUI `select` / `btn` classes with `bg-base-200` / `border-spur-border` / `text-spur-text` to satisfy the no-daisyui-class-leak rule.

- **Nested `<button>` removed from Roster member rows.** Restructured row to a styled `<div>` so Start / Stop are sibling buttons (no more invalid HTML or happy-dom hydration warning leak). MessagesTab uses the shared `<Button>` wrapper.

- **Terminal input no longer silently swallows stdin for loop agents.** Lines submitted while the active member is a loop agent now produce a local echo frame and a fire-and-forget POST to `/api/messages`, in parallel with stdin (for agents that do consume stdin).

## [0.3.7] — 2026-07-12

### Added

- **Runtime process-tree observability (task 0243).** New `spur observability processes` entry point and web **ProcessListTab** that render the OS process tree rooted at the server's own pid, with depth-based visual indent and per-row metadata (PID, parent PID, RSS, elapsed, source badge: `serve` / `supervisor` / `descendant`). Backed by a new `ProcessInspector` port in `@gobing-ai/spur-app` (port-and-adapter — tests inject fixtures, production shells out to `ps`) and a typed `ProcessInventoryService` that overlays supervisor-tracked processes onto the OS tree. The server exposes it at `GET /api/observability/processes` and returns `501 UNSUPPORTED_PLATFORM` on hosts without a parseable process table.

- **`bridgeEventBus<T>()` — single shared EventBus bridge helper.** Replaced three hand-rolled `on/off/emit` bridge implementations in `AgentService`, `RuleService`, and `WorkflowService` with one typed utility. Also picked up by the server's context to replace seven `eventsBus as unknown as never` casts in the bootstrap, so the event-bus wiring is now type-safe end-to-end.

- **`spur init` substitutes AGENTS.md placeholders at scaffold time (task 0242).** New projects no longer ship `{project-name}` / `{project-description}` placeholder tokens — `init` resolves them at write time. The bundled template is split into a **portable** `config/templates/AGENTS.md` (seeded by `spur init`) and a **monorepo-instance** root `AGENTS.md`, with a new alignment test that enforces the portable contract.

- **Tooltips in observability tabs surface more diagnostic fields (task 0234).** Each renderer in `buildTooltipSummary` now shows 2–4 high-value fields instead of 1, with a shared `formatDuration` / `pickNumber` helper pair. The `workflow` renderer collapses `phase / transition / action` into one labeled pair (not three redundant ones).

### Changed

- **Server error envelopes use status-specific messages in production (task 0241 R2).** Non-500 errors (404 / 409 / 422 / 503) now carry a client-safe message that corresponds to the status code instead of the generic "Internal server error". 500 errors still return the generic message with no stack leak.

- **HITL default behavior is now deny, opt-in to approve (task 0241 R1).** The server-side default HITL responder never auto-approves unless the operator opts in via `SPUR_HITL_AUTO_APPROVE=1` (or the equivalent config key). The CLI desktop-notifier responder's non-macOS / osascript-error fallback also defaults to `no`. This eliminates the foot-gun where a missing interactive operator would silently approve work.

- **Server SSE stream helpers consolidated (task 0241 R8).** The team live-tail and events planning streams now share a single `sendSseKeepalive` / `enqueueSseFrame` helper module (`apps/server/src/modules/sse/stream-helpers.ts`) so the two streams cannot drift on heartbeat framing.

- **App-layer domain errors are now typed and reach the server error-handler via `instanceof` (task 0241 R9).** `GuardDeniedError` (→ 409), `LockTimeoutError` (→ 503), and the `hitlAutoApproveEnabled` / `hitlConfirmDefault` helpers live in `@gobing-ai/spur-app` so throw sites in `PlanningWriteService` raise the same types the server matches.

- **Model-status doctor column renders the full enum (task 0239 R4/AC1).** The `Model` column in `spur agent doctor` shows the full status string (`available | quota_exhausted | rate_limited | unavailable | unknown`) instead of 3-char abbreviations — self-documenting on the doctor table.

- **`spur task refresh` is now `re-scan corpus` (task 0235 / 0192 follow-up).** `kanban.md` is retired; the **web Task Kanban board** is the single source of truth. `--strict` is now an option on `spur task resolve`. New verbs `migrate` (one-time A17 corpus normalization), `refresh-roster <wbs>` (regenerate a parent's sub-task roster), `verdict <wbs>` (derive a verdict JSON from verify-answer text), and `path <wbs>` (inverse of `resolve`).

- **Spur-supported agent list expanded.** Codex is dropped; `omp`, `Hermes`, and `Grok` are added to the supported-agent list in `AGENTS.md` and the `AgentDetector` catalog. (The catalog update was an internal-side artifact; the user-facing consequence is that `spur agent doctor` recognizes the new detectors.)

- **`PatchFrontmatterField` matches only inside the frontmatter block.** A body line shaped like `priority: ...` can no longer be rewritten when `priority` is absent from frontmatter; the matching is constrained to between the opening and closing `---` fences.

- **Config loader cache is mtime-based.** Long-running servers now pick up `.spur/config.yaml` edits without restart; an exported `invalidateSpurConfig(path?)` provides explicit cache clearing.

### Fixed

- **`spur agent --timeout` rejects non-numeric values (task 0240 R4).** A `--timeout abc` no longer propagates `NaN` to the runner; the CLI now returns exit 2 with a clear validation error before any spawn.

- **InboxTab poll + focus-refetch race (task 0241 R5).** The 15-second poll interval and focus-refetch callback now track an `AbortController` that is aborted on cleanup AND whenever a new request starts — no more in-flight requests writing to `setMessages` after unmount.

- **`Bun.spawn([editor, path])` now respects multi-word `$EDITOR` (task 0241 R6).** Editors like `code -w` or `cursor -n` no longer break when launched from `spur agent --editor`; the spawn now uses `shell: true` so the editor command splits correctly.

- **`spur serve --json` reports the spawned server pid, not the CLI's own (task 0241 R7).** The PID field in `--json` mode is now forwarded from the server startup log.

- **Migration 0005 (`ALTER TABLE runs ADD COLUMN pid`) is idempotent on retry (task 0240 R8).** The migration now declares `addColumnIfMissing: { table: 'runs', column: 'pid' }`; the dead `builtInAddColumnGuard` fallback was removed (0007 already has its own explicit guard).

- **Web InboxTab abort controller (task 0241 R5).** Same fix as above; documented separately for changelog visibility.

- **`patchFrontmatterField` no longer rewrites body lines (task 0240 R2).** See Changed section.

- **Config cache invalidation (task 0240 R9).** See Changed section.

- **Plugin `sp-dev-run` task-corpus stabilities (task 0240 R12 / R14).** `TaskService.create` and `createBatchItem` now share one `renderCreatedTaskContent()` helper (was ~80-line near-duplicate). `TaskService.findTaskFileName` searches all registered task folders, so `spur task show <wbs>` resolves any task that `spur task resolve` finds.

- **`Config` and `Task` task-corpus stability fixes (task 0240 R1, R3, R5, R6, R7, R10).** Removed the dead private-host gate in `http-request.ts` (allowlist already enforces the same security property). Consolidated `yamlSafeValue` / `formatYamlValue` into one `escapeYamlValue` export with proper `"` and `\` escaping. Fixed `SchemaLifecyclePort` docstring to match code (same-status guard only). Replaced `stat()` with `lstat()` in `scanWorkflowFiles` so symlink detection works. Added a `.catch` to the supervisor `pipeStream` reader chain so stream errors no longer surface as unhandled rejections. Markdown table cells in `renderTesting` / `renderReview` now escape `|` in evidence text.

- **Server tests/quality:** removed `_CoverageAnchor` class from `apps/server/src/context.ts` (task 0241 R3) — the `void new _CoverageAnchor()` invocation that was keeping the class alive purely for the coverage gate is gone, and the accessors it was keeping alive now have real tests.