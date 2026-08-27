---
name: roles
description: "Layer-1 role→tier table for /sp:dev-* dispatch — four roles (scribe, coder, reviewer, planner), one per tier; command→role mapping closed over plugins/sp/commands/; stage-floor reconciliation. Consumed by sp:spur-dev, sp:spur-cli, sp:code-verification."
see_also:
  - spur-dev
  - spur-cli
  - code-verification
---

# Roles — the Layer-1 role-to-tier table

The executor-selection contract is two layers. **Layer 1 (this file)** projects *role → tier*;
its SSOT is `agent.roles` in `config/config.global.yaml` (task 0647 / ADR-078) — this file is the
agent/human-facing view plus the plugin-owned command→role mapping. `DEFAULT_AGENT_ROLES` in
`packages/config/src/index.ts` is the no-filesystem fallback and must remain identical. **Layer 2** maps
*tier → executor* and is owned by the operator in `.spur/config.yaml`. This file never names an
executor, a model, or a vendor — it declares only what tier a role's work needs, and the
operator's config decides which executor serves that tier.

The vocabulary is four roles, one per tier:

| Role | Tier | Stage floor source |
| --- | --- | --- |
| `scribe` | cheap | changelog (`min_tier: cheap`) |
| `coder` | standard | implement / test / wrap (`min_tier: standard`) |
| `reviewer` | capable-1 | verify / review / dogfood (highest fold `capable-1`) |
| `planner` | capable-2 | plan / refine / brainstorm (highest fold `capable-2`) |

**The one-role-per-tier property is the invariant**, not a coincidence: two roles sharing a tier
resolve to the same eligible executor set and are one role with two names. A proposed fifth role
must bring a fifth tier. The tiers are the live vocabulary
`cheap | standard | capable-1 | capable-2 | capable-3` (packages/config/src/index.ts).

This table supersedes the eight-intention vocabulary recorded in task 0344 § Solution D1/D2. That
decision named eight intentions, but against the stage registry they carried only four distinct
tier floors (`plan` capable-2; `verify`/`dogfood` capable-1; `changelog` cheap; everything else
standard) — four of the eight names had no routing consequence. The four roles below are that
collapse, named as people so they stay addressable in `--agent`.

## The table

<!-- PROJECTION (task 0647 / ADR-078): the tier/stages half of the block below is a generated view
     of agent.roles in config/config.global.yaml — edit that SSOT, not this file.
     plugins/sp/tests/roles.test.ts (R9) fails the suite on any three-way drift with the
     DEFAULT_AGENT_ROLES no-filesystem fallback. The
     `commands:` half is plugin data (command frontmatter is its SSOT). -->

```yaml
version: 1
roles:
  - id: scribe
    tier: cheap
    commands: [dev-gitmsg, dev-handover, dev-daily, dev-changelog, dev-refresh, rule-add, rule-refine, workflow-add, workflow-refine, spur-init]
    stages: [changelog]
  - id: coder
    tier: standard
    commands: [dev-run, dev-unit, dev-debug, dev-simplify, dev-fixall, dev-reverse, dev-wrap, dev-wrapall, dev-gtd]
    stages: [implement, test, wrap]
  - id: reviewer
    tier: capable-1
    commands: [dev-verify, dev-verifyall, dev-review, dev-review-session, dev-pr-review, dev-dogfood, rule-scan, dev-find-conflict, dev-find-issue]
    stages: [verify, review, dogfood]
  - id: planner
    tier: capable-2
    commands: [dev-plan, dev-refine, dev-brainstorm, dev-idea, dev-runall, dev-parallel, dev-next, dev-arch, dev-refineall, dev-find-next, dev-feature-change]
    stages: [plan, refine, brainstorm]
```

`commands` is the closed command→role mapping: every file under `plugins/sp/commands/` appears in
exactly one row, and a new command must be added to exactly one row (or bring a fifth role with a
fifth tier). `stages` lists the canonical stages the role folds (ids from
`REGISTERED_CANONICAL_STAGES` in `packages/domain/src/stage-registry/schema.ts`); a role's `tier`
must not sit below the highest `min_tier` among its folded stages.

## Role annotations

- **`scribe` (cheap).** Writing derived text — commit messages, changelogs, handovers, daily
  summaries — plus template scaffolding (`spur init`, rule/workflow authoring). Mechanical,
  high-volume, cheap-tier work. Folds the `changelog` stage.
- **`coder` (standard).** Implementation and delivery: running the pipeline, unit tests, debugging,
  simplification, fix-everything sweeps, reverse engineering, wrap-up, and the end-to-end
  delivery flow (`dev-gtd`). Folds `implement`, `test`, `wrap`.
- **`reviewer` (capable-1).** Verification and analysis: per-task verify/review, batch verify,
  dogfooding, anti-pattern scanning (`rule-scan`), immediate session review, and the two audit
  commands (`dev-find-conflict`, `dev-find-issue`) — those analyse rather than transcribe, which is
  why they sit here and not under `scribe`. `dev-find-issue` routes through `sp:history-anatomy`;
  `dev-review-session` routes through `sp:session-review` in the active host context. Folds
  `verify`, `review`, `dogfood`.
- **`planner` (capable-2).** The planning half: feature planning, requirement refinement (single
  and batch), brainstorm, idea intake, batch run/parallel orchestration, next-step routing,
  architecture survey, feature-frontier prioritization, and feature-tree restructure. Folds `plan`,
  `refine`, `brainstorm`.

**Placement notes (directory closure, task 0535).** The decided four-row table listed 31 commands;
the live `plugins/sp/commands/` directory has 38 (39 at the time of the mapping; `dev-history-load`
was removed in HA-S1 0661). The six additional commands were placed by the
same stage logic: `dev-refineall` folds `refine` → planner; `dev-find-next` is planning-side
frontier work → planner; `dev-feature-change` is planning-half corpus surgery on the feature tree →
planner; `dev-gtd` is the execution/delivery flow → coder; `dev-find-conflict` and `dev-find-issue`
are audits/analysis → reviewer (same reasoning as `rule-scan`). Later additions: `dev-pr-review` is review orchestration —
driving the external PR review and triaging its findings folds the `review` stage → reviewer;
`dev-review-session` performs evidence-backed review over the active conversation → reviewer.

**Consistency is a test, not a convention.** `plugins/sp/tests/roles.test.ts` parses this YAML and
asserts the tier-distinctness, command closure, stage-floor, and boundary invariants against the
real command directory, the real stage registry, and the real operator config — plus three-way parity
with `config/config.global.yaml` and `DEFAULT_AGENT_ROLES` (R9, 0647): the table above must equal the
shipped SSOT and no-filesystem fallback on id/tier/stages. When the table and the registry disagree,
fix the table or the registry — never the test. When the three role tables disagree, fix the shipped
SSOT first, then regenerate the projections.
A project may re-tier/re-stage a role at config time via `agent.roles` (closed vocabulary) — that
override never flows back into this file.
