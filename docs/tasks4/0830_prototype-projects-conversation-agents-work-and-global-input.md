---
schema_version: 1
name: Prototype Projects conversation, agents, work, and global input interactions
status: done
template: feature-impl
created_at: 2026-09-11T18:07:39.271Z
updated_at: "2026-09-12T04:15:58.917Z"
feature_id: G6
priority: P2
tags:
  - wayfinder:prototype

dependencies: ["0828"]
---

## 0830. Prototype Projects conversation, agents, work, and global input interactions

### Background

Robin approved the G6 Projects structure (Conversation, Agents, Work), rest/GTD defaults, and managed-loop v1 boundary on 2026-09-11. This task makes that direction concrete for product review through an isolated interactive prototype.

The current GlobalAgentBar is UI-only, ProjectSwitcher navigates between project servers, and Workspace composes team-scoped views. The prototype must model the proposed request/receipt/result behavior without claiming those production paths are already connected. Consume the completed 0828 runtime inventory for honest state labels and capability/route migration.

### Requirements

- [x] R1. Deliver a locally reviewable Projects prototype with Conversation, Agents and Work, one project switcher, per-agent role/executor/run details, and contextual lifecycle/terminal/message/activity controls.
- [x] R2. Demonstrate project-bound input and task/feature references, receipt-before-clear, failure draft preservation, idempotent retry, result navigation, and switching projects while a submission is pending.
- [x] R3. Make zero-agent, missing/offline orchestrator, rest-held, executor-unavailable, blocked, failed-delivery and outcome-unknown states selectable using labeled mock data; explain the available action in each state.
- [x] R4. Verify keyboard/IME, focus and announcements, narrow-screen layout and the retained-control/legacy-route mapping; publish a review package with explicit mock/runtime limitations.

Out of scope: modifying live Board routes or components, production API calls, launching/stopping agents or project servers, new dependencies, actual team/config migration, backend implementation, or treating visual review as runtime verification.

### Acceptance Criteria

- [x] AC-1 (R1): Given the local prototype, when its three views and agent detail are opened, then all retained capabilities are discoverable under one project context and every mutation is visibly simulated.
- [x] AC-2 (R2): Given two projects with colliding labels and delayed/failing responses, when the user submits, edits, retries, switches and refreshes, then requests/results remain bound to the captured project and no newer or other-project draft is cleared.
- [x] AC-3 (R3): Given the fixture controls, when each required state is selected, then its honest status and recovery/next action are visible and no mock result is presented as a production receipt.
- [x] AC-4 (R4): Given the review package, when checks are inspected, then automated interaction results, keyboard/IME/focus evidence, 390/1440 px views and complete legacy control/route mapping are recorded; unavailable browser evidence remains explicitly unverified.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-11T23:05:58.812Z

Ready-depth refinement, 2026-09-11:
- CLOSED — Conversation/Agents/Work and one project selector are approved. Detailed visual feedback is collected after the artifact is reviewable.
- CLOSED — All dispatch/lifecycle controls are mocked; no real backend, agent process or project server is contacted.
- CLOSED — open-design is optional tooling for this deliverable; a self-contained local HTML prototype is the fixed fallback and portable output.
- CLOSED — Drafts are revision-aware and project-bound; late acknowledgments cannot clear newly typed text or the active draft of another project.
- CLOSED — Use existing happy-dom for an automated interaction check; it does not substitute for browser evidence of layout or native IME behavior.
- DEFERRED — Robin owns final visual feedback and cutover timing. Public API/schema naming belongs to the later implementation design, not this mock.

### Design

#### WHAT / WHY / WHERE

Freeze deliverables: `docs/prototypes/g6-projects/index.html` (self-contained HTML/CSS/JavaScript with labeled fixtures) and `docs/reports/g6-projects-prototype.md` (viewing instructions, scenarios, screenshots/check evidence and migration mapping). No new production API, route, package or shared component abstraction. Use the DESIGN.md surface/ink/accent/spacing values and semantic native controls; no CDN, network font, dependency install or build pipeline is needed.

Existing components are behavior references: GlobalAgentBar, ProjectSwitcher, BoardLayout, WorkspaceShell, InboxShell, TeamsShell, MemberTerminal and task/feature views. Reuse their useful labels/control hierarchy, not their stub submission or duplicate navigation. Existing production files remain untouched by this prototype.

The requested open-design tool may be used if available, but the local interactive artifact is the required portable output. Tool absence is resolved by this fallback, not an approval blocker.

#### Frozen interaction contract

Show one project selector and a header with worktree, strategy, orchestrator availability and capacity. Conversation is the default view. Agents exposes member details plus contextual process/terminal/message/activity inspection. Work links the selected task/feature to the same conversation; it does not maintain a second task backlog. All lifecycle controls simulate outcomes and visibly identify the simulation.

Fixtures include two distinct project paths with identical display/member labels to expose accidental name-based addressing. Private prototype request fields are projectPath, requestId, text and optional taskId/featureId. Capture these at submission; subsequent navigation cannot change their destination. Store drafts and conversation independently by project path in a versioned prototype-only localStorage key, `spur:g6:projects-prototype:v1`; invalid/unavailable storage shows a nonfatal persistence notice. Do not read or write production Board storage.

Send creates a pending receipt row; clear only the submitted draft revision after a simulated durable acceptance. If the user edits while waiting, retain the newer text. On failure keep the draft and retry with the same requestId for the same immutable payload; changed payload gets a new ID. A late receipt/result updates its original project's conversation, never the currently focused project's draft. A successful queued receipt with no active orchestrator is labeled queued-awaiting-orchestrator, not working.

Provide explicit fixture controls for delayed acceptance, network failure, duplicate retry, result arrival, refresh, and every R3 state. rest accepts requests into a visible hold; results from already-running work remain visible. Unknown outcome offers inspect/reconcile guidance, not an unconditional retry. Mock work completion distinguishes run exit from a verified result.

Enter submits; Shift+Enter inserts a newline; Enter during IME composition never submits. Escape closes detail/floating surfaces and restores focus to the opener. Tabs work by keyboard, selected state is announced, status updates use an appropriate live region, errors preserve readable text, and state is not communicated by color alone. Check 390 px and 1440 px layouts; the composer cannot obscure content or focused controls.

#### Dependency and verification contract

0828 supplies observable states and the preserve/convert/retire mapping. Keep its current-versus-proposed distinction visible. 0829 is not a dependency: both prototypes share the approved strategy semantics; UI mock labels must not imply that its simulator is a production backend.

The report records steps and actual outcomes for every R2/R3 case, keyboard/IME/focus behavior, both viewports, and a control/route mapping for Workspace/Inbox/Teams. At least one automated interaction check belongs under `apps/web/tests/prototypes/g6-projects.test.ts`, using existing happy-dom where useful, and must fail on cross-project receipt/draft corruption. Run it inside apps/web. Browser inspection is required for layout and real focus/IME evidence when available; DOM-only checks cannot establish those. If the browser is unavailable, name the unverified cases and leave verification partial rather than claiming visual PASS.

Do not freeze new production DTOs or endpoint names from this private mock. Robin owns visual/taste feedback after the prototype exists; that does not block building the approved three-view structure. Execution checkpoint after 60 minutes: save artifact and unverified scenarios under `.spur/run/0830/`, then continue. Production mutationPolicy: none; prototype/report/check files satisfy requireDiff.

### Plan

- [x] R1/R4: Read approved G6, DESIGN.md, completed 0828 Handoff and existing Board components; map retained controls before drawing views.
- [x] R1/R3: Build the self-contained three-view prototype with two project fixtures and all required availability/hold/failure states.
- [x] R2: Implement simulated asynchronous receipts/results, per-project drafts and immutable retry identity; exercise delayed receipts while editing and switching projects.
- [x] R2/R4: Add and run the existing-toolchain interaction check inside apps/web; inspect keyboard/IME/focus and the two viewports in an available browser.
- [x] R3/R4: Publish viewing instructions, scenario receipts, visual evidence, route/control migration and explicit limitations for Robin's review.

### Solution

Self-contained G6 Projects simulation; no production routes, API calls, processes or dependencies changed.

- `docs/prototypes/g6-projects/index.html:470` — captures immutable project/task/feature payloads; correct duplicate/retry comparison and unknown-outcome suppression.
- `docs/prototypes/g6-projects/index.html:608` — clears only the accepted persisted draft revision; preserves task references on failure and newer edits.
- `docs/prototypes/g6-projects/index.html:367` — rejects malformed conversation storage and detaches pre-reload timer captures.
- `docs/prototypes/g6-projects/index.html:199` — labeled mock Start/Stop and member Terminal/Messages input; detail keyboard/focus and project-switch isolation. Result rows navigate to their captured work reference.
- `apps/web/tests/prototypes/g6-projects.test.ts:458` — regression checks reproduced draft loss, duplicate reference requests and unknown replay; 19 interaction tests now pass.
- `docs/reports/g6-projects-prototype.md:76` — Chrome screenshots at 390/1440 px, real browser keyboard/composition/focus and reload evidence, plus complete retained-control/route mapping. Composer and fixture controls use normal flow to prevent overlap.

Chrome input-engine composition is verified; operating-system candidate windows, mobile keyboards and other browsers are not claimed. All lifecycle, receipt and result behavior remains visibly simulated.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/tests/prototypes/g6-projects.test.ts:497` and `apps/web/tests/prototypes/g6-projects.test.ts:545` — mock lifecycle/member input and project-bound result navigation; workspace `bun test tests/prototypes/g6-projects.test.ts` exit 0 (19 tests, 200 assertions). |
| R2 | MET | `apps/web/tests/prototypes/g6-projects.test.ts:458` — revision-safe clear; task-reference retry and unknown-outcome regression cases at lines 468 and 486; same command exit 0. Chrome actual reload preserves project isolation. |
| R3 | MET | `docs/prototypes/g6-projects/index.html:850` — selectable state cards; workspace suite exercises every required state and prevents unknown-outcome replay; same test command exit 0. |
| R4 | MET | `docs/reports/g6-projects-prototype.md:76` — Chrome 153 at 390/1440 px: keyboard, browser input-engine composition, detail focus, reload isolation and zero overflow/page errors; browser-check.mjs exit 0. Tracked screenshots and complete legacy mapping; OS candidate UI untested. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 (R1) | MET | test | `apps/web/tests/prototypes/g6-projects.test.ts:497` and `apps/web/tests/prototypes/g6-projects.test.ts:545` — mock lifecycle/member input and project-bound result navigation; workspace `bun test tests/prototypes/g6-projects.test.ts` exit 0 (19 tests, 200 assertions). |
| AC-2 (R2) | MET | test | `apps/web/tests/prototypes/g6-projects.test.ts:458` — revision-safe clear; task-reference retry and unknown-outcome regression cases at lines 468 and 486; same command exit 0. Chrome actual reload preserves project isolation. |
| AC-3 (R3) | MET | test | `docs/prototypes/g6-projects/index.html:850` — selectable state cards; workspace suite exercises every required state and prevents unknown-outcome replay; same test command exit 0. |
| AC-4 (R4) | MET | command | `docs/reports/g6-projects-prototype.md:76` — Chrome 153 at 390/1440 px: keyboard, browser input-engine composition, detail focus, reload isolation and zero overflow/page errors; browser-check.mjs exit 0. Tracked screenshots and complete legacy mapping; OS candidate UI untested. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Self-contained prototype, retained controls, per-project immutable requests and revision-aware clearing; screenshots and real Chromium composition/focus evidence replace the old browser-unverified receipt. |
| P4 | scope-creep | — | Prototype, task-owned tests/report/screenshots only; production Board and APIs untouched. |
| P4 | browser | — | node .spur/run/g6-verifyall/browser-check.mjs exit 0; Chrome 153.0.8010.36 at 390x900 and 1440x900; OS candidate UI and mobile keyboards not exercised. |
| P4 | fix-artifacts | — | Rewrote .spur/run/0830-verify-answer.txt lines 1-31; derived .spur/run/0830-verdict.json; .spur/run/g6-verifyall/0830-red.log, 0830-tests.log, browser-check.mjs and browser-results.json disclose checks. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- [G6 map and approval](../features/G6_projects-and-agent-fleet-unification-design.md)
- [Approved design direction](../plans/2026-09-11-project-agent-fleet-brainstorm.md)
- [0828 — Runtime and migration investigation](0828_inventory-and-probe-project-fleet-identity-delivery-and-lega.md)
- [DESIGN.md](../../DESIGN.md)
- [GlobalAgentBar](../../apps/web/src/components/GlobalAgentBar.tsx)
- [ProjectSwitcher](../../apps/web/src/components/ProjectSwitcher.tsx)
- [Existing input-bar test setup](../../apps/web/tests/components/GlobalAgentBar.test.tsx)
- [Workspace ownership](../design/workspace-design.md)
- [Inbox message-plane boundary](../design/inbox-board-module.md)
- Required future input: `docs/reports/g6-runtime-inventory.md` from 0828. Required outputs listed in Design are planned artifacts, not existing evidence.

### History

- 2026-09-11T23:53:05.194Z todo → wip (system)
- 2026-09-12T00:27:20.941Z wip → testing (system)
- 2026-09-12T00:27:21.274Z testing → done (system)

