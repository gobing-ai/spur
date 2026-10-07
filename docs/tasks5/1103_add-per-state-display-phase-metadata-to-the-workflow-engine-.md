---
schema_version: 1
name: Add per-state display phase metadata to the workflow engine state schema
status: backlog
template: feature-impl
created_at: 2026-10-07T06:14:15.476Z
updated_at: "2026-10-07T06:14:39.720Z"
feature_id: I13

---

## 1103. Add per-state display phase metadata to the workflow engine state schema

### Background

Map I13 decided that the display phase table lives in workflow YAML. The engine's state schema is `.strict()`
(`@gobing-ai/ts-dual-workflow-engine` 0.5.16 `dist/schema.js` lines 79-93; `StateDef` in `dist/types.d.ts` lines 56-78),
and Spur loads definitions through `loadWorkflowDef` (`packages/app/src/workflow/workflow-resolver.ts:4`). So a `phase` key on a
state is rejected today. Per AGENTS.md, fix the released engine facade rather than stripping keys in Spur.

### Requirements

- [ ] R1. Add an optional, behavior-free per-state display field to the engine `StateDef` type and zod schema (e.g. `display: { phase: string, phaseTitle?: string, title?: string, show?: 'plan' | 'on-entry' }`); the engine ignores it at run time.
- [ ] R2. Release the engine and bump the Spur workspace catalog; existing workflows load unchanged.
- [ ] R3. Engine tests cover: field accepted, unknown sub-keys rejected, absent field unchanged.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
