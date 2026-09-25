---
kind: plan
title: "sp:expert-spur enhancement — discovery and proposal"
status: approved
created_at: 2026-09-10
updated_at: 2026-09-10
related: []
tags: [brainstorm, plugin]
needs_design: true
run_id: 3bad357d-ac7d-4d03-a426-ba5c6997805a
---

# sp:expert-spur enhancement — discovery and proposal

## Operator review (idea-eval, 2026-09-10)

Robin approved the direction with three changes. They supersede the "No new skill" verdict, the
"no CLI source change" scope guard and the out-of-scope line below.

1. **CLI enhancements are in scope.** Enhance both the `spur` CLI and the skills wherever the
   process needs more capability. First confirmed defect: `spur workflow list` labels the installed
   package folder as the `project` layer and never lists the project's own `.spur/workflows`.
   - Root cause: `WorkflowService.list()` labels every configured `workflows.paths` entry `project`
     (`packages/app/src/services/workflow-service.ts:1391`). The user-global config registers the
     package folder by absolute path (`~/.config/spur/config.yaml:202-204`), and a configured
     `workflows.paths` replaces the `.spur/workflows/` default, so the project folder is never scanned.
   - Required: relabel the package folder as the **shared** layer; always list a **project** layer for
     `<cwd>/.spur/workflows`, whether or not it exists or holds workflows; keep registering extra
     folders possible for future extension.
   - Operator consent for this public-surface change (`workflow list` output and its `--json` layer
     ids) is recorded here.
2. **Two new cross-noun skills: `sp:spur-composer` and `sp:spur-doctor`.** The `spur-` prefix groups them
   with `sp:spur-cli` and `sp:spur-dev`. They cover every spur noun, not only workflow and history:
   - `sp:spur-composer` — composition and tuning: select from a catalog, compose, tune, and promote
     along ephemeral → project → shared.
   - `sp:spur-doctor` — evaluation and reflection: evaluate artifacts against evidence, reflect over
     LLM history sessions, and propose evolutions.
3. **expert-spur is not a coordinator or orchestrator.** Coordination and orchestration stay with
   `sp:super-planner`. This holds through design and implementation.

**Assessment: accepted.** The per-noun convention (`spur-cli/SKILL.md:95`) forbids per-noun verb
catalogs; these are cross-noun competencies, so they do not break it. Refinements carried into design:

- **Split of duties.** `sp:spur-cli` stays the verb facade. Composer writes artifacts; doctor only
  evaluates and proposes, and composer applies what the operator accepts. Doctor consumes
  `sp:history-anatomy` findings and never re-interprets raw history.
- **Loops belong to super-planner.** A recurring self-evolution loop, or any `spur agent run` /
  `spur message` dispatch for coordination, belongs to `sp:super-planner` or a workflow. expert-spur
  loads spur-cli, spur-composer and spur-doctor and runs one bounded corpus campaign per dispatch.
- **Naming.** "doctor" collides with `spur agent doctor` and the `doctor.probe` workflow action. The
  skill description must say it diagnoses spur artifacts, not runtime environments.

## Recommendation

Reshape, then proceed. Keep `sp:expert-spur` a thin corpus router and put new depth in `sp:spur-cli`
references. That follows the one-reference-per-noun convention (`plugins/sp/skills/spur-cli/SKILL.md:95`)
and the thin-wrapper direction already agreed in
`docs/plans/2026-09-06-feature-hierarchy-governance-brainstorm.md:285`. Changes in value order:

1. Workflow catalog + intent→workflow selection; fix find-existing-workflow, which cannot see the shared catalog today.
2. Hard `spur team` prohibition + deprecation banners.
3. Evidence-driven rule composition and tuning from `spur rule trace`.
4. History reflection bridge: `sp:history-anatomy` findings → corpus actions.
5. Bounded dynamic workflow composition (ephemeral → project → shared ladder).
6. Bounded agent/message usage, staged after in-flight B1/G4/D6; feature/task routing refresh.

No new skill. One charter line must not move: expert-spur never drives the planning/execution
lifecycle (`plugins/sp/agents/expert-spur.md:72`, pinned by `plugins/sp/tests/skill-structure.test.ts:1675`).
"Use Spur's agent capacity to get things done" is therefore reshaped into corpus-scoped dispatch;
execution stays with `sp:super-planner`.

This is a discovery proposal. The idea pipeline is paused at its idea-eval taste gate.

## Evidence and scope

Read: `expert-spur.md` (full); spur-cli `SKILL.md`, `agent.md`, `message.md`, `history.md`, `team.md`,
`rules.md`, `workflows.md`, `workflows/operations.md`, `workflows/workflow-fit-and-tuning.md`; spur-dev
`SKILL.md`, `dev-operations.md` §16, `inline-pipeline-driver.md`, `idea-evaluation.md`;
`config/workflows/idea-pipeline.yaml`; `parallel-execution/references/dispatch-surface.md`;
`docs/design/inter-agent-control-plane.md` §1–3; `skill-structure.test.ts` R56; `config/rules/README.md`.

Ran: `spur workflow list --json`, `spur {rule,workflow,history} --help`, anchor `rg` over the files
above, open-task search on the affected surfaces (none open).

In scope: `plugins/sp/agents/expert-spur.md`, `plugins/sp/skills/spur-cli/**`, `plugins/sp/skills/spur-dev/**`
(routing only if needed), `plugins/sp/skills/history-anatomy/**` (one taxonomy column), `plugins/sp/tests/**`.

Out of scope: adding, changing or removing a public `spur` noun/verb; CLI source changes; behavior
changes to shared `config/workflows/*.yaml`; retiring `spur team` itself.

## Findings, highest severity first

| # | Sev | Finding | Evidence |
|---|---|---|---|
| F1 | High | find-existing-workflow is blind to the shared catalog. Step 1 enumerates `.spur/workflows/*.yaml`; this repo has no such directory, and `spur workflow list --json` resolves all 11 workflows from the installed package (`layers[0].path = …/node_modules/@gobing-ai/spur/config/workflows`). Following the procedure yields "no match" and a duplicate workflow. | `spur-cli/references/workflows/operations.md:68`; `spur workflow list --json` |
| F2 | High | No intent→workflow selection guide. `workflows.md` covers verbs and schema; `workflow-fit-and-tuning.md` covers the fit gate and promote/demote/optimize. Nothing maps a requirement to one of the shared workflows. | `workflows.md`; `workflows/workflow-fit-and-tuning.md:156` |
| F3 | High | `spur team` retirement is undocumented. No ADR and no deprecation text in `team.md`; spur-cli still lists team as a Tier B noun and names it in its description. | `spur-cli/SKILL.md:3,50`; `rg -i 'retir\|deprecat' team.md` → none |
| F4 | Med | agent/message mixes team-coupled and team-free verbs without saying so. `agent loop` is supervisor-managed and launched by `spur team start`; `agent create/edit/delete` write "team agent specs". | `spur-cli/references/agent.md:25,29,92-95` |
| F5 | Med | Rule tuning is not evidence-driven. `spur rule trace` exists, but no `rules/*` procedure consumes it. Init-time adaptation exists and should be reused, not duplicated. | `rules.md:60,134`; `rg 'rule trace' rules/*.md` → none; `init.md:78-116` |
| F6 | Med | History has analysis but no reflection loop. `history.md` is verbs; `sp:history-anatomy` owns interpretation (closed taxonomy, 12-section report); `sp:session-review` owns the active session. Nothing turns findings into tasks, rule candidates or workflow optimizations. | `history.md`; history-anatomy and session-review descriptions |
| F7 | Low | expert-spur scope covers task/feature/rule/workflow only and does not route the hierarchy procedure. | `expert-spur.md:29`; feature-hierarchy brainstorm `:285` |

Context: B1 (agent run hardening) and G4 (inter-agent control plane) are verifying and D6
(role-addressed coordination) is active, so agent/message guidance written now documents a moving target.

## Per-noun proposal

### workflow — shared catalog (highest value)

New `spur-cli/references/workflows/catalog.md`, one row per shared workflow: intent, entry command,
key vars, HITL gates, "not for". Seed intents are below. Derive entry commands from the YAML headers
in the task; don't guess them.

| Workflow | Intent |
|---|---|
| `idea-pipeline` | vague idea → feature + AC + task batch |
| `task-pipeline` | one task: precheck → implement → gate → review → approve → verify → record |
| `feature-dev` | execute an existing feature's roster to verified completion |
| `wrapup-pipeline` | doc-sync, metrics, feature transition, branch cleanup |
| `pr-review` | GitHub PR-review spine |
| `wayfinder-resolution` | research/spec tasks |
| `docs-pipeline` | documentation work |
| `history-anatomy` | daily/ad-hoc history diagnosis |
| `task-lifecycle` / `feature-lifecycle` | status FSMs (legal transitions) |
| `basic` | generic implement-check-fix loop |

- **Parity test.** Catalog rows equal the `config/workflows/*.yaml` names, the same pattern as
  `cli-surface-parity.test.ts`. Drift fails CI.
- **find-existing fix.** Step 1 enumerates through `spur workflow list --json` (all layers), then reads each file.
- **Selection rule.** Catalog match → run it. Near match → project-tier tuning. No match → composition ladder.
- **Composition ladder** (dynamic generation):
  1. *Ephemeral.* Compose `.spur/run/<runId>-wf-<slug>.yaml` from existing actions, slash commands and
     skills only. Node budget: shell ≤5 units; `agent.run` input is a slash command or skill
     (ADR-043/069). Before any run: `spur workflow validate --json`, the validate-and-dry-run core,
     and a `spur workflow show` diagram for operator review.
  2. *Project.* On second use, save to `.spur/workflows/<name>.yaml` (existing default, `operations.md:186`).
  3. *Shared.* Only through the fit gate's promote direction (replay + branch + record) with explicit
     operator consent, because a `config/workflows/` change ships to every project.
- Tune a shared workflow for one project at the project tier. Never edit the shared YAML in place for one project.

### rule — per-project composition and DX tuning

- **Composition.** A project preset is `extends` over the sample packs (presets table in
  `config/rules/README.md`) plus per-rule scope and severity overrides. Initial adaptation stays in
  `init.md:78-116`.
- **Tuning loop** (added to `rules/fine-tuning.md`):
  1. `spur rule trace --last N --json`, then rank rules by findings.
  2. Classify each hot rule: glob too wide, severity wrong, evaluator wrong, or real debt.
  3. Make one adjustment, then run `spur rule validate`.
  4. Re-run on the affected inputs (T11) and record the rationale in the rule file header.
- **New-rule source.** Repeated findings from the history bridge become `/sp:rule-add` candidates.

### history — analysis → reflection

- Interpretation stays in `sp:history-anatomy`. Add an action-routing column to its closed finding
  taxonomy: task | rule candidate | workflow optimization | doc/learning | no-op.
- **expert-spur reflection mode.** Run or read the anatomy report. For each finding, execute its routed
  action through the CLI (`spur task create`, `/sp:rule-add`, the workflow optimize direction), then report.
  It never re-interprets raw history.

### agent / message — bounded, staged after B1/G4/D6

- **Allowed (team-free):** `agent run --agent/--model` (one-shot), `agent doctor`, `agent list`.
- **Spec-addressed (allowed only if premise P2 holds):** `agent run --spec [--drain]`, `agent wait`, and
  `message send/inbox/reply/watch`. `agent wait` is identity-pinned and bounded to 10 min or 20 polls
  (spur-dev 0777).
- **Forbidden:** `agent loop` (team-supervisor) and all `spur team *`.
- Use only on a dispatch-surface trigger (`dispatch-surface.md:29-40`): a cross-model review of a composed
  workflow, a headless corpus campaign, or a durable record for a bulk mutation. Route execution
  requests to `sp:super-planner`.
- `agent.md` and `message.md` gain a team-coupling matrix so every caller sees it, not only expert-spur.

### team

- Add to expert-spur `### Never`: "Never use `spur team`; it is retiring." Also forbid `agent loop`.
- Add a "retiring, do not use for new work" banner to `team.md` and the spur-cli routing row. Keep the
  row and the reference while the noun exists, because the facade documents the live surface
  (`cli-surface-parity.test.ts`).
- Whether to record the retirement as an ADR now is the operator's call (Q5).

### feature / task — routing, not new capability

Existing references are already deep (`features/{hierarchy-mece,roadmap-priority,acceptance-criteria}`,
`tasks/{l3-guard-cheatsheet,section-editing}`). Add routing only:

- Hierarchy and roadmap campaigns route to `features/hierarchy-mece.md` and `roadmap-priority.md`.
- Bulk status sweeps check each transition against the `task-lifecycle` / `feature-lifecycle` FSM before writing.
- When a campaign turns into execution, hand off explicitly to `sp:super-planner`.

## Approaches

| Approach | Summary | Confidence | Why |
|---|---|---|---|
| **A. Thin router + reference depth** (recommended) | The agent body gains a per-noun routing table, three modes (corpus campaign, reflection, composition) and the team guard. Depth goes in spur-cli references; history-anatomy gains one column; tests pin the boundaries. | HIGH | Matches `SKILL.md:95` and the agreed thin-wrapper direction; smallest context cost per dispatch; every procedure has one owner. |
| B. Fat agent | All procedures inline in `expert-spur.md`. | LOW | Duplicates references, bloats every dispatch, contradicts the `:285` direction. |
| C. Specialist split | New `expert-workflow` / `expert-rule` agents or a `history-reflection` skill. | MEDIUM-LOW | Cleaner isolation, but violates `SKILL.md:95`, multiplies trigger collisions with super-planner and history-anatomy, and is premature at this size. |

**New-skill verdict: none.** `sp:workflow-composer` was rejected: the workflow noun belongs to spur-cli,
and composition is a procedure, not a competency. `sp:history-reflection` was rejected: history-anatomy
owns interpretation, and routing is one column plus an agent mode. Revisit the composer only if
composition grows its own evaluator loop.

## Design Summary

- **Components.**
  - `expert-spur.md`: charter, routing table, modes, Never list.
  - spur-cli references: `workflows/catalog.md` (new); `workflows/operations.md` (find-existing fix +
    ladder); `rules/fine-tuning.md` (trace loop); `agent.md` and `message.md` (coupling matrix);
    `team.md` and `SKILL.md` (banner).
  - history-anatomy taxonomy: action column.
  - Tests: catalog parity (new); R56 extension (team guard, dispatch surface); 0786 unchanged.
- **Boundaries.** expert-spur owns corpus and composition, super-planner execution, history-anatomy
  interpretation, spur-dev lifecycle, spur-cli verbs. No CLI source or public-surface change.
- **Data flow.**
  - Requirement → catalog selection → run it, tune it at project tier, or compose through the ladder.
  - History → anatomy findings → routed actions → CLI writes → T11 affected-input checks.
  - Rule trace → classify → adjust → validate → scoped re-run.
- **Open design questions.**
  - Q1: Does `.spur/workflows/<name>.yaml` shadow a shared workflow of the same name? `layers[]` suggests
    layered resolution, but this is unverified. The answer decides whether project-tier tuning works by
    override or by rename.
  - Q2 (P2): Do agent specs, `agent wait` and `spur message` survive team retirement?
  - Q3: Do `spur workflow validate/run/show` accept a `.spur/run/` path for ephemeral workflows?
    `run <file>` suggests yes; needs verification.
  - Q4: Catalog-as-data instead of a hand-written reference: add intent/`description` to the workflow
    YAML and to `workflow list --json` (entries have no description field today). An additive `--json`
    change needs public-surface consent.
  - Q5: Record the team retirement as an ADR now, or at removal?
- **needs_design: true.** This is a cross-cutting role-boundary convention spanning four agents, several
  skills and tests, plus a new reference module and a parity test. Q1–Q3 need design answers before
  decomposition.

## Proposed work breakdown (input to decompose)

| # | Task | Depends on |
|---|---|---|
| T1 | Team guard: Never rule, `team.md`/`SKILL.md` banner, R56 assertion | — |
| T2 | Workflow catalog reference + parity test + find-existing fix | Q1 |
| T3 | Composition ladder procedure (ephemeral → project → shared) | T2, Q3 |
| T4 | Rule trace-driven tuning loop + composition guidance | — |
| T5 | History action-routing column + expert-spur reflection mode | — |
| T6 | agent/message coupling matrix + bounded-usage section | B1/G4/D6 settled, Q2 |
| T7 | Feature/task routing refresh (hierarchy, lifecycle FSM checks) | — |
| T8 | expert-spur charter integration (description triggers, Scope, modes, Output); `superskill agent evaluate` baseline before, re-score after | T1–T7 |

## Acceptance outline

- expert-spur states "Never use `spur team`" and excludes `agent loop`; a test asserts both.
- Catalog rows equal the `config/workflows/*.yaml` names; adding a workflow without a row fails the parity test.
- find-existing-workflow step 1 enumerates through `spur workflow list --json`.
- The composition ladder never writes `config/workflows/` without recorded consent; every ephemeral
  workflow passes validate + dry-run before it runs.
- The rule tuning procedure starts from `spur rule trace --json` evidence and ends with
  `spur rule validate` plus a scoped re-run.
- Every history-anatomy finding class maps to exactly one action class.
- R56 and 0786 still pass; expert-spur keeps "Never drive the planning/execution lifecycle".
- The `superskill agent evaluate` score for expert-spur is not lower than the recorded baseline.

## Verification performed and limits

- **Verified:** F1–F7, through the reads and commands listed under Evidence and scope.
- **Not verified:**
  - Q1 shadowing, Q3 path acceptance, and whether the team retirement covers specs and messages (Q2).
  - No `superskill agent evaluate` baseline yet; T8 records it.
  - B1/G4/D6 status comes from the feature query earlier in this run.

## Spec self-review and continuation

- No placeholders; every open item is a named question with an owner (design or operator).
- No contradiction with R56, 0786, ADR-054 or `dispatch-surface.md`.
- Scope guard holds: no CLI or public-surface change; shared workflow edits happen only with consent.
- Continuation: idea-eval (taste) → feature-create → AC → feature-check → system-design (Q1–Q5) →
  design-approval (taste) → decompose.
