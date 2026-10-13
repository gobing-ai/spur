---
schema_version: 1
name: Residuals from 1185
status: backlog
template: standard
created_at: 2026-10-13T03:01:50.794Z
updated_at: "2026-10-13T03:01:51.962Z"

---

## 1189. Residuals from 1185

### Background

Source task: 1185 (feature A33) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:fbc62b10 — packages/app/src/workflow/consumer-compat.ts:98: Recognition is bounded to `<workdir>/.spur/`, documented as a `shortcut:` at `:96`. R1's antecedent is any project-layer override script, so a port at `<workdir>/scripts/verify.mjs` still gets the bare `exited with N`. Fail-open (the old message), never a wrong one.
- review-finding:644e8007 — packages/app/src/workflow/consumer-compat.ts:125: A multi-script override can name the WRONG consumer: `definitionConsumerScript` returns the first project-rooted script (`:139-141`) while the export names come from the actually failing child (`:147-149`). No case covers >1 consumer (`packages/app/tests/workflow/consumer-compat.test.ts:126-144` is single-command).

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
