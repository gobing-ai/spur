---
schema_version: 1
id: "A821"
name: "A2A cooperation sequence view: filtered agent dialog with tooltip detail"
status: backlog
priority: P2
tags: []
created_at: "2026-11-25T23:51:52.607Z"
updated_at: "2026-11-25T23:52:40.596Z"
---

# A821: A2A cooperation sequence view: filtered agent dialog with tooltip detail

## Goal

Make agent cooperation visible at a glance in Integrations › A2A: the tab leads with a filterable, time-ordered sequence view of who sent what to whom (local fleet members, inbound A2A callers, outbound peers), while Agent Card, credential, receipt and message details move into accessible pinnable tooltips so the default view stays clean without losing any capability.

## Scope

**In scope**
- Sequence view as the A2A tab's primary surface: one lifeline per agent, one arrow per message/request in time order, grouped by thread and reply.
- Filters: agent, direction, kind, status, thread, time range; compact (≤639 px) fallback as a stacked list.
- Additive project-scoped, filterable, keyset-paged inbox read (contract + server + DAO); existing `inbox.list` unchanged.
- Lifeline-header tooltip: Agent Card summary (name, description, skills, endpoint, auth), credential env name and set/unset; raw card JSON in pinned/expanded detail.
- Arrow tooltip: message excerpt, status timeline, request key, run/trace link, remote task/context refs.
- Extract the DESIGN.md pinnable semantic tooltip (hover + focus open, pin to copy, Escape closes) from System Events into a shared component and reuse it.
- Existing configuration panels (member cards, CLI examples, receipts) collapse into a drawer rather than being removed.
- Live updates from existing `message.*` frames.
- Owner doc updates: `docs/design/integrations-module.md`, DESIGN.md (tooltip component), inbox contract satellite.

**Out of scope**
- Stitching the remote peer's internal dialog into the sequence (follow-up T).
- Composing, replying or marking read from the sequence view (Projects › Inbox stays the action surface).
- New persistence or schema changes to `inbox_messages`.
- Changes to A2A transport, auth, or Agent Card generation.

## Acceptance Criteria

```gherkin
Feature: A2A cooperation sequence view: filtered agent dialog with tooltip detail

  @core
  Scenario: R1 — A2A tab leads with a sequence view of agent cooperation
    # covers: I1
    Given the project has inbox messages between fleet members, an inbound A2A caller and an outbound peer
    When an operator opens Integrations › A2A
    Then the primary content is a sequence view with one lifeline per participating agent
    And each message or request renders as an arrow from sender to receiver in time order
    And replies are drawn under their thread with the inReplyTo link visible

  @core
  Scenario: R2 — Project-scoped inbox read serves the sequence view
    # covers: I6
    Given messages exist for several members of the project
    When a client calls the project-scoped inbox read with no member filter
    Then it returns messages across all members ordered by time with a keyset cursor and a page limit
    And it accepts optional member, direction, kind, status, thread and time-range filters
    And the existing per-member inbox.list contract and response are unchanged

  @core
  Scenario: R3 — Filters narrow the sequence view
    # covers: I2
    Given the sequence view shows messages among at least three agents
    When the operator filters by agent, direction, kind, status, thread or time range
    Then only matching arrows and their lifelines remain
    And the active filters are reflected in the URL so the view can be shared and restored
    And clearing filters restores the full view

  @core
  Scenario: R4 — Agent lifeline tooltip shows the Agent Card summary
    # covers: I3, I7
    Given an agent lifeline header in the sequence view
    When the operator hovers it or moves keyboard focus to it
    Then a semantic tooltip shows the card name, description, skills, endpoint and auth scheme
    And for an outbound peer it shows the credential env name and whether it is set, never its value
    And pinning the tooltip makes it selectable and reveals the raw Agent Card JSON
    And Escape or outside activation closes it

  @core
  Scenario: R5 — Message arrow tooltip shows message detail
    # covers: I4, I7
    Given a message arrow in the sequence view
    When the operator hovers or focuses it
    Then a semantic tooltip shows the body excerpt, kind, status timeline (queued, delivered, read) and request key
    And it links the run to its trace and shows remote task and context refs when present

  @core
  Scenario: R6 — Pinnable semantic tooltip is a shared component
    # covers: I7
    Given the System Events tab and the A2A sequence view
    When both render a pinnable semantic tooltip
    Then they use the same shared tooltip component with hover, focus, pin, Escape and outside-close behavior
    And the System Events tooltip behavior is unchanged

  @core
  Scenario: R7 — Configuration detail stays reachable but out of the default view
    # covers: I5
    Given the A2A tab with configured members and outbound peers
    When the operator opens the tab
    Then member cards, CLI examples and receipt lists are not expanded in the default view
    And a configuration drawer exposes all of them without loss of capability

  @core
  Scenario: R8 — Sequence view updates live
    # covers: I8
    Given the sequence view is open
    When a new message.sent or message.read frame arrives for the project
    Then the matching arrow appears or its status updates without a manual reload

  @edge
  Scenario: R9 — Compact layout falls back to a stacked list
    # covers: I1, I2
    Given a viewport of 639 px or narrower
    When the operator opens Integrations › A2A
    Then messages render as a stacked time-ordered list showing sender → receiver
    And filters and tooltips remain available

  @edge
  Scenario: R10 — Empty and degraded states are explicit
    # covers: I1, I3
    Given a project with no A2A or inbox traffic, or an Agent Card that fails to load
    When the operator views the sequence or a lifeline tooltip
    Then the sequence shows an empty state naming how to send a first message
    And the tooltip shows a card-unavailable diagnostic instead of failing silently
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1452 | Add project-scoped inbox.timeline read for the A2A sequence view | todo |
| 1453 | Extract the System Events pinned tooltip into a shared PinnableTooltip | todo |
| 1454 | Render the A2A cooperation sequence view with filters, tooltips and config drawer | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
