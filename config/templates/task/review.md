---
schema_version: 1
name: "{{ NAME }}"
description: ""
status: backlog
type: review
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
ac_numbering: task-local
created_at: "{{ CREATED_AT }}"
updated_at: "{{ CREATED_AT }}"
---

## {{ WBS }}. {{ NAME }}

### Background

{{ BACKGROUND }}

#### Review Findings

The code-review findings this task must address — logged here as **input** (what was found
in the reviewed PR/commit/diff). Fix in priority order (P1 → P2 → …); re-review after.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1       |      |         |                |
| P2       |      |         |                |

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Fill after triage/refinement from the findings. -->

### Acceptance Criteria

<!-- `- [ ] R1 — <exact feature scenario title>` bullets, or `Scenario:` blocks titled verbatim from the linked feature AC; task-only checks go in prose below, or set `ac_altitude: task-local`. Keep empty until the review task becomes executable work. -->

### Q&A

<!-- Clarifications, false positives, accepted risk, and triage decisions. -->

### Design

<!-- Fix approach and tradeoffs if the findings require design judgment. -->

### Plan

- [ ] Fix P1 findings
- [ ] Fix P2 findings
- [ ] Fix all the remaining findings if any
- [ ] Re-review the changed code

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

Post-implementation reflection — filled **after** the first fix round: what went wrong, what
remains to fix before closing, and any **back-issues** (new findings surfaced by the fix).

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1       |      |         |                |
| P2       |      |         |                |

### References

<!-- Links to source review, dogfood report, PR/diff, related tasks, or external references. -->

### History
