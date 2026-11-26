---
kind: design
title: "dsh (DeepSeek Harness) as a wrapped coding agent"
status: proposed
created_at: 2026-11-26
updated_at: 2026-11-26
related: [U, U1, U2]
tags: [system, agent, U]
version: 0.1.0
---

# dsh (DeepSeek Harness) as a wrapped coding agent

Feature [U](../features/U_deepseek-harness-dsh-as-a-wrapped-coding-agent.md). Decision: [ADR-153](../00_ADR.md).
Follow-ups: U1 (Superskill `dsh` install target), U2 (dsh history import source).

## 1. Boundary

Spur wraps the `dsh` binary the way it wraps the other ten agents. dsh plugins are in-process
Cordis packages that bind to dsh services (`ctx.skills`, `ctx.mcpManager`, `ctx.systemPrompt`) and
have no declarative manifest, so Spur never loads, translates or inspects them. An operator's dsh
profile, including its plugins, applies to every Spur-dispatched run because dsh itself executes it.

## 2. Runner shim (`@gobing-ai/ts-ai-runner`, `src/agents/shims.ts`)

The shim lives in the released facade; Spur adds no local workaround (AGENTS.md, reusable engines).

| Concern | Contract |
| --- | --- |
| One-shot | `dsh --profile headless --json`, task on stdin, cwd = run worktree |
| Resume | `--session-id <id>`; id taken from the stream's opening `session` event |
| Permission | workspace-write → `--permission-mode workspace-write`; unattended full access → `--permission-mode auto --approval-policy never` |
| Events | `session`, `status`, `text`, `thinking`, `tool_call`, `tool_result`, `final`, `error` → runner session/text/tool events; unknown types ignored |
| Success | exit 0 **and** `final.reason.kind === 'completed'`; a missing `final` or any other kind is a failure carrying the reason |
| Capability record | `resumeById: true`, `sessionDir: false`, `structuredOutput: true`, `verifiedVersion: <pinned>` |
| Availability | `dsh --version` on PATH; no credential read or stored (provider keys stay in the dsh profile) |

The pinned version is the installed release line (0.2.2-rc.1 at planning time); the vendored
0.2.3-alpha.2 tree is a developer preview and is not the contract source.

## 3. Spur wiring

Each existing per-agent table gains a `dsh` row; no new seam is introduced.

| Surface | Change |
| --- | --- |
| `config/config.global.yaml`, `config/config.example.yaml` | `dsh` executor entry, not in a default tier until R11 passes |
| `packages/app/src/services/process-identity.ts` | `dsh` binary → agent `dsh` |
| `packages/app/src/services/run-session-observer.ts` | session id from the `session` event |
| `packages/app/src/services/failure-classification.ts` | dsh quota/auth `error` events → provider `dsh` |
| `packages/app/src/services/agent-mcp-readiness.ts` | dsh MCP via profile patch (`mcp-manager` `config.servers`), verdict only; writing it is U1 |
| `apps/web/src/modules/integrations/helpers.ts` | Board row: binary, YAML profile-patch config format, readiness |

## 4. Skills

dsh `skill-filesystem` scans `<project>/.agents/skills` and `~/.agents/skills`, where Superskill
already writes the `sp-*` skills. No Spur change; R10 proves discovery. `/sp:dev-*` slash commands do
not port (dsh registers commands in code only).

## 5. Version-skew guard

A recorded `--json` fixture from the pinned version drives the parser contract test (R12). Doctor
compares `verifiedVersion` with `dsh --version` and reports a mismatch without disabling the
executor (R13).

## 6. Proof

One E2E run dispatches a bounded task to the `dsh` executor and writes a receipt with the dsh
version, session id and the Spur run id (R11). It needs a configured dsh model provider on the host.
