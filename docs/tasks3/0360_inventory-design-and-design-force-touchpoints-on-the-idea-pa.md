---
template: issue
schema_version: 1
name: "Inventory --design and design=force touchpoints on the idea path"
description: ""
status: done
type: issue
profile: standard
feature_id: I1
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: []
created_at: "2026-07-28T03:21:51.586Z"
updated_at: "2026-07-28T03:32:50.110Z"
done_forced: "true"
done_reason: "Research-only task: inventory/change-map written to Solution; no code changes to verify"
---

## 0360. Inventory --design and design=force touchpoints on the idea path

### Background
Wayfinder ticket for map **I1**. Type: **research** (`wayfinder:research`).

Produce a complete change map of every surface that still exposes `--design` / `design=force` on the **idea** path (command, idea-pipeline YAML, docs, tests). This is the prerequisite inventory for removing the force path so Design stays default-on with only `--skip-design`.
### Requirements
R1. Grep/list every idea-path reference to `--design`, `design=force`, `design: "force"`, or docs that document force for `/sp:dev-idea` / `idea-pipeline`.

R2. Distinguish **must-change for I1** (idea CLI + idea-pipeline + idea-specific docs/tests) from **leave alone** (dev-plan / planning-pipeline still has `--design` — out of scope per map).

R3. For each must-change file, record path + what to change (delete flag, collapse var enum, update table, fix assertion).

R4. Do not implement the removal. Solution is the inventory/change map only.

R5. On close, append a one-line gist to map I1 **Decisions so far**.
### Acceptance Criteria
```gherkin
Feature: Idea-path --design / design=force inventory

  Scenario: Idea-path touchpoints listed
    Given the repo contains dev-idea, idea-pipeline, and related docs/tests
    When research ticket 0360 is resolved
    Then Solution lists every idea-path --design or design=force touchpoint with path evidence

  Scenario: Scope split recorded
    Given /sp:dev-plan still has --design
    When the inventory is recorded
    Then each touchpoint is tagged must-change (I1) or leave-alone (out of scope)

  Scenario: Change map is actionable
    Given the must-change set
    When the ticket closes
    Then each entry has a one-line intended edit (no implementation performed)
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
**Inventory: `--design` / `design=force` touchpoints on the idea path**

**Must-change for I1 (idea-specific)**

| # | Touchpoint | Intended edit |
|---|-----------|---------------|
| 1 | `plugins/sp/commands/dev-idea.md:3` — `argument-hint` includes `[--design]` | Remove `[--design]` from arg-hint; keep `[--skip-design]` and `[--design-approved]` |
| 2 | `plugins/sp/commands/dev-idea.md:14` — Usage line `[--auto] [--design] [--skip-design] [--design-approved]` | Remove `[--design]` from usage |
| 3 | `plugins/sp/commands/dev-idea.md:17` — Design var enum: `auto (default) \| force (--design) \| skip` | Collapse to `auto (default) \| skip (--skip-design)` — remove `force` variant entirely |
| 4 | `plugins/sp/commands/dev-idea.md:18` — "Default/force author per-task `design`" | Reword to "Default authors per-task `design`; `--skip-design` leaves Design blank" |
| 5 | `plugins/sp/commands/dev-idea.md:23` — `--vars` JSON: `"design":"auto\|force\|skip"` | Collapse to `"design":"auto\|skip"` — remove `force` from the enum |
| 6 | `config/workflows/idea-pipeline.yaml:19` — Comment: `"force" (--design)` in vars block | Remove `"force" (--design)` from the comment; var is `auto \| skip` |
| 7 | `config/workflows/idea-pipeline.yaml:11` — Comment: `needs_design signal or --design` | Reword to `needs_design signal` only (auto-driven) |
| 8 | `config/workflows/idea-pipeline.yaml:20` — Comment: "Default/force: decompose must author batch item `design`" | Reword: "Default: decompose must author batch item `design`" |
| 9 | `config/workflows/idea-pipeline.yaml:143` — Comment: `or --design forces it` | Remove `or --design forces it` |
| 10 | `config/workflows/idea-pipeline.yaml:262` — Guard: `test "${vars.design}" = force \|\|` branch in ac-generate → system-design | Remove the `force` test; guard becomes `test "${vars.design}" = auto && test "$(jq …)" != false` |
| 11 | `config/workflows/idea-pipeline.yaml:302` — Guard: `test "${vars.design}" = force \|\|` branch in feature-check → system-design | Same removal as #10 — drop `force` branch |
| 12 | `.spur/workflows/idea-pipeline.yaml` — Content-identical copy of `config/workflows/idea-pipeline.yaml` | Apply same edits #6–#11; or replace with symlink to config/ |
| 13 | `plugins/sp/skills/spur-dev/references/dev-operations.md:68` — Operation map arg-hint: `[--auto] [--design] [--skip-design] [--design-approved]` | Remove `[--design]` from arg-hint |
| 14 | `plugins/sp/skills/spur-dev/references/dev-operations.md:255` — Inputs: "`--design` forces the system-design step to run" | Remove the `--design` sentence |
| 15 | `plugins/sp/skills/spur-dev/references/dev-operations.md:257` — Behavior: `"design":"auto\|force\|skip"` in vars JSON | Collapse to `"design":"auto\|skip"` |
| 16 | `plugins/sp/skills/spur-dev/references/dev-operations.md:259` — Design package table: row `\| --design \| always run \| author design \|` + commentary | Delete the `--design` row; table becomes 2-row (default + `--skip-design`) |
| 17 | `plugins/sp/skills/brainstorm/SKILL.md:189` — "`--design` forces `system-design` (feature satellite) regardless of signal" | Delete this bullet; the flag no longer exists on the idea path |

**Leave alone (out of scope for I1)**

- `plugins/sp/commands/dev-plan.md:18` — `--design` on the plan path; plan still has the force flag
- `plugins/sp/skills/spur-dev/references/dev-operations.md:57` — `--design` in plan operation §6; plan's design package is independent
- `plugins/sp/skills/spur-dev/references/dev-operations.md:178` — plan design flags (§6)
- `plugins/sp/skills/spur-dev/references/planning-workflow.md:162` — `--design` in planning workflow; plan keeps its own force flag
- `plugins/sp/skills/spur-dev/references/planning-workflow.md:168` — `--design` force description for plan
- `plugins/sp/skills/spur-dev/references/planning-workflow.md:174` — `--design` table row for plan
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` — No `design=force` or `--design` references found
- `AGENTS.md` — No `design=force` references found

**Summary**

17 must-change touchpoints across 5 unique files (+ 1 mirror copy at `.spur/workflows/`). All edits are deletions or enum collapses — no new code. The `design` var on the idea path becomes `auto | skip` (2-value enum); the `--design` CLI flag is removed from `dev-idea` only. `/sp:dev-plan` retains its own `--design` flag independently.
### Testing
Research task — no code changes, no tests to run. Verification is AC traceability only.

- **AC: "Idea-path touchpoints listed"** — PASS. Solution table lists 17 touchpoints with `file:line` evidence from grep across `plugins/sp/commands/dev-idea.md`, `config/workflows/idea-pipeline.yaml`, `.spur/workflows/idea-pipeline.yaml`, `plugins/sp/skills/spur-dev/references/dev-operations.md`, and `plugins/sp/skills/brainstorm/SKILL.md`.
- **AC: "Scope split recorded"** — PASS. Every touchpoint is tagged must-change (I1) or leave-alone (out of scope) with explicit rationale.
- **AC: "Change map is actionable"** — PASS. Each must-change entry has a one-line intended edit (e.g. "Remove `[--design]` from arg-hint", "Collapse to `auto | skip`").
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-28T03:29:05.715Z todo → wip (system)
- 2026-07-28T03:31:35.211Z wip → testing (system)
- 2026-07-28T03:32:50.094Z testing → done (system)
