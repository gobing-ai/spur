---
schema_version: 1
name: "Harness eval suite: fixture task set + pipeline parity comparator"
status: todo
template: brainstorm
created_at: 2026-08-18T22:01:29.766Z
updated_at: "2026-08-18T22:31:05.740Z"
feature_id: I6
---

## 0595. Harness eval suite: fixture task set + pipeline parity comparator

### Background

`wayfinder:prototype` — ticket on map **[I6]** (Spur harness self-improvement program).

**What is the smallest harness that can prove one task pipeline is not worse than another — and what
does it show about `task-pipeline.yaml` today?**

The operator ratified at charting that a harness eval suite is in scope **and gates promotion of
`task-pipeline2.yaml`**. "Once it's mature enough" is not a bar until something measures maturity. You
cannot refactor 3,410 lines of workflow YAML and 25,088 lines of plugin prose on inspection.

This ticket runs **before** [0596] deliberately: build the comparator against the *existing* pipeline
first and capture the baseline, so the new pipeline has a target to hit rather than a story to tell.

1. **A fixture task set.** Small, deterministic, real enough to exercise precheck → implement → test →
   review → verify → done. Seeded from `sp:dogfood-testing`, which already drives a testee end-to-end
   with a bounded retry budget and a live ledger — extend it rather than building a parallel runner.
2. **A comparator.** Given a fixture set and a workflow YAML, produce a per-task record: verify
   verdict, artifacts written, gate outcomes, token cost, wall-clock. Diffable across two YAMLs.
3. **The baseline.** Run it against `config/workflows/task-pipeline.yaml` and record the result as the
   reference. This number is also the honest input to [0594]'s cost work.
4. **A proposed promotion bar** — concrete and measurable (verdict parity? cost within N%? K
   consecutive green tasks?). **Propose only.** Ratifying the bar is open question 1 on the map and
   belongs to the operator.

- Uses `spur workflow run` as-is. If the comparator wants a CLI flag that does not exist, that is an
  ADR-051 consent gate — surface it to the operator, do not add it.
- Must not require the fixture tasks to pollute the real corpus. Decide and document where fixture
  tasks live and how they are cleaned up.
- Do not touch `spur task` (feature F92, concurrent agent).

Authoring `task-pipeline2.yaml` — that is [0596].

### Requirements

- R1 — Build a deterministic fixture task set that exercises the full pipeline path (precheck → implement → test → review → verify → done), extending `sp:dogfood-testing` rather than standing up a parallel runner.
- R2 — Build a comparator that, given a fixture set and a workflow YAML, emits a per-task record of verify verdict, artifacts written, gate outcomes, token cost, and wall-clock, diffable across two workflow files.
- R3 — Run the comparator against `config/workflows/task-pipeline.yaml` and record the result as the reference baseline.
- R4 — Document where fixture tasks live and how they are cleaned up, so a comparator run never pollutes the real task corpus.
- R5 — Propose a concrete, measurable promotion bar for replacing `task-pipeline.yaml` with `task-pipeline2.yaml`, and surface it as the answer candidate for map open question 1 without ratifying it.
- R6 — Surface any required `spur` CLI flag that does not yet exist to the operator as an ADR-051 consent item instead of adding it.

### Acceptance Criteria

```gherkin
Feature: Harness eval suite

  Scenario: R1 — the fixture set exercises the whole pipeline
    Given the fixture task set is run through task-pipeline.yaml
    When the run completes
    Then precheck, implement, test, review, verify, and done were all exercised

  Scenario: R2 — two pipelines are comparable from one command
    Given a fixture set and two workflow YAML files
    When the comparator runs against both
    Then a per-task record of verdict, artifacts, gate outcomes, token cost, and wall-clock is emitted for each
    And the two records are diffable

  Scenario: R3 — a baseline exists before any rival pipeline is written
    Given task-pipeline.yaml is the only pipeline
    When the comparator is run against it
    Then a reference baseline is recorded

  Scenario: R4 — fixture runs do not pollute the corpus
    Given a comparator run has completed
    When the task corpus is inspected
    Then no fixture task remains outside its documented location

  Scenario: R5 — the promotion bar is proposed, not ratified
    Given the comparator can measure verdict parity and cost
    When the promotion bar is written
    Then it is concrete and measurable
    And it is recorded as a proposal against map open question 1

  Scenario: R6 — a missing CLI flag becomes a consent item
    Given the comparator needs a spur CLI flag that does not exist
    When that need is discovered
    Then it is surfaced to the operator as an ADR-051 consent item
    And no CLI surface change is landed
```

### Q&A

**Closed at charting / in Design.**

- Eval suite is in scope and gates pipeline2 promotion (operator, 2026-08-18).
- Surface is `scripts/spur-dev.ts`, not the `spur` CLI — ADR-051 puts self-dev tooling on the internal
  surface with no consent gate.
- Verb name `eval-pipeline`; module `scripts/commands/eval-pipeline.ts`.
- Verdict derivation is reused from `spur task verdict --json`, not re-implemented.

**Deferred to the operator (map open question 1, owner: operator).**
The promotion bar itself. This task proposes; the operator ratifies.

**Open, resolvable by the implementer.**

- Whether the fixture set can be made deterministic enough for parity to mean anything, given the
  pipeline invokes a model. If not, the honest answer is a variance band rather than an equality
  test — report which, with the measured variance, rather than forcing a binary.
- Whether token cost is recoverable per run from existing artifacts. If not, record `null` and state
  the gap; do not silently drop the field.

### Design

**WHAT.** A runnable comparator plus a recorded baseline. This task **does ship code** — the first in
the map that does.

**WHY.** `task-pipeline2.yaml` ([0596]) cannot be promoted on inspection. The operator ratified a
parity gate, which requires something that measures parity. Building it against the *existing*
pipeline first means [0596] has a target rather than a story.

**WHERE — frozen targets.**

| Piece | Location |
| --- | --- |
| Comparator command | `scripts/spur-dev.ts` + one module under `scripts/commands/` |
| Comparator tests | `scripts/commands/<name>.test.ts` (sibling, per `AGENTS.md`) |
| Fixture tasks | `tests/fixtures/pipeline-eval/` — **outside** `docs/tasks*`, never the real corpus |
| Baseline artifact | `.spur/reports/pipeline-eval/<iso>-baseline.json` |
| Pipeline under test | `config/workflows/task-pipeline.yaml` (read-only here) |
| Seed skill | `plugins/sp/skills/dogfood-testing/SKILL.md` (608 lines) — extend its protocol, do not fork it |

**Surface decision — frozen: this is `scripts/spur-dev.ts`, not the `spur` CLI.** Per ADR-051 the
`spur` CLI is the public end-user surface and any noun/verb addition needs operator consent with
design context; `scripts/spur-dev.ts` is the internal Spur-self-dev surface with no consent gate and
is explicitly scoped to "monorepo gates" and "building Spur itself". A pipeline eval harness is
Spur-self-dev. **Do not add a `spur eval` noun.**

**Naming — frozen.** Command verb `eval-pipeline`, matching the existing `bundle-*` / `verify-pack` /
`link-check` verb style. Module `scripts/commands/eval-pipeline.ts`. No other new names.

**Comparator contract — frozen record shape.** One row per fixture task per pipeline:

```
{ wbs, pipeline, verdict, gateOutcomes[], artifactsWritten[], tokenCost, wallClockMs, exitCode }
```

`verdict` comes from `spur task verdict <wbs> --json` (the CLI already derives PASS/PARTIAL/FAIL/
UNKNOWN — **do not re-implement verdict parsing**). `artifactsWritten` is the `.spur/run` delta
across the run. `tokenCost` from the run's agent-session artifacts; when a run yields no token data,
record `null` and count it as unmeasured — never zero.

**Algorithm.** Snapshot `.spur/run` → run the fixture set against pipeline A → snapshot → diff →
repeat for pipeline B → emit both record sets and a per-field diff. Determinism is not assumed: the
report states run count and variance, and a single run is labelled as such.

**Anti-patterns — do not do these.**

- Do not add a `spur` CLI noun or verb. That is an ADR-051 consent gate; surface it instead (R6).
- Do not create fixture tasks in `docs/tasks*`. They collide with the live WBS allocator and would be
  swept by `spur task check --corpus`.
- Do not re-implement verdict derivation, task-check, or section-matrix logic — `spur task verdict`
  and `spur task check` already own it, and F92 is actively changing that surface in this tree.
- Do not write `task-pipeline2.yaml` here. That is [0596].
- Do not ratify the promotion bar. R5 proposes; map open question 1 decides.

**Handoff to [0596].** [0596] consumes: the `eval-pipeline` command, the fixture set location, and
the baseline artifact path. This task must leave those three stable — they are [0596]'s only
interface to it. Any change to the record shape after [0596] starts breaks its parity run.

### Plan

- [ ] Read `sp:dogfood-testing` and decide precisely which of its protocol to extend vs re-use as-is; record the seam (R1)
- [ ] Design the fixture task set: minimal, deterministic, exercising precheck→implement→test→review→verify→done (R1)
- [ ] Place fixtures under `tests/fixtures/pipeline-eval/` and document the create/cleanup lifecycle so no fixture reaches the real corpus (R4)
- [ ] Add `scripts/commands/eval-pipeline.ts` and register the verb in `scripts/spur-dev.ts` (R2)
- [ ] Implement the record shape: verdict via `spur task verdict --json`, artifacts via `.spur/run` snapshot diff, token cost, wall-clock (R2)
- [ ] Implement the two-pipeline diff output (R2)
- [ ] Write `scripts/commands/eval-pipeline.test.ts` covering record shape, snapshot diffing, and the null-token-cost case (R2)
- [ ] Run the comparator against `config/workflows/task-pipeline.yaml`; write the baseline artifact (R3)
- [ ] Record run count and variance in the report; label single-run results as such (R3)
- [ ] Draft the proposed promotion bar from what the comparator actually measures; mark it a proposal against map open question 1 (R5)
- [ ] If any needed `spur` CLI flag is absent, write it up as an ADR-051 consent item and stop there (R6)
- [ ] Verification: `bun run lint`, `bun run test`, `bun run build` green; `spur task check --corpus` shows no new fixture-induced findings; `git status` intentional

### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References

- Map: [I6](../features/I6_spur-harness-self-improvement-program-dev-spine-cost-event-5w1h-ssot-run-record-consolidation-and-board-module-boundaries.md)
- ADR-051 — two command surfaces: public `spur` CLI (consent-gated) vs internal `scripts/spur-dev.ts`
- `AGENTS.md` § Spur CLI surface — the surface-choice table this Design applies
- `AGENTS.md` § Testing — sibling `*.test.ts` location and coverage bar
- Skill `sp:dogfood-testing` — the protocol this task extends
- CLI: `spur task verdict --json`, `spur workflow run --dry-run --json`
- Dependent: [0596] (consumes the command, fixture location, and baseline artifact)

### History
