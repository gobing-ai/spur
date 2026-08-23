---
schema_version: 1
name: "History Board Timeline Tab: Compact Antigravity-CLI stream, per-card Sources AgentIcon, as-is tool telemetry tooltips, USER prompt cards, and conversation item filters"
status: done
template: feature-impl
created_at: 2026-08-23T06:38:10.533Z
updated_at: "2026-08-23T14:24:05.277Z"
feature_id: E8
---

## 0635. History Board Timeline Tab: Compact Antigravity-CLI stream, per-card Sources AgentIcon, as-is tool telemetry tooltips, USER prompt cards, and conversation item filters

### Background
The Spur History Board Timeline tab was rebuilt in task 0634 into a conversation skeleton with an ordered 9-field metadata bar and a continuous vertical rail. However, rendering multi-line operation cards (~68 px collapsed) alongside standalone assistant block header pills creates excessive vertical scroll height during multi-turn agent execution loops.

To achieve visual and density parity with Antigravity-CLI's compact transcript output, this task refines the Timeline tab into a dense, scan-friendly single-line stream:
1. Renames the panel header from `Conversation skeleton` to `Conversation` and adds item-filtering checkboxes (`Hide assistant`, `Hide unknown`, `Hide empty`, all unchecked by default).
2. Flattens the stream by eliminating standalone assistant block header pills and embedding the dedicated 9-agent `AgentIcon` (from the Sources tab) directly onto each operation card with an accessible hover/focus metadata tooltip (Agent, Model, Timestamp).
3. Displays tool names as-is in lowercase/original monospace (e.g. `glob`, `grep`, `edit`, `read`, `write`, `bash`, `search`, `run`) rather than uppercase transformed badges, moving token breakdown telemetry (`fresh input`, `cache read`, `output`, `total`) into an interactive hover/focus tooltip on the tool tag.
4. Moves execution result tags (`EXIT_CODE=0` / `EXIT_CODE=N`) into the first line, right-aligned directly before the `›` disclosure chevron, eliminating the separate second line in collapsed state for true single-line compactness (~38 px).
5. Standardizes user prompt cards into matching full-width single-line cards featuring a clean user vector icon, `USER` badge, prompt summary, character count, and expandable verbatim prompt drawer.
### Requirements
- **R1 (Header & Item Filtering):** Rename the panel header from `Conversation skeleton` to `Conversation`. Add three filter checkboxes on the same line after `Expand all / Collapse all`: `Hide assistant` (filters out assistant events with `ev.kind === 'assistant'` or non-tool `run` events), `Hide unknown` (filters out events where `ev.kind === 'unknown'` or `ev.agent === 'unknown'`), and `Hide empty` (filters out events with empty payload, 0 duration, and 0 tokens). All checkboxes must be unchecked by default, and blocks with all events filtered out must be omitted.
- **R2 (Embedded Agent Vector Icon & Telemetry Tooltip):** Eliminate standalone assistant block headers across the chronological stream. Render the dedicated 9-agent `AgentIcon` (`claude`, `codex`, `agy`, `omp`, `openclaw`, `hermes`, `grok`, `opencode`, `pi`) at the start of each operation card. Expose an accessible hover/focus tooltip popover on the agent icon displaying Agent name, Model name, and Timestamp (`fmtUtcClock`). Support keyboard focus, blur, and Escape dismissal.
- **R3 (As-Is Tool Naming & Token Breakdown Tooltip):** Render tool name tags as-is without uppercase conversion (e.g. `glob`, `grep`, `edit`, `read`, `write`, `bash`, `search`, `run`). Expose an interactive hover/focus tooltip popover on the tool tag displaying fresh input (`📥`), cache read (`💾`), output (`📤`), and total token load (`⚡`).
- **R4 (Compact Single-Line Operation Card & Right-Aligned Result):** Format each collapsed operation card as a single-line flex row (`[AgentIcon] [ToolTag] [Title] ... [EXIT_CODE=N] [›]`). Right-align execution result badges (`EXIT_CODE=0` in emerald, `EXIT_CODE=N` in rose) directly before the `›` disclosure chevron. Eliminate the separate second line in collapsed state. Retain click-to-expand behavior for the verbatim dark monospace payload drawer (`#0d141f`).
- **R5 (Unified User Prompt Cards):** Align user prompt cards to full right-column width matching tool cards. Render a clean user vector icon (`<UserIcon />`), `USER` badge, first-line summary, character count chip, and `›` chevron on a single line. Retain click-to-expand behavior for verbatim prompt text in dark monospace drawer.
- **R6 (Responsive Geometry & Left Gutter Telemetry):** Maintain 136 px left gutter on desktop (>=640 px) displaying timestamp (`HH:MM:SS`) and step duration (`⏱ ...`) with hot-amber threshold (>=5s). Center nodes on the continuous vertical rail (cyan for user prompts, category-colored for operations).
- **R7 (Pure Token Accounting & Zero Currency Guard):** Retain pure token accounting (`fresh + cache + output`) and cache-read ratio formulas without introducing any dollar (`$`), `USD`, or cost conversions.
- **R8 (Quality Gate & Component Test Coverage):** Add comprehensive unit tests in `components.test.tsx` verifying the `Conversation` header, filter toggles, embedded `AgentIcon` tooltips, as-is tool tags with token breakdown tooltips, right-aligned exit codes, and `USER` prompt cards. Pass all monorepo gates (`bun run autofix && bun run spur-check`, `bun run test-cf`, `bun run build`, `bun run corpus-check`).
### Acceptance Criteria
```gherkin
Feature: History Board Timeline Compact Antigravity-CLI Stream

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

#### 1. Header Toolbar with Filter Checkboxes
- Header title changed to `Conversation`.
- Inline filter checkboxes placed right after `Expand all / Collapse all`:
  - `Hide assistant`: suppresses non-tool assistant blocks and `kind === 'assistant' | 'run'` events.
  - `Hide unknown`: suppresses events with unknown kinds or agent ids.
  - `Hide empty`: suppresses empty prompt/operation rows with 0 duration and 0 tokens.

#### 2. Compact Single-Line Operation Card
- Left gutter (136 px): `fmtUtcClock(block.timestamp)` + duration indicator with amber threshold (`ev.durationMs >= 5000`).
- Card content (single line, ~38 px height):
  - `AgentBadge`: `<AgentIcon id={ev.agent || block.source} />` with hover/focus popover showing Agent, Model, and Timestamp.
  - `ToolTokenBadge`: As-is tool name in lowercase monospace with hover/focus popover showing `fresh`, `cache`, `output`, and `total` tokens.
  - Title: Monospace summary string truncated in center.
  - Result: `EXIT_CODE=0` (emerald) or `EXIT_CODE=N` (rose) badge right-aligned.
  - Chevron: `›` toggle button with `min-h-[44px]` touch target, rotating 90° on expansion.
- Drawer: Verbatim monospace `#0d141f` drawer rendered below single line when expanded.

#### 3. Standardized User Prompt Card
- Left gutter (136 px): `fmtUtcClock(block.timestamp)` + input token badge (`📥 {tokens} in`).
- Card content:
  - User icon (`<UserIcon />` SVG) + `USER` badge.
  - Truncated prompt summary line.
  - Character count chip (`{N} chars`).
  - Chevron `›` toggle button expanding verbatim `#0d141f` prompt drawer.
### Plan
- [x] Update `TimelineTab.tsx` header title to `Conversation` and add filter checkboxes for `Hide assistant`, `Hide unknown`, and `Hide empty` (R1).
- [x] Add `AgentBadge` component embedding the dedicated 9-agent `AgentIcon` (from Sources tab) with hover/focus metadata tooltip displaying agent, model, and timestamp (R2).
- [x] Add `ToolTokenBadge` displaying tool name as-is in lowercase monospace with hover/focus token breakdown tooltip displaying fresh, cache, output, and total tokens (R3).
- [x] Refactor operation cards into compact single-line flex rows with right-aligned `EXIT_CODE` badge and chevron toggle; eliminate standalone assistant block header pills and the second metadata line in collapsed state (R4, R6).
- [x] Update user prompt cards with `<UserIcon />`, `USER` badge, first-line summary, character count chip, full right-column width, and expandable payload drawer (R5).
- [x] Update and extend component tests in `components.test.tsx` asserting `Conversation` title, filter checkbox toggles, embedded `AgentIcon` tooltips, as-is tool badges with token tooltips, right-aligned exit codes, and `USER` prompt cards (R8).
- [x] Synchronize satellite documentation in `docs/design/history-board-module.md` and `docs/04_DESIGN.md` (R8).
- [x] Run full quality gate (`bun run autofix && bun run spur-check`), Cloudflare worker test (`bun run test-cf`), build (`bun run build`), and corpus check (`bun run corpus-check`) (R7, R8).
### Solution
Curated change-map — one row per changed file, anchored at the primary symbol each change implements.

| Change | Anchor |
|--------|--------|
| `TimelineTab` — renamed panel header to Conversation, added filter checkboxes (Hide assistant, Hide unknown, Hide empty), integrated dedicated Sources `AgentIcon` vector badge with metadata tooltip popover, as-is tool tag with token breakdown tooltip popover, single-line operation cards with right-aligned exit code badges, and `<UserIcon />` prompt cards | `apps/web/src/modules/history/TimelineTab.tsx:309` |
| Component test suite asserting Conversation panel header, filter checkboxes, embedded AgentIcon tooltip, as-is tool badge tooltip, right-aligned exit codes, and UserTokenBadge prompt card | `apps/web/tests/modules/history/components.test.tsx:365` |
| Synchronized Timeline specification and task mapping in History Board design satellite | `docs/design/history-board-module.md:10` |
| Synchronized History Board satellite reference in 04_DESIGN.md | `docs/04_DESIGN.md:66` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/history/TimelineTab.tsx:479` renames the panel header to `Conversation` and adds filter checkboxes for `Hide assistant`, `Hide unknown`, and `Hide empty`. Component tests verify panel header and filter checkbox rendering. |
| R2 | MET | `apps/web/src/modules/history/TimelineTab.tsx:225` embeds the dedicated `AgentIcon` vector badge with hover/focus metadata popover (Agent name, Model name, UTC timestamp) and Escape key dismissal on each operation card. Component tests verify tooltip attributes, contents, and interactions. |
| R3 | MET | `apps/web/tests/modules/history/components.test.tsx:629` tests that tool names render as-is in lowercase monospace (glob, grep, edit, read, write, bash, search, run) and embeds hover/focus token breakdown tooltip (📥 fresh, 💾 cache, 📤 output, ⚡ total). |
| R4 | MET | `apps/web/src/modules/history/TimelineTab.tsx:736` formats operation cards into single-line flex rows (~38px) with right-aligned `EXIT_CODE=0` / `EXIT_CODE=N` badges directly before the `›` chevron and verbatim payload drawers. Component tests verify layout and payload expansion. |
| R5 | MET | `apps/web/src/modules/history/TimelineTab.tsx:130` replaces multi-line bubbles with `<UserIcon />` prompt cards, character count badges, and expandable drawers. Component tests verify prompt drawer expansion. |
| R6 | MET | `apps/web/tests/modules/history/components.test.tsx:365` has 15 passing tests covering panel header, filters, AgentIcon tooltips, tool token badges, exit code badges, and prompt cards. |
| R7 | MET | `docs/design/history-board-module.md:10` is synchronized with task 0635 specifications and full quality gates pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Timeline tab inspects session execution with Agent and Model tags | MET | test | `bun test apps/web/tests/modules/history/components.test.tsx` exited 0: 15 pass, 186 assertions. `bun run spur-check` exited 0: 6233 pass; `bun run test-cf` and `bun run build` exited 0. Static review at `apps/web/src/modules/history/TimelineTab.tsx:309` confirms no contract/service/database/dependency surface was added. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence in `components.test.tsx`. |
| P4 | security-xss | `TimelineTab.tsx` | No raw HTML injection or dangerouslySetInnerHTML; pure text and inline SVG glyphs. |
| P4 | accessibility | `TimelineTab.tsx` | Full role="tooltip", aria-describedby, focus/blur/Escape handling, and min 44px touch targets. |
### References
- Feature [E8](../../features/E8_history-board-module-analytics-summary-execution-timeline-sessions-forensic-insights-and-agent-sources-registry.md)
- History Board Design Satellite [`docs/design/history-board-module.md`](../design/history-board-module.md)
- Prior task [0634](0634_history-board-timeline-tab-rebuild-conversation-skeleton-con.md)
- System Architecture [`docs/03_ARCHITECTURE.md`](../03_ARCHITECTURE.md)
- Non-UI Surface Design [`docs/04_DESIGN.md`](../04_DESIGN.md)
### History
- 2026-08-23T06:39:55.414Z todo → wip (system)
- 2026-08-23T06:44:51.680Z wip → testing (system)
- 2026-08-23T06:45:54.490Z testing → done (system)
