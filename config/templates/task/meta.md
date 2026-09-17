---
schema_version: 1
name: "{{ NAME }}"
description: ""
status: backlog
type: meta
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "{{ CREATED_AT }}"
updated_at: "{{ CREATED_AT }}"
---

## {{ WBS }}. {{ NAME }}

### Background

{{ BACKGROUND }}

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty if not applicable. -->

### Acceptance Criteria

<!-- `- [ ] R1 — <exact feature scenario title>` bullets, or `Scenario:` blocks titled verbatim from the linked feature AC; task-only checks go in prose below, or set `ac_altitude: task-local`. Keep empty if not applicable. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Approach and tradeoffs for process/docs/config changes. Keep this short. -->

### Plan

<!-- Ordered checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
