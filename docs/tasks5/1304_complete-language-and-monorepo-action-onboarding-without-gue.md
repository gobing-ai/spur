---
schema_version: 1
name: Complete language and monorepo action onboarding without guessing commands
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.917Z
updated_at: "2026-11-05T20:37:59.348Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: A92
priority: P2
tags:
  - simplification-2026-11
  - w4
  - approved
estimate_hours: 8

dependencies: ["1303"]
---

## 1304. Complete language and monorepo action onboarding without guessing commands

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W4; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature A92: Language and monorepo onboarding retains execution ownership.

Owned surfaces/callers/fixtures/config/docs: init discovery introduced by JavaScript onboarding; existing builder.actions working-directory ownership; Cargo/Go/Python/Make fixture manifests; representative mixed monorepo; init/action docs and templates.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C0 R1 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Freeze conservative language defaults and package selection. Do not assume Python project.scripts are shell actions or introduce a cwd schema. The selected fixture root and quoted command prefix suffice.
- Verified source seams: `apps/cli/src/commands/self/exec.ts:32`; `packages/app/src/services/sdlc-actions.ts:103`; `apps/cli/src/commands/init.ts:353`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Language and monorepo onboarding retains execution ownership; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Complete language and monorepo action onboarding without guessing commands

  Scenario: AC1 — Language and monorepo onboarding retains execution ownership (req: R1)
    Given Cargo, Go, Python, Make and mixed-monorepo fixtures with selected roots and missing scripts
    When the operator inspects and accepts supported action bindings
    Then working directories and tool availability are explicit, no unsupported command is invented and a representative non-Bun project reaches a successful check within five operator actions
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:59.058Z

Closed: use the conservative mapping above. Sources checked: https://doc.rust-lang.org/cargo/commands/cargo-check.html ; https://doc.rust-lang.org/cargo/commands/cargo-test.html ; https://pkg.go.dev/cmd/go . Python defaults remain unbound without declared project commands.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Extend 1303 detection: explicit Make/action bindings win. With Cargo.toml and available cargo propose build="cargo build", typecheck="cargo check", test="cargo test", check composite [typecheck,test], using Cargo manifest default-member behavior. With go.mod and available go propose build="go build ./...", test="go test ./...", check composite [build,test]; do not relabel build as lint. Python pyproject.toml alone proposes no pytest/uv/poetry command: use an explicit matching Make target or preserved custom action; other actions stay unbound with reason. One chosen package root: root manifest wins, otherwise a single immediate child package may be selected; multiple candidate roots stay unbound with paths listed. For a selected child prefix the stored string with cd <shQuote(relativeRoot)> && <command>, using existing shell-quote helper and no cwd field. No recursive monorepo discovery or execution during detection.

#### Dependencies and handoff

Direct prerequisites: 1303. 1303 provides detectBuilderBindings and preserved init/config behavior; extend it instead of adding another profile detector.

Output/handoff: A verified independently reviewable slice with unchanged public behavior.

#### Boundaries and verification

(cd apps/cli && bun test tests/commands/init.test.ts tests/commands/self/exec.test.ts); (cd packages/app && bun test tests/services/sdlc-actions.test.ts). Use fixture executable stubs for deterministic discovery and separately report real-tool availability. Verify Cargo/Go semantics against the official references recorded in Q&A.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write Cargo default-member, Go, Python-declared-Make and mixed-root/conflict fixtures before implementation.
- [ ] 2. Extend only the existing detection result and command rendering; preserve user bindings and tool absence diagnostics.
- [ ] 3. Run generated self exec commands only in disposable fixtures and record the five-or-fewer operator action journey for a representative non-Bun project.
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
