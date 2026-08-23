---
schema_version: 1
name: "History Board Timeline Tab: Compact Antigravity-CLI stream, per-card Sources AgentIcon, as-is tool telemetry tooltips, USER prompt cards, and conversation item filters"
status: done
template: feature-impl
created_at: 2026-08-23T06:38:10.533Z
updated_at: "2026-08-23T06:45:54.490Z"
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
- `apps/web/src/modules/history/TimelineTab.tsx:73-125`: Refactored `toolPresentation` to return as-is lowercase tool tags (`glob`, `grep`, `edit`, `read`, `write`, `bash`, `search`, `run`).
- `apps/web/src/modules/history/TimelineTab.tsx:127-143`: Added `<UserIcon />` SVG component for consistent prompt card headers.
- `apps/web/src/modules/history/TimelineTab.tsx:146-191`: Added `AgentBadge` component embedding the Sources-matching vector `AgentIcon` with accessible hover/focus metadata tooltip popover (Agent name, Model name, UTC timestamp) supporting Escape key dismissal.
- `apps/web/src/modules/history/TimelineTab.tsx:194-245`: Added `ToolTokenBadge` component displaying as-is lowercase tool name with interactive hover/focus token breakdown tooltip popover (`📥 fresh`, `💾 cache`, `📤 output`, `⚡ total`).
- `apps/web/src/modules/history/TimelineTab.tsx:310-335`: Added filter predicates for `Hide assistant` (`kind === 'assistant' | 'run'`), `Hide unknown` (`kind === 'unknown' | agent === 'unknown'`), and `Hide empty` (empty payload, 0 duration, 0 tokens), omitting empty blocks.
- `apps/web/src/modules/history/TimelineTab.tsx:350-390`: Renamed header title `Conversation skeleton` → `Conversation` and added inline filter checkboxes with pure Tailwind utility styling (`w-3.5 h-3.5 rounded border border-base-content/30 accent-primary`).
- `apps/web/src/modules/history/TimelineTab.tsx:550-590`: Standardized user prompt cards to full right-column width with `<UserIcon />`, `USER` badge, first-line prompt summary, character count, and expandable verbatim prompt drawer (`#0d141f`).
- `apps/web/src/modules/history/TimelineTab.tsx:670-684`: Rendered right-aligned `EXIT_CODE=0` / `EXIT_CODE=N` result badges directly before the `›` disclosure chevron on the single-line operation card.
- `apps/web/tests/modules/history/components.test.tsx:297-526`: Updated component test suite asserting `Conversation` title, filter checkboxes (`Hide assistant`, `Hide unknown`, `Hide empty`), embedded `AgentIcon` tooltip, as-is tool badges (`glob`, `grep`, `edit`, `run`) with token breakdown tooltips, right-aligned exit codes, and `USER` prompt cards.
- `docs/design/history-board-module.md:63-72`: Updated Section 3.2 Timeline specification and Section 5 Workstream Mapping to document task 0635 Antigravity-CLI compact stream.
- `docs/04_DESIGN.md:66`: Updated History Board satellite citation to include task 0635.
### Testing
- `bun test apps/web/tests/modules/history/components.test.tsx`:
  - 14 tests passing across 1 file, 134 expect() calls.
- `bun run autofix && bun run spur-check`:
  - Full comprehensive quality gate PASS across 6,232 unit/component tests in 340 files (24,052 expect() calls), with clean link-check, transition-shim-check, script-contract-check, Biome lint/format, typecheck, and rule checks.
- `bun run test-cf`:
  - Cloudflare Worker vitest test suite 1/1 PASS.
- `bun run build`:
  - Successfully built CLI, server worker, and static web bundle with zero errors.
- `bun run apps/cli/src/index.ts task check 0635`:
  - Task check structural validation PASS.
- Coverage: N/A (UI component test coverage via `apps/web/tests/modules/history/components.test.tsx`).
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
