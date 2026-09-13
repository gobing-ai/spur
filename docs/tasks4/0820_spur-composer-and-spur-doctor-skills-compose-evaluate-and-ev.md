---
schema_version: 1
name: spur-composer and spur-doctor skills compose, evaluate and evolve spur artifacts
status: done
template: feature-impl
created_at: 2026-09-10T22:18:37.284Z
updated_at: "2026-09-13T05:57:05.251Z"
feature_id: I21
priority: P2
tags:
  - plugin
  - skills

dependencies: ["0819"]
ac_numbering: task-local
---

## 0820. spur-composer and spur-doctor skills compose, evaluate and evolve spur artifacts

### Background

Composition and evaluation cut across every spur noun, but today they are scattered across per-noun `sp:spur-cli` references, and nothing reflects over LLM history to evolve rules, workflows or docs. This task adds the two cross-noun skills from ADR-114: `sp:spur-composer`, which applies changes, and `sp:spur-doctor`, which proposes them.

Implements:
- R5 — sp:spur-composer composes and tunes every spur noun
- R6 — sp:spur-doctor evaluates spur artifacts from CLI evidence
- R7 — spur-doctor reflects over history through history-anatomy findings
- R8 — spur-doctor proposes and spur-composer applies
- R10 — find-existing-workflow searches every listed layer
- R11 — the composition ladder gates every promotion
- R12 — rule tuning is driven by rule trace evidence
- R25 — spur-composer composes to the composition budgets

Ordering: after the workflow-layers task, because composer selection and find-existing read its `list --json` `layers`, `source` and `description`. Composer and doctor are one task: the propose/apply contract (R8) and the shared test file are one review context. R25 (added 2026-09-10 with ADR-115) teaches composer the composition rules; doctor's step-profile evidence is a separate task because it adds a plugin script.

Rubric: E8 D1 L1 C1 R1 = 12 → own task: a markdown-only plugin surface with a different review lens from the CLI change.

### Requirements

- [x] R1. `plugins/sp/skills/spur-composer/SKILL.md` validates and covers selection, composition and tuning for tasks, features, rules, workflows and agent specs. It links `sp:spur-cli` references instead of restating verb or flag catalogs, routes recurring loops and coordination to `sp:super-planner`, and forbids `spur team` and `spur agent loop`.
- [x] R2. `plugins/sp/skills/spur-doctor/SKILL.md` validates and names a read-only evidence source for each covered noun. Its description says it diagnoses spur artifacts, not runtime environments like `spur agent doctor`. It routes recurring loops to `sp:super-planner` and forbids `spur team` and `spur agent loop`.
- [x] R3. spur-doctor reflects over history only through `sp:history-anatomy` findings. It maps every finding class to exactly one action class (task, rule candidate, workflow optimization, doc or learning, no-op) and never re-interprets raw history records.
- [x] R4. spur-doctor returns a proposal table and performs no task, feature, rule or workflow write. spur-composer applies the rows the operator accepts through `spur` verbs and re-runs each row's verify evidence.
- [x] R5. The `sp:spur-cli` find-existing-workflow procedure (`references/workflows/operations.md`) takes its candidates from `spur workflow list --json` across all layers instead of globbing `.spur/workflows`.
- [x] R6. spur-composer's composition ladder (ephemeral → project → shared) gates each step on `spur workflow validate` and `spur workflow run --dry-run`, and writes `config/workflows` only after recorded operator consent.
- [x] R7. spur-composer's rule tuning procedure starts from `spur rule trace --json` evidence and ends with `spur rule validate` and a re-run on the affected inputs.
- [x] R8. `plugins/sp/skills/spur-cli/references/workflows/workflow-fit-and-tuning.md` teaches the consolidation and cache-window rules of the workflow composition contract (rules 5 and 7). spur-composer applies them with the ADR-115 budgets whenever it composes or tunes a workflow. It merges adjacent model steps only when no gate, HITL state or independence boundary sits between them, and keeps author and certifier steps apart. It also runs long deterministic work outside `agent.run`.

### Acceptance Criteria

```gherkin
Feature: spur-composer and spur-doctor skills compose, evaluate and evolve spur artifacts

  Scenario: R1 — sp:spur-composer composes and tunes every spur noun
    Given plugins/sp/skills/spur-composer/SKILL.md
    When the plugin structure tests run
    Then the skill validates and covers selection, composition and tuning for tasks, features, rules, workflows and agent specs
    And it links to sp:spur-cli references instead of restating verb or flag catalogs

  Scenario: R2 — sp:spur-doctor evaluates spur artifacts from CLI evidence
    Given plugins/sp/skills/spur-doctor/SKILL.md
    When the plugin structure tests run
    Then the skill validates and names an evidence source for each covered noun
    And its description says it diagnoses spur artifacts, not runtime environments like `spur agent doctor`

  Scenario: R3 — spur-doctor reflects over history through history-anatomy findings
    Given a sp:history-anatomy report
    When spur-doctor runs a reflection
    Then every finding class maps to exactly one action class: task, rule candidate, workflow optimization, doc or learning, or no-op
    And spur-doctor never re-interprets raw history records

  Scenario: R4 — spur-doctor proposes and spur-composer applies
    Given an evolution proposal from spur-doctor
    When the operator accepts it
    Then spur-composer applies it through `spur` CLI verbs
    And spur-doctor itself performs no task, feature, rule or workflow write

  Scenario: R5 — find-existing-workflow searches every listed layer
    Given the find-existing-workflow procedure
    When it enumerates candidate workflows
    Then it reads `spur workflow list --json` across all layers instead of globbing `.spur/workflows`

  Scenario: R6 — the composition ladder gates every promotion
    Given a composed workflow
    When it moves from ephemeral to project to shared
    Then each step passes `spur workflow validate` and a dry run before use
    And the shared step writes config/workflows only after recorded operator consent

  Scenario: R7 — rule tuning is driven by rule trace evidence
    Given the rule tuning procedure
    When a rule is tuned for a project
    Then the procedure starts from `spur rule trace --json` evidence
    And it ends with `spur rule validate` and a re-run on the affected inputs

  Scenario: R8 — spur-composer composes to the composition budgets
    Given the workflow-fit-and-tuning reference and plugins/sp/skills/spur-composer/SKILL.md
    When the plugin structure tests run
    Then the reference teaches the consolidation and cache-window rules
    And spur-composer applies them with the ADR-115 budgets when it composes or tunes a workflow
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-10T22:20:18.654Z

- **Q2, agent specs after team retirement: kept.** Resolved from evidence. Specs are the control-plane occupant identity (`OccupantRef.specId`, `docs/design/inter-agent-control-plane.md` §2), addressed by `agent run --spec`, `agent wait` and `message`. Composer and doctor reach them only through `spur agent create|edit|delete|list --specs` (satellite §9). If team retirement moves those verbs, the satellite §3 row follows.
- **One skill or two: two** (D6), so doctor stays provably read-only.
- **Doctor reading raw history: no** (D7). `sp:history-anatomy` stays the only history interpreter.
- **Rule trace evidence: no CLI change needed.** `spur rule trace <runId> --json` already returns per-rule `evaluations` with `findings`, `findings_json` and `severity`, which is enough for the R7 tuning loop.
- **Deferred:** the enhancement suggestions reported at design-approval are outside I21 until the operator consents.
- **Decomposition:** the pre-batch-create quiz gate was auto-skipped under `--auto`. The rubric line is in Background.

#### Q&A entry — 2026-09-11T15:56:11.813Z

Refined at depth=ready (refineall I21, 2026-09-11). Closed decisions:
- **§3 ownership with 0822.** 0822 owns the `workflow-fit-and-tuning.md` §3 numbers, posture and owners, rewritten with its validator constants. 0820 (R8, Plan step 5) adds only the consolidation and cache-window rule text next to them, linking `docs/design/workflow-composition-contract.md` § Composition budgets. It changes no §3 number. Whichever task lands second rebases onto the other's §3 text.

### Design

**Approach.** Two thin cross-noun skills per ADR-114 and `docs/design/spur-artifact-evolution.md` §2–§10. Each links the `sp:spur-cli` references for verbs and existing per-noun procedures (`references/workflows/*.md`, `references/rules/fine-tuning.md`, `references/features/*.md`, `references/tasks/*.md`, `references/agent.md`).
- `sp:spur-composer` covers:
  - catalog selection from `spur workflow list --json`, using `description` as the intent: a match runs as is, a near match becomes a same-name project-layer override, and no match goes up the ladder;
  - the composition ladder (§7) and the rule tuning loop (§8);
  - applying accepted doctor proposals (§5);
  - the ADR-115 composition rules (R8): taught once in `workflow-fit-and-tuning.md` next to its §3 budgets, with the rule text owned by `docs/design/workflow-composition-contract.md` § Composition budgets (ADR-115). Composer links them and does not restate them.
- `sp:spur-doctor` covers:
  - the per-noun evidence table (§3);
  - the reflection map over history-anatomy `trend`, `category` and `ownerSurface` (§4, first match wins, reusing the environment-lens placement rule);
  - the proposal table (`key`, `evidence`, `action`, `change`, `apply`, `verify`).
  Doctor's step-profile evidence and the §10 flag table land with the step-profile task, which adds the plugin script.

**Rejected.**
- One combined skill: it mixes read-only evaluation with writes. One method per competency keeps doctor provably read-only.
- Per-noun references only: this scatters a cross-noun method across five files.
- Doctor reading raw history: `sp:history-anatomy` stays the only history interpreter.

**Invariants.**
- Doctor names no mutating verb and writes nothing. A caller that wants a record saves the table under `docs/reports/`.
- Composer writes only through `spur` verbs and the ladder's gated file steps. The shared step needs recorded consent plus `build:bundle` parity.
- Neither skill restates a verb or flag catalog, uses `spur team` or `spur agent loop`, or runs a recurring loop. Loops and coordination go to `sp:super-planner` or a workflow.
- Agent specs are reached only through `spur agent create|edit|delete|list --specs` (satellite §9).
- A task proposal carries the history-anatomy finding `key` in its body (the existing handoff route).
- `workflow-fit-and-tuning.md` stays the one taught home for composition numbers and rules; the §3 numbers change with the validator constants (governance §1.2 ratchet).

### Plan

1. Create both skill folders, matching the frontmatter of sibling `plugins/sp/skills/*/SKILL.md`, and fill them from satellite §2–§9.
2. Doctor: the evidence table, the reflection map, the proposal table, and a description that sets it apart from `spur agent doctor`.
3. Composer: selection, the ladder, the rule tuning loop, and apply-and-verify.
4. `plugins/sp/skills/spur-cli/references/workflows/operations.md`: find-existing-workflow step 1 reads `spur workflow list --json` across all layers.
5. `plugins/sp/skills/spur-cli/references/workflows/workflow-fit-and-tuning.md`: add the consolidation and cache-window rules next to the §3 budgets, linking the composition contract. Composer's workflow section links them.
6. `plugins/sp/README.md`: index rows and tree entries for both skills.
7. `plugins/sp/tests/skill-structure.test.ts`:
   - both skills exist;
   - composer names the five nouns and links spur-cli and `workflow-fit-and-tuning.md`;
   - doctor names an evidence source per noun and the five action classes, and contains no mutating `spur` verb;
   - find-existing reads `list --json`;
   - the reference names the consolidation and cache-window rules.
8. Run `superskill skill validate` on both skills, then `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `plugins/sp/tests/skill-structure.test.ts:1989` |
| `plugins/sp/tests/skill-structure.test.ts:769` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Composer covers five nouns and links the CLI facade. `plugins/sp/skills/spur-composer/SKILL.md:44`; `plugins/sp/tests/skill-structure.test.ts:2041`. Executed: `bun run spur-check` (exit 0). |
| R2 | MET | Doctor names read-only evidence sources and its artifact diagnosis boundary. `plugins/sp/skills/spur-doctor/SKILL.md:48`; `plugins/sp/tests/skill-structure.test.ts:2080`. Executed: `bun run spur-check` (exit 0). |
| R3 | MET | History findings use the first-match map over the five closed action classes. `plugins/sp/skills/spur-doctor/SKILL.md:92`; `plugins/sp/tests/skill-structure.test.ts:2103`. Executed: `bun run spur-check` (exit 0). |
| R4 | MET | Doctor proposes; composer applies accepted rows and reruns their verification. `plugins/sp/skills/spur-composer/SKILL.md:121`; `plugins/sp/tests/skill-structure.test.ts:2114`. Executed: `bun run spur-check` (exit 0). |
| R5 | MET | Workflow discovery consumes the complete CLI layer catalog. `plugins/sp/skills/spur-cli/references/workflows/operations.md:62`; `plugins/sp/tests/skill-structure.test.ts:2142`. Executed: `bun run spur-check` (exit 0). |
| R6 | MET | Every promotion has validation and dry-run gates; shared promotion requires consent. `plugins/sp/skills/spur-composer/SKILL.md:72`; `plugins/sp/tests/skill-structure.test.ts:2060`. Executed: `bun run spur-check` (exit 0). |
| R7 | MET | Rule tuning starts with trace evidence and ends with validate and affected-input rerun. `plugins/sp/skills/spur-composer/SKILL.md:109`; `plugins/sp/tests/skill-structure.test.ts:2071`. Executed: `bun run spur-check` (exit 0). |
| R8 | MET | Composition guidance preserves author/certifier independence and cache-window limits. `plugins/sp/skills/spur-composer/SKILL.md:90`; `plugins/sp/tests/skill-structure.test.ts:2152`. Executed: `bun run spur-check` (exit 0). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — sp:spur-composer composes and tunes every spur noun | MET | test | Composer covers five nouns and links the CLI facade. `plugins/sp/skills/spur-composer/SKILL.md:44`; `plugins/sp/tests/skill-structure.test.ts:2041`. Executed: `bun run spur-check` (exit 0). |
| Scenario: R2 — sp:spur-doctor evaluates spur artifacts from CLI evidence | MET | test | Doctor names read-only evidence sources and its artifact diagnosis boundary. `plugins/sp/skills/spur-doctor/SKILL.md:48`; `plugins/sp/tests/skill-structure.test.ts:2080`. Executed: `bun run spur-check` (exit 0). |
| Scenario: R3 — spur-doctor reflects over history through history-anatomy findings | MET | test | History findings use the first-match map over the five closed action classes. `plugins/sp/skills/spur-doctor/SKILL.md:92`; `plugins/sp/tests/skill-structure.test.ts:2103`. Executed: `bun run spur-check` (exit 0). |
| Scenario: R4 — spur-doctor proposes and spur-composer applies | MET | test | Doctor proposes; composer applies accepted rows and reruns their verification. `plugins/sp/skills/spur-composer/SKILL.md:121`; `plugins/sp/tests/skill-structure.test.ts:2114`. Executed: `bun run spur-check` (exit 0). |
| Scenario: R5 — find-existing-workflow searches every listed layer | MET | test | Workflow discovery consumes the complete CLI layer catalog. `plugins/sp/skills/spur-cli/references/workflows/operations.md:62`; `plugins/sp/tests/skill-structure.test.ts:2142`. Executed: `bun run spur-check` (exit 0). |
| Scenario: R6 — the composition ladder gates every promotion | MET | test | Every promotion has validation and dry-run gates; shared promotion requires consent. `plugins/sp/skills/spur-composer/SKILL.md:72`; `plugins/sp/tests/skill-structure.test.ts:2060`. Executed: `bun run spur-check` (exit 0). |
| Scenario: R7 — rule tuning is driven by rule trace evidence | MET | test | Rule tuning starts with trace evidence and ends with validate and affected-input rerun. `plugins/sp/skills/spur-composer/SKILL.md:109`; `plugins/sp/tests/skill-structure.test.ts:2071`. Executed: `bun run spur-check` (exit 0). |
| Scenario: R8 — spur-composer composes to the composition budgets | MET | test | Composition guidance preserves author/certifier independence and cache-window limits. `plugins/sp/skills/spur-composer/SKILL.md:90`; `plugins/sp/tests/skill-structure.test.ts:2152`. Executed: `bun run spur-check` (exit 0). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Requirements, Design and Plan mapped to current implementations and tests; documented extraction choices preserved. |
| P4 | quality-gate | — | `bun run spur-check` exit 0; final log `.spur/run/I21-verifyall-20260912/spur-check-final.log`. |
| P4 | build-and-cloudflare | — | build:scripts, CLI/server/web builds, build:bundle and test-cf exited 0. |
| P4 | secua-review | — | All five dimensions checked; re-audit fixes on 0819, 0823 and 0825 have red/green regression evidence. |
| P4 | artifact-disclosure | — | Rebuilt `.spur/run/0820-verify-answer.txt:1-46` and `.spur/run/0820-verdict.json` from fresh evidence; Testing rendered by task record. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-11T18:58:47.631Z todo → wip (system)
- 2026-09-11T19:21:53.020Z wip → testing (system)
- 2026-09-11T19:21:53.805Z testing → done (system)

