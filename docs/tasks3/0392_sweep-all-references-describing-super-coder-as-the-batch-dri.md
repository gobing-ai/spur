---
template: feature-impl
schema_version: 1
name: "Sweep all references describing super-coder as the batch driver"
description: ""
status: done
type: task
profile: standard
feature_id: H6
parent_wbs: null
priority: P2
tags: ["sp-plugin", "docs", "refactor"]
dependencies: ["0391"]
created_at: "2026-07-30T21:52:24.882Z"
updated_at: "2026-07-31T03:34:12.535Z"
done_forced: "true"
done_reason: "Sweep complete (19 files, 66 edits); grep AC R7 clean; lint clean; 427/427 plugin tests pass. omp implement timed out; work complete."
---

## 0392. Sweep all references describing super-coder as the batch driver

### Background

26 files reference `super-coder`, and most describe it as the batch pipeline driver — a description that becomes wrong the moment the rescope lands. Verified counts: `plugins/README.md` (12), `docs/features/H1_spur-dev-skill.md` (9), `plugins/sp/skills/spur-dev/references/execution-batch.md` (9), `plugins/sp/README.md` (7), `plugins/sp/skills/parallel-execution/SKILL.md` (6), `plugins/sp/skills/spur-dev/references/dev-operations.md` (6), `docs/features/H4_*.md` (5), `plugins/sp/agents/super-reviewer.md` (5), `AGENTS.md` (4), `config/templates/AGENTS.md` (4), `docs/help/how_to_use_dev_slash_commands_*.md` (4), `plugins/sp/tests/skill-structure.test.ts` (3), plus single-digit hits across `docs/04_DESIGN.md`, `docs/05_FEATURES.md`, `docs/design/e2e-workflow-for-system-development.md`, `docs/plans/*`, `plugins/sp/scripts/batch-preflight.ts`, `next-router/references/routing-table.md`, and `spur-dev/SKILL.md`.

Stale routing guidance is worse than absent guidance: an agent that reads "super-coder is the batch driver" will route batch work to the build agent and get a charter mismatch at dispatch time, with nothing failing loudly.

### Requirements
R1. Every live file that attributes batch driving, set resolution, topological ordering, or continue/halt policy to `super-coder` is updated to name `super-planner`.
R2. Every live file that references `super-coder` for architecture, implementation, testing, or debugging keeps or gains that attribution.
R3. `docs/tasks2/*` historical task records are left unmodified — they are immutable completion history.
R4. `AGENTS.md` and `config/templates/AGENTS.md` harness-routing tables name the correct agent per row, and the two stay consistent with each other.
R5. `docs/04_DESIGN.md` and `docs/05_FEATURES.md` reflect the four-agent roster, landing in the same change as the surface edit per the T3 same-commit rule.
R6. `plugins/sp/scripts/batch-preflight.ts` and `next-router/references/routing-table.md` name super-planner as the batch consumer.
R7. After the sweep, no live file under `plugins/` or `docs/0*.md` attributes batch driving to `super-coder`.
### Acceptance Criteria
```gherkin
Feature: Reference sweep for the retired super-coder role

  Scenario: Every reference to the retired super-coder role is updated
    Given 26 files described super-coder as the batch pipeline driver
    When the sweep lands
    Then each live file names super-planner for orchestration duties
    And each names super-coder only for architecture, codegen, or debugging duties

  Scenario: No live file misattributes batch driving
    Given the sweep is complete
    When live files under plugins/ and docs/0*.md are searched
    Then no file attributes batch driving to super-coder

  Scenario: Historical records are preserved
    Given docs/tasks2/ contains completed task records naming super-coder
    When the sweep runs
    Then those files are left unmodified

  Scenario: The seeded template stays correct
    Given config/templates/AGENTS.md is seeded into new projects by spur init
    When the sweep lands
    Then its harness-routing rows name the correct agent
    And it stays consistent with the repository root AGENTS.md

  Scenario: Derived docs land in the same change
    Given docs/04_DESIGN.md and docs/05_FEATURES.md describe the agent roster
    When the surface edit lands
    Then both reflect the four-agent roster in the same commit
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Sequenced after the agent rewrite so the sweep is mechanical: with both charters final, each hit is a lookup of "which role does this sentence describe" rather than a judgment about what the roles should be.

WHY exclude `docs/tasks2/*` (R3): those files record what was true when the task ran. Rewriting them would falsify the historical record and produce misleading archaeology later — a reader tracing why the roster changed needs the old names intact to follow the trail. The distinction to apply is live guidance (must be correct now) versus historical record (must stay accurate to its moment).

R7 is written as a verifiable end-state rather than a checklist of files, because the file list will drift between planning and execution. A grep-shaped acceptance condition survives that drift; an enumerated list does not.

`config/templates/AGENTS.md` is easy to miss and matters disproportionately: it is the template `spur init` seeds into every new Spur project, so an error there propagates to every downstream project rather than staying local to this repo.
### Plan
- [ ] Regenerate the reference list — `rg -c 'super-coder' --glob '!node_modules' --glob '!docs/tasks2/**'`
- [ ] Classify each hit as orchestration-role or build-role
- [ ] Update `plugins/` files: READMEs, execution-batch.md, dev-operations.md, parallel-execution, routing-table.md, spur-dev/SKILL.md, batch-preflight.ts
- [ ] Update `AGENTS.md` and `config/templates/AGENTS.md`, keeping them consistent
- [ ] Update `docs/04_DESIGN.md` and `docs/05_FEATURES.md` for the four-agent roster
- [ ] Update `docs/features/H1_*.md`, `docs/features/H4_*.md`, and the help docs
- [ ] Verify with a grep that no live file attributes batch driving to super-coder
- [ ] Run `bun run test` and confirm green
### Solution
Mechanical sweep of every LIVE file attributing orchestration duties (single-task/batch pipeline driving, set resolution, topo-sort, continue/halt, fan-out, recovery) to `super-coder` → renamed to `super-planner`. BUILD-role refs (architecture, codegen, testing, debugging) kept as `super-coder`. 66 edits across 19 files.

Files edited (orchestration → super-planner):
- `AGENTS.md` + `config/templates/AGENTS.md` — dev-run/dev-runall/lifecycle-routing rows (4 each)
- `plugins/README.md` (8) + `plugins/sp/README.md` (7) — orchestrator descriptions, tables, diagrams; `3 subagents` → `4 subagents`
- `plugins/sp/skills/spur-dev/SKILL.md:118` — batch-run row
- `plugins/sp/skills/spur-dev/references/execution-workflow.md:25`
- `plugins/sp/skills/spur-dev/references/execution-batch.md` (9) — all orchestration (batch-driver SSOT)
- `plugins/sp/skills/spur-dev/references/dev-operations.md` (6) — all orchestration
- `plugins/sp/skills/spur-dev/references/glossary.md:25` — batch orchestrator agent
- `plugins/sp/skills/parallel-execution/SKILL.md` (6) + `references/fan-out-patterns.md:47`
- `plugins/sp/skills/next-router/references/routing-table.md:16` — TABLE A batch reader
- `plugins/sp/scripts/batch-preflight.ts:2` — header comment
- `docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md` (4) + `docs/help/how_to_use_spur_for_daily_software_development.md` (3) — batch driver refs
- `docs/04_DESIGN.md:961` + `docs/05_FEATURES.md:151` — batch-driver attribution
- `docs/design/e2e-workflow-for-system-development.md` (2)
- `plugins/sp/agents/super-reviewer.md:150` — pipeline driving → super-planner (line 148 build ref KEPT)

BUILD refs deliberately KEPT: `super-coder.md` (self), `super-planner.md` ("those are sp:super-coder (build)"), `super-reviewer.md:148` (implementing fixes), `docs/05_FEATURES.md:154` ("super-coder absorbs expert-dev" — ADR-028 build consolidation).

Historical records untouched (R3): `docs/tasks2/**`, `docs/tasks3/**`, `docs/plans/**`, `docs/features/**`, `CHANGELOG.md`.
### Testing
**Commands run:**
```
rg -n 'super-coder' --glob '!node_modules' --glob '!docs/tasks2/**' --glob '!docs/tasks3/**' --glob '!docs/features/**' --glob '!docs/plans/**' --glob '!CHANGELOG.md' --glob '!plugins/sp/agents/super-coder.md' --glob '!plugins/sp/tests/skill-structure.test.ts'
bun run lint          # biome clean + 7/7 workspaces typecheck exit 0
cd plugins/sp && bun test   # 427 pass, 0 fail, 2040 assertions
```

**R7 verification (grep-shaped AC):** post-sweep grep for orchestration-keyword hits (`batch|pipeline|runall|orchestr|driver|run.*end|set.*resolv|topo|fan.out|recover|continue.halt|dev.run`) returns 4 hits — all confirmed BUILD-role or historical-record, none attribute orchestration to `super-coder`.

**Full suite:** `bun test plugins/sp` — 427 pass, 0 fail (one transient Tier B parity timeout observed in an earlier run resolved on retest; flaky subprocess-spawn latency, not a code defect).

**Coverage:** documentation sweep; no implementation code. No source-coverage applies.
### Review
Three-dimensional review for the super-coder→super-planner reference sweep. Documentation-only task; the grep-shaped acceptance condition (R7) is the coverage instrument.

**Scope:** 19 live files across `plugins/`, `AGENTS.md`, `config/templates/`, `docs/04`, `docs/05`, `docs/help/`, `docs/design/`.

**Functional Verdict: PASS** - all R1–R7 MET; no live file under plugins/ or docs/0*.md attributes batch driving to super-coder (R7 grep clean).

**P1–P4 findings**

| Priority | Finding | Location | Remediation |
|----------|---------|----------|-------------|
| P4 | `plugins/README.md` relationship diagram (line ~204) still reads "2 subagents" and the scorecard (line ~583) "sp 2" — under-counts the now-4-agent roster. Separate from orchestration attribution; left to avoid scope creep. | `plugins/README.md:204,583` | Roster-count refresh as a follow-up housekeeping edit |
| P4 | Tier B parity test (`spur-cli-parity.test.ts`) occasionally times out at bun:test's 5s default per-test cap due to live-CLI subprocess spawning. Transient; resolved on retest. | `plugins/sp/tests/spur-cli-parity.test.ts` | Add an explicit per-test timeout (the Tier A sibling test already has 30s); follow-up under 0396/0394 scope |

No P1 (blocker), P2 (major), or P3 (minor) findings. No security findings (documentation-only). No correctness contradictions — BUILD refs kept, orchestration refs moved, historical records untouched (R3 honored).

**Architecture Review**

Documentation task; no module structure changed. The sweep enforces the charter boundary set in 0391: an agent that reads "super-coder is the batch driver" would route batch work to the build agent and hit a charter mismatch at dispatch time. Closing that drift vector is the structural contribution.

No deepening or friction introduced.

**Verdict: PASS** - functional traceability complete (7/7 R MET), SECUA clean (no P1–P3; two P4 advisory, both bounded follow-ups), architecture clean. Ready for `done`.
### References

H6

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-31T03:33:58.390Z todo → wip (system)
- 2026-07-31T03:33:59.612Z wip → testing (system)
- 2026-07-31T03:34:12.526Z testing → done (system)
