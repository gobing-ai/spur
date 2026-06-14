---
schema_version: 1
id: "{{ ID }}"
name: "{{ NAME }}"
status: backlog
priority: P2
tags: []
created_at: "{{ CREATED_AT }}"
updated_at: "{{ CREATED_AT }}"
---

# {{ ID }}: {{ NAME }}

## Goal

{{ GOAL }}

## Scope

- In:
- Out:

## Acceptance Criteria

```gherkin
Feature: {{ NAME }}

  Scenario: Basic acceptance
    Given some precondition
    When some action
    Then some expected outcome
```

<!-- BEGIN_TASKS -->
<!-- END_TASKS -->

## Notes

## History
