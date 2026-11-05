---
schema_version: 1
name: Propose safe npm and pnpm bindings through existing init actions
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.916Z
updated_at: "2026-11-05T20:37:57.259Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: A92
priority: P2
tags:
  - simplification-2026-11
  - w4
  - approved
estimate_hours: 8

dependencies: []
---

## 1303. Propose safe npm and pnpm bindings through existing init actions

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W4; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature A92: JavaScript project onboarding proposes declared action bindings safely.

Owned surfaces/callers/fixtures/config/docs: apps/cli/src/commands/init.ts and init tests; packages/config builder schema/loader; packages/app/src/services/sdlc-actions.ts; self exec inspection; bundled init templates and SDLC contracts.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C0 R1 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- No working-directory field exists in builder.actions and no init preview flag exists. Keep the current action string/array schema; place subdirectory commands behind existing quoting/cwd behavior. UI fixes and Markdown proof are not functional dependencies.
- Verified source seams: `apps/cli/src/commands/init.ts:70`; `packages/app/src/services/sdlc-actions.ts:66`; `apps/cli/src/commands/self/exec.ts:39`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. JavaScript project onboarding proposes declared action bindings safely; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Propose safe npm and pnpm bindings through existing init actions

  Scenario: AC1 — JavaScript project onboarding proposes declared action bindings safely (req: R1)
    Given npm or pnpm scripts, lockfile conflicts, missing tools and existing custom builder actions
    When init discovers or previews action bindings
    Then declared commands and provenance are proposed deterministically while conflicts and unbound actions are explicit and existing configuration is preserved
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:56.973Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Extend the init-only detection helper with discovered package.json scripts and lockfile/packageManager evidence. Frozen precedence: existing explicit builder.actions unchanged; existing Bun detection unchanged; matching declared Make action takes precedence over JS script fallback; npm/pnpm is selected only when one manager is unambiguous. Conflicting lockfiles/packageManager means preset none and commented unbound entries with a reason, never install/run. For each reserved action bind only an identically named declared script, command <manager> run <action> with validated fixed action name. Add private detectBuilderBindings returning {bindings,sourceByAction,diagnostics}; render command config only, provenance as comments, not schema fields. Re-init preserves user bytes. Inspection uses existing self exec --list/--dry-run; no new init flag.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1304 extends the same private detection result; no new runtime config is required.

#### Boundaries and verification

(cd apps/cli && bun test tests/commands/init.test.ts tests/commands/self/exec.test.ts tests/init-templates.test.ts); (cd packages/app && bun test tests/services/sdlc-actions.test.ts). Save generated YAML, inspection JSON and fixture check exit.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write manifest/lock/Make/custom-action fixtures with non-executable candidate commands first.
- [ ] 2. Implement deterministic init-only binding detection and render preset none for unambiguous non-Bun bindings.
- [ ] 3. Verify conflicting manifests remain unbound, no discovery command executes and reinit preserves configured content.
- [ ] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
