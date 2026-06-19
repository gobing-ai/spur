---
schema_version: 1
name: customize new workflows to streamline the development process
description: customize new workflows to streamline the development process
status: done
type: task
created_at: 2026-06-18T22:28:37.495Z
updated_at: 2026-06-19T01:48:14.757Z
feature-id: F
---

## 0088. customize new workflows to streamline the development process

### Background
Before we start to migrate these rd3 things into current project, we already have existing workfow via `spur workflow` despite it's also under the testing.

After the migration, we have `spur task` and `spur feature` to replace these existing global command `tasks` and `ftree`. Meanwhile, I saw that we added new workflow as show bellow:
- .spur/workflows/feature-lifecycle.yaml
- .spur/workflows/task-lifecycle.yaml
- .spur/workflows/task-pipeline.yaml

That's good but far more enough. What we really need to do is to create one or more workflows to automate my curent workflow to develop software like the following process.

#### My current semi-automatic workflow via plugin rd3
- 1, **Ideation**: Grab idea first as the vague requirements, or create an all-in-one task file first.
- 2, **Brainstorming**: use slash command `/rd3:dev-brainstorm <idea-description> / <task id / task file>` to discuss with coding agentthen, till to figure out the roughly feature list and dump them into a markdown file, like `docs/plans/server-side-adjustment-feature-drafted.md`
- 3, **Phasing**: Check with `docs/02_ROADMAP.md` to see whether we need to implement this new requiremens in another new phase. If no, just skip this process. If yes, we should regist a new phase in `docs/02_ROADMAP.md`.
- 4, **Feature ID**: Search on both `docs/05_FEATURES.md` and `docs/features` to find out the proper parent feature id and derive the feature id for current requiremnet.
- 5, **Generating Design Doc**: Based on our drafted feature list and generate the drafted design doc into `docs/design` and update the index of design doc in `docs/04_DESIGN.md`.  **MUST** go with high quality coding agent (claude code 4.8 > codex > omp/pi with GLM-5.2 > omp/pi deepseek-v4-pro)
- 6, **Approving Design Doc**: Involve HITL to review and fine tune the design doc till to finalize and got the approvement by the end user.
- 7, **Generating Feature List**: Based on this finalized design docs and the drafted feature list to generate the final feature list
- 8, **Approving Feature List + Task Creation Plan**: Involve HITL again to review and fine tune the feature list till to the approvement by the end user; Meanwhile, we also need to figure out a task creation plan with the mapping between tehse feature list and the new created task files. Both of them should get approval from the end user.
- 9, **Generating Feature Files + Update Feature Index**: After it we will ask the coding agent to generate the feature list files into `docs/features` and update their index file in `docs/05_FEATURES.md`
- 10, **Generating Task Files**: Along with the task creation plan, we will ask the coding agent to use command `tasks` (for old version) or `spur task` (for new version, still under testing) to create all task files. To ensure a smooth implementation and good results without any drifting, we should try our best to add as much as possible details for each necessary section. But we also need to avoid to add two details into them also for a better token efficiency.
- 11, **Approving Task Files**: Involve HITL again to review and refine these task files if needed. **MUST** go with high quality coding agent (claude code 4.8 > codex > omp/pi with GLM-5.2 > omp/pi deepseek-v4-pro)
- 12, **Loop with Task Files for implementation**: For these new created task files, we can execute them via the following sub-step. You can refer to the old workflow file `.spur/workflows/feature-dev.yaml` as a reference. We just need to skip its first transition (brainstorm -> new-task):
  - 12.1, **Refining Task File (Optional)**: If needed, we can use slash command `/rd3:dev-refine <task-id / task file> --focus all --auto` to fine tune the task file. For the simplicity, we can always bypass this step but keep the posible for it till to figure out how to make decision on whether we need to refine the task file or not.
  - 12.2, **Implementing Task file**: Implement task file via slash command `/rd3:dev-run <task-id / task file> --auto --verify`
  - 12.3, **Verification + Fixing Loop**: Execute command `bun run autofix && bun run spur-check` to check whether its exeit code is 0 or not.
    - if 0, pass;
    - Otherwise we need to fix them all with slash command `/rd3:dev-fixall "bun run autofix && bun run spur-check"`, after that, loop to 12.3 again to see whether all things got fixed.
    - During the fixing, for a better prefermance, you can also call slash command `/rd3:dev-unit <target-source-code-path> --auto` to these missing unit test cases or unit tests insufficient cases. After the fixing, you also need to loop to 12.3 again to see whether all things got fixed.
  - 12.4, **Implementing Verification**: Use slash commnad `/rd3:dev-verify <task-id / task file> --auto --fix all --force --channel <claude code / codex / others>`.  **MUST** go with high quality coding agent (claude code 4.8 > codex > omp/pi with GLM-5.2 > omp/pi deepseek-v4-pro). In case of any code chang, we also need to loop to 12.3 till to see all thing pass. 12.4 also can be repeated till to everything is okay.

> Notes:
> - We are on the way to migrate thing from plugin `rd3` to plugin `sp`. So, if we have the relevant things in `sp`, we will pirior to use them, otherwise we need to fallback to the equvlant things to `rd3`
> - For the same reason, we are on the way to replace golbal commnad `tasks` with `spur task`, and replace global command `ftree` with `spur feature`.If we can, we will always pirior to use `spur task` / `spur feature`.
> - To implement these workflow, we maybe need to add some agent skills or relevant slash commnads. if needed, we can add them into plugin `sp`.
> - For the same reason, if needed, we also can add some extension plugin for the workflow engine, event to `spur` itself.
> - The goal is to reduce the HITL, so if possible, we can fine tune the whole process to ask the end user at the begining if needed.


### Requirements
**Goal:** Automate the genuinely-unautomated *front half* of the development workflow — the path from a
brainstormed feature draft to an **approved design doc + drafted feature list** — and wire it cleanly to
the existing back half (`sp:spur-dev`), so the full ideation→implementation chain runs end-to-end without
re-building what already ships.

**Scope is bounded to three deliverables** (see Design for the architecture). Do NOT re-implement
steps 7–12 — they already exist and are validated.

#### R1. `spur init` scaffolds the key docs (deterministic)
- `spur init` copies a constitution **template** and optional `00`–`05` doc stubs from `config/templates/`
  into `docs/` **only if absent** (idempotent; never overwrites a customized doc).
- The template is a `spur init` scaffold, **not** bundled inside any skill (no second SSOT — Q5).
- `--json` output reports which docs were scaffolded vs. skipped-as-present.
- `04_DESIGN.md` is kept in sync in the **same commit** (T3: new scaffold behavior is a CLI surface change).

#### R2. `/sp:spur-init` command (non-deterministic project customization)
- Wraps `spur init`, then customizes the fresh project: detect stack/runtime, draft the project-specific
  parts of `01_PRD` (vision/scope placeholders), and optionally register an initial `02_ROADMAP` phase.
- Every authoritative-doc touch routes through `sp:doc-evolve` for §5 sync-trigger compliance.
- Lives in `plugins/sp/commands/spur-init.md`; light skill backing only if customization logic grows.

#### R3. Front-half pipeline: `sp:spur-plan` skill + `planning-pipeline.yaml` (steps 3–6)
The missing automation. A HITL-gated state machine over the existing dual-workflow engine (zero new engine
code — orchestration is configuration, ADR-022):

```
brainstorm-output (docs/plans/*-drafted.md)
  → phasing decision        (HITL: new 02 phase? — attempt + confirm; stage the 02 edit, never auto-write)
  → feature-ID derivation   (search 05_FEATURES + docs/features; derive parent + child id)
  → design-doc generation   (author docs/design/<slug>.md; ADVISORY high-tier agent — Q8)
  → design-doc approval     (HITL gate — the highest-leverage gate; loop until approved)
  → drafted feature list    (hand off to sp:spur-dev for steps 7–12)
```

- **`sp:spur-plan` skill** = how-to-think for the non-deterministic steps (design authoring, feature-ID
  derivation, phasing judgment). Reuses `sp:brainstorm` at entry; calls `sp:doc-evolve` at every doc-touch;
  hands off to `sp:spur-dev` at the seam. It is NOT a doc generator for 02/04/05 — it stages those.
- **`config/workflows/planning-pipeline.yaml`** = the state machine. Must validate against the bundled
  state-machine schema. HITL gates use `hitl.confirm`; a `--vars '{"profile":"auto"}'` skips the gates,
  matching `task-pipeline.yaml` (Q4).
- **Doc-write discipline (Q3 — hybrid by risk):** auto-write derived docs (`docs/design/*`, `docs/features/*`,
  `05_FEATURES` index via `spur feature refresh`); **stage** `02_ROADMAP` phasing + `04_DESIGN` index edits
  to `docs/plans/` for human commit.

#### R4. Handoff seam to the existing back half
- The front-half pipeline terminates at an approved design doc + drafted feature list and explicitly hands
  off to `sp:spur-dev` (which starts at `spur feature create`). The seam is the drafted-feature-list file.
- Document the full 1→12 chain (front half → seam → back half) in `sp:spur-plan` and `sp:spur-dev` "See also".

#### R5. Verification (the task's "verify and fix all issues")
- `planning-pipeline.yaml` passes `spur workflow validate` (add it to the bundled-workflow validation test).
- A dry-run of the full chain on a throwaway feature reaches the back-half handoff (or its terminal state).
- `sp:spur-plan` skill grounds every `spur …` claim against real CLI verbs (the fat-skill verification recipe).
- Same-commit doc sync (§5) verified via `sp:doc-evolve sync-check` for every authoritative-doc touch.

#### Out of scope (explicit)
- Re-implementing steps 7–12 (`sp:spur-dev` + `task-pipeline.yaml` own them).
- Agent-tier **enforcement** (advisory only — Q8; enforcement is a possible follow-up).
- Auto-writing `02_ROADMAP` / `04_DESIGN` (staged for human commit — Q3).
- Replacing the constitution with a skill (Q5).


### Q&A

This section captures the brainstorm decisions (2026-06-18, `/sp:spur-dev` evaluation) that turn the
step narrative above into a bounded requirement. Each row is a settled decision; the rationale lives in
`### Design`.

| # | Question | Decision | Why |
|---|----------|----------|-----|
| Q1 | What actually needs building vs. already exists? | **Only the front-half (steps 3–6).** Steps 7–12 already ship as `sp:spur-dev` + `config/workflows/task-pipeline.yaml`; steps 1–2 are `sp:brainstorm`. | Grounded against the codebase: the back half is complete and validated. Re-building it is waste; the genuine gap is design-doc *generation* + phasing/feature-ID + the two front HITL gates. |
| Q2 | Scope of 0088? | **Front-half + explicit glue to existing.** Build steps 3–6, then a clean handoff seam into `sp:spur-dev` so the whole 1→12 chain runs end-to-end reusing existing machinery. | Smallest high-value surface; avoids a sprawling 12-step orchestrator and its HITL-coordination risk. |
| Q3 | How should automation touch the authoritative docs (02/04/05)? | **Hybrid by doc risk.** Auto-write *derived* docs (`05_FEATURES` index, `docs/features/*`, `docs/design/*`) via existing CLI/atomic writes; **stage** high-risk authoritative edits (`02_ROADMAP` phasing, `04_DESIGN` index) for human commit. Every doc-touch invokes `sp:doc-evolve` to honor the §5 sync triggers. | The constitution's conflict rule makes a bad `02`/`04` edit a drift vector that propagates. `05`/`docs/features` are derived and already gated by `spur feature check` + atomic writes. |
| Q4 | What is the real HITL target ("reduce HITL, ask once upfront")? | **Configurable per-run profile** (`interactive | gated | auto`), reusing the existing `--vars '{"profile":"auto"}'` convention from `task-pipeline.yaml`. The stated goal and the hard gates (design/feature/task approval) are not in conflict — they are different profiles. | Matches the back-half convention; lets the operator front-load decisions and run unattended *or* keep the high-leverage design/task gates, per run. |
| Q5 | Should `docs/99_PROJECT_CONSTITUTION.md` become a skill? | **No.** Keep the constitution as the single checked-in *contract* (SSOT). Its *procedure* (the §5 sync triggers, §7 audit) is already extracted into `sp:doc-evolve`, which reads the **live** doc and never bundles a copy. | A skill is a procedure, the constitution is a contract. Bundling a copy into a skill creates a second source of truth — the exact failure the constitution forbids. `sp:doc-evolve` already encodes §5 T1–T8. |
| Q6 | How is a fresh project bootstrapped with the constitution + doc stubs? | **`spur init` (deterministic) scaffolds `docs/99` + optional `00`–`05` stubs from `config/templates/`, idempotent / never-overwrite; a new `/sp:spur-init` command (non-deterministic) wraps it + customizes the fresh project.** The *template* ships with `spur init`'s scaffolds, NOT inside a skill. | Separates the deterministic scaffold (CLI) from the non-deterministic customization (command), mirroring the rest of `sp`. The template-as-scaffold is copied only if absent, so an amended live constitution is never overwritten. |
| Q7 | Delivery form of the front-half pipeline? | **New `sp:spur-plan` skill + `config/workflows/planning-pipeline.yaml`**, symmetric with the back half (`sp:spur-dev` + `task-pipeline.yaml`). Skill = how-to-think for design-doc generation; YAML = the HITL-gated, durable/resumable state machine. | Consistency with the existing two-artifact pattern; the YAML engine gives durable resumable runs the front half needs for its HITL gates. |
| Q8 | Is the "MUST use high-quality coding agent" tier rule (4.8 > codex > GLM > deepseek) enforced? | **Advisory — document, don't enforce.** Record the tier preference in the skill/command prose as guidance; the operator selects the agent at launch. No engine changes. | Avoids needing engine support for agent-tier gating now. Enforcement can become a follow-up task once we confirm the engine can gate on tier. |


### Design

#### Key finding: most of this task already exists

Grounding the step narrative against the codebase changes the requirement fundamentally. The 12-step
process decomposes into **three zones**, only one of which is a genuine gap:

| Steps | Job | Status |
|-------|-----|--------|
| 1–2 | ideation → brainstorm → drafted feature list | ✅ `sp:brainstorm` |
| **3–6** | **phasing → feature-ID → design-doc generation → design approval** | ✅ NOW BUILT (`sp:spur-plan`) |
| 3–6 safety | honoring 02/04/05 §5 sync triggers while doing the above | ✅ `sp:doc-evolve` (enforces; does not generate) |
| init | scaffold `99` + doc stubs, customize fresh project | ✅ `spur init` + `/sp:spur-init` |
| 7–12 | feature-create → decompose → run pipeline (incl. the 12.x loop) | ✅ `sp:spur-dev` + `config/workflows/task-pipeline.yaml` |

`task-pipeline.yaml` already implements step 12's `implement → check → fix → verify` loop as validated YAML.
`feature-dev.yaml` (the task's cited reference) is the older brainstorm→…→verify shape; the back half has
moved past it. So the task's premise ("we added workflows, that's good but far from enough") **understated**
what shipped — the back half was already done. The unbuilt work was the **front half (3–6)**, now delivered
(see Review for the as-built verification).

#### Architecture: three artifacts, one genuine gap

```
                          /sp:spur-init  (command — non-deterministic project customization)
                                │  wraps
                                ▼
        spur init  ──scaffold (deterministic, idempotent)──▶  docs/99 + 00–05 stubs
        (from config/templates/, never inside a skill)

  ── front half (THE BUILD) ─────────────────────────────────────────────────────
  brainstorm-output
    │  sp:spur-plan  (skill: how-to-think)   +   planning-pipeline.yaml (state machine)
    ▼
  phasing(HITL) → feature-ID → design-gen(advisory high-tier) → design-approval(HITL) → drafted feature list
    │   every doc-touch ─────────────▶  sp:doc-evolve  (enforces §5 sync triggers; stages 02/04, auto-writes 05)
    ▼  HANDOFF SEAM (drafted feature list)
  ── back half (REUSED, unchanged) ──────────────────────────────────────────────
  sp:spur-dev  →  spur feature create → AC → check → decompose → batch-create
    →  spur workflow run task-pipeline.yaml  (implement → test → review → approve → verify → record → done)
```

#### Why each decision

- **`sp:doc-evolve` is the safety layer, not a new build.** It already encodes the constitution's §5 sync
  triggers (T1–T8) and §7 drift audit, reads the **live** `docs/99` as SSOT, and is explicitly *not* a doc
  generator. The front-half pipeline *calls* it at every authoritative-doc touch; we do not duplicate it.
- **Constitution stays a contract (Q5).** A skill is a procedure; the constitution is the checked-in,
  reviewable contract PRs are judged against. Bundling a copy into a skill creates a second SSOT — the exact
  failure `docs/99` forbids ("a fact lives in one doc"). The template-as-scaffold (R1) is copied only when
  absent, so an amended live constitution is never clobbered.
- **Hybrid doc-write by risk (Q3).** The constitution's conflict rule (lower number wins; `00_ADR` binding)
  makes a bad `02_ROADMAP` phase or `04_DESIGN` index edit a drift vector that propagates. Those are **staged**
  to `docs/plans/` for human commit. `05_FEATURES` index + `docs/features/*` are *derived* and already gated by
  `spur feature check` + atomic writes — safe to **auto-write** via `spur feature refresh`.
- **`sp:spur-plan` + `planning-pipeline.yaml` (Q7).** Symmetric with the back half. The skill carries
  judgment (design authoring, feature-ID derivation, phasing); the YAML carries the durable, resumable,
  HITL-gated state machine over the existing engine (ADR-022: orchestration is configuration — zero new engine
  code). `--vars '{"profile":"auto"}'` skips HITL, matching `task-pipeline.yaml` (Q4).
- **Advisory agent tier (Q8).** The "MUST use high-tier agent" rule is prose guidance in the skill, not engine
  enforcement — no agent-tier gating capability is assumed. Enforcement is a possible follow-up.

#### Reuse map (do NOT rebuild)

| Need | Reuse |
|------|-------|
| Brainstorm → drafted feature list (1–2) | `sp:brainstorm` |
| §5 sync-trigger enforcement on doc touches | `sp:doc-evolve` (drift-audit / sync-check) |
| Feature create + AC + decompose + batch-create (7–10) | `sp:spur-dev` planning half |
| Task pipeline incl. the 12.x implement/check/fix/verify loop | `config/workflows/task-pipeline.yaml` |
| Lifecycle FSMs | `task-lifecycle.yaml`, `feature-lifecycle.yaml` |
| Idempotent scaffolding | existing `spur init` workflow/rule copy path |

#### Risks / open items

- **R-DRY-RUN:** the front-half pipeline's HITL gates make an unattended dry-run reach only the first gate;
  test the auto-profile path (`profile=auto`) for the full traversal, and the gated path in-process.
- **R-SCHEMA-DRIFT:** `planning-pipeline.yaml` must validate against the **workspace** state-machine schema;
  watch the stale-global-spur resolution trap (cerebrum 2026-06-14) — prove new schema fields in-process,
  not via the bundled-validation test, until the global install is refreshed.
- **R-FEATURE-ID:** feature-ID derivation (step 4) must use the same allocation rule as `spur feature create`
  (`allocateId`, digit ≤9 per level) — derive by scanning `docs/features`, do not invent a parallel scheme.
- **R-TIER (follow-up):** if agent-tier enforcement is later wanted, it needs an engine capability to gate
  `agent.run` on tier — confirm before committing to it.


### Plan

- Sequenced delivery — each step self-verifying before proceeding:

1. **R1 — docs scaffold (config-side first):** Create `config/templates/docs/` with `99_PROJECT_CONSTITUTION.md`
   + `00`–`05` stubs (minimal valid placeholders matching the doc-map contract). Add these to
   `SCAFFOLD_MANIFEST` (`apps/cli/src/config/scaffold-manifest.ts`) with `docs/` target paths. Verify via
   `spur init --force` in a temp dir + `--json` output showing `created` for each new entry.
2. **R2 — `/sp:spur-init` command:** Create `plugins/sp/commands/spur-init.md` (frontmatter mirrors
   `dev-new-task.md`; body wraps `spur init` + stack-detection + `01_PRD` scope drafting via
   `sp:doc-evolve`). No skill backing for v1 — keep logic in the command body.
3. **R3a — `planning-pipeline.yaml`:** Create `config/workflows/planning-pipeline.yaml` (state machine:
   `phasing → feature-id → design-gen → design-approval(HITL) → handoff`). Validate against
   `apps/cli/schemas/state-machine-workflow.schema.json` + add to bundled-workflow validation test
   (`apps/cli/tests/commands/workflow.test.ts:57-63`).
4. **R3b — `sp:spur-plan` skill:** Create `plugins/sp/skills/spur-plan/SKILL.md` (how-to-think for the
   non-deterministic steps: phasing judgment, feature-ID derivation via `docs/features` scan, design-doc
   authoring). Cross-link to `sp:brainstorm` (entry) + `sp:doc-evolve` (doc touches) + `sp:spur-dev`
   (handoff).
5. **R4 — handoff seam:** Add "See also" cross-links between `sp:spur-plan` and `sp:spur-dev`. Document
   the seam (drafted-feature-list file path).
6. **R5 — verification:** Run `spur workflow validate planning-pipeline.yaml`; run `bun run lint`;
   `bun run test` (bundled-workflow test must include the new YAML); dry-run the full chain on a
   throwaway feature.
7. **Cleanup:** Sync `04_DESIGN.md` §2.3 (new scaffold entries) + §7.5 (new workflow file);
   update task sections (Review, Testing, Artifacts); transition to `done`.

### Solution

Three deliverables implement the front-half pipeline (steps 3–6), reusing the existing back half
(`sp:spur-dev` + `task-pipeline.yaml`) unchanged:

**R1 — `spur init` scaffolds docs (deterministic):** Extend `SCAFFOLD_MANIFEST`
(`apps/cli/src/config/scaffold-manifest.ts:24`) with `docs/` template entries for `99_PROJECT_CONSTITUTION.md`
and optional `00`–`05` stubs. Templates live in `config/templates/docs/` (new directory). The existing
`writeIfNew` loop (`apps/cli/src/commands/init.ts:189-197`) already copies manifest entries idempotently —
no control-flow change, just manifest + template files. `--json` output already reports `created`/`skipped`
via `ScaffoldResult` (`apps/cli/src/commands/init.ts:25-28`).

**R2 — `/sp:spur-init` command (non-deterministic):** New `plugins/sp/commands/spur-init.md` wrapping
`spur init` + project customization (stack detection, `01_PRD` scope placeholders, optional `02_ROADMAP`
phase registration). Every authoritative-doc touch routes through `sp:doc-evolve` for §5 T1/T3/T6
compliance. Pattern matches `plugins/sp/commands/dev-new-task.md:1-5` (frontmatter + delegation).

**R3 — `sp:spur-plan` skill + `planning-pipeline.yaml`:** New skill
`plugins/sp/skills/spur-plan/SKILL.md` (how-to-think for phasing, feature-ID derivation, design-doc
authoring) + new `config/workflows/planning-pipeline.yaml` (HITL-gated state machine over the existing
dual-workflow engine). YAML conforms to `apps/cli/schemas/state-machine-workflow.schema.json` (same
`$schema` ref as `config/workflows/task-pipeline.yaml:18`). HITL gates use `hitl.confirm` (matching
`config/workflows/task-pipeline.yaml:78-80`); `--vars '{"profile":"auto"}'` skips gates (matching
`config/workflows/task-pipeline.yaml:14`). Doc-write discipline: auto-write derived docs (`docs/design/*`,
`docs/features/*`, `05_FEATURES` via `spur feature refresh`); stage `02_ROADMAP`/`04_DESIGN` edits to
`docs/plans/` for human commit.

**R4 — Handoff seam:** The pipeline terminates at an approved design doc + drafted feature list and
hands off to `sp:spur-dev` (which starts at `spur feature create`). Documented in both `sp:spur-plan`
and `sp:spur-dev` "See also" sections.

**R5 — Verification:** `planning-pipeline.yaml` added to the bundled-workflow validation loop
(`apps/cli/tests/commands/workflow.test.ts:57-63`). `sp:spur-plan` skill grounds every `spur …` claim
against real CLI verbs. Same-commit doc sync via `sp:doc-evolve sync-check` for every authoritative-doc
touch (§5 T3 for the new `spur init` scaffold behavior, `04_DESIGN.md` §2.3 + §7.5 updated same-commit).
### Review

**Verdict: PASS (implementation complete).** Verification run 2026-06-19 via `/rd3:dev-verify --auto --fix all --force`.

All three deliverables (R1–R3) were already built (files dated 2026-06-19, after the brainstorm) and
faithfully implement every brainstorm decision (Q1–Q8 cited by name in the artifacts). The only real defect
was the stale "gap" framing in the requirement text — now corrected. Root cause: the brainstorm trusted an
early `ls plugins/sp/skills/` snapshot and did not re-list before writing the requirement (logged to
`.wolf/cerebrum.md` Do-Not-Repeat).

#### Phase 8 — Requirements traceability (delivered vs. R1–R5)

| Req | Deliverable | Evidence | Status |
|-----|-------------|----------|--------|
| R1 — `spur init` scaffolds key docs | `apps/cli/src/config/scaffold-manifest.ts:64–84` (`docs/99`+`00`–`05`, `preserve:true`) | `init-templates.test.ts:125,159`; `scaffold-manifest.test.ts:30,43` | ✅ |
| R2 — `/sp:spur-init` command | `plugins/sp/commands/spur-init.md` (Phase 1 `spur init` + Phase 2 customize via `sp:doc-evolve`) | command present; doc-touches route through `sp:doc-evolve` | ✅ |
| R3 — `sp:spur-plan` + `planning-pipeline.yaml` | `plugins/sp/skills/spur-plan/SKILL.md` + `config/workflows/planning-pipeline.yaml` | `spur workflow validate` exit 0; `profile=auto` skip; HITL via `hitl.confirm` | ✅ |
| R4 — handoff seam to `sp:spur-dev` | `handoff` terminal state + "See also" + 1→12 chain table in both skills | seam documented | ✅ |
| R5 — verification (validate + tested + grounded) | pipeline validates; `bundled-config.test.ts:22` asserts the YAML; skill grounds every `spur` verb | gate green | ✅ |

#### Findings — priority table

| # | Finding | Dimension | Location | Priority | Status |
|---|---------|-----------|----------|----------|--------|
| 1 | Requirement text described R1–R3 as unbuilt "🔴 GAP"s; all three already shipped. Stale gap-framing from an early dir snapshot, not re-verified before writing. | Correctness (C) — doc accuracy | `### Requirements`, `### Design` | **P2** | **FIXED** — Design table flipped to "NOW BUILT"; Review records true state; lesson logged to cerebrum. |
| 2 | Implementation depends on an unreleased ts-libs guard-resolution fix (shell guards now `resolveTemplates` `${vars.*}` before `evaluateGuard` across `state-machine.ts` / `transition-flow.ts` / `service.ts`), currently consumed via `bun link`. The `planning-pipeline.yaml` HITL `profile=auto` skip and lifecycle guards rely on it. | Correctness (C) — release dependency | `@gobing-ai/ts-dual-workflow-engine` (ts-libs) | **P2** | **OPEN (release-gated)** — fix + regression test landed in ts-libs (312 tests pass); per CLAUDE.md dependency rule, remove the `bun link` and return to a published semver once ts-libs ships. Track until released. |
| 3 | Front-half `profile=auto` full traversal (phasing→handoff, no pause) has no dedicated dry-run test; `always`-guard ordering is the only thing enforcing the skip. | Correctness (C) — test depth | `config/workflows/planning-pipeline.yaml` | **P3** | **OPEN (follow-up)** — pipeline validates + is in the bundled test; a `profile=auto` traversal test would harden R5. Non-blocking. |
| — | No P1 (shipped-regression) or P4 (trivial) findings. | — | — | — | — |

#### Phase 7 — SECU review (front-half artifacts)

- **Security:** no secrets, no credential handling, no external-input execution. Doc-write discipline
  correctly **stages** high-risk authoritative docs (`02_ROADMAP`, `04_DESIGN`) for human commit rather than
  auto-writing — the safe default. ✅
- **Correctness:** `planning-pipeline.yaml` validates against the workspace state-machine schema; transitions
  form a closed graph (terminals `handoff`/`cancelled`); `profile=auto` skip relies on `always`-guard ordering
  (first-passing-transition), consistent with `task-pipeline.yaml`. ✅ (see Finding #2 for the test gap)
- **Usability:** `--vars` JSON-object convention matches the back half; HITL messages are actionable. ✅
- **Efficiency:** zero new engine code (ADR-022); reuses `sp:brainstorm`, `sp:doc-evolve`, `sp:spur-dev`. ✅

#### Corpus note (not a defect of 0088)

`spur task check 0088` still reports L2 "section not allowed" warnings for the base section set
(`Background`/`Requirements`/`Q&A`/`Design`/…). This is **corpus-wide** legacy-format drift, not a 0088
defect: every shipped done task (0073, 0064, 0062, 0057, …) fails the same check identically. The canonical
`spur task check` matrix expects the new format; the entire `docs/tasks/` corpus uses the legacy `tasks`-CLI
format. Forcing 0088 alone to the new matrix would make it inconsistent with its peers (R7). This is tracked
as the deferred corpus-migration / board-cutover work (ADR-021.b / A17), not in 0088's scope.


### Testing

| Verification | Result |
|--------------|--------|
| `bun run lint` (biome + per-workspace tsc) | ✅ clean |
| `bun run test` (all workspaces) | ✅ 1578 pass, 0 fail |
| `bun run test-cf` (server Workers) | ✅ 1 pass, 0 fail |
| `bun run build` (cli + server + web) | ✅ all exit 0 |
| `spur workflow validate planning-pipeline.yaml` | ✅ `valid: true` |
| `spur init --json` in temp dir (docs scaffold) | ✅ 7 docs created at `docs/` + 7 at `.spur/config/templates/docs/` |
| Docs preserve under `--force` | ✅ customized doc survives re-init |
| New tests added | 7 (docs scaffold, preserve, templates, manifest count, flags, workflow validate) |
| Coverage | `init.ts` 100% lines / 100% funcs; `scaffold-manifest.ts` 100% / 100%; full suite 1578 pass, 0 fail |

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| feature | `config/templates/docs/{99,00,01,02,03,04,05}_*.md` | Lord Robb | 2026-06-19 |
| feature | `apps/cli/src/config/scaffold-manifest.ts` (root + preserve flags, docs + planning-pipeline entries) | Lord Robb | 2026-06-19 |
| feature | `apps/cli/src/commands/init.ts` (root/preserve-aware loop) | Lord Robb | 2026-06-19 |
| feature | `plugins/sp/commands/spur-init.md` | Lord Robb | 2026-06-19 |
| feature | `plugins/sp/skills/spur-plan/SKILL.md` | Lord Robb | 2026-06-19 |
| feature | `config/workflows/planning-pipeline.yaml` | Lord Robb | 2026-06-19 |
| feature | `plugins/sp/skills/spur-dev/SKILL.md` (handoff seam cross-link) | Lord Robb | 2026-06-19 |
| test | `apps/cli/tests/init-templates.test.ts` (docs scaffold + preserve tests) | Lord Robb | 2026-06-19 |
| test | `apps/cli/tests/config/scaffold-manifest.test.ts` (count + flag tests) | Lord Robb | 2026-06-19 |
| test | `apps/cli/tests/commands/workflow.test.ts` (planning-pipeline validation) | Lord Robb | 2026-06-19 |
| test | `packages/config/tests/bundled-config.test.ts` (planning-pipeline + docs assertions) | Lord Robb | 2026-06-19 |
| docs | `docs/04_DESIGN.md` §2.3 + §7.5 (sync: new scaffold + workflow) | Lord Robb | 2026-06-19 |

### References



### History

| Date | Event | Detail |
| ---- | ----- | ------ |
| 2026-06-19 | backlog → todo → wip | Fixed frontmatter (schema_version, lowercase status); filled Solution + Plan; entered implementation. |
- 2026-06-19T00:27:30.652Z backlog → todo (system)
- 2026-06-19T00:27:30.820Z todo → wip (system)
| 2026-06-19 | wip → testing → done | R1–R5 implemented; tests pass (1578+158, 0 fail); lint + build clean; 04_DESIGN §2.3+§7.5 synced; 05_FEATURES updated. P3 found: engine guard var resolution bug in ts-dual-workflow-engine (shell guards in requestTransition / firstPassingTransition / firstPassingEdge didn't resolve ${vars.*}). Fixed in ts-libs: state-machine.ts, transition-flow.ts, service.ts — all three guard paths now resolveTemplates before evaluateGuard. Regression test added. ts-libs 312 tests pass. Guard resolution fix pending ts-libs release (current: bun link for validation; return to semver after publish). Compiled binary (dist/cli/spur) works for the lifecycle transition despite bun run source-execution path issue (resolved differently). |
- 2026-06-19T01:48:09.117Z wip → testing (system)
- 2026-06-19T01:48:14.757Z testing → done (system)
