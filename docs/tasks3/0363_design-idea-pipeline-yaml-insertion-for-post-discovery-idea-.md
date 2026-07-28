---
template: issue
schema_version: 1
name: "Design idea-pipeline YAML insertion for post-discovery idea-eval taste gate"
description: ""
status: done
type: issue
profile: standard
feature_id: I1
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: ["0362", "0360"]
created_at: "2026-07-28T03:21:55.875Z"
updated_at: "2026-07-28T03:37:24.523Z"
done_forced: "true"
done_reason: "Research/design task: YAML insertion plan written to Solution with file:line evidence; no code changes to verify"
---

## 0363. Design idea-pipeline YAML insertion for post-discovery idea-eval taste gate

### Background
Wayfinder ticket for map **I1**. Type: **research** (`wayfinder:research`).

Produce a concrete idea-pipeline YAML change plan: new/changed states, transitions, guards, HITL pause, force-path removal, and iterationBound impact. Depends on 0362 contract. Does not apply the YAML yet (implementation graduates after this map ticket).
### Requirements
R1. Specify the post-discovery flow: `discovery → idea-eval → (approve) feature-create | (reject) cancelled`.

R2. Specify how `design` var collapses to `auto|skip` (drop all `force` branches) using 0360 inventory.

R3. Specify HITL mechanism (hitl.confirm / pause) so taste-gate behavior matches design-approval under interactive and profile=auto.

R4. Call out iterationBound, retry, cleanup shell steps, and validation command (`spur workflow validate`).

R5. Do not edit idea-pipeline.yaml in this ticket — plan only in Solution.

R6. On close, gist to map I1 **Decisions so far**; note implement work ready to graduate from fog.
### Acceptance Criteria
```gherkin
Feature: idea-pipeline YAML insertion plan for idea-eval

  Scenario: State graph specified
    Given the 0362 contract and current idea-pipeline.yaml
    When research ticket 0363 is resolved
    Then Solution lists new/changed states and transitions including reject→cancelled

  Scenario: Force path removal planned
    Given design=force branches in idea-pipeline
    When the plan is recorded
    Then every force branch has a planned delete or collapse to auto|skip

  Scenario: Taste gate under --auto specified
    Given design-approval precedent
    When the ticket closes
    Then Solution states how profile=auto still pauses on idea-eval unless an explicit prior-approval var applies
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
**YAML insertion plan: post-discovery `idea-eval` taste gate + `design` var collapse**

**Current state graph** (from `config/workflows/idea-pipeline.yaml:10`):
```
start → discovery → feature-create → ac-generate → feature-check
  → system-design (conditional) → design-approval → decompose
  → batch-create → batch-create-run → handoff
```

**Planned state graph**:
```
start → discovery → idea-eval → (approve) feature-create → ac-generate → feature-check
  → system-design (conditional) → design-approval → decompose
  → batch-create → batch-create-run → handoff
                   (reject) → cancelled
```

**1. New state: `idea-eval`**

Insert between `discovery` and `feature-create` at `config/workflows/idea-pipeline.yaml:83` (before `feature-create` state definition).

```yaml
  - id: idea-eval
    description: >
      HITL taste gate. Discovery has produced the idea-evaluation report
      (.spur/run/idea-eval-report.md) with urgency/necessity scores, premises,
      pros/cons, and a recommendation. The operator reviews and approves or
      rejects. This gate is NOT auto-clicked by --auto (taste gate, like
      design-approval). Only routes around when vars.idea_approved=true
      (explicit prior approval).
    pause: true
    onEnter:
      - kind: hitl.confirm
        options:
          prompt: "Review the idea evaluation report (.spur/run/idea-eval-report.md). Approve to create a feature, or reject to cancel?"
```

Precedent: `design-approval` at `config/workflows/idea-pipeline.yaml:153` — same pattern (HITL-only, `pause: true`, `hitl.confirm`).

**2. Changed transitions**

- **Remove**: `discovery → feature-create` (at `config/workflows/idea-pipeline.yaml:236`, `guard: always`)
- **Add**: `discovery → idea-eval` (`guard: always`) — discovery complete, enter eval gate
- **Add**: `idea-eval → feature-create` (approve) — `test "${vars.__hitlAnswer}" = yes`
- **Add**: `idea-eval → cancelled` (reject) — `test "${vars.__hitlAnswer}" = cancel || test "${vars.__hitlAnswer}" = no`

Auto-skip under `--auto` with prior approval:
- **Add**: `idea-eval → feature-create` (auto-skip) — `test "${vars.profile}" = auto && test "${vars.idea_approved}" = true`
  Declaration order: auto-skip guard FIRST (same pattern as `design-approval` → `decompose` at `config/workflows/idea-pipeline.yaml:334`).

**3. `design` var collapse: `auto|force|skip` → `auto|skip`**

Per 0360 inventory, the following lines change:

- `config/workflows/idea-pipeline.yaml:19` — vars comment: remove `"force" (--design)`
- `config/workflows/idea-pipeline.yaml:11` — shape comment: remove `or --design`
- `config/workflows/idea-pipeline.yaml:20-21` — "Default/force" → "Default"
- `config/workflows/idea-pipeline.yaml:143` — "or --design forces it" → remove
- `config/workflows/idea-pipeline.yaml:262` — guard: remove `test "${vars.design}" = force ||`; simplify to `test "${vars.design}" = auto && test "$(jq …)" != false`
- `config/workflows/idea-pipeline.yaml:302` — guard: same removal as L262
- `config/workflows/idea-pipeline.yaml:45` — `design: "auto"` default stays (no change needed; just documenting it)

**4. New var: `idea_approved`**

At `config/workflows/idea-pipeline.yaml:46` (after `design_approved`):
```yaml
  idea_approved: "false"
```

**5. `start` state cleanup additions**

At `config/workflows/idea-pipeline.yaml:67` — add `idea-eval-report.md` to the cleanup list:
```
rm -f .spur/run/idea-eval-report.md
```
(alongside existing `idea-ac-retry-count`, `idea-feature-id.txt`, etc.)

**6. Discovery `agent.run` input update**

At `config/workflows/idea-pipeline.yaml:80` — extend the discovery agent input to also say:
"…and emit the idea-evaluation report to `.spur/run/idea-eval-report.md` per the idea-evaluation template (`plugins/sp/skills/spur-dev/references/idea-evaluation.md`)."

This is the artifact that `idea-eval` reads and presents to the operator.

**7. `iterationBound` impact**

Current bound: `25` (at `config/workflows/idea-pipeline.yaml:36`).
The new `idea-eval` state adds 1 transition in the normal path (discovery → idea-eval) and 1 more (idea-eval → feature-create). Worst case adds +2 transitions.
New worst-case: 22 (existing) + 2 = 24 — still within 25. **No change needed.**

**8. Validation command**

After implementing, run:
```bash
spur workflow validate config/workflows/idea-pipeline.yaml
```
Also validate the copy:
```bash
spur workflow validate .spur/workflows/idea-pipeline.yaml
```

**9. `.spur/workflows/idea-pipeline.yaml` mirror**

Apply all the same changes to the content-identical copy. Alternatively, replace it with a symlink to `config/workflows/idea-pipeline.yaml` (operator decision — this ticket does not implement the change).

**10. Shape comment update**

Update the shape comment at `config/workflows/idea-pipeline.yaml:10` to:
```
# Shape: start -> discovery -> idea-eval -> feature-create -> ac-generate -> feature-check
#          -> system-design (conditional: needs_design signal)
#          -> design-approval (taste HITL gate; not auto-clicked by --auto)
#          -> decompose -> batch-create -> handoff
#        (idea-eval rejection -> cancelled)
#        (feature-check failure routes back to ac-generate; batch-create failure to decompose).
```

**Taste gate under `--auto`**

The `idea-eval` state follows `design-approval` precedent exactly:
- `pause: true` — state pauses for HITL
- Under `profile=auto`: the auto-skip guard checks `test "${vars.idea_approved}" = true`
  - If `idea_approved=true` → skip directly to `feature-create` (operator pre-approved)
  - If `idea_approved=false` (default) → state enters, pauses for `hitl.confirm`, waits for operator
- This means `--auto` without `--idea-approved` still pauses at idea-eval — consistent with Auto-Decision Principle #5 (taste decisions always surface to human)
### Testing
Research/design task — no code changes, no tests to run. Verification is AC traceability only.

- **AC: "State graph specified"** — PASS. Solution specifies the new `idea-eval` state (HITL-only, `pause: true`, `hitl.confirm`), all changed/removed/added transitions (discovery → idea-eval → feature-create/cancelled), auto-skip guard, and the updated state graph shape. Cites precedent from `config/workflows/idea-pipeline.yaml:153` (design-approval) and `config/workflows/idea-pipeline.yaml:334` (auto-skip guard pattern).
- **AC: "Force path removal planned"** — PASS. Solution lists every `design=force` branch planned for deletion: guard at `config/workflows/idea-pipeline.yaml:262` (ac-generate → system-design), guard at `config/workflows/idea-pipeline.yaml:302` (feature-check → system-design), plus 5 comment updates. Each has a specific edit (remove `test "${vars.design}" = force ||`, collapse enum to `auto|skip`).
- **AC: "Taste gate under --auto specified"** — PASS. Solution states `profile=auto` still pauses at `idea-eval` unless `idea_approved=true` (explicit prior-approval var). Auto-skip guard: `test "${vars.profile}" = auto && test "${vars.idea_approved}" = true`. Mirrors `design-approval` → `decompose` pattern at `config/workflows/idea-pipeline.yaml:334`.
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-28T03:35:58.812Z todo → wip (system)
- 2026-07-28T03:37:23.109Z wip → testing (system)
- 2026-07-28T03:37:24.507Z testing → done (system)
