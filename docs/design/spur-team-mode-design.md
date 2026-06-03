# Spur Team Mode — Design Document

**Status:** Proposal · **Date:** 2026-06-02
**Source:** relaydeck deep-dive analysis + design discussion with Robin Min
**Derived from:** `docs/00_ADR.md`, `docs/04_DESIGN.md`, `docs/analysis/relaydeck-vs-spur-analysis.md`

---

## 1. Context

The current `spur agent run` is a stateless one-shot launcher: detect the agent, translate the prompt to agent-specific CLI flags, spawn as a subprocess, wait for exit, return the result. This works well for single-turn ad-hoc tasks but cannot support multi-agent orchestration, persistent agent sessions, or inter-agent communication.

relaydeck demonstrated that the key to team mode is three primitives: **persistent agent subprocesses**, **identity preamble injection**, and **durable messaging with live stdin delivery**. This document proposes adapting those primitives into Spur's architecture while preserving existing investments in task files, workflow engine, rule engine, and cross-agent slash commands.

---

## 2. Design Principles

1. **Extend `ts-ai-runner`, don't fork it.** The library gains a `TeamAgentProcess` class and a `TeamOrchestrator` — the same module that already provides `AgentDetector`, `DoctorRunner`, and `AiRunner`.

2. **Task files drive agent assignment.** An agent's "purpose" is not static config — it's the task it's currently assigned to. Task files in `docs/tasks/` get `Assignee:` and `Purpose:` fields; the orchestrator reads them at spawn.

3. **Workflow engine dispatches the team.** `ts-dual-workflow-engine` steps become team dispatches: each step names an agent ID and a prompt, and the engine sends messages to the agent via the queue and waits for completion.

4. **Rule engine gates team actions.** Pre-commit, pre-bash, and pre-file-write hooks evaluate against agent purpose. A `planner` agent should never write code; a `coder` agent should never commit unreviewed.

5. **Local-first, zero new deps.** Messaging uses the existing SQLite DB. No Redis, NATS, or external broker. No new package dependencies beyond what `ts-ai-runner` already needs.

6. **Ship in phases.** Phases 1-3 are independent of the team daemon and can ship incrementally. Phase 4+ adds the persistent orchestrator.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        .spur/                                    │
│  agents/<id>.yaml     agent specs (source of truth)              │
│  spur.db              agent state + message queue (SQLite)      │
│  rules/               team guardrails                           │
│  workflows/           team workflow definitions                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ts-ai-runner (extended)                       │
│                                                                  │
│  AgentDetector ──── detects installed CLIs (unchanged)          │
│  DoctorRunner ──── readiness checks (unchanged)                 │
│  AiRunner.run() ── one-shot exec (unchanged)                   │
│                                                                  │
│  TeamAgentProcess ── persistent subprocess (new)                │
│    .start() .stop() .send(message) .subscribe(cb)               │
│  TeamOrchestrator ── team lifecycle (new)                       │
│    .loadSpecs() .startAgent() .sendMessage() .getAgents()       │
│  IdentityPreamble ── compose self+peers prompt (new)            │
│    .build(agent, peers, task?)                                  │
│  MessageService ── durable queue + stdin injection (new)        │
│    .enqueue(from, to, body) .drain(agentId) .deliver(msg)       │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  claude -p   │    │  codex exec  │    │   pi -p      │
│  (subprocess)│    │  (subprocess)│    │  (subprocess)│
│  stdin: pipe │    │  stdin: pipe │    │  stdin: pipe │
└──────────────┘    └──────────────┘    └──────────────┘
```

---

## 4. Data Model

### 4.1 Agent Spec (`.spur/agents/<id>.yaml`)

```yaml
# .spur/agents/planner.yaml
id: planner
name: "Architecture Planner"
type: claude-code
workspace: spur-new
purpose: ""                                 # filled at spawn from current task file
tags: [planning, architecture]
config:
  model: claude-sonnet-4-20250514
  autonomy: auto
system_prompt: |
  Always produce numbered, actionable plans.
  Use `spur task update <id> planned` when done.
inject_identity_preamble: true
auto_start: false                           # Phase 4+
```

### 4.2 Inbox Messages Table

```sql
CREATE TABLE inbox_messages (
    id             TEXT PRIMARY KEY,        -- 'msg_' || hex(randomblob(8))
    from_id        TEXT,                    -- sender ID or 'operator'
    to_id          TEXT NOT NULL,
    body           TEXT NOT NULL,
    status         TEXT DEFAULT 'queued',   -- queued | injected | delivered | failed
    in_reply_to    TEXT,                    -- msg_id for threading
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    delivered_at   TEXT,
    inject_attempts INTEGER DEFAULT 0,
    inject_error   TEXT
);
CREATE INDEX idx_inbox_messages_to_status ON inbox_messages(to_id, status);
```

### 4.3 Task File Extension

```markdown
<!-- docs/tasks/0005_Implement_auth_module.md -->

# 0005: Implement Auth Module

**Assignee:** `coder`              ← new: agent ID
**Purpose:** "Implement JWT auth with refresh tokens for the API layer"  ← new
**Status:** planned

## Requirements
...
```

The `spur team assign` command reads `Assignee:` to route tasks. The `Purpose:` field becomes the agent's injected purpose at spawn.

---

## 5. Messaging Architecture

### Model: Hybrid SQLite Queue + stdin Injection

This is relaydeck's proven model, adapted to Spur's constraints:

```
┌──────────────────────┐
│   Message Producer   │  (CLI, workflow engine, another agent)
│   spur message send  │
└────────┬─────────────┘
         │ INSERT INTO inbox_messages (queued)
         ▼
┌──────────────────────┐
│   SQLite (spur.db)   │  ← durable, zero-dependency, already in use
│   inbox_messages     │
└────────┬─────────────┘
         │ two delivery paths:
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────────────┐
│ Live   │ │ Deferred Drain   │
│ Inject │ │                  │
│        │ │ spur agent run   │
│ daemon │ │ --drain          │
│ writes │ │                  │
│ stdin  │ │ SELECT queued    │
│ of     │ │ → inject as      │
│ running│ │ first prompt     │
│ agent  │ │                  │
└────────┘ └──────────────────┘
```

### Why SQLite + stdin, not a message broker?

| Criterion | SQLite + stdin | Redis / NATS | File-based (JSONL) | Unix socket |
|-----------|---------------|--------------|---------------------|-------------|
| Durable | ✅ | ✅ (configurable) | ✅ | ❌ |
| Push delivery | ✅ (stdin write) | ✅ (pub/sub) | ❌ (poll only) | ✅ |
| Zero new deps | ✅ | ❌ | ✅ | ✅ |
| Works cold (no daemon) | ✅ (deferred drain) | ❌ | ✅ | ❌ |
| Concurrent safe | ✅ (SQLite WAL) | ✅ | ❌ (no locking) | ✅ |
| Agent-side work | None | Needs client lib | None | Needs socket client |
| Query/audit | ✅ (SQL) | Limited | ❌ (grep file) | ❌ |
| Matches ADR-010 (local-first) | ✅ | ❌ (external service) | ✅ | ✅ |

SQLite + stdin wins on all dimensions that matter for a local-first tool. Redis/NATS would be the right move if Spur becomes multi-machine, but that's Phase 5+ — not now.

### Delivery Flow (Detailed)

**Live path** (Phase 4+, daemon running):
```
1. MessageService.enqueue("planner", "coder", "Implement auth module")
2. INSERT → inbox_messages (status: queued)
3. TeamOrchestrator delivers to live agent:
   a. Format: "[task from=planner id=msg_abc123] Implement auth module"
   b. agentProcess.stdin.write(formatted + "\n")
   c. UPDATE status = 'injected'
4. Optional echo confirmation (Phase 5+):
   a. Poll agent stdout for msg_abc123 echo
   b. UPDATE status = 'delivered'
```

**Deferred path** (no daemon, `spur agent run --drain`):
```
1. MessageService.enqueue("operator", "coder", "Fix merge conflicts in PR #42")
2. INSERT → inbox_messages (status: queued)
3. Later: spur agent run --drain --agent coder
4. TeamAgentProcess.start():
   a. SELECT * FROM inbox_messages WHERE to_id = 'coder' AND status = 'queued'
   b. Compose as system prompt addendum or initial prompt block
   c. UPDATE status = 'injected'
5. Agent sees pending messages as the first thing in context
```

### Message Format

Messages injected to agent stdin use a structured prefix:

```
[task from=<agent-id> id=<msg-id>] <body>
```

This is:
- Regex-parseable by the control plane for echo confirmation
- Human-readable for the agent model to understand
- Distinct from normal conversation so it doesn't get confused with task content

The agent's identity preamble teaches it how to reply:

```
When you receive a [task from=X id=Y] message, reply using:
  spur message reply Y "your response"
This ensures the reply is durable and delivered to X even if they
are not currently running.
```

---

## 6. Identity Preamble

Every agent at spawn receives an auto-generated identity block in its system prompt:

```markdown
You are agent `coder` (Claude Code) in workspace `spur-new`.
Your current task: #0005 — Implement JWT auth with refresh tokens for the API layer.
Your purpose: Implement scoped code changes as directed by `planner`.

Peer agents in this workspace:
  - `planner` (claude-code) — Produce implementation plans from requirements.
  - `reviewer` (codex-cli) — Review PRs for correctness, security, and style.

Git context:
  - repo: spur-new
  - branch: feat/auth-module
  - dirty: 3 files

Communication — to send a message to a peer, use:
  spur message send --to <agent-id> "<message>"
To reply to a message, use:
  spur message reply <msg-id> "<response>"
To check your inbox:
  spur message inbox

Guardrails:
  - You are not authorized to commit code.
  - You are not authorized to modify docs/tasks/ files.
```

This is composed by `IdentityPreamble.build(agent, peers, task?)`:

```typescript
function buildIdentityPreamble(
    agent: AgentSpec,
    peers: AgentSpec[],
    task?: TaskFile,
): string {
    const lines: string[] = [];
    
    lines.push(`You are agent \`${agent.id}\` (${agent.type}) in workspace \`${agent.workspace}\`.`);
    
    if (task) {
        lines.push(`Your current task: #${task.number} — ${task.purpose || task.title}`);
    }
    if (agent.config.system_prompt) {
        lines.push(agent.config.system_prompt);
    }
    
    if (peers.length > 0) {
        lines.push('\nPeer agents in this workspace:');
        for (const p of peers) {
            lines.push(`  - \`${p.id}\` (${p.type}) — ${p.purpose || '(no purpose set)'}`);
        }
    }
    
    lines.push('\nCommunication — to send a message to a peer, use:');
    lines.push('  spur message send --to <agent-id> "<message>"');
    lines.push('To reply to a message, use:');
    lines.push('  spur message reply <msg-id> "<response>"');
    
    // Git context
    const git = getGitContext(agent.workspace);
    if (git) lines.push(git);
    
    // Rule engine guardrails
    const guardrails = evaluateGuardrails(agent);
    if (guardrails.length > 0) {
        lines.push('\nGuardrails:');
        for (const g of guardrails) lines.push(`  - ${g}`);
    }
    
    return lines.join('\n');
}
```

---

## 7. Integration with Existing Systems

### 7.1 Task Files → Agent Assignment

```
docs/tasks/0005_Implement_auth.md
  Assignee: coder          ← matches .spur/agents/coder.yaml
  Purpose: "Implement JWT auth..."  ← injected as purpose
  Status: planned

spur team assign 0005 coder   ← CLI to set assignee
  → updates task file
  → if coder is running: injects "New task assigned: #0005"
  → if coder is cold: queued, delivered on next --drain
```

### 7.2 Workflow Engine → Team Dispatch

The dual-workflow engine already supports FSM and transition-flow steps. Extend step types:

```yaml
# .spur/workflows/release-pipeline.yaml
name: Release Pipeline
version: "1.0"
steps:
  - id: plan
    type: agent                     # new step type
    agent: planner
    prompt: |
      Plan the release for version {{ vars.version }}.
      Output your plan. When complete, run:
        spur workflow transition {{ workflow.id }} review
    timeout: 300s
    transitions:
      - to: review
        when: output.contains("APPROVED")
      - to: plan                    # loop: reject → re-plan
        when: output.contains("REJECTED")

  - id: review
    type: agent
    agent: reviewer
    prompt: |
      Review this plan: {{ steps.plan.output }}
      Reply APPROVED or REJECTED with reasoning.
    transitions:
      - to: implement
        when: output.contains("APPROVED")
      - to: plan
        when: output.contains("REJECTED")

  - id: implement
    type: agent
    agent: coder
    prompt: |
      Implement: {{ steps.plan.output }}
      After implementation, run: spur workflow complete {{ workflow.id }}
```

The workflow engine sends messages to agents via `MessageService`, then monitors the agent's output (or explicit `spur workflow transition` command) for completion signals.

### 7.3 Rule Engine → Team Guardrails

```yaml
# .spur/rules/team-guardrails.yaml
preset: team
rules:
  - id: planner-read-only
    severity: error
    message: "Planner agents must not modify source files"
    when:
      agent_purpose_contains: "plan"
    deny:
      - write: src/**
      - bash: git commit
      - bash: git push

  - id: coder-no-commit
    severity: error
    message: "Coder agents must not commit without review"
    when:
      agent_purpose_contains: "implement"
    deny:
      - bash: git push
      - bash: git commit  # allow commit --amend for fixups?

  - id: require-review-before-merge
    severity: warning
    message: "Changes to src/** require reviewer approval"
    when:
      agent_purpose_contains: "implement"
    require:
      - human-approval
```

Rules are evaluated at two points:
1. **At spawn**: injected into the identity preamble as guardrails
2. **At action**: the team daemon checks rules before permitting file writes or shell commands (Phase 5+)

### 7.4 Cross-Agent Slash Commands

Existing slash-command translation in `ts-ai-runner` extends to team context:

```
# In planner's context:
/coder:skill::implement-auth   → translated to coder's skill format
                                 → sent as message to coder

# Via CLI:
spur message send --to coder "/implement src/auth.ts"
  → translated: codex: $implement src/auth.ts
  → injected to coder's stdin
```

---

## 8. Phased Implementation Plan

### Phase 1 — Identity + Purpose (now)

**Goal:** Agents know who they are and what they're doing, even in one-shot mode.

```
spur agent run "fix the login bug" \
  --purpose "Bug fixer" \
  --tags "debug,auth" \
  --system-prompt "Always add tests for fixes."

→ injects identity preamble into prompt
→ no new deps, no architectural changes
```

**Deliverables:**
- `ts-ai-runner`: `IdentityPreamble.build()` in new `src/identity.ts`
- `ts-ai-runner`: `AiRunner.run()` accepts `purpose?`, `tags?`, `systemPrompt?`
- CLI: `--purpose`, `--tags`, `--system-prompt` flags on `spur agent run`

### Phase 2 — Message Queue + Deferred Drain (weeks)

**Goal:** Agents can send messages to each other, delivered on next run.

```
spur message send --to coder "Fix merge conflicts in PR #42"
  → INSERT into spur.db inbox_messages

spur agent run --drain --agent coder
  → SELECT queued messages → inject as first prompt
  → agent sees pending tasks immediately

spur message inbox --agent coder
  → list pending messages
```

**Deliverables:**
- `ts-ai-runner`: `MessageService` class (enqueue, drain, deliver)
- DB: migration for `inbox_messages` table
- CLI: `spur message send`, `spur message inbox`, `spur message reply`
- CLI: `--drain` flag on `spur agent run`

### Phase 3 — Agent Specs + Task Assignment (weeks)

**Goal:** Config-as-code agent definitions, task-file-driven purpose.

```
spur agent create coder --type claude-code --tags "implement" --system-prompt "..."
  → writes .spur/agents/coder.yaml

spur team assign 0005 coder
  → updates docs/tasks/0005_...md with Assignee: coder

spur agent run --task 0005
  → reads task file → injects purpose + context
```

**Deliverables:**
- `ts-ai-runner`: `AgentSpec` type + YAML load/save
- CLI: `spur agent create`, `spur agent edit`, `spur agent list --specs`
- CLI: `spur team assign <task-id> <agent-id>`
- CLI: `--task <task-id>` flag on `spur agent run`

### Phase 4 — Team Daemon (months)

**Goal:** Persistent multi-agent runtime with live message delivery.

```
spur team start
  → reads .spur/agents/*.yaml
  → spawns each agent in subprocess (pipe mode)
  → drains pending messages per agent
  → starts SSE feed for live output streaming
  → HTTP API: POST /team/agents/:id/message
```

**Deliverables:**
- `ts-ai-runner`: `TeamAgentProcess` class (subprocess lifecycle)
- `ts-ai-runner`: `TeamOrchestrator` class (team lifecycle)
- CLI: `spur team start`, `spur team stop`, `spur team status`
- Server: Team HTTP API endpoints

### Phase 5 — Dashboard + PTY + Guardrails (months, tbd)

**Goal:** Full relaydeck-parity observability and enforcement.

- PTY support (node-pty) for live terminal in dashboard
- WebSocket streaming of agent output to `apps/web`
- Server-side rule engine evaluation for team guardrails
- Semantic status engine (working/idle/awaiting-input)
- Echo confirmation for message delivery

---

## 9. Open Questions

1. **Pipe vs PTY:** Can all target agents (claude, codex, pi, gemini, opencode, cursor, antigravity) operate correctly in pipe mode (`-p` flag)? Or do some strictly require a TTY? *Answer: Claude Code `-p`, Codex `exec`, pi `-p`, and gemini `-p` all work in pipe mode. Cursor and Antigravity may require special handling.*

2. **Single vs multiple daemon processes:** Should each agent run as a subprocess of a single daemon (relaydeck model), or as independent processes managed by a lightweight supervisor (PM2/systemd model)? *Proposal: Single daemon for Phase 4 (simpler), independent processes for Phase 5+ (better fault isolation).*

3. **Agent stdin format:** Should messages be injected as raw text + `\n`, or should there be a framing protocol (length-prefixed, JSON envelope)? *Proposal: Start with raw text + `\n` (simplest). Add framing if echo confirmation requires it in Phase 5.*

4. **Workflow engine integration depth:** Should the workflow engine directly manage agent processes, or should it be a consumer of the message queue? *Proposal: Consumer — workflow engine sends messages and monitors completion via explicit `spur workflow transition` calls from agents. This decouples the engines.*

---

## 10. References

- `docs/00_ADR.md` — Architecture decisions (especially ADR-006: external engines, ADR-010: local-first CLI)
- `docs/04_DESIGN.md` — CLI surface and data shapes
- `docs/analysis/relaydeck-vs-spur-analysis.md` — relaydeck deep-dive
- `vendors/relaydeck/AGENTS.md` — relaydeck architecture documentation
- `vendors/relaydeck/relaydeck/harness/base.py` — HarnessAgent (PTY spawn, identity preamble, message injection)
- `vendors/relaydeck/relaydeck/orchestrator.py` — Orchestrator (agent lifecycle, message delivery)
- `vendors/relaydeck/plugins/messaging/plugin.py` — Durable peer messaging plugin
