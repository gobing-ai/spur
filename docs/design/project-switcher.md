---
doc: design/project-switcher
feature_id: K1
owns: SURFACE + mechanism for multi-project Spur Board switching and the project fleet
authority: derived (ADR wins on conflict)
updated_at: 2026-09-14
---

# Project switcher — system design (feature K1)

## 1. Problem

Operators run `spur serve --port N` per project root, memorize ports, and open separate browser tabs.
There is no shared registry of known Spur projects and no board affordance to switch or auto-start
another project.

## 2. Decision

**Adopt the in-process hub registry** (Approach 1 from
`docs/plans/2026-07-29-project-switcher-brainstorm.md`):

| Choice | Decision | Why |
| --- | --- | --- |
| Registry location | `~/.config/spur/projects.json` | User-global, survives per-project cwd; stable contract for future launchd |
| Hub model | Every `spur serve` registers itself; any instance can list/start peers | No new daemon in this stage |
| Port semantics | `port == 0` ⇒ stopped; `port > 0` ⇒ claimed listen port | Matches operator mental model in the idea brief |
| Switch UX | Top-left project name → popup menu with running/stopped icons | Reuses existing identity surface (`LeftSidebar` + `/api/project`) |
| Auto-start | Selecting a stopped project starts `spur serve` for that path | Required by feature AC R2 / R9 |
| Launchd | Out of scope; registry + start/stop APIs stay daemon-agnostic | Future swap of hub for launchd agent without web redesign |

**Rejected (this stage):** standalone daemon (Approach 2 — overbuilt); client-only localStorage
(Approach 3 — no auto-start / no lifecycle).

## 3. Data contract

```typescript
// ~/.config/spur/projects.json
interface ProjectsFile {
    schema_version: 1;
    projects: ProjectEntry[];
}

interface ProjectEntry {
    name: string; // display name
    path: string; // absolute or ~-expandable project root
    port: number; // 0 = stopped; >0 = listening port last claimed
}
```

**Lifecycle rules**

1. **Start** — if matching entry has `port === 0` (or is missing), allocate a free port, write it,
   then listen. Prefer explicit `--port` when provided; still register that port.
2. **Stop (any exit path)** — set the entry’s `port` to `0` (SIGINT, SIGTERM, intentional stop,
   process death cleanup on next discovery when the claimed port is not live).
3. **Stale reclaim** — when listing, if `port > 0` but nothing answers health on that port, treat as
   stopped and rewrite `port: 0`.
4. **Concurrency** — advisory lock around read-modify-write of `projects.json` (mkdir-lock or
   exclusive create of sibling `.lock` dir under `~/.config/spur/`).

Path matching: expand `~`, resolve realpath when the directory exists; identity key is normalized
absolute path (name is display-only, unique by convention).

### 3.1 Project fleet declaration — `<projectPath>/.spur/fleet.json` (0835)

The **project** is the composition unit (ADR-116). Its agent roster is a fleet declared in the
project's own tree, schema owned by `packages/config/src/index.ts` (`FleetDeclarationSchema`):

```typescript
interface FleetDeclaration {
    version: 1;
    members: FleetMember[];
    /** memberLocalId of the planner-role member carrying purpose: 'orchestrator'; absent = none declared. */
    orchestrator?: string;
}

interface FleetMember {
    id?: string; // explicit stable id — wins outright in the memberLocalId allocator (0835 R3)
    role?: string; // closed Layer-1 role vocabulary, shared with team members
    executor?: string; // agent.executors name
    purpose?: string;
    enabled?: boolean; // default true; false keeps the derived `<role>-<n>` index but is not materialized
}
```

Invariants: a member declares `role` or `executor` (at least one); the declaration is **desired state
only** — no process or liveness fields, which are read from the occupant and supervisor surfaces;
`enabled: false` preserves the member's derived id index so later members never silently reallocate.
A declaration with no enabled members is valid and resolves to a fleet whose `missing` names the fix.

**Resolution.** `FleetService` (`packages/app/src/services/fleet-service.ts`) owns the lifecycle:
`load(projectPath)` reads and validates the declaration, `resolve(projectPath)` produces the
resolved fleet plus `capacity.missing`, `resolveOrchestrator(projectPath)` returns the bound
orchestrator (absent ⇒ `missing`, never inferred by search), `materialize(projectPath, { check })`
reconciles specs (the `spur projects list --fleet` preview is the `check` path), and
`assertLaunchGroundTruth(projectPath)` is the serve-start gate. Delivery and capacity receipts are
[§7 fleet ownership and dispatch boundaries](#fleet-ownership-and-dispatch-boundaries-g62).

**Board surface.** The Projects module (`apps/web/src/modules/projects/`) renders the fleet as the
Agents tab's declared-vs-observed roster, with Conversation and Processes as its sibling tabs (the
three-tab contract); the roster reads `/api/project/fleet` rather than the retired
`GET /api/team/teams` roster shape.

## 4. Module boundaries

```
packages/config     Zod schema for ProjectsFile + default path helper
packages/app        ProjectRegistry service (list/get/upsert/setPort/allocatePort/withLock)
apps/cli            spur serve lifecycle hooks; spur projects {add,remove,list,start,stop}
apps/server         GET /api/projects; POST /api/projects/start; optional POST .../stop
apps/web            ProjectSwitcher + LeftSidebar integration
```

**Ownership**

| Concern | Owner |
| --- | --- |
| Schema + path defaults | `packages/config` |
| File I/O, lock, port allocate, stale heal | `ProjectRegistry` in `packages/app` |
| Process spawn for start | CLI `projects start` + server start handler (shared helper in app) |
| HTTP transport DTOs | inline JSON in server module (or contracts only if reused by web typed client) |
| UI | `apps/web` only |

Apps stay thin transports (ADR-021). No domain DAO/SQLite for the registry — file is SSOT.

## 5. Serve integration

Extend `startServer` / `registerServeCommand` (no new server process type):

1. Resolve project root (`--cwd` / context cwd) and display name (basename or optional override).
2. `ProjectRegistry.registerOrUpdate({ path, name, port })` after bind port is known.
3. On graceful shutdown path already used by serve: always `setPort(path, 0)`.
4. Best-effort: `process.on('beforeExit' / 'exit')` + signal handlers already draining serve —
   add registry deregister in the same teardown so intentional and crash-adjacent exits clear the port.
5. SIGKILL: cannot run handlers; next `list`/`/api/projects` stale-heal clears the port.

When `.spur/fleet.json` exists, startup materializes its enabled members after the quota-update drain
and before autostart or HTTP admission. CLI and server share `resolveAgentRoles`, including configured
role overrides and stage-floor validation. Invalid declarations or ground-truth mismatches stop startup.
Registration preserves an existing project name because fleet mailbox IDs use that name as their prefix.

**Port assignment**

- If CLI `--port` set → use it (fail if bind fails).
- Else if registry entry has `port > 0` and still healthy → prefer reuse only when same process
  restart is intentional; default safer path: if port free, reuse; if busy, allocate new.
- Else allocate lowest free port in a configurable band (default **3000–3999**), verifying OS bind
  readiness before commit to registry.

## 6. CLI surface (`spur projects`)

| Verb | Behavior |
| --- | --- |
| `add <path> [--name]` | Upsert entry with `port: 0`; require valid Spur project root (`.spur/` or monorepo signal) |
| `remove <name\|path>` | Drop entry (does not kill a running process — warn if port > 0) |
| `list [--json] [--fleet]` | Table / JSON of name, path, port, running; `--fleet` (0835/0836) also resolves each project's `.spur/fleet.json` declaration, orchestrator binding and capacity under the same verb |
| `start <name\|path> [--port]` | Spawn `spur serve` in project path (detached child); wait until health OK; update registry |
| `stop <name\|path>` | SIGTERM process listening on registered port (or recorded pid if we add it later); set port 0 |
| `migrate [path] [--dry-run\|--apply] [--json]` | Preview legacy team conversion by default; explicit `--apply` backs up a differing fleet declaration and writes the conversion. Conflicts exit 2. |

`--json` on list/start/stop for machine use. Noun name **`projects`** (plural) matches multi-entry
resource; keep `spur serve` as the low-level launcher.

Migration reads existing inbox and coordination addresses through a read-only SQLite connection,
without schema migrations; a missing database or table contributes no addresses. It refuses conversion
when the target registry name differs from the legacy team ID (`project-name-mismatch`): fleet spec
IDs use the registry name as their prefix, so the names must agree to preserve mailbox identity.
The operator resolves that conflict explicitly; migration never renames the project or merges teams.

**Future launchd:** `start`/`stop` become thin clients of a daemon; `ProjectRegistry` file contract
unchanged.

## 7. HTTP API

Existing: `GET /api/project` → `{ name, path }` (cwd basename + normalized worktree path; both null without a server project context — 0840 added `path`).

New:

```http
GET /api/projects
→ { "projects": [{ "name", "path", "port", "running": boolean, "current": boolean }] }

POST /api/projects/start
body: { "name"?: string, "path"?: string }
→ { "name", "path", "port", "running": true, "url": "http://localhost:<port>" }

GET /api/project/fleet   (0840)
→ { "path": string|null, "strategy": { "name": "rest"|"gtd", "version": number }|null,
    "orchestrator": { "state": "bound-online"|"bound-offline"|"missing"|"unresolvable", "instanceId"?, "holderId"?, "reason"? },
    "members": [{ "instanceId", "role"?, "executor", "model"?, "enabled", "writeCapable", "capabilityState" }],
    "capacity": { "total", "enabled", "writeCapable", "missing": string[] } }
```

- `running` is live-checked (TCP or `GET /api/health` with short timeout), not only `port > 0`.
- `current` marks the board’s own project.
- Start is idempotent if already running (return existing port/url).
- CF Worker: list may return empty / not configured; start returns 501 — registry is local-disk only.
- `/api/project/fleet` (0840) reads the served project's own migrated db and `.spur/fleet.json`
  through `FleetService` + `StrategyRuntime`; every fact degrades to a named state
  (`missing`/`unresolvable`/`null`) instead of a 500.
  Role-only members use the shared role resolver against fresh merged config, including configured
  role tiers and stage-floor validation, even when the caller supplies no role table.
- Wire contract (0840 review F1): `orchestrator` is a **claim projection** —
  `{ state, instanceId?, holderId?, reason? }`. `holderId` is intentionally included on
  `bound-online`; the raw `project_claims` row is never echoed. 0841-0843 freeze on this shape.
- An invalid/unreadable `.spur/fleet.json` keeps FleetService's purpose-built detail (file +
  reason) in `capacity.missing` (0840 review F3) — never a placeholder, never a 500.

Optional later: `POST /api/projects/stop` (CLI covers stop for v1).

### Fleet ownership and dispatch boundaries (G62)

- `bound-online` requires an unexpired claim matching the declared orchestrator instance.
  A second process is refused even when it uses the same spec ID. Acquisition increments the
  generation; heartbeat and release require that exact generation. Released rows retain it.
- The managed orchestrator loop restores persisted strategy and reconciles prior deliveries
  before selection. Unconfigured projects default to `rest`; Board reads never reset strategy.
  `rest` leaves queued input unstarted and permits running work to finish and reconcile.
- GTD selects `fleet:auto` tasks through the existing task checker and dependency gate, in
  priority/WBS order. Existing assignees constrain member selection; otherwise coder or
  role-unspecified members are eligible. Running instance generations consume capacity.
  Prior run receipts hold a still-todo task for explicit reconciliation rather than repeat it.
- Selected tasks execute through `AgentService.runTraced` and `/sp:dev-run`, preserving the task
  pipeline's verification and advancement gates. Spec-addressed fleet runs require the managed
  dispatch guard. Arbitrary queued messages cannot bypass task authorization.
- Write acquisition atomically checks the live owner and persisted GTD strategy version.
  The loop renews ownership and the running write lease every ten seconds against a thirty-second
  TTL. The slot is released after completion reconciliation. Proven read-only assignments take
  no write slot; unknown capability never grants read-only concurrency.
- The capacity receipt records both the write-lease generation and originating orchestrator
  generation. Result validation requires both to match their live owners. Missing receipt
  evidence fails closed; replaced owners produce a diagnostic without a task transition.
  Executor resolution is followed by another owner/strategy/lease check before each launch.
- Registration, materialization, supervision, and spec-addressed execution validate real process
  cwd, spec workspace, filesystem storage root, and (when opened) SQLite's backing file.
  Project path aliases are accepted; foreign storage roots and storage symlinks are rejected.
  Environment identity hints are not proof of project ownership.
- Wake sources are messages/replies, task creation/update, strategy/capacity changes, and invocation
  exits. CLI senders persist metadata-only events; managed invocations flush the existing ledger.
  `--poll` remains the backstop, idle holds are recorded on change, and undeclared projects retain
  legacy queue consumption. Idle wakes make no model call.

### Request envelope (0841)

Board requests travel as ordinary `inbox_messages` rows — operator mailbox
`board-operator` to the orchestrator instance, read back through the existing
non-consuming `GET /api/messages/inbox` (no new endpoint, no client-side
message store). When the request carries explicit references, the web client
prefixes the body with a single envelope line; a request without refs stays a
plain message so `spur message` output and the Projects Conversation tab see the operator's
text verbatim:

```
SPUR-REQUEST/1 {"refs":[{"kind":"task","wbs":"0844"},{"kind":"feature","id":"G63"}]}

<human request text, verbatim>
```

- `refs` items are `{kind:'task', wbs}` or `{kind:'feature', id}`; fields are
  serialized in that fixed order so the envelope is deterministic.
- Decoding is prefix-guarded and total: missing prefix, truncated or non-JSON
  payload, wrong shape, or malformed ref items degrade to the whole body as
  text with `refs: []` — a malformed envelope is prose, never a dropped
  message.
- Owner: `apps/web/src/modules/projects/conversation.ts`
  (`encodeRequestEnvelope` / `decodeRequestEnvelope`); submission wiring is
  task 0844.

### Agents roster two-fact card (0842)

The Agents tab renders the served project's fleet as cards that join two
independent facts, never collapsed into one indicator:

- DECLARED — the member from `GET /api/project/fleet` (`members`, the 0840
  wire of FleetService 0835): role, executor, `model` (the resolved executor
  profile's model, omitted when it declares none), `enabled`, `capabilityState`.
- OBSERVED — the process from the existing `GET /api/team/processes` read:
  `running` / `exited` / `not-started`, pid, startedAt, exitCode.

They disagree in both directions (declared-but-not-running; a live process
with no declared member) and the card shows both, joined by `instanceId`.
Issue labels are frozen and shared with the global input receipts (0844):

| Condition | Label | Next action |
| --- | --- | --- |
| `capabilityState === 'unavailable'` | executor unavailable | the executor cannot run here — check the executor's install/attestation |
| `capabilityState === 'unknown'` | capability unknown | no attestation exists; it grants nothing and is not a failure |
| not running, no capability issue | not running | start it |
| orchestrator + `bound-offline` | orchestrator offline | its claim is held but stale — see `project_claims` |

- Join: pure `buildRoster(snapshot, processes)` in
  `apps/web/src/modules/projects/roster.ts`. The orchestrator is marked only
  when the binding carries a matching `instanceId` (never guessed on
  `missing`/`unresolvable`); undeclared live processes are appended
  (`undeclared`); the operator mailbox `board-operator` is never rendered.
- Member detail: a pane (not a route, no focus trap) mounting the existing
  process/terminal (`MemberTerminal`), messages (non-consuming
  `GET /api/messages/inbox`), activity (`GET /api/events/history`), and the
  lifecycle verbs `/api/team/*` already exposes — start, stop, stdin. Escape
  restores focus to the opener card.
- Member details read the fleet snapshot (`GET /api/project/fleet`, already in board context) for the
  selected member's `model` and the project's common working directory. A declared member whose
  resolved executor profile names no model reports `Executor default`; an undeclared live process
  reports `Unavailable`. Values are matched by instance id, so selecting another member cannot retain
  the previous member's details.
- Test attributes: `data-roster-entry`, `data-roster-declared`,
  `data-roster-observed`, `data-roster-issue`, `data-member-detail`,
  `data-g6="open-member"` (the prototype selector, reused by 0845).

### Processes tab (0852)

`ProjectTabId` is `conversation | agents | processes`. The 0843 Work tab, which
embedded `KanbanBoard` / `FeaturesShell` / `ProcessesView` as sections, was
removed on 2026-09-14: Tasks and Features are their own Board modules, so
Projects no longer duplicates them. `/board/projects/work` resolves to the
default tab through the `useProjectTab` unknown-segment rule. The Work-side task
reference capture (`addRef({kind:'task', wbs})`) left with it. The draft's ref
contract (`ConversationRef`, chips, submission) is unchanged.

- `ProcessesView` restores the retired 0262/0264/0267 watch list. It polls
  `GET /api/team/processes` for rows: supervised processes plus registry
  one-shots, deduplicated by covered agentId/pid. The rows sit behind the 0267
  filter bar (running-only, source, team/unassigned), with an empty state when
  nothing matches. The wire parse stays in `MemberTerminal.tsx`
  (`parseProcessList`/`parseExecutions`).
- Draft placement: `BoardLayout` provides `ConversationDraftContext` (0841),
  because `GlobalAgentBar` mounts outside the module.
- Test attributes: `data-g6="task-chip"` on the conversation's task reference
  chip; `data-processes-filter-*` / `data-processes-filters` on the filter bar.
- Owner: `apps/web/src/modules/projects/tabs.tsx`.

## 8. Web UI

**`ProjectSwitcher`** (new component):

- Trigger: expanded sidebar project title becomes a button (`aria-haspopup="menu"`).
- Menu: list from `GET /api/projects`; each row = status icon + name (+ optional port).
  - Running: filled/green indicator
  - Stopped: muted indicator
  - Current: checkmark / `aria-current`
- Select running → `window.location.assign(url)` (same path `/board` on target origin).
- Select stopped → `POST /api/projects/start`, loading state, then navigate to returned `url`.
- Keyboard: arrows, Enter, Escape; click-outside closes.
- Collapsed sidebar: keep fold UX; switcher only when expanded (or icon affordance if trivial).

Hooks: keep `useProjectName()`; add `useProjectList()` with refresh on open.

## 9. Process spawn helper

Shared `startProjectServe({ path, port?, detached: true })` in `packages/app` or CLI helper:

- Resolve `spur` binary: `process.execPath` / argv0 when running bundled CLI; else `spur` on PATH.
- Spawn: `spur serve --cwd <path> --port <n> --no-open` (no nested browser storms).
- Do not block the hub event loop beyond health poll budget; surface errors to API/CLI.

**Out of scope:** supervising children after hub exit (orphan serves keep running until stopped;
registry still reflects ports until stale-heal). Document that hub death does not kill children.

## 10. Testing strategy

| Layer | Tests |
| --- | --- |
| Registry | unit: allocate, lock, stale heal, ~ expansion, atomic write (temp dir) |
| Serve lifecycle | integration: start registers port; SIGTERM → port 0 |
| CLI projects | command tests with fake registry path via env override |
| API | health-module style request tests |
| Web | component tests for open/select/start loading (happy-dom) |

Env override for tests: `SPUR_PROJECTS_FILE` (or config key) → absolute path, never touch real
`~/.config/spur/projects.json` in unit tests.

## 11. Doc / surface sync

Same-commit with surface changes (constitution T3):

- `docs/04_DESIGN.md` — `spur projects` table + `/api/projects` shapes
- `docs/03_ARCHITECTURE.md` — short multi-project registry paragraph pointing here
- ADR — user-global project registry (see `docs/00_ADR.md` ADR-037)

## 12. Phased delivery (task batch)

| Phase | Deliverable | Unlocks AC |
| --- | --- | --- |
| A | Registry + schema + lock + tests | foundation |
| B | Serve register/deregister + auto port | R3, R4, R5, R14 |
| C | `spur projects` CLI | R6–R10, R8 |
| D | HTTP list + start | R11, R2 server half |
| E | Board switcher UI | R1, R2, R12 |

Launchd remains a future feature; no task in this batch.

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| Concurrent registry writes | advisory lock + atomic rename |
| Port collision with non-Spur processes | bind probe before commit |
| Hub cannot start child (path/binary) | clear API/CLI error; leave port 0 |
| Cross-origin boards | full navigation, no shared cookies needed for local boards |
| `--strict` feature check orphans before tasks | known idea-pipeline friction; tasks restore traceability |

## 14. Open points (non-blocking)

- Persist `pid` in `ProjectEntry` for more reliable stop (optional enhancement).
- Port band config key in spur config vs hard-coded 3000–3999.
- Whether `projects add` auto-runs on first `spur serve` without prior add (recommended: yes).
