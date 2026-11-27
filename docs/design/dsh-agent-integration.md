---
kind: design
title: "dsh (DeepSeek Harness) as a wrapped coding agent"
status: accepted
created_at: 2026-11-26
updated_at: 2026-11-26
related: [B81, B811, E11]
tags: [system, agent, B81]
version: 0.1.0
---

# dsh (DeepSeek Harness) as a wrapped coding agent

Feature [B81](../features/B81_deepseek-harness-dsh-as-a-wrapped-coding-agent.md). Decision: [ADR-153](../00_ADR.md).
Follow-ups: B811 (Superskill `dsh` install target), E11 (Spur history coverage of the importer's `deepseek` source).

## 1. Boundary

Spur wraps the `dsh` binary the way it wraps the other ten agents. dsh plugins are in-process
Cordis packages that bind to dsh services (`ctx.skills`, `ctx.mcpManager`, `ctx.systemPrompt`) and
have no declarative manifest, so Spur never loads, translates or inspects them. An operator's dsh
profile, including its plugins, applies to every Spur-dispatched run because dsh itself executes it.

## 2. Runner shim (`@gobing-ai/ts-ai-runner`, `src/agents/shims.ts`)

ts-ai-runner 0.8.5 ships `dshShim` under canonical id `deepseek` (`shims.ts:426`), upgraded from the stale
0.1.5-rc.1 argv to the 0.2.x headless contract by task 1456; the capability row is verified against
`0.2.2-rc.1`. Spur adds no local workaround (AGENTS.md, reusable engines).
Shims are pure argv builders (`ShimCommand = {command, args}`), so the runner parses no dsh output.

| Concern | Contract |
| --- | --- |
| One-shot | `dsh --profile headless [--json] --permission-mode workspace-write --approval-policy never -- <task>`; `--json` only in json mode; cwd = run worktree |
| Resume | `--session-id <id>` plus the same permission flags; the recorded cwd must match |
| Permission | fixed: `PromptOptions` has no permission field. `--add-dir <git-common-dir>` is not needed: the dispatched executor never commits — worktree commits are driver-owned (WT-3b, `plugins/sp/skills/spur-dev/references/execution-worktree.md` §WT-3b, through `spur workflow commit-guard-stage`) |
| Success | dsh's exit status: 0 only for a completed final `turn/end`, else 1 (headless README, exit mapping) |
| Capability record | `supportsResumeById: true`, `supportsSessionDir: false`, `supportsStructuredOutput: true`, `supportsPersistentStdin: false`, `verifiedAgainst: <pinned>` |
| Availability | `dsh --version` on PATH; no credential read or stored (provider keys stay in the dsh profile) |

The pinned version is the installed release line (0.2.2-rc.1 at planning time); the vendored
0.2.3-alpha.2 tree is a developer preview and is not the contract source.

## 3. Spur wiring

Each existing per-agent table gains a `deepseek` row (the runner's canonical id); no new seam is introduced.

| Surface | Change |
| --- | --- |
| `config/config.global.yaml`, `config/config.example.yaml` | disabled `deepseek` executor entry, not in a default tier until R11 passes |
| `packages/app/src/services/process-identity.ts` | `dsh` executable name only if `ps comm` shows `dsh` rather than `node` — observed 2026-11-26 on dsh 0.2.2-rc.1: `comm=node`, so no entry (it would claim every Node agent's process) |
| `packages/app/src/services/run-session-observer.ts` | `deepseek: 'deepseek'`; the importer source already covers `~/.dsh/sessions` |
| `packages/app/src/services/failure-classification.ts` | a provider pattern only for an observed dsh stderr signature |
| `packages/app/src/services/agent-mcp-readiness.ts` | Reads `@deepseek-ai/dsh-mcp-client` loaders from `insert` operations in the headless profile’s `cordis.patch.yml` and matches `config.serverName: spur`. Older flat declarations remain readable. Superskill’s B811 install target writes the native patch format accepted by dsh 0.2.2-rc.1. |
| `apps/web/src/modules/integrations/helpers.ts` | `deepseek` in `MCP_CLIENT_AGENTS`: binary, YAML profile-patch config format, readiness |

## 4. Skills

dsh `skill-filesystem` scans `<project>/.agents/skills` and `~/.agents/skills`, where Superskill
already writes the `sp-*` skills. No Spur change. dsh has no list verb, so R10 proves discovery with a
`skill` tool_call in a `--json` run. `/sp:dev-*` slash commands do
not port (dsh registers commands in code only).

## 5. Version-skew guard

A recorded `--json` fixture from the pinned version pins the exit-status ⇔ `final.reason` agreement (R12).
The existing doctor `capability-declaration-stale` warning (`agent-doctor-ops.ts`) compares
`verifiedAgainst` with `dsh --version` and reports a mismatch without disabling the executor (R13).

## 6. Proof

One E2E run dispatches a bounded task to the `deepseek` executor and writes a receipt with the dsh
version, session id and the Spur run id (R11). It needs a configured dsh model provider on the host and must run outside the agent sandbox, because dsh writes `$DSH_HOME`.
