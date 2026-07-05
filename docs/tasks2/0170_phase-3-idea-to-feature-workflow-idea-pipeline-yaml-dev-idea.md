---
template: feature-impl
schema_version: 1
name: Phase 3 Idea-to-Feature workflow — idea-pipeline.yaml, dev-idea, design approval gate
description: ""
status: done
type: task
profile: standard
feature_id: I
parent_wbs: "0167"
priority: P2
tags: []
dependencies: []
created_at: 2026-07-01T18:42:39.271Z
updated_at: 2026-07-01T21:03:52.473Z
---

## 0170. Phase 3 Idea-to-Feature workflow — idea-pipeline.yaml, dev-idea, design approval gate

### Background

Phase 3 of the 0167 6-phase decomposition (Plan steps 13-17). Builds the unified idea-to-feature entry point. Depends on Phase 2 (task 0167 phase-2 child) completing first — uses the dev-operations registration pattern and cross-cutting conventions. Implements parent task 0167 Plan Phase 3.

Dependency: Phase 2 must complete first (dev-operations registration pattern + cross-cutting conventions). Phase 4 depends on this task.

Source: docs/tasks2/0167_*.md Plan Phase 3; docs/design/e2e-workflow-for-system-development.md idea-pipeline contract.

### Requirements
R1. (parent R1) Create `idea-pipeline.yaml` state-machine workflow at `config/workflows/idea-pipeline.yaml` (physical source; `.spur/workflows/idea-pipeline.yaml` symlinked). States: start -> discovery (agent.run dispatching sp:brainstorm; records design summary + emits `needs_design` signal) -> feature-create (spur feature create or select existing) -> ac-generate (write AC per ac-style-guide.md via spur feature update) -> feature-check (hitl.confirm gate: `spur feature check <id> --strict`; objective, auto-routable) -> system-design (agent.run dispatching sp:sys-architecture; HITL design approval; auto-detection via `needs_design` signal per R2 below) -> decompose (agent.run dispatching sp:spec-decomposition with design doc as input) -> batch-create (hitl.confirm gate: `spur task batch-create`; objective, auto-routable) -> handoff (terminal; output feature id + task WBS list + next command; NO task execution). `$schema` = `@gobing-ai/spur/schemas/state-machine-workflow.schema.json`, `kind: state-machine`.

R2. (parent R16) Auto-detection for the system-design step: when neither `--design` nor `--skip-design` is set, the `needs_design` signal from brainstorm's scope decomposition check (Phase 1, task 0168 R3) determines whether `system-design` runs. `needs_design=true` (multi-subsystem/schema/transport/dependency) -> runs; `needs_design=false` (single-module/bug-fix/pattern-following) -> skipped, routing directly from `feature-check` to `decompose`. `--design` forces `needs_design=true`; `--skip-design` forces `needs_design=false`. Ties lean toward design ("nothing is too simple", parent R2 pattern 2). The criteria mirror the seam heuristic from `dev-plan-design-doc-generation.md`.

R3. (parent R1) Create `/sp:dev-idea` command at `plugins/sp/commands/dev-idea.md` — thin wrapper: `spur workflow run .spur/workflows/idea-pipeline.yaml --vars '{"idea":"<text>","profile":"interactive|auto","design":"auto|force|skip"}'`. Supports `--auto`, `--design`, `--skip-design` flags. The pipeline stops at handoff — tasks are created but not executed.

R4. (parent R10) Register `idea` operation in `plugins/sp/skills/spur-dev/references/dev-operations.md`. This drives the R32 structural test (added in Phase 6, task 0173).

R5. (parent R2 pattern 1, design doc Design Approval Gate) Add `## Design Approval Gate` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md` documenting the brainstorm hard gate: a design summary is always recorded ("nothing is too simple"); the design approval is a taste gate and remains a pause unless the operator has explicitly approved the design in-session; with `--auto`, the gate auto-approves only when an explicit prior approval is represented in workflow vars. This drives the R33 structural test (added in Phase 6, task 0173).

R6. (parent R13, design doc System Principles 4) Validate pipeline alignment: verify `idea-pipeline.yaml` stops at handoff (does not execute tasks), `feature-dev.yaml` continues to execution, and no state in `idea-pipeline.yaml` calls another pipeline's state graph (nesting forbidden). The design doc's overlap management notes that `idea-pipeline.yaml` and `feature-dev.yaml` share brainstorm+plan steps intentionally — `idea-pipeline` stops at handoff, `feature-dev` continues to execution. Duplication is in YAML calls, not logic.
### Acceptance Criteria
**AC-P3.1: idea-pipeline.yaml validates**
```gherkin
Feature: Phase 3 Idea-to-Feature workflow

  Scenario: idea-pipeline.yaml is a valid state-machine workflow
    Given the file config/workflows/idea-pipeline.yaml
    When running `spur workflow validate .spur/workflows/idea-pipeline.yaml --json`
    Then the command exits 0
    And the workflow has states: discovery, feature-create, ac-generate, feature-check, system-design, decompose, batch-create, handoff
    And handoff is a terminal state with no task execution
```

**AC-P3.2: dev-idea command exists**
- Pass: `plugins/sp/commands/dev-idea.md` exists with valid frontmatter.
- Pass: the command delegates to `.spur/workflows/idea-pipeline.yaml`.
- Pass: the command supports `--auto`, `--design`, `--skip-design` flags.

**AC-P3.3: dev-operations registration**
- Pass: `grep 'idea' plugins/sp/skills/spur-dev/references/dev-operations.md` returns a match for the idea operation.

**AC-P3.4: Design Approval Gate documented**
- Pass: `grep '## Design Approval Gate' plugins/sp/skills/spur-dev/references/cross-cutting.md` returns a match.
- Pass: the section documents that design approval is a taste gate, not auto-clicked by `--auto` unless explicit prior approval is represented.

**AC-P3.5: needs_design signal routing**
- Pass: `idea-pipeline.yaml` or its docs reference the `needs_design` signal from brainstorm.
- Pass: the routing logic handles `--design` (force on), `--skip-design` (force off), and neither (signal-driven with ties leaning design).

**AC-P3.6: No pipeline nesting**
- Pass: manual review confirms no state in `idea-pipeline.yaml` inlines another pipeline's state graph.
- Pass: `idea-pipeline.yaml` stops at `handoff`; it does not call `task-pipeline.yaml`.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Inherits the parent task 0167 Design section group A1 and the design doc's `idea-pipeline.yaml` contract, Design Step Routing, and HITL and Auto Mode sections.

**Approach:** Phase 3 builds the unified idea-to-feature entry point. One workflow YAML (`idea-pipeline.yaml`), one new command (`dev-idea`), one new cross-cutting section (Design Approval Gate), and dev-operations registration. No code changes — orchestration is configuration (ADR-022).

**Key design decisions (sliced from parent Design A1 + design doc):**

- **Why a workflow, not a skill (parent A1):** Orchestration is configuration (ADR-022). The workflow YAML orchestrates the flow; existing skills (`brainstorm`, `spec-decomposition`, `sys-architecture`) are invoked by `agent.run` steps. No orchestration logic in skill files.

- **State sequence (design doc idea-pipeline contract):** `start -> discovery -> feature-create -> ac-generate -> feature-check -> system-design -> decompose -> batch-create -> handoff`. The design doc's required actions table specifies each state's action kind: `discovery` = agent.run (sp:brainstorm); `feature-create` = spur feature create; `ac-generate` = write AC via spur feature update; `feature-check` = hitl.confirm (objective gate); `system-design` = agent.run (sp:sys-architecture); `decompose` = agent.run (sp:spec-decomposition); `batch-create` = hitl.confirm (objective gate); `handoff` = output only.

- **Design step routing (design doc Design Step Routing):** Three mechanisms — brainstorm design summary (always), system architecture step (conditional), design satellite generation (planning-pipeline, not this pipeline). The `needs_design` signal from brainstorm determines whether `system-design` runs. Flag truth table: `--design` forces on; `--skip-design` forces off; neither uses signal; ties run design.

- **Doc-sync boundary (parent R1, design doc Documentation Boundaries):** The `system-design` step creates initial design docs (ADR entries, architecture decisions, design satellites). This is fundamentally different from `wrapup-pipeline.yaml`'s `doc-sync` step (Phase 2), which handles post-implementation drift. Conflating these two is a correctness risk.

- **HITL gates (design doc HITL and Auto Mode):** `feature-check` and `batch-create` are objective gates — auto-routable under `--auto`. `design-approval` is a taste gate — NOT auto-clicked by `--auto` unless explicit prior approval is represented. Implementation rule: `--auto` sets `profile=auto`; YAML transitions route around auto-resolvable HITL states before entry.

- **Overlap with feature-dev.yaml (design doc overlap management):** `idea-pipeline.yaml` and `feature-dev.yaml` share brainstorm+plan steps intentionally. `idea-pipeline` stops at handoff (tasks created); `feature-dev` continues to execution. Different entry conditions (vague idea vs known feature), different exits. Rule: each pipeline is a self-contained phase boundary.

**Impacted surfaces (from parent Plan steps 13-17):**
- New: `config/workflows/idea-pipeline.yaml`, `plugins/sp/commands/dev-idea.md`
- Updated: `plugins/sp/skills/spur-dev/references/dev-operations.md` (idea operation), `plugins/sp/skills/spur-dev/references/cross-cutting.md` (Design Approval Gate section)
### Plan
Ordered checklist from parent task 0167 Plan Phase 3 (steps 13-17). Each step is sequential within the phase. Phase 2 (task 0169) must complete first.

- [x] Step 13: Create `config/workflows/idea-pipeline.yaml` state-machine workflow (start -> discovery -> feature-create -> ac-generate -> feature-check -> system-design -> decompose -> batch-create -> handoff). System-design step dispatches sp:sys-architecture with HITL approval gate; auto-detection (R2) uses `needs_design` signal from brainstorm (Phase 1, task 0168) to determine whether system-design runs; `--design`/`--skip-design` flags override auto-detection (R1, R2). Verify: `spur workflow validate .spur/workflows/idea-pipeline.yaml --json` exits 0.
- [x] Step 14: Create `plugins/sp/commands/dev-idea.md` command (thin wrapper: `spur workflow run .spur/workflows/idea-pipeline.yaml`) (R3). Verify: file exists with valid frontmatter delegating to `.spur/workflows/idea-pipeline.yaml`.
- [x] Step 15: Register `idea` operation in `plugins/sp/skills/spur-dev/references/dev-operations.md` (R4). Verify: `grep 'idea' plugins/sp/skills/spur-dev/references/dev-operations.md`.
- [x] Step 16: Add `## Design Approval Gate` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md` documenting the brainstorm hard gate (R5). Verify: `grep '## Design Approval Gate' plugins/sp/skills/spur-dev/references/cross-cutting.md`.
- [x] Step 17: Validate pipeline alignment: verify `idea-pipeline.yaml` stops at handoff, `feature-dev.yaml` continues to execution, no nesting (R6). Verify: manual review — no state in idea-pipeline calls another pipeline's state graph.
### Solution
Phase 3 Idea-to-Feature workflow implemented. One new workflow YAML, one new command, dev-operations registration, one new cross-cutting section. No code changes — orchestration is configuration (ADR-022).

**Change map:**

- `config/workflows/idea-pipeline.yaml:25` — new state-machine workflow (start -> discovery -> feature-create -> ac-generate -> feature-check -> system-design -> design-approval -> decompose -> batch-create -> handoff; conditional routing via `needs_design` signal + `design` var; `design-approval` is taste HITL with `pause: true`; no-nesting: no state calls task-pipeline or feature-dev)
- `plugins/sp/commands/dev-idea.md:7` — new command (thin wrapper: `spur workflow run .spur/workflows/idea-pipeline.yaml`; supports `--auto`, `--design`, `--skip-design`)
- `plugins/sp/skills/spur-dev/references/dev-operations.md:174` — registered operation #16 (idea); updated count 15 -> 16
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:323` — appended `## Design Approval Gate` section (taste gate documentation, `needs_design` routing table, auto-mode behavior)

**Rationale:** Phase 3 builds the unified idea-to-feature entry point per the design doc's idea-pipeline contract. The `needs_design` signal from brainstorm (Phase 1, task 0168 R3) determines whether `system-design` runs. `--design`/`--skip-design` flags override the signal. `design-approval` is a taste gate — NOT auto-clicked by `--auto` (Auto-Decision Principle #5). The pipeline stops at `handoff` — no task execution, no pipeline nesting. No new skills, no new lifecycle YAMLs — ADR-022 holds.
### Testing
**Verification commands and outcomes (all 6 ACs):**

AC-P3.1 (idea-pipeline.yaml validates):
- `spur workflow validate .spur/workflows/idea-pipeline.yaml --json` -> `{"valid": true, "ok": true}`, exit 0
- States present: start, discovery, feature-create, ac-generate, feature-check, system-design, design-approval, decompose, batch-create, handoff, cancelled
- Terminal states: handoff, cancelled

AC-P3.2 (dev-idea command):
- `test -f plugins/sp/commands/dev-idea.md` -> exists
- `grep -c '^description:' dev-idea.md` -> 1 (valid frontmatter)
- `grep -c 'idea-pipeline' dev-idea.md` -> 4 (delegates to idea-pipeline)
- `grep -c '\-\-auto'` -> 6, `grep -c '\-\-design'` -> 6, `grep -c '\-\-skip-design'` -> 6

AC-P3.3 (dev-operations registration):
- `grep -c '^### 16\. idea' dev-operations.md` -> 1

AC-P3.4 (Design Approval Gate documented):
- `grep -c '## Design Approval Gate' cross-cutting.md` -> 1
- `grep -ci 'not auto-clicked' cross-cutting.md` -> 1 (taste gate, not auto-clicked by --auto)
- `grep -c 'taste gate' cross-cutting.md` -> 6

AC-P3.5 (needs_design signal routing):
- `grep -c 'needs_design' idea-pipeline.yaml` -> 6 (signal referenced)
- `grep -c 'vars.design' idea-pipeline.yaml` -> 4 (force/skip/auto routing)
- `grep -c 'idea-needs-design' idea-pipeline.yaml` -> 4 (signal file read by guards)

AC-P3.6 (No pipeline nesting):
- `awk '/^states:/,/^transitions:/' idea-pipeline.yaml | grep 'task-pipeline|feature-dev'` -> (no matches in states section)
- `grep -c 'handoff' terminalStates` -> 1 (handoff is terminal)
- task-pipeline/feature-dev references are in header comments only (documentation, not state actions)

**Coverage claim:** N/A — Phase 3 is workflow YAML + command/reference work, no code to cover. R32/R33/R34 structural tests are added in Phase 6 (task 0173).

**Gate status:** All 6 ACs pass. `spur workflow validate` exits 0.
### Review
| Severity | File | Finding | Recommendation |
|---|---|---|---|
| P1 | — | None | — |
| P2 | — | None | — |
| P3 | config/workflows/idea-pipeline.yaml | feature-check guard runs `spur feature check` up to 3 times (one per transition guard attempt). The check is not cached between guard evaluations. | Accepted for v1 — idea-pipeline runs once per idea, not per task. The overhead is acceptable. Future optimization: cache the check result in a file and read it in subsequent guards. |
| P4 | config/workflows/idea-pipeline.yaml | batch-create guard runs `spur task batch-create` twice (success guard + failure guard). If the first guard succeeds and creates tasks, the second guard would fail (tasks already exist) — but declaration order means the success guard is tried first, so the failure guard never runs on success. | Accepted — declaration order ensures correctness. The failure guard only runs when the success guard fails (batch-create exits non-zero), so double-execution does not occur. |
| P4 | config/workflows/idea-pipeline.yaml | feature_id is passed via file (.spur/run/idea-feature-id.txt) rather than vars mutation. This is because the dual-workflow engine may not support mid-run var mutation. | Accepted — file-based handoff is the proven pattern (same as verify verdict in task-pipeline.yaml). |

**Residual risk:** Low. The idea-pipeline has not been end-to-end tested (Phase 6 dogfood will exercise it). The `needs_design` signal routing is validated by `spur workflow validate` but not exercised with a real brainstorm output. The `design-approval` gate's auto-skip (when `design_approved=true`) is implemented but not tested — it requires the operator to have explicitly set `design_approved` in vars.

**Final disposition:** PASS — all 6 ACs verified, workflow validates, no pipeline nesting, ADR-022 holds.
### References

I

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-01T20:57:22.098Z todo → wip (system)
- 2026-07-01T21:03:50.817Z wip → testing (system)
- 2026-07-01T21:03:52.473Z testing → done (system)
