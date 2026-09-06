---
schema_version: 1
name: "Make task creation and checking agree on valid persisted content"
status: todo
template: feature-impl
created_at: 2026-09-06T20:59:14.049Z
updated_at: "2026-09-06T21:02:11.683Z"
feature_id: F21
priority: P1
dependencies: ["0786"]
---

## 0787. Make task creation and checking agree on valid persisted content

### Background

Fresh source-local CLI probes reproduced bare create and background-only batch create exiting 0 followed by task check exiting 1 with L3.requirements-empty and L3.ac-empty. Optional scaffold bodies are checked unconditionally. Feature links or any batch spec field currently imply todo. Required-section metadata is reconstructed from missing findings. Quoted names fail YAML parsing and literal backslashes can become tabs. Evidence and exact commands are in docs/plans/2026-09-06-task-creation-readiness-brainstorm.md; code premises are TaskService.create/createBatchItem, TaskCheckService.runL3, and PlanningCheckService.summarizeWithStatus.

Implements feature scenarios R1 — Capture validation follows the actual section matrix; R2 — Supplied task specifications are validated before persistence; R3 — Task input round trips and failures preserve machine output. Shared rendering, status choice, diagnostics and serialization are one reviewable correctness change; do not split individual bugs into more tasks. Schedule after the existing workflow repair batch ending at 0786.

Sizing: approximately 6–8 hours, one deterministic correctness deliverable spanning app/domain/CLI tests; medium risk, no parallel coordination. Parent effort is approximately 14–20 hours; rubric E16 D2 L2 C0 R1=21 justifies two independently verifiable deliverables with distinct deterministic versus model-assisted risk. This task stays whole under the operator's cohesion instruction; no child tasks.

### Requirements

- [ ] R1. Single and batch capture creation produce truthful backlog records; project and bundled matrix selection agrees with checking for every supported template. Omitted or placeholder-only optional backlog sections do not generate scaffold-only findings, while required Background is substantive.
- [ ] R2. Supplied candidates are validated before persistence against the same variant/status rules used by task check. Fully specified inputs may enter todo; partial content or a feature link alone never establishes readiness. Malformed authored AC and missing required planning bodies at todo remain failures. Batch validation failure leaves no task files or parent mutations.
- [ ] R3. requiredSections is the full resolved matrix list, missingSections only the missing subset, including --as target semantics. Preserve finding codes, strict severity behavior and genuine feature/dependency diagnostics; do not weaken completion evidence.
- [ ] R4. Single/batch creation round-trips allowed names and tags exactly, including embedded and enclosing quotes, backslashes, Unicode, colons and line breaks. Invalid input returns nonzero plus one parseable raw/enveloped JSON error without writes.
- [ ] R5. Supply create-to-check regressions against real matrix assets and source-local CLI probes, record the explicit unsuppressed corpus audit for checker-policy changes, and update the owning CLI surface docs. No model execution, new dependency, full-corpus repair, or second matrix policy is in scope.

### Acceptance Criteria

```gherkin
Feature: Consistent task creation and default implementation readiness

  @core
  Scenario: R1 — Capture validation follows the actual section matrix
    Given a supported task variant and a bare capture with a valid background
    When creation and current-status checking run with the same project or bundled matrix
    Then optional unfilled planning sections do not cause scaffold-only errors or warnings
    And the task remains backlog and requiredSections lists every resolved required section even when all are present

  @core
  Scenario: R2 — Supplied task specifications are validated before persistence
    Given a single or batch candidate with supplied planning content
    When the shared creation path evaluates the candidate for its intended status
    Then malformed authored content and missing required content are reported before commit
    And a complete valid specification can enter todo while incomplete capture cannot claim implementation readiness

  @core
  Scenario: R3 — Task input round trips and failures preserve machine output
    Given task names or tags containing quotes backslashes colons Unicode or allowed line breaks
    When single or batch creation runs with raw JSON or envelope output
    Then successful show output preserves the original strings exactly
    And invalid input exits nonzero with one parseable error result and no created files
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Read docs/design/task-creation-readiness.md (ADR-109, approved design, not yet shipped). No new dependency, public noun/verb, readiness scoring framework, or implementation during creation. Tests and owning documentation ship with this task. Preserve unrelated edits and use source-local CLI provenance for dogfood.

WHAT/WHY: repair the deterministic producer/consumer contract once so single create, batch create and HTTP create share it. Keep creator and checker on the existing matrix. Status reflects supplied validated content; a feature link is traceability only. A bare title is a legitimate capture Background, not fabricated Requirements or AC. Preserve optional future-stage scaffold compatibility; suppress only absent/placeholder optional backlog planning sections. Authored invalid content remains checked at every status. Make required content validation matrix-aware for Background/AC/Design/Plan and preserve Requirements' established todo contract without hard-coding another status matrix.

WHERE: packages/app/src/services/task-service.ts (create/createBatchItem, shared candidate rendering), task-check.ts (check/runL3/runL4), planning-check-base.ts (matrix metadata); packages/domain/src/planning/markdown-document.ts and task-skeleton.ts only for reusable rendering/serialization; apps/cli/src/commands/task.ts for structured errors and shared configuration; apps/server/src/context.ts and modules/task/handlers.ts only where deterministic wiring needs parity. Use existing tests in each workspace.

FROZEN CONTRACT: no new public flags in this task. Keep existing create/batch return fields, variant defaults and dedupe/WBS lock semantics. requiredSections comes directly from the selected variant/status entry, including --as; missingSections is independently derived from document presence. Reuse TaskCheckService's content policy for a candidate document before allocation commit, factoring its read/parse boundary only as needed; never invoke a second full CLI or persist a temporary candidate into the real corpus just to check it. Batch candidates are all validated before writes or parent wiring; retain existing rollback handling for later I/O failures.

SERIALIZATION: use the already-installed YAML serializer with a frontmatter object rather than double-quoted interpolation in create and createBatchItem. Do not naively use escapeYamlValue as an exact-string writer: it preserves enclosing quotes and does not fully escape line breaks. Names/tags must round-trip as data; restrict title line breaks only if the live schema explicitly rejects them, not through silent normalization. Keep CLI usage/dedupe/collision exits; generic create failure under --json uses the existing writeJsonError/toEnvelopeJson conventions.

VALIDATION: empty optional backlog bodies are allowed, substantive Background remains required; todo required planning bodies cannot be placeholders. Real missing-feature warnings remain visible; never auto-link a feature or raise all tasks to todo to pass. Completed Solution/Testing/Review rules remain unchanged. Cover standard, feature-impl, issue, review, meta and brainstorm using actual matrix loading.

HANDOFF: the second F21 task consumes this deterministic candidate validation and existing WBS/path output; it owns --skip-ready and model orchestration. This task must be independently usable before that default changes. Dependencies[] identifies 0786; the dependent task is 0788. No unresolved design decisions; incidental implementation names remain local, no new public API.

VERIFY: focused failing regressions for bare/linked/partial/complete create-to-check, exact string round-trips and raw/envelope failures; HTTP no-agent regression; all required project gates. Because checker policy changes, run bun run corpus-check once, retain unsuppressed output, and distinguish historical findings from new regressions without baselines.

### Plan

- [ ] 1. Reproduce the current single/batch failures and add focused regressions using real matrix assets (R1–R4).
- [ ] 2. Repair shared candidate rendering, exact YAML serialization and JSON error paths; validate before write and preserve locking/rollback (R2, R4).
- [ ] 3. Align matrix-aware content checks, status derivation and required/missing metadata; exercise all variants and HTTP caller behavior (R1–R3).
- [ ] 4. Run targeted tests from their workspaces, source-local CLI probes and the explicit unsuppressed corpus audit; classify findings without suppression (R5).
- [ ] 5. Update docs/04_DESIGN.md and its task-readiness satellite, run doc-evolve sync-check and required project gates; leave the deterministic seam documented for the next task (R5).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: F21, consistent task creation and default implementation readiness.
- Decision: docs/00_ADR.md, ADR-109.
- Surface: docs/design/task-creation-readiness.md.
- Discovery evidence: docs/plans/2026-09-06-task-creation-readiness-brainstorm.md.
- Sequence: 0786 → 0787 → 0788; dependency edges are the execution ordering authority.
### History
