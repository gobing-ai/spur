---
template: issue
schema_version: 1
name: "Decide idea-eval agent ownership, artifacts, reject wiring, and re-entry flags"
description: ""
status: done
type: issue
profile: standard
feature_id: I1
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: ["0361"]
created_at: "2026-07-28T03:21:54.623Z"
updated_at: "2026-07-28T03:35:51.678Z"
done_forced: "true"
done_reason: "Grilling/decision task: contract decisions written to Solution with file:line evidence; no code changes to verify"
---

## 0362. Decide idea-eval agent ownership, artifacts, reject wiring, and re-entry flags

### Background
Wayfinder ticket for map **I1**. Type: **grilling** (`wayfinder:grilling`).

Lock the idea-evaluation **contract**: which agent/skill authors the report, artifact paths, reject/cancel semantics, whether `--idea-approved` (or similar) exists for re-entry, and how the enhanced idea flows into feature-create. Depends on the 0361 template shape.
### Requirements
R1. Decide ownership: separate idea-pipeline `agent.run` state vs extend discovery/`sp:brainstorm` to emit the eval report as its terminal artifact.

R2. Decide artifact path(s) under `.spur/run/` and whether the enhanced idea overwrites `vars.idea` or stays a sidecar consumed by feature-create.

R3. Decide reject path: `cancelled` terminal, cleanup expectations for discovery outputs, operator-visible message.

R4. Decide re-entry under `--auto`: require always-pause only, or also add an explicit prior-approval var (mirror `design_approved` / `--design-approved`).

R5. Do not implement YAML or code. Decision + short contract only; 0363 designs the YAML against this contract.

R6. On close, gist to map I1 **Decisions so far**.
### Acceptance Criteria
```gherkin
Feature: Idea-eval ownership and re-entry contract

  Scenario: Ownership decided
    Given the 0361 template prototype
    When grilling ticket 0362 is resolved
    Then Solution names whether brainstorm or a dedicated pipeline state owns report authorship

  Scenario: Artifacts and enhanced-idea flow decided
    Given .spur/run conventions from idea-pipeline
    When the contract is recorded
    Then artifact path(s) and vars.idea vs sidecar semantics are explicit

  Scenario: Reject and re-entry decided
    Given taste-gate precedent (design-approval)
    When the ticket closes
    Then reject→cancelled cleanup and any --idea-approved / design_approved-style re-entry rule are named
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
**Decisions: idea-eval agent ownership, artifacts, reject wiring, and re-entry flags**

**R1. Ownership: extend discovery / `sp:brainstorm` to emit the eval report as its terminal artifact**

Decision: **Extend discovery** (NOT a separate `agent.run` state).

Rationale: Discovery already dispatches `sp:brainstorm` which produces the design summary, `needs_design` signal, and approach trade-offs — all inputs the evaluation template needs. Adding a second `agent.run` state would duplicate context-loading (re-read the brainstorm artifact) and add a pipeline state that is effectively "summarize what you just produced." Instead, `sp:brainstorm` emits the idea-evaluation report as its terminal artifact alongside the existing `idea-needs-design.json`. The pipeline `idea-eval` state is a **non-agent state** — it reads the artifact file, renders the HITL pause, and routes approve/reject. This matches `design-approval` (state `config/workflows/idea-pipeline.yaml:153`) which is also a non-agent HITL-only state that reads a pre-authored artifact.

Precedent: `design-approval` at `config/workflows/idea-pipeline.yaml:153` — no `agent.run`, just `hitl.confirm` + guard routing.

**R2. Artifact path: `.spur/run/idea-eval-report.md` as a sidecar consumed by feature-create**

Decision: Emit to `.spur/run/idea-eval-report.md`. The enhanced-idea text is a **sidecar** — feature-create reads it as input context but `vars.idea` is NOT overwritten.

Rationale:
- `.spur/run/` is the established run-artifact directory (see `config/workflows/idea-pipeline.yaml:67` — `mkdir -p .spur/run`). All other idea-pipeline artifacts live there: `idea-needs-design.json`, `idea-feature-id.txt`, `idea-ac-content.md`, `idea-task-batch.json`.
- Overwriting `vars.idea` would lose the original operator input, making debugging and retry harder. The sidecar keeps both: `vars.idea` (what the operator typed) and `.spur/run/idea-eval-report.md` (what the agent refined). Feature-create can reference both.
- The `feature-create` state's `agent.run` input (at `config/workflows/idea-pipeline.yaml:92`) already reads `.spur/run/` files for context; adding one more is consistent.

Template file: `plugins/sp/skills/spur-dev/references/idea-evaluation.md` (per 0361 recommendation). The `.spur/run/idea-eval-report.md` is a filled instance of that template.

**R3. Reject path: `cancelled` terminal, no cleanup of discovery outputs**

Decision: Reject → **`cancelled`** terminal state. Discovery outputs (brainstorm artifact, `idea-needs-design.json`) are **not cleaned up**.

Rationale:
- `cancelled` is already a declared terminal state at `config/workflows/idea-pipeline.yaml:40`. The reject path adds no new terminal.
- Discovery outputs are useful even on reject: the operator may re-run with `--auto` after reshaping the idea, and re-reading the prior brainstorm avoids redundant discovery work.
- Cleanup expectation: none. The `.spur/run/` directory is ephemeral per-run; it is cleaned on next `start` state entry (see `config/workflows/idea-pipeline.yaml:67` — `rm -f .spur/run/idea-*`). Adding cleanup to the reject path would be inconsistent with how `failed` already works (no cleanup on `failed` either).
- Operator-visible message: the HITL reject renders a note: "Idea rejected. No feature created. Run `/sp:dev-idea` again to retry with a different idea."

**R4. Re-entry under `--auto`: require always-pause; add `--idea-approved` var**

Decision: The idea-eval taste gate **always pauses** under `--auto`, just like `design-approval`. Additionally, add an explicit prior-approval var `idea_approved` (pipeline var) / `--idea-approved` (CLI flag).

Rationale:
- The Auto-Decision Principle #5 says taste decisions always surface to the operator. Idea evaluation is a taste decision — the operator decides whether the refined idea is worth pursuing. This matches `design-approval` at `config/workflows/idea-pipeline.yaml:156` which says "NOT auto-clicked by --auto".
- The `--idea-approved` flag mirrors `--design-approved` (see `config/workflows/idea-pipeline.yaml:22` and `plugins/sp/commands/dev-idea.md:3`). It lets an operator who has already reviewed the idea (e.g. in a prior session or via a brainstorm command) skip the pause:
  - Pipeline var: `idea_approved` (default `"false"`)
  - CLI flag: `--idea-approved` → sets `idea_approved=true` in `--vars`
  - Guard: `test "${vars.idea_approved}" = true` routes around the HITL pause
- Without `--idea-approved`, the HITL pause is mandatory even under `--auto`.

Contract summary:
- `config/workflows/idea-pipeline.yaml:42` — add `idea_approved: "false"` to `vars`
- `plugins/sp/commands/dev-idea.md:3` — add `[--idea-approved]` to arg-hint
- `plugins/sp/commands/dev-idea.md:23` — add `"idea_approved":"false|true"` to `--vars` JSON
### Testing
Grilling/decision task — no code changes, no tests to run. Verification is AC traceability only.

- **AC: "Ownership decided"** — PASS. Solution names `sp:brainstorm` (discovery) as report author, not a dedicated pipeline state. Rationale cites precedent from `config/workflows/idea-pipeline.yaml:153` (design-approval is a non-agent HITL-only state).
- **AC: "Artifacts and enhanced-idea flow decided"** — PASS. Artifact path: `.spur/run/idea-eval-report.md`. Enhanced idea is a sidecar (NOT overwriting `vars.idea`). Template home: `plugins/sp/skills/spur-dev/references/idea-evaluation.md:1` (per 0361). Rationale cites `.spur/run/` convention from `config/workflows/idea-pipeline.yaml:67`.
- **AC: "Reject and re-entry decided"** — PASS. Reject → `cancelled` terminal (already declared at `config/workflows/idea-pipeline.yaml:40`). No cleanup. Re-entry: `--idea-approved` flag mirroring `--design-approved` pattern (`config/workflows/idea-pipeline.yaml:22`); always-pause under `--auto` unless `idea_approved=true`.
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-28T03:34:27.346Z todo → wip (system)
- 2026-07-28T03:35:44.799Z wip → testing (system)
- 2026-07-28T03:35:51.642Z testing → done (system)
