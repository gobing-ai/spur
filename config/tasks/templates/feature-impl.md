---
schema_version: 1
name: "{{ NAME }}"
description: ""
status: backlog
type: task
profile: standard
feature_id: "{{ FEATURE_ID }}"
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "{{ CREATED_AT }}"
updated_at: "{{ CREATED_AT }}"
---

## {{ WBS }}. {{ NAME }}

### Background

{{ BACKGROUND }}

### Acceptance Criteria

```gherkin
Feature: {{ NAME }}

  Scenario: Basic acceptance
    Given a precondition
    When an action is taken
    Then an expected result occurs
```

- [ ] Acceptance checklist item

### Design

### Plan

- [ ] Implementation step

### Solution

### Testing

### Review

### References

### History
