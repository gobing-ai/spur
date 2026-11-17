---
schema_version: 1
name: Switcher and project list resolve gateway URLs
status: todo
template: feature-impl
created_at: 2026-11-17T00:06:29.307Z
updated_at: "2026-11-17T00:29:14.290Z"
feature_id: K4
priority: P2
tags:
  - web
  - board
  - cli
estimate_hours: 4

dependencies: ["1357", "1358", "1359"]
---

## 1361. Switcher and project list resolve gateway URLs

### Background

Feature K4 (ADR-151, `docs/design/project-gateway.md` §6 B9, B10, B13, §8). Through the gateway every local project shares one browser origin. Navigation must use `/<prefix>/board` for local entries, and two side effects of the shared origin must be contained: per-project `localStorage` keys collide, and HTTP/1.1's six-connections-per-origin cap is exhausted by per-component EventSources once 3+ project tabs are open. Covers R7, R12.

### Requirements

- [ ] R7. `/api/projects` returns `prefix` (null for remote) and `url` per entry; the switcher navigates local entries to `/<prefix>/board` on the current origin when `basePath() !== '/'` (else today's per-port URL) and remote entries to `http://<host>:<port>/board`; `spur projects list` shows a URL column (`--json` adds `prefix`, `url`).
- [ ] R12. Per-project `localStorage` keys are namespaced by base path (unchanged keys at `/`), `spur-theme` stays global, and each Board tab holds one planning-event EventSource shared by GlobalAgentBar, InboxView, SystemEventsTab and the existing subscribers.

### Acceptance Criteria

- [ ] AC1 — Switcher navigates local by prefix and remote by host and port (req: R7)
- [ ] AC2 — Projects sharing the gateway origin keep separate browser state and bounded connections (req: R12)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature K4 R7, R12; ADR-151; `docs/design/project-gateway.md` §6 (B9, B10, B13), §8.
- `apps/web/src/components/ProjectSwitcher.tsx:39,293,311`, `apps/web/src/lib/planning-events.ts:64`, `apps/server/src/modules/health/index.ts:428`, `apps/cli/src/commands/projects.ts:181`.
- Depends on 1357, 1358, 1359.

### History

- 2026-11-17T00:21:24.181Z feature_id Q → K4 (system)

