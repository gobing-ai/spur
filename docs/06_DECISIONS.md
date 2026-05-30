# 06 Decisions — Spur

[TOC]

**Version:** 0.9.0
**Derived from:** `docs/01_PRD.md` §10, `docs/03_ARCHITECTURE.md` §18
**Last Updated:** 2026-05-24 (v0.9.0)
**Owner:** Robin Min

> This document is the **single source of truth** for every resolved decision. When a decision is recorded here, source documents (`01_PRD.md` §10, `03_ARCHITECTURE.md` §18) should replace or reduce their inline decision text to a pointer to the canonical D-* entry below. No other document should contain full decision records.

---

## Decision Index

| ID | Title | Source | Date |
|----|-------|--------|------|
| [D-001](#d-001-spur-is-a-new-standalone-project) | Spur is a new standalone project | PRD §10 | 2026-05-08 |
| [D-002](#d-002-no-byok-or-key-storage-in-phases-05) | No BYOK or key storage in Phases 0–5 | PRD §10 · ADR-001 | 2026-05-08 |
| [D-003](#d-003-pi-as-default-coding-agent) | Pi as default coding agent | PRD §10 · ADR-002 | 2026-05-08 |
| [D-004](#d-004-wrap-airunner-as-the-phase-1-execution-base) | Wrap ai-runner as the Phase 1 execution base | PRD §10 · ADR-003 | 2026-05-08 |
| [D-005](#d-005-yaml-driven-rule-engine-with-rule-pack-compiler-boundary) | YAML-driven rule engine with rule-pack compiler boundary | PRD §10 · ADR-004 · Task 0102 | 2026-05-08 / 2026-05-15 |
| [D-006](#d-006-fsm-driven-workflow-engine-with-workflow-compiler-boundary) | FSM-driven workflow engine with workflow compiler boundary | PRD §10 · ADR-005 · Task 0103 | 2026-05-08 / 2026-05-16 |
| [D-007](#d-007-gates-as-transition-predicates-not-actions) | Gates as transition predicates, not actions | PRD §10 · ADR-006 | 2026-05-08 |
| [D-008](#d-008-five-spur-categories-as-peer-packages) | Five Spur categories as peer packages | ADR-007 | 2026-05-08 |
| [D-009](#d-009-workspace-as-static-binding-record) | Workspace as static binding record | PRD §10 · ADR-008 | 2026-05-08 |
| [D-010](#d-010-cli-only-phase-1-web-deferred-to-phase-2) | CLI-only Phase 1; web deferred to Phase 2 | PRD §10 · ADR-009 | 2026-05-08 |
| [D-011](#d-011-rg-and-sg-only-for-phase-1-evaluators) | `rg` and `sg` only for Phase 1 evaluators | PRD §10 · ADR-010 | 2026-05-08 |
| [D-012](#d-012-redaction-as-pre-persistence-etl-stage) | Redaction as pre-persistence ETL stage | PRD §10 · ADR-011 | 2026-05-08 |
| [D-013](#d-013-append-only-runevent-store) | Append-only RunEvent store | ADR-012 | 2026-05-08 |
| [D-014](#d-014-internal-registry-before-external-plugin-loader) | Internal registry before external plugin loader | PRD §10 · ADR-013 | 2026-05-08 |
| [D-015](#d-015-exclude-acpacpx-and-rd3-orchestration-v1v2) | Exclude ACP/acpx and rd3 orchestration v1/v2 | PRD §10 · ADR-014 | 2026-05-08 |
| [D-016](#d-016-rd3-task-lifecycle-reused-not-rebuilt) | rd3 task lifecycle reused, not rebuilt | PRD §10 | 2026-05-08 |
| [D-017](#d-017-phase-1-uses-spur-native-run-events-only) | Phase 1 uses Spur-native run events only | PRD §10 | 2026-05-08 |
| [D-018](#d-018-asset-system-starts-minimal) | Asset system starts minimal | PRD §10 | 2026-05-08 |
| [D-019](#d-019-agent-health-output-matches-airunner-doctor-contract) | Agent health output matches airunner doctor contract | PRD §10 · D-028 | 2026-05-08 / 2026-05-19 |
| [D-020](#d-020-ai-runner-lives-in-kernel) | AI Runner lives in Kernel | PRD §10 | 2026-05-08 |
| [D-021](#d-021-cli-flag-naming-agent-not-channel) | CLI flag naming: `--agent`, not `--channel` | This doc | 2026-05-11 |
| [D-022](#d-022-spur-agents-removed-agent-list-owns-health-inspection) | `spur agents` removed; `agent list` owns health inspection | This doc · D-028 | 2026-05-11 / 2026-05-19 |
| [D-023](#d-023-env-var-airunner_channel-renamed-to-spur_agent) | Env var `$AIRUNNER_CHANNEL` renamed to `$SPUR_AGENT` | This doc | 2026-05-11 |
| [D-024](#d-024-rule-engine-host-owns-capability-registries) | Rule engine host owns capability registries | Task 0090 / W2a-W7 | 2026-05-15 |
| [D-025](#d-025-cli-entity-centric-refactoring) | CLI entity-centric refactoring | This doc | 2026-05-15 |
| [D-026](#d-026-rule-engine-extension-system) | Rule engine extension system | This doc | 2026-05-15 |
| [D-027](#d-027-rehome-profile-loading-to-core-loader-and-kernel-owned-config) | Rehome profile loading to `core/loader` and kernel-owned config | Task 0116 | 2026-05-17 |
| [D-028](#d-028-cli-command-files-are-transport-wrappers) | CLI command files are transport wrappers | Task 0126 | 2026-05-19 |
| [D-029](#d-029-history-subsystem-naming-alignment) | History subsystem naming alignment | Task 0130 | 2026-05-20 |
| [D-030](#d-030-workflow-engine-workspace-decoupling) | Workflow engine workspace decoupling | Task 0139 · Tasks 0140–0143 | 2026-05-21 |
| [D-031](#d-031-history-etl-standardized-layer-between-raw-and-normalized) | History ETL standardized layer between raw and normalized | Task 0152 | 2026-05-24 |
| [D-032](#d-032-generic-etl-engine-with-per-agent-traits) | Generic ETL engine with per-agent traits | Task 0152 | 2026-05-24 |

---

## D-001: Spur is a new standalone project

**Source:** PRD §10 · **Date:** 2026-05-08

**Decision.** Spur is a new standalone project, not a fork or extension of rd3, cc-bridge, or magnifier. It builds on the `typescript-bun-starter` monorepo base.

**Consequences.**
- Package topology, CI, and tooling are Spur-owned.
- External projects contribute as reference inputs (PRD §2), not as direct extraction targets.
- Code reuse is intentional and declared per ADR/D-0xx entry.

---

## D-002: No BYOK or key storage in Phases 0–5

**Source:** PRD §10 · ADR-001 · **Date:** 2026-05-08

**Decision.** Spur does not own, store, or proxy LLM provider keys in Phases 0–5. BYOK, sandboxing, and secret/key storage are deferred to Phase 6+. Agent health inspection reports an agent's authentication state by invoking the agent's own self-report — Spur never reads credentials directly.

**Consequences.**
- ai-runner remains a thin wrapper rather than a key-managing layer.
- Failure modes for unauthenticated agents are opaque to Spur.
- A future BYOK phase will require a new decision and a key-management subsystem.

**Alternatives considered.** Minimal keychain integration. Rejected — even minimal key handling demands threat-modeling disproportionate to early-phase value.

---

## D-003: Pi as default coding agent

**Source:** PRD §10 · ADR-002 · **Date:** 2026-05-08

**Decision.** Pi is the system-wide default coding agent. Selection precedence: invocation flag → workspace binding → profile default → built-in default (Pi).

**Consequences.**
- Pi's availability is part of Phase 1 acceptance criteria.
- Documentation and examples assume Pi unless stated otherwise.

**Alternatives considered.** Claude Code or Codex as default. Rejected — Pi's customization is the closest match to Spur's harness style.

---

## D-004: Wrap ai-runner as the Phase 1 execution base

**Source:** PRD §10 · ADR-003 · **Date:** 2026-05-08

**Decision.** Phase 1 wraps the existing `airunner` script (`~/projects/cc-agents/scripts/airunner.ts`) via subprocess invocation. Phase 2 extracts it into a typed library after the wrapper has been exercised end-to-end.

**Consequences.**
- Phase 1 ships faster.
- The wrapper boundary becomes an architectural seam — the kernel-side contract does not change when extraction happens.

**Alternatives considered.** Reimplementing from scratch in Phase 1. Rejected — too much engineering before the harness loop is validated.

---

## D-005: YAML-driven rule engine with rule-pack compiler boundary

**Source:** PRD §10 · ADR-004 · Task 0102 · **Date:** 2026-05-08 · **Amended:** 2026-05-15 · **Superseded in part by:** D-027 (2026-05-17 — see below)

> **D-027 amendment.** The ownership rows below referring to `@spur/profiles` are retired. Rule authoring schemas (rule files, presets, extension references), preset composition, source-layer merging, and rule normalization move to `@spur/kernel/src/rules/config`. Generic YAML/file/source-loading primitives move to `@spur/core/loader`. `@spur/contracts` retains shared DTOs and cross-tier HTTP/event contracts only — engine-specific authoring schemas leave `contracts` and travel with the engine. The boundary that "the rule engine does not import raw YAML or filesystem APIs" still holds — it now means rule *evaluation* code (`rules/host`, `rules/evaluators`, ...) does not, while the sibling `rules/config` module is the authorised loader. See D-027 for the rationale.

**Decision.** Constraint rules remain declarative YAML consumed by a generic rule engine. YAML owns policy. Code owns evaluators, fixers, finding output, host/capability registration, and rule-pack compiler semantics.

The original wording, "Profiles, not the kernel, read YAML," is replaced by a finer boundary:
- `@spur/contracts` owns rule, preset, source, and finding schemas plus DTO types. *(Superseded by D-027: engine-specific authoring schemas move to `@spur/kernel/src/rules/config`; `@spur/contracts` keeps only cross-tier DTOs.)*
- `@spur/tooling` owns reusable, package-agnostic YAML parsing/validation helpers and pure path/glob/collection helpers. *(Superseded by D-027: generic YAML/file/source loading mechanics move to `@spur/core/loader`. Pure string/path helpers remain in `@spur/tooling`.)*
- `@spur/core` owns runtime filesystem, process, and module-loading primitives.
- `@spur/profiles` owns profile discovery and project configuration loading: locating `.spur/config.yaml`, resolving profile defaults, and producing configured rule/workflow source roots. *(Superseded by D-027: `@spur/profiles` is retired. Discovery and configuration loading now live in `@spur/kernel/src/rules/config` and `@spur/kernel/src/workflow/config`, layered on top of `@spur/core/loader`.)*
- `@spur/kernel` owns the rule-engine domain: rule-pack compilation, preset composition semantics, source-layer merge semantics, rule reference normalization, extension reference binding to `RuleEngineHost`, built-in evaluators/fixers/resolvers, and evaluation.

The kernel must not import raw YAML or direct filesystem APIs for rule-pack loading unless a later decision explicitly changes the runtime boundary. It receives parsed documents, source descriptors, or loader adapters from the packages above and turns them into executable rule packs.

**Consequences.**
- Adding a rule is a config change, not a code change.
- New evaluators require code (and a decision if they introduce new dependencies — see D-011).
- Rule-engine semantics stay cohesive with host/evaluator/fixer contracts instead of accumulating under `profiles/src/rules`.
- `profiles` remains a configuration/profile package, not an alternate rule-engine package.
- Shared YAML and validation helpers become reusable project infrastructure, not one-off parser code hidden in the rule engine.
- Task 0102 must validate the current `packages/profiles/src/rules` split and either migrate rule-pack compiler logic to the decided owner or record a new decision if evidence supports keeping it there.

**Alternatives considered.**
- Profiles owns all YAML, preset, source, and extension normalization. Amended/rejected — this caused `profiles/src/rules` to grow into a second rule subsystem and separated rule-pack semantics from rule evaluation.
- Kernel owns raw YAML and filesystem loading. Rejected — that couples rule execution to runtime I/O and weakens the runtime boundary.
- Create a dedicated `@spur/rules` package. Deferred — useful if the kernel grows too broad, but premature before Task 0102 proves a separate package boundary is needed.
- Code-defined rules. Rejected — project rules drift too quickly to live in TypeScript.

---

## D-006: FSM-driven workflow engine with workflow compiler boundary

**Source:** PRD §10 · ADR-005 · Task 0103 · **Date:** 2026-05-08 · **Amended:** 2026-05-16 · **Superseded in part by:** D-027 (2026-05-17 — see below)

> **D-027 amendment.** The ownership rows below referring to `@spur/profiles` are retired. Workflow authoring schemas, source layering, dialect dispatch, and normalization now live under `@spur/kernel/src/workflow/config` on top of `@spur/core/loader` primitives. The kernel boundary "execution code does not import raw YAML or filesystem APIs" still holds — the `workflow/driver` and `workflow/host` modules consume only normalized values produced by their sibling `workflow/config` module. D-027 also introduces the dialect discriminator: missing or `state-machine` `kind` keeps existing behavior; `kind: transition-flow` is accepted at the config layer ahead of its runtime driver (see Task 0120).

**Decision.** Internal workflows remain declarative FSM definitions executed by a generic engine. The grammar is states, one entry action per non-terminal state, ordered transitions, transition gates, transition guards, terminal states, and iteration bounds.

The ownership boundary is:
- `@spur/contracts` owns the authored workflow schema, JSON Schema artifact, normalized workflow DTO shape if/when shared across packages, and structured validation error DTOs. *(Superseded by D-027: authoring schemas and JSON Schema artifacts move to `@spur/kernel/src/workflow/config`. `@spur/contracts` keeps only the cross-tier `WorkflowState`/`PhaseRun`/event DTOs.)*
- `@spur/tooling` owns reusable YAML parsing/validation helpers and pure path helpers used by workflow loaders. *(Superseded by D-027: YAML/file mechanics move to `@spur/core/loader`. Pure path/string helpers may remain in `@spur/tooling`.)*
- `@spur/core` owns runtime primitives used by workflow execution, such as process execution, event-bus infrastructure, filesystem adapters, and persistence/runtime wiring. D-027 adds `@spur/core/src/loader` for generic YAML/file/source-loading primitives.
- `@spur/profiles` owns workflow file discovery and project configuration loading: locating configured workflow source roots, resolving local/global/configured/explicit source layers, reading YAML, applying structural schema validation, detecting unsupported authored shapes, resolving profile-level defaults, and adapting authored files into the normalized workflow object accepted by the workflow-engine boundary. *(Superseded by D-027: `@spur/profiles` is retired. All of this moves to `@spur/kernel/src/workflow/config`, with the generic mechanics delegated to `@spur/core/loader`.)*
- `@spur/kernel/src/workflow` owns workflow-engine domain semantics: semantic validation, workflow compiler invariants, action/gate/guard contracts, host registry binding, transition selection order, driver loop, state persistence boundary, action lifecycle events, variable interpolation timing, static analysis helpers, Mermaid rendering, and built-in actions/guards/gates.

`profiles` may perform loader-time checks to return useful file/path errors, but canonical workflow semantic validation must live in `@spur/kernel/src/workflow` or a shared contract package, not as profile-only behavior. *(After D-027: read "the workflow config module under `@spur/kernel/src/workflow/config` may perform loader-time checks ...".)* The kernel must not import raw YAML or direct filesystem APIs to load workflow definitions unless a later decision explicitly changes the runtime boundary. It consumes normalized workflow objects, descriptors, or loader adapters produced by the packages above.

`packages/kernel/src/fsm` and the `@spur/kernel/fsm` subpath were legacy implementation artifacts from the pre-refactor FSM module. They were removed in Task 0112; consumers import from `@spur/kernel/workflow` or the top-level `@spur/kernel` barrel.

**Consequences.**
- Workflow correctness becomes a definition concern, separable from execution.
- New workflow shapes are config additions.
- The engine is reusable for non-run pipelines (Phase 2 ETL — see D-012).
- Workflow grammar changes require updating contracts and kernel FSM semantics together; profile loaders should stay thin adapters around shared parsing/schema helpers.
- `profiles/src/workflows` must not become an alternate workflow engine or the canonical owner of workflow invariants.
- Future work in `packages/kernel/src/workflow` should consolidate semantic checks, planning, transition analysis, action/gate/guard binding, compiler diagnostics, and execution behavior there before adding new workflow constructs.

**Alternatives considered.**
- Profiles owns workflow normalization and semantic validation, kernel only drives the normalized object. Amended/rejected — this splits workflow grammar semantics away from the engine and risks profile-only behavior that the driver cannot reason about.
- Kernel owns raw YAML and filesystem workflow loading. Rejected — that couples FSM execution to project I/O and weakens the runtime/package boundary.
- `packages/kernel/src/fsm` and `@spur/kernel/fsm` were deleted in Task 0112. The canonical workflow surface is `@spur/kernel/workflow`.
- Create a dedicated `@spur/workflows` or `@spur/fsm` package. Deferred — useful if `packages/kernel/src/workflow` grows beyond kernel cohesion, but premature before a focused workflow refactor proves the need.
- Procedural orchestrators. Rejected for the fragility surfaced by rd3 v1/v2.

---

## D-007: Gates as transition predicates, not actions

**Source:** PRD §10 · ADR-006 · **Date:** 2026-05-08

**Decision.** Gates are predicates evaluated on FSM transitions. The engine evaluates a gate only when considering a transition. The action that ran before the gate is the implement/fix step itself.

**Consequences.**
- No gate pseudo-state in the FSM grammar.
- Iteration bounding lives on transition guards, not on counter-incrementing actions.
- Multiple transitions out of one state can each carry their own gate.

**Alternatives considered.** Gates as FSM actions. Rejected — produces a larger grammar and pushes counter logic into actions.

---

## D-008: Five Spur categories as peer packages

**Source:** ADR-007 · **Date:** 2026-05-08

**Decision.** Each Spur product category (Kernel, Profiles, Workspaces, Assets, Tooling) is a peer package alongside the starter's `core`/`contracts`/`api-types`. Inter-category dependencies become `import` lines, checkable by the rule engine.

**Consequences.**
- Boundary violations become compile-time errors when paired with the `import-boundary` rule.
- `core` retains its starter-inherited scope (runtime, db, event-bus, telemetry).
- Adding a category is a package addition, not a refactor of `core`.

**Alternatives considered.** Nested under `core`. Rejected — boundaries inside one compilation unit drift over time.

---

## D-009: Workspace as static binding record

**Source:** PRD §10 · ADR-008 · **Date:** 2026-05-08

**Decision.** Workspace is a static binding record (repo + workdir + agents + workflow + purpose) with no mutable lifecycle field. Run owns lifecycle. Git context is computed at read time, not stored.

**Consequences.**
- The workspace registry never carries stale branch or status data.
- `Run.workspace_id` references a stable entity.
- Multiple concurrent runs against one workspace are naturally supported.

**Alternatives considered.** Workspace-owned lifecycle. Rejected — duplicates Run state.

---

## D-010: CLI-only Phase 1; web deferred to Phase 2

**Source:** PRD §10 · ADR-009 · **Date:** 2026-05-08

**Decision.** Phase 1 ships CLI-only. Read-only web inspection moves to Phase 2 alongside the asset registry.

**Consequences.**
- Phase 1 surface area shrinks.
- `apps/server` and `apps/web` remain in the topology but ship no Spur routes in Phase 1.
- Web design benefits from Phase 1 data shape feedback.

**Alternatives considered.** Optional Phase 1 web. Rejected — "optional" features tend to ship half-built.

---

## D-011: `rg` and `sg` only for Phase 1 evaluators

**Source:** PRD §10 · ADR-010 · **Date:** 2026-05-08

**Decision.** Phase 1 evaluators (`path`, `regex`, `import-boundary`, `tsdoc-export`, `test-location`) use `rg` (ripgrep) and `sg` (ast-grep) only. Tree-sitter–backed evaluators land in Phase 2.

**Consequences.**
- Phase 1 has fewer dependencies.
- New Phase 1 rules must be expressible with regex or ast-grep patterns.

**Alternatives considered.** Tree-sitter from Phase 1. Rejected — premature for Phase 1 rule needs.

---

## D-012: Redaction as pre-persistence ETL stage

**Source:** PRD §10 · ADR-011 · **Date:** 2026-05-08

**Decision.** Redaction is the pre-processing stage of an ETL pipeline. Phase 1 hardcodes redaction at the persistence boundary as a single stage. Phase 2 generalizes to a multi-stage ETL workflow executed by the FSM engine (D-006). The redaction rule pack is shared between both via `@spur/contracts`.

**Consequences.**
- No event payload reaches storage without passing redaction — architectural invariant.
- Phase 2 ETL reuses D-006's engine — no new orchestration primitive.

**Alternatives considered.** Redaction as opt-in middleware. Rejected — invariants that depend on configuration tend to fail silently.

---

## D-013: Append-only RunEvent store

**Source:** ADR-012 · **Date:** 2026-05-08

**Decision.** `RunEvent` is append-only. Updates that look like mutations (run finished, phase exited) are emitted as new events. Projections compute the latest state.

**Consequences.**
- ETL input is trivial — immutable history.
- Re-derivation cannot re-leak secrets (redaction ran before the original write — D-012).
- Storage grows monotonically; pruning is a future concern with its own decision.

**Alternatives considered.** Mutable rows. Rejected — couples persistence to projection logic.

---

## D-014: Internal registry before external plugin loader

**Source:** PRD §10 · ADR-013 · **Date:** 2026-05-08

**Decision.** Phases 1–3 use a first-party internal registry — typed map of name → implementation. Phase 4 promotes to a manifest-loaded external plugin loader without changing the seam contract.

**Consequences.**
- Phase 1 ships faster.
- First-party and plugin contributions remain interchangeable.

**Alternatives considered.** External plugin loader from Phase 1. Rejected — too much surface area before seams are stable.

---

## D-015: Exclude ACP/acpx and rd3 orchestration v1/v2

**Source:** PRD §10 · ADR-014 · **Date:** 2026-05-08

**Decision.** Spur excludes ACP/acpx as an execution path and does not directly reuse rd3 orchestration v1/v2. Both remain reference-only sources of design lessons. rd3 orchestration-v2's DAG + FSM-lifecycle + event-sourced-state model informs D-006, D-007, and D-013 — but no code is extracted from it.

**Consequences.**
- Spur's execution layer is built fresh on ai-runner (D-004) and the FSM engine (D-006).
- Patterns from rd3 (skills, task lifecycle, `/rd3:dev-*` flows) are still consumed; only the orchestrators are excluded from code reuse.

**Alternatives considered.** Wrap ACP. Rejected for reliability reasons.

---

## D-016: rd3 task lifecycle reused, not rebuilt

**Source:** PRD §10 · **Date:** 2026-05-08

**Decision.** The mature rd3 task lifecycle and `/rd3:dev-*` workflows are reused in Phase 1 rather than rebuilt from scratch. Spur references existing rd3 assets as its initial task/workflow foundation.

**Consequences.**
- Phase 1 task input can use existing rd3 task files directly.
- Spur-native task authoring and decomposition are deferred.

---

## D-017: Phase 1 uses Spur-native run events only

**Source:** PRD §10 · **Date:** 2026-05-08

**Decision.** Phase 1 captures only Spur-native run events. External coding-agent history import (Claude, Codex, Pi, OpenCode) is deferred to Phase 2.

**Consequences.**
- The Phase 1 event taxonomy and capture surface are smaller.
- External history parsers are Phase 2 deliverables.

---

## D-018: Asset system starts minimal

**Source:** PRD §10 · **Date:** 2026-05-08

**Decision.** The asset system starts as reference/inspect/minimal manifest. Full scaffold/package/adapt/export is deferred to later phases (Phase 4).

**Consequences.**
- Phase 1 asset support: registry, inspect, manifest validation.
- Asset authoring and cross-platform export are not Phase 1 concerns.

---

## D-019: Agent health output matches airunner doctor contract

**Source:** PRD §10 · **Date:** 2026-05-08 · **Amended by:** D-028

**Decision.** Agent health inspection reports per-agent status using the same columns as `airunner doctor`: `installed / version / authenticated / usable`. It does not probe LLM-provider keys — it only invokes each agent's own self-report. D-028 moves this surface to entity-centric `spur agent list`.

**Consequences.**
- `spur agent list` output is compatible with existing ai-runner diagnostic workflows.
- Key-provider status is the agent's responsibility, not Spur's.

---

## D-020: AI Runner lives in Kernel

**Source:** PRD §10 · **Date:** 2026-05-08

**Decision.** The AI Runner / Executor engine lives in the Kernel category as a coding-agent-agnostic engine. The Tooling layer does not duplicate execution capability.

**Consequences.**
- One execution primitive serves all workflows.
- Workspaces bind to agents; the kernel dispatches to the bound agent via ai-runner.

---

## D-021: CLI flag naming: `--agent`, not `--channel`

**Source:** This doc · **Date:** 2026-05-11 · **Supersedes:** task 0066

**Decision.** Every Phase-1 command that selects an underlying coding agent uses `-a, --agent <name>`. The short flag `-c` is reserved exclusively for `--continue` (resume previous session — industry convention shared by `claude`, `codex`, `gemini`, `pi`).

**Context.** Task 0066 renamed `--agent` → `--channel` across the legacy top-level run command, the former doctor command, and `spur workspace add`. This collided with run-resume `-c, --continue` (the `-c` short flag bound to `--channel` on some commands and `--continue` on others, depending on registration order). The term "channel" also conflicts with the existing data field `DetectedAgent.channels` (the per-agent list of available models), which is a different concept.

**Consequences.**
- `RunCommandOptions.agent`, `DoctorCommandOptions.agent`, workspace-add `--agent` are the canonical names.
- `resolveChannel()` → `resolveAgent()`; `ChannelResolution` → `AgentResolution`.
- `RunContext.channel` → `RunContext.agentOverride` (FSM action types).
- The `DetectedAgent.channels: string[]` data field is unchanged — it represents per-agent model lists, not flag values.
- `packages/kernel/src/ai-runner/channel-resolver.ts` is deleted; resolution logic is inlined in `apps/cli/src/commands/run.ts`.

**Alternatives considered.**
- _Keep `--channel`, rebind `-c` to `--continue` only._ Rejected: the naming still conflicts with the data field and misaligns with all reference coding-agent CLIs.
- _Use `--backend`._ Rejected: less natural than "agent" for AI-coding-agent CLIs.

---

## D-022: `spur agents` removed; `agent list` owns health inspection

**Source:** This doc · **Date:** 2026-05-11 · **Supersedes:** F-1.3.4, Roadmap §1.3.3 · **Amended by:** D-028

**Decision.** The `spur agents` CLI command is removed. The original top-level health surface is also retired by D-028; the canonical inspection command is now `spur agent list`.

**Context.** `spur agents` was specified as the cheapest agent listing and foundation for the original health command (F-1.3.4). In practice every column in `spur agents` was a strict subset of the health output, and the health probe already ran in well under one second on the operator's machine. Maintaining two commands with overlapping responsibilities created an inconsistent surface (different formatters, different test fixtures, different docs sections) without any user-visible benefit.

**Consequences.**
- `apps/cli/src/commands/agents.ts`, `apps/cli/src/formatters/agents.ts`, and their tests are deleted.
- Roadmap §1.3.3 is marked removed; F-1.3.4 is marked removed.
- `docs/04_DESIGN.md` §2.4 (was `spur agents`) deleted; §2.5–§2.11 renumbered to §2.4–§2.10.
- `docs/03_ARCHITECTURE.md` §17.2 command table no longer lists `spur agents`.
- D-028 preserves the PRD §10/B3 health output shape under `spur agent list`; only the command placement changes.

**Alternatives considered.**
- _Keep `spur agents` as a compact one-liner for scripting._ Rejected: JSON health output already serves that need with strictly more information.
- _Alias `spur agents` to the health command._ Rejected: aliases create discoverability noise without solving any real problem.

---

## D-023: Env var `$AIRUNNER_CHANNEL` renamed to `$SPUR_AGENT`

**Source:** This doc · **Date:** 2026-05-11 · **Companion to:** D-021

**Decision.** The environment variable that selects an agent for `spur agent run --agent current` is `$SPUR_AGENT`. The legacy name `$AIRUNNER_CHANNEL` is removed (no compatibility shim).

**Context.** The legacy name carried both the rejected "channel" terminology (D-021) and the historical `airunner` prefix from the original wrapped script. Renaming aligns the env var with the product name and the canonical flag.

**Consequences.**
- `spur agent run --agent current` reads from `$SPUR_AGENT`; unset or empty falls through to the next precedence step (workspace default).
- CLI help text and tests reference `$SPUR_AGENT` exclusively.
- This is a breaking change for any shell profile or CI step exporting `$AIRUNNER_CHANNEL`; users must rename it.

---

## D-024: Rule engine host owns capability registries

**Source:** Task 0090 / W2a-W7 · **Date:** 2026-05-15

**Decision.** Rule engine capabilities are registered through `RuleEngineHost`, which owns evaluator, fixer, resolver, and formatter registries. Built-ins and extensions use the same registration path; extension registration may override built-ins with an explicit warning.

**Consequences.**
- `RuleEngine` stays an orchestrator over a host instead of a registry container.
- Preset-loaded extensions can participate without special-case engine wiring.
- Static built-in maps are deprecated and must not be reintroduced.
- Built-in wiring is centralized in `host/builtins.ts`, called once from the `RuleEngine` constructor.

**Alternatives considered.** Static maps in `RuleEngine` plus separate plugin hooks. Rejected because it recreates the POC drift that task 0090 exists to remove.

---

## D-025: CLI entity-centric refactoring

**Source:** This doc · **Date:** 2026-05-15 · **Amended by:** D-028

**Decision.** The first-layer `spur` commands are refactored around key domain entities. Each entity becomes a subcommand group with its own lifecycle:

- `spur rule` — already refactored. Entity: constraint rules. Stable command surface.
- `spur agent` — stable. Agent invocation UX lives under `spur agent run`; agent health/listing UX lives under `spur agent list`. The legacy top-level run command remains as a backward-compatible alias during migration.
- `spur workflow` — will be re-implemented following the same entity-centric pattern as `spur rule`. Current `spur workflow` command is transitional; the next iteration aligns it with the host/registry/extension architecture proven in the rule engine.

Commands that are **not** entity-centric and remain stable:
- `spur help` — utility command. No entity.
- `spur init` — project bootstrap. No entity.

Commands with **undecided** direction:
- `spur workspace` — may become an entity group or remain standalone. Decision deferred.

Resolved since:
- `packages/profiles` direction → see D-027 (package retired; ownership split between `@spur/core/loader` and engine-owned `@spur/kernel/src/{rules,workflow}/config`).

**Consequences.**
- `spur rule` is the reference implementation for entity-centric command groups.
- Future entity commands follow `spur rule`'s pattern: host-driven registries, extension loading, YAML-driven configuration, host-owned capability registries.
- Legacy top-level run → `spur agent run` migration is gradual; no hard cutover date.
- The former top-level health command → `spur agent list` is a direct surface conversion; the doctor-style health output shape is preserved.
- `spur workflow` rewrite uses the same host/evaluator/fixer registry pattern.
- Stable utility commands (`help`, `init`, `doctor`) are not subject to entity refactoring.

**Alternatives considered.**
- _Flat command surface with no entity grouping._ Rejected — the flat surface already shows strain around action-vs-entity command naming, with no clear ownership of subcommand namespaces.
- _Big-bang refactor of all commands at once._ Rejected — too much risk. Gradual migration lets each entity group stabilize independently.
- _Keep the legacy top-level run command as-is permanently._ Rejected — `run` is an action, not an entity; the entity it operates on is the agent, and the command should reflect that.

---

## D-026: Rule engine extension system

**Source:** This doc · **Date:** 2026-05-15

**Decision.** The rule engine supports a dynamic extension system that lets presets declare custom evaluators, fixers, resolvers, and formatters as local modules loaded at evaluation time.

Extension loading is **disabled by default**. It must be explicitly enabled in the profile config (`rules.allowExtensions: true`). Extensions are declared in preset YAML under the `extensions:` block. `@spur/kernel/src/rules/config` resolves extension paths to absolute module paths (D-027 retired the prior `@spur/profiles` ownership); `@spur/kernel/src/rules/host` validates each module against a per-kind duck-type contract and registers it on the host.

Per-kind contract validation uses duck-typing (required property presence + type checks), not `instanceof`. Each kind requires specific properties:

| Kind | Required properties | Registry key |
|------|---------------------|-------------|
| resolver | `name`, `resolveTestPath` | `name` |
| evaluator | `type`, `evaluate` | `type` |
| fixer | `name`, `createFixes` | `name` |
| formatter | `name`, `format` | `name` |

Conflict policy: extension overrides built-in (warning), extension overrides extension (warning, latest wins), duplicate built-in throws (always a bug). Child presets override parent presets because later preset-chain entries register later.

**Consequences.**
- Extension loading is a profile-gated opt-in, not a default behavior.
- `ExtensionLoadError` provides structured error codes for diagnostics.
- The extension system is the same mechanism used for all four capability registries — no special-case loading paths.
- Auto-fix authority (three-layer: rule YAML → preset overrides → CLI flags) applies to all fixer providers, including extension-contributed ones.

**Alternatives considered.**
- _Extensions enabled by default._ Rejected — dynamic module loading is a security surface; opt-in is the safer default.
- _Separate plugin loading path for extensions._ Rejected — the host registry is the single registration path; adding a parallel mechanism recreates the two-path drift that D-024 eliminated.

---

## D-027: Rehome profile loading to `core/loader` and kernel-owned config

**Source:** Task 0116 · **Date:** 2026-05-17 · **Supersedes (in part):** D-005, D-006, D-026

**Context.** `packages/profiles` had grown to own three unrelated concerns: (1) generic YAML/file/source-loading mechanics, (2) rule-engine authoring schemas, preset composition, source layering, extension resolution, and (3) workflow-engine authoring schemas, source layering, and normalization. Earlier decisions (D-005, D-006) carved this boundary when the rule and workflow engines were less mature. After the rule-engine refactor (D-024, D-026) and the workflow-engine refactor (Task 0112), the engine-local config logic became visibly disconnected from its engine, and `profiles/src/{rules,workflows}` started behaving like alternate engines. Adding a transition-flow workflow dialect cleanly required this split to be resolved first.

**Decision.** Retire `packages/profiles`. Move ownership along functional seams:

| Concern | New Owner | Rationale |
| --- | --- | --- |
| YAML read/parse, schema validation adapter, source path resolution, structured loader errors | `@spur/core/src/loader` | Runtime-generic utility; usable by any future config consumer; no kernel dependency |
| Rule file/preset/extension schemas, preset composition, rule source merging, rule normalization, extension reference resolution, rule JSON Schema artifact | `@spur/kernel/src/rules/config` | Rule-engine authoring semantics belong with the rule engine |
| Workflow authoring schemas (state-machine and transition-flow), workflow source merging, dialect dispatch, workflow normalization, workflow JSON Schema artifact | `@spur/kernel/src/workflow/config` | Workflow-engine authoring semantics belong with the workflow engine |
| Cross-tier DTOs (`Run`, `PhaseRun`, `RunEvent`, `ConstraintFinding`, `WorkflowState`, redaction metadata, HTTP/event contracts) | `@spur/contracts` | Stable cross-tier shapes |

Direction rules:
```text
apps/* -> @spur/kernel -> @spur/core
apps/* -> @spur/contracts
@spur/kernel -> @spur/core
@spur/kernel -> @spur/contracts
@spur/core -> @spur/contracts

Forbidden:
@spur/core -> @spur/kernel
@spur/contracts -> @spur/kernel
@spur/kernel -> @spur/profiles    (package no longer exists)
apps/* -> @spur/profiles          (package no longer exists)
```

**Workflow dialect foundation.** The new `@spur/kernel/src/workflow/config` introduces a discriminated union:

```ts
type WorkflowDialect = "state-machine" | "transition-flow";

type AuthoredWorkflowConfig =
  | StateMachineWorkflowConfig
  | TransitionFlowWorkflowConfig;

type NormalizedWorkflow =
  | NormalizedStateMachineWorkflow
  | NormalizedTransitionFlowWorkflow;
```

Rules:
- Missing `kind:` is treated as `state-machine` for backward compatibility.
- `kind: state-machine` keeps existing `initial` + `states[]` semantics.
- `kind: transition-flow` uses top-level `transitions[]`, trigger fields, and transition-flow-only validation.
- Cross-dialect fields are rejected at the loader.
- The runtime driver for `transition-flow` lands in a follow-up task (Task 0120). This decision only commits to the config foundation.

**Consequences.**
- Rule and workflow engines own their authoring contracts; preset composition and source layering can evolve with the engine.
- `@spur/core/loader` is reusable for any future configuration consumer that needs YAML + source layering + schema validation.
- `@spur/contracts` stops accumulating engine-private authoring schemas.
- The kernel rule "execution code does not import raw YAML or filesystem APIs" still holds. The sibling `*/config` modules are the only authorised loaders inside kernel; the import-boundary rule (Architecture §16) is tightened to whitelist them explicitly.
- Existing state-centric workflow YAML, `.spur/config.yaml`, and all CLI commands (`spur rule *`, `spur workflow *`, `spur init`) keep working without user-visible change.
- Transition-flow YAML now parses and validates today, before any runtime can execute it; this lets the downstream tasks (0117–0123) progress in parallel branches.
- Earlier decisions referencing `@spur/profiles` ownership (D-005 ownership rows; D-006 ownership rows; D-026 extension-path resolution) are superseded by this entry and updated in-place with amendment notes.

**Alternatives considered.**
- _Keep `packages/profiles` and only add the transition-flow schema._ Rejected — the existing split was already producing duplicate engine subsystems under `profiles/src/{rules,workflows}`, and adding a second workflow dialect on top of that structure would have entrenched the drift.
- _Move generic loaders into `@spur/tooling`._ Rejected — the loader is runtime-facing configuration infrastructure consumed by CLI/server execution paths, not a pure build-time helper. `@spur/tooling` keeps its purity invariant (no I/O, no global state).
- _Create a dedicated `@spur/rules` and `@spur/workflows` package pair._ Deferred — useful if `@spur/kernel` later outgrows its cohesion, but introducing two new top-level packages without that pressure is premature. Keeping rule/workflow config beside their engines inside `@spur/kernel` already gets the cohesion gain.
- _Keep engine authoring schemas in `@spur/contracts`._ Rejected — `@spur/contracts` is for cross-tier DTOs (CLI ↔ kernel, server ↔ web). Authoring formats are engine-private artifacts; co-locating them with the engine prevents `contracts` from becoming a dumping ground.

**Acceptance signals (from Task 0116).** No source file references `@spur/profiles` or `packages/profiles`; both workflow dialects load through `@spur/kernel/src/workflow/config`; `@spur/core` does not import `@spur/kernel`; `bun run check` passes.

---

## D-028: CLI command files are transport wrappers

**Source:** Task 0126 · **Date:** 2026-05-19 · **Amends:** D-022, D-025

**Decision.** Files under `apps/cli/src/commands` are transport adapters. They own Commander wiring, flag parsing, stdout/stderr writing, and process-exit application. Reusable command behavior belongs in package-owned application services so the same behavior can be exposed by `apps/server` without importing CLI code.

For coding-agent commands, `@spur/kernel` owns `AgentService`:
- `spur agent run` invokes the service's prompt/slash-command execution path.
- `spur agent list` invokes the service's doctor-style agent health listing path.
- The legacy top-level run command remains a backward-compatible alias for `spur agent run`.
- The former top-level health command is retired; its capability is converted to `spur agent list`.

**Consequences.**
- New CLI command files should stay thin and dependency-inject package services in tests.
- Server routes may call the package service directly instead of shelling out to the CLI or importing Commander modules.
- `agent list` preserves the old doctor output fields: agent, installed, version, authenticated, usable, tier, channels, and error.
- D-022's removal of the old `spur agents` command still stands; the replacement is the entity-centric `spur agent list`, not a resurrected top-level plural command.

**Alternatives considered.**
- _Keep the former top-level health command as a stable utility exception._ Rejected — once `agent list` exists, health inspection duplicates an entity operation and weakens the entity-first surface.
- _Keep the legacy top-level run implementation in the CLI and only add an alias._ Rejected — it blocks server reuse and violates the wrapper boundary.
- _Create a new `@spur/agents` package immediately._ Deferred — current agent execution already lives in `@spur/kernel`; a new package is warranted only if agent functionality outgrows kernel cohesion.

---

## D-029: History subsystem naming alignment

**Source:** Task 0130 · **Date:** 2026-05-20 · **Unblocks:** Tasks 0131-0138

**Context.** Task 0129 introduces a new analytics subsystem absorbed from the `magnifier` POC. The user-facing surface is fixed as `spur history import|analyze|report`, but the magnifier POC and the initial spur draft used a mix of `log-*` (packages, DB tables) and `History*` (planned types, future server routes). Leaving this mix unresolved would force every downstream subtask to negotiate naming and produce drift between command, package, service, schema, and report vocabulary. Migrations for the new schema have not been generated yet (task 0133 owns first migration), so the cost of choosing now is near-zero and the cost of switching later is high.

**Decision.** Use `history` as the canonical noun across every layer of the new subsystem.

| Layer | Name |
| --- | --- |
| Command group | `spur history` (`import`, `analyze`, `report`) |
| Packages | `@spur/history-ingest`, `@spur/history-analytics` |
| Service classes | `HistoryIngestService`, `HistoryAnalysisService`, `HistoryReportService` |
| DB table prefix | `history*` (e.g., `historyRawEvents`, `historyConversations`, `historyDailySummaries`) |
| DB schema files | `packages/core/src/db/schema/history-*.ts` |
| CLI command path | `apps/cli/src/commands/history/` |
| Public types | `HistoryPlatform`, `PlatformHistoryAdapter`, `HistoryRawEvent`, `HistoryTypedRawRow`, `ParsedHistoryRecord`, `HistoryImportOptions`, `HistoryImportResult`, `ReprojectionReport`, `CostReport`, `BehaviorReport`, `ProductivityReport`, `ToolReport` |
| Test fixture path | `packages/history-ingest/tests/fixtures/<platform>/`, `packages/history-analytics/tests/fixtures/`, `apps/cli/tests/commands/history/fixtures/` |
| User-facing report vocabulary | "history" / "conversation history" / "session"; avoid "log" in human output and JSON keys |

The magnifier POC's `log_*` table names are explicitly **not** preserved verbatim during the port. "Raw event ledger" semantics are still expressible via column/method names (`rawEvents`, `appendEvent`, `eventLedger`) — the `log` prefix carries no information that `history` cannot.

**Consequences.**
- Every schema file, service file, package directory, CLI command directory, test fixture, and report key uses `history` as the canonical noun. A repository-wide grep for `history` reaches every layer of the subsystem.
- Parent task 0129 is updated (package boundary table, DB schema table, service layer section, reference map, requirements) to replace the mixed `log-*` / `History*` draft with the chosen vocabulary.
- Subtasks 0131-0138 cite this decision instead of negotiating naming locally.
- Server routes for history analytics (deferred per task 0129) use `/api/history/*` paths calling `HistoryReportService` — symmetric across CLI, server, and storage.
- Migrations generated by task 0133 commit the `history*` table names; no rename migrations are anticipated.

**Alternatives considered.**
- *Keep `@spur/log-ingest` / `@spur/log-analytics` and `log*` tables for "raw event ledger" connotation.* Rejected — forces every contributor to mentally translate between the user-facing `history` and internal `log` at every layer crossing, and contradicts the recent convergence pattern (D-022, D-023, D-025, D-028) of one entity vocabulary across CLI, service, and storage. The ledger semantic is preserved through column and method names, not a package prefix.
- *Hybrid: `spur history` command + `@spur/log-*` internal + `log*` tables, with `log` defined as strictly internal storage vocabulary.* Rejected — the rationale ("internal vs external vocabulary") is the same one D-022/D-023 already rejected when retiring `$AIRUNNER_CHANNEL`/`spur agents`. Spur consistently picks one name and applies it everywhere.
- *Defer the decision and let subtasks pick locally.* Rejected — produces drift across 0131-0138 and forces a future rename through schema migrations. Parent task 0129 already shows this drift in its current draft, and downstream tasks already show partial divergence (e.g., 0131 uses `HistoryPlatform`; 0136/0138 still say `LogIngestService`).
- *Use `conversation` instead of `history` (e.g., `@spur/conversation-ingest`).* Rejected — the command group is `spur history`; introducing a third noun ("history" CLI + "conversation" internals) reintroduces the translation problem this decision exists to remove.

**Acceptance signals.** Parent task 0129 and subtasks 0131-0138 contain no remaining `@spur/log-*`, `LogIngestService`, `LogAnalysisService`, `LogReportService`, or `log*` table references outside Background/Naming Decision sections that document the rejected alternative. `tasks check 0129` and `tasks check 0130` pass.

---

## D-030: Workflow engine workspace decoupling

**Source:** Task 0139 · Tasks 0140–0143 · **Date:** 2026-05-21

**Decision.** Workspace-bearing fields (such as `workdir`, `workspaceId`, and `profileDir`) are optional at the workflow engine's runtime contract boundaries (`DriverRunContext`). The workflow engine no longer assumes that a workspace exists for execution. Actions that strictly require a workspace (like `agent.run`) must declare or require it explicitly in their own options or execution context.

**Consequences.**
- The workflow engine can now execute pure, non-agentic task pipelines (such as shell commands) without requiring workspace database records or physical workspace directories.
- `WorkflowService` context construction is cleaned up, removing fallback assignments (`this.deps.cwd()`) and type-coerced hacks (`prepared.run.workspaceId`).
- Downstream actions needing workspace directories must resolve them via workspace adapters rather than relying on global runner context.
- Failure paths preserve raw, untransformed `errorData: unknown` payload properties end-to-end.

**Alternatives considered.**
- *Retain mandatory workspace fields.* Rejected — forces non-agentic pipelines to construct dummy workspaces or carry mock paths, coupling the engine to agentic workspace tracking.

---

## D-031: History ETL standardized layer between raw and normalized

**Source:** Task 0152 · **Date:** 2026-05-24 · **Builds on:** D-012, D-013, D-029

**Context.** The history pipeline persists each source record as one row in a typed `history_raw_*` table, storing multi-block message content as a single JSON string in `content_text` (e.g. `[{"type":"text",...},{"type":"thinking",...},{"type":"tool_use",...}]`). The array is never exploded. Downstream consequences observed in real data: `content_text` is used only for a length count; `has_tool_use` is `0` on all 146,802 Pi rows despite 185 messages containing tool-use blocks; the Pi normalize handler matches `record_type = 'tool_call'` while the mapper writes `'toolCall'` (dead code); 140,573 raw Pi messages produced 0 normalized messages and 0 tool-usage rows; every token row collapsed to `model = 'codex-default'`; and `project_name` is dropped before reaching `history_conversation`. The product goal — token usage by model / type / project and attribution to the originating slash-command or agent-skill — is unreachable while content blocks stay locked inside an opaque JSON string.

`history_raw_event` does **not** persist the raw JSON payload; `content_text` on the typed raw tables is the **only** lossless copy of the content array. Redaction audit (`history_redaction_audit.raw_event_id` → `history_raw_event.id`) and `content_sha256` anchor integrity of that copy. D-012 already designates a multi-stage ETL pipeline as the Phase 2 generalization of redaction; D-013 makes the raw event store append-only and explicitly states "ETL input is trivial — immutable history" and derivations are recomputable.

**Decision.** Introduce a standardized **ETL layer** between the raw landing zone and the normalized analytics tables.

1. **Raw tables stay lossless and unchanged in role.** `history_raw_*` remains the append-only landing zone (D-013). `content_text` and `content_sha256` are **retained on raw tables** — they are the sole replay source and the redaction integrity anchor. Raw tables are never renamed and never mutated by ETL.
2. **New `history_etl_*` table family is the exploded, flattened, re-derivable projection.** A new ETL stage reads raw rows, explodes each `content_text` array into one row per content block, and flattens nested block objects into typed columns. Every ETL row carries at minimum a `type` discriminator (`text`, `thinking`, `tool_use`, `tool_result`, …) plus type-specific columns, and a `raw_event_id` lineage pointer back to `history_raw_event.id`. Table names follow a fixed mapping:

   | Raw table | ETL table |
   | --- | --- |
   | `history_raw_usage_claude` | `history_etl_usage_claude` |
   | `history_raw_transcript_claude` | `history_etl_transcript_claude` |
   | `history_raw_session_codex` | `history_etl_session_codex` |
   | `history_raw_session_pi` | `history_etl_session_pi` |
   | `history_raw_message_opencode` | `history_etl_message_opencode` |
   | `history_raw_message_gemini` | `history_etl_message_gemini` |
   | `history_raw_message_antigravity` | `history_etl_message_antigravity` |
   | `history_raw_message_openclaw` | `history_etl_message_openclaw` |

3. **`content_text` / `content_sha256` are dropped from the `history_etl_*` tables only** — never from `history_raw_*`. The ETL layer's job is the flattened standardized form; the raw layer keeps the lossless blob. (This corrects an earlier imprecise framing that suggested dropping the columns from raw tables.)
4. **`normalize` consumes `history_etl_*`, not raw.** The normalize phase and its per-platform handlers read flattened ETL rows instead of re-parsing `content_text`. The orchestrator gains an `etl` phase ordered before `normalize`.
5. **ETL is re-derivable, consistent with D-013.** ETL rows are a projection: drop-and-rebuild via `--force` exactly like the existing projection model. No append-only guarantee is claimed for ETL output; the guarantee lives on the raw layer.
6. **Attribution flows through ETL.** `model`, `project_name`, and identity columns are carried from raw → ETL → normalized so token usage can be grouped by model / type / project. Command/skill attribution (slash-command and agent/skill name extracted from the first user text block) is persisted to a dedicated normalized table downstream and is **impossible without this explode step**.

**Consequences.**
- D-013 append-only and D-012 replay/redaction invariants are preserved: raw stays immutable and lossless; ETL is a recomputable derivation.
- Migration of the 140k+ existing rows is non-destructive — backfill is "run the new ETL phase with `--force`," not a schema rename + column drop.
- Redaction audit and `content_sha256` integrity remain valid because raw tables are untouched.
- Storage grows (raw blob + flattened ETL rows); accepted — lossless replay and redaction verifiability outrank storage cost, and ETL rows store scalars rather than duplicating the JSON blob.
- The broken derived columns on raw Pi (`has_thinking`/`has_tool_use`/`tool_name`/`tool_input`/`tool_result`/`is_error`) are superseded by ETL columns and become candidates for the cleanup stage (see D-032 consequences).

**Alternatives considered.**
- *Explode in place: rename `history_raw_*` → `history_etl_*` and drop `content_text`/`content_sha256` from them.* Rejected — deletes the only lossless copy of the content array, breaks D-013 re-derivation and D-012 redaction verifiability, severs the `content_sha256` audit anchor, and forces a destructive 140k-row migration with no rollback. Conflates lossless capture (ingest) with structured derivation (ETL).
- *Store the raw JSON payload in `history_raw_event` and shrink typed raw tables.* Rejected for now — larger blast radius (ledger contract, loader, every mapper, new redaction surface for the payload column) without advancing the stated goal; deferred as a possible future consolidation.

---

## D-032: Generic ETL engine with per-agent traits

**Source:** Task 0152 · **Date:** 2026-05-24 · **Builds on:** D-014, D-031

**Context.** Source data shapes diverge sharply across the eight supported coding-agent record families, confirmed by inspecting each platform's Zod schema and real rows:

| Agent | Content shape | Token model | Conversation composition |
| --- | --- | --- | --- |
| Pi | `content[]` blocks: `text` / `thinking` / `tool_use` (tools embedded inside message content, **not** separate records) | inline `message.usage` per message | user + assistant turns, tools inline |
| Claude (usage) | `content[]` blocks or plain string | inline `usage` | usage records |
| Claude (transcript) | plain string content | inline `usage` | transcript turns |
| Codex | `{type, message: string}` — plain string, no blocks | **separate `token_count` events** (not per-message) | session_meta + event_msg |
| OpenCode | file = **array** of `{role, parts?, tokens}` | inline `tokens` per message | per-message array container |
| Gemini | user messages only | none | no assistant turns / no usage / no model |
| Antigravity | user messages only | none | no assistant turns / no usage / no model |
| OpenClaw | session entries | partial inline tokens | session-shaped |

A per-platform copy of explode/flatten/insert logic would duplicate the same loop eight times and drift. Conversely, a single hardcoded transform cannot express string-vs-block-vs-no-content, inline-vs-separate token accounting, or user-only conversations.

**Decision.** Build one **generic ETL engine** carrying all shared mechanics, parameterized by a per-agent **trait** (strategy object) that declares only agent-specific behavior. Consistent with D-014, traits are registered in a first-party internal registry keyed by platform; no external plugin loader in this phase.

**Generic engine owns (shared, written once):**
- Chunked read loop over the raw table, `processing_status` / cursor transitions, batch insert into `history_etl_*`, per-chunk commit, error isolation, and idempotent re-run (`--force`).
- `raw_event_id` lineage carry-through and propagation of `model`, `project_name`, and identity columns from raw → ETL.
- The explode driver: given a list of blocks from the trait, emit one ETL row per block with the trait-provided column map.

**Per-agent trait declares (agent-specific only):**
- `parseContent(rawRow): Block[]` — normalize the agent's content (string → single text block; block array → blocks; array-of-messages container → flattened blocks; no content → empty) into a common `Block` shape.
- `blockColumns(block): Record<string, unknown>` — map a block's `type` and complementary nested attributes to ETL columns (e.g. `text`, `thinking`, `tool_name`, `tool_input`, `tool_result`, `is_error`), where the set of recognized `type` values and their columns is defined per agent.
- `recordTypeOf(rawRow)` and token-field locations — where input/output/cache/total tokens live, including the Codex case where tokens arrive on separate `token_count` events rather than per message.
- `composeConversationKey(rawRow)` — how rows group into a conversation for that agent (some agents have only user turns).

A shared `Block` / `EtlRow` contract and the common ETL column superset live in `@spur/contracts`; the engine and trait registry live in `@spur/history-analytics` (the ETL stage is an analyze-time projection). The `type` discriminator set and complementary columns are designed from each agent's actual schema, extensible as new agents or new block types appear.

**Consequences.**
- Adding a new coding agent means implementing one trait, not a new ETL pipeline — the engine, lineage handling, and incremental loop are reused.
- The refactor doubles as a **cleanup stage**: the previously broken/duplicated per-platform parsing in normalize handlers, the dead Pi `tool_call` branch, the unreliable derived Pi raw columns, and the inline `JSON.stringify(content)` mapper logic are removed in favor of the generic engine + trait surface. Cleanup is in scope for the implementing task.
- The trait boundary mirrors the existing `platforms/<name>/{schema,mappers,parser}.ts` pattern, so contributors meet a familiar seam (D-029 vocabulary, D-014 registry).

**Alternatives considered.**
- *Per-platform copy of the full ETL loop.* Rejected — eight-way duplication, guaranteed drift, and the exact maintenance burden this decision removes.
- *Single hardcoded transform with conditionals.* Rejected — cannot cleanly express the string/block/array/no-content and inline/separate-token divergence; conditionals would re-create per-agent branching without the registry's testability.

---

## D-033: Explicit field-name mapping (alias firewall) for every raw-data importer

**Source:** Task 0152 · **Date:** 2026-05-24 · **Builds on:** D-029, D-032

**Context.** Each coding agent's source log is an external, undocumented, drifting contract. A concrete failure: the Claude transcript importer was written against assumed snake_case fields (`session_id`, `parent_id`, `event_ts`), but real Claude Code transcripts emit camelCase (`sessionId`, `parentUuid`, `timestamp` as an ISO string). Because the parser/schema read the wrong names and silently fell back to `null` / `Date.now()`, the import "succeeded" with 0 errors while corrupting nearly every row: 140,578 of 141k rows lost their session id, 100% lost their parent lineage, and **every** `event_date` was stamped with the import day instead of the real conversation date — defeating the token-usage-by-date analysis the history subsystem exists for. The defect was invisible because the test fixtures had been written to match the wrong assumed schema, so the suite stayed green against unreal data.

**Decision.** Every per-agent raw-data importer maps source fields to canonical fields through **one explicit, declarative field-name mapping module** — never via inline `a ?? b` fallbacks scattered across the mapper. The mapping is the single place where source-field aliases are declared, and it behaves as a **field-name firewall** with three layered fallbacks per canonical field:

1. **Ordered alias list, canonical name first.** Each canonical field lists its known source aliases in priority order, with the canonical name itself first so a future source that adopts the canonical name still resolves (e.g. `sessionId` → `['sessionId', 'session_id']`).
2. **Type-tolerant resolution.** When an alias is present but not the expected primitive type, coerce it (e.g. a numeric id → string) rather than dropping it.
3. **Never silently null a present value.** If any alias holds a value, surface *some* value. Return `null` only when no alias is present at all. **Missing data is worse than imperfectly-typed data** — a surfaced-but-coerced value is noticeable; a silent `null` hides schema drift until it corrupts analytics.

Test fixtures for importers must use the **real** source shape (verified against actual agent output), not an assumed one; mapper tests assert the canonical result for both the real format and any legacy aliases. A test that still passes after the real source format changes is the wrong test (global R8).

Reference implementation: `packages/history-ingest/src/platforms/claude/field-map.ts` (`canonicalizeTranscriptFields`).

**Consequences.**
- Source-format drift surfaces a value (and a noticeable anomaly) instead of vanishing into `null`; new or renamed source fields are added in exactly one place per agent.
- Adding/onboarding a coding agent (D-032 trait) includes authoring its field-map module; the trait consumes canonical fields, never raw aliases.
- Importer fixtures must be sourced from real agent output; synthetic fixtures that encode an assumed schema are prohibited because they mask exactly this class of defect.
- Timestamps in particular must be parsed from the real source field (ISO string or epoch ms) and must **not** default to import time on a miss — an unresolved timestamp is recorded as such, not silently stamped `Date.now()` for analytics-bearing rows.

**Alternatives considered.**
- *Inline `??` fallbacks at each use site.* Rejected — the failure mode that produced this decision; aliases drift out of sync across call sites and there is no single firewall to harden.
- *Trust the Zod schema alone.* Rejected — a schema with `.optional()` fields validates a record that is missing every real field, so validation passes while data is lost. The schema gates shape; the field-map gates naming.

---

## Source Cross-Reference

Where each decision was originally recorded:

| Source | Decisions |
|--------|-----------|
| `01_PRD.md` §10 | D-001 through D-020 (original resolved list) |
| `03_ARCHITECTURE.md` §18 | D-002 through D-015 (formal ADRs with context/decision/consequences/alternatives) |
| `06_DECISIONS.md` (this doc) | D-021 through D-024 (post-consolidation amendments) |

D-001, D-016–D-020 were originally PRD §10 items; D-002–D-015 were originally ADRs from `03_ARCHITECTURE.md` §18. D-021–D-023 were added here directly as post-implementation refinements. D-025–D-026 capture the CLI entity refactoring and rule engine extension system architecture. D-027 retires `packages/profiles` and rehomes its responsibilities into `@spur/core/loader` plus engine-owned config modules inside `@spur/kernel` (Task 0116). D-028 makes CLI command files transport wrappers and completes the agent surface conversion. D-029 fixes the history subsystem naming across packages, services, DB tables, and CLI before any migration ships (Task 0130). D-030 decouples the workflow engine from mandatory workspaces to support general-purpose orchestration (Task 0139).

---

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-05-09 | Initial consolidation: 20 decisions extracted from PRD §10 and Architecture §18. |
| 0.2.0 | 2026-05-11 | Added D-021 (`--agent`), D-022 (`spur agents` removed), D-023 (`$SPUR_AGENT`). Supersedes task 0066, F-1.3.4. |
| 0.3.0 | 2026-05-15 | Added D-024 (host-owned capability registries). Task 0090 closeout. |
| 0.4.0 | 2026-05-15 | Added D-025 (CLI entity-centric refactoring), D-026 (rule engine extension system). Post-rules-refactoring doc alignment. |
| 0.5.0 | 2026-05-17 | Added D-027 (rehome profile loading to `core/loader` + kernel-owned config; transition-flow dialect foundation). Amended D-005, D-006, D-026 with supersession notes; resolved the D-025 `packages/profiles` deferred item. Task 0116. |
| 0.6.0 | 2026-05-19 | Added D-028 (CLI command wrappers + package-owned services). Moved agent execution to `spur agent run` and converted health inspection to `spur agent list`. Task 0126. |
| 0.7.0 | 2026-05-20 | Added D-029 (history subsystem naming alignment). Locks `history-*` packages, services, DB tables, and CLI paths before the first history migration ships. Task 0130. |
| 0.8.0 | 2026-05-21 | Added D-030 (workflow engine workspace decoupling) to support general-purpose orchestration. Task 0139 / 0144. |
| 0.9.0 | 2026-05-24 | Added D-031 (history ETL standardized layer), D-032 (generic ETL engine with per-agent traits), D-033 (explicit field-name mapping firewall for raw-data importers). Task 0152. |
