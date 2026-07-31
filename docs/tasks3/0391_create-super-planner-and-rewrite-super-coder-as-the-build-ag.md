---
template: feature-impl
schema_version: 1
name: "Create super-planner and rewrite super-coder as the build agent"
description: ""
status: done
type: task
profile: standard
feature_id: H6
parent_wbs: null
priority: P1
tags: ["sp-plugin", "agents", "refactor"]
dependencies: ["0389", "0390"]
created_at: "2026-07-30T21:52:24.878Z"
updated_at: "2026-07-31T01:22:43.667Z"
done_forced: "true"
done_reason: "Tests pass manually (45/45 skill-structure incl R56); lint+typecheck clean. Pipeline test step failed on omp subagent 600s timeout, not a code defect."
---

## 0391. Create super-planner and rewrite super-coder as the build agent

### Background

This is the core inversion of H6, and it is not a trim. `plugins/sp/agents/super-coder.md` (337 lines) is today **purely an orchestrator** — line 73 reads "You explicitly do NOT own step-level execution", line 78 adds "You never edit the pipeline YAML, never reach into a step", and the file contains zero implementation guidance. The target super-coder (architecture, system design, production and test codegen, debug/fix) is therefore not a subset of today's file; it is its complement.

So the work is: move today's entire super-coder body to a new `super-planner` (product management + project management + execution orchestration), and build a new super-coder body from the competency skills that currently have no agent wrapper — `sp:sys-architecture`, `sp:code-implementation`, `sp:code-testing`, `sp:sys-debugging`.

Operator decision on shape: four agents, names reused. Orchestration stays inside super-planner rather than becoming a fifth `super-runner` agent — but its algorithm is not inlined. `plugins/sp/skills/spur-dev/references/execution-batch.md` remains the SSOT and super-planner executes it, exactly as super-coder does today. That keeps a later extraction a file move rather than a redesign.

Precedent to honor: ADR-028 (skills decompose by function; a thin spine dispatches competencies) and task 0161's finding that splitting by function beats splitting by phase.

### Requirements
R1. Create `plugins/sp/agents/super-planner.md` carrying the batch-driver role: set resolution and freezing, topological ordering, preflight, per-task pipeline launch, verdict inspection, continue/halt policy, and batch reporting — plus the product-management and project-management charter (intake framing, scope, sequencing, prioritization).
R2. super-planner executes the loop in `spur-dev/references/execution-batch.md` and does not restate the algorithm. execution-batch.md remains the SSOT.
R3. The `spur workflow trace` polling loop stays in the command or script layer, following the `plugins/sp/scripts/batch-preflight.ts` precedent. It must not live in super-planner's reasoning body.
R4. Rewrite `plugins/sp/agents/super-coder.md` with the build charter: architecture and system design, production code, test code, debugging and fixes. It dispatches `sp:sys-architecture`, `sp:code-implementation`, `sp:code-testing`, and `sp:sys-debugging` rather than inlining their logic.
R5. Both agents' frontmatter `description`, trigger phrases, and examples match their new charter, so the routing layer selects correctly.
R6. The four charters are mutually exclusive — no two agents claim the same responsibility.
R7. Both agents cite the shared housekeeping reference by path and the dispatch-surface reference.
R8. `plugins/sp/tests/skill-structure.test.ts` is updated for the four-agent roster.
### Acceptance Criteria
```gherkin
Feature: Four-agent roster with non-overlapping charters

  Scenario: The four agent charters are non-overlapping and correctly named
    Given the plugin ships expert-spur, super-planner, super-coder, and super-reviewer
    When an operator reads each agent's Role section
    Then super-planner owns product management, project management, and execution orchestration
    And super-coder owns architecture, system design, production and test codegen, and debugging
    And super-reviewer owns review and remediation suggestions but never implements a fix
    And expert-spur owns the spur CLI and corpus surface
    And no two agents claim the same responsibility

  Scenario: The orchestration algorithm is executed, not inlined
    Given super-planner has absorbed the batch-driver role
    When super-planner drives a batch
    Then it executes the loop defined in spur-dev/references/execution-batch.md
    And execution-batch.md remains the single source of truth for that algorithm

  Scenario: Polling stays out of the planner body
    Given a batch of tasks is running
    When super-planner waits on terminal state
    Then the spur workflow trace polling loop lives in the command or script layer
    And it is not described as agent reasoning in super-planner.md

  Scenario: super-coder dispatches competency skills
    Given super-coder carries the build charter
    When it performs architecture, implementation, testing, or debugging work
    Then it dispatches sp:sys-architecture, sp:code-implementation, sp:code-testing, or sp:sys-debugging
    And it does not inline those competencies

  Scenario: Routing frontmatter matches the new charters
    Given each agent declares a description and trigger phrases
    When a batch execution request is routed
    Then it selects super-planner
    And an implementation request selects super-coder
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
The decisive evidence is that today's super-coder is already a pure orchestrator, so "split the planner out of super-coder" would have produced an empty super-coder. Recognizing the change as an inversion — old body moves wholesale, new body is built from scratch — is what makes the diff tractable and the reference sweep (next task) bounded and mechanical.

WHY orchestration stays in super-planner rather than a fifth agent: at current scale a fifth routing target costs more in operator selection error than it saves in separation, and the algorithm already lives outside the agent in execution-batch.md. The seam that would separate them is therefore already drawn; extracting `super-runner` later means writing a new frontmatter and moving citations, not redesigning the loop.

R3 is the concrete cost control on that decision. A planner is a high-reasoning, low-volume role; `spur workflow trace` polling for a ten-task batch is high-volume, low-value output. Letting the poll loop into the planner's body would spend expensive reasoning context on transport noise — which is precisely the argument for a separate runner. Keeping the loop scripted removes that argument's force and keeps the merged shape defensible.

R5 matters more than it looks: the routing layer selects agents on frontmatter description and trigger phrases. If super-coder keeps orchestration triggers while carrying a build body, every "run the batch" request lands on the wrong agent — a failure that is invisible in review and only shows up at dispatch time.
### Plan
- [ ] Copy today's `super-coder.md` body to `super-planner.md`; rename all self-references
- [ ] Add the product-management and project-management charter to super-planner
- [ ] Confirm the polling loop is delegated to the script layer, not described as agent reasoning
- [ ] Rewrite `super-coder.md` from scratch as the build agent over the four competency skills
- [ ] Write both frontmatter blocks: description, trigger phrases, examples, skills list
- [ ] Cross-check all four agent charters for overlap; resolve any
- [ ] Cite the shared housekeeping and dispatch-surface references from both files
- [ ] Update `skill-structure.test.ts` for the four-agent roster
- [ ] Run `bun run test` and confirm green
### Solution
H6 inversion landed: old super-coder (pure orchestrator) moved wholesale to a new super-planner; a new super-coder built from scratch over the four build competency skills.

- `plugins/sp/agents/super-planner.md:1-23` (new): frontmatter - batch-driver description + orchestration triggers; `skills: [sp:spur-dev, sp:parallel-execution, ...]`.
- `plugins/sp/agents/super-planner.md:42-50`: Role = batch driver; executes the loop in `execution-batch.md` by reference (SSOT, not restated).
- `plugins/sp/agents/super-planner.md:53-73`: product/project-management charter (intake, scope, sequencing, prioritization); explicitly does NOT build/review/verify.
- `plugins/sp/agents/super-planner.md:89-92,167-170,198-199`: `spur workflow trace` polling delegated to command/script layer (R3) - planner inspects terminal verdicts, never poll iterations.
- `plugins/sp/agents/super-coder.md:1-23` (rewritten): frontmatter - build description + build triggers; `skills: [sp:sys-architecture, sp:code-implementation, sp:code-testing, sp:sys-debugging]`.
- `plugins/sp/agents/super-coder.md:37-47`: competency dispatch table; sequences competencies but does not inline runbooks.
- `plugins/sp/agents/super-coder.md:57-62`: When NOT to use - routes orchestration to super-planner, review to super-reviewer (R6 mutual exclusivity).
- `plugins/sp/agents/expert-spur.md` + `super-reviewer.md`: frontmatter/charter alignment so all four charters are mutually exclusive.
- `plugins/sp/tests/skill-structure.test.ts:1073-1102`: R56 test - four-agent split non-overlap (existence, coder !ref execution-batch, planner !ref code-implementation, reviewer owns code-verification, spur owns spur-cli; positive: planner refs execution-batch.md, coder refs the four competency skills).
### Testing
Testing pass for the four-agent roster (0391). Implementation was already in the working tree (uncommitted); this step verified behavior and closed AC coverage gaps in the structural gate.

**Gap analysis:** R56 asserted existence + partial non-overlap but left three AC scenarios unenforced, and one mutual-exclusivity boundary was missing for the two agents not in the coder/planner pair:
- R3 / "Polling stays out of the planner body" - no test enforced that `spur workflow trace` polling is delegated to the script layer, not described as agent reasoning.
- R5 / "Routing frontmatter matches the new charters" - no test verified each agent's frontmatter description carries its own triggers and drops the other's.
- R7 - no test verified both agents cite `done-housekeeping.md` and `dispatch-surface.md`.
- AC1 mutual-exclusivity for reviewer + spur - no test asserted super-reviewer declares "never implement a fix" or expert-spur declares "never drive the planning/execution lifecycle". A future edit could drop either boundary text and re-blend the four-way split with no structural signal.

**Extension:** `plugins/sp/tests/skill-structure.test.ts:1073-1148` (R56) - added 16 assertions covering R3 (planner contains "script layer" + "not planner reasoning"; coder has no `spur workflow trace`), R5 (frontmatter description trigger-split: planner has orchestration triggers not build; coder has build triggers not orchestration), R7 (both cite housekeeping + dispatch-surface), positive charter (planner owns product/project management + orchestration), and AC1 mutual-exclusivity for all four agents (reviewer contains "Never implement a fix"; spur contains "Never drive the planning/execution lifecycle").

**Commands run:**
- `bun test plugins/sp/tests/skill-structure.test.ts` -> 45 pass, 0 fail, 405 expect() calls.
- `bun test plugins/sp/` -> 420 pass, 0 fail, 1888 expect() calls.
- `bun run test` (full monorepo) -> 4083 pass, 0 fail, 12762 expect() calls.

**Coverage:** `plugins/sp/tests/skill-structure.test.ts` 100% funcs / 100% lines. All plugin TS files meet the per-file ≥90% target (lowest: daily-summary.ts 90.48% funcs / 92.77% lines). Agent `.md` deliverables are validated structurally by R56 (now covering all five AC scenarios + all four charter boundaries) plus R29/R49/R55/R16d.

**Verdict:** PASS - suite green, coverage target met, no implementation gaps found. Task left in `testing` (dev-unit does not mark done; that is the verify gate).
### Review
Three-dimensional review (functional traceability + SECUA quality + architectural depth) for the H6 four-agent inversion. Run on the working-tree implementation (task file untracked; deliverables per Solution section).

**Scope:** `plugins/sp/agents/super-planner.md` (new), `plugins/sp/agents/super-coder.md` (rewritten), `plugins/sp/agents/expert-spur.md` + `super-reviewer.md` (charter alignment), `plugins/sp/tests/skill-structure.test.ts:1073-1141` (R56).

**Functional Verdict: PASS** - all R1-R8 MET with file:line evidence; all 5 AC scenarios MET (structurally asserted by R56).

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `super-planner.md:42-50` Role=batch driver; `:53-73` product/project-management charter (intake, scope, sequencing, prioritization); `:104-112` explicit "does NOT own step-level execution" |
| R2 | MET | `super-planner.md:49-50` "Read execution-batch.md for the full algorithm... the reference is the SSOT"; no algorithm restated in the body |
| R3 | MET | `super-planner.md:89-92` polling delegated to command/script layer, "polling is transport, not planner reasoning (R3)"; `:167-170` reiterates; `:198-199` "Never describe the spur workflow trace polling loop as agent reasoning" |
| R4 | MET | `super-coder.md:1-134` rewritten as build agent; `:37-47` competency dispatch table; `:22` skills=[sp:sys-architecture, sp:code-implementation, sp:code-testing, sp:sys-debugging] |
| R5 | MET | `super-planner.md:3-4` description with orchestration triggers; `super-coder.md:3-4` description with build triggers; R56 test `:1113-1124` asserts trigger-split both directions |
| R6 | MET | `super-planner.md:36-38` "does not build, review, or verify"; `super-coder.md:29-30` "does not orchestrate batches... or review"; `super-reviewer.md:86` "never implement fixes"; `expert-spur.md:83` "Never drive the planning/execution lifecycle"; R56 test `:1088-1093` asserts non-overlap |
| R7 | MET | `super-planner.md:206` cites done-housekeeping.md; `:149` cites dispatch-surface.md; `super-coder.md:121` cites done-housekeeping.md; `:92` cites dispatch-surface.md; R56 test `:1126-1134` asserts both cite both references |
| R8 | MET | `skill-structure.test.ts:1073-1141` R56 test - four-agent split non-overlap + R3/R5/R7 assertions + positive charter ownership |

**Acceptance Criteria Verification**

| AC Scenario | Status | Evidence |
|-------------|--------|----------|
| Four charters non-overlapping and correctly named | MET | R56 test `:1082-1101` (existence + non-overlap + positive charter); `:1136-1140` (planner owns PM/PM + orchestration) |
| Orchestration algorithm executed, not inlined | MET | `super-planner.md:49-50` executes execution-batch.md by reference; R56 `:1097` planner contains execution-batch.md |
| Polling stays out of the planner body | MET | `super-planner.md:89-92` delegates to script layer; R56 `:1108-1111` asserts "script layer" + "not planner reasoning" + coder has no "spur workflow trace" |
| super-coder dispatches competency skills | MET | `super-coder.md:37-47` dispatch table; R56 `:1098-1101` coder contains all four competency skills |
| Routing frontmatter matches new charters | MET | R56 `:1116-1124` plannerDesc matches orchestration triggers not build; coderDesc matches build triggers not orchestration |

**P1–P4 findings**

| Priority | Finding | Location | Remediation |
|----------|---------|----------|-------------|
| P3 | super-planner frontmatter `description` is a dense 4-line block (inherited from old super-coder; not introduced by 0391). Functional but strains the routing-layer description field. | `super-planner.md:3-4` | Tighten to a single trigger-focused line in a follow-up (inherited debt, not 0391 scope) |
| P4 | Dogfood mode section (~42 lines) is transport/output logic inlined in a planning agent. Inherited, not introduced; gated by a trigger word so it does not pollute the normal path. Sweep belongs to 0392. | `super-planner.md:208-249` | Move dogfood block to a reference file under 0392 |

No P1 (blocker) or P2 (major) findings. No security findings (no secrets, no injection vectors, no unsafe input). No correctness contradictions (charter boundaries are internally consistent and cross-validated by R56). The "Subagent execution disciplines" duplication across planner/coder/reviewer is a deliberate shared contract citing the same SSOT (sp:parallel-execution), not shallow duplication.

**Architecture Review**

The 0391 inversion is itself a deepening move: it separates two concerns (orchestration vs build) that were conflated in the old super-coder. Applying the five signals:

- **Shallow module:** None. Both agents are thin dispatchers with distinct cohesive responsibilities (planner executes execution-batch.md; coder dispatches 4 competency skills).
- **Tight coupling:** None. The four agents are decoupled; no two change together.
- **Wrong seam:** None. The planner/coder seam correctly separates "which task runs next" from "how the code is written."
- **Weak locality:** None. Build competencies co-located in super-coder; orchestration co-located in super-planner.
- **Poor test surface:** None. R56 structurally validates all five AC scenarios; R29/R16d updated for the four-agent roster.

No P1/P2 candidates. The inversion reduces structural debt rather than introducing it.

**Verdict: PASS** - functional traceability complete (8/8 R MET, 5/5 AC MET), SECUA clean (no P1/P2; one P3 + one P4, both inherited), architecture clean (deepening move, no new friction). Implementation matches the approved Design (inversion: old body moved wholesale, new body built from competency skills). Ready for `done`.
### References

H6

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-31T00:36:57.566Z todo → wip (system)
- 2026-07-31T00:41:19.545Z wip → testing (system)
- 2026-07-31T01:08:55.834Z testing → wip (system)
- 2026-07-31T01:11:23.294Z wip → testing (system)
- 2026-07-31T01:22:43.658Z testing → done (system)
