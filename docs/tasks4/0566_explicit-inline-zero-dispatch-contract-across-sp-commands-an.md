---
template: feature-impl
schema_version: 1
name: "Explicit-inline zero-dispatch contract across sp commands and skills"
description: ""
status: todo
type: task
profile: standard
feature_id: G5
parent_wbs: null
priority: P2
tags: ["plugins/sp", "contracts", "adr-047"]
dependencies: ["0565"]
ac_numbering: task-local
created_at: "2026-08-15T16:12:04.377Z"
updated_at: "2026-08-15T16:18:09.895Z"
---

## 0566. Explicit-inline zero-dispatch contract across sp commands and skills

### Background

Run after the CLI/service/workflow error contract lands (sibling task in this batch — contract text documents shipped behavior). The plugin-side inline-default execution-surface contract (plugins/sp/skills/spur-dev/references/cross-cutting.md) currently treats explicit `inline` as equivalent to omit, which under 0508 permits a single native-subagent dispatch — leaking the host-session guarantee. Design: docs/design/agent-inline-host-session.md. Enforcement here is convention, not mechanism — the CLI error (sibling task) is the mechanical backstop.

### Requirements
- [ ] **R1.** `cross-cutting.md` § inline-default execution surface gains the explicit-`inline` carve-out: all model-bearing work executes in the invoking host session — no subagent, no subprocess, no workflow hop; 0508 eligibility applies to `omit` only. Measurable: the contract text states the carve-out and names the CLI error as backstop.
- [ ] **R2.** `flag-glossary.md` and `dev-plan.md` inline rows no longer document `inline` ≡ omit; `dev-parallel.md` documents explicit-inline as sequential host-session execution with a printed notice (parallel fan-out is dispatch). Measurable: each file's inline row states the zero-dispatch semantics.
- [ ] **R3.** Same-change sweep (feature AC R4): no command, skill, or reference under `plugins/sp` resolves or documents `inline` as `agent.default`/omit-equivalent after this task. Measurable: a grep over the plugin tree for the old equivalence returns no live row (the 0539 inventory script's plugin assertions stay green).
### Acceptance Criteria
Covers feature G5 scenarios:

- **R2 — Explicit inline on slash commands and agent skills means zero dispatch**
- **R4 — Consumers documenting inline as omit-equivalent are corrected in the same change**

```gherkin
Scenario: R2 — Explicit inline on slash commands and agent skills means zero dispatch
  Given a slash command or backend agent skill invoked with `--agent inline`
  When it executes model-bearing work
  Then all of that work runs in the invoking host session
  And no subagent, subprocess, or workflow hop receives the prompt

Scenario: R4 — Consumers documenting inline as omit-equivalent are corrected in the same change
  Given `agent-service` resolution, the workflow `agent.run` action, and `dev-plan` docs
  When the feature ships
  Then none of them resolve or document `inline` as `agent.default`
  And the ADR-047 amendment, flag glossary, and docs/04 §7.8 updates land in the same commit
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Per docs/design/agent-inline-host-session.md § Component 4: cross-cutting.md explicit-inline carve-out (zero dispatch; 0508 eligibility omit-only); flag-glossary.md + dev-plan.md inline rows corrected; dev-parallel.md sequential-notice row. Convention-level enforcement — no code mechanism inside skills; the CLI special error (sibling task) is the backstop for subprocess dispatch. Skill text states the guarantee as MUST/NEVER per the operator's phrasing.
### Plan
- [ ] Rewrite cross-cutting.md inline-default contract with the explicit-inline carve-out (R1)
- [ ] Correct flag-glossary.md and dev-plan.md inline rows (R2)
- [ ] Add dev-parallel.md explicit-inline sequential-notice row (R2)
- [ ] Grep plugins/sp for residual inline≡omit/agent.default equivalences; correct or justify each (R3)
- [ ] Re-run the 0539 surface-drift inventory to confirm plugin assertions stay green (R3)
- [ ] Run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
