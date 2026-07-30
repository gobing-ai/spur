---
doc: design/project-switcher
feature_id: K1
owns: SURFACE + mechanism for multi-project Spur Board switching
authority: derived (ADR wins on conflict)
updated_at: 2026-07-29
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
| `list [--json]` | Table / JSON of name, path, port, running |
| `start <name\|path> [--port]` | Spawn `spur serve` in project path (detached child); wait until health OK; update registry |
| `stop <name\|path>` | SIGTERM process listening on registered port (or recorded pid if we add it later); set port 0 |

`--json` on list/start/stop for machine use. Noun name **`projects`** (plural) matches multi-entry
resource; keep `spur serve` as the low-level launcher.

**Future launchd:** `start`/`stop` become thin clients of a daemon; `ProjectRegistry` file contract
unchanged.

## 7. HTTP API

Existing: `GET /api/project` → `{ name }` (current cwd basename).

New:

```http
GET /api/projects
→ { "projects": [{ "name", "path", "port", "running": boolean, "current": boolean }] }

POST /api/projects/start
body: { "name"?: string, "path"?: string }
→ { "name", "path", "port", "running": true, "url": "http://localhost:<port>" }
```

- `running` is live-checked (TCP or `GET /api/health` with short timeout), not only `port > 0`.
- `current` marks the board’s own project.
- Start is idempotent if already running (return existing port/url).
- CF Worker: list may return empty / not configured; start returns 501 — registry is local-disk only.

Optional later: `POST /api/projects/stop` (CLI covers stop for v1).

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
