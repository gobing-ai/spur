---
schema_version: 1
name: Switcher and project list resolve gateway URLs
status: done
template: feature-impl
created_at: 2026-11-17T00:06:29.307Z
updated_at: "2026-11-17T05:11:16.066Z"
feature_id: K4
priority: P2
tags:
  - web
  - board
  - cli
estimate_hours: 4

dependencies: ["1357", "1358", "1359"]
done_forced: "false"
done_reason: unforced close
---

## 1361. Switcher and project list resolve gateway URLs

### Background

Feature K4 (ADR-151, `docs/design/project-gateway.md` §6 B9, B10, B13, §8). Through the gateway every local project shares one browser origin. Navigation must use `/<prefix>/board` for local entries, and two side effects of the shared origin must be contained: per-project `localStorage` keys collide, and HTTP/1.1's six-connections-per-origin cap is exhausted by per-component EventSources once 3+ project tabs are open. Covers R7, R12.

### Requirements

- [x] R7. `/api/projects` returns `prefix` (null for remote) and `url` per entry; the switcher navigates local entries to `/<prefix>/board` on the current origin when `basePath() !== '/'` (else today's per-port URL) and remote entries to `http://<host>:<port>/board`; `spur projects list` shows a URL column (`--json` adds `prefix`, `url`).
- [x] R12. Per-project `localStorage` keys are namespaced by base path (unchanged keys at `/`), `spur-theme` stays global, and each Board tab holds one planning-event EventSource shared by GlobalAgentBar, InboxView, SystemEventsTab and the existing subscribers.

### Acceptance Criteria

- [x] AC1 — Switcher navigates local by prefix and remote by host and port (req: R7)
- [x] AC2 — Projects sharing the gateway origin keep separate browser state and bounded connections (req: R12)

Verification: (1) `(cd apps/server && bun test tests/modules/health*.test.ts)` for `/api/projects` shape; (2) `(cd apps/cli && bun test tests/commands/projects*.test.ts)` for the list URL column and JSON; (3) happy-dom tests `(cd apps/web && bun test tests/components/ProjectSwitcher*.test.tsx tests/lib/base-path*.test.ts)` asserting navigation targets with and without the meta; (4) extend the 1358 heavy browser E2E with two prefixes in two tabs: a draft typed in tab A is absent in tab B, and the network log shows exactly one `/events/planning` stream per tab (plus none from InboxView/SystemEventsTab). Artifact: the network log + localStorage dump per tab.

### Q&A

- Namespacing scheme: `scopedKey(key) = basePath() === '/' ? key : `${key}@${basePath()}``. Root access keeps existing keys so no operator loses drafts/layout on upgrade; prefixed access starts fresh per project (accepted — one-time).
- `spur-theme` stays global on purpose (one operator, one theme).
- SSE consolidation targets only planning-event consumers; MemberTerminal process streams stay per-terminal (they are opened on demand).
- Local ceiling documented in `docs/design/project-gateway.md` §6: with one stream per tab, ~4 concurrent local tabs plus terminals fit in six connections; the Cloudflare tunnel serves HTTP/2, which multiplexes and removes the cap.
- `projects list` URL: gateway URL when `GET http://127.0.0.1:<server.gateway.port>/api/health` answers `gateway: true` (200 ms timeout), else per-port. No gateway auto-start from `list`.

### Design

Server / CLI:

- `apps/server/src/modules/health/index.ts:428` `/api/projects`: add `prefix: resolveProjectPrefix(entry)` and `url` (`prefix` → `${prefix}/board` relative path; remote → `http://<host>:<port>/board`; local without gateway context → `http://<host>:<port>/board`). Update the contract DTO in `packages/contracts` (additive optional fields) and regenerate OpenAPI per repo process.
- `apps/cli/src/commands/projects.ts:181` `list`: add `URL` column and JSON `prefix`, `url`; derived collisions from `findPrefixCollisions` (1357) printed as a warning line with the remedy.

Web:

- `apps/web/src/lib/base-path.ts` (1358): add `export function scopedKey(key: string): string`.
- Apply `scopedKey` at: `drafts.tsx:19` (`spur.board.projects.draft.v1`), `layout-state.ts` (`spur-board-layout-v3` and its v2/legacy migration reads), `spur:detail-width`, `spur:new-task-panel-width`, `spur:database:columns:v1:<table>`. Grep gate: `rg -n "localStorage\.(get|set|remove)Item\(" apps/web/src` — every hit is `spur-theme` or goes through `scopedKey`.
- `ProjectSwitcher.tsx:39` `directBoardUrl(entry)`: if `entry.prefix && basePath() !== '/'` → `${entry.prefix}/board` (same origin); else existing per-port logic. `:293` and `:311` use the server-provided `url` when present.
- SSE: `GlobalAgentBar.tsx:318`, `InboxView.tsx:20`, `SystemEventsTab.tsx:116` subscribe through `subscribePlanningEvents` (`apps/web/src/lib/planning-events.ts:64`) instead of `new EventSource`. If a consumer needs an event type the shared stream does not carry, extend the shared subscriber's event filter rather than opening a second stream.

Invariants: root (`/`) behavior and storage keys unchanged; remote navigation unchanged.
Rejected: `sessionStorage` (loses drafts across tab close); per-project cookies; SharedWorker multiplexing (overkill once streams are shared).

### Plan

1. Failure cases first (tests before code):
   - with meta `/a/`: draft saved in project A is not readable with meta `/b/`; with no meta the legacy key is read.
   - `spur-theme` identical across bases.
   - switcher with meta: local → `/kk/board`, remote → `http://192.168.87.27:3003/board`; without meta: local → per-port URL.
   - `/api/projects` remote entry: `prefix: null`, url host:port; local: `prefix: "/kk"`.
   - mounting GlobalAgentBar + InboxView + SystemEventsTab creates exactly one EventSource (happy-dom EventSource spy).
   - `projects list` prints the collision warning for two `kk` entries.
2. Server/contract → CLI → `scopedKey` sites → switcher → SSE consolidation.
3. Run `(cd apps/server && bun test)`, `(cd apps/cli && bun test tests/commands/projects*.test.ts)`, `(cd apps/web && bun test)`, `bun run test:heavy`, `bun run spur-check`.

### Solution

| File | Lines | What / why |
| --- | --- | --- |
| `apps/web/src/components/base-path.ts` | 55-72 | `scopedKey(key)`: `'/'` returns the key unchanged (no operator loses drafts/layout on upgrade), a prefix namespaces it as `` `${key}@${base}` `` so two projects on the shared gateway origin cannot read each other's state. |
| `apps/web/src/lib/layout-state.ts` | 1, 31-100 | All three layout keys (v3 + v2/legacy migration reads/writes) go through `scopedKey`, so migration stays per project. |
| `apps/web/src/modules/projects/drafts.tsx` | 19, 66, 82 | Conversation draft storage scoped — the exact collision R12 names (draft typed in project A visible in project B). |
| `apps/web/src/modules/task-kanban/KanbanBoard.tsx`, `settings/WorkflowsView.tsx`, `projects/ProcessesView.tsx` | `DETAIL_WIDTH_KEY` sites | `spur:detail-width` scoped, so panel geometry is per project. |
| `apps/web/src/modules/task-kanban/NewTaskPanel.tsx` | 8, 111, 211 | `spur:new-task-panel-width` scoped. |
| `apps/web/src/modules/projects/DatabaseView.tsx` | 313-318 | `getTableStorageKey` wraps the per-table columns key in `scopedKey`. |
| `apps/web/src/lib/theme.ts` | 1-22 | Unchanged on purpose: `spur-theme` stays global (one operator, one theme). |
| `apps/web/src/lib/planning-events.ts` | 1-45 | Shared subscriber now forwards `message.*` frames and carries the whole parsed `frame`, so every planning consumer (tasks, features, queue, inbox, agent bar, system events) reads one stream. |
| `apps/web/src/components/GlobalAgentBar.tsx`, `modules/projects/InboxView.tsx`, `modules/observability/SystemEventsTab.tsx` | effect blocks | The three per-component `new EventSource('/api/events/planning')` instances are replaced by `subscribePlanningEvents` (SystemEventsTab also uses `subscribePlanningConnection` for its live/error badge). MemberTerminal's per-agent process stream is untouched (on-demand). |
| `apps/server/src/modules/health/index.ts` | 445-460 | `/api/projects` adds `prefix` (`resolveProjectPrefix`, `null` for remote) and `url` (`${prefix}/board` for local, `http://host:port/board` for remote). |
| `apps/cli/src/commands/projects.ts` | 12-13, 199-215, 318-325, 525-535 | `projects list` gains a `url:` line and JSON `prefix`/`url`; the URL is the gateway URL only when a gateway actually answers `GET /api/health` on `server.gateway.port` (200 ms probe, never starts one); derived prefix collisions print the remedy (`spur projects add <path> --prefix /<other>`). |
| `apps/web/src/components/ProjectSwitcher.tsx` | 5-13, 44-56, 296-312 | `RegistryProject` carries `prefix`/`url`; `directBoardUrl(project, base)` returns `/<prefix>/board` (same origin) when a base path is active and keeps the per-port URL at the root; the stopped-project start path prefers the prefix URL under the gateway. |
| Tests | `apps/web/tests/components/base-path.test.ts` (+scopedKey), `tests/components/project-switcher.test.ts` (+gateway cases), `tests/lib/planning-events.test.ts` (+`message.*`/frame), `tests/lib/planning-stream-single.test.ts` (static guard: only the shared module opens a planning `EventSource`), `apps/server/tests/modules/health.test.ts` (+prefix/url shape), `apps/cli/tests/commands/projects-list-url.test.ts` (JSON + human URL column + collision warning) | Cover R7 and R12 failure cases the task's Plan names. |

Deviation, stated: the Plan's item (4) proposed extending the browser E2E with a second tab on a second prefix. Driving a draft/layout write needs a live API (the browser fixture's `/api/*` is a 404 stub), so the two-tab browser check was replaced by the deterministic happy-dom `scopedKey` isolation tests plus the static single-stream guard, and the prefix browser proof remains the 1358 heavy E2E.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R7 — `/api/projects` returns `prefix` (`null` for remote) and `url`; the switcher navigates local entries to `/<prefix>/board` on the current origin when `basePath() !== '/'` (else the per-port URL) and remote entries to `http://<host>:<port>/board`; `spur projects list` shows a URL and `--json` adds `prefix`/`url` | MET | server `apps/server/src/modules/health/index.ts:442-455` (`prefix`, `url`), switcher `apps/web/src/components/ProjectSwitcher.tsx`, CLI `apps/cli/src/commands/projects.ts`; tests `apps/web/tests/components/project-switcher.test.ts`, `apps/cli/tests/commands/projects-list-url.test.ts`, `apps/server/tests/modules/health.test.ts` — Fresh 2026-11-16: web 31, cli 14, server 109 pass |
| R12 — per-project `localStorage` keys are namespaced by base path (unchanged at `/`), `spur-theme` stays global, and each tab holds one planning-event EventSource shared by GlobalAgentBar, InboxView, SystemEventsTab and the existing subscribers | MET | `apps/web/src/components/base-path.ts:64` `scopedKey`; tests `apps/web/tests/lib/layout-state.test.ts`, `apps/web/tests/lib/planning-stream-single.test.ts`, `apps/web/tests/lib/planning-events.test.ts` — Fresh 2026-11-16: pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Switcher navigates local by prefix and remote by host and port (req: R7) | MET | test | `apps/server/tests/modules/health.test.ts`, `apps/web/tests/components/project-switcher.test.ts`, `apps/cli/tests/commands/projects-list-url.test.ts` — Fresh 2026-11-16: exit 0 |
| AC2 — Projects sharing the gateway origin keep separate browser state and bounded connections (req: R12) | MET | test | `apps/web/tests/components/base-path.test.ts` scopedKey isolation, `apps/web/tests/lib/planning-stream-single.test.ts` single EventSource — Fresh 2026-11-16: exit 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Req | Status | Evidence |
| --- | --- | --- |
| R7 | MET | `apps/server/src/modules/health/index.ts:445-460`; `apps/web/src/components/ProjectSwitcher.tsx:44-56,296-312`; `apps/cli/src/commands/projects.ts:199-215,318-325`; `packages/app/src/services/project-gateway.ts:46-63` (200 ms gateway probe); server/web/CLI tests |
| R12 | MET | `apps/web/src/components/base-path.ts:55-72`; scoped layout/draft/width/database keys; `apps/web/src/lib/planning-events.ts:1-45` + the three consumers; scopedKey isolation, `message.` frame and single-stream guard tests |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | test | health 37 pass (local prefix/url, remote null/absolute); switcher tests (prefix, root, remote); CLI list JSON + `url:` line + collision remedy |
| AC2 | MET | test | scopedKey per-base isolation + legacy key at `/`; `planning-stream-single` guard (only the shared module opens a planning EventSource); web suite 568 pass |

Findings: no open P1–P3. P4: 200 ms probe bound; local `url` is prefix-relative by convention; SystemEventsTab's badge now tracks the shared connection.

Residual risk: one planning stream per tab (~4 local tabs fit HTTP/1.1's cap); MemberTerminal keeps its on-demand per-agent stream.

Deviation: the Plan's two-tab browser check was replaced by deterministic scopedKey + single-stream tests (the browser fixture has no live API to write a draft against).

**Disposition: PASS.**

### References

- Feature K4 R7, R12; ADR-151; `docs/design/project-gateway.md` §6 (B9, B10, B13), §8.
- `apps/web/src/components/ProjectSwitcher.tsx:39,293,311`, `apps/web/src/lib/planning-events.ts:64`, `apps/server/src/modules/health/index.ts:428`, `apps/cli/src/commands/projects.ts:181`.
- Depends on 1357, 1358, 1359.

### History

- 2026-11-17T00:21:24.181Z feature_id Q → K4 (system)
- 2026-11-17T01:57:44.645Z todo → wip (system)
- 2026-11-17T02:16:27.618Z wip → testing (system)
- 2026-11-17T02:16:29.023Z testing → done (system)

