---
schema_version: 1
id: "A84"
name: "Board module backend API handlers: optional in-process Web-Fetch routes (/api/modules/:id/*)"
status: verifying
priority: P1
tags: []
created_at: "2026-11-26T18:58:44.414Z"
updated_at: "2026-11-26T20:03:35.929Z"
---

# A84: Board module backend API handlers: optional in-process Web-Fetch routes (/api/modules/:id/*)

## Goal

Let a downstream project's Board modules serve their own backend HTTP routes from the Spur server the project already runs, so a module ships one optional built-ESM Web-Fetch handler at `/api/modules/<id>/*` instead of a second loopback server, a second daemon, hand-rolled CORS, and a `127.0.0.1` URL that remote gateway access cannot reach.

## Scope

- In:
  - Optional `api` field on `type: react` entries of `bootstrap.modules`: a non-empty project-relative path to a built ESM bundle, added to the Zod declaration parser and the tracked/bundled JSON Schema together, rejected on `type: iframe`, with strict unknown-key rejection retained.
  - A type-only public handler contract (`BoardModuleApiContext`, `BoardModuleApiHandler`) published from the `@gobing-ai/spur/board` entry through the generated `index.d.ts`, with no value imports.
  - Startup validation in `prepareBoardModules`: absolute paths, lexical escapes outside the project root, missing or non-file targets, and symlinks resolving outside the real project root fail closed and name the module id; the resolved path stays on the internal asset root and never enters the public module catalog.
  - Request dispatch at `/api/modules/:id` and `/api/modules/:id/*` inside the existing Board server module, before the oRPC `/api/*` handlers so host-guard and CSRF middleware still apply; the module prefix is stripped with query string, method, headers and body preserved; unknown, disabled or API-less modules answer 404 JSON and handler failures answer 500 JSON without crashing the server.
  - Handler loading keyed by resolved real path and file `mtimeMs`, so rebuilding a module bundle takes effect on the next request without restarting `spur self serve`, and modules sharing one bundle share one loaded instance.
  - Same-origin access through the project gateway path `/<project>/api/modules/:id/*` proven for `GET` and `POST` (query string and request/response bodies) with no CORS configuration and no second port, plus the module authoring documentation update in the same commit.
- Out:
  - Supervised subprocess, Unix-socket or non-JavaScript sidecar backends.
  - Live reload of module declarations from `.spur/config.yaml`; adding or removing a module still needs a server restart, only a rebuilt bundle reloads.
  - Module-owned authentication, authorization or CSRF exemptions beyond the host guard and CSRF the server already applies.
  - Filesystem module APIs on the Cloudflare Worker deployment target.

## Acceptance Criteria

```gherkin
# Keep the Feature: line (feature check L3.ac-bdd-error without it). Each Scenario: title is the
# identity key tasks reference verbatim ("- [ ] AC1 — <title>"); number R1, R2, …; never rename after tasks link.
Feature: Board module backend API handlers: optional in-process Web-Fetch routes (/api/modules/:id/*)

  @core
  Scenario: R1 — Configuration accepts a module API bundle and still rejects invalid shapes
    # covers: I1
    Given a project `.spur/config.yaml` declares `bootstrap.modules`
    When a `type: react` entry sets `api` to a non-empty project-relative path
    Then declaration parsing and JSON-Schema validation both accept it
    And an empty `api` or an `api` on a `type: iframe` entry fails with a `bootstrap.modules[i]` error
    And unknown keys are still rejected

  @core
  Scenario: R2 — The published Board types carry the handler contract
    # covers: I2
    Given the generated `@gobing-ai/spur/board` type entry point
    When a downstream author imports the module API contract
    Then `BoardModuleApiContext` and `BoardModuleApiHandler` are exported as interfaces
    And the generated declaration file holds no value imports and typecheck passes

  @core
  Scenario: R3 — Startup fails closed on unusable module API paths
    # covers: I3
    Given an enabled `type: react` module declares `api`
    When startup preparation sees an absolute path, a `../` escape, a missing file, a non-file target or a symlink resolving outside the project root
    Then it fails with a module-specific configuration error naming the id and reason
    And a valid declaration puts the resolved path only on the internal asset root, never in the public catalog

  @core
  Scenario: R4 — Module routes dispatch rewritten requests and contain failures
    # covers: I4
    Given the Board server is running with an enabled module that declares `api`
    When a client calls `GET /api/modules/<id>/items?limit=5` and a `POST /api/modules/<id>/actions` with a body
    Then the handler receives the remainder path, the query string, the method, the body and `{ projectPath, moduleId }`
    And unknown, disabled or API-less modules answer 404 JSON
    And a handler that throws or exports no `fetch` answers 500 JSON while the server keeps serving

  @core
  Scenario: R5 — A rebuilt module bundle reloads without a server restart
    # covers: I5
    Given a module route already served `v1` from its bundle
    When the bundle is rebuilt on disk
    Then the next request serves the new code
    And two modules pointing at the same unchanged bundle share one loaded instance

  @core
  Scenario: R6 — The gateway reaches module routes same-origin with no CORS or extra port
    # covers: I6
    Given a project served behind the gateway with a module that declares `api`
    When a client calls `GET` and `POST` on `http://localhost:<gatewayPort>/<project>/api/modules/<id>/...`
    Then the gateway forwards to the project's own server, the host guard and CSRF checks pass, and the module response returns unchanged
    And no CORS header or second loopback port is needed, and the authoring guide documents the contract
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1455 | Support optional Web-Fetch backend API handlers on native Board modules (/api/modules/:id/*) | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-11-26T20:02:51.078Z backlog → active (system)
- 2026-11-26T20:03:35.929Z active → verifying (system)

