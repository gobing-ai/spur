# 01 PRD — Spur

**Version:** 1.0.0
**Status:** Active
**Last Updated:** 2026-05-30
**Owner:** Robin Min

## 1. Product Vision

Spur is a **local-first harness engineering toolkit** for mainstream coding agents. It is not a new
coding agent, and not a BYOK LLM platform. Spur assumes the user already has coding agents installed
and authenticated, then provides the harness around them: agent detection and health, constraint
checking, workflow orchestration, history import and analytics, and operational visibility.

The goal is to turn scattered agent skills, policy checks, execution loops, and conversation-history
analytics into one coherent, daily-use toolkit that makes agent-driven engineering measurable,
reproducible, constrained, and inspectable.

Supported agents: **Claude Code, Codex, Gemini CLI, Antigravity, pi, OpenCode, OpenClaw.** Pi is the
default when Spur runs an agent itself.

## 2. Problem Statement

AI coding workflows are fragmented across plugins, scripts, and ad-hoc config:

- Agent skills, slash commands, and subagents live as loose markdown/scripts with no shared backend.
- Policy and constraint checks are scattered across one-off scripts and per-project rules.
- Conversation history from each agent sits in incompatible JSONL formats with no unified analytics.
- Workflow/loop execution logic is reinvented per project.

The missing product is a unified harness layer that consolidates these into checkable, repeatable,
inspectable capabilities behind one CLI.

## 3. Principles

| Principle | Implication |
|-----------|-------------|
| Local-first | SQLite + local files; no network in the core loop. Cloud surface is optional and read-oriented. |
| Agent-agnostic | One abstraction for all agents; vendor glue lives behind it. Spur never stores agent keys. |
| Config over code | Rules and workflows are declarative (YAML + Zod); engines interpret normalized definitions. |
| Reusable engines | Generic capabilities are external `@gobing-ai/ts-*` packages; Spur is a domain consumer. |
| Inspectable & reversible | History raw stays in files; only validated, redacted data is persisted and re-derivable. |
| MVP-first | Ship the smallest useful loop; defer speculative surface until its need is reconfirmed. |

## 4. Users & Use Cases

**Primary user:** a developer running coding agents daily who wants discipline and visibility around
them.

| Use case | Command |
|----------|---------|
| Check which agents are installed and usable | `spur agent list` / `spur agent doctor` |
| Enforce project constraints (imports, secrets, structure) | `spur rule run` |
| Run a multi-step agent workflow / dev loop | `spur workflow run <file>.yaml` |
| Import and analyze agent conversation history & cost | `spur history import` / `spur history analyze` |
| Scaffold a Spur project | `spur init` |

## 5. Scope

### 5.1 In scope (committed product surface)

| Capability | Command | Backed by | Status |
|------------|---------|-----------|--------|
| Project scaffold | `spur init` | local CLI + DAOs | done |
| Agent detection / health | `spur agent list\|doctor` | `ts-ai-runner` | done |
| Constraint rule evaluation | `spur rule run` | `ts-rule-engine` | done |
| Constraint rule discovery / validation | `spur rule list\|validate` | `ts-rule-engine` | done |
| Workflow validate / run / list | `spur workflow ...` | `ts-dual-workflow-engine` | done |
| History import (7 sources) | `spur history import` | `ts-llm-jsonl-importer` | done |
| History cost analytics | `spur history analyze` | local analytics consumer | done |
| History report surface | `spur history report` | placeholder | TODO marker only |

### 5.2 Supporting utilities

`spur status [path]` and `spur migrate` — operational helpers that keep the local project
consistent. Stable but not the headline product surface. `spur status [path]` owns basic path
metadata; the former standalone `spur inspect <path>` surface is removed. `spur migrate` remains a
temporary helper until the migration lifecycle is finalized.

### 5.3 Deferred (needs design before porting)

Carried in old spur but **not** ported until their need and design are reconfirmed:

- **Agent run execution** (`spur agent run <task>`) — `ts-ai-runner` exposes `AiRunner`; the CLI
  surface and run-capture model need design.
- **Rich run inspection** (timeline, events, gates, artifacts) — depends on a run model wired
  through the workflow engine's persistence.
- **Asset inspection / SSOT asset model** — old `@spur/assets` was discarded; rebuild only if needed.
- **Server/web inspection UI** beyond the health vertical slice.

### 5.4 Out of scope (Phase 1)

BYOK, key storage, sandboxing, multi-tenant cloud, desktop/mobile apps.

## 6. Non-Functional Requirements

- **Gate:** `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build` all green; coverage
  ≥ 85% lines / 90% functions in aggregate.
- **Determinism:** every command supports `--json`; output is stable for automation.
- **Privacy:** Spur never stores agent API keys; history redaction strips secrets/PII before persistence.
- **Portability:** server runs on both Bun and Cloudflare Workers via runtime abstraction.

## 7. Success Criteria

1. The five committed commands work end-to-end against real agent installs and real history files.
2. A new constraint or workflow is added by editing YAML, not code.
3. A new history source is added by one `SourceDefinition`, with no pipeline change.
4. The full gate passes from the CLI's own `spur rule run` as the self-hosted quality check.

## 8. References

- Architecture decisions: `docs/00_ADR.md` (authoritative).
- Current architecture: `docs/03_ARCHITECTURE.md`.
- Roadmap: `docs/02_ROADMAP.md`.
