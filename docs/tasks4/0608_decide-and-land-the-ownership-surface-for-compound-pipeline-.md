---
schema_version: 1
name: "Decide and land the ownership surface for compound pipeline shell"
status: done
template: feature-impl
created_at: 2026-08-20T00:09:14.886Z
updated_at: "2026-09-06T23:39:25.108Z"
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
- [x] R1. Every compound shell program in the shipped pipelines has a decided owner (feature R4). Inventory the `shell` actions across `config/workflows/*.yaml`, and classify each as: public `spur` verb, application service, built-in action kind, workflow-relative external extension, or deliberately-stays-shell. Classification is per-case and reasoned — the deciding factor is whether the behavior is reusable product semantics, project-only policy, or genuinely trivial glue. A case left in shell records **why**, so the exception is visible rather than assumed.

- [x] R2. Public-surface changes carry explicit operator consent (feature R4). Any new or changed `spur` noun, verb, flag, JSON field, or human-output contract is presented to the operator with design context and the surface alternatives **before** it lands, per ADR-051. Respect the noun-first rule: the first CLI layer is nouns, so a new noun is justified only when no existing noun can host the action. Landing a public surface change without recorded consent is the failure mode this requirement prevents.

- [x] R3. At least the two blocked D5-L cases are resolved (feature R5). `qualityGateCmd` and the `task-pipeline.yaml` precheck doctor probe each reach a decided owner and land there, or are recorded as deliberate shell exceptions with the reason. These two are the concrete evidence the gap is real; a decision that leaves both untouched with no reason recorded does not satisfy this task.

- [x] R4. Landing a surface deletes the shell it replaces (feature R5). The owning capability ships with unit and failure-path tests, the pipeline invokes it, and the replaced shell is **removed** — not left beside the new path. `config/workflow-composition-baseline.json` records the new action facts in the same commit, and the affected pipeline's own tests prove behavior parity.

- [x] R5. The seeded-project portability rule is stated and honored. `spur init` never scaffolds `packages/` or `plugins/sp/`, so any capability a shipped workflow invokes must resolve in a seeded project or degrade deliberately. Record the rule, and either retire the dual-implementation split introduced for the idea handoff in task 0604 (`packages/app/src/workflow/idea-handoff-cli.ts` plus its shell fallback) or record why the split is the correct steady state.

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
**Decision record (R1, R2, R5).** The ownership surface for every compound shell program in the
shipped pipelines is decided and recorded in the new decision record
`docs/design/workflow-shell-ownership.md`. All **58** `onEnter` / `onExit` shell programs across
`config/workflows/*.yaml` are classified individually (reusable product semantics → built-in /
application service; project-only policy → recorded shell exception; trivial glue → stays shell),
plus two reasoned bulk exceptions: the **92** transition guards and the single-`$spurBin`-call
state actions. No public `spur` noun / verb / flag / JSON-field / human-output contract changes, so
R2 requires no operator consent decision; the alternatives considered are recorded in the design
doc. The two mandatory D5-L cases reach decided owners: the doctor probe lands (below);
`qualityGateCmd` is a recorded deliberate shell exception (project-only policy; `command.gate` bans
shell strings by design; the per-project override surface is the semantic).

**Doctor probe lands as `doctor.probe` built-in (R3, R4, scenario R5).**

- `packages/app/src/workflow/actions/doctor-probe.ts` — new least-privilege built-in action kind
  (option c). Moves the task-pipeline precheck auth classifier out of shell: probes each resolved
  executor via `spur agent doctor <exe> --json`, classifies the detail (omp/pi env-key misses soft,
  explicit auth failures hard), writes PASS/FAIL to a status file under `.spur/run/`, and always
  succeeds (soft probe — transition guards route on the token). Preserves the executor-divergence
  line when `agent` ≠ `implementAgent`.
- `packages/app/src/workflow/builtins.ts:13,84-88` — registers the runner on the workflow host.
- `config/workflows/task-pipeline.yaml:136-163` — `precheck:onEnter:0` now invokes `doctor.probe`;
  the ~40-line shell classifier is **deleted**, not left beside the new path.
- `config/workflow-composition-baseline.json` (line 268-272 at the time; store retired by ADR-108, `docs/00_ADR.md:1002`) — `precheck:onEnter:0` action facts updated
  to `doctor.probe` in the same commit (composition parity enforced by
  `packages/app/tests/workflow/composition-baseline.test.ts`).
- `packages/app/tests/workflow/actions/doctor-probe.test.ts` — new unit + failure-path tests (10):
  PASS on authenticated, FAIL on hard auth failure, SOFT on omp/pi env-miss, both-executor
  divergence, single-executor, doctor exit non-zero, resultFile confinement, multi-token `spurBin`
  split, metacharacter rejection, unparseable-output degradation.
- `plugins/sp/tests/task-pipeline-resilience.test.ts:102-131` — the affected pipeline's own test
  now drives the real built-in + `NodeProcessExecutor` against the same fake doctor binary,
  asserting identical PASS/FAIL + output lines (behavior parity). The two dirty-tree subtests'
  shell ordinal shifted (doctor is no longer a shell action) and were updated to index 0.

**Portability rule (R5).** Stated in `docs/design/workflow-shell-ownership.md` — any capability a
shipped workflow invokes must resolve in a seeded project or degrade deliberately. Built-ins run
in-process in the `spur` CLI (portable by construction); external extensions carry a `spur`-verb
fallback; the idea-handoff dual implementation (`packages/app/src/workflow/idea-handoff-cli.ts` +
the portable jq/shell fallback in `idea-pipeline handoff-finalize:onEnter:0`) is **recorded as the
correct steady state**, not retired: the monorepo hosts the typed writer, seeded projects get the
portable shell program, both halves share one contract.

**Stale-doc correction.** `docs/design/workflow-composition-contract.md` — D5-L row updated: the
doctor probe is no longer "stays shell"; it landed on the `doctor.probe` built-in (D6).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/design/workflow-shell-ownership.md:80` "Individual classification (58 programs)" — the table rows were counted independently this run: exactly **58** ` |
| R2 | MET | `docs/design/workflow-shell-ownership.md:70-78` — consent posture recorded: no public `spur` noun, verb, flag, JSON field, or human-output contract changed, so no ADR-051 consent decision is required. `doctor.probe` is a workflow **action kind**, the same internal surface class as `command.gate` / `run.artifact` (task 0603). Verified against the diff: no `apps/cli` surface file is touched by this task. The sole future consent trigger (`qualityGateCmd` external-extension home) is named and deferred. |
| R3 | MET | Both blocked D5-L cases reach a decided owner. Doctor probe → option (c) least-privilege built-in, landed at `packages/app/src/workflow/actions/doctor-probe.ts` and registered at `packages/app/src/workflow/builtins.ts:13` (import) / `:88` (`new DoctorProbeActionRunner(`). `qualityGateCmd` → recorded deliberate shell exception at `docs/design/workflow-shell-ownership.md:49-56`, with the reason stated: the per-project override string **is** the semantic, and `command.gate` bans shell strings by design. |
| R4 | MET | Replaced shell deleted, not shadowed: `config/workflows/task-pipeline.yaml:157` is `- kind: doctor.probe`, and the shell auth classifier is gone — independently confirmed this run by counting shell state actions in `task-pipeline.yaml`: **16 at `git HEAD` → 15 in the working tree**, i.e. exactly one shell program removed as the built-in landed. Same-commit baseline update: `config/workflow-composition-baseline.json` (line 269 at the time; store retired by ADR-108, `docs/00_ADR.md:1002`) `"kind": "doctor.probe"`. Unit + failure-path tests and behavior parity: `bun test packages/app/tests/workflow/actions/doctor-probe.test.ts plugins/sp/tests/task-pipeline-resilience.test.ts packages/app/tests/workflow/composition-baseline.test.ts` → **36 pass, 0 fail** this run, with `doctor-probe.ts` at 100% line and function coverage. |
| R5 | MET | `docs/design/workflow-shell-ownership.md:186-192` — the seeded-project portability rule is stated: `spur init` scaffolds neither `packages/` nor `plugins/sp/`, so built-in action kinds (`doctor.probe`, `command.gate`, `run.artifact`) run in-process in the `spur` CLI and are portable by construction; external extensions carry a `spur`-verb fallback; app services stay monorepo-only. The idea-handoff dual implementation (`packages/app/src/workflow/idea-handoff-cli.ts` + the portable jq/shell fallback) is recorded as the correct steady state with its reasoning, which is the alternative R5 explicitly permits. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R4 — Compound pipeline shell has a decided owner under ADR-051 [docs-only] | MET | static-ref | `docs/design/workflow-shell-ownership.md:36-44,49-56,70-78,80-185` — 58 individually classified programs (row count verified this run) plus two reasoned bulk exceptions; consent posture recorded as no-decision-required with the reason; the case left in shell (`qualityGateCmd`) records why at `:49-56`. The decision, not the code, is this scenario's deliverable per the task Design. |
| Scenario: R5 — The chosen surface lands and the shell it replaces is deleted | MET | test | `bun test packages/app/tests/workflow/actions/doctor-probe.test.ts plugins/sp/tests/task-pipeline-resilience.test.ts packages/app/tests/workflow/composition-baseline.test.ts` → 36 pass this run. The pipeline invokes the capability (`config/workflows/task-pipeline.yaml:157`), the baseline records the new action facts (`config/workflow-composition-baseline.json` (line 269 at the time; store retired by ADR-108, `docs/00_ADR.md:1002`)), and the replaced shell is removed — proven by the independent 16 → 15 shell-action count against `git HEAD`, not by assertion. `plugins/sp/tests/task-pipeline-resilience.test.ts` drives the real `DoctorProbeActionRunner` + `NodeProcessExecutor` against the same fake doctor binary, so parity is executed rather than argued. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Scope:** working-tree diff of task 0608 (task `wip`): the `doctor.probe` built-in action kind lands (`packages/app/src/workflow/actions/doctor-probe.ts`), the task-pipeline precheck doctor shell classifier is deleted, `config/workflow-composition-baseline.json` action facts are updated in the same commit, the decision record `docs/design/workflow-shell-ownership.md` is added, and behavior parity is proven by unit + pipeline tests.

**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture.

**Verdict:** PASS

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | correctness | `packages/app/src/workflow/actions/doctor-probe.ts:114` | `resultFile` confinement is a prefix check (`normalized.startsWith(allowedDir)`), so sibling paths `.spur/run-evil/x` and `.spur/run2/x` pass and write outside `.spur/run/`. Input is trusted workflow YAML and the bypass stays under `.spur/` (low real-world impact), but the check does not deliver its own failure-path guarantee ("must resolve beneath .spur/run/"). Remediation: boundary-compare `normalized === allowedDir || normalized.startsWith(allowedDir + sep)` (import `sep` from `node:path`), or `relative(allowedDir, normalized)` rejecting `..`-prefixed / absolute results. Add a sibling-collision test. |
| P4 | architecture | `docs/design/workflow-shell-ownership.md:77` | Documented deviations, not blockers: Plan step 4 (prototype the external-extension path from a seeded layout) is deferred with a recorded reason (no extension mechanism exists yet); the frozen inventory count (49/7/92 = 148) re-measured to 58/92 = 150 with the +2 boundary-idiom delta explained. Both are explicit in the decision record, so no silent deviation. |

**Functional Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `docs/design/workflow-shell-ownership.md:80` — all 58 `onEnter`/`onExit` shell programs classified individually (BUILTIN/EXT/POLICY/GLUE/DUAL/SIMPLE) plus two reasoned bulk exceptions (92 guards, single-`$spurBin` glue); every case carries a disposition and reason |
| R2 | MET | `docs/design/workflow-shell-ownership.md:70-78` — consent posture recorded: no public `spur` noun/verb/flag/JSON-field/human-output contract changes, so no consent decision required; the two mandatory cases routed to non-public owners; `doctor.probe` is a workflow action kind (same internal surface class as `command.gate`/`run.artifact`, task 0603) |
| R3 | MET | doctor probe → option (c) built-in, landed at `packages/app/src/workflow/actions/doctor-probe.ts`; `qualityGateCmd` → option (e) recorded deliberate shell exception with the project-only-policy rationale (`docs/design/workflow-shell-ownership.md:49-56`). Both mandatory D5-L cases have explicit dispositions |
| R4 | MET | Replaced shell deleted: `config/workflows/task-pipeline.yaml:157` `kind: doctor.probe` replaces the ~40-line classifier (diff removes 64 lines); same-commit baseline update `config/workflow-composition-baseline.json:269`; unit + failure-path tests `packages/app/tests/workflow/actions/doctor-probe.test.ts` (10); behavior parity via the pipeline's own test `plugins/sp/tests/task-pipeline-resilience.test.ts:104-131` |
| R5 | MET | `docs/design/workflow-shell-ownership.md:188-202` — seeded-project portability rule stated (built-ins portable by construction; extensions carry a `spur`-verb fallback; app services monorepo-only); idea-handoff dual implementation (`idea-handoff-cli.ts` + portable jq/shell fallback) recorded as the correct steady state with the retirement-cost reasoning |

**SECUA Review**

- S: `doctor.probe` splits the resolved `spurBin` into argv without a shell and rejects shell metacharacters (`doctor-probe.ts:20-31`) — no injection surface; no secrets handled; status writes confined under `.spur/` (see P3 for the prefix gap).
- E: exactly one `spur agent doctor <exe> --json` subprocess per resolved executor, buffered; no N+1, no unbounded growth.
- C: unparseable doctor output degrades to `unknown` auth without failing the run; omp/pi env-key misses stay soft, explicit auth failures hard (0487/0503 semantics preserved); executor-divergence line emitted only when the two executors differ; non-zero doctor exit writes FAIL.
- U: hard-fail line carries actionable remediation (`fix agent.default or pass --vars '{"agent":"<authenticated-executor>"}' … agent doctor <exe> --json`); missing-option errors name the exact key.
- A: new built-in registered consistently with siblings (`builtins.ts:88-92`); pure `classifyDoctorProbe` / `parseDoctorJson` extracted with injected `ProcessExecutor` / `FileSystem` seams.

**Architecture**

No deepening candidates in scope. `doctor-probe.ts` is a deep module — a narrow `execute(options, context)` interface over real logic (classification, JSON parsing, multi-executor probing, status-file write) — the exact consolidation the shell could not express. Not shallow, no tight coupling (seams injected), locality strong (the previously scattered classifier now lives in one module), test surface excellent.

**Verification Evidence (fresh, run this turn)**

- `bun test packages/app/tests/workflow/actions/doctor-probe.test.ts` → 10 pass, 0 fail (34 expects)
- `bun test plugins/sp/tests/task-pipeline-resilience.test.ts` → 7 pass, 0 fail (behavior parity through real built-in + `NodeProcessExecutor` against the same fake doctor binary)
- `bun test packages/app/tests/workflow/composition-baseline.test.ts` → 18 pass, 0 fail (composition parity enforced)
- `bun test plugins/sp/tests/inline-pipeline-driver.test.ts` → 3 pass, 0 fail (smoke harness handles the new action kind)
- `spur workflow validate config/workflows/task-pipeline.yaml` → `workflow valid: task-pipeline`

**Disposition:** PASS — all 5 requirements MET; no blocker/major findings. One P3 confinement-hardening finding (defense-in-depth, non-blocking) and one P4 note on documented deferrals. `doctor.probe` lands cleanly, the replaced shell is deleted, and behavior parity is proven by the affected pipeline's own tests.
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-20T18:34:58.534Z todo → wip (system)
- 2026-08-20T18:50:26.979Z wip → testing (system)
- 2026-08-20T18:50:46.979Z testing → done (system)
