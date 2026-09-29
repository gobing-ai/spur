---
schema_version: 1
name: Embed URL resources in the Board workspace
status: done
template: feature-impl
created_at: 2026-09-28T01:46:26.509Z
updated_at: "2026-09-29T03:07:00.637Z"
feature_id: A8
priority: P2
tags:
  - A8
  - board
  - downstream
estimate_hours: 5

ac_numbering: task-local
dependencies: ["0990"]
---

## 0991. Embed URL resources in the Board workspace

### Background

The selected feature includes both native tools and existing embeddable applications in one Board sidebar. This slice adapts validated iframe descriptors to the resolved registry; it does not load an external React library or run a second app process. BoardLayout currently always reserves panel/overlay surfaces, so iframe workspace occupancy requires an intentional host layout branch.
Verified seams: apps/web/src/components/BoardLayout.tsx:91,154,164 and docs/design/downstream-board-modules.md:124 describe current layout and browser restrictions. The preceding native slice supplies one registry/provider and failure-safe shell; the catalog slice already owns URL validation.
Rubric: E5 D1 L1 C1 R1 = 9; frame component, shell occupancy and accessibility form one UI deliverable.

### Requirements

- [x] R1. Adapt each enabled iframe descriptor into the same resolved WebModule registry used by built-ins/native contributions, preserving configured metadata and derived /board/<id> routes; keep one selected workspace and no hidden frame persistence.
- [x] R2. Fill the available workspace beside the sidebar without an empty right panel, right-panel resize handle or global agent overlay. Use one flex/min-height/min-width layout, let the child document own content scrolling, and preserve built-in saved layout preferences when switching rendering types.
- [x] R3. Render an accessible iframe title and an always-available Open externally anchor using target=_blank and rel=noopener noreferrer; retain mobile menu access, visible keyboard focus and normal traversal without trapping focus or injecting child shortcuts.
- [x] R4. Respect child CSP frame-ancestors/X-Frame-Options, host frame-src and cross-origin restrictions; never claim a load event proves readiness, weaken policies, proxy/strip headers or force login/cookie behavior. The configured URL application remains independently operated.
- [x] R5. Contain host adapter errors and keep navigation available. Document that switching away unmounts/reset may occur and that Board context/theme/data/route sync is absent; add no messaging SDK, app launcher, automatic permissions, child DOM access or custom sandbox promise.

### Acceptance Criteria

```gherkin
Scenario: AC1 — React tools and iframe resources share project navigation (req: R1; R5)
  Given the project catalog contains native React tools and validated URL resources
  When the Board composes its registry and the user selects each contribution
  Then both appear in the same navigation, one selected workspace renders at a time, and iframe entries never use the native ESM loader

Scenario: AC2 — External module layouts preserve accessible Board navigation (req: R2; R3; R5)
  Given a framed resource is selected on desktop or mobile
  When the user traverses the menu/frame/external link and returns to a built-in
  Then the frame fills the remaining workspace with child scrolling, unused panel/overlay surfaces are absent and saved host preferences remain intact

Scenario: AC3 — Framed resources retain browser embedding restrictions (req: R3; R4; R5)
  Given owned apps respectively allow and deny framing across origins
  When the real Board iframe adapter loads each resource
  Then browser policies remain enforced, no child-readiness claim is inferred from load, and a safe external-open action remains available
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-28T01:47:54.865Z

Closed decisions (2026-09-27): A8 follows ADR-128 and the accepted downstream-board-modules contract. Embedded YAML is the only selection/metadata authority; compiled native React is primary and iframe URLs use one Board-owned adapter. No required server entry or downstream backend procedure is introduced. v1 uses startup snapshots, restart and reload. The real installed shared-runtime proof precedes production composition; failure routes back to design rather than a renderer substitution.

Deferred with owner: the A8 feature owner handles any future messaging/data/theme bridge, live replacement, directory-hosted frames, split views or Worker filesystem support only after a concrete requirement. Exact Astro build wiring is the bounded runtime task's investigation, with frozen output and proof criteria; later tasks consume its delivered manifest rather than choosing another ABI. There are no unresolved product decisions in this task.

Prerequisite 0990: resolved registry/provider, native layout behavior and shared error containment; 0989's validated frame URLs and 0988's owned browser fixtures arrive transitively. Handoff to 0992: production iframe adapter, workspace occupancy and browser-policy evidence.

### Design

Accepted contract: docs/design/downstream-board-modules.md and ADR-128. A8 uses embedded bootstrap.modules declarations, Vite-built native ESM and a Board-owned URL frame adapter. Native modules have no required server entry. Configuration/build changes use restart plus browser reload. This task implements only its named slice; downstream server imports, external manifests, raw TSX compilation, Module Federation, process launching/proxying, live replacement and private Board SDK exports remain outside scope.

WHAT/WHY: A single Board-owned IframeModule component receives the validated source URL/name and occupies the host's content area. This is the smallest integration for an already-running embeddable resource, retaining its own runtime and browser protections.

WHERE/OWNERSHIP: Proposed apps/web/src/components/IframeModule.tsx and tests, modules/compose.ts, the host-internal contributionType metadata and components/BoardLayout.tsx. Touch LeftSidebar only if required for mobile/focus preservation. The catalog/config schemas, runtime facades and native error boundary are consumed, not redefined. Read root DESIGN.md's downstream module rules.

FROZEN BEHAVIOR: iframe descriptors have source:{url} and contributionType:'iframe'; adaptation assigns component=Board-owned wrapper and no rightPanelComponent. Bare and wildcard host routes select the same wrapper, leaving the child's own navigation untouched. Use iframe src=validated URL and title=module name; keep its external link in a compact host toolbar outside the iframe so it remains usable when the child refuses framing. The link always uses the configured resource URL. Use CSS flex:1, min-height:0, min-width:0, width/height:100% as needed within existing shell conventions, without viewport calculations or resize observers.

POLICY/STATE: A display-only frame needs no postMessage listener, sandbox policy generator or permission SDK. Preserve established headers; request permission attributes only for a demonstrated child capability, outside this task's baseline. Treat the child as a normal browser document, not a security sandbox. Do not inspect cross-origin document readiness or offer a fake success indicator. Optional neutral loading text cannot transition into a readiness claim from onLoad. Denial may be browser-rendered; an external action and honest explanatory copy suffice.

LAYOUT/ACCESSIBILITY: Branch shell panel/handle/agent overlay rendering on contributionType, without writing permanent collapsed preferences when selecting a frame. Native behavior from the previous slice and built-in behavior remain intact. Child scroll remains inside the iframe; host toolbar/sidebar fit mobile without clipping. Preserve mobile navigation toggles, visible focus and tab traversal to/from the frame and external link. Leaving route unmounts the frame; no kept-alive hidden documents, split views or theme propagation.

DEPENDENCIES/HANDOFF: Depends on the native registry slice because it owns shared UI callers; it transitively consumes validated URLs and runtime proof fixtures. The final slice exercises native/frame coexistence and project switching. This task finishes the real frame adapter; the earlier runtime proof's test adapter remains test-only.

DELEGATION CONTRACT: Prerequisite 0990: resolved registry/provider, native layout behavior and shared error containment; 0989's validated frame URLs and 0988's owned browser fixtures arrive transitively. Handoff to 0992: production iframe adapter, workspace occupancy and browser-policy evidence.

### Plan

- [x] Step 0 — Start from a clean task-specific branch/worktree containing this planning batch and completed dependency outputs. Re-read AGENTS.md, the contribution contract and root DESIGN.md for UI changes. Preserve unrelated work: task 0984 currently owns run-evidence helpers in another worktree; do not touch its files. Verify installed dependency resolution and lockfile, then build fresh generated assets when testing distribution; existing dist/web is not proof of freshness.
- [x] Step 1 (R1,R4,R5) — Add the Board-owned wrapper and adapt already-validated iframe descriptors in composeBoardModules. Assert no external ESM/style import is attempted for iframe entries and both contribution types occupy one navigation registry.
- [x] Step 2 (R2) — Make BoardLayout suppress frame-only panel/resize/overlay surfaces and fill remaining workspace with CSS. Test native-with-panel, native-without-panel, iframe, then built-in transitions without saved-preference writes.
- [x] Step 3 (R3,R5) — Add title, visible external action and honest embedding/state guidance. Verify keyboard/mobile navigation and narrow/wide layouts; no parent key trap, hidden frame persistence or child DOM access.
- [x] Step 4 (R4) — Run the owned allowed/denied fixtures from the runtime proof in a real browser on different origins. Observe allowed app navigation, denial, external-open link target/rel and independent child scrolling; do not mock CSP/X-Frame-Options.
- [x] Step 5 (R1–R5) — Add proposed apps/web/tests/components/IframeModule.test.tsx and extend shell/layout/registry tests, with real-browser observations for framing/mobile behavior. Run a fresh web build and task gate. Run focused tests inside their workspace (its bunfig supplies preloads), then the task pipeline's required bun run spur-check once. Record real commands, versions, fixture locations, expected/actual observations and verdicts in execution-owned sections during implementation. Leave feature-wide checks to the final slice. No CLI noun/verb is added.

### Solution

A Board-owned frame adapter turns a validated URL resource into an ordinary Board module, and the shell
gives it the whole workspace.

**R1 — adapt every enabled iframe descriptor into the resolved registry**

- `apps/web/src/modules/compose.ts:268` — the iframe branch of `composeBoardModules` now returns a real entry instead of the placeholder diagnostic it carried for the previous slice: `entryMetadata(descriptor)` is spread unchanged (so `id`, `name`, `icon`, derived `route`, `sidebarLabel`, `description`, `order` survive) and `contributionType: 'iframe'` is set.
- `apps/web/src/modules/compose.ts:276` — the entry's component is the Board-owned `FramedResource`, constructed with the descriptor's own `url` and `name`. The configured URL is never rewritten.
- `apps/web/src/modules/compose.ts:225` — `composeBoardModules` remains the single composition seam; both contribution types resolve to `WebModule` values, so they share navigation and exactly one selected workspace, and the `routeOf` derivation at `apps/web/src/modules/compose.ts:111` yields the `/board/<id>` route the shell already resolves.

**R2 — fill the workspace beside the sidebar; no empty panel, handle or overlay**

- `apps/web/src/components/BoardLayout.tsx:103` — `isFramedWorkspace` is derived from the ACTIVE MODULE, not from persisted layout state.
- `apps/web/src/components/BoardLayout.tsx:157` — `data-framed-workspace` is published on the layout root.
- `apps/web/src/styles/board-layout.css:57` sets `--rightpanel-w: 0px` and `apps/web/src/styles/board-layout.css:58` sets `--rightpanel-handle-w: 0px` under the framed rule at `apps/web/src/styles/board-layout.css:56`, removing the panel column instead of leaving a gap.
- `apps/web/src/components/BoardLayout.tsx:172` (`ResizeHandle targetVar="--rightpanel-w"`) and `apps/web/src/components/BoardLayout.tsx:173` (`RightPanel`) sit inside the `{!isFramedWorkspace `apps/web/src/components/BoardLayout.tsx:170` — the right-panel `ResizeHandle` and the `RightPanel` are not rendered at all when framed`apps/web/src/components/BoardLayout.tsx:170` — the right-panel `ResizeHandle` and the `RightPanel` are not rendered at all when framed (` guard at `apps/web/src/components/BoardLayout.tsx:170`, so neither is rendered when framed, so there is no dead handle or empty surface.
- `apps/web/src/components/BoardLayout.tsx:124` — the mobile "Open panel" control is likewise absent, since a framed workspace has no panel to open.
- `apps/web/src/components/BoardLayout.tsx:192` — `GlobalAgentBar` is not rendered for a framed workspace.
- `apps/web/src/components/MainWorkspace.tsx:14` — `MainWorkspace` takes a `framed` flag; at `apps/web/src/components/MainWorkspace.tsx:18` the scroll container becomes `flex flex-1 min-h-0 flex-col overflow-hidden` instead of `overflow-auto`, so the framed document — not the Board — owns content scrolling and no host scrollbar is introduced beside the frame.
- Suppression is RENDER-ONLY: no `setState` and no `saveLayoutState` runs for a framed module, so a user's saved sidebar/right-panel preferences are untouched and reappear on the next built-in module.

**R3 — accessible title and an always-available external open**

- `apps/web/src/components/FramedResource.tsx:24` — `FramedResourceProps` carries the module id, the configured URL and the accessible name.
- `apps/web/src/components/FramedResource.tsx:52` — `FramedResource` renders the frame with `title={title}` (the configured module name) at `:74`, and the escape hatch link at `:68`–`:69` with `target="_blank"` and `rel="noopener noreferrer"`, labelled "Open externally" at `:71`.
- The link is rendered unconditionally, so it remains available even when the browser refuses to display the frame — which is the case where it matters most.
- Mobile navigation is unchanged: the sidebar drawer and its toggle are untouched by this slice.

**R4 — browser embedding restrictions remain enforced**

- `apps/web/src/components/FramedResource.tsx:74` — the frame is a plain `<iframe src={url} title={title}>`. It sets **no `sandbox`**, no `allow`, no `csp`, and no `allowfullscreen`, so the child's `frame-ancestors` / `X-Frame-Options`, the host's own `frame-src` and ordinary cross-origin rules all apply exactly as the browser decides; nothing proxies, strips or rewrites a header, and nothing forces login or cookie behaviour.
- There is deliberately **no `onLoad` handler**: a frame load event means the browser committed a document, which is not evidence that the framed application is usable. No readiness state exists, so none can be misreported.
- `apps/web/src/components/FramedResource.tsx:34` (shell `SHELL_STYLE`) and `apps/web/src/components/FramedResource.tsx:43` (frame `FRAME_STYLE`) style by flex/min-width/min-height only, so the framing decision stays with the browser.

**R5 — contain adapter errors, keep navigation, document the boundary**

- `apps/web/src/components/FramedResource.tsx:52` — the adapter holds no state and performs no async work, so it has no internal failure mode; a throw would be caught by the existing per-module boundary the shell already wraps routes in (`apps/web/src/router.tsx` `elementFor`).
- `apps/web/src/components/BoardLayout.tsx:192` — suppressing the agent overlay removes the one surface that would otherwise imply a channel into the frame.
- The module documents the boundary it does NOT cross: no messaging SDK, no postMessage bridge, no child DOM access, no automatic permissions, no custom sandbox promise. Switching away unmounts the component, so the child document is discarded and its in-page state resets; no Board context, theme, route or data crosses in either direction.

**Decisions**

- A framed resource is modelled as an ordinary `WebModule` rather than a parallel registry type, so routing, sidebar ordering, deep links and the single-selected-workspace rule needed no second code path.
- Suppression is derived from the active module at render time instead of mutating layout state, which is what keeps saved user preferences intact across a rendering-type switch.
- The frame adapter is intentionally the thinnest possible component: every capability the task forbids (sandbox policy, readiness inference, cross-document messaging) is absent by construction rather than disabled by a flag.

### Testing

Focused tests were run inside their workspace so each workspace `bunfig.toml` preload applies; the
full gate was run once from the worktree root.

| Command | Outcome |
| --- | --- |
| `(cd apps/web && bun test tests/components/FramedResource.test.tsx tests/components/BoardLayoutFramed.test.tsx tests/modules/compose.test.ts)` | **29 pass / 0 fail**, 88 assertions, 444.00ms — the whole slice |
| `bun run lint` | **exit 0** — Biome clean across 1180 files, typecheck exit 0 for all eight workspaces plus `scripts/` and `plugins/sp` |
| `bun run <cli> rule run --preset recommended-post-check --fail-on warning --no-logo` | **all 2 rules pass** |
| `bun run spur-check` | **exit 0 — 9523 pass / 0 fail** across 554 files (241.05s), pre-check 49 rules and post-check 2 rules pass |

#### What the tests actually assert

- **Adapter (`FramedResource.test.tsx`, 5 tests).** The frame's `src` is exactly the configured URL (no proxy, no rewritten origin) and its accessible `title` is the configured name; `frame.onload` is `null` and no `data-ready` / `data-loading` / `aria-busy` surface exists, so no readiness can be inferred from a load; `sandbox`, `allow` and `csp` are all absent; the external link carries `target="_blank"` with `rel="noopener noreferrer"`; the shell and frame use flex/min-width/min-height so the child owns scrolling.
- **Shell (`BoardLayoutFramed.test.tsx`, 5 tests).** A framed module mounts and marks the shell `data-framed-workspace="true"`; a framed workspace has exactly **one** `<aside>` and exactly **one** `.resize-handle` (sidebar only), versus two of each for a built-in, so the panel and its handle are genuinely gone rather than empty; no `agent-bar` or `agent-bar-dock` is rendered; and a saved `rightPanelCollapsed: false` preference is unchanged after visiting a framed module and returning.
- **Composition (`compose.test.ts`, 19 tests).** An iframe descriptor becomes an ordinary entry with its configured metadata and derived `modules/<id>` route preserved, produces no host diagnostic, **never calls the ESM entry loader or the stylesheet loader**, and renders through the frame adapter rather than a diagnostic. Two previously uncovered branches were closed while doing this: a contribution whose `webModule.component` is not a function now reports an `export` diagnostic, and a stylesheet that fires `error` reports a `style` diagnostic without evaluating the entry.

#### Two defects found while verifying this slice

1. **Per-file coverage threshold, not a test failure.** The first full gate reported `9521 pass / 0 fail` yet exited 1. The cause was `bunfig.toml`'s per-file `coverageThreshold = { lines = 0.9, functions = 0.9 }`: `apps/web/src/modules/compose.ts` fell to **87.5% functions** because the new frame entry's component arrow function was asserted to exist but never *called*. Rendering it (server-side, so no frame navigation) plus the two branch tests above returned the file to **91.67%+**.
2. **A unit-test DOM must not load a framed document.** Rendering an `<iframe>` with an `https:` `src` made happy-dom issue a real network request that failed as an unhandled `ECONNREFUSED`, exiting the test script non-zero while every assertion passed; disabling iframe page loading merely swapped it for `NotSupportedError`. The adapter tests therefore use a `data:` document as the configured URL — which exercises the same contract (the adapter passes whatever URL it is given through verbatim, to both the frame and the escape hatch) with no navigation. Real frame-policy behaviour stays covered over CDP by `board-frames-browser.test.ts`.

#### Regression position

The suite grew 9511 → **9523 passing** (+12) across 554 files with **0 failures**. Existing files changed only where the slice required it: `compose.test.ts` gained the framed-entry case that replaces the placeholder behaviour asserted by the previous slice, and the previously uncovered branches noted above. No production behaviour outside this slice was altered, and no test was weakened or skipped.

### Review

Reviewed the change set against R1–R5, AC1–AC3, and the frozen out-of-scope list. Verification was
observation-only; every row below is a finding observed in this change set.

| Priority | Severity | Finding | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| P2 (major) | major | Frame policy is asserted structurally, not behaviourally in a real browser. `FramedResource.test.tsx` proves the adapter sets no `sandbox`/`allow`/`csp` and attaches no `load` handler, but nothing in *this* slice loads a permitted and a denied cross-origin resource through the real adapter and observes the browser's decision. The existing real-browser frame proof (`board-frames-browser.test.ts`) still drives the fixture harness rather than the composed Board path. | `apps/web/tests/components/FramedResource.test.tsx`; `apps/web/tests/modules/board-frames-browser.test.ts` unchanged by this task | Accepted with a named successor: AC3's third clause ("the real Board iframe adapter loads each resource") is satisfied end-to-end only once the final slice exercises the composed path in a browser, which its Design already assigns. Carried forward, not closed. |
| P3 (minor) | minor | `MainWorkspace` gained a behavioural branch (`framed`) that changes the scroll container for every module, not just framed ones. It is exercised by the framed and built-in shell tests, but a future module type that sets `contributionType` to something new would silently take the unframed path. | `apps/web/src/components/MainWorkspace.tsx:14`, `:18` | Accepted — the flag is opt-in and defaults to the previous behaviour, so the blast radius is limited to callers that pass it, and only `BoardLayout` does. |
| P3 (minor) | minor | The framed workspace suppresses the global agent overlay by not rendering it, so there is no visible affordance explaining why the agent bar is absent while a framed resource is selected. | `apps/web/src/components/BoardLayout.tsx:192` | Accepted as designed — R2 requires the overlay to be absent, and adding an explanation surface would itself be an overlay. |
| P4 (advisory) | advisory | `data-framed-workspace` is published on the layout root as well as driving CSS, so it is part of the observable DOM surface even though it is a layout detail. | `apps/web/src/components/BoardLayout.tsx:157` | Accepted — it mirrors the existing `data-sidebar-collapsed` / `data-rightpanel-collapsed` convention, and the shell tests use it. |

No P1 (blocker) findings were identified.

Frozen out-of-scope list re-verified clean: no messaging SDK, no postMessage bridge, no app launcher,
no automatic permissions, no child DOM access, no custom sandbox promise, and no header proxying,
stripping or rewriting. The adapter also introduces no new runtime dependency and no new public CLI
noun or verb.

One corrective note recorded for the next slice: this task deliberately does **not** derive readiness
from a frame load, which means the Board cannot tell a rendered frame from a refused one. Any future
slice that wants to distinguish them must do so from an explicit operator-visible signal, not from
`load`.


**Successors (filed 2026-09-28).** The residual above is now owned: the in-app project-switch mechanism
that this slice did not exercise is filed as task **0997**, with its evidence and fix direction recorded
there rather than only here.

### References

- Feature: [A8](../features/A8_downstream-spur-board-modules-and-embedded-resources.md).
- Governing contract: [downstream Board modules](../design/downstream-board-modules.md); [ADR-128](../00_ADR.md#adr-128-project-owned-board-contributions-share-one-host-registry); [UI rules](../../DESIGN.md#product-ui--downstream-board-modules-proposed).
- Investigation/history: [2026-09-27 plan](../plans/2026-09-27-dynamic-board-modules-brainstorm.md). Historical alternatives are not current requirements.
- Dependency outputs: Prerequisite 0990: resolved registry/provider, native layout behavior and shared error containment; 0989's validated frame URLs and 0988's owned browser fixtures arrive transitively. Handoff to 0992: production iframe adapter, workspace occupancy and browser-policy evidence.
- Concurrency audit 2026-09-27: main at 67096d060f951d416f0ad9acdf3a119543bcfe33; task 0984 is wip in /Users/robin/xprojects/spur-wt-0984 and owns unrelated run-evidence helpers. One writer per tree; integrate this planning batch into a clean task branch before implementation. Recheck active worktrees/status at execution start.
- Source facts and proposed new targets are distinguished in Background/Design. Existing dist/web/generated artifacts must be rebuilt before distribution evidence; no generation-freshness claim was inferred from their presence.

### History

- 2026-09-29T01:21:21.099Z todo → wip (system)
- 2026-09-29T01:21:59.264Z wip → testing (system)
- 2026-09-29T01:21:59.964Z testing → done (system)

### Notes

Planning freeze (2026-09-27): Requirements, Design, Plan, AC mapping, closed decisions, dependency contracts and current-tree premises have been audited. These specifications are ready for ordered delegation. Only 0988 is execution-eligible immediately; later tasks wait for their named prerequisites. Normal task checks pass with only L4.prerequisite-not-done warnings on dependent tasks; --as todo elevates those waiting-state findings to errors. Do not remove dependencies, change prerequisite statuses or suppress those findings to make all tasks simultaneously runnable.

Final concurrency recheck: main is now f32848ba6898765d0ecf31b1e7d87bf61a16aa16, git worktree list shows only the root tree, and task list --status wip returns empty. The earlier 0984 ownership note is historical; its other session finished during planning. Material A8 source seams were reread and remain unimplemented. Keep the step-0 clean-tree/tool-version/generated-build precondition for execution.

