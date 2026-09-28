---
kind: plan
title: Dynamic downstream modules for the Spur Board
status: accepted
created_at: 2026-09-27
updated_at: 2026-09-27
related: [A8, docs/design/downstream-board-modules.md]
tags: [brainstorm, A8, web, config]
needs_design: true
run_id: board-modules-a2a8208c-4586-4278-bdc5-6da2ea9d7a3f
---

# Dynamic downstream modules for the Spur Board

## 1. Objective and recommendation

Let a downstream project select Board modules in its own `.spur/config.yaml`, then use its installed Spur CLI to show those modules alongside the built-ins. The project does not edit or rebuild the Spur checkout.

The operator selected **embedded definitions + native React component contributions + Vite**, with no required server entry. The accepted design includes an explicit iframe type for existing embeddable resources, adapted into the same Board registry by one built-in component. Downstream native authors write TSX and build browser ESM; iframe authors supply a URL. Both share project navigation. The installed-Board shared-runtime proof is still required. Config selection changes require server restart and browser reload in v1.

Sections 4–8 retain the original, broader native-module proposal with external manifests and optional server extensions. Section 10 records the subsequent iframe alternative, and section 11 records the narrower native-only revision. Section 12 records the selected direction and requested dual-mode compatibility; the proposed governed contract is now [downstream-board-modules.md](../design/downstream-board-modules.md). Historical alternatives do not add requirements to the current scope.

The selected idea is recorded as feature A8 through the CLI. The detailed design is accepted, and tasks 0988–0992 are ready for dependency-ordered delegation. Acceptance criteria and requirement coverage pass their planning checks. No production implementation has started; section 13 records the handoff and execution preconditions.

## 2. Current behavior and verified premises

| Boundary | Current fact | Source |
|---|---|---|
| Configuration | The Spur schema accepts only `options` inside its bootstrap object. A supplied `modules` key disappears from the parsed config. | [bootstrapOptionsSchema](../../packages/config/src/index.ts#L894); local parse probe below |
| Infrastructure bootstrap | Installed ts-infra 0.5.9 reads logging, telemetry, scheduler, events, and database from bootstrap YAML; it does not load `bootstrap.modules`. Its portable Plugin/PluginHost lifecycle exists but is a different contract. | `node_modules/@gobing-ai/ts-infra/dist/application-node.js`, `runNodeApplication`; `dist/application/plugins/types.d.ts` |
| Server modules | Static built-ins implement `ServerModule.mount(app, ctx)` and are mounted before the global API handler and static/SPA fallback. | [types](../../apps/server/src/modules/types.ts), [registry](../../apps/server/src/modules/registry.ts), [createApp](../../apps/server/src/bootstrap.ts) |
| Browser modules | WebModule owns identity, label, icon, route, component, optional right panel, description, sidebar label, and order. | [WebModule](../../apps/web/src/modules/types.ts) |
| Discovery | Browser imports come from an eager Vite glob at build time. The filesystem fallback is for Bun tests, not a browser loader. | [discoverModules](../../apps/web/src/modules/discover.ts#L104) |
| Runtime registration | `registerModuleRoot` is a no-op. `modules` and `defaultModule` are exported snapshots, and routes are constructed from them. | [registry](../../apps/web/src/modules/registry.ts#L65), [router](../../apps/web/src/router.tsx#L21) |
| Browser startup | BoardApp creates its router once per mount. Dynamic discovery must finish before that construction. | [BoardApp](../../apps/web/src/components/BoardApp.tsx) |
| Distribution | The CLI ships prebuilt web assets and schema exports, with no public Board SDK/build kit. The server prefers project `dist/web` when available. | [CLI manifest](../../apps/cli/package.json), [bundleWeb](../../scripts/commands/bundle-web.ts), [resolveWebDistPath](../../apps/server/src/serve.ts#L552) |
| Project isolation | Switching projects navigates to that project's server URL; each server already owns one project root. | [ProjectSwitcher](../../apps/web/src/components/ProjectSwitcher.tsx#L228) |

The `bootstrap.modules` name is reasonable because these are project-owned startup contributions. Spur config and application composition should own its schema and semantics. Do not imply that this key already belongs to ts-infra, or change a reusable infrastructure facade merely to give it Board-specific knowledge. Reuse PluginHost only if actual resource lifecycle work needs it.

Documentation describing root registration as usable runtime discovery overstates current implementation. Correct the module-authoring guide when the new contract becomes real.

## 3. Bun startup versus changes while serving

The relevant ordering boundary is **before the first request reaches the composed Hono app**, rather than an absolute Bun requirement that all future modules exist before `Bun.serve`.

A focused assertion-based experiment on the installed versions produced:

| Experiment | Observation |
|---|---|
| Bun 1.3.14: serve, make a request, reload fetch handler, request again | PASS: new handler is used |
| Bun 1.3.14: add a native route through server.reload after serving | PASS: new route is available |
| Hono 4.12.23: add a route after the first request | Throws: `Can not add a route since the matcher is already built.` |
| Keep Bun listener open, build a fresh Hono app, then swap a dispatch reference | PASS: existing and new routes use the new app |

Rerun the experiment:

```bash
bun .spur/run/board-modules-a2a8208c-4586-4278-bdc5-6da2ea9d7a3f-runtime-probe.ts
```

The probe is run-local and gitignored. It proves API feasibility, not safe replacement of the full production runtime. Hono's installed `SmartRouter.add/match` source confirms matcher finalization. [Bun documents fetch/route reload](https://bun.com/docs/runtime/http/server#hot-route-reloading); [Hono documents registration ordering](https://hono.dev/docs/api/routing#routing-priority).

**For the original native-server alternative:** resolve manifests, validate the full set, import/mount enabled server contributions, and publish the browser catalog before opening the listener. A restart is sufficient. For either UI-only recommendation, load declarative config at startup and use fixed catalog/asset handlers; no dynamic Hono route registration per module is necessary. Native browser imports happen after the server starts, before the browser registry/router is constructed. No watcher, reload endpoint, or browser synchronization channel is required.

**If live replacement becomes necessary:** prepare a new immutable module generation and fresh Hono composition; validate it completely, then atomically swap dispatch. Retain old generations until requests/streams finish, dispose resources, and reload or synchronize browser registry/router state. Also address server import caches, dependency invalidation, and versioned frontend assets. Replacing Bun handlers alone does not do this work.

## 4. Alternatives and tradeoffs

| Approach | Fit | Main cost | Confidence |
|---|---|---|---|
| Startup selection of prebuilt native ESM modules | Best fit for an installed Board and existing WebModule experience | Public authoring types plus shared browser runtime/export seam | Medium end to end; high for backend startup |
| Generate a project-specific Board build using Astro/Vite | Good fallback if a shared-runtime proof cannot pass | Ship a portable build kit; downstream rebuilds the whole Board | High build mechanism; medium packaging |
| Mount a standalone web app inside an iframe | Useful for an already-built independent application | Different context, navigation, right-panel, and accessibility integration | High embedding mechanism; weaker native fit |

A startup source import list is technically feasible, but extending the current glob cannot make an already-published browser bundle import arbitrary TSX. Vite requires literal glob arguments and transforms imports during build. [Vite glob caveats](https://vite.dev/guide/features#glob-import-caveats).

Do not add Module Federation or a plugin marketplace for this feature. Native ESM and a small explicit host contract are sufficient if the proof passes.

## 5. Proposed configuration and authoring contract

Project configuration selects modules; module-owned manifests contain their definitions:

```yaml
bootstrap:
  modules:
    - manifest: ./board-modules/catalog/module.json
      enabled: true
```

Proposed module manifest:

```json
{
  "schemaVersion": 1,
  "id": "catalog",
  "name": "Catalog",
  "icon": "📦",
  "route": "catalog",
  "order": 100,
  "web": {
    "assets": "./dist/web",
    "entry": "./index.js",
    "styles": ["./index.css"]
  },
  "server": {
    "entry": "./dist/server/index.js"
  }
}
```

Semantics:

- `manifest` resolves relative to the project root selected by the existing serve invocation, independent of the shell cwd. Pin its canonical module root. Manifest server paths are relative to that root; web entry/styles paths are relative to the declared web asset root.
- `enabled` defaults to true. Disabled entries retain structural config validation and do not import/execute extension code or require built assets.
- `schemaVersion` versions the manifest and the accompanying authoring ABI. Reject unsupported versions with the config index, manifest path, and supported version.
- Metadata reuses WebModule's meaning. `id` and `route` are nonempty safe path segments; v1 requires `route === id`. Names/icons are nonempty strings; order is finite. Description/sidebarLabel may retain the existing optional meanings.
- The browser entry is built ESM. It exports the existing component contribution shape: `component` and optional `rightPanelComponent`, under one documented named export `webModule`. The host combines this with manifest metadata into WebModule. Metadata has one owner.
- The optional server entry exports `serverModule` with the existing `name`/`mount` pattern. Require its name to match the manifest id. Mount onto a child Hono app rooted at `/api/modules/<id>`; expose a small stable context containing projectRoot and logger rather than the private ServerContext/service graph.
- If a module uses oRPC, it owns its own contract/client and namespaced OpenAPI handler. Its procedures are not automatically members of Spur's compile-time global contract. No assumption that adding ServerModule also adds procedures to the global router.
- Publish the small authoring types through deliberate exports from the installed Spur package. Downstream imports must not depend on private apps/web/apps/server paths. Exact export layout belongs in the subsequent system design.
- The v1 server contribution installs routes; persistent background resources and live lifecycle hooks are outside this proposal.

This example is a proposed contract. It cannot be pasted into today's config and expected to load a module.

## 6. Browser loading and runtime compatibility

Browser delivery is the main remaining proof obligation:

1. Load a validated public catalog from the local server. Include display metadata, versioned same-origin browser URLs, styles, and module API base URLs; omit filesystem paths and server-only data.
2. Load external entries and styles, combine their components with metadata, validate alongside built-ins, and construct the registry before route/sidebar creation. Refactor snapshot wiring only at this composition seam.
3. Preserve existing module ordering and the current landing module by default; external order may affect navigation order but should not silently change the landing target. Reject duplicate ids/routes and collisions with retired redirect routes.
4. Keep native modules on the host's React instance. External bundles must externalize supported React/JSX runtime imports, and router imports if exposed. The host must export facades backed by the same instances its own components use. An import map can resolve those external imports, but mapping alone does not fix an already duplicated host runtime. [React duplicate-instance guidance](https://react.dev/warnings/invalid-hook-call-warning#duplicate-react); [browser import maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap).
5. Keep styles explicit, scoped to module roots, and compatible with Board tokens; build Tailwind-dependent module CSS downstream. Serve JS with the correct MIME type and include all referenced chunks/assets.
6. A configured module that cannot load shows an actionable module error while built-ins remain usable. A render error is contained at the module boundary.

The shared-runtime proof must use a hook-bearing external component, navigation, CSS, and an optional right panel in the actual installed Board. It must also test a downstream dependency graph containing a second local React installation. The browser must still resolve the supported shared runtime. **No such installed-package browser proof has been run in this investigation.**

## 7. Validation, trust, and compatibility rules

- An absent or empty module list preserves the current built-in Board/API behavior.
- Validate config and manifest structure before executing extension code. Reject enabled missing entries, unsupported schemas, identity mismatches, collisions, or mounting errors before listening.
- Serve only files within the declared, canonical web asset roots. Reject traversal and symlink escape; do not expose source trees, server bundles, or project config as assets.
- Global host/security middleware still wraps module APIs/assets. Preserve the existing host guard, CSRF/CORS rules, and API-versus-SPA fallback behavior. Module namespaces prevent accidental route collisions; they do not sandbox trusted code.
- Import extension server code only for the local Board server. Normal CLI task/feature/history commands may validate declarations but must not execute Board extensions.
- Fail clearly when enabled filesystem-backed server modules are requested on an unsupported runtime. Do not implicitly extend the Cloudflare Worker deployment model.
- Cache asset generations with content-aware URLs. Config/code changes require restart and browser reload in v1; no promise that ordinary ESM import reevaluates changed files.
- Test two downstream project roots with distinct configurations and switching between their server origins. A project-specific `dist/web` override must be validated for the catalog/runtime protocol instead of silently selecting an incompatible old Board.

## 8. Proposed sequence and observable checks

These are proposed work units, not created tasks.

1. **Standalone runtime/package proof.** Produce a module fixture outside Spur and exercise the installed-package Board: shared hook-bearing React component, CSS/chunks, deep link, optional panel, and optional namespaced API. Also establish the supported minimum Bun version using the existing engine policy. If the runtime proof fails, revise the proposal to project-specific Board builds before production loader implementation.
2. **Contract and config.** Finalize/export the versioned manifest/contribution types and validate `bootstrap.modules` in the existing config loader. Check absent/empty/disabled inputs, invalid paths/versions, identity collisions, and preservation of bootstrap options.
3. **Startup server composition.** Resolve/import selected modules, compose namespaced routes before wildcard handlers, expose the public catalog, and serve only declared assets. Check errors before listen, host/middleware enforcement, CLI import isolation, and restart behavior.
4. **Board composition and installed-project validation.** Add asynchronous catalog loading before registry/router creation, reuse native shell components, and verify ordering, deep links, error containment, no duplicate React, project switching, and fallback assets.
5. **Authoring guide and portable templates.** Update the existing module guide and applicable config/init templates. During accepted design/implementation, route lasting boundary choices to ADR, mechanisms to architecture, and contracts to a design satellite plus its index. Run focused tests and applicable harness gates through the subsequent task pipeline.

All production work depends on item 1. The pipeline's later AC and decomposition must cover I1–I5 from the evaluation inventory, including the runtime investigation and explicit restart contract.

## Design Summary

Spur owns a validated project-local `bootstrap.modules` list discriminated by react or iframe. Shared metadata supplies identity/navigation; native entries provide prebuilt browser ESM components and optional right panels, while iframe entries provide existing app URLs. Both are adapted into one existing WebModule registry. Native entries share the Board's React/JSX runtime and restricted asset transport; frames retain separate documents and embedding policies. Browser composition precedes registry/router construction. No server entry, external manifest, process manager, Module Federation, automatic messaging bridge or live configuration replacement is required. The installed-Board runtime proof precedes production loader work. Exact proposed fields, compatibility, errors and ownership live in the [design satellite](../design/downstream-board-modules.md).

## 9. Evaluation status and evidence limits

Spec self-review: PASS for requirement coverage, explicit proposed/current labeling, consistent path semantics, alternatives, bounded scope, and documented proof dependencies. This does not certify production code or end-to-end delivery.

Urgency 3/5; necessity 4/5. Recommendation: reshape and proceed after operator evaluation.

The assertion-based Bun/Hono proof and schema parse observation passed. Both frontend approaches are supported by their platform mechanisms and existing code inspection, but neither has an installed-Board end-to-end proof. The native shared-runtime proof is required for the current recommendation. No repository-wide tests, feature verify PASS, or release certification is claimed.

The run-scoped [evaluation report](../../.spur/run/board-modules-a2a8208c-4586-4278-bdc5-6da2ea9d7a3f-idea-eval-report.md) carries the complete requirement inventory and operator direction selection. The run-scoped artifacts are gitignored; this plan preserves the durable proposal and observed results.

## 10. Operator feedback: definitions, hosting, Vite, and iframe integration

### 10.1 Embedded definition versus external manifest

Prefer embedded definitions for the recommended iframe scope. The definition is project-specific navigation and an app location, with no JavaScript export graph or host ABI to describe. The existing YAML loader already reads the file, so another file adds path resolution, compatibility, overrides, and error cases without an immediate benefit.

External manifests become useful when a reusable module package has many fields, owns/version-controls its definition separately, or is consumed by multiple projects. In that case the package owns defaults and project config owns selection/overrides. Do not keep duplicate definitions in both places. Neither external files nor simultaneous support for both forms is needed for v1.

Proposed URL-backed example:

```yaml
bootstrap:
  modules:
    - id: catalog
      name: Catalog
      icon: "📦"
      type: iframe
      source:
        url: http://127.0.0.1:5173/
```

An alternative source for a locally built app:

```yaml
source:
  directory: ./apps/catalog/dist
```

Require exactly one of url or directory. For directory sources, resolve from the selected project root and generate a same-origin URL such as `/modules/catalog/`; require an index.html app entry. Derive `/board/catalog` from id rather than repeating route. Keep enabled (default true), finite order, and description optional. Preserve the current built-in landing target. Reject malformed definitions, unsupported protocols, URL credentials, duplicate ids, and collisions with existing/retired routes. Config URLs describe trusted project apps, not arbitrary user-provided HTML or executable config.

### 10.2 Why the earlier manifest contained server

The earlier optional server field meant **import and mount routes into the existing local Bun/Hono process**, not launch another server. It would be useful only for code that needs to extend Spur's own API/runtime. A frontend does not automatically need such a contribution.

| Iframe source | Who serves the UI? | Where does app-specific backend logic run? |
|---|---|---|
| Existing URL | The downstream project's own dev/production server | Its existing backend |
| Local built directory | The current Spur Bun server serves static files | Existing Spur APIs where sufficient, otherwise a separately managed project backend |
| Native server contribution, deferred | Spur may also host the frontend | Imported module routes in the Spur process |

Serving HTML/JS files is different from executing the application's backend. Directory hosting alone cannot run SSR endpoints, Node/Bun APIs, or a backend hidden in a frontend framework. Do not imply it can.

Recommended v1 has no server-entry field and does not start/reverse-proxy downstream processes. URL apps must already be running. Add process integration only if operating separate apps becomes a concrete burden.

### 10.3 Vite is compatible and does not need replacement

Keep Astro/Vite for building the Board and allow downstream projects to keep their own Vite dev/build workflow. The iframe loads an app document at runtime; its scripts/CSS load normally in that document. Independent apps can use different React versions or other frameworks.

Vite's support for lazy/dynamic imports covers modules it can analyze in its build graph. It does not register arbitrary project paths in a previously built Board merely because a YAML file changes. Its glob arguments must be literals. Native runtime ESM remains possible, but the host must implement the loader, asset handling, and shared-runtime contract.

For directory hosting, build assets for the actual `/modules/<id>/` prefix and configure the child router's basename consistently (or use hash routing). Vite rewrites generated asset references through its base option. Relative assets alone are not sufficient for arbitrary nested SPA URLs. A directory handler needs module-local HTML fallback for valid client routes and real 404s for missing JS/CSS/assets.

Sources: [Vite glob caveats](https://vite.dev/guide/features#glob-import-caveats), [Vite public base paths](https://vite.dev/guide/build#public-base-path).

### 10.4 Full-content iframe is the recommended simpler integration

An iframe is a separate document, so it separates component runtimes, CSS, and application routing. It can fill the entire region beside the Board's sidebar with width/height 100%, display block, and no border. This directly fits the clarified option being evaluated. [HTML iframe standard](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-iframe-element).

The existing Board always renders a right panel, its resize handle, and GlobalAgentBar; MainWorkspace also has a scrolling child. Therefore dropping a 100%-sized iframe into today's component is insufficient for the requested occupied space. The frame presentation must omit the right panel and its handle, omit the agent-bar overlay, allocate the remaining grid width, and let the child own scrolling. Preserve normal layout preferences when returning to built-ins. Keep mobile navigation reachable and provide an accessible frame title and focus traversal.

Benefits:
- One built-in frame adapter and data descriptors instead of loading external React components.
- No shared React/import-map SDK, CSS-global conflicts, or Board rebuild for a newly configured app.
- URL sources work with existing dev servers and their HMR, including applications using other stacks.
- Directory sources can use the same Bun server without an app server entry.

Limits that affect fit:
- Child apps do not inherit Board React contexts, native right-panel rendering, theme CSS, or parent keyboard shortcuts.
- A child's route is not automatically reflected in the outer Board URL. Child state ordinarily resets when its frame is unmounted by module switching; preserve frames only if retaining that state becomes required.
- Cross-origin apps cannot read the parent DOM. When interaction is needed, a small versioned postMessage protocol can carry narrowly defined events; check both event.origin and event.source and use an exact targetOrigin. This bridge is not needed merely to display the app. [Web messaging standard](https://html.spec.whatwg.org/multipage/web-messaging.html#crossDocumentMessages).
- The app must permit framing through its X-Frame-Options/CSP frame-ancestors policy, and the Board's own policy must permit that frame source. A different localhost port is a different origin. CORS is relevant to cross-origin API fetches, not a requirement simply to display the frame. [CSP framing contract](https://w3c.github.io/webappsec-csp/#directive-frame-ancestors).
- Framed authentication, cookies, and popup flows need testing when an app depends on them. An inaccessible or unavailable app does not become reachable because it is framed.
- Same-origin framing separates UI runtimes but does not sandbox trusted scripts from host data. Do not weaken existing host guards/CSRF or describe a permissive same-origin sandbox as isolation.
- A frame load event does not prove successful application loading; browser behavior intentionally fires it even for failure. An optional readiness handshake would provide stronger status when required. [Iframe event behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#error_and_load_event_behavior).

The installed Hono 4.12.23 secureHeaders default was inspected and checked in a minimal request: X-Frame-Options is SAMEORIGIN and no CSP is set by default. This permits same-origin directory apps under the same response policy. A URL app on another port must allow the Board origin in its own response headers; changing the Board's response header cannot override the child's policy. The actual downstream app has not yet been tested.

### 10.5 Revised proposed sequence

1. Validate embedded iframe descriptors in the existing project-config loader and expose only safe display/source descriptors.
2. Adapt the existing registry/router to receive descriptors before construction; use one iframe component and the full-content shell presentation.
3. Prove URL-backed integration with an owned downstream app, including framing headers, its own routing/HMR, mobile/focus/scrolling, switching, and app unavailability. If directory hosting is needed for initial downstream projects, prove assets, SPA routing, containment, and same-origin API behavior as a separate part of this work.
4. Update the module-authoring guide and applicable init/config templates; use the normal feature/task pipeline gates after direction selection.

Recommendation confidence: high for the simpler architectural fit; medium for end-to-end behavior until the real downstream app proof passes. The current run stays at idea evaluation. This feedback is exploration and does not imply operator selection of either iframe or native integration.

## 11. Latest feedback: a native React/TSX contract

The operator accepts the other simplifications and asks whether a React/TSX contract is possible and preferable to framing. Yes: it fits the existing WebModule component boundary and is the better direction when downstream contributions should behave like native Board modules. An iframe remains simpler for displaying a complete, independently operated application with its own runtime; native modules provide more direct shell integration. This recommendation is an engineering assessment, not a completed runtime proof or implementation approval.

### 11.1 Minimal authoring and configuration contract

Keep metadata in `.spur/config.yaml`. The built entry exports only the versioned UI contribution, avoiding duplicated id/name/route definitions:

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
```

```tsx
import type { ComponentType } from 'react';
import Catalog from './Catalog';

interface BoardModuleContribution {
    apiVersion: 1;
    component: ComponentType;
    rightPanelComponent?: ComponentType;
}

export const webModule = {
    apiVersion: 1,
    component: Catalog,
} satisfies BoardModuleContribution;
```

The interface above illustrates the proposed public authoring type; downstream authors would import its published definition rather than redeclare it. No Board SDK/type export exists today. Reuse the existing WebModule contribution fields and adapter rather than inventing a second UI framework. The browser entry is compiled ESM, not raw TSX. It must export a component, not call createRoot or mount an independent application.

Resolve web.directory from the selected project root; resolve entry/styles inside that canonical directory and reject traversal or symlink escapes. Derive `/board/catalog` from id, preserve enabled/order/description conventions, reject built-in/retired route collisions, and serve only that declared asset tree. Validate apiVersion before registering the contribution. These examples are proposed, not supported by today's schema.

### 11.2 Runtime and host boundaries

Vite library mode can produce ESM and externalize dependencies. A downstream module must externalize React and its JSX runtime; any supported React DOM or React Router imports must also resolve to the host's actual instances. Matching peer-dependency versions is insufficient. The installed Board build must deliberately publish browser runtime facades backed by the same modules used by its renderer; an import map can route external bare imports to those facades. An import map alone cannot deduplicate React already embedded in a bundle. Check the Board's pinned build-tool versions before prescribing exact build options. [Vite library mode](https://vite.dev/guide/build#library-mode), [React instance requirement](https://react.dev/warnings/invalid-hook-call-warning#duplicate-react), [import maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap).

Use the current route/component integration and optional right-panel contribution. Public integration with project/API/navigation context should be added only for a concrete first module, through a narrow supported boundary; private Board hooks, contexts, service internals, and filesystem paths are not automatically public. Shared React alone does not make separately defined context objects identical. Full-content rendering beside the sidebar remains possible without an iframe; shell allocation must preserve mobile navigation and existing built-in layout preferences.

Require scoped CSS or CSS Modules and explicit built styles; avoid global resets and downstream-generated Tailwind CSS affecting the Board shell. Component errors need a module error boundary and failed entry imports need a useful error route, leaving built-ins usable. Native modules are trusted code executing in the Board document; they have no security sandbox or style isolation merely because the contract is typed. A supported ABI/runtime policy becomes a release obligation.

UI assets/catalog use the existing Bun server and fixed handlers. There is no need to import module code into Bun, run another server, or extend the global API contract merely to render a component. An application-specific backend remains separately owned unless an actual requirement later justifies server extensions. Load config before listen; import browser components before registry/router construction. Selection changes require restart and browser reload in v1. Build-watch/HMR support is a separate capability, not implied by runtime dynamic import.

### 11.3 Proof before production loader work

First exercise the installed CLI's real Board with a module built outside the Spur checkout. Verify a useState-bearing component, shared runtime identity despite another local React installation, scoped CSS and a referenced chunk/asset, existing navigation/deep links, optional right-panel rendering, incompatible apiVersion, failed loading/render containment, and project switching. This proves the distribution seam, not just that a standalone Vite library compiles. No such browser proof has been run.

If the installed Board cannot share its runtime reliably, evaluate a portable project-specific Board build using one Astro/Vite dependency graph. That approach avoids the runtime-sharing seam but requires distributing a build kit and rebuilding the Board for module changes. Do not add Module Federation or support both iframe/native loaders preemptively. Select one rendering model after the proof and the operator's evaluation.

## 12. Selected native direction and requested iframe compatibility

The operator agrees to embedded configuration, native React contributions, Vite, and no required server entry. This clears the idea-evaluation decision for that direction. The operator also asks whether both React and iframe resources can be supported going forward; the proposed design includes a narrow iframe URL adapter alongside the native path, without a generic plugin engine or a second navigation system. Section 11's advice against preemptive dual support is superseded by this explicit requested use case.

Both types share id/name/icon/order/description and derive the Board route from id. Native configuration contains web.directory/entry/styles; iframe configuration contains source.url. Reject mixed type-specific fields. Native modules load compiled component contributions; iframe modules instantiate one host-owned React adapter. Both appear in the same Board workspace with one active route at a time. Simultaneous panels or automatic data sharing are separate requirements.

An iframe URL must permit embedding through its own framing headers; ordinary browser restrictions cannot be bypassed by this contract. Provide an external-open action, and do not equate frame load with application readiness. No message bridge is required merely to display existing resources. Native modules still need the actual installed-Board shared-runtime proof; adding an iframe adapter does not substitute for it.

At this revision, feature A8 and its fifteen scenarios covered the original five requirements plus the new dual-mode requirement. Feature-check and inventory coverage passed with the then-expected no-linked-tasks warning. The detailed design review was the next boundary. The subsequent acceptance and decomposition are recorded in section 13; the [detailed design](../design/downstream-board-modules.md) and ADR-128 now record the accepted, unimplemented boundary.

## 13. Accepted design and implementation-ready handoff

The operator accepted the detailed direction and requested detailed tasks for A8. The atomic CLI batch created 0988–0992. All remain todo; no production implementation or implementation verification is claimed by this planning record.

| Task | Deliverable | Prerequisites | Estimate |
| --- | --- | --- | --- |
| [0988](../tasks5/0988_prove-and-package-the-board-shared-runtime-and-downstream-au.md) | Prove and package the Board shared runtime and downstream authoring contract | None | 8h |
| [0989](../tasks5/0989_load-and-serve-validated-project-module-catalogs-and-restric.md) | Load and serve validated project module catalogs and restricted assets | 0988 | 8h |
| [0990](../tasks5/0990_render-native-downstream-modules-through-one-board-registry.md) | Render native downstream modules through one Board registry | 0989 | 8h |
| [0991](../tasks5/0991_embed-url-resources-in-the-board-workspace.md) | Embed URL resources in the Board workspace | 0990 | 5h |
| [0992](../tasks5/0992_validate-downstream-installs-and-publish-module-authoring-gu.md) | Validate downstream installs and publish module authoring guidance | 0990, 0991 | 8h |

The tasks contain 28 numbered requirements and 21 task-local Given/When/Then scenarios covering all 15 A8 feature scenarios. Each has detailed Background, Requirements, Design, Plan, closed Q&A, References and readiness Notes. Design records freeze names, file ownership, precedence/algorithms, failure/security behavior, exclusions and WBS-specific dependency inputs/outputs. Execution-owned Solution/Testing/Review sections remain for the task pipelines.

Ready-depth audit: all 35 checklist rows pass (requirements, design, plan, AC, decisions, dependencies, premises), with digests bound using the existing computePlanningDigest service and source citation linting. The deterministic handoff finalizer reports all five specifications READY. Normal task checks pass with only expected prerequisite-not-done warnings on dependent tasks; --as todo treats these waiting-state findings as eligibility errors. This is ordered planning readiness, not simultaneous start eligibility: 0988 starts first, and later tasks wait for their exact dependency outputs and completed predecessors. Dependencies were retained; no findings were suppressed and no implementation verdict was fabricated.

Current-source corrections: Astro 6.4.2 resolves Vite 7.3.3 from its own installed package graph, matching the lockfile; an ancestor Vite installation is not the Board build. The project YAML seed is currently owned by apps/cli/src/commands/init.ts:307, not a presumed application init service. Generated web assets require a fresh build before package proof. Final concurrency recheck found main f32848ba, no additional worktrees and no wip tasks; initial 0984 ownership information remains historical. Implementers must repeat the clean-tree/toolchain/generated-output preconditions at execution start.

Runtime-proof sequencing is deliberate. Task 0988 uses a build-known adapter confined to a temporary test build to prove independently built ESM with the installed Board renderer and public declarations. It does not depend on the later generic config/catalog loader. If shared-runtime packaging fails, dependent implementation stops for design reconciliation; Module Federation or an iframe substitution is not an implicit fallback. Task 0992 proves the full production config/catalog path from an installed package with no test adapter.

Next command: `/sp:dev-runall --feature A8 --auto`. This planning job stops here; future execution must respect the dependency order. The run-scoped finalizer report and ready evidence are under .spur/run/board-modules-a2a8208c-4586-4278-bdc5-6da2ea9d7a3f-idea-handoff.md and -idea-ready.json; durable delegation specifications are the linked task files.
