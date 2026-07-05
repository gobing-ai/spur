# Workspace Design

Authority: `docs/00_ADR.md` (ADR-025). Feature G3.

## 1. Data Model

A **Workspace** is a named composition layer that binds a git work-folder, an agent team
roster, and per-agent inboxes into one collaborative unit surfaced as a board module.

```typescript
interface Workspace {
  id: string;            // kebab-case slug, derived from name
  name: string;          // human-readable label
  gitFolder: string;     // absolute or cwd-relative path to the git work-folder
  worktree: boolean;     // true = isolated git worktree; false = bare folder (v1: false)
  agentIds: string[];    // team roster — agent spec ids from .spur/agents/
  inboxScope: 'workspace' | 'agent'; // v1: 'workspace' — messages scoped to workspace agents
  active: boolean;       // v1: single active workspace; the rest are dormant
  boardTabs: string[];   // ordered tab set for the workspace board module
}
```

**Single-active-workspace stance (v1).** Only one workspace is active at a time. This
avoids concurrency complexity for inbox scoping, process supervision, and shared SQLite
state. Multi-workspace scheduling is a deferred concern.

**Inbox scoping rule (§2).** When `inboxScope === 'workspace'`, the Inbox tab under the
workspace board only shows messages between agents listed in `agentIds`. An agent belongs
to exactly one workspace in v1 (enforced by the team roster invariant: an agent spec id
cannot appear in two workspaces' rosters concurrently).

## 2. Config Placement

Workspace definitions live in the project config (`spurConfigSchema`), not the env config
(`configSchema`). Rationale: workspaces are project-specific (tied to `.spur/`), not
environment-specific. The two-schema split in `packages/config` is documented in ADR-021.

```yaml
# .spur/config.yaml
workspaces:
  - id: default
    name: Default
    gitFolder: "."
    agentIds: [planner, coder]
    active: true
```

`spur init` seeds a `default` workspace with the root `.spur/agents/` directory.

## 3. Lifecycle

- **Create:** `spur workspace create <name> [--git-folder <path>] [--agent <id>...]` →
  writes the workspace entry to `.spur/config.yaml` config.
- **Open:** `spur workspace open <id>` → sets `active: true` on the target, `active: false`
  on all others; the server reloads the workspace context on next serve.
- **Close:** `spur workspace close <id>` → `active: false`; no-op on the last workspace.
- **List:** `spur workspace list [--json]` → enumerates all defined workspaces with their
  active flag.

No delete in v1 (workspaces are append-only; dormant workspaces are just not active).

## 4. Server API

Routes mounted under `/api/workspaces` by a new `workspaces` module (Bun-gated, no-op on CF):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/workspaces` | List all workspaces (id, name, active flag) |
| GET | `/api/workspaces/current` | Active workspace detail (full config + agent roster) |
| PUT | `/api/workspaces/:id/open` | Set active workspace |
| PUT | `/api/workspaces/:id/close` | Deactivate workspace |

## 5. Board Module

A `workspaces` web module provides the workspace dashboard. Tabs:

| Tab | Composes from | Purpose |
|-----|---------------|---------|
| Overview | Workspace API, task.list | Active workspace status, agent roster, recent tasks |
| Team | Team API (processes + start/stop), SupervisorService | Team process registry, start/stop controls |
| Inbox | Messages API (inbox scoped to workspace agentIds) | Workspace-scoped message feed with live tail |
| Tasks | Task Kanban (filtered by workspace) | Tasks in the workspace's git folder |

Tab components re-use existing module components (InboxTab, ProcessListTab) where they
already compose correctly under workspace-scoped data.

## 6. Isolation Rule

**Workspace-scoped messaging (v1):** a `message.send` to an agent not in the sender's
workspace is rejected with a clear error. This is enforced at the TeamService layer by
checking the active workspace's `agentIds` roster. Cross-workspace messaging is deferred.

## 7. Seam Review (G1/G2 cross-check)

| G1/G2 seam | Workspace needs | Status |
|------------|----------------|--------|
| TeamService.sendMessage | Workspace-scoped agent validation | Add check in 0197 |
| TeamService.getInbox | Scoped to workspace agents | Add filter in 0197 |
| SupervisorService | Per-workspace process registry | Compose in WorkspaceService |
| Message IPC events | Workspace-aware filter on inbox tab | Add filter in 0197 web tab |
| Process list API | Workspace-scoped process list | Add filter in 0197 server module |

## 8. Non-Goals

- Multi-machine workspace replication
- Permissions / RBAC
- Non-git folder workspaces
- Concurrent multi-workspace scheduling (single active workspace in v1)
- Workspace-scoped task visibility (all tasks in the git folder are visible)
- Cross-workspace messaging
