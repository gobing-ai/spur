---
schema_version: 1
id: "K4"
name: "One-port project gateway with path prefixes and launchd daemon"
status: active
priority: P2
tags: []
created_at: "2026-11-17T00:02:35.082Z"
updated_at: "2026-11-17T01:11:13.400Z"
---

# K4: One-port project gateway with path prefixes and launchd daemon

## Goal

Make every local registered project reachable through one stable, fixed port under its own URL path prefix (for example `/knowledge-kit`), served by a single long-lived Spur gateway that can run as a macOS user LaunchAgent, so a Cloudflare tunnel or any reverse proxy needs exactly one ingress target that survives project restarts and reboots. Remote registry entries keep their current host and port behavior unchanged.

## Scope

**In scope**
- Optional `prefix` on local entries in `~/.config/spur/projects.json`: slug form, unique among local entries, reserved segments refused, default derived from `name`; existing entries keep working without migration. `spur projects add --prefix`.
- Gateway mode `spur self serve --gateway [--port] [--host]`: one fixed port routes `/<prefix>/*` to the project's own `spur serve` on an internal loopback port (prefix stripped), streams SSE, and lazily starts or adopts the project serve through `startRegisteredProject`.
- Gateway-side adaptation so project serves stay unchanged: host guard and CSRF against the public origin, `Host`/`Origin` rewritten to the loopback upstream, `text/html` responses and `Location` headers rebased under `/<prefix>/` with an injected `<meta name="spur-base">`.
- Board base-path awareness (relative built chunks, `basePath()`-derived API, router basename, raw links, Markdown links, module assets, module-kit export) so the same build works under a prefix and at the root.
- Shared-origin hygiene: per-project namespacing of Board `localStorage` keys and one planning-event stream per tab, because every local project now shares the gateway origin.
- Project switcher and `spur projects list`: local entries resolve to `/<prefix>/board` on the gateway origin; remote entries keep `http://<host>:<port>/board`.
- `spur self daemon <install|uninstall|status>`: a macOS user LaunchAgent whose only job is keeping the gateway always on (`RunAtLoad`, `KeepAlive`, captured PATH, log files).
- ADR-151 superseding the K1 "no daemon / launchd out of scope" decision, plus gateway, switcher and architecture doc updates.

**Out of scope**
- Collapsing `spur serve` into one multi-tenant process (per-project DB, fleet, scheduler, job worker and owner lock stay process-scoped).
- Changing remote entries' host/port semantics or proxying remote hosts through the gateway.
- Host-based (subdomain) routing.
- Linux systemd, Windows service, or root LaunchDaemon support.
- Access control and authentication for tunnel exposure — configured at the Cloudflare tunnel layer, not in Spur.
- Cloudflare tunnel provisioning or `cloudflared` configuration.
- Browser-side isolation between local projects beyond storage namespacing (same origin is accepted under local operator trust).

## Acceptance Criteria

```gherkin
Feature: One-port project gateway with path prefixes and launchd daemon

  @core
  Scenario: R1 — Local entries accept an optional validated prefix
    # covers: I1, I4
    Given a projects.json with local entries with and without a prefix field and a remote entry
    When the registry is loaded and a prefix is added or changed through the registry service
    Then a local entry without prefix resolves to a slug derived from its name such as /knowledge-kit
    And a prefix that is not a slug, collides with another local entry, or uses a reserved segment api, board, modules or _astro is rejected with an actionable error
    And existing entries load and serve unchanged without a migration step

  @core
  Scenario: R2 — Remote entries keep host and port semantics
    # covers: I3
    Given a remote entry with host 192.168.87.27 and port 3003 next to a local entry with the same path
    When the registry is read, listed, and resolved for navigation
    Then the remote entry keeps its stored host and port and resolves to http://192.168.87.27:3003/board
    And no prefix is derived for, required of, or routed through the gateway for the remote entry

  @core
  Scenario: R3 — Gateway routes each local prefix on one fixed port
    # covers: I2, I5, I9
    Given the gateway listening on one fixed port and two local projects with distinct prefixes
    When a client requests /<prefix>/api/health and /<prefix>/board for each project through that port
    Then each request reaches only that project's own spur serve on its internal loopback port with the prefix stripped
    And an unknown prefix answers 404 naming the known prefixes
    And per-project process isolation for database, fleet, scheduler and owner lock is unchanged

  @core
  Scenario: R4 — Gateway lazily starts or adopts a project serve
    # covers: I2, I5
    Given a local project whose serve is stopped and another whose serve is already running
    When the first requests for each prefix arrive at the gateway concurrently
    Then the stopped project is started once through the existing project start path and the requests are answered once health is OK
    And the running project is adopted without spawning a duplicate owner

  @core
  Scenario: R5 — Server-sent event streams pass through the gateway
    # covers: I2, I5
    Given a Board SSE subscription opened through /<prefix>/
    When the project serve emits events
    Then the client receives each event incrementally without buffering until the stream closes
    And closing the client closes the upstream stream

  @core
  Scenario: R6 — Board works under a prefix and at the root
    # covers: I2, I6
    Given the same built Board served once through the gateway under /<prefix>/ and once directly on its per-project port
    When an operator opens the Board, navigates between routes, loads Board-module assets and receives live updates
    Then every API call, link, SSE stream, module asset and static asset resolves under the active base path
    And no request escapes to the origin root under the prefix, verified by a browser E2E artifact

  @core
  Scenario: R7 — Switcher navigates local by prefix and remote by host and port
    # covers: I6
    Given a registry with two local entries and one remote entry and the Board opened through the gateway
    When the operator opens the project switcher and selects each entry
    Then a local entry navigates to /<prefix>/board on the current origin
    And a remote entry navigates to http://<host>:<port>/board
    And spur projects list reports the resolved URL for each entry

  @core
  Scenario: R8 — Gateway serves the tunnel origin and adapts requests for the upstream
    # covers: I5
    Given the gateway configured with an allowed tunnel hostname
    When a browser on the tunnel origin loads a Board page and sends a same-origin POST, and another request arrives with an unlisted Host or a cross-origin Origin
    Then the page HTML and redirects are rebased under /<prefix>/ and the POST succeeds without any project serve change
    And the unlisted Host is refused with 421 and the cross-origin POST is refused with 403 before reaching any project serve

  @core
  Scenario: R9 — Gateway installs as a macOS user LaunchAgent
    # covers: I7
    Given macOS and an installed spur binary
    When the operator runs spur self daemon install, status and uninstall
    Then install writes a user LaunchAgent plist with RunAtLoad, KeepAlive, captured PATH, log file paths and the absolute spur binary running the gateway, and bootstraps it with launchctl
    And status reports loaded state, pid and gateway health
    And uninstall boots it out and removes the plist, and repeating install or uninstall is idempotent

  @edge
  Scenario: R10 — Daemon lifecycle fails clearly off macOS or on a conflicting port
    # covers: I7
    Given a non-macOS platform, or the fixed gateway port held by a foreign process
    When the operator installs the service or the gateway starts
    Then the command exits nonzero naming the unsupported platform or the conflicting port
    And no partial plist or half-registered service is left behind

  @core
  Scenario: R11 — Architecture decision and size evaluation are recorded
    # covers: I8, I9
    Given the K1 decision that launchd and a standalone daemon were out of scope
    When the gateway design is accepted
    Then a new ADR records the one-port gateway plus LaunchAgent decision, the rejected multi-tenant single-process and host-routing alternatives, and supersedes the K1 daemon exclusion
    And the project-switcher design and architecture docs describe the prefix contract, gateway routing and daemon lifecycle with the evaluated size

  @edge
  Scenario: R12 — Projects sharing the gateway origin keep separate browser state and bounded connections
    # covers: I6
    Given two local projects opened in separate tabs through the same gateway origin
    When the operator edits a conversation draft, resizes panels and keeps both Boards open with live updates
    Then drafts, layout and column preferences of one project never appear in the other while the theme stays global
    And each tab holds one shared planning-event stream instead of one per component
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1358 | Runtime base path for the Board | todo |
| 1359 | Gateway routes local prefixes on one fixed port | todo |
| 1363 | Accept ADR-151 and sync gateway docs | todo |
| 1357 | Registry prefix contract for local projects | testing |
| 1361 | Switcher and project list resolve gateway URLs | todo |
| 1362 | Gateway LaunchAgent install, uninstall and status | todo |
| 1360 | Gateway origin, CSRF and forwarded-header trust | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-11-17T00:21:24.181Z moved Q → K4 (system)
- 2026-11-17T01:11:13.400Z backlog → active (system)

