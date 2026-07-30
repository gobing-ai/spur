# Brainstorm: Project Switcher Capability

**Date:** 2026-07-29

## Overview

Currently, `spur serve --port N` must be run explicitly from each project root to access its Spur Board. Users memorize port numbers and manage multiple terminal sessions to work across projects. The request is to make the project name in the Spur Board sidebar a clickable project switcher — click it, see all known projects with running/stopped status, select one to navigate there (auto-starting if needed). Under the hood, project metadata lives in `~/.config/spur/projects.json` with port `0` meaning "not running," and auto-port allocation on startup.

## Approaches

### Approach 1: In-Process Hub Registry ⭐ Recommended

**Description:** The currently-running `spur serve` process doubles as a project registry hub. On startup, it registers itself in `~/.config/spur/projects.json` (auto-allocating a port if needed). It exposes a `GET /api/projects` endpoint listing all known projects with running/stopped status. When the web UI selects a stopped project, the hub spawns a child `bun` process running `spur serve` for that project. On shutdown (SIGINT/SIGTERM/process exit), the hub deregisters itself and kills child processes.

**Trade-offs:**
- **Pros:**
  - Minimal new infrastructure — no separate daemon process
  - Leverages existing `spur serve` and `/api/project` endpoint patterns
  - Natural extension of the current single-project model
  - `projects.json` is the stable contract for future launchd migration
  - Cross-project navigation is a simple browser redirect to the target port
- **Cons:**
  - Hub process becomes a single point of failure for multi-project visibility
  - Child process lifecycle management adds complexity (spawn, monitor, cleanup cascades)
  - Hub crash means child processes must be tracked and cleaned up
  - Concurrent writes to `projects.json` from multiple terminals need file-locking

**Implementation Notes:**
- New `ProjectRegistry` service in `packages/app` reads/writes `~/.config/spur/projects.json` with atomic file writes
- New `/api/projects` endpoint in `apps/server` returning `{ projects: [{ name, path, port, running }] }`
- `spur serve` gains `--hub` flag (implicit when `projects.json` exists) to enable registry mode
- Port allocation: scan `projects.json` for used ports, pick next available from 3000–3099 range
- Graceful shutdown: `process.on('exit')` + signal handlers deregister project and kill children
- Web UI: `LeftSidebar` project name → clickable `<button>` → fetches `/api/projects` → renders dropdown with status dots

**Confidence:** HIGH
**Sources:** Codebase inspection (apps/server/src/serve.ts, apps/web/src/components/LeftSidebar.tsx, apps/server/src/modules/health/index.ts) | Verified: 2026-07-29

### Approach 2: Standalone Project Daemon

**Description:** A separate lightweight daemon process (`spur daemon` or launchd service) manages project instances independently. It listens on a Unix socket or fixed TCP port, accepts commands (list/start/stop), and maintains `projects.json`. The web UI communicates with this daemon for project discovery and switching. Each `spur serve` instance registers with the daemon on startup.

**Trade-offs:**
- **Pros:**
  - Clean separation of concerns — registry is not coupled to any web server
  - Survives browser sessions and terminal closures
  - Natural path to launchd (the daemon is the launchd-managed process)
  - No hub-server coupling; any project can be started independently
- **Cons:**
  - New process to manage, install, and keep running
  - Additional IPC surface (Unix socket or HTTP to daemon)
  - Over-engineered for current single-user, single-machine usage
  - Adds startup latency (must check daemon is alive before any operation)

**Implementation Notes:**
- New `spur daemon` CLI command with start/stop/status subcommands
- Daemon listens on `~/.config/spur/daemon.sock` (Unix socket) or `localhost:3099`
- Project registration is push-based (each `spur serve` calls daemon on startup)
- Web UI fetches from daemon's HTTP endpoint, not from the project's own server

**Confidence:** MEDIUM
**Sources:** Architectural reasoning; no direct precedent in codebase | Verified: 2026-07-29

### Approach 3: Client-Side Only (localStorage)

**Description:** No server-side changes. The web UI stores a user-curated project list in `localStorage`. Each entry has a name and URL. The dropdown shows these entries and navigates via `window.location.href`. No auto-start, no running status, no port management — purely a bookmark list.

**Trade-offs:**
- **Pros:**
  - Zero server changes — pure frontend feature
  - Simplest possible implementation
  - No process management, no file I/O, no concurrency concerns
- **Cons:**
  - Fragile: URLs break when ports change
  - No auto-start capability (must manually start each project)
  - No running/stopped status visibility
  - No path to launchd integration
  - User must manually register and maintain project URLs
  - Does not meet the stated requirement for automatic port assignment and lifecycle management

**Implementation Notes:**
- Add a `<select>` or dropdown in `LeftSidebar` with localStorage-backed options
- "Add project" button opens a prompt for name + URL
- Selecting a project sets `window.location.href`

**Confidence:** HIGH (that it's insufficient for the stated requirements)
**Sources:** Codebase inspection | Verified: 2026-07-29

## Design Summary

The project switcher spans three layers with a shared data contract:

### Data Contract: `~/.config/spur/projects.json`

```typescript
interface ProjectsFile {
    projects: ProjectEntry[];
}
interface ProjectEntry {
    name: string;       // display name (e.g. "Spur", "Superskill")
    path: string;       // absolute or ~-prefixed filesystem path
    port: number;       // 0 = stopped, >0 = running on this port
}
```

**Rules:**
- Port `0` means no instance is running for that project
- On `spur serve` startup: if an entry exists with `port: 0`, allocate a free port and update to the new port; if no entry exists, create one with an allocated port
- On shutdown (any exit): unconditionally set port back to `0`
- Port allocation: scan all entries for used ports, pick the lowest free port ≥ 3000
- File writes are atomic (write to temp file, rename) to prevent corruption

### Layer 1: Config / App Services (`packages/config`, `packages/app`)

**New: `ProjectRegistry` service** — reads, writes, and validates `~/.config/spur/projects.json`. Exposes:
- `list(): ProjectEntry[]` — all known projects
- `register(path: string, port: number): void` — add or update an entry
- `deregister(path: string): void` — set port to 0
- `allocatePort(): number` — find next free port

**Schema validation** via Zod in `packages/config`.

### Layer 2: Server (`apps/server`)

**New: `GET /api/projects`** — returns all projects with running status:
```json
{ "projects": [{ "name": "Spur", "path": "~/xprojects/spur-new", "port": 3000, "running": true }] }
```

**New: `POST /api/projects/start`** — starts a project's `spur serve` if stopped, returns `{ port }`.

**Modified: `startServer()`** — auto-registers current project on startup, deregisters on shutdown. Accepts optional `projectName` to override basename-derived name.

**Graceful shutdown contract:** SIGINT, SIGTERM, and `process.on('exit')` all trigger deregistration (port → 0). Uncaught exceptions and unhandled rejections also trigger cleanup before exit.

### Layer 3: Web UI (`apps/web`)

**Modified: `LeftSidebar.tsx`** — the project name `<span>` becomes a `<button>` that opens a popup menu. The `useProjectName()` hook gains a sibling `useProjectList()` hook that fetches `/api/projects`.

**Popup menu:**
- Each item shows: status icon (🟢 running / ⚫ stopped) + project name
- Current project has a checkmark or highlight
- Clicking a running project: `window.location.href = url`
- Clicking a stopped project: POST to `/api/projects/start`, poll until ready, then navigate

**New: `ProjectSwitcher.tsx` component** — self-contained popup with keyboard navigation (arrow keys, Enter, Escape), click-outside-to-close, and loading/error states.

### Cross-Cutting Concerns

- **Port conflict detection:** Before allocating, verify the port is not bound by a non-Spur process
- **Stale entries:** Entries with `port > 0` but no responding process are detected via health-check on `/api/projects` list and marked as "unknown" in the UI
- **Concurrent writes:** File-level advisory lock (or `mkdir`-based lock) for `projects.json` updates from multiple terminal sessions
- **Future launchd path:** The `ProjectRegistry` interface is designed so a launchd-managed `spur daemon` can replace the in-process registry by implementing the same contract — the server and web layers are unchanged

## Recommendations

**Adopt Approach 1 (In-Process Hub Registry)** with the following scope decisions:

1. **Ship now:** `ProjectRegistry` service, `GET /api/projects`, `LeftSidebar` project switcher popup, auto-registration on serve startup, graceful deregistration on shutdown, auto-port allocation.
2. **Defer:** Child process spawning (start a stopped project from the hub). Initial implementation shows stopped projects as greyed out; clicking them shows a "run `spur serve` from that project" tooltip. This avoids the complexity of nested Bun process management in v1 while still delivering the core value of project discovery and switching between running instances.
3. **Design for later:** The `POST /api/projects/start` endpoint and the `ProjectManager` subprocess spawner are designed but implemented in a follow-up. The `projects.json` schema and API contract remain stable through both phases.

**Rationale:** The in-process hub model matches current usage (single developer, macOS, interactive terminal sessions) without introducing a new persistent process. It builds directly on the existing `spur serve` infrastructure. Deferring child-process spawning to phase 2 reduces risk and delivers value faster — the core pain point (finding which port each project is on) is solved immediately.

## Next Steps

1. Create `ProjectRegistry` service in `packages/app/src/services/project-registry.ts` with Zod schema, atomic file I/O, and port allocation
2. Add `GET /api/projects` endpoint to `apps/server/src/modules/health/index.ts`
3. Add auto-registration to `startServer()` in `apps/server/src/serve.ts`
4. Add graceful deregistration on SIGINT/SIGTERM/exit
5. Create `ProjectSwitcher.tsx` component in `apps/web/src/components/`
6. Modify `LeftSidebar.tsx` to integrate project switcher
7. Write tests: `ProjectRegistry` unit tests, `/api/projects` integration tests, `ProjectSwitcher` component tests
8. (Phase 2) Implement `POST /api/projects/start` and child process spawning

---

**Generated by:** sp:brainstorm
**Research delegation:** in-process codebase inspection (scout)
