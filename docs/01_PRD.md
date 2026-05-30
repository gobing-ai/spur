# 01 PRD — Spur

**Version:** 0.7.0  
**Status:** Architecture-Ready  
**Last Updated:** 2026-05-08  
**Owner:** Robin Min

## 1. Product Vision

Spur is a local-first harness engineering toolkit for mainstream coding agents. It is not a new coding agent, and it is not a BYOK LLM platform in the current stage. Spur assumes the user already has coding agents installed and authenticated, then provides the harness around those agents: execution discipline, analytics, orchestration, constraints, verification, asset engineering, and operational visibility.

The long-term goal is to turn scattered agent skills, task workflows, execution scripts, policy checks, and conversation-history analytics into one coherent daily-use platform.

The product should support the whole harness lifecycle:

```text
idea/concept
  → feature/task decomposition
  → agent skill/workflow selection
  → local coding-agent execution
  → run/event capture
  → constraints + verification
  → inspection + analytics
  → skill/workflow tuning
```

Pi is the default coding agent path when Spur needs to run an agent itself. The initial execution model should build on the existing `airunner` work in:

- `~/projects/cc-agents/scripts/airunner.ts`
- `~/projects/cc-agents/scripts/lib/ai-runner.ts`

These already provide installed-agent detection, doctor checks, channel resolution, slash-command translation, and command execution without storing user keys.

## 2. Source Inputs

| Source                                                                                         | Useful Signals                                                                                         |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `docs/00_idea.md`                                                                              | Spur intent, stack preference, internal resources, document plan                                       |
| `~/projects/typescript-bun-starter/docs/01_ARCHITECTURE_SPEC.md`                               | Bun monorepo, contracts/core/cli/server/web boundaries, event bus, job queue, telemetry, policy checks |
| `~/xprojects/magnifier/docs/01_ARCHITECTURE_SPEC.md`                                           | Mature local-first analytics, per-platform ETL, raw events, selected projections                       |
| `~/projects/cc-agents/docs/reverse-engineering-rd3.md`                                         | Mature skills/commands/subagents, task lifecycle, feature tree foundation, verification concepts       |
| `~/projects/cc-agents/scripts/airunner.ts` and `~/projects/cc-agents/scripts/lib/ai-runner.ts` | Existing no-BYOK installed-agent execution layer                                                       |
| `~/projects/cc-bridge/docs/reverse-engineering-review.md`                                      | Reference/POC ideas for execution, channels, sessions, memory, scheduling, permissions                 |
| `~/projects/cc-bridge/docs/paseo-review.md`                                                    | Reference ideas for loop execution, normalized agent timelines, cooperation                            |
| `~/projects/cc-agents/vendors/flue/reverse-engineering-report.md`                              | Reference ideas for sessions, sandbox boundaries, structured results                                   |
| `~/projects/cc-agents/docs/reverse-engineering-oma.md`                                         | SSOT asset model, vendor adaptation, install/doctor workflow                                           |

## 3. Problem Statement

AI coding workflows are fragmented:

- rd3 has mature skills, slash commands, subagents, and task lifecycle management, but many capabilities are spread across markdown assets and scripts.
- rd3 orchestration-v1/v2 contain useful lessons, but neither should be reused directly.
- ACP/acpx has unacceptable performance and stability for this project and should not be part of Spur's execution strategy.
- Magnifier has strong local-first analytics patterns, but much of its higher-level intelligence remains early/evaluative.
- cc-bridge is useful as a reference/POC, not as a direct extraction target.
- Tooling and constraints are scattered across `rd3:quick-grep`, `scripts/policy-check.ts`, project AGENTS rules, and local scripts.

The missing product is a unified harness layer that makes agent-driven engineering measurable, reproducible, constrained, inspectable, and continuously improvable.

## 4. Positioning

Spur should be positioned as:

> A local-first agent harness toolkit for measuring, running, constraining, verifying, and improving coding-agent workflows.

Spur is not:

- a new coding agent,
- a BYOK LLM provider platform,
- a secret/key storage system,
- a generic chatbot framework,
- a desktop/mobile IDE in v1,
- a cloud-first team SaaS in the early phase.

## 5. Design Principles

1. **Simple and modular first.** Build small explicit modules; avoid framework-heavy abstractions until they pay for themselves.
2. **Local-first.** Store runs, events, artifacts, config, and analytics locally by default.
3. **No key ownership.** Do not store or manage user LLM provider keys in early phases.
4. **Reuse what already works.** rd3 skills/task lifecycle and ai-runner are inputs, not things to rewrite immediately.
5. **Core loop first.** Every phase should strengthen the loop: run, capture, constrain, verify, inspect.
6. **Rules are configuration.** Harness constraints should be YAML-driven so project rules can evolve without code changes.
7. **Workflows are state machines.** Internal workflows should run on a shared FSM engine rather than one-off procedural scripts.
8. **Events over tight coupling.** Use typed events and durable state to connect modules without source-level coupling.
9. **Seams before ecosystems.** Define extension seams early; defer external plugin ecosystem until product loop is proven.
10. **Human-readable where useful.** Keep skills, workflows, rules, and specs friendly to humans and agents.

## 6. Target Users

### Senior AI-Native Developer

Needs to run coding-agent work reliably, inspect outputs, measure token/accuracy behavior, and enforce repo rules without fragile one-off prompt flows.

### Engineering Lead / Architect

Needs visibility into agent-assisted engineering work across projects, workflows, skills, token/cost profiles, and failure modes.

### Agent Framework Maintainer

Needs a concrete base for skills/slash commands/subagents, plus a path to validate, package, adapt, and improve them using real evidence.

## 7. Top-Level Product Architecture

Spur should be described with five top-level categories. These are product architecture categories, not implementation packages.

```text
Spur
├── Kernel
├── Profiles
├── Workspaces
├── Assets
└── Tooling
```

Relationship:

```text
Profiles define rules, workflows, defaults, and policies.
Kernel executes rules, workflows, runs, jobs, and events.
Workspaces bind git-backed work directories to agents, purpose, and workflow.
Assets provide reusable agent-facing behavior.
Tooling provides reusable implementation utilities.
```

### 7.1 Kernel

Kernel is the generic runtime foundation. It should not own project-specific policies, workflows, or skills.

| Sub-Component           | Purpose                                                                                                                                               | Urgency |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| YAML Rule Engine        | Evaluate harness constraints from YAML rules; host-owned registries (evaluators, fixers, resolvers, formatters) with extension support (D-024, D-026) | P0      |
| FSM Workflow Engine     | Execute internal workflows as persisted state machines                                                                                                | P0      |
| Event Bus / Event Model | Typed internal lifecycle events and decoupling                                                                                                        | P0      |
| Persistence Runtime     | SQLite/Drizzle DB, migrations, repositories                                                                                                           | P0      |
| AI Runner / Executor    | Execute installed agents through ai-runner/Pi                                                                                                         | P0      |
| Gate Engine             | Command/file/content/compound verification gates                                                                                                      | P0      |
| Artifact Store          | Store logs, outputs, patches, reports                                                                                                                 | P0      |
| Scheduler               | Delayed/repeated internal work                                                                                                                        | P1      |
| Job Queue               | Async jobs: ETL, projections, reports                                                                                                                 | P1      |
| Redaction Engine        | Redact secrets before persistence                                                                                                                     | P1      |
| Extension Registry      | Internal first-party extension registry                                                                                                               | P1      |

Kernel rule:

> Kernel executes generic definitions; it does not own project-specific rules, workflows, or skills.

### 7.2 Profiles

Profiles are configuration bundles. They bind Kernel engines to project/team conventions.

| Sub-Component                | Purpose                                          | Urgency |
| ---------------------------- | ------------------------------------------------ | ------- |
| Profile Config               | `.spur/config.yaml`, defaults, identity          | P0      |
| RuleSets                     | YAML rules consumed by Rule Engine               | P0      |
| Workflow Definitions         | YAML FSM definitions consumed by Workflow Engine | P0      |
| Runner Defaults              | Default agent/channel/model/mode preferences     | P0      |
| Gate Defaults                | Default check commands and verification policies | P0      |
| Asset References             | rd3/Spur asset paths and metadata                | P1      |
| Permission / Override Policy | Explicit approvals for risky operations          | P1      |
| Storage Paths                | DB/artifacts/logs/events path config             | P1      |
| Plugin/Extension Settings    | Enable/disable built-ins and later plugins       | P2      |
| Environment Policy           | Env capture/redaction/denylist behavior          | P2      |

Profile rule:

> Profiles configure how Kernel primitives behave in a project or team context.

> **Implementation note (D-027).** Profile is a product-architecture *category*, not a single implementation package. Generic file/YAML/source-loading mechanics live in `@spur/core/loader`; rule and workflow authoring schemas, source layering, preset composition, and normalization live with their engines under `@spur/kernel/rules/config` and `@spur/kernel/workflow/config`. The standalone `@spur/profiles` package has been retired.

### 7.3 Workspaces

Workspaces are managed git-backed execution contexts. A workspace contains one concrete working directory under a git repo, assigned one or more agents and a workflow for a specific purpose.

| Sub-Component       | Purpose                                        | Urgency |
| ------------------- | ---------------------------------------------- | ------- |
| Workspace Registry  | Track workspaces, repo roots, workdirs, state  | P1      |
| Git Context         | Branch, status, remote, dirty-state checks     | P1      |
| Agent Assignment    | Assign one or more agents to a workspace       | P1      |
| Workflow Binding    | Bind workspace to workflow and purpose         | P1      |
| Run Binding         | Link runs to workspace context                 | P1      |
| Workspace Lifecycle | create/ready/running/paused/completed/archived | P2      |
| Isolation Strategy  | Same repo, worktree, temp clone, sandbox       | P2      |
| Inbox / Outbox      | Cooperation messages scoped to workspace       | P3      |
| Artifact Scope      | Workspace-scoped logs/patches/reports          | P3      |
| Cleanup / Archive   | Archive stale workspaces and artifacts         | P3      |

Workspace rule:

> Workspaces bind git-backed work directories, agents, workflows, and purpose into an execution context.

### 7.4 Assets

Assets are reusable agent-facing definitions and supporting files. They include skills, slash commands, subagents, workflow templates, manifests, and related prompt or policy material. Run outputs remain **Artifacts**, not Assets.

| Sub-Component             | Purpose                                               | Urgency |
| ------------------------- | ----------------------------------------------------- | ------- |
| Asset Registry            | Catalog skills, commands, subagents, workflows, hooks | P1      |
| Asset Reference / Import  | Reference existing rd3 assets first                   | P1      |
| Asset Manifest            | Minimal metadata contract                             | P1      |
| Asset Inspector           | `spur asset inspect`                                  | P1      |
| Skill Base                | Spur-native skill authoring base                      | P2      |
| Workflow Template Base    | Reusable workflow templates                           | P2      |
| Slash Command Base        | Command authoring/adaptation                          | P3      |
| Subagent Base             | Subagent definition/adaptation                        | P3      |
| Asset Validator           | Quality/schema checks                                 | P2      |
| Asset Packager / Exporter | Adapt/export to Claude/Codex/Gemini/Pi/etc.           | P4      |

Assets rule:

> Assets define behavior for agents; Kernel executes and measures the behavior.

### 7.5 Tooling

Tooling provides reusable capability libraries. Tooling should not own product state or orchestration.

| Sub-Component            | Purpose                                  | Urgency |
| ------------------------ | ---------------------------------------- | ------- |
| Search Tools             | `rg`, structural search wrappers         | P0      |
| Import Boundary Analyzer | Detect invalid imports/layer violations  | P0      |
| TSDoc Export Analyzer    | Enforce exported symbol docs             | P0      |
| File Policy Checker      | Forbidden files/path rules               | P0      |
| Command Runner           | Safe command execution wrapper           | P0      |
| Markdown/YAML Parser     | Task, rule, workflow, asset parsing      | P0      |
| Git Utilities            | Repo detection, status, branch info      | P1      |
| Tree-sitter Utilities    | Syntax-aware checks                      | P1      |
| Conversation Parsers     | Claude/Codex/Pi/OpenCode history parsing | P2      |
| Projection Utilities     | Build summaries from raw events          | P2      |
| Token/Cost Calculator    | Token/cost normalization                 | P2      |
| Report Generator         | Human/JSON/Markdown reports              | P2      |
| Patch/Diff Utilities     | Patch inspection and artifact capture    | P2      |

Tooling rule:

> Tooling provides reusable capabilities; it does not own orchestration or durable product state.

### 7.6 Extension Seams

Extension seams cut across all five categories. They are not a separate top-level category.

- Kernel exposes extension points.
- Profiles configure enabled extensions.
- Workspaces bind extensions to execution contexts.
- Assets can be contributed by extensions.
- Tooling libraries can be reused by extensions.

Phase 1 uses first-party built-ins through an internal registry. External plugin loading is post-MVP.

## 8. Delivery Roadmap

Phased scope, task breakdown, acceptance criteria, data model, storage layout, architecture module mapping, and privacy/redaction requirements are in **[`docs/02_ROADMAP.md`](./02_ROADMAP.md)**.

Summary by phase:

| Phase                            | Focus                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| 0 — Foundation                   | Stabilise the existing Bun monorepo starter as a reliable dev base                 |
| 1 — MVP Harness Loop             | `doctor → run → capture events → verify/constraint-check → inspect`                |
| 2 — Analytics + Assets           | Spur-native projections, Magnifier-style import, asset registry, one scaffold path |
| 3 — Orchestration + Cooperation  | Richer FSM workflows, durable inbox/outbox, cooperation substrate                  |
| 4 — Plugins + Skill Engineering  | External plugin loading, full asset scaffold/validate/package/adapt/export         |
| 5 — Team + Advanced Intelligence | Multi-machine aggregation, advisory engine, NL query, rich dashboards              |

Implementation priority follows **Kernel → Profiles → Workspaces → Assets → Tooling** (see roadmap for details). Per D-027, "Profiles" as an implementation track now refers to the rule/workflow config modules inside `@spur/kernel` plus the generic loader primitives in `@spur/core/loader`, not a peer package.

## 9. Risks

| Risk                                       | Severity | Mitigation                                                     |
| ------------------------------------------ | -------- | -------------------------------------------------------------- |
| MVP turns into whole platform              | High     | Keep Phase 1 bound to doctor/run/capture/verify/inspect        |
| Agent CLI drift                            | High     | Doctor checks, command metadata, ai-runner compatibility tests |
| Rebuilding rd3 too early                   | Medium   | Reference rd3 assets first                                     |
| Analytics model overbuilt too early        | Medium   | Phase 1 uses Spur-native events only                           |
| Constraints become scattered scripts again | High     | Centralize rule definitions, runners, and findings             |
| Plugin mechanism over-engineered           | Medium   | Phase 1 internal registry only                                 |
| Inbox becomes orchestrator                 | High     | Workflow state remains in orchestration                        |
| Event bus becomes hidden coupling          | Medium   | Typed event contracts, explicit persistence                    |
| Local-first data leaks                     | High     | Redaction before persistence                                   |

## 10. Resolved Decisions

> **Single source of truth:** [`docs/06_DECISIONS.md`](./06_DECISIONS.md) is the canonical, maintained record for every decision. The list below is a summary snapshot; when this section and `06_DECISIONS.md` conflict, `06_DECISIONS.md` wins.

- Spur is a new standalone project.
- No BYOK/key storage in the early stage.
- Pi is the default execution path when Spur drives an agent.
- ai-runner is the first execution base.
- YAML-driven rule engine is a foundational kernel.
- FSM workflow engine is a foundational kernel.
- ACP/acpx is excluded.
- rd3 orchestration-v1/v2 are reference-only, not reused directly.
- Mature rd3 task lifecycle and `/rd3:dev-*` flows are reused rather than rebuilt in Phase 1.
- Phase 1 uses Spur-native run events, not external history import.
- Plugin system starts as an internal registry, not third-party loading.
- Asset system starts as reference/inspect/minimal manifest, not full scaffold/package/adapt.
- BYOK, sandboxing, and secret/key storage are deferred to Phase 6+ (out of scope for Phases 0–5).
- `spur doctor` matches the `airunner doctor` contract: per-agent `installed / version / authenticated / usable` columns. It does not probe LLM-provider keys — it only invokes each agent's own self-report.
- Workspaces are static binding records (repo + workdir + agents + workflow + purpose). Run is the live execution; `Run.workspaceId` references Workspace. (S2/Option A.)
- Phase 1 ships CLI-only. Web inspection moves to Phase 2 alongside the asset registry. (S3.)
- Gates are predicates on FSM transitions, not standalone actions. The action that ran before the gate is the implement/fix step. (S4/Option B.)
- Phase 1 constraint evaluators use `rg` and `sg` (ast-grep) only. Tree-sitter is deferred. (M4.)
- AI Runner / Executor lives in Kernel as a coding-agent-agnostic engine. Tooling layer does not duplicate it. (S1.)
- Redaction is one stage of an FSM-defined ETL pipeline. Pre-processing handles sensitive-data detection and redaction; post-processing handles pattern recognition and projections. The FSM workflow engine drives ETL stage transitions. (S5.)
- History ingestion uses a three-layer data flow: lossless append-only `history_raw_*` landing zone → standardized exploded/flattened `history_etl_*` projection → normalized analytics tables. Multi-block message content is exploded one row per block in the ETL layer; `content_text`/`content_sha256` are retained on raw but dropped on ETL. (D-031.)
- The ETL explode/flatten is a generic engine parameterized by per-agent traits (content parsing, block→column mapping, token-field locations, conversation composition), enabling token usage analysis by model/type/project and attribution of tokens to the originating slash-command or agent-skill. (D-032.)

## 11. Open Questions

1. Should Phase 1 task input use existing rd3 task files directly, or define a smaller `TaskSpec` wrapper?
2. What is the exact YAML FSM config shape for `implement → check → fix-until-pass`? _(answered in `03_ARCHITECTURE.md` §FSM Grammar.)_
3. Which command should be the default check gate: `bun run check`, user config, or inferred from project?
4. Should `.spur/config.yaml` be hand-written first or generated by `spur init`?
5. Which single asset type should get first scaffold support after MVP: `skill` or `workflow`?
6. What is the minimum internal cooperation message envelope for Phase 3?
7. Which extension point should be externalized first after internal registry is stable?
