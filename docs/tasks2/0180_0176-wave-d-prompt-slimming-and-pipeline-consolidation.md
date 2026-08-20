---
template: standard
schema_version: 1
name: "0176 Wave D: prompt slimming and pipeline consolidation"
description: ""
status: done
type: task
profile: standard
parent_wbs: "0176"
priority: P2
tags: []
dependencies: []
created_at: 2026-07-02T06:29:12.250Z
updated_at: "2026-08-20T02:32:01.485Z"
---

## 0180. 0176 Wave D: prompt slimming and pipeline consolidation

### Background

Child task for 0176 Wave D. Fix F8, F9, and F10: duplicated/contradictory agent prompts, overlapping planning/idea pipeline ownership, embedded shell status ladders, and stale review-skill numbering.

### Requirements
- R1. Shrink workflow `agent.run` prompts so skills own criteria and formats; workflows should dispatch skills and artifact contracts.
- R2. Align decomposition prompts with the actual task-batch schema fields.
- R3. Replace planning-pipeline feature-id prose with `spur feature create`, or retire planning-pipeline if superseded by idea-pipeline.
- R4. Decide and record the fate of planning-pipeline before making broad edits to its behavior.
- R5. Promote wrapup feature status ladder behavior to a CLI verb or explicitly defer it with rationale.
- R6. Renumber or anchor `sp:code-verification` review-mode steps and fix stale references in related review docs.
- R7. Sync authoritative design docs for any CLI-surface change.
### Acceptance Criteria

<!-- Given/When/Then scenarios or a checklist derived from Requirements. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan
Scope: F8 (4 prompt-shrink sites across `idea-pipeline.yaml` + `planning-pipeline.yaml`),
F9 (planning-pipeline fate decision + wrapup shell-ladder trim), F10 (code-verification step
renumber + code-review See-also dedupe + secu-review.md step ref). Three workflow YAMLs, two
skill docs, one reference, no new verbs, no schema changes, one ADR.

**P0 — Discover (informational, no edits)**
- `idea-pipeline.yaml:72` discovery prompt carries the entire `needs_design` criteria block verbatim
  from `plugins/sp/skills/brainstorm/SKILL.md:268` (the "signal" table). Drift risk on the next
  needs_design change. Skill is the SSOT.
- `idea-pipeline.yaml:169` decompose prompt demands "each entry must include acceptance
  criteria"; the real schema (`apps/cli/schemas/task-batch.schema.json`) accepts only `name`/
  `background`/`requirements`/`feature_id`/`parent_wbs`/`priority`/`tags`/`template`. The
  schema-rejected prompt steers the LLM into writing JSON the gate rejects.
- `planning-pipeline.yaml:71` asks the agent to "scan docs/features + docs/05_FEATURES.md;
  allocate child id" — re-implementing `spur feature create`'s ID-allocation rule by prose
  while the verb already exists. `planning-pipeline.yaml:69-70` also drops `agent:` and
  `timeoutMs` on the `agent.run` step.
- `wrapup-pipeline.yaml:127-149` embeds a ~20-line shell status ladder for the legal path
  `backlog → active → verifying → done`, calling `spur feature check` + `spur feature update`
  + `spur feature show` per hop. `spur feature update <id> <status>` already invokes the
  lifecycle transition (`apps/cli/src/commands/feature.ts:118-123`); the existing verb
  enforces legal-edge guards. A `--to <status>` alias is a thin convenience, not a new
  capability. (R5.)

**P1 — F8a: shrink idea-pipeline discovery prompt**
- `config/workflows/idea-pipeline.yaml:72` — replace the embedded criteria + 2-3-approaches
  prose with `"Run sp:brainstorm for the idea: ${vars.idea}. Persist the design summary to
  .spur/run/<wbs>-brainstorm.md and the needs_design signal to
  .spur/run/idea-needs-design.json per sp:brainstorm's `Design Approval Gate` and `needs_design
  signal` sections (the skill owns criteria)."`
- Net diff: ~6 lines of agent input shrink to 3 lines; criteria duplication removed.
- `onEnter` continues to expect `.spur/run/idea-needs-design.json` (the existing
  design-route guard in `ac-generate` transitions reads it).

**P2 — F8b: align idea-pipeline decompose prompt with the schema**
- `config/workflows/idea-pipeline.yaml:169` — replace the "filled Requirements/AC/Design/Plan
  sections" demand with a schema-faithful description: "Run sp:spec-decomposition for feature
  ${vars.featureId}. Read the brainstorm artifact, feature AC, and design doc. Produce a
  task-batch JSON array at .spur/run/idea-task-batch.json that validates against
  apps/cli/schemas/task-batch.schema.json — the schema permits only these entry fields:
  `name`, `background`, `requirements`, `feature_id`, `parent_wbs`, `priority`, `tags`,
  `template`. Refine-after-decompose fills AC/Design/Plan; do not invent them here."
- This eliminates the schema-rejected JSON the agent currently produces and aligns with
  planning-workflow Step 6's refine-later model.

**P3 — F8c: planning-pipeline feature-id prose → `spur feature create`**
- `config/workflows/planning-pipeline.yaml:69-71` — replace the prose feature-id derivation
  with a shell call to `spur feature create` (or a new agent.run that invokes the verb).
  Two paths:
  - *Path A (agent.run dispatch):* `Run sp:brainstorm's `spur feature create` rule for slug
    ${vars.slug}: invoke '${vars.spurBin} feature create "<name derived from ${vars.slug}>"
    --parent ${vars.feature} --json' and capture the new feature id into a writeable file
    for the design-gen step.`
  - *Path B (shell action, simpler):* replace the agent.run with a `shell` action that
    shells `spur feature create` and writes the id to a file. Less agent surface, but
    loses the parent-context reasoning.
- Going with **Path A** — the feature name needs slug → human title reasoning the agent
  owns; `spur feature create` owns the id allocation. The agent prompt shrinks to the
  skill rule + the verb invocation; no re-implementation of id rules.
- Add `agent:` and `timeoutMs:` (using `vars.agent` / `vars.stepTimeoutMs`) to match the
  other pipelines' convention (F8d).

**P4 — F8d: planning-pipeline agent/timeout/spurBin vars**
- `config/workflows/planning-pipeline.yaml:37-42` — add `agent: "omp"`, `spurBin: "spur"`,
  `stepTimeoutMs: "600000"` to the `vars` block (matching `idea-pipeline.yaml:44-46`).
- Add `agent: ${vars.agent}` and `timeoutMs: ${vars.stepTimeoutMs}` to every
  `agent.run` step in the file. R36 test (skill-structure.test.ts:351) enforces
  `vars.*` template references are declared in the vars block — adding the vars
  before the templates is mandatory.
- Add a top-of-file note (matching `idea-pipeline.yaml:11-25` shape) documenting the
  new vars.

**P5 — F9a: ADR-029 planning-pipeline fate**
- R4 in 0180 says "Decide and record the fate of planning-pipeline before making broad
  edits to its behavior." F8c/d are narrow prompt/var fixes; they do NOT decide the
  fate. The fate decision (retire, keep, or fold) is a real operator call.
- Add `ADR-029` to `docs/00_ADR.md` recording the deferral: planning-pipeline's fate
  is deferred pending a separate operator call; F8 changes (P3/P4) are minimal
  compatibility fixes that don't pre-judge. ADR entry includes the three options and
  the F9 evidence. (Wave E / task 0181 is the right place to land the decision.)
- This satisfies R4 ("decide and record the fate" — the *decision-deferral* is the
  decision recorded for this wave; the fate itself is not decided here).

**P6 — F9b: defer `spur feature advance` verb**
- The wrapup shell ladder calls `spur feature check` + `spur feature update` + `spur
  feature show` three times to walk the legal path. `spur feature update <id> <status>`
  already routes through the lifecycle transition (`feature.ts:118-123`), so the legal
  edge enforcement is already in the existing verb. A `feature advance <id> [--to
  <status>]` alias is sugar, not new capability.
- Decision: defer. R5 of 0180 says "promote to a CLI verb or explicitly defer with
  rationale." The rationale: the existing verb already enforces legal edges; a new
  verb is sugar that adds surface area without changing semantics. Record the
  deferral in ADR-029 alongside the planning-pipeline fate.

**P7 — F9c: shrink wrapup-pipeline feature-transition shell ladder**
- `config/workflows/wrapup-pipeline.yaml:127-149` — replace the 20-line shell with a
  single `agent.run` (or, better, a `shell` action invoking the existing verb per
  hop) so the ladder is reusable and the workflow doesn't encode 4 lines of legal-edge
  state machine.
- Going with: a single `agent.run` that invokes `spur feature update` and verifies
  via `spur feature show` (the agent owns the loop, the verb owns legal edges). The
  onEnter shrinks from ~22 lines of inline shell to ~3 lines of agent input.
- Replace the existing `command:` shell ladder with:
  - `command: '${vars.spurBin} feature update ${vars.feature} active || true; status=$(${vars.spurBin} feature show ${vars.feature} --json | jq -r .status); if test "$status" = active; then ${vars.spurBin} feature check ${vars.feature} && ${vars.spurBin} feature update ${vars.feature} verifying; fi; if test "$status" = verifying; then ${vars.spurBin} feature check ${vars.feature} --strict && ${vars.spurBin} feature update ${vars.feature} done; fi; ${vars.spurBin} feature show ${vars.feature} --json | jq -e .status == "done"'`
  - Actually that doesn't shrink. Better path: keep the `shell` action but use a
    pre-step to walk the path. **REVISED — see F9c-final below.**
- **F9c-final:** Promote the legal-edge walk to a small helper action `feature.advance
  <id>` that calls the existing transition verb with verification. This adds ONE
  builtin action (~30 lines) and collapses the workflow shell ladder to 1 line
  (`feature.advance ${vars.feature}`). The 0108 precedent (the cancel-pipeline
  finding for `spur task record` replacing ~50 lines of shell) directly supports
  this.
- Wait — the precedent 0108 was for the `record` verb. The same pattern is
  defensible here. BUT: R5 of 0180 frames the verb as "promote to a CLI verb"
  (P9 of the parent plan). A `feature.advance` builtin action is a
  *workflow-runtime* helper, not a CLI verb. The R5 wording in 0180 specifically
  says "promote to `spur feature advance <id> [--to <status>]`" — a CLI verb.
- Reading F5 of 0176 ("shell ladder embedded ... promote to a CLI verb, e.g. `spur
  feature advance <id> [--to <status>]`") — this is a CLI surface change. CLI
  surface changes require 04_DESIGN sync (constitution §sync T2).
- **Final F9c decision:** add the CLI verb `spur feature advance <id> [--to
  <status>]`. It walks the legal path idempotently and verifies after every hop
  (the existing `spur feature update` enforces legal edges; `advance` adds the
  multi-hop walk + verification). The verb IS the canonical entry point for the
  lifecycle walk; `spur feature update <id> <status>` remains available for
  single-step transitions. This satisfies R5 of 0180 as worded.
- Implementation: add `advance` to `apps/cli/src/commands/feature.ts`, with the
  shell-ladder logic ported (or simplified — the verb walks the legal path
  itself). 04_DESIGN.md §1 (CLI surface) gets a row.

**P8 — F10a: renumber code-verification review-mode step list**
- `plugins/sp/skills/code-verification/SKILL.md:358-359` — review mode currently
  says "Runs Steps 3 + 7 + 10 (Review section only)". After Wave C inserted Step 6
  (design-conformance) between AC guard (Step 5) and SECUA (now Step 7), the
  review-mode list still references the pre-Wave-C numbering. The renumber is:
  Step 3 (change scope) → Step 7 (SECUA) → Step 10 (write Review section). These
  are correct step numbers; the issue is that "Step 7" is now the SECUA step
  (unchanged) and "Step 10" is the write-Review step (unchanged). So the literal
  "Steps 3 + 7 + 10" is actually right post-Wave C.
- Reading more carefully: F10 says "review-mode step list 'Steps 3 + 5 + 8' is
  stale numbering (should be scope / SECUA / write-Review)". Let me re-read the
  actual file: line 358-359 says "Runs Steps 3 + 7 + 10". The fix-direction
  names "scope / SECUA / write-Review" — Step 3 = scope, Step 7 = SECUA, Step
  10 = write Review. So the numbers ARE correct. The fix-direction in F10
  was speculative.
- But F10 also notes: "Step 8b" is wedged after Step 10 and splits Step 10's
  sentence mid-flow; Gotcha 2 cites "(Step 9)" for the Step-10 artifact."
- Looking at the actual file (line 282-304): there is a `### Step 12 — Handoff
  to record (pipeline context)` followed by an orphaned `(R9; the agent
  reporting PASS in prose is necessary but not sufficient).` line. The "Step
  8b" reference in F10 may be obsolete too. The Gotcha 2 cite is: "Write the
  verdict artifact last. The workflow guard reads it; a stale/partial file
  fails the gate misleadingly. Emit it only after the verdict is final (Step
  12)." (line 391-392). So Gotcha 2 cites Step 12 (correct). F10 was wrong
  about Gotcha 2.
- F10's "Step 8b" was speculative; the actual issue is the orphan `(R9; …)`
  sentence and the Step 12 numbering being jumped to from Step 11 with a
  contextual note lost. Fix: renumber Step 12 → re-anchor after Step 11 with
  no orphan sentence; remove the "(R9; …)" parenthetical (it's a parenthetical
  of unclear provenance).

**P9 — F10b: fix secu-review.md step reference**
- `plugins/sp/skills/code-verification/references/secu-review.md:10` —
  currently: "The code-quality lens applied in verify mode (Step 5) and review
  mode." Post-Wave-C, SECUA is Step 7 (verify mode) and the step list moved up
  by one for AC-guard alignment. Fix: "The code-quality lens applied in
  verify mode (Step 7) and review mode."

**P10 — F10c: dedupe code-review See-also**
- `plugins/sp/skills/code-review/SKILL.md:17` (frontmatter `see_also`)
  lists `sp:code-verification` AND line 92 (markdown See-also section) lists
  `sp:code-verification` again. F10 says it's a duplication. The fix:
  remove the markdown See-also line (the frontmatter is the source of truth
  for routing metadata; the markdown section is documentation prose). Keep
  the frontmatter entry.
- Alternatively: remove the frontmatter entry and keep the markdown one. The
  frontmatter is the machine-readable contract; keeping the frontmatter
  entry preserves routing. Decision: keep frontmatter, drop markdown
  duplicate.

**P11 — 04_DESIGN.md sync**
- New CLI verb: `spur feature advance <id> [--to <status>]`. Add a row to
  the feature verb table in `docs/04_DESIGN.md §1`. (CLI surface change per
  constitution sync T2.)

**P12 — Tests + verify**
- `plugins/sp/tests/skill-structure.test.ts:369-388` (R37) references
  idea-pipeline for the embedded literal and the `__hitlAnswer` pattern.
  Add an R38: planning-pipeline also declares `agent`, `spurBin`,
  `stepTimeoutMs` vars (matches idea-pipeline convention post-F8d).
- Add an R39: idea-pipeline discovery prompt no longer contains the
  `needs_design` criteria text (now lives only in sp:brainstorm).
- Add an R40: idea-pipeline decompose prompt no longer demands
  acceptance_criteria on every entry.
- Existing tests pass; new tests pass.

**P13 — Doc sync**
- Author `## Solution` change-map via `spur task update 0180 --section
  Solution --from-file` per the wave pattern.
- 04_DESIGN §1 gets a `spur feature advance` row.
- CHANGELOG entry per the same-commit rule (constitution §sync T2).

**P14 — Verification gate**
- `bun run apps/cli/src/index.ts workflow validate config/workflows/{idea,
  planning,wrapup}-pipeline.yaml --json` — all three PASS.
- `bun run format`.
- `bun run lint`.
- `bun run test` (full).
- `bun run test-cf`.
- `bun run build`.

## Out of scope
- The full planning-pipeline fate decision (R4) is recorded as a deferral in
  ADR-029; the actual decision (retire / keep / fold into idea) is reserved
  for the operator, in a follow-up wave or task. F8c/d are minimal
  compatibility fixes that don't pre-judge.
- The `sp:doc-evolve` skill prose (refers to planning-pipeline as a valid
  entry point) is left untouched — that prose is consistent with the
  "planning-pipeline still ships" deferral.
- Any change to the dual-workflow engine.
- A `feature.advance` workflow-runtime builtin action (the F9c-final chose
  the CLI verb path per R5's wording; a runtime helper could be added
  later if the verb is repeatedly called from workflows).
### Solution
Implemented Wave D by turning the prompt/pipeline audit findings into concrete workflow and CLI changes:

- Slimmed `idea-pipeline` discovery so `sp:brainstorm` owns approach/design/`needs_design` criteria, and aligned decomposition output with the actual task-batch schema fields instead of asking the agent to invent AC/Design/Plan fields that the schema rejects (`config/workflows/idea-pipeline.yaml:68`, `config/workflows/idea-pipeline.yaml:166`).
- Aligned `planning-pipeline` with the shared dispatch convention (`agent`, `spurBin`, `stepTimeoutMs`) and replaced prose feature-id allocation with an agent instruction that invokes canonical `spur feature create` and writes `.spur/run/plan-feature-id.txt` (`config/workflows/planning-pipeline.yaml` line 38 (file retired 2026-08-20 by ADR-072 / task 0606), `config/workflows/planning-pipeline.yaml` line 65 (file retired 2026-08-20 by ADR-072 / task 0606)).
- Recorded ADR-029: planning-pipeline fate is explicitly deferred as an operator/product decision, while Wave D makes only compatibility fixes; the same ADR promotes wrapup's feature status ladder into a CLI verb (`docs/00_ADR.md:771`).
- Added `spur feature advance <id> [--to <status>]`, which walks the legal forward lifecycle path, runs feature checks before guarded hops, verifies observed status after transitions, and returns `{id,status,hops}` for `--json` (`apps/cli/src/commands/feature.ts:138`, `apps/cli/src/commands/feature.ts:173`, `apps/cli/src/commands/feature.ts:369`).
- Collapsed `wrapup-pipeline` feature transition from the embedded shell ladder to `${vars.spurBin} feature advance ${vars.feature} --json` (`config/workflows/wrapup-pipeline.yaml:118`).
- Synced CLI-surface docs and changelog for `spur feature advance` (`docs/04_DESIGN.md:539`, `CHANGELOG.md`), and cleaned stale review/verification guidance: SECUA is Step 7, review mode references Steps 3 + 7 + 10, and duplicate markdown See-also entry was removed (`plugins/sp/skills/code-verification/references/secu-review.md:10`, `plugins/sp/skills/code-verification/SKILL.md:358`, `plugins/sp/skills/code-review/SKILL.md:38`).
- Added CLI coverage for `feature advance` success, idempotent, human output, unknown feature, unreachable target, and guarded-hop denial branches; added plugin structural invariants R38-R40 for planning vars, brainstorm-owned `needs_design`, and schema-faithful decomposition prompt (`apps/cli/tests/commands/feature.test.ts:234`, `apps/cli/tests/commands/feature.test.ts:250`, `apps/cli/tests/commands/feature.test.ts:262`, `apps/cli/tests/commands/feature.test.ts:286`, `apps/cli/tests/commands/feature.test.ts:293`, `apps/cli/tests/commands/feature.test.ts:308`, `plugins/sp/tests/skill-structure.test.ts:390`).

Dogfood recovery note: workflow run `4ac8a861-6233-4e19-ad43-595d99bec537` failed in `implement` after `600846ms`. The late partial diff was usable, but I manually completed the missing tests/docs hardening and ran the full canonical gate.
### Testing
| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Agent prompts are slimmer and delegate criteria to skills/artifact contracts: `config/workflows/idea-pipeline.yaml:68`, `config/workflows/idea-pipeline.yaml:166`, `config/workflows/planning-pipeline.yaml` line 65 (file retired 2026-08-20 by ADR-072 / task 0606). |
| R2 | MET | Decomposition prompt lists only task-batch schema fields and says AC/Design/Plan are filled later: `config/workflows/idea-pipeline.yaml:166`; structural invariant at `plugins/sp/tests/skill-structure.test.ts:413`. |
| R3 | MET | Planning feature-id allocation now invokes canonical `spur feature create` instead of prose ID derivation: `config/workflows/planning-pipeline.yaml` line 65 (file retired 2026-08-20 by ADR-072 / task 0606). |
| R4 | MET | ADR-029 records the planning-pipeline fate as explicitly deferred pending operator decision, avoiding broad behavior edits in this wave: `docs/00_ADR.md:771`. |
| R5 | MET | Added `spur feature advance` and replaced wrapup's embedded ladder with the verb: `apps/cli/src/commands/feature.ts:138`, `config/workflows/wrapup-pipeline.yaml:118`. |
| R6 | MET | Stale review/verification references cleaned: `plugins/sp/skills/code-verification/references/secu-review.md:10`, `plugins/sp/skills/code-verification/SKILL.md:358`, `plugins/sp/skills/code-review/SKILL.md:38`. |
| R7 | MET | New CLI surface documented in `docs/04_DESIGN.md:539` and `CHANGELOG.md`. |

**Commands**

| Command | Result |
|---------|--------|
| `bun run apps/cli/src/index.ts workflow validate config/workflows/idea-pipeline.yaml --json` | PASS |
| `bun run apps/cli/src/index.ts workflow validate config/workflows/planning-pipeline.yaml --json` | PASS |
| `bun run apps/cli/src/index.ts workflow validate config/workflows/wrapup-pipeline.yaml --json` | PASS |
| `bun run format` | PASS |
| `bun run lint` | PASS |
| `bun test apps/cli/tests/commands/feature.test.ts plugins/sp/tests/skill-structure.test.ts` | Assertions PASS; standalone focused run exits 1 because repo-wide coverage threshold applies to partial test runs. |
| `bun run test` | PASS: 2074 tests, 0 failed, 5366 assertions, 99.45% funcs / 99.06% lines. |
| `bun run test-cf` | PASS: server Workers test file 1/1, tests 1/1. |
| `bun run build` | PASS: CLI, server, and web built; existing CSS/chunk-size warnings only. |

Coverage: 99.45% funcs / 99.06% lines from `bun run test`.
### Review
| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P2 | Workflow reliability | `config/workflows/task-pipeline.yaml` | Dogfood run `4ac8a861-6233-4e19-ad43-595d99bec537` failed in `implement` after `600846ms`, again before verify/record. Manual recovery completed the work; repeated implement timeout remains a workflow issue for the final sweep. |
| P3 | Correctness | `config/workflows/feature-lifecycle.yaml:50` | Guarded feature lifecycle transitions do not receive CLI `--folder` overrides. In temp fixtures, `feature advance --folder <path> --to verifying` runs the lifecycle guard against the project-default corpus. Logged as bug-747; not fixed in Wave D because it predates `advance` and needs lifecycle-adapter var design. |
| P3 | Test depth | `apps/cli/tests/commands/feature.test.ts:308` | Multi-hop `advance` under `--folder` cannot be tested as a success path until bug-747 is fixed. Covered one-hop success/idempotency plus guarded-hop denial so the residual is explicit. |
| P4 | Product decision | `docs/00_ADR.md:777` | Planning-pipeline fate is intentionally deferred rather than decided in this implementation wave. This is recorded as ADR-029 and should be revisited with Robin before broad removal/folding work. |

Final disposition: PASS with one logged follow-up (bug-747) and the repeated dogfood timeout recorded as bug-746.
### References
- Parent: 0176 (`docs/tasks2/0176_sp-plugin-audit-remediation-decomposition-wiring-review-dept.md`)
- Dogfood workflow run: `4ac8a861-6233-4e19-ad43-595d99bec537` (local-only dogfood report retained under `docs/dogfood/`, gitignored — not committed; referenced here by run ID per ADR/Q1 decision).
- ADR: ADR-029 (`docs/00_ADR.md:771`)
- Related issues: bug-746 (0180 implement timeout), bug-747 (`--folder` lifecycle guard gap), plus timeout lineage bug-740/742/744
### History
- 2026-07-02T22:20:47.743Z todo → wip (system)
- 2026-07-02T22:20:52.070Z wip → testing (system)
- 2026-07-02T22:20:55.951Z testing → done (system)
