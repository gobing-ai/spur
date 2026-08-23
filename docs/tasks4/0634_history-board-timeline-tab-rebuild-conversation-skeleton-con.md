---
schema_version: 1
name: "History Board Timeline Tab: Rebuild conversation skeleton, continuous timeline rail, and chat execution flow to match prototype"
status: todo
template: feature-impl
created_at: 2026-08-23T04:52:47.905Z
updated_at: "2026-08-23T04:53:46.003Z"
feature_id: E8
---

## 0634. History Board Timeline Tab: Rebuild conversation skeleton, continuous timeline rail, and chat execution flow to match prototype

### Background
During visual and functional verification of the History Board module (`/board/history`), a significant implementation drift was identified in the **Timeline** tabview between the original design prototype (`docs/design/prototypes/spur-board-history.html`, `history-app.js`, `docs/design/prototypes/review-artifacts/proto-timeline.png`, `proto-timeline-expanded.png`) and the current live implementation in `apps/web/src/modules/history/TimelineTab.tsx` (captured in `live-timeline.png`).

#### Identified Architecture & Visual Gaps:
1. **Container & Header Navigation Disconnect:**
   - *Prototype:* Features a cohesive `Conversation skeleton` header with a streamlined right-aligned control group: a custom-styled pill session combobox (`id… · Agent · Date · Tokens`), compact previous/next stepper buttons (`[ ← ]` `[ → ]`), and a global `[ Expand all ]` / `[ Collapse all ]` toggle.
   - *Current Implementation:* Wraps controls in a clunky "SELECT SESSION" box with disjointed dropdowns, raw labels, and fragmented buttons.

2. **Session Metadata Bar:**
   - *Prototype:* Displays a high-density, 8-field horizontal metadata strip with subtle muted labels and bold values: `SESSION` (tail-truncated `1b4bdef8…fdc4`), `AGENT` (pill with colored indicator dot `• OMP`), `MODEL` (pill with model family dot `• claude-sonnet-4.6`), `STARTED`, `DURATION`, `TOTAL TOKENS`, `CACHE READ` (accented cyan `%`), `OUTPUT TOKENS`, and `TOOL CALLS`.
   - *Current Implementation:* Broken into an asymmetrical 6-column grid with generic text labels and missing agent/model status badges.

3. **Loss of the Continuous Vertical Timeline Rail (Execution Flow):**
   - *Prototype:* Features a single, continuous vertical thread line running down the entire conversation. Each step is anchored to this rail with colored node dots (`tl-node`, `tl-block-node`) representing the event kind. On the left side of the rail (~130px fixed column), each step displays execution micro-metrics: timestamp/clock pill (`16:49:53`), duration row (`⏱ 485ms` + spark progress bar `█`), and token load row (`⚡ 298.5K` + spark progress bar `█`). Hovering or focusing on the left telemetry cell reveals a comprehensive floating popover badge showing complete step metrics (Action, Agent, Model, Latency, Total Tokens, Fresh Input, Cache Read, Output Tokens).
   - *Current Implementation:* Completely abandoned the vertical timeline rail in favor of disconnected, bulky rectangular card blocks (`Turn #2`, `Turn #3`) with large text rows (`Duration: ... Tokens: ... Fresh: ... Cache: ...`) that destroy the feeling of a chronological execution stream.

4. **Chat-Mode User Prompt Bubbles:**
   - *Prototype:* User turns are rendered as elegant chat prompt bubbles along the timeline rail, featuring a `[ PROMPT ]` badge, user prompt summary, metadata chips (`📥 38.6K input tokens  71 characters`), and an expandable payload drawer.
   - *Current Implementation:* Clumsy right-aligned prompt bubble that looks detached from the execution thread.

5. **Assistant Turn Block Headers:**
   - *Prototype:* Compact, single-line horizontal header attached to the timeline thread: timestamp (`16:50:12`), timeline node dot, and a consolidated pill containing the Agent icon & name (`[ ▷ OMP ]`), Model badge (`• claude-sonnet-4.6`), and block summary (`8 operations · ⏱ 59.4s · ⚡ 2.8M`).
   - *Current Implementation:* Heavyweight banner bar repeating bulky badges and text across multiple lines.

6. **Tool Step Execution Cards & Terminal Output:**
   - *Prototype:* High-density interactive cards with colored left accent borders matching tool categories (`[ READ ]` green, `[ RUN ]` amber, `[ GREP ]` purple, `[ BASH ]` blue, `[ WRITE ]` red, `[ EDIT ]` yellow), monospace target/command title, token breakdown chips (`📥 39.3K in`, `💾 254.2K cache`, `📤 5.0K out`), exit code badges (`[ EXIT_CODE=0 ] 0 errors`), and chevron indicator `›`. Clicking or expanding reveals a dark code container (`bg-[#0d141f]` / terminal view) formatted with monospace output.
   - *Current Implementation:* Generic cards with flat `#1 READ` tags and a standard `Details` toggle button.

This task completely rebuilds `TimelineTab.tsx` and its supporting timeline components to achieve 1:1 parity with the design prototype while preserving theme adaptability (Dark/Light mode) and pure-token accounting.
### Requirements
- **R1 (Conversation Skeleton Header & Navigation Toolbar):**
  - **R1.1:** Render the top card header with the exact title `Conversation skeleton` on the left.
  - **R1.2:** Implement a unified right-side control toolbar containing:
    - Custom styled session selector combobox/dropdown displaying `id… · Agent · Date · Tokens` (e.g. `1b4bdef8… · OMP · Aug 21 16:49 · 7.7M`).
    - Sequential stepper buttons `[ ← ]` (Previous) and `[ → ]` (Next) bound to the filtered session roster order, with disabled states at boundaries.
    - Global toggle button `[ Expand all ]` / `[ Collapse all ]` that toggles all event accordions across all turns in the session.

- **R2 (8-Column Session Metadata Strip):**
  - **R2.1:** Render a high-density 8-field horizontal metadata strip below the header with subtle uppercase/muted labels (`.k`) and clear values (`.v`):
    - `SESSION`: Tail-truncated session ID with hover tooltip (`1b4bdef8…fdc4`).
    - `AGENT`: Pill badge with agent brand color dot (e.g. `• OMP`, `• Claude Code`).
    - `MODEL`: Model pill badge with family brand dot (e.g. `• claude-sonnet-4.6`).
    - `STARTED`: Formatted start timestamp (e.g. `Aug 21 16:49`).
    - `DURATION`: Formatted duration (e.g. `13m` / `45s`).
    - `TOTAL TOKENS`: Formatted token count (e.g. `7.7M`).
    - `CACHE READ`: Formatted cache hit ratio highlighted in cyan `#22d3ee` (e.g. `89.0%`).
    - `OUTPUT TOKENS`: Formatted output tokens (e.g. `16.3K`).
    - `TOOL CALLS`: Integer count of tool executions (e.g. `21`).

- **R3 (Continuous Vertical Timeline Rail & Step Micro-Metrics):**
  - **R3.1:** Render a continuous vertical timeline rail line running through the entire chronological flow of the session.
  - **R3.2:** Anchor every step (user prompt, assistant block, tool execution) to the rail line with a distinct color-coded node dot (`tl-node`, `tl-block-node`).
  - **R3.3:** Render the left-side telemetry cell (`~130px` width) for every step:
    - For User Prompts: Time clock pill (`16:49:53`) + Input tokens chip (`📥 38.6K in`).
    - For Tool Steps:
      - Latency metric row: `⏱ 485ms` + inline duration micro spark bar `█` (turns amber/hot when `durMs >= 5000`).
      - Token load row: `⚡ 298.5K` + inline token micro spark bar `█` (turns cyan/heavy when `stepTok >= 50000`).
  - **R3.4:** Add an accessible, rich floating tooltip popover to the left telemetry cell (`data-tl-step-info`) that displays:
    - Step number header with Agent SVG icon (`Step #N Telemetry`).
    - Grid of metrics: `Action`, `Agent / Model`, `Latency Cost` (amber), `Total Tokens` (cyan), `Fresh Input`, `Cache Read` (cyan), `Output Tokens`.

- **R4 (Chat-Mode User Prompt Bubbles):**
  - **R4.1:** Render user prompt events as chat bubble cards (`.tl-body.user`) connected to the timeline rail.
  - **R4.2:** Include a dark badge `[ PROMPT ]`, the prompt summary text, and a rotating chevron `›`.
  - **R4.3:** Display prompt metadata chips: `📥 38.6K input tokens` and `N characters`.
  - **R4.4:** Clicking the card or using `Expand all` opens the expandable prompt payload drawer displaying full formatted prompt text.

- **R5 (Assistant Turn Block Headers):**
  - **R5.1:** Group consecutive assistant tool operations under a clean, single-line horizontal block header (`tl-block-hdr`).
  - **R5.2:** Include the turn start timestamp (`16:50:12`), timeline node dot, and a consolidated pill badge container.
  - **R5.3:** Display inside the pill:
    - Agent chip with vector SVG icon and brand color (`[ ▷ OMP ]`).
    - Model chip with brand dot (`• claude-sonnet-4.6`).
    - Summary text: `N operations · ⏱ {totalDuration} · ⚡ {totalTokens}`.

- **R6 (Tool Execution Step Cards & Payloads):**
  - **R6.1:** Render tool operations as sleek dark cards (`.evt.${kind}`) with colored left accent borders matching tool categories:
    - `READ` (emerald `#10b981`), `RUN` (amber `#f59e0b`), `GREP` (purple `#a855f7`), `BASH` (blue `#3b82f6`), `WRITE` (rose `#f43f5e`), `EDIT` (yellow `#eab308`), `GLOB` (indigo `#6366f1`).
  - **R6.2:** Card header displays tool kind badge (`[ READ ]`), target path / command in clean monospace font, and rotating expand chevron `›`.
  - **R6.3:** Card meta row displays:
    - Exit code chip when applicable: `[ EXIT_CODE=0 ] 0 errors` (green) or `[ EXIT_CODE=N ]` (red).
    - Token chips: `📥 {tokIn} in`, `💾 {cache} cache` (cyan), `📤 {tokOut} out`.
  - **R6.4:** Expandable payload drawer (`.tl-detail`) renders code snippets, command stdout/stderr, or file contents in a dark terminal container (`bg-[#0d141f]` / `base-300`) with horizontal scrolling and monospace styling.

- **R7 (Interactive State, Accessibility, & Theme Parity):**
  - **R7.1:** Maintain full keyboard navigation (`Enter` / `Space` to toggle cards, `Escape` to close tooltips).
  - **R7.2:** Ensure seamless light and dark theme compatibility using DaisyUI base tokens with high-contrast borders and data visualization accents.
  - **R7.3:** Retain pure-token accounting (zero cost/dollar fields).
### Acceptance Criteria
#### Scenario 1: Conversation Skeleton Header and Session Traversal (R1, R2)
- **GIVEN** the Timeline tab is rendered at `/board/history`
- **WHEN** the session loads
- **THEN** the top card header displays the title `Conversation skeleton`
- **AND** the right-side toolbar contains a styled session dropdown, `[ ← ]` Previous, `[ → ]` Next stepper buttons, and `[ Expand all ]` / `[ Collapse all ]`
- **AND** the metadata bar displays all 8 fields (`SESSION`, `AGENT`, `MODEL`, `STARTED`, `DURATION`, `TOTAL TOKENS`, `CACHE READ`, `OUTPUT TOKENS`, `TOOL CALLS`) with tail-truncation on the session ID.

#### Scenario 2: Continuous Timeline Rail and Node Alignment (R3.1, R3.2)
- **GIVEN** a session containing multiple user prompts and assistant tool turns
- **WHEN** the timeline stream is rendered
- **THEN** a single vertical timeline rail line runs continuously down the left side of the conversation
- **AND** every user prompt, assistant turn header, and tool execution step is anchored with a color-coded node dot along the rail.

#### Scenario 3: Step Micro-Metrics and Rich Telemetry Tooltip (R3.3, R3.4)
- **GIVEN** tool execution steps in the timeline
- **WHEN** viewing the left-side telemetry cell
- **THEN** it displays the latency row (`⏱ {duration}`) with an inline duration progress bar and the token load row (`⚡ {tokens}`) with an inline token progress bar
- **AND** hovering or focusing the telemetry cell renders a floating popover displaying the full breakdown: `Action`, `Agent / Model`, `Latency Cost`, `Total Tokens`, `Fresh Input`, `Cache Read`, `Output Tokens`.

#### Scenario 4: Chat-Mode User Prompts (R4)
- **GIVEN** a user message event in the session
- **WHEN** rendered on the timeline
- **THEN** it displays as a chat prompt bubble with a dark `[ PROMPT ]` badge, user input summary text, and input token metrics
- **AND** clicking the prompt card expands the full prompt text.

#### Scenario 5: Assistant Block Header Grouping (R5)
- **GIVEN** consecutive assistant tool execution steps within a turn
- **WHEN** the block header renders
- **THEN** it displays a single-line horizontal header with timestamp, timeline node, and a pill containing the Agent icon, Model badge, operation count, total block duration, and total block tokens.

#### Scenario 6: Tool Execution Step Cards and Terminal Payloads (R6)
- **GIVEN** a tool call event (e.g. `read`, `run`, `bash`, `grep`)
- **WHEN** rendered on the timeline
- **THEN** it appears as a card with a category-colored left accent border, tool kind badge (`[ READ ]`, `[ RUN ]`, etc.), monospace target path/command, exit code badge, and token chips
- **AND** clicking the card or clicking `Expand all` opens a dark terminal-styled drawer showing the full payload output.

#### Scenario 7: Global Expand All and Stepper Boundary Discipline (R1.2, R7.1)
- **GIVEN** a session with multiple collapsed events
- **WHEN** clicking `Expand all`
- **THEN** all user prompts and tool detail drawers expand simultaneously, and the button changes to `Collapse all`
- **AND** `[ ← ]` is disabled on the first session in the roster, and `[ → ]` is disabled on the last session.
### Q&A
**Q: Why was the timeline previously drifting from the prototype?**
A: Initial implementation in task 0626 converted the timeline into discrete, turn-based rectangular card containers (`Turn #N` cards) rather than a single unified execution stream. This fractured the continuous vertical rail line, distorted the visual hierarchy of user prompts versus tool execution blocks, and dropped the high-density micro-metrics on the left rail.

**Q: How do we construct the continuous vertical rail line in CSS/React?**
A: Using a dedicated relative timeline track layout: the parent stream container hosts an absolute vertical line (`before:absolute before:top-0 before:bottom-0 before:left-[140px] before:w-[2px] before:bg-base-content/10`), where each timeline row aligns its node dot (`relative z-10 w-2.5 h-2.5 rounded-full border-2`) exactly over the line, with the left cell holding micro-metrics and the right cell holding the event card.

**Q: Does this change any backend APIs or database schemas?**
A: No. The backend oRPC endpoint `getTimeline` and contract `HistoryTimelineResponse` already supply `session`, `blocks`, `turnIndex`, `events` with `kind`, `title`, `durationMs`, `tokens`, `freshInputTokens`, `cacheReadTokens`, `outputTokens`, `exitCode`, and `payload`. This task is purely a frontend presentation and component architecture rebuild in `apps/web/src/modules/history/`.

**Q: How is Dark and Light theme switching handled?**
A: Structural surfaces use Tailwind/DaisyUI semantic tokens (`bg-base-200/50`, `border-base-content/10`, `text-base-content`, `bg-base-100`). Terminal payload drawers use a dark monospace theme (`bg-[#0d141f]` or `bg-base-300`) with high-contrast text to replicate a real terminal experience across both dark and light modes.

**Q: Are there any dollar/cost fields?**
A: No. Strictly pure-token accounting (`billedTokens`, `cacheSavedTokens`, `freshInputTokens`, `outputTokens`), execution counts, and duration metrics.
### Design
The rebuild is contained entirely within `apps/web/src/modules/history/`:

```text
apps/web/src/modules/history/
├── TimelineTab.tsx           # Rebuilt: Conversation skeleton, metadata strip, continuous vertical rail, user prompts, assistant blocks, tool cards
├── AgentIcon.tsx             # Vector SVGs for coding agents
├── charts.tsx                # Formatting helpers (fmtTok, fmtDur, fmtMs, fmtInt, SparkBar)
└── HistoryShell.tsx          # Session navigation router
```

#### Component Architecture:

1. **`TimelineTab` Root Container:**
   - **`ConversationSkeletonCard`:**
     - Title: `Conversation skeleton`
     - Right Toolbar: Styled Select + Steppers + Expand/Collapse button.
     - 8-Field Metadata Bar: Tail-truncated Session ID, Agent badge, Model badge, Started, Duration, Total Tokens, Cache Read %, Output Tokens, Tool Calls.
   - **`TimelineStream`:**
     - Continuous vertical rail line (`left: 140px` or responsive rail).
     - Renders flat list of chronological items (`UserRow` | `AssistantBlock`).

2. **`TimelineUserRow`:**
   - Left cell: Timestamp (`fmtClock`) + Input tokens chip (`📥 X in`).
   - Center node: Violet/Primary colored dot on the vertical rail.
   - Right body: Chat prompt card with `[ PROMPT ]` badge, summary text, input tokens count, and expandable full payload.

3. **`TimelineAssistantBlock`:**
   - **`BlockHeader`:**
     - Timestamp + Center node dot + Consolidated pill: Agent SVG icon + Model brand dot + Operations count · Duration · Total Tokens.
   - **`ToolRow` (for each tool event in the block):**
     - Left cell (`StepTelemetryCell`):
       - Duration row (`⏱ {duration}`) + duration micro sparkbar (amber if `durationMs >= 5000`).
       - Token row (`⚡ {tokens}`) + token micro sparkbar (cyan if `tokens >= 50000`).
       - Hover popover: Full step telemetry breakdown.
     - Center node: Category-colored dot on the vertical rail.
     - Right body (`ToolEventCard`):
       - Category accent line (Emerald `read`, Amber `run`, Purple `grep`, Blue `bash`, Rose `write`, Yellow `edit`).
       - Tool kind badge + Monospace target path / command + Chevron.
       - Meta row: Exit code badge + Token chips (`in`, `cache`, `out`).
       - Expandable drawer: Dark terminal code block (`bg-[#0d141f]` / `base-300`).
### Plan
- [ ] **Phase 1 (Header & Metadata Strip Rebuild):** Rebuild the top `Conversation skeleton` container in `TimelineTab.tsx` with the styled session selector, previous/next stepper buttons, `Expand all` toggle, and the 8-field high-density metadata bar (R1, R2).
- [ ] **Phase 2 (Continuous Rail & Step Micro-Metrics):** Implement the continuous vertical timeline rail line and left telemetry cells with clock pills, duration sparkbars, token load sparkbars, and floating telemetry tooltips (R3).
- [ ] **Phase 3 (Chat-Mode User Prompts & Assistant Block Headers):** Rebuild user prompt chat bubble rows and single-line assistant block header pills with vector agent icons and model family badges (R4, R5).
- [ ] **Phase 4 (Tool Step Cards & Terminal Output Drawer):** Rebuild the tool execution cards with category-colored left accent borders, exit code badges, token chips, and expandable dark terminal drawers (R6).
- [ ] **Phase 5 (Verification & Test Suite):** Update unit tests in `apps/web/tests/modules/history/components.test.tsx` to assert new DOM structure, keyboard accessibility, expand/collapse toggles, and verify full quality gate (`bun run check`).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
