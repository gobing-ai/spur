---
name: "Wire team mode into Spur CLI and app layer"
description: "Consume ts-ai-runner team mode primitives, wire up CLI commands (spur message, spur team, spur agent create), add DB migration for inbox_messages, and build the TeamService application layer"
status: Done
created_at: 2026-06-02T18:15:00Z
updated_at: 2026-06-03T16:34:24.293Z
folder: docs/tasks
type: task
feature-id: "F-6 team-mode"
priority: high
dependencies:
  - "0005: Extract packages/app application services layer"
  - "@gobing-ai/ts-ai-runner 0.2.6+ (with team mode primitives: IdentityPreamble, MessageService, TeamAgentProcess, TeamOrchestrator, AgentSpec)"
  - "@gobing-ai/ts-db 0.2.5+ (with inbox_messages table and InboxMessageDao)"
tags: ["team-mode", "feature", "cli", "app-services", "messaging", "orchestration"]
impl_progress:
  planning: pending
  design: pending
  implementation: completed
  review: completed
  testing: completed
---

## 0007. Wire Team Mode into Spur CLI and App Layer

### Background

The ts-libs task (ts-libs `docs/tasks/0005`) delivers the team mode primitives:
`IdentityPreamble`, `MessageService`, `TeamAgentProcess`, `TeamOrchestrator`, `AgentSpec`,
and `InboxMessageDao`. This task consumes those primitives and wires them into Spur:

- **DB:** Add `inbox_messages` migration to the Spur CLI schema.
- **`packages/app`:** Build `TeamService` wrapping `TeamOrchestrator` for CLI consumption.
- **CLI:** New `spur message` command group, `spur team` command group, `spur agent create`,
  extended `spur agent run` flags (`--purpose`, `--tags`, `--system-prompt`, `--task`, `--drain`).
- **Config:** `.spur/agents/` directory for agent spec YAML files.
- **Server (Phase 4, deferred):** Team HTTP API endpoints, SSE/WebSocket streaming.

The full design is in `docs/design/spur-team-mode-design.md`.

### Requirements

#### R1 — DB migration for `inbox_messages`

- **R1.1** — Add migration SQL file `drizzle/0001_spur_team_inbox.sql` with `CREATE TABLE inbox_messages`
  matching the ts-db schema (see R1 in ts-libs task 0005).
- **R1.2** — Migration file includes the `_spur_cli_` marker (required by `CLI_MIGRATION_FILE_MARKER`).
- **R1.3** — Register in `packages/domain/src/migrations.ts` `CLI_MIGRATIONS` array.
- **R1.4** — Regenerated `CLI_SCHEMA_SQL` includes the new table.

#### R2 — `packages/app`: `TeamService`

- **R2.1** — Create `packages/app/src/services/team-service.ts`.
- **R2.2** — `TeamService` wraps `TeamOrchestrator` from `ts-ai-runner`:
  - `constructor(context: CliContext)` — initializes DB adapter, creates `InboxMessageDao`,
    creates `MessageService`, creates `TeamOrchestrator`.
  - `startAgent(id: string): Promise<TeamStartResult>` — orchestrates start, returns
    process status + identity preamble for display.
  - `stopAgent(id: string): Promise<void>`.
  - `sendMessage(from, to, body, replyTo?): Promise<SendResult>` — enqueues, returns msgId.
  - `inbox(id: string): Promise<InboxResult>` — lists messages.
  - `reply(msgId, body): Promise<SendResult>` — infers recipient, threads reply.
  - `getStatus(): Promise<TeamStatusResult>` — lists all agents with status.
  - `assignTask(taskId: string, agentId: string): Promise<void>` — updates task file.
- **R2.3** — Exported from `packages/app/src/index.ts`.

#### R3 — CLI: `spur agent run` extended flags

- **R3.1** — `--purpose <text>` — sets agent purpose in identity preamble.
- **R3.2** — `--tags <a,b,c>` — comma-separated tags (stored, not yet used for routing).
- **R3.3** — `--system-prompt <text>` — appended to agent's system prompt.
- **R3.4** — `--task <task-id>` — reads task file for purpose + context injection.
- **R3.5** — `--drain` — drains pending `inbox_messages` for this agent before the prompt.
- **R3.6** — All new flags work with `--json` output (included in the JSON envelope).
- **R3.7** — All new flags are optional; existing `spur agent run "prompt"` works unchanged.

#### R4 — CLI: `spur message` command group

- **R4.1** — `spur message send --to <agent-id> <body>` — enqueues message via `MessageService`.
  Prints message ID. `--from <agent-id>` for agent-originated messages (default: 'operator').
- **R4.2** — `spur message inbox [--agent <id>]` — lists pending messages. Supports `--json`.
  Shows: msg_id, from, body (truncated), created_at, status.
- **R4.3** — `spur message reply <msg-id> <body>` — infers recipient from the original
  message's `from_id`, threads via `in_reply_to`. Auto-routes response.
- **R4.4** — All commands support `--json`.

#### R5 — CLI: `spur agent create` (agent spec management)

- **R5.1** — `spur agent create <id> --type <agent-type> [flags]` — writes
  `.spur/agents/<id>.yaml` with the agent spec.
  Flags: `--name`, `--workspace`, `--purpose`, `--tags`, `--model`, `--autonomy`,
  `--system-prompt`, `--no-identity-preamble`, `--auto-start`.
- **R5.2** — `spur agent edit <id>` — opens the YAML file in `$EDITOR` (or falls back to
  printing the path). Read-only operation — the user edits in their editor.
- **R5.3** — `spur agent list --specs` — additional column showing whether a `.yaml` spec
  exists for each detected agent. `--json` includes spec paths.
- **R5.4** — `spur agent delete <id>` — removes `.spur/agents/<id>.yaml` (with confirmation
  prompt unless `--force`).
- **R5.5** — Agent ID validation: `[a-z][a-z0-9]*(-[a-z0-9]+)*`, max 64 chars.

#### R6 — CLI: `spur team` command group

- **R6.1** — `spur team assign <task-id> <agent-id>` — updates the task file's `Assignee:`
  field. If agent is running (Phase 4+), injects "New task assigned: #<task-id>" via
  message queue.
- **R6.2** — `spur team status` — lists all agent specs + running status (Phase 4+ shows
  live status from daemon; Phase 1-3 shows "stopped" for all).
- **R6.3** — `spur team start` (Phase 4, deferred stub) — placeholder that prints:
  "Team daemon not yet available. Use `spur agent run --drain` for deferred message delivery."
- **R6.4** — `spur team stop` (Phase 4, deferred stub) — same placeholder pattern.

#### R7 — `.spur/agents/` directory

- **R7.1** — `spur init` creates `.spur/agents/` directory with a `.gitkeep` file.
- **R7.2** — `spur status` reports agent specs found in `.spur/agents/`.

#### R8 — Phase 4 deferred: `spur team start` daemon mode

- **R8.1** — Stub commands ship in Phase 1-3 (per R6.3-R6.4). Full implementation deferred.
- **R8.2** — When implemented: `spur team start` reads `.spur/agents/*.yaml`, spawns each
  agent via `TeamOrchestrator.startAgent()`, drains pending messages, starts HTTP API with
  SSE feed for live output streaming.
- **R8.3** — `spur team stop` calls `TeamOrchestrator.stopAll()`.
- **R8.4** — `spur team status` shows live process state, uptime, message counts.

#### R9 — Tests and coverage

- **R9.1** — CLI tests for `spur message send|inbox|reply` with in-memory SQLite.
- **R9.2** — CLI tests for `spur agent create` — verify YAML output, ID validation, duplicate
  detection.
- **R9.3** — CLI tests for `spur agent run --purpose --tags --system-prompt --task --drain`.
- **R9.4** — CLI tests for `spur team assign` — verify task file mutation.
- **R9.5** — `TeamService` unit tests with mocked `TeamOrchestrator`.
- **R9.6** — Coverage ≥ 85% line, ≥ 90% function (project standard).
- **R9.7** — `bun run test-cf` passes.

#### R10 — Gate

- **R10.1** — `bun run lint` clean.
- **R10.2** — `bun run test` passes; no tests skipped.
- **R10.3** — `bun run test-cf` passes.
- **R10.4** — `bun run build` succeeds.
- **R10.5** — `bun run autofix && bun run spur-check` passes.
- **R10.6** — Manual smoke: `spur agent run "hello" --purpose "test"`, `spur message send --to test "hi"`,
  `spur agent create test-agent --type claude-code`, `spur team assign 0005 test-agent`.

### Design

#### Command surface (post-implementation)

```
spur agent run <prompt>     [--agent <name>] [--model <name>] [--mode <mode>] [--cwd <path>]
                            [--continue] [--json]
                            [--purpose <text>] [--tags <a,b>] [--system-prompt <text>]
                            [--task <id>] [--drain]

spur agent list             [--json] [--specs]
spur agent doctor           [agent] [--json]
spur agent create <id>      --type <agent> [--name <n>] [--workspace <ws>] [--purpose <p>]
                            [--tags <a,b>] [--model <m>] [--autonomy <mode>]
                            [--system-prompt <s>] [--no-identity-preamble] [--auto-start]
spur agent edit <id>
spur agent delete <id>      [--force]

spur message send           --to <agent-id> <body> [--from <agent-id>] [--json]
spur message inbox          [--agent <id>] [--json]
spur message reply          <msg-id> <body> [--json]

spur team assign            <task-id> <agent-id>
spur team status            [--json]
spur team start             (Phase 4, deferred)
spur team stop              (Phase 4, deferred)
```

#### File layout

```
packages/app/
  src/services/
    team-service.ts          ← TeamService (NEW)
  tests/services/
    team-service.test.ts     ← TeamService tests (NEW)

apps/cli/src/commands/
  agent.ts                   ← extended: --purpose, --tags, --system-prompt, --task, --drain
  message.ts                 ← NEW: spur message send|inbox|reply
  team.ts                    ← NEW: spur team assign|status (start|stop stubs)

apps/cli/src/index.ts        ← register new command groups

packages/domain/src/
  migrations.ts              ← add 0001_spur_team_inbox migration

drizzle/
  0001_spur_team_inbox.sql   ← NEW: inbox_messages DDL

.spur/
  agents/
    .gitkeep                 ← created by spur init
```

#### TeamService API

```typescript
export interface SendResult {
    msgId: string;
    toId: string;
    status: 'queued' | 'injected';
    injected: boolean;
}

export interface InboxResult {
    messages: Array<{
        id: string;
        fromId: string | null;
        body: string;
        status: string;
        createdAt: string;
    }>;
    count: number;
}

export interface TeamStatusResult {
    agents: Array<{
        id: string;
        name: string;
        type: string;
        workspace: string;
        purpose: string;
        status: 'running' | 'stopped' | 'errored' | 'unknown';
        pid?: number;
    }>;
}

export class TeamService {
    constructor(context: CliContext);

    async sendMessage(fromId: string | null, toId: string, body: string,
                      replyTo?: string): Promise<SendResult>;
    async getInbox(agentId: string, limit?: number, offset?: number): Promise<InboxResult>;
    async replyToMessage(msgId: string, body: string): Promise<SendResult>;
    async getStatus(): Promise<TeamStatusResult>;
    async assignTask(taskId: string, agentId: string): Promise<void>;
    async createAgentSpec(spec: AgentSpecInput): Promise<AgentSpec>;
    async deleteAgentSpec(id: string): Promise<void>;
}
```

### Plan

#### Phase 1 — DB migration

1. Create `drizzle/0001_spur_team_inbox.sql` with `CREATE TABLE inbox_messages` + index.
2. Add `_spur_cli_` marker comment in the SQL file.
3. Register in `packages/domain/src/migrations.ts` `CLI_MIGRATIONS` array.
4. Verify `CLI_SCHEMA_SQL` in `packages/domain/src/schema/index.ts` includes the new table.
5. Run migration against test DB, verify table exists.

#### Phase 2 — `TeamService` in `packages/app`

6. Create `packages/app/src/services/team-service.ts`.
7. Implement `TeamService` with constructor wiring: `CliContext` → `DbAdapter` →
   `InboxMessageDao` → `MessageService` → `TeamOrchestrator`.
8. Implement `sendMessage`, `getInbox`, `replyToMessage` (thin wrappers over `MessageService`).
9. Implement `getStatus` (reads agent specs + queries running agents from orchestrator).
10. Implement `assignTask` (reads task file, sets `Assignee:` field, writes back).
11. Implement `createAgentSpec` / `deleteAgentSpec` (delegates to `ts-ai-runner` AgentSpec
    load/save).
12. Write `packages/app/tests/services/team-service.test.ts` — mock `TeamOrchestrator`,
    use in-memory SQLite, test send → inbox → reply flow.

#### Phase 3 — CLI: `spur message` command group

13. Create `apps/cli/src/commands/message.ts`.
14. Implement `spur message send` — parse flags, call `TeamService.sendMessage()`,
    output msgId or JSON.
15. Implement `spur message inbox` — parse flags, call `TeamService.getInbox()`,
    format as table or JSON.
16. Implement `spur message reply` — parse args, call `TeamService.replyToMessage()`.
17. Register `message` command group in `apps/cli/src/index.ts`.
18. Write CLI tests in `apps/cli/tests/commands/message.test.ts`.

#### Phase 4 — CLI: `spur agent run` extended flags

19. Add `--purpose`, `--tags`, `--system-prompt`, `--task`, `--drain` to
    `apps/cli/src/commands/agent.ts` flag parsing.
20. When `--task` is provided, read the task file to extract `Purpose:` field.
21. When `--drain` is provided, call `MessageService.drain()` before dispatching the prompt.
22. Pass new options through to `AiRunner.run()` via `PromptOptions`.
23. Update `apps/cli/tests/commands/agent.test.ts` with new flag tests.

#### Phase 5 — CLI: `spur agent create/edit/delete`

24. Add `create`, `edit`, `delete` subcommands to `apps/cli/src/commands/agent.ts`.
25. Implement `spur agent create` — validate id, build `AgentSpec`, call
    `TeamService.createAgentSpec()`.
26. Implement `spur agent edit` — find YAML file, check `$EDITOR` env var,
    `Bun.spawn([editor, path], { stdio: 'inherit' })`.
27. Implement `spur agent delete` — confirmation prompt, call `TeamService.deleteAgentSpec()`.
28. Add `--specs` flag to existing `spur agent list` — includes spec path column.
29. Write CLI tests.

#### Phase 6 — CLI: `spur team` command group

30. Create `apps/cli/src/commands/team.ts`.
31. Implement `spur team assign` — call `TeamService.assignTask()`.
32. Implement `spur team status` — call `TeamService.getStatus()`, format table.
33. Implement `spur team start` / `spur team stop` stubs (deferred).
34. Register `team` command group in `apps/cli/src/index.ts`.
35. Write CLI tests.

#### Phase 7 — `.spur/agents/` scaffolding

36. Update `spur init` in `apps/cli/src/commands/init.ts` to create `.spur/agents/.gitkeep`.
37. Update `spur status` to report agent specs found.

#### Phase 8 — Verify

38. `bun run lint` clean.
39. `bun run test` passes.
40. `bun run test-cf` passes.
41. `bun run build` succeeds.
42. `bun run autofix && bun run spur-check` passes.
43. Manual smoke test: full round-trip with two agents.

### Solution

Wired team mode end-to-end across DB, app layer, and CLI by consuming the
`@gobing-ai/ts-ai-runner@0.3.0` team primitives (`TeamOrchestrator`,
`MessageService`, `buildIdentityPreamble`, agent-spec helpers) and the
`@gobing-ai/ts-db@0.3.0` `InboxMessageDao`.

**DB (R1).** Added `drizzle/0001_spur_team_inbox.sql` (with the `_spur_cli_`
marker) and an `INBOX_MESSAGES_SCHEMA_SQL` constant in
`packages/domain/src/migrations.ts`, folded into `CLI_SCHEMA_SQL` and registered
as a discrete `0001_spur_team_inbox` entry in `CLI_MIGRATIONS` so existing
databases get the table incrementally. DDL mirrors the ts-db Drizzle schema
(11 columns + `(to_id, status)` index).

**App layer (R2).** Added `packages/app/src/services/team-service.ts` —
`TeamService` wraps the orchestrator/message-service over the CLI `DbAdapter`
with lazily-built DB dependencies. Methods: `sendMessage`, `getInbox`,
`replyToMessage` (threads to the original sender via `in_reply_to`), `getStatus`,
`assignTask` (sets `assignee:` in task frontmatter), `createAgentSpec`/
`deleteAgentSpec`/`listAgentSpecs`, `buildIdentity`. Added `@gobing-ai/ts-db` to
the app package (catalog ref). Exported from `packages/app/src/index.ts`.

**CLI (R3-R7).**
- `spur agent run` extended flags (`--purpose/--tags/--system-prompt/--task`)
  map straight through to the upstream `PromptOptions` identity-preamble fields;
  `--drain` resolves the addressed `--agent <spec-id>`, folds its pending inbox
  into the prompt, and rewrites `--agent` to the spec's coding-agent type.
- New `apps/cli/src/commands/message.ts` (`send|inbox|reply`) and
  `apps/cli/src/commands/team.ts` (`assign|status` + `start|stop` Phase-4 stubs).
- `spur agent create|edit|delete` + `list --specs` added to `agent.ts`.
- `spur init` now scaffolds `.spur/agents/.gitkeep` (always, even `--minimal`);
  `spur status` reports agent spec ids found there.
- Registered `message` and `team` groups in `apps/cli/src/index.ts` + help text.

**Design coherence note.** Agent-spec `type` and the runner's `AgentName` are
distinct namespaces (`claude-code` spec type vs. `claude` runner name). The
`--drain` path makes this explicit by mapping spec id → spec type. Upstream
`validateAgentId` (`[a-z][a-z0-9_-]{1,63}`) and the non-empty-`purpose`
round-trip requirement are honored rather than re-implemented; empty purpose
defaults to `"<type> agent"`.

**Phase 4 (R8)** — `spur team start|stop` ship as the specified deferred stubs;
the persistent daemon, HTTP API, and SSE streaming remain out of scope.

`docs/04_DESIGN.md` (command surface + `inbox_messages` table row) and
`docs/05_FEATURES.md` (new Team Mode section) updated in sync.


### Testing

Verified 2026-06-03. All five gate commands pass.

- `bun run lint` — Biome clean + `tsc --noEmit` green across all 7 workspaces.
- `bun run test` — **327 pass, 0 fail**, 844 assertions, 48 files. Coverage gate
  met: aggregate **100% function / 99.36% line** (threshold 90% func / 85% line).
  New code coverage: `team-service.ts` 100%/100%, `message.ts` 100%/100%,
  `team.ts` 100%/100%, `agent.ts` 100%/100%, `migrations.ts` 100%/100%.
- `bun run test-cf` — server Cloudflare Workers Vitest: 1 file / 1 test pass.
- `bun run build` — cli (1.51 MB bundle), server (compiled), web (Astro) all
  exit 0.

New tests:
- `packages/app/tests/services/team-service.test.ts` — 16 tests: send/inbox/reply
  flow (incl. reply threading + operator-originated rejection), spec
  create/delete/list (duplicate + invalid-id guards), `getStatus`, `assignTask`
  (set/replace/missing), `buildIdentity` peers (R9.5).
- `apps/cli/tests/commands/message.test.ts` — 11 tests (R9.1).
- `apps/cli/tests/commands/team.test.ts` — 8 tests incl. assign mutates task file
  (R9.4) and daemon stubs.
- `apps/cli/tests/commands/agent-team.test.ts` — create/edit/delete/list-specs +
  `run --drain` with injected runner doubles (R9.2, R9.3).
- Extended `migrations.test.ts` (inbox table + 0001 migration), `init.test.ts`
  (`.spur/agents/.gitkeep`), `status.test.ts` (spec reporting), `agent-service.test.ts`
  (team-flag pass-through), `dispatch-inspect.test.ts` (message/team routing).

Manual smoke (R10.6) on a fresh temp project: `init` → `agent create planner
--type claude` → `agent list --specs` → `message send/inbox/reply` (reply threaded
to sender) → `team assign 0099 planner` (frontmatter mutated) → `team status` →
`status --json` (agentSpecs listed) → `team start` (stub) → `agent delete --force`.
All round-trip correctly.

No tests skipped, `.skip`'d, or commented out.


### Review



**Verdict: PASS** (self-review; workflow-owned verification, `--channel current`).

Traceability — every requirement met:
- R1 (DB migration) ✅ — `0001_spur_team_inbox.sql` + registered; table usable after migration (tested).
- R2 (TeamService) ✅ — all specified methods present + exported; 100% covered.
- R3 (agent run flags) ✅ — `--purpose/--tags/--system-prompt/--task` → PromptOptions; `--drain` folds inbox; existing `spur agent run "x"` unchanged.
- R4 (message group) ✅ — send/inbox/reply with `--json`; reply threads via `in_reply_to`.
- R5 (agent create/edit/delete) ✅ — spec YAML; upstream `validateAgentId`; duplicate + missing guards; `list --specs`.
- R6 (team group) ✅ — assign mutates frontmatter; status lists specs; start/stop stubs.
- R7 (`.spur/agents/`) ✅ — init `.gitkeep`; status reports specs.
- R8 (Phase 4) ✅ — stubs only, as specified; daemon deferred.
- R9 (tests/coverage) ✅ — 327 pass; aggregate 100% func / 99.36% line.
- R10 (gate) ✅ — lint/test/test-cf/build all green; manual smoke passed.

Risks / follow-ups (non-blocking):
- Spec `type` vs runner `AgentName` namespace gap is real; `--drain` maps id→type,
  but a spec whose `type` isn't a valid `AgentName` will only fail at `run`
  resolution time. Acceptable for Phase 1-3; revisit when the daemon lands.
- `index.ts` lines 141-147 (`import.meta.main` entrypoint) are structurally
  uncovered by tests — pre-existing pattern, not a regression.
- ADR check: no `00_ADR.md` divergence — change consumes package-owned schema
  (ADR-007) and stays local-first (ADR-010); `04_DESIGN.md` + `05_FEATURES.md`
  updated in the same change.

SECU: no secrets, no `.env`, no external network; message bodies are stored
verbatim in local SQLite (operator-trusted). No injection surface (parameterized
DAO queries upstream).



---

## Verification — 2026-06-03 (`/rd3:dev-verify --fix all --force`)

**Mode:** verify (Phase 7 SECU + Phase 8 traceability) · **Channel:** current (dogfood-safe)
**Scope:** team-service.ts, message.ts, team.ts, agent.ts, init.ts, status.ts, agent-service.ts, migrations.ts, 0001_spur_team_inbox.sql
**Gate after fix:** `bun run lint` PASS · `bun run test` 328 pass / 0 fail · coverage 100% func / 99.36% line
**Verdict: PASS** (1 P2 found and fixed; no open blockers)

### P1 — Blockers
_None._

### P2 — Warnings (fixed in this pass)
| # | Title | Dimension | Location | Resolution |
|---|-------|-----------|----------|------------|
| 1 | `team assign` corrupts task files whose frontmatter contains a `$`-sequence | Correctness | `team-service.ts:316` (`setFrontmatterField`) | `String.replace` interpreted `$&`/`$1`/`` $` ``/`$'` in the replacement string as special patterns. **Fixed** by passing function replacers (`() => …`) so content is written verbatim. Regression test added (`$1.00`/`$&` survive `assignTask`). Logged bug-121. |

### P3 — Info (reviewed, not actioned — intentional design)
| # | Title | Dimension | Location | Note |
|---|-------|-----------|----------|------|
| 2 | `message send --to/--from` not syntactically validated via `validateAgentId` | Correctness | `message.ts:38-48` | Deliberate: team mode addresses agents **before** their spec exists (deferred `--drain` delivery). Recipient flows only into a parameterized DAO insert (no injection) + a CLI display string (no XSS). Adding validation would be a behavior change on a Done task for marginal benefit; declined to avoid over-engineering. |
| 3 | `agent edit` builds path from raw `id` rather than `spec.id` | Usability | `agent.ts:132` | Equal by construction (`find(e => e.id === id)`); `Bun.spawn` uses array form (no shell injection from `$EDITOR`). Cosmetic only; left as-is. |

### P4 — Suggestions
_None material._

### Phase 7 SECU summary
- **Security:** No hardcoded secrets. No shell injection — `Bun.spawn([editor, path])` is array-form (no `sh -c`); a hostile `$EDITOR` cannot inject. No SQL injection — all DB access is via parameterized `InboxMessageDao` (upstream). `assignTask` calls `validateAgentId` before writing, so an `agentId` with newlines/colons cannot inject YAML. `setFrontmatterField` regexes are linear (no ReDoS) and use the literal key `assignee` (no regex injection).
- **Efficiency:** No N+1 or await-in-loop in the new paths. DB deps built lazily (spec-only ops never open a DB).
- **Correctness:** One real defect (P2, fixed). No `any`, no empty catch, no swallowed errors. Reply correctly rejects unknown/operator-originated messages.
- **Usability:** Consistent error messages with exit codes (2 = bad args, 1 = not-found/failure). Clear JSON envelopes.

### Phase 8 — Requirements traceability
- R1 DB migration → **MET** (`0001_spur_team_inbox.sql` + `INBOX_MESSAGES_SCHEMA_SQL`; table usable, tested).
- R2 TeamService → **MET** (all methods + exports; 100% covered).
- R3 agent run flags → **MET** (`--purpose/--tags/--system-prompt/--task` → PromptOptions; `--drain` folds inbox; legacy `run "x"` unchanged).
- R4 message group → **MET** (send/inbox/reply; reply threads via `in_reply_to`).
- R5 agent create/edit/delete + list --specs → **MET** (upstream `validateAgentId`; duplicate/missing guards).
- R6 team group → **MET** (assign now corruption-safe; status lists specs; start/stop stubs).
- R7 `.spur/agents/` → **MET** (init `.gitkeep`; status reports specs).
- R8 Phase 4 → **MET** (stubs only, as specified).
- R9 tests/coverage → **MET** (328 pass; 100% func / 99.36% line).
- R10 gate → **MET** (lint/test/test-cf/build green; manual smoke passed).

No scope drift. No `00_ADR.md` divergence (consumes package-owned schema ADR-007, stays local-first ADR-010).



---

### Verify follow-up — 2026-06-03 ("fix all remaining")

The two P3/P4 findings previously marked "intentional / not actioned" were applied
on request:

- **P3 (Correctness) — recipient id validation.** `TeamService.sendMessage` now
  runs `validateAgentId` on `toId` and on a non-null `fromId`; `getInbox` validates
  `agentId`. Existence is still NOT required (deferred `--drain` delivery), only
  syntax — a typo surfaces immediately instead of creating an unaddressable row.
- **P3 (Usability) — clean error exits.** `message` and `team` command dispatchers
  now wrap execution in try/catch, mapping a thrown validation/lookup error to a
  clean **exit 2** with the message, instead of letting it bubble to the top-level
  handler as a generic exit 1.
- **P4 — `agent edit`** builds the spec path from `spec.id` (canonical, validated)
  rather than the raw `id` argument.

Tests added: service-level (`sendMessage`/`getInbox` reject malformed ids; valid
future-agent accepted), CLI-level (`message send` bad id → exit 2; `team assign`
missing task → exit 2). Logged bug-122.

**Gate (post-follow-up):** `bun run lint` PASS · `bun run test` **332 pass / 0
fail**, coverage 100% func / 99.36% line · `bun run test-cf` PASS · `bun run build`
all exit 0. Postflight audit: **PASS, 0 blockers**. No open findings remain.


### P1 — Blockers
_None._

### P2 — Warnings (fixed in this pass)
| # | Title | Dimension | Location | Resolution |
|---|-------|-----------|----------|------------|
| 1 | `team assign` corrupts task files whose frontmatter contains a `$`-sequence | Correctness | `team-service.ts:316` (`setFrontmatterField`) | `String.replace` interpreted `$&`/`$1`/`` $` ``/`$'` in the replacement string as special patterns. **Fixed** by passing function replacers (`() => …`) so content is written verbatim. Regression test added (`$1.00`/`$&` survive `assignTask`). Logged bug-121. |

### P3 — Info (reviewed, not actioned — intentional design)
| # | Title | Dimension | Location | Note |
|---|-------|-----------|----------|------|
| 2 | `message send --to/--from` not syntactically validated via `validateAgentId` | Correctness | `message.ts:38-48` | Deliberate: team mode addresses agents **before** their spec exists (deferred `--drain` delivery). Recipient flows only into a parameterized DAO insert (no injection) + a CLI display string (no XSS). Adding validation would be a behavior change on a Done task for marginal benefit; declined to avoid over-engineering. |
| 3 | `agent edit` builds path from raw `id` rather than `spec.id` | Usability | `agent.ts:132` | Equal by construction (`find(e => e.id === id)`); `Bun.spawn` uses array form (no shell injection from `$EDITOR`). Cosmetic only; left as-is. |

### P4 — Suggestions
_None material._

### Phase 7 SECU summary
- **Security:** No hardcoded secrets. No shell injection — `Bun.spawn([editor, path])` is array-form (no `sh -c`); a hostile `$EDITOR` cannot inject. No SQL injection — all DB access is via parameterized `InboxMessageDao` (upstream). `assignTask` calls `validateAgentId` before writing, so an `agentId` with newlines/colons cannot inject YAML. `setFrontmatterField` regexes are linear (no ReDoS) and use the literal key `assignee` (no regex injection).
- **Efficiency:** No N+1 or await-in-loop in the new paths. DB deps built lazily (spec-only ops never open a DB).
- **Correctness:** One real defect (P2, fixed). No `any`, no empty catch, no swallowed errors. Reply correctly rejects unknown/operator-originated messages.
- **Usability:** Consistent error messages with exit codes (2 = bad args, 1 = not-found/failure). Clear JSON envelopes.

### Phase 8 — Requirements traceability
- R1 DB migration → **MET** (`0001_spur_team_inbox.sql` + `INBOX_MESSAGES_SCHEMA_SQL`; table usable, tested).
- R2 TeamService → **MET** (all methods + exports; 100% covered).
- R3 agent run flags → **MET** (`--purpose/--tags/--system-prompt/--task` → PromptOptions; `--drain` folds inbox; legacy `run "x"` unchanged).
- R4 message group → **MET** (send/inbox/reply; reply threads via `in_reply_to`).
- R5 agent create/edit/delete + list --specs → **MET** (upstream `validateAgentId`; duplicate/missing guards).
- R6 team group → **MET** (assign now corruption-safe; status lists specs; start/stop stubs).
- R7 `.spur/agents/` → **MET** (init `.gitkeep`; status reports specs).
- R8 Phase 4 → **MET** (stubs only, as specified).
- R9 tests/coverage → **MET** (328 pass; 100% func / 99.36% line).
- R10 gate → **MET** (lint/test/test-cf/build green; manual smoke passed).

No scope drift. No `00_ADR.md` divergence (consumes package-owned schema ADR-007, stays local-first ADR-010).


### References

- `docs/design/spur-team-mode-design.md` — Full team mode design (authoritative)
- `docs/analysis/relaydeck-vs-spur-analysis.md` — relaydeck messaging architecture reference
- `docs/tasks/0005_Extract_packages_app_application_services_layer.md` — Prerequisite: app layer
- `docs/tasks/0006_Design_plugin_system_architecture.md` — Plugin system (future, deferred)
- `docs/00_ADR.md` — ADR-001 (re-foundation), ADR-007 (package-owned schema), ADR-010 (local-first)
- `apps/cli/src/commands/agent.ts` — Current agent command (to extend)
- `apps/cli/src/commands/init.ts` — Current init command (to extend)
- `apps/cli/src/index.ts` — CLI dispatch (to register new command groups)
- `packages/domain/src/migrations.ts` — Migration registration
- `packages/app/src/index.ts` — App layer public API (to extend with TeamService)
- `packages/domain/src/schema/index.ts` — Schema SQL composition
- ts-libs: `packages/ai-runner/src/identity.ts` — IdentityPreamble (upstream dependency)
- ts-libs: `packages/ai-runner/src/message-service.ts` — MessageService (upstream dependency)
- ts-libs: `packages/ai-runner/src/team-orchestrator.ts` — TeamOrchestrator (upstream dependency)
- ts-libs: `packages/db/src/dao/inbox-message-dao.ts` — InboxMessageDao (upstream dependency)
