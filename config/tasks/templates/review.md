---
schema_version: 1
name: "{{ NAME }}"
description: ""
status: backlog
type: review
template: review
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
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

### Plan

- [ ] Fix P1 findings
- [ ] Fix P2 findings
- [ ] Fix all the remaining findings if any
- [ ] Re-review the changed code

### Review

Post-implementation reflection — filled **after** the first fix round: what went wrong, what
remains to fix before closing, and any **back-issues** (new findings surfaced by the fix).

### References

### History
