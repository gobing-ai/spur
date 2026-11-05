---
schema_version: 1
name: Classify executable shell positions without blocking literal read-only searches
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.920Z
updated_at: "2026-11-05T20:40:04.131Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: A6
priority: P2
tags:
  - simplification-2026-11
  - w8
  - approved
estimate_hours: 8

dependencies: []
---

## 1313. Classify executable shell positions without blocking literal read-only searches

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W8; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature A6: Destructive-command policy distinguishes literal data from execution.

Owned surfaces/callers/fixtures/config/docs: plugins/sp/lib/destructive-policy.ts; plugins/sp/scripts/hooks/careful-guard.ts and portable callers; plugins/sp/tests/hooks/careful-guard.test.ts and shared classifier tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C1 R2 = 14. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Do not leave parser/library choice open or claim a complete shell parser is needed. Freeze a conservative lexical pass: allow only proven literal read-only searches; everything ambiguous retains the current classifier behavior.
- Verified source seams: `plugins/sp/lib/destructive-policy.ts:190`; `plugins/sp/lib/destructive-policy.ts:185`; `plugins/sp/scripts/hooks/careful-guard.ts:84`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Destructive-command policy distinguishes literal data from execution; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Classify executable shell positions without blocking literal read-only searches

  Scenario: AC1 — Destructive-command policy distinguishes literal data from execution (req: R1)
    Given quoted ripgrep patterns containing destructive vocabulary and destructive commands inside executable positions or substitutions
    When the shared classifier and host hook evaluate the command
    Then literal data causes no false permission prompt while all destructive positive controls still request approval without weakening nested-execution detection
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:38:18.595Z

Closed: use a bounded internal lexer and conservative fallback; no new parser package, no claim of full shell-language coverage.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

No new dependency or public API. Add private shellWords/command-segment scanner in destructive-policy.ts tracking single/double quotes, escapes, ; | & newlines and backtick/$() substitutions. Proven standalone rg/grep operands are data; in single quotes never recurse, in double/unquoted substitutions recursively classify executable contents. Also recursively inspect sh/bash/zsh -c argument and env/command prefixes. For malformed/unclosed/unsupported constructs, fall back to existing conservative classifyCommand patterns, not allow. Keep existing SQL/git/rm policy and safe-target rules intact. Do not exempt arbitrary programs or blanket-whitelist rg. Preserve permission ask semantics across portable hook callers.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: Independent safety fix; no functional dependency on Markdown renderer discovery.

#### Boundaries and verification

(cd plugins/sp && bun test tests/hooks/destructive-policy.test.ts tests/hooks/careful-guard.test.ts). Extend the existing shared classifier matrix in destructive-policy.test.ts. Save false-positive and destructive control matrix; plugin-smoke is required only if actual plugin dependency graph changes.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write literal-search positives plus destructive substitutions, nested sh, malformed quoting, git global options and escaped-token negative controls first.
- [ ] 2. Implement the conservative command-position scanner and apply existing dangerous-command logic only to known executable regions; unknown regions retain conservative fallback.
- [ ] 3. Exercise the shared function and real hook payload path, keeping every existing destructive positive control and standalone import rule.
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
