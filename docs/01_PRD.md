---
doc: 01_PRD
owns: WHAT — product vision, users, scope (in / out / deferred)
authority: authoritative-on-scope
version: 1.5.2
owner: Robin Min
updated_at: 2026-08-26
read_before: adding a command or feature
edit_rules: 99 §6.2
sync: [T1, T4, T6]
---

# 01 PRD — Spur

## 1. Product Vision

Spur is a **local-first harness engineering toolkit** for mainstream coding agents. It is not a
coding agent and not a BYOK LLM platform. It assumes agents are already installed and
authenticated, and provides the harness around them: agent detection and health, constraint
checking, workflow orchestration, history import and analytics, team coordination, and
operational visibility — one coherent, daily-use toolkit that makes agent-driven engineering
measurable, reproducible, constrained, and inspectable.

Spur also owns the **planning layer** of that loop (ADR-020–023): markdown task and feature files
as the single source of truth, a spec-driven pipeline from vague description to BDD-specified
features and linked tasks, and — shape pending the server/web design task (ADR-021) — a local
kanban board as the operator's review surface.

Supported agents (canonical ids from `@gobing-ai/ts-ai-runner` `DISPLAY_ORDER`, 0.4.8+): **Claude
Code (`claude`), Codex (`codex`), Gemini CLI (`gemini`), pi (`pi`), omp (`omp`), OpenCode
(`opencode`), Antigravity (`antigravity-cli`), OpenClaw (`openclaw`), Hermes (`hermes`), Grok
(`grok`).** Auto-selection uses Tier-1 priority (not a fixed default agent); configure
`agent.default` / executors to pin a preferred runner (e.g. `omp` or `grok`).

## 2. Problem Statement

AI coding workflows are fragmented across plugins, scripts, and ad-hoc config:

- Agent skills, slash commands, and subagents live as loose markdown/scripts with no shared backend.
- Policy and constraint checks are scattered across one-off scripts and per-project rules.
- Conversation history from each agent sits in incompatible JSONL formats with no unified analytics.
- Workflow/loop execution logic is reinvented per project.
- Task and feature specs live in tooling trapped inside one agent's plugin format.

The missing product is a unified harness layer behind one CLI.

## 3. Principles

| Principle                | Implication                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Local-first              | SQLite + local files; no network in the core loop. Cloud surface is optional and read-oriented. |
| Agent-agnostic           | One abstraction for all agents; vendor glue lives behind it. Spur never stores agent keys.      |
| Config over code         | Rules and workflows are declarative (YAML + Zod); engines interpret normalized definitions.     |
| Reusable engines         | Generic capabilities are external `@gobing-ai/ts-*` packages; Spur is a domain consumer.        |
| Inspectable & reversible | Raw data stays in files; only validated, redacted data is persisted and re-derivable.           |
| MVP-first                | Ship the smallest useful loop; defer speculative surface until its need is reconfirmed.         |

## 4. Users & Use Cases

**Primary user:** a developer running coding agents daily who wants discipline and visibility
around them.

| Use case                                                  | Command                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| Check which agents are installed and usable               | `spur agent list` / `spur agent doctor`                          |
| Execute a prompt through any agent                        | `spur agent run`                                                 |
| Enforce project constraints (imports, secrets, structure) | `spur rule run`                                                  |
| Run a multi-step agent workflow / dev loop                | `spur workflow run <file>.yaml`                                  |
| Import and analyze agent conversation history & cost      | `spur history import` / `spur history analyze`                   |
| Coordinate team agents and durable messages               | `spur message ...` / `spur team ...`                             |
| Inspect rule/workflow run history                         | `spur rule trace` / `spur workflow trace`                        |
| Scaffold a Spur project                                   | `spur init`                                                      |
| Manage markdown task files (WBS, sections, status)        | `spur task ...` _(ADR-020)_                                      |
| Manage feature files with BDD acceptance criteria         | `spur feature ...` _(ADR-020)_                                   |
| Plan a feature from a vague description                   | sp planning skill → `spur agent run` + CLI verbs _(ADR-020/023)_ |

## 5. Scope

Scope tables own **membership** only; delivery status per capability lives in `05_FEATURES`.

### 5.1 In scope (committed product surface)

| Capability                                                 | Command                                            | Backed by                                  |
| ---------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| Project scaffold                                           | `spur init`                                        | local CLI + DAOs                           |
| Agent detection / health                                   | `spur agent list\|doctor`                          | `ts-ai-runner`                             |
| Agent run execution                                        | `spur agent run`                                   | `ts-ai-runner` (`AiRunner`)                |
| Agent spec management                                      | `spur agent create\|edit\|delete`, `list --specs`  | `ts-ai-runner` spec helpers                |
| Inter-agent durable messages                               | `spur message send\|inbox\|reply`                  | `MessageService` + ts-db                   |
| Team coordination                                          | `spur team assign\|status\|up\|down\|start\|stop` | `TeamService` + `SupervisorService` (`spur serve`) |
| Inter-agent control plane (occupant identity, coordination artifacts, pinned wait) | existing `spur agent` / `spur message` (no new noun) | ADR-057; feature G4 |
| Team-scoped Board composition                              | Spur Board Teams / Inbox / Workspace                | existing team, message, and task surfaces  |
| Constraint rule evaluation / discovery / validation        | `spur rule run\|list\|validate`                    | `ts-rule-engine`                           |
| Rule / workflow run history                                | `spur rule trace` / `spur workflow trace`          | engine persistence via ts-db               |
| Actionable local observability context                     | Spur Board System Events + existing trace commands | system-event ledger + engine persistence   |
| Workflow validate / run / list                             | `spur workflow ...`                                | `ts-dual-workflow-engine`                  |
| History import (10 sources)                                | `spur history import`                              | `ts-llm-jsonl-importer`                    |
| History cost analytics                                     | `spur history analyze`                             | local analytics consumer                   |
| History report surface                                     | `spur history report`                              | pure artifact renderer (`--mode default\|forensics`, `--task`/`--top`; E5) |
| Task management (markdown CRUD, WBS, sections, check)      | `spur task ...`                                    | task domain in `packages/` (ADR-021)       |
| Feature management (`docs/features/`, INDEX, traceability) | `spur feature ...`                                 | feature domain in `packages/` (ADR-021)    |
| Spec-driven planning pipeline (fat skill)                  | `plugins/sp` skill → `spur agent run` + CLI verbs  | `ts-ai-runner` + task/feature domain       |
| Semantic conflict audit (authority-aware, four-pillar)     | `/sp:dev-find-conflict`                            | `sp:conflict-finding` skill (`plugins/sp`) |
| Environment-improvement lens on dogfood and history-anatomy reports | existing `/sp:dev-dogfood` / `/sp:dev-find-issue` (no new command) | ADR-084/085; feature I9 |

### 5.2 Supporting utilities

`spur status [path]` and `spur migrate` — operational helpers, stable but not headline surface.
`spur migrate` remains a temporary helper until the migration lifecycle is finalized.

### 5.3 Deferred (needs design before build)

- **Local board + launcher** (kanban UI, task API, SSE) — settled by the server/web design task
  (ADR-021 consequence b); until then the legacy board remains the operator surface.
- **Rich run inspection** (events, gates, artifacts beyond the trace verbs) — depends on the
  Phase-2 run model. Distinct from ADR-057 coordination-facing run records (a path list another
  agent can address, not the inspector).
- **`spur inspect <verb>`** — adapter-based project-state interrogation (coverage/lint/typecheck/deps).
- **Meta-tooling, research, and context layers** — stay live in cc-agents until the core stabilizes.
- **`spur plugin convert`** + per-platform adapter generation — per-platform install scripts suffice.
- **Web plugin container & multi-workspace** — any board ships as plain pages first (ADR-012 lesson).
- **Scheduler auto-trigger** — lifecycle events exist on the engine's EventBus seam (ADR-022);
  the scheduler consumer comes later.
- **Asset inspection / SSOT asset model** — old `@spur/assets` discarded; rebuild only if needed.

Full rd3-migration dispositions: `docs/plans/2026-06-10-rd3-migration-feature-list.md`.

### 5.4 Out of scope

- BYOK, key storage, sandboxing, multi-tenant cloud, desktop/mobile apps.
- Peer-to-peer sockets between coding agents.
- Reading another agent's terminal (PTY snapshot, screen manifests, OSC/spinner matching) as IPC.
- Injecting keystrokes or synthetic Enter into another agent's UI as a command.
- A third local IPC transport beside CLI `--json` and oRPC (Unix-socket JSON API, binary TUI protocol, named-pipe control plane).
- Using the Board Inbox timeline as wait or send authority.

## 6. Non-Functional Requirements

- **Gate:** the `AGENTS.md` verification gate passes before "done" (lint, tests incl. Workers
  runtime, build; coverage thresholds enforced by `bunfig.toml`).
- **Determinism:** every command supports `--json`; output is stable for automation.
- **Privacy:** Spur never stores agent API keys; history redaction strips secrets/PII before persistence.
- **Portability:** server runs on both Bun and Cloudflare Workers via runtime abstraction.

## 7. Success Criteria

1. The committed commands work end-to-end against real agent installs and real history files.
2. A new constraint or workflow is added by editing YAML, not code.
3. A new history source is added by one `SourceDefinition`, with no pipeline change.
4. The full gate passes from the CLI's own `spur rule run` as the self-hosted quality check.
5. Agents drive `spur task`/`spur feature` as their spec lifecycle across projects (post ADR-020).

## 8. References

- Architecture decisions: `docs/00_ADR.md` (authoritative).
- Current architecture: `docs/03_ARCHITECTURE.md`.
- Roadmap: `docs/02_ROADMAP.md`.
- rd3 migration triage: `docs/plans/2026-06-10-rd3-migration-feature-list.md`.
- BDD format research: `docs/plans/2026-06-10-rd3-tasks-bdd-research.md`.
