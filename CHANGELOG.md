# Changelog

## [Unreleased]

_No changes yet._

## [0.3.2] — 2026-07-05

### Added

- **Embedded job queue + scheduler (task 0190, waves 0200/0201).** `packages/app` gains `JobWorkerService` and `JobHandlerRegistry` (drain, process-once semantics); `apps/server` ships a jobs observability module (queue stats, worker drain) and `serve.ts` wires worker attach/detach with autostart. Backed by a new `runs.external_key` column migration (`drizzle/0007`).
- **Observability board module (task 0189, waves 0198–0210).** New `system_events` append-only ledger DAO + tap in `packages/domain`; SSE-streamed planning events surfaced through `registerSystemEventTap()` with per-handler try/catch isolation. `apps/web` lands the observability shell with System Events, Inbox, Jobs, and Process List tabs (auto-discovery contract, polling refresh, accessible focus/keyboard nav).
- **Cross-agent inbox IPC message bus (task 0193, waves 0204–0206).** Server `POST /api/messages` and `GET /api/messages/inbox` read APIs; `TeamService.listRecent()` cross-recipient newest-first feed via new `InboxRecentDao`. Message lifecycle (`message.sent`/`message.replied`) events wired to the SSE stream. New `spur message watch` CLI verb with configurable `--interval`; `apps/web` `InboxTab` live tail backed by message events.
- **Team process supervision (task 0195, waves 0207–0210).** `SupervisorService` in `packages/app` (spawn/exit/stop events, autostart, SIGTERM→SIGKILL escalation, 60s exit cleanup) with 100% line coverage. Server team module mounts the supervisor; `apps/cli` ships `spur team start|stop <agent-id>` that POST to the running server (replacing Phase-4 daemon stubs); `apps/web` `ProcessListTab` lists supervised processes and subscribes to `process.*` SSE events. `SupervisorService.writeStdin` forwards lines to child stdin.
- **Features board module (task 0194).** `packages/app` feature client + typed contracts for feature DTOs; `apps/web` tree view + detail panel + lifecycle actions. Server feature handlers wired into context and event names.
- **Workspace web module (tasks 0196/0197).** Module structure under `apps/web/src/modules/observability/` per the auto-discovery contract; routing/keyboard/persistence notes backfilled in task 0199.
- **Task-kanban web parity (task 0191, waves 0202/0203).** `NewTaskPanel` markdown editor and `TaskDetail` metadata render close the F7 parity gap; `task-service` + `task-check` refinements and task DTO updates in `packages/contracts`.
- **`spur-init` rule glob adaptation (task 0188).** Replaces the "dogfood-artifact" excuse with Phase 1.6 — an LLM-as-judge pass that detects project layout (monorepo / single-package / flat / polyglot) and rewrites layout-dependent recommended-pre-check globs to match actual roots, writing adapted overlays to `.spur/rules/<category>/`. `spur rule run --preset recommended-pre-check` now reports zero `kind:'error'` findings on fresh scaffolds. Adds R45 structural test; extends the `04_DESIGN.md §1.1` ownership contract.
- **`sp:dev-unit` file-focused workflow.** Test file naming convention, directory mirroring, iteration rules with max-3-pass escalation, coverage-gap diagnostic for V8 function coverage quirks, and a task-scoped Workflow B with status transition guard.
- **Per-workspace lcov merge script (initial).** `scripts/merge-coverage.ts` runs each workspace's tests with coverage, resolves SF paths to repo-root-relative, deduplicates with max-hit per line, and writes `.coverage/lcov.info` for the coverage-gate rule. (Superseded by the native Bun cutover below.)

### Changed

- **Cutover to native Bun coverage gate; delete `merge-coverage.ts` (355 lines).** `package.json` test scripts rewired to a single-invocation native Bun runner producing one merged `.coverage/lcov.info` across all workspaces in ~15s. `bunfig.toml` keeps `coverageThreshold` at 0.9/0.9 (lines/functions) and adds `**/*.tsx` to `coveragePathIgnorePatterns` — React components are exercised via happy-dom integration tests, not unit tests. `AGENTS.md` coverage language synced. `_No changes yet._` placeholder retired.
- **Task-kanban board refactor.** `TaskFilters` collapsed to a single dataset-keyed `onChange` handler (4 fns → 2; callback-identity exception to `ts-no-tiny-functions`); broken `fireEvent.change` happy-dom block dropped and tests consolidated around the api-mock harness.
- **`startServer` DI refactor.** Server `index.ts` uses dependency injection for `startServer`, enabling direct testing of the `main()` bootstrap path without `mock.module` leaks (59% → 95.5% line coverage).
- **`spur-init` ownership contract.** `init.test.ts` adds 4 tests (SSOT manifest↔TASK_VARIANTS invariant, source-resolution, task-create probe, brainstorm assertion); `04_DESIGN.md` fixes template inventory (default→standard, adds brainstorm); skill-structure test R43 scoped to Command index section.
- **Command docs aligned with CLI source.** `cmd_feature.md` adds the `advance` subcommand and drops the phantom `migrate` entry; `plugins/sp/README.md` consolidates marketplace metadata, on-ramps, batch/parallel paths, and the full command index.
- **Task lifecycle records refreshed.** Tasks 0188–0213 decomposed into wave sub-tasks; parent tasks moved todo → wip; feature rosters auto-generated via `spur task refresh-roster`; A1/0188 marked done. New planning record at `docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md`.

### Fixed

- **JSON log-line output leak during multi-path test runs.** `apps/server/src/worker.ts` `defaultBootstrap` now falls back to `process.env.NODE_ENV` when the Cloudflare Worker `env` arg omits it, so `bun test` (NODE_ENV=test) flows into `serverBootstrapConfig` and disables logging — mirroring the CLI guard at `apps/cli/src/index.ts:66`. Previously `worker.fetch(req, {})` in tests reconfigured LogTape with a console sink (`initializeLogger({console:true,json:true})`), replacing the fatal-only mute from `tests/setup.ts` and bleeding 96 JSON `@timestamp` lines from `app.workflow`, `app.rule-engine`, and `app.ai-runner.shims` loggers during `bun test ./apps/cli ./apps/server ./apps/web ./packages ./plugins`. Verified: leak 96 → 0, full suite 2380 pass / 0 fail.
- **Task-service `refresh` scope.** `resolveFolder()` now returns the resolved candidate path (was returning the raw input) and refresh scans all configured folders, not just `tasksDir`.
- **Cross-workspace lcov phantom uncovered lines.** `scripts/merge-coverage.ts` filters lcov records by owning workspace so different workspaces instrumenting the same source file don't introduce phantom uncovered lines (drops phantom gaps 58 → 7 real).
- **`spur-init` scaffold manifest SSOT (task 0188).** Enforces scaffold manifest↔`TASK_VARIANTS` invariant; dedupes the Implementation block; scopes R43 to Command index only.
- **`sp-plugin` YAML frontmatter quoting.** 7 skill frontmatters had unquoted `: "` descriptions that YAML parsed as mapping pairs, breaking `superskill install` with "incomplete explicit mapping pair". Now wrapped in double quotes with inner `\"` escapes (code-implementation, code-testing, code-verification, spec-decomposition, spur-dev, doc-evolve, dogfood-testing).
- **CLI coverage gaps.** `apps/cli/src/index.ts` extracts the `import.meta.main` block into exported `runCli()` for direct testing without `process.exit()` (88% → 95.3% line coverage); unused `cwd` variable removed from the runCli test.
- **Lint warnings.** Unused imports, non-null assertions, and string-concat → template literals cleaned; `no-leaky-module-mocks.yaml` excludes `index.test.tsx` (uses `mock.module` for hooks + rpc-client proxy).

## [0.3.1] — 2026-07-03

### Added

- **`sp-no-vendor-refs` boundary rule (task 0187).** New `config/rules/boundary/sp-no-vendor-refs.yaml` forbids any `plugins/sp` file from referencing `vendors/`; runs as the 29th recommended-pre-check rule so `bun run spur-check` gates the boundary. Structural test R20 remains as defense-in-depth.
- **Task 0187 closeout record.** `docs/tasks2/0187_adopt-vendors-skills-lessons-into-plugins-sp-10-point-improv.md` lands the program's closeout documentation.

### Changed

- **Adopt vendor skill-engineering lessons across the `sp` plugin (task 0187).** Pruned all 16 skill descriptions to enforced budgets (aggregate 4173/4400 chars); flipped `daily-summary` and `branch-workflow` to `disable-model-invocation`; reworked `sys-debugging` to feedback-loop-first and added the vertical-slice doctrine to `spec-decomposition` and the deep-module vocabulary to `sys-architecture`. Added a plugin `README.md` (flow map + command index) and a `spur-dev` glossary SSOT (`references/glossary.md`). Pruned duplication (`code-verification` 424 → 359, `brainstorm` 422 → 278 lines). Hardened `dev-handover` (suggested skills, redaction, no-duplication rules). Added structural tests R42–R44; fixed the R43 word-boundary regex-escaping bug.

## [0.3.0] — 2026-07-03

### Added

- **Web design system + theming + responsive (W4/0085)** — design tokens via Tailwind `@theme` (Spur identity palette, semantic colors, typography), dark mode toggle with daisyUI theme switching, localStorage persistence, and `prefers-color-scheme` first-load respect. Mobile responsive: left sidebar → slide-in drawer, right panel → bottom sheet on viewports <768px. FOUC-prevention inline script in `index.astro`.
- **`spur feature update --section/--from-file` (0175, Wave D).** `feature update` now accepts an optional `--section <name>` + `--from-file <path>` pair that rewrites a single frontmatter-or-body section from a file, mirroring `spur task update`. The feature body sections (Status, Acceptance Criteria, Linked Tasks, etc.) become machine-writable without a full-body round-trip. `wrapup-pipeline.yaml`'s feature-transition step now uses `feature update --section` for its linked-tasks write, replacing the previous inline `sed` shellout.

- **HITL workflow actions and responders** — three human-in-the-loop action runners (`hitl.confirm`, `hitl.select`, `hitl.input`) plus CLI (`ClackHitlResponder`) and non-interactive (`DefaultHitlResponder`) responders. Answers flow back via engine `setVars` so guards can branch on user input. Responder selected per `isatty(1)`: interactive `@clack/prompts` when attached to a terminal, configured defaults in CI/headless. Wired through `SpurWorkflowBuiltinsOptions`, `WorkflowAppServiceContext`, and `CliContext` with the same injection pattern as `agent.run`/`rule.check`. Engine catalog bumped to `^0.3.10` for `HitlResponder` contract.
- **`--continue` flag wired through sp-plugin dev commands.** `/sp:dev-idea`, `/sp:dev-plan`, and `/sp:dev-run` now pass `--continue` through to the underlying `spur agent run` invocation, enabling session-resume across pipeline steps.

### Changed

- **`hitl.confirm` cancel now routes via `__hitlAnswer` (0182 Wave A).** The `task-pipeline.yaml`
  `approve` gate replaced its single `always -> verify` guard with three ordered guards mirroring
  `idea-pipeline.yaml` — `__hitlAnswer = yes -> verify`, `= no -> failed`, `= cancel -> cancelled`
  (declaration order: yes, no, cancel; no `always` edge remains). `cancelled` is a new terminal
  state. This is a behavior change for any workflow consuming the approve gate's old pass-through.
  New `file.read.into-var` builtin resolves absolute paths without re-joining `context.workdir`.
  Idea-pipeline sentinel/guard hardening closes the same HITL-routing gap in `idea-pipeline.yaml`.
- **Verification depth tightened.** `sp:code-verification` now includes a design-conformance
  pass and `spur task verdict` downgrades behavior-bearing CORE AC rows from `MET` to
  `PARTIAL` unless they carry `test` or `command` evidence. CLI-surface tasks are expected
  to preserve a golden-path `--json` command evidence row.
- **Feature wrap-up lifecycle walk centralized.** `spur feature advance <id> [--to <status>]`
  now owns the legal forward path (`backlog→active→verifying→done`) and replaces the inline
  shell status ladder previously embedded in `wrapup-pipeline.yaml`.
- **Agent doctor precheck + design-approval flag + CLI facade sync (0176 Wave E).**
  `task-pipeline.yaml` and `idea-pipeline.yaml` now run `spur agent doctor ${vars.agent}` before
  agent-run work; `idea-pipeline.yaml` raises `iterationBound` to 25 on its retry-capped edges.
  `/sp:dev-idea` and `/sp:dev-plan` expose `--design-approved` as the wrapper path for
  `design_approved=true`. `spur-cli/references/tasks/verbs.md` documents `task verdict`,
  `task refresh-roster`, `task path`, and `resolve --strict`. `task-write-guard.ts` keeps its
  versioned guard decision logic local with fail-open and decision tests; `hooks.json` stays on
  the portable `superskill hook run sp task-write-guard` entrypoint.
- **Decomposition wiring — `spur task batch-create` auto-wires parent tasks (task 0178, 0176 Wave B / F1+F2).** When a batch carries items with `parent_wbs`, the service now (a) invokes `spur task refresh-roster` for every distinct parent after the atomic create lands (auto-generates the `## Plan` sub-task roster block) and (b) transitions each parent from `todo` to `wip` via the lifecycle-guarded verb (`writeService.transition`). Wire-up is best-effort per parent — partial failures record into the new `parentsWired` return field and do not abort the batch (children are already on disk). The CLI surfaces a per-parent line in both human and `--json` output. `batchCreate`'s return type is now `{ children: WriteResult[]; parentsWired: ParentWireResult[] }`. `spur-dev/references/execution-batch.md` Step 1 gains an umbrella-parent exclusion rule (R1.5) that drops any `ready` candidate with open children. `spec-decomposition/references/decomposition.md` and `spur-dev/references/planning-workflow.md` no longer mention the "hand-write the roster" workflow or the "deferred roll-up gate" — both are shipped.

### Removed

- **`@gobing-ai/spur-plugin-sdk` package removed.** The plugin substrate moved upstream to a bare `PluginHost` + `Plugin` lifecycle core in `@gobing-ai/ts-infra`, consumed via `runApplication` (ADR-012 amendment). `packages/plugin-sdk` is deleted; the server's unused plugin-route plumbing is removed. The previously published `@gobing-ai/spur-plugin-sdk@0.1.8` remains on npm but receives no further releases. The release script and Publish workflow no longer build or publish it.
- **`spur plugin` placeholder command removed.** Plugin discovery is deferred after the ADR-012 amendment, so the always-empty `plugin list|info` CLI surface is removed until a real plugin consumer exists.

### Fixed

- **Pipeline hardening across idea/planning/wrapup/task (0176 Wave C).** Implement-step agent runs now enforce a timeout; `file.read.into-var` and `agent.run` actions resolve absolute paths instead of re-joining `context.workdir` and double-rooting; idea/planning/wrapup pipelines reject undeclared variables at validate time and create missing output directories at run time.
- **`--vars` JSON-string double-encoding.** `spur workflow run --vars '<json>'` parsed the flag once at the CLI boundary and again inside the workflow app service, corrupting nested JSON values. Single-parse fix; dev-command wrappers that pass `--vars` now carry a raw JSON string.
- **Dogfood report contract enforcement.** `sp:dev-dogfood` rejects reports missing the mandatory `### 3. Monitor Ledger` table; `sp:super-coder` wording corrected to match the single-task-vs-batch contract.
- **Task-check unchecked-box rule.** `spur task check` now flags an unchecked `- [ ]` box in the Plan section as a readiness failure — a task with outstanding sub-items cannot pass `check`.

## [0.2.12] — 2026-07-01

### Added

- **Idea-to-feature pipeline (`idea-pipeline.yaml`).** New 13-state state-machine workflow
  that converts a vague idea into a validated feature with acceptance criteria and a
  decomposed task batch — discovery → feature-create → ac-generate → feature-check →
  system-design → design-approval → decompose → batch-create → handoff. The pipeline
  stops at handoff; tasks are created but not executed. Retry caps on cyclic edges
  (feature-check↔ac-generate, batch-create↔decompose) prevent infinite loops.
- **Post-execution wrap-up pipeline (`wrapup-pipeline.yaml`).** New 9-state workflow
  that closes out a task batch: resolve → doc-sync → learning-capture → metrics-record →
  feature-transition → done. Writes `.spur/memory/learnings.md` and
  `.spur/memory/wrapup-metrics.jsonl` for cross-session continuity.
- **Three new slash commands.** `/sp:dev-idea` drives the idea pipeline; `/sp:dev-wrap`
  wraps up a single task; `/sp:dev-wrapall` wraps up a feature's task set. All three
  delegate to the new pipeline YAMLs.
- **Plugin structural hardening.** The `sp` plugin (manifest version-synced at 0.2.12) ships with R30–R35 structural test
  invariants (22 tests), cross-cutting convention documentation (CLI-gated writes,
  section matrix, check-before-write, HITL taxonomy), a product-planning skill
  (RICE/MoSCoW prioritization, strategy profiles), and parallel execution framework docs.
- **`agent.run` expectFile option.** Workflow `agent.run` actions now accept an
  `expectFile` option that verifies the expected side-effect artifact exists on disk
  after a successful (exit-0) agent run. If absent, the step returns `ok: false` with a
  descriptive error. 31 tests, 100% coverage.
- **Session checkpoint writes.** Terminal states in `feature-dev.yaml`,
  `planning-pipeline.yaml`, `task-pipeline.yaml`, and `wrapup-pipeline.yaml` write
  session checkpoint markers to `.spur/memory/sessions/` for pipeline resume support.
- **Cross-cutting conventions reference.** `gate-checklists.md` codifies R30–R35
  invariants; `cross-cutting.md` documents the six write-discipline conventions shared
  by the orchestration spine and all competency skills.

### Changed

- **Pipeline quality gates hardened.** The `task-pipeline.yaml` implement stage now runs
  `bun run format` as a post-agent cleanup step, preventing unformatted agent output from
  reaching the test stage. The test stage runs `bun run lint` as a post-agent gate — if
  the lint gate is red, the run routes to `failed` before review can advance.
- **`/sp:dev-wrap` and `/sp:dev-wrapall` accept `--dry-run`.** The flag passes through
  to `spur workflow run --dry-run`, validating transitions without writing corpus or
  memory artifacts.
- **`bump-ver` syncs plugin manifests.** `bun run bump-ver <version>` now also updates
  `.claude-plugin/marketplace.json` and `plugins/sp/plugin.json` so the `sp` plugin
  version stays in lockstep with the spur CLI release.

### Fixed

- **R-numbering heuristic false-positive on multi-line requirements.** The task
  Requirements L3 check now counts requirement blocks (blank-line-separated paragraphs)
  instead of individual lines, so a multi-line R-item body no longer dilutes the ratio
  and triggers a spurious warning.
- **Planning pipeline design-approval was a pass-through under auto.** The
  `design-approval` state in `planning-pipeline.yaml` was a bare node with no pause
  mechanism — under `profile=auto` without explicit `design_approved=true`, it
  auto-transitioned to handoff instead of pausing as a taste gate. Fixed: added
  `pause: true` + `hitl.confirm`, matching the idea-pipeline pattern and the design doc
  HITL taxonomy.
- **Idea-pipeline YAML validation failure.** Two transition descriptions with unquoted
  `(retry cap: 3)` caused `spur workflow validate` to fail on YAML nested-mapping parse
  errors. Quoted both descriptions.

## [0.2.11] — 2026-07-01

### Added

- **Parallel execution mode for batch task runs.** `sp:super-coder` gains an optional
  parallel fan-out — default sequential, enters parallel only on explicit request when
  the fan-out checks (dependency, file-overlap, token-budget) pass. `/sp-dev-runall`
  accepts `--mode <sequential|parallel>`. Two new invariants guard the seam: R28
  (workflow schema ref + HITL pause) and R29 (parallel batch contract consistency).
- **Four new dev skills: debug, review, branch, parallel.** `sp:sys-debugging`
  (5-phase debugging protocol), `sp:code-review` (pre-commit self-review + SECUA agent
  review), `sp:branch-workflow` (branch lifecycle, worktrees, merge prep), and
  `sp:parallel-execution` (fan-out patterns, result synthesis) ship as backing skills.
  The thin `dev-branch` / `dev-debug` / `dev-review-req` command wrappers were added
  and dropped within this cycle — invoke the skills directly.
- **`/sp-dev-parallel` command** wrapping the parallel-execution skill with
  `$ARGUMENTS` passthrough.
- **Task-type-aware pipeline dispatch in `/sp-dev-run`**, routing by task type.
- **L4 advisory suffix in `/sp-dev-refine` SKIP verdicts**, surfacing the next-level
  check when a section is skipped.
- **`feature_id` advisory on `spur task done`.** When a task reaches `done` without a
  `feature_id`, prints a human-only nudge (skipped under `--json`) linking the task to
  its feature for traceability.

### Changed

- **Config loading cached; schema refs resolve from disk.** `loader.ts` adds
  `spurConfigCache`, `planningFoldersCache` (WeakMap on `FileSystem`), and `cacheKey()`
  so repeated `loadSpurConfig` / `resolvePlanningFolders` calls skip re-reads; failed
  loads evict from cache. `resolveSchemaSpecifier()` resolves
  `@gobing-ai/spur/package.json` to the workspace manifest on disk in dev, fixing JSON
  Schema validation in the monorepo. `task.ts` adds `sectionMatrixCache` for
  `loadSectionMatrix`. Three loader tests cover schema-ref resolution, global fallback
  parity, and planning-folders caching.
- **`task-pipeline.yaml` enables `pause: true` on the `approve` state (E3 HITL)**,
  removing the stale deferred comment about the global schema. `basic.yaml` adds a
  `$schema` ref.
- **Skill polish across the sp plugin.** `code-verification` gains section-write
  guidance for the Testing field; `secu-review` gains a pre-completion checklist;
  `spur-dev/dev-operations` codifies the L4 advisory in the SKIP contract;
  `spur-dev/execution-batch` documents the parallel execution path;
  `code-implementation/implementation-patterns` adds context-reuse guidance;
  `spur-cli` and `sys-architecture` fix unquoted YAML descriptions. R24–R27
  invariants cover description quoting and cross-ref integrity.

### Fixed

- **Planning-core YAML scalars and table-format file:line citations.**
  `markdown-document.ts` adds `normalizeYamlScalars()` (Date→ISO) and `yamlSafeValue()`
  to quote-unsafe scalars on write. `task-check.ts` adds `hasAdjacentFileLineColumns()`
  so L3 accepts markdown table rows with `file:line` in adjacent columns (P3 from task
  0166). Three regression tests cover the table-format detection.

### Misc

- New models added to `.spur/config.yaml`.
- `.tmp-*` directories ignored.
- Tracking docs updated for the 0161–0166 task cycle.

## [0.2.10] — 2026-06-30

### Added

- **Functional skill split — competency skills + thin spine (ADR-028).** The monolithic `sp:spur-dev`
  skill is decomposed into a thin orchestration spine that dispatches five deep competency skills:
  `sp:code-implementation` (task-driven implementation, root-cause debugging, Solution change-maps),
  `sp:code-testing` (coverage measurement, gap analysis, per-stack adapters for Bun/TS, Go, Python),
  `sp:code-verification` (requirements-traceability verdict + SECUA review),
  `sp:sys-architecture` (ADR judgment, module boundaries, build-vs-extend decisions), and
  `sp:spec-decomposition` (feature→task-batch decomposition). The four `spur-<noun>` skills
  consolidate into a single `sp:spur-cli` CLI facade with per-noun references. Five noun-experts
  retire in favor of `sp:expert-spur`. The `sp:super-coder` agent broadens to drive single-task
  end-to-end pipelines in addition to batches.
- **Verify acceptance criteria guard with typed evidence ladder.** The `sp:dev-verify` command now
  automatically evaluates acceptance criteria when present, with typed evidence
  (`test`/`command`/`static-ref`/`manual-review`/`llm-judge`/`n/a`) so weak proof is visible.
  Objective AC cannot be certified by `llm-judge` alone. AC statuses and blocker/major findings
  fold into the aggregate PASS/PARTIAL/FAIL verdict. The verdict schema contract now carries an
  `acceptanceCriteria` array.
- **Dogfood Monitor Ledger with deterministic cache methodology.** Every dogfood report now requires
  a mandatory `### 3. Monitor Ledger` table as the audit trail, with a deterministic `cache%` formula
  computed from per-row Fresh/Cached Token sums and a mandatory Basis column. An anti-fiction rule
  prevents invented cache percentages.
- **Plugin structural invariants locked in test suite.** Seven new invariant tests (R13, R16a–d,
  R20–R23) guard the functional skill split: cross-cutting.md single-SSOT, disjoint trigger surfaces
  across skills, no dangling cross-skill references, no retired entity names, no vendors/rd3
  references in shipped plugin files, mandatory AC guard semantics in verify path, mandatory monitor
  ledger in dogfood path, and no unscoped ignore rules that hide plugin entrypoints.

### Changed

- **Full lifecycle scaffold in task templates.** All six task templates (`standard`, `feature-impl`,
  `issue`, `review`, `meta`, `brainstorm`) now carry the complete lifecycle section scaffold with
  guidance comments. The section matrix replaces forbidden section lists with broadly-permissive
  optional lists so templates can pre-include all sections without check failures.
- **Task template tightening.** The `feature-impl` template auto-populates `{{ FEATURE_ID }}` in the
  References section when created with `--feature`. The `review` template drops a redundant
  `template: review` frontmatter line (the creation path always sets it).
- **`sp:spur-plan` skill stub removed.** The thin placeholder carried no active consumers — its
  planning narrative has always lived in `sp:spur-dev`. References in `sp:spur-dev` and `spur-init`
  updated accordingly.
- **`plugins/README.md` regenerated** from the live `plugins/sp/` file tree with accurate skill
  versions, expanded reference-file directory layout, corrected relationship diagram, and updated
  migration scorecard.
- **Scaffold paths migrated** from `.spur/config/` nested layout to `.spur/` flat paths
  (workflows → `.spur/workflows/`, templates → `.spur/templates/`).

### Fixed

- **Vendors protection.** The `protected-files.yaml` no-modification rule now excludes `vendors/`.
- **Spur-cli gitignore scoped to repo root.** The `spur-cli` ignore patterns are now anchored so
  they don't hide plugin skill entrypoints in nested paths.
- **Missing review checklist item.** The review template Plan checklist now includes "Fix all the
  remaining findings if any."
- **Hook error handling.** The task-write-guard hook error path is hardened.
- **Daily-summary and task-write-guard tests** use spy-based stubs instead of PATH-shim mutations
  for improved portability.

## [0.2.9] — 2026-06-29

### Added

- **Board module auto-discovery (web).** Board-registry modules are now discovered automatically at
  build time and wired to the runtime registry; bare `/board` redirects to the default module.
- **Batch task execution — `/sp:dev-runall` + `sp:super-coder`.** Run a set of tasks through their
  pipelines in dependency-correct order, with a batch report emitted at the end.
- **`spur workflow cancel <run-id>`.** Cancel a running workflow with pid-tracked subprocess kill.
- **SECUA framework for `sp:dev-review` / `sp:dev-verify`.** The review and verify commands are
  extended to the SECUA review framework.
- **`sp:dev-gitmsg` per-file summarization.** Commit-message generation now groups changes by
  concern and summarizes per file.
- **Actionable `feature_id` warning in `spur task check`**, plus a done-gate regression test.
- **`sp:super-coder` Definition of Done contract** — DoD housekeeping, dogfood persistence, and
  point-of-action enforcement via a terminal gate.

### Changed

- **Portable task-write-guard hook.** The `sp` task-write-guard hook is now portable across installs.

### Fixed

- **Task status normalization before lifecycle transitions.** Opaque `FSMError` on case-drift is
  resolved; task/feature status is normalized at the planning-write boundary.
- **L3 review/plan checks hardened.** The L3 Review rule now handles prose-only and empty-cell
  scaffolds; the L3 Plan check scans all lines with a refine pre-synthesis skip gate.
- **Refine skip-gate scoped to target sections**, with updated Review guidance.
- **Lifecycle gate backstop inlined** and `implement` `onEnter` reordered; project-local workflow
  fallback with a non-strict done-gate.
- **Workflow definitions realigned** with the SECUA rename and the batch delegation contract.
- **GitHub Actions workflows fixed.**
- **Hook error handling fixed.**
- **`sp:dev-dogfood` `--max-retry` default** corrected.

## [0.2.6] — 2026-06-26

A release focused on three surfaces: the **Spur Board web app** (Tasks as the default
module and a documented module-hub pattern), the **`sp` dev-workflow plugin** (the
`--next` step-chain, `--agent` overrides, and feature-level orchestration), and the
**planning layer** (verdict/record/roster verbs and stricter gates).

### New Features

- **Spur Board: Tasks is the default module.** The placeholder landing module is gone;
  opening the board lands on the Tasks kanban. A new *How to Add a UI Plugin to the Spur
  Board* guide documents the module-hub pattern — adding a self-contained React view takes
  one directory and one registry line, with no routing or sidebar wiring.
- **Task Kanban board.** Tasks render as a status-grouped kanban with the active folder
  selectable (not positional), plus a resizable right-dock task-detail panel, a New Task
  slide-out, and inline task-body editing with Save/Cancel.
- **Contextual workflow actions in TaskDetail.** Action buttons and a cancel-confirm modal
  surface human-in-the-loop transitions directly from the board, backed by a new
  `POST /tasks/{wbs}/actions` write API.
- **`sp` dev-workflow `--next` step-chain.** `dev-refine` → `dev-run` → `dev-verify` now
  chain via `--next`, honoring the task-lifecycle FSM (no `--no-lifecycle` in interactive
  chains) and stopping review-pending on guard failure. `dev-run --next` implies
  `--mode implement` instead of erroring on full mode.
- **`--agent` override across dev-* commands.** Dev commands accept an explicit agent, and
  `--agent` auto-resolution is now phase-aware (executor profiles). `spur agent doctor`
  reports readiness with an aligned table, status glyph, and tri-state auth column.
- **Feature-level orchestration.** The dev workflow can plan and run at the feature scope,
  not just the task scope. `sp:spur-plan` and a design-doc generation mode feed planning.
- **New dev skills & commands:** `dev-brainstorm` (grilling discovery with `--task`),
  `/sp:dev-dogfood` (`--full` all-severity reporting), `sp:spur-tdd`, and
  `sp:dev-gitmsg --commit`.

### Improvements

- **Workflow engine flags.** `--async`, `--force`, and `--no-lifecycle` on `spur workflow
  run`; run-start plan preview and live EventBus step progress; `AbortSignal` propagated
  through the agent subprocess chain; `spur workflow clean` finalizes orphaned runs.
- **Centralized config loading (ADR-027).** `.spur/config.yaml` loading is centralized in
  `spur-config`; the legacy `.spur/config.json` references are retired.
- **UI boundary rules promoted to error.** `ui-import-seam-only` and
  `no-daisyui-class-leak` are now `error` and run in the standing pre-check — daisyUI is
  fully routed behind a typed `ui.ts` seam.
- **Section-write guards & done-gate.** The workflow enforces the section matrix at done,
  owns per-status sections, and guards phantom writes; `MarkdownDocument` deduplicates
  sections at parse time.

### Bug Fixes

- **`spur task check` strictness.** `--strict-core` gate on `task check`; section-write
  guard scoped to the exact corpus path via `resolve --strict`; parent-child roll-up gate
  in `task check`; `Review` section accepted at `testing` status.
- **Dead `--agent` surface removed.** The `current`/`$SPUR_AGENT` `--agent` paths and
  stale dogfood agent docs are removed.
- **Pipeline regression closed.** The rd3→sp dev verify-skill + completion-gate regression
  (0105) is resolved.

### Internal

- Server-side implementation on Hono/oRPC across server and web (EventBus, JobQueue,
  Scheduler, ServerModule registry, health endpoints).
- Task-planning migration from `rd3` into the Spur planning layer (ADR-020–023).
- Test coverage lifted above the 90% line/function threshold across CLI, server, and
  domain; `plugins/sp` tests included in the verification gate.

## [0.1.9] — 2026-06-08

### Changed

- **`@gobing-ai/ts-infra` bump to `^0.3.5`** — adds `runApplication` / `runNodeApplication` bootstrap orchestrator subpaths.
- **CLI bootstrap standardized on `runNodeApplication`** (ADR-017) — `spur-cli`'s `main()` now delegates to `ts-infra`'s `runNodeApplication`, providing deterministic logger/telemetry/events/DB lifecycle. `spur-server` can reuse the identical wiring.
- **Single config surface** — `.spur/config.yaml` is now the sole config file. The legacy `.spur/config.json` project marker is retired. Resolution: project `.spur/config.yaml` → fallback `~/.config/spur/config.yaml`. `spur init` writes a minimal `.spur/config.yaml` with a `bootstrap:` block consumed by `ts-infra` and a Spur app section validated by `spurAppConfigSchema`.
- **DB created eagerly** — injected via `runNodeApplication` `services.db`, replacing lazy creation in `createCliContext`.

# Changelog

## [0.1.1] — 2026-06-06

Spur v0.1.1 is the first published release after the re-foundation onto the `spur-new` monorepo.
It bundles the full CLI surface, the plugin SDK, and the application services layer behind
`@gobing-ai/spur-cli` and `@gobing-ai/spur-plugin-sdk`.

### New Features

- **Plugin system** — `@gobing-ai/spur-plugin-sdk` ships with typed capability registries
  (command, rule, skill, harness, provider, event, UI, worker, API), trust-level sandboxing
  (curated / untrusted tiers), and a `PluginLoader` that discovers plugins from bundled,
  user-global (`~/.spur/plugins/`), and project-local (`.spur/plugins/`) roots. Plugin API
  routes mount into the server via Hono with OpenAPI schema generation.
- **`spur plugin` commands** — `list`, `info`, `enable`, `disable` subcommands for managing
  installed plugins from the CLI.
- **`spur rule run --stop-on-first`** — new flag stops rule evaluation at the first failure
  (or at a configurable severity threshold), giving fast-fail workflows without running the
  full ruleset.
- **Disabled rules in verbose output** — `spur rule run --verbose` now shows rules skipped
  by the preset filter with a `⊘` marker, so you can see _what_ was excluded.
- **Portable spur rules** — `recommended` and `strict-check` preset rulesets absorbed from
  `@gobing-ai/ts-rule-engine` into the Spur repo as the single source of truth. New rules
  cover DAO boundaries, runtime boundaries, HTTP boundaries, file protection, test location
  enforcement, CLI surface consistency, Bun tooling constraints, and Biome suppression bans.
- **Team-mode agent specs** — `spur agent create|edit|delete` manage agent YAML specs under
  `.spur/agents/`. `spur agent list --specs` enumerates them. Supports identity preamble
  injection (`--purpose`, `--tags`, `--system-prompt`, `--task`) and message draining
  (`--drain`).
- **Inter-agent messaging** — `spur message send|inbox|reply` backed by a durable SQLite
  inbox, enabling asynchronous coordination between team agents.

### Improvements

- **Application services layer** (`packages/app`) — `AgentService`, `RuleService`,
  `WorkflowService`, `HistoryService`, `TeamService`, and `PluginService` extracted into a
  shared `@gobing-ai/spur-app` workspace, decoupling domain logic from CLI I/O.
- **Domain persistence** (`packages/domain`) — analytics, DAOs, migrations, and schema
  extracted into `@gobing-ai/spur-domain` with full test coverage on in-memory SQLite.
- **Rule and workflow engines are now plugins** — both `ts-rule-engine` and
  `ts-dual-workflow-engine` register through the plugin SDK's harness and rule registries,
  making them replaceable without changing CLI code.
- **Canonical documentation** — `docs/00_ADR.md` through `docs/05_FEATURES.md` rewritten
  with single-source-of-truth discipline, an explicit conflict-resolution order, and the
  CLI grammar contract (`spur <noun> [<verb>] [positionals] [--flags]`).
- **CI gate** — GitHub Actions `ci.yml` enforces `bun run check` (Biome lint + `tsc --noEmit`
  across 8 workspaces + 542 tests) on every push and PR.
- **Trusted Publishing ready** — `publish.yml` supports OIDC-based npm publishing via
  `id-token: write`, with tag-triggered (`@gobing-ai/spur-cli-v*`) and manual dispatch
  paths.

### Bug Fixes

- **Migration gaps** — CLI surface commands (`agent team`, `message`, `plugin`, stubs) now
  properly registered in the Commander program, fixing `unknown command` errors at runtime.
- **`spur rule run` error propagation** — `fail-on` and `stop-on-first` flags now correctly
  drive exit codes and halt evaluation.
- **Server plugin route validation** — duplicate or invalid route prefixes are rejected at
  registration time; server lifecycle hooks are fail-soft (a broken plugin no longer takes
  down the server).
- **TypeScript strictness** — `noUncheckedIndexedAccess: true` enforced project-wide.
  `cwdStat` guard hardened; `yaml` import resolved; `vite/client` types scoped to web workspace.
- **`spur rule list`** — refactored to match the noun-verb contract and produce clean tabular
  output.
- **SECU hardening** — ETL query table parameter narrowed to an allowlist union, preventing
  SQL injection through user-controlled identifiers.

### Breaking Changes

- **Re-foundation** — Spur has been rebuilt from the ground up on the `spur-new` monorepo.
  The old `spur` codebase under `drizzle/_legacy_reference/` is frozen and inert. If you had
  a checkout of the original repo, migrate to the new one.
- **`@gobing-ai/spur-cli`** now publishes as a Bun-native binary (entry: `dist/index.js`,
  engines `bun >= 1.3.0`). The old Node.js-based CLI is retired.
- **`.spur/rules/` layout** — preset files renamed and reorganized. `recommended.yaml` is
  now `recommended-pre-check.yaml` + `recommended-post-check.yaml`. Custom rule files
  referencing old preset names need updating.
