---
schema_version: 1
name: "Decide and land the ownership surface for compound pipeline shell"
status: todo
template: feature-impl
created_at: 2026-08-20T00:09:14.886Z
updated_at: "2026-08-20T07:54:16.720Z"
feature_id: D6
dependencies: ["0606"]
---

## 0608. Decide and land the ownership surface for compound pipeline shell

### Background
Implements feature D6 scenarios R4–R5.

**Provenance.** The original workflow-refactor brief said: *"For `shell` node, if needed, we can centralize these shell logic to be the part of spur CLI itself or some built-in extention or some external extension. All depends on the nature and your intention."* Feature D5 carried the built-in half (`command.gate`, `run.artifact` shipped in task 0603) but put **a new public CLI noun or verb** explicitly out of scope under ADR-051, and never exercised the external-extension path at all. That gap is what stopped task 0604's D5-L wave.

**Evidence that the gap is real, not theoretical (task 0604, 2026-08-19):**

- `qualityGateCmd` defaults to `"bun run format && bun run spur-check"` — a compound shell string documented as a per-project override and executed via `sh -c`. `command.gate` bans shell strings by design, so the `test` hop could not migrate without either breaking that override surface or defeating the primitive's purpose.
- The `task-pipeline.yaml` precheck doctor probe is a ~40-line classifier: per-agent-family auth classification (omp/pi env-key misses are soft, explicit auth failures are hard) and an executor-divergence line, accumulated across tasks 0487 and 0503. `command.gate` records exit codes only, so migrating it as-is would delete that logic.
- The `docs-pipeline.yaml` precheck did migrate, but only because both its checks are plain single-verb `spur` invocations.
- `plugins/sp/scripts/` is the repo's existing portable mechanism for tested TS callable from YAML (`pr-review.yaml` uses `bun "$(superskill script path sp pr-reviewing.ts)"`), but those scripts are **standalone** — `node:*` imports only, no workspace imports — so hosting `packages/app` logic there means duplicating it, which is the outcome D5 exists to prevent.
- Consequently task 0604's idea-handoff wiring (D5-O) had to ship as a monorepo-writer plus a portable shell fallback: `packages/app/src/workflow/idea-handoff-cli.ts` runs where `packages/` exists, and seeded projects fall through to the original jq/shell program. Two implementations of one contract, sanctioned by 0604's Q&A but not a resting place.

**The actual decision this task owns.** For each case, the portable-surface options are (a) a public `spur` verb — needs explicit operator consent with design context under ADR-051, and per that ADR the first CLI layer is **nouns only**, so a new action must justify why no existing noun can host it; (b) an application service reachable only in the monorepo; (c) a least-privilege built-in action kind; (d) a workflow-relative external extension. Option (d) is the least-explored and may be the right home for project-only policy like `qualityGateCmd`.
### Requirements
- [ ] R1. Every compound shell program in the shipped pipelines has a decided owner (feature R4). Inventory the `shell` actions across `config/workflows/*.yaml`, and classify each as: public `spur` verb, application service, built-in action kind, workflow-relative external extension, or deliberately-stays-shell. Classification is per-case and reasoned — the deciding factor is whether the behavior is reusable product semantics, project-only policy, or genuinely trivial glue. A case left in shell records **why**, so the exception is visible rather than assumed.

- [ ] R2. Public-surface changes carry explicit operator consent (feature R4). Any new or changed `spur` noun, verb, flag, JSON field, or human-output contract is presented to the operator with design context and the surface alternatives **before** it lands, per ADR-051. Respect the noun-first rule: the first CLI layer is nouns, so a new noun is justified only when no existing noun can host the action. Landing a public surface change without recorded consent is the failure mode this requirement prevents.

- [ ] R3. At least the two blocked D5-L cases are resolved (feature R5). `qualityGateCmd` and the `task-pipeline.yaml` precheck doctor probe each reach a decided owner and land there, or are recorded as deliberate shell exceptions with the reason. These two are the concrete evidence the gap is real; a decision that leaves both untouched with no reason recorded does not satisfy this task.

- [ ] R4. Landing a surface deletes the shell it replaces (feature R5). The owning capability ships with unit and failure-path tests, the pipeline invokes it, and the replaced shell is **removed** — not left beside the new path. `config/workflow-composition-baseline.json` records the new action facts in the same commit, and the affected pipeline's own tests prove behavior parity.

- [ ] R5. The seeded-project portability rule is stated and honored. `spur init` never scaffolds `packages/` or `plugins/sp/`, so any capability a shipped workflow invokes must resolve in a seeded project or degrade deliberately. Record the rule, and either retire the dual-implementation split introduced for the idea handoff in task 0604 (`packages/app/src/workflow/idea-handoff-cli.ts` plus its shell fallback) or record why the split is the correct steady state.

> **Cross-reference (2026-08-20):** task **0610 R4** adds a nested-pipeline-run refusal that touches
> `agent.run` and `spur workflow run`. It deliberately ships **no** new public noun, verb, or flag —
> refusal is the unconditional default. If a real caller ever needs an opt-out, that flag is a public
> surface change and belongs to this task's R2 consent path, not to 0610.

**Non-goals:** adding a public verb without consent; re-running D5's migrations; duplicating `packages/app` logic into a standalone plugin script to dodge the surface question; changing the proof-state invariant; the query-cost work (task 0607) or D5's closure (task 0606).
### Acceptance Criteria
```gherkin
Feature: Ownership surface for compound pipeline shell

  Scenario: R4 — Compound pipeline shell has a decided owner under ADR-051
    Given deterministic behavior that lives in pipeline shell because no owned capability can host it
    When each case is classified
    Then it resolves to a public spur verb, an application service, a built-in, or a workflow-relative external extension
    And every new or changed public surface carries explicit operator consent with design context
    And a case deliberately left in shell records why, so the exception is visible rather than assumed

  Scenario: R5 — The chosen surface lands and the shell it replaces is deleted
    Given a consented ownership decision for a shell program
    When the owning capability ships with unit and failure-path tests
    Then the pipeline invokes the capability and the replaced shell is removed, not left beside it
    And the composition baseline records the new action facts in the same commit
    And behavior parity is proven by the affected pipeline's own tests
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**WHAT.** Decide, under ADR-051, who owns each compound shell program in the shipped pipelines — a
public `spur` verb, an application service, a built-in action kind, a workflow-relative external
extension, or a recorded shell exception — and land the decision for at least the two cases D5-L
could not migrate.

**WHY.** D5 shipped the built-in half (`command.gate`, `run.artifact`, task 0603) but ruled a new
public CLI surface out of scope, and never exercised the external-extension path. That is what stopped
task 0604's D5-L wave and forced the idea-handoff dual implementation. The decision, not the code, is
the deliverable.

#### WHERE — frozen inventory scope (measured on this tree, 2026-08-20)

`grep -c 'kind: shell'` reports **148**, which is misleading: it counts transition guards too.
Measured precisely by parsing the definitions:

| Class | Count | Disposition |
| --- | --- | --- |
| **Compound state actions** (`onEnter` / `onExit`, multi-statement or control-flow) | **49** | **The inventory R1 owns.** |
| Simple state actions (one `$spurBin …` call) | 7 | Stated bulk exception — trivial glue, no reusable semantics. |
| Transition guards (`guard: kind: shell`) | 92 | Stated bulk exception — single boolean predicates (`test … && $spurBin …`). |
| **Total shell programs** | **148** | |

Compound state actions by workflow: `idea-pipeline` 13, `task-pipeline` 13, `pr-review` 8,
`wayfinder-resolution` 4, `wrapup-pipeline` 4, `basic` 3, `docs-pipeline` 2, `feature-dev` 2.

**Classify the 49 individually; record the 7 and the 92 as two reasoned bulk exceptions.** R1 says a
case left in shell must record *why* — a bulk exception with a stated rule satisfies that and keeps
the task finishable. Classifying 148 programs one by one is not a better decision, it is a worse one
made 148 times.

> **ponytail: known ceiling.** The bulk exception is a judgment that guards and one-liners carry no
> reusable product semantics. If a specific guard later proves to hold real policy, promote that one
> case out of the exception — do not re-open all 92.

#### The two mandatory cases (R3)

1. **`qualityGateCmd`** — defaults to `"bun run format && bun run spur-check"`, documented as a
   per-project override, executed via `sh -c`. `command.gate` bans shell strings by design, so it
   cannot host this without either breaking the override surface or defeating the primitive. This is
   **project-only policy**, not product semantics — the strongest candidate for option (d), a
   workflow-relative external extension, or for a recorded permanent shell exception.
2. **`task-pipeline.yaml` precheck doctor probe** — a ~40-line classifier (per-agent-family auth
   classification, executor-divergence line) accumulated across tasks 0487 and 0503. `command.gate`
   records exit codes only, so migrating as-is would delete the classification. This is **reusable
   product semantics** — the strongest candidate for option (b), an application service, with the
   pipeline invoking it.

**Precision note:** `docs-pipeline`'s precheck migrated *partially* — 2 of its 4 precheck actions are
`command.gate`; a third is still a `shell` PASS/FAIL combiner. Cite it as a partial precedent, not a
clean one.

#### Frozen decision options (ADR-051)

(a) public `spur` verb — **needs explicit operator consent with design context before it lands**, and
the first CLI layer is **nouns only**, so a new noun is justified only when no existing noun can host
the action; (b) application service, monorepo-only; (c) least-privilege built-in action kind;
(d) workflow-relative external extension; (e) deliberately-stays-shell **with a recorded reason**.

**No public surface lands in this task without recorded consent.** That is R2, and it is the failure
mode this task exists to prevent.

#### Seeded-project portability rule (R5)

`spur init` scaffolds neither `packages/` nor `plugins/sp/`, so any capability a shipped workflow
invokes must resolve in a seeded project or degrade deliberately. `plugins/sp/scripts/` is the existing
portable mechanism (`pr-review.yaml` calls `bun "$(superskill script path sp pr-reviewing.ts)"` in 8
places), but those scripts are standalone — `node:*` imports only — so hosting `packages/app` logic
there means duplicating it, which is the outcome D5 exists to prevent. Task 0604 resolved this once by
shipping both (`packages/app/src/workflow/idea-handoff-cli.ts` **plus** a shell fallback). R5 requires
either retiring that split or recording why it is the correct steady state.

#### Anti-patterns (do not implement)

- Copying `packages/app` logic into a standalone `plugins/sp/scripts/` twin to dodge the surface
  question. That is the duplication D5 exists to prevent, and R5 names it.
- Adding a public noun, verb, or flag without recorded consent, or adding a **noun** where an existing
  noun could host a verb (ADR-051 noun-first).
- Migrating the doctor probe to `command.gate` as-is — it records exit codes only, so the
  classification would be silently deleted.
- Forcing `qualityGateCmd` into `command.gate` by pre-splitting the shell string; that breaks the
  documented per-project override.
- Leaving a replaced shell beside its new owner (R4 requires deletion).
- Classifying all 148 programs individually.

#### Cross-task contract

- **Depends on 0606** for D5 closure ordering only; no code overlap.
- **Owns the consent path for 0610 R4.** 0610 adds a nested-run refusal touching `agent.run` and
  `spur workflow run` with **no** new public flag (refusal is unconditional). If a real caller ever
  needs an opt-out, that flag is a public surface change and belongs to R2 here.
- **Does not own cost/query work** — task **0607**. If a measurement needs a new surface, 0607 routes
  it here.
- **Leaves for dependents:** the recorded classification becomes the precedent any future shell
  program is judged against.
### Plan
1. **Inventory (R1) — scope frozen in Design.** Classify the **49 compound state actions** individually (state, purpose, and whether the behavior is reusable product semantics, project-only policy, or trivial glue). Record the **7 simple state actions** and the **92 transition guards** as two reasoned *bulk* exceptions, not 99 individual verdicts. Verify: all 49 compound cases carry a disposition and a reason; both bulk exceptions state their rule; the counts in the write-up match a re-run of the measurement (49 / 7 / 92, total 148).
2. **Classify (R1, R3).** Assign each of the 49 one of: public `spur` verb, application service, built-in action kind, workflow-relative external extension, deliberately-stays-shell. Record the reason per case. Verify: `qualityGateCmd` and the `task-pipeline` precheck doctor probe each have an explicit disposition — these two are mandatory under R3 and a run that leaves both untouched with no reason recorded does not satisfy this task.
3. **Consent round (R2).** Present the surface-affecting subset to the operator with design context and alternatives, honoring ADR-051's noun-first rule. Verify: a recorded consent decision exists before any public-surface code lands.
4. **Prototype the external-extension path (R1).** It is the least-explored option and the most likely home for project-only policy like `qualityGateCmd`. Verify: a workflow-relative extension loads and runs from a seeded-project layout, not just the monorepo.
5. **Land the decided owners (R3, R4).** Ship each capability with unit and failure-path tests, point the pipeline at it, delete the replaced shell, and update `config/workflow-composition-baseline.json` in the same commit. Verify: affected pipeline tests green; `spur workflow validate` green; the removed shell is absent from the diff's "after" side.
6. **Portability rule (R5).** State the seeded-project rule, then either retire the idea-handoff dual implementation from task 0604 or record why it is the correct steady state. Verify: whichever path is chosen, a seeded-layout test proves the workflow still resolves its capability.
7. **Gates.** `bun run lint`, targeted tests, `spur workflow validate`, `bun run script-contract-check` if plugin scripts change, then `bun run spur-check`.

**Done when** every compound shell action has a recorded owner, the two blocked D5-L cases are resolved or reasoned exceptions, each landed capability replaced its shell rather than shadowing it, and no public surface changed without recorded consent.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
