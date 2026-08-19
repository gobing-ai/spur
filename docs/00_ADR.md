---
doc: 00_ADR
owns: WHY — cross-cutting decisions, one-line reasons
authority: authoritative
version: 1.21.0
owner: Robin Min
updated_at: 2026-08-16
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
