---
kind: design
title: Downstream Board module configuration and contributions
status: accepted
created_at: 2026-09-27
updated_at: 2026-09-27
related: [A8, docs/plans/2026-09-27-dynamic-board-modules-brainstorm.md]
tags: [contract, A8, web, config]
---

# Downstream Board module configuration and contributions

## 1. Issue and scope

The installed Board discovers only built-in modules through its build-time Vite glob. Downstream projects need explicit project-owned extensions without modifying Spur's checkout. Native React contributions are the selected primary direction; an iframe adapter can put existing embeddable applications into the same navigation. This design is accepted and unimplemented. See [A8](../features/A8_downstream-spur-board-modules-and-embedded-resources.md), [the investigation](../plans/2026-09-27-dynamic-board-modules-brainstorm.md), and [ADR-128](../00_ADR.md#adr-128-project-owned-board-contributions-share-one-host-registry).

This scope includes compiled React libraries and iframe URLs. It excludes server entry imports, external manifests, process management/proxying, iframe-directory hosting, automatic cross-document messaging, simultaneous split views, and live configuration replacement. One selected module occupies the Board workspace at a time. UI rules belong to [root DESIGN.md](../../DESIGN.md#product-ui--downstream-board-modules-proposed).

## 2. Context and constraints

- Current `bootstrapOptionsSchema` accepts options and strips modules; the new declaration belongs to Spur's config loader, not ts-infra's generic bootstrap engine.
- `WebModule` already supplies component and optional rightPanelComponent. The pure createRegistry validator is reusable; registerModuleRoot is a no-op and exported modules/defaultModule/routes are snapshots.
- BoardApp creates its router once. Runtime contributions must be resolved before constructing that registry/router; imports naturally occur after the Bun listener opens.
- The published CLI ships prebuilt Board assets and no public UI authoring export. Adding runtime facade assets and a type-only export is necessary for native contributions.
- The Bun/Hono probe establishes that Bun can replace handlers after listening but Hono cannot append routes to its finalized matcher. UI-only contributions need fixed catalog/asset handlers, so v1 does not mutate live routes.

## 3. Solution and ownership

The project config contains a discriminated union. Both types share identity and navigation metadata; only the native type has an ESM asset source. A browser composition step adapts both to the existing WebModule shape. An iframe is implemented by one Board-owned React component receiving validated data; it does not participate in the external React ABI.

| Owner | Responsibility |
| --- | --- |
| packages/config | Validate declarations through the existing merged project-config loader; no extension execution |
| packages/app | Resolve project-relative asset roots and create the public catalog; enforce path/identity rules without importing browser code |
| packages/contracts | Public catalog DTOs and the read-only oRPC procedure; no React or domain types |
| apps/server | Thin catalog handler and restricted static asset transport, composed before fallback routes |
| apps/web | Shared runtime facade build entries, async composition, existing registry/router integration, frame adapter, and module error boundaries |
| apps/cli distribution | Ship the Board runtime manifest/facades and public authoring declarations with the existing release assets |

The read-only catalog is `contract.board.modules` with path `/board/modules` under the existing `/api` OpenAPI prefix. Implement it with implement(contract) and use the typed OpenAPILink client. `BoardModuleCatalog` returns `{catalogVersion:1, runtime, modules}`; runtime records contributionApiVersion 1, React/DOM/router versions and explicit facade imports. Runtime may be null only for an empty enabled catalog without a capable Board distribution (standalone or legacy), preserving these existing paths without filesystem loading. Enabled contributions require compatible runtime metadata. Public descriptors include safe same-origin entryUrl/styles or iframe source.url, never canonical filesystem roots or server-only configuration. Routes retain the relative WebModule route segment derived from id. Directory-to-URL lookup stays server-side. Static files use fixed `/modules/:id/*` handling; reserve that namespace ahead of the Board SPA fallback.

The browser loads the catalog, loads configured native entries/styles with per-module failures contained, creates iframe adapters and native/error contributions, and combines them with built-ins through createRegistry. A route factory and registry provider give the router, sidebar, active-module lookup and layout the same resolved registry; no mutable global snapshot is used as an async update mechanism. Preserve the current built-in landing target independently of external navigation order. A catalog failure leaves built-ins usable with a visible catalog diagnostic. Native loading is bounded per contribution so a stalled entry cannot indefinitely block built-ins; a timed-out module gets an error route rather than a successful status.

## 4. Configuration and contribution contract

```yaml
bootstrap:
  modules:
    - id: catalog
      name: Catalog
      icon: "📦"
      type: react
      web:
        directory: ./board/catalog/dist
        entry: ./index.js
        styles: [./index.css]
    - id: documentation
      name: Documentation
      icon: "📚"
      type: iframe
      source:
        url: https://docs.example.test/
```

These examples are proposed and are not accepted by today's schema. `docs.example.test` is an illustrative URL, not a verified embeddable resource.

### 4.1 Shared fields and validation

- type is required and is exactly react or iframe. Reject mixed type-specific fields and unsupported fields, including server and manifest, inside a module declaration.
- id is a nonempty safe lowercase path segment, proposed pattern `[a-z][a-z0-9-]*`; name/icon are nonempty strings. Derive route from id rather than duplicating it. Optional description/sidebarLabel/order reuse existing WebModule meanings; order must be finite. enabled defaults to true.
- Reject duplicate ids/routes, collisions with all built-in declarations and retired redirect routes, even for disabled declarations. Record the config index/id and reason in diagnostics.
- Disabled entries retain structural validation but require no existing assets and execute no code. An absent/empty list preserves existing Board behavior. Preserve bootstrap.options and unrelated merged configuration.
- Enabled native roots/entries/styles must exist and pass containment checks before listening. Unsupported Board distribution capability also fails before listen. Ordinary CLI commands validate config without executing downstream Board code or checking enabled Board assets unnecessarily.

### 4.2 Native React contributions

```ts
import type { ComponentType } from 'react';

export interface BoardModuleContribution {
    readonly apiVersion: 1;
    readonly component: ComponentType;
    readonly rightPanelComponent?: ComponentType;
}
```

The entry exports `webModule` conforming to this shape. Metadata is exclusively in YAML. TSX is authoring syntax; the browser receives compiled ESM. A contribution exports components and does not call createRoot. Keep the public contract derived from existing WebModule fields rather than exposing private Board contexts.

Publish this declaration as a proposed **type-only** `@gobing-ai/spur/board` package export. It is not a runtime SDK. The implementation should generate its declaration artifact from the authoring type, include it in the CLI package's exports/files, and prove resolution from a separately installed downstream fixture. React type imports are supplied by the consumer's documented compatible development dependencies; no React value import is introduced into the CLI or plugin standalone surfaces.

web.directory resolves relative to the project root selected by the existing serve invocation, independent of shell cwd. entry and styles resolve inside that canonical directory; entry is required and styles defaults to an empty list. Reject absolute/escaping entry/style paths and traversal or symlink escape at request time. A declared root may point to a separate built asset tree; it is an explicit trusted configuration choice, not permission to expose the entire project. JS responses have correct MIME types; missing JS/CSS/chunks return real errors rather than HTML. In v1 use no-store for these project-owned module assets and require restart/reload after a rebuild; immutable asset generations are unnecessary without hot replacement.

Vite library mode produces ESM and explicit CSS. Externalize react and react/jsx-runtime; also externalize react/jsx-dev-runtime for development artifacts. Supported React DOM/React Router imports, when needed, must resolve to the corresponding host instances. Bundle other module-private dependencies into the module's browser output rather than introducing unsupported bare imports.

The Board build must emit runtime facades from the **same client build graph** as its renderer. Build-time facade entry exports include the supported React and JSX runtime modules; supported router/DOM subpaths are listed explicitly in the shipped runtime manifest, with no wildcard promise. Generated import-map entries resolve bare imports to those emitted facade URLs before module entry evaluation. Building a second standalone React runtime or merely setting peerDependencies/dedupe does not establish identity. The distribution-root `board-runtime.json` records manifestVersion 1, catalogVersion 1, contributionApiVersion 1, reactVersion/reactDomVersion/reactRouterVersion, imports and generated reservedModules (built-in id/route metadata and retired identities). The packaged host inventory remains authoritative when validating a project web override; a project dist/web override with enabled contributions must advertise this compatible protocol or fail clearly before listen.

The implementation proof must establish these outputs with the repository's pinned Astro/Vite versions. At planning readiness, resolving Vite from the installed Astro 6.4.2 package gives Vite 7.3.3, matching bun.lock; resolving Vite from an ancestor directory is not evidence about this build. Exact bundler wiring remains the first work unit; do not prescribe newer build options from current web docs without checking the installed build tool. If the facade proof fails, return to design with the project-specific Board-build alternative rather than silently adding Module Federation or substituting iframes for declared native modules.

Initial supported runtime versions follow the Board release and its documented compatibility matrix (current source pins React/React DOM 19.2.1 and React Router 7.11.0). apiVersion is checked before registration, though importing a trusted ESM entry necessarily evaluates its top-level code. Shared React does not make independently defined context objects identical. Add a supported project/API/navigation capability only for a demonstrated first-module need; no private hooks become public by implication. Scope module CSS and avoid global resets or shell-wide Tailwind output. Load explicit styles before displaying the contribution. Import, incompatible-export and render errors produce useful module diagnostics while built-ins remain navigable.

### 4.3 Iframe contributions

source.url is an absolute HTTP/HTTPS URL without embedded credentials. The configured application is independently operated; Spur does not start or proxy it. One built-in frame adapter supplies an accessible title and an always-available Open externally link with noopener/noreferrer for a new browsing context. Browser framing, mixed-content, cookie/authentication and popup policies still apply. The Board cannot force an arbitrary external site to embed or reliably inspect cross-origin failure content.

Respect the child's CSP frame-ancestors and X-Frame-Options and any existing host frame-src policy. Do not weaken protections, describe ordinary same-origin frames as a security sandbox, or treat the iframe load event as successful application readiness. Retain same-origin browser restrictions. A URL app on another localhost port is a different origin. No automatic Board context/theme, keyboard, data or route synchronization is promised; child navigation and HMR stay with its own application. Switching away unmounts the frame and may reset child state. No hidden-frame persistence is required.

When concrete interaction requires a bridge, add narrowly defined versioned postMessage events with event.origin/event.source checks and exact targetOrigin. A display-only iframe requires no messaging SDK.

### 4.4 Lifecycle and runtime limits

Validate/resolve config and establish fixed catalog/asset handlers before Bun.serve. Browser imports happen after the listener starts and before registry/router construction; they do not add server routes. Changes to config or native builds require server restart and browser reload. No watcher, live registry updates, ESM cache invalidation, or resource-draining protocol is part of v1. Each project server owns its own catalog/assets; project switching follows the existing origin navigation.

No downstream server entry is required or imported. Native components may call existing supported APIs; an application-specific backend remains separately owned. This proposal changes the local Bun Board; Cloudflare Worker deployments do not acquire filesystem module loading. Future Worker support needs a deployment-specific asset/catalog contract.

## 5. Tradeoffs and proof sequence

| Candidate | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| One registry, native ESM loader and built-in frame adapter | Native tools and existing apps share navigation without a new plugin engine | Shared React release contract plus browser framing limits | Recommended |
| Iframe-only catalog | Independent runtimes and minimal loader | Weaker native shell/context/right-panel integration | Rejected as the sole rendering model |
| Project-specific Board build | One build graph naturally shares dependencies | Portable build kit and full Board rebuild for module changes | Fallback if native distribution proof fails |

First prove a separately built hook-bearing native module in the actual installed CLI Board, including another local React installation, scoped styles/chunks, deep links, an optional right panel, incompatible exports and error containment. Use a build-known adapter injected only into a temporary test build, independently served fixture ESM and the actual installed renderer; this proof must not depend on a not-yet-built generic config/catalog loader. Do not ship test routes or adapters in the production package. Prove the exported authoring type from that installed package. Also exercise an owned URL app that permits framing, an app that rejects framing, external-open behavior, child navigation and mobile/focus/scrolling. A denied frame must not be misreported as ready; cross-origin failure detection is not promised. Neither frontend proof has been run yet.

Only after those proofs should production config/catalog, restricted assets and browser composition be implemented through the normal task pipeline. Authoring docs and portable config examples must be updated alongside implemented surfaces; until then, examples remain proposed. Live data bridges, split views and module process lifecycle await explicit requirements.

Sources: [React shared-instance requirement](https://react.dev/warnings/invalid-hook-call-warning#duplicate-react), [Vite library mode](https://vite.dev/guide/build#library-mode), [import maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap), [CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors), [postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage), [iframe event behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#error_and_load_event_behavior).
