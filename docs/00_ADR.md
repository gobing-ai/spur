---
doc: 00_ADR
owns: WHY — lasting architectural choices, context and tradeoffs
authority: authoritative
version: 1.44.0
owner: Robin Min
updated_at: 2026-09-09
read_before: any structural change; before diverging from a decision
edit_rules: 99 §6.1
sync: [T1, T2]
---

# 00 ADR — Spur

Spur's cross-cutting decisions — choices that bind more than one feature, module, or pipeline, or
that change a repo-wide invariant. Single-feature design choices, however important, live in that
feature's `docs/design/` satellite and feature file, not here (admission test: ADR-000). Mechanisms
and surface details live in `03`/`04`.

Editorial condensation preserves issued IDs, original titles/dates, decision outcomes and
meaningful amendments. Admission and maintenance rules: constitution §6.1. Legacy feature/task
entries remain addressable but do not justify new nonarchitectural entries.

## ADR-000: Admission — This File Records Cross-Cutting Decisions Only

**Status:** Accepted · **Date:** 2026-09-07

**Decision.** Admit choices that establish or change lasting architectural boundaries or
invariants across features/modules. Feature-scoped design belongs in its design/feature record.
Keep every issued ADR number and decision history; older misplaced entries are not precedent.

**Why.** A feature/task ledger hides the architectural choices readers need.

**Detail:** constitution §6.1. ADR-000 remains the reserved admission entry.

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

- **Status:** Accepted · **Date:** 2026-06-11
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

**Legacy record.** Feature/UI/operational guidance retained for existing references;
its detailed contract belongs in the linked owner. It is not precedent for new task-level ADRs.
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
- **Amendment (2026-08-20, ADR-072 accepted):** the deferral is resolved — planning is retired.
  `config/workflows/planning-pipeline.yaml` is deleted; planning routes through the canonical
  idea/dev-plan path (idea-pipeline + `/sp:dev-plan`).

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

**Amendment (2026-08-16).** The canonical `stage_id` is **derived from the declared role** — the
folded stage with the highest `min_tier` in `plugins/sp/references/roles.md` (ties → declaration
order). That floor equals the role's tier by the roles.md R4 invariant, so derivation does not
change where a run starts.

**Why.** After `default-by-phase` was removed (0452) and prompt-regex phase derivation retired
(0536 R4), the only remaining input was an internal `stage` flag that no production caller set —
not the CLI, not the workflow `agent.run` action, not the server. `model_policy`, the fallback tier
chain, and resource-exhaustion failover were therefore unreachable outside tests, including the
0482 R1 repair of exactly that condition, which re-introduced it one level up. Roles are the input
production already carries: every pipeline `agent.run` step declares one (0538 R2).

**Detail:** `04 §2.1`; `AgentService.resolveCanonicalStage` / `stageForRole`; the role-driven
escalation test in `packages/app/tests/services/agent-service.test.ts`.

> **Amendment (task 0348, applied with task 0536).** Stage-registry `model_policy` is a _default
> seed_, overridable per-stage via config (deep-replace). The routing key stays `stage_id`; the
> registry is demoted from sole source to default, not removed.
>
> **Amendment (task 0536).** Prompt-regex phase detection (`extractPhase`) is **retired** — the
> prompt text never derives a stage. The stage door is the explicit `--stage` flag; undeclared
> callers land on the default role visibly. `--agent` is redefined as the **role selector**
> (`scribe`·cheap / `coder`·standard / `reviewer`·capable-1 / `planner`·capable-2, the Layer-1
> vocabulary in `plugins/sp/references/roles.md`, task 0535): a role picks the _starting_ tier and
> resolution begins at that tier's cheapest eligible executor; an executor name remains a permanent
> pin; a value that is neither a role, a configured executor, nor `auto` is rejected before any
> spawn. This is an **ADR-051 public CLI surface change**, authorized by the operator ruling of
> 2026-08-13 (recorded in task 0536 § Background). `default-by-phase` was removed earlier (task
> 0452).

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

- **Status:** Accepted · **Date:** 2026-08-04
- **Decision:** Write one retained `.spur/run/<RUNID>.log` containing foreground rendering, child output, and consumed steering input; allow `--no-log`, clean by policy, and follow through `workflow trace <RUNID> --follow --output`. Keep trace JSONL and partial salvage separate.
- **Why:** Async runs discarded the exact narration operators need for live diagnosis and postmortems.
- **Detail:** `docs/design/workflow-run-log.md`; `03 §6`; feature D2.

## ADR-046: Workflow-Specific Rejection of `--agent inline`

- **Status:** Superseded by ADR-047 · **Date:** 2026-08-04 · **Feature:** H82
- **Summary:** Rejected `inline` for workflow-driven commands; replaced by one value table and run-scoped affinity.

## ADR-047: Unified Agent Semantics, Session Affinity, and Live Output

- **Status:** Accepted · **Date:** 2026-08-05 · **Feature:** H83 · **Supersedes:** ADR-046 · **Amends:** ADR-041
- **Decision:** Use one `--agent` table everywhere: interactive omit/`inline` stays in the host session; headless omit/`inline` resolves `agent.default`, `auto` uses tier routing, and names select executors. Workflow hops remain subprocesses, share run-scoped resumable sessions when supported, and stream pipe output live without TTY/stdin. Host-stage control inversion remains deferred.
- **Why:** This removes contradictory semantics and host-session contamination while preserving auditability and timeout isolation.
- **Detail:** feature H83; cross-cutting/flag glossary; agent runner/runtime seams; ADR-045.

**Amendment (2026-08-10).** Interactive `dev-run --mode full` and sequential `dev-runall` with omit/`inline` now invert control at the command/skill layer and execute the existing task-pipeline stages in the host session; named/auto, parallel, and headless paths remain subprocesses.

**Why.** Interactive omit/inline must honor the invoking session while retaining the YAML gates and auditable provenance.

**Detail:** `04 §7.8`; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`; task 0503.

**Amendment (2026-08-10, task 0508).** Interactive omit/`inline` keeps the pipeline controller in the host session and remains **non-subprocess** (no `spur agent run`, no `spur workflow run`), but no longer guarantees that every model-bearing stage runs in the host context. Eligible sequential `agent.run` stages — a pure-slash action in a non-interactive state, when the host platform exposes a native subagent with shared-worktree read/write/shell capability — dispatch **once** to that native subagent and join before the driver continues. Any pre-dispatch eligibility failure falls back to one host execution; a failure after dispatch follows the stage's error policy and is never replayed in the host. Operator confirmation actions, `pause: true`, and approve/taste/ask decisions stay host-owned. Explicit `--agent auto`/name, headless, parallel, and direct implement-only paths are unchanged.

**Why.** The repository's native-subagent delegation surface is the default for model-bearing work when the host platform provides one; the inline driver previously bypassed it for every pipeline stage, growing host context. The eligibility test is observable facts only (action kind, pure-slash input, interactive exclusion, capability) — the subjective handoff-cost heuristic is removed.

**Detail:** `04 §7.8`; `cross-cutting.md` § Inline-default execution surface; `inline-pipeline-driver.md`; task 0508.

**Amendment (task 0536 / 0542, feature B2).** The `--agent` value domain gains the Layer-1 role
selectors (`scribe`/`coder`/`reviewer`/`planner` — `plugins/sp/references/roles.md`, task 0535): a
role picks a starting tier instead of naming an executor, and `agent.default`'s value domain moves
from executor names to roles (0542 R2, shim `agent-default-executor`). The unified table stays —
role, executor name, bare binary name (shim), `auto`, or `inline` — one selector, closed and
validated at the CLI boundary. Prompt-regex phase detection is retired alongside (ADR-033 amendment
0536).

**Why.** Role routing expresses the caller's intent without pinning a vendor; the executor pin
remains a permanent override for the pipeline's deliberate pins.

**Detail:** `04 §2.1`; `plugins/sp/references/roles.md`; `plugins/sp/skills/spur-dev/references/flag-glossary.md`; ADR-033 amendment (0536).

**Amendment (2026-08-15, feature G5 / task 0565).** Explicit `--agent inline` is a **hard
host-session guarantee**, not a synonym for `omit`. Host-session surfaces (slash commands, backend
agent skills) keep model-bearing work in the invoking session. Headless surfaces (`spur agent run`,
workflow `agent.run`, serve-side dispatch) cannot host a session and reject `inline` with the
frozen exported `AGENT_INLINE_HEADLESS_MESSAGE` at exit 2 (CLI boundary) or through the existing
resolve/action failure channels — no dispatch, no `agent.default` fallback, no partial side
effects. 0508 native-subagent eligibility applies to **`omit` only**, never explicit `inline`. The
unified table stays: role, executor name, bare binary name (shim), `auto`, or `inline`
(host-session-only).

**Why.** Explicit `inline` was silently ≡ omit → `agent.default` on headless surfaces, so an
inline request could execute in another session with zero signal — the debugging trap feature G5
removes. The stable greppable message (not a new exit code) carries attribution; exit-code taxonomy
is already crowded.

**Detail:** `04 §7.8`; `docs/design/agent-inline-host-session.md`; task 0565.

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

  **Amendment (2026-08-21, task 0625):** The repository quality gate is deliberately split:
  `spur-check` is the fast per-task chain and excludes the corpus sweep; `spur-check-new` adds
  `spur task check --corpus`. Per-task lifecycle edges keep their structural guards, while an
  applied wrap-up feature transition runs `spur-check-new` once and reports its result before the
  transition action returns. This supersedes the phrase "on `spur-check`" above. The split keeps
  the measured corpus-sweep cost out of every task loop without leaving feature-level findings
  unobserved. **Detail:** `03 §12.5` and
  `docs/design/lifecycle-projection-integrity.md`.

  **Amendment (2026-08-21, task 0625 forced re-audit):** A multi-hop sync that lands an earlier
  hop and then fails a later guard is a changed feature state, even though no `{ applied: true }`
  result is returned. The service therefore refreshes the touched roster in `finally` after any
  landed hop, and wrap-up runs the corpus-aware gate on either an applied result or a non-zero sync
  exit. **Why:** `active → verifying` can persist before the strict `→ done` guard rejects — the
  exact A3 residue this decision must observe. **Detail:** `03 §12.5` and
  `docs/design/lifecycle-projection-integrity.md`.

## ADR-051: Public CLI Surface vs Internal spur-dev Tooling — Ownership and Consent Gate

- **Status:** Accepted · **Date:** 2026-08-10

**Decision.** The public Spur CLI serves end users; internal commands serve repository development.
New or changed public nouns/verbs require operator consent with design context. Prefer verbs
under existing nouns; add a noun only when no existing noun owns the action.

**Why / tradeoff.** Public commands are versioned user contracts. Keeping internal plumbing
separate limits public commitments while allowing repository tooling to evolve.

**Amendment (2026-08-10).** Corpus checking was placed under the existing task noun.
**Amendment (2026-08-16).** Consent also covers changes to observable output of existing verbs.
**Amendment (2026-08-20).** Extend placement to four owners: public CLI, internal command modules,
package-script compositions, and portable plugin scripts (ADR-065).

**Consent provenance:** the 2026-08-20 A3 batch, 2026-08-21 feature-refresh breadth,
2026-08-26 doctor options, and 2026-08-27 workflow-show options are recorded in the
[surface governance contract](design/harness-surface-governance.md) and their linked tasks.
These applications do not create additional architectural decisions.

**Detail:** [harness surface governance](design/harness-surface-governance.md).

## ADR-052: Team-Scoped Board Composition with Separate Control and Message Planes

- **Status:** Accepted · **Date:** 2026-08-11 · **Feature:** G3 · **Supersedes:** ADR-042
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

- **Status:** Accepted · **Date:** 2026-08-12 · **Feature:** J5
- **Decision:** Keep upstream `@gobing-ai/ts-*` event maps domain-local; Spur wraps cataloged events
  at its shared tap/emitter boundary in a versioned actionable envelope carrying project, producer,
  correlation, presentation, and bounded redacted data. Existing trace JSON contracts may gain
  optional context fields but retain every existing field and meaning.
- **Why:** One Spur-owned projection makes every Board and CLI consumer consistent without coupling
  the generic upstream EventBus or duplicating policy across emit sites.
- **Detail:** `03 §16`; `docs/design/actionable-observability-context.md`; feature J5.

## ADR-057: Inter-Agent Coordination Is a Runtime-Mediated Control Plane

**Status:** Accepted · **Date:** 2026-08-12 · **Feature:** G4

**Decision.** Coding agents coordinate only through Spur’s two existing channels — durable `spur message` / `inbox_messages`, and the supervised process pipe. There is no third IPC transport, no agent-to-agent socket, no terminal scrape, and no keystroke injection. The Board is a client, not a wait or command authority. New verbs stay on `agent` / `message` (ADR-051).

**Why.** Copying multiplexer I/O would collapse ADR-052’s two planes and fight a harness that does not own PTYs.

**Detail:** `03 §17`; `docs/design/inter-agent-control-plane.md`; feature G4. Complements ADR-052 (does not change Board composition).

## ADR-058: Tracked Transition Shims — Two-Sided Manifest Gate

- **Status:** Accepted · **Date:** 2026-08-13 · **Amends:** ADR-041, ADR-047 · **Feature:** B2
- **Decision:** Compatibility with the pre-role agent surface is accepted for the agent-role
  transition period — but only as a tracked shim. Every compatibility path carries a source
  comment marker `@transition-shim(<id>)` registered in `config/transition-shims.json` (required
  fields: id, owning WBS, file, what it keeps working, removal condition). The two-sided gate
  `bun run transition-shim-check`, wired inside `spur-check`, fails on any marker with no
  manifest entry **and** on any manifest entry whose marker is gone from source — the two
  reported distinctly. Emptying the manifest is the definition of the transition being complete;
  a removal condition must be objectively checkable against the repository.
- **Why:** Untracked shims become permanent compatibility debt, and a one-sided list rots into a
  silent suppression file — the same failure `corpus-check`'s two-sided baseline exists to end
  (ADR-050).
- **Detail:** `03 §18`; `04 §2.5`; `plugins/sp/scripts/transition-shim-check.ts`; task 0541;
  shims registered by 0536/0537/0538/0542.

## ADR-059: Run→Session Correlation Is the Provenance Authority

**Status:** Accepted · **Date:** 2026-08-14 · **Feature:** E6

**Decision.** Every DB-backed `spur agent run` records its run→session mapping in
`history_run_session` at the invoke boundary (exact; `observed` or `supplied`), and imported
history predating observation is correlated retroactively by time window (estimated;
`inferred`) — an `estimated` row never shadows an `exact` one, and zero/several candidates
write nothing rather than a guess. Session `provenance` (`spur-run` vs `ambient`) is derived
from that mapping; the cwd-substring `detectProvenance` heuristic is deleted upstream
(`@gobing-ai/ts-llm-jsonl-importer@0.4.33`).

**Why.** The heuristic guessed provenance from a path substring; the mapping observes or
infers it from the run that actually produced the session.

**Detail:** `03 §7`; `04 §3.1` (`history_run_session` row) and `spur agent run`; tasks 0557/0558/0559.

## ADR-060: Trace Cost Joins the Mapping to Typed Token Columns — Never Prices

**Status:** Accepted · **Date:** 2026-08-14 · **Feature:** E6

**Decision.** `spur workflow trace` cost attribution joins the `history_run_session` mapping to
`history_message`'s typed token columns, folding exact and estimated figures apart and never
summing them; the ETL `CostRecord` read path is retired on the read side. Tokens are reported,
never priced — no currency value is computed or emitted.

**Why.** Pricing is a consumer concern (0281/0284 never-fabricate); tokens are the measured
fact, and mixing observed with inferred figures hides the confidence of each.

**Detail:** `03 §7`; `04` `spur workflow trace`; task 0559.

## ADR-061: The Role→Tier SSOT Is Code in packages/config, Not the Plugin Markdown

**Status:** Superseded by ADR-078 · **Date:** 2026-08-16 · **Feature:** B3

**Decision.** The Layer-1 role → tier/stages map's single source of truth is
`DEFAULT_AGENT_ROLES` in `packages/config/src/index.ts`, with an optional, closed-vocabulary
`agent.roles` project override (per-field merge: re-tier/re-stage a known role; never invent
roles) validated at config load. The CLI resolves roles as `DEFAULT_AGENT_ROLES ← agent.roles
override` — the runtime regex parse of `plugins/sp/references/roles.md` is deleted outright,
with no transition shim: code defaults are byte-identical to the last parsed values, so a
fallback could only reintroduce drift. `roles.md` survives as an agent/human-facing projection
whose tier/stages half is parity-gated by `plugins/sp/tests/roles.test.ts` (R9) against the
constant; its command→role mapping half stays plugin-owned (command frontmatter is its SSOT).

**Why.** The map is a CLI routing contract (it defines the `--agent` selector domain and drives
`AgentService` resolution), yet its SSOT was plugin content the core regex-parsed at runtime —
two inversions: a missing/stale plugin tree hard-failed every role dispatch, and the parse's
shape was frozen by a test inside the plugin, i.e. the plugin tested the CLI's dependency.

**Detail:** `packages/config/src/index.ts` (`DEFAULT_AGENT_ROLES`, `AgentRoleConfigSchema`);
`apps/cli/src/context.ts` (`resolveAgentRoles`); `04` `agent.roles`; task 0572.

## ADR-062: Corpus Gates Verify Evidence Content, and Every Severity Is Ratcheted

**Status:** Accepted · **Date:** 2026-08-17 · **Amends:** ADR-050 · **Feature:** F91

**Decision (historical policy).** Check all configured task folders and ratchet both errors and
warnings against a two-sided, unique-key baseline. Evidence must name the requirement's subject,
not merely resolve a path; support explicit repository and external citation forms. Scenario
coverage respects declared task-versus-feature altitude.

**Why / tradeoff.** Path-only checks accepted unrelated evidence; unratcheted warnings hid defects.
The wider sweep exposed old debt but imposed a costly reconciliation burden.

**Later policy:** ADR-090 changed the ratchet, ADR-092 narrowed audit scope, and ADR-108 retired
accepted-debt snapshots. Evidence-subject and citation requirements remain independently owned.

**Detail:** [planning records](design/planning-record-contracts.md); ADR-050/090/092/108.

## ADR-063: A New Top-Level Feature Node Requires Operator Consent

**Status:** Accepted · **Date:** 2026-08-17 · **Complements:** ADR-051 · **Feature:** F91

**Decision.** Nest work under the feature owning its primary object. A new top-level root
requires operator consent and reasons for rejecting candidate parents. Child-count limits never
justify a new root; relocate misplaced work through the feature tool.

**Why / tradeoff.** Root IDs form the durable product map. Restricting root growth costs a placement
decision but prevents an agent's filing convenience from redefining product structure.

**Detail:** 04 §7.2; ADR-051.

## ADR-064: Pin the Implement Executor Per-Hop via `implementAgent`

**Status:** Accepted (design) · **Date:** 2026-08-18 · **Feature:** H1

**Legacy record — execution tuning.** Evaluate the existing implementAgent per-hop pin as the
latency lever; retain the capability floor and require a same-task comparison before adoption.
Raising timeouts or weakening gates does not address generation latency. Narrowing hop scope was
rejected as a non-bottleneck; review/verify parallelism was deferred as a separate FSM change.

**Why.** The measured runs were dominated by implement generation.

**Detail:** task 0588 Design owns measurements and alternatives; task-pipeline owns the pin.
This tuning approval is not precedent for new task-level ADRs.

## ADR-065: Align plugins/sp Scripts to the Superskill Entrypoint Contract

**Status:** Accepted · **Date:** 2026-08-19 · **Feature:** I

**Decision.** Portable plugin shipping scripts use Node-compatible entrypoints, committed
generated .mjs twins and the canonical Superskill script path. Repository-only gates may use Bun.
A two-sided manifest/build gate checks category, roster, twins and invocation references.

**Why / tradeoff.** Plugin users need no monorepo/Bun environment; portable twins add a build-time
parity obligation. Repository-only tooling retains its existing runtime.

**Amendment (2026-08-24).** The history-anatomy cache helper joins the portable shipping category.
The manifest owns the roster; this register does not duplicate it.

**Detail:** config/plugin-scripts.json; Superskill ADR-015/022; 04 §2.6.

## ADR-066: Cataloged System Events Use Exhaustive Server-Side Presenters

**Status:** Accepted · **Date:** 2026-08-19 · **Feature:** J9

**Decision.** Every cataloged System Event resolves through a typed, event-name-keyed server presenter that owns its authored description, retained fields, summary behavior, and explicit outcome derivation or unsupported classification; clients render the canonical result and do not interpret event payloads.

**Why.** One exhaustive event-specific authority prevents source-family defaults and client switches from drifting across persistence, SSE, history, table, and tooltip views.

**Detail:** `03 §16.1`; `docs/design/event-tracking.md` §11; `docs/design/actionable-observability-context.md` §System Event semantic presentation.

## ADR-067: Stored Event Facts Are Stable; Derived Presentation Reprojects on Read

**Status:** Accepted · **Date:** 2026-08-19 · **Amends:** ADR-056 · **Feature:** J9

**Decision.** A valid stored canonical v2 System Event keeps its persisted `data` and `context` unchanged, while history reads recompute only `presentation` through the current catalog presenter; no ledger row is rewritten.

**Why.** Stored facts are evidence, while summary, description, fields, outcome, and action are view policy that can improve without mutating that evidence.

**Detail:** `03 §16.1`; `docs/design/actionable-observability-context.md` §Projection paths.

## ADR-068: Missing Event Semantics Are Captured at the Producing Boundary

**Status:** Accepted · **Date:** 2026-08-19 · **Feature:** J9

**Decision.** Facts absent from bounded event data are added where they are known: planning mutations emit their section locus, workflow composition emits workflow and step identity, and the upstream queue-consumer contract emits its configured queue name; presenters and clients never infer or backfill absent facts.

**Why.** Reconstructing identity or outcome from unrelated configuration, job types, or event names would turn diagnostic presentation into a guess.

**Detail:** `03 §16.1`; `docs/design/event-tracking.md` §§6–7/11.

## ADR-069: Workflow YAML Orchestrates Owned Capabilities

**Status:** Accepted · **Date:** 2026-08-19 · **Feature:** D5

**Decision.** Workflow YAML orders capabilities. Deterministic behavior remains in existing
application/CLI modules or capability-specific built-ins; extensions own local policy and
agent.run remains the judgment boundary.

**Why.** Existing seams preserve one behavior owner without another workflow DSL.

**Amendment (2026-08-20).** Add measurable shell/non-slash-prompt composition advisories.
Findings recommend the existing ownership choices; they never change validation exit status,
block execution or enter the quality gate.
**Amendment (2026-08-21).** Freeze the shell threshold at more than five non-comment units;
prompt length determines severity, not whether a non-slash input is reported. Exact severity
bands and historical dispositions belong in the surface contract.
**Amendment (2026-09-05).** ADR-108 retires disposition snapshots and exact-mirroring machinery.
Measures and advisory-only behavior remain; live findings cannot be hidden by stored dispositions.

**Detail:** [workflow composition](design/workflow-composition-contract.md) and
[surface governance](design/harness-surface-governance.md).

## ADR-070: Workflow Progress Reprojects Persisted Execution Truth

**Status:** Accepted · **Date:** 2026-08-19 · **Feature:** D5

**Decision.** Workflow progress is a pure read projection of the resolved definition and existing
persisted run, phase, transition, action, and artifact rows; System Events only wake re-queries, and
bounded polling remains the convergence fallback.

**Why.** One replay authority avoids an event-derived progress store that can disagree after loss or restart.

**Detail:** `03 §21`; `docs/design/workflow-observability.md` §D5 detailed progress projection.

## ADR-071: Mutation After Verification Invalidates the Proof

**Status:** Accepted (design) · **Date:** 2026-08-19 · **Feature:** D5

**Decision.** Every proof-bearing action declares repository/corpus state effects separately from
evidence writes; `write` or `may-write` invalidates prior proof, and PASS is valid only when the
quality, review, and observe-only verification evidence names one unchanged final-state digest.

**Why.** A verdict cannot prove tree state that was allowed to change after the verdict was produced.

**Detail:** `03 §20.3`; `docs/design/workflow-composition-contract.md` §Verification proof state.

## ADR-072: One Canonical Pipeline per Lifecycle Boundary

**Status:** Accepted · **Date:** 2026-08-19 · **Feature:** D5 · **Amends:** ADR-029

**Decision.** Keep task execution, idea, docs, wrap-up, and integration-HEAD PR review as distinct
lifecycle workflows; absorb planning into the canonical idea/dev-plan path, and merge only a
proof-preserving task-pipeline2 delta into task-pipeline before deleting the duplicate.

**Why.** A single graph per lifecycle boundary removes semantic drift while preserving genuinely independent gates.

**Detail:** `03 §20.4`; `docs/design/workflow-composition-contract.md` §Target workflow inventory.

**Acceptance (2026-08-20, task 0606 R6).** Every runtime planning caller was already migrated by
task 0604 (waves D5-A…D5-P); nothing seeds or references `planning-pipeline.yaml`. On acceptance:
`config/workflows/planning-pipeline.yaml` is deleted, ADR-029 is amended to record the retirement,
and `RETIRED_PROJECT_SEEDS` in `packages/config/src/bundled-config.ts` (which excluded the retired
graph from init seeding) is removed as now-dead, together with the two tests asserting the exclusion.

## ADR-073: System Event Table Cells Project Human Identity

**Status:** Accepted · **Date:** 2026-08-19 · **Feature:** J91

**Legacy record.** Feature/UI/operational guidance retained for existing references;
its detailed contract belongs in the linked owner. It is not precedent for new task-level ADRs.

**Decision.** Observability System Events table columns display only human correlators; opaque event ids and remediation commands that embed those ids remain in the tooltip and expanded payload.

**Why.** Operators diagnose from the table; substituting UUIDs and trace commands for workflow, step, and action names hides the facts they need.

**Detail:** `03 §16.2`; `docs/design/system-events-human-table.md`.

## ADR-074: Coding-Agent Identity Is an Optional Presentation Projection

**Status:** Accepted · **Date:** 2026-08-19 · **Feature:** J91

**Legacy record.** Feature/UI/operational guidance retained for existing references;
its detailed contract belongs in the linked owner. It is not precedent for new task-level ADRs.

**Decision.** Coding-agent / executor identity is an optional `presentation.agent` string projected by the envelope from bounded payload facts in a fixed order; it is never `context.producer`, never inferred by the Board, and omitted when the event has no executor.

**Why.** Producer names the emitting package; the diagnostic question is which coding agent executed the request, and that fact already exists on agent-bearing payloads.

**Detail:** `03 §16.2`; `docs/design/system-events-human-table.md`.

## ADR-075: Wait and Message Stay Identity-Pinned — No Role Addressing

**Status:** Accepted · **Date:** 2026-08-20 · **Feature:** D6 · **Task:** 0609

**Decision (original).** Wait/message addressing remains concrete-spec based. Roles select
executors, not recipients; add role addressing only after a concrete caller demonstrates need.

**Why / tradeoff.** An occupant pin prevents wait/re-resolution races. Adding role lookup without
a caller would introduce zero/multiple-match ambiguity for no demonstrated benefit.

**Amendment (2026-08-26 · Task 0685).** Admit exact-one role/executor-name resolution to a spec ID.
Zero or multiple matches fail with candidates; no fan-out. Existing --to addressing remains.
**Amendment (2026-08-26 · Task 0685 verification correction).** Wait and send-with-wait snapshot
the existing occupant pin after resolution. Unwaited send queues to the resolved spec ID without
requiring a live occupant, matching the original --to path.

**Detail:** [inter-agent control plane](design/inter-agent-control-plane.md) §6; ADR-057.

## ADR-076: Retire the D5-N Promotion Bar — Delete task-pipeline2 Rather Than Promote It

**Status:** Accepted · **Date:** 2026-08-20 · **Feature:** D5 · **Task:** 0606 · **Amends:** ADR-072

**Decision.** The D5-N promotion bar is **retired as a gate**, and `config/workflows/task-pipeline2.yaml`
is **deleted rather than promoted**. `task-pipeline.yaml` remains the single canonical task pipeline.
`scripts/spur-dev.ts eval-pipeline` survives as a _measurement_ tool, invoked deliberately; it is no
longer a precondition for any transition, deletion, or feature closure.

**Why.**

- **The bar guarded a promotion nobody wants.** A static comparison of the two graphs
  (`extractResolvedWorkflowFacts`, 2026-08-20) shows pipeline2 declares **5** model queries to
  pipeline1's **4** — it _adds_ a `residual-sweep` model hop. The stated goal of the work was to make
  the pipeline faster. Promoting a graph with an extra LLM stage does not serve that goal.
- **The thing it blocked was a no-op deletion.** `task-pipeline2.yaml` has **zero live callers** —
  nothing in `config/`, `plugins/`, `apps/`, `packages/`, or `scripts/` invokes it. The only
  non-documentation references were its own `name:` field, its composition-baseline entry, and a
  prose proposal string. Deleting unreferenced code needs no performance evidence; the constitution's
  "delete, don't layer" rule already covers it.
- **The gate did not protect what it appeared to protect.** Changes to the _canonical_
  `task-pipeline.yaml` never went through the bar — the 2026-08-20 precheck-size fix landed without it.
  It gated a parallel file, not the pipeline that runs real work.
- **The instrument could not measure its own criterion.** `eval-pipeline` derives `tokenCost` from
  `action_runs.result_json`, where 44 of 1971 rows carry any token field — so every run reported
  `tokenCost: null`. The bar's "model-query count / cost" condition was unmeasurable in practice.
- **The wall-clock baseline was unrepresentative.** The 538 s I6 PASS baseline is the outlier: the only
  other full-depth run on record is 2053 s, and the 2026-08-20 runs measured 2023 s / 1985 s — all
  within 4 % of each other. A ±10 % band around 538 s was not a reachable target.
- **Cost of keeping it.** Four attempts over two days, each ~35 min × 2 pipelines of live model quota,
  never reaching a verdict. It blocked 0606 R1 → R3 → R4 → D5 closure → tasks 0607/0608 → feature D6.

**The safety rationale was already discharged.** ADR-071 made `residual-sweep` read-only and
snapshot-bracketed, so a post-PASS mutation cannot reach `record`. What the bar still guarded was
cost and parity, not a safety hole.

**How performance is measured instead.** From real execution, not a synthetic fixture. Every task run
through the pipeline already produces wall-clock, and `history_message` carries per-message
`input_tokens` / `output_tokens` / `cost_usd` for pi, claude, omp, and codex. Real runs are a larger
and more representative dataset than a one-R-item fixture, and they cost nothing extra.

**Evidence that would reopen this.** A concrete need to promote a parallel task-pipeline graph that
measurably _reduces_ model-query count or wall-clock against real-run history data. If that appears,
gate it on measured real-run data, not on a fixture bar.

**Detail:** ADR-071 (proof-state invariant), ADR-072 (one canonical pipeline per lifecycle boundary),
`docs/design/workflow-composition-contract.md`.

## ADR-077: Pin Beats Role — Explicit Executor Pins Win Routing; Roles Set the Tier Floor

- **Status:** Accepted · **Date:** 2026-08-20
- **Decision:** When an `agent.run` step (or CLI invocation) carries both an explicit executor pin
  and a declared role, the pin wins routing outright and the role sets only the capability floor the
  escalation ladder climbs from. A pinned executor is operator steering — an intentional override —
  while a role is a starting-tier default. Resolution never silently substitutes away from a pin.
- **Why:** Post-mortem (task 0622) surfaced doubt about which signal wins when pipelines declare
  `agent: ${vars.agent}` alongside `role:`. Both shipped behaviors are intentional and
  production-reachable; the precedence was implicit in code but nowhere written. All seven shipped
  pipelines follow this pattern (pin from vars, role as floor), so codifying it removes ambiguity
  without changing behavior.
- **Detail:** `packages/app/src/services/agent-service.ts` — pin handling and the comment that a pin
  bypasses role resolution (~:1202-1209), role attribution recorded under a pin (~:1240-1263), and
  role→starting-tier rationale (~:1285-1303). Tests:
  `packages/app/tests/services/agent-service.test.ts:2574` (declared-role escalation climbs the
  ladder) and `:2645` (pinned executor bypasses role routing).

## ADR-078: The Role→Tier SSOT Moves to the Config Layer; Code Keeps a Byte-Identical Fallback

**Status:** Accepted · **Date:** 2026-08-23 · **Supersedes:** ADR-061 · **Feature:** A4

**Decision.** The role→tier/stages table's single source of truth is the config layer: the
machine-wide `config/config.global.yaml` (0641 R4) carries the full base table, project
`.spur/config.yaml` applies per-field `agent.roles` overrides on top, and the merged object is
validated once at load (0640). `DEFAULT_AGENT_ROLES` in `packages/config/src/index.ts` is demoted
to a minimal hardcoded fallback, **byte-identical to the shipped global default** — all four roles
at their current tiers and stage sets. The fallback applies only when the merged config provides
no `agent.roles` table at all (no global file and no project file): the CF-safe core must resolve
roles with no filesystem access. A fallback that differed from the shipped default would turn a
missing config file into a silent behavior change — precisely the failure ADR-061 existed to
prevent — so byte-identity is the requirement, not a nicety.

**Why.** ADR-061 put the SSOT in code because, on 2026-08-16, "config-owned" meant "per-project
duplicated" — no machine-wide config file existed, so config ownership implied N copies drifting
apart. The operator ruled on 2026-08-23 to overturn on that premise change: A4's layered loader
(0640) supplies the machine-wide file, retiring the duplication argument. ADR-061's other reason
survives and constrains this design: a code default must exist for the no-filesystem case. Also
surviving from 061: the closed four-role vocabulary (`scribe`, `coder`, `reviewer`, `planner` —
0536; the inversion changes _where the table is read from_, never _how many roles exist_), the
per-field override semantics (re-tier/re-stage, never invent), `roles.md` remaining a projection
rather than a runtime input, and the deletion of the runtime markdown regex parse.

**Detail.** Blast radius: `packages/config/src/index.ts` (`AgentRoleSpec:158`,
`DEFAULT_AGENT_ROLES:173` demoted to fallback, `AgentRoleConfigSchema:221`, and the
`AgentConfigSchema.superRefine` role-key closure + executor/role namespace disjointness — unchanged,
now guarding the merged object whatever its provenance); `apps/cli/src/context.ts:49`
(`resolveAgentRoles` merges the config-sourced base with project overrides instead of the constant;
signature fate deferred to the implementation ticket); `plugins/sp/tests/roles.test.ts` R9 (`:310`)
retargets from "markdown ≡ constant" to three-way parity: `roles.md` ≡ `config/config.global.yaml`
table ≡ fallback constant (byte-identical). The gate does not retire — pointed only at the demoted
constant it would stop guarding the real SSOT. Layer merge per 0639's classification:
`agent.roles` object-deep-merge, `<role>.tier` scalar-replace, `<role>.stages` array-replace
(whole-set semantics; concat misroutes). Implementation task follows this ADR + the 0642 Solution
blast-radius table.
**Amendment (2026-08-24) — the fallback is explicit, never silent (feature A5 R7/R8).** The
composition root records role-table provenance (`config` when the merged config supplies
`agent.roles`, `fallback` otherwise) and threads it alongside the role map; `spur agent doctor`
reports when the byte-identical fallback is in effect (error-stream note in text mode, a
`rolesSource` field under `--json`). The fallback's content, applicability rule, and parity gate
are unchanged — what changes is that applying it is now observable. **Detail:**
`docs/design/universal-config-loading.md` §Role-fallback provenance.

## ADR-079: A Report Cache Stores Judgment, Never Evidence — the Deterministic Half Always Reruns

**Status:** Accepted · **Date:** 2026-08-24 · **Feature:** I8

**Decision.** A cached diagnostic report is reusable only for the model-authored half. Every
invocation reruns the deterministic half — `spur history analyze` over the live imported database —
and reuses the cached enrichment only when the freshly derived semantic artifact digest, the report
contract version, and the skill/workflow logic digests all match what the cached report recorded.
The cache is never validated from a filename, a modification time, or a `generated_at` field.

**Why.** A cache keyed on anything but re-derived evidence can present a stale conclusion as current
evidence, which is the one failure a diagnostic report cannot survive.

**Amendment (2026-08-25, task 0669).** Digest authority moved beside the type it canonicalizes:
`semanticArtifactDigest`, its canonicalization, and the ranked-versus-set classification now live in
`packages/domain/src/analytics/artifact-digest.ts` (`ARTIFACT_ARRAY_CLASSIFICATION` is derived from
the `HistoryArtifact` type; an unclassified array field fails `tsc`). The plugin script consumes a
generated committed copy (`plugins/sp/lib/artifact-digest.generated.mjs`, `bun run build:plugin-lib`)
so the ADR-065 twin keeps running under bare node with no monorepo dependency; digests are unchanged
(proven by fixture parity), so no published report's recorded `artifactDigest` is invalidated.

**Detail:** `docs/design/history-anatomy.md` §Cache contract — identity tuple, frontmatter
provenance fields, provisional-versus-closed day semantics, and the invalidation matrix.

## ADR-080: A Bounded Ranking Is Never a Population Count

**Status:** Accepted · **Date:** 2026-08-24 · **Feature:** I8 · **Consent:** HA-S1, operator-approved 2026-08-24

**Decision.** Any analytics artifact that bounds a leaderboard must also carry the true population it
was drawn from and the applied depth, and every renderer must present the bounded list as "top N of
M". Where the true population is unavailable — an artifact written before the field existed — the
figure renders `not available`; a bounded array length is never substituted for a total.

**Why.** `render-forensics.ts:54` printed `bySession.length` as the total session count while
`analyze --top` bounds that array to 20, so any day with more than 20 sessions rendered a coverage
claim that was silently false.

**Detail:** `docs/design/history-anatomy.md` §HA-S1 — the additive artifact fields, the renderer
change, and the backward-compatibility rule for pre-addition artifacts.

## ADR-081: Board Module Shell Convention — One-Row Header, Append-Only Tabs, Density-First Full-Bleed

**Status:** Accepted · **Date:** 2026-08-24 · **Feature:** F72

**Amendment (2026-08-26).** The full-bleed rule now applies to the **board body only**; the
module **header** rides the shared centered `max-w-[1600px]` rail (History/Observability parity),
so the two modules' headers align at the same width while Tasks' lanes keep every available
pixel below. `index.test.tsx` pins this split: `max-w-[1600px]` appears only in the header, never
inside `[data-kanban-board]`.

**Decision.** Every multi-view Board module composes a shell: a `<Module>Shell.tsx` owning a single
header row — icon + module name + live chip on the left, module-specific inline filters in the
middle, tab strip on the right — backed by an append-only `tabs.ts` contract
(`{ id, label, component }`; never reorder or rename, because the tab strip and any persisted UI
state key on `id`). The default module layout stays the centered `max-w-[1600px]` column (History,
Observability); a density-first module whose primary canvas is a multi-lane board MAY go full-bleed,
with header and body sharing one horizontal padding so lanes align under the header — Tasks is the
first full-bleed instance. A module embedded inside another module (Workspace ⊃ Tasks) keeps a
headerless export rendering pure content; the shell is the route component, and header affordances
(filters, primary actions) belong to the module route, not the embed. Header-owned state (phase,
lane visibility) reaches the board as optional controlled props with uncontrolled in-board defaults.

**Why.** History (0626) and Observability (J92) already implement this shell by example; F72 is the
third adopter and the first to diverge on width. An unrecorded divergence is exactly the drift the
constitution's conflict rule forbids, and the next module refactor needs the convention, the width
rule, and the embed rule written down once rather than re-derived per module.

**Detail:** `docs/design/tasks-module-shell-parity.md` — header anatomy, combined-input parse rule,
tab contract, controlled-prop seam, and card enrichment shapes; mechanism placement in
`docs/03_ARCHITECTURE.md` §14.5.

## ADR-082: Merged Config Loads Once at the Composition Root — the Only App-Config Source

**Status:** Accepted · **Date:** 2026-08-24 · **Feature:** A5

**Decision.** Every Spur process loads app config exactly once at its composition root via the
merged `loadSpurConfig` (global defaults + project override, validated once — 0640) and threads
the resulting `SpurConfig` through the dispatch/service context. ts-infra's `runNodeApplication`
retains only the project-shaped `bootstrap` section; `appRt.appConfig` is never read, every
per-slice `loadSpurConfig` call outside the two composition roots (CLI `main()`, server startup)
is deleted, and no ts-infra multi-file layering API is built — that remains a possible later
evolution, not a prerequisite. A config-load failure at the composition root emits a single
`--json` error envelope naming the failing layer.

**Why.** The CLI composition root validated the merged config and then discarded it, feeding
dispatch from ts-infra's single-file load — so one process held two config truths and the entire
global layer went invisible whenever a project config existed (`spur agent doctor coder` failing
against 15 globally defined executors, reproduced 2026-08-24).

**Detail:** `docs/03_ARCHITECTURE.md` §1.2.1 (mechanism + invariants);
`docs/design/universal-config-loading.md` (context shapes, consumer rewiring table, `--json`
error-envelope codes, regression-test matrix).

## ADR-083: The Anchor-Citation Class Is a Dated Legacy Set — Frozen Pending F91's Matcher Decision

**Status:** Superseded by ADR-090 (2026-08-27) · **Date:** 2026-08-25 · **Feature:** F61

**Legacy record — historical reconciliation.** The 2026-08-25 citation findings were frozen as
a dated legacy set without a repair campaign or matcher change. Probes showed the point-window
matcher rejected otherwise valid citations; matcher changes were routed to F91 separately.

**Why / tradeoff.** Re-authoring correct citations would hide the matcher defect. Freezing residue
preserved the narrow reconciliation scope but did not solve matching quality.

**Supersession:** ADR-090 removed this mechanism; frozen entries did not migrate.
Probe evidence and the proposal remain in task 0670 Background/Design.

## Routed proposal to feature F91 (task 0670 R2)

Historical proposal/evidence belongs to task 0670 and feature F91. This heading is retained for
existing references; it grants no current matcher-change or repair-campaign authorization.

## ADR-084: Environment-Improvement Lens Projects Into Existing Report Owners

**Status:** Accepted · **Date:** 2026-08-26 · **Feature:** I9

**Decision.** Harvest vendor `vendors/misc/retro` as one plugin-level environment-improvement mapping projected into `sp:dogfood-testing` report §6 and `sp:history-anatomy` report section 9. Do not add a third analysis skill, `/sp:dev-retro`, or a public CLI noun. History-anatomy's closed category vocabulary stays frozen — retro names occupy `<signal>` or owner-surface only. The mapping is the single category table and carries the implementer-versus-reviewer placement rule.

**Why.** The harvestable value is a compact taxonomy plus a placement rule; a third skill would overlap two live report contracts and fail ADR-016's command test.

**Detail:** `docs/03_ARCHITECTURE.md` §22; `docs/design/environment-improvement-lens.md`.

**Amendment (2026-08-27 · ADR-089):** The prohibition remains on a standalone retro/lens command
that duplicates the two report owners. `/sp:dev-review-session` is a distinct current-context
review surface: it reviews the active conversation, uses this lens only to place supported
improvement proposals, and performs no imported-history analysis.

## ADR-085: Environment Remediations Remain Operator Proposals

**Status:** Accepted · **Date:** 2026-08-26 · **Feature:** I9

**Decision.** Environment-lens remediations are operator proposals only. Dogfood fix-mode must not `Edit`/`Write` `AGENTS.md`, skills, rules, or other environment sources for an environment-tagged finding. History-anatomy already forbids applied changes; I9 does not add a second mutation source.

**Why.** Retro suggests environment changes; mixing those into dogfood fix-mode would mutate harness files on the same path that repairs the testee.

**Detail:** `docs/03_ARCHITECTURE.md` §22; `docs/design/environment-improvement-lens.md`.

**Amendment (2026-08-27 · ADR-089):** `sp:session-review` inherits present-don't-apply for process
and environment improvements. Its complete report is read-only: no source/doc edit, corpus write,
workflow launch, or indexed-context append.

## ADR-086: Materialized Agent Instances Are Runtime State, Not Committed Spec Files

**Status:** Accepted · **Date:** 2026-08-26 · **Task:** 0685

**Decision.** Agent-team state is a three-layer taxonomy:

1. **Capability catalog** (`agent.roles`, `agent.executors` in `.spur/config.yaml`) is _config_ —
   hand-authored and committed. It defines what CAN run.
2. **Team rosters** (`agent.team.<id>.members`) are _config_ — declared intent for what SHOULD run,
   committed with the project.
3. **Materialized agent instances** (deterministic `<teamId>-<memberKey>` ids, executor bindings,
   resolved Layer-1 roles) are _runtime state_: after the `0026_spur_cli_agent_instances` cutover
   they are rows written by the composition root (`team up`) into the project's CLI database.
   Today they are the files under `.spur/agents/`, which are untracked scratch (`.gitignore`
   `.spur/agents/*`, 0685 R3) — never a source of truth and never committed shapes. The read shape
   is frozen ahead of the cutover in `AgentInstance` / `AgentInstanceStore` (`packages/domain`, 0685
   R2); the migration DDL stays a reserved draft until its writer exists. No `0026_*.sql` is
   registered before then.

`~/.config/spur/projects.json` is rejected as the instance home for three reasons (task 0685):
(1) wrong granularity — it is the cross-project machine registry (`{name,path,port}` only), while
instances are per-project and scoped to that project's composition root and DB; (2) conflation —
adding per-team mutable instance rows to a schema-versioned, advisory-locked pointer file turns one
process's lock artifact into another's config SSOT; (3) transactional needs — instance writes join
team-state mutations (occupancy, inbox) the project SQLite DB already owns atomically, which a JSON
pointer file cannot provide.

Untracked generated specs also imply the demo-story fix: an example roster ships as the commented-in
`agent.team.demo` block in `.spur/config.yaml`, not as tracked spec files.

**Amendment (2026-08-26 · Task 0685 verification correction):** The capability catalog
(`agent.roles`, `agent.executors`, `agent.default`) stays machine-global in
`~/.config/spur/config.yaml`; `.spur/config.yaml` owns the project roster and optional project
overrides through the merged loader. The blanket scratch rule cannot inspect YAML tags, so
hand-authored specs remain opt-in trackable with `git add -f`; only `spur:generated` specs are
runtime state by contract. Detail: `docs/03_ARCHITECTURE.md` §17 and `docs/04_DESIGN.md` §2.1/§3.1.

## ADR-087: `--agent inline` Is One Honest Selector — Default Inline, Substitution Over Rejection

**Status:** Accepted · **Date:** 2026-08-26 · **Task:** 0687

**Decision.** Three changes collapse the G5 (0565) frozen-rejection contract and the 0508
omit-only carve-out into plain selector semantics:

1. **Inline is the default.** `resolveAgent` resolves omitted `--agent` as `'inline'`
   (`agent-service.ts`); omitted and explicit `inline` are indistinguishable downstream.
2. **Native-subagent eligibility is resolution-shaped, not flag-shaped.** Task-0508 eligibility
   condition 1 now reads "resolved selector is inline" on the two interactive full-pipeline
   surfaces instead of "`--agent` omitted with an explicit-inline zero-dispatch carve-out"
   (`inline-pipeline-driver.md`).
3. **Headless surfaces substitute instead of rejecting.** `AGENT_INLINE_HEADLESS_MESSAGE` is
   deleted together with its validation gate in `validateAgentSelector`, its workflow wrapper in
   `AgentRunActionRunner.execute`, and the re-export. An `inline` request reaching
   `AgentService.resolveAgent` resolves through the tier chain exactly like `auto` and emits one
   stderr warning naming the substitute (`--agent inline requested on a headless surface (no host
session); resolved <executor> — substituted tier resolution`). No exit-code change, no
   `agent.default` normalization at call sites — substitution lives only where resolution happens.

**Why.** The frozen rejection was honest about the surface mismatch but violated one-flag-one-
meaning: scripts propagating the new default got exit 2 from `spur agent run` for requesting the
same selection an interactive session honors. A warn-and-resolve fallback keeps dispatches alive,
stays auditable (the warning names role/tier provenance), and removes the last conditional branch
from the selector so `inline` has exactly one behavior everywhere: in-session when a session
exists, tier-substituted when it does not. Pinned verbatim tests were updated in the same change;
the exit-2 envelope shape remains untouched for genuine resolution failures.

**Retired by this ADR.** Both rejection contracts are dead ends a future reader must not
resurrect: ADR-046's workflow-specific rejection of `--agent inline` (already superseded by
ADR-047, restated here so no surviving reference implies it still binds) and the ADR-047 G5
amendment's frozen `AGENT_INLINE_HEADLESS_MESSAGE` hard error (task 0565). The debugging-trap
motive behind both is satisfied by the mandatory substitution warning, not by refusal.

**Detail:** `docs/04_DESIGN.md` §2.1/§3.2 (selector table, agent.run flow);
`docs/design/agent-inline-host-session.md` (G5 history, superseded); task 0687.

## ADR-088: The Anchor-Subject Gate Is a Warning Signal, Not an Error Verdict

**Status:** Accepted · **Date:** 2026-08-27 · **Task:** 0688

**Decision.** The dogfood `L4.anchor-subject-mismatch: error` severity override
(`.spur/config.yaml` `tasks.severity`) is removed; the check runs at its default warning severity
and reconciles two-sided in the corpus ratchet. Supersedes the promotion intent recorded in the
2026-08-18 wave (task 0583 R6) and the 2026-08-25 frozen-set note (task 0670, ADR-083), which
conditioned promotion on "the qualification migration is APPLIED and this residue is worked down".

**Why.** Task 0688 (feature F91) fixed the matcher the promotion was waiting for: citations now
match against the anchor's cited lines plus an ±20-line window (`ANCHOR_WINDOW_LINES = 20`), and
row subject tokens exclude every backticked anchor in the row, so multi-anchor rows stop
self-reporting. Measured effect (R5 before/after sweep, `.spur/run/0688-{before,after}.json`):
corpus observed mismatch findings 2015 → 982 (−51%); sections pinned at the 5-finding cap
304 → 124; ADR-083 probe 2 measured new-code mismatches 42 → 10. The migration is applied and the
residue halved — but the remaining 982 are frozen legacy drift with no repair campaign. Promoting
to error now would mint ~840 dated error entries for drift the corpus has explicitly declined to
repair, converting a live drift signal into permanent ratchet debt — the exact anti-pattern the
baseline constitution warns against. A warning reconciles two-sided (new or vanished warning keys
still fail `task check --corpus`), so demotion costs loudness at task transitions, not gate force.

**Consequences.** (1) All 435 error-severity baseline entries staled under the new matcher and
were re-keyed at warning severity; 115 no longer reproduce at all. (2) `L3.testing-coverage` is
retired — bunfig.toml machine-enforces 90/90 coverage on every `bun run test`, so the
human-obligation check is redundant double-keeping; its 54 baseline entries are removed.
(3) Replacing it, `L3.status-claim-contradiction` (error) fires when a Requirements checkbox
contradicts a done/open status claim in the same sentence-ish clause of Solution/Testing prose;
ambiguity is silent by construction, and its measured residue (32 legacy findings, the eb93dfdaa
class) is baselined as a dated set. (4) 04_DESIGN §2.1 and
`docs/design/lifecycle-projection-integrity.md` §2 carry the widened-window tokenization contract.

**Detail:** task 0688; feature F91; `config/corpus-baseline.json` note § 2026-08-27.

## ADR-089: Active Session Review Is Inline and Separate from Imported-History Forensics

**Status:** Accepted · **Date:** 2026-08-27

**Decision.** Ship `/sp:dev-review-session` as a thin wrapper over `sp:session-review`. The skill
reviews the active host conversation, emits a compact read-only report, and never launches a
workflow, delegates to another agent, imports history, compares a baseline, publishes a cache, or
mutates source, docs, memory, or corpus state. `/sp:dev-find-issue` remains the daily/ad-hoc
imported-history surface.

**Why.** Immediate wrap-up and historical forensics have different evidence, latency, and output
contracts; combining them would unfreeze history-anatomy's two-mode and twelve-section contracts.

**Detail:** `docs/design/session-review.md`; `docs/04_DESIGN.md` §6.

## ADR-090: The Corpus Gate Goes Single-Sided on New Findings — Dated Residue Retires with Its Wave

**Status:** Accepted · **Date:** 2026-08-27 · **Task:** 0691 · **Feature:** F94 (absorbs F96)

**Decision (intermediate policy).** Replace dated per-entry debt with a generated previous-sweep
snapshot: new findings fail; vanished entries do not. This amends ADR-050/062, supersedes
ADR-083's dated set and ADR-088's reconciliation practice, and preserves its severity ruling.
Delete the F96 prose-proximity status-claim matcher rather than tune its false positives.

**Why / tradeoff.** Snapshot regeneration removes manual ledger churn and its corruption risk.
It loses per-entry diagnoses and can conceal a narrowed matcher; snapshot diffs and policy-change
audits were the chosen mitigation. Class collapse retained the failure mode; an advisory-only
sweep was rejected at this stage. Operator approved the composed snapshot/single-sided option
on 2026-08-27 in task 0691 R2.

**Later policy:** ADR-093 limited pass waivers; ADR-092 narrowed sweep scope; ADR-108 removed
accepted-debt snapshots and made unsuppressed audits explicit. This entry's snapshot mechanism
is historical, not current policy.

**Detail:** [essential workflow checks](design/essential-workflow-checks.md); ADR-108.

## ADR-091: The CLI `--json` Surface Adopts the Contracts Envelope Behind an Opt-In `--json-envelope` Flag

**Status:** Accepted · **Date:** 2026-08-27 · **Task:** 0693 · **Feature:** F95

**Decision.** Adopt the existing contracts envelope through one opt-in --json-envelope seam;
the flag takes precedence over SPUR_JSON_ENVELOPE=1. Keep the raw default during migration and
preserve command payloads, exit codes and human output. CLI-local error codes map to INTERNAL_ERROR
with details.cliCode; no new shared error code without a demonstrated consumer.

**Why / tradeoff.** One existing wire contract removes divergent CLI envelopes. Opt-in adoption
avoids an immediate breaking change but temporarily retains two output modes. Immediate default
replacement, a CLI-local envelope, the different ts-utils envelope and per-call-site wrapping
were rejected. Artifact-backed raw outputs keep their documented exceptions.

**Approval provenance:** operator approval recorded 2026-08-27 in task 0693 R3/Q&A.
Default flipping remains separate work after a documented migration window.

**Amendment 2026-08-27 (task 0697) — the envelope seam moves to packages/app.** Share the helpers
from the application layer and re-export them through CLI output. Service emitters cannot import
the CLI without creating a cycle. Contracts remain DTO-only; duplicating helpers or adding a new
package would introduce another owner. The raw default and public options remain unchanged.

**Detail:** [data/output contracts](design/data-output-contracts.md), 04 §4.1.

## ADR-092: The Corpus Sweep Scopes to Open Work — Archived Folders Are Read-Only History

**Status:** Accepted · **Date:** 2026-08-28 · **Task:** 0700 · **Amends:** ADR-062 §1, ADR-050

**Decision.** Explicit corpus audits derive findings from the active task folder only, including
its freshly terminal records. Archived folders remain resolvable for identity, feature and
dependency references but are not re-derived as findings. No check or severity changes here.

**Why / tradeoff.** Archived closed work dominated recurring findings without an active repair
consumer. Folder scope reduces that burden while retaining checks on newly completed records;
archival evidence remains readable rather than continuously re-audited.

**Later policy:** ADR-108 retires the snapshot/waiver mechanism and preserves explicit,
unsuppressed audits. Ordinary changes check affected records.

**Detail:** [essential workflow checks](design/essential-workflow-checks.md); ADR-062/108.

## ADR-093: Gate-Waiver Baselines Are Temporary Debt Registers

**Status:** Accepted (design) · **Date:** 2026-08-29

**Decision.** A committed baseline that changes a current gate result from FAIL to PASS may waive
only pre-existing findings and only temporarily. It must name its bounded scope, owner, review date,
and objective remediation or removal condition; new findings fail closed, and regeneration cannot
silently roll waivers forward. Reference snapshots that only detect drift or measure regressions are
not waivers.

**Why.** A permanent or self-renewing waiver silently redefines failure as success and destroys the
sensor's value.

**Detail:** `03 §23`; ADR-058 (temporary compatibility manifest). ADR-108 retired the corpus
snapshot application; this entry does not authorize recreating it.

## ADR-094: Constrained Agent Stages Require Host-Enforced Capability Attestation

**Status:** Accepted (design) · **Date:** 2026-08-29

**Decision.** Spur continues to delegate sandbox enforcement to installed agents, but a constrained
stage must declare required filesystem, network, process, and external-mutation capabilities; the
resolved executor must attest host enforcement before dispatch, and unknown or unavailable is a
hard refusal.

**Why.** Delegating sandbox ownership does not prove that a selected executor enforces the stage's
constraints.

**Detail:** `03 §24`; task 0706; ADR-012.

**Clarification (task 0754).** ADR-102 refines capability-attestation enforcement; it does not supersede the host-enforcement principle.

## ADR-095: Runtime Budgets Use Measured Usage; Unknown Is Never Zero

**Status:** Accepted (design) · **Date:** 2026-08-29

**Decision.** Agent actions may declare wall-clock, token, and cost limits; Spur enforces them from
typed measured usage at supported safe boundaries and fails a required but unmeasurable budget.
Offline pipeline baselines remain regression sensors, not runtime limits.

**Why.** Retrospective totals and nullable baselines cannot bound an active autonomous run.

**Detail:** `03 §24`; task 0707; ADR-060/076.

## ADR-096: Safety Trip Wires Reuse Existing Fail-Closed Workflow Boundaries

**Status:** Accepted (design) · **Date:** 2026-08-29

**Decision.** A closed deterministic catalog maps retry exhaustion, budget or capability failure,
proof invalidation, and bounded-output overflow to existing workflow failure transitions and bounded
events at safe boundaries; no model judge, policy DSL, or second controller participates.

**Why.** Operational signals are useful controls only when they deterministically stop unsafe
continuation.

**Detail:** `03 §24`; task 0708; ADR-035/056.

## ADR-097: Review and Verification Are Context-Independent by Construction

**Status:** Accepted (design) · **Date:** 2026-08-29

**Decision.** Built-in review and final verification run in fresh sessions with recorded executor
provenance; P0/P1 work also requires an executor distinct from implementation, failing closed when
no eligible independent executor exists.

**Why.** A nominal reviewer that inherits implementation context can repeat the same assumptions
instead of independently testing them.

**Detail:** `03 §24`; task 0710; ADR-026/047.

## ADR-098: Escalation Packets Project Existing Evidence

**Status:** Accepted (design) · **Date:** 2026-08-29

**Decision.** A blocked or failed run emits one versioned, bounded, redacted JSON escalation packet
that references existing task, run, proof, artifact, budget, capability, and event evidence and
states the exact operator decision required; it copies no logs and adds no persistence plane.

**Why.** Evidence already exists, but fragmented evidence is not an actionable handoff.

**Detail:** `03 §24`; task 0709; ADR-044/056.

**Clarification (task 0754).** Dry-run probes do not emit escalation packets.

## ADR-099: Checkpoints and Indexed Context Are Freshness-Bound Derived State

**Status:** Accepted (design) · **Date:** 2026-08-29

**Decision.** Checkpoints and indexed-context artifacts carry schema, owner, source commit/digest,
time, state, next action, and artifact references; resume validates freshness, and cleanup removes
only expired, unreferenced, regenerable state within its confined owner path.

**Why.** Derived memory without freshness and retention rules becomes a stale competing authority.

**Detail:** `03 §24`; task 0711; ADR-044/079.

**Clarification (task 0754).** Freshness is checked again at resume against version and definition changes.

## ADR-100: Verified-Outcome Metrics Require Digest-Bound PASS Evidence

**Status:** Accepted (design) · **Date:** 2026-08-29

**Decision.** A verified result is a done task with a PASS verdict bound to the final proof digest;
force-done, synthetic, missing, mismatched, or invalidated verdicts do not count. Correction and cost
metrics derive from existing records and report missing attribution as null with coverage.

**Why.** Activity and token volume do not measure harness reliability; verified outcomes do.

**Detail:** `03 §24`; task 0712; ADR-071.

**Clarification (task 0754).** Completion requires the certifying run’s current proof binding; missing or stale binding is refused.

## ADR-101: History Refresh Uses Process Isolation and Database Single-Flight

**Status:** Accepted · **Date:** 2026-08-29

**Decision.** Every queued history refresh runs the existing `spur history daily` pipeline in a
child process, and one database constraint admits at most one pending-or-processing
`history.refresh` job per project.

**Why.** The existing CLI and queue seams provide event-loop isolation and cross-process exclusion
without adding another worker runtime or coordination plane.

**Detail:** `03 §7`; `docs/design/history-refresh-process-isolation.md`; feature E31.

## ADR-102: Constrained Agent Stages Attest Executor Capabilities Before Spawn

**Status:** Accepted (design) · **Date:** 2026-08-29

**Decision.** Workflow `agent.run` stages may declare `requiresCapabilities` (closed axis vocabulary
`fsRead|fsWrite|networkEgress|processSpawn|externalMutationApproval`; levels `available|enforced`),
and executors attest `executionCapabilities` in agent config. Dispatch resolves the target executor
and compares requirements against the attestation BEFORE spawning, re-checking on each escalation
hop; an unsatisfied or unknown/unattested axis fails closed (exit 2) with an axis-by-axis
diagnostic. Routing attribution records a bounded, redacted per-axis evidence payload.

**Why.** Unattended high-risk stages (e.g. `implement`/`test-fix` under the auto profile) mutate the
working tree and spawn processes; dispatching them to an executor whose sandboxing is unknown or
too weak risks unbounded mutation. Tier alone is not a capability signal (R8). Missing data resolves
to `unknown`, never permissive.

**Detail:** task 0706; `04 Design §agent-capability-attestation`.

## ADR-103: History Rollups Refresh Incrementally by Bucket Under a Refresh Watermark

**Status:** Accepted (design) · **Date:** 2026-09-03

**Decision.** Incrementally refresh rollups from an imported-at watermark by atomically
rederiving touched buckets. Track per-table watermark/range/definition version separately from
turn completeness. Persist tool identity on fact rows and avoid read-path full-table aggregation;
the History transport contract stays unchanged.

**Why / tradeoff.** Refresh cost should follow imported delta rather than corpus size. Correct
bucket replacement requires explicit progress/version metadata instead of a full rebuild.

**Detail:** [incremental materialization](design/history-incremental-materialization.md); ADR-101.

## ADR-104: The History Schema Has One DDL Authority — Spur's Migration Ledger

**Status:** Accepted (design) · **Date:** 2026-09-03

**Decision.** Within Spur, its migration ledger is the single DDL authority and ordering.
Importer SQL remains usable standalone but enters Spur only as a versioned migration step.
Keep core facts, raw landing tables and derived marts distinct.

**Why / tradeoff.** Split DDL execution lets released importer changes diverge from existing
databases. A single ledger requires coordinated migration adoption instead of implicit upstream DDL.

**Detail:** [incremental materialization](design/history-incremental-materialization.md) §9; ADR-103.

## ADR-105: History Schema Ownership Splits on Three Axes — Table, Column, Index

**Status:** Accepted (design) · **Date:** 2026-09-03

**Decision.** Assign history schema ownership by element: table DDL to its owning layer,
fact columns to the value producer, and indexes to the query consumer. Keep the existing packages.

**Why / tradeoff.** Producer facts and consumer indexes need different knowledge; a single
table-owner rule misplaces one of them. The split requires an enforced schema compatibility contract.

**Detail:** [incremental materialization](design/history-incremental-materialization.md); ADR-104/103.

## ADR-106: History Aggregates Store One Additive Measure Vector and No Derived Ratios

**Status:** Accepted (design) · **Date:** 2026-09-03

**Decision.** KPI aggregates store a shared additive measure vector: counts, token sums,
duration sums and duration samples. Derive ratios/means on read, retain denominators and keep
attributed measures distinct. Cache reads and writes remain separate measures; writes are not
cache hits. Do not change the transport contract.

**Why / tradeoff.** Additive values compose across buckets; stored ratios do not. Read projections
must compute derived metrics consistently from the retained sums and sample counts.

**Detail:** [incremental materialization](design/history-incremental-materialization.md) §12.

## ADR-107: Proportional Workflow Routing on Surrounding Pilots

**Status:** Accepted · **Date:** 2026-09-04 · **Feature:** D9 · **Task:** 0758

**Decision.** Workflow proportional routing uses a closed route table with mutually exhaustive predicates:
missing, unknown, or conflicting evidence always selects the safety path (default); complete and
consistent evidence selects the fast path. The immutable safety floor (proof-bracket guards,
budget fail-closed dispatch, reviewer/executor independence, run-id confinement) holds on every
route, including the fast path. Every route writes a bounded machine-readable reason to
`.spur/run/<runId>-route-reason.txt` and appends to `.spur/memory/<workflow>-routes.log`. Routing is
isolated per workflow definition, independently revertable, and exercises identical routes
across unversioned and versioned definition forms.

**Why.** Proportional routing allows bounded tasks to avoid unnecessary model or verification
overhead without compromising the deterministic safety floor. Piloting on `wrapup-pipeline` and
`task-lifecycle` proves the closed route table on real callers before migrating `task-pipeline`.

**Detail:** `config/proportional-route-table.ts`; `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §4; task 0758.

**Amendment (2026-09-04 — D9 Option B closure, task 0764).** The failed re-measure selects the
feature's complete Option B branch: `task-lifecycle` proportional routing is reverted because its
one-edge-per-pair transition API made the pilot unsafe; the wrapup route table and task-pipeline
migration remain installed but unreachable by default. A workflow's fast path may be activated only
after a source-local re-measure shows at least five real terminal runs and at least 80%
`mappedRuns / terminalRuns` coverage for that workflow. Activation-dependent real-run evidence is
not applicable while Option B holds; the failed measurement remains recorded rather than forced
green.

**Why.** The frozen coverage bar failed, so safety requires closure without manufacturing fast-path
runs solely to satisfy the rollout branch.

**Detail:** feature D9 `## Notes`; tasks 0757–0759 and 0764.

## ADR-108: Essential Workflow Gates and Explicit Corpus Audits

**Status:** Accepted · **Date:** 2026-09-05 · **Feature:** D61

**Decision.** Preserve essential integrity/evidence checks at affected write/completion
boundaries. Make corpus checks explicit audits; retire accepted-debt snapshots, regenerators and
exact composition mirrors. Keep plan/version/progress behavior in existing owners.

**Why.** Behavioral evidence and truthful progress are more useful than repeated document sweeps
and self-maintaining acceptance snapshots.

**Migration:** supersedes routine sweep/snapshot policies in ADR-050/062/090/092, their ADR-093
waiver application and the exact-mirroring portion of ADR-069. ADR-107's safety closure and
activation evidence bar remain unchanged.

**Correction (2026-09-06, operator clarification).** Removing the opt-in audit was an incorrect
implementation, not the accepted decision. Retain visible, unsuppressed audits; ordinary task
and wrap-up gates check affected inputs. No replacement snapshot or policy DSL.

**Detail:** [essential workflow checks](design/essential-workflow-checks.md).

## Amendments (task 0754, D8 Decision 8 closure)

Historical implementation sweep; delivery evidence remains in task 0754. The architectural
clarifications are retained with ADR-094/098/099/100/102; retired baseline receipts have no
current policy authority. This heading remains for existing references.

## ADR-109: Task Creation Prepares Specifications by Default

- **Status:** Accepted · **Date:** 2026-09-06 · **Feature:** F21 · **Amends:** ADR-020
- **Decision:** Default task CLI creation invokes the existing ready-preparation competency, with an explicit capture opt-out. Shared task writers remain deterministic; host planning prepares content inline and avoids a second model pass. Structural validity, specification readiness and execution prerequisites remain distinct.
- **Why:** A newly created task should not require a separate manual refinement action, and shared writers must not acquire hidden agent execution.
- **Detail:** `03 §12.4`; [task creation surface](design/task-creation-readiness.md).

## ADR-110: System-Event Ingestion Is Catalog-Open, Presentation Stays Cataloged

- **Status:** Accepted (design) · **Date:** 2026-09-07 · **Feature:** J31
- **Decision:** Both `system_events` persistence paths (server tap, CLI emitter) persist every emitted event name, synthesizing a generic catalog entry for names absent from `BASE_CATALOG` (derived prefix, generic renderer, default tier, standard redaction, per-prefix quota bound at the persist site (the resolver enumerates catalog prefixes only)). The catalog stops being an ingestion gate and remains the presentation/promotion layer: cataloged names keep their presenters, tiers, and payload policies.
- **Why:** Catalog-closed ingestion silently drops any event nobody registered — including upstream ts-libs emissions (e.g. ts-infra `db.*`) and future drift — making the observability board incomplete by construction. The ts-infra EventBus has no wildcard subscription, so the catch-all intercepts at the emit seam (idempotent `emit` wrap at the tap/ledger attach points) rather than subscribing.
- **Detail:** [observabilities module polish](design/observabilities-module-polish.md). Accepted limitation: uncataloged events are history-visible on refresh, not live-streamed, until ts-infra grows an `onAny`/wildcard seam (upstream follow-up).

## ADR-111: Quota-Driven Config Updates Survive Event-History Retention

**Status:** Accepted · **Date:** 2026-09-07 · **Feature:** B5

**Decision.** Deliver quota-driven executor configuration updates through a durable latest-observation
record per project/executor; retain YAML as the execution-availability authority.

**Why.** A prunable observability ledger cannot guarantee delivery of a pending configuration update.

**Detail:** [executor availability](design/executor-availability.md); `03 §25`.

## ADR-112: Execution Deadlines Are Upstream Policy; Unlimited Jobs Retain Renewable Ownership

**Status:** Accepted (design) · **Date:** 2026-09-08 · **Feature:** A21

**Decision.** Scheduler and queue execution limits share an upstream `ts-infra` contract; process-tree
termination stays in `ts-runtime` and cooperative import cancellation stays in the importer. Spur
supplies application defaults and compatibility translation. Omission inherits, explicit `null`
disables the execution deadline, and positive integers bound it. Queue ownership expires independently
of execution duration and is renewed/fenced per attempt; cancellation settlement precedes retry.

**Why.** Shared cancellation and ownership semantics benefit all consumers and prevent unlimited
execution from becoming duplicate execution after a visibility interval. This binds scheduler,
history, and queue persistence consumers while preserving ADR-004's published-package boundary.

**Detail:** `03 §26`; [execution deadline design](design/execution-deadlines.md).
