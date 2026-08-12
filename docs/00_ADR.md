---
doc: 00_ADR
owns: WHY — cross-cutting decisions, one-line reasons
authority: authoritative
version: 1.14.0
owner: Robin Min
updated_at: 2026-08-12
read_before: any structural change; before diverging from a decision
edit_rules: 99 §6.1
sync: [T1, T2]
---

# 00 ADR — Spur

Spur's cross-cutting decisions. Mechanisms and surface details live in `03`/`04`.

Historical entries were compacted in place on 2026-08-09 with operator approval. Numbers, dates,
statuses, and decision outcomes remain stable; future changes follow the append-only rules in `99 §6.1`.

## ADR-001: Greenfield Re-Foundation

- **Status:** Accepted · **Date:** 2026-05-30
- **Decision:** Re-found Spur as a clean Bun-workspace monorepo using `ts-base` conventions; discard the old `@spur/*` tree. Local packages are `app`, `contracts`, `config`, and `domain`; reusable engines remain `@gobing-ai/ts-*` dependencies.
- **Why:** Extracting the old tree would preserve its accumulated debt.
- **Detail:** `03 §1` and ADR-021.

## ADR-002: Bun Workspaces, No Turborepo

- **Status:** Accepted · **Date:** 2026-05-30
- **Decision:** Use Bun workspace filtering for orchestration; forbid Turborepo and remote-cache infrastructure until repository scale justifies them.
- **Why:** The current workspace count does not justify another orchestration layer.
- **Detail:** `03 §1`.

## ADR-003: Shared TypeScript Tooling from ts-base

- **Status:** Accepted · **Date:** 2026-05-30
- **Decision:** Reuse `ts-base` Biome, Lefthook, and shared TypeScript presets; gate on Biome plus per-workspace `tsc --noEmit`.
- **Why:** Shared tooling prevents style and compiler drift across sibling projects.
- **Detail:** `AGENTS.md` and `03 §1`.

## ADR-004: ts-libs as External Dependencies, Not Workspace Members

- **Status:** Accepted · **Date:** 2026-05-30
- **Decision:** Consume `@gobing-ai/ts-*` by published semver, never committed `workspace:*`; use `bun link` only for temporary validation.
- **Why:** A published dependency boundary is explicit and independently versioned.
- **Detail:** `03 §1.1`.

## ADR-005: oRPC as the Type Seam

- **Status:** Accepted · **Date:** 2026-05-30
- **Decision:** Define transport DTOs in `packages/contracts`, bind handlers with oRPC `implement(contract)`, generate OpenAPI, and type the web client through `OpenAPILink`; retire `@hono/zod-openapi` plus manual equality checks.
- **Why:** Contract drift becomes a compile-time error.
- **Detail:** `03 §4`; `04 §5`.

## ADR-006: Domain Engines Are External ts-libs Packages

- **Status:** Accepted · **Date:** 2026-05-30
- **Decision:** Keep reusable agent, rule, workflow, and history engines in independently versioned `@gobing-ai/ts-*` packages; Spur owns only application glue and thin transports.
- **Why:** Other projects can reuse the engines without depending on Spur.
- **Detail:** `03 §1.1`, `§5–7`.

## ADR-007: Package-Owned Database Schema

- **Status:** Accepted · **Date:** 2026-05-30
- **Decision:** Each domain package exports its schema SQL; the CLI composes it into `CLI_SCHEMA_SQL` and migrates only marked top-level Spur migrations through `__spur_cli_migrations`.
- **Why:** Schema ownership follows code ownership.
- **Detail:** `03 §8`; `04 §3.1`.

## ADR-008: History Raw Files Are Canonical; DB Holds Validated ETL

- **Status:** Accepted · **Date:** 2026-05-30
- **Decision:** Validate history records before persistence, retain raw JSONL as the canonical store, import incrementally by source/file checkpoint, and deduplicate by post-redaction SHA-256 through source definitions.
- **Why:** Raw DB storage and full re-imports were large, fragile, and platform-specific.
- **Detail:** `03 §7`; `04 §3.2`.

## ADR-009: Dual-Mode Workflow Engine

- **Status:** Accepted · **Date:** 2026-05-30
- **Decision:** Use `@gobing-ai/ts-dual-workflow-engine` for both FSM and conditional DAG workflows, with validated YAML, interpolation, and adapter-backed persistence.
- **Why:** One engine covers simple loops and complex orchestration.
- **Detail:** `03 §6`.

## ADR-010: CLI Is Primary; Local-First Is Default

- **Status:** Accepted · **Date:** 2026-05-30
- **Decision:** Make the CLI the primary writer of record, local files plus SQLite the default store, and `--json` available on commands; server/web remain thin inspection transports. The committed surface is maintained in `04` and includes team, trace, task, and feature additions.
- **Why:** Spur's core loop is a single-machine developer workflow with no required network service.
- **Detail:** `03 §2`; `04 §1`; ADR-020.

## ADR-011: ts-db Facade and Single-Source Tables

- **Status:** Accepted · **Date:** 2026-06-01
- **Decision:** Confine `ts-db` and Drizzle to `packages/domain`, define tables with `defineTable`, derive DDL with `createTableSql`, and keep raw SQL out of apps.
- **Why:** One table definition prevents schema/DDL/type drift and preserves storage portability.
- **Detail:** `03 §8`; `.spur/rules/boundary/dao-boundary.yaml`.

## ADR-012: Minimal Plugin Lifecycle in ts-infra; Extensions Deferred

- **Status:** Accepted (design) · **Date:** 2026-06-03
- **Decision:** Use the lifecycle-only `Plugin`/`PluginHost` substrate from `ts-infra`; the unused Spur SDK, capability registries, trust ladder, and server plugin routes are removed or deferred until a real consumer exists. Plugin harness execution also remains deferred pending injected-shim support; runtime sandboxing is out of scope.
- **Why:** The larger substrate had no production consumer, while local plugins are operator-trusted.
- **Detail:** `03 §11`; `04 §6`; task 0015.

## ADR-013: Command-Scoped Custom Help

- **Status:** Superseded by ADR-014 · **Date:** 2026-06-04
- **Summary:** Required per-command `helpText()` renderers and a dispatcher registry; replaced by Commander-native parsing and help.

## ADR-014: CLI Dispatch and Help via Commander

- **Status:** Accepted · **Date:** 2026-06-06
- **Decision:** Build noun/verb registration, parsing, dispatch, exit handling, and command help on `commander` plus `@commander-js/extra-typings`; use Commander's flat top-level help.
- **Why:** The custom parser, dispatcher, and help registry duplicated maintained library behavior.
- **Detail:** `04 §1`.

## ADR-015: Bundled Config Is Spur-Owned; Runtime Paths Use `.spur/`

- **Status:** Accepted · **Date:** 2026-06-07
- **Decision:** Keep default assets in repo-root `config/`, publish them as package-root `config/`, seed global/local copies without overwriting, and resolve bundled → global → local. Runtime code and agent guidance must reference `.spur/`, while `config/` remains build-time SSOT; the rule engine owns only generic examples.
- **Why:** One inspectable asset tree removes hardcoded and cross-repository config duplication.
- **Detail:** `04 §2.3`, `§1.1`; `.spur/rules/boundary/sp-runtime-path.yaml`.

## ADR-016: Slash Commands Exist Only for Agentic Value

- **Status:** Accepted · **Date:** 2026-06-07
- **Decision:** Use the CLI directly for deterministic single verbs; add slash commands only for fuzzy intent or valuable multi-step orchestration. Skills own behavior, commands remain thin, and subagents are reserved for context isolation.
- **Why:** CLI-forwarding wrappers add surface and drift without capability.
- **Detail:** `plugins/sp/skills/*/references/operations.md`.

## ADR-017: CLI Bootstrap Uses ts-infra

- **Status:** Accepted · **Date:** 2026-06-08
- **Decision:** Bootstrap the CLI with `runNodeApplication`; consolidate project/app configuration into `.spur/config.yaml`, resolved locally then globally, and retire `.spur/config.json`.
- **Why:** Shared lifecycle wiring removes per-app bootstrap and duplicate config paths.
- **Detail:** `03 §2`; `04 §2.1`.

## ADR-018: Number Never Allocated

- **Status:** Skipped · **Date:** recorded 2026-06-11
- **Summary:** Reserved after cross-repository numbering confusion; never reuse.

## ADR-019: Runtime-Specific Server Bootstrap

- **Status:** Accepted · **Date:** 2026-06-09
- **Decision:** Use `runNodeApplication` for Bun and portable `runApplication` for Cloudflare Workers, sharing only portable bootstrap configuration and the Hono app factory.
- **Why:** Workers must not inherit Node filesystem dependencies.
- **Detail:** `03 §2`; `04 §5`.

## ADR-020: Task and Feature Planning Join the CLI

- **Status:** Accepted (design) · **Date:** 2026-06-11
- **Decision:** Commit `spur task` and `spur feature`; Markdown remains SSOT and SQLite derived. Keep the LLM planning pipeline in skills, not a new CLI noun. Parent checks warn on roll-up inconsistencies or missing rosters; `task refresh-roster` owns roster generation.
- **Why:** The heavily used planning stack belongs in Spur's validated application layer, not an agent-plugin tree.
- **Detail:** `03 §12`; `04 §7.1`; `01 §5.1`.

## ADR-021: Functionality Lives in `packages/app`

- **Status:** Accepted · **Date:** 2026-06-11
- **Decision:** Keep CLI, server, and web as thin transports; put application services, writes, and orchestration in `packages/app` over domain DAOs and external engines.
- **Why:** One validated service path prevents transport-specific behavior and lock domains.
- **Detail:** `03 §1`, `§12.2`.

## ADR-022: Task and Feature Lifecycle Runs on `spur workflow`

- **Status:** Accepted · **Date:** 2026-06-11
- **Decision:** Define task/feature lifecycles as workflow YAML with guards and EventBus customization; Markdown frontmatter status remains SSOT and workflow state is derived. Approval uses `hitl.confirm` until pause-aware schemas are available.
- **Why:** A separate lifecycle FSM would duplicate the owned workflow engine.
- **Detail:** `03 §12.2–12.3`.

## ADR-023: rd3 Migration Boundary and Fat Skills

- **Status:** Accepted · **Date:** 2026-06-11
- **Decision:** Move executable, validating, storage, and coordination logic into Spur; do not migrate replaced agents. Keep agent behavior in skill-owned competencies with thin command/agent wrappers, and design migrations collectively before phased implementation.
- **Why:** The boundary prevents mechanical ports and preserves one agent-facing SSOT.
- **Detail:** migration plan; ADR-028; `02 §Phase 1.5`.

## ADR-024: Anti-Hallucination Belongs to Superskill

- **Status:** Accepted · **Date:** 2026-06-18
- **Decision:** Superskill owns anti-hallucination behavior; Spur provides `AgentService.runCapture` and the DI-backed `response.validate` workflow primitive. The former in-repo skill is removed.
- **Why:** Answer verification is an agent capability; Spur owns only harness plumbing.
- **Detail:** `packages/app/src/builtins.ts`.

## ADR-025: Board Interaction Libraries

- **Status:** Accepted · **Date:** 2026-06-22
- **Decision:** Use `@dnd-kit/core`/`sortable` for drag-and-drop and `@uiw/react-md-editor` for task-board Markdown editing, scoped to `apps/web` and its Astro-island shell.
- **Why:** Both libraries provide maintained, accessible behavior without custom implementations.
- **Detail:** `apps/web/package.json`; `apps/web/src/ui.ts`.

## ADR-026: Verification Skill and Workflow Verdict Gate

- **Status:** Accepted · **Date:** 2026-06-23
- **Decision:** Keep verification in `sp:code-verification`; gate `verify → record` on a PASS verdict and `record → done` on `spur task check`. Pipeline implementation invokes implement-only mode, never recursively drives the pipeline.
- **Why:** Verification is independent, and persisted verdicts plus structural checks provide deterministic postflight gates.
- **Detail:** `03`; `04 §7.5`; verdict schema.

## ADR-027: One Spur Config Loader with Portable Core

- **Status:** Accepted · **Date:** 2026-06-26
- **Decision:** Make `@gobing-ai/spur-config` the sole `.spur/config.yaml` loader, split dependency-free schemas/types from the Node-only loader, and retire legacy task JSONC config.
- **Why:** Multiple loaders drifted, while Workers cannot import Node/YAML loading dependencies.
- **Detail:** `03`; `04 §2`.

## ADR-028: Functional Skills Behind a Thin Spine

- **Status:** Accepted · **Date:** 2026-06-30
- **Decision:** Decompose lifecycle behavior into reusable architecture, implementation, testing, verification, and decomposition skills behind `sp:spur-dev`; use one `sp:spur-cli` facade and one `expert-spur` agent.
- **Why:** Deep functional competencies are more reusable and coherent than noun-specific or lifecycle-monolith skills.
- **Detail:** `03 §12`; `04`; `05 §9`.

## ADR-029: Defer Planning-Pipeline Fate; Add `feature advance`

- **Status:** Accepted · **Date:** 2026-07-02
- **Decision:** Defer whether to retire or merge the planning pipeline; replace the wrap-up shell status ladder with idempotent `spur feature advance`, sharing transition logic with single-step update.
- **Why:** The pipeline decision lacks evidence, while lifecycle walking is deterministic CLI behavior.
- **Detail:** `04 §1`; `apps/cli/src/commands/feature.ts`.

## ADR-030: Shared Full-Surface Mocks for Bun

- **Status:** Accepted · **Date:** 2026-07-08
- **Decision:** Because `mock.module()` is process-global and unrestored, modules mocked by multiple files use one full-surface baseline, re-register custom behavior in `beforeEach`, and are not mocked where directly tested.
- **Why:** Incompatible global mocks caused ordering-dependent CI failures.
- **Detail:** `apps/web/tests/test-helpers/rpc-client-mock.ts`; mock rules.

## ADR-031: Plugin Prompts and Executable Code Use Separate Trees

- **Status:** Accepted · **Date:** 2026-07-17
- **Decision:** Keep prompt artifacts under `skills/`, `commands/`, and `agents/`; place executable helpers in `plugins/sp/scripts/<skill>/` and tests in `plugins/sp/tests/<skill>/`. Skill directories contain no scripts or tests.
- **Why:** One root per concern simplifies packaging, discovery, coverage, and structural enforcement.
- **Detail:** `plugins/sp/README.md`; `plugins/sp/tests/skill-structure.test.ts`.

## ADR-032: Commands Are SSOT; Superskill Owns Adapters

- **Status:** Accepted · **Date:** 2026-07-21
- **Decision:** Hand-edit only `plugins/sp/commands/*.md`; validate thin wrappers and let `superskill install` generate platform adapters. Dev commands expose syntax in `argument-hint`, command-local public flag tables, and canonical shared semantics in one glossary.
- **Why:** Registries and committed adapters duplicated command metadata and conflicted with Superskill's existing generator.
- **Detail:** command validator/tests; `docs/design/dev-command-argument-contract.md`.

## ADR-033: Stage-Registry Adaptive Model Routing

- **Status:** Accepted · **Date:** 2026-07-24
- **Decision:** Resolve agents by canonical `stage_id` and registry `model_policy`, starting at the cheapest eligible capability tier and following declared fallbacks on objective failure signals. Retain `default-by-phase` only as a deprecated compatibility shim.
- **Why:** Prompt-regex phase routing could not express capability floors or evidence-based escalation.
- **Detail:** `04 §2.1`; stage registry; `AgentService`.

## ADR-034: Domain Status Vocabulary; Accessible Board Encoding

- **Status:** Accepted · **Date:** 2026-07-25
- **Decision:** Domain constants own task/feature status vocabularies; Board modules own only visual mappings. Spur-token surfaces use contrast-verified Spur semantic tokens, and icon-only affordances require an accessible name plus non-color distinction.
- **Why:** This prevents duplicated vocabularies, theme-token drift, and inaccessible status-only icons.
- **Detail:** `docs/design/feature-tree-status-affordance.md`; status icons and global styles.

## ADR-035: Read-Only Workflow Observability; Separate Steering Controller

- **Status:** Accepted · **Date:** 2026-07-28
- **Decision:** Keep observability as a redacted, bounded projection that preserves canonical output; perform synchronous steering only through a separate authenticated, version-checked, policy-gated controller at declared boundaries. Defer cross-process steering pending a durable protocol.
- **Why:** Event buses provide observation, not safe command durability, ordering, or recovery.
- **Detail:** workflow observability and steering design satellites.

## ADR-036: Portable Cloudflare Worker Composition Root

- **Status:** Accepted · **Date:** 2026-07-29
- **Decision:** Give Bun and Cloudflare Workers separate composition roots over shared portable HTTP primitives; the Worker graph excludes filesystem, process-control, and Bun SQLite services.
- **Why:** The shared eager factory pulled Bun-only dependencies into the Worker bundle.
- **Detail:** `03 §2`; `04 §5.1`.

## ADR-037: User-Global Project Registry

- **Status:** Accepted · **Date:** 2026-07-29
- **Decision:** Coordinate multi-project Board discovery through `~/.config/spur/projects.json`; local servers register/deregister, and `port: 0` means stopped. Any future daemon must reuse this contract.
- **Why:** A global file solves project discovery without introducing a daemon during active local development.
- **Detail:** `docs/design/project-switcher.md`; feature K1.

## ADR-038: CLI and `spur-cli` Skill Change Together

- **Status:** Accepted · **Date:** 2026-07-31
- **Decision:** Update covered `sp:spur-cli` references in the same change as CLI verbs/flags; enforce bidirectional parity with a named exclusion list. Dispatch-surface selection remains separate from ADR-033 model-tier selection.
- **Why:** Undocumented and phantom CLI surfaces accumulated without mechanical coupling.
- **Detail:** `plugins/sp/tests/spur-cli-parity.test.ts`; dispatch-surface reference.

## ADR-039: `--next` Means Chain to Completion

- **Status:** Accepted · **Date:** 2026-07-31
- **Decision:** Define `--next` once: after success, return to `sp:next-router`, propagate the flag, and continue until completion, a gate stop, or the eight-hop bound. Use `--mode implement` for the former implement-only meaning.
- **Why:** Seven commands had four incompatible meanings with no semantic parity gate.
- **Detail:** shared flag glossary; next-router skill and routing table.

## ADR-040: Required Sections Cannot Remain Placeholders

- **Status:** Accepted · **Date:** 2026-08-01
- **Decision:** `spur task check` raises `L3.required-section-placeholder` when a section required by the current status matrix contains only empty/comment/TBD scaffold; the matrix, not hardcoded statuses, controls applicability.
- **Why:** Inline task execution could reach `done` with unfilled Solution or Testing sections while all existing checks skipped placeholders.
- **Detail:** task-check service; finding codes; section matrix.

## ADR-041: One Dev-Command `--agent` Selector

- **Status:** Accepted · **Date:** 2026-08-01
- **Decision:** Replace `--inline`/`--subprocess` with `--agent <inline|auto|name>`; the value identifies who performs model-bearing work and the surface is derived. Pipeline orchestrators apply it to their stages. ADR-047 defines headless omit/`inline` resolution.
- **Why:** Multiple flags created default mismatches and contradictory combinations.
- **Detail:** dev command contracts; cross-cutting/flag-glossary references; ADR-047.

## ADR-042: One Inbox Module with Per-Agent Timelines

- **Status:** Superseded by ADR-052 · **Date:** 2026-08-04
- **Decision:** Consolidate Board messaging into `modules/inbox` with All, Supervisor, and member tabs; merge durable messages with process frames client-side. Remove duplicate message views; Supervisor remains a UI filter, not a routing identity.
- **Why:** Three overlapping message surfaces fragmented one operator workflow.
- **Detail:** `03 §14`; `docs/design/inbox-board-module.md`; feature M4.

## ADR-043: Workflow Agent Inputs Prefer Pure Slash Commands

- **Status:** Accepted · **Date:** 2026-08-04
- **Decision:** Use pure slash commands in workflow `agent.run` inputs when a command exists; commands/skills own discipline. The task test hop is quality probe → optional `dev-fixall` → hard recheck. Advisory steps fail soft, declared retries reach their retry edge, and scaffolded workflows guard monorepo-only helpers with CLI fallbacks.
- **Why:** Workflow prose duplicated skill behavior and created drifting prompt SSOTs.
- **Detail:** workflow configs; dev-run/code-implementation contracts; structure tests.

## ADR-044: Failure Terminals and Run-Scoped Artifacts

- **Status:** Accepted · **Date:** 2026-08-04
- **Decision:** Workflow schemas classify failure terminals so status, persistence, events, and exit code agree; shared `.spur/run/` artifacts include `__runId`, while already entity-scoped artifacts remain unchanged.
- **Why:** Failed terminals previously exited successfully, and concurrent runs could read each other's gate artifacts.
- **Detail:** workflow schema/driver/CLI; task 0425.

## ADR-045: Retained All-in-One Workflow Run Log

- **Status:** Accepted (design) · **Date:** 2026-08-04
- **Decision:** Write one retained `.spur/run/<RUNID>.log` containing foreground rendering, child output, and consumed steering input; allow `--no-log`, clean by policy, and follow through `workflow trace <RUNID> --follow --output`. Keep trace JSONL and partial salvage separate.
- **Why:** Async runs discarded the exact narration operators need for live diagnosis and postmortems.
- **Detail:** `docs/design/workflow-run-log.md`; `03 §6`; feature D2.

## ADR-046: Workflow-Specific Rejection of `--agent inline`

- **Status:** Superseded by ADR-047 · **Date:** 2026-08-04 · **Feature:** H82
- **Summary:** Rejected `inline` for workflow-driven commands; replaced by one value table and run-scoped affinity.

## ADR-047: Unified Agent Semantics, Session Affinity, and Live Output

- **Status:** Accepted (design) · **Date:** 2026-08-05 · **Feature:** H83 · **Supersedes:** ADR-046 · **Amends:** ADR-041
- **Decision:** Use one `--agent` table everywhere: interactive omit/`inline` stays in the host session; headless omit/`inline` resolves `agent.default`, `auto` uses tier routing, and names select executors. Workflow hops remain subprocesses, share run-scoped resumable sessions when supported, and stream pipe output live without TTY/stdin. Host-stage control inversion remains deferred.
- **Why:** This removes contradictory semantics and host-session contamination while preserving auditability and timeout isolation.
- **Detail:** feature H83; cross-cutting/flag glossary; agent runner/runtime seams; ADR-045.

**Amendment (2026-08-10).** Interactive `dev-run --mode full` and sequential `dev-runall` with omit/`inline` now invert control at the command/skill layer and execute the existing task-pipeline stages in the host session; named/auto, parallel, and headless paths remain subprocesses.

**Why.** Interactive omit/inline must honor the invoking session while retaining the YAML gates and auditable provenance.

**Detail:** `04 §7.8`; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`; task 0503.

**Amendment (2026-08-10, task 0508).** Interactive omit/`inline` keeps the pipeline controller in the host session and remains **non-subprocess** (no `spur agent run`, no `spur workflow run`), but no longer guarantees that every model-bearing stage runs in the host context. Eligible sequential `agent.run` stages — a pure-slash action in a non-interactive state, when the host platform exposes a native subagent with shared-worktree read/write/shell capability — dispatch **once** to that native subagent and join before the driver continues. Any pre-dispatch eligibility failure falls back to one host execution; a failure after dispatch follows the stage's error policy and is never replayed in the host. Operator confirmation actions, `pause: true`, and approve/taste/ask decisions stay host-owned. Explicit `--agent auto`/name, headless, parallel, and direct implement-only paths are unchanged.

**Why.** The repository's native-subagent delegation surface is the default for model-bearing work when the host platform provides one; the inline driver previously bypassed it for every pipeline stage, growing host context. The eligibility test is observable facts only (action kind, pure-slash input, interactive exclusion, capability) — the subjective handoff-cost heuristic is removed.

**Detail:** `04 §7.8`; `cross-cutting.md` § Inline-default execution surface; `inline-pipeline-driver.md`; task 0508.

## ADR-048: `task record` Owns Done Walk and Run-Link

- **Status:** Accepted · **Date:** 2026-08-05 · **Task:** 0436 R4
- **Decision:** With a PASS verdict, `spur task record --transition done` walks `wip → testing → done` and creates the pipeline run-link atomically; non-PASS receives one guard denial.
- **Why:** The record step already proves pipeline provenance, so separate links and intermediate commands were redundant friction.
- **Detail:** `03 §12.2`; `04 §7.1`; task service and record tests.

## ADR-049: Per-Entry Custom Split Targets and Typed Forensic Tables

- **Status:** Accepted · **Date:** 2026-08-07
- **Decision:** Let custom split entries select `targetTable` while preserving bare-record compatibility; store normalized forensic data in typed `history_message` and `history_tool_call` tables using data-driven typed inserts, while retaining generic ETL tables.
- **Why:** One JSONL line must fan out to indexable cross-source message and tool-call records.
- **Detail:** importer split seam, DAO typed columns, schema SQL; feature E1.

## ADR-050: Continuous, Unbypassable Corpus Gates

- **Status:** Accepted · **Date:** 2026-08-07
- **Decision:** `--no-lifecycle` suppresses only lifecycle run records, never structural checks; `--force-done` waives only verdict checks. `corpus-check` validates every task/feature on `spur-check` against a two-sided baseline, and T10 requires same-change reconciliation when findings tighten.
- **Why:** Combined flags bypassed all guards, while one-time transition checks missed later rule drift; a stale-aware corpus sweep closes both gaps.
- **Detail:** task CLI backstop; corpus-check script; baseline; `99 §5 T10`.

## ADR-051: Public CLI Surface vs Internal spur-dev Tooling — Ownership and Consent Gate

- **Status:** Accepted · **Date:** 2026-08-10
- **Decision:** Two command surfaces with a strict boundary. The `spur` CLI (`apps/cli/`) is the
  **public, end-user harness surface** — it must stay simple and easy to use, and hosts anything a
  Spur end user would run. `scripts/spur-dev.ts` is **internal, Spur self-dev tooling only** —
  packaging/release (`publish`, `bump-ver`, `drop-tags`, `bundle-*`, `verify-pack`,
  `check-marketplace-version`), building Spur itself (`build-cli`, `build-binaries`, `dev-all`), and
  monorepo-specific gates (`link-check`). Adding, changing, or removing any CLI noun/verb requires
  **explicit operator consent** with enough design context to evaluate the decision; agents must
  present the surface choice before implementing, never land a CLI surface change unilaterally.
  spur-dev commands are unconstrained by the consent gate but follow the one-module-per-command
  pattern under `scripts/commands/` with `bundle-*`-style verb naming and a test sibling.
  **First-layer noun discipline:** the first layer of the `spur` CLI (the nouns) is added
  **extremely carefully** to keep the surface clean and neat — the first layer MUST be a noun so
  that similar actions group under it (`task check`, `feature check`, `rule run`). Verbs and flags
  are the preferred expansion mechanism; a new first-layer noun is justified only when no existing
  noun can host the action. Consequence: `spur corpus check` is the wrong design for promoting
  corpus-check — `corpus` would be a one-gate noun. The correct promotion hosts the sweep under the
  existing `task` noun (`spur task check --corpus`), since `spur task check` with no WBS already
  sweeps the full corpus and corpus-check's only delta is baseline reconciliation and fail
  semantics.
- **Why:** The CLI is a published, versioned contract to end users — every noun/verb is a public
  API commitment (docs, `--help`, scripts, muscle memory). Unilateral growth erodes the
  simple-harness design goal. spur-dev has no such contract; it is repo plumbing and may evolve
  freely. Task 0500 surfaced the ambiguity (bundle-plugins added to spur-dev) and the boundary was
  previously implicit.
- **Detail:** routing rule operationalized in `AGENTS.md` § Spur CLI surface. Known misplacement:
  `corpus-check` lives in spur-dev but operates on any Spur-managed project's task/feature corpus,
  making it a user-facing gate in disguise — promotion target is `spur task check --corpus` (per
  the noun discipline above), tracked in its own task. All twelve CLI nouns
  (`init agent history rule workflow message team task feature status migrate serve`) are
  legitimately public; all other spur-dev commands are correctly internal.

  **Amendment (2026-08-10):** Task 0502 completed the recorded promotion: the public gate is now
  `spur task check --corpus`; the spur-dev command was removed. **Detail:** `04 §7.1`.

## ADR-052: Team-Scoped Board Composition with Separate Control and Message Planes

- **Status:** Accepted (design) · **Date:** 2026-08-11 · **Feature:** G3 · **Supersedes:** ADR-042
- **Decision:** Use `agent.team.<teamId>` as the v1 workspace context. Teams exclusively owns roster,
  process lifecycle, terminal I/O, and activity; Inbox owns durable messages only; the Workspace Board
  module composes team-scoped Teams, Inbox, and Tasks views. Add no workspace schema, service, API, or
  CLI noun in v1.
- **Why:** Team already owns the work folder and roster; a second workspace model and a second process
  viewer duplicate authority without a current requirement.
- **Detail:** `docs/design/workspace-design.md`;
  `docs/plans/2026-08-11-g3-team-inbox-workspace-boundary-brainstorm.md`; task 0197.

## ADR-053: Parity Harness Diffs Agent-Facing Surfaces Against the Live Monorepo CLI

- **Status:** Accepted · **Date:** 2026-08-11 · **Feature:** I2 · **Amends:** ADR-038
- **Decision:** Extend the plugin parity harness to mechanically diff three agent-facing surfaces
  against the live monorepo CLI (`bun run apps/cli/src/index.ts <noun> --help` / `--json`): the
  `sp:spur-cli` facade inventories (noun routing table, Tier C exclusions, per-noun verb/flag
  references), the `sp:spur-dev` spine step-routing table, and the `AGENTS.md` noun table. The diff
  is bidirectional — documented-but-absent and live-but-undocumented are both findings — and drift
  fixes are evidence-driven from test failures.
- **Why:** Mechanical parity fixes today's drift and prevents tomorrow's, reusing the proven in-repo
  harness (ADR-038) instead of a new mechanism.
- **Detail:** `03 §15`; `docs/design/plugin-surface-parity.md`; feature I2.

**Amendment (2026-08-11, feature I2 design gate).** CLI-surface capture is `--help`-primary:
`<noun> --help` is the universal capture surface, and `--json` is used only where the noun actually
exposes a machine-readable inventory. Human `--help` parsing is a narrow adapter with fixtures and
explicit exclusions, not an assumed machine API. The harness extends the existing parity suite with
at most one shared CLI-surface helper and at most one new focused parity test; the pre-allocated
multi-file test layout is dropped.

**Why.** Not every noun exposes `--json`; assuming a machine-readable surface invents a contract the
CLI does not provide, and pre-allocating test files multiplies maintenance before any assertion is
proven.

**Detail:** `03 §15`; `docs/design/plugin-surface-parity.md` §3/§7.

**Amendment (2026-08-11, implementation).** The harness shipped: the frozen capture helper
`captureCliSurface` / `parseCommanderHelp` at `plugins/sp/tests/helpers/cli-surface.ts`, the focused
parity suite `plugins/sp/tests/cli-surface-parity.test.ts`, and `skill-structure.test.ts` extensions
(tasks 0512–0517). Status: Accepted (design) → Accepted.

**Detail:** `03 §15`; `docs/design/plugin-surface-parity.md`.

## ADR-054: Facade/Spine Boundary Is Test-Asserted; SSOT Consolidation Rejected

- **Status:** Accepted · **Date:** 2026-08-11 · **Feature:** I2
- **Decision:** Keep the ownership split — `sp:spur-dev` (spine) owns lifecycle, `sp:spur-cli`
  (facade) owns the verb reference, the CLI is the validator — and assert it with parity tests that
  fail when the facade documents lifecycle steps or the spine documents verb inventories. Reject
  consolidating skill references into `docs/04_DESIGN.md` as the sole surface SSOT.
- **Why:** The facade exists precisely as the skill home for the CLI surface (ADR-028/038);
  consolidation rewrites a deliberately chosen structure for no drift benefit the parity harness
  does not already provide.
- **Detail:** `03 §15`; `docs/design/plugin-surface-parity.md`; feature I2.

**Amendment (2026-08-11, feature I2 design gate).** The boundary is defined by ownership, not by
absence: `sp:spur-cli` owns CLI noun/verb/flag semantics — including task and feature
status-transition verbs — while `sp:spur-dev` owns multi-step lifecycle orchestration. Parity tests
assert each surface documents its owned scope and fail on inversion; they do not assert the facade
contains no "lifecycle steps". Duplication assertions are limited to exact catalogs and structured
inventories, never arbitrary prose.

**Why.** Status-transition verbs are CLI semantics the facade must own, and prose-duplication
detection is not mechanically reliable.

**Detail:** `03 §15`; `docs/design/plugin-surface-parity.md` §5/§6.

**Amendment (2026-08-11, implementation).** The boundary assertions shipped with the ADR-053 harness
(plugins/sp/tests/cli-surface-parity.test.ts, tasks 0512–0517): the facade owns CLI noun/verb/flag
semantics, the spine owns orchestration, and the tests fail on inversion. Status:
Accepted (design) → Accepted.

**Detail:** `03 §15`; `docs/design/plugin-surface-parity.md` §5/§6.

## ADR-055: Separate Runtime Agent Execution from the `sp` Plugin Feature Root

- **Status:** Accepted · **Date:** 2026-08-11 · **Feature:** I
- **Decision:** Feature B owns runtime agent execution (`spur agent`, runner/doctor, processes,
  sessions, and executor selection). Feature I is the durable `sp` plugin root for skills,
  commands, subagents, hooks, `/sp:dev-*` orchestration, and CLI-reference parity. Feature H is
  frozen historical structure and receives no new children or tasks.
- **Why:** H already mixes runtime and plugin concerns. Extending it would preserve ambiguous
  ownership; a dedicated I root makes new work deterministic without rewriting completed history.
- **Detail:** `03 §15`; `docs/plans/2026-08-11-sp-plugin-feature-tree-restructure-map.md`.

## ADR-056: Enrich System Events at the Spur Catalog and Sink Boundary

- **Status:** Accepted (design) · **Date:** 2026-08-12 · **Feature:** J5
- **Decision:** Keep upstream `@gobing-ai/ts-*` event maps domain-local; Spur wraps cataloged events
  at its shared tap/emitter boundary in a versioned actionable envelope carrying project, producer,
  correlation, presentation, and bounded redacted data. Existing trace JSON contracts may gain
  optional context fields but retain every existing field and meaning.
- **Why:** One Spur-owned projection makes every Board and CLI consumer consistent without coupling
  the generic upstream EventBus or duplicating policy across emit sites.
- **Detail:** `03 §16`; `docs/design/actionable-observability-context.md`; feature J5.
