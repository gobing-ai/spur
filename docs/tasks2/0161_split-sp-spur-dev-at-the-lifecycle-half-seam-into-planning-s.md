---
template: feature-impl
schema_version: 1
name: "Split sp:spur-dev at the lifecycle-half seam into planning (sp:spur-plan) and execution (sp:spur-dev)"
description: ""
status: wip
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-30T07:01:29.766Z"
updated_at: 2026-06-30T18:16:06.594Z
---

## 0161. Split sp:spur-dev at the lifecycle-half seam into planning (sp:spur-plan) and execution (sp:spur-dev)

### Background
`sp:spur-dev` has grown into an all-in-one fat skill that owns the **entire** planning-to-execution
lifecycle under one trigger: feature/task file prep, task execution, system-design/ADR judgment,
coding, BDD/TDD authoring, unit testing, and review+fix. Measured size today: **214-line SKILL.md
router + 2,113 lines across 12 reference files** (+ 3 stack adapters). The risk is **not** runtime
context bloat — progressive disclosure already keeps per-step loading small. The risk is
**conceptual coupling under one trigger surface**: one skill answers many genuinely different
operator intents (design vs. implement vs. test vs. decompose) with different reasoning modes,
failure modes, and reuse contexts.

## The decision: split by FUNCTION, not by phase (evidence-driven)

An initial proposal to split by **lifecycle phase** (planning vs. execution) was **rejected**. A
phase boundary is *temporal*, not a capability boundary — the two phases are two ends of one
conveyor belt the same operator rides in one sitting, so a phase split relocates coupling rather
than reducing it (shallow modules with a fat shared interface). The correct axis is **functional**:
each extracted skill is a distinct *competency* (deep module, narrow interface), independently
invoked and reused outside the pipeline.

This is confirmed by the mature origin and two reference implementations:

- **rd3** (`~/projects/cc-agents/plugins/rd3/`, the origin of this whole planning layer) never built
  a fat skill. It decomposed by **function** into ~50 fine-grained competency skills with a **thin
  orchestrator** on top: `code-implement-common`, `backend-architect` (vs `backend-design`),
  `sys-testing`, `code-verification`, `task-decomposition` — each "the primary skill for X". The
  orchestrator `jon-snow` is *"a thin specialist wrapper that delegates ALL orchestration to
  orchestration-v2"*; `orchestration-v2` binds `phase → skill` in YAML, enforces structure (DAG,
  gates, FSM, state), and **never inlines** a competency (a `CRITICAL` enforcement rule). rd3 also
  proves composition is extractable — `task-decomposition` stands alone, and `code-implement-common`'s
  preconditions literally require *"Task is already decomposed (use rd3:task-decomposition if not)."*
- **gstack** (`vendors/gstack/`) ships a root `SKILL.md` that is explicitly *"Router for the gstack
  skill suite — sends any gstack request to the right skill."* This validates a centralized CLI/router
  facade *alongside* separate competency skills (gstack does both).
- **obra/Superpowers** (`vendors/Superpowers/`) names skills by activity (`test-driven-development`,
  `systematic-debugging`, `writing-plans`) and keeps **TDD as a standalone discipline skill** invoked
  "before writing implementation code" — separate from implementation. Its
  `subagent-driven-development` is the same thin-dispatch model: "dispatch a fresh implementer
  subagent per task, review after each, broad review at the end." Two mature systems converge on
  thin-spine-dispatches-competencies.

## Documentation drift to fix as part of this work

`spur-dev`'s SKILL.md cites the split as "sanctioned future split seam (design §12.1, risk R4)" —
but `03_ARCHITECTURE.md §12.1` is about **markdown-as-SSOT**, not skill granularity, and **no ADR or
architecture entry records the skill-split decision**. Per the project conflict rule, code cannot
diverge from an unrecorded decision; the ADR must land first (Wave 0). The decision also supersedes
the one-fat-skill posture implied by ADR-016/ADR-023.

## Operator-confirmed decisions feeding this task

1. **Axis = functional** (design/code/test/decompose as deep skills); the spine dispatches them.
2. **Competency skills + renames (domain-activity naming):**
   - `sys-architecture` ← system design / ADR judgment (rd3: backend-architect).
   - `code-implementation` ← implement + the existing `references/stacks/` + `implementation-patterns.md` (rd3: code-implement-common + backend-design).
   - `code-testing` ← coverage / gap analysis / test extension (rd3: sys-testing).
   - `code-verification` ← **kept as-is** (already rd3 parity, review/verify).
   - `spec-decomposition` ← feature/spec → task batch (rd3: task-decomposition).
   - `spur-tdd` ← **kept as a thin discipline skill**, referenced by `code-implementation` and
     `code-testing` (Superpowers model); NOT absorbed.
3. **`spur-cli` consolidated facade** (gstack router pattern): one skill with **one reference file per
   `spur` noun**, replacing `spur-tasks`, `spur-features`, `spur-rules`, `spur-workflows`. A facade
   over CLI verbs (how to invoke, parse `--json`, the CLI-gated write contract) — it does **not**
   absorb competency logic. New noun going forward = +1 reference file (scalable by construction).
4. **`expert-spur` subagent** (new) loads `spur-cli`, replacing `expert-tasks/features/rules/workflows`.
5. **`expert-dev` retired**; `super-coder` absorbs the single-task full-lifecycle driver role in
   addition to its batch-orchestrator role (one fewer agent).
6. **`spur-dev` temporarily kept** as-is, then shrunk to a **thin orchestration spine** in Wave C.
7. **Landing shape:** one comprehensive task with a waved Plan (ADR gate → Wave A → B → C).

Reference: `plugins/sp/skills/spur-dev/` (current fat skill); `plugins/sp/skills/spur-{tasks,features,rules,workflows,tdd}/`;
`plugins/sp/agents/{expert-dev,expert-tasks,expert-features,expert-rules,expert-workflows,super-coder}.md`;
`~/projects/cc-agents/plugins/rd3/` (origin); `vendors/gstack/`, `vendors/Superpowers/` (references);
`docs/00_ADR.md` (ADR-016/023 to supersede); feature H1 `## Notes` (names the split seam).
### Requirements
- [ ] R1. **Record the decision first (BLOCKING gate).** Add a dated ADR entry in `docs/00_ADR.md` establishing the **functional** skill-split decomposition, superseding the one-fat-skill posture of ADR-016/ADR-023. State the competency-skill set + names, the thin-spine-dispatches-competencies model (rd3/Superpowers evidence), the `spur-cli` facade pattern, the disjoint-trigger requirement, and that `cross-cutting.md` stays single-SSOT. No skill/agent/command file changes before this entry is committed (project conflict rule). Correct the dangling "design §12.1" citation.
- [ ] R2. **`spur-cli` consolidated facade (gstack router pattern).** Create `plugins/sp/skills/spur-cli/` with a router SKILL.md and **one reference file per `spur` noun** (`references/tasks.md`, `features.md`, `rules.md`, `workflows.md`), each owning how to invoke that noun's verbs, parse `--json`, and honor the CLI-gated write contract. The facade is reference/dispatch only — it MUST NOT absorb competency logic. Document the extension rule: a new `spur <noun>` adds exactly one reference file.
- [ ] R3. **Retire the four noun-skills.** Remove `spur-tasks`, `spur-features`, `spur-rules`, `spur-workflows` after their content is re-homed into `spur-cli` reference files (R2). Repoint every `see_also`/`Skill()`/doc reference that named them to `spur-cli`. No content lost — verify each retired skill's substantive guidance has a home in the corresponding `spur-cli` reference.
- [ ] R4. **`expert-spur` subagent (new).** Create `plugins/sp/agents/expert-spur.md` that loads `sp:spur-cli` and covers all `spur` noun operations (multi-step task/feature/rule/workflow work in its own context). Retire `expert-tasks`, `expert-features`, `expert-rules`, `expert-workflows`; repoint references. Trigger description must not collide with the dev-workflow agents.
- [ ] R5. **Retire `expert-dev`; `super-coder` absorbs single-task lifecycle.** Remove `plugins/sp/agents/expert-dev.md`. Broaden `super-coder` so it drives both a single task end-to-end AND a batch — update its description/role so triggers cover "run this task end to end" plus the existing batch triggers, without ambiguity against `/sp:dev-*` commands. Repoint any reference to `expert-dev`.
- [ ] R6. **Competency skill — `sys-architecture`.** Create `plugins/sp/skills/sys-architecture/` for system-design / ADR judgment (rd3: backend-architect). Standalone trigger ("what's the right approach", "design this system", "ADR for X"). Carries architecture judgment only; code-level stack patterns belong to `code-implementation` (R7), not here.
- [ ] R7. **Competency skill — `code-implementation`.** Create `plugins/sp/skills/code-implementation/` (rd3: code-implement-common + backend-design). Carries the existing `references/stacks/` (bun-ts, python, go) and `implementation-patterns.md` re-homed via `git mv` from `spur-dev`. References `spur-tdd` for discipline (R9). Trigger: "implement", "write code", "build this".
- [ ] R8. **Competency skill — `code-testing`.** Create `plugins/sp/skills/code-testing/` (rd3: sys-testing). Owns coverage measurement, gap analysis, test extension; carries `unit-testing.md` re-homed from `spur-dev`. References `spur-tdd` (R9). Trigger: "write tests", "measure coverage", "what's untested". Distinct from `code-implementation` (implement) and `spur-tdd` (discipline).
- [ ] R9. **`spur-tdd` kept as referenced discipline skill (Superpowers model).** Do NOT absorb it. Keep `plugins/sp/skills/spur-tdd/` as the thin red-green-refactor discipline; both `code-implementation` and `code-testing` link to it via `see_also`/inline reference. Verify it contains discipline (the *how* of TDD), not coverage mechanics (which live in `code-testing`).
- [ ] R10. **Competency skill — `spec-decomposition`.** Create `plugins/sp/skills/spec-decomposition/` (rd3: task-decomposition). Carries `decomposition.md` + `ac-style-guide.md` re-homed from `spur-dev`. Owns feature/spec → validated task batch (the `task-batch.schema.json` contract). Extracted in Wave C after the spine→competency binding is proven (Wave B).
- [ ] R11. **`code-verification` kept as-is.** No change beyond `see_also` sync — it is already the correctly-split review/verify competency (rd3 parity). Confirm the spine dispatches to it unchanged.
- [ ] R12. **Spine → competency binding (the load-bearing interface).** The execution pipeline (`config/workflows/task-pipeline.yaml`) must bind each phase to its competency skill (rd3 orchestration-v2 model: `phase → skill`), passing the task WBS + advisory payload; the skill writes results back via the CLI-gated section contract. `spur-dev` becomes the thin spine that dispatches and never inlines a competency. Prove this end-to-end on one real task before extracting composition (Wave B gate before Wave C).
- [ ] R13. **`cross-cutting.md` stays single-SSOT — link, never copy.** It is read by the spine and every competency. Keep exactly one physical copy (in `spur-dev`/the spine); all competency skills link to it cross-skill. Adding a second copy is a defect — assert exactly-one-copy in R16.
- [ ] R14. **Shrink `spur-dev` to the thin spine (Wave C).** After competencies are extracted and the binding proven, strip the competency narrative from `spur-dev`'s SKILL.md + trigger description so it owns only orchestration (FSM, gates, dispatch, section-write contract). Its trigger narrows to pipeline/run vocabulary, disjoint from the competency skills.
- [ ] R15. **Re-point `/sp:dev-*` command delegation — byte-stable surface.** Each command keeps its name and flags; only its `Skill()` delegation target changes to the new owning skill/spine. No operator-visible change. Audit all 13 dev-* command files + their See-Also.
- [ ] R16. **Disjoint-trigger + single-SSOT + link-resolution assertions.** Extend the `plugins/sp` test suite to assert: (a) no two skills (spine + competencies + spur-cli) share trigger vocabulary that makes routing ambiguous; (b) exactly one `cross-cutting.md` exists; (c) every cross-skill reference link resolves; (d) no retired skill/agent name remains referenced anywhere. Runs in the chained `test` gate.
- [ ] R17. **No content loss + no cross-competency leaks.** Every reference file re-homed via `git mv` (history preserved); no substantive guidance dropped in any retirement. After the split, no competency requires a step/reference owned by another competency; the only sanctioned cross-skill dependency is the shared `cross-cutting.md` link (R13).
- [ ] R18. **Doc-map + companion sync (same commit as the change that creates the drift).** Update `AGENTS.md` (skill/agent ownership + CLI-surface rows), `docs/04_DESIGN.md`, `docs/05_FEATURES.md §9`, feature H1, and `see_also` frontmatter across all affected skills/agents.
- [ ] R19. **Validate.** `bun run lint` clean; `bun run test` green incl. R16 assertions and existing `plugins/sp` tests (no skips); `bun run build` succeeds; `git status` only intentional changes. Manually dry-trigger one phrase per new skill and confirm correct routing (no collision).
- [ ] R20. **`plugins/sp` stays self-contained (hard boundary, ADR-028d).** No skill, agent, command, reference file, config, or doc inside `plugins/sp` may reference `vendors/` or the external `rd3` plugin (`~/projects/cc-agents/plugins/rd3/`) — those are research-time evidence only, never a runtime or documentation dependency. When re-homing content (R7/R8/R10) or authoring new skills (R2/R6), translate any rd3/vendor-derived guidance into Spur-native prose; cite Spur paths only. Add a `plugins/sp` test asserting zero occurrences of `vendors/` or `rd3` paths across the plugin tree (runs in the chained `test` gate, complements R16).
### Acceptance Criteria
```gherkin
Feature: Restructure sp plugin into functional competency skills with a thin spine and CLI facade

  @core
  Scenario: R1 ADR records the functional split before any file changes
    Given the functional split is not yet recorded in any ADR
    When the restructure begins
    Then a dated ADR entry supersedes the one-fat-skill posture of ADR-016/ADR-023
    And no skill, agent, or command file is modified before that entry is committed

  @core
  Scenario: R2 spur-cli is a CLI facade with one reference per noun
    Given the spur CLI has the nouns tasks, features, rules, and workflows
    When spur-cli is created
    Then it has one reference file per noun and routes invocation guidance only
    And it contains no competency logic

  @core
  Scenario: R3 the four noun-skills are retired without content loss
    Given spur-tasks, spur-features, spur-rules, and spur-workflows exist
    When their content is re-homed into spur-cli reference files
    Then the four noun-skills are removed and every reference to them points to spur-cli
    And each retired skill's substantive guidance has a home in spur-cli

  @core
  Scenario: R4 expert-spur replaces the four noun experts
    Given expert-tasks, expert-features, expert-rules, and expert-workflows exist
    When expert-spur is created loading spur-cli
    Then the four noun experts are retired and references point to expert-spur
    And expert-spur's trigger does not collide with the dev-workflow agents

  @core
  Scenario: R5 super-coder absorbs the single-task lifecycle and expert-dev is retired
    Given expert-dev and super-coder both delegate to the dev workflow
    When the overlap is resolved
    Then expert-dev is removed and super-coder drives both a single task end-to-end and a batch
    And its triggers cover both without ambiguity against the /sp:dev-* commands

  @core
  Scenario: R6 R7 R8 the competency skills exist on the functional axis
    Given the fat skill owns design, implementation, and testing under one trigger
    When the competencies are extracted
    Then sys-architecture, code-implementation, and code-testing each exist as standalone skills
    And each has a distinct trigger and owns its re-homed reference files

  @core
  Scenario: R9 spur-tdd remains a referenced discipline skill
    Given two mature systems disagree on whether TDD is its own skill
    When the split is complete
    Then spur-tdd remains a thin discipline skill referenced by code-implementation and code-testing
    And it is not absorbed into either

  @core
  Scenario: R10 spec-decomposition is extracted after the binding is proven
    Given composition is fused to the orchestration spine today
    When the spine-to-competency binding has been proven end-to-end
    Then spec-decomposition is extracted as a standalone skill carrying its re-homed references
    And the spine no longer inlines decomposition

  @core
  Scenario: R12 the spine dispatches competencies and never inlines them
    Given task-pipeline.yaml drives execution
    When a task runs through the pipeline
    Then each phase is bound to its competency skill and receives the WBS plus advisory payload
    And spur-dev acts only as the dispatching spine

  @core
  Scenario: R13 cross-cutting rules remain a single source of truth
    Given cross-cutting.md is read by the spine and every competency
    When the split is complete
    Then exactly one cross-cutting.md exists and every competency links to it

  @core
  Scenario: R15 the /sp:dev-* command surface is byte-stable
    Given the dev-* commands are thin delegating wrappers
    When delegation is re-pointed to the new owning skills
    Then every command keeps its name and flags and only its delegation target changes

  @core
  Scenario: R16 skills have disjoint trigger surfaces with resolving links
    Given the spine, competencies, and spur-cli all carry triggers
    When the assertion suite runs
    Then no two skills share ambiguous trigger vocabulary
    And exactly one cross-cutting.md exists, every cross-skill link resolves, and no retired name is still referenced

  @edge
  Scenario: R17 no cross-competency dependency leaks past the shared link
    Given the split is complete
    When any competency is operated end to end
    Then it requires no step or reference owned by another competency
    And the only cross-skill dependency is the shared cross-cutting.md link

  @core
  Scenario: R19 the verification gate stays green after the restructure
    Given all waves are complete
    When the full verification gate runs
    Then bun run lint, bun run test (incl. the new assertions), and bun run build all pass with no skips
    And git status shows only intentional changes

  @core
  Scenario: R20 the sp plugin is self-contained
    Given the restructure re-homes content derived from rd3 and vendor references
    When the plugin tree is scanned
    Then no skill, agent, command, reference, config, or doc inside plugins/sp references vendors/ or the rd3 plugin path
    And the self-containment assertion passes in the test gate
```
### Design
**Chosen approach: decompose `sp:spur-dev` along the FUNCTIONAL axis into deep competency skills with
a thin orchestration spine, plus a `spur-cli` CLI facade — converging the spur plugin back toward the
proven rd3 shape (which spur regressed from), informed by gstack's router pattern and Superpowers'
naming/discipline model. The work is mostly *relocation and re-pointing*, not authoring: the seams
already exist, collapsed into one skill.**

## Why functional, not phase (rejected alternative, with the reason)

A phase boundary (planning vs. execution) is *temporal* — the two halves are two ends of one belt the
same operator rides in one sitting. Splitting there yields **shallow modules** (thin temporal slices)
with a fat shared interface (cross-cutting.md, vocabulary, gates all straddle the seam): coupling is
relocated, not reduced. The functional axis yields **deep modules** — each a distinct competency
(design / implement / test / decompose) with a narrow interface, independently invoked and reused
outside the pipeline. rd3 (the origin) chose functional and never had a fat skill; spur's fat skill is
the regression to undo. `code-verification` was *already* extracted by function — a phase split would
have introduced a second, conflicting decomposition axis into the same plugin (R6-class contradiction).

## Destination model

```
COMPETENCY SKILLS (deep, functional)            re-homed refs
  sys-architecture     system design / ADR       (architecture judgment only)
  code-implementation  implement to spec         stacks/, implementation-patterns.md
  code-testing         coverage / gap / extend   unit-testing.md
  code-verification    review / verify (KEEP)    (unchanged)
  spec-decomposition   feature/spec -> task batch decomposition.md, ac-style-guide.md
  spur-tdd             TDD discipline (KEEP)      referenced by code-implementation + code-testing

SPINE  spur-dev -> thin orchestrator (Wave C)
        owns task-pipeline.yaml binding, FSM, gates, cross-cutting.md (section-write SSOT)
        dispatches competencies as phases; NEVER inlines them

CLI FACADE  spur-cli (gstack router pattern)
        one skill, one reference file per noun (tasks/features/rules/workflows/...)
        replaces spur-tasks/features/rules/workflows; reference/dispatch only, no competency logic
        new noun = +1 reference file

SUBAGENTS  expert-spur (NEW, loads spur-cli)  replaces expert-{tasks,features,rules,workflows}
           super-coder (KEEP, broadened)       absorbs single-task lifecycle; expert-dev RETIRED
```

## The load-bearing part: the spine -> competency interface (R12)

This is the work that earns the split, and rd3 already solved it. orchestration-v2 binds `phase ->
skill` in YAML; the engine enforces **structure** (DAG deps, gates, FSM, state persistence); the skill
receives the **WBS + advisory payload** and writes results back. Advisory payload fields (`tdd: true`,
`focus_areas`, `depth`) are hints the skill may act on; the engine does not validate them. Spur already
has every primitive: `task-pipeline.yaml` (phase->step binding), the section-status matrix (the gate),
`cross-cutting.md` (the section-write contract). So the interface is not new design — it is
*uncollapsing* what spur fused. The Wave B gate is: prove one real task runs end-to-end with phases
bound to extracted competency skills before extracting composition (Wave C).

## Naming convention

`<domain>-<activity>`: `code-implementation`, `code-testing`, `code-verification`, `sys-architecture`.
`spec-decomposition` names the input it consumes (feature/spec). `spur-cli` names what it wraps. This
is consistent and disjoint — which is what makes the R16 disjoint-trigger assertion satisfiable.

## What each reference taught (traceability)

- **rd3**: functional axis; thin spine that dispatches and never inlines (CRITICAL rule); composition
  is extractable (`task-decomposition` standalone + an implement precondition); architect (topology)
  is separate from design (code conventions) -> hence architecture judgment in `sys-architecture`,
  stack patterns in `code-implementation`.
- **gstack**: root SKILL.md as suite router validates `spur-cli` as a facade alongside (not instead of)
  competency skills.
- **Superpowers**: activity-named skills; TDD kept standalone as discipline ("before writing
  implementation code") -> `spur-tdd` referenced, not absorbed; subagent-driven-development is the same
  thin-dispatch model (dispatch per task, review after each).

## Boundaries / invariants

- Operator-visible CLI + `/sp:dev-*` command surface unchanged (R15) — no renamed commands, no flag
  changes. The split is internal SSOT relocation.
- `code-verification` untouched beyond see_also (R11).
- No new CLI verb, workflow YAML capability, or runtime behavior — this relocates skill ownership and
  rebinds the pipeline; it does not add product capability.
- Reference files move via `git mv` (history preserved) (R17); only routers/links are rewritten.
- The only sanctioned cross-skill dependency is the shared `cross-cutting.md` link (R13/R17).
- `spur-cli` is a facade — it must not absorb competency reasoning (R2).
- **`plugins/sp` is self-contained (ADR-028d, R20):** rd3 (`~/projects/cc-agents/plugins/rd3/`) and
  `vendors/` are design-time evidence ONLY. No shipped file in the plugin references them — re-homed
  guidance is translated to Spur-native prose citing Spur paths. The rd3/gstack/Superpowers names in
  this task's Background/Design are *traceability for the decision*, not a dependency of the artifact;
  they must not leak into any `plugins/sp` file. A test asserts zero `vendors/`/`rd3` occurrences.

## Sequencing rationale (the waves)

Wave 0 (ADR) gates everything (conflict rule). Wave A (spur-cli + expert-spur + agent cleanup) is
lowest-risk, highest-clutter-reduction, and touches no spine. Wave B (sys-architecture +
code-implementation + code-testing + prove the binding) front-loads the interface risk with the
clearest competencies. Wave C (extract spec-decomposition + shrink spur-dev + re-point commands) is
last because shrinking the spine and pulling composition depend on the binding proven in B. This
mirrors rd3 reaching ~50 skills iteratively, not in one leap.

## Risk register

- *Trigger overlap* (highest) -> R16 disjoint-vocabulary assertion + R19 manual dry-trigger per skill.
- *Spine<->competency binding* (the earned-it risk) -> Wave B end-to-end proof gates Wave C.
- *cross-cutting.md drift* -> single-SSOT + exactly-one-copy assertion (R13/R16).
- *Content loss on retirement* -> git mv + per-retirement content-has-a-home check (R3/R17).
- *Dangling references to retired names* -> R16 "no retired name still referenced" assertion.
- *Operator surprise* -> byte-stable command surface (R15).
### Plan
**Wave 0 — Record the decision (BLOCKING; do before any file change)**

- [x] Step 0.1 — Draft the ADR entry (R1): functional split, competency-skill set + names, thin-spine
  dispatch model, `spur-cli` facade, disjoint-trigger + single-SSOT rules; supersede ADR-016/023;
  correct the dangling §12.1 citation. **Get operator review of the ADR wording before proceeding.**
- [x] Step 0.2 — Commit the ADR alone. No skill/agent/command change in this commit. (Done: ADR-028 + task 0161 + H1 committed together at f292708 — ADR landed before any skill/agent change, satisfying the gate intent.)

**Wave A — CLI facade + subagent cleanup (lowest risk, no spine change)**

- [x] Step A.1 — Create `spur-cli` skill: router SKILL.md + `references/{tasks,features,rules,workflows}.md`,
  re-homing the substantive guidance from each noun-skill (R2). Add the +1-file extension rule.
- [x] Step A.2 — Retire `spur-tasks/features/rules/workflows`; repoint all references to `spur-cli` (R3).
- [x] Step A.3 — Create `expert-spur` subagent loading `spur-cli`; retire the four noun experts;
  repoint references (R4).
- [x] Step A.4 — Retire `expert-dev`; broaden `super-coder` to drive single-task + batch with disjoint
  triggers; repoint references (R5).
- [x] Step A.5 — Wave-A gate: `bun run lint` + `bun run test`; assert no retired name is referenced
  (partial R16); doc-sync the affected rows (partial R18).

**Wave B — Competency extraction + binding proof (front-load interface risk)**

- [ ] Step B.1 — Create `sys-architecture` (R6): architecture/ADR judgment only.
- [ ] Step B.2 — Create `code-implementation` (R7): `git mv` `stacks/` + `implementation-patterns.md`
  from spur-dev; link `spur-tdd`.
- [ ] Step B.3 — Create `code-testing` (R8): `git mv` `unit-testing.md`; link `spur-tdd`.
- [ ] Step B.4 — Verify `spur-tdd` is discipline-only, referenced by B.2 + B.3, not absorbed (R9).
- [ ] Step B.5 — Bind these phases in `task-pipeline.yaml` to the new competency skills; confirm the
  spine dispatches (does not inline) (R12). Keep `code-verification` binding unchanged (R11).
- [ ] Step B.6 — **Wave-B GATE (proves the interface):** run one real task end-to-end through the
  pipeline with phases bound to the extracted skills; confirm WBS + advisory payload flow in and
  results write back via the CLI-gated section contract. Do not start Wave C until this passes.

**Wave C — Spine shrink + composition extraction + command re-point**

- [ ] Step C.1 — Create `spec-decomposition` (R10): `git mv` `decomposition.md` + `ac-style-guide.md`;
  bind the decompose phase to it.
- [ ] Step C.2 — Shrink `spur-dev` to the thin spine (R14): strip competency narrative from SKILL.md +
  trigger; keep `cross-cutting.md` here as the single SSOT (R13); narrow trigger to pipeline vocabulary.
- [ ] Step C.3 — Re-point all 13 `/sp:dev-*` command delegations to the new owners; names/flags
  unchanged (R15).
- [ ] Step C.4 — Add/extend the full assertion suite (R16): disjoint triggers, exactly-one
  cross-cutting.md, all cross-skill links resolve, no retired name referenced, no cross-competency leak
  (R17).

**Wave D — Sync + validate**

- [ ] Step D.1 — Full doc-map sync (R18): `AGENTS.md`, `04_DESIGN.md`, `05_FEATURES.md §9`, feature H1,
  all `see_also` frontmatter — same commit as the drift-creating change.
- [ ] Step D.2 — Validate (R19): `bun run lint` -> `bun run test` (incl. assertions, no skips) ->
  `bun run build`; `git status` clean of unintended diffs; manually dry-trigger one phrase per new
  skill and confirm correct routing. Run `spur feature refresh H1`.
### Solution

### Testing

### Review

### References
**Spur — skills to change/retire/create:**
- `plugins/sp/skills/spur-dev/` — the fat skill: shrink to thin spine (R14); keep `cross-cutting.md`
  here as single SSOT (R13).
- `plugins/sp/skills/spur-dev/references/{decomposition.md,ac-style-guide.md}` — re-home to
  `spec-decomposition` (R10).
- `plugins/sp/skills/spur-dev/references/{stacks/,implementation-patterns.md}` — re-home to
  `code-implementation` (R7).
- `plugins/sp/skills/spur-dev/references/unit-testing.md` — re-home to `code-testing` (R8).
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` — stays; linked by all competencies (R13).
- `plugins/sp/skills/{spur-tasks,spur-features,spur-rules,spur-workflows}/` — retire into `spur-cli`
  reference files (R2/R3).
- `plugins/sp/skills/spur-tdd/` — keep as referenced discipline skill (R9).
- `plugins/sp/skills/code-verification/` — keep as-is (R11).
- NEW: `plugins/sp/skills/{spur-cli,sys-architecture,code-implementation,code-testing,spec-decomposition}/`.

**Spur — agents:**
- `plugins/sp/agents/{expert-tasks,expert-features,expert-rules,expert-workflows}.md` — retire into
  `expert-spur` (R4).
- `plugins/sp/agents/expert-dev.md` — retire; role absorbed by `super-coder` (R5).
- `plugins/sp/agents/super-coder.md` — broaden to single-task + batch (R5).
- NEW: `plugins/sp/agents/expert-spur.md` (R4).

**Spur — commands & config:**
- `plugins/sp/commands/dev-*.md` (13 files) — re-point delegation, byte-stable surface (R15).
- `config/workflows/task-pipeline.yaml` — bind phases to competency skills (R12).

**Origin & references (read-only evidence):**
- `~/projects/cc-agents/plugins/rd3/skills/{orchestration-v2,code-implement-common,sys-testing,backend-architect,backend-design,task-decomposition,code-verification}/`
  — the functional decomposition + thin-spine `phase->skill` binding to mirror.
- `~/projects/cc-agents/plugins/rd3/agents/{jon-snow,super-coder}.md` — thin-dispatch agent model.
- `vendors/gstack/SKILL.md` + `vendors/gstack/ARCHITECTURE.md` — root-router-as-suite-facade pattern
  (backs `spur-cli`).
- `vendors/Superpowers/skills/{test-driven-development,subagent-driven-development}/SKILL.md` —
  TDD-as-standalone-discipline (backs R9) + thin-dispatch orchestration.

**Docs to sync (R18):**
- `docs/00_ADR.md` (ADR-016/023 supersede + new entry, R1); `docs/03_ARCHITECTURE.md §12` (correct the
  mis-cited §12.1); `docs/04_DESIGN.md`; `docs/05_FEATURES.md §9`; `AGENTS.md`; feature **H1** (`## Notes`
  names the split seam this executes).
### History
- 2026-06-30T17:58:35.670Z todo → wip (system)
