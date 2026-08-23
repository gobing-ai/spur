---
schema_version: 1
name: "History Board Timeline Tab: Default filter checkboxes to checked, rename Hide other empty, 80% card width with left/right alignment, and unclipped top-layer tooltips"
status: done
template: feature-impl
created_at: 2026-08-23T13:59:01.053Z
updated_at: "2026-08-23T21:47:35.870Z"
feature_id: E8
---

## 0636. History Board Timeline Tab: Default filter checkboxes to checked, rename Hide other empty, 80% card width with left/right alignment, and unclipped top-layer tooltips

### Background
Following the initial compact stream implementation in task 0635, this task applies targeted UI and ergonomics refinements to the History Board Timeline tab based on operator feedback:

1. **Default Filter Checkboxes & Renaming:**
   - Initialize `Hide assistant`, `Hide unknown`, and `Hide other empty` to **checked by default** (`useState(true)`).
   - Rename the 3rd filter option from `Hide empty` to `Hide other empty` to clarify that empty assistant and unknown turns are filtered by the first two toggles, while the 3rd suppresses other remaining empty blocks/events.
   - When checked by default, the timeline immediately displays a clean, high-signal stream of user prompts and actual tool-using operations.

2. **Asymmetric 80% Card Width & Left/Right Alignment:**
   - User input cards are sized to **80% parent width** (`w-[80%]`) and aligned to the **right** (`flex justify-end`), reinforcing conversational prompt orientation.
   - Tool-using operation cards are sized to **80% parent width** (`w-[80%]`) and aligned to the **left** (`flex justify-start`), establishing clear visual distinction between user inputs and agent actions.

3. **Top-Layer Tooltips & Unclipped Stacking Context:**
   - In collapsed single-line cards (~38 px), tooltips on coding agent vector icons (`AgentBadge`) and tool name tags (`ToolTokenBadge`) were previously prone to clipping due to `overflow-hidden` on the card container and lower z-index stacking across consecutive rows.
   - Remove `overflow-hidden` from the card boundary, move payload clipping to the inner expanded drawer, and elevate popovers with `z-50` so tooltips always display unclipped at the top layer above surrounding cards.
### Requirements
- **R1 (Default Checkbox State & Labeling):** Initialize `hideAssistant`, `hideUnknown`, and `hideOtherEmpty` state to `true` by default in `TimelineTab.tsx`. Label the third checkbox explicitly as `Hide other empty`. Ensure blocks with no matching events under active default filters are omitted.
- **R2 (Card Width & Conversational Alignment):** User prompt cards must be 80% width (`w-[80%]`) and right-aligned (`justify-end`) within the right column. Tool-using operation cards must be 80% width (`w-[80%]`) and left-aligned (`justify-start`) within the right column.
- **R3 (Top-Layer Unclipped Tooltip Architecture):** Remove `overflow-hidden` from the operation card outer container so tooltips are never clipped by the card boundary. Set `z-50` on tooltip popovers (`AgentBadge` and `ToolTokenBadge`) and ensure proper stacking context across single-line cards. Keep payload scroll overflow strictly within the inner expanded drawer (`overflow-x-auto rounded-b-lg`).
- **R4 (Component Test Suite):** Update tests in `components.test.tsx` verifying that all three checkboxes (`timeline-filter-assistant`, `timeline-filter-unknown`, `timeline-filter-empty`) are checked by default, text label contains `Hide other empty`, user cards render with right alignment (`justify-end`, `w-[80%]`), and operation cards render with left alignment (`justify-start`, `w-[80%]`).
- **R5 (Quality Gate & Doc Synchronization):** Pass comprehensive quality gate `bun run autofix && bun run spur-check` (6,232 tests green), `bun run test-cf`, `bun run build`, and `spur task check --corpus`. Synchronize `docs/design/history-board-module.md` and `docs/04_DESIGN.md`.
### Acceptance Criteria
```gherkin
Feature: History Board Timeline Filter Defaults, 80% Asymmetric Alignment, and Top-Layer Tooltips

  Scenario: Timeline tab inspects session execution with Agent and Model tags
    Given a session record is selected from the dropdown or deep-linked from the Sessions table
    When the Timeline tab is viewed
    Then the header displays session ID, Coding Agent badge, Model badge, duration, and token metrics
    And chronological event rows render user prompts on the right and tool/command events on the left
    And each tool/command event displays an [Agent] and [Model] tag alongside latency duration and token telemetry
    And clicking an event toggles the full input/output payload and execution metadata
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
#### 1. Filter Checkbox Defaults & Labels
- State initialization:
  ```ts
  const [hideAssistant, setHideAssistant] = useState(true);
  const [hideUnknown, setHideUnknown] = useState(true);
  const [hideOtherEmpty, setHideOtherEmpty] = useState(true);
  ```
- Checkbox label text: `Hide assistant`, `Hide unknown`, `Hide other empty`.

#### 2. Card Width & Alignment Geometry
- **User Prompt Row (`TimelineTab.tsx`):**
  - Container: `pl-6 sm:pl-5 min-w-0 flex justify-end`
  - Card: `w-[80%] max-w-none bg-base-100 rounded-lg border border-primary/20 hover:border-primary/40 ...`
- **Operation Card Row (`TimelineTab.tsx`):**
  - Container: `pl-6 sm:pl-5 min-w-0 flex justify-start`
  - Card: `w-[80%] max-w-none bg-base-100 rounded-lg border border-base-content/10 border-l-[3px] ...`

#### 3. Stacking Context & Tooltip Architecture
- Remove `overflow-hidden` from the outer `.bg-base-100` card container so tooltip popovers extend beyond card boundaries without clipping.
- Set `z-50` on popovers (`AgentBadge` and `ToolTokenBadge`):
  ```tsx
  className={`absolute left-0 top-full z-50 mt-1 w-56 p-2 rounded-lg bg-base-300 border border-base-content/20 shadow-2xl text-[11px] font-mono leading-relaxed pointer-events-none ${open ? 'block' : 'hidden'}`}
  ```
- Retain inner drawer clipping when expanded (`rounded-b-lg overflow-x-auto border-t border-base-content/10`).
### Plan
- [x] Initialize `hideAssistant`, `hideUnknown`, and `hideOtherEmpty` state to `true` and update label to `Hide other empty` in `TimelineTab.tsx` (R1).
- [x] Set 80% width (`w-[80%]`) and right-alignment (`justify-end`) on user prompt cards, and 80% width (`w-[80%]`) and left-alignment (`justify-start`) on tool-using operation cards (R2).
- [x] Remove `overflow-hidden` from outer operation cards, elevate tooltip popovers with `z-50`, and isolate drawer clipping to the inner container (R3).
- [x] Update `components.test.tsx` assertions for default-checked filters, `Hide other empty` label, 80% width/alignment classes, and unclipped tooltip rendering (R4).
- [x] Synchronize satellite documentation in `docs/design/history-board-module.md` and `docs/04_DESIGN.md` (R5).
- [x] Run full quality gate (`bun run autofix && bun run spur-check`), Cloudflare worker test (`bun run test-cf`), build (`bun run build`), and corpus check (`bun run corpus-check`) (R5).
### Solution
Curated change-map — one row per changed file, anchored at the primary symbol each change implements.

| Change | Anchor |
|--------|--------|
| `TimelineTab` — initialized filter checkboxes to `true` by default, renamed 3rd toggle to `Hide other empty`, set 80% card width with right-aligned user cards (`justify-end`) and left-aligned operation cards (`justify-start`), and elevated popovers to `z-50` with unclipped outer card containers | `apps/web/src/modules/history/TimelineTab.tsx:306` |
| Timeline component test suite asserting Conversation panel with filter checkboxes, ordered 9-field metadata, and formula calculations | `apps/web/tests/modules/history/components.test.tsx:390` |
| Synchronized Timeline specification and task mapping in History Board design satellite | `docs/design/history-board-module.md:10` |
| Synchronized History Board satellite reference in 04_DESIGN.md | `docs/04_DESIGN.md:66` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/history/TimelineTab.tsx:322-324` initializes `hideAssistant`, `hideUnknown`, and `hideOtherEmpty` to `true`; `:369-385` removes assistant, unknown, truly empty events, and empty blocks; `:471-500` binds the three checked controls and exact `Hide other empty` label. `apps/web/tests/modules/history/components.test.tsx:300-313,486-627` exercises the defaults, label, and filtering behavior. |
| R2 | MET | `apps/web/src/modules/history/TimelineTab.tsx:780-781` renders the user card as exact `w-[80%]` inside `justify-end`; `:696-699` renders the operation card as exact `w-[80%]` inside `justify-start`. `apps/web/tests/modules/history/components.test.tsx:375-406` asserts all four classes with non-vacuous `not.toBeNull()` checks. |
| R3 | MET | `apps/web/src/modules/history/TimelineTab.tsx:231,287` places AgentBadge and ToolTokenBadge popovers at `z-50`; the operation card at `:699` has no `overflow-hidden`; its expanded drawer at `:766-774` owns `overflow-x-auto rounded-b-lg`. Component tests at `apps/web/tests/modules/history/components.test.tsx:408-448` exercise both accessible tooltip layers and their focus, hover, blur, and Escape behavior. |
| R4 | MET | `apps/web/tests/modules/history/components.test.tsx:300-313,375-406` asserts all filter defaults, exact third label, user right alignment plus exact width, and operation left alignment plus exact width. The strengthened selector assertions first failed against `w-full sm:w-[80%]`, then passed after the production repair; the full file exited 0 with 15 tests and 189 assertions. |
| R5 | MET | `docs/design/history-board-module.md:64-70,187` records the exact Timeline behavior and maps task 0636; `docs/04_DESIGN.md` indexes that satellite. Fresh gates all exited 0: `bun run autofix`, `bun run spur-check` (6,233 tests / 340 files / 24,112 assertions / 99.07% lines), `bun run test-cf` (1/1), `bun run build`, and `bun run corpus-check` (0 new / 0 stale). |
| AC-2 | MET | The E8 Timeline scenario is exercised by `apps/web/tests/modules/history/components.test.tsx:300-627`; the full component file exited 0 with 15 tests and 189 assertions, and the repository suite exited 0 with 6,233 tests. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Timeline tab inspects session execution with Agent and Model tags | MET | test | `apps/web/tests/modules/history/components.test.tsx:300-627` proves the session metadata, chronological user/tool rows, Agent/Model and token/duration telemetry, filtering, alignment, tooltips, and payload disclosure; `bun test apps/web/tests/modules/history/components.test.tsx` exited 0 with 15 tests and 189 assertions. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Phase | Focus | Status | Findings |
|---|---|---|---|
| P1 | Functional Traceability | PASS | All 5 requirements (R1–R5) verified against code and test assertions. Checkbox defaults are true, label is 'Hide other empty', cards have 80% width with right/left alignment, and tooltips are unclipped at z-50. |
| P2 | SECUA & Quality | PASS | No security vulnerabilities, zero new dependencies, full keyboard navigation (Escape, focus/blur), reduced-motion support, no raw console logs, pure Tailwind utility classes. |
| P3 | Architecture Depth | PASS | Clean single-file UI refinement in `TimelineTab.tsx` without leaking DaisyUI classes. Drawer overflow isolation prevents card popover clipping. |
| P4 | Documentation & Parity | PASS | Synchronized `docs/design/history-board-module.md` (frontmatter, Section 3.2, Section 5) and `docs/04_DESIGN.md` satellite index. |
### References
- Feature [E8](../../features/E8_history-board-module-analytics-summary-execution-timeline-sessions-forensic-insights-and-agent-sources-registry.md)
- History Board Design Satellite [`docs/design/history-board-module.md`](../design/history-board-module.md)
- Prior task [0635](0635_history-board-timeline-tab-compact-antigravity-cli-stream-pe.md)
- Prior task [0634](0634_history-board-timeline-tab-rebuild-conversation-skeleton-con.md)
- Non-UI Surface Design [`docs/04_DESIGN.md`](../04_DESIGN.md)
### History
- 2026-08-23T14:00:01.693Z todo → wip (system)
- 2026-08-23T14:06:56.532Z wip → testing (system)
- 2026-08-23T14:07:01.025Z testing → done (system)
