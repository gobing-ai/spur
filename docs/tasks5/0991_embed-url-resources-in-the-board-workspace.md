---
schema_version: 1
name: Embed URL resources in the Board workspace
status: todo
template: feature-impl
created_at: 2026-09-28T01:46:26.509Z
updated_at: "2026-09-28T01:51:42.762Z"
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

- [ ] R1. Adapt each enabled iframe descriptor into the same resolved WebModule registry used by built-ins/native contributions, preserving configured metadata and derived /board/<id> routes; keep one selected workspace and no hidden frame persistence.
- [ ] R2. Fill the available workspace beside the sidebar without an empty right panel, right-panel resize handle or global agent overlay. Use one flex/min-height/min-width layout, let the child document own content scrolling, and preserve built-in saved layout preferences when switching rendering types.
- [ ] R3. Render an accessible iframe title and an always-available Open externally anchor using target=_blank and rel=noopener noreferrer; retain mobile menu access, visible keyboard focus and normal traversal without trapping focus or injecting child shortcuts.
- [ ] R4. Respect child CSP frame-ancestors/X-Frame-Options, host frame-src and cross-origin restrictions; never claim a load event proves readiness, weaken policies, proxy/strip headers or force login/cookie behavior. The configured URL application remains independently operated.
- [ ] R5. Contain host adapter errors and keep navigation available. Document that switching away unmounts/reset may occur and that Board context/theme/data/route sync is absent; add no messaging SDK, app launcher, automatic permissions, child DOM access or custom sandbox promise.

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

- [ ] Step 0 — Start from a clean task-specific branch/worktree containing this planning batch and completed dependency outputs. Re-read AGENTS.md, the contribution contract and root DESIGN.md for UI changes. Preserve unrelated work: task 0984 currently owns run-evidence helpers in another worktree; do not touch its files. Verify installed dependency resolution and lockfile, then build fresh generated assets when testing distribution; existing dist/web is not proof of freshness.
- [ ] Step 1 (R1,R4,R5) — Add the Board-owned wrapper and adapt already-validated iframe descriptors in composeBoardModules. Assert no external ESM/style import is attempted for iframe entries and both contribution types occupy one navigation registry.
- [ ] Step 2 (R2) — Make BoardLayout suppress frame-only panel/resize/overlay surfaces and fill remaining workspace with CSS. Test native-with-panel, native-without-panel, iframe, then built-in transitions without saved-preference writes.
- [ ] Step 3 (R3,R5) — Add title, visible external action and honest embedding/state guidance. Verify keyboard/mobile navigation and narrow/wide layouts; no parent key trap, hidden frame persistence or child DOM access.
- [ ] Step 4 (R4) — Run the owned allowed/denied fixtures from the runtime proof in a real browser on different origins. Observe allowed app navigation, denial, external-open link target/rel and independent child scrolling; do not mock CSP/X-Frame-Options.
- [ ] Step 5 (R1–R5) — Add proposed apps/web/tests/components/IframeModule.test.tsx and extend shell/layout/registry tests, with real-browser observations for framing/mobile behavior. Run a fresh web build and task gate. Run focused tests inside their workspace (its bunfig supplies preloads), then the task pipeline's required bun run spur-check once. Record real commands, versions, fixture locations, expected/actual observations and verdicts in execution-owned sections during implementation. Leave feature-wide checks to the final slice. No CLI noun/verb is added.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: [A8](../features/A8_downstream-spur-board-modules-and-embedded-resources.md).
- Governing contract: [downstream Board modules](../design/downstream-board-modules.md); [ADR-128](../00_ADR.md#adr-128-project-owned-board-contributions-share-one-host-registry); [UI rules](../../DESIGN.md#product-ui--downstream-board-modules-proposed).
- Investigation/history: [2026-09-27 plan](../plans/2026-09-27-dynamic-board-modules-brainstorm.md). Historical alternatives are not current requirements.
- Dependency outputs: Prerequisite 0990: resolved registry/provider, native layout behavior and shared error containment; 0989's validated frame URLs and 0988's owned browser fixtures arrive transitively. Handoff to 0992: production iframe adapter, workspace occupancy and browser-policy evidence.
- Concurrency audit 2026-09-27: main at 67096d060f951d416f0ad9acdf3a119543bcfe33; task 0984 is wip in /Users/robin/xprojects/spur-wt-0984 and owns unrelated run-evidence helpers. One writer per tree; integrate this planning batch into a clean task branch before implementation. Recheck active worktrees/status at execution start.
- Source facts and proposed new targets are distinguished in Background/Design. Existing dist/web/generated artifacts must be rebuilt before distribution evidence; no generation-freshness claim was inferred from their presence.

### History
### Notes

Planning freeze (2026-09-27): Requirements, Design, Plan, AC mapping, closed decisions, dependency contracts and current-tree premises have been audited. These specifications are ready for ordered delegation. Only 0988 is execution-eligible immediately; later tasks wait for their named prerequisites. Normal task checks pass with only L4.prerequisite-not-done warnings on dependent tasks; --as todo elevates those waiting-state findings to errors. Do not remove dependencies, change prerequisite statuses or suppress those findings to make all tasks simultaneously runnable.

Final concurrency recheck: main is now f32848ba6898765d0ecf31b1e7d87bf61a16aa16, git worktree list shows only the root tree, and task list --status wip returns empty. The earlier 0984 ownership note is historical; its other session finished during planning. Material A8 source seams were reread and remain unimplemented. Keep the step-0 clean-tree/tool-version/generated-build precondition for execution.

