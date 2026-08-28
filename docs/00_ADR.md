---
doc: 00_ADR
owns: WHY — cross-cutting decisions, one-line reasons
authority: authoritative
version: 1.32.0
owner: Robin Min
updated_at: 2026-08-27
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

> **Amendment (task 0348, applied with task 0536).** Stage-registry `model_policy` is a *default
> seed*, overridable per-stage via config (deep-replace). The routing key stays `stage_id`; the
> registry is demoted from sole source to default, not removed.
>
> **Amendment (task 0536).** Prompt-regex phase detection (`extractPhase`) is **retired** — the
> prompt text never derives a stage. The stage door is the explicit `--stage` flag; undeclared
> callers land on the default role visibly. `--agent` is redefined as the **role selector**
> (`scribe`·cheap / `coder`·standard / `reviewer`·capable-1 / `planner`·capable-2, the Layer-1
> vocabulary in `plugins/sp/references/roles.md`, task 0535): a role picks the *starting* tier and
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

  **Amendment (2026-08-16):** Consent granted for the task 0575 authoring-time size warning — a
  behavior-only surface change (new stderr line + `warnings[]` entry on `spur task update --section
  Requirements|Plan`; no noun, verb, or flag added; code confined to `packages/app`). Confirms the
  consent gate covers observable output changes of existing verbs, not just noun/verb additions; the
  granted application supersedes the earlier 2026-08-16 parked status. **Detail:** `04 §7.1`.

  **Amendment (2026-08-20, feature A3 / task 0613):** Extends the two-surface rule to the complete
  four-surface script placement table and records this feature's operator consent in one place.

  - **R4 — four-surface placement table.** A new script lands on exactly one of four surfaces,
    selected by a single condition:

    | Surface | Hosts | Selection condition |
    | --- | --- | --- |
    | `apps/cli/src/commands` | public `spur` verbs | a Spur **end user** runs it on any Spur-managed project — and each addition needs the consent gate below |
    | `scripts/commands` | internal spur-dev commands | **Spur self-dev only** — packaging/release, building Spur, monorepo gates (one module per command, `bundle-*`-style naming, test sibling) |
    | `package.json` scripts | repo-wide developer entrypoints | a **repo developer** invokes it by name (`bun run …`); it composes existing binaries, adds no logic, and its name is the contract |
    | `plugins/sp/scripts` | plugin-shipped scripts | the action must run on **agent machines that only have the plugin**, not the monorepo — entrypoint contract owned by **ADR-065** (`.mjs` twins, declaration, no repo-relative paths), cross-referenced, not restated |

  - **R5 — consent record (feature A3).** Operator consent is granted for the feature's six
    public-surface changes: the `spur self` noun (aggregating legacy standalone verbs, 0616), the
    `spur builder` noun (spur-dev `bump-ver` / `drop-tags` promotion, 0617), `--fix` on
    `spur task check` and `spur feature check` (0619), `spur workflow show` (mermaid FSM render,
    0620), the `spur agent doctor` AUTH-column removal (0621), and the `workflow validate`
    composition advisory output (0614, advisory-only per ADR-069 R3). Design context: the feature
    intent (surface governance) and the A3 batch review of 2026-08-20; each landing task cites this
    record instead of re-litigating the gate. **Operational view:**
    `docs/design/harness-surface-governance.md`.

  **Amendment (2026-08-21, task 0625):** Consent granted to make `spur feature refresh` scope
  explicit: `--feature <id>` rewrites one feature, the new `--all` flag opts into the full sweep,
  and a bare invocation refuses with exit 2. The explicit broad-write token prevents a scoped
  lifecycle run from silently rewriting unrelated feature rosters. **Detail:**
  `docs/design/harness-surface-governance.md` §4 and
  `docs/design/lifecycle-projection-integrity.md`.

  **Amendment (2026-08-26, feature B4 / task 0683):** Consent granted for two flags on the existing
  `spur agent doctor` verb — `--probe-health` (opt into model health probing; without it no model
  health request is issued) and `--force-refresh` (bypass the 60 s detection cache at
  `.spur/run/agent-doctor.json`, re-run detection, rewrite the file). Both are flag expansions of an
  existing verb, not a new noun or verb, and both change observable output of an existing verb — the
  class the 2026-08-16 amendment brought under this gate. Consent was given by the operator in the B4
  planning session of 2026-08-26 and is recorded here so landing tasks cite the record rather than
  re-litigating the gate. **Detail:** `docs/design/agent-doctor-inspection-surface.md` §5.1–§5.2;
  surface shape in `docs/04_DESIGN.md` § `spur agent doctor`.

  **Amendment (2026-08-27, feature D7 / task 0695):** Consent granted for two options on the
  existing `spur workflow show` verb — `--format <mermaid|todo>` (mermaid stays default; `todo`
  renders a declared-step checklist projection) and `--json` (machine envelope for both formats).
  Both are option expansions of an existing read-only verb, not a new noun or verb. Consent was
  given at the D7 idea-evaluation gate, which also rejected the alternative shapes: a boolean
  `--todo` flag and a separate `spur workflow todo` verb (flag-not-action), and output caching.
  **Detail:** `docs/design/harness-surface-governance.md` §4; surface shape in `docs/04_DESIGN.md`
  § `spur workflow show`.

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

- **Status:** Accepted · **Date:** 2026-08-12 · **Feature:** J5
- **Decision:** Keep upstream `@gobing-ai/ts-*` event maps domain-local; Spur wraps cataloged events
  at its shared tap/emitter boundary in a versioned actionable envelope carrying project, producer,
  correlation, presentation, and bounded redacted data. Existing trace JSON contracts may gain
  optional context fields but retain every existing field and meaning.
- **Why:** One Spur-owned projection makes every Board and CLI consumer consistent without coupling
  the generic upstream EventBus or duplicating policy across emit sites.
- **Detail:** `03 §16`; `docs/design/actionable-observability-context.md`; feature J5.

> **Amendment (2026-08-15).** Built: the J5 envelope foundation (0526), routing attribution (0545),
> and the role/token aggregates (0546/0547) all shipped; the Board render (0552) is the terminal
> consumer. Status moves from `Accepted (design)` to `Accepted`. Shapes: `04 §7.9`; mechanism:
> `03 §16` / `03 §7`.

## ADR-057: Inter-Agent Coordination Is a Runtime-Mediated Control Plane

**Status:** Accepted (waves 1–2 shipped) · **Date:** 2026-08-12 · **Feature:** G4

**Decision.** Coding agents coordinate only through Spur’s two existing channels — durable `spur message` / `inbox_messages`, and the supervised process pipe. There is no third IPC transport, no agent-to-agent socket, no terminal scrape, and no keystroke injection. The Board is a client, not a wait or command authority. New verbs stay on `agent` / `message` (ADR-051).

**Why.** Copying multiplexer I/O would collapse ADR-052’s two planes and fight a harness that does not own PTYs.

**Detail:** `03 §17`; `docs/design/inter-agent-control-plane.md`; feature G4. Complements ADR-052 (does not change Board composition).

**Amendment (2026-08-13).** Wave 1 (occupant pin, coordination-facing run row, caller env) shipped. Wave 2 (identity-pinned `agent wait`, atomic `message send --wait`, lifecycle projector) shipped with 0530. Wave 3 (snapshot-then-follow, first-class `blocked`) remains accepted design.

**Detail:** tasks 0529/0530; `03 §17`; `docs/design/inter-agent-control-plane.md`.

**Amendment (2026-08-13, 0531).** Wave 3 snapshot-then-follow shipped: `followSystemEventsAfter` over the existing `system_events` ledger (global monotonic `sequence` auto-assigned at persist; `idx_system_events_sequence`). First-class `blocked` / optional `agent report-state` remain accepted design.

**Detail:** task 0531; `03 §17`; `docs/design/inter-agent-control-plane.md` §8.

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

**Status:** Accepted · **Date:** 2026-08-16 · **Feature:** B3

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

**Decision.** Four changes to the task-corpus gates, landing in dependency order:

1. **The corpus sweep covers every configured task folder**, not just the active one. The
   backlog it exposes (404 errors across 180 `done` tasks in `docs/tasks{,2,3}`) is reconciled
   into `config/corpus-baseline.json` in the same commit, per constitution T10.
2. **The two-sided ratchet extends to warning severity.** A warning outside the baseline fails
   the gate, and a baseline entry that no longer reproduces fails it too — the same
   cannot-rot property errors already have (ADR-050) and tracked shims already have (ADR-058).
   **One key, one entry.** Reconciliation is key-addressed, so a second entry for a
   `<kind>:<id>:<code>` key is unreachable: it can never be matched or reported stale on its
   own, and the extras silently over-cover. A key emitting 33 findings that later emits 1 would
   still reconcile clean, so the ratchet would see only total disappearance, never a partial
   reduction. A duplicated key fails the gate outright. (Added 2026-08-17 during 0582's verify:
   the first generated warning baseline held 2,541 entries over 903 keys and reintroduced exactly
   the rot this ADR exists to end.)
3. **An evidence anchor must name its requirement's subject, not merely resolve.** Existence +
   line bounds stop being sufficient. Ships as a warning; promotes to error once the
   qualification migration (below) has landed.
4. **Two notations replace one.** Evidence inside this repository is cited as a repo-relative
   backtick `path:line` anchor; evidence outside it (external package sources, gitignored
   `.spur/run/**` artifacts) is cited in a documented external form the checker recognizes as
   external instead of scoring it a stale repo-root anchor. A `spur task migrate` rule
   qualifies the 810 historical anchors whose basename resolves to exactly one repository path;
   the 178 ambiguous ones are left to authors.

**Also:** DD-09's subset rule applies only to tasks that graduate their feature's scenarios. A
task whose acceptance criteria sit at a finer altitude than the feature's ship contract declares
that altitude rather than being held to a rule it cannot satisfy.

**Why.** The anchor gate's own source called content matching "an agent re-verify
responsibility" — so the gate passed the dangerous case (an anchor drifted onto unrelated code,
which reads as verified) and flagged only the harmless one (a path that fails to resolve). The
2026-08-17 E5 re-audit found 18 such anchors across tasks 0553/0554/0555 while `spur task check`
reported zero warnings on all three. That was survivable only because warnings had no ratchet
and 84% of the corpus sat outside the error gate: 2,291 warnings and 404 ungated errors had
accumulated against a 2-entry baseline. A gate nobody must reconcile is not a gate, and a
citation form with no legal spelling for a third of its use cases guarantees the noise that
hides the real findings.

**Detail:** `packages/app/src/services/corpus-check.ts` (sweep scope, warning ratchet);
`packages/app/src/services/task-check.ts` (`checkLineAnchors` subject matching, external form);
`packages/domain/src/bdd/coverage.ts` (DD-09 altitude); `04 §7.1`; feature F91.

## ADR-063: A New Top-Level Feature Node Requires Operator Consent

**Status:** Accepted · **Date:** 2026-08-17 · **Complements:** ADR-051 · **Feature:** F91

**Decision.** Feature IDs encode position (DD-14), so the single-letter root set is the project's
coarsest and most durable map. Adding a letter to it is a structural claim about the shape of the
product, not a filing convenience:

1. **Nesting is the default.** New work is filed under the existing feature that already owns its
   primary object — the module, surface, or contract the work changes. An agent must name that
   owner, or state why no feature owns the object, before proposing a root node.
2. **A new top-level node requires explicit operator consent**, requested with the candidate
   parents that were considered and the reason each was rejected. This mirrors ADR-051's rule for
   CLI nouns: the first layer is a small, stable vocabulary, and a new entry is justified only when
   no existing entry can host the work.
3. **The DD-14 nine-children cap is never a reason to add a root letter.** A full parent means
   "nest one level deeper" or "you picked the wrong parent" — not "start a new tree". Reading the
   cap as permission to go to the root inverts it: the cap exists to keep the tree legible, and
   root sprawl is the exact illegibility it prevents.
4. **Relocation is cheap; do not tolerate a bad placement.** `spur feature move <id> --parent <id>`
   cascade-renames the node and its descendants and rewrites every task `feature_id` edge, with
   `--dry-run` to preview. A misplaced feature is a two-command fix, so there is no cost argument
   for leaving one where it landed.

**Why.** On 2026-08-17 an agent created top-level feature `L` for corpus-gate-integrity work,
reasoning that `F` (Planning) already held nine children and both semantically-adjacent parents
(`F2` task-management CLI, `F6` corpus migration) were near-terminal. Every step of that was
locally defensible and the conclusion was still wrong: `F9` — "make each task's Acceptance Criteria
verifiable at the code level, and make the four-layer validation gate's severities tunable" —
already owned `checkAcCoverage`, the stable finding codes, and the severity-override map, which are
precisely the objects the new work changes. The feature was relocated to `F91`. The failure was not
bad judgment about `F`; it was treating a root-node addition as a placement decision an agent makes
alone, when it is the one placement decision that is effectively permanent.

**Detail:** DD-14 ID rules and `spur feature move` in `04 §7.2`; ADR-051 noun discipline as the
parallel rule for the CLI surface.

## ADR-064: Pin the Implement Executor Per-Hop via `implementAgent`

**Status:** Accepted (design) · **Date:** 2026-08-18 · **Feature:** H1

**Decision.** Model-hop wall-clock is the long pole of a `task-pipeline.yaml` task run — measured at
91–97% of pipeline wall-clock across 3 real runs (task 0588, source artifacts
`.spur/run/08d76749*/` `7831bfc8*/` `97e7a2a6*/`), with implement the dominant single hop
(12–28 min, 40–95% of its 30-min budget). The practical latency lever is **pinning a faster
executor/model for the implement hop through the existing `implementAgent` per-hop pin**
(`config/workflows/task-pipeline.yaml:65`), not raising the `stepTimeoutMs`/`implementTimeoutMs`
budgets and not narrowing the deterministic gate.

**Why.** The 30-min timeouts are headroom, not measured latency — setting them higher without
measurement is how they grew from 600s. The measured bottleneck is inside the implement hop's
generation loop, so the lever belongs on the hop's executor, not on the budget or the gate.

**Constraints (binding).** (1) Keep the size↔capability gate (task 0487 R3) authoritative: a pinned
executor below the `reviewer`-role floor must never receive an oversized task — the pin is a
per-task choice, not a blanket downgrade. (2) Confirm on a same-task A/B (default `omp` →
`zai/glm-5.2` vs the pinned executor) before adopting; option (ii) narrow-hop-scope is rejected as
optimizing a non-bottleneck; option (iii) review∥verify parallelization is deferred as a real FSM
change with structurally-dependent hops.

**Detail:** task 0588 `### Design` (full evidence table + attribution + option matrix);
`config/workflows/task-pipeline.yaml:65` (`implementAgent`), `:269` (implement `agent.run`
`agent: ${vars.implementAgent}`).

## ADR-065: Align plugins/sp Scripts to the Superskill Entrypoint Contract

**Status:** Accepted · **Date:** 2026-08-19 · **Feature:** I

**Decision.** All scripts in `plugins/sp/scripts/` follow an explicit two-category contract recorded in
`config/plugin-scripts.json`:

1. **Standard shipping scripts (7):** `batch-preflight.ts`, `feature-sync-bounded.ts`,
   `history-load.ts`, `pr-reviewing.ts`, `daily-summary/daily-summary.ts`,
   `dogfood-testing/detect-pipeline-driving.ts`, `dogfood-testing/validate-report.ts`.
   - Each carries no Bun-specific globals (`Bun.argv` → `process.argv.slice(2)`, `Bun.file` → `node:fs`,
     `Bun.spawn`/`Bun.spawnSync` → `node:child_process`).
   - Each carries a committed, portable `.mjs` twin generated via `superskill script convert sp <rel>`,
     executable under bare `node` on any install target (Claude Code, Codex, Pi, OpenCode, Antigravity, Hermes, Grok).
   - All shipped surfaces (`plugins/sp/{commands,skills,agents}`, `README.md`) invoke these scripts exclusively
     via the canonical substitution `node "$(superskill script path sp <rel>.mjs)" <args>`.
   - The repo-relative form `bun plugins/sp/scripts/<rel>` is forbidden across all shipped surfaces.
2. **Repo-only scripts (8):** `task-size-precheck.ts`, `transition-shim-check.ts`,
   `script-contract-check.ts`, `validate-commands.ts`, `validate-flag-contracts.ts`,
   `surface-drift-inventory.ts`, `stage-registry-adapter.ts`, `daily-summary/logger.ts`.
   - Remain on `bun`, never generate `.mjs` twins, and are invoked only in monorepo workflows and quality gates.
   - `task-size-precheck.ts` is guarded in `task-pipeline.yaml` so seeded external projects without `plugins/sp`
     degrade cleanly with a skip notice rather than failing.
3. **Continuous mechanical enforcement:** `bun run script-contract-check` runs in `spur-check` (third,
   after `transition-shim-check` and before `lint`). The check is two-sided: missing/stale twins, unexpected twins
   on repo-only scripts, unlisted disk scripts, and forbidden `bun plugins/sp/scripts/` references all fail the gate.
4. **Build integration:** `npm run build:scripts` regenerates all twins and is chained into `npm run build`.

**Authority.** Superskill ADR-015 (plugin script layout) and ADR-022 (script entrypoint staging & version coupling)
define the upstream standard contract.

**Detail:** task 0600; `config/plugin-scripts.json`; `plugins/sp/scripts/script-contract-check.ts`.

**Amendment (2026-08-24).** The standard-shipping roster above grows from 7 to 8: add
`history-anatomy-cache.ts` — the deterministic cache helper for the history-anatomy report
(HA-S1 0659). It is a `standard` contract with a committed `history-anatomy-cache.mjs` twin,
declared in `config/plugin-scripts.json`, and appended to `package.json` `build:scripts`. Task
0661 amends the same entry for the `history-load.ts` removal; if both land in one commit, a single
amendment block covers both.

**Amendment (2026-08-24, second).** The standard-shipping roster drops from 8 to 7: remove
`history-load.ts` (and its twin) — the on-demand load+analyze plugin script deleted with
the `/sp:dev-history-load` command (HA-S1 0661). Its two supported import owners (`load-history`
in `package.json`, the History UI Import & Analyze path) were verified independent of the plugin
script and are preserved. `config/plugin-scripts.json` and `package.json` `build:scripts` no
longer name it. (0659 added `history-anatomy-cache.ts`; both amendments to this entry land in the
I8 change — see the first amendment.)

## ADR-066: Cataloged System Events Use Exhaustive Server-Side Presenters

**Status:** Accepted (design) · **Date:** 2026-08-19 · **Feature:** J9

**Decision.** Every cataloged System Event resolves through a typed, event-name-keyed server presenter that owns its authored description, retained fields, summary behavior, and explicit outcome derivation or unsupported classification; clients render the canonical result and do not interpret event payloads.

**Why.** One exhaustive event-specific authority prevents source-family defaults and client switches from drifting across persistence, SSE, history, table, and tooltip views.

**Detail:** `03 §16.1`; `docs/design/event-tracking.md` §11; `docs/design/actionable-observability-context.md` §System Event semantic presentation.

## ADR-067: Stored Event Facts Are Stable; Derived Presentation Reprojects on Read

**Status:** Accepted (design) · **Date:** 2026-08-19 · **Amends:** ADR-056 · **Feature:** J9

**Decision.** A valid stored canonical v2 System Event keeps its persisted `data` and `context` unchanged, while history reads recompute only `presentation` through the current catalog presenter; no ledger row is rewritten.

**Why.** Stored facts are evidence, while summary, description, fields, outcome, and action are view policy that can improve without mutating that evidence.

**Detail:** `03 §16.1`; `docs/design/actionable-observability-context.md` §Projection paths.

## ADR-068: Missing Event Semantics Are Captured at the Producing Boundary

**Status:** Accepted (design) · **Date:** 2026-08-19 · **Feature:** J9

**Decision.** Facts absent from bounded event data are added where they are known: planning mutations emit their section locus, workflow composition emits workflow and step identity, and the upstream queue-consumer contract emits its configured queue name; presenters and clients never infer or backfill absent facts.

**Why.** Reconstructing identity or outcome from unrelated configuration, job types, or event names would turn diagnostic presentation into a guess.

**Detail:** `03 §16.1`; `docs/design/event-tracking.md` §§6–7/11.

## ADR-069: Workflow YAML Orchestrates Owned Capabilities

**Status:** Accepted · **Date:** 2026-08-19 · **Feature:** D5

**Decision.** Workflow YAML selects and orders capabilities; reusable deterministic behavior lives
in its owning application/CLI module or a capability-specific built-in, workflow extensions own
only local policy, and `agent.run` remains the judgment boundary.

**Why.** Extending proven seams keeps one behavior owner without inventing a generalized workflow DSL.

**Detail:** `03 §20`; `docs/design/workflow-composition-contract.md`.

**Amendment (2026-08-20, feature A3 / task 0613):** Adds the detectable composition measures and
the advisory-only posture the principle previously lacked.

- **R1 — shell composition measure.** The unit is the non-comment shell line (split on newline and
  `;`) of a `shell` action's `command`. A program reported above the threshold is
  to-be-enhanced, and the recommended fixes are drawn **only** from the five owner options already
  recorded in `docs/design/workflow-shell-ownership.md` (public verb / application service /
  least-privilege built-in / external extension / stays-shell exception) — no new vocabulary. The
  threshold number is deliberately **not frozen here**: measured on this tree, all 58 classified
  shell programs join a recorded disposition, and flag rates run >3→30, >4→25, >5→21, >6→18,
  >8→14 of the 58 — `>5` cleanly separates trivial glue (SIMPLE ≤ 2, GLUE
  median 2, never flagged at ≥3) from owned-capability candidates (POLICY 22–32, DUAL 43), and is
  the candidate this tree's evidence supports; the sibling advisory task (0614) freezes the number
  and this ADR records it once it survives contact.
- **R2 — agent.run composition measure.** A **non-slash `input`** is the reporting trigger (per
  ADR-043); raw prompt length sets **severity only**, never triggers a report; the recommended fix
  is to move the operation behind a centralized agent skill or slash command.
- **R3 — advisory posture.** Composition findings never change a `workflow validate` exit status,
  never block a run, and are not added to `spur-check` / `spur-check-new`.

**Operational view:** `docs/design/harness-surface-governance.md`. **Promotion:** Proposed →
Accepted — the decision now carries detectable measures and a fix vocabulary, which is the
acceptance case the Proposed status waited on.

**Amendment (2026-08-21, feature A3 / task 0614):** Threshold frozen at **`>5`** (a program with
≥6 non-comment shell units is flagged). The 2026-08-20 flag-rate table was measured over the 58
pre-migration classified programs; on the live 57 shell actions the raw `>5` flag rate is 25.
Steady state recorded 2026-08-21 across all 10 `config/workflows/*.yaml`: **0 shell findings,
25 suppressed, 8 agent.run findings** — every shell action measuring ≥6 lines carries a recorded
disposition in `config/workflow-composition-baseline.json` (8 workflow entries); the 33
sub-threshold classified programs need no entry. agent.run severity bands are frozen at
<200 low / ≤1000 medium / >1000 chars. The advisory appears in `workflow validate --json` as
`composition {findings[], suppressed}` and on stderr in human mode; it never changes exit status.

## ADR-070: Workflow Progress Reprojects Persisted Execution Truth

**Status:** Proposed · **Date:** 2026-08-19 · **Feature:** D5

**Decision.** Workflow progress is a pure read projection of the resolved definition and existing
persisted run, phase, transition, action, and artifact rows; System Events only wake re-queries, and
bounded polling remains the convergence fallback.

**Why.** One replay authority avoids an event-derived progress store that can disagree after loss or restart.

**Detail:** `03 §21`; `docs/design/workflow-observability.md` §D5 detailed progress projection.

## ADR-071: Mutation After Verification Invalidates the Proof

**Status:** Proposed · **Date:** 2026-08-19 · **Feature:** D5

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

**Status:** Accepted (design) · **Date:** 2026-08-19 · **Feature:** J91

**Decision.** Observability System Events table columns display only human correlators; opaque event ids and remediation commands that embed those ids remain in the tooltip and expanded payload.

**Why.** Operators diagnose from the table; substituting UUIDs and trace commands for workflow, step, and action names hides the facts they need.

**Detail:** `03 §16.2`; `docs/design/system-events-human-table.md`.

## ADR-074: Coding-Agent Identity Is an Optional Presentation Projection

**Status:** Accepted (design) · **Date:** 2026-08-19 · **Feature:** J91

**Decision.** Coding-agent / executor identity is an optional `presentation.agent` string projected by the envelope from bounded payload facts in a fixed order; it is never `context.producer`, never inferred by the Board, and omitted when the event has no executor.

**Why.** Producer names the emitting package; the diagnostic question is which coding agent executed the request, and that fact already exists on agent-bearing payloads.

**Detail:** `03 §16.2`; `docs/design/system-events-human-table.md`.

## ADR-075: Wait and Message Stay Identity-Pinned — No Role Addressing

**Status:** Accepted · **Date:** 2026-08-20 · **Feature:** D6 · **Task:** 0609

**Decision.** `spur agent wait` and `spur message send` keep identity-pinned addressing (spec id /
`--to`), and role addressing is **not** added to either verb. A role names an *executor selection*
for `agent.run`; it is not an addressee for wait or message. This closes the D5 R6 deferral, which
was previously recorded only inside D5's acceptance criteria.

**Why.** The concrete-caller survey (task 0609 R1) found no caller that needs to address a role
rather than a spec id:

- No shipped workflow in `config/workflows/*.yaml` invokes `agent wait` or `message send` at all
  (`grep -rn "agent wait\|message send\|spur message"` → zero matches) — the pipeline surface has
  no wait/message caller of any kind, let alone a role-addressed one.
- The team/coordination surface (`spur team assign|status|up|down|start|stop`,
  `apps/cli/src/commands/team.ts`) takes concrete `<task-id>`, `<agent-id>`, and `<team>` arguments
  throughout — no verb accepts a role as an addressee.
- No CLI command accepts `--role` (`rg '--role' apps/cli/src/commands/*.ts` → zero matches outside
  `agent run`'s action option). The illustrative `--to reviewer` / `agent wait reviewer` examples in
  `plugins/sp/skills/spur-cli/references/{message,agent}.md` are spec ids that happen to share role
  names — the flag tables define them as "Recipient agent id" / "Agent spec id", and the
  implementation (`apps/cli/src/commands/message.ts:29,50`, `agent.ts:96`) treats them as plain
  recipient ids with no role resolution.
- `--tags role:worker` (agent create, `agent.md:175`) is an identity *tag* on a spec — searchable
  metadata, not a role-resolved addressee.

Identity pinning stays authoritative because the occupant pin — `{ specId, runId, generation }`,
snapshotted before wait or send (ADR-057 wave 2, task 0530) — is what actually binds a wait to a
run. A role would need exact-one resolution to collapse to that same pin, and the survey shows no
consumer that would benefit: the added surface would carry the ambiguity cost (zero/multi-occupant
errors, re-resolution races) with no demonstrated caller. Under ADR-051's noun-first rule, adding
`--role` to existing verbs without a concrete caller is surface without demand.

**Evidence that would reopen this.** Any of: (1) a shipped pipeline or `spur team` workflow that
genuinely needs to address "the reviewer"/"the planner" rather than a concrete spec; (2) a
demonstrated multi-occupant team pattern where the operator needs one-role-one-recipient semantics
and the concrete spec id is unknowable in advance; (3) an agent-to-agent protocol where messages
must route by role for liveness (e.g. a dead occupant's role must be re-bound). If one appears,
reopen with exact-one resolution: zero/multi-occupant are hard errors naming the role and count, the
pin is written before proceed, and no fan-out is introduced (D6 R3/R4).

**Detail:** `docs/design/spur-team-mode-design.md`; ADR-051 (public-surface consent),
ADR-057 (identity-pinned control plane), ADR-061 (role→tier SSOT in `packages/config`).

**Amendment (2026-08-26 · Task 0685):** Reopened exactly as this entry's evidence clause (2)+(3)
anticipated: task 0685 demonstrated operator flow needing one-role-one-recipient addressing where
the concrete spec id is not knowable in advance, landing `message send --role` / `agent wait
--role` as exactly-one resolution over the frozen instance shapes (`AgentInstanceStore.byRole` /
`byExecutor`, vocabulary = AGENT_ROLE_NAMES ∪ executor names). The resolution collapses onto the
SAME `{specId, runId, generation}` identity pin snapshotted before proceed — identity pinning stays
authoritative; `--to` remains the default surface; zero/multi matches are hard errors naming the
count and candidates; no fan-out (D6 R3/R4 preserved). This amendment does NOT weaken the wave-2
pin semantics; it adds the resolution layer in front of them.

**Amendment (2026-08-26 · Task 0685 verification correction):** Exact-one `--role` resolution
first yields a concrete `specId`. `agent wait` and `message send --wait` then snapshot the existing
occupant pin; an unwaited `message send` queues to that resolved id without requiring an occupant,
matching the unchanged `--to` path. Detail: `docs/design/inter-agent-control-plane.md` §6.

## ADR-076: Retire the D5-N Promotion Bar — Delete task-pipeline2 Rather Than Promote It

**Status:** Accepted · **Date:** 2026-08-20 · **Feature:** D5 · **Task:** 0606 · **Amends:** ADR-072

**Decision.** The D5-N promotion bar is **retired as a gate**, and `config/workflows/task-pipeline2.yaml`
is **deleted rather than promoted**. `task-pipeline.yaml` remains the single canonical task pipeline.
`scripts/spur-dev.ts eval-pipeline` survives as a *measurement* tool, invoked deliberately; it is no
longer a precondition for any transition, deletion, or feature closure.

**Why.**

- **The bar guarded a promotion nobody wants.** A static comparison of the two graphs
  (`extractResolvedWorkflowFacts`, 2026-08-20) shows pipeline2 declares **5** model queries to
  pipeline1's **4** — it *adds* a `residual-sweep` model hop. The stated goal of the work was to make
  the pipeline faster. Promoting a graph with an extra LLM stage does not serve that goal.
- **The thing it blocked was a no-op deletion.** `task-pipeline2.yaml` has **zero live callers** —
  nothing in `config/`, `plugins/`, `apps/`, `packages/`, or `scripts/` invokes it. The only
  non-documentation references were its own `name:` field, its composition-baseline entry, and a
  prose proposal string. Deleting unreferenced code needs no performance evidence; the constitution's
  "delete, don't layer" rule already covers it.
- **The gate did not protect what it appeared to protect.** Changes to the *canonical*
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
measurably *reduces* model-query count or wall-clock against real-run history data. If that appears,
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
0536; the inversion changes *where the table is read from*, never *how many roles exist*), the
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

**Amendment (2026-08-24).** Decision shipped: the cache contract is built as the
`history-anatomy-cache.ts` plugin script (+ `.mjs` twin) and the `history-anatomy.yaml` workflow
cache branch (0659/0660). The deterministic half — semantic artifact digest, invalidation matrix,
structure gate, atomic publication — is installed code, not a design.

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

**Amendment (2026-08-24).** Decision shipped: `analyze` records the true selection population and
applied depth per bounded leaderboard, the forensics renderer labels each leaderboard `top N of M`,
and pre-addition artifacts render `not available` (0657). The backward-compatibility rule is
installed code, not a design.

**Detail:** `docs/design/history-anatomy.md` §HA-S1 — the additive artifact fields, the renderer
change, and the backward-compatibility rule for pre-addition artifacts.

## ADR-081: Board Module Shell Convention — One-Row Header, Append-Only Tabs, Density-First Full-Bleed

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

**Status:** Accepted (design) · **Date:** 2026-08-24 · **Feature:** A5

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

**Status:** Accepted (design) · **Date:** 2026-08-25 · **Feature:** F61

**Decision.** The anchor-citation class — `L4.anchor-subject-mismatch` and `L4.stale-line-anchor` —
is reconciled as a **dated legacy set**: the 2026-08-25 findings are accepted into the baseline
under per-code diagnoses, and **no repair campaign and no matcher change runs under this
reconciliation**. The matcher (`citedLinesNameSubject`, `extractSubjectTokens`, the cited-window
slice in `checkLineAnchors`) stays byte-for-byte unchanged, because feature F61 puts it Out of
Scope ("loosening it to excuse a bad citation is forbidden") and F61 AC R2 requires it unchanged
from the shape feature F91 shipped. The measured matcher evidence is routed to feature F91 as a
proposal (below), not applied here.

**Why this outcome.** Three probes measured in task 0670 (Background) make "repair the citations"
the wrong campaign and "narrow/loosen the rule" unavailable:

- **Probe 1 — multi-anchor union: real, negligible.** `extractSubjectTokens` excludes only the
  anchor under test, so a sibling anchor's path becomes a subject token. It can never appear in the
  cited source, and it defeats the "every token is a row id ⇒ nothing to assert" escape in
  `citedLinesNameSubject` (`packages/app/src/services/task-check.ts:400-406`). A bare one-anchor
  evidence row passes; the same row with a second anchor reports; excluding every anchor restores
  the pass. Corpus fallout of the narrowing: 2 baseline entries stop reproducing (`task:0110`,
  `task:0368`). Mechanism confirmed; explains ~0.5 % of the class.
- **Probe 2 — point-window matching: the driver.** The matcher reads only the cited lines
  (`packages/app/src/services/task-check.ts:1367-1372`). A single-line anchor pointing *inside* a
  symbol can never contain that symbol's name. Worked example (task 0665): a citation of
  `apps/cli/src/context.ts:170` for subjects `createCliContext` / `AgentConfig` — line 170 is
  `const cwd = resolve(options.cwd ?? process.cwd());`, inside `createCliContext` declared at line
  151, `agentConfig` bound at line 176. The citation is correct and the window is too narrow.
  Widening the cited window to ±20 lines moves new mismatches **42 → 10** and turns ~101 baselined
  mismatch entries stale (5 → 106); total observed findings 4,873 → 3,976.
- **Probe 3 — cap coupling.** `checkLineAnchors` caps findings at 5 per section, so per-code counts
  are not independent: under probe 2, `L4.stale-line-anchor` rose 31 → 56 purely because suppressed
  mismatches freed cap slots.

Probe 2 says most citations are *correct* and the matcher's point-window is what makes them
"mismatch" — so a citation-repair campaign would be mass re-authoring of correct citations, which
the two-sided gate would then re-flag under a different diagnosis. Freezing the dated legacy set is
the honest reconciliation: the entries record that these findings were measured on 2026-08-25,
diagnosed per code, and accepted while F91 decides the matcher's window. **Narrowing or widening
the matcher is not an outcome of this ADR** (F61 Scope; F61 AC R2).

**Detail.** Baseline reconciliation and the per-code dated diagnoses live in
`config/corpus-baseline.json` `note` (`§ L4.anchor-subject-mismatch (2026-08-25)`,
`§ L4.stale-line-anchor (2026-08-25)`). The residue codes are reconciled independently:
`§ L3.unchecked-checklist (2026-08-25)` and `§ L3.ac-empty (2026-08-25)`. The F93-owned codes
(`L4.scenario-unverified`, `L4.evidence-not-recoverable`, `L4.verifying-incomplete-tasks`) are
out of scope and stay unlisted per their F93 ownership.

## Routed proposal to feature F91 (task 0670 R2)

Feature F91 owns the matcher (`task-check.ts` anchor subject-matching) and is `done`. The probe
measurements below are **routed, not applied**: no matcher source file is modified by task 0670.

- **Probe-1 result (per-row anchor exclusion):** excluding every anchor in an evidence row (not
  just the anchor under test) from the subject-token extraction makes 2 baseline entries stale
  (`task:0110`, `task:0368`) and moves new mismatches 42 → 43. Mechanism at
  `packages/app/src/services/task-check.ts:1378` / `:400-406`.
- **Probe-2 result (point-window matching):** widening the cited window to ±20 lines drops new
  mismatches **42 → 10** and turns ~101 baselined mismatch entries stale (5 → 106); total observed
  findings 4,873 → 3,976. The matcher reads only the cited lines
  (`packages/app/src/services/task-check.ts:1367-1372`); a single-line anchor inside a symbol can
  never name it.

**Reproduction commands (frozen, for a future F91 task):**

```bash
# full sweep, machine-readable (measured 2026-08-25, ~60 s wall clock)
bun run apps/cli/src/index.ts task check --corpus --json > /tmp/corpus.json

# probe 2 (window widening): edit the cited-window slice in checkLineAnchors to ±20,
# re-run the sweep, compare new-mismatch and stale-entry counts against the above.
```

## ADR-084: Environment-Improvement Lens Projects Into Existing Report Owners

**Status:** Accepted (design) · **Date:** 2026-08-26 · **Feature:** I9

**Decision.** Harvest vendor `vendors/misc/retro` as one plugin-level environment-improvement mapping projected into `sp:dogfood-testing` report §6 and `sp:history-anatomy` report section 9. Do not add a third analysis skill, `/sp:dev-retro`, or a public CLI noun. History-anatomy's closed category vocabulary stays frozen — retro names occupy `<signal>` or owner-surface only. The mapping is the single category table and carries the implementer-versus-reviewer placement rule.

**Why.** The harvestable value is a compact taxonomy plus a placement rule; a third skill would overlap two live report contracts and fail ADR-016's command test.

**Detail:** `docs/03_ARCHITECTURE.md` §22; `docs/design/environment-improvement-lens.md`.

**Amendment (2026-08-27 · ADR-089):** The prohibition remains on a standalone retro/lens command
that duplicates the two report owners. `/sp:dev-review-session` is a distinct current-context
review surface: it reviews the active conversation, uses this lens only to place supported
improvement proposals, and performs no imported-history analysis.

## ADR-085: Environment Remediations Remain Operator Proposals

**Status:** Accepted (design) · **Date:** 2026-08-26 · **Feature:** I9

**Decision.** Environment-lens remediations are operator proposals only. Dogfood fix-mode must not `Edit`/`Write` `AGENTS.md`, skills, rules, or other environment sources for an environment-tagged finding. History-anatomy already forbids applied changes; I9 does not add a second mutation source.

**Why.** Retro suggests environment changes; mixing those into dogfood fix-mode would mutate harness files on the same path that repairs the testee.

**Detail:** `docs/03_ARCHITECTURE.md` §22; `docs/design/environment-improvement-lens.md`.

**Amendment (2026-08-27 · ADR-089):** `sp:session-review` inherits present-don't-apply for process
and environment improvements. Its complete report is read-only: no source/doc edit, corpus write,
workflow launch, or indexed-context append.

## ADR-086: Materialized Agent Instances Are Runtime State, Not Committed Spec Files

**Status:** Accepted · **Date:** 2026-08-26 · **Task:** 0685

**Decision.** Agent-team state is a three-layer taxonomy:

1. **Capability catalog** (`agent.roles`, `agent.executors` in `.spur/config.yaml`) is *config* —
   hand-authored and committed. It defines what CAN run.
2. **Team rosters** (`agent.team.<id>.members`) are *config* — declared intent for what SHOULD run,
   committed with the project.
3. **Materialized agent instances** (deterministic `<teamId>-<memberKey>` ids, executor bindings,
   resolved Layer-1 roles) are *runtime state*: after the `0026_spur_cli_agent_instances` cutover
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

**Status:** Approved — A+C compose (operator, 2026-08-27, task 0691 R2) · **Date:** 2026-08-27 · **Task:** 0691 · **Feature:** F94 (absorbs F96)

**Decision.** The corpus gate stops reconciling dated residue and keeps one ratchet: **a finding
not in the baseline fails; a baseline entry that stops reproducing no longer does.** The baseline
collapses from a two-sided 1,916-entry dated ledger into a **committed snapshot of the previous
sweep's observed findings** — regenerated by tooling from the sweep output, never hand-edited.
This is option **A+C composed**: snapshot-diff for the new-findings side, single-sided for the
vanished side.

- **Amends ADR-050:** the two-sided cannot-rot property is retired. Rationale below.
- **Amends ADR-062:** the warning-severity ratchet stays two-sided *in effect* on the active
  folder's fresh findings (new warnings still fail), but warnings no longer mint dated per-entry
  debt; the snapshot absorbs them mechanically.
- **Supersedes ADR-083:** the dated-legacy-set mechanism (freeze, per-code diagnosis paragraphs,
  repair-campaign conditioning) is deleted, not re-used. The frozen sets' entries do not migrate.
- **Supersedes ADR-088's reconcile practice** (not its severity ruling): the anchor-subject check
  stays at warning severity; the 435-entry re-key reconciliation it required is the last of its
  kind.
- **Constitution T10:** retained, narrowed. Same-commit obligation survives for **newly failing
  findings** (fix them, or accept them into the regenerated snapshot with a dated wave note).
  The "or add each to `config/corpus-baseline.json`" branch becomes "accept into the regenerated
  snapshot" — mechanical, no per-entry authoring. The stale-entry removal obligation (the
  "delete the moment its finding is fixed" half) is subsumed: the snapshot cannot hold a stale
  entry because it is regenerated from what the sweep actually observed.

**Why.** The measured cost curve (2026-08-27, `config/corpus-baseline.json`):

- 1,916 entries over 37 distinct codes; 1,797 task-kind, 119 feature-kind.
- **1,580 of 1,797 task entries (88%) sit on archived folders** (`docs/tasks{,2,3}`, ids ≤0488) —
  closed work the repo has declined to repair across three waves (2026-08-17: 1,037 archived;
  2026-08-21: 278; 2026-08-27: 264).
- Nine reconcile waves in 20 days (08-07 → 08-27); the 2026-08-27 wave alone minted 423 entries
  (325 `L4.anchor-subject-mismatch` re-keyed by ADR-088's severity demotion — 228 archived, 97
  active).
- Three reconcile incidents in the 0688 session (2026-08-27): an inverted jq filter dropped the
  baseline 1907 → 18 (caught only by a 408-new-error blowup), and object-construction key loss
  truncated the file. All were hand-rolled jq on a policy file.

The two-sided dated ledger's failure mode is structural, not incidental: it converts every
matcher change into a mandatory same-commit rewrite of a 1,900-entry file whose only safe edit
path (per-entry diagnosis, dated) is manual. The incidents are what that cost curve looks like at
the limit. Meanwhile the property it buys — cannot-rot on 1,580 archived entries the corpus has
already declined to repair — is ratchet debt with no exit: each wave mints more, none is ever
paid down.

**Options evaluated** (option set per task 0691; precedence reliability > audit fidelity > diff
size — an option that removes a whole failure mode beats one that only shrinks the file):

| Option | Verdict | Reasoning |
| --- | --- | --- |
| **A. Snapshot-diff** (drop dated-residue baselining; gate new findings vs committed snapshot of previous run) | **Adopted — new-findings half** | Keeps gate force exactly where it has value: a genuinely new finding fails the commit that introduced it. Removes the per-entry diagnosis obligation and with it the hand-rolled-jq failure class. Loses the per-entry reason/date audit trail — accepted: the wave note and git history on the snapshot carry the same information at 1% of the maintenance cost. |
| **B. Class collapse** (keep two-sided; merge superseded classes into single keys) | Rejected | Smallest diff, but explicitly fails the precedence rule: reconcile churn stays per-wave, per-matcher-change. 37 codes → fewer keys shrinks the file, not the cost curve. The 0688 incidents were count-blind; they happen at any entry count >~0 with manual jq in the loop. |
| **C. Single-sided** (gate new findings only; vanished entries no longer fail) | **Adopted — vanished half** | Kills stale-entry reconcile, the dominant churn source (every matcher improvement strands entries; ADR-088 stranded 435 in one step). The ADR-050 silent-suppression concern is answered structurally: the snapshot is machine-regenerated from observed findings, so a suppression must be a deliberate code change to the matcher or the sweep, both reviewable in a diff — not an unexplained row rotting in a ledger nobody re-derives. Residual risk accepted: a *narrowed* matcher silently stops flagging previously-flagged correct findings. Mitigation: the snapshot diff makes vanished findings *visible* in the commit diff (count drops are seen in review), and any matcher change keeps its own T10 same-commit sweep obligation. |
| **D. Retire the baseline entirely** (advisory-only sweep) | Rejected | Zero gate force. The corpus gate is the only mechanism that caught the eb93dfdaa class (verdict MET with unflipped checkboxes, found by `L3.status-claim-contradiction`) and the 404-error backlog ADR-062 exposed. The sweep's value is gating; reporting-only recreates the pre-ADR-050 world where 84% of the corpus sat outside the gate. |

**F96 disposition (absorbed — clause-window machinery): DELETE.** The claim-matcher
clause-window machinery — `ANCHOR_WINDOW_LINES` widening and the row-subject tokenization of
`L3.status-claim-contradiction` (ADR-088's replacement check: bare claim word within 80 chars, no
sentence separator, not/never lookbehind negation) — is **deleted, not retained**. Evidence: the
three dated residue entries **0607/0677/0670** (`L3.status-claim-contradiction: error`,
`since: 2026-08-27`) are false positives on the *active* folder, each reason recording
"Clause-window ambiguity (task 0688 R7 ceiling)": 0607 quotes "not implemented" describing
deferred residuals, 0677 a "todo" token in a MET table row, 0670 "Pending" inside the quoted
ADR-083 title. A matcher whose own filing residue on fresh work is 100% false positives at error
severity has a precision floor no window tuning fixes — the clause-proximity heuristic cannot
see quotation or scope boundaries. The check itself is removed from
`task-check.ts`, the `L3.status-claim-contradiction` code retires, and its 18 residue
entries (7 archived / 11 active) go nowhere — under the single-sided snapshot they would
be keys whose emitting check no longer exists, so the regenerated baseline carries zero
status-claim entries. If status-claim verification is wanted again, it returns as a
structurally different check (e.g. resolving checkbox state against recorded verdicts, not
prose token proximity), as its own decision.

**Consequences.** (1) `config/corpus-baseline.json` becomes a generated snapshot (entries keyed
by observed finding; wave note preserved) — hand edits to it are prohibited; regeneration is a
script with a round-trip assertion on entry count, replacing hand-rolled jq permanently. (2) The
`packages/app/src/services/corpus-check.ts` reconciliation drops the stale half and the
per-entry dated-diagnosis contract. (3) T10's stale-entry clause and the ADR-083 frozen-set
notes in the baseline `note` field retire with the mechanism. (4) **Not in effect until operator
approval recorded below — task 0691 R2. No gate code, baseline rewrite, or machinery removal
lands before that approval.**

**Operator approval.** **Approved: A+C compose** — recorded 2026-08-27 via the task 0691 R2 gate
(inline dev-runall pipeline, option presented among A+C / A / C / B / D). Verbatim selection:
"A+C compose". Direction evidence: the 2026-08-27 operator message ruling the two-sided
dated-baseline direction wrong ("simplify the gate and baseline massively for reliability and
efficiency"). Plan steps 5–7 (implementation, verification, anti-pattern confirmation) unblocked.

**Detail:** task 0691; feature F94; feature F96 (cancelled into 0691); ADR-050 → ADR-062 →
ADR-083 → ADR-088 chain; `99 §5 T10`; `config/corpus-baseline.json` (1,916 entries, measured
2026-08-27).

## ADR-091: The CLI `--json` Surface Adopts the Contracts Envelope Behind an Opt-In `--json-envelope` Flag

**Status:** Accepted · **Date:** 2026-08-27 · **Task:** 0693 · **Feature:** F95

**Decision.** Every `spur <noun> <verb> --json` emit migrates to the envelope already defined in
`packages/contracts/src/shared.ts:24-39` — success `{ok: true, data}` (paginated lists
`{ok: true, data[], meta}`), failure `{ok: false, error: {code, message, details?}}` with the
frozen `API_ERROR_CODES` union — routed through **a single opt-in seam**: a `--json-envelope`
flag on shared options (explicit flag > `SPUR_JSON_ENVELOPE=1` env, read in
`apps/cli/src/output.ts`, the non-interactive opt-in for scripts that cannot add a flag per call),
applied at the `toJson()` choke point in `apps/cli/src/output.ts` and
adopted per noun in descending emit-count order (task 26, workflow 12, feature 11, projects 10,
message 10, history 9, team 6, agent 6, builder 4, rule 3, init 2, status/serve/migrate 1 each —
102 sites swept, `docs/04_DESIGN.md` §4.1). **The default stays the current unwrapped shape for
the deprecation window**; `--json` and `--json-envelope` coexist until a follow-up F95 task flips
the default after a documented window.

Migration of the deviation classes found in the §4.1 sweep:

- **Bare-array lists** (`task list`, `task check`, `feature check`) become paginated envelope
  responses: `{ok: true, data: [...], meta}`.
- **Top-level `ok`-as-command-success** (~18 sites: projects verbs, task 431/715/754, agent
  create, builder, init fresh) move their payload under `data`; the top-level `ok` becomes the
  envelope discriminant. Command-level failure semantics move to the `ok: false` + `error`
  branch; exit codes are unchanged (out of scope).
- **Pseudo-envelope errors** (`{error: {code, message}}` without `ok`; `{ok: false, error:
  "<string>"}` with CLI-local codes) normalize to `apiErrorSchema` with frozen codes.
- **Helper bypasses** (raw `JSON.stringify` at rule list, task verdict, task verifyall-aggregate)
  route through the same seam; the task-verdict file artifact's *content* is unchanged (out of
  scope). Its console emit also stays raw (see `docs/04_DESIGN.md` §4.1 "Kept raw"), where the
  artifact bytes double as the stdout payload — adopting the seam there would fork two renderings
  of one artifact and is deferred to the consumers of that surface.

**`API_ERROR_CODES` extension (closes the DEFERRED Q&A item).** **No seventh code now.** The two
CLI-local error vocabularies (message/agent/task-collision; projects/builder) map to
`INTERNAL_ERROR` with the CLI-local code carried in `error.details.cliCode`, so no consumer that
strings-matches today loses information and no new vocabulary is minted without proven need. A
new code is added only when a consumer can be shown to branch programmatically on it — and that
extension amends this ADR rather than reopening it.

- **Operates under ADR-051:** the `spur` CLI is the public surface; this change is consent-gated
  (see conditioning) and the flag name, migration table, and deprecation window are the consent
  artifacts.

**Why.** Task 0688 (2026-08-27) surfaced four live `--json` deviations in one session: a task
update response with no `ok` field, two bare-array responses, and a flat-with-`ok` shape — each a
different contract for the same flag. The 102-site sweep (`docs/04_DESIGN.md` §4.1) showed the
divergence is structural: **zero sites emit the canonical envelope today**, with five recurring
deviation classes across 14 noun modules. `packages/contracts` already defines and
server-validates the exact shape; the CLI re-invented five approximations of it. Adopting rather
than authoring gives one wire shape across oRPC server and CLI with one source of truth. The 0688
incident is the cost of the status quo: an unannounced shape change broke consumers — which is
also why adoption is opt-in with the raw default preserved, not a flag flip in this task.

**Options evaluated:**

| Option | Verdict | Reasoning |
| --- | --- | --- |
| **Adopt contracts envelope, opt-in `--json-envelope`, raw default during window** | **Adopted** | One source of truth, zero breaking change at merge, per-noun adoption reviewable incrementally. |
| Flip `--json` to enveloped immediately | Rejected | Repeats the 0688 failure class: an unannounced shape change breaking consumers. |
| Author a new CLI-local envelope | Rejected | Second convention beside an existing canonical one; server and CLI shapes drift again. |
| Adopt `@gobing-ai/ts-utils` `ApiEnvelope` | Rejected | Different shape (`{code, message, result, data}`), zero call sites under `apps/`/`packages/`. Recorded as rejected alternative; retiring it is out of scope. |
| Per-call-site wrapping (no seam) | Rejected | 102 sites × two shapes to keep in sync; the seam makes the flag a one-line concern per noun. |

**Consequences.** (1) `apps/cli/src/output.ts` gains `CliEnvelope<T>` types re-exported from
`packages/contracts`; `--json-envelope` registers in
`apps/cli/src/commands/shared-options.ts`. (2) Migration is per-noun and mechanical: each site's
existing payload moves under `data` verbatim — **no payload field, exit code, or human-output
change** (out of scope). (3) The oRPC/server surface is not migrated; `packages/contracts` is the
source being adopted, not a target. (4) The default-shape flip and the `--json-envelope`-default
deprecation window are follow-up F95 work carrying this ADR id. (5) **Not in effect until
operator consent is recorded — task 0693 R3, per the ADR-051 amendment for public CLI surface
changes. No `apps/cli/src/` or `packages/app/src` edit lands before that consent.**

**Operator approval.** **Approved** — recorded 2026-08-27 (operator Robin Min) via the task 0693
R3 gate. The operator approves ADR-091 as presented: contracts envelope adopted as the standard
`--json` shape, opt-in only via `--json-envelope` / `SPUR_JSON_ENVELOPE=1` (flag > env) at the
single `toJson()` seam, raw default preserved during the deprecation window (default flip =
follow-up F95 work), bare-array list verbs paginate to `{ok, data[], meta}`, and **no seventh
`API_ERROR_CODES` code** (CLI-local codes collapse to `INTERNAL_ERROR` with `details.cliCode`).
Mirrored in task 0693 `### Q&A`. R4 unblocked.

**Detail:** task 0693; feature F95; `docs/04_DESIGN.md` §4.1 (102-site shape inventory);
`packages/contracts/src/shared.ts:24-39`; `apps/cli/src/output.ts:22`; incident evidence: task
0688 (2026-08-27, four observed `--json` deviations).

**Amendment 2026-08-27 (task 0697) — the envelope seam moves to `packages/app`.** The helpers
(`envelopeEnabled`, `toEnvelopeJson`, `toEnvelopeError`, `writeJsonError`, and the `CliEnvelope` /
`EnvelopeErrorPayload` / `EnvelopeOptions` types) now live in
**`packages/app/src/output/envelope.ts`**, exported from `@gobing-ai/spur-app`.
`apps/cli/src/output.ts` re-exports them, so all 99 call sites adopted at 0693 resolve unchanged
and keep `import { toEnvelopeJson } from '../output'`. `CommandOutput`, `consoleOutput`, and
`toJson` stay CLI-local; `writeJsonError` now accepts the structural `EnvelopeCapableOutput`
(`{write, error}`), which both `CommandOutput` and the service output sinks already satisfy.

*Why the move is forced, not chosen.* The 0693 sweep was scoped to `apps/cli/src/commands/**`, but
five verbs emit their `--json` from a service in `packages/app` and so never saw
`options.jsonEnvelope`: `agent list`, `agent doctor`, `rule run`, `rule validate` (the four filed
on 0697) plus `agent run`, which AC4's inventory scan surfaced as the same defect class. The naive
fix — importing the helpers from `apps/cli` into `packages/app` — is not merely discouraged, it is
**circular against the workspace graph**: `apps/cli/package.json` already depends on
`@gobing-ai/spur-app`, and five CLI modules import it at runtime. Moving the helpers down and
re-exporting up is the only direction that adds no dependency edge. ADR-021 ("Functionality Lives
in `packages/app`") independently points the same way, but the binding constraint is the graph.

*Rejected alternatives.* (1) **`packages/contracts`** — that package is transport DTOs only
(AGENTS.md § oRPC), and `envelopeEnabled` reads `process.env`, which is runtime behavior, not a
DTO. (2) **Duplicating the helpers into `packages/app`** — a second envelope implementation inside
the very task meant to finish adopting the first; ADR-091 exists to stop the repo growing another
envelope. (A third, a new shared package for four functions, was rejected as ceremony.)

*No consent gate.* This is an internal module relocation: no CLI noun, verb, or flag changes.
`--json-envelope` already exists and was already consent-approved above, so the ADR-051 gate that
governed 0693 does not apply here. The amendment exists so the next reader knows why
`apps/cli/src/output.ts` became a re-export. The raw default and the deferred default-flip are
unchanged.

*Detail:* task 0697; `packages/app/src/output/envelope.ts`; `apps/cli/src/output.ts`;
`docs/04_DESIGN.md` §4.1 (closed inventory); AC4 guard
`apps/cli/tests/json-envelope-inventory.test.ts`.
